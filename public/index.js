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
// Keep this cache key aligned with the bindings build generation so JS/WASM/data
// are always fetched from the same build.
const EMHD_BINDINGS_CACHE_KEY = "20260318a";
const withEmHdBindingsCacheKey = (resourcePath) => {
    if (!resourcePath)
        return resourcePath;
    return resourcePath.includes("?")
        ? `${resourcePath}&v=${EMHD_BINDINGS_CACHE_KEY}`
        : `${resourcePath}?v=${EMHD_BINDINGS_CACHE_KEY}`;
};
const parseWarmupBooleanParam = (paramName, fallback) => {
    try {
        const search = String(window?.location?.search || "");
        const params = new URLSearchParams(search);
        return parseBooleanFlag(params.get(paramName), fallback);
    }
    catch {
        return fallback;
    }
};
let emHdBindingsAssetWarmupStarted = false;
let emHdBindingsInlineAssetResolvePromise = null;
const fetchScriptAsBlobUrl = async (resourceUrl) => {
    if (typeof fetch !== "function")
        return null;
    if (typeof Blob === "undefined")
        return null;
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function")
        return null;
    try {
        const response = await fetch(resourceUrl, {
            method: "GET",
            cache: "force-cache",
            credentials: "same-origin",
        });
        if (!response.ok)
            return null;
        const scriptText = await response.text();
        if (!scriptText)
            return null;
        return URL.createObjectURL(new Blob([scriptText], { type: "text/javascript" }));
    }
    catch {
        return null;
    }
};
const resolveEmHdBindingsInlineAssets = async () => {
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
const warmupEmHdBindingsAssets = () => {
    if (emHdBindingsAssetWarmupStarted)
        return;
    emHdBindingsAssetWarmupStarted = true;
    if (typeof fetch !== "function")
        return;
    const enableWarmup = parseWarmupBooleanParam("warmupBindings", false);
    if (!enableWarmup)
        return;
    const inlineMainScript = parseWarmupBooleanParam("inlineBindingsMainScript", false);
    const inlineWorkerScript = parseWarmupBooleanParam("inlineBindingsWorkerScript", false);
    const includeWorkerScript = parseWarmupBooleanParam("warmupWorkerScript", true);
    const includeWasmPayloads = parseWarmupBooleanParam("warmupWasmPayloads", false);
    const warmupTargets = [];
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
const resolveGetUsdModuleFn = () => {
    const needleGetUsdModule = globalThis["NEEDLE:USD:GET"];
    if (typeof needleGetUsdModule === "function") {
        return needleGetUsdModule;
    }
    const exportedGetUsdModule = globalThis["USD_WASM_MODULE"];
    return typeof exportedGetUsdModule === "function" ? exportedGetUsdModule : null;
};
let emHdBindingsLoadPromise = null;
const loadEmHdBindingsGetUsdModuleFn = async () => {
    const cached = resolveGetUsdModuleFn();
    if (cached)
        return cached;
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
const isMaterialBindingApiWarningMessage = (message) => {
    const text = String(message || "");
    if (!text)
        return false;
    return text.includes("BindingsAtPrim") && text.includes("MaterialBindingAPI");
};
const isNonCriticalHydraWarningMessage = (message) => {
    const text = String(message || "");
    if (!text)
        return false;
    return (text.includes("Selected hydra renderer doesn't support prim type")
        || text.includes("Unsupported interpolation type 'varying' for primvar st")
        || text.includes("has illegal material reference to prim"));
};
class ViewerApp {
    constructor(options = {}) {
        this.USD = null;
        this.driver = null;
        this.messageLog = null;
        this.progressBar = null;
        this.progressLabel = null;
        this.params = new URL(document.location.href).searchParams;
        this.filename = normalizeUsdPath(this.params.get("file") || "");
        this.currentDisplayFilename = "";
        // Keep truth extraction opt-in; default robot loading now relies on the
        // one-shot scene snapshot rather than late JS-side metadata fallbacks.
        this.truthFirst = parseBooleanFlag(this.params.get("truthFirst"), false);
        this.wasmThreadCap = this.getWasmThreadCap();
        this.wasmThreadCount = this.getPreferredWasmThreadCount();
        this.prewarmWorkers = parseBooleanFlag(this.params.get("prewarmWorkers"), true);
        this.liveUsdDraw = parseBooleanFlag(this.params.get("liveUsdDraw"), false);
        this.maxCpuDraw = parseBooleanFlag(this.params.get("maxCpuDraw"), false);
        this.drawEveryNFrames = this.getDrawEveryNFrames();
        this.idleDrawThrottleStartMs = this.getDurationParamMs("idleDrawThrottleStartMs", 800, 0, 60000);
        this.idleDrawEveryNFrames = this.getCountParam("idleDrawEveryNFrames", 3, 1, 120);
        this.drawBurstCount = this.getDrawBurstCount();
        this.drawBurstBudgetMs = this.getDrawBurstBudgetMs();
        this.frameDelayMs = this.getFrameDelayMs();
        this.jointPanelRetryDelayMs = this.getDurationParamMs("jointPanelRetryDelayMs", 120, 0, 60000);
        // The strict one-shot path already blocks on metadata readiness; default to a
        // single synchronous panel build and keep the old retry loop opt-in.
        this.jointPanelRetryMaxAttempts = this.getCountParam("jointPanelRetryMaxAttempts", 0, 0, 240);
        this.idlePoseRefreshSuppressionAfterInputMs = this.getDurationParamMs("idlePoseRefreshSuppressionAfterInputMs", 450, 0, 10000);
        this.drawFrameCounter = 0;
        this.lastUserInteractionAtMs = 0;
        this.showLinkDynamics = false;
        this.showVisualMeshes = true;
        this.showCollisionMeshes = true;
        this.loadedCollisionPrims = false;
        this.loadedVisualPrims = false;
        this.readStageMetadata = true;
        // Load both visual and collision prims in the primary pass so toggles do not
        // trigger a second-stage reload or any silent background completion work.
        this.linkDynamicsStorageKey = "usdViewer.showLinkDynamics";
        this.visualMeshesStorageKey = "usdViewer.showVisualMeshes";
        this.collisionMeshesStorageKey = "usdViewer.showCollisionMeshes";
        this.timeout = 40;
        this.endTimeCode = 0;
        this.ready = false;
        this.drawFailed = false;
        this.stopped = false;
        this.filePickerOpen = false;
        this.meshFilterRefreshFrames = 0;
        this.pendingMaterialBindingWarningCount = 0;
        this.pendingMaterialBindingWarningTimer = null;
        this.robotMetadataEventRefreshScheduled = false;
        this.activeLoadToken = 0;
        this.disposed = false;
        this.uiCleanup = null;
        this.sceneCleanup = null;
        this.interactionCleanup = null;
        this.linkRotationController = new LinkRotationController();
        this.linkDynamicsController = new LinkDynamicsController();
        this.usdFsHelper = new UsdFsHelper(() => this.USD, debugFileHandling);
        this.jointPanelController = null;
        this.handleRobotMetadataReady = () => {
            if (this.robotMetadataEventRefreshScheduled)
                return;
            this.robotMetadataEventRefreshScheduled = true;
            void Promise.resolve().then(() => {
                this.robotMetadataEventRefreshScheduled = false;
                if (!this.ready)
                    return;
                void this.jointPanelController?.refresh();
                if (this.showLinkDynamics) {
                    void this.rebuildLinkDynamics();
                }
            });
        };
        this.exposeGlobal = options.exposeGlobal !== false;
        this.linkDynamicsController.setCurrentLinkFrameResolver((linkPath) => this.linkRotationController.getCurrentLinkFrameMatrix(linkPath));
        this.publicApi = this.createPublicApi();
    }
    getApi() {
        return this.publicApi;
    }
    createPublicApi() {
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
    assertNotDisposed(action) {
        if (!this.disposed)
            return;
        throw new Error(`ViewerApp has been disposed and cannot ${action}.`);
    }
    getVisibilityState() {
        return {
            visuals: this.showVisualMeshes,
            collisions: this.showCollisionMeshes,
            dynamics: this.showLinkDynamics,
        };
    }
    getStateSnapshot() {
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
    getRobotMetadataSnapshot() {
        const stageSourcePath = this.filename || window.renderInterface?.getStageSourcePath?.() || null;
        return getRenderRobotMetadataSnapshot(window.renderInterface, stageSourcePath);
    }
    async warmupRobotMetadata(options = {}) {
        this.assertNotDisposed("warm up robot metadata");
        const stageSourcePath = this.filename || window.renderInterface?.getStageSourcePath?.() || null;
        return await warmupRenderRobotMetadataSnapshot(window.renderInterface, {
            stageSourcePath,
            ...options,
        });
    }
    async waitUntilReady(options = {}) {
        this.assertNotDisposed("wait for readiness");
        const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 30000));
        const pollIntervalMs = Math.max(10, Math.floor(options.pollIntervalMs ?? 32));
        const startMs = this.getNowMs();
        while (!this.disposed) {
            if (this.ready)
                return this.getStateSnapshot();
            if (!this.filename && !this.driver && !window.renderInterface) {
                return this.getStateSnapshot();
            }
            if (timeoutMs > 0 && this.getNowMs() - startMs >= timeoutMs) {
                throw new Error(`Viewer did not become ready within ${timeoutMs}ms.`);
            }
            await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs));
        }
        throw new Error("Viewer was disposed before it became ready.");
    }
    normalizeRequestedUsdPath(requestedFile) {
        const normalizedPath = normalizeUsdPath(String(requestedFile || "").trim(), this.filename);
        return String(normalizedPath || "").split("?")[0];
    }
    async loadUsdFromPath(requestedFile, options = {}) {
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
        if (!this.isLoadTokenActive(loadToken))
            return this.getStateSnapshot();
        await this.loadUsdFile(this.filename, normalizedPath, loadToken);
        return this.getStateSnapshot();
    }
    async loadFilesIntoViewer(fileList) {
        this.assertNotDisposed("load uploaded files");
        await this.handleUploadedFileList(fileList);
        if (this.ready || !this.filename)
            return this.getStateSnapshot();
        return await this.waitUntilReady();
    }
    async clearForApi(options = {}) {
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
    async setVisibilityState(visibility) {
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
    async exportRoundtripUsdWithOptions(options = {}) {
        this.assertNotDisposed("export roundtrip USD");
        const renderInterface = window.renderInterface;
        if (!renderInterface || typeof renderInterface.exportLoadedStageSnapshot !== "function") {
            return { ok: false, error: "export-unavailable" };
        }
        const result = await renderInterface.exportLoadedStageSnapshot({
            stageSourcePath: this.filename,
            persistToServer: true,
            overwrite: true,
            ...options,
        });
        return (result || { ok: false, error: "unknown-export-error" });
    }
    async disposeApp() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.stopped = true;
        this.createLoadToken();
        window.removeEventListener("usd:robot-metadata-ready", this.handleRobotMetadataReady);
        if (this.pendingMaterialBindingWarningTimer !== null) {
            window.clearTimeout(this.pendingMaterialBindingWarningTimer);
            this.pendingMaterialBindingWarningTimer = null;
        }
        try {
            await this.clearStage({ clearVirtualFs: true });
        }
        catch { }
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
    async run() {
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
        if (this.messageLog)
            this.messageLog.textContent = "Initializing...";
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
        if (this.disposed)
            return;
        this.registerInteractionSignals();
        this.linkRotationController.setEnabled(true);
        this.linkRotationController.setRenderInterface(window.renderInterface || null);
        window.linkRotationController = this.linkRotationController;
        window.linkDynamicsController = this.linkDynamicsController;
        await usdInitPromise;
        if (this.disposed)
            return;
        this.bindUi();
        window.exportLoadedStageSnapshot = (options = {}) => this.exportRoundtripUsdWithOptions(options);
        this.initializeJointPanel();
        window.addEventListener("usd:robot-metadata-ready", this.handleRobotMetadataReady);
        this.animate();
        if (!this.filename)
            return;
        const loadToken = this.createLoadToken();
        await this.clearStage({ clearVirtualFs: false });
        if (!this.isLoadTokenActive(loadToken))
            return;
        const requestedPath = new URL(document.location.href).searchParams.get("file") || this.filename;
        const rootPath = normalizeUsdPath(requestedPath, this.filename).split("?")[0];
        await this.loadUsdFile(this.filename, rootPath, loadToken);
    }
    setFilenameText(sourcePath) {
        const fileName = String(sourcePath || "").split("/").pop()?.split("#")[0].split("?")[0] || "";
        const el = document.querySelector(".filename");
        if (el)
            el.innerText = fileName;
        this.currentDisplayFilename = fileName;
    }
    updateUrl() {
        if (this.filename.includes("github.com")) {
            this.filename = this.filename.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
        }
        const currentUrl = new URL(window.location.href);
        if (this.filename)
            currentUrl.searchParams.set("file", this.filename);
        else
            currentUrl.searchParams.delete("file");
        this.showLinkDynamics ? currentUrl.searchParams.set("showDynamics", "1") : currentUrl.searchParams.delete("showDynamics");
        currentUrl.searchParams.set("showVisuals", this.showVisualMeshes ? "1" : "0");
        currentUrl.searchParams.set("showCollisions", this.showCollisionMeshes ? "1" : "0");
        currentUrl.searchParams.set("readStageMetadata", this.readStageMetadata ? "1" : "0");
        window.history.pushState({}, this.filename || "", currentUrl);
    }
    createLoadToken() {
        this.activeLoadToken += 1;
        return this.activeLoadToken;
    }
    isLoadTokenActive(loadToken) {
        return loadToken === this.activeLoadToken;
    }
    getDesiredPrimitiveSelection() {
        return {
            loadVisualPrims: !!this.showVisualMeshes,
            loadCollisionPrims: !!this.showCollisionMeshes,
        };
    }
    getPrimaryPrimitiveSelection() {
        const desired = this.getDesiredPrimitiveSelection();
        if (desired.loadVisualPrims || desired.loadCollisionPrims) {
            return { loadVisualPrims: true, loadCollisionPrims: true };
        }
        return desired;
    }
    disposeDriver(driverToDispose) {
        if (!driverToDispose)
            return;
        try {
            if (typeof driverToDispose.isDeleted === "function" && driverToDispose.isDeleted()) {
                return;
            }
        }
        catch { }
        try {
            if (typeof driverToDispose.delete === "function") {
                driverToDispose.delete();
            }
        }
        catch (error) {
            console.warn("Failed to dispose previous USD driver.", error);
        }
        try {
            this.USD?.flushPendingDeletes?.();
        }
        catch { }
    }
    getWasmThreadCap() {
        const minThreads = 1;
        const absoluteMaxThreads = 128;
        const hardwareConcurrency = Number(navigator?.hardwareConcurrency || 4);
        const requestedThreadsRaw = this.params.get("threads");
        const requestedThreads = Number(requestedThreadsRaw);
        const recommendedThreads = Math.max(2, Math.floor(hardwareConcurrency) - 2);
        const defaultCap = Math.max(minThreads, Math.min(absoluteMaxThreads, Math.min(8, recommendedThreads)));
        const requestedCapRaw = this.params.get("threadCap");
        if (requestedCapRaw === null || requestedCapRaw === "") {
            if (Number.isFinite(requestedThreads) && requestedThreads > 0) {
                return Math.max(minThreads, Math.min(absoluteMaxThreads, Math.floor(requestedThreads)));
            }
            return defaultCap;
        }
        const requestedCap = Number(requestedCapRaw);
        if (!Number.isFinite(requestedCap))
            return defaultCap;
        return Math.max(minThreads, Math.min(absoluteMaxThreads, Math.floor(requestedCap)));
    }
    getPreferredWasmThreadCount() {
        const minThreads = 1;
        const maxThreads = this.wasmThreadCap;
        const hardwareConcurrency = Number(navigator?.hardwareConcurrency || 4);
        const recommendedThreads = Math.max(2, Math.floor(hardwareConcurrency) - 2);
        const defaultThreads = Math.max(minThreads, Math.min(maxThreads, Math.min(8, recommendedThreads)));
        const requestedRaw = this.params.get("threads");
        if (requestedRaw === null || requestedRaw === "")
            return defaultThreads;
        const requested = Number(requestedRaw);
        if (!Number.isFinite(requested))
            return defaultThreads;
        return Math.max(minThreads, Math.min(maxThreads, Math.floor(requested)));
    }
    getDrawEveryNFrames() {
        const requestedRaw = this.params.get("drawEveryNFrames");
        if (requestedRaw === null || requestedRaw === "")
            return 1;
        const requested = Number(requestedRaw);
        if (!Number.isFinite(requested))
            return 1;
        return Math.max(1, Math.min(120, Math.floor(requested)));
    }
    getDrawBurstCount() {
        const requestedRaw = this.params.get("drawBurst");
        const hardwareConcurrency = Number(navigator?.hardwareConcurrency || 4);
        const defaultBurst = this.maxCpuDraw
            ? Math.max(1, Math.min(64, Math.floor(Math.max(this.wasmThreadCount, hardwareConcurrency))))
            : 1;
        if (requestedRaw === null || requestedRaw === "")
            return defaultBurst;
        const requested = Number(requestedRaw);
        if (!Number.isFinite(requested))
            return defaultBurst;
        return Math.max(1, Math.min(128, Math.floor(requested)));
    }
    getDrawBurstBudgetMs() {
        const requestedRaw = this.params.get("drawBurstBudgetMs");
        const defaultBudgetMs = this.maxCpuDraw ? 12 : 0;
        if (requestedRaw === null || requestedRaw === "")
            return defaultBudgetMs;
        const requested = Number(requestedRaw);
        if (!Number.isFinite(requested))
            return defaultBudgetMs;
        return Math.max(0, Math.min(1000, requested));
    }
    getFrameDelayMs() {
        const requestedRaw = this.params.get("frameDelayMs");
        const defaultDelayMs = 0;
        if (requestedRaw === null || requestedRaw === "")
            return defaultDelayMs;
        const requested = Number(requestedRaw);
        if (!Number.isFinite(requested))
            return defaultDelayMs;
        return Math.max(0, Math.min(1000, requested));
    }
    getDurationParamMs(paramName, fallbackMs, minMs, maxMs) {
        const requestedRaw = this.params.get(paramName);
        if (requestedRaw === null || requestedRaw === "")
            return fallbackMs;
        const requested = Number(requestedRaw);
        if (!Number.isFinite(requested))
            return fallbackMs;
        return Math.max(minMs, Math.min(maxMs, Math.floor(requested)));
    }
    getCountParam(paramName, fallbackCount, minCount, maxCount) {
        const requestedRaw = this.params.get(paramName);
        if (requestedRaw === null || requestedRaw === "")
            return fallbackCount;
        const requested = Number(requestedRaw);
        if (!Number.isFinite(requested))
            return fallbackCount;
        return Math.max(minCount, Math.min(maxCount, Math.floor(requested)));
    }
    getNowMs() {
        if (typeof performance !== "undefined" && typeof performance.now === "function") {
            return performance.now();
        }
        return Date.now();
    }
    markUserInteraction() {
        this.lastUserInteractionAtMs = this.getNowMs();
    }
    setOneShotLoadingVisibility(active) {
        if (!document.body)
            return;
        if (active) {
            document.body.setAttribute("data-one-shot-loading", "1");
        }
        else {
            document.body.removeAttribute("data-one-shot-loading");
        }
    }
    registerInteractionSignals() {
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
    shouldRunUsdDraw() {
        if (!this.liveUsdDraw)
            return false;
        let effectiveDrawEveryNFrames = this.drawEveryNFrames;
        const hasTimelineAnimation = Number.isFinite(this.endTimeCode) && this.endTimeCode > 0;
        if (!hasTimelineAnimation) {
            const nowMs = this.getNowMs();
            const sinceLastInteractionMs = nowMs - this.lastUserInteractionAtMs;
            if (sinceLastInteractionMs >= this.idleDrawThrottleStartMs) {
                effectiveDrawEveryNFrames = Math.max(effectiveDrawEveryNFrames, this.idleDrawEveryNFrames);
            }
        }
        if (effectiveDrawEveryNFrames <= 1)
            return true;
        const shouldDraw = this.drawFrameCounter === 0;
        this.drawFrameCounter = (this.drawFrameCounter + 1) % effectiveDrawEveryNFrames;
        return shouldDraw;
    }
    async initUsd() {
        const profileLoad = parseBooleanFlag(this.params.get("profileLoad"), false);
        const initStartMs = this.getNowMs();
        if (this.messageLog)
            this.messageLog.textContent = `Loading USD Module (${this.wasmThreadCount} threads) – this can take a moment...`;
        this.updateUrl();
        const enableHydraPerfLogs = parseBooleanFlag(this.params.get("profileHydraSync"), false)
            || parseBooleanFlag(this.params.get("profileHydraMesh"), false)
            || parseBooleanFlag(this.params.get("debugHydraPerf"), false);
        const enableWasmStdout = parseBooleanFlag(this.params.get("enableWasmStdout"), false);
        const shouldSuppressWasmPerfLog = (message) => {
            if (enableHydraPerfLogs)
                return false;
            return (message.includes("[SYNC TIMING]") ||
                message.includes("[SLOW TOPOLOGY]") ||
                message.includes("[SLOW POINTS]") ||
                message.includes("[THREAD BLOCK ANALYZE]") ||
                message.includes("[LAG DETECTED]"));
        };
        const getUsdModuleFn = await loadEmHdBindingsGetUsdModuleFn();
        const inlineAssetUrls = await resolveEmHdBindingsInlineAssets().catch(() => ({
            mainScriptUrlOrBlob: withEmHdBindingsCacheKey("/usd/bindings/emHdBindings.js"),
            workerScriptUrlOrNull: null,
        }));
        this.USD = await getUsdModuleFn({
            mainScriptUrlOrBlob: inlineAssetUrls.mainScriptUrlOrBlob,
            locateFile: (file) => {
                const normalizedFile = String(file || "");
                if (inlineAssetUrls.workerScriptUrlOrNull
                    && /(?:^|\/)emHdBindings\.worker\.js$/i.test(normalizedFile)) {
                    return inlineAssetUrls.workerScriptUrlOrNull;
                }
                return withEmHdBindingsCacheKey("/usd/bindings/" + normalizedFile);
            },
            PTHREAD_POOL_LIMIT: this.wasmThreadCap,
            PTHREAD_POOL_SIZE: this.wasmThreadCount,
            PTHREAD_NUM_CORES: this.wasmThreadCount,
            PTHREAD_POOL_PREWARM: this.prewarmWorkers,
            print: (...args) => {
                if (!enableWasmStdout && !enableHydraPerfLogs)
                    return;
                const message = args.map((entry) => String(entry ?? "")).join(" ");
                if (shouldSuppressWasmPerfLog(message))
                    return;
                console.log(...args);
            },
            printErr: (...args) => {
                const message = args.map((entry) => String(entry ?? "")).join(" ");
                if (shouldSuppressWasmPerfLog(message))
                    return;
                if (isMaterialBindingApiWarningMessage(message)) {
                    const handled = window.renderInterface?.handleMaterialBindingApiWarning?.({ message, level: "error" }) === true;
                    if (handled)
                        return;
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
        window.USD = this.USD;
        if (profileLoad) {
            const elapsedMs = Math.round((this.getNowMs() - initStartMs) * 10) / 10;
            console.info(`[LOAD PROFILE][init-usd] module-ready in ${elapsedMs}ms`);
        }
        if (this.messageLog)
            this.messageLog.textContent = "Loading done";
    }
    bindUi() {
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
    initializeJointPanel() {
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
    async setShowLinkDynamicsAsync(enabled) {
        this.showLinkDynamics = !!enabled;
        saveBooleanState(this.linkDynamicsStorageKey, this.showLinkDynamics);
        await this.rebuildLinkDynamics();
        this.updateUrl();
    }
    async exportRoundtripUsd() {
        if (this.messageLog)
            this.messageLog.textContent = "Exporting roundtrip USD...";
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
    setShowVisualMeshes(enabled) {
        this.showVisualMeshes = !!enabled;
        saveBooleanState(this.visualMeshesStorageKey, this.showVisualMeshes);
        this.applyMeshFilters();
        this.requestMeshFilterRefresh(6);
        this.render();
        this.updateUrl();
    }
    setShowCollisionMeshes(enabled) {
        this.showCollisionMeshes = !!enabled;
        saveBooleanState(this.collisionMeshesStorageKey, this.showCollisionMeshes);
        this.applyMeshFilters();
        this.requestMeshFilterRefresh(6);
        this.render();
        this.updateUrl();
    }
    applyMeshFilters() {
        applyMeshVisibilityFilters(window.renderInterface, this.showVisualMeshes, this.showCollisionMeshes);
    }
    requestMeshFilterRefresh(frames = 8) {
        this.meshFilterRefreshFrames = Math.max(this.meshFilterRefreshFrames, frames);
    }
    rebuildLinkAxes() {
        // Link-axes overlay was removed in robot-focused mode.
    }
    async rebuildLinkDynamics() {
        if (!window.usdRoot)
            return;
        await this.linkDynamicsController.rebuild(window.usdRoot, window.renderInterface, this.showLinkDynamics);
        if (this.showLinkDynamics && window.renderInterface) {
            void this.linkDynamicsController.syncLinkDynamicsTransforms(window.renderInterface);
        }
        window.requestAnimationFrame(() => {
            this.render();
        });
    }
    clearLinkDynamics() {
        if (!window.usdRoot)
            return;
        this.linkDynamicsController.clear(window.usdRoot);
    }
    async clearStage(options = {}) {
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
            }
            else {
                window.usdRoot.clear?.();
            }
        }
    }
    async performUsdLoadPass(displayName, pathToLoad, loadToken, selection, loadPassLabel, options = {}) {
        if (!this.USD || !window.usdRoot)
            return false;
        if (!this.isLoadTokenActive(loadToken))
            return false;
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
                    if (!this.isLoadTokenActive(loadToken))
                        return;
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
            if (!loadState)
                return false;
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
            if (!this.isLoadTokenActive(loadToken))
                return false;
            this.prewarmJointInteractionCaches();
            await this.prewarmInteractiveControllers(loadToken);
            if (!this.isLoadTokenActive(loadToken))
                return false;
            await this.prepareLinkDynamicsForOneShot(loadToken);
            if (!this.isLoadTokenActive(loadToken))
                return false;
            this.ready = readyAfterLoad;
            loadCompleted = true;
            return true;
        }
        finally {
            if (loadCompleted || this.isLoadTokenActive(loadToken)) {
                this.setOneShotLoadingVisibility(false);
            }
        }
    }
    async prewarmInteractiveControllers(loadToken) {
        if (!this.isLoadTokenActive(loadToken))
            return;
        if (!this.showLinkDynamics)
            return;
        if (!this.isLoadTokenActive(loadToken))
            return;
        const renderInterface = window.renderInterface;
        if (!renderInterface)
            return;
        try {
            await this.linkDynamicsController.prewarmCatalogForInteractive(renderInterface);
        }
        catch {
            // Keep one-shot preload resilient; runtime rebuild path remains.
        }
    }
    prewarmJointInteractionCaches() {
        try {
            this.linkRotationController.prewarmInteractivePoseCaches();
        }
        catch {
            // Keep one-shot preload resilient; runtime interaction keeps fallback paths.
        }
    }
    async refreshJointPanelSynchronously(loadToken) {
        if (!this.jointPanelController)
            return;
        try {
            await this.jointPanelController.refresh();
            if (!this.isLoadTokenActive(loadToken))
                return;
            if (this.jointPanelRetryMaxAttempts > 0 && this.isJointPanelMissingRows()) {
                await this.refreshJointPanelWithRetries(loadToken);
            }
        }
        catch (error) {
            console.warn("Failed to refresh joint panel in strict one-shot mode.", error);
        }
    }
    async prepareLinkDynamicsForOneShot(loadToken) {
        if (!this.isLoadTokenActive(loadToken))
            return;
        if (!this.showLinkDynamics)
            return;
        const renderInterface = window.renderInterface;
        if (!window.usdRoot || !renderInterface)
            return;
        await this.rebuildLinkDynamics();
    }
    isJointPanelMissingRows() {
        const panel = document.getElementById("joint-panel");
        const list = document.getElementById("joint-panel-list");
        if (!panel || !list)
            return true;
        const rowCount = list.querySelectorAll(".joint-row").length;
        const visible = window.getComputedStyle(panel).display !== "none";
        return !visible || rowCount <= 0;
    }
    async refreshJointPanelWithRetries(loadToken) {
        if (!this.jointPanelController)
            return;
        if (!this.isJointPanelMissingRows())
            return;
        const maxAttempts = Math.max(0, Math.floor(this.jointPanelRetryMaxAttempts));
        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
            if (!this.isLoadTokenActive(loadToken))
                return;
            if (!this.isJointPanelMissingRows())
                return;
            try {
                await this.jointPanelController.refresh();
            }
            catch (error) {
                console.warn("Joint panel refresh attempt failed.", error);
            }
            if (!this.isLoadTokenActive(loadToken))
                return;
            if (!this.isJointPanelMissingRows())
                return;
            if (attempt >= maxAttempts)
                return;
            const retryDelayMs = Math.max(0, Math.floor(this.jointPanelRetryDelayMs));
            if (retryDelayMs > 0) {
                await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
            }
        }
    }
    async loadUsdFile(displayName, pathToLoad, loadToken) {
        if (!this.USD || !window.usdRoot)
            return;
        if (!this.isLoadTokenActive(loadToken))
            return;
        const primarySelection = this.getPrimaryPrimitiveSelection();
        const primaryPassLabel = `primary-v${Number(primarySelection.loadVisualPrims)}-c${Number(primarySelection.loadCollisionPrims)}`;
        const loadedPrimary = await this.performUsdLoadPass(displayName, pathToLoad, loadToken, primarySelection, primaryPassLabel, {});
        if (!loadedPrimary)
            return;
        if (!this.isLoadTokenActive(loadToken))
            return;
    }
    async loadFile(file, isRootFile, fullPath, loadToken) {
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
    async handleUploadedFileList(fileList) {
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
    async dropHandler(event) {
        event.preventDefault();
        if (!event.dataTransfer)
            return;
        const files = event.dataTransfer.files;
        if (files?.length) {
            await this.handleUploadedFileList(files);
        }
    }
    onWindowResize() {
        resizeViewerScene();
    }
    setFilePickerState(isOpen) {
        this.filePickerOpen = !!isOpen;
        document.body.classList.toggle("file-picker-open", this.filePickerOpen);
    }
    render() {
        renderScene();
    }
    applyPostDrawSceneUpdates() {
        const renderInterface = window.renderInterface;
        if (!renderInterface)
            return false;
        let changed = false;
        // Re-apply interactive joint poses after each Hydra Draw() pass; otherwise
        // slider/pointer joint edits are overwritten by the next frame's stage sync.
        changed = this.linkRotationController.apply(renderInterface) === true || changed;
        if (this.showLinkDynamics) {
            changed = this.linkDynamicsController.syncLinkDynamicsTransforms(renderInterface) === true || changed;
        }
        return changed;
    }
    async animate() {
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
                if (this.meshFilterRefreshFrames <= 0)
                    return false;
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
export async function init(options = {}) {
    const app = new ViewerApp(options);
    await app.run();
    return app.getApi();
}
