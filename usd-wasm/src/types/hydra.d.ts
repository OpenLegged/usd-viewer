import { Object3D, Texture } from 'three';
import { HdWebSyncDriver } from './bindings';

export class hydraDelegate { }






export const consoleRenderDelegate: hydraDelegate = {}






export type threeJsRenderDelegateConfig = {
    driver: () => HdWebSyncDriver,
    stage?: () => any,
    setStage?: (stage: any) => void,
    usdRoot: Object3D,
    stageSourcePath?: string,
    suppressMaterialBindingApiWarnings?: boolean,
    enableXformOpFallbackFromLayerText?: boolean,
    enableProtoBlobFastPath?: boolean,
    loadCollisionPrims?: boolean,
    loadVisualPrims?: boolean,
    maxVisualPrims?: number,
    /** Paths for resolving textures */
    paths?: string[],
    /** @deprecated */
    envMap?: Texture,
}
export class threeJsRenderDelegate extends hydraDelegate {
    constructor(path: string, config: threeJsRenderDelegateConfig)
}
