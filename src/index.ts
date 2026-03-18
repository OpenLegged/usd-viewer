import { parseBooleanFlag, getSavedBooleanState, saveBooleanState, normalizeUsdPath } from "./viewer/path-utils.js";
import { applyMeshVisibilityFilters } from "./viewer/visibility.js";
import { UsdFsHelper } from "./viewer/usd-fs.js";
import { initializeViewerScene, renderScene, resizeViewerScene } from "./viewer/scene-bootstrap.js";
import { bindViewerUi } from "./viewer/ui-bindings.js";
import { loadUsdStage } from "./viewer/usd-loader.js";
import { handleUploadedFileList, loadVirtualFile } from "./viewer/upload-workflow.js";
import { runAnimationFrame } from "./viewer/animation-loop.js";
import { LinkRotationController } from "./viewer/link-rotation.js";
import { JointPanelController } from "./viewer/joint-panel.js";
import { LinkDynamicsController } from "./viewer/link-dynamics.js";
import { getRenderRobotMetadataSnapshot, warmupRenderRobotMetadataSnapshot } from "./viewer/robot-metadata.js";
import type { JointInfoSnapshot } from "./viewer/link-rotation.js";
import type { RenderRobotMetadataSnapshot } from "./viewer/robot-metadata.js";
import type {
  UsdViewerApi,
  ViewerClearOptions,
  ViewerInitOptions,
  ViewerLoadUsdFromPathOptions,
  ViewerRobotMetadataWarmupOptions,
  ViewerRoundtripExportResult,
  ViewerStateSnapshot,
  ViewerVisibilityState,
  ViewerWaitUntilReadyOptions,
} from "./embed/usd-viewer-api.js";

type UsdModule = any;
type HdWebSyncDriver = any;
type PrimitiveLoadSelection = {
  loadVisualPrims: boolean;
  loadCollisionPrims: boolean;
};
type LoadPassOptions = {
  maxVisualPrims?: number;
  markVisualPrimsLoaded?: boolean;
  silentUi?: boolean;
};
type GetUsdModuleFn = (options: Record<string, unknown>) => Promise<UsdModule>;

// Keep this cache key aligned with the bindings build generation so JS/WASM/data
// are always fetched from the same build.
const EMHD_BINDINGS_CACHE_KEY = "20260318a";
const withEmHdBindingsCacheKey = (resourcePath: string): string => {
  if (!resourcePath) return resourcePath;
  return resourcePath.includes("?")
    ? `${resourcePath}&v=${EMHD_BINDINGS_CACHE_KEY}`
    : `${resourcePath}?v=${EMHD_BINDINGS_CACHE_KEY}`;
};
const parseWarmupBooleanParam = (paramName: string, fallback: boolean): boolean => {
  try {
    const search = String(window?.location?.search || "");
    const params = new URLSearchParams(search);
    return parseBooleanFlag(params.get(paramName), fallback);
  } catch {
    return fallback;
  }
};
let emHdBindingsAssetWarmupStarted = false;
let emHdBindingsInlineAssetResolvePromise: Promise<{
  mainScriptUrlOrBlob: string;
  workerScriptUrlOrNull: string | null;
}> | null = null;
const fetchScriptAsBlobUrl = async (resourceUrl: string): Promise<string | null> => {
  if (typeof fetch !== "function") return null;
  if (typeof Blob === "undefined") return null;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    const response = await fetch(resourceUrl, {
      method: "GET",
      cache: "force-cache",
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const scriptText = await response.text();
    if (!scriptText) return null;
    return URL.createObjectURL(new Blob([scriptText], { type: "text/javascript" }));
  } catch {
    return null;
  }
};
const resolveEmHdBindingsInlineAssets = async (): Promise<{
  mainScriptUrlOrBlob: string;
  workerScriptUrlOrNull: string | null;
}> => {
  if (emHdBindingsInlineAssetResolvePromise) {
    return emHdBindingsInlineAssetResolvePromise;
  }
  emHdBindingsInlineAssetResolvePromise = (async () => {
    const defaultMainScriptUrl = withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.js");
    const defaultWorkerScriptUrl = withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.worker.js");
    // Blob inlining adds an extra fetch for emHdBindings scripts and can
    // noticeably increase cold-start latency. Keep it opt-in.
    const inlineMainScript = parseWarmupBooleanParam("inlineBindingsMainScript", false);
    const inlineWorkerScript = parseWarmupBooleanParam("inlineBindingsWorkerScript", false);

    const [mainScriptBlobUrl, workerScriptBlobUrl] = await Promise.all([
      inlineMainScript ? fetchScriptAsBlobUrl(defaultMainScriptUrl) : Promise.resolve(null),
      inlineWorkerScript ? fetchScriptAsBlobUrl(defaultWorkerScriptUrl) : Promise.resolve(null),
    ]);

    return {
      mainScriptUrlOrBlob: mainScriptBlobUrl || defaultMainScriptUrl,
      workerScriptUrlOrNull: workerScriptBlobUrl || null,
    };
  })().catch((error) => {
    emHdBindingsInlineAssetResolvePromise = null;
    throw error;
  });
  return emHdBindingsInlineAssetResolvePromise;
};
const warmupEmHdBindingsAssets = (): void => {
  if (emHdBindingsAssetWarmupStarted) return;
  emHdBindingsAssetWarmupStarted = true;
  if (typeof fetch !== "function") return;
  const enableWarmup = parseWarmupBooleanParam("warmupBindings", false);
  if (!enableWarmup) return;
  const inlineMainScript = parseWarmupBooleanParam("inlineBindingsMainScript", false);
  const inlineWorkerScript = parseWarmupBooleanParam("inlineBindingsWorkerScript", false);
  const includeWorkerScript = parseWarmupBooleanParam("warmupWorkerScript", true);
  const includeWasmPayloads = parseWarmupBooleanParam("warmupWasmPayloads", false);
  const warmupTargets: string[] = [];
  if (!inlineMainScript) {
    warmupTargets.push(withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.js"));
  }
  if (includeWorkerScript && !inlineWorkerScript) {
    warmupTargets.push(withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.worker.js"));
  }
  if (includeWasmPayloads) {
    warmupTargets.push(withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.wasm"));
    warmupTargets.push(withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.data"));
  }
  for (const warmupUrl of warmupTargets) {
    void fetch(warmupUrl, {
      method: "GET",
      cache: "force-cache",
      credentials: "same-origin",
    }).catch(() => {
      // Warmup is best-effort.
    });
  }
};
const resolveGetUsdModuleFn = (): GetUsdModuleFn | null => {
  const needleGetUsdModule = (globalThis as any)["NEEDLE:USD:GET"];
  if (typeof needleGetUsdModule === "function") {
    return needleGetUsdModule as GetUsdModuleFn;
  }
  const exportedGetUsdModule = (globalThis as any)["USD_WASM_MODULE"];
  return typeof exportedGetUsdModule === "function" ? (exportedGetUsdModule as GetUsdModuleFn) : null;
};
let emHdBindingsLoadPromise: Promise<GetUsdModuleFn> | null = null;
const loadEmHdBindingsGetUsdModuleFn = async (): Promise<GetUsdModuleFn> => {
  const cached = resolveGetUsdModuleFn();
  if (cached) return cached;

  if (!emHdBindingsLoadPromise) {
    warmupEmHdBindingsAssets();
    emHdBindingsLoadPromise = (async () => {
      await import(withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.js"));
      const loaded = resolveGetUsdModuleFn();
      if (!loaded) {
        throw new TypeError("NEEDLE:USD:GET is not available after loading emHdBindings.js");
      }
      return loaded;
    })().catch((error) => {
      emHdBindingsLoadPromise = null;
      throw error;
    });
  }

  return emHdBindingsLoadPromise;
};

const debugFileHandling = false;
const isMaterialBindingApiWarningMessage = (message: string): boolean => {
  const text = String(message || "");
  if (!text) return false;
  return text.includes("BindingsAtPrim") && text.includes("MaterialBindingAPI");
};
const isNonCriticalHydraWarningMessage = (message: string): boolean => {
  const text = String(message || "");
  if (!text) return false;
  return (
    text.includes("Selected hydra renderer doesn't support prim type")
    || text.includes("Unsupported interpolation type 'varying' for primvar st")
    || text.includes("has illegal material reference to prim")
  );
};

class ViewerApp {
  private readonly exposeGlobal: boolean;
  private readonly publicApi: UsdViewerApi;
  private USD: UsdModule | null = null;
  private driver: HdWebSyncDriver | null = null;
  private messageLog: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private params = new URL(document.location.href).searchParams;
  private filename = normalizeUsdPath(this.params.get("file") || "");
  private currentDisplayFilename = "";
  // Keep truth extraction opt-in; default robot loading now relies on the
  // one-shot scene snapshot rather than late JS-side metadata fallbacks.
  private readonly truthFirst = parseBooleanFlag(this.params.get("truthFirst"), false);
  private readonly wasmThreadCap = this.getWasmThreadCap();
  private readonly wasmThreadCount = this.getPreferredWasmThreadCount();
  private readonly prewarmWorkers = parseBooleanFlag(this.params.get("prewarmWorkers"), true);
  private readonly liveUsdDraw = parseBooleanFlag(this.params.get("liveUsdDraw"), false);
  private readonly maxCpuDraw = parseBooleanFlag(this.params.get("maxCpuDraw"), false);
  private readonly drawEveryNFrames = this.getDrawEveryNFrames();
  private readonly idleDrawThrottleStartMs = this.getDurationParamMs("idleDrawThrottleStartMs", 800, 0, 60_000);
  private readonly idleDrawEveryNFrames = this.getCountParam("idleDrawEveryNFrames", 3, 1, 120);
  private readonly drawBurstCount = this.getDrawBurstCount();
  private readonly drawBurstBudgetMs = this.getDrawBurstBudgetMs();
  private readonly frameDelayMs = this.getFrameDelayMs();
  private readonly jointPanelRetryDelayMs = this.getDurationParamMs("jointPanelRetryDelayMs", 120, 0, 60_000);
  // The strict one-shot path already blocks on metadata readiness; default to a
  // single synchronous panel build and keep the old retry loop opt-in.
  private readonly jointPanelRetryMaxAttempts = this.getCountParam("jointPanelRetryMaxAttempts", 0, 0, 240);
  private readonly idlePoseRefreshSuppressionAfterInputMs = this.getDurationParamMs("idlePoseRefreshSuppressionAfterInputMs", 450, 0, 10_000);
  private drawFrameCounter = 0;
  private lastUserInteractionAtMs = 0;

  private showLinkDynamics = false;
  private showVisualMeshes = true;
  private showCollisionMeshes = true;
  private loadedCollisionPrims = false;
  private loadedVisualPrims = false;
  private readStageMetadata = true;
  // Load both visual and collision prims in the primary pass so toggles do not
  // trigger a second-stage reload or any silent background completion work.

  private readonly linkDynamicsStorageKey = "usdViewer.showLinkDynamics";
  private readonly visualMeshesStorageKey = "usdViewer.showVisualMeshes";
  private readonly collisionMeshesStorageKey = "usdViewer.showCollisionMeshes";

  private timeout = 40;
  private endTimeCode = 0;
  private ready = false;
  private drawFailed = false;
  private stopped = false;
  private filePickerOpen = false;
  private meshFilterRefreshFrames = 0;
  private pendingMaterialBindingWarningCount = 0;
  private pendingMaterialBindingWarningTimer: number | null = null;
  private robotMetadataEventRefreshScheduled = false;
  private activeLoadToken = 0;
  private disposed = false;
  private uiCleanup: (() => void) | null = null;
  private sceneCleanup: (() => void) | null = null;
  private interactionCleanup: (() => void) | null = null;

  private readonly linkRotationController = new LinkRotationController();
  private readonly linkDynamicsController = new LinkDynamicsController();
  private readonly usdFsHelper = new UsdFsHelper(() => this.USD, debugFileHandling);
  private jointPanelController: JointPanelController | null = null;
  private readonly handleRobotMetadataReady = (): void => {
    if (this.robotMetadataEventRefreshScheduled) return;
    this.robotMetadataEventRefreshScheduled = true;
    void Promise.resolve().then(() => {
      this.robotMetadataEventRefreshScheduled = false;
      if (!this.ready) return;
      void this.jointPanelController?.refresh();
      if (this.showLinkDynamics) {
        void this.rebuildLinkDynamics();
      }
    });
  };

  constructor(options: ViewerInitOptions = {}) {
    this.exposeGlobal = options.exposeGlobal !== false;
    this.linkDynamicsController.setCurrentLinkFrameResolver((linkPath) => this.linkRotationController.getCurrentLinkFrameMatrix(linkPath));
    this.publicApi = this.createPublicApi();
  }

  getApi(): UsdViewerApi {
    return this.publicApi;
  }

  private createPublicApi(): UsdViewerApi {
    return {
      getState: () => this.getStateSnapshot(),
      waitUntilReady: (options) => this.waitUntilReady(options),
      loadUsdFromPath: (path, options) => this.loadUsdFromPath(path, options),
      loadFiles: (fileList) => this.loadFilesIntoViewer(fileList),
      clear: (options) => this.clearForApi(options),
      getVisibility: () => this.getVisibilityState(),
      setVisibility: (visibility) => this.setVisibilityState(visibility),
      getJointInfos: () => this.linkRotationController.getAllJointInfos(),
      setJointAngle: (linkPath, angleDeg) => this.linkRotationController.setJointAngleForLink(linkPath, angleDeg),
      getRobotMetadata: () => this.getRobotMetadataSnapshot(),
      warmupRobotMetadata: (options) => this.warmupRobotMetadata(options),
      exportRoundtripUsd: (options) => this.exportRoundtripUsdWithOptions(options),
      dispose: () => this.disposeApp(),
    };
  }

  private assertNotDisposed(action: string): void {
    if (!this.disposed) return;
    throw new Error(`ViewerApp has been disposed and cannot ${action}.`);
  }

  private getVisibilityState(): ViewerVisibilityState {
    return {
      visuals: this.showVisualMeshes,
      collisions: this.showCollisionMeshes,
      dynamics: this.showLinkDynamics,
    };
  }

  private getStateSnapshot(): ViewerStateSnapshot {
    return {
      file: this.filename,
      displayName: this.currentDisplayFilename,
      ready: this.ready,
      stopped: this.stopped,
      disposed: this.disposed,
      loadedVisualPrims: this.loadedVisualPrims,
      loadedCollisionPrims: this.loadedCollisionPrims,
      visibility: this.getVisibilityState(),
    };
  }

  private getRobotMetadataSnapshot(): RenderRobotMetadataSnapshot | null {
    const stageSourcePath = this.filename || window.renderInterface?.getStageSourcePath?.() || null;
    return getRenderRobotMetadataSnapshot(window.renderInterface, stageSourcePath);
  }

  private async warmupRobotMetadata(
    options: ViewerRobotMetadataWarmupOptions = {},
  ): Promise<RenderRobotMetadataSnapshot | null> {
    this.assertNotDisposed("warm up robot metadata");
    const stageSourcePath = this.filename || window.renderInterface?.getStageSourcePath?.() || null;
    return await warmupRenderRobotMetadataSnapshot(window.renderInterface, {
      stageSourcePath,
      ...options,
    });
  }

  private async waitUntilReady(
    options: ViewerWaitUntilReadyOptions = {},
  ): Promise<ViewerStateSnapshot> {
    this.assertNotDisposed("wait for readiness");
    const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 30_000));
    const pollIntervalMs = Math.max(10, Math.floor(options.pollIntervalMs ?? 32));
    const startMs = this.getNowMs();

    while (!this.disposed) {
      if (this.ready) return this.getStateSnapshot();
      if (!this.filename && !this.driver && !window.renderInterface) {
        return this.getStateSnapshot();
      }
      if (timeoutMs > 0 && this.getNowMs() - startMs >= timeoutMs) {
        throw new Error(`Viewer did not become ready within ${timeoutMs}ms.`);
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, pollIntervalMs));
    }

    throw new Error("Viewer was disposed before it became ready.");
  }

  private normalizeRequestedUsdPath(requestedFile: string): string {
    const normalizedPath = normalizeUsdPath(String(requestedFile || "").trim(), this.filename);
    return String(normalizedPath || "").split("?")[0];
  }

  private async loadUsdFromPath(
    requestedFile: string,
    options: ViewerLoadUsdFromPathOptions = {},
  ): Promise<ViewerStateSnapshot> {
    this.assertNotDisposed("load a USD path");
    const normalizedPath = this.normalizeRequestedUsdPath(requestedFile);
    if (!normalizedPath) {
      throw new Error("loadUsdFromPath requires a valid USD file path.");
    }
    const loadToken = this.createLoadToken();
    this.filename = normalizedPath;
    this.setFilenameText(this.filename);
    this.updateUrl();
    await this.clearStage({ clearVirtualFs: options.clearVirtualFs === true });
    if (!this.isLoadTokenActive(loadToken)) return this.getStateSnapshot();
    await this.loadUsdFile(this.filename, normalizedPath, loadToken);
    return this.getStateSnapshot();
  }

  private async loadFilesIntoViewer(fileList: FileList | File[]): Promise<ViewerStateSnapshot> {
    this.assertNotDisposed("load uploaded files");
    await this.handleUploadedFileList(fileList);
    if (this.ready || !this.filename) return this.getStateSnapshot();
    return await this.waitUntilReady();
  }

  private async clearForApi(options: ViewerClearOptions = {}): Promise<void> {
    this.assertNotDisposed("clear the stage");
    this.createLoadToken();
    await this.clearStage({
      clearVirtualFs: options.clearVirtualFs !== false,
    });
    this.filename = "";
    this.setFilenameText("");
    this.updateUrl();
    if (this.messageLog) {
      this.messageLog.textContent = "Stage cleared.";
    }
  }

  private async setVisibilityState(visibility: Partial<ViewerVisibilityState>): Promise<ViewerStateSnapshot> {
    this.assertNotDisposed("change visibility");
    if (typeof visibility.visuals === "boolean") {
      this.setShowVisualMeshes(visibility.visuals);
    }
    if (typeof visibility.collisions === "boolean") {
      this.setShowCollisionMeshes(visibility.collisions);
    }
    if (typeof visibility.dynamics === "boolean") {
      await this.setShowLinkDynamicsAsync(visibility.dynamics);
    }
    return this.getStateSnapshot();
  }

  private async exportRoundtripUsdWithOptions(
    options: Record<string, unknown> = {},
  ): Promise<ViewerRoundtripExportResult> {
    this.assertNotDisposed("export roundtrip USD");
    const renderInterface = (window as any).renderInterface;
    if (!renderInterface || typeof renderInterface.exportLoadedStageSnapshot !== "function") {
      return { ok: false, error: "export-unavailable" };
    }

    const result = await renderInterface.exportLoadedStageSnapshot({
      stageSourcePath: this.filename,
      persistToServer: true,
      overwrite: true,
      ...options,
    });
    return (result || { ok: false, error: "unknown-export-error" }) as ViewerRoundtripExportResult;
  }

  private async disposeApp(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopped = true;
    this.createLoadToken();
    window.removeEventListener("usd:robot-metadata-ready", this.handleRobotMetadataReady as EventListener);
    if (this.pendingMaterialBindingWarningTimer !== null) {
      window.clearTimeout(this.pendingMaterialBindingWarningTimer);
      this.pendingMaterialBindingWarningTimer = null;
    }
    try {
      await this.clearStage({ clearVirtualFs: true });
    } catch {}
    this.linkRotationController.clear();
    this.linkRotationController.setRenderInterface(null);
    this.linkRotationController.setStageSourcePath(null);
    this.linkDynamicsController.setStageSourcePath(null);
    this.jointPanelController?.dispose();
    this.jointPanelController = null;
    this.interactionCleanup?.();
    this.interactionCleanup = null;
    this.uiCleanup?.();
    this.uiCleanup = null;
    this.sceneCleanup?.();
    this.sceneCleanup = null;
    window.usdViewerApi = undefined;
    window.exportLoadedStageSnapshot = undefined;
    window.linkRotationController = undefined;
    window.linkDynamicsController = undefined;
    window.renderInterface = undefined;
    window.driver = undefined;
    window.usdStage = undefined;
    window.USD = undefined;
    window.camera = undefined;
    window.scene = undefined;
    window.renderer = undefined;
    window._controls = undefined;
    window.usdRoot = undefined;
    document.body.classList.remove("file-picker-open");
  }

  async run(): Promise<void> {
    this.assertNotDisposed("run");
    if (this.exposeGlobal) {
      window.usdViewerApi = this.publicApi;
    }
    this.messageLog = document.querySelector("#message-log");
    this.progressBar = document.querySelector("#loading-bar");
    this.progressLabel = document.querySelector("#loading-percent");
    this.showLinkDynamics = this.params.get("showDynamics") !== null
      ? parseBooleanFlag(this.params.get("showDynamics"), false)
      : getSavedBooleanState(this.linkDynamicsStorageKey, false);
    const hasFileParam = this.params.get("file") !== null;
    const hasShowVisualsParam = this.params.get("showVisuals") !== null;
    const hasShowCollisionsParam = this.params.get("showCollisions") !== null;

    this.showVisualMeshes = hasShowVisualsParam
      ? parseBooleanFlag(this.params.get("showVisuals"), true)
      // For direct `?file=...` links, default to visuals-on unless explicitly requested.
      : (hasFileParam ? true : getSavedBooleanState(this.visualMeshesStorageKey, true));
    this.showCollisionMeshes = hasShowCollisionsParam
      ? parseBooleanFlag(this.params.get("showCollisions"), false)
      // For direct `?file=...` links, default to visuals-only unless explicitly requested.
      : (hasFileParam ? false : getSavedBooleanState(this.collisionMeshesStorageKey, false));
    const allowEmptyMeshSelection = parseBooleanFlag(this.params.get("allowEmptySelection"), false);
    if (hasFileParam && !allowEmptyMeshSelection && !this.showVisualMeshes && !this.showCollisionMeshes) {
      // Self-heal stale/shared URLs that disabled both layers and looked like a load failure.
      this.showVisualMeshes = true;
    }
    this.loadedCollisionPrims = false;
    this.loadedVisualPrims = false;
    this.readStageMetadata = parseBooleanFlag(this.params.get("readStageMetadata"), this.truthFirst);

    this.setFilenameText(this.filename);
    if (this.messageLog) this.messageLog.textContent = "Initializing...";
    warmupEmHdBindingsAssets();
    const usdInitPromise = this.initUsd();
    if (this.filename) {
      this.setOneShotLoadingVisibility(true);
    }

    this.sceneCleanup = await initializeViewerScene({
      params: this.params,
      onDrop: (event) => this.dropHandler(event),
      onTogglePause: () => {
        this.stopped = !this.stopped;
      },
      onResize: () => this.onWindowResize(),
    });
    if (this.disposed) return;
    this.registerInteractionSignals();

    this.linkRotationController.setEnabled(true);
    this.linkRotationController.setRenderInterface(window.renderInterface || null);
    window.linkRotationController = this.linkRotationController;
    window.linkDynamicsController = this.linkDynamicsController;

    await usdInitPromise;
    if (this.disposed) return;
    this.bindUi();
    window.exportLoadedStageSnapshot = (options: Record<string, unknown> = {}) => this.exportRoundtripUsdWithOptions(options);
    this.initializeJointPanel();
    window.addEventListener("usd:robot-metadata-ready", this.handleRobotMetadataReady as EventListener);
    this.animate();

    if (!this.filename) return;
    const loadToken = this.createLoadToken();
    await this.clearStage({ clearVirtualFs: false });
    if (!this.isLoadTokenActive(loadToken)) return;
    const requestedPath = new URL(document.location.href).searchParams.get("file") || this.filename;
    const rootPath = normalizeUsdPath(requestedPath, this.filename).split("?")[0];
    await this.loadUsdFile(this.filename, rootPath, loadToken);
  }

  private setFilenameText(sourcePath: string): void {
    const fileName = String(sourcePath || "").split("/").pop()?.split("#")[0].split("?")[0] || "";
    const el = document.querySelector(".filename") as HTMLElement | null;
    if (el) el.innerText = fileName;
    this.currentDisplayFilename = fileName;
  }

  private updateUrl(): void {
    if (this.filename.includes("github.com")) {
      this.filename = this.filename.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
    }

    const currentUrl = new URL(window.location.href);
    if (this.filename) currentUrl.searchParams.set("file", this.filename);
    else currentUrl.searchParams.delete("file");

    this.showLinkDynamics ? currentUrl.searchParams.set("showDynamics", "1") : currentUrl.searchParams.delete("showDynamics");
    currentUrl.searchParams.set("showVisuals", this.showVisualMeshes ? "1" : "0");
    currentUrl.searchParams.set("showCollisions", this.showCollisionMeshes ? "1" : "0");
    currentUrl.searchParams.set("readStageMetadata", this.readStageMetadata ? "1" : "0");
    window.history.pushState({}, this.filename || "", currentUrl);
  }

  private createLoadToken(): number {
    this.activeLoadToken += 1;
    return this.activeLoadToken;
  }

  private isLoadTokenActive(loadToken: number): boolean {
    return loadToken === this.activeLoadToken;
  }

  private getDesiredPrimitiveSelection(): PrimitiveLoadSelection {
    return {
      loadVisualPrims: !!this.showVisualMeshes,
      loadCollisionPrims: !!this.showCollisionMeshes,
    };
  }

  private getPrimaryPrimitiveSelection(): PrimitiveLoadSelection {
    const desired = this.getDesiredPrimitiveSelection();
    if (desired.loadVisualPrims || desired.loadCollisionPrims) {
      return { loadVisualPrims: true, loadCollisionPrims: true };
    }
    return desired;
  }

  private disposeDriver(driverToDispose: HdWebSyncDriver | null): void {
    if (!driverToDispose) return;
    try {
      if (typeof driverToDispose.isDeleted === "function" && driverToDispose.isDeleted()) {
        return;
      }
    } catch {}

    try {
      if (typeof driverToDispose.delete === "function") {
        driverToDispose.delete();
      }
    } catch (error) {
      console.warn("Failed to dispose previous USD driver.", error);
    }

    try {
      this.USD?.flushPendingDeletes?.();
    } catch {}
  }

  private getWasmThreadCap(): number {
    const minThreads = 1;
    const absoluteMaxThreads = 128;
    const hardwareConcurrency = Number((navigator as any)?.hardwareConcurrency || 4);
    const requestedThreadsRaw = this.params.get("threads");
    const requestedThreads = Number(requestedThreadsRaw);
    const recommendedThreads = Math.max(2, Math.floor(hardwareConcurrency) - 2);
    const defaultCap = Math.max(
      minThreads,
      Math.min(absoluteMaxThreads, Math.min(8, recommendedThreads)),
    );
    const requestedCapRaw = this.params.get("threadCap");
    if (requestedCapRaw === null || requestedCapRaw === "") {
      if (Number.isFinite(requestedThreads) && requestedThreads > 0) {
        return Math.max(minThreads, Math.min(absoluteMaxThreads, Math.floor(requestedThreads)));
      }
      return defaultCap;
    }
    const requestedCap = Number(requestedCapRaw);
    if (!Number.isFinite(requestedCap)) return defaultCap;
    return Math.max(minThreads, Math.min(absoluteMaxThreads, Math.floor(requestedCap)));
  }

  private getPreferredWasmThreadCount(): number {
    const minThreads = 1;
    const maxThreads = this.wasmThreadCap;
    const hardwareConcurrency = Number((navigator as any)?.hardwareConcurrency || 4);
    const recommendedThreads = Math.max(2, Math.floor(hardwareConcurrency) - 2);
    const defaultThreads = Math.max(
      minThreads,
      Math.min(maxThreads, Math.min(8, recommendedThreads)),
    );
    const requestedRaw = this.params.get("threads");
    if (requestedRaw === null || requestedRaw === "") return defaultThreads;
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested)) return defaultThreads;
    return Math.max(minThreads, Math.min(maxThreads, Math.floor(requested)));
  }

  private getDrawEveryNFrames(): number {
    const requestedRaw = this.params.get("drawEveryNFrames");
    if (requestedRaw === null || requestedRaw === "") return 1;
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested)) return 1;
    return Math.max(1, Math.min(120, Math.floor(requested)));
  }

  private getDrawBurstCount(): number {
    const requestedRaw = this.params.get("drawBurst");
    const hardwareConcurrency = Number((navigator as any)?.hardwareConcurrency || 4);
    const defaultBurst = this.maxCpuDraw
      ? Math.max(1, Math.min(64, Math.floor(Math.max(this.wasmThreadCount, hardwareConcurrency))))
      : 1;
    if (requestedRaw === null || requestedRaw === "") return defaultBurst;
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested)) return defaultBurst;
    return Math.max(1, Math.min(128, Math.floor(requested)));
  }

  private getDrawBurstBudgetMs(): number {
    const requestedRaw = this.params.get("drawBurstBudgetMs");
    const defaultBudgetMs = this.maxCpuDraw ? 12 : 0;
    if (requestedRaw === null || requestedRaw === "") return defaultBudgetMs;
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested)) return defaultBudgetMs;
    return Math.max(0, Math.min(1000, requested));
  }

  private getFrameDelayMs(): number {
    const requestedRaw = this.params.get("frameDelayMs");
    const defaultDelayMs = 0;
    if (requestedRaw === null || requestedRaw === "") return defaultDelayMs;
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested)) return defaultDelayMs;
    return Math.max(0, Math.min(1000, requested));
  }

  private getDurationParamMs(paramName: string, fallbackMs: number, minMs: number, maxMs: number): number {
    const requestedRaw = this.params.get(paramName);
    if (requestedRaw === null || requestedRaw === "") return fallbackMs;
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested)) return fallbackMs;
    return Math.max(minMs, Math.min(maxMs, Math.floor(requested)));
  }

  private getCountParam(paramName: string, fallbackCount: number, minCount: number, maxCount: number): number {
    const requestedRaw = this.params.get(paramName);
    if (requestedRaw === null || requestedRaw === "") return fallbackCount;
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested)) return fallbackCount;
    return Math.max(minCount, Math.min(maxCount, Math.floor(requested)));
  }

  private getNowMs(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  private markUserInteraction(): void {
    this.lastUserInteractionAtMs = this.getNowMs();
  }

  private setOneShotLoadingVisibility(active: boolean): void {
    if (!document.body) return;
    if (active) {
      document.body.setAttribute("data-one-shot-loading", "1");
    } else {
      document.body.removeAttribute("data-one-shot-loading");
    }
  }

  private registerInteractionSignals(): void {
    this.interactionCleanup?.();
    this.markUserInteraction();
    const mark = () => this.markUserInteraction();

    const domElement = window.renderer?.domElement;
    domElement?.addEventListener("pointerdown", mark, { passive: true });
    domElement?.addEventListener("pointermove", mark, { passive: true });
    domElement?.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("keydown", mark, { passive: true });
    this.interactionCleanup = () => {
      domElement?.removeEventListener("pointerdown", mark);
      domElement?.removeEventListener("pointermove", mark);
      domElement?.removeEventListener("wheel", mark);
      window.removeEventListener("keydown", mark);
    };
  }

  private shouldRunUsdDraw(): boolean {
    if (!this.liveUsdDraw) return false;
    let effectiveDrawEveryNFrames = this.drawEveryNFrames;
    const hasTimelineAnimation = Number.isFinite(this.endTimeCode) && this.endTimeCode > 0;
    if (!hasTimelineAnimation) {
      const nowMs = this.getNowMs();
      const sinceLastInteractionMs = nowMs - this.lastUserInteractionAtMs;
      if (sinceLastInteractionMs >= this.idleDrawThrottleStartMs) {
        effectiveDrawEveryNFrames = Math.max(effectiveDrawEveryNFrames, this.idleDrawEveryNFrames);
      }
    }

    if (effectiveDrawEveryNFrames <= 1) return true;
    const shouldDraw = this.drawFrameCounter === 0;
    this.drawFrameCounter = (this.drawFrameCounter + 1) % effectiveDrawEveryNFrames;
    return shouldDraw;
  }

  private async initUsd(): Promise<void> {
    const profileLoad = parseBooleanFlag(this.params.get("profileLoad"), false);
    const initStartMs = this.getNowMs();
    if (this.messageLog) this.messageLog.textContent = `Loading USD Module (${this.wasmThreadCount} threads) – this can take a moment...`;
    this.updateUrl();
    const enableHydraPerfLogs = parseBooleanFlag(this.params.get("profileHydraSync"), false)
      || parseBooleanFlag(this.params.get("profileHydraMesh"), false)
      || parseBooleanFlag(this.params.get("debugHydraPerf"), false);
    const enableWasmStdout = parseBooleanFlag(this.params.get("enableWasmStdout"), false);
    const shouldSuppressWasmPerfLog = (message: string): boolean => {
      if (enableHydraPerfLogs) return false;
      return (
        message.includes("[SYNC TIMING]") ||
        message.includes("[SLOW TOPOLOGY]") ||
        message.includes("[SLOW POINTS]") ||
        message.includes("[THREAD BLOCK ANALYZE]") ||
        message.includes("[LAG DETECTED]")
      );
    };
    const getUsdModuleFn = await loadEmHdBindingsGetUsdModuleFn();
    const inlineAssetUrls = await resolveEmHdBindingsInlineAssets().catch(() => ({
      mainScriptUrlOrBlob: withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.js"),
      workerScriptUrlOrNull: null,
    }));
    this.USD = await getUsdModuleFn({
      mainScriptUrlOrBlob: inlineAssetUrls.mainScriptUrlOrBlob,
      locateFile: (file: string) => {
        const normalizedFile = String(file || "");
        if (
          inlineAssetUrls.workerScriptUrlOrNull
          && /(?:^|\/)emHdBindings\.worker\.js$/i.test(normalizedFile)
        ) {
          return inlineAssetUrls.workerScriptUrlOrNull;
        }
        return withEmHdBindingsCacheKey("/usd/bindings/" + normalizedFile);
      },
      PTHREAD_POOL_LIMIT: this.wasmThreadCap,
      PTHREAD_POOL_SIZE: this.wasmThreadCount,
      PTHREAD_NUM_CORES: this.wasmThreadCount,
      PTHREAD_POOL_PREWARM: this.prewarmWorkers,
      print: (...args: any[]) => {
        if (!enableWasmStdout && !enableHydraPerfLogs) return;
        const message = args.map((entry) => String(entry ?? "")).join(" ");
        if (shouldSuppressWasmPerfLog(message)) return;
        console.log(...args);
      },
      printErr: (...args: any[]) => {
        const message = args.map((entry) => String(entry ?? "")).join(" ");
        if (shouldSuppressWasmPerfLog(message)) return;
        if (isMaterialBindingApiWarningMessage(message)) {
          const handled = window.renderInterface?.handleMaterialBindingApiWarning?.({ message, level: "error" }) === true;
          if (handled) return;

          this.pendingMaterialBindingWarningCount += 1;
          if (this.pendingMaterialBindingWarningTimer === null) {
            this.pendingMaterialBindingWarningTimer = window.setTimeout(() => {
              const count = this.pendingMaterialBindingWarningCount;
              this.pendingMaterialBindingWarningCount = 0;
              this.pendingMaterialBindingWarningTimer = null;
              if (count > 0) {
                console.warn(`[ViewerApp] Suppressed ${count} early MaterialBindingAPI warning(s) before render interface was ready.`);
              }
            }, 0);
          }
          return;
        }
        if (isNonCriticalHydraWarningMessage(message)) {
          return;
        }

        console.error(...args);
      },
    });
    (window as any).USD = this.USD;
    if (profileLoad) {
      const elapsedMs = Math.round((this.getNowMs() - initStartMs) * 10) / 10;
      console.info(`[LOAD PROFILE][init-usd] module-ready in ${elapsedMs}ms`);
    }
    if (this.messageLog) this.messageLog.textContent = "Loading done";
  }

  private bindUi(): void {
    this.uiCleanup?.();
    this.uiCleanup = bindViewerUi({
      showLinkDynamics: this.showLinkDynamics,
      showVisualMeshes: this.showVisualMeshes,
      showCollisionMeshes: this.showCollisionMeshes,
      onToggleLinkDynamics: (enabled) => this.setShowLinkDynamicsAsync(enabled),
      onToggleVisualMeshes: (enabled) => this.setShowVisualMeshes(enabled),
      onToggleCollisionMeshes: (enabled) => this.setShowCollisionMeshes(enabled),
      onExportRoundtripUsd: async () => {
        await this.exportRoundtripUsd();
      },
      onUploadedFileList: async (files) => {
        await this.handleUploadedFileList(files);
      },
      onSelectUsdFilePath: async (requestedFile) => {
        await this.loadUsdFromPath(requestedFile, { clearVirtualFs: false });
      },
      onFilePickerStateChange: (isOpen) => this.setFilePickerState(isOpen),
    });
  }

  private initializeJointPanel(): void {
    this.jointPanelController = new JointPanelController({
      panel: document.getElementById("joint-panel"),
      header: document.getElementById("joint-panel-header"),
      list: document.getElementById("joint-panel-list"),
      requestJointInfos: async () => this.linkRotationController.getAllJointInfos(),
      setJointAngle: (linkPath, angleDeg) => this.linkRotationController.setJointAngleForLink(linkPath, angleDeg),
      onJointChanged: (jointInfo) => {
        this.markUserInteraction();
        if (this.messageLog) {
          const linkName = jointInfo.linkPath.split("/").pop() || jointInfo.linkPath;
          this.messageLog.textContent = `${linkName}: ${jointInfo.angleDeg.toFixed(1)}° (limit ${jointInfo.lowerLimitDeg.toFixed(1)}° ~ ${jointInfo.upperLimitDeg.toFixed(1)}°)`;
        }
      },
    });
    this.jointPanelController.initialize();
    this.jointPanelController.clear();
  }

  private async setShowLinkDynamicsAsync(enabled: boolean): Promise<void> {
    this.showLinkDynamics = !!enabled;
    saveBooleanState(this.linkDynamicsStorageKey, this.showLinkDynamics);
    await this.rebuildLinkDynamics();
    this.updateUrl();
  }

  private async exportRoundtripUsd(): Promise<void> {
    if (this.messageLog) this.messageLog.textContent = "Exporting roundtrip USD...";
    const result = await this.exportRoundtripUsdWithOptions({
      flattenStage: false,
    });
    if (!result?.ok) {
      const reason = String(result?.error || "unknown-export-error");
      if (this.messageLog) {
        this.messageLog.textContent = reason === "export-unavailable"
          ? "Roundtrip export is not available yet."
          : `Roundtrip export failed: ${reason}`;
      }
      return;
    }
    const exportedPath = String(result.filePath || result.outputVirtualPath || result.outputFileName || "").trim();
    if (this.messageLog) {
      this.messageLog.textContent = exportedPath
        ? `Roundtrip USD exported: ${exportedPath}`
        : "Roundtrip USD exported.";
    }
  }

  private setShowVisualMeshes(enabled: boolean): void {
    this.showVisualMeshes = !!enabled;
    saveBooleanState(this.visualMeshesStorageKey, this.showVisualMeshes);
    this.applyMeshFilters();
    this.requestMeshFilterRefresh(6);
    this.render();
    this.updateUrl();
  }

  private setShowCollisionMeshes(enabled: boolean): void {
    this.showCollisionMeshes = !!enabled;
    saveBooleanState(this.collisionMeshesStorageKey, this.showCollisionMeshes);
    this.applyMeshFilters();
    this.requestMeshFilterRefresh(6);
    this.render();
    this.updateUrl();
  }

  private applyMeshFilters(): void {
    applyMeshVisibilityFilters(window.renderInterface, this.showVisualMeshes, this.showCollisionMeshes);
  }

  private requestMeshFilterRefresh(frames = 8): void {
    this.meshFilterRefreshFrames = Math.max(this.meshFilterRefreshFrames, frames);
  }

  private rebuildLinkAxes(): void {
    // Link-axes overlay was removed in robot-focused mode.
  }

  private async rebuildLinkDynamics(): Promise<void> {
    if (!window.usdRoot) return;
    await this.linkDynamicsController.rebuild(window.usdRoot, window.renderInterface, this.showLinkDynamics);
    if (this.showLinkDynamics && window.renderInterface) {
      void this.linkDynamicsController.syncLinkDynamicsTransforms(window.renderInterface);
    }
    window.requestAnimationFrame(() => {
      this.render();
    });
  }

  private clearLinkDynamics(): void {
    if (!window.usdRoot) return;
    this.linkDynamicsController.clear(window.usdRoot);
  }

  private async clearStage(options: {
    preserveJointPanel?: boolean;
    clearVirtualFs?: boolean;
  } = {}): Promise<void> {
    const previousDriver = this.driver;
    const clearVirtualFs = options.clearVirtualFs !== false;
    this.robotMetadataEventRefreshScheduled = false;
    this.ready = false;
    this.drawFailed = false;
    this.timeout = 40;
    this.endTimeCode = 0;
    this.driver = null;
    this.loadedCollisionPrims = false;
    this.loadedVisualPrims = false;
    window.driver = null;
    window.usdStage = null;
    window.renderInterface = null;
    this.disposeDriver(previousDriver);

    this.clearLinkDynamics();
    this.linkRotationController.clear();
    this.linkRotationController.setStageSourcePath(null);
    this.linkRotationController.setRenderInterface(null);
    this.linkDynamicsController.setStageSourcePath(null);
    if (!options.preserveJointPanel) {
      this.jointPanelController?.clear();
    }
    if (window.usdRoot) {
      if (clearVirtualFs) {
        this.usdFsHelper.clearStageFiles(window.usdRoot);
      } else {
        window.usdRoot.clear?.();
      }
    }
  }

  private async performUsdLoadPass(
    displayName: string,
    pathToLoad: string,
    loadToken: number,
    selection: PrimitiveLoadSelection,
    loadPassLabel: string,
    options: LoadPassOptions = {},
  ): Promise<boolean> {
    if (!this.USD || !window.usdRoot) return false;
    if (!this.isLoadTokenActive(loadToken)) return false;

    this.setOneShotLoadingVisibility(true);
    let loadCompleted = false;
    try {
      this.ready = false;
      this.drawFailed = false;
      const loadParams = new URLSearchParams(this.params.toString());
      if (loadParams.get("threads") === null) {
        loadParams.set("threads", String(this.wasmThreadCount));
      }
      if (loadParams.get("prewarmWorkers") === null) {
        loadParams.set("prewarmWorkers", this.prewarmWorkers ? "1" : "0");
      }
      loadParams.set("fastLoad", "1");
      if (this.truthFirst && loadParams.get("stageMetadataBudgetMs") === null) {
        loadParams.set("stageMetadataBudgetMs", "2200");
      }
      loadParams.set("aggressiveInitialDraw", "1");
      if (loadParams.get("initialDrawYieldMs") === null) {
        loadParams.set("initialDrawYieldMs", this.truthFirst ? "1" : "4");
      }
      if (loadParams.get("enableProtoBlobFastPath") === null) {
        loadParams.set("enableProtoBlobFastPath", "1");
      }
      if (typeof options.maxVisualPrims === "number") {
        loadParams.set("maxVisualPrims", String(Math.max(0, Math.floor(options.maxVisualPrims))));
      }
      const loadState = await loadUsdStage({
        USD: this.USD,
        usdFsHelper: this.usdFsHelper,
        messageLog: this.messageLog,
        progressBar: this.progressBar,
        progressLabel: this.progressLabel,
        showLoadUi: !options.silentUi,
        readStageMetadata: this.readStageMetadata,
        loadCollisionPrims: selection.loadCollisionPrims,
        loadVisualPrims: selection.loadVisualPrims,
        loadPassLabel,
        params: loadParams,
        displayName,
        pathToLoad,
        isLoadActive: () => this.isLoadTokenActive(loadToken),
        debugFileHandling,
        onResolvedFilename: (normalizedPath, resolvedDisplayName) => {
          if (!this.isLoadTokenActive(loadToken)) return;
          this.filename = normalizedPath;
          this.updateUrl();
          this.setFilenameText(resolvedDisplayName || normalizedPath);
        },
        applyMeshFilters: () => this.applyMeshFilters(),
        rebuildLinkAxes: () => this.rebuildLinkAxes(),
        renderFrame: () => this.render(),
      });

      if (!this.isLoadTokenActive(loadToken)) {
        if (loadState?.driver) {
          this.disposeDriver(loadState.driver);
        }
        return false;
      }

      if (!loadState) return false;
      const readyAfterLoad = loadState.ready;
      this.driver = loadState.driver;
      this.ready = false;
      this.drawFailed = loadState.drawFailed;
      this.timeout = loadState.timeout;
      this.endTimeCode = loadState.endTimeCode;
      this.loadedCollisionPrims = !!loadState.loadedCollisionPrims;
      this.loadedVisualPrims = typeof options.markVisualPrimsLoaded === "boolean"
        ? options.markVisualPrimsLoaded
        : !!loadState.loadedVisualPrims;
      this.requestMeshFilterRefresh(20);
      this.linkRotationController.setStageSourcePath(loadState.normalizedPath || this.filename);
      this.linkRotationController.setRenderInterface(window.renderInterface || null);
      this.linkDynamicsController.setStageSourcePath(loadState.normalizedPath || this.filename);
      await this.refreshJointPanelSynchronously(loadToken);
      if (!this.isLoadTokenActive(loadToken)) return false;
      this.prewarmJointInteractionCaches();
      await this.prewarmInteractiveControllers(loadToken);
      if (!this.isLoadTokenActive(loadToken)) return false;
      await this.prepareLinkDynamicsForOneShot(loadToken);
      if (!this.isLoadTokenActive(loadToken)) return false;
      this.ready = readyAfterLoad;
      loadCompleted = true;
      return true;
    } finally {
      if (loadCompleted || this.isLoadTokenActive(loadToken)) {
        this.setOneShotLoadingVisibility(false);
      }
    }
  }

  private async prewarmInteractiveControllers(loadToken: number): Promise<void> {
    if (!this.isLoadTokenActive(loadToken)) return;
    if (!this.showLinkDynamics) return;
    if (!this.isLoadTokenActive(loadToken)) return;
    const renderInterface = window.renderInterface;
    if (!renderInterface) return;
    try {
      await this.linkDynamicsController.prewarmCatalogForInteractive(renderInterface);
    } catch {
      // Keep one-shot preload resilient; runtime rebuild path remains.
    }
  }

  private prewarmJointInteractionCaches(): void {
    try {
      this.linkRotationController.prewarmInteractivePoseCaches();
    } catch {
      // Keep one-shot preload resilient; runtime interaction keeps fallback paths.
    }
  }

  private async refreshJointPanelSynchronously(loadToken: number): Promise<void> {
    if (!this.jointPanelController) return;
    try {
      await this.jointPanelController.refresh();
      if (!this.isLoadTokenActive(loadToken)) return;
      if (this.jointPanelRetryMaxAttempts > 0 && this.isJointPanelMissingRows()) {
        await this.refreshJointPanelWithRetries(loadToken);
      }
    } catch (error) {
      console.warn("Failed to refresh joint panel in strict one-shot mode.", error);
    }
  }

  private async prepareLinkDynamicsForOneShot(loadToken: number): Promise<void> {
    if (!this.isLoadTokenActive(loadToken)) return;
    if (!this.showLinkDynamics) return;
    const renderInterface = window.renderInterface;
    if (!window.usdRoot || !renderInterface) return;
    await this.rebuildLinkDynamics();
  }

  private isJointPanelMissingRows(): boolean {
    const panel = document.getElementById("joint-panel");
    const list = document.getElementById("joint-panel-list");
    if (!panel || !list) return true;
    const rowCount = list.querySelectorAll(".joint-row").length;
    const visible = window.getComputedStyle(panel).display !== "none";
    return !visible || rowCount <= 0;
  }

  private async refreshJointPanelWithRetries(loadToken: number): Promise<void> {
    if (!this.jointPanelController) return;
    if (!this.isJointPanelMissingRows()) return;

    const maxAttempts = Math.max(0, Math.floor(this.jointPanelRetryMaxAttempts));
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      if (!this.isLoadTokenActive(loadToken)) return;
      if (!this.isJointPanelMissingRows()) return;

      try {
        await this.jointPanelController.refresh();
      } catch (error) {
        console.warn("Joint panel refresh attempt failed.", error);
      }
      if (!this.isLoadTokenActive(loadToken)) return;
      if (!this.isJointPanelMissingRows()) return;
      if (attempt >= maxAttempts) return;

      const retryDelayMs = Math.max(0, Math.floor(this.jointPanelRetryDelayMs));
      if (retryDelayMs > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelayMs));
      }
    }
  }

  private async loadUsdFile(displayName: string, pathToLoad: string, loadToken: number): Promise<void> {
    if (!this.USD || !window.usdRoot) return;
    if (!this.isLoadTokenActive(loadToken)) return;

    const primarySelection = this.getPrimaryPrimitiveSelection();
    const primaryPassLabel = `primary-v${Number(primarySelection.loadVisualPrims)}-c${Number(primarySelection.loadCollisionPrims)}`;
    const loadedPrimary = await this.performUsdLoadPass(
      displayName,
      pathToLoad,
      loadToken,
      primarySelection,
      primaryPassLabel,
      {},
    );
    if (!loadedPrimary) return;
    if (!this.isLoadTokenActive(loadToken)) return;
  }

  private async loadFile(file: File, isRootFile: boolean, fullPath: string, loadToken: number): Promise<void> {
    await loadVirtualFile({
      USD: this.USD,
      usdFsHelper: this.usdFsHelper,
      messageLog: this.messageLog,
      file,
      fullPath,
      isRootFile,
      onLoadRootUsdPath: async (rootVirtualPath) => {
        await this.loadUsdFile(rootVirtualPath, rootVirtualPath, loadToken);
      },
    });
  }

  private async handleUploadedFileList(fileList: FileList | File[]): Promise<void> {
    const loadToken = this.createLoadToken();
    await handleUploadedFileList({
      fileList,
      messageLog: this.messageLog,
      clearStage: async () => this.clearStage(),
      loadSingleFile: async (file, isRootFile, fullPath) => {
        await this.loadFile(file, isRootFile, fullPath, loadToken);
      },
    });
  }

  private async dropHandler(event: DragEvent): Promise<void> {
    event.preventDefault();
    if (!event.dataTransfer) return;
    const files = event.dataTransfer.files;
    if (files?.length) {
      await this.handleUploadedFileList(files);
    }
  }

  private onWindowResize(): void {
    resizeViewerScene();
  }

  private setFilePickerState(isOpen: boolean): void {
    this.filePickerOpen = !!isOpen;
    document.body.classList.toggle("file-picker-open", this.filePickerOpen);
  }

  private render(): void {
    renderScene();
  }

  private applyPostDrawSceneUpdates(): boolean {
    const renderInterface = window.renderInterface;
    if (!renderInterface) return false;

    let changed = false;
    // Re-apply interactive joint poses after each Hydra Draw() pass; otherwise
    // slider/pointer joint edits are overwritten by the next frame's stage sync.
    changed = this.linkRotationController.apply(renderInterface) === true || changed;

    if (this.showLinkDynamics) {
      changed = this.linkDynamicsController.syncLinkDynamicsTransforms(renderInterface) === true || changed;
    }

    return changed;
  }

  private async animate(): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.stopped) {
      requestAnimationFrame(() => this.animate());
      return;
    }

    if (this.filePickerOpen) {
      requestAnimationFrame(() => this.animate());
      return;
    }

    this.drawFailed = await runAnimationFrame({
      driver: this.driver,
      ready: this.ready,
      drawFailed: this.drawFailed,
      timeout: this.timeout,
      endTimeCode: this.endTimeCode,
      shouldDraw: () => this.shouldRunUsdDraw(),
      drawBurstCount: this.drawBurstCount,
      drawBurstBudgetMs: this.drawBurstBudgetMs,
      frameDelayMs: this.frameDelayMs,
      applyPostDrawTransforms: () => this.applyPostDrawSceneUpdates(),
      applyMeshFilters: () => this.applyMeshFilters(),
      shouldApplyMeshFilters: () => {
        if (this.meshFilterRefreshFrames <= 0) return false;
        this.meshFilterRefreshFrames--;
        return true;
      },
      renderFrame: () => this.render(),
    });
    if (!this.disposed) {
      requestAnimationFrame(() => this.animate());
    }
  }

}

export type {
  UsdViewerApi,
  ViewerInitOptions,
  ViewerRoundtripExportResult,
  ViewerStateSnapshot,
  ViewerVisibilityState,
} from "./embed/usd-viewer-api.js";

export async function init(options: ViewerInitOptions = {}): Promise<UsdViewerApi> {
  const app = new ViewerApp(options);
  await app.run();
  return app.getApi();
}
