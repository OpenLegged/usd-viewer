#ifndef PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_RENDER_DELEGATE_H
#define PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_RENDER_DELEGATE_H

#include "pxr/pxr.h"
#include "pxr/imaging/hd/renderDelegate.h"
#include "pxr/imaging/hd/instancer.h"
#include "pxr/imaging/hd/mesh.h"
#include "pxr/imaging/hd/enums.h"
#include "pxr/imaging/hd/vertexAdjacency.h"
#include "pxr/base/gf/matrix4f.h"
#include "pxr/base/gf/vec2f.h"
#include "pxr/base/gf/vec3f.h"
#include "pxr/base/gf/vec4f.h"
#include "pxr/base/gf/vec2d.h"
#include "pxr/base/gf/vec3d.h"
#include "pxr/base/gf/vec4d.h"
#include "pxr/base/gf/vec2i.h"
#include "pxr/base/gf/vec3i.h"
#include "pxr/base/gf/vec4i.h"

#include <emscripten/bind.h>
#include <emscripten/threading.h>

#include <array>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

PXR_NAMESPACE_OPEN_SCOPE

class WebRenderDelegate final : public HdRenderDelegate
{
public:
    struct ProtoDataBlobRecord
    {
        bool valid = false;
        int numVertices = 0;
        int numIndices = 0;
        int numUVs = 0;
        int uvDimension = 0;
        int numNormals = 0;
        int normalsDimension = 0;
        std::vector<float> points;
        std::vector<uint32_t> indices;
        std::vector<float> uv;
        std::vector<float> normals;
        std::array<float, 16> transform = {0.0f};
        std::string materialId;
    };

    WebRenderDelegate(emscripten::val renderDelegateInterface) :
             _renderDelegateInterface(renderDelegateInterface)
    {

    };
    virtual ~WebRenderDelegate() = default;

    virtual const TfTokenVector &GetSupportedRprimTypes() const override;
    virtual const TfTokenVector &GetSupportedSprimTypes() const override;
    virtual const TfTokenVector &GetSupportedBprimTypes() const override;
    virtual HdRenderParam *GetRenderParam() const override;
    virtual HdResourceRegistrySharedPtr GetResourceRegistry() const override;

    ////////////////////////////////////////////////////////////////////////////
    ///
    /// Renderpass factory
    ///
    ////////////////////////////////////////////////////////////////////////////

    virtual HdRenderPassSharedPtr CreateRenderPass(HdRenderIndex *index,
                HdRprimCollection const& collection) override;

    ////////////////////////////////////////////////////////////////////////////
    ///
    /// Instancer Factory
    ///
    ////////////////////////////////////////////////////////////////////////////

    virtual HdInstancer *CreateInstancer(HdSceneDelegate *delegate,
                                         SdfPath const& id) override;

    virtual void DestroyInstancer(HdInstancer *instancer) override;

    ////////////////////////////////////////////////////////////////////////////
    ///
    /// Prim Factories
    ///
    ////////////////////////////////////////////////////////////////////////////

    virtual HdRprim *CreateRprim(TfToken const& typeId,
                                 SdfPath const& rprimId) override;

    virtual void DestroyRprim(HdRprim *rPrim) override;

    virtual HdSprim *CreateSprim(TfToken const& typeId,
                                 SdfPath const& sprimId) override;

    virtual HdSprim *CreateFallbackSprim(TfToken const& typeId) override;
    virtual void DestroySprim(HdSprim *sprim) override;

    virtual HdBprim *CreateBprim(TfToken const& typeId,
                                 SdfPath const& bprimId) override;

    virtual HdBprim *CreateFallbackBprim(TfToken const& typeId) override;

    virtual void DestroyBprim(HdBprim *bprim) override;

    ////////////////////////////////////////////////////////////////////////////
    ///
    /// Sync, Execute & Dispatch Hooks
    ///
    ////////////////////////////////////////////////////////////////////////////

    virtual void CommitResources(HdChangeTracker *tracker) override;

    void UpsertProtoDataBlob(std::string const& rprimPath,
                             ProtoDataBlobRecord const& record);
    bool ReadProtoDataBlob(
        std::string const& rprimPath,
        std::function<void(ProtoDataBlobRecord const&)> const& reader) const;
    void ReadAllProtoDataBlobs(
        std::function<void(std::string const&, ProtoDataBlobRecord const&)> const& reader) const;
    void RemoveProtoDataBlob(std::string const& rprimPath);

private:
    static const TfTokenVector SUPPORTED_RPRIM_TYPES;
    static const TfTokenVector SUPPORTED_SPRIM_TYPES;
    static const TfTokenVector SUPPORTED_BPRIM_TYPES;

    WebRenderDelegate(
                                const WebRenderDelegate &) = delete;
    WebRenderDelegate &operator =(
                                const WebRenderDelegate &) = delete;

    emscripten::val _renderDelegateInterface;
    mutable std::mutex _protoDataBlobMutex;
    std::unordered_map<std::string, ProtoDataBlobRecord> _protoDataBlobByRprimPath;
};

PXR_NAMESPACE_CLOSE_SCOPE

#endif // PXR_USD_IMAGING_USD_IMAGING_EMSCRIPTEN_RENDER_DELEGATE_H
