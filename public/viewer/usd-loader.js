// @ts-ignore runtime cache-busting query suffix is resolved by browser ESM loader.
import { ThreeRenderDelegateInterface } from "/usd/hydra/ThreeJsRenderDelegate.js?v=20260318a";
import { fitCameraToSelection, scheduleCameraRefit } from "./camera.js";
import { getDirectoryFromVirtualPath, isLikelyNonRenderableUsdConfig, normalizeUsdPath, parseBooleanFlag } from "./path-utils.js";
const COLLISION_SEGMENT_PATTERN = /(?:^|\/)collisions?(?:$|[/.])/i;
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
    let total = 0;
    let ready = 0;
    let collisions = 0;
    let visuals = 0;
    const shouldCountMesh = (id, mesh) => {
        const normalizedId = String(id || "");
        if (!normalizedId)
            return false;
        const positionCount = Number(mesh?._mesh?.geometry?.getAttribute?.("position")?.count || 0);
        if (positionCount > 0)
            return true;
        if (normalizedId.includes(".proto_"))
            return true;
        const isTopLevelPlaceholderMesh = /^\/(?:meshes|visuals|colliders?|collision)\//i.test(normalizedId);
        if (!isTopLevelPlaceholderMesh)
            return true;
        const resolvedPath = renderInterface?.getResolvedPrimPathForMeshId?.(normalizedId)
            || renderInterface?.getResolvedVisualTransformPrimPathForMeshId?.(normalizedId)
            || null;
        return !!resolvedPath;
    };
    for (const [id, mesh] of entries) {
        if (!shouldCountMesh(String(id || ""), mesh))
            continue;
        total += 1;
        const geometry = mesh?._mesh?.geometry;
        const positionAttribute = geometry?.getAttribute?.("position");
        if (positionAttribute && positionAttribute.count > 0)
            ready++;
        if (COLLISION_SEGMENT_PATTERN.test(id))
            collisions++;
        else
            visuals++;
    }
    return {
        total,
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
function inferDependencyStemForUsdPath(stagePath, fileName) {
    const normalizedPath = String(stagePath || "").toLowerCase();
    const normalizedFileName = String(fileName || "").trim();
    const inferredStem = normalizedFileName.replace(/\.usd[a-z]?$/i, "");
    if (!inferredStem)
        return "";
    if (!normalizedPath.includes("/configuration/"))
        return inferredStem;
    return inferredStem.replace(/_(base|physics|robot|sensor)$/i, "");
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
    const forceDependencyPreload = parseBooleanFlag(params.get("forceDependencyPreload"), false);
    const autoLoadDependencies = parseBooleanFlag(params.get("autoLoadDependencies"), true);
    const strictOneShot = parseBooleanFlag(params.get("strictOneShot"), true);
    const normalizedPathForDependencyDefaults = String(pathToLoad || "").toLowerCase();
    const isConfigurationUsdPath = normalizedPathForDependencyDefaults.includes("/configuration/");
    const inferredSkipSensorPayloadsOnOpen = (!isConfigurationUsdPath
        && (normalizedPathForDependencyDefaults.includes("/unitree_model/")
            || normalizedPathForDependencyDefaults.includes("/robots/")));
    const hasExplicitIncludeSensorDependency = params.has("includeSensorDependency");
    const includeSensorDependencyFallback = hasExplicitIncludeSensorDependency
        ? parseBooleanFlag(params.get("includeSensorDependency"), false)
        : !inferredSkipSensorPayloadsOnOpen;
    const skipSensorPayloadsOnOpen = parseBooleanFlag(params.get("skipSensorPayloadsOnOpen"), hasExplicitIncludeSensorDependency
        ? !includeSensorDependencyFallback
        : inferredSkipSensorPayloadsOnOpen);
    const defaultIncludeSensorDependency = normalizedPathForDependencyDefaults.includes("/unitree_model/")
        || normalizedPathForDependencyDefaults.includes("/robots/");
    const includeSensorDependency = parseBooleanFlag(params.get("includeSensorDependency"), skipSensorPayloadsOnOpen ? false : defaultIncludeSensorDependency);
    const warmupRuntimeBridge = true;
    const warmupRuntimeBridgeBeforeDraw = false;
    const warmupRobotMetadata = true;
    const resolveRobotMetadataBeforeReady = true;
    const requireCompleteRobotMetadata = true;
    const maxCpuDraw = parseBooleanFlag(params.get("maxCpuDraw"), false);
    // Favor full-scene readiness during the loading phase to avoid long tail mesh hydration.
    const aggressiveInitialDraw = parseBooleanFlag(params.get("aggressiveInitialDraw"), true);
    const drawBurstRenderEveryDraw = parseBooleanFlag(params.get("drawBurstRenderEveryDraw"), aggressiveInitialDraw);
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
    const finalSceneDrainBudgetMs = (() => {
        const requested = Number(params.get("finalSceneDrainBudgetMs"));
        const fallback = strictOneShot
            ? (maxCpuDraw ? 12000 : 8000)
            : initialDrawBudgetMs;
        if (!Number.isFinite(requested))
            return fallback;
        return Math.max(0, Math.min(120000, Math.floor(requested)));
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
    const buildPlaceholderUsdBinary = (defaultPrimName) => {
        if (typeof TextEncoder === "undefined")
            return null;
        const normalizedPrimName = String(defaultPrimName || "Config").trim() || "Config";
        return new TextEncoder().encode([
            "#usda 1.0",
            "(",
            `    defaultPrim = "${normalizedPrimName}"`,
            ")",
            "",
            `def Xform "${normalizedPrimName}"`,
            "{",
            "}",
            "",
        ].join("\n"));
    };
    const shouldSeedMissingOptionalConfigurationPlaceholders = (!isConfigurationUsdPath
        && (normalizedPathForDependencyDefaults.includes("/unitree_model/")
            || normalizedPathForDependencyDefaults.includes("/robots/")));
    const seedMissingOptionalConfigurationPlaceholder = (fileName, defaultPrimName = "Config") => {
        if (!canWriteVirtualFs)
            return false;
        if (!fileName)
            return false;
        const placeholderBinary = buildPlaceholderUsdBinary(defaultPrimName);
        if (!placeholderBinary)
            return false;
        const rootDirectory = getDirectoryFromVirtualPath(normalizedPath);
        const configurationDirectory = rootDirectory.toLowerCase().endsWith("/configuration/")
            ? rootDirectory
            : normalizeUsdPath(`${rootDirectory}configuration/`);
        const localConfigurationPath = normalizeUsdPath(`${configurationDirectory}${fileName}`);
        const sharedConfigurationPath = normalizeUsdPath(`/configuration/${fileName}`);
        if (!usdFsHelper.hasVirtualFilePath(localConfigurationPath)) {
            writeBinaryToVirtualPath(localConfigurationPath, placeholderBinary);
        }
        if (sharedConfigurationPath !== localConfigurationPath && !usdFsHelper.hasVirtualFilePath(sharedConfigurationPath)) {
            writeBinaryToVirtualPath(sharedConfigurationPath, placeholderBinary);
        }
        return true;
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
            const configurationDirectory = rootDirectory.toLowerCase().endsWith("/configuration/")
                ? rootDirectory
                : normalizeUsdPath(`${rootDirectory}configuration/`);
            const localConfigurationPath = normalizeUsdPath(`${configurationDirectory}${fileName}`);
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
            if (!loadedBinary) {
                const shouldSeedPlaceholder = shouldSeedMissingOptionalConfigurationPlaceholders
                    && /_(base|physics|robot)\.usd$/i.test(fileName);
                if (shouldSeedPlaceholder) {
                    seedMissingOptionalConfigurationPlaceholder(fileName);
                }
                return;
            }
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
    const seedOptionalSensorPlaceholder = (dependencyStem) => {
        if (!canWriteVirtualFs)
            return;
        if (!dependencyStem)
            return;
        if (includeSensorDependency)
            return;
        if (!skipSensorPayloadsOnOpen)
            return;
        seedMissingOptionalConfigurationPlaceholder(`${dependencyStem}_sensor.usd`, "Sensors");
    };
    const shouldPreloadRootLayerToVirtualFs = normalizedPath.startsWith("/");
    if (shouldPreloadRootLayerToVirtualFs) {
        const rootLayerLoaded = await ensureVirtualFileFromCandidates(normalizedPath, [normalizedPath]);
        if (rootLayerLoaded) {
            // Root layer is available in WASM FS.
        }
    }
    const normalizedFileName = normalizedPath.split("/").pop()?.toLowerCase() || "";
    const inferredStem = inferDependencyStemForUsdPath(normalizedPath, normalizedFileName);
    const dependencyStem = unitreeDependencyStemByRootUsdFile[normalizedFileName] || inferredStem;
    const normalizedPathLower = normalizedPath.toLowerCase();
    const shouldAutoLoadDependenciesFromVirtualFs = usdFsHelper.hasVirtualFilePath(normalizedPath);
    const shouldAutoLoadDependenciesFromUnitreePath = normalizedPathLower.startsWith("/unitree_model/");
    const isPiperSceneUsdPath = normalizedPathLower.startsWith("/piper_isaac_sim/usd/");
    const shouldAutoLoadInferredRootDependencies = shouldAutoLoadDependenciesFromVirtualFs && !isPiperSceneUsdPath;
    if (autoLoadDependencies
        && dependencyStem
        && (shouldAutoLoadInferredRootDependencies || shouldAutoLoadDependenciesFromUnitreePath || forceDependencyPreload)) {
        await autoLoadSublayers(dependencyStem);
    }
    if (dependencyStem) {
        seedOptionalSensorPlaceholder(dependencyStem);
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
        // In snapshot/one-shot mode, all heavy bridge payloads should arrive before
        // ready; disable on-demand fallback pulls so interaction stays cache-only.
        strictOneShotSceneLoad: strictOneShot,
        autoBatchProtoBlobsOnFirstAccess: false,
        autoBatchPrimTransformsOnFirstAccess: false,
        autoBatchCollisionProtoOverridesOnFirstAccess: false,
        autoBatchVisualProtoOverridesOnFirstAccess: false,
        deferHiddenCollisionProtoSyncInCommit: false,
        // During high-frequency Hydra sync callbacks, avoid fallback driver.GetStage()
        // lookups before window.usdStage is ready to prevent first-sync stalls.
        deferDriverStageLookupInSyncHotPath: parseBooleanFlag(params.get("deferDriverStageLookupInSyncHotPath"), true),
        // For fast interactive loads, avoid synchronous driver.GetStage() fallback unless
        // metadata access is explicitly enabled.
        allowDriverStageLookup: false,
        // Unitree root stages can skip optional sensor payloads during stage open.
        // This avoids composing/fetching sensor-only payloads on the critical path.
        skipSensorPayloadsOnOpen,
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
    const runRuntimeBridgeWarmup = (phaseLabel, options = {}) => {
        if (!warmupRuntimeBridge)
            return null;
        if (phaseLabel !== "post-initial-draw" && !warmupRuntimeBridgeBeforeDraw)
            return null;
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.warmupRobotSceneSnapshotFromDriver !== "function")
            return null;
        if (!isLoadStillActive())
            return null;
        if (window.driver !== state.driver)
            return null;
        try {
            const summary = activeRenderInterface.warmupRobotSceneSnapshotFromDriver(state.driver, {
                force: options.force === true,
                stageSourcePath: normalizedPath,
                emitRobotMetadataEvent: false,
            });
            if (summary && typeof summary === "object") {
                markLoadPhase(`runtime-bridge-warmup-${phaseLabel}`);
            }
            return summary && typeof summary === "object" ? summary : null;
        }
        catch {
            return null;
        }
    };
    const getPendingProtoHydrationCount = (summary) => {
        if (!summary || typeof summary !== "object")
            return null;
        const rawPending = Number(summary.hydratedProtoMeshPendingCount ?? summary.pendingCount);
        if (Number.isFinite(rawPending) && rawPending >= 0) {
            return Math.max(0, Math.floor(rawPending));
        }
        const rawAttempted = Number(summary.hydratedProtoMeshAttemptedCount ?? summary.attemptedCount);
        const rawCompleted = Number(summary.hydratedProtoMeshCount ?? summary.completedCount);
        if (Number.isFinite(rawAttempted) && rawAttempted >= 0 && Number.isFinite(rawCompleted) && rawCompleted >= 0) {
            return Math.max(0, Math.floor(rawAttempted) - Math.floor(rawCompleted));
        }
        return null;
    };
    const hasRuntimeBridgeCompletedProtoHydration = (summary) => {
        if (!summary || typeof summary !== "object")
            return false;
        if (summary.sceneSnapshotReady !== true)
            return false;
        const pendingCount = getPendingProtoHydrationCount(summary);
        return pendingCount === 0;
    };
    const runProtoHydrationPass = () => {
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.hydratePendingProtoMeshes !== "function")
            return null;
        if (!isLoadStillActive())
            return null;
        if (window.driver !== state.driver)
            return null;
        try {
            return activeRenderInterface.hydratePendingProtoMeshes({ allowDeferredFinalBatch: false }) || null;
        }
        catch {
            return null;
        }
    };
    const getPendingResolvedPrimHydrationCount = (summary) => {
        if (!summary || typeof summary !== "object")
            return null;
        const rawPending = Number(summary.pendingCount);
        if (Number.isFinite(rawPending) && rawPending >= 0) {
            return Math.max(0, Math.floor(rawPending));
        }
        const rawAttempted = Number(summary.attemptedCount);
        const rawCompleted = Number(summary.completedCount);
        if (Number.isFinite(rawAttempted) && rawAttempted >= 0 && Number.isFinite(rawCompleted) && rawCompleted >= 0) {
            return Math.max(0, Math.floor(rawAttempted) - Math.floor(rawCompleted));
        }
        return null;
    };
    const runResolvedPrimHydrationPass = (options = {}) => {
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.hydratePendingResolvedPrimMeshes !== "function")
            return null;
        if (!isLoadStillActive())
            return null;
        if (window.driver !== state.driver)
            return null;
        try {
            return activeRenderInterface.hydratePendingResolvedPrimMeshes({
                driver: state.driver,
                force: options.force === true,
            }) || null;
        }
        catch {
            return null;
        }
    };
    const getRobotSceneStageSnapshot = () => {
        const activeRenderInterface = window.renderInterface;
        if (!activeRenderInterface || typeof activeRenderInterface.getCachedRobotSceneSnapshot !== "function") {
            return null;
        }
        try {
            const stageSourcePath = String(activeRenderInterface.getStageSourcePath?.() || "").trim() || null;
            const snapshot = activeRenderInterface.getCachedRobotSceneSnapshot(stageSourcePath);
            if (!snapshot || typeof snapshot !== "object")
                return null;
            const stageSnapshot = snapshot.stage;
            return stageSnapshot && typeof stageSnapshot === "object" ? stageSnapshot : null;
        }
        catch {
            return null;
        }
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
        if (!hasAnyMetadata) {
            return isLikelyNonRenderableUsdConfig(normalizedPath);
        }
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
        };
    };
    const awaitRobotMetadataWarmup = async (activeRenderInterface, options) => {
        try {
            const maybePromise = activeRenderInterface.startRobotMetadataWarmupForStage(buildRobotMetadataWarmupOptions(options.force));
            if (maybePromise && typeof maybePromise.then === "function") {
                await maybePromise;
            }
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
        await awaitRobotMetadataWarmup(activeRenderInterface, { force: true });
        if (!isRobotMetadataReady()) {
            await awaitRobotMetadataWarmup(activeRenderInterface, { force: true });
        }
        if (isRobotMetadataReady()) {
            markLoadPhase("robot-metadata-ready-before-interactive");
        }
    };
    if (isLikelyNonRenderableUsdConfig(normalizedPath)) {
        runRuntimeBridgeWarmup("driver-init", { force: true });
        const activeRenderInterface = window.renderInterface;
        if (activeRenderInterface && typeof activeRenderInterface.startRobotMetadataWarmupForStage === "function") {
            await awaitRobotMetadataWarmup(activeRenderInterface, { force: true });
        }
        if (!isLoadStillActive())
            return state;
        applyMeshFilters();
        state.ready = true;
        rebuildLinkAxes();
        setMessage("This USD config contains no renderable meshes (sensor/robot metadata only).");
        setProgress(100, true);
        hideProgress();
        flushLoadProfile("ok");
        return state;
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
    if (!isLoadStillActive())
        return state;
    const initialDrawStartMs = profileNow();
    const updateStreamingStatus = () => {
        const stats = getMeshLoadStats(window.renderInterface);
        const meshReadyPercent = Math.min(100, Math.round((stats.ready / Math.max(stats.total, 1)) * 100));
        setMessage(`Streaming meshes... ${stats.ready}/${Math.max(stats.total, 1)} ready`);
        setProgress(88 + (meshReadyPercent * 0.03));
        return stats;
    };
    let stats = { total: 0, ready: 0, collisions: 0, visuals: 0 };
    if (runInstrumentedDriverDraw("load-fast", { forceRender: drawBurstRenderEveryDraw })) {
        stats = updateStreamingStatus();
    }
    runResolvedPrimHydrationPass({ force: true });
    updateStreamingStatus();
    markLoadPhase("initial-draw-done");
    const postInitialDrawWarmupSummary = runRuntimeBridgeWarmup("post-initial-draw", { force: true });
    let needsFinalProtoHydrationPass = !hasRuntimeBridgeCompletedProtoHydration(postInitialDrawWarmupSummary);
    let needsFinalResolvedPrimHydrationPass = false;
    if (needsFinalProtoHydrationPass) {
        const postInitialDrawHydrationSummary = runProtoHydrationPass();
        const pendingProtoHydrationCount = getPendingProtoHydrationCount(postInitialDrawHydrationSummary);
        needsFinalProtoHydrationPass = pendingProtoHydrationCount === null || pendingProtoHydrationCount > 0;
    }
    const postInitialDrawResolvedPrimHydrationSummary = runResolvedPrimHydrationPass({ force: true });
    const pendingResolvedPrimHydrationCount = getPendingResolvedPrimHydrationCount(postInitialDrawResolvedPrimHydrationSummary);
    needsFinalResolvedPrimHydrationPass = (pendingResolvedPrimHydrationCount !== null
        && pendingResolvedPrimHydrationCount > 0);
    if (profileTextureLoads) {
        const textureSnapshot = window.renderInterface?.registry?.getTextureLoadSnapshot?.();
        if (textureSnapshot) {
            const managerPending = Number(textureSnapshot?.manager?.pending || 0);
            void managerPending;
        }
    }
    applyMeshFilters();
    setMessage("Finishing load...");
    setProgress(92);
    await yieldToMainThread();
    const inferredStageUpAxis = inferStageUpAxisFromPath(normalizedPath);
    window.usdStage = null;
    if (!isLoadStillActive())
        return state;
    markLoadPhase("stage-ready");
    markLoadPhase("stage-mesh-fastpath");
    const refreshMeshStageOverrides = () => {
        try {
            window.renderInterface?.refreshMeshStageOverrides?.({
                includeCollision: !!loadCollisionPrims,
                includeVisual: false,
            });
        }
        catch {
            // Keep load resilient and quiet.
        }
        applyMeshFilters();
    };
    const shouldRunStageOverrides = !!loadCollisionPrims || !loadVisualPrims;
    if (!shouldRunStageOverrides) {
    }
    else {
        setMessage("Applying transform/collision fixes...");
        refreshMeshStageOverrides();
        setProgress(96);
    }
    markLoadPhase("stage-overrides-applied");
    const drainStrictOneShotMeshReadiness = async () => {
        if (!strictOneShot || state.drawFailed)
            return;
        const drainStartedAtMs = profileNow();
        let previousReady = -1;
        let previousTotal = -1;
        let previousPendingProto = -1;
        let previousPendingResolvedPrim = -1;
        let stagnantPassCount = 0;
        for (;;) {
            if (!isLoadStillActive())
                return;
            const hydrationSummary = runProtoHydrationPass();
            const resolvedPrimHydrationSummary = runResolvedPrimHydrationPass();
            const pendingProtoCount = Math.max(0, Number(getPendingProtoHydrationCount(hydrationSummary) ?? 0));
            const pendingResolvedPrimCount = Math.max(0, Number(getPendingResolvedPrimHydrationCount(resolvedPrimHydrationSummary) ?? 0));
            stats = updateStreamingStatus();
            const allMeshesReady = stats.total <= 0 || stats.ready >= stats.total;
            if (allMeshesReady && pendingProtoCount === 0 && pendingResolvedPrimCount === 0) {
                return;
            }
            const isStagnant = (stats.ready === previousReady
                && stats.total === previousTotal
                && pendingProtoCount === previousPendingProto
                && pendingResolvedPrimCount === previousPendingResolvedPrim);
            stagnantPassCount = isStagnant ? (stagnantPassCount + 1) : 0;
            previousReady = stats.ready;
            previousTotal = stats.total;
            previousPendingProto = pendingProtoCount;
            previousPendingResolvedPrim = pendingResolvedPrimCount;
            const elapsedMs = profileNow() - drainStartedAtMs;
            if ((finalSceneDrainBudgetMs > 0 && elapsedMs >= finalSceneDrainBudgetMs) || stagnantPassCount >= 6) {
                console.warn(`[usd-loader] Strict one-shot drain stopped with ${stats.ready}/${Math.max(stats.total, 1)} meshes ready and ${pendingProtoCount} pending proto meshes.`);
                return;
            }
            let drewInBurst = false;
            const burstCount = Math.max(1, aggressiveInitialDraw ? initialDrawBurst : 1);
            for (let drawIndex = 0; drawIndex < burstCount; drawIndex++) {
                if (!isLoadStillActive())
                    return;
                if (!runInstrumentedDriverDraw("load-complete", { forceRender: drawBurstRenderEveryDraw }))
                    break;
                drewInBurst = true;
            }
            if (!drewInBurst || state.drawFailed)
                return;
            await yieldToMainThread(initialDrawYieldMs);
        }
    };
    await drainStrictOneShotMeshReadiness();
    if (!isLoadStillActive())
        return state;
    markLoadPhase("strict-one-shot-drain-done");
    const cachedSceneStageSnapshot = getRobotSceneStageSnapshot();
    state.timeout = 40;
    state.endTimeCode = 0;
    if (cachedSceneStageSnapshot) {
        const stageEndTimeCode = Number(cachedSceneStageSnapshot.endTimeCode || 0);
        const stageTimeCodesPerSecond = Number(cachedSceneStageSnapshot.timeCodesPerSecond || 0);
        state.endTimeCode = Number.isFinite(stageEndTimeCode) && stageEndTimeCode > 0 ? stageEndTimeCode : 0;
        state.timeout = Number.isFinite(stageTimeCodesPerSecond) && stageTimeCodesPerSecond > 0 ? 1000 / stageTimeCodesPerSecond : 40;
    }
    let stageUpAxis = inferredStageUpAxis;
    if (cachedSceneStageSnapshot) {
        const resolvedAxis = String(cachedSceneStageSnapshot.upAxis || "").trim().toLowerCase();
        if (resolvedAxis === "y" || resolvedAxis === "z") {
            stageUpAxis = resolvedAxis;
        }
    }
    window.usdRoot.rotation.x = stageUpAxis === "z" ? -Math.PI / 2 : 0;
    if (needsFinalProtoHydrationPass) {
        runProtoHydrationPass();
    }
    if (needsFinalResolvedPrimHydrationPass) {
        runResolvedPrimHydrationPass({ force: true });
    }
    const fitted = fitCameraToSelection(window.camera, window._controls, [window.usdRoot], 1.5, params);
    if (!fitted) {
        scheduleCameraRefit(window.camera, window._controls, [window.usdRoot], params);
    }
    await ensureRobotMetadataReadyBeforeInteractive();
    if (!isLoadStillActive())
        return state;
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
    flushLoadProfile("ok");
    return state;
}
