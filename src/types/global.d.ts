import type { PerspectiveCamera, Group, Scene, WebGLRenderer } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
  }
}

export {};
