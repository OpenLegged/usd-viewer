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
#include "pxr/base/gf/quatd.h"
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
#include <chrono>
#include <cctype>
#include <cstdint>
#include <cmath>
#include <memory>
#include <mutex>
#include <vector>
#include <string>
#include <utility>
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

    void SetPreferProtoBlobOverHydraPayload(bool prefer) {
        _renderDelegate.SetPreferProtoBlobOverHydraPayload(prefer);
    }

    bool GetPreferProtoBlobOverHydraPayload() const {
        return _renderDelegate.GetPreferProtoBlobOverHydraPayload();
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
        std::unordered_set<std::string> seenPaths;
        seenPaths.reserve(4096);
        auto appendPrimPath = [&](UsdPrim const& prim) {
            if (!prim) return;
            const std::string path = prim.GetPath().GetString();
            if (path.empty()) return;
            if (!seenPaths.insert(path).second) return;
            primPaths.set(index++, path);
        };

        // Default traversal excludes instance proxies, which means many authored
        // collision/visual mesh prims inside instance hierarchies are absent
        // from the JS-side path index.
        for (const UsdPrim& prim : _stage->Traverse()) {
            appendPrimPath(prim);
        }

        // Include instance-proxy paths so JS can resolve prims like:
        // /<robot>/<link>/collisions/<name>/mesh
        const Usd_PrimFlagsPredicate proxyPredicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (const UsdPrim& prim : UsdPrimRange::Stage(_stage, proxyPredicate)) {
            appendPrimPath(prim);
        }
        return primPaths;
    }

    emscripten::val GetPhysicsJointRecords() {
        emscripten::val records = emscripten::val::array();
        if (!_stage) return records;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        int recordIndex = 0;
        const Usd_PrimFlagsPredicate predicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);

        for (const UsdPrim& prim : UsdPrimRange::Stage(_stage, predicate)) {
            if (!prim) continue;

            const std::string primTypeName = prim.GetTypeName().GetString();
            const std::string normalizedTypeName = _ToLowerAscii(primTypeName);
            if (normalizedTypeName.find("joint") == std::string::npos) continue;

            emscripten::val record = emscripten::val::object();
            const std::string primPath = prim.GetPath().GetString();
            record.set("path", primPath);
            record.set("jointPath", primPath);
            record.set("jointName", prim.GetName().GetString());
            record.set("jointTypeName", primTypeName);
            record.set("jointType", primTypeName);
            record.set("body0Path", _ReadFirstRelationshipTargetPath(prim.GetRelationship(TfToken("physics:body0"))));
            record.set("body1Path", _ReadFirstRelationshipTargetPath(prim.GetRelationship(TfToken("physics:body1"))));
            record.set("axisToken", _ReadAxisToken(prim, timeCode));

            std::array<double, 3> localPos0 = {0.0, 0.0, 0.0};
            if (_TryReadVec3Attr(prim.GetAttribute(TfToken("physics:localPos0")), timeCode, &localPos0)) {
                record.set("localPos0", _Vec3ToJsArray(localPos0));
            }

            std::array<double, 3> localPos1 = {0.0, 0.0, 0.0};
            if (_TryReadVec3Attr(prim.GetAttribute(TfToken("physics:localPos1")), timeCode, &localPos1)) {
                record.set("localPos1", _Vec3ToJsArray(localPos1));
            }

            std::array<double, 4> localRot0Wxyz = {1.0, 0.0, 0.0, 0.0};
            if (_TryReadQuatWxyzAttr(prim.GetAttribute(TfToken("physics:localRot0")), timeCode, &localRot0Wxyz)) {
                record.set("localRot0Wxyz", _Vec4ToJsArray(localRot0Wxyz));
            }

            std::array<double, 4> localRot1Wxyz = {1.0, 0.0, 0.0, 0.0};
            if (_TryReadQuatWxyzAttr(prim.GetAttribute(TfToken("physics:localRot1")), timeCode, &localRot1Wxyz)) {
                record.set("localRot1Wxyz", _Vec4ToJsArray(localRot1Wxyz));
            }

            double lowerLimit = 0.0;
            if (_TryReadDoubleAttr(prim, "physics:lowerLimit", timeCode, &lowerLimit)) {
                record.set("lowerLimitDeg", lowerLimit);
            }

            double upperLimit = 0.0;
            if (_TryReadDoubleAttr(prim, "physics:upperLimit", timeCode, &upperLimit)) {
                record.set("upperLimitDeg", upperLimit);
            }

            records.set(recordIndex++, record);
        }

        return records;
    }

    emscripten::val GetPhysicsLinkDynamicsRecords() {
        emscripten::val records = emscripten::val::array();
        if (!_stage) return records;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        const UsdPrim defaultPrim = _stage->GetDefaultPrim();
        const std::string defaultPrimPath = defaultPrim ? defaultPrim.GetPath().GetString() : std::string();
        const std::string defaultPrimPrefix = defaultPrimPath.empty()
            ? std::string()
            : (defaultPrimPath + "/");
        int recordIndex = 0;

        for (const UsdPrim& prim : _stage->Traverse()) {
            if (!prim) continue;

            if (!defaultPrimPrefix.empty()) {
                const std::string primPath = prim.GetPath().GetString();
                if (primPath != defaultPrimPath && primPath.rfind(defaultPrimPrefix, 0) != 0) {
                    continue;
                }
            }

            const std::string primPath = prim.GetPath().GetString();
            if (primPath.empty()) continue;
            if (primPath.find("/visuals") != std::string::npos) continue;
            if (primPath.find("/collisions") != std::string::npos) continue;
            if (primPath.find("/Looks") != std::string::npos) continue;
            if (primPath.find("/joints") != std::string::npos) continue;

            const std::string primTypeName = _ToLowerAscii(prim.GetTypeName().GetString());
            if (!primTypeName.empty() && primTypeName != "xform") {
                continue;
            }

            double mass = 0.0;
            const bool hasMass = _TryReadDoubleAttr(prim, "physics:mass", timeCode, &mass);

            std::array<double, 3> centerOfMassLocal = {0.0, 0.0, 0.0};
            const bool hasCenterOfMass = _TryReadVec3Attr(
                prim.GetAttribute(TfToken("physics:centerOfMass")),
                timeCode,
                &centerOfMassLocal);

            std::array<double, 3> diagonalInertia = {0.0, 0.0, 0.0};
            const bool hasDiagonalInertia = _TryReadVec3Attr(
                prim.GetAttribute(TfToken("physics:diagonalInertia")),
                timeCode,
                &diagonalInertia);

            std::array<double, 4> principalAxesLocalWxyz = {1.0, 0.0, 0.0, 0.0};
            const bool hasPrincipalAxes = _TryReadQuatWxyzAttr(
                prim.GetAttribute(TfToken("physics:principalAxes")),
                timeCode,
                &principalAxesLocalWxyz);

            if (!hasMass && !hasCenterOfMass && !hasDiagonalInertia && !hasPrincipalAxes) {
                continue;
            }

            emscripten::val record = emscripten::val::object();
            record.set("linkPath", primPath);
            record.set("mass", hasMass ? emscripten::val(mass) : emscripten::val::null());
            record.set("centerOfMassLocal", hasCenterOfMass
                ? _Vec3ToJsArray(centerOfMassLocal)
                : _Vec3ToJsArray(std::array<double, 3>{0.0, 0.0, 0.0}));
            record.set("diagonalInertia", hasDiagonalInertia
                ? _Vec3ToJsArray(diagonalInertia)
                : emscripten::val::null());
            record.set("principalAxesLocalWxyz", hasPrincipalAxes
                ? _Vec4ToJsArray(principalAxesLocalWxyz)
                : _Vec4ToJsArray(std::array<double, 4>{1.0, 0.0, 0.0, 0.0}));
            records.set(recordIndex++, record);
        }

        return records;
    }

    // Build a lightweight robot metadata snapshot directly in WASM/C++.
    // This avoids heavy JS-side stage traversal/parsing on the main thread.
    emscripten::val GetRobotMetadataSnapshot(
        emscripten::val linkPaths,
        std::string const& stageSourcePath = std::string()) {
        emscripten::val snapshot = emscripten::val::object();
        emscripten::val emptyPairs = emscripten::val::array();
        emscripten::val emptyJointEntries = emscripten::val::array();
        emscripten::val emptyDynamicsEntries = emscripten::val::array();
        snapshot.set("stageSourcePath", emscripten::val::null());
        snapshot.set("generatedAtMs", 0.0);
        snapshot.set("source", "mesh-only");
        snapshot.set("linkParentPairs", emptyPairs);
        snapshot.set("jointCatalogEntries", emptyJointEntries);
        snapshot.set("linkDynamicsEntries", emptyDynamicsEntries);
        if (!_stage) return snapshot;

        auto normalizePathToken = [](std::string value) -> std::string {
            value = TfStringTrim(value);
            if (value.empty()) return std::string();
            value.erase(
                std::remove_if(
                    value.begin(),
                    value.end(),
                    [](char ch) { return ch == '<' || ch == '>'; }),
                value.end());
            value = TfStringTrim(value);
            if (value.empty()) return std::string();
            if (value[0] != '/') value = "/" + value;
            while (value.size() > 1 && value.back() == '/') {
                value.pop_back();
            }
            return value;
        };

        auto getRootPathFromPrimPath = [](std::string const& primPath) -> std::string {
            if (primPath.empty() || primPath[0] != '/') return std::string();
            const size_t secondSlash = primPath.find('/', 1);
            if (secondSlash == std::string::npos) return primPath;
            return primPath.substr(0, secondSlash);
        };

        auto getPathWithoutRoot = [&](std::string const& primPath) -> std::string {
            const std::string rootPath = getRootPathFromPrimPath(primPath);
            if (rootPath.empty()) return std::string();
            if (primPath.size() <= rootPath.size()) return "/";
            return primPath.substr(rootPath.size());
        };

        auto axisVectorFromToken = [](std::string const& axisToken) -> GfVec3d {
            const std::string token = _ToLowerAscii(axisToken);
            if (token == "y") return GfVec3d(0.0, 1.0, 0.0);
            if (token == "z") return GfVec3d(0.0, 0.0, 1.0);
            return GfVec3d(1.0, 0.0, 0.0);
        };

        auto rotateAxisByQuaternionWxyz = [&](std::string const& axisToken, std::array<double, 4> const& localRotWxyz) -> std::array<double, 3> {
            GfVec3d axis = axisVectorFromToken(axisToken);
            const double w = localRotWxyz[0];
            const double x = localRotWxyz[1];
            const double y = localRotWxyz[2];
            const double z = localRotWxyz[3];
            GfQuatd quat(w, GfVec3d(x, y, z));
            const double quatLen = quat.GetLength();
            if (std::isfinite(quatLen) && quatLen > 1e-6) {
                quat.Normalize();
                axis = quat.Transform(axis);
            }
            const double axisLen = axis.GetLength();
            if (!std::isfinite(axisLen) || axisLen <= 1e-12) {
                return {1.0, 0.0, 0.0};
            }
            axis /= axisLen;
            return {axis[0], axis[1], axis[2]};
        };

        std::string normalizedStageSourcePath = TfStringTrim(stageSourcePath);
        const size_t queryMarker = normalizedStageSourcePath.find('?');
        if (queryMarker != std::string::npos) {
            normalizedStageSourcePath = normalizedStageSourcePath.substr(0, queryMarker);
        }
        if (!normalizedStageSourcePath.empty()) {
            snapshot.set("stageSourcePath", normalizedStageSourcePath);
        }

        std::unordered_set<std::string> linkPathSet;
        std::vector<std::string> sortedLinkPaths;
        int linkPathCount = 0;
        try {
            linkPathCount = linkPaths["length"].as<int>();
        } catch (...) {
            linkPathCount = 0;
        }
        if (linkPathCount > 0) {
            for (int index = 0; index < linkPathCount; ++index) {
                std::string rawPath;
                try {
                    rawPath = linkPaths[index].as<std::string>();
                } catch (...) {
                    continue;
                }
                const std::string normalizedPath = normalizePathToken(rawPath);
                if (normalizedPath.empty()) continue;
                if (!linkPathSet.insert(normalizedPath).second) continue;
                sortedLinkPaths.push_back(normalizedPath);
            }
        }
        std::sort(sortedLinkPaths.begin(), sortedLinkPaths.end());

        const auto now = std::chrono::steady_clock::now().time_since_epoch();
        const double nowMs = std::chrono::duration<double, std::milli>(now).count();
        snapshot.set("generatedAtMs", nowMs);

        if (sortedLinkPaths.empty()) {
            return snapshot;
        }

        std::unordered_map<std::string, std::vector<std::string>> runtimeLinkPathsByName;
        std::vector<std::string> rootPaths;
        std::unordered_set<std::string> rootPathSet;
        runtimeLinkPathsByName.reserve(sortedLinkPaths.size());
        rootPathSet.reserve(sortedLinkPaths.size());

        for (std::string const& linkPath : sortedLinkPaths) {
            const std::string linkName = _GetPathBasename(linkPath);
            if (!linkName.empty()) {
                runtimeLinkPathsByName[linkName].push_back(linkPath);
            }
            const std::string rootPath = getRootPathFromPrimPath(linkPath);
            if (!rootPath.empty() && rootPathSet.insert(rootPath).second) {
                rootPaths.push_back(rootPath);
            }
        }
        std::sort(rootPaths.begin(), rootPaths.end());
        for (auto& item : runtimeLinkPathsByName) {
            std::vector<std::string>& paths = item.second;
            std::sort(paths.begin(), paths.end());
            paths.erase(std::unique(paths.begin(), paths.end()), paths.end());
        }

        auto sortByPreferredRoot = [&](std::vector<std::string>* paths, std::string const& preferredRootPath) {
            if (!paths) return;
            std::sort(
                paths->begin(),
                paths->end(),
                [&](std::string const& left, std::string const& right) {
                    const int leftPreferred = (!preferredRootPath.empty() && getRootPathFromPrimPath(left) == preferredRootPath) ? 0 : 1;
                    const int rightPreferred = (!preferredRootPath.empty() && getRootPathFromPrimPath(right) == preferredRootPath) ? 0 : 1;
                    if (leftPreferred != rightPreferred) {
                        return leftPreferred < rightPreferred;
                    }
                    return left < right;
                });
        };

        auto resolveRuntimeLinkPathsFromSourcePath = [&](std::string const& sourcePath, std::string const& preferredRootPath) -> std::vector<std::string> {
            std::vector<std::string> matches;
            const std::string normalizedSourcePath = normalizePathToken(sourcePath);
            if (normalizedSourcePath.empty()) return matches;

            auto addMatch = [&](std::string const& candidatePath) {
                if (candidatePath.empty()) return;
                if (linkPathSet.find(candidatePath) == linkPathSet.end()) return;
                if (std::find(matches.begin(), matches.end(), candidatePath) != matches.end()) return;
                matches.push_back(candidatePath);
            };

            addMatch(normalizedSourcePath);

            const std::string linkName = _GetPathBasename(normalizedSourcePath);
            if (!linkName.empty()) {
                const auto found = runtimeLinkPathsByName.find(linkName);
                if (found != runtimeLinkPathsByName.end()) {
                    for (std::string const& candidatePath : found->second) {
                        addMatch(candidatePath);
                    }
                }
            }

            const std::string sourceWithoutRoot = getPathWithoutRoot(normalizedSourcePath);
            if (!sourceWithoutRoot.empty() && sourceWithoutRoot != "/") {
                if (!preferredRootPath.empty()) {
                    addMatch(preferredRootPath + sourceWithoutRoot);
                }
                for (std::string const& rootPath : rootPaths) {
                    if (!preferredRootPath.empty() && rootPath == preferredRootPath) continue;
                    addMatch(rootPath + sourceWithoutRoot);
                }
            }

            sortByPreferredRoot(&matches, preferredRootPath);
            return matches;
        };

        struct JointCatalogRecord {
            std::string jointPath;
            std::string jointName;
            std::string jointType;
            std::string parentLinkPath;
            std::string axisToken;
            std::array<double, 3> axisLocal = {1.0, 0.0, 0.0};
            std::array<double, 3> localPivotInLink = {0.0, 0.0, 0.0};
            bool hasLocalPivotInLink = false;
            double lowerLimitDeg = -180.0;
            double upperLimitDeg = 180.0;
        };

        std::unordered_map<std::string, JointCatalogRecord> stageJointRecordByChildLinkPath;
        std::unordered_map<std::string, std::string> linkParentPathByChildLinkPath;
        stageJointRecordByChildLinkPath.reserve(sortedLinkPaths.size());
        linkParentPathByChildLinkPath.reserve(sortedLinkPaths.size());

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        const Usd_PrimFlagsPredicate predicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (const UsdPrim& prim : UsdPrimRange::Stage(_stage, predicate)) {
            if (!prim) continue;

            const std::string primTypeName = prim.GetTypeName().GetString();
            const std::string normalizedTypeName = _ToLowerAscii(primTypeName);
            if (normalizedTypeName.find("joint") == std::string::npos) continue;

            const bool isControllableJoint =
                normalizedTypeName.find("revolute") != std::string::npos
                || normalizedTypeName.find("continuous") != std::string::npos;

            const std::string body0Path = normalizePathToken(
                _ReadFirstRelationshipTargetPath(prim.GetRelationship(TfToken("physics:body0"))));
            const std::string body1Path = normalizePathToken(
                _ReadFirstRelationshipTargetPath(prim.GetRelationship(TfToken("physics:body1"))));
            if (body1Path.empty()) continue;

            const std::string jointPath = normalizePathToken(prim.GetPath().GetString());
            const std::string jointName = TfStringTrim(prim.GetName().GetString());
            const std::string axisToken = _ReadAxisToken(prim, timeCode);

            std::array<double, 3> localPos1 = {0.0, 0.0, 0.0};
            const bool hasLocalPos1 = _TryReadVec3Attr(
                prim.GetAttribute(TfToken("physics:localPos1")),
                timeCode,
                &localPos1);

            std::array<double, 4> localRot1Wxyz = {1.0, 0.0, 0.0, 0.0};
            _TryReadQuatWxyzAttr(
                prim.GetAttribute(TfToken("physics:localRot1")),
                timeCode,
                &localRot1Wxyz);
            const std::array<double, 3> axisLocal = rotateAxisByQuaternionWxyz(axisToken, localRot1Wxyz);

            double lowerLimitDeg = -180.0;
            if (!_TryReadDoubleAttr(prim, "physics:lowerLimit", timeCode, &lowerLimitDeg)) {
                lowerLimitDeg = -180.0;
            }
            double upperLimitDeg = 180.0;
            if (!_TryReadDoubleAttr(prim, "physics:upperLimit", timeCode, &upperLimitDeg)) {
                upperLimitDeg = 180.0;
            }

            const std::vector<std::string> childLinkPaths = resolveRuntimeLinkPathsFromSourcePath(body1Path, std::string());
            for (std::string const& childLinkPath : childLinkPaths) {
                if (childLinkPath.empty()) continue;
                const std::string preferredRootPath = getRootPathFromPrimPath(childLinkPath);
                const std::vector<std::string> parentCandidates = resolveRuntimeLinkPathsFromSourcePath(body0Path, preferredRootPath);
                const std::string parentLinkPath = parentCandidates.empty() ? std::string() : parentCandidates[0];
                if (linkParentPathByChildLinkPath.find(childLinkPath) == linkParentPathByChildLinkPath.end()) {
                    linkParentPathByChildLinkPath.emplace(childLinkPath, parentLinkPath);
                }

                if (!isControllableJoint) continue;
                if (stageJointRecordByChildLinkPath.find(childLinkPath) != stageJointRecordByChildLinkPath.end()) continue;

                JointCatalogRecord record;
                record.jointPath = jointPath;
                record.jointName = jointName;
                record.jointType = primTypeName;
                record.parentLinkPath = parentLinkPath;
                record.axisToken = axisToken;
                record.axisLocal = axisLocal;
                record.localPivotInLink = localPos1;
                record.hasLocalPivotInLink = hasLocalPos1;
                record.lowerLimitDeg = lowerLimitDeg;
                record.upperLimitDeg = upperLimitDeg;
                stageJointRecordByChildLinkPath.emplace(childLinkPath, record);
            }
        }

        emscripten::val jointCatalogEntries = emscripten::val::array();
        int jointCatalogIndex = 0;
        for (std::string const& linkPath : sortedLinkPaths) {
            const auto found = stageJointRecordByChildLinkPath.find(linkPath);
            if (found == stageJointRecordByChildLinkPath.end()) continue;
            JointCatalogRecord const& record = found->second;

            const std::string rootPath = getRootPathFromPrimPath(linkPath);
            const std::string fallbackJointName = record.jointName.empty()
                ? (_GetPathBasename(linkPath) + "_joint")
                : record.jointName;
            const std::string jointPath = record.jointPath.empty()
                ? (rootPath.empty() ? ("/joints/" + fallbackJointName) : (rootPath + "/joints/" + fallbackJointName))
                : record.jointPath;

            emscripten::val entry = emscripten::val::object();
            entry.set("linkPath", linkPath);
            entry.set("jointPath", jointPath);
            entry.set("jointName", fallbackJointName);
            entry.set("jointType", record.jointType.empty() ? std::string("PhysicsRevoluteJoint") : record.jointType);
            if (record.parentLinkPath.empty()) {
                entry.set("parentLinkPath", emscripten::val::null());
            } else {
                entry.set("parentLinkPath", record.parentLinkPath);
            }
            entry.set("axisToken", record.axisToken.empty() ? std::string("X") : record.axisToken);
            entry.set("axisLocal", _Vec3ToJsArray(record.axisLocal));
            entry.set("lowerLimitDeg", record.lowerLimitDeg);
            entry.set("upperLimitDeg", record.upperLimitDeg);
            if (record.hasLocalPivotInLink) {
                entry.set("localPivotInLink", _Vec3ToJsArray(record.localPivotInLink));
            } else {
                entry.set("localPivotInLink", emscripten::val::null());
            }
            jointCatalogEntries.set(jointCatalogIndex++, entry);
        }

        emscripten::val linkDynamicsEntries = emscripten::val::array();
        int dynamicsIndex = 0;
        for (std::string const& linkPath : sortedLinkPaths) {
            const SdfPath linkSdfPath(linkPath);
            if (linkSdfPath.IsEmpty()) continue;
            const UsdPrim linkPrim = _stage->GetPrimAtPath(linkSdfPath);
            if (!linkPrim) continue;

            double mass = 0.0;
            const bool hasMass = _TryReadDoubleAttr(linkPrim, "physics:mass", timeCode, &mass);
            std::array<double, 3> centerOfMassLocal = {0.0, 0.0, 0.0};
            const bool hasCenterOfMass = _TryReadVec3Attr(
                linkPrim.GetAttribute(TfToken("physics:centerOfMass")),
                timeCode,
                &centerOfMassLocal);
            std::array<double, 3> diagonalInertia = {0.0, 0.0, 0.0};
            const bool hasDiagonalInertia = _TryReadVec3Attr(
                linkPrim.GetAttribute(TfToken("physics:diagonalInertia")),
                timeCode,
                &diagonalInertia);
            std::array<double, 4> principalAxesWxyz = {1.0, 0.0, 0.0, 0.0};
            const bool hasPrincipalAxes = _TryReadQuatWxyzAttr(
                linkPrim.GetAttribute(TfToken("physics:principalAxes")),
                timeCode,
                &principalAxesWxyz);

            if (!hasMass && !hasCenterOfMass && !hasDiagonalInertia && !hasPrincipalAxes) {
                continue;
            }

            emscripten::val entry = emscripten::val::object();
            entry.set("linkPath", linkPath);
            entry.set("mass", hasMass ? emscripten::val(mass) : emscripten::val::null());
            entry.set("centerOfMassLocal", hasCenterOfMass
                ? _Vec3ToJsArray(centerOfMassLocal)
                : _Vec3ToJsArray(std::array<double, 3>{0.0, 0.0, 0.0}));
            entry.set("diagonalInertia", hasDiagonalInertia
                ? _Vec3ToJsArray(diagonalInertia)
                : emscripten::val::null());
            emscripten::val principalAxesLocal = emscripten::val::array();
            principalAxesLocal.set(0, principalAxesWxyz[1]);
            principalAxesLocal.set(1, principalAxesWxyz[2]);
            principalAxesLocal.set(2, principalAxesWxyz[3]);
            principalAxesLocal.set(3, principalAxesWxyz[0]);
            entry.set("principalAxesLocal", principalAxesLocal);
            linkDynamicsEntries.set(dynamicsIndex++, entry);
        }

        std::vector<std::pair<std::string, std::string>> linkParentPairsSorted;
        linkParentPairsSorted.reserve(linkParentPathByChildLinkPath.size());
        for (auto const& item : linkParentPathByChildLinkPath) {
            if (item.first.empty()) continue;
            linkParentPairsSorted.push_back(item);
        }
        std::sort(
            linkParentPairsSorted.begin(),
            linkParentPairsSorted.end(),
            [](std::pair<std::string, std::string> const& left, std::pair<std::string, std::string> const& right) {
                return left.first < right.first;
            });

        emscripten::val linkParentPairs = emscripten::val::array();
        int pairIndex = 0;
        for (std::pair<std::string, std::string> const& item : linkParentPairsSorted) {
            emscripten::val pair = emscripten::val::array();
            pair.set(0, item.first);
            if (item.second.empty()) {
                pair.set(1, emscripten::val::null());
            } else {
                pair.set(1, item.second);
            }
            linkParentPairs.set(pairIndex++, pair);
        }

        const bool hasStageMetadata =
            pairIndex > 0
            || jointCatalogIndex > 0
            || dynamicsIndex > 0;
        snapshot.set("source", hasStageMetadata ? std::string("usd-stage-cpp") : std::string("mesh-only"));
        snapshot.set("linkParentPairs", linkParentPairs);
        snapshot.set("jointCatalogEntries", jointCatalogEntries);
        snapshot.set("linkDynamicsEntries", linkDynamicsEntries);
        return snapshot;
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
        _EnsureProtoCandidateMapsPrimed(acceptableTypes);
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const&) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                if (!proto.valid || proto.sectionName != "collisions") return;
                overrides.set(rprimPath, _BuildCollisionProtoOverride(rprimPath, timeCode, &xformCache, &_collisionCandidateMapCache));
            });
        return overrides;
    }

    emscripten::val GetVisualProtoOverride(std::string const& meshId) {
        emscripten::val result = emscripten::val::object();
        result.set("valid", false);
        if (!_stage || meshId.empty()) return result;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        return _BuildVisualProtoOverride(meshId, timeCode, &xformCache);
    }

    emscripten::val GetVisualProtoOverrides() {
        emscripten::val overrides = emscripten::val::object();
        if (!_stage) return overrides;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        const std::vector<std::string> acceptableTypes = {"mesh", "cube", "sphere", "cylinder", "capsule"};
        _EnsureProtoCandidateMapsPrimed(acceptableTypes);
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const&) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                if (!proto.valid || proto.sectionName != "visuals") return;
                overrides.set(rprimPath, _BuildVisualProtoOverride(rprimPath, timeCode, &xformCache, &_visualCandidateMapCache));
            });
        return overrides;
    }

    // One-shot proto override payload for both collision and visual proto meshes.
    // This avoids multiple large JS<->WASM bridge calls and duplicate stage scans.
    emscripten::val GetProtoMeshOverrides() {
        emscripten::val bundle = emscripten::val::object();
        emscripten::val collisionOverrides = emscripten::val::object();
        emscripten::val visualOverrides = emscripten::val::object();
        bundle.set("collision", collisionOverrides);
        bundle.set("visual", visualOverrides);
        bundle.set("collisionCount", 0.0);
        bundle.set("visualCount", 0.0);
        if (!_stage) return bundle;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        const std::vector<std::string> acceptableTypes = {"mesh", "cube", "sphere", "cylinder", "capsule"};
        _EnsureProtoCandidateMapsPrimed(acceptableTypes);

        size_t collisionCount = 0;
        size_t visualCount = 0;
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const&) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                if (!proto.valid) return;

                if (proto.sectionName == "collisions") {
                    emscripten::val overrideData = _BuildCollisionProtoOverride(
                        rprimPath,
                        timeCode,
                        &xformCache,
                        &_collisionCandidateMapCache);
                    bool valid = false;
                    try {
                        valid = overrideData["valid"].as<bool>();
                    } catch (...) {
                        valid = false;
                    }
                    if (!valid) return;
                    collisionOverrides.set(rprimPath, overrideData);
                    ++collisionCount;
                    return;
                }

                if (proto.sectionName == "visuals") {
                    emscripten::val overrideData = _BuildVisualProtoOverride(
                        rprimPath,
                        timeCode,
                        &xformCache,
                        &_visualCandidateMapCache);
                    bool valid = false;
                    try {
                        valid = overrideData["valid"].as<bool>();
                    } catch (...) {
                        valid = false;
                    }
                    if (!valid) return;
                    visualOverrides.set(rprimPath, overrideData);
                    ++visualCount;
                }
            });

        bundle.set("collisionCount", static_cast<double>(collisionCount));
        bundle.set("visualCount", static_cast<double>(visualCount));
        return bundle;
    }

    // Pull and clear the per-frame dirty RPrim delta batch prepared by WebRenderDelegate::Sync.
    emscripten::val GetRprimDeltaBatch() {
        return _renderDelegate.TakeRprimDeltaBatch();
    }

    // One-shot final stage override batch for all proto meshes.
    // Each entry includes final geometry descriptor + world matrix + dirty mask.
    emscripten::val GetFinalStageOverrideBatch() {
        emscripten::val bundle = emscripten::val::object();
        emscripten::val entries = emscripten::val::object();
        bundle.set("entries", entries);
        bundle.set("count", 0.0);
        bundle.set("collisionCount", 0.0);
        bundle.set("visualCount", 0.0);
        if (!_stage) return bundle;

        const UsdTimeCode timeCode = _delegate ? _delegate->GetTime() : UsdTimeCode::Default();
        UsdGeomXformCache xformCache(timeCode);
        const std::vector<std::string> acceptableTypes = {"mesh", "cube", "sphere", "cylinder", "capsule"};
        _EnsureProtoCandidateMapsPrimed(acceptableTypes);

        size_t totalCount = 0;
        size_t collisionCount = 0;
        size_t visualCount = 0;
        _renderDelegate.ReadAllProtoDataBlobs(
            [&](std::string const& rprimPath, WebRenderDelegate::ProtoDataBlobRecord const&) {
                if (rprimPath.find(".proto_") == std::string::npos) return;
                const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(rprimPath);
                if (!proto.valid) return;

                emscripten::val overrideData = emscripten::val::object();
                if (proto.sectionName == "collisions") {
                    overrideData = _BuildCollisionProtoOverride(
                        rprimPath,
                        timeCode,
                        &xformCache,
                        &_collisionCandidateMapCache);
                } else if (proto.sectionName == "visuals") {
                    overrideData = _BuildVisualProtoOverride(
                        rprimPath,
                        timeCode,
                        &xformCache,
                        &_visualCandidateMapCache);
                } else {
                    return;
                }

                bool valid = false;
                try {
                    valid = overrideData["valid"].as<bool>();
                } catch (...) {
                    valid = false;
                }
                if (!valid) return;

                uint32_t dirtyMask = 0;
                try {
                    dirtyMask = static_cast<uint32_t>(overrideData["dirtyMask"].as<double>());
                } catch (...) {
                    dirtyMask = 0;
                }

                if (proto.sectionName == "collisions") {
                    dirtyMask |= kFinalStageDirtySectionCollision;
                    dirtyMask |= kFinalStageDirtyApplyGeometry;
                    overrideData.set("applyGeometry", true);
                    ++collisionCount;
                } else {
                    dirtyMask |= kFinalStageDirtySectionVisual;
                    overrideData.set("applyGeometry", false);
                    ++visualCount;
                }

                overrideData.set("sectionName", proto.sectionName);
                overrideData.set("dirtyMask", static_cast<double>(dirtyMask));
                entries.set(rprimPath, overrideData);
                ++totalCount;
            });

        bundle.set("count", static_cast<double>(totalCount));
        bundle.set("collisionCount", static_cast<double>(collisionCount));
        bundle.set("visualCount", static_cast<double>(visualCount));
        return bundle;
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
    using ProtoCandidateMap = std::unordered_map<std::string, std::vector<PrimCandidate>>;
    using CollisionCandidateMap = ProtoCandidateMap;
    using VisualCandidateMap = ProtoCandidateMap;

    mutable bool _protoCandidateMapsPrimed = false;
    mutable CollisionCandidateMap _collisionCandidateMapCache;
    mutable VisualCandidateMap _visualCandidateMapCache;
    mutable std::unordered_map<std::string, ProtoMeshIdentifier> _protoMeshIdentifierCache;
    mutable std::mutex _primOverrideMeshPayloadMutex;
    mutable std::unordered_map<std::string, WebRenderDelegate::ProtoDataBlobRecord> _primOverrideMeshPayloadCache;

    static constexpr uint32_t kFinalStageDirtyGeometryDescriptor = 1u << 0;
    static constexpr uint32_t kFinalStageDirtyWorldTransform = 1u << 1;
    static constexpr uint32_t kFinalStageDirtyResolvedPrimPath = 1u << 2;
    static constexpr uint32_t kFinalStageDirtyExtent = 1u << 3;
    static constexpr uint32_t kFinalStageDirtyPrimitiveParams = 1u << 4;
    static constexpr uint32_t kFinalStageDirtySectionCollision = 1u << 8;
    static constexpr uint32_t kFinalStageDirtySectionVisual = 1u << 9;
    static constexpr uint32_t kFinalStageDirtyApplyGeometry = 1u << 10;

    ProtoMeshIdentifier _GetCachedProtoMeshIdentifier(std::string const& meshId) const {
        if (meshId.empty()) return ProtoMeshIdentifier();
        const auto found = _protoMeshIdentifierCache.find(meshId);
        if (found != _protoMeshIdentifierCache.end()) {
            return found->second;
        }
        const ProtoMeshIdentifier parsed = _ParseProtoMeshIdentifier(meshId);
        _protoMeshIdentifierCache.emplace(meshId, parsed);
        return parsed;
    }

    void _EnsureProtoCandidateMapsPrimed(
        std::vector<std::string> const& acceptedTypes) const {
        if (_protoCandidateMapsPrimed) return;
        _collisionCandidateMapCache = _BuildCollisionCandidateMap(acceptedTypes);
        _visualCandidateMapCache = _BuildVisualCandidateMap(acceptedTypes);
        _protoCandidateMapsPrimed = true;
    }

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

    static std::vector<std::string> _GetExpectedPrimTypesForProtoType(std::string const& protoType) {
        std::vector<std::string> expected;
        const std::string normalizedType = _ToLowerAscii(protoType);
        if (normalizedType == "box") {
            expected.push_back("cube");
        } else if (normalizedType == "sphere") {
            expected.push_back("sphere");
        } else if (normalizedType == "cylinder") {
            expected.push_back("cylinder");
        } else if (normalizedType == "capsule") {
            expected.push_back("capsule");
        } else if (normalizedType == "mesh") {
            expected.push_back("mesh");
            expected.push_back("cube");
            expected.push_back("sphere");
            expected.push_back("cylinder");
            expected.push_back("capsule");
        }
        return expected;
    }

    static std::vector<std::string> _GetExpectedCollisionPrimTypes(ProtoMeshIdentifier const& proto) {
        if (!proto.valid || proto.sectionName != "collisions") return {};
        return _GetExpectedPrimTypesForProtoType(proto.protoType);
    }

    static std::vector<std::string> _GetExpectedVisualPrimTypes(ProtoMeshIdentifier const& proto) {
        if (!proto.valid || proto.sectionName != "visuals") return {};
        return _GetExpectedPrimTypesForProtoType(proto.protoType);
    }

    static std::vector<std::string> _BuildProtoPrimPathCandidates(
        ProtoMeshIdentifier const& proto,
        bool includeGenericFallbacks = true) {
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
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex));
            if (includeGenericFallbacks && proto.protoIndex == 0) {
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
            }
            return candidates;
        }

        const std::string usdType = proto.protoType == "box" ? "cube" : proto.protoType;
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/" + proto.protoType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/mesh_" + std::to_string(proto.protoIndex) + "/" + usdType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType + "_" + std::to_string(proto.protoIndex) + "/" + proto.protoType);
        _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType + "_" + std::to_string(proto.protoIndex) + "/" + usdType);
        if (includeGenericFallbacks && proto.protoIndex == 0) {
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + usdType);
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.protoType);
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "/" + usdType);
            _AppendUniqueCandidate(&candidates, proto.containerPath + "/" + proto.linkName + "/" + proto.protoType);
        }
        return candidates;
    }

    static std::string _NormalizeLinkToken(std::string value) {
        std::string lowered = _ToLowerAscii(value);
        if (lowered.size() > 5 && lowered.substr(lowered.size() - 5) == "_link") {
            lowered = lowered.substr(0, lowered.size() - 5);
        }
        return lowered;
    }

    static std::string _GetParentPathBasename(std::string const& primPath) {
        if (primPath.empty()) return std::string();
        const size_t lastSlash = primPath.find_last_of('/');
        if (lastSlash == std::string::npos || lastSlash == 0) return std::string();
        return _GetPathBasename(primPath.substr(0, lastSlash));
    }

    static bool _IsLikelyLinkNamedCandidatePath(
        ProtoMeshIdentifier const& proto,
        std::string const& primPath) {
        if (!proto.valid || primPath.empty()) return false;
        const std::string linkToken = _NormalizeLinkToken(proto.linkName);
        if (linkToken.empty()) return false;

        const std::string parentName = _NormalizeLinkToken(_GetParentPathBasename(primPath));
        if (parentName.empty()) return false;
        if (parentName == linkToken) return true;
        if (parentName.find(linkToken) != std::string::npos) return true;
        return false;
    }

    static void _PrepareProtoDiscoveredCandidates(
        ProtoMeshIdentifier const& proto,
        std::vector<std::string> const& expectedTypes,
        std::vector<PrimCandidate>* discovered) {
        if (!discovered) return;
        if (discovered->empty()) return;

        std::unordered_set<std::string> seenPaths;
        std::vector<PrimCandidate> filtered;
        filtered.reserve(discovered->size());
        for (PrimCandidate const& candidate : *discovered) {
            if (!candidate.second) continue;
            if (candidate.first.empty()) continue;
            if (!seenPaths.insert(candidate.first).second) continue;
            const std::string candidateType = _GetSupportedPrimTypeName(candidate.second);
            if (candidateType.empty() || !_ContainsString(expectedTypes, candidateType)) continue;
            filtered.push_back(candidate);
        }
        if (filtered.empty()) {
            discovered->clear();
            return;
        }

        if (proto.protoType == "mesh" && filtered.size() > 1) {
            const auto preferred = std::find_if(
                filtered.begin(),
                filtered.end(),
                [&](PrimCandidate const& candidate) {
                    return _IsLikelyLinkNamedCandidatePath(proto, candidate.first);
                });
            if (preferred != filtered.end() && preferred != filtered.begin()) {
                std::rotate(filtered.begin(), preferred, preferred + 1);
            }
        }

        *discovered = std::move(filtered);
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

    bool _ResolveProtoPrim(
        ProtoMeshIdentifier const& proto,
        std::vector<std::string> const& expectedTypes,
        bool collisionSection,
        ProtoCandidateMap const* candidateMap,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType) const {
        if (!_stage || !proto.valid || !outPrim || !outPrimPath || !outPrimType) return false;
        if (expectedTypes.empty()) return false;

        const std::vector<std::string> indexCandidates = _BuildProtoPrimPathCandidates(proto, false);
        for (std::string const& candidatePath : indexCandidates) {
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
        } else if (collisionSection) {
            CollisionCandidateMap fallbackMap = _BuildCollisionCandidateMap(expectedTypes);
            const auto found = fallbackMap.find(proto.containerPath);
            if (found != fallbackMap.end()) {
                discovered = found->second;
            }
        } else {
            VisualCandidateMap fallbackMap = _BuildVisualCandidateMap(expectedTypes);
            const auto found = fallbackMap.find(proto.containerPath);
            if (found != fallbackMap.end()) {
                discovered = found->second;
            }
        }

        _PrepareProtoDiscoveredCandidates(proto, expectedTypes, &discovered);

        if (!discovered.empty()) {
            const size_t discoveredSize = discovered.size();
            if (proto.protoIndex > 0 && static_cast<size_t>(proto.protoIndex) >= discoveredSize) {
                return false;
            }
            const size_t pickedIndex = (
                proto.protoIndex >= 0
                && static_cast<size_t>(proto.protoIndex) < discoveredSize)
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

        if (proto.protoIndex == 0) {
            const std::vector<std::string> genericCandidates = _BuildProtoPrimPathCandidates(proto, true);
            for (std::string const& candidatePath : genericCandidates) {
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
        }

        return false;
    }

    bool _ResolveCollisionProtoPrim(
        ProtoMeshIdentifier const& proto,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType,
        CollisionCandidateMap const* candidateMap = nullptr) const {
        const std::vector<std::string> expectedTypes = _GetExpectedCollisionPrimTypes(proto);
        return _ResolveProtoPrim(
            proto,
            expectedTypes,
            true,
            candidateMap,
            outPrim,
            outPrimPath,
            outPrimType);
    }

    bool _ResolveVisualProtoPrim(
        ProtoMeshIdentifier const& proto,
        UsdPrim* outPrim,
        std::string* outPrimPath,
        std::string* outPrimType,
        VisualCandidateMap const* candidateMap = nullptr) const {
        const std::vector<std::string> expectedTypes = _GetExpectedVisualPrimTypes(proto);
        return _ResolveProtoPrim(
            proto,
            expectedTypes,
            false,
            candidateMap,
            outPrim,
            outPrimPath,
            outPrimType);
    }

    ProtoCandidateMap _BuildProtoCandidateMap(
        std::vector<std::string> const& acceptedTypes,
        std::string const& sectionMarker,
        size_t sectionContainerLength) const {
        ProtoCandidateMap candidateMap;
        if (!_stage || acceptedTypes.empty()) return candidateMap;
        if (sectionMarker.empty() || sectionContainerLength == 0) return candidateMap;

        const Usd_PrimFlagsPredicate predicate = UsdTraverseInstanceProxies(UsdPrimAllPrimsPredicate);
        for (UsdPrim const& prim : UsdPrimRange::Stage(_stage, predicate)) {
            if (!prim) continue;
            const std::string primType = _GetSupportedPrimTypeName(prim);
            if (primType.empty() || !_ContainsString(acceptedTypes, primType)) continue;

            const std::string primPath = prim.GetPath().GetString();
            const size_t markerPos = primPath.find(sectionMarker);
            if (markerPos == std::string::npos) continue;

            const size_t containerEnd = markerPos + sectionContainerLength;
            if (containerEnd <= 0 || containerEnd > primPath.size()) continue;
            const std::string containerPath = primPath.substr(0, containerEnd);
            if (containerPath.empty()) continue;

            candidateMap[containerPath].push_back({primPath, prim});
        }
        return candidateMap;
    }

    CollisionCandidateMap _BuildCollisionCandidateMap(
        std::vector<std::string> const& acceptedTypes) const {
        return _BuildProtoCandidateMap(
            acceptedTypes,
            "/collisions/",
            std::string("/collisions").size());
    }

    VisualCandidateMap _BuildVisualCandidateMap(
        std::vector<std::string> const& acceptedTypes) const {
        return _BuildProtoCandidateMap(
            acceptedTypes,
            "/visuals/",
            std::string("/visuals").size());
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
        const std::array<TfToken, 2> axisAttrNames = {
            TfToken("physics:axis"),
            TfToken("axis")
        };
        for (TfToken const& axisAttrName : axisAttrNames) {
            UsdAttribute axisAttr = prim.GetAttribute(axisAttrName);
            if (!axisAttr) continue;

            TfToken axisToken;
            if (axisAttr.Get(&axisToken, timeCode) && !axisToken.IsEmpty()) {
                axis = axisToken.GetString();
                break;
            }

            std::string axisString;
            if (axisAttr.Get(&axisString, timeCode) && !axisString.empty()) {
                axis = axisString;
                break;
            }
        }
        axis = _ToLowerAscii(axis);
        if (axis == "x") return "X";
        if (axis == "y") return "Y";
        return "Z";
    }

    static void _Matrix4dToFloat16(
        GfMatrix4d const& matrix,
        std::array<float, 16>* outValues) {
        if (!outValues) return;
        int index = 0;
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                (*outValues)[index++] = static_cast<float>(matrix[row][column]);
            }
        }
    }

    static bool _TryTriangulateFaceVertexIndices(
        VtIntArray const& faceVertexCounts,
        VtIntArray const& faceVertexIndices,
        std::vector<uint32_t>* outIndices) {
        if (!outIndices) return false;
        outIndices->clear();
        if (faceVertexIndices.empty()) return false;

        if (faceVertexCounts.empty()) {
            outIndices->reserve(faceVertexIndices.size());
            for (int indexValue : faceVertexIndices) {
                if (indexValue < 0) return false;
                outIndices->push_back(static_cast<uint32_t>(indexValue));
            }
            return !outIndices->empty();
        }

        size_t cursor = 0;
        for (int countValue : faceVertexCounts) {
            const int count = countValue > 0 ? countValue : 0;
            const size_t countSize = static_cast<size_t>(count);
            if (cursor + countSize > faceVertexIndices.size()) {
                break;
            }

            if (count >= 3) {
                const int firstIndex = faceVertexIndices[cursor];
                if (firstIndex < 0) return false;
                for (int vertexIndex = 1; vertexIndex < count - 1; ++vertexIndex) {
                    const int secondIndex = faceVertexIndices[cursor + static_cast<size_t>(vertexIndex)];
                    const int thirdIndex = faceVertexIndices[cursor + static_cast<size_t>(vertexIndex + 1)];
                    if (secondIndex < 0 || thirdIndex < 0) return false;
                    outIndices->push_back(static_cast<uint32_t>(firstIndex));
                    outIndices->push_back(static_cast<uint32_t>(secondIndex));
                    outIndices->push_back(static_cast<uint32_t>(thirdIndex));
                }
            }
            cursor += countSize;
            if (cursor >= faceVertexIndices.size()) break;
        }

        return !outIndices->empty();
    }

    static bool _BuildMeshPayloadRecordFromPrim(
        UsdPrim const& prim,
        UsdTimeCode const& timeCode,
        GfMatrix4d const& worldMatrix,
        WebRenderDelegate::ProtoDataBlobRecord* outRecord) {
        if (!outRecord) return false;

        *outRecord = WebRenderDelegate::ProtoDataBlobRecord();
        const UsdGeomMesh mesh(prim);
        if (!mesh) return false;

        const UsdAttribute pointsAttr = mesh.GetPointsAttr();
        VtVec3fArray pointsF;
        if (pointsAttr.Get(&pointsF, timeCode) && !pointsF.empty()) {
            outRecord->points.reserve(pointsF.size() * 3);
            for (GfVec3f const& point : pointsF) {
                outRecord->points.push_back(point[0]);
                outRecord->points.push_back(point[1]);
                outRecord->points.push_back(point[2]);
            }
        } else {
            VtVec3dArray pointsD;
            if (pointsAttr.Get(&pointsD, timeCode) && !pointsD.empty()) {
                outRecord->points.reserve(pointsD.size() * 3);
                for (GfVec3d const& point : pointsD) {
                    outRecord->points.push_back(static_cast<float>(point[0]));
                    outRecord->points.push_back(static_cast<float>(point[1]));
                    outRecord->points.push_back(static_cast<float>(point[2]));
                }
            }
        }
        if (outRecord->points.empty()) return false;

        VtIntArray faceVertexIndices;
        VtIntArray faceVertexCounts;
        mesh.GetFaceVertexIndicesAttr().Get(&faceVertexIndices, timeCode);
        mesh.GetFaceVertexCountsAttr().Get(&faceVertexCounts, timeCode);
        _TryTriangulateFaceVertexIndices(faceVertexCounts, faceVertexIndices, &outRecord->indices);

        const UsdAttribute uvAttr = prim.GetAttribute(TfToken("primvars:st"));
        if (uvAttr) {
            VtVec2fArray uvF;
            if (uvAttr.Get(&uvF, timeCode) && !uvF.empty()) {
                outRecord->uv.reserve(uvF.size() * 2);
                for (GfVec2f const& uv : uvF) {
                    outRecord->uv.push_back(uv[0]);
                    outRecord->uv.push_back(uv[1]);
                }
            } else {
                VtVec2dArray uvD;
                if (uvAttr.Get(&uvD, timeCode) && !uvD.empty()) {
                    outRecord->uv.reserve(uvD.size() * 2);
                    for (GfVec2d const& uv : uvD) {
                        outRecord->uv.push_back(static_cast<float>(uv[0]));
                        outRecord->uv.push_back(static_cast<float>(uv[1]));
                    }
                }
            }
        }

        const UsdAttribute normalsAttr = mesh.GetNormalsAttr();
        if (normalsAttr) {
            VtVec3fArray normalsF;
            if (normalsAttr.Get(&normalsF, timeCode) && !normalsF.empty()) {
                outRecord->normals.reserve(normalsF.size() * 3);
                for (GfVec3f const& normal : normalsF) {
                    outRecord->normals.push_back(normal[0]);
                    outRecord->normals.push_back(normal[1]);
                    outRecord->normals.push_back(normal[2]);
                }
            } else {
                VtVec3dArray normalsD;
                if (normalsAttr.Get(&normalsD, timeCode) && !normalsD.empty()) {
                    outRecord->normals.reserve(normalsD.size() * 3);
                    for (GfVec3d const& normal : normalsD) {
                        outRecord->normals.push_back(static_cast<float>(normal[0]));
                        outRecord->normals.push_back(static_cast<float>(normal[1]));
                        outRecord->normals.push_back(static_cast<float>(normal[2]));
                    }
                }
            }
        }

        _Matrix4dToFloat16(worldMatrix, &outRecord->transform);
        outRecord->numVertices = static_cast<int>(outRecord->points.size() / 3);
        outRecord->numIndices = static_cast<int>(outRecord->indices.size());
        outRecord->numUVs = static_cast<int>(outRecord->uv.size() / 2);
        outRecord->uvDimension = outRecord->numUVs > 0 ? 2 : 0;
        outRecord->numNormals = static_cast<int>(outRecord->normals.size() / 3);
        outRecord->normalsDimension = outRecord->numNormals > 0 ? 3 : 0;
        outRecord->valid = outRecord->numVertices > 0;
        return outRecord->valid;
    }

    static emscripten::val _Vec3ToJsArray(std::array<double, 3> const& value) {
        emscripten::val out = emscripten::val::array();
        out.set(0, value[0]);
        out.set(1, value[1]);
        out.set(2, value[2]);
        return out;
    }

    static emscripten::val _Vec4ToJsArray(std::array<double, 4> const& value) {
        emscripten::val out = emscripten::val::array();
        out.set(0, value[0]);
        out.set(1, value[1]);
        out.set(2, value[2]);
        out.set(3, value[3]);
        return out;
    }

    static std::string _ReadFirstRelationshipTargetPath(UsdRelationship const& relationship) {
        if (!relationship) return std::string();
        SdfPathVector targets;
        if (!relationship.GetTargets(&targets) || targets.empty()) return std::string();
        return targets[0].GetString();
    }

    static bool _TryReadVec3Attr(
        UsdAttribute const& attribute,
        UsdTimeCode const& timeCode,
        std::array<double, 3>* outValue) {
        if (!attribute || !outValue) return false;

        GfVec3f valueF(0.0f);
        if (attribute.Get(&valueF, timeCode)) {
            (*outValue)[0] = static_cast<double>(valueF[0]);
            (*outValue)[1] = static_cast<double>(valueF[1]);
            (*outValue)[2] = static_cast<double>(valueF[2]);
            return true;
        }

        GfVec3d valueD(0.0);
        if (attribute.Get(&valueD, timeCode)) {
            (*outValue)[0] = valueD[0];
            (*outValue)[1] = valueD[1];
            (*outValue)[2] = valueD[2];
            return true;
        }

        return false;
    }

    static bool _TryReadQuatWxyzAttr(
        UsdAttribute const& attribute,
        UsdTimeCode const& timeCode,
        std::array<double, 4>* outValue) {
        if (!attribute || !outValue) return false;

        GfQuatf valueQuatf;
        if (attribute.Get(&valueQuatf, timeCode)) {
            const GfVec3f imaginary = valueQuatf.GetImaginary();
            (*outValue)[0] = static_cast<double>(valueQuatf.GetReal());
            (*outValue)[1] = static_cast<double>(imaginary[0]);
            (*outValue)[2] = static_cast<double>(imaginary[1]);
            (*outValue)[3] = static_cast<double>(imaginary[2]);
            return true;
        }

        GfQuatd valueQuatd;
        if (attribute.Get(&valueQuatd, timeCode)) {
            const GfVec3d imaginary = valueQuatd.GetImaginary();
            (*outValue)[0] = valueQuatd.GetReal();
            (*outValue)[1] = imaginary[0];
            (*outValue)[2] = imaginary[1];
            (*outValue)[3] = imaginary[2];
            return true;
        }

        return false;
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

        const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(meshId);
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

    emscripten::val _BuildVisualProtoOverride(
        std::string const& meshId,
        UsdTimeCode const& timeCode,
        UsdGeomXformCache* xformCache,
        VisualCandidateMap const* candidateMap = nullptr) const {
        emscripten::val out = emscripten::val::object();
        out.set("valid", false);
        if (!_stage || !xformCache) return out;

        const ProtoMeshIdentifier proto = _GetCachedProtoMeshIdentifier(meshId);
        if (!proto.valid || proto.sectionName != "visuals") return out;

        UsdPrim resolvedPrim;
        std::string resolvedPrimPath;
        std::string resolvedPrimType;
        if (!_ResolveVisualProtoPrim(proto, &resolvedPrim, &resolvedPrimPath, &resolvedPrimType, candidateMap)) {
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

        uint32_t dirtyMask = (
            kFinalStageDirtyGeometryDescriptor
            | kFinalStageDirtyWorldTransform
            | kFinalStageDirtyResolvedPrimPath);
        const GfMatrix4d worldMatrix = xformCache->GetLocalToWorldTransform(prim);
        out.set("valid", true);
        out.set("resolvedPrimPath", primPath);
        out.set("primType", primType);
        out.set("worldTransform", _Matrix4dToJsArray(worldMatrix));

        if (primType == "mesh") {
            WebRenderDelegate::ProtoDataBlobRecord meshPayloadRecord;
            if (_BuildMeshPayloadRecordFromPrim(prim, timeCode, worldMatrix, &meshPayloadRecord)) {
                emscripten::val payload = emscripten::val::object();
                {
                    std::lock_guard<std::mutex> lock(_primOverrideMeshPayloadMutex);
                    WebRenderDelegate::ProtoDataBlobRecord& cached = _primOverrideMeshPayloadCache[primPath];
                    cached = std::move(meshPayloadRecord);
                    payload = _ProtoDataBlobRecordToJsVal(cached);
                }

                out.set("meshPayload", payload);
                // Keep flattened fields for compatibility with existing blob readers.
                out.set("numVertices", payload["numVertices"]);
                out.set("numIndices", payload["numIndices"]);
                out.set("numUVs", payload["numUVs"]);
                out.set("uvDimension", payload["uvDimension"]);
                out.set("numNormals", payload["numNormals"]);
                out.set("normalsDimension", payload["normalsDimension"]);
                out.set("pointsPtr", payload["pointsPtr"]);
                out.set("indicesPtr", payload["indicesPtr"]);
                out.set("uvPtr", payload["uvPtr"]);
                out.set("normalsPtr", payload["normalsPtr"]);
                out.set("transformPtr", payload["transformPtr"]);
                out.set("transform", payload["transform"]);
            }
        }

        std::array<double, 3> extentSize = {0.0, 0.0, 0.0};
        if (_TryReadExtentSize(prim, timeCode, &extentSize)) {
            out.set("extentSize", _Vec3ToJsArray(extentSize));
            dirtyMask |= kFinalStageDirtyExtent;
        }

        if (primType == "cube") {
            double size = 0.0;
            if (_TryReadDoubleAttr(prim, "size", timeCode, &size)) {
                out.set("size", size);
                dirtyMask |= kFinalStageDirtyPrimitiveParams;
            }
        } else if (primType == "sphere" || primType == "cylinder" || primType == "capsule") {
            double radius = 0.0;
            if (_TryReadDoubleAttr(prim, "radius", timeCode, &radius)) {
                out.set("radius", radius);
                dirtyMask |= kFinalStageDirtyPrimitiveParams;
            }
            if (primType == "cylinder" || primType == "capsule") {
                double height = 0.0;
                if (_TryReadDoubleAttr(prim, "height", timeCode, &height)) {
                    out.set("height", height);
                    dirtyMask |= kFinalStageDirtyPrimitiveParams;
                }
                out.set("axis", _ReadAxisToken(prim, timeCode));
                dirtyMask |= kFinalStageDirtyPrimitiveParams;
            }
        }

        out.set("dirtyMask", static_cast<double>(dirtyMask));
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
        {
            std::lock_guard<std::mutex> lock(_primOverrideMeshPayloadMutex);
            _primOverrideMeshPayloadCache.clear();
        }

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
