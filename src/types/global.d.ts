import type { PerspectiveCamera, Group, Scene, WebGLRenderer } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { UsdViewerApi, ViewerRoundtripExportResult } from "../embed/usd-viewer-api.js";

declare global {
  interface Window {
    camera?: PerspectiveCamera;
    scene?: Scene;
    renderer?: WebGLRenderer;
    _controls?: OrbitControls;
    usdRoot?: Group;
    driver?: any;
    usdStage?: any;
    renderInterface?: any;
    linkRotationController?: any;
    linkDynamicsController?: any;
    USD?: any;
    usdViewerApi?: UsdViewerApi;
    exportLoadedStageSnapshot?: (options?: Record<string, unknown>) => Promise<ViewerRoundtripExportResult | { ok: false; error: string }>;
  }
}

export {};
