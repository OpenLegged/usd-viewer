#ifndef PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_TESTDRIVER_H
#define PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_TESTDRIVER_H

/// \file usdImaging/emscripteTest/testdriver.h

#include "pxr/pxr.h"
#include "pxr/usdImaging/usdImaging/delegate.h"

#include "pxr/imaging/hd/changeTracker.h"
#include "pxr/imaging/hd/engine.h"
#include "pxr/imaging/hd/renderIndex.h"
#include "pxr/imaging/hd/renderPass.h"
#include "pxr/imaging/hd/rprim.h"
#include "pxr/imaging/hd/rprimCollection.h"
#include "pxr/imaging/hd/tokens.h"
#include "pxr/usd/ar/asset.h"
#include "pxr/usd/ar/resolver.h"
#include "pxr/usd/ar/resolverContextBinder.h"
#include "pxr/base/tf/stringUtils.h"
#include "pxr/base/vt/array.h"
#include "pxr/base/gf/vec3f.h"
#include "pxr/base/gf/vec3d.h"
#include "pxr/usd/usdGeom/xformable.h"
#include "pxr/usd/usdGeom/xformCache.h"
#include "pxr/usd/usdGeom/mesh.h"
#include "pxr/usd/usdGeom/cube.h"
#include "pxr/usd/usdGeom/sphere.h"
#include "pxr/usd/usdGeom/cylinder.h"
#include "pxr/usd/usdGeom/capsule.h"
#include "pxr/usd/usd/primFlags.h"
#include "pxr/usd/usd/primRange.h"

#include "webRenderDelegate.h"
#include "pxr/imaging/hd/unitTestNullRenderPass.h"
#include <emscripten/bind.h>
#include "pxr/usd/usdSkel/bakeSkinning.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cmath>
#include <memory>
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>

PXR_NAMESPACE_OPEN_SCOPE

using HdRenderPassSharedPtr = std::shared_ptr<HdRenderPass>;

/// A simple test task that just causes sync processing
class WebSyncTask final : public HdTask
{
public:
    WebSyncTask(HdRenderPassSharedPtr const &renderPass,
                        TfTokenVector const &renderTags)
        : HdTask(SdfPath::EmptyPath())
        , _renderPass(renderPass)
        , _renderTags(renderTags)
    {
    }

    virtual void Sync(HdSceneDelegate* delegate,
                      HdTaskContext* ctx,
                      HdDirtyBits* dirtyBits) override {
        _renderPass->Sync();

        *dirtyBits = HdChangeTracker::Clean;
    }

    virtual void Prepare(HdTaskContext* ctx,
                         HdRenderIndex* renderIndex) override {
    }

    virtual void Execute(HdTaskContext* ctx) override {
    }

    virtual const TfTokenVector &GetRenderTags() const override {
        return _renderTags;
    }

private:
    HdRenderPassSharedPtr _renderPass;
    TfTokenVector _renderTags;
};

/// \class HdWebSyncDriver
///
/// A driver that syncs to the Emscripten Web Renderer.
///
/// \note This test driver uses a Null render delegate, so
/// no images are produced.  It just syncs between Hydra and
/// a Web Renderer.
///
class HdWebSyncDriver final {
public:
    HdWebSyncDriver(emscripten::val renderDelegateInterface,
                                    std::string const& usdFilePath)
        : _engine()
        , _renderDelegate(renderDelegateInterface)
        , _renderIndex(nullptr)
        , _delegate(nullptr)
        , _geometryPass()
        , _stage()
    {
        HdRprimCollection collection = HdRprimCollection(
                HdTokens->geometry,
                HdReprSelector(HdReprTokens->hull));

        TfTokenVector renderTags;
        renderTags.push_back(HdRenderTagTokens->geometry);

        _Init(UsdStage::Open(usdFilePath),
              collection,
              SdfPath::AbsoluteRootPath(),
              renderTags);
    }

    HdWebSyncDriver(emscripten::val renderDelegateInterface,
                                    UsdStageRefPtr const& usdStage)
        : _engine()
        , _renderDelegate(renderDelegateInterface)
        , _renderIndex(nullptr)
        , _delegate(nullptr)
        , _geometryPass()
        , _stage()
    {
        HdRprimCollection collection = HdRprimCollection(
                HdTokens->geometry,
                HdReprSelector(HdReprTokens->hull));

        TfTokenVector renderTags;
        renderTags.push_back(HdRenderTagTokens->geometry);

        _Init(usdStage,
              collection,
              SdfPath::AbsoluteRootPath(),
              renderTags);
    }

    ~HdWebSyncDriver()
    {
        delete _delegate;
        delete _renderIndex;
    }

    void Draw() {
        _delegate->ApplyPendingUpdates();
        HdTaskSharedPtrVector tasks = {
            std::make_shared<WebSyncTask>(_geometryPass, _renderTags)
        };
        _engine.Execute(&_delegate->GetRenderIndex(), &tasks);
    }

    void getFile(std::string filename, emscripten::val callback) {
        auto& resolver = ArGetResolver();
        ArResolverContextBinder binder(&resolver, _stage->GetPathResolverContext());

        std::shared_ptr<ArAsset> asset = resolver.OpenAsset(ArResolvedPath(filename));
        if (!asset) {
            callback(emscripten::val::undefined());
            return;
        }

        std::shared_ptr<const char> buffer = asset->GetBuffer();
        if (!buffer) {
            callback(emscripten::val::undefined());
            return;
        }

        size_t bufferSize = asset->GetSize();
        callback(emscripten::val(emscripten::typed_memory_view(bufferSize, buffer.get())));
    }
    void SetTime(double time) {
        _delegate->SetTime(time);
    }

    double GetTime() {
        return _delegate->GetTime().GetValue();
    }

    /// Marks an rprim in the RenderIndex as dirty with the given dirty flags.
    void MarkRprimDirty(SdfPath path, HdDirtyBits flag) {
        _delegate->GetRenderIndex().GetChangeTracker()
            .MarkRprimDirty(path, flag);
    }

    /// Returns the underlying delegate for this driver.
    UsdImagingDelegate& GetDelegate() {
        return *_delegate;
    }

    /// Returns the populated UsdStage for this driver.
    UsdStageRefPtr const& GetStage() {
        return _stage;
    }

    emscripten::val GetPrimTransforms() {
        emscripten::val worldMap = emscripten::val::object();
        emscripten::val localMap = emscripten::val::object();

        if (!_stage) {
            emscripten::val emptyResult = emscripten::val::object();
            emptyResult.set("world", worldMap);
            emptyResult.set("local", localMap);
            emptyResult.set("count", 0);
            return emptyResult;
        }

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        size_t primCount = 0;
        const GfMatrix4d identity(1.0);

        for (const UsdPrim& rootPrim : _stage->GetPseudoRoot().GetChildren()) {
            _CollectPrimTransformsRecursive(
                rootPrim,
                identity,
                timeCode,
                worldMap,
                localMap,
                &primCount);
        }

        emscripten::val result = emscripten::val::object();
        result.set("world", worldMap);
        result.set("local", localMap);
        result.set("count", static_cast<double>(primCount));
        return result;
    }

    emscripten::val GetPrimPathSet() {
        emscripten::val primPaths = emscripten::val::array();
        if (!_stage) return primPaths;

        int index = 0;
        for (const UsdPrim& prim : _stage->Traverse()) {
            const std::string path = prim.GetPath().GetString();
            if (path.empty()) continue;
            primPaths.set(index++, path);
        }
        return primPaths;
    }

    emscripten::val GetProtoDataBlob(std::string const& protoPath) {
        emscripten::val result = emscripten::val::object();
        result.set("valid", false);
        if (protoPath.empty() || protoPath[0] != '/') return result;

        bool found = _renderDelegate.ReadProtoDataBlob(
            protoPath,
            [&](WebRenderDelegate::ProtoDataBlobRecord const& record) {
                result = _ProtoDataBlobRecordToJsVal(record);
            });
        if (!found) return result;
        return result;
    }

    emscripten::val GetAllProtoDataBlobs() {
        emscripten::val blobs = emscripten::val::object();
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const& record) {
                if (rprimPath.empty()) return;
                blobs.set(rprimPath, _ProtoDataBlobRecordToJsVal(record));
            });
        return blobs;
    }

    emscripten::val GetCollisionProtoOverride(std::string const& meshId) {
        emscripten::val result = emscripten::val::object();
        result.set("valid", false);
        if (!_stage || meshId.empty()) return result;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        return _BuildCollisionProtoOverride(meshId, timeCode, &xformCache);
    }

    emscripten::val GetCollisionProtoOverrides() {
        emscripten::val overrides = emscripten::val::object();
        if (!_stage) return overrides;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        const std::vector<std::string> acceptableTypes = {"mesh", "cube", "sphere", "cylinder", "capsule"};
        CollisionCandidateMap candidateMap = _BuildCollisionCandidateMap(acceptableTypes);
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const&) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _ParseProtoMeshIdentifier(rprimPath);
                if (!proto.valid || proto.sectionName != "collisions") return;
                overrides.set(rprimPath, _BuildCollisionProtoOverride(rprimPath, timeCode, &xformCache, &candidateMap));
            });
        return overrides;
    }

    emscripten::val GetPrimOverrideData(std::string const& primPath) {
        emscripten::val result = emscripten::val::object();
        result.set("valid", false);
        if (!_stage || primPath.empty() || primPath[0] != '/') return result;

        const SdfPath sdfPath(primPath);
        if (sdfPath.IsEmpty()) return result;
        const UsdPrim prim = _stage->GetPrimAtPath(sdfPath);
        if (!prim) return result;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        return _BuildPrimOverrideDataFromPrim(prim, primPath, timeCode, &xformCache);
    }

    emscripten::val GetPrimOverrideDataMap(emscripten::val primPaths) {
        emscripten::val result = emscripten::val::object();
        if (!_stage || primPaths.isUndefined() || primPaths.isNull()) return result;

        int length = 0;
        try {
            length = primPaths["length"].as<int>();
        } catch (...) {
            return result;
        }
        if (length <= 0) return result;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        std::unordered_set<std::string> visited;
        visited.reserve(static_cast<size_t>(length));

        for (int index = 0; index < length; ++index) {
            std::string primPath;
            try {
                primPath = primPaths[index].as<std::string>();
            } catch (...) {
                continue;
            }
            if (primPath.empty() || primPath[0] != '/') continue;
            if (!visited.insert(primPath).second) continue;

            const SdfPath sdfPath(primPath);
            if (sdfPath.IsEmpty()) continue;
            const UsdPrim prim = _stage->GetPrimAtPath(sdfPath);
            if (!prim) continue;

            emscripten::val overrideData = _BuildPrimOverrideDataFromPrim(prim, primPath, timeCode, &xformCache);
            bool isValid = false;
            try {
                isValid = overrideData["valid"].as<bool>();
            } catch (...) {
                isValid = false;
            }
            if (!isValid) continue;
            result.set(primPath, overrideData);
        }

        return result;
    }

private:
    HdEngine _engine;
    WebRenderDelegate _renderDelegate;
    HdRenderIndex       *_renderIndex;
    UsdImagingDelegate  *_delegate;
    HdRenderPassSharedPtr _geometryPass;
    UsdStageRefPtr _stage;
    TfTokenVector _renderTags;

    struct ProtoMeshIdentifier {
        bool valid = false;
        std::string meshId;
        std::string containerPath;
        std::string linkPath;
        std::string linkName;
        std::string sectionName;
        std::string protoType;
        int protoIndex = -1;
    };

    using PrimCandidate = std::pair<std::string, UsdPrim>;
    using CollisionCandidateMap = std::unordered_map<std::string, std::vector<PrimCandidate>>;

    static emscripten::val _Matrix4dToJsArray(GfMatrix4d const& matrix) {
        emscripten::val values = emscripten::val::array();
        int index = 0;
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                values.set(index++, matrix[row][column]);
            }
        }
        return values;
    }

    static emscripten::val _Float16ToJsArray(std::array<float, 16> const& values16) {
        emscripten::val values = emscripten::val::array();
        for (int index = 0; index < 16; ++index) {
            values.set(index, values16[index]);
        }
        return values;
    }

    static double _PointerToJsNumber(void const* ptr) {
        if (!ptr) return 0.0;
        return static_cast<double>(reinterpret_cast<uintptr_t>(ptr));
    }

    static std::string _ToLowerAscii(std::string const& value) {
        std::string lowered = value;
        std::transform(
            lowered.begin(),
            lowered.end(),
            lowered.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return lowered;
    }

    static std::string _GetPathBasename(std::string const& path) {
        if (path.empty()) return std::string();
        const size_t lastSlash = path.find_last_of('/');
        if (lastSlash == std::string::npos) return path;
        if (lastSlash + 1 >= path.size()) return std::string();
        return path.substr(lastSlash + 1);
    }

    static bool _ContainsString(std::vector<std::string> const& values, std::string const& needle) {
        return std::find(values.begin(), values.end(), needle) != values.end();
    }

    static std::string _GetSupportedPrimTypeName(UsdPrim const& prim) {
        if (!prim) return std::string();

        const std::string authoredType = _ToLowerAscii(prim.GetTypeName().GetString());
        if (authoredType == "mesh"
            || authoredType == "cube"
            || authoredType == "sphere"
            || authoredType == "cylinder"
            || authoredType == "capsule") {
            return authoredType;
        }

        if (UsdGeomMesh(prim)) return "mesh";
        if (UsdGeomCube(prim)) return "cube";
        if (UsdGeomSphere(prim)) return "sphere";
        if (UsdGeomCylinder(prim)) return "cylinder";
        if (UsdGeomCapsule(prim)) return "capsule";
        return std::string();
    }

    static void _AppendUniqueCandidate(
        std::vector<std::string>* candidates,
        std::string const& path) {
        if (!candidates || path.empty()) return;
        if (std::find(candidates->begin(), candidates->end(), path) != candidates->end()) return;
        candidates->push_back(path);
    }

    static ProtoMeshIdentifier _ParseProtoMeshIdentifier(std::string const& meshId) {
        ProtoMeshIdentifier result;
        if (meshId.empty()) return result;
        const size_t protoMarker = meshId.rfind(".proto_");
        if (protoMarker == std::string::npos) return result;

        const std::string containerPath = meshId.substr(0, protoMarker);
        const std::string suffix = meshId.substr(protoMarker + 7);
        const size_t idMarker = suffix.rfind("_id");
        if (containerPath.empty() || idMarker == std::string::npos || idMarker + 3 >= suffix.size()) {
            return result;
        }

        const std::string protoType = _ToLowerAscii(suffix.substr(0, idMarker));
        const std::string protoIndexText = suffix.substr(idMarker + 3);
        if (protoType.empty() || protoIndexText.empty()) return result;

        int protoIndex = -1;
        try {
            protoIndex = std::stoi(protoIndexText);
        } catch (...) {
            return result;
        }
        if (protoIndex < 0) return result;

        const size_t lastSlash = containerPath.find_last_of('/');
        if (lastSlash == std::string::npos || lastSlash == 0 || lastSlash + 1 >= containerPath.size()) {
            return result;
        }
        const std::string linkPath = containerPath.substr(0, lastSlash);
        const std::string sectionName = _ToLowerAscii(containerPath.substr(lastSlash + 1));
        const std::string linkName = _GetPathBasename(linkPath);
        if (linkPath.empty() || sectionName.empty() || linkName.empty()) return result;

        result.valid = true;
        result.meshId = meshId;
        result.containerPath = containerPath;
        result.linkPath = linkPath;
        result.linkName = linkName;
        result.sectionName = sectionName;
        result.protoType = protoType;
        result.protoIndex = protoIndex;
        return result;
    }

    static std::vector<std::string> _GetExpectedCollisionPrimTypes(ProtoMeshIdentifier const& proto) {
        std::vector<std::string> expected;
        if (!proto.valid || proto.sectionName != "collisions") return expected;

        if (proto.protoType == "box") {
            expected.push_back("cube");
        } else if (proto.protoType == "sphere") {
            expected.push_back("sphere");
        } else if (proto.protoType == "cylinder") {
            expected.push_back("cylinder");
        } else if (proto.protoType == "capsule") {
            expected.push_back("capsule");
        } else if (proto.protoType == "mesh") {
            expected.push_back("mesh");
            expected.push_back("cube");
            expected.push_back("sphere");
            expected.push_back("cylinder");
            expected.push_back("capsule");
        }
        return expected;
    }

    static std::vector<std::string> _BuildProtoPrimPathCandidates(ProtoMeshIdentifier const& proto) {
        std::vector<std::string> candidates;
        if (!proto.valid) return candidates;

        if (proto.protoType == "mesh") {
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/collision_mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/visual_mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/cube");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/sphere");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/cylinder");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/capsule");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "/mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "_" + proto.sectionName + "/mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "_link/mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/collision_mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/visual_mesh");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/cube");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/sphere");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/cylinder");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/capsule");
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex));
            return candidates;
        }

        const std::string usdType = proto.protoType == "box" ? "cube" : proto.protoType;
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/" + proto.protoType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/" + usdType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType + "_" + std::to_string(proto.protoIndex) + "/" + proto.protoType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType + "_" + std::to_string(proto.protoIndex) + "/" + usdType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + usdType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "/" + usdType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "/" + proto.protoType);
        return candidates;
    }

    bool _TryResolveSupportedCollisionPrim(
        UsdPrim const& candidatePrim,
        std::vector<std::string> const& expectedTypes,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType) const {
        if (!candidatePrim || !outPrim || !outPrimPath || !outPrimType) return false;

        auto tryAcceptPrim = [&](UsdPrim const& prim) {
            if (!prim) return false;
            const std::string primType = _GetSupportedPrimTypeName(prim);
            if (primType.empty() || !_ContainsString(expectedTypes, primType)) return false;
            const std::string primPath = prim.GetPath().GetString();
            if (primPath.empty()) return false;
            *outPrim = prim;
            *outPrimPath = primPath;
            *outPrimType = primType;
            return true;
        };

        if (tryAcceptPrim(candidatePrim)) return true;

        const Usd_PrimFlagsPredicate predicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (UsdPrim const& descendant : candidatePrim.GetFilteredDescendants(predicate)) {
            if (tryAcceptPrim(descendant)) return true;
        }
        return false;
    }

    bool _ResolveCollisionProtoPrim(
        ProtoMeshIdentifier const& proto,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType,
        CollisionCandidateMap const* candidateMap = nullptr) const {
        if (!_stage || !proto.valid || !outPrim || !outPrimPath || !outPrimType) return false;

        const std::vector<std::string> expectedTypes = _GetExpectedCollisionPrimTypes(proto);
        if (expectedTypes.empty()) return false;

        const std::vector<std::string> candidates = _BuildProtoPrimPathCandidates(proto);
        for (std::string const& candidatePath : candidates) {
            if (candidatePath.empty()) continue;
            const SdfPath sdfPath(candidatePath);
            if (sdfPath.IsEmpty()) continue;
            const UsdPrim candidatePrim = _stage->GetPrimAtPath(sdfPath);
            if (!candidatePrim) continue;
            if (_TryResolveSupportedCollisionPrim(
                candidatePrim,
                expectedTypes,
                outPrim,
                outPrimPath,
                outPrimType)) {
                return true;
            }
        }

        std::vector<PrimCandidate> discovered;
        if (candidateMap) {
            const auto found = candidateMap->find(proto.containerPath);
            if (found != candidateMap->end()) {
                discovered = found->second;
            }
        } else {
            CollisionCandidateMap fallbackMap = _BuildCollisionCandidateMap(expectedTypes);
            const auto found = fallbackMap.find(proto.containerPath);
            if (found != fallbackMap.end()) {
                discovered = found->second;
            }
        }

        if (!discovered.empty()) {
            discovered.erase(
                std::remove_if(
                    discovered.begin(),
                    discovered.end(),
                    [&](PrimCandidate const& candidate) {
                        if (!candidate.second) return true;
                        const std::string candidateType = _GetSupportedPrimTypeName(candidate.second);
                        return candidateType.empty() || !_ContainsString(expectedTypes, candidateType);
                    }),
                discovered.end());
        }

        if (!discovered.empty()) {
            std::sort(
                discovered.begin(),
                discovered.end(),
                [](PrimCandidate const& left, PrimCandidate const& right) {
                    return left.first < right.first;
                });
            const size_t pickedIndex = (
                proto.protoIndex >= 0
                && static_cast<size_t>(proto.protoIndex) < discovered.size())
                ? static_cast<size_t>(proto.protoIndex)
                : 0;
            const UsdPrim pickedPrim = discovered[pickedIndex].second;
            const std::string pickedPrimType = _GetSupportedPrimTypeName(pickedPrim);
            if (pickedPrimType.empty()) return false;
            *outPrim = pickedPrim;
            *outPrimPath = discovered[pickedIndex].first;
            *outPrimType = pickedPrimType;
            return true;
        }
        return false;
    }

    CollisionCandidateMap _BuildCollisionCandidateMap(
        std::vector<std::string> const& acceptedTypes) const {
        CollisionCandidateMap candidateMap;
        if (!_stage || acceptedTypes.empty()) return candidateMap;

        static const std::string collisionsMarker = "/collisions/";
        static const size_t collisionsContainerLength = std::string("/collisions").size();
        const Usd_PrimFlagsPredicate predicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (UsdPrim const& prim : UsdPrimRange::Stage(_stage, predicate)) {
            if (!prim) continue;
            const std::string primType = _GetSupportedPrimTypeName(prim);
            if (primType.empty() || !_ContainsString(acceptedTypes, primType)) continue;

            const std::string primPath = prim.GetPath().GetString();
            const size_t markerPos = primPath.find(collisionsMarker);
            if (markerPos == std::string::npos) continue;

            const size_t containerEnd = markerPos + collisionsContainerLength;
            if (containerEnd <= 0 || containerEnd > primPath.size()) continue;
            const std::string containerPath = primPath.substr(0, containerEnd);
            if (containerPath.empty()) continue;

            candidateMap[containerPath].push_back({primPath, prim});
        }
        return candidateMap;
    }

    static bool _TryReadExtentSize(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode,
        std::array<double, 3>* outExtentSize) {
        if (!outExtentSize) return false;
        UsdAttribute extentAttr = prim.GetAttribute(TfToken("extent"));
        if (!extentAttr) return false;

        VtVec3fArray extentF;
        if (extentAttr.Get(&extentF, timeCode) && extentF.size() >= 2) {
            (*outExtentSize)[0] = std::abs(static_cast<double>(extentF[1][0] - extentF[0][0]));
            (*outExtentSize)[1] = std::abs(static_cast<double>(extentF[1][1] - extentF[0][1]));
            (*outExtentSize)[2] = std::abs(static_cast<double>(extentF[1][2] - extentF[0][2]));
            return true;
        }

        VtVec3dArray extentD;
        if (extentAttr.Get(&extentD, timeCode) && extentD.size() >= 2) {
            (*outExtentSize)[0] = std::abs(extentD[1][0] - extentD[0][0]);
            (*outExtentSize)[1] = std::abs(extentD[1][1] - extentD[0][1]);
            (*outExtentSize)[2] = std::abs(extentD[1][2] - extentD[0][2]);
            return true;
        }
        return false;
    }

    static bool _TryReadDoubleAttr(
        UsdPrim const& prim,
        char const* attrName,
        UsdTimeCode const& timeCode,
        double* outValue) {
        if (!attrName || !outValue) return false;
        UsdAttribute attribute = prim.GetAttribute(TfToken(attrName));
        if (!attribute) return false;

        double valueDouble = 0.0;
        if (attribute.Get(&valueDouble, timeCode) && std::isfinite(valueDouble)) {
            *outValue = valueDouble;
            return true;
        }

        float valueFloat = 0.0f;
        if (attribute.Get(&valueFloat, timeCode) && std::isfinite(valueFloat)) {
            *outValue = static_cast<double>(valueFloat);
            return true;
        }
        return false;
    }

    static std::string _ReadAxisToken(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode) {
        std::string axis = "Z";
        UsdAttribute axisAttr = prim.GetAttribute(TfToken("axis"));
        if (!axisAttr) return axis;

        TfToken axisToken;
        if (axisAttr.Get(&axisToken, timeCode) && !axisToken.IsEmpty()) {
            axis = axisToken.GetString();
        } else {
            std::string axisString;
            if (axisAttr.Get(&axisString, timeCode) && !axisString.empty()) {
                axis = axisString;
            }
        }
        axis = _ToLowerAscii(axis);
        if (axis == "x") return "X";
        if (axis == "y") return "Y";
        return "Z";
    }

    static emscripten::val _Vec3ToJsArray(std::array<double, 3> const& value) {
        emscripten::val out = emscripten::val::array();
        out.set(0, value[0]);
        out.set(1, value[1]);
        out.set(2, value[2]);
        return out;
    }

    emscripten::val _ProtoDataBlobRecordToJsVal(
        WebRenderDelegate::ProtoDataBlobRecord const& record) const {
        emscripten::val blob = emscripten::val::object();
        blob.set("valid", record.valid);
        blob.set("numVertices", record.numVertices);
        blob.set("numIndices", record.numIndices);
        blob.set("numUVs", record.numUVs);
        blob.set("uvDimension", record.uvDimension);
        blob.set("numNormals", record.numNormals);
        blob.set("normalsDimension", record.normalsDimension);
        blob.set("materialId", record.materialId);
        blob.set("pointsPtr", _PointerToJsNumber(record.points.empty() ? nullptr : record.points.data()));
        blob.set("indicesPtr", _PointerToJsNumber(record.indices.empty() ? nullptr : record.indices.data()));
        blob.set("uvPtr", _PointerToJsNumber(record.uv.empty() ? nullptr : record.uv.data()));
        blob.set("normalsPtr", _PointerToJsNumber(record.normals.empty() ? nullptr : record.normals.data()));
        blob.set("transformPtr", _PointerToJsNumber(record.transform.data()));
        // Keep a small transform fallback in case pointer access is disabled.
        blob.set("transform", _Float16ToJsArray(record.transform));
        return blob;
    }

    emscripten::val _BuildCollisionProtoOverride(
        std::string const& meshId,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache,
        CollisionCandidateMap const* candidateMap = nullptr) const {
        emscripten::val out = emscripten::val::object();
        out.set("valid", false);
        if (!_stage || !xformCache) return out;

        const ProtoMeshIdentifier proto = _ParseProtoMeshIdentifier(meshId);
        if (!proto.valid || proto.sectionName != "collisions") return out;

        UsdPrim resolvedPrim;
        std::string resolvedPrimPath;
        std::string resolvedPrimType;
        if (!_ResolveCollisionProtoPrim(proto, &resolvedPrim, &resolvedPrimPath, &resolvedPrimType, candidateMap)) {
            return out;
        }

        out = _BuildPrimOverrideDataFromPrim(resolvedPrim, resolvedPrimPath, timeCode, xformCache);
        out.set("meshId", meshId);
        return out;
    }

    emscripten::val _BuildPrimOverrideDataFromPrim(
        UsdPrim const& prim,
        std::string const& primPath,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache) const {
        emscripten::val out = emscripten::val::object();
        out.set("valid", false);
        if (!prim || primPath.empty() || !xformCache) return out;

        const std::string primType = _GetSupportedPrimTypeName(prim);
        if (primType.empty()) return out;

        out.set("valid", true);
        out.set("resolvedPrimPath", primPath);
        out.set("primType", primType);
        out.set("worldTransform", _Matrix4dToJsArray(xformCache->GetLocalToWorldTransform(prim)));

        std::array<double, 3> extentSize = {0.0, 0.0, 0.0};
        if (_TryReadExtentSize(prim, timeCode, &extentSize)) {
            out.set("extentSize", _Vec3ToJsArray(extentSize));
        }

        if (primType == "cube") {
            double size = 0.0;
            if (_TryReadDoubleAttr(prim, "size", timeCode, &size)) {
                out.set("size", size);
            }
        } else if (primType == "sphere" || primType == "cylinder" || primType == "capsule") {
            double radius = 0.0;
            if (_TryReadDoubleAttr(prim, "radius", timeCode, &radius)) {
                out.set("radius", radius);
            }
            if (primType == "cylinder" || primType == "capsule") {
                double height = 0.0;
                if (_TryReadDoubleAttr(prim, "height", timeCode, &height)) {
                    out.set("height", height);
                }
                out.set("axis", _ReadAxisToken(prim, timeCode));
            }
        }

        return out;
    }

    void _CollectPrimTransformsRecursive(
        UsdPrim const& prim,
        GfMatrix4d const& parentWorldMatrix,
        UsdTimeCode const& timeCode,
        emscripten::val& worldMap,
        emscripten::val& localMap,
        size_t* primCount) {
        if (!prim) return;

        GfMatrix4d localMatrix(1.0);
        bool resetsXformStack = false;
        const UsdGeomXformable xformable(prim);
        if (xformable) {
            xformable.GetLocalTransformation(&localMatrix, &resetsXformStack, timeCode);
        }

        const GfMatrix4d worldMatrix = resetsXformStack
            ? localMatrix
            : (parentWorldMatrix * localMatrix);
        const std::string primPath = prim.GetPath().GetString();
        if (!primPath.empty()) {
            localMap.set(primPath, _Matrix4dToJsArray(localMatrix));
            worldMap.set(primPath, _Matrix4dToJsArray(worldMatrix));
            if (primCount) {
                (*primCount)++;
            }
        }

        for (UsdPrim const& child : prim.GetChildren()) {
            _CollectPrimTransformsRecursive(
                child,
                worldMatrix,
                timeCode,
                worldMap,
                localMap,
                primCount);
        }
    }

    void _Init(UsdStageRefPtr const& usdStage,
               HdRprimCollection const &collection,
               SdfPath const &delegateId,
               TfTokenVector const &renderTags) {
        _renderIndex = HdRenderIndex::New(&_renderDelegate, HdDriverVector());
        TF_VERIFY(_renderIndex != nullptr);
        _delegate = new UsdImagingDelegate(_renderIndex, delegateId);

        _stage = usdStage;

        UsdSkelBakeSkinning(_stage->Traverse());
        _stage->Save();
        _delegate->Populate(_stage->GetPseudoRoot());

        _geometryPass = HdRenderPassSharedPtr(
                       new Hd_UnitTestNullRenderPass(_renderIndex, collection));

        _renderTags = renderTags;
    }
};

PXR_NAMESPACE_CLOSE_SCOPE

#endif //PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_TESTDRIVER_H
