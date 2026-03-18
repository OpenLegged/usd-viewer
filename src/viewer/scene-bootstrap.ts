import {
  PerspectiveCamera,
  Scene,
  Group,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  SRGBColorSpace,
  NeutralToneMapping,
  VSMShadowMap,
  PMREMGenerator,
  EquirectangularReflectionMapping,
} from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const HYDRA_PHASE_PROFILE_FROM_QUERY = (() => {
  try {
    const search = typeof window !== "undefined" ? String(window.location?.search || "") : "";
    if (!search) return false;
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const raw = params.get("profileHydraPhases");
    if (raw === null) return false;
    const normalized = String(raw || "").trim().toLowerCase();
    if (normalized === "") return true;
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  } catch {
    return false;
  }
})();

export interface SceneBootstrapOptions {
  params: URLSearchParams;
  onDrop: (event: DragEvent) => Promise<void>;
  onTogglePause: () => void;
  onResize: () => void;
}

export async function initializeViewerScene(options: SceneBootstrapOptions): Promise<() => void> {
  const { params, onDrop, onTogglePause, onResize } = options;
  const parseQueryBoolean = (value: string | null, fallback: boolean): boolean => {
    if (value === null || value === undefined) return fallback;
    const normalized = String(value || "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return fallback;
  };
  const parseNonNegativeNumber = (value: string | null, fallback: number): number => {
    if (value === null || value === undefined || String(value).trim() === "") return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  };

  const camera = (window.camera = new PerspectiveCamera(27, window.innerWidth / window.innerHeight, 1, 3500));
  camera.position.z = Number(params.get("cameraZ")) || 7;
  camera.position.y = Number(params.get("cameraY")) || 7;
  camera.position.x = Number(params.get("cameraX")) || 0;

  const scene = (window.scene = new Scene());
  const usdRoot = (window.usdRoot = new Group());
  usdRoot.name = "USD Root";
  scene.add(usdRoot);

  const renderer = (window.renderer = new WebGLRenderer({ antialias: true, alpha: false }));
  let disposed = false;
  let interactionPixelRatioTimer: number | null = null;
  let environmentRenderTarget: { dispose: () => void; texture?: { dispose?: () => void } } | null = null;
  const pixelRatioCap = parseNonNegativeNumber(params.get("pixelRatioCap"), 1.0);
  const interactionPixelRatioCap = parseNonNegativeNumber(params.get("interactionPixelRatioCap"), 1.0);
  const interactionPixelRatioHoldMs = Math.max(0, Math.min(10_000, Math.floor(parseNonNegativeNumber(params.get("interactionPixelRatioHoldMs"), 220))));
  const safePixelRatioCap = Math.max(0.5, pixelRatioCap);
  const resolveBasePixelRatio = (): number => Math.max(0.5, Math.min(window.devicePixelRatio || 1, safePixelRatioCap));
  const resolveInteractionPixelRatio = (): number => {
    const basePixelRatio = resolveBasePixelRatio();
    return Math.max(0.5, Math.min(basePixelRatio, Math.max(0.25, interactionPixelRatioCap)));
  };
  const applyPixelRatio = (ratio: number): void => {
    if (disposed) return;
    const basePixelRatio = resolveBasePixelRatio();
    const clamped = Math.max(0.25, Math.min(basePixelRatio, ratio));
    if (Math.abs(renderer.getPixelRatio() - clamped) <= 1e-4) return;
    renderer.setPixelRatio(clamped);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    // Ensure viewport updates are visible even when animation loop is idle.
    renderScene();
  };
  renderer.setPixelRatio(resolveBasePixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = VSMShadowMap;
  renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0xd7dde8, 1);

  // Keep a deterministic direct-light baseline so dark materials do not collapse
  // into black silhouettes when environment lighting is weak or delayed.
  if (parseQueryBoolean(params.get("fallbackLights"), true)) {
    const ambient = new AmbientLight(0xffffff, parseNonNegativeNumber(params.get("ambientIntensity"), 0.38));
    ambient.name = "ViewerAmbientLight";
    scene.add(ambient);

    const keyLight = new DirectionalLight(0xffffff, parseNonNegativeNumber(params.get("keyLightIntensity"), 1.15));
    keyLight.name = "ViewerKeyLight";
    keyLight.position.set(6, 8, 6);
    scene.add(keyLight);

    const fillLight = new DirectionalLight(0xd7e6ff, parseNonNegativeNumber(params.get("fillLightIntensity"), 0.55));
    fillLight.name = "ViewerFillLight";
    fillLight.position.set(-7, 4, -6);
    scene.add(fillLight);

    const rimLight = new DirectionalLight(0xfff2d4, parseNonNegativeNumber(params.get("rimLightIntensity"), 0.35));
    rimLight.name = "ViewerRimLight";
    rimLight.position.set(0, 10, -10);
    scene.add(rimLight);
  }

  const controls = (window._controls = new OrbitControls(camera, renderer.domElement));
  controls.enableDamping = true;
  controls.dampingFactor = 0.2;
  controls.update();
  const requestImmediateRender = (): void => {
    if (disposed) return;
    renderScene();
  };
  let inInteractionQualityMode = false;
  const enterInteractionQualityMode = (): void => {
    if (inInteractionQualityMode) return;
    inInteractionQualityMode = true;
    if (interactionPixelRatioTimer !== null) {
      window.clearTimeout(interactionPixelRatioTimer);
      interactionPixelRatioTimer = null;
    }
    applyPixelRatio(resolveInteractionPixelRatio());
  };
  const scheduleBaseQualityRestore = (): void => {
    if (interactionPixelRatioTimer !== null) {
      window.clearTimeout(interactionPixelRatioTimer);
      interactionPixelRatioTimer = null;
    }
    if (interactionPixelRatioHoldMs <= 0) {
      inInteractionQualityMode = false;
      applyPixelRatio(resolveBasePixelRatio());
      return;
    }
    interactionPixelRatioTimer = window.setTimeout(() => {
      interactionPixelRatioTimer = null;
      inInteractionQualityMode = false;
      applyPixelRatio(resolveBasePixelRatio());
    }, interactionPixelRatioHoldMs);
  };
  controls.addEventListener("start", () => {
    enterInteractionQualityMode();
  });
  controls.addEventListener("change", () => {
    if (!inInteractionQualityMode) {
      enterInteractionQualityMode();
    }
    scheduleBaseQualityRestore();
    requestImmediateRender();
  });
  controls.addEventListener("end", () => {
    scheduleBaseQualityRestore();
    requestImmediateRender();
  });
  const handleViewportMutation = (): void => {
    enterInteractionQualityMode();
    onResize();
    scheduleBaseQualityRestore();
    requestImmediateRender();
  };
  const handleWheelInteraction = (): void => {
    if (!inInteractionQualityMode) {
      enterInteractionQualityMode();
    }
    scheduleBaseQualityRestore();
    requestImmediateRender();
  };

  const enableEnvironmentMap = parseQueryBoolean(params.get("environmentMap"), true);
  const envMapPromise = !enableEnvironmentMap
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
      const pmremGenerator = new PMREMGenerator(renderer);
      pmremGenerator.compileCubemapShader();
      new HDRLoader().load(
        "environments/neutral.hdr",
        (texture) => {
          if (disposed) {
            texture.dispose?.();
            pmremGenerator.dispose();
            resolve();
            return;
          }
          environmentRenderTarget?.dispose?.();
          const hdrRenderTarget = pmremGenerator.fromEquirectangular(texture);
          environmentRenderTarget = hdrRenderTarget;
          texture.mapping = EquirectangularReflectionMapping;
          texture.needsUpdate = true;
          scene.environment = hdrRenderTarget.texture;
          texture.dispose?.();
          pmremGenerator.dispose();
          resolve();
        },
        undefined,
        () => {
          pmremGenerator.dispose();
          resolve();
        }
      );
    });

  document.body.appendChild(renderer.domElement);
  const handleDrop = (event: DragEvent): void => {
    void onDrop(event);
  };
  const handleDragOver = (event: DragEvent): void => {
    event.preventDefault();
  };
  const previousBodyOnKeyUp = document.body.onkeyup;
  const handleBodyKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") onTogglePause();
  };
  renderer.domElement.addEventListener("wheel", handleWheelInteraction, { passive: true });
  renderer.domElement.addEventListener("drop", handleDrop);
  renderer.domElement.addEventListener("dragover", handleDragOver);
  window.addEventListener("resize", handleViewportMutation);
  window.visualViewport?.addEventListener("resize", handleViewportMutation);
  window.visualViewport?.addEventListener("scroll", handleViewportMutation);
  document.body.onkeyup = handleBodyKeyUp;

  renderScene();
  void envMapPromise;
  return () => {
    disposed = true;
    if (interactionPixelRatioTimer !== null) {
      window.clearTimeout(interactionPixelRatioTimer);
      interactionPixelRatioTimer = null;
    }
    renderer.domElement.removeEventListener("wheel", handleWheelInteraction);
    renderer.domElement.removeEventListener("drop", handleDrop);
    renderer.domElement.removeEventListener("dragover", handleDragOver);
    window.removeEventListener("resize", handleViewportMutation);
    window.visualViewport?.removeEventListener("resize", handleViewportMutation);
    window.visualViewport?.removeEventListener("scroll", handleViewportMutation);
    document.body.onkeyup = previousBodyOnKeyUp;
    controls.dispose();
    environmentRenderTarget?.dispose?.();
    environmentRenderTarget?.texture?.dispose?.();
    if (scene.environment === environmentRenderTarget?.texture) {
      scene.environment = null;
    }
    renderer.domElement.remove();
    renderer.dispose();
  };
}

export function resizeViewerScene(): void {
  if (!window.camera || !window.renderer) return;
  window.camera.aspect = window.innerWidth / window.innerHeight;
  window.camera.updateProjectionMatrix();
  window.renderer.setSize(window.innerWidth, window.innerHeight);
  // Keep resize responsive when no continuous redraw is running.
  renderScene();
}

export function renderScene(): void {
  if (window.renderer && window.scene && window.camera) {
    const renderInterface = (window as any).renderInterface;
    const phaseProfilingEnabled = renderInterface?.isHydraPhaseInstrumentationEnabled?.() === true
      || HYDRA_PHASE_PROFILE_FROM_QUERY;
    if (!phaseProfilingEnabled) {
      window.renderer.render(window.scene, window.camera);
      return;
    }

    const now = (typeof performance !== "undefined" && typeof performance.now === "function")
      ? () => performance.now()
      : () => Date.now();
    const renderSeq = Number((window as any).__HYDRA_RENDER_SEQ__ || 0) + 1;
    (window as any).__HYDRA_RENDER_SEQ__ = renderSeq;
    const startMark = `hydra.phase.render.${renderSeq}.start`;
    const endMark = `hydra.phase.render.${renderSeq}.end`;
    try {
      performance.mark?.(startMark);
    } catch {}
    const renderStartedAt = now();
    window.renderer.render(window.scene, window.camera);
    const renderEndedAt = now();
    try {
      performance.mark?.(endMark);
      performance.measure?.(`hydra.phase.render.${renderSeq}`, startMark, endMark);
    } catch {}
    const renderBlockingMs = Math.max(0, renderEndedAt - renderStartedAt);
    renderInterface?.recordHydraRenderPhase?.(renderBlockingMs, "renderer.render");
  }
}
