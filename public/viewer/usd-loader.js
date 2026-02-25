// @ts-ignore runtime cache-busting query suffix is resolved by browser ESM loader.
import { ThreeRenderDelegateInterface } from "/usd/hydra/ThreeJsRenderDelegate.js?v=20260224c";
import { fitCameraToSelection, scheduleCameraRefit } from "./camera.js";
import { getDirectoryFromVirtualPath, isLikelyNonRenderableUsdConfig, normalizeUsdPath, parseBooleanFlag } from "./path-utils.js";
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function nextAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
async function yieldToMainThread(minDelayMs = 0) {
    if (minDelayMs > 0) {
        await sleep(minDelayMs);
        return;
    }
    await nextAnimationFrame();
}
function getMeshLoadStats(renderInterface) {
    const meshes = renderInterface?.meshes || {};
    const entries = Object.entries(meshes);
    let ready = 0;
    let collisions = 0;
    let visuals = 0;
    for (const [id, mesh] of entries) {
        const geometry = mesh?._mesh?.geometry;
        const positionAttribute = geometry?.getAttribute?.("position");
        if (positionAttribute && positionAttribute.count > 0)
            ready++;
        if (/\/collisions\.|\/collisions\//i.test(id))
            collisions++;
        else
            visuals++;
    }
    return {
        total: entries.length,
        ready,
        collisions,
        visuals,
    };
}
function inferStageUpAxisFromPath(stagePath) {
    const normalized = String(stagePath || "").toLowerCase();
    if (normalized.includes("/unitree_model/"))
        return "z";
    if (normalized.includes("/piper_isaac_sim/"))
        return "z";
    return "y";
}
async function ensureRootPathIsLoadable(pathToLoad, usdFsHelper) {
    if (!pathToLoad)
        return false;
    if (/^[a-z]+:\/\//i.test(pathToLoad))
        return true;
    if (usdFsHelper.hasVirtualFilePath(pathToLoad))
        return true;
    if (!pathToLoad.startsWith("/"))
        return true;
    if (pathToLoad.toLowerCase().startsWith("/unitree_model/"))
        return true;
    if (pathToLoad.toLowerCase().startsWith("/piper_isaac_sim/"))
        return true;
    try {
        const response = await fetch(pathToLoad, { method: "HEAD" });
        return response.ok;
    }
    catch {
        return false;
    }
}
export async function loadUsdStage(args) {
    const { USD, usdFsHelper, messageLog, progressBar, progressLabel, showLoadUi = true, readStageMetadata, loadCollisionPrims, loadVisualPrims: requestedLoadVisualPrims, loadPassLabel, params, displayName, pathToLoad, isLoadActive, debugFileHandling = false, onResolvedFilename, applyMeshFilters, rebuildLinkAxes, renderFrame, } = args;
    const fastLoad = parseBooleanFlag(params.get("fastLoad"), true);
    const truthFirst = parseBooleanFlag(params.get("truthFirst"), false);
    // Strict one-shot mode: complete all critical metadata/cache prep during load,
    // then enter interactive state without deferred background tails.
    const strictOneShot = parseBooleanFlag(params.get("strictOneShot"), true);
    const directStageMeshRead = parseBooleanFlag(params.get("directStageMeshRead"), true);
    // Stage override scans are one of the heaviest post-load tasks on large robot
    // assets. Keep the default synchronous so interaction (joint panel / COM
    // toggle) is not starved by long deferred background chunks.
    const deferStageOverrides = strictOneShot
        ? false
        : parseBooleanFlag(params.get("deferStageOverrides"), false);
    const primeFinalStageOverrideBatchBeforeDraw = parseBooleanFlag(params.get("primeFinalStageOverrideBatchBeforeDraw"), truthFirst);
    const deferredStageOverridesStartDelayMs = (() => {
        const requested = Number(params.get("deferStageOverridesStartDelayMs"));
        const fallback = fastLoad ? 180 : 0;
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(120000, Math.floor(requested)));
    })();
    const deferredStageOverridesChunkSize = (() => {
        const requested = Number(params.get("deferStageOverridesChunkSize"));
        // A single-mesh chunk keeps UI ultra-smooth but can create very long
        // completion tails on large robot stages.
        if (!Number.isFinite(requested))
            return fastLoad ? 4 : 2;
        return Math.max(1, Math.min(256, Math.floor(requested)));
    })();
    const deferredStageOverridesChunkDelayMs = (() => {
        const requested = Number(params.get("deferStageOverridesChunkDelayMs"));
        if (!Number.isFinite(requested))
            return fastLoad ? 2 : 16;
        return Math.max(0, Math.min(5000, Math.floor(requested)));
    })();
    const deferStageOverridesUseIdle = parseBooleanFlag(params.get("deferStageOverridesUseIdle"), !fastLoad);
    const deferredStageOverridesWorkBudgetMs = (() => {
        const requested = Number(params.get("deferStageOverridesWorkBudgetMs"));
        // Run multiple chunks per tick to reduce scheduling overhead while keeping
        // each slice bounded.
        if (!Number.isFinite(requested))
            return fastLoad ? 10 : 6;
        return Math.max(1, Math.min(200, Math.floor(requested)));
    })();
    const forceDependencyPreload = parseBooleanFlag(params.get("forceDependencyPreload"), false);
    const autoLoadDependencies = parseBooleanFlag(params.get("autoLoadDependencies"), true);
    const normalizedPathForDependencyDefaults = String(pathToLoad || "").toLowerCase();
    const defaultIncludeSensorDependency = normalizedPathForDependencyDefaults.includes("/unitree_model/")
        || normalizedPathForDependencyDefaults.includes("/robots/");
    const includeSensorDependency = parseBooleanFlag(params.get("includeSensorDependency"), defaultIncludeSensorDependency);
    const allowDriverStageLookup = parseBooleanFlag(params.get("allowDriverStageLookup"), truthFirst || readStageMetadata);
    // Visual proto transforms from Hydra/proto blobs are already truth-aligned for
    // the common robot assets. Keep visual stage overrides opt-in so strict
    // one-shot mode does not overwrite per-submesh authored orientation.
    const applyVisualStageOverrides = parseBooleanFlag(params.get("applyVisualStageOverrides"), false);
    const legacyPrefetchStageTransformsRaw = params.get("prefetchStageTransforms");
    const hasLegacyPrefetchStageTransformsFlag = legacyPrefetchStageTransformsRaw !== null;
    const legacyPrefetchStageTransforms = parseBooleanFlag(legacyPrefetchStageTransformsRaw, false);
    // Keep first-paint path light by default: stage transform prefetch now runs
    // post-initial-draw unless explicitly requested before draw.
    const prefetchStageTransformsBeforeDraw = hasLegacyPrefetchStageTransformsFlag
        ? legacyPrefetchStageTransforms
        : parseBooleanFlag(params.get("prefetchStageTransformsBeforeDraw"), false);
    const prefetchStageTransformsPostDraw = hasLegacyPrefetchStageTransformsFlag
        ? legacyPrefetchStageTransforms
        : parseBooleanFlag(params.get("prefetchStageTransformsPostDraw"), true);
    const prefetchProtoDataBlobs = parseBooleanFlag(params.get("prefetchProtoDataBlobs"), true);
    const prefetchProtoDataBlobsBeforeDraw = strictOneShot
        ? true
        : parseBooleanFlag(params.get("prefetchProtoDataBlobsBeforeDraw"), truthFirst);
    const prefetchProtoDataBlobsMode = (() => {
        if (strictOneShot)
            return "immediate";
        const rawMode = String(params.get("prefetchProtoDataBlobsMode") || "").trim().toLowerCase();
        return rawMode === "immediate" ? "immediate" : "idle";
    })();
    const prefetchProtoDataBlobsStartDelayMs = (() => {
        if (strictOneShot)
            return 0;
        const requested = Number(params.get("prefetchProtoDataBlobsStartDelayMs"));
        const fallback = fastLoad ? 300 : 120;
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(120000, Math.floor(requested)));
    })();
    const warmupRuntimeBridge = parseBooleanFlag(params.get("warmupRuntimeBridge"), true);
    const warmupRuntimeBridgeBeforeDraw = parseBooleanFlag(params.get("warmupRuntimeBridgeBeforeDraw"), truthFirst || !!loadCollisionPrims);
    const warmupRuntimeBridgeAfterDraw = parseBooleanFlag(params.get("warmupRuntimeBridgeAfterDraw"), warmupRuntimeBridge);
    const prefetchFinalStageOverrideBatchBeforeDraw = parseBooleanFlag(params.get("prefetchFinalStageOverrideBatchBeforeDraw"), primeFinalStageOverrideBatchBeforeDraw);
    const warmupRobotMetadata = parseBooleanFlag(params.get("warmupRobotMetadata"), true);
    // Ensure joint + COM/inertia metadata is fully resolved before reporting
    // load completion. This keeps first interaction behavior aligned with
    // collision meshes (no long tail metadata warmup after first frame).
    const resolveRobotMetadataBeforeReady = strictOneShot
        ? true
        : parseBooleanFlag(params.get("resolveRobotMetadataBeforeReady"), true);
    const eagerRobotMetadataWarmup = parseBooleanFlag(params.get("eagerRobotMetadataWarmup"), true);
    const skipUrdfTruthDuringEagerWarmup = parseBooleanFlag(params.get("skipUrdfTruthDuringEagerWarmup"), true);
    const allowJsRobotMetadataFallback = parseBooleanFlag(params.get("allowJsRobotMetadataFallback"), !strictOneShot);
    const requireCompleteRobotMetadata = parseBooleanFlag(params.get("requireCompleteRobotMetadata"), strictOneShot);
    const robotMetadataResolveBudgetMs = (() => {
        const requested = Number(params.get("robotMetadataResolveBudgetMs"));
        // Strict one-shot blocks interactivity until metadata is ready, so avoid
        // timing out by default and leaving heavy work to first interaction.
        const fallback = strictOneShot ? 0 : (fastLoad ? 4000 : 8000);
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(120000, Math.floor(requested)));
    })();
    const maxCpuDraw = parseBooleanFlag(params.get("maxCpuDraw"), false);
    // Favor full-scene readiness during the loading phase to avoid long tail mesh hydration.
    const aggressiveInitialDraw = parseBooleanFlag(params.get("aggressiveInitialDraw"), true);
    const drawBurstRenderEveryDraw = parseBooleanFlag(params.get("drawBurstRenderEveryDraw"), aggressiveInitialDraw);
    const stageMetadataBudgetMs = (() => {
        const requested = Number(params.get("stageMetadataBudgetMs"));
        const fallback = truthFirst ? (fastLoad ? 2200 : 3200) : (fastLoad ? 350 : 2500);
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(120000, Math.floor(requested)));
    })();
    const hardwareConcurrency = Number(navigator?.hardwareConcurrency || 4);
    const defaultThreadHint = 4;
    const requestedThreadHint = Number(params.get("threads"));
    const inferredThreadHint = Number.isFinite(requestedThreadHint) && requestedThreadHint > 0
        ? Math.floor(requestedThreadHint)
        : defaultThreadHint;
    const initialDrawBurst = (() => {
        const requested = Number(params.get("initialDrawBurst"));
        const baselineBurst = maxCpuDraw
            ? Math.max(2, Math.min(16, inferredThreadHint))
            : 1;
        // Keep fast-load interactive: large draw bursts can monopolize the main
        // thread right after the first visible frame.
        const aggressiveBurst = maxCpuDraw
            ? Math.max(2, Math.min(24, inferredThreadHint * 2))
            : 2;
        const fallback = aggressiveInitialDraw
            ? Math.max(baselineBurst, aggressiveBurst)
            : baselineBurst;
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(1, Math.min(128, Math.floor(requested)));
    })();
    const initialDrawBudgetMs = (() => {
        const requested = Number(params.get("initialDrawBudgetMs"));
        const fallback = aggressiveInitialDraw
            ? (maxCpuDraw ? 2800 : 2200)
            : (maxCpuDraw ? 1200 : 700);
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(60000, Math.floor(requested)));
    })();
    const initialDrawYieldMs = (() => {
        const requested = Number(params.get("initialDrawYieldMs"));
        const fallback = aggressiveInitialDraw ? 4 : 8;
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(1000, Math.floor(requested)));
    })();
    const initialDrawTargetReadyRatio = (() => {
        const requested = Number(params.get("initialDrawTargetReadyRatio"));
        const fallback = aggressiveInitialDraw
            ? 0.98
            : (maxCpuDraw ? 0.9 : 0.85);
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0.1, Math.min(1, requested));
    })();
    const postDrawProtoResyncEnabled = parseBooleanFlag(params.get("postDrawProtoResync"), truthFirst);
    const forcePostDrawProtoResync = parseBooleanFlag(params.get("forcePostDrawProtoResync"), false);
    const postDrawProtoResyncChunk = (() => {
        const requested = Number(params.get("postDrawProtoResyncChunk"));
        if (!Number.isFinite(requested))
            return 16;
        return Math.max(1, Math.min(64, Math.floor(requested)));
    })();
    const loadVisualPrims = typeof requestedLoadVisualPrims === "boolean"
        ? requestedLoadVisualPrims
        : parseBooleanFlag(params.get("loadVisualPrims"), true);
    const maxVisualPrimsRaw = params.get("maxVisualPrims");
    let maxVisualPrims;
    if (maxVisualPrimsRaw !== null && maxVisualPrimsRaw !== "") {
        const parsedMaxVisualPrims = Number(maxVisualPrimsRaw);
        if (Number.isFinite(parsedMaxVisualPrims)) {
            maxVisualPrims = Math.max(0, Math.floor(parsedMaxVisualPrims));
        }
    }
    const profileLoad = parseBooleanFlag(params.get("profileLoad"), false);
    const profileTextureLoads = parseBooleanFlag(params.get("profileTextureLoads"), false)
        || parseBooleanFlag(params.get("profileHydraPhases"), false);
    const eagerRenderDuringLoad = parseBooleanFlag(params.get("eagerRenderDuringLoad"), true);
    const eagerRenderEveryDraw = parseBooleanFlag(params.get("eagerRenderEveryDraw"), false);
    // Force-enable proto blob fast path for performance triage.
    const enableProtoBlobFastPath = true;
    const profileStartTime = (typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now();
    const profileMarks = [];
    const callbackProfileByName = new Map();
    const profileNow = () => ((typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now());
    const markLoadPhase = (label) => {
        if (!profileLoad)
            return;
        const now = profileNow();
        profileMarks.push({
            label,
            ms: Math.round((now - profileStartTime) * 10) / 10,
        });
    };
    const addCallbackSample = (name, durationMs) => {
        if (!profileLoad)
            return;
        const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
        const existing = callbackProfileByName.get(name) || { count: 0, totalMs: 0, maxMs: 0 };
        existing.count += 1;
        existing.totalMs += safeDuration;
        existing.maxMs = Math.max(existing.maxMs, safeDuration);
        callbackProfileByName.set(name, existing);
    };
    const flushLoadProfile = (status) => {
        if (!profileLoad)
            return;
        markLoadPhase(`end:${status}`);
        const phaseRows = profileMarks
            .map((mark, index) => {
            const previous = index > 0 ? profileMarks[index - 1].ms : 0;
            const delta = Math.max(0, Math.round((mark.ms - previous) * 10) / 10);
            return `${index.toString().padStart(2, "0")}. ${mark.label}: +${delta}ms (t=${mark.ms}ms)`;
        })
            .join("\n");
        const callbackRows = Array.from(callbackProfileByName.entries())
            .sort((a, b) => b[1].totalMs - a[1].totalMs)
            .slice(0, 20)
            .map(([name, stats]) => {
            const total = Math.round(stats.totalMs * 10) / 10;
            const max = Math.round(stats.maxMs * 10) / 10;
            return `${name}: count=${stats.count}, total=${total}ms, max=${max}ms`;
        })
            .join("\n");
        console.info([
            `[LOAD PROFILE][${status}] ${normalizedPath}`,
            phaseRows || "(no phases)",
            callbackRows ? `[LOAD PROFILE][callbacks]\n${callbackRows}` : "",
        ].filter(Boolean).join("\n"));
    };
    let eagerRenderCount = 0;
    const runEagerRender = (_phaseLabel, options = {}) => {
        if (!eagerRenderDuringLoad)
            return;
        if (typeof renderFrame !== "function")
            return;
        const forceRender = !!options.forceRender;
        if (!forceRender && !eagerRenderEveryDraw && eagerRenderCount > 0)
            return;
        const renderStart = profileNow();
        try {
            renderFrame();
            eagerRenderCount += 1;
        }
        catch {
            // Keep eager rendering best-effort and silent in hot paths.
        }
    };
    const isLoadStillActive = () => {
        if (typeof isLoadActive !== "function")
            return true;
        try {
            return isLoadActive();
        }
        catch {
            return false;
        }
    };
    const setMessage = (text) => {
        if (!isLoadStillActive())
            return;
        if (!showLoadUi)
            return;
        if (messageLog)
            messageLog.textContent = text;
    };
    let currentProgress = 0;
    const setProgress = (rawPercent, force = false) => {
        if (!isLoadStillActive())
            return;
        if (!showLoadUi)
            return;
        const clamped = Math.max(0, Math.min(100, Math.round(rawPercent)));
        currentProgress = force ? clamped : Math.max(currentProgress, clamped);
        if (progressBar) {
            progressBar.style.width = `${currentProgress}%`;
        }
        if (progressLabel) {
            progressLabel.textContent = `${currentProgress}%`;
        }
    };
    const hideProgress = () => {
        if (!isLoadStillActive())
            return;
        if (!showLoadUi)
            return;
        if (progressBar?.parentElement) {
            const container = progressBar.parentElement;
            if (container.isConnected)
                container.style.display = "none";
        }
    };
    if (showLoadUi && progressBar && progressBar.parentElement) {
        progressBar.parentElement.style.display = "block";
    }
    if (showLoadUi) {
        setProgress(0, true);
    }
    if (!USD || !window.usdRoot)
        return null;
    const normalizedPath = normalizeUsdPath(pathToLoad, displayName).split("?")[0];
    if (!normalizedPath)
        return null;
    markLoadPhase("start");
    const state = {
        driver: null,
        ready: false,
        drawFailed: false,
        timeout: 40,
        endTimeCode: 0,
        normalizedPath,
        loadedCollisionPrims: !!loadCollisionPrims,
        loadedVisualPrims: !!loadVisualPrims,
    };
    if (!isLoadStillActive())
        return state;
    onResolvedFilename(normalizedPath, displayName || normalizedPath);
    setMessage("Checking file path...");
    setProgress(4);
    const canLoadRootPath = await ensureRootPathIsLoadable(normalizedPath, usdFsHelper);
    if (!isLoadStillActive())
        return state;
    if (!canLoadRootPath) {
        setMessage(`Cannot find USD file at '${normalizedPath}'.`);
        setProgress(0, true);
        hideProgress();
        state.ready = true;
        return state;
    }
    setProgress(10);
    markLoadPhase("root-path-checked");
    const unitreeDependencyStemByRootUsdFile = {
        "g1_29dof_rev_1_0.usd": "g1_29dof_rev_1_0",
        "g1_23dof_rev_1_0.usd": "g1_23dof_rev_1_0",
        "go2.usd": "go2_description",
        "go2w.usd": "go2w_description",
        "h1.usd": "h1",
        "h1_2.usd": "h1_2",
        "h1_2_handless.usd": "h1_2_handless",
        "b2.usd": "b2_description",
        "b2w.usd": "b2w_description",
    };
    const usdModule = window.USD;
    const canWriteVirtualFs = !!usdModule
        && typeof usdModule.FS_createPath === "function"
        && typeof usdModule.FS_createDataFile === "function"
        && typeof usdModule.FS_unlink === "function";
    const loadFileAsBinary = async (requestPath) => {
        try {
            const response = await fetch(requestPath);
            if (!response.ok)
                return null;
            const binary = await response.arrayBuffer();
            if (!binary || binary.byteLength <= 0)
                return null;
            return new Uint8Array(binary);
        }
        catch {
            return null;
        }
    };
    const writeBinaryToVirtualPath = (virtualPath, binaryData) => {
        if (!canWriteVirtualFs)
            return;
        const normalizedVirtualPath = normalizeUsdPath(virtualPath).split("?")[0];
        const fileName = normalizedVirtualPath.split("/").pop();
        if (!fileName)
            return;
        const directory = getDirectoryFromVirtualPath(normalizedVirtualPath);
        try {
            usdModule.FS_createPath("", directory, true, true);
        }
        catch { }
        try {
            if (usdFsHelper.hasVirtualFilePath(normalizedVirtualPath)) {
                usdModule.FS_unlink(normalizedVirtualPath);
                usdFsHelper.untrackVirtualFilePath(normalizedVirtualPath);
            }
        }
        catch { }
        try {
            usdModule.FS_createDataFile(directory, fileName, binaryData, true, true, true);
            usdFsHelper.trackVirtualFilePath(normalizedVirtualPath);
        }
        catch {
            // Keep load path resilient; missing optional dependency files are tolerated.
        }
    };
    const ensureVirtualFileFromCandidates = async (virtualPath, candidateFetchPaths) => {
        if (!virtualPath)
            return false;
        if (!canWriteVirtualFs)
            return false;
        const normalizedVirtualPath = normalizeUsdPath(virtualPath).split("?")[0];
        if (usdFsHelper.hasVirtualFilePath(normalizedVirtualPath))
            return true;
        for (const candidatePath of candidateFetchPaths) {
            const loadedBinary = await loadFileAsBinary(candidatePath);
            if (!loadedBinary)
                continue;
            writeBinaryToVirtualPath(normalizedVirtualPath, loadedBinary);
            return true;
        }
        return false;
    };
    const autoLoadSublayers = async (dependencyStem) => {
        if (!canWriteVirtualFs)
            return;
        const tryEnsureDependencyFile = async (fileName) => {
            if (!fileName)
                return;
            const rootDirectory = getDirectoryFromVirtualPath(normalizedPath);
            const localConfigurationPath = normalizeUsdPath(`${rootDirectory}configuration/${fileName}`);
            const sharedConfigurationPath = normalizeUsdPath(`/configuration/${fileName}`);
            const candidateFetchPaths = Array.from(new Set([
                localConfigurationPath,
                sharedConfigurationPath,
            ]));
            if (usdFsHelper.hasVirtualFilePath(localConfigurationPath))
                return;
            if (usdFsHelper.hasVirtualFilePath(sharedConfigurationPath)) {
                try {
                    const existing = usdModule.FS_readFile?.(sharedConfigurationPath);
                    if (existing && existing.length > 0) {
                        writeBinaryToVirtualPath(localConfigurationPath, existing);
                        return;
                    }
                }
                catch { }
            }
            let loadedBinary = null;
            for (const candidatePath of candidateFetchPaths) {
                loadedBinary = await loadFileAsBinary(candidatePath);
                if (loadedBinary)
                    break;
            }
            if (!loadedBinary)
                return;
            writeBinaryToVirtualPath(localConfigurationPath, loadedBinary);
            if (sharedConfigurationPath !== localConfigurationPath) {
                writeBinaryToVirtualPath(sharedConfigurationPath, loadedBinary);
            }
        };
        const dependencySuffixesByStem = {
            h1_2_handless: ["base", "physics", "robot"],
        };
        const dependencySuffixes = dependencySuffixesByStem[dependencyStem] || ["base", "physics"];
        if (includeSensorDependency) {
            dependencySuffixes.push("sensor");
        }
        const dependencyFileNames = dependencySuffixes.map((suffix) => `${dependencyStem}_${suffix}.usd`);
        await Promise.all(dependencyFileNames.map((dependencyFileName) => tryEnsureDependencyFile(dependencyFileName)));
    };
    const shouldPreloadRootLayerToVirtualFs = normalizedPath.startsWith("/");
    if (shouldPreloadRootLayerToVirtualFs) {
        const rootLayerLoaded = await ensureVirtualFileFromCandidates(normalizedPath, [normalizedPath]);
        if (rootLayerLoaded) {
            // Root layer is available in WASM FS.
        }
    }
    const normalizedFileName = normalizedPath.split("/").pop()?.toLowerCase() || "";
    const inferredStem = normalizedFileName
        ? normalizedFileName.replace(/\.usd[a-z]?$/i, "")
        : "";
    const dependencyStem = unitreeDependencyStemByRootUsdFile[normalizedFileName] || inferredStem;
    const shouldAutoLoadDependenciesFromVirtualFs = usdFsHelper.hasVirtualFilePath(normalizedPath);
    const shouldAutoLoadDependenciesFromUnitreePath = normalizedPath.toLowerCase().startsWith("/unitree_model/");
    if (autoLoadDependencies
        && dependencyStem
        && (shouldAutoLoadDependenciesFromVirtualFs || shouldAutoLoadDependenciesFromUnitreePath || forceDependencyPreload)) {
        await autoLoadSublayers(dependencyStem);
    }
    if (autoLoadDependencies && normalizedPath.toLowerCase().startsWith("/piper_isaac_sim/")) {
        const piperCameraDependencyRoots = [
            "/piper_isaac_sim/piper_description/urdf/piper_description_v100_realsense_camera_v2/piper_description_v100_realsense_camera_v2.usd",
            "/piper_isaac_sim/piper_h_description/urdf/piper_h_description_d435_dark/piper_h_description_d435_dark.usd",
            "/piper_isaac_sim/piper_l_description/urdf/piper_l_description_d435_dark/piper_l_description_d435_dark.usd",
            "/piper_isaac_sim/piper_x_description/urdf/piper_x_description_d435/piper_x_description_d435.usd",
        ];
        const ensurePiperDependencyFileSet = async (rootUsdPath) => {
            const normalizedRootPath = normalizeUsdPath(rootUsdPath).split("?")[0];
            if (!normalizedRootPath)
                return;
            const rootDirectory = getDirectoryFromVirtualPath(normalizedRootPath);
            const rootFileName = normalizedRootPath.split("/").pop() || "";
            if (!rootFileName)
                return;
            const stem = rootFileName.replace(/\.usd[a-z]?$/i, "");
            await ensureVirtualFileFromCandidates(normalizedRootPath, [normalizedRootPath]);
            for (const suffix of ["base", "physics", "robot", "sensor"]) {
                const dependencyPath = normalizeUsdPath(`${rootDirectory}configuration/${stem}_${suffix}.usd`);
                await ensureVirtualFileFromCandidates(dependencyPath, [dependencyPath]);
            }
        };
        await Promise.all(piperCameraDependencyRoots.map((dependencyRoot) => ensurePiperDependencyFileSet(dependencyRoot)));
    }
    if (!isLoadStillActive())
        return state;
    setProgress(22);
    markLoadPhase("dependency-preload-done");
    setMessage("Initializing USD driver...");
    window.usdStage = null;
    let driver = null;
    const renderInterface = (window.renderInterface = new ThreeRenderDelegateInterface({
        usdRoot: window.usdRoot,
        paths: [],
        stageSourcePath: normalizedPath,
        suppressMaterialBindingApiWarnings: true,
        // Parsing fallback xform ops from raw USDA layer text is extremely expensive
        // on large Unitree assets; keep it opt-in via URL when needed for diagnostics.
        enableXformOpFallbackFromLayerText: parseBooleanFlag(params.get("enableXformOpFallbackFromLayerText"), false),
        // Proto stage sync is force-enabled to avoid slow per-mesh bridge calls.
        enableProtoBlobFastPath,
        // Prefer one-shot final stage override batches over per-mesh fallback chains.
        preferFinalStageOverrideBatchInProtoSync: parseBooleanFlag(params.get("preferFinalStageOverrideBatchInProtoSync"), true),
        // Skip heavy per-callback geometry copies when proto blob fast-path is enabled.
        preferProtoBlobOverHydraPayload: parseBooleanFlag(params.get("preferProtoBlobOverHydraPayload"), true),
        // Bridge optimization: when first proto/blob or transform query arrives,
        // pull a batch once and serve subsequent mesh requests from JS caches.
        autoBatchProtoBlobsOnFirstAccess: parseBooleanFlag(params.get("autoBatchProtoBlobsOnFirstAccess"), true),
        autoBatchPrimTransformsOnFirstAccess: parseBooleanFlag(params.get("autoBatchPrimTransformsOnFirstAccess"), true),
        // During high-frequency Hydra sync callbacks, avoid fallback driver.GetStage()
        // lookups before window.usdStage is ready to prevent first-sync stalls.
        deferDriverStageLookupInSyncHotPath: parseBooleanFlag(params.get("deferDriverStageLookupInSyncHotPath"), true),
        // In strict one-shot mode, prefer C++ metadata snapshot and avoid heavy JS
        // stage text fallback unless explicitly requested.
        allowJsRobotMetadataFallback,
        // For fast interactive loads, avoid synchronous driver.GetStage() fallback unless
        // metadata access is explicitly enabled.
        allowDriverStageLookup,
        // Low-noise phase instrumentation:
        //   1) WASM payload fetch/copy
        //   2) Three.js object/build work
        //   3) renderer.render blocking time
        enableHydraPhaseInstrumentation: parseBooleanFlag(params.get("profileHydraPhases"), false),
        loadCollisionPrims: !!loadCollisionPrims,
        loadVisualPrims: !!loadVisualPrims,
        maxVisualPrims,
        stage: () => window.usdStage || null,
        setStage: (resolvedStage) => {
            window.usdStage = resolvedStage || null;
        },
        driver: () => driver,
    }));
    if (profileLoad && renderInterface && typeof renderInterface === "object") {
        const wrappedFunctionNames = new Set();
        const wrapMethod = (owner, methodName) => {
            if (!owner || typeof owner[methodName] !== "function")
                return;
            const fullName = methodName;
            if (wrappedFunctionNames.has(fullName))
                return;
            const original = owner[methodName];
            owner[methodName] = function profiledRenderInterfaceMethod(...methodArgs) {
                const startedAt = profileNow();
                let result;
                try {
                    result = original.apply(this, methodArgs);
                }
                catch (error) {
                    addCallbackSample(fullName, profileNow() - startedAt);
                    throw error;
                }
                if (result && typeof result.then === "function") {
                    return Promise.resolve(result)
                        .then((value) => {
                        addCallbackSample(fullName, profileNow() - startedAt);
                        return value;
                    })
                        .catch((error) => {
                        addCallbackSample(fullName, profileNow() - startedAt);
                        throw error;
                    });
                }
                addCallbackSample(fullName, profileNow() - startedAt);
                return result;
            };
            wrappedFunctionNames.add(fullName);
        };
        const proto = Object.getPrototypeOf(renderInterface);
        if (proto) {
            for (const name of Object.getOwnPropertyNames(proto)) {
                if (name === "constructor")
                    continue;
                wrapMethod(proto, name);
            }
        }
        for (const name of Object.keys(renderInterface)) {
            wrapMethod(renderInterface, name);
        }
    }
    setProgress(30);
    markLoadPhase("render-interface-ready");
    await yieldToMainThread();
    try {
        driver = new USD.HdWebSyncDriver(renderInterface, normalizedPath);
        if (driver instanceof Promise) {
            driver = await driver;
        }
    }
    catch (error) {
        console.error("Failed to create USD driver", error);
        setMessage("Failed to initialize USD renderer for this file.");
        hideProgress();
        state.ready = true;
        flushLoadProfile("error");
        return state;
    }
    if (!isLoadStillActive()) {
        state.driver = driver || null;
        flushLoadProfile("aborted");
        return state;
    }
    if (!driver) {
        setMessage("Failed to initialize USD renderer for this file.");
        hideProgress();
        state.ready = true;
        flushLoadProfile("error");
        return state;
    }
    try {
        if (typeof driver.SetPreferProtoBlobOverHydraPayload === "function") {
            driver.SetPreferProtoBlobOverHydraPayload(renderInterface?.preferProtoBlobOverHydraPayload !== false);
        }
    }
    catch { }
    state.driver = window.driver = driver;
    await yieldToMainThread();
    let protoBlobPrefetchedBeforeDraw = false;
    const runRuntimeBridgeWarmup = (phaseLabel, options = {}) => {
        if (!warmupRuntimeBridge)
            return null;
        const forceRefresh = options.force === true;
        const shouldWarmInPhase = (phaseLabel === "driver-init" && warmupRuntimeBridgeBeforeDraw)
            || (phaseLabel === "post-initial-draw" && warmupRuntimeBridgeAfterDraw)
            // Strict one-shot must be able to force one post-draw refresh so early
            // bootstrap caches (captured before meshes settle) do not remain stale.
            || (phaseLabel === "post-initial-draw" && strictOneShot && forceRefresh);
        if (!shouldWarmInPhase)
            return null;
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.warmupRuntimeBridgeFromDriver !== "function")
            return null;
        if (!isLoadStillActive())
            return null;
        if (window.driver !== state.driver)
            return null;
        const hasDedicatedTransformPrefetchInPhase = (phaseLabel === "driver-init" && prefetchStageTransformsBeforeDraw)
            || (phaseLabel === "post-initial-draw" && prefetchStageTransformsPostDraw);
        try {
            const summary = activeRenderInterface.warmupRuntimeBridgeFromDriver(state.driver, {
                force: forceRefresh,
                // Avoid duplicate GetPrimTransforms bridge calls when this phase already
                // runs a dedicated prefetch step via refreshPrefetchedStageTransforms().
                includePrimTransforms: !hasDedicatedTransformPrefetchInPhase,
                includeProtoDataBlobs: prefetchProtoDataBlobs,
                includeCollisionProtoOverrides: true,
                includeResolvedPrimPathIndex: true,
                includeRobotMetadata: warmupRobotMetadata && options.includeRobotMetadata === true,
                robotMetadataSkipIdleWait: eagerRobotMetadataWarmup,
                robotMetadataSkipUrdfTruthFallback: skipUrdfTruthDuringEagerWarmup,
            });
            const warmedTransforms = Number(summary?.transformTotalCount || 0);
            const warmedProtoBlobs = Number(summary?.protoBlobCount || 0);
            if (warmedTransforms > 0 || warmedProtoBlobs > 0) {
                markLoadPhase(`runtime-bridge-warmup-${phaseLabel}`);
            }
            if (phaseLabel === "driver-init" && warmedProtoBlobs > 0) {
                protoBlobPrefetchedBeforeDraw = true;
            }
            return summary && typeof summary === "object" ? summary : null;
        }
        catch {
            return null;
        }
    };
    const refreshPrefetchedStageTransforms = (phaseLabel, options = {}) => {
        const shouldPrefetchInPhase = (phaseLabel === "driver-init" && prefetchStageTransformsBeforeDraw)
            || (phaseLabel === "post-initial-draw" && prefetchStageTransformsPostDraw);
        if (!shouldPrefetchInPhase || !window.renderInterface || typeof window.renderInterface.prefetchPrimTransformsFromDriver !== "function") {
            return { world: 0, local: 0, total: 0 };
        }
        try {
            const transformPrefetchSummary = window.renderInterface.prefetchPrimTransformsFromDriver(state.driver, {
                force: options.force === true,
            });
            const worldCount = Number(transformPrefetchSummary?.world || 0);
            const localCount = Number(transformPrefetchSummary?.local || 0);
            const totalCount = Number(transformPrefetchSummary?.total || Math.max(worldCount, localCount));
            return { world: worldCount, local: localCount, total: totalCount };
        }
        catch {
            return { world: 0, local: 0, total: 0 };
        }
    };
    const runProtoBlobPrefetch = (options = {}) => {
        if (!prefetchProtoDataBlobs)
            return 0;
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.prefetchProtoDataBlobsFromDriver !== "function")
            return 0;
        if (!isLoadStillActive())
            return 0;
        if (window.driver !== state.driver)
            return 0;
        const forceRefresh = options.force === true;
        try {
            const protoPrefetchSummary = activeRenderInterface.prefetchProtoDataBlobsFromDriver(state.driver, { force: forceRefresh });
            const protoCount = Number(protoPrefetchSummary?.count || 0);
            return Number.isFinite(protoCount) ? Math.max(0, Math.floor(protoCount)) : 0;
        }
        catch {
            return 0;
        }
    };
    const runFinalStageOverrideBatchPrefetch = (phaseLabel, options = {}) => {
        const forceRefresh = options.force === true;
        const shouldPrefetchInPhase = (phaseLabel === "driver-init" && prefetchFinalStageOverrideBatchBeforeDraw)
            || (phaseLabel === "post-initial-draw" && primeFinalStageOverrideBatchBeforeDraw)
            || (phaseLabel === "post-initial-draw" && strictOneShot && forceRefresh);
        if (!shouldPrefetchInPhase)
            return null;
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.prefetchFinalStageOverrideBatchFromDriver !== "function") {
            return null;
        }
        if (!isLoadStillActive())
            return null;
        if (window.driver !== state.driver)
            return null;
        try {
            const summary = activeRenderInterface.prefetchFinalStageOverrideBatchFromDriver(state.driver, {
                force: forceRefresh,
            });
            const prefetchedCount = Number(summary?.count || 0);
            if (prefetchedCount > 0) {
                markLoadPhase(`stage-overrides-batch-prefetch-${phaseLabel}`);
            }
            return summary && typeof summary === "object" ? summary : null;
        }
        catch {
            return null;
        }
    };
    const scheduleProtoBlobPrefetch = () => {
        if (!prefetchProtoDataBlobs)
            return;
        const runPrefetch = () => {
            void runProtoBlobPrefetch({ force: !protoBlobPrefetchedBeforeDraw });
        };
        const startDelayMs = prefetchProtoDataBlobsStartDelayMs;
        if (prefetchProtoDataBlobsMode === "immediate") {
            if (startDelayMs <= 0) {
                runPrefetch();
            }
            else {
                window.setTimeout(runPrefetch, startDelayMs);
            }
            return;
        }
        const requestIdle = window.requestIdleCallback;
        if (typeof requestIdle !== "function") {
            window.setTimeout(runPrefetch, startDelayMs);
            return;
        }
        window.setTimeout(() => {
            try {
                requestIdle(() => runPrefetch(), { timeout: 2500 });
            }
            catch {
                runPrefetch();
            }
        }, startDelayMs);
    };
    const getRobotMetadataSnapshotStats = () => {
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.getCachedRobotMetadataSnapshot !== "function") {
            return {
                hasSnapshot: false,
                jointCount: 0,
                dynamicsCount: 0,
                linkParentCount: 0,
            };
        }
        try {
            const stageSourcePath = String(activeRenderInterface.getStageSourcePath?.() || "").trim() || null;
            const snapshot = activeRenderInterface.getCachedRobotMetadataSnapshot(stageSourcePath);
            if (!snapshot || typeof snapshot !== "object") {
                return {
                    hasSnapshot: false,
                    jointCount: 0,
                    dynamicsCount: 0,
                    linkParentCount: 0,
                };
            }
            const jointCount = Array.isArray(snapshot.jointCatalogEntries)
                ? snapshot.jointCatalogEntries.length
                : 0;
            const dynamicsCount = Array.isArray(snapshot.linkDynamicsEntries)
                ? snapshot.linkDynamicsEntries.length
                : 0;
            const linkParentCount = Array.isArray(snapshot.linkParentPairs)
                ? snapshot.linkParentPairs.length
                : 0;
            return {
                hasSnapshot: true,
                jointCount,
                dynamicsCount,
                linkParentCount,
            };
        }
        catch {
            return {
                hasSnapshot: false,
                jointCount: 0,
                dynamicsCount: 0,
                linkParentCount: 0,
            };
        }
    };
    const hasResolvedRobotMetadataSnapshot = (options = {}) => {
        const stats = getRobotMetadataSnapshotStats();
        if (!stats.hasSnapshot)
            return false;
        const hasAnyMetadata = stats.jointCount > 0 || stats.dynamicsCount > 0 || stats.linkParentCount > 0;
        if (!hasAnyMetadata)
            return false;
        if (options.requireComplete !== true)
            return true;
        // Strict one-shot: keep interaction blocked until both joint and
        // COM/inertia metadata are ready, preventing first-click long stalls.
        return stats.jointCount > 0 && stats.dynamicsCount > 0;
    };
    const isRobotMetadataReady = () => {
        return hasResolvedRobotMetadataSnapshot({
            requireComplete: requireCompleteRobotMetadata,
        });
    };
    const buildRobotMetadataWarmupOptions = (force) => {
        return {
            force,
            // Force the C++ snapshot path now; avoid waiting for idle slices.
            skipIdleWait: true,
            skipUrdfTruthFallback: skipUrdfTruthDuringEagerWarmup,
            requireComplete: requireCompleteRobotMetadata,
            allowStageFallback: !strictOneShot || allowJsRobotMetadataFallback,
        };
    };
    const awaitRobotMetadataWarmup = async (activeRenderInterface, options) => {
        try {
            const maybePromise = activeRenderInterface.startRobotMetadataWarmupForStage(buildRobotMetadataWarmupOptions(options.force));
            if (!maybePromise || typeof maybePromise.then !== "function") {
                return;
            }
            if (strictOneShot || !options.honorBudget) {
                await maybePromise;
                return;
            }
            if (robotMetadataResolveBudgetMs > 0) {
                let timeoutHandle = null;
                try {
                    await Promise.race([
                        maybePromise,
                        new Promise((resolve) => {
                            timeoutHandle = window.setTimeout(resolve, robotMetadataResolveBudgetMs);
                        }),
                    ]);
                }
                finally {
                    if (timeoutHandle !== null) {
                        window.clearTimeout(timeoutHandle);
                    }
                }
                return;
            }
            await maybePromise;
        }
        catch {
            // Keep load resilient; fallback UI refresh path remains active.
        }
    };
    const ensureRobotMetadataReadyBeforeInteractive = async () => {
        if (!warmupRobotMetadata)
            return;
        if (!resolveRobotMetadataBeforeReady)
            return;
        if (!isLoadStillActive())
            return;
        if (window.driver !== state.driver)
            return;
        if (isRobotMetadataReady())
            return;
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.startRobotMetadataWarmupForStage !== "function")
            return;
        await awaitRobotMetadataWarmup(activeRenderInterface, {
            force: strictOneShot,
            honorBudget: true,
        });
        if (strictOneShot && !isRobotMetadataReady()) {
            await awaitRobotMetadataWarmup(activeRenderInterface, {
                force: true,
                honorBudget: false,
            });
        }
        if (isRobotMetadataReady()) {
            markLoadPhase("robot-metadata-ready-before-interactive");
        }
    };
    runRuntimeBridgeWarmup("driver-init", {
        force: true,
        // Driver-init runs before first draw; runtime link paths are often incomplete.
        // Defer metadata snapshot fetch to post-draw/ready stage to avoid caching
        // empty metadata and causing delayed first interaction.
        includeRobotMetadata: false,
    });
    runFinalStageOverrideBatchPrefetch("driver-init", { force: false });
    refreshPrefetchedStageTransforms("driver-init", { force: false });
    if (prefetchProtoDataBlobsBeforeDraw && !protoBlobPrefetchedBeforeDraw) {
        const prefetched = runProtoBlobPrefetch({ force: true });
        protoBlobPrefetchedBeforeDraw = prefetched > 0;
        if (protoBlobPrefetchedBeforeDraw) {
            markLoadPhase("proto-blob-prefetch-before-draw");
        }
    }
    markLoadPhase("stage-transform-prefetch-done");
    setMessage("Loading meshes...");
    setProgress(38);
    markLoadPhase("driver-created");
    const runInstrumentedDriverDraw = (sourceLabel, options = {}) => {
        const renderInterface = window.renderInterface;
        const beginHydraDrawPhase = renderInterface?.beginHydraDrawPhase;
        const endHydraDrawPhase = renderInterface?.endHydraDrawPhase;
        const canProfilePhases = typeof beginHydraDrawPhase === "function" && typeof endHydraDrawPhase === "function";
        const canMarkHydraSync = typeof performance !== "undefined"
            && typeof performance.mark === "function"
            && typeof performance.measure === "function";
        if (canProfilePhases) {
            try {
                beginHydraDrawPhase.call(renderInterface, sourceLabel);
            }
            catch {
                // Keep draw resilient even when instrumentation fails.
            }
        }
        try {
            if (canMarkHydraSync) {
                try {
                    performance.mark("hydra-sync-start");
                }
                catch { }
            }
            state.driver.Draw();
            runEagerRender(sourceLabel, { forceRender: options.forceRender });
            return true;
        }
        catch (drawError) {
            state.drawFailed = true;
            void drawError;
            return false;
        }
        finally {
            if (canMarkHydraSync) {
                try {
                    performance.mark("hydra-sync-end");
                    performance.measure("Hydra Sync Blocking", "hydra-sync-start", "hydra-sync-end");
                }
                catch { }
            }
            if (canProfilePhases) {
                try {
                    endHydraDrawPhase.call(renderInterface);
                }
                catch {
                    // Keep draw resilient even when instrumentation fails.
                }
            }
        }
    };
    let earlyFinalStageOverrideBatchPrimeScheduled = false;
    const scheduleEarlyFinalStageOverrideBatchPrime = () => {
        if (!primeFinalStageOverrideBatchBeforeDraw)
            return;
        if (earlyFinalStageOverrideBatchPrimeScheduled)
            return;
        earlyFinalStageOverrideBatchPrimeScheduled = true;
        const runPrime = () => {
            if (!isLoadStillActive())
                return;
            const renderInterface = window.renderInterface;
            if (!renderInterface || typeof renderInterface.prefetchFinalStageOverrideBatchFromDriver !== "function")
                return;
            const resolvedDriver = state.driver || null;
            if (!resolvedDriver)
                return;
            try {
                const summary = renderInterface.prefetchFinalStageOverrideBatchFromDriver(resolvedDriver, {
                    force: false,
                });
                const count = Number(summary?.count || 0);
                if (Number.isFinite(count) && count > 0) {
                    markLoadPhase("stage-overrides-batch-primed-pre-burst");
                }
            }
            catch {
                // Keep pre-initial override priming best-effort and non-blocking.
            }
        };
        const requestIdle = window.requestIdleCallback;
        if (typeof requestIdle === "function") {
            window.setTimeout(() => {
                try {
                    requestIdle(() => runPrime(), { timeout: 2500 });
                }
                catch {
                    runPrime();
                }
            }, 0);
            return;
        }
        window.setTimeout(runPrime, 0);
    };
    if (fastLoad) {
        // Fast path: draw once for first visual feedback, then run a bounded
        // draw burst to rapidly hydrate meshes while the load screen is visible.
        if (!isLoadStillActive())
            return state;
        const initialDrawStartMs = profileNow();
        const safeDraw = (forceRender = false) => runInstrumentedDriverDraw("load-fast", { forceRender });
        const updateStreamingStatus = () => {
            const stats = getMeshLoadStats(window.renderInterface);
            const meshReadyPercent = Math.min(100, Math.round((stats.ready / Math.max(stats.total, 1)) * 100));
            setMessage(`Streaming meshes... ${stats.ready}/${Math.max(stats.total, 1)} ready`);
            setProgress(88 + (meshReadyPercent * 0.03));
            return stats;
        };
        let stats = { total: 0, ready: 0, collisions: 0, visuals: 0 };
        if (safeDraw(drawBurstRenderEveryDraw)) {
            scheduleEarlyFinalStageOverrideBatchPrime();
            stats = updateStreamingStatus();
        }
        if (!state.drawFailed && aggressiveInitialDraw) {
            for (;;) {
                if (!isLoadStillActive())
                    return state;
                const elapsedMs = profileNow() - initialDrawStartMs;
                const readyRatio = stats.total > 0 ? stats.ready / stats.total : 0;
                if (initialDrawBudgetMs > 0 && elapsedMs >= initialDrawBudgetMs)
                    break;
                if (stats.total > 0 && readyRatio >= initialDrawTargetReadyRatio)
                    break;
                let drewInBurst = false;
                for (let drawIndex = 0; drawIndex < initialDrawBurst; drawIndex++) {
                    if (!isLoadStillActive())
                        return state;
                    if (initialDrawBudgetMs > 0 && (profileNow() - initialDrawStartMs) >= initialDrawBudgetMs)
                        break;
                    if (!safeDraw(drawBurstRenderEveryDraw))
                        break;
                    drewInBurst = true;
                }
                if (!drewInBurst || state.drawFailed)
                    break;
                stats = updateStreamingStatus();
                const burstReadyRatio = stats.total > 0 ? stats.ready / stats.total : 0;
                if (stats.total > 0 && burstReadyRatio >= initialDrawTargetReadyRatio)
                    break;
                await yieldToMainThread(initialDrawYieldMs);
            }
        }
        stats = updateStreamingStatus();
    }
    else {
        let previousTotal = -1;
        let previousReady = -1;
        let stableRounds = 0;
        for (let round = 0; round < 24; round++) {
            if (!isLoadStillActive())
                return state;
            if (!runInstrumentedDriverDraw("load-slow"))
                break;
            if (round === 0) {
                scheduleEarlyFinalStageOverrideBatchPrime();
            }
            const stats = getMeshLoadStats(window.renderInterface);
            setMessage(`Loading meshes... ${stats.ready}/${Math.max(stats.total, 1)} ready`);
            const meshReadyPercent = Math.min(100, Math.round((stats.ready / Math.max(stats.total, 1)) * 100));
            setProgress(38 + (meshReadyPercent * 0.52));
            if (stats.total === previousTotal && stats.ready === previousReady)
                stableRounds++;
            else
                stableRounds = 0;
            previousTotal = stats.total;
            previousReady = stats.ready;
            if (stats.total > 0 && stats.ready > 0 && stableRounds >= 2)
                break;
            await yieldToMainThread(45);
        }
        if (!isLoadStillActive())
            return state;
        setProgress(92);
        runInstrumentedDriverDraw("load-finalize");
    }
    markLoadPhase("initial-draw-done");
    runRuntimeBridgeWarmup("post-initial-draw", {
        // Strict one-shot refreshes bridge caches after first draw so staged proto
        // overrides/transforms are not locked to pre-draw provisional values.
        force: strictOneShot,
        includeRobotMetadata: strictOneShot && warmupRobotMetadata,
    });
    runFinalStageOverrideBatchPrefetch("post-initial-draw", { force: strictOneShot });
    if (warmupRobotMetadata && !resolveRobotMetadataBeforeReady) {
        const scheduleRobotMetadataWarmup = () => {
            const runWarmup = () => {
                const renderInterface = window.renderInterface;
                if (!renderInterface || typeof renderInterface.startRobotMetadataWarmupForStage !== "function")
                    return;
                if (!isLoadStillActive())
                    return;
                if (window.driver !== state.driver)
                    return;
                void Promise.resolve(renderInterface.startRobotMetadataWarmupForStage({
                    force: false,
                    skipIdleWait: eagerRobotMetadataWarmup,
                    skipUrdfTruthFallback: skipUrdfTruthDuringEagerWarmup,
                })).catch(() => {
                    // Robot metadata warmup is best-effort.
                });
            };
            if (eagerRobotMetadataWarmup) {
                // Prioritize joint metadata readiness: use the WASM snapshot path
                // immediately after the first frame instead of waiting for deep idle.
                window.requestAnimationFrame(() => {
                    window.setTimeout(() => runWarmup(), 0);
                });
                return;
            }
            const requestIdle = window.requestIdleCallback;
            const minIdleBudgetMs = 6;
            const maxIdleAttempts = 8;
            const idleTimeoutMs = 1800;
            let idleAttempts = 0;
            const scheduleWhenIdle = () => {
                if (!isLoadStillActive())
                    return;
                if (window.driver !== state.driver)
                    return;
                if (typeof requestIdle !== "function") {
                    runWarmup();
                    return;
                }
                try {
                    requestIdle((deadline) => {
                        if (!isLoadStillActive())
                            return;
                        if (window.driver !== state.driver)
                            return;
                        const remaining = Number(deadline?.timeRemaining?.() || 0);
                        const timedOut = deadline?.didTimeout === true;
                        if (!timedOut && remaining < minIdleBudgetMs && idleAttempts < maxIdleAttempts) {
                            idleAttempts += 1;
                            window.setTimeout(() => scheduleWhenIdle(), 0);
                            return;
                        }
                        runWarmup();
                    }, { timeout: idleTimeoutMs });
                }
                catch {
                    runWarmup();
                }
            };
            // Give first render + one RAF a chance to settle before any metadata warmup.
            window.requestAnimationFrame(() => {
                window.setTimeout(() => scheduleWhenIdle(), 0);
            });
        };
        scheduleRobotMetadataWarmup();
    }
    if (profileTextureLoads) {
        const textureSnapshot = window.renderInterface?.registry?.getTextureLoadSnapshot?.();
        if (textureSnapshot) {
            const managerPending = Number(textureSnapshot?.manager?.pending || 0);
            void managerPending;
        }
    }
    // A second transform prefetch after the first draw burst avoids stale
    // early-stage matrices and fixes proto links that rely on GfQuatd xform ops.
    const postDrawTransformSummary = refreshPrefetchedStageTransforms("post-initial-draw", {
        force: strictOneShot,
    });
    const postDrawPrefetchedTransformCount = Number(postDrawTransformSummary.total || 0);
    const shouldRunPostDrawProtoResync = (postDrawProtoResyncEnabled || forcePostDrawProtoResync) && (forcePostDrawProtoResync
        || postDrawPrefetchedTransformCount > 0);
    if (window.renderInterface?.meshes && shouldRunPostDrawProtoResync) {
        const protoMeshes = Object.values(window.renderInterface.meshes).filter((hydraMesh) => {
            if (!hydraMesh || typeof hydraMesh._id !== "string")
                return false;
            const meshId = String(hydraMesh._id || "");
            return meshId.includes(".proto_");
        });
        let protoResynced = 0;
        for (let meshIndex = 0; meshIndex < protoMeshes.length; meshIndex++) {
            if (!isLoadStillActive())
                return state;
            const hydraMesh = protoMeshes[meshIndex];
            try {
                if (typeof hydraMesh.resyncProtoTransformOnly === "function") {
                    hydraMesh.resyncProtoTransformOnly();
                    protoResynced += 1;
                }
                else if (typeof hydraMesh.applyProtoStageSync === "function") {
                    hydraMesh.applyProtoStageSync();
                    protoResynced += 1;
                }
                else {
                    if (typeof hydraMesh.syncProtoTransformFromFallback === "function") {
                        hydraMesh.syncProtoTransformFromFallback();
                    }
                    if (typeof hydraMesh.syncCollisionRotationFromVisualLink === "function") {
                        hydraMesh.syncCollisionRotationFromVisualLink();
                    }
                }
            }
            catch {
                // Keep load resilient even if a single proto mesh fails to resync.
            }
            if ((meshIndex + 1) % postDrawProtoResyncChunk === 0) {
                const ratio = protoMeshes.length > 0
                    ? Math.min(1, (meshIndex + 1) / protoMeshes.length)
                    : 1;
                const progressBase = fastLoad ? 92 : 95;
                const progressSpan = fastLoad ? 2 : 1;
                setProgress(progressBase + (ratio * progressSpan));
                setMessage(`Resyncing proto transforms... ${meshIndex + 1}/${Math.max(protoMeshes.length, 1)}`);
                await yieldToMainThread();
            }
        }
        if (profileLoad && protoMeshes.length > 0) {
            void protoResynced;
        }
    }
    else if (profileLoad) {
        void postDrawPrefetchedTransformCount;
    }
    applyMeshFilters();
    if (readStageMetadata) {
        setMessage("Resolving stage metadata...");
    }
    else {
        setMessage("Finishing load...");
    }
    setProgress(fastLoad ? 92 : 95);
    await yieldToMainThread();
    let stage = null;
    const inferredStageUpAxis = inferStageUpAxisFromPath(normalizedPath);
    window.usdStage = null;
    let stageResolvedWithinBudget = false;
    let resolveStagePromise = null;
    const shouldAttemptStageResolve = (readStageMetadata || truthFirst || allowDriverStageLookup)
        && state.driver
        && typeof state.driver.GetStage === "function";
    if (shouldAttemptStageResolve) {
        resolveStagePromise = (async () => {
            let resolvedStage = null;
            resolvedStage = state.driver.GetStage();
            if (resolvedStage && typeof resolvedStage.then === "function") {
                await resolvedStage;
                resolvedStage = state.driver.GetStage();
            }
            return resolvedStage || null;
        })();
        if (strictOneShot) {
            try {
                stage = await resolveStagePromise;
                stageResolvedWithinBudget = true;
                window.usdStage = stage || null;
            }
            catch {
                stageResolvedWithinBudget = false;
            }
        }
        else if (stageMetadataBudgetMs > 0) {
            let timeoutHandle = null;
            try {
                const stageResult = await Promise.race([
                    resolveStagePromise.then((resolvedStage) => ({
                        kind: "stage",
                        stage: resolvedStage || null,
                    })),
                    new Promise((resolve) => {
                        timeoutHandle = window.setTimeout(() => resolve({ kind: "timeout" }), stageMetadataBudgetMs);
                    }),
                ]);
                if (stageResult.kind === "stage") {
                    stageResolvedWithinBudget = true;
                    stage = stageResult.stage || null;
                    window.usdStage = stage;
                }
            }
            catch {
                stageResolvedWithinBudget = false;
            }
            finally {
                if (timeoutHandle !== null) {
                    window.clearTimeout(timeoutHandle);
                }
            }
        }
    }
    if (!isLoadStillActive())
        return state;
    markLoadPhase(stageResolvedWithinBudget ? "stage-ready" : "stage-ready-deferred");
    if (directStageMeshRead && stage && window.renderInterface && typeof window.renderInterface.hydrateMissingMeshGeometryFromStage === "function") {
        try {
            const hydrationSummary = window.renderInterface.hydrateMissingMeshGeometryFromStage();
            if (hydrationSummary && Number(hydrationSummary.hydrated || 0) > 0) {
                applyMeshFilters();
                void hydrationSummary;
            }
        }
        catch {
            // Keep load path quiet; fallback remains active.
        }
    }
    markLoadPhase("stage-mesh-fastpath");
    const refreshMeshStageOverrides = () => {
        const includeVisualStageOverrides = !!loadVisualPrims && !!applyVisualStageOverrides;
        try {
            window.renderInterface?.refreshMeshStageOverrides?.({
                includeCollision: !!loadCollisionPrims,
                includeVisual: includeVisualStageOverrides,
            });
        }
        catch {
            // Keep load resilient and quiet.
        }
        applyMeshFilters();
    };
    const shouldRunStageOverrides = !!loadCollisionPrims || !loadVisualPrims || applyVisualStageOverrides;
    if (!shouldRunStageOverrides) {
        setMessage("Finishing load...");
        setProgress(fastLoad ? 96 : 98);
    }
    else if (deferStageOverrides) {
        setMessage("Finishing load...");
        const currentRenderInterface = window.renderInterface || null;
        const runDeferredStageOverrides = () => {
            if (!isLoadStillActive())
                return;
            if ((window.renderInterface || null) !== currentRenderInterface)
                return;
            if (!currentRenderInterface || typeof currentRenderInterface.refreshMeshStageOverrides !== "function") {
                refreshMeshStageOverrides();
                return;
            }
            // Prime the final-stage override batch once before chunked refresh.
            // This avoids expensive per-mesh proto blob fallback work on the main
            // thread while still keeping stage overrides deferred/off critical path.
            let allowPerMeshFallbackDuringDeferredChunks = true;
            if (typeof currentRenderInterface.prefetchFinalStageOverrideBatchFromDriver === "function") {
                try {
                    const resolvedDriver = state.driver || window.driver || null;
                    if (resolvedDriver) {
                        const batchSummary = currentRenderInterface.prefetchFinalStageOverrideBatchFromDriver(resolvedDriver, {
                            force: false,
                        }) || {};
                        const batchCount = Number(batchSummary?.count || 0);
                        const batchProtoMeshCount = Number(batchSummary?.protoMeshCount || 0);
                        if (Number.isFinite(batchCount)
                            && Number.isFinite(batchProtoMeshCount)
                            && batchProtoMeshCount > 0
                            && batchCount >= batchProtoMeshCount) {
                            allowPerMeshFallbackDuringDeferredChunks = false;
                        }
                    }
                }
                catch {
                    // Keep deferred overrides best-effort.
                }
            }
            let nextIndex = 0;
            const scheduleChunk = (next, delayMs) => {
                const requestIdle = window.requestIdleCallback;
                const shouldUseIdle = deferStageOverridesUseIdle && typeof requestIdle === "function";
                window.setTimeout(() => {
                    if (shouldUseIdle) {
                        try {
                            requestIdle(() => next(), { timeout: Math.max(120, delayMs + 120) });
                            return;
                        }
                        catch {
                            // Fall through to immediate callback.
                        }
                    }
                    next();
                }, delayMs);
            };
            const runChunk = () => {
                if (!isLoadStillActive())
                    return;
                if ((window.renderInterface || null) !== currentRenderInterface)
                    return;
                const tickStartedAtMs = profileNow();
                let done = false;
                while (!done) {
                    let summary = null;
                    try {
                        summary = currentRenderInterface.refreshMeshStageOverrides({
                            includeCollision: !!loadCollisionPrims,
                            includeVisual: !!loadVisualPrims && !!applyVisualStageOverrides,
                            startIndex: nextIndex,
                            chunkSize: deferredStageOverridesChunkSize,
                            prefetchFinalStageBatch: false,
                            allowPerMeshFallback: allowPerMeshFallbackDuringDeferredChunks,
                            reuseProtoMeshCache: true,
                        });
                    }
                    catch {
                        return;
                    }
                    done = summary && typeof summary === "object"
                        ? summary.done === true
                        : true;
                    const reportedNextIndex = Number(summary?.nextIndex);
                    nextIndex = Number.isFinite(reportedNextIndex)
                        ? Math.max(0, Math.floor(reportedNextIndex))
                        : (nextIndex + deferredStageOverridesChunkSize);
                    if (done)
                        break;
                    const elapsedMs = Math.max(0, profileNow() - tickStartedAtMs);
                    if (elapsedMs >= deferredStageOverridesWorkBudgetMs)
                        break;
                }
                if (done) {
                    applyMeshFilters();
                }
                else {
                    scheduleChunk(runChunk, deferredStageOverridesChunkDelayMs);
                }
            };
            scheduleChunk(runChunk, 0);
        };
        window.setTimeout(runDeferredStageOverrides, deferredStageOverridesStartDelayMs);
        setProgress(96);
    }
    else {
        setMessage("Applying transform/collision fixes...");
        refreshMeshStageOverrides();
        setProgress(fastLoad ? 96 : 98);
    }
    markLoadPhase("stage-overrides-applied");
    state.timeout = 40;
    state.endTimeCode = 0;
    if (stage?.GetEndTimeCode) {
        const stageEndTimeCode = Number(stage.GetEndTimeCode());
        const stageTimeCodesPerSecond = Number(stage.GetTimeCodesPerSecond ? stage.GetTimeCodesPerSecond() : 0);
        state.endTimeCode = Number.isFinite(stageEndTimeCode) && stageEndTimeCode > 0 ? stageEndTimeCode : 0;
        state.timeout = Number.isFinite(stageTimeCodesPerSecond) && stageTimeCodesPerSecond > 0 ? 1000 / stageTimeCodesPerSecond : 40;
    }
    let stageUpAxis = inferredStageUpAxis;
    if (stage?.GetUpAxis) {
        try {
            const resolvedAxis = String.fromCharCode(stage.GetUpAxis()).toLowerCase();
            if (resolvedAxis === "y" || resolvedAxis === "z") {
                stageUpAxis = resolvedAxis;
            }
        }
        catch { }
    }
    window.usdRoot.rotation.x = stageUpAxis === "z" ? -Math.PI / 2 : 0;
    const fitted = fitCameraToSelection(window.camera, window._controls, [window.usdRoot], 1.5, params);
    if (!fitted) {
        scheduleCameraRefit(window.camera, window._controls, [window.usdRoot], params);
    }
    await ensureRobotMetadataReadyBeforeInteractive();
    if (!isLoadStillActive())
        return state;
    if (strictOneShot && prefetchProtoDataBlobs && !protoBlobPrefetchedBeforeDraw) {
        const prefetchedNow = runProtoBlobPrefetch({ force: true });
        if (prefetchedNow > 0) {
            protoBlobPrefetchedBeforeDraw = true;
            markLoadPhase("proto-blob-prefetch-before-ready");
        }
    }
    state.ready = true;
    rebuildLinkAxes();
    markLoadPhase("camera-and-link-axes-done");
    const root = {};
    if (usdFsHelper.canOperateOnUsdFilesystem()) {
        usdFsHelper.addPath(root, "/");
        void debugFileHandling;
    }
    const loadedMeshCount = window.renderInterface?.meshes ? Object.keys(window.renderInterface.meshes).length : 0;
    if (loadedMeshCount === 0) {
        if (!loadVisualPrims && !loadCollisionPrims) {
            setMessage("Both visual and collision meshes are disabled (showVisuals=0 & showCollisions=0).");
        }
        else if (isLikelyNonRenderableUsdConfig(normalizedPath)) {
            setMessage("This USD config contains no renderable meshes (sensor/robot metadata only).");
        }
        else {
            setMessage("No geometry loaded. If this file has external dependencies, upload the whole folder.");
        }
    }
    else {
        const stats = getMeshLoadStats(window.renderInterface);
        setMessage(`Loaded ${stats.total} meshes (visual: ${stats.visuals}, collision: ${stats.collisions}).`);
    }
    // Force one render before reporting 100% so shader compile/GPU upload cost
    // is paid while still inside the loading phase instead of after UI completion.
    runEagerRender("pre-complete", { forceRender: true });
    setProgress(100, true);
    hideProgress();
    if (!strictOneShot) {
        scheduleProtoBlobPrefetch();
    }
    flushLoadProfile("ok");
    if (!strictOneShot && resolveStagePromise && !stageResolvedWithinBudget) {
        const activeRenderInterface = window.renderInterface || null;
        const activeDriver = state.driver;
        const fallbackUpAxis = stageUpAxis;
        void resolveStagePromise.then((resolvedStage) => {
            if (!resolvedStage)
                return;
            if (!isLoadStillActive())
                return;
            if ((window.renderInterface || null) !== activeRenderInterface)
                return;
            if (window.driver !== activeDriver)
                return;
            window.usdStage = resolvedStage;
            let resolvedUpAxis = fallbackUpAxis;
            if (typeof resolvedStage.GetUpAxis === "function") {
                try {
                    const rawAxis = String.fromCharCode(resolvedStage.GetUpAxis()).toLowerCase();
                    if (rawAxis === "y" || rawAxis === "z") {
                        resolvedUpAxis = rawAxis;
                    }
                }
                catch { }
            }
            window.usdRoot.rotation.x = resolvedUpAxis === "z" ? -Math.PI / 2 : 0;
        }).catch(() => {
            // Keep background stage resolution best-effort.
        });
    }
    return state;
}
