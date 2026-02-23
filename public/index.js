import { Group, Mesh, MeshStandardMaterial, BoxGeometry, SphereGeometry, CylinderGeometry } from "three";
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
// Keep this cache key aligned with the bindings build generation so JS/WASM/data
// are always fetched from the same build.
const EMHD_BINDINGS_CACHE_KEY = "20260223c";
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
    constructor() {
        this.USD = null;
        this.driver = null;
        this.messageLog = null;
        this.progressBar = null;
        this.progressLabel = null;
        this.params = new URL(document.location.href).searchParams;
        this.filename = normalizeUsdPath(this.params.get("file") || "");
        this.currentDisplayFilename = "";
        // Keep first paint responsive by default; metadata truth alignment is loaded
        // asynchronously after the primary mesh pass.
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
        this.initialJointPanelRefreshDelayMs = this.getDurationParamMs("initialJointPanelRefreshDelayMs", 0, 0, 60000);
        this.jointPanelRetryDelayMs = this.getDurationParamMs("jointPanelRetryDelayMs", 120, 0, 60000);
        this.jointPanelRetryMaxAttempts = this.getCountParam("jointPanelRetryMaxAttempts", 40, 0, 240);
        this.backgroundUpgradeDelayMs = this.getDurationParamMs("backgroundUpgradeDelayMs", 2200, 0, 60000);
        this.backgroundUpgradeQuietMs = this.getDurationParamMs("backgroundUpgradeQuietMs", 700, 0, 10000);
        this.backgroundUpgradeMaxWaitMs = this.getDurationParamMs("backgroundUpgradeMaxWaitMs", 8000, 0, 120000);
        this.postLoadUiRefreshDelayMs = this.getDurationParamMs("postLoadUiRefreshDelayMs", 1200, 0, 60000);
        this.postLoadUiRefreshQuietMs = this.getDurationParamMs("postLoadUiRefreshQuietMs", 500, 0, 10000);
        this.postLoadUiRefreshMaxWaitMs = this.getDurationParamMs("postLoadUiRefreshMaxWaitMs", 4000, 0, 120000);
        this.idlePoseRefreshSuppressionAfterInputMs = this.getDurationParamMs("idlePoseRefreshSuppressionAfterInputMs", 450, 0, 10000);
        this.pauseAnimationForInitialUi = parseBooleanFlag(this.params.get("pauseAnimationForInitialUi"), false);
        this.pauseAnimationForInitialUiMaxMs = this.getDurationParamMs("pauseAnimationForInitialUiMaxMs", 12000, 0, 120000);
        this.drawFrameCounter = 0;
        this.lastUserInteractionAtMs = 0;
        this.showLinkDynamics = false;
        this.showVisualMeshes = true;
        this.showCollisionMeshes = true;
        this.loadedCollisionPrims = false;
        this.loadedVisualPrims = false;
        this.readStageMetadata = true;
        this.preferredPrimaryLoadKind = "visual";
        this.visualProxyFirst = parseBooleanFlag(this.params.get("visualProxyFirst"), true);
        this.twoPassSelectionUpgrade = parseBooleanFlag(this.params.get("twoPassSelectionUpgrade"), true);
        this.forceFullPrimPreload = parseBooleanFlag(this.params.get("forceFullPrimPreload"), false);
        // Default to full preload so visual/collision toggles do not trigger stage reloads.
        this.preloadHiddenPrims = parseBooleanFlag(this.params.get("preloadHiddenPrims"), true);
        this.silentBackgroundUpgradeUi = parseBooleanFlag(this.params.get("silentBackgroundUpgradeUi"), true);
        this.throttleBackgroundUpgrade = parseBooleanFlag(this.params.get("throttleBackgroundUpgrade"), true);
        this.stageReloadProxyRoot = null;
        this.linkDynamicsStorageKey = "usdViewer.showLinkDynamics";
        this.visualMeshesStorageKey = "usdViewer.showVisualMeshes";
        this.collisionMeshesStorageKey = "usdViewer.showCollisionMeshes";
        this.timeout = 40;
        this.endTimeCode = 0;
        this.ready = false;
        this.drawFailed = false;
        this.stopped = false;
        this.blockAnimationForInitialUi = false;
        this.blockAnimationResumeTimer = null;
        this.filePickerOpen = false;
        this.meshFilterRefreshFrames = 0;
        this.pendingMaterialBindingWarningCount = 0;
        this.pendingMaterialBindingWarningTimer = null;
        this.robotMetadataEventRefreshScheduled = false;
        this.activeLoadToken = 0;
        this.asyncUpgradeGeneration = 0;
        this.backgroundUpgradePending = false;
        this.backgroundUpgradeActive = false;
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
    }
    async run() {
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
        const loadPriorityParam = String(this.params.get("loadPriority") || "").trim().toLowerCase();
        if (loadPriorityParam === "collision") {
            this.preferredPrimaryLoadKind = "collision";
        }
        else if (loadPriorityParam === "visual") {
            this.preferredPrimaryLoadKind = "visual";
        }
        else if (this.showCollisionMeshes && !this.showVisualMeshes) {
            this.preferredPrimaryLoadKind = "collision";
        }
        else {
            this.preferredPrimaryLoadKind = "visual";
        }
        this.loadedCollisionPrims = false;
        this.loadedVisualPrims = false;
        this.readStageMetadata = parseBooleanFlag(this.params.get("readStageMetadata"), this.truthFirst);
        this.setFilenameText(this.filename);
        if (this.messageLog)
            this.messageLog.textContent = "Initializing...";
        warmupEmHdBindingsAssets();
        const usdInitPromise = this.initUsd();
        await initializeViewerScene({
            params: this.params,
            onDrop: (event) => this.dropHandler(event),
            onTogglePause: () => {
                this.stopped = !this.stopped;
            },
            onResize: () => this.onWindowResize(),
        });
        this.registerInteractionSignals();
        this.linkRotationController.setEnabled(true);
        this.linkRotationController.setRenderInterface(window.renderInterface || null);
        window.linkRotationController = this.linkRotationController;
        window.linkDynamicsController = this.linkDynamicsController;
        await usdInitPromise;
        this.bindUi();
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
        this.asyncUpgradeGeneration += 1;
        this.backgroundUpgradePending = false;
        this.backgroundUpgradeActive = false;
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
    shouldPreloadAllPrims() {
        return this.preloadHiddenPrims || this.forceFullPrimPreload;
    }
    getBackgroundUpgradeTargetSelection() {
        const desired = this.getDesiredPrimitiveSelection();
        if (!this.shouldPreloadAllPrims())
            return desired;
        if (!desired.loadVisualPrims && !desired.loadCollisionPrims)
            return desired;
        return {
            loadVisualPrims: true,
            loadCollisionPrims: true,
        };
    }
    shouldUseVisualProxyFirst() {
        if (this.shouldPreloadAllPrims())
            return false;
        if (!this.visualProxyFirst)
            return false;
        if (!this.showVisualMeshes)
            return false;
        if (this.showCollisionMeshes)
            return false;
        return true;
    }
    getPrimaryPrimitiveSelection() {
        if (this.shouldUseVisualProxyFirst()) {
            return { loadVisualPrims: true, loadCollisionPrims: false };
        }
        const desired = this.getDesiredPrimitiveSelection();
        if (this.shouldPreloadAllPrims() && (desired.loadVisualPrims || desired.loadCollisionPrims)) {
            return { loadVisualPrims: true, loadCollisionPrims: true };
        }
        if (desired.loadVisualPrims && desired.loadCollisionPrims && !this.twoPassSelectionUpgrade) {
            return desired;
        }
        if (!(desired.loadVisualPrims && desired.loadCollisionPrims)) {
            return desired;
        }
        if (this.preferredPrimaryLoadKind === "collision") {
            return { loadVisualPrims: false, loadCollisionPrims: true };
        }
        return { loadVisualPrims: true, loadCollisionPrims: false };
    }
    getMissingPrimitiveLabels(targetSelection) {
        const missing = [];
        if (targetSelection.loadVisualPrims && !this.loadedVisualPrims) {
            missing.push("visual meshes");
        }
        if (targetSelection.loadCollisionPrims && !this.loadedCollisionPrims) {
            missing.push("collision meshes");
        }
        return missing;
    }
    needsSelectionUpgrade(targetSelection) {
        return this.getMissingPrimitiveLabels(targetSelection).length > 0;
    }
    describeMissingPrimitiveSelection(targetSelection) {
        const missing = this.getMissingPrimitiveLabels(targetSelection);
        if (missing.length <= 0)
            return "remaining data";
        if (missing.length === 1)
            return missing[0];
        return `${missing[0]} and ${missing[1]}`;
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
    clearStageReloadProxy() {
        if (!this.stageReloadProxyRoot)
            return;
        try {
            if (typeof this.stageReloadProxyRoot.removeFromParent === "function") {
                this.stageReloadProxyRoot.removeFromParent();
            }
            else if (window.scene?.remove) {
                window.scene.remove(this.stageReloadProxyRoot);
            }
        }
        catch { }
        this.stageReloadProxyRoot = null;
    }
    showVisualLoadingProxy(pathToLoad) {
        if (!this.shouldUseVisualProxyFirst())
            return;
        const scene = window.scene;
        if (!scene)
            return;
        this.clearStageReloadProxy();
        const proxyRoot = new Group();
        proxyRoot.name = "USD Loading Proxy";
        const material = new MeshStandardMaterial({
            color: 0x8f99a8,
            roughness: 0.82,
            metalness: 0.04,
            transparent: true,
            opacity: 0.82,
        });
        const addBox = (w, h, d, x, y, z) => {
            const mesh = new Mesh(new BoxGeometry(w, h, d), material);
            mesh.position.set(x, y, z);
            proxyRoot.add(mesh);
        };
        const addCylinder = (radius, height, x, y, z, rx = 0) => {
            const mesh = new Mesh(new CylinderGeometry(radius, radius, height, 12), material);
            mesh.position.set(x, y, z);
            mesh.rotation.x = rx;
            proxyRoot.add(mesh);
        };
        const addSphere = (radius, x, y, z) => {
            const mesh = new Mesh(new SphereGeometry(radius, 12, 10), material);
            mesh.position.set(x, y, z);
            proxyRoot.add(mesh);
        };
        const normalized = String(pathToLoad || "").toLowerCase();
        if (normalized.includes("/h1/") || normalized.includes("h1_2") || normalized.includes("/g1/")) {
            addBox(0.34, 0.72, 0.22, 0, 0.36, 0);
            addSphere(0.13, 0, 0.84, 0);
            addCylinder(0.055, 0.46, -0.24, 0.48, 0, Math.PI / 2);
            addCylinder(0.055, 0.46, 0.24, 0.48, 0, Math.PI / 2);
            addCylinder(0.07, 0.88, -0.1, -0.08, 0);
            addCylinder(0.07, 0.88, 0.1, -0.08, 0);
            addBox(0.26, 0.12, 0.12, 0, -0.52, 0);
        }
        else if (normalized.includes("go2") || normalized.includes("b2")) {
            addBox(0.52, 0.2, 0.26, 0, 0.28, 0);
            addSphere(0.1, 0.18, 0.33, 0);
            addCylinder(0.045, 0.34, -0.2, 0.08, 0.13);
            addCylinder(0.045, 0.34, 0.2, 0.08, 0.13);
            addCylinder(0.045, 0.34, -0.2, 0.08, -0.13);
            addCylinder(0.045, 0.34, 0.2, 0.08, -0.13);
        }
        else {
            addBox(0.44, 0.76, 0.28, 0, 0.4, 0);
            addSphere(0.14, 0, 0.9, 0);
            addCylinder(0.06, 0.9, -0.12, -0.05, 0);
            addCylinder(0.06, 0.9, 0.12, -0.05, 0);
        }
        scene.add(proxyRoot);
        this.stageReloadProxyRoot = proxyRoot;
        console.info("[ViewerApp] Showing visual loading proxy.");
    }
    captureStageReloadProxy() {
        const scene = window.scene;
        const usdRoot = window.usdRoot;
        if (!scene || !usdRoot)
            return false;
        if (!usdRoot.children || usdRoot.children.length <= 0)
            return false;
        this.clearStageReloadProxy();
        try {
            const proxyClone = usdRoot.clone(true);
            proxyClone.name = "USD Loading Proxy";
            proxyClone.traverse?.((node) => {
                if (!node)
                    return;
                if (typeof node.updateWorldMatrix === "function") {
                    node.updateWorldMatrix(false, false);
                }
            });
            scene.add(proxyClone);
            this.stageReloadProxyRoot = proxyClone;
            return true;
        }
        catch (error) {
            console.warn("Failed to capture stage reload proxy.", error);
            this.stageReloadProxyRoot = null;
            return false;
        }
    }
    getWasmThreadCap() {
        const minThreads = 1;
        const absoluteMaxThreads = 128;
        const hardwareConcurrency = Number(navigator?.hardwareConcurrency || 4);
        const requestedThreadsRaw = this.params.get("threads");
        const requestedThreads = Number(requestedThreadsRaw);
        const reservedMainThread = Math.max(1, Math.floor(hardwareConcurrency) - 2);
        const minRecommendedThreads = hardwareConcurrency >= 4 ? 2 : 1;
        const recommendedThreads = Math.max(minRecommendedThreads, Math.floor(reservedMainThread * 0.9));
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
        const reservedMainThread = Math.max(1, Math.floor(hardwareConcurrency) - 2);
        // Keep at least one spare core for UI + browser scheduling.
        const minRecommendedThreads = hardwareConcurrency >= 4 ? 2 : 1;
        const recommendedThreads = Math.max(minRecommendedThreads, Math.floor(reservedMainThread * 0.9));
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
    registerInteractionSignals() {
        this.markUserInteraction();
        const mark = () => this.markUserInteraction();
        const domElement = window.renderer?.domElement;
        domElement?.addEventListener("pointerdown", mark, { passive: true });
        domElement?.addEventListener("pointermove", mark, { passive: true });
        domElement?.addEventListener("wheel", mark, { passive: true });
        window.addEventListener("keydown", mark, { passive: true });
    }
    async waitForInteractionQuietPeriod(quietMs, maxWaitMs) {
        const normalizedQuietMs = Math.max(0, Math.floor(quietMs));
        const normalizedMaxWaitMs = Math.max(0, Math.floor(maxWaitMs));
        if (normalizedQuietMs <= 0)
            return;
        const startedAt = this.getNowMs();
        for (;;) {
            const now = this.getNowMs();
            const sinceLastInteraction = now - this.lastUserInteractionAtMs;
            if (sinceLastInteraction >= normalizedQuietMs)
                return;
            if (normalizedMaxWaitMs > 0 && (now - startedAt) >= normalizedMaxWaitMs)
                return;
            await new Promise((resolve) => window.setTimeout(resolve, 80));
        }
    }
    async waitForBrowserIdleSlice(timeoutMs) {
        const normalizedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
        const requestIdle = window.requestIdleCallback;
        if (typeof requestIdle !== "function") {
            await new Promise((resolve) => window.setTimeout(resolve, Math.min(120, normalizedTimeoutMs)));
            return;
        }
        await new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done)
                    return;
                done = true;
                resolve();
            };
            try {
                requestIdle(() => finish(), { timeout: normalizedTimeoutMs });
            }
            catch {
                finish();
                return;
            }
            window.setTimeout(finish, normalizedTimeoutMs + 40);
        });
    }
    async waitForDeferredHeavyWork(delayMs, quietMs, maxWaitMs) {
        const normalizedDelayMs = Math.max(0, Math.floor(delayMs));
        if (normalizedDelayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, normalizedDelayMs));
        }
        await this.waitForInteractionQuietPeriod(quietMs, maxWaitMs);
        await this.waitForBrowserIdleSlice(Math.max(200, Math.min(maxWaitMs, 2000)));
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
        bindViewerUi({
            showLinkDynamics: this.showLinkDynamics,
            showVisualMeshes: this.showVisualMeshes,
            showCollisionMeshes: this.showCollisionMeshes,
            onToggleLinkDynamics: (enabled) => this.setShowLinkDynamics(enabled),
            onToggleVisualMeshes: (enabled) => this.setShowVisualMeshes(enabled),
            onToggleCollisionMeshes: (enabled) => this.setShowCollisionMeshes(enabled),
            onUploadedFileList: async (files) => {
                await this.handleUploadedFileList(files);
            },
            onSelectUsdFilePath: async (requestedFile) => {
                const loadToken = this.createLoadToken();
                this.filename = requestedFile;
                this.setFilenameText(this.filename);
                await this.clearStage({ clearVirtualFs: false });
                if (!this.isLoadTokenActive(loadToken))
                    return;
                await this.loadUsdFile(this.filename, this.filename, loadToken);
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
                if (!this.showLinkDynamics || !window.renderInterface)
                    return;
                const changed = this.linkDynamicsController.syncLinkDynamicsTransforms(window.renderInterface);
                if (changed) {
                    this.render();
                }
            },
        });
        this.jointPanelController.initialize();
        this.jointPanelController.clear();
    }
    setShowLinkDynamics(enabled) {
        this.showLinkDynamics = !!enabled;
        saveBooleanState(this.linkDynamicsStorageKey, this.showLinkDynamics);
        void this.rebuildLinkDynamics();
        this.updateUrl();
    }
    reloadStageForSelectionUpgrade(reasonText) {
        if (!this.filename)
            return;
        const loadToken = this.createLoadToken();
        if (this.messageLog)
            this.messageLog.textContent = `Reloading stage to include ${reasonText}...`;
        void (async () => {
            await this.clearStage({ clearVirtualFs: false });
            if (!this.isLoadTokenActive(loadToken))
                return;
            await this.loadUsdFile(this.filename, this.filename, loadToken);
        })();
    }
    setShowVisualMeshes(enabled) {
        this.showVisualMeshes = !!enabled;
        this.clearStageReloadProxy();
        if (this.showVisualMeshes) {
            this.preferredPrimaryLoadKind = "visual";
        }
        saveBooleanState(this.visualMeshesStorageKey, this.showVisualMeshes);
        if (this.showVisualMeshes && !this.loadedVisualPrims && this.driver) {
            if (this.shouldPreloadAllPrims()) {
                if (!this.silentBackgroundUpgradeUi && this.messageLog) {
                    this.messageLog.textContent = "Visual meshes are still loading in background...";
                }
                this.scheduleBackgroundSelectionUpgrade(this.filename, this.filename, this.activeLoadToken);
            }
            else {
                this.reloadStageForSelectionUpgrade("visual meshes");
                this.updateUrl();
                return;
            }
        }
        this.applyMeshFilters();
        this.requestMeshFilterRefresh(6);
        this.updateUrl();
    }
    setShowCollisionMeshes(enabled) {
        const wasEnabled = this.showCollisionMeshes;
        this.showCollisionMeshes = !!enabled;
        this.clearStageReloadProxy();
        if (this.showCollisionMeshes) {
            this.preferredPrimaryLoadKind = "collision";
        }
        saveBooleanState(this.collisionMeshesStorageKey, this.showCollisionMeshes);
        if (!wasEnabled && this.showCollisionMeshes && !this.loadedCollisionPrims && this.driver) {
            if (this.shouldPreloadAllPrims()) {
                if (!this.silentBackgroundUpgradeUi && this.messageLog) {
                    this.messageLog.textContent = "Collision meshes are still loading in background...";
                }
                this.scheduleBackgroundSelectionUpgrade(this.filename, this.filename, this.activeLoadToken);
            }
            else {
                this.reloadStageForSelectionUpgrade("collision meshes");
                this.updateUrl();
                return;
            }
        }
        this.applyMeshFilters();
        this.requestMeshFilterRefresh(6);
        this.updateUrl();
    }
    applyMeshFilters() {
        applyMeshVisibilityFilters(window.renderInterface, this.showVisualMeshes, this.showCollisionMeshes);
    }
    requestMeshFilterRefresh(frames = 8) {
        this.meshFilterRefreshFrames = Math.max(this.meshFilterRefreshFrames, frames);
    }
    beginInitialUiAnimationBlock() {
        if (!this.pauseAnimationForInitialUi)
            return;
        this.blockAnimationForInitialUi = true;
        if (this.blockAnimationResumeTimer !== null) {
            window.clearTimeout(this.blockAnimationResumeTimer);
            this.blockAnimationResumeTimer = null;
        }
        const timeoutMs = Math.max(0, Math.floor(this.pauseAnimationForInitialUiMaxMs));
        if (timeoutMs <= 0)
            return;
        this.blockAnimationResumeTimer = window.setTimeout(() => {
            this.endInitialUiAnimationBlock();
        }, timeoutMs);
    }
    endInitialUiAnimationBlock() {
        this.blockAnimationForInitialUi = false;
        if (this.blockAnimationResumeTimer !== null) {
            window.clearTimeout(this.blockAnimationResumeTimer);
            this.blockAnimationResumeTimer = null;
        }
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
        this.render();
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
        if (!options.preserveStageReloadProxy) {
            this.clearStageReloadProxy();
        }
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
        this.endInitialUiAnimationBlock();
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
        this.ready = false;
        this.drawFailed = false;
        const loadParams = new URLSearchParams(this.params.toString());
        const eagerBridgeWarmup = this.truthFirst || this.shouldPreloadAllPrims() || selection.loadCollisionPrims;
        if (loadParams.get("threads") === null) {
            loadParams.set("threads", String(this.wasmThreadCount));
        }
        if (loadParams.get("prewarmWorkers") === null) {
            loadParams.set("prewarmWorkers", this.prewarmWorkers ? "1" : "0");
        }
        if (loadParams.get("allowDriverStageLookup") === null) {
            loadParams.set("allowDriverStageLookup", this.truthFirst ? "1" : "0");
        }
        if (this.truthFirst && loadParams.get("deferStageOverrides") === null) {
            loadParams.set("deferStageOverrides", "0");
        }
        if (this.truthFirst && loadParams.get("postDrawProtoResync") === null) {
            loadParams.set("postDrawProtoResync", "1");
        }
        if (loadParams.get("prefetchStageTransforms") === null) {
            if (loadParams.get("prefetchStageTransformsBeforeDraw") === null) {
                loadParams.set("prefetchStageTransformsBeforeDraw", eagerBridgeWarmup ? "1" : "0");
            }
            if (loadParams.get("prefetchStageTransformsPostDraw") === null) {
                loadParams.set("prefetchStageTransformsPostDraw", "1");
            }
        }
        if (loadParams.get("prefetchProtoDataBlobsBeforeDraw") === null) {
            loadParams.set("prefetchProtoDataBlobsBeforeDraw", eagerBridgeWarmup ? "1" : "0");
        }
        if (loadParams.get("prefetchProtoDataBlobsMode") === null) {
            loadParams.set("prefetchProtoDataBlobsMode", eagerBridgeWarmup ? "immediate" : "idle");
        }
        if (loadParams.get("prefetchProtoDataBlobsStartDelayMs") === null) {
            loadParams.set("prefetchProtoDataBlobsStartDelayMs", eagerBridgeWarmup ? "0" : "300");
        }
        if (loadParams.get("warmupRuntimeBridge") === null) {
            loadParams.set("warmupRuntimeBridge", eagerBridgeWarmup ? "1" : "0");
        }
        if (loadParams.get("warmupRuntimeBridgeBeforeDraw") === null) {
            loadParams.set("warmupRuntimeBridgeBeforeDraw", eagerBridgeWarmup ? "1" : "0");
        }
        if (loadParams.get("warmupRuntimeBridgeAfterDraw") === null) {
            loadParams.set("warmupRuntimeBridgeAfterDraw", "1");
        }
        if (loadParams.get("warmupRobotMetadata") === null) {
            loadParams.set("warmupRobotMetadata", "1");
        }
        if (this.truthFirst && loadParams.get("stageMetadataBudgetMs") === null) {
            loadParams.set("stageMetadataBudgetMs", "2200");
        }
        if (loadParams.get("aggressiveInitialDraw") === null) {
            const shouldAggressivelyDraw = selection.loadVisualPrims && !selection.loadCollisionPrims;
            loadParams.set("aggressiveInitialDraw", shouldAggressivelyDraw ? "1" : "0");
        }
        if (loadParams.get("initialDrawYieldMs") === null) {
            loadParams.set("initialDrawYieldMs", this.truthFirst ? "1" : "8");
        }
        if (loadParams.get("enableProtoBlobFastPath") === null) {
            loadParams.set("enableProtoBlobFastPath", "1");
        }
        if (loadParams.get("autoBatchProtoBlobsOnFirstAccess") === null) {
            loadParams.set("autoBatchProtoBlobsOnFirstAccess", "1");
        }
        if (loadParams.get("autoBatchPrimTransformsOnFirstAccess") === null) {
            loadParams.set("autoBatchPrimTransformsOnFirstAccess", "1");
        }
        if (typeof options.maxVisualPrims === "number") {
            loadParams.set("maxVisualPrims", String(Math.max(0, Math.floor(options.maxVisualPrims))));
        }
        if (typeof options.directStageMeshRead === "boolean") {
            loadParams.set("directStageMeshRead", options.directStageMeshRead ? "1" : "0");
        }
        if (options.lowPriorityBackground) {
            // Keep background upgrade non-intrusive: avoid aggressive draw bursts and
            // defer expensive override work in small chunks.
            loadParams.set("fastLoad", "0");
            loadParams.set("aggressiveInitialDraw", "0");
            loadParams.set("initialDrawBurst", "1");
            loadParams.set("initialDrawBudgetMs", "280");
            loadParams.set("initialDrawYieldMs", "16");
            loadParams.set("eagerRenderDuringLoad", "0");
            loadParams.set("deferStageOverrides", "1");
            loadParams.set("deferStageOverridesStartDelayMs", "80");
            loadParams.set("deferStageOverridesChunkSize", "1");
            loadParams.set("deferStageOverridesChunkDelayMs", "24");
            loadParams.set("prefetchProtoDataBlobs", "0");
            loadParams.set("postDrawProtoResync", "0");
            loadParams.set("warmupRuntimeBridge", "0");
            loadParams.set("warmupRobotMetadata", "0");
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
        this.driver = loadState.driver;
        this.ready = loadState.ready;
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
        this.beginInitialUiAnimationBlock();
        this.scheduleImmediateJointPanelRefresh(loadToken);
        this.schedulePostLoadUiRefresh(loadToken);
        return true;
    }
    scheduleImmediateJointPanelRefresh(loadToken) {
        if (!this.jointPanelController) {
            this.endInitialUiAnimationBlock();
            return;
        }
        const profileJointPanel = /(?:\?|&)profileJointCatalog=(?:1|true|yes|on)(?:&|$)/i.test(String(window.location?.search || ""));
        const delayMs = Math.max(0, Math.floor(this.initialJointPanelRefreshDelayMs));
        if (profileJointPanel) {
            const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
                ? Math.round(performance.now())
                : Date.now();
            console.info("[ViewerApp] scheduleImmediateJointPanelRefresh delay=", delayMs, "at", nowMs, "ms");
        }
        void (async () => {
            try {
                if (delayMs > 0) {
                    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
                }
                if (profileJointPanel) {
                    const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
                        ? Math.round(performance.now())
                        : Date.now();
                    console.info("[ViewerApp] immediate joint panel refresh started at", nowMs, "ms");
                }
                if (!this.isLoadTokenActive(loadToken))
                    return;
                await this.jointPanelController?.refresh();
                if (!this.isLoadTokenActive(loadToken))
                    return;
                if (this.isJointPanelMissingRows()) {
                    await this.refreshJointPanelWithRetries(loadToken);
                }
            }
            catch (error) {
                console.warn("Failed to refresh joint panel immediately after load.", error);
            }
            finally {
                this.endInitialUiAnimationBlock();
            }
        })();
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
    scheduleBackgroundSelectionUpgrade(displayName, pathToLoad, loadToken, options = {}) {
        if (this.backgroundUpgradePending || this.backgroundUpgradeActive)
            return;
        const scheduledGeneration = this.asyncUpgradeGeneration;
        const initialTargetSelection = this.getBackgroundUpgradeTargetSelection();
        if (!this.needsSelectionUpgrade(initialTargetSelection))
            return;
        const initialMissing = this.describeMissingPrimitiveSelection(initialTargetSelection);
        this.backgroundUpgradePending = true;
        if (!this.silentBackgroundUpgradeUi && this.messageLog) {
            this.messageLog.textContent = `Primary selection loaded. You can interact now. ${initialMissing} will load in background...`;
        }
        void (async () => {
            try {
                await this.waitForDeferredHeavyWork(this.backgroundUpgradeDelayMs, this.backgroundUpgradeQuietMs, this.backgroundUpgradeMaxWaitMs);
                if (!this.isLoadTokenActive(loadToken))
                    return;
                if (scheduledGeneration !== this.asyncUpgradeGeneration)
                    return;
                const targetSelection = this.getBackgroundUpgradeTargetSelection();
                if (!this.needsSelectionUpgrade(targetSelection))
                    return;
                const missing = this.describeMissingPrimitiveSelection(targetSelection);
                if (!this.silentBackgroundUpgradeUi && this.messageLog) {
                    this.messageLog.textContent = `Loading ${missing} in background...`;
                }
                this.backgroundUpgradeActive = true;
                const keepProxyVisibleDuringReload = !!options.keepProxyVisibleDuringReload;
                const capturedProxy = keepProxyVisibleDuringReload && this.captureStageReloadProxy();
                if (!capturedProxy) {
                    this.clearStageReloadProxy();
                }
                await this.clearStage({
                    preserveStageReloadProxy: capturedProxy,
                    preserveJointPanel: true,
                    clearVirtualFs: false,
                });
                if (!this.isLoadTokenActive(loadToken))
                    return;
                if (scheduledGeneration !== this.asyncUpgradeGeneration)
                    return;
                const passLabel = `background-v${Number(targetSelection.loadVisualPrims)}-c${Number(targetSelection.loadCollisionPrims)}`;
                const loaded = await this.performUsdLoadPass(displayName, pathToLoad, loadToken, targetSelection, passLabel, {
                    silentUi: this.silentBackgroundUpgradeUi,
                    lowPriorityBackground: this.throttleBackgroundUpgrade,
                });
                if (!this.isLoadTokenActive(loadToken))
                    return;
                if (scheduledGeneration !== this.asyncUpgradeGeneration)
                    return;
                if (loaded || !capturedProxy) {
                    this.clearStageReloadProxy();
                }
                this.applyMeshFilters();
                this.requestMeshFilterRefresh(8);
            }
            finally {
                this.backgroundUpgradeActive = false;
                this.backgroundUpgradePending = false;
            }
        })();
    }
    async loadUsdFile(displayName, pathToLoad, loadToken) {
        if (!this.USD || !window.usdRoot)
            return;
        if (!this.isLoadTokenActive(loadToken))
            return;
        this.showVisualLoadingProxy(pathToLoad);
        const primarySelection = this.getPrimaryPrimitiveSelection();
        const usingVisualProxyFirst = this.shouldUseVisualProxyFirst()
            && primarySelection.loadVisualPrims
            && !primarySelection.loadCollisionPrims;
        const primaryLoadOptions = {};
        const primaryPassLabel = `primary-v${Number(primarySelection.loadVisualPrims)}-c${Number(primarySelection.loadCollisionPrims)}`;
        const loadedPrimary = await this.performUsdLoadPass(displayName, pathToLoad, loadToken, primarySelection, primaryPassLabel, primaryLoadOptions);
        if (!loadedPrimary) {
            this.clearStageReloadProxy();
            return;
        }
        if (!this.isLoadTokenActive(loadToken))
            return;
        this.clearStageReloadProxy();
        const backgroundTargetSelection = this.getBackgroundUpgradeTargetSelection();
        if (!this.needsSelectionUpgrade(backgroundTargetSelection)) {
            this.clearStageReloadProxy();
            return;
        }
        this.scheduleBackgroundSelectionUpgrade(displayName, pathToLoad, loadToken, {
            keepProxyVisibleDuringReload: usingVisualProxyFirst,
        });
    }
    schedulePostLoadUiRefresh(loadToken) {
        void (async () => {
            try {
                await this.waitForDeferredHeavyWork(this.postLoadUiRefreshDelayMs, this.postLoadUiRefreshQuietMs, this.postLoadUiRefreshMaxWaitMs);
                if (!this.isLoadTokenActive(loadToken))
                    return;
                if (this.showLinkDynamics) {
                    await this.rebuildLinkDynamics();
                    if (!this.isLoadTokenActive(loadToken))
                        return;
                }
            }
            catch (error) {
                console.warn("Failed to refresh post-load inspector panels.", error);
            }
        })();
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
        if (!this.showLinkDynamics)
            return false;
        if (!window.renderInterface)
            return false;
        return this.linkDynamicsController.syncLinkDynamicsTransforms(window.renderInterface);
    }
    async animate() {
        if (this.stopped) {
            requestAnimationFrame(() => this.animate());
            return;
        }
        if (this.blockAnimationForInitialUi) {
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
        requestAnimationFrame(() => this.animate());
    }
}
export async function init() {
    const app = new ViewerApp();
    await app.run();
}
