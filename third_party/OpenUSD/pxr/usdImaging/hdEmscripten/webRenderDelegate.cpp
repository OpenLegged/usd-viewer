//
// Copyright 2016 Pixar
//
// Licensed under the Apache License, Version 2.0 (the "Apache License")
// with the following modification; you may not use this file except in
// compliance with the Apache License and the following modification to it:
// Section 6. Trademarks. is deleted and replaced with:
//
// 6. Trademarks. This License does not grant permission to use the trade
//    names, trademarks, service marks, or product names of the Licensor
//    and its affiliates, except as required to comply with Section 4(c) of
//    the License and to reproduce the content of the NOTICE file.
//
// You may obtain a copy of the Apache License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the Apache License with the above modification is
// distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the Apache License for the specific
// language governing permissions and limitations under the Apache License.
//
#include "webRenderDelegate.h"
#include "pxr/base/gf/vec2f.h"
#include "pxr/imaging/hd/bufferArray.h"
#include "pxr/imaging/hd/material.h"
#include "pxr/imaging/hd/mesh.h"
#include "pxr/imaging/hd/points.h"
#include "pxr/imaging/hd/bprim.h"
#include "pxr/imaging/hd/tokens.h"
#include "pxr/imaging/hd/repr.h"
#include "pxr/imaging/hd/resourceRegistry.h"
#include "pxr/imaging/hdSt/strategyBase.h"
#include "pxr/imaging/hd/unitTestNullRenderPass.h"
#include "pxr/imaging/hd/meshUtil.h"
#include "pxr/imaging/hd/smoothNormals.h"
#include "pxr/imaging/hd/vtBufferSource.h"

#include <algorithm>
#include <cctype>
#include <iostream>
#include <utility>

using namespace emscripten;

PXR_NAMESPACE_OPEN_SCOPE

const std::map<HdInterpolation, std::string> InterpolationStrings = {
    {HdInterpolationConstant, "constant"},
    {HdInterpolationUniform, "uniform"},
    {HdInterpolationVarying, "varying"},
    {HdInterpolationVertex, "vertex"},
    {HdInterpolationFaceVarying, "facevarying"},
    {HdInterpolationInstance, "instance"}
};

void _runInMainThread(int funPointer) {
    std::function<void()>  *function = reinterpret_cast<std::function<void()>*>(funPointer);
    (*function)();
}

// Only the main thread can communicate with the JS interpreter (other threads run in web workers).
// All direct invocations of JS functions need to go through the main thread.
void runInMainThread(std::function<void()> fun) {
    emscripten_sync_run_in_main_runtime_thread(EM_FUNC_SIG_VI, _runInMainThread, (void *) &fun);
}

class Emscripten_Rprim final : public HdMesh {
public:
    Emscripten_Rprim(TfToken const& typeId,
                 SdfPath const& id,
                 emscripten::val renderDelegateInterface,
                 WebRenderDelegate* ownerDelegate)
     : HdMesh(id)
     , _typeId(typeId)
     , _renderDelegateInterface(renderDelegateInterface)
     , _ownerDelegate(ownerDelegate)
     , _rPrim(val::undefined())
     , _meshUtil(NULL)
     , _transform(1.0f)
     , _materialIdPath()
     , _uvPrimvar()
     , _adjacencyValid(false)
     , _normalsValid(false)
     , _smoothNormals(false)
    {
      _rPrim = _renderDelegateInterface.call<val>("createRPrim", std::string(typeId.GetText()), id.GetAsString());
      if (_ownerDelegate) {
          _ownerDelegate->RegisterLiveRprimPath(id.GetAsString());
      }
    }

    virtual ~Emscripten_Rprim() {
        if (!_ownerDelegate) return;
        const std::string rprimPath = GetId().GetAsString();
        _ownerDelegate->ClearRprimDelta(rprimPath);
        _ownerDelegate->RemoveProtoDataBlob(rprimPath);
        _ownerDelegate->UnregisterLiveRprimPath(rprimPath);
    }

    void findContiguousSections(
        const VtArray<int>& faces,
        std::string const& materialId,
        std::vector<WebRenderDelegate::GeomSubsetSection>& sections,
        const VtArray<int>& faceVertexCounts) {
        if (faces.empty()) return; // Return early if the input vector is empty

        int currentStart = 0;
        for (size_t i = 0; i < faces[0]; ++i) {
            currentStart += (faceVertexCounts[i] - 2) * 3;
        }

        int currentLength = (faceVertexCounts[0] - 2) * 3;

        for (size_t i = 1; i < faces.size(); ++i) {
            if (faces[i] == faces[i - 1] + 1) {
                currentLength += (faceVertexCounts[i] - 2) * 3;
            } else {
                sections.push_back({currentStart, currentLength, materialId});
                currentStart = currentLength;
                currentLength = (faceVertexCounts[i] - 2) * 3;
            }
        }

        sections.push_back({currentStart, currentLength, materialId});

        return;
    }

    virtual void Sync(HdSceneDelegate *delegate,
                      HdRenderParam   *renderParam,
                      HdDirtyBits     *dirtyBits,
                      TfToken const   &reprToken) override
    {
        // Get the id of this mesh. This is used to get various resources associated with it.
        SdfPath const& id = GetId();
        const std::string idPath = id.GetAsString();
        const bool skipHydraPayloadForProto = _IsProtoMeshRprim()
            && _ownerDelegate
            && _ownerDelegate->GetPreferProtoBlobOverHydraPayload();

        // Materials need to be synced before primvars, to allow the JS side to apply primvar information like
        // displayColor if no other material is set.
        bool fetchedTopology = false;
        if (*dirtyBits & HdChangeTracker::DirtyMaterialId) {
            auto materialId = delegate->GetMaterialId(id);
            _materialIdPath = materialId.GetAsString();

            if (materialId.IsEmpty()){
                int refineLevel = _topology.GetRefineLevel();
                _topology = HdMeshTopology(delegate->GetMeshTopology(id), refineLevel);
                fetchedTopology = true;

                auto faceVertexCounts = _topology.GetFaceVertexCounts();
                auto geomSubsets = _topology.GetGeomSubsets();
                if (!geomSubsets.empty()){
                    std::vector<WebRenderDelegate::GeomSubsetSection> sections;
                    for (const auto& geomSubset : geomSubsets) {
                        const std::string materialID = geomSubset.materialId.GetAsString();
                        findContiguousSections(geomSubset.indices, materialID, sections, faceVertexCounts);
                    }

                    if (!sections.empty()) {
                        _ownerDelegate->QueueRprimGeomSubsetMaterial(idPath, sections);
                    }
                }
            }
            else {
                _ownerDelegate->QueueRprimMaterial(idPath, materialId.GetAsString());
            }
        }

        // Update points
        if (HdChangeTracker::IsPrimvarDirty(*dirtyBits, id, HdTokens->points)) {
            VtValue value = delegate->Get(id, HdTokens->points);
            _points = value.Get<VtVec3fArray>();
            _normalsValid = false;
            if (!_points.empty() && !skipHydraPayloadForProto) {
                _ownerDelegate->QueueRprimPoints(
                    idPath,
                    reinterpret_cast<float const*>(_points.cdata()),
                    static_cast<int>(_points.size() * 3));
            }
        }

        if (HdChangeTracker::IsTopologyDirty(*dirtyBits, id)) {
            // When pulling a new topology, we don't want to overwrite the
            // refine level or subdiv tags, which are provided separately by the
            // scene delegate, so we save and restore them.
            // TODO: This was copied from the Embree mesh class. We don't actually pull subdiv and refine information, since we're not handling that kind of geometry. We always only create a triangulated mesh.
            PxOsdSubdivTags subdivTags = _topology.GetSubdivTags();

            if (!fetchedTopology){
                int refineLevel = _topology.GetRefineLevel();
                _topology = HdMeshTopology(delegate->GetMeshTopology(id), refineLevel);
            }
            _topology.SetSubdivTags(subdivTags);

            // Triangulate the input faces.
            if (_meshUtil != NULL) delete _meshUtil;
            _meshUtil = new HdMeshUtil(&_topology, GetId());
            _meshUtil->ComputeTriangleIndices(&_triangulatedIndices, &_trianglePrimitiveParams);

            if (!_triangulatedIndices.empty() && !skipHydraPayloadForProto) {
                _ownerDelegate->QueueRprimIndices(
                    idPath,
                    reinterpret_cast<int32_t const*>(_triangulatedIndices.cdata()),
                    static_cast<int>(_triangulatedIndices.size() * 3));
            }

            _normalsValid = false;
            _adjacencyValid = false;
        }

        // Sync primvars
        if (HdChangeTracker::IsAnyPrimvarDirty(*dirtyBits, id)) {
            _SyncPrimvars(delegate, *dirtyBits, idPath, skipHydraPayloadForProto);
        }

        // TODO: Various sources, such as surface representation description, the topology scheme, or the availablity
        // of authored normals (as a primvar) can impact whether we want to calculate smooth normals or not. We ignore
        // all this and simply always generate them.
        _smoothNormals = true;

        // Update the smooth normals in steps:
        // 1. If the topology is dirty, update the adjacency table, a processed
        //    form of the topology that helps calculate smooth normals quickly.
        // 2. If the points are dirty, update the smooth normal buffer itself.
        if (_smoothNormals && !_adjacencyValid) {
            _adjacency.BuildAdjacencyTable(&_topology);
            _adjacencyValid = true;
            // If we rebuilt the adjacency table, force a rebuild of normals.
            _normalsValid = false;
        }

        if (_smoothNormals && !_normalsValid) {
            _computedNormals = Hd_SmoothNormals::ComputeSmoothNormals(
                &_adjacency, _points.size(), _points.cdata());
            _normalsValid = true;
            if (!_computedNormals.empty() && !skipHydraPayloadForProto) {
                _ownerDelegate->QueueRprimNormals(
                    idPath,
                    reinterpret_cast<float const*>(_computedNormals.cdata()),
                    static_cast<int>(_computedNormals.size() * 3));
            }
        }

        if (HdChangeTracker::IsTransformDirty(*dirtyBits, id)) {
            _transform = GfMatrix4f(delegate->GetTransform(id));
            if (!skipHydraPayloadForProto) {
                _ownerDelegate->QueueRprimTransform(
                    idPath,
                    reinterpret_cast<float const*>(_transform.data()),
                    16);
            }
        }

        _UpdateProtoDataBlobCache();
        *dirtyBits &= ~HdChangeTracker::AllSceneDirtyBits;
    }


    virtual HdDirtyBits GetInitialDirtyBitsMask() const override
    {
        // Set all bits except the varying flag
        return  (HdChangeTracker::AllSceneDirtyBits) &
                (~HdChangeTracker::Varying);
    }

    virtual HdDirtyBits _PropagateDirtyBits(HdDirtyBits bits) const override
    {
        return bits;
    }


protected:
    virtual void _InitRepr(TfToken const &reprToken,
                           HdDirtyBits *dirtyBits) override
    {
        _ReprVector::iterator it = std::find_if(_reprs.begin(), _reprs.end(),
                                                _ReprComparator(reprToken));
        if (it == _reprs.end()) {
            _reprs.emplace_back(reprToken, HdReprSharedPtr());
        }
    }

private:
    template <typename VecArrayT, size_t ComponentCount>
    static std::vector<float> _FlattenFloatTupleArray(VecArrayT const& values)
    {
        if (values.empty()) return {};
        const float* rawValues = reinterpret_cast<float const*>(values.cdata());
        return std::vector<float>(
            rawValues,
            rawValues + (values.size() * ComponentCount));
    }

    static std::vector<uint32_t> _FlattenTriangulatedIndices(VtVec3iArray const& values)
    {
        if (values.empty()) return {};
        std::vector<uint32_t> flattened(values.size() * 3);
        size_t writeIndex = 0;
        for (auto const& triangle : values) {
            flattened[writeIndex++] = static_cast<uint32_t>(std::max(0, triangle[0]));
            flattened[writeIndex++] = static_cast<uint32_t>(std::max(0, triangle[1]));
            flattened[writeIndex++] = static_cast<uint32_t>(std::max(0, triangle[2]));
        }
        return flattened;
    }

    TfToken _typeId;
    emscripten::val _renderDelegateInterface;
    WebRenderDelegate* _ownerDelegate;
    emscripten::val _rPrim;
    HdMeshUtil *_meshUtil;

    VtVec3iArray _triangulatedIndices;
    VtIntArray _trianglePrimitiveParams;
    VtVec3fArray _computedNormals;

    HdMeshTopology _topology;
    GfMatrix4f _transform;
    std::string _materialIdPath;
    VtVec3fArray _points;
    VtVec2fArray _uvPrimvar;
    Hd_VertexAdjacency _adjacency;
    struct PrimvarPayload {
        std::string name;
        std::string interpolation;
        int dimension = 0;
        std::vector<float> values;
    };
    std::unordered_map<std::string, PrimvarPayload> _primvarPayloadByKey;

    bool _adjacencyValid;
    bool _normalsValid;
    bool _smoothNormals;

    bool _IsProtoMeshRprim() const
    {
        return GetId().GetAsString().find(".proto_") != std::string::npos;
    }

    bool _ShouldCapturePrimvarForProtoBlob(std::string const& name) const
    {
        return name == "st" || name == "primvars:st";
    }

    static std::string _NormalizePrimvarName(std::string const& name)
    {
        if (name.empty()) return {};

        std::string normalized = name;
        std::transform(
            normalized.begin(),
            normalized.end(),
            normalized.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        if (normalized.rfind("primvars:", 0) == 0) {
            normalized = normalized.substr(9);
        }
        return normalized;
    }

    static bool _TryGetSplitStPrimvarOrdinal(std::string const& name, int* outOrdinal)
    {
        if (outOrdinal) {
            *outOrdinal = -1;
        }

        const std::string normalized = _NormalizePrimvarName(name);
        if (normalized == "st") {
            if (outOrdinal) {
                *outOrdinal = 0;
            }
            return true;
        }
        if (normalized.rfind("st_", 0) != 0 || normalized.size() <= 3) {
            return false;
        }

        int ordinal = 0;
        for (size_t index = 3; index < normalized.size(); ++index) {
            const char ch = normalized[index];
            if (ch < '0' || ch > '9') {
                return false;
            }
            ordinal = (ordinal * 10) + static_cast<int>(ch - '0');
        }

        if (ordinal <= 0) {
            return false;
        }
        if (outOrdinal) {
            *outOrdinal = ordinal;
        }
        return true;
    }

    static size_t _GetExpectedFaceVaryingElementCount(HdMeshTopology const& topology)
    {
        const VtIntArray faceVertexCounts = topology.GetFaceVertexCounts();
        if (faceVertexCounts.empty()) return 0;

        size_t expectedCount = 0;
        for (const int countValue : faceVertexCounts) {
            if (countValue > 0) {
                expectedCount += static_cast<size_t>(countValue);
            }
        }
        return expectedCount;
    }

    bool _TryBuildMergedFaceVaryingStPrimvar(
        HdSceneDelegate* delegate,
        HdPrimvarDescriptorVector const& primvars,
        VtVec2fArray* outMergedPrimvar,
        std::string* outCanonicalPrimvarName = nullptr) const
    {
        if (!delegate || !outMergedPrimvar) return false;

        struct SplitPrimvarRecord {
            int ordinal = -1;
            std::string name;
            TfToken token;
        };

        std::vector<SplitPrimvarRecord> splitPrimvars;
        splitPrimvars.reserve(primvars.size());
        bool hasSplitSuffix = false;
        for (HdPrimvarDescriptor const& primvar : primvars) {
            const std::string name = primvar.name.GetString();
            int ordinal = -1;
            if (!_TryGetSplitStPrimvarOrdinal(name, &ordinal)) {
                continue;
            }
            if (ordinal > 0) {
                hasSplitSuffix = true;
            }
            splitPrimvars.push_back({ordinal, name, primvar.name});
        }

        if (splitPrimvars.size() <= 1 || !hasSplitSuffix) {
            return false;
        }

        std::sort(
            splitPrimvars.begin(),
            splitPrimvars.end(),
            [](SplitPrimvarRecord const& left, SplitPrimvarRecord const& right) {
                if (left.ordinal != right.ordinal) {
                    return left.ordinal < right.ordinal;
                }
                return left.name < right.name;
            });

        const size_t expectedCount = _GetExpectedFaceVaryingElementCount(_topology);
        if (expectedCount == 0) {
            return false;
        }

        VtVec2fArray mergedPrimvar;
        mergedPrimvar.reserve(expectedCount);
        for (SplitPrimvarRecord const& splitPrimvar : splitPrimvars) {
            const VtValue value = GetPrimvar(delegate, splitPrimvar.token);
            if (!value.CanCast<VtVec2fArray>()) {
                return false;
            }
            const VtVec2fArray currentPrimvar = value.Get<VtVec2fArray>();
            if (currentPrimvar.empty()) {
                continue;
            }
            for (GfVec2f const& uvValue : currentPrimvar) {
                mergedPrimvar.push_back(uvValue);
            }
        }

        if (mergedPrimvar.size() != expectedCount) {
            return false;
        }

        *outMergedPrimvar = std::move(mergedPrimvar);
        if (outCanonicalPrimvarName) {
            *outCanonicalPrimvarName = splitPrimvars.front().name;
        }
        return true;
    }

    static bool _ShouldQueuePrimvarToJs(std::string const& name)
    {
        if (name.empty()) return false;

        const std::string normalized = _NormalizePrimvarName(name);

        return normalized == "st"
            || normalized == "displaycolor"
            || normalized == "normals";
    }

    void _UpdateProtoDataBlobCache()
    {
        if (!_ownerDelegate || !_IsProtoMeshRprim()) return;

        WebRenderDelegate::ProtoDataBlobRecord record;
        record.valid = true;
        record.numVertices = static_cast<int>(_points.size());
        record.numIndices = static_cast<int>(_triangulatedIndices.size() * 3);
        record.numUVs = static_cast<int>(_uvPrimvar.size());
        record.uvDimension = record.numUVs > 0 ? 2 : 0;
        record.numNormals = static_cast<int>(_computedNormals.size());
        record.normalsDimension = record.numNormals > 0 ? 3 : 0;
        record.materialId = _materialIdPath;

        const HdGeomSubsets geomSubsets = _topology.GetGeomSubsets();
        if (!geomSubsets.empty()) {
            const VtIntArray faceVertexCounts = _topology.GetFaceVertexCounts();
            for (const HdGeomSubset& geomSubset : geomSubsets) {
                const std::string materialID = geomSubset.materialId.GetAsString();
                findContiguousSections(
                    geomSubset.indices,
                    materialID,
                    record.geomSubsetSections,
                    faceVertexCounts);
            }
        }

        if (!_points.empty()) {
            record.points = _FlattenFloatTupleArray<VtVec3fArray, 3>(_points);
        }

        if (!_triangulatedIndices.empty()) {
            record.indices = _FlattenTriangulatedIndices(_triangulatedIndices);
        }

        if (!_uvPrimvar.empty()) {
            record.uv = _FlattenFloatTupleArray<VtVec2fArray, 2>(_uvPrimvar);
        }

        if (!_computedNormals.empty()) {
            record.normals = _FlattenFloatTupleArray<VtVec3fArray, 3>(_computedNormals);
        }

        int matrixIndex = 0;
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                record.transform[matrixIndex++] = _transform[row][column];
            }
        }

        _ownerDelegate->UpsertProtoDataBlob(GetId().GetAsString(), record);
    }

    void _StorePrimvarPayload(std::string const& key,
                              std::string const& name,
                              std::string const& interpolation,
                              int dimension,
                              std::vector<float>&& values,
                              std::string const& rprimPath)
    {
        if (!_ownerDelegate || values.empty() || dimension <= 0 || rprimPath.empty()) return;
        PrimvarPayload &payload = _primvarPayloadByKey[key];
        payload.name = name;
        payload.interpolation = interpolation;
        payload.dimension = dimension;
        payload.values = std::move(values);
        _ownerDelegate->QueueRprimPrimvar(
            rprimPath,
            payload.name,
            payload.interpolation,
            payload.dimension,
            payload.values.data(),
            static_cast<int>(payload.values.size()));
    }

    // Send primvar data to JS
    void _SendPrimvar(const VtValue &value,
                      const std::string &name,
                      const HdInterpolation &interpolation,
                      std::string const& rprimPath,
                      bool queueToJs)
    {
        const std::string &ip = InterpolationStrings.at(interpolation);
        if (value.CanCast<VtVec2fArray>()) {
            VtVec2fArray primvarData = value.Get<VtVec2fArray>();
            if (_ShouldCapturePrimvarForProtoBlob(name)) {
                _uvPrimvar = primvarData;
            }
            if (!queueToJs) return;
            std::vector<float> flattened = _FlattenFloatTupleArray<VtVec2fArray, 2>(primvarData);
            _StorePrimvarPayload(name + "|2|" + ip, name, ip, 2, std::move(flattened), rprimPath);
        }
        if (value.CanCast<VtVec3fArray>()) {
            if (!queueToJs) return;
            VtVec3fArray primvarData = value.Get<VtVec3fArray>();
            std::vector<float> flattened = _FlattenFloatTupleArray<VtVec3fArray, 3>(primvarData);
            _StorePrimvarPayload(name + "|3|" + ip, name, ip, 3, std::move(flattened), rprimPath);
        }
        if (value.CanCast<VtVec4fArray>()) {
            if (!queueToJs) return;
            VtVec4fArray primvarData = value.Get<VtVec4fArray>();
            std::vector<float> flattened = _FlattenFloatTupleArray<VtVec4fArray, 4>(primvarData);
            _StorePrimvarPayload(name + "|4|" + ip, name, ip, 4, std::move(flattened), rprimPath);
        }
    }

    void _SyncPrimvars(HdSceneDelegate *delegate,
                       HdDirtyBits      dirtyBits,
                       std::string const& rprimPath,
                       bool skipHydraPayloadForProto)
    {
        SdfPath const &id = GetId();
        for (size_t interpolation = HdInterpolationConstant;
                    interpolation < HdInterpolationCount;
                    ++interpolation) {
            HdInterpolation ip = static_cast<HdInterpolation>(interpolation);
            HdPrimvarDescriptorVector primvars = GetPrimvarDescriptors(delegate, ip);
            VtVec2fArray mergedFaceVaryingStPrimvar;
            std::string mergedFaceVaryingStCanonicalName;
            const bool hasMergedFaceVaryingSt = ip == HdInterpolationFaceVarying
                && _TryBuildMergedFaceVaryingStPrimvar(
                    delegate,
                    primvars,
                    &mergedFaceVaryingStPrimvar,
                    &mergedFaceVaryingStCanonicalName);

            size_t numPrimVars = primvars.size();
            for (size_t primVarNum = 0;
                        primVarNum < numPrimVars;
                    ++primVarNum) {
                HdPrimvarDescriptor const &primvar = primvars[primVarNum];
                if (HdChangeTracker::IsPrimvarDirty(dirtyBits,
                                                    id,
                                                    primvar.name)) {
                    const std::string primvarName = primvar.name.GetString();
                    const bool isMergedFaceVaryingStFamily = hasMergedFaceVaryingSt
                        && _TryGetSplitStPrimvarOrdinal(primvarName, nullptr);
                    if (isMergedFaceVaryingStFamily
                        && !mergedFaceVaryingStCanonicalName.empty()
                        && primvarName != mergedFaceVaryingStCanonicalName) {
                        continue;
                    }

                    const VtValue value = isMergedFaceVaryingStFamily
                        ? VtValue(mergedFaceVaryingStPrimvar)
                        : GetPrimvar(delegate, primvar.name);
                    const bool queueToJs = !skipHydraPayloadForProto
                        && _ShouldQueuePrimvarToJs(isMergedFaceVaryingStFamily ? std::string("st") : primvarName);

                    switch(ip) {
                        case HdInterpolationFaceVarying: {
                            HdVtBufferSource buffer(primvar.name, value);

                            VtValue triangulated;
                            if (!_meshUtil->ComputeTriangulatedFaceVaryingPrimvar(
                                    buffer.GetData(),
                                    buffer.GetNumElements(),
                                    buffer.GetTupleType().type,
                                    &triangulated)) {
                                TF_CODING_ERROR("[%s] Could not triangulate face-varying data.",
                                    primvar.name.GetText());
                                continue;
                            }

                            _SendPrimvar(
                                triangulated,
                                isMergedFaceVaryingStFamily ? std::string("st") : primvarName,
                                ip,
                                rprimPath,
                                queueToJs);
                            break;
                        }
                        case HdInterpolationConstant:
                        case HdInterpolationVertex: {
                            _SendPrimvar(
                                value,
                                primvarName,
                                ip,
                                rprimPath,
                                queueToJs);
                            break;
                        }
                        default:
                            TF_WARN("Unsupported interpolation type '%s' for primvar %s",
                                InterpolationStrings.at(ip).c_str(),
                                primvar.name.GetText());
                    }
                }
            }
        }
    }

    Emscripten_Rprim()                                 = delete;
    Emscripten_Rprim(const Emscripten_Rprim &)             = delete;
    Emscripten_Rprim &operator =(const Emscripten_Rprim &) = delete;
};

class Emscripten_Material final : public HdMaterial {
public:
    Emscripten_Material(SdfPath const& id, emscripten::val renderDelegateInterface) :
      HdMaterial(id)
     , _renderDelegateInterface(renderDelegateInterface)
     , _sPrim(val::undefined())
    {
      _sPrim = _renderDelegateInterface.call<val>("createSPrim", std::string("material"), id.GetAsString());
    }

    virtual ~Emscripten_Material() = default;

    virtual void Sync(HdSceneDelegate *sceneDelegate,
                      HdRenderParam   *renderParam,
                      HdDirtyBits     *dirtyBits) override
    {
      if (*dirtyBits == HdMaterial::Clean) {
        return;
      }
      runInMainThread([&]() {

        VtValue vtMat = sceneDelegate->GetMaterialResource(GetId());
        if (vtMat.IsHolding<HdMaterialNetworkMap>()) {
            HdMaterialNetworkMap const& hdNetworkMap =
                vtMat.UncheckedGet<HdMaterialNetworkMap>();

            for (auto& [networkId, network]: hdNetworkMap.map) {
                for (auto& node : network.nodes) {
                    val parameters = val::object();
                    for (auto &[parameterName, value] : node.parameters) {
                        parameters.set(parameterName, value._GetJsVal());
                        if (value.IsHolding<SdfAssetPath>()) {
                            SdfAssetPath assetPath = value.Get<SdfAssetPath>();
                            parameters.set("resolvedPath", assetPath.GetResolvedPath());
                        }
                    }
                    _sPrim.call<val>("updateNode", networkId.GetString(), node.path.GetAsString(), parameters);
                }

                val relationships = val::array();
                int i = 0;
                for (auto &relationship : network.relationships) {
                    val relationshipObj = val::object();
                    relationshipObj.set("inputId", relationship.inputId.GetAsString());
                    relationshipObj.set("inputName", relationship.inputName);
                    relationshipObj.set("outputId", relationship.outputId.GetAsString());
                    relationshipObj.set("outputName", relationship.outputName);
                    relationships.set(i++, relationshipObj);
                }

                _sPrim.call<val>("updateFinished", networkId.GetString(), relationships);
            }
        }
        *dirtyBits = HdMaterial::Clean;
      });
    };

    virtual HdDirtyBits GetInitialDirtyBitsMask() const override {
        return HdMaterial::AllDirty;
    }

private:
    emscripten::val _renderDelegateInterface;
    emscripten::val _sPrim;


    Emscripten_Material()                                  = delete;
    Emscripten_Material(const Emscripten_Material &)             = delete;
    Emscripten_Material &operator =(const Emscripten_Material &) = delete;
};

const TfTokenVector WebRenderDelegate::SUPPORTED_RPRIM_TYPES =
{
    HdPrimTypeTokens->mesh,
    HdPrimTypeTokens->points
};

const TfTokenVector WebRenderDelegate::SUPPORTED_SPRIM_TYPES =
{
    HdPrimTypeTokens->material
};

const TfTokenVector WebRenderDelegate::SUPPORTED_BPRIM_TYPES =
{
};

const TfTokenVector &
WebRenderDelegate::GetSupportedRprimTypes() const
{
    return SUPPORTED_RPRIM_TYPES;
}

const TfTokenVector &
WebRenderDelegate::GetSupportedSprimTypes() const
{
    return SUPPORTED_SPRIM_TYPES;
}

const TfTokenVector &
WebRenderDelegate::GetSupportedBprimTypes() const
{
    return SUPPORTED_BPRIM_TYPES;
}

HdRenderParam *
WebRenderDelegate::GetRenderParam() const
{
    return nullptr;
}

HdResourceRegistrySharedPtr
WebRenderDelegate::GetResourceRegistry() const
{
    static HdResourceRegistrySharedPtr resourceRegistry(new HdResourceRegistry);
    return resourceRegistry;
}

HdRenderPassSharedPtr
WebRenderDelegate::CreateRenderPass(HdRenderIndex *index,
                                HdRprimCollection const& collection)
{
    return HdRenderPassSharedPtr(
        new Hd_UnitTestNullRenderPass(index, collection));
}

HdInstancer *
WebRenderDelegate::CreateInstancer(HdSceneDelegate *delegate,
                                               SdfPath const& id)
{
    return new HdInstancer(delegate, id);
}

void
WebRenderDelegate::DestroyInstancer(HdInstancer *instancer)
{
    delete instancer;
}


HdRprim *
WebRenderDelegate::CreateRprim(TfToken const& typeId,
                                    SdfPath const& rprimId)
{
    return new Emscripten_Rprim(typeId, rprimId, _renderDelegateInterface, this);
}

void
WebRenderDelegate::DestroyRprim(HdRprim *rPrim)
{
    delete rPrim;
}

HdSprim *
WebRenderDelegate::CreateSprim(TfToken const& typeId,
                                           SdfPath const& sprimId)
{
    if (typeId == HdPrimTypeTokens->material) {
        return new Emscripten_Material(sprimId, _renderDelegateInterface);
    } else {
        TF_CODING_ERROR("Unknown Sprim Type %s", typeId.GetText());
    }

    return nullptr;
}

HdSprim *
WebRenderDelegate::CreateFallbackSprim(TfToken const& typeId)
{
    if (typeId == HdPrimTypeTokens->material) {
        return new Emscripten_Material(SdfPath::EmptyPath(), _renderDelegateInterface);
    } else {
        TF_CODING_ERROR("Unknown Sprim Type %s", typeId.GetText());
    }

    return nullptr;
}


void
WebRenderDelegate::DestroySprim(HdSprim *sPrim)
{
    delete sPrim;
}

HdBprim *
WebRenderDelegate::CreateBprim(TfToken const& typeId,
                                    SdfPath const& bprimId)
{
    TF_CODING_ERROR("Unknown Bprim Type %s", typeId.GetText());

    return nullptr;
}

HdBprim *
WebRenderDelegate::CreateFallbackBprim(TfToken const& typeId)
{
    TF_CODING_ERROR("Unknown Bprim Type %s", typeId.GetText());

    return nullptr;
}

void
WebRenderDelegate::DestroyBprim(HdBprim *bPrim)
{
    delete bPrim;
}

void
WebRenderDelegate::CommitResources(HdChangeTracker *tracker)
{
    _renderDelegateInterface.call<void>("CommitResources");
}

void
WebRenderDelegate::UpsertProtoDataBlob(std::string const& rprimPath,
                                       ProtoDataBlobRecord const& record)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_protoDataBlobMutex);
    _protoDataBlobByRprimPath[rprimPath] = record;
}

bool
WebRenderDelegate::ReadProtoDataBlob(
    std::string const& rprimPath,
    std::function<void(ProtoDataBlobRecord const&)> const& reader) const
{
    if (!reader || rprimPath.empty()) return false;
    std::lock_guard<std::mutex> lock(_protoDataBlobMutex);
    const auto found = _protoDataBlobByRprimPath.find(rprimPath);
    if (found == _protoDataBlobByRprimPath.end()) return false;
    reader(found->second);
    return true;
}

void
WebRenderDelegate::ReadAllProtoDataBlobs(
    std::function<void(std::string const&, ProtoDataBlobRecord const&)> const& reader) const
{
    if (!reader) return;
    std::lock_guard<std::mutex> lock(_protoDataBlobMutex);
    for (auto const& entry : _protoDataBlobByRprimPath) {
        reader(entry.first, entry.second);
    }
}

void
WebRenderDelegate::RemoveProtoDataBlob(std::string const& rprimPath)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_protoDataBlobMutex);
    _protoDataBlobByRprimPath.erase(rprimPath);
}

void
WebRenderDelegate::RegisterLiveRprimPath(std::string const& rprimPath)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_liveRprimPathMutex);
    if (_liveRprimPathSet.insert(rprimPath).second) {
        _liveRprimPathOrder.push_back(rprimPath);
    }
}

void
WebRenderDelegate::UnregisterLiveRprimPath(std::string const& rprimPath)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_liveRprimPathMutex);
    _liveRprimPathSet.erase(rprimPath);
}

void
WebRenderDelegate::ReadAllLiveRprimPaths(
    std::function<void(std::string const&)> const& reader) const
{
    if (!reader) return;
    std::lock_guard<std::mutex> lock(_liveRprimPathMutex);
    for (std::string const& rprimPath : _liveRprimPathOrder) {
        if (_liveRprimPathSet.find(rprimPath) == _liveRprimPathSet.end()) continue;
        reader(rprimPath);
    }
}

void
WebRenderDelegate::SetPreferProtoBlobOverHydraPayload(bool prefer)
{
    _preferProtoBlobOverHydraPayload.store(prefer, std::memory_order_release);
}

bool
WebRenderDelegate::GetPreferProtoBlobOverHydraPayload() const
{
    return _preferProtoBlobOverHydraPayload.load(std::memory_order_acquire);
}

void
WebRenderDelegate::QueueRprimMaterial(std::string const& rprimPath,
                                      std::string const& materialId)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.hasMaterialId = true;
    record.materialId = materialId;
    record.dirtyMask |= kRprimDeltaDirtyMaterial;
}

void
WebRenderDelegate::QueueRprimGeomSubsetMaterial(
    std::string const& rprimPath,
    std::vector<GeomSubsetSection> const& sections)
{
    if (rprimPath.empty() || sections.empty()) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.geomSubsetSections = sections;
    record.dirtyMask |= kRprimDeltaDirtyGeomSubsetMaterial;
}

void
WebRenderDelegate::QueueRprimPoints(std::string const& rprimPath,
                                    float const* points,
                                    int pointsCount)
{
    if (rprimPath.empty() || !points || pointsCount <= 0) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.pointsPtr = reinterpret_cast<uintptr_t>(points);
    record.pointsCount = pointsCount;
    record.dirtyMask |= kRprimDeltaDirtyPoints;
}

void
WebRenderDelegate::QueueRprimIndices(std::string const& rprimPath,
                                     int32_t const* indices,
                                     int indicesCount)
{
    if (rprimPath.empty() || !indices || indicesCount <= 0) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.indicesPtr = reinterpret_cast<uintptr_t>(indices);
    record.indicesCount = indicesCount;
    record.dirtyMask |= kRprimDeltaDirtyIndices;
}

void
WebRenderDelegate::QueueRprimNormals(std::string const& rprimPath,
                                     float const* normals,
                                     int normalsCount)
{
    if (rprimPath.empty() || !normals || normalsCount <= 0) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.normalsPtr = reinterpret_cast<uintptr_t>(normals);
    record.normalsCount = normalsCount;
    record.dirtyMask |= kRprimDeltaDirtyNormals;
}

void
WebRenderDelegate::QueueRprimTransform(std::string const& rprimPath,
                                       float const* transform,
                                       int transformCount)
{
    if (rprimPath.empty() || !transform || transformCount <= 0) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    record.transformPtr = reinterpret_cast<uintptr_t>(transform);
    record.transformCount = transformCount;
    record.dirtyMask |= kRprimDeltaDirtyTransform;
}

void
WebRenderDelegate::QueueRprimPrimvar(std::string const& rprimPath,
                                     std::string const& name,
                                     std::string const& interpolation,
                                     int dimension,
                                     float const* data,
                                     int dataCount)
{
    if (rprimPath.empty() || name.empty() || interpolation.empty() || dimension <= 0 || !data || dataCount <= 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    auto found = _rprimDeltaByPath.find(rprimPath);
    if (found == _rprimDeltaByPath.end()) {
        _rprimDeltaOrder.push_back(rprimPath);
        found = _rprimDeltaByPath.emplace(rprimPath, RprimDeltaRecord()).first;
    }
    RprimDeltaRecord &record = found->second;
    auto existing = std::find_if(
        record.primvars.begin(),
        record.primvars.end(),
        [&](RprimPrimvarDeltaRecord const& primvar) {
            return primvar.name == name
                && primvar.interpolation == interpolation
                && primvar.dimension == dimension;
        });
    if (existing == record.primvars.end()) {
        record.primvars.push_back(RprimPrimvarDeltaRecord{
            name,
            interpolation,
            dimension,
            reinterpret_cast<uintptr_t>(data),
            dataCount,
        });
    } else {
        existing->dataPtr = reinterpret_cast<uintptr_t>(data);
        existing->dataCount = dataCount;
    }
    record.dirtyMask |= kRprimDeltaDirtyPrimvars;
}

void
WebRenderDelegate::ClearRprimDelta(std::string const& rprimPath)
{
    if (rprimPath.empty()) return;
    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    _rprimDeltaByPath.erase(rprimPath);
}

emscripten::val
WebRenderDelegate::TakeRprimDeltaBatch()
{
    emscripten::val batch = emscripten::val::object();
    emscripten::val entries = emscripten::val::object();
    batch.set("entries", entries);
    batch.set("count", 0.0);

    std::lock_guard<std::mutex> lock(_rprimDeltaMutex);
    int emitted = 0;
    for (std::string const& rprimPath : _rprimDeltaOrder) {
        const auto found = _rprimDeltaByPath.find(rprimPath);
        if (found == _rprimDeltaByPath.end()) continue;
        RprimDeltaRecord const& record = found->second;
        if (record.dirtyMask == 0) continue;

        emscripten::val delta = emscripten::val::object();
        delta.set("dirtyMask", static_cast<double>(record.dirtyMask));

        if (record.hasMaterialId) {
            delta.set("materialId", record.materialId);
        }

        if (!record.geomSubsetSections.empty()) {
            emscripten::val sectionArray = emscripten::val::array();
            int sectionIndex = 0;
            for (GeomSubsetSection const& section : record.geomSubsetSections) {
                emscripten::val sectionObject = emscripten::val::object();
                sectionObject.set("start", section.start);
                sectionObject.set("length", section.length);
                sectionObject.set("materialId", section.materialId);
                sectionArray.set(sectionIndex++, sectionObject);
            }
            delta.set("geomSubsetSections", sectionArray);
        }

        if (record.pointsPtr != 0 && record.pointsCount > 0) {
            delta.set("pointsPtr", static_cast<double>(record.pointsPtr));
            delta.set("pointsCount", static_cast<double>(record.pointsCount));
        }

        if (record.indicesPtr != 0 && record.indicesCount > 0) {
            delta.set("indicesPtr", static_cast<double>(record.indicesPtr));
            delta.set("indicesCount", static_cast<double>(record.indicesCount));
        }

        if (record.normalsPtr != 0 && record.normalsCount > 0) {
            delta.set("normalsPtr", static_cast<double>(record.normalsPtr));
            delta.set("normalsCount", static_cast<double>(record.normalsCount));
        }

        if (record.transformPtr != 0 && record.transformCount > 0) {
            delta.set("transformPtr", static_cast<double>(record.transformPtr));
            delta.set("transformCount", static_cast<double>(record.transformCount));
        }

        if (!record.primvars.empty()) {
            emscripten::val primvarArray = emscripten::val::array();
            int primvarIndex = 0;
            for (RprimPrimvarDeltaRecord const& primvar : record.primvars) {
                if (primvar.dataPtr == 0 || primvar.dataCount <= 0 || primvar.dimension <= 0) continue;
                emscripten::val primvarObject = emscripten::val::object();
                primvarObject.set("name", primvar.name);
                primvarObject.set("interpolation", primvar.interpolation);
                primvarObject.set("dimension", primvar.dimension);
                primvarObject.set("dataPtr", static_cast<double>(primvar.dataPtr));
                primvarObject.set("dataCount", static_cast<double>(primvar.dataCount));
                primvarArray.set(primvarIndex++, primvarObject);
            }
            if (primvarIndex > 0) {
                delta.set("primvars", primvarArray);
            }
        }

        entries.set(rprimPath, delta);
        emitted += 1;
    }

    _rprimDeltaByPath.clear();
    _rprimDeltaOrder.clear();
    batch.set("count", static_cast<double>(emitted));
    return batch;
}

PXR_NAMESPACE_CLOSE_SCOPE
