// @ts-nocheck
import { Color, Matrix4, MeshPhysicalMaterial, Quaternion, Vector3 } from 'three';
import * as Shared from './shared.js';
import { TextureRegistry } from './TextureRegistry.js';
import { HydraInstancer } from './HydraInstancer.js';
import { HydraMesh } from './HydraMesh.js';
import { HydraMaterial } from './HydraMaterial.js';
import { HydraSkeleton } from './HydraSkeleton.js';
import { SdfPath } from './SdfPath.js';
import { getDefaultMaterial } from './default-material-state.js';

const { buildProtoPrimPathCandidates,clamp01,createMatrixFromXformOp,debugInstancer,debugMaterials,debugMeshes,debugPrims,debugTextures,defaultGrayComponent,disableMaterials,disableTextures,extractJointRecordsFromLayerText,extractPrimPathFromMaterialBindingWarning,extractReferencePrimTargets,extractScopeBodyText,extractUsdAssetReferencesFromLayerText,getActiveMaterialBindingWarningOwner,getAngleInRadians,getCollisionGeometryTypeFromUrdfElement,getExpectedPrimTypesForCollisionProto,getExpectedPrimTypesForProtoType,getMatrixMaxElementDelta,getPathBasename,getPathWithoutRoot,getRawConsoleMethod,getRootPathFromPrimPath,getSafePrimTypeName,hasNonZeroTranslation,hydraCallbackErrorCounts,installMaterialBindingApiWarningInterceptor,isIdentityQuaternion,isLikelyDefaultGrayMaterial,isLikelyInverseTransform,isMaterialBindingApiWarningMessage,isMatrixApproximatelyIdentity,isNonZero,isPotentiallyLargeBaseAssetPath,logHydraCallbackError,materialBindingRepairMaxLayerTextLength,materialBindingWarningHandlers,maxHydraCallbackErrorLogsPerMethod,nearlyEqual,normalizeHydraPath,normalizeUsdPathToken,parseColliderEntriesFromLayerText,parseGuideCollisionReferencesFromLayerText,parseLinkDynamicsPatchesFromLayerText,parseProtoMeshIdentifier,parseUrdfTruthFromText,parseVector3Text,parseVisualSemanticChildNamesFromLayerText,parseXformOpFallbacksFromLayerText,rawConsoleError,rawConsoleWarn,registerMaterialBindingApiWarningHandler,remapRootPathIfNeeded,resolveUrdfTruthFileNameForStagePath,resolveUsdAssetPath,setActiveMaterialBindingWarningOwner,shouldAllowLargeBaseAssetScan,stringifyConsoleArgs,toArrayLike,toColorArray,toFiniteNumber,toFiniteQuaternionWxyzTuple,toFiniteVector2Tuple,toFiniteVector3Tuple,toMatrixFromUrdfOrigin,toQuaternionWxyzFromRpy,transformEpsilon,wrapHydraCallbackObject } = Shared;

const HYDRA_PHASE_PROFILE_FROM_QUERY = (() => {
  try {
    const search = typeof window !== 'undefined' ? String(window.location?.search || '') : '';
    if (!search) return false;
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const raw = params.get('profileHydraPhases');
    if (raw === null) return false;
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === '') return true;
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  } catch {
    return false;
  }
})();

export class ThreeRenderDelegateCore {

  /**
   * @param {import('..').threeJsRenderDelegateConfig} config
   */
  constructor(config) {
    const safeConfig = (config && typeof config === 'object') ? config : {};
    this.config = safeConfig;
    this.registry = new TextureRegistry(safeConfig);
    this.modelOverrides = safeConfig.modelOverrides || null;
    this.stageSourcePath = typeof safeConfig.stageSourcePath === 'string'
      ? String(safeConfig.stageSourcePath).split('?')[0]
      : null;
    this.suppressMaterialBindingApiWarnings = safeConfig.suppressMaterialBindingApiWarnings !== false;
    this.loadCollisionPrims = safeConfig.loadCollisionPrims !== false;
    this.loadVisualPrims = safeConfig.loadVisualPrims !== false;
    this.enableXformOpFallbackFromLayerText = safeConfig.enableXformOpFallbackFromLayerText === true;
    this.enableProtoBlobFastPath = safeConfig.enableProtoBlobFastPath !== false;
    this.preferProtoBlobOverHydraPayload = safeConfig.preferProtoBlobOverHydraPayload !== false;
    this.preferFinalStageOverrideBatchInProtoSync = safeConfig.preferFinalStageOverrideBatchInProtoSync !== false;
    // Strict one-shot loads must finish scene payload resolution before reveal.
    // Keep legacy per-mesh bridge fetches disabled until snapshot caches exist.
    this.strictOneShotSceneLoad = safeConfig.strictOneShotSceneLoad === true;
    // Keep first visual frame fast: hidden collision proto meshes can defer
    // expensive sync until they become visible.
    this.deferHiddenCollisionProtoSyncInCommit = safeConfig.deferHiddenCollisionProtoSyncInCommit !== false;
    // Reduce JS<->WASM bridge chatter by default: prime batch payloads once,
    // then resolve per-mesh reads from JS cache.
    this.autoBatchProtoBlobsOnFirstAccess = safeConfig.autoBatchProtoBlobsOnFirstAccess !== false;
    this.autoBatchPrimTransformsOnFirstAccess = safeConfig.autoBatchPrimTransformsOnFirstAccess !== false;
    this.autoBatchCollisionProtoOverridesOnFirstAccess = safeConfig.autoBatchCollisionProtoOverridesOnFirstAccess !== false;
    this.autoBatchVisualProtoOverridesOnFirstAccess = safeConfig.autoBatchVisualProtoOverridesOnFirstAccess !== false;
    this.allowDriverStageLookup = safeConfig.allowDriverStageLookup === true;
    // Avoid expensive driver.GetStage() calls inside high-frequency Hydra sync callbacks.
    // Stage-dependent fallback passes still run later once stage metadata is ready.
    this.deferDriverStageLookupInSyncHotPath = safeConfig.deferDriverStageLookupInSyncHotPath !== false;
    this._hydraSyncHotPathDepth = 0;
    this.enableHydraPhaseInstrumentation = safeConfig.enableHydraPhaseInstrumentation === true
      || HYDRA_PHASE_PROFILE_FROM_QUERY
      || globalThis?.__HYDRA_PROFILE_PHASES__ === true;
    this._hydraPhasePerfState = {
      drawSeq: 0,
      renderSeq: 0,
      activeDraw: null,
      history: [],
      maxHistory: 48,
      firstRenderSample: null,
    };
    this.maxVisualPrims = Number.isFinite(safeConfig.maxVisualPrims)
      ? Math.max(0, Math.floor(Number(safeConfig.maxVisualPrims)))
      : null;
    this.loadedVisualPrimCount = 0;
    this.materials = {};
    this.meshes = {};
    this.instancers = {};
    this.skeletons = {};
    this._meshMutationVersion = 0;
    this._localXformCache = new Map();
    this._localXformResetsStackCache = new Map();
    this._localXformAuthoredOpsCache = new Map();
    this._worldXformCache = new Map();
    this._worldXformCacheSourceByPath = new Map();
    this._primPathExistenceCache = new Map();
    this._knownPrimPathSet = null;
    this._knownPrimPathSetPrimed = false;
    this._meshFallbackCache = new Map();
    this._resolvedProtoPrimPathCache = new Map();
    this._resolvedVisualPrimPathCache = new Map();
    this._xformOpFallbackMapByStageSource = new Map();
    this._rootLayerXformOpFallbackMapByStageSource = new Map();
    this._stageFallbackMaterialCache = new Map();
    this._snapshotMaterialRecordById = new Map();
    this._snapshotMaterialIdsByStageSource = new Map();
    this._snapshotFallbackMaterialCache = new Map();
    this._linkVisualTransformCache = new Map();
    this._visualMeshIdByLinkPath = new Map();
    this._meshIdByLinkPath = new Map();
    this._protoMeshMetadataByMeshId = new Map();
    this._guideCollisionPrimPathCache = new Map();
    this._guideCollisionRefMapByStageSource = new Map();
    this._visualSemanticChildMapByStageSource = new Map();
    this._openedGuideStages = new Map();
    this._protoDataBlobBatchCache = new Map();
    this._protoDataBlobBatchPrimed = false;
    this._primTransformBatchPrimed = false;
    this._collisionProtoOverrideCache = new Map();
    this._collisionProtoOverrideBatchPrimed = false;
    this._visualProtoOverrideCache = new Map();
    this._visualProtoOverrideBatchPrimed = false;
    this._finalStageOverrideBatchCache = new Map();
    this._finalStageOverrideBatchPrimed = false;
    this._finalStageOverrideBatchProtoMeshCount = 0;
    this._stageOverrideProtoMeshCache = null;
    this._primOverrideDataCache = new Map();
    this._urdfTruthByStageSource = new Map();
    this._urdfTruthLoadPromisesByStageSource = new Map();
    this._urdfLinkWorldTransformCacheByStageSource = new Map();
    this._urdfVisualFallbackDecisionCache = new Map();
    this._urdfVisualFallbackLinkDecisionCache = new Map();
    this._robotMetadataSnapshotByStageSource = new Map();
    this._robotSceneSnapshotByStageSource = new Map();
    this._robotMetadataBuildPromisesByStageSource = new Map();
    this._preferredVisualMaterialByLinkCache = new Map();
    this._resolvedDriverStage = null;
    this._pendingDriverStagePromise = null;
    this._decomposeScratchPosition = new Vector3();
    this._decomposeScratchQuaternion = new Quaternion();
    this._decomposeScratchScale = new Vector3();
    this._materialBindingWarningSummary = {
      count: 0,
      primPaths: new Set(),
      sampleMessages: [],
    };
    this._materialBindingWarningSummaryTimer = null;
    this._materialBindingSchemaRepairAttempted = false;
    this._materialBindingSchemaRepairSucceeded = false;
    this._materialBindingSchemaWriteSupported = null;
    this._hasRunStageTruthAlignmentDiagnostics = false;
    this._materialBindingWarningHandler = ({ message, level }) => this.handleMaterialBindingApiWarning({ message, level });
    setActiveMaterialBindingWarningOwner(this);
    registerMaterialBindingApiWarningHandler(this._materialBindingWarningHandler);

    // Bind hot transform helpers defensively so detached callback invocations
    // from external runtimes cannot lose `this`.
    if (typeof this.getWorldTransformForPrimPath === 'function') {
      this.getWorldTransformForPrimPath = this.getWorldTransformForPrimPath.bind(this);
    }
    if (typeof this.getLocalTransformForPrimPath === 'function') {
      this.getLocalTransformForPrimPath = this.getLocalTransformForPrimPath.bind(this);
    }

    if (this.isHydraPhaseInstrumentationEnabled() && typeof window !== 'undefined') {
      window.__HYDRA_PHASE_METRICS__ = {
        getSnapshot: () => this.getHydraPhasePerfSnapshot(),
      };
    }
  }

  enterHydraSyncHotPath() {
    const nextDepth = Number(this._hydraSyncHotPathDepth || 0) + 1;
    this._hydraSyncHotPathDepth = nextDepth > 0 ? nextDepth : 1;
  }

  leaveHydraSyncHotPath() {
    const currentDepth = Number(this._hydraSyncHotPathDepth || 0);
    this._hydraSyncHotPathDepth = currentDepth > 1 ? currentDepth - 1 : 0;
  }

  isHydraSyncHotPathActive() {
    return Number(this._hydraSyncHotPathDepth || 0) > 0;
  }

  isHydraPhaseInstrumentationEnabled() {
    return this.enableHydraPhaseInstrumentation === true;
  }

  _nowPerfMs() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  _markPerf(name) {
    if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
    try {
      performance.mark(name);
    } catch {}
  }

  _measurePerf(name, startMark, endMark) {
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
    try {
      performance.measure(name, startMark, endMark);
    } catch {}
  }

  _accumulatePerfMap(metricMap, key, value) {
    if (!(metricMap instanceof Map)) return;
    const normalizedKey = String(key || '').trim() || '<unknown>';
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    metricMap.set(normalizedKey, Number(metricMap.get(normalizedKey) || 0) + numeric);
  }

  beginHydraDrawPhase(source = 'driver.Draw') {
    if (!this.isHydraPhaseInstrumentationEnabled()) return null;
    const state = this._hydraPhasePerfState;
    if (!state) return null;

    const seq = Number(state.drawSeq || 0) + 1;
    state.drawSeq = seq;
    const startMark = `hydra.phase.draw.${seq}.start`;
    this._markPerf(startMark);
    state.activeDraw = {
      seq,
      source: String(source || 'driver.Draw'),
      startedAtMs: this._nowPerfMs(),
      wasmFetchMs: 0,
      threeBuildMs: 0,
      commitMs: 0,
      renderMs: 0,
      wasmByMesh: new Map(),
      buildByMesh: new Map(),
      startMark,
      endMark: `hydra.phase.draw.${seq}.end`,
    };
    return state.activeDraw;
  }

  recordHydraWasmFetchPhase(durationMs, meshId = null) {
    if (!this.isHydraPhaseInstrumentationEnabled()) return;
    const draw = this._hydraPhasePerfState?.activeDraw;
    if (!draw) return;
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return;
    draw.wasmFetchMs += duration;
    this._accumulatePerfMap(draw.wasmByMesh, meshId, duration);
  }

  recordHydraThreeBuildPhase(durationMs, meshId = null) {
    if (!this.isHydraPhaseInstrumentationEnabled()) return;
    const draw = this._hydraPhasePerfState?.activeDraw;
    if (!draw) return;
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return;
    draw.threeBuildMs += duration;
    this._accumulatePerfMap(draw.buildByMesh, meshId, duration);
  }

  recordHydraCommitPhase(durationMs) {
    if (!this.isHydraPhaseInstrumentationEnabled()) return;
    const draw = this._hydraPhasePerfState?.activeDraw;
    if (!draw) return;
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return;
    draw.commitMs += duration;
  }

  recordHydraRenderPhase(durationMs, source = 'renderer.render') {
    if (!this.isHydraPhaseInstrumentationEnabled()) return;
    const state = this._hydraPhasePerfState;
    if (!state) return;
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0) return;
    state.renderSeq = Number(state.renderSeq || 0) + 1;

    if (!state.firstRenderSample) {
      state.firstRenderSample = {
        seq: state.renderSeq,
        durationMs: duration,
        source: String(source || 'renderer.render'),
      };
      // Keep first-render instrumentation silent in hot paths.
    }

    if (state.activeDraw) {
      state.activeDraw.renderMs += duration;
    }
  }

  endHydraDrawPhase() {
    if (!this.isHydraPhaseInstrumentationEnabled()) return null;
    const state = this._hydraPhasePerfState;
    const draw = state?.activeDraw;
    if (!draw) return null;

    this._markPerf(draw.endMark);
    this._measurePerf(`hydra.phase.draw.${draw.seq}`, draw.startMark, draw.endMark);

    const endedAtMs = this._nowPerfMs();
    const totalMs = Math.max(0, endedAtMs - Number(draw.startedAtMs || endedAtMs));
    const textureSnapshot = this.registry?.getTextureLoadSnapshot?.() || null;
    const summary = {
      seq: draw.seq,
      source: draw.source,
      totalMs,
      wasmFetchMs: Number(draw.wasmFetchMs || 0),
      threeBuildMs: Number(draw.threeBuildMs || 0),
      commitMs: Number(draw.commitMs || 0),
      renderMs: Number(draw.renderMs || 0),
      texturePending: Number(textureSnapshot?.pending || 0),
      loadingManagerPending: Number(textureSnapshot?.manager?.pending || 0),
      textureStarted: Number(textureSnapshot?.started || 0),
      textureCompleted: Number(textureSnapshot?.completed || 0),
      textureFailed: Number(textureSnapshot?.failed || 0),
      topWasmMeshes: Array.from(draw.wasmByMesh.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5),
      topBuildMeshes: Array.from(draw.buildByMesh.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5),
    };

    state.activeDraw = null;
    state.history.push(summary);
    const maxHistory = Number(state.maxHistory || 48);
    if (state.history.length > maxHistory) {
      state.history.splice(0, state.history.length - maxHistory);
    }

    // Profiling summary is retained in-memory via getHydraPhasePerfSnapshot().

    return summary;
  }

  getHydraPhasePerfSnapshot() {
    const state = this._hydraPhasePerfState;
    if (!state) return null;
    return {
      drawSeq: Number(state.drawSeq || 0),
      renderSeq: Number(state.renderSeq || 0),
      activeDraw: state.activeDraw ? {
        seq: state.activeDraw.seq,
        source: state.activeDraw.source,
        startedAtMs: state.activeDraw.startedAtMs,
        wasmFetchMs: Number(state.activeDraw.wasmFetchMs || 0),
        threeBuildMs: Number(state.activeDraw.threeBuildMs || 0),
        commitMs: Number(state.activeDraw.commitMs || 0),
        renderMs: Number(state.activeDraw.renderMs || 0),
      } : null,
      firstRenderSample: state.firstRenderSample || null,
      texture: this.registry?.getTextureLoadSnapshot?.() || null,
      history: Array.isArray(state.history) ? state.history.slice(-24) : [],
    };
  }

  getStageSourcePath() {
    if (this.stageSourcePath) return this.stageSourcePath;
    const stage = this.getStage();
    const rootLayer = stage?.GetRootLayer?.();
    const identifier = normalizeHydraPath(rootLayer?.identifier || '');
    if (!identifier) return null;
    this.stageSourcePath = identifier.split('?')[0];
    return this.stageSourcePath;
  }

  getNormalizedStageSourcePath() {
    const path = String(this.getStageSourcePath() || '').trim();
    return path ? path.split('?')[0] : null;
  }

  isQueryFlagEnabled(paramName, fallback = false) {
    try {
      const search = String(window?.location?.search || '');
      if (!search) return fallback;
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const rawValue = params.get(paramName);
      if (rawValue === null) return fallback;
      const normalized = String(rawValue || '').trim().toLowerCase();
      if (!normalized) return true;
      if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
      if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
      return fallback;
    } catch {
      return fallback;
    }
  }

  shouldAllowUrdfHttpFallback() {
    return this.isQueryFlagEnabled('allowUrdfHttpFallback', false);
  }

  getStageMetadataLayerTexts(stage) {
    const layerTexts = [];
    const seenTexts = new Set();
    const addLayerText = (text) => {
      const serialized = String(text || '').trim();
      if (!serialized) return;
      if (seenTexts.has(serialized)) return;
      seenTexts.add(serialized);
      layerTexts.push(serialized);
    };
    const addLayer = (layer) => {
      if (!layer || typeof layer.ExportToString !== 'function') return;
      try {
        addLayerText(layer.ExportToString());
      } catch {}
    };

    addLayer(stage?.GetRootLayer?.());
    try {
      const usedLayers = toArrayLike(stage?.GetUsedLayers?.());
      if (Array.isArray(usedLayers)) {
        for (const layer of usedLayers) {
          addLayer(layer);
        }
      }
    } catch {}

    return layerTexts;
  }

  getCachedRobotMetadataSnapshot(stageSourcePath = null) {
    const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
    if (!normalizedStagePath) return null;
    return this._robotMetadataSnapshotByStageSource.get(normalizedStagePath) || null;
  }

  getCachedRobotSceneSnapshot(stageSourcePath = null) {
    const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
    if (!normalizedStagePath) return null;
    return this._robotSceneSnapshotByStageSource.get(normalizedStagePath) || null;
  }

  emitRobotMetadataSnapshotReady(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
      window.dispatchEvent(new CustomEvent('usd:robot-metadata-ready', { detail: snapshot }));
    } catch {
      try {
        window.dispatchEvent(new Event('usd:robot-metadata-ready'));
      } catch {}
    }
  }

  emitRobotSceneSnapshotReady(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
      window.dispatchEvent(new CustomEvent('usd:robot-scene-ready', { detail: snapshot }));
    } catch {
      try {
        window.dispatchEvent(new Event('usd:robot-scene-ready'));
      } catch {}
    }
  }

  resolveRoundtripUsdVirtualPath(stageSourcePath = null, options = {}) {
    const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
    if (!normalizedStagePath || !normalizedStagePath.startsWith('/')) return null;

    const lastSlash = normalizedStagePath.lastIndexOf('/');
    const directory = lastSlash >= 0 ? normalizedStagePath.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? normalizedStagePath.slice(lastSlash + 1) : normalizedStagePath;
    if (!fileName) return null;

    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '.usd';
    const suggestedFileName = String(options?.outputFileName || '').trim();
    const outputFileName = suggestedFileName || `${baseName}.viewer_roundtrip${extension || '.usd'}`;
    return directory ? `${directory}/${outputFileName}` : `/${outputFileName}`;
  }

  async writeUsdExportToServer(virtualPath, content, options = {}) {
    const normalizedVirtualPath = String(virtualPath || '').trim();
    if (!normalizedVirtualPath || !normalizedVirtualPath.startsWith('/')) {
      return { ok: false, error: 'invalid-export-path' };
    }
    if (typeof fetch !== 'function') {
      return { ok: false, error: 'fetch-unavailable' };
    }

    let response = null;
    let payload = null;
    try {
      response = await fetch('/api/write-usd-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          virtualPath: normalizedVirtualPath,
          content: String(content || ''),
          overwrite: options?.overwrite !== false,
        }),
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error || 'write-usd-export-failed'),
      };
    }

    if (!response?.ok || payload?.ok !== true) {
      return {
        ok: false,
        error: String(payload?.error || `write-usd-export-${Number(response?.status || 0)}`),
        status: Number(response?.status || 0),
        payload: payload || null,
      };
    }

    return {
      ok: true,
      virtualPath: String(payload.virtualPath || normalizedVirtualPath),
      filePath: String(payload.filePath || ''),
      bytesWritten: Number(payload.bytesWritten || 0),
    };
  }

  async exportLoadedStageSnapshot(options = {}) {
    const activeDriver = options?.driver || this.config?.driver?.() || globalThis?.driver || null;
    const stageSourcePath = String(options?.stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
    const flattenStage = options?.flattenStage === true;
    const emptyResult = {
      ok: false,
      error: 'export-unavailable',
      stageSourcePath: stageSourcePath || null,
      outputVirtualPath: null,
    };

    let exportPayload = null;
    if (activeDriver && typeof activeDriver.ExportLoadedStageSnapshot === 'function') {
      try {
        exportPayload = activeDriver.ExportLoadedStageSnapshot({
          flattenStage,
          stageSourcePath,
        });
      } catch {
        exportPayload = null;
      }
    }

    if ((!exportPayload || exportPayload.ok !== true) && typeof this.getStage === 'function') {
      const stage = this.getStage();
      const rootLayer = stage?.GetRootLayer?.() || null;
      if (rootLayer && typeof rootLayer.ExportToString === 'function') {
        try {
          const content = rootLayer.ExportToString();
          exportPayload = {
            ok: !!content,
            flattened: false,
            content: typeof content === 'string' ? content : String(content || ''),
            stageSourcePath,
            rootLayerIdentifier: rootLayer?.identifier || null,
            defaultPrimPath: stage?.GetDefaultPrim?.()?.GetPath?.()?.pathString || null,
            outputFileName: null,
            exportMode: 'root-layer-js-fallback',
          };
        } catch {
          exportPayload = null;
        }
      }
    }

    if (!exportPayload || exportPayload.ok !== true) {
      return emptyResult;
    }

    const content = typeof exportPayload.content === 'string'
      ? exportPayload.content
      : String(exportPayload.content || '');
    if (!content) {
      return {
        ...emptyResult,
        error: 'empty-export-content',
      };
    }

    const outputVirtualPath = String(
      options?.outputVirtualPath
      || this.resolveRoundtripUsdVirtualPath(stageSourcePath, { outputFileName: exportPayload.outputFileName })
      || ''
    ).trim();

    const result = {
      ok: true,
      flattened: exportPayload.flattened === true,
      content,
      stageSourcePath: String(exportPayload.stageSourcePath || stageSourcePath || '').trim() || null,
      rootLayerIdentifier: exportPayload.rootLayerIdentifier || null,
      defaultPrimPath: exportPayload.defaultPrimPath || null,
      outputFileName: exportPayload.outputFileName || null,
      outputVirtualPath: outputVirtualPath || null,
      exportMode: exportPayload.exportMode || (flattenStage ? 'flattened-stage' : 'root-layer'),
    };

    if (options?.persistToServer === false) {
      return result;
    }
    if (!outputVirtualPath) {
      return {
        ...result,
        ok: false,
        error: 'unsupported-export-path',
      };
    }

    const persisted = await this.writeUsdExportToServer(outputVirtualPath, content, options);
    return {
      ...result,
      persisted,
      ok: persisted.ok === true,
      error: persisted.ok === true ? null : persisted.error || 'write-usd-export-failed',
      filePath: persisted.filePath || null,
      bytesWritten: Number(persisted.bytesWritten || 0),
    };
  }

  tryBuildRobotMetadataSnapshotFromDriver(stageSourcePath, sortedLinkPaths, meshCountsByLinkPath) {
    if (!Array.isArray(sortedLinkPaths) || sortedLinkPaths.length <= 0) {
      return {
        stageSourcePath: stageSourcePath || null,
        generatedAtMs: this._nowPerfMs(),
        source: 'mesh-only',
        linkParentPairs: [],
        jointCatalogEntries: [],
        linkDynamicsEntries: [],
        meshCountsByLinkPath,
      };
    }

    const activeDriver = typeof window !== 'undefined' ? window?.driver : null;
    if (!activeDriver || typeof activeDriver.GetRobotMetadataSnapshot !== 'function') {
      return null;
    }

    const toArray = (value) => (
      Array.isArray(value)
        ? value
        : (value && typeof value.length === 'number' ? Array.from(value) : [])
    );

    try {
      const rawSnapshot = activeDriver.GetRobotMetadataSnapshot(sortedLinkPaths, String(stageSourcePath || ''));
      if (!rawSnapshot || typeof rawSnapshot !== 'object') return null;

      const linkParentPairs = toArray(rawSnapshot.linkParentPairs);
      const jointCatalogEntries = toArray(rawSnapshot.jointCatalogEntries);
      const linkDynamicsEntries = toArray(rawSnapshot.linkDynamicsEntries);
      const hasStageData = (
        linkParentPairs.length > 0
        || jointCatalogEntries.length > 0
        || linkDynamicsEntries.length > 0
      );
      const generatedAtMs = Number(rawSnapshot.generatedAtMs);
      return {
        stageSourcePath: String(rawSnapshot.stageSourcePath || stageSourcePath || '').trim() || null,
        generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : this._nowPerfMs(),
        source: hasStageData
          ? (String(rawSnapshot.source || 'usd-stage-cpp') || 'usd-stage-cpp')
          : 'mesh-only',
        linkParentPairs,
        jointCatalogEntries,
        linkDynamicsEntries,
        meshCountsByLinkPath,
      };
    } catch {
      return null;
    }
  }

  buildRobotMetadataSnapshotForStage(stageSourcePath, truth) {
    const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0] || null;
    const allowJsStageFallback = false;
    const shouldReadStageDataInJs = !!truth || allowJsStageFallback;
    let resolvedStage = null;
    let resolvedStageInitialized = false;
    const getStageForMetadataFallback = () => {
      if (resolvedStageInitialized) {
        return resolvedStage;
      }
      resolvedStageInitialized = true;
      resolvedStage = shouldReadStageDataInJs ? (this.getStage?.() || null) : null;
      return resolvedStage;
    };
    let metadataLayerTexts = [];
    const meshCountsByLinkPath = {};
    const linkPathSet = new Set();
    const normalizeVector3 = (value, fallback = [0, 0, 0]) => {
      const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === 'number' ? Array.from(value) : null);
      if (!source || source.length < 3) return fallback.slice(0, 3);
      const x = Number(source[0]); const y = Number(source[1]); const z = Number(source[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return fallback.slice(0, 3);
      return [x, y, z];
    };
    const normalizeQuaternionWxyz = (value, fallback = [1, 0, 0, 0]) => {
      const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === 'number' ? Array.from(value) : null);
      if (!source || source.length < 4) return fallback.slice(0, 4);
      const w = Number(source[0]); const x = Number(source[1]); const y = Number(source[2]); const z = Number(source[3]);
      if (!Number.isFinite(w) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return fallback.slice(0, 4);
      return [w, x, y, z];
    };
    const normalizeAxisToken = (value) => {
      const token = String(value || 'X').trim().toUpperCase();
      if (token.startsWith('Y')) return 'Y';
      if (token.startsWith('Z')) return 'Z';
      return 'X';
    };
    const toAxisVector = (axisToken) => {
      if (axisToken === 'Y') return new Vector3(0, 1, 0);
      if (axisToken === 'Z') return new Vector3(0, 0, 1);
      return new Vector3(1, 0, 0);
    };
    const rotateAxisByQuaternionWxyz = (axisToken, localRot1Wxyz) => {
      const axis = toAxisVector(axisToken);
      const normalizedWxyz = normalizeQuaternionWxyz(localRot1Wxyz, [1, 0, 0, 0]);
      const quaternion = new Quaternion(
        Number(normalizedWxyz[1] ?? 0),
        Number(normalizedWxyz[2] ?? 0),
        Number(normalizedWxyz[3] ?? 0),
        Number(normalizedWxyz[0] ?? 1),
      );
      if (Number.isFinite(quaternion.lengthSq()) && quaternion.lengthSq() > 1e-12) {
        quaternion.normalize();
        axis.applyQuaternion(quaternion);
      }
      if (!Number.isFinite(axis.lengthSq()) || axis.lengthSq() <= 1e-12) {
        return [1, 0, 0];
      }
      axis.normalize();
      return [axis.x, axis.y, axis.z];
    };
    const axisTokenFromAxis = (axis) => {
      const x = Math.abs(Number(axis?.[0] || 0));
      const y = Math.abs(Number(axis?.[1] || 0));
      const z = Math.abs(Number(axis?.[2] || 0));
      if (y >= x && y >= z) return 'Y';
      if (z >= x && z >= y) return 'Z';
      return 'X';
    };
    const hasSignificantVector3 = (vector3Tuple, epsilon = 1e-8) => {
      if (!Array.isArray(vector3Tuple) || vector3Tuple.length < 3) return false;
      return (
        Math.abs(Number(vector3Tuple[0] || 0)) > epsilon
        || Math.abs(Number(vector3Tuple[1] || 0)) > epsilon
        || Math.abs(Number(vector3Tuple[2] || 0)) > epsilon
      );
    };
    const hasSignificantMassValue = (value, epsilon = 1e-8) => {
      const mass = Number(value);
      return Number.isFinite(mass) && Math.abs(mass) > epsilon;
    };
    const hasNonIdentityQuaternionWxyz = (quaternionWxyz, epsilon = 1e-6) => {
      if (!Array.isArray(quaternionWxyz) || quaternionWxyz.length < 4) return false;
      return (
        Math.abs(Number(quaternionWxyz[1] || 0)) > epsilon
        || Math.abs(Number(quaternionWxyz[2] || 0)) > epsilon
        || Math.abs(Number(quaternionWxyz[3] || 0)) > epsilon
        || Math.abs(Number(quaternionWxyz[0] ?? 1) - 1) > epsilon
      );
    };
    const safeGetPrimAtPath = (stageObject, primPath) => {
      if (!stageObject?.GetPrimAtPath || !primPath) return null;
      try {
        return stageObject.GetPrimAtPath(primPath) || null;
      } catch {
        return null;
      }
    };
    const safeGetPrimAttribute = (prim, attributeName) => {
      if (!prim?.GetAttribute || !attributeName) return null;
      try {
        return prim.GetAttribute(attributeName)?.Get?.() ?? null;
      } catch {
        return null;
      }
    };
    const normalizeStageJointType = (jointTypeName) => {
      const raw = String(jointTypeName || '').trim();
      const normalized = raw.toLowerCase();
      if (!normalized) return 'joint';
      if (normalized === 'revolute' || normalized.includes('revolute') || normalized === 'continuous' || normalized.includes('continuous')) {
        return 'revolute';
      }
      if (normalized === 'prismatic' || normalized.includes('prismatic')) return 'prismatic';
      if (normalized === 'fixed' || normalized.includes('fixed')) return 'fixed';
      if (normalized === 'distance' || normalized.includes('distance')) return 'distance';
      if (normalized === 'spherical' || normalized.includes('spherical') || normalized.includes('ball')) return 'spherical';
      if (normalized === 'd6' || normalized.includes('d6')) return 'd6';
      return raw || 'joint';
    };
    const isControllableStageJointType = (jointTypeName) => {
      return normalizeStageJointType(jointTypeName) === 'revolute';
    };
    const isNonRotationalStageJointType = (jointTypeName) => {
      const type = normalizeStageJointType(jointTypeName);
      return type === 'fixed' || type === 'prismatic' || type === 'distance';
    };
    const normalizeStageJointLimits = (jointTypeName, lowerLimitDeg, upperLimitDeg) => {
      const lower = Number(lowerLimitDeg);
      const upper = Number(upperLimitDeg);
      const hasLower = Number.isFinite(lower);
      const hasUpper = Number.isFinite(upper);
      if (!hasLower && !hasUpper) {
        if (isNonRotationalStageJointType(jointTypeName)) {
          return { lower: 0, upper: 0 };
        }
        return { lower: -180, upper: 180 };
      }
      let normalizedLower = hasLower ? lower : (isNonRotationalStageJointType(jointTypeName) ? 0 : -180);
      let normalizedUpper = hasUpper ? upper : (isNonRotationalStageJointType(jointTypeName) ? 0 : 180);
      if (normalizedLower > normalizedUpper) {
        const midpoint = (normalizedLower + normalizedUpper) * 0.5;
        normalizedLower = midpoint;
        normalizedUpper = midpoint;
      }
      return { lower: normalizedLower, upper: normalizedUpper };
    };
    const collisionPrimitiveTypeFromProto = (protoType) => {
      const normalizedType = String(protoType || '').trim().toLowerCase();
      if (!normalizedType) return null;
      if (normalizedType === 'cube') return 'box';
      return normalizedType;
    };
    const parseLegacyRuntimeMeshDescriptor = (meshId) => {
      const normalizedMeshPath = normalizeUsdPathToken(meshId);
      if (!normalizedMeshPath || !normalizedMeshPath.startsWith('/')) return null;
      const sectionMatch = normalizedMeshPath.match(/^(.*)\/(visuals|collisions)(?:([/.])(.*))?$/i);
      if (!sectionMatch) return null;
      const linkPath = normalizeUsdPathToken(sectionMatch[1]);
      if (!linkPath || linkPath === '/') return null;
      const sectionName = String(sectionMatch[2] || '').toLowerCase();
      const suffix = String(sectionMatch[4] || '').trim().toLowerCase();
      const inferProtoType = () => {
        if (!suffix) return 'mesh';
        if (suffix.includes('box') || suffix.includes('cube')) return 'box';
        if (suffix.includes('sphere')) return 'sphere';
        if (suffix.includes('cylinder')) return 'cylinder';
        if (suffix.includes('capsule')) return 'capsule';
        return 'mesh';
      };
      const inferProtoIndex = () => {
        const suffixIndexMatch = suffix.match(/(?:^|[^a-z0-9])(?:id|mesh_)(\d+)(?:[^a-z0-9]|$)/i);
        if (suffixIndexMatch) {
          const parsed = Number(suffixIndexMatch[1]);
          if (Number.isFinite(parsed) && parsed >= 0) return parsed;
        }
        return 0;
      };
      return {
        containerPath: `${linkPath}/${sectionName}`,
        linkPath,
        linkName: getPathBasename(linkPath),
        sectionName,
        protoType: inferProtoType(),
        protoIndex: inferProtoIndex(),
      };
    };
    const parseRuntimeMeshDescriptor = (meshId) => {
      const cached = this._protoMeshMetadataByMeshId.get(meshId);
      if (cached?.linkPath) return cached;
      const parsedProto = parseProtoMeshIdentifier(meshId);
      if (parsedProto?.linkPath) return parsedProto;
      return parseLegacyRuntimeMeshDescriptor(meshId);
    };

    for (const meshId of Object.keys(this.meshes || {})) {
      const proto = parseRuntimeMeshDescriptor(meshId);
      if (!proto?.linkPath) continue;
      this._protoMeshMetadataByMeshId.set(meshId, proto);
      linkPathSet.add(proto.linkPath);

      if (!meshCountsByLinkPath[proto.linkPath]) {
        meshCountsByLinkPath[proto.linkPath] = {
          visualMeshCount: 0,
          collisionMeshCount: 0,
          collisionPrimitiveCounts: {},
        };
      }
      const counts = meshCountsByLinkPath[proto.linkPath];
      if (proto.sectionName === 'collisions') {
        counts.collisionMeshCount += 1;
        const primitiveType = collisionPrimitiveTypeFromProto(proto.protoType);
        if (primitiveType) {
          counts.collisionPrimitiveCounts[primitiveType] = Number(counts.collisionPrimitiveCounts[primitiveType] || 0) + 1;
        }
      } else if (proto.sectionName === 'visuals') {
        counts.visualMeshCount += 1;
      }
    }

    const sortedLinkPaths = Array.from(linkPathSet).sort((left, right) => left.localeCompare(right));
    const mergeMissingJointCatalogEntriesFromDriver = (snapshot) => {
      if (!snapshot || typeof snapshot !== 'object') return snapshot;
      if (!Array.isArray(sortedLinkPaths) || sortedLinkPaths.length <= 0) return snapshot;
      const activeDriver = typeof window !== 'undefined' ? window?.driver : null;
      if (!activeDriver || typeof activeDriver.GetPhysicsJointRecords !== 'function') {
        return snapshot;
      }

      let rawJointRecords = [];
      try {
        rawJointRecords = activeDriver.GetPhysicsJointRecords();
      } catch {
        rawJointRecords = [];
      }
      const driverJointRecords = (
        rawJointRecords && typeof rawJointRecords.length === 'number'
          ? Array.from(rawJointRecords)
          : []
      );
      if (driverJointRecords.length <= 0) return snapshot;

      const linkPathSetForMerge = new Set(sortedLinkPaths);
      const runtimeLinkPathsByNameForMerge = new Map();
      const rootPathSetForMerge = new Set();
      const rootPathsForMerge = [];
      for (const linkPath of sortedLinkPaths) {
        const linkName = getPathBasename(linkPath);
        if (linkName) {
          const existing = runtimeLinkPathsByNameForMerge.get(linkName) || [];
          existing.push(linkPath);
          runtimeLinkPathsByNameForMerge.set(linkName, existing);
        }
        const rootPath = getRootPathFromPrimPath(linkPath);
        if (rootPath && !rootPathSetForMerge.has(rootPath)) {
          rootPathSetForMerge.add(rootPath);
          rootPathsForMerge.push(rootPath);
        }
      }
      rootPathsForMerge.sort((left, right) => left.localeCompare(right));

      const sortByPreferredRootForMerge = (paths, preferredRootPath = null) => {
        const deduped = Array.from(new Set(paths.filter(Boolean)));
        deduped.sort((left, right) => left.localeCompare(right));
        if (!preferredRootPath) return deduped;
        return deduped.sort((left, right) => {
          const leftPreferred = getRootPathFromPrimPath(left) === preferredRootPath ? 0 : 1;
          const rightPreferred = getRootPathFromPrimPath(right) === preferredRootPath ? 0 : 1;
          if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
          return left.localeCompare(right);
        });
      };
      const resolveRuntimeLinkPathsFromSourcePathForMerge = (sourcePath, preferredRootPath = null) => {
        const source = String(sourcePath || '').trim();
        if (!source) return [];
        const normalizedSourcePath = normalizeUsdPathToken(source);
        const matches = [];
        const addMatch = (candidatePath) => {
          if (!candidatePath) return;
          if (!linkPathSetForMerge.has(candidatePath)) return;
          if (matches.includes(candidatePath)) return;
          matches.push(candidatePath);
        };

        addMatch(normalizedSourcePath);
        const linkName = getPathBasename(normalizedSourcePath || source.replace(/[<>]/g, ''));
        if (linkName) {
          for (const candidatePath of runtimeLinkPathsByNameForMerge.get(linkName) || []) {
            addMatch(candidatePath);
          }
        }

        if (normalizedSourcePath) {
          const sourceWithoutRoot = getPathWithoutRoot(normalizedSourcePath);
          if (sourceWithoutRoot && sourceWithoutRoot !== '/') {
            if (preferredRootPath) {
              addMatch(`${preferredRootPath}${sourceWithoutRoot}`);
            }
            for (const rootPath of rootPathsForMerge) {
              if (preferredRootPath && rootPath === preferredRootPath) continue;
              addMatch(`${rootPath}${sourceWithoutRoot}`);
            }
          }
        }

        return sortByPreferredRootForMerge(matches, preferredRootPath);
      };
      const normalizeEntryChildLinkPath = (entry) => {
        return normalizeUsdPathToken(String(entry?.linkPath || entry?.childLinkPath || entry?.body1Path || '')) || null;
      };

      const existingJointCatalogEntries = Array.isArray(snapshot.jointCatalogEntries)
        ? snapshot.jointCatalogEntries.slice()
        : [];
      const existingEntryByChildLinkPath = new Map();
      for (const entry of existingJointCatalogEntries) {
        const childLinkPath = normalizeEntryChildLinkPath(entry);
        if (!childLinkPath) continue;
        if (!linkPathSetForMerge.has(childLinkPath)) continue;
        if (existingEntryByChildLinkPath.has(childLinkPath)) continue;
        existingEntryByChildLinkPath.set(childLinkPath, entry);
      }

      const existingLinkParentPairs = Array.isArray(snapshot.linkParentPairs)
        ? snapshot.linkParentPairs.slice()
        : [];
      const existingPairKeySet = new Set();
      for (const pair of existingLinkParentPairs) {
        if (!Array.isArray(pair) || pair.length <= 0) continue;
        const childLinkPath = normalizeUsdPathToken(String(pair[0] || '')) || null;
        if (!childLinkPath) continue;
        const parentLinkPath = normalizeUsdPathToken(String(pair[1] || '')) || null;
        existingPairKeySet.add(`${childLinkPath}|${parentLinkPath || ''}`);
      }

      let mutated = false;
      for (const jointRecord of driverJointRecords) {
        const body1Path = normalizeUsdPathToken(String(jointRecord?.body1Path || '')) || null;
        if (!body1Path) continue;
        const body0Path = normalizeUsdPathToken(String(jointRecord?.body0Path || '')) || null;
        const jointPath = normalizeUsdPathToken(String(jointRecord?.jointPath || jointRecord?.path || '')) || null;
        const fallbackJointName = jointPath ? getPathBasename(jointPath) : '';
        const jointName = String(jointRecord?.jointName || fallbackJointName || '').trim();
        const jointTypeName = String(jointRecord?.jointTypeName || jointRecord?.jointType || '').trim();
        const jointType = normalizeStageJointType(jointTypeName);
        const axisToken = normalizeAxisToken(jointRecord?.axisToken || jointRecord?.axis || 'X');
        const localPos1 = normalizeVector3(jointRecord?.localPos1 || [0, 0, 0], [0, 0, 0]);
        const localRot1Wxyz = normalizeQuaternionWxyz(
          jointRecord?.localRot1Wxyz || jointRecord?.localRot1 || [1, 0, 0, 0],
          [1, 0, 0, 0],
        );
        const axisLocal = rotateAxisByQuaternionWxyz(axisToken, localRot1Wxyz);
        const limits = normalizeStageJointLimits(
          jointTypeName || jointType,
          Number(jointRecord?.lowerLimitDeg),
          Number(jointRecord?.upperLimitDeg),
        );

        const childLinkPaths = resolveRuntimeLinkPathsFromSourcePathForMerge(body1Path);
        for (const childLinkPath of childLinkPaths) {
          if (!childLinkPath) continue;
          const preferredRootPath = getRootPathFromPrimPath(childLinkPath);
          const parentCandidates = resolveRuntimeLinkPathsFromSourcePathForMerge(body0Path, preferredRootPath);
          const parentLinkPath = parentCandidates[0] || null;

          const pairKey = `${childLinkPath}|${parentLinkPath || ''}`;
          if (!existingPairKeySet.has(pairKey)) {
            existingPairKeySet.add(pairKey);
            existingLinkParentPairs.push([childLinkPath, parentLinkPath]);
            mutated = true;
          }

          const existingEntry = existingEntryByChildLinkPath.get(childLinkPath) || null;
          if (existingEntry) {
            if (!existingEntry.parentLinkPath && parentLinkPath) {
              existingEntry.parentLinkPath = parentLinkPath;
              mutated = true;
            }
            if (!existingEntry.jointPath && jointPath) {
              existingEntry.jointPath = jointPath;
              mutated = true;
            }
            if (!existingEntry.jointName && jointName) {
              existingEntry.jointName = jointName;
              mutated = true;
            }
            if (!existingEntry.jointTypeName && jointTypeName) {
              existingEntry.jointTypeName = jointTypeName;
              mutated = true;
            }
            if (!existingEntry.jointType && jointType) {
              existingEntry.jointType = jointType;
              mutated = true;
            }
            if (isNonRotationalStageJointType(jointTypeName || jointType)) {
              const existingLowerLimit = Number(existingEntry.lowerLimitDeg);
              const existingUpperLimit = Number(existingEntry.upperLimitDeg);
              const hasExistingLimits = Number.isFinite(existingLowerLimit) && Number.isFinite(existingUpperLimit);
              const looksLikeLegacyDefaultLimits = hasExistingLimits
                && Math.abs(existingLowerLimit + 180) <= 1e-6
                && Math.abs(existingUpperLimit - 180) <= 1e-6;
              if (!hasExistingLimits || looksLikeLegacyDefaultLimits) {
                existingEntry.lowerLimitDeg = limits.lower;
                existingEntry.upperLimitDeg = limits.upper;
                mutated = true;
              }
            }
            continue;
          }

          const fallbackRootPath = getRootPathFromPrimPath(childLinkPath);
          const fallbackJointNameForPath = jointName || `${getPathBasename(childLinkPath) || 'link'}_joint`;
          const resolvedJointPath = jointPath
            || (fallbackRootPath
              ? `${fallbackRootPath}/joints/${fallbackJointNameForPath}`
              : `/joints/${fallbackJointNameForPath}`);

          const newEntry = {
            linkPath: childLinkPath,
            childLinkPath: childLinkPath,
            jointPath: resolvedJointPath,
            jointName: fallbackJointNameForPath,
            jointType: jointType,
            jointTypeName: jointTypeName || null,
            parentLinkPath,
            axisToken,
            axisLocal,
            lowerLimitDeg: limits.lower,
            upperLimitDeg: limits.upper,
            localPivotInLink: localPos1,
          };
          existingJointCatalogEntries.push(newEntry);
          existingEntryByChildLinkPath.set(childLinkPath, newEntry);
          mutated = true;
        }
      }

      if (!mutated) return snapshot;
      existingLinkParentPairs.sort((left, right) => String(left?.[0] || '').localeCompare(String(right?.[0] || '')));
      return {
        ...snapshot,
        linkParentPairs: existingLinkParentPairs,
        jointCatalogEntries: existingJointCatalogEntries,
      };
    };
    if (!truth) {
      let cxxSnapshot = this.tryBuildRobotMetadataSnapshotFromDriver(
        normalizedStagePath,
        sortedLinkPaths,
        meshCountsByLinkPath,
      );
      cxxSnapshot = mergeMissingJointCatalogEntriesFromDriver(cxxSnapshot);
      if (cxxSnapshot) {
        const cxxLinkParentCount = Array.isArray(cxxSnapshot.linkParentPairs)
          ? cxxSnapshot.linkParentPairs.length
          : 0;
        const cxxJointCount = Array.isArray(cxxSnapshot.jointCatalogEntries)
          ? cxxSnapshot.jointCatalogEntries.length
          : 0;
        const cxxDynamicsCount = Array.isArray(cxxSnapshot.linkDynamicsEntries)
          ? cxxSnapshot.linkDynamicsEntries.length
          : 0;
        const cxxHasCompleteStageMetadata = cxxJointCount > 0 && cxxDynamicsCount > 0;
        const cxxHasAnyStageMetadata = cxxLinkParentCount > 0 || cxxJointCount > 0 || cxxDynamicsCount > 0;
        const stage = allowJsStageFallback ? getStageForMetadataFallback() : null;
        if (cxxHasCompleteStageMetadata || (!stage && cxxHasAnyStageMetadata) || !allowJsStageFallback) {
          return cxxSnapshot;
        }
      }
      if (!allowJsStageFallback) {
        return {
          stageSourcePath: normalizedStagePath,
          generatedAtMs: this._nowPerfMs(),
          source: 'mesh-only',
          linkParentPairs: [],
          jointCatalogEntries: [],
          linkDynamicsEntries: [],
          meshCountsByLinkPath,
        };
      }
      const stage = getStageForMetadataFallback();
      metadataLayerTexts = this.getStageMetadataLayerTexts(stage);
    }

    const jointCatalogEntries = [];
    const linkDynamicsEntries = [];
    const rootPaths = Array.from(new Set(sortedLinkPaths.map((linkPath) => getRootPathFromPrimPath(linkPath)).filter(Boolean)));
    const runtimeLinkPathsByName = new Map();
    for (const linkPath of sortedLinkPaths) {
      const linkName = getPathBasename(linkPath);
      if (!linkName) continue;
      const existing = runtimeLinkPathsByName.get(linkName) || [];
      existing.push(linkPath);
      runtimeLinkPathsByName.set(linkName, existing);
    }
    const sortByPreferredRoot = (paths, preferredRootPath = null) => {
      const deduped = Array.from(new Set(paths.filter(Boolean)));
      deduped.sort((left, right) => left.localeCompare(right));
      if (!preferredRootPath) return deduped;
      return deduped.sort((left, right) => {
        const leftPreferred = getRootPathFromPrimPath(left) === preferredRootPath ? 0 : 1;
        const rightPreferred = getRootPathFromPrimPath(right) === preferredRootPath ? 0 : 1;
        if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
        return left.localeCompare(right);
      });
    };
    const resolveRuntimeLinkPathsFromSourcePath = (sourcePath, preferredRootPath = null) => {
      const source = String(sourcePath || '').trim();
      if (!source) return [];
      const normalizedSourcePath = normalizeUsdPathToken(source);
      const matches = [];
      const addMatch = (candidatePath) => {
        if (!candidatePath) return;
        if (!linkPathSet.has(candidatePath)) return;
        if (matches.includes(candidatePath)) return;
        matches.push(candidatePath);
      };

      addMatch(normalizedSourcePath);
      const linkName = getPathBasename(normalizedSourcePath || source.replace(/[<>]/g, ''));
      if (linkName) {
        for (const candidatePath of runtimeLinkPathsByName.get(linkName) || []) {
          addMatch(candidatePath);
        }
      }

      if (normalizedSourcePath) {
        const sourceWithoutRoot = getPathWithoutRoot(normalizedSourcePath);
        if (sourceWithoutRoot && sourceWithoutRoot !== '/') {
          const remapOrder = preferredRootPath
            ? [preferredRootPath, ...rootPaths.filter((entry) => entry !== preferredRootPath)]
            : rootPaths;
          for (const rootPath of remapOrder) {
            if (!rootPath) continue;
            addMatch(`${rootPath}${sourceWithoutRoot}`);
          }
        }
      }

      return sortByPreferredRoot(matches, preferredRootPath);
    };
    const stageJointRecordByChildLinkPath = new Map();
    const stageLinkDynamicsRecordByLinkPath = new Map();
    const linkParentPathByChildLinkPath = new Map();
    const ingestStageJointRecords = (jointRecords) => {
      if (!Array.isArray(jointRecords) || jointRecords.length <= 0) return;
      const seenJointKeys = new Set();

      for (const jointRecord of jointRecords) {
        const body1Path = normalizeUsdPathToken(String(jointRecord?.body1Path || ''));
        if (!body1Path) continue;
        const body0Path = normalizeUsdPathToken(String(jointRecord?.body0Path || '')) || null;
        const jointPath = normalizeUsdPathToken(String(jointRecord?.jointPath || jointRecord?.path || '')) || null;
        const fallbackJointName = jointPath ? getPathBasename(jointPath) : '';
        const jointName = String(jointRecord?.jointName || fallbackJointName || '').trim();
        const jointTypeName = String(jointRecord?.jointTypeName || jointRecord?.jointType || '').trim();
        const jointType = normalizeStageJointType(jointTypeName);
        const axisToken = normalizeAxisToken(jointRecord?.axisToken || jointRecord?.axis || 'X');
        const limits = normalizeStageJointLimits(
          jointTypeName || jointType,
          Number(jointRecord?.lowerLimitDeg),
          Number(jointRecord?.upperLimitDeg),
        );
        const localPos1 = normalizeVector3(jointRecord?.localPos1 || [0, 0, 0], [0, 0, 0]);
        const localRot1Wxyz = normalizeQuaternionWxyz(
          jointRecord?.localRot1Wxyz || jointRecord?.localRot1 || [1, 0, 0, 0],
          [1, 0, 0, 0],
        );
        const key = `${jointName}|${body0Path || ''}|${body1Path}`;
        if (seenJointKeys.has(key)) continue;
        seenJointKeys.add(key);

        const childLinkPaths = resolveRuntimeLinkPathsFromSourcePath(body1Path);
        for (const childLinkPath of childLinkPaths) {
          if (!childLinkPath) continue;
          const preferredRootPath = getRootPathFromPrimPath(childLinkPath);
          const parentCandidates = resolveRuntimeLinkPathsFromSourcePath(body0Path, preferredRootPath);
          const parentLinkPath = parentCandidates[0] || null;
          if (!linkParentPathByChildLinkPath.has(childLinkPath)) {
            linkParentPathByChildLinkPath.set(childLinkPath, parentLinkPath);
          }

          if (stageJointRecordByChildLinkPath.has(childLinkPath)) continue;
          stageJointRecordByChildLinkPath.set(childLinkPath, {
            jointName,
            jointPath,
            jointTypeName,
            jointType: jointType,
            body0Path,
            body1Path,
            axisToken,
            lowerLimitDeg: limits.lower,
            upperLimitDeg: limits.upper,
            localPos1,
            localRot1Wxyz,
            parentLinkPath,
          });
        }
      }
    };

    if (!truth && allowJsStageFallback) {
      const driverRecords = (() => {
        try {
          const activeDriver = typeof window !== 'undefined' ? window?.driver : null;
          if (!activeDriver) {
            return { jointRecords: [], linkDynamicsRecords: [] };
          }

          const rawJointRecords = (typeof activeDriver.GetPhysicsJointRecords === 'function')
            ? activeDriver.GetPhysicsJointRecords()
            : [];
          const jointRecords = (
            rawJointRecords && typeof rawJointRecords.length === 'number'
              ? Array.from(rawJointRecords)
              : []
          );

          const rawLinkDynamicsRecords = (typeof activeDriver.GetPhysicsLinkDynamicsRecords === 'function')
            ? activeDriver.GetPhysicsLinkDynamicsRecords()
            : [];
          const linkDynamicsRecords = (
            rawLinkDynamicsRecords && typeof rawLinkDynamicsRecords.length === 'number'
              ? Array.from(rawLinkDynamicsRecords)
              : []
          );

          return { jointRecords, linkDynamicsRecords };
        } catch {
          return { jointRecords: [], linkDynamicsRecords: [] };
        }
      })();
      ingestStageJointRecords(driverRecords.jointRecords);

      for (const dynamicsRecord of driverRecords.linkDynamicsRecords) {
        const linkPath = normalizeUsdPathToken(String(dynamicsRecord?.linkPath || ''));
        if (!linkPath) continue;
        if (!linkPathSet.has(linkPath)) continue;

        const massValue = toFiniteNumber(dynamicsRecord?.mass);
        const centerOfMassLocal = normalizeVector3(dynamicsRecord?.centerOfMassLocal, [0, 0, 0]);
        const diagonalInertiaTuple = toFiniteVector3Tuple(dynamicsRecord?.diagonalInertia);
        const principalAxesLocalWxyz = normalizeQuaternionWxyz(dynamicsRecord?.principalAxesLocalWxyz, [1, 0, 0, 0]);

        const hasDynamicsData = (
          hasSignificantMassValue(massValue)
          || hasSignificantVector3(centerOfMassLocal)
          || (Array.isArray(diagonalInertiaTuple) && hasSignificantVector3(diagonalInertiaTuple))
          || hasNonIdentityQuaternionWxyz(principalAxesLocalWxyz)
        );
        if (!hasDynamicsData) continue;

        stageLinkDynamicsRecordByLinkPath.set(linkPath, {
          mass: massValue === undefined ? null : Number(massValue),
          centerOfMassLocal,
          diagonalInertia: Array.isArray(diagonalInertiaTuple)
            ? normalizeVector3(diagonalInertiaTuple, [0, 0, 0])
            : null,
          principalAxesLocalWxyz,
        });
      }
    }

    if (!truth && metadataLayerTexts.length > 0) {
      for (const layerText of metadataLayerTexts) {
        ingestStageJointRecords(extractJointRecordsFromLayerText(layerText));
      }
    }
    const linkDynamicsPatchesByLinkPath = new Map();
    if (!truth && metadataLayerTexts.length > 0) {
      const mergePatch = (linkPath, incomingPatch) => {
        if (!linkPath || !incomingPatch || typeof incomingPatch !== 'object') return;
        const existingPatch = linkDynamicsPatchesByLinkPath.get(linkPath) || {};
        const nextPatch = { ...existingPatch };
        if (incomingPatch.mass !== undefined && Number.isFinite(Number(incomingPatch.mass))) {
          nextPatch.mass = Number(incomingPatch.mass);
        }
        if (Array.isArray(incomingPatch.centerOfMassLocal)) {
          nextPatch.centerOfMassLocal = normalizeVector3(incomingPatch.centerOfMassLocal, [0, 0, 0]);
        }
        if (Array.isArray(incomingPatch.diagonalInertia)) {
          nextPatch.diagonalInertia = normalizeVector3(incomingPatch.diagonalInertia, [0, 0, 0]);
        }
        if (Array.isArray(incomingPatch.principalAxesLocalWxyz)) {
          nextPatch.principalAxesLocalWxyz = normalizeQuaternionWxyz(incomingPatch.principalAxesLocalWxyz, [1, 0, 0, 0]);
        }
        linkDynamicsPatchesByLinkPath.set(linkPath, nextPatch);
      };

      for (const layerText of metadataLayerTexts) {
        const parsedPatches = parseLinkDynamicsPatchesFromLayerText(layerText);
        for (const [linkPath, patch] of parsedPatches.entries()) {
          mergePatch(linkPath, patch);
        }
      }
    }
    const linkDynamicsPatchesByLinkName = new Map();
    for (const [linkPath, patch] of linkDynamicsPatchesByLinkPath.entries()) {
      const linkName = getPathBasename(linkPath);
      if (!linkName) continue;
      if (!linkDynamicsPatchesByLinkName.has(linkName)) {
        linkDynamicsPatchesByLinkName.set(linkName, patch);
      }
    }
    const jointByChildLinkName = truth?.jointByChildLinkName;
    const inertialByLinkName = truth?.inertialByLinkName;
    const stage = shouldReadStageDataInJs ? getStageForMetadataFallback() : null;

    for (const linkPath of sortedLinkPaths) {
      const linkName = getPathBasename(linkPath);
      const rootPath = getRootPathFromPrimPath(linkPath);

      const jointEntry = jointByChildLinkName?.get?.(linkName) || stageJointRecordByChildLinkPath.get(linkPath) || null;
      if (jointEntry) {
        const isUrdfJointEntry = !!(jointByChildLinkName?.get?.(linkName));
        const stageAxisToken = normalizeAxisToken(jointEntry.axisToken || 'X');
        const axisLocal = isUrdfJointEntry
          ? normalizeVector3(jointEntry.axisLocal, [1, 0, 0])
          : rotateAxisByQuaternionWxyz(stageAxisToken, jointEntry.localRot1Wxyz);
        const axisToken = isUrdfJointEntry ? axisTokenFromAxis(axisLocal) : stageAxisToken;
        const jointName = String(jointEntry.jointName || `${linkName}_joint`).trim() || `${linkName}_joint`;
        const stageParentCandidates = resolveRuntimeLinkPathsFromSourcePath(jointEntry.body0Path, rootPath);
        const parentLinkName = String(jointEntry.parentLinkName || '').trim();
        const parentLinkPath = linkParentPathByChildLinkPath.get(linkPath)
          || stageParentCandidates[0]
          || (parentLinkName ? (rootPath ? `${rootPath}/${parentLinkName}` : `/${parentLinkName}`) : null);
        if (!linkParentPathByChildLinkPath.has(linkPath)) {
          linkParentPathByChildLinkPath.set(linkPath, parentLinkPath || null);
        }
        const jointTypeName = String(jointEntry.jointTypeName || jointEntry.jointType || '').trim();
        const jointType = normalizeStageJointType(jointTypeName);
        const limits = normalizeStageJointLimits(
          jointTypeName || jointType,
          Number(jointEntry.lowerLimitDeg),
          Number(jointEntry.upperLimitDeg),
        );
        const localPivotInLink = Array.isArray(jointEntry.originXyz)
          ? normalizeVector3(jointEntry.originXyz, [0, 0, 0])
          : (Array.isArray(jointEntry.localPos1) ? normalizeVector3(jointEntry.localPos1, [0, 0, 0]) : null);
        jointCatalogEntries.push({
          linkPath,
          jointPath: rootPath ? `${rootPath}/joints/${jointName}` : `/joints/${jointName}`,
          jointName,
          jointType: jointType,
          jointTypeName: jointTypeName || null,
          parentLinkPath,
          axisToken,
          axisLocal,
          lowerLimitDeg: limits.lower,
          upperLimitDeg: limits.upper,
          localPivotInLink,
        });
      }

      const inertialEntry = inertialByLinkName?.get?.(linkName) || null;
      if (inertialEntry || stage) {
        const stageDynamicsRecord = stageLinkDynamicsRecordByLinkPath.get(linkPath) || null;
        const prim = safeGetPrimAtPath(stage, linkPath);
        const stagePatch = linkDynamicsPatchesByLinkPath.get(linkPath) || linkDynamicsPatchesByLinkName.get(linkName) || null;

        const massValueFromPrim = toFiniteNumber(safeGetPrimAttribute(prim, 'physics:mass'));
        const massValue = Number.isFinite(Number(inertialEntry?.mass))
          ? Number(inertialEntry.mass)
          : (
            stageDynamicsRecord?.mass !== null && Number.isFinite(Number(stageDynamicsRecord?.mass))
              ? Number(stageDynamicsRecord.mass)
              : (massValueFromPrim !== undefined ? Number(massValueFromPrim) : (Number.isFinite(Number(stagePatch?.mass)) ? Number(stagePatch.mass) : null))
          );

        const centerOfMassTupleFromPrim = toFiniteVector3Tuple(safeGetPrimAttribute(prim, 'physics:centerOfMass'));
        const diagonalInertiaTupleFromPrim = toFiniteVector3Tuple(safeGetPrimAttribute(prim, 'physics:diagonalInertia'));
        const principalAxesTupleFromPrim = toFiniteQuaternionWxyzTuple(safeGetPrimAttribute(prim, 'physics:principalAxes'));

        const centerOfMassLocal = inertialEntry
          ? normalizeVector3(inertialEntry.centerOfMassLocal, [0, 0, 0])
          : normalizeVector3(stageDynamicsRecord?.centerOfMassLocal || centerOfMassTupleFromPrim || stagePatch?.centerOfMassLocal, [0, 0, 0]);
        const diagonalInertia = inertialEntry
          ? (Array.isArray(inertialEntry.diagonalInertia) ? normalizeVector3(inertialEntry.diagonalInertia, [0, 0, 0]) : null)
          : (Array.isArray(stageDynamicsRecord?.diagonalInertia || diagonalInertiaTupleFromPrim || stagePatch?.diagonalInertia)
            ? normalizeVector3(stageDynamicsRecord?.diagonalInertia || diagonalInertiaTupleFromPrim || stagePatch?.diagonalInertia, [0, 0, 0])
            : null);
        const principalAxesWxyz = inertialEntry
          ? normalizeQuaternionWxyz(inertialEntry.principalAxesLocalWxyz, [1, 0, 0, 0])
          : normalizeQuaternionWxyz(
            stageDynamicsRecord?.principalAxesLocalWxyz || principalAxesTupleFromPrim || stagePatch?.principalAxesLocalWxyz,
            [1, 0, 0, 0],
          );
        const hasDynamicsData = (
          hasSignificantMassValue(massValue)
          || hasSignificantVector3(centerOfMassLocal)
          || hasSignificantVector3(diagonalInertia)
          || hasNonIdentityQuaternionWxyz(principalAxesWxyz)
        );
        if (!hasDynamicsData) {
          continue;
        }

        linkDynamicsEntries.push({
          linkPath,
          mass: massValue,
          centerOfMassLocal,
          diagonalInertia,
          principalAxesLocal: [principalAxesWxyz[1], principalAxesWxyz[2], principalAxesWxyz[3], principalAxesWxyz[0]],
        });
      }
    }

    const linkParentPairs = Array.from(linkParentPathByChildLinkPath.entries())
      .filter(([childLinkPath]) => !!childLinkPath)
      .map(([childLinkPath, parentLinkPath]) => [childLinkPath, parentLinkPath || null]);
    linkParentPairs.sort((left, right) => String(left[0] || '').localeCompare(String(right[0] || '')));

    let metadataSource = 'mesh-only';
    if (truth) {
      metadataSource = 'urdf-truth';
    } else if (jointCatalogEntries.length > 0 || linkDynamicsEntries.length > 0 || linkParentPairs.length > 0) {
      metadataSource = 'usd-stage';
    }

    return {
      stageSourcePath: normalizedStagePath,
      generatedAtMs: this._nowPerfMs(),
      source: metadataSource,
      linkParentPairs,
      jointCatalogEntries,
      linkDynamicsEntries,
      meshCountsByLinkPath,
    };
  }

  startRobotMetadataWarmupForStage(stageSourcePathOrOptions = null, maybeOptions = null) {
    let stageSourcePath = null;
    let options = {};
    if (typeof stageSourcePathOrOptions === 'string') {
      stageSourcePath = stageSourcePathOrOptions;
      options = (maybeOptions && typeof maybeOptions === 'object') ? maybeOptions : {};
    } else {
      options = (stageSourcePathOrOptions && typeof stageSourcePathOrOptions === 'object')
        ? stageSourcePathOrOptions
        : {};
    }

    const force = options?.force === true;
    const skipIdleWait = options?.skipIdleWait === true;
    const skipUrdfTruthFallback = true;
    const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
    if (!normalizedStagePath) return Promise.resolve(null);

    if (!force && this._robotMetadataSnapshotByStageSource.has(normalizedStagePath)) {
      const cachedSnapshot = this._robotMetadataSnapshotByStageSource.get(normalizedStagePath) || null;
      const hasCachedMetadata = (
        Array.isArray(cachedSnapshot?.jointCatalogEntries) && cachedSnapshot.jointCatalogEntries.length > 0
      ) || (
        Array.isArray(cachedSnapshot?.linkDynamicsEntries) && cachedSnapshot.linkDynamicsEntries.length > 0
      ) || (
        Array.isArray(cachedSnapshot?.linkParentPairs) && cachedSnapshot.linkParentPairs.length > 0
      );
      if (hasCachedMetadata) {
        return Promise.resolve(cachedSnapshot);
      }
    }
    if (this._robotMetadataBuildPromisesByStageSource.has(normalizedStagePath)) {
      return this._robotMetadataBuildPromisesByStageSource.get(normalizedStagePath);
    }

    const waitForIdleSlice = async (options = {}) => {
      const minBudgetMs = Math.max(0, Number(options?.minBudgetMs ?? 6));
      const maxPasses = Math.max(1, Math.floor(Number(options?.maxPasses ?? 6)));
      const timeoutMs = Math.max(0, Math.floor(Number(options?.timeoutMs ?? 360)));
      await new Promise<void>((resolve) => {
        try {
          (globalThis as any).setTimeout(resolve, 0);
        } catch {
          resolve();
        }
      });

      const requestIdle = (globalThis as any).requestIdleCallback as
        | ((callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void, options?: { timeout?: number }) => number)
        | undefined;
      if (typeof requestIdle !== 'function') return;

      for (let pass = 0; pass < maxPasses; pass += 1) {
        const hasBudget = await new Promise<boolean>((resolve) => {
          let done = false;
          const finish = (value: boolean) => {
            if (done) return;
            done = true;
            resolve(value);
          };
          try {
            requestIdle((deadline) => {
              const remaining = Number(deadline?.timeRemaining?.() || 0);
              const timedOut = deadline?.didTimeout === true;
              finish(timedOut || remaining >= minBudgetMs);
            }, { timeout: timeoutMs });
          } catch {
            finish(true);
            return;
          }
          try {
            (globalThis as any).setTimeout(() => finish(true), timeoutMs + 120);
          } catch {}
        });

        if (hasBudget) return;

        await new Promise<void>((resolve) => {
          try {
            (globalThis as any).setTimeout(resolve, 0);
          } catch {
            resolve();
          }
        });
      }
    };

    const buildPromise = Promise.resolve()
      .then(async () => {
        if (!skipIdleWait) {
          await waitForIdleSlice({ minBudgetMs: 6, maxPasses: 8, timeoutMs: 360 });
        }
        let snapshot = this.buildRobotMetadataSnapshotForStage(normalizedStagePath, null);
        const needsUrdfTruth = (
          !skipUrdfTruthFallback
          && this.shouldAllowUrdfHttpFallback()
          && (
            !snapshot
            || (
              (!Array.isArray(snapshot.jointCatalogEntries) || snapshot.jointCatalogEntries.length <= 0)
              && (!Array.isArray(snapshot.linkDynamicsEntries) || snapshot.linkDynamicsEntries.length <= 0)
            )
          )
        );
        if (needsUrdfTruth) {
          const truthPromise = this.startUrdfTruthLoadForStage(normalizedStagePath);
          const truth = truthPromise ? await truthPromise.catch(() => null) : null;
          if (!skipIdleWait) {
            await waitForIdleSlice({ minBudgetMs: 4, maxPasses: 6, timeoutMs: 420 });
          }
          snapshot = this.buildRobotMetadataSnapshotForStage(normalizedStagePath, truth || null);
        }
        if (!snapshot) return null;
        this._robotMetadataSnapshotByStageSource.set(normalizedStagePath, snapshot);
        this.emitRobotMetadataSnapshotReady(snapshot);
        return snapshot;
      })
      .finally(() => {
        this._robotMetadataBuildPromisesByStageSource.delete(normalizedStagePath);
      });

    this._robotMetadataBuildPromisesByStageSource.set(normalizedStagePath, buildPromise);
    return buildPromise;
  }

  async prefetchUrdfTruthForStage() {
    const stageSourcePath = this.getNormalizedStageSourcePath();
    if (!stageSourcePath) return null;
    const loadPromise = this.startUrdfTruthLoadForStage(stageSourcePath);
    if (!loadPromise) return null;
    try {
      return await loadPromise;
    } catch {
      return null;
    }
  }

  startUrdfTruthLoadForStage(stageSourcePath) {
    const normalizedStagePath = String(stageSourcePath || '').trim().split('?')[0];
    if (!normalizedStagePath) return null;
    if (!this.shouldAllowUrdfHttpFallback()) {
      this._urdfTruthByStageSource.set(normalizedStagePath, null);
      return Promise.resolve(null);
    }

    if (this._urdfTruthByStageSource.has(normalizedStagePath)) {
      return Promise.resolve(this._urdfTruthByStageSource.get(normalizedStagePath) || null);
    }
    if (this._urdfTruthLoadPromisesByStageSource.has(normalizedStagePath)) {
      return this._urdfTruthLoadPromisesByStageSource.get(normalizedStagePath);
    }

    const urdfFileName = resolveUrdfTruthFileNameForStagePath(normalizedStagePath);
    if (!urdfFileName) {
      this._urdfTruthByStageSource.set(normalizedStagePath, null);
      return Promise.resolve(null);
    }

    const loadPromise = fetch(`/urdf/${encodeURIComponent(urdfFileName)}`)
      .then(async (response) => {
        if (!response.ok) return null;
        const text = await response.text();
        return parseUrdfTruthFromText(text);
      })
      .catch(() => null)
      .then((truth) => {
        this._urdfTruthByStageSource.set(normalizedStagePath, truth || null);
        return truth || null;
      })
      .finally(() => {
        this._urdfTruthLoadPromisesByStageSource.delete(normalizedStagePath);
      });

    this._urdfTruthLoadPromisesByStageSource.set(normalizedStagePath, loadPromise);
    return loadPromise;
  }

  getUrdfTruthForCurrentStage() {
    const stageSourcePath = this.getNormalizedStageSourcePath();
    if (!stageSourcePath) return null;
    if (this._urdfTruthByStageSource.has(stageSourcePath)) {
      return this._urdfTruthByStageSource.get(stageSourcePath) || null;
    }
    this.startUrdfTruthLoadForStage(stageSourcePath);
    return null;
  }

  getUrdfJointEntryForPrimPath(primPath) {
    const truth = this.getUrdfTruthForCurrentStage();
    if (!truth?.jointByChildLinkName) return null;
    const linkName = getPathBasename(primPath);
    if (!linkName) return null;
    return truth.jointByChildLinkName.get(linkName) || null;
  }

  getVisualLinkFrameTransform(linkPath) {
    if (!linkPath || !linkPath.startsWith('/')) return null;

    const primaryVisualMeshMatrix = this.meshes?.[`${linkPath}/visuals.proto_mesh_id0`]?._mesh?.matrix || null;
    if (primaryVisualMeshMatrix) return primaryVisualMeshMatrix.clone();

    const representativeVisualMatrix = this.getRepresentativeVisualTransformForLinkPath(linkPath) || null;
    return representativeVisualMatrix ? representativeVisualMatrix.clone() : null;
  }

  getStageOrVisualLinkWorldTransform(linkPath) {
    if (!linkPath || !linkPath.startsWith('/')) return null;

    const stageWorldMatrix = this.getWorldTransformForPrimPath(linkPath) || null;
    const visualLinkFrameMatrix = this.getVisualLinkFrameTransform(linkPath) || null;
    if (!stageWorldMatrix) return visualLinkFrameMatrix ? visualLinkFrameMatrix.clone() : null;
    if (!visualLinkFrameMatrix) return stageWorldMatrix.clone();

    const stageLooksIdentity = isMatrixApproximatelyIdentity(stageWorldMatrix);
    const visualFrameLooksAuthored = !isMatrixApproximatelyIdentity(visualLinkFrameMatrix)
      || hasNonZeroTranslation(visualLinkFrameMatrix);
    if (stageLooksIdentity && visualFrameLooksAuthored) {
      return visualLinkFrameMatrix.clone();
    }

    return stageWorldMatrix.clone();
  }

  getPreferredLinkWorldTransform(linkPath) {
    if (!linkPath || !linkPath.startsWith('/')) return null;
    return this.getStageOrVisualLinkWorldTransform(linkPath);
  }

  getUrdfLinkWorldTransformFromJointChain(linkPath) {
    if (!linkPath || !linkPath.startsWith('/')) return null;

    const stageSourcePath = this.getNormalizedStageSourcePath() || '__unknown_stage__';
    let stageCache = this._urdfLinkWorldTransformCacheByStageSource.get(stageSourcePath);
    if (!(stageCache instanceof Map)) {
      stageCache = new Map();
      this._urdfLinkWorldTransformCacheByStageSource.set(stageSourcePath, stageCache);
    }
    if (stageCache.has(linkPath)) {
      const cached = stageCache.get(linkPath);
      return cached ? cached.clone() : null;
    }

    const truth = this.getUrdfTruthForCurrentStage();
    if (!truth?.jointByChildLinkName) {
      return null;
    }

    const linkName = getPathBasename(linkPath);
    if (!linkName) {
      stageCache.set(linkPath, null);
      return null;
    }

    const urdfRelativeMatrix = new Matrix4().identity();
    let currentLinkName = linkName;
    let traversedJointCount = 0;
    const visitedLinks = new Set();

    while (currentLinkName && !visitedLinks.has(currentLinkName)) {
      visitedLinks.add(currentLinkName);
      const jointEntry = truth.jointByChildLinkName.get(currentLinkName);
      if (!jointEntry) {
        break;
      }

      let jointLocalMatrix = jointEntry.localMatrix || null;
      if (!jointLocalMatrix && jointEntry.originXyz && jointEntry.originQuatWxyz) {
        jointLocalMatrix = toMatrixFromUrdfOrigin(jointEntry.originXyz, jointEntry.originQuatWxyz);
      }
      if (jointLocalMatrix) {
        urdfRelativeMatrix.premultiply(jointLocalMatrix);
      }

      traversedJointCount += 1;
      const parentLinkName = String(jointEntry.parentLinkName || '').trim();
      if (!parentLinkName) {
        break;
      }
      currentLinkName = parentLinkName;
    }

    const rootLinkName = currentLinkName;
    const slashIndex = linkPath.lastIndexOf('/');
    const linkParentPath = slashIndex > 0 ? linkPath.slice(0, slashIndex) : '';

    let rootLinkStageMatrix = null;
    if (rootLinkName) {
      const rootLinkPathFromParent = linkParentPath ? `${linkParentPath}/${rootLinkName}` : '';
      const stageRootPath = getRootPathFromPrimPath(linkPath);
      const rootLinkPathFromStageRoot = stageRootPath ? `${stageRootPath}/${rootLinkName}` : '';
      const rootPathCandidates = [
        rootLinkPathFromParent,
        rootLinkPathFromStageRoot,
      ].filter((candidatePath, candidateIndex, allCandidates) => {
        return !!candidatePath && allCandidates.indexOf(candidatePath) === candidateIndex;
      });

      for (const candidatePath of rootPathCandidates) {
        rootLinkStageMatrix = this.getStageOrVisualLinkWorldTransform(candidatePath);
        if (rootLinkStageMatrix) {
          break;
        }
      }
    }

    let result = null;
    if (rootLinkStageMatrix) {
      result = rootLinkStageMatrix.clone().multiply(urdfRelativeMatrix);
    } else if (traversedJointCount > 0) {
      result = urdfRelativeMatrix.clone();
    }

    stageCache.set(linkPath, result ? result.clone() : null);
    return result ? result.clone() : null;
  }

  getUrdfCollisionEntryForMeshId(meshId) {
    const truth = this.getUrdfTruthForCurrentStage();
    if (!truth?.collisionsByLinkName) return null;

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto || proto.sectionName !== 'collisions') return null;
    const linkName = getPathBasename(proto.linkPath);
    if (!linkName) return null;

    const linkCollisions = truth.collisionsByLinkName.get(linkName);
    if (!linkCollisions) return null;
    const geometryType = proto.protoType === 'box' ? 'box' : proto.protoType;
    const typedEntries = linkCollisions.byType?.get(geometryType) || [];
    if (typedEntries[proto.protoIndex]) return typedEntries[proto.protoIndex];

    // Keep URDF fallback strict by proto index/type. If USD expands a link into
    // multiple collider prototypes while URDF only exposes one collider entry,
    // reusing index 0 for all prototypes causes stacked/overlapping colliders.
    if (proto.protoIndex === 0) {
      if (typedEntries.length === 1) return typedEntries[0];
      if (typedEntries.length === 0 && linkCollisions.all?.length === 1) return linkCollisions.all[0];
    }
    return null;
  }

  getUrdfVisualEntryForMeshId(meshId) {
    const truth = this.getUrdfTruthForCurrentStage();
    if (!truth?.visualsByLinkName) return null;

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto || proto.sectionName !== 'visuals') return null;
    const linkName = getPathBasename(proto.linkPath);
    if (!linkName) return null;

    const linkVisuals = truth.visualsByLinkName.get(linkName);
    if (!Array.isArray(linkVisuals) || linkVisuals.length === 0) return null;
    if (linkVisuals[proto.protoIndex]) return linkVisuals[proto.protoIndex];
    if (proto.protoIndex === 0 && linkVisuals.length === 1) return linkVisuals[0];
    return null;
  }

  getCollisionWorldTransformFromUrdfTruth(meshId) {
    const collisionEntry = this.getUrdfCollisionEntryForMeshId(meshId);
    if (!collisionEntry?.localMatrix) return null;

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto?.linkPath) return null;
    const linkWorldMatrix = this.getUrdfLinkWorldTransformFromJointChain(proto.linkPath)
      || this.getPreferredLinkWorldTransform(proto.linkPath)
      || null;
    if (!linkWorldMatrix) return null;

    const linkPosition = new Vector3();
    const linkQuaternion = new Quaternion();
    const linkScale = new Vector3();
    linkWorldMatrix.decompose(linkPosition, linkQuaternion, linkScale);

    const linkRigidMatrix = new Matrix4().compose(linkPosition, linkQuaternion, new Vector3(1, 1, 1));
    const urdfWorldMatrix = linkRigidMatrix.multiply(collisionEntry.localMatrix);

    const resolvedCollisionPrimPath = this.getResolvedPrimPathForMeshId(meshId);
    if (!resolvedCollisionPrimPath) {
      return urdfWorldMatrix;
    }

    const resolvedCollisionWorldMatrix = this.getWorldTransformForPrimPath(resolvedCollisionPrimPath);
    if (!resolvedCollisionWorldMatrix) {
      return urdfWorldMatrix;
    }

    const urdfPosition = new Vector3();
    const urdfQuaternion = new Quaternion();
    const urdfScale = new Vector3();
    urdfWorldMatrix.decompose(urdfPosition, urdfQuaternion, urdfScale);

    const resolvedScale = new Vector3();
    resolvedCollisionWorldMatrix.decompose(new Vector3(), new Quaternion(), resolvedScale);

    const epsilon = 1e-8;
    const resolveScaleComponent = (candidateValue, fallbackValue) => {
      if (Number.isFinite(candidateValue) && Math.abs(candidateValue) > epsilon) {
        return candidateValue;
      }
      if (Number.isFinite(fallbackValue) && Math.abs(fallbackValue) > epsilon) {
        return fallbackValue;
      }
      return 1;
    };

    const mergedScale = new Vector3(
      resolveScaleComponent(resolvedScale.x, urdfScale.x),
      resolveScaleComponent(resolvedScale.y, urdfScale.y),
      resolveScaleComponent(resolvedScale.z, urdfScale.z)
    );

    return new Matrix4().compose(urdfPosition, urdfQuaternion, mergedScale);
  }

  getVisualWorldTransformFromUrdfTruth(meshId) {
    if (!this.shouldUseUrdfVisualFallbackForMesh(meshId)) return null;

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto?.linkPath) return null;

    const visualEntry = this.getUrdfVisualEntryForMeshId(meshId);
    const resolvedVisualPrimPath = this.getResolvedVisualTransformPrimPathForMeshId(meshId);
    const resolvedVisualWorldMatrix = resolvedVisualPrimPath
      ? this.getWorldTransformForPrimPath(resolvedVisualPrimPath)
      : null;

    const stageLinkWorldMatrix = this.getPreferredLinkWorldTransform(proto.linkPath);
    const linkWorldMatrix = this.getUrdfLinkWorldTransformFromJointChain(proto.linkPath)
      || stageLinkWorldMatrix
      || null;
    if (!linkWorldMatrix) return null;

    const deriveLocalVisualMatrix = (parentWorldMatrix, childWorldMatrix) => {
      if (!parentWorldMatrix || !childWorldMatrix) return null;
      const inverseParentWorldMatrix = parentWorldMatrix.clone().invert();
      return inverseParentWorldMatrix.multiply(childWorldMatrix.clone());
    };

    const resolvedVisualLocalMatrix = deriveLocalVisualMatrix(stageLinkWorldMatrix, resolvedVisualWorldMatrix);

    let localVisualMatrix = visualEntry?.localMatrix
      ? visualEntry.localMatrix.clone()
      : null;
    if (!localVisualMatrix) {
      localVisualMatrix = resolvedVisualLocalMatrix;
    }
    if (!localVisualMatrix) {
      // For primary visual proto, identity is a safe fallback when neither URDF
      // nor stage-local submesh transform is available.
      localVisualMatrix = proto.protoIndex === 0 ? new Matrix4().identity() : null;
    }
    if (!localVisualMatrix) return null;

    const linkPosition = new Vector3();
    const linkQuaternion = new Quaternion();
    const linkScale = new Vector3();
    linkWorldMatrix.decompose(linkPosition, linkQuaternion, linkScale);

    const linkRigidMatrix = new Matrix4().compose(linkPosition, linkQuaternion, new Vector3(1, 1, 1));
    const urdfWorldMatrix = linkRigidMatrix.multiply(localVisualMatrix);
    return urdfWorldMatrix;
  }

  getUrdfFallbackXformOpValueForPrimPath(primPath, opName) {
    if (!primPath || !opName || !opName.startsWith('xformOp:orient')) return undefined;
    const normalizedPrimPath = String(primPath || '');
    const isCollisionPrim = normalizedPrimPath.includes('/collisions/');
    if (!isCollisionPrim) return undefined;

    const collisionMatch = normalizedPrimPath.match(/^(.*)\/collisions\/mesh_(\d+)\/([^/]+)$/i);
    if (!collisionMatch) return undefined;
    const linkPath = collisionMatch[1];
    const protoIndex = Number(collisionMatch[2]);
    const protoTypeToken = String(collisionMatch[3] || '').toLowerCase();
    if (!Number.isFinite(protoIndex)) return undefined;
    const protoType = protoTypeToken === 'cube' ? 'box' : protoTypeToken;
    const meshId = `${linkPath}/collisions.proto_${protoType}_id${protoIndex}`;
    const fallbackEntry = this.getUrdfCollisionEntryForMeshId(meshId);
    if (!fallbackEntry?.originQuatWxyz) return undefined;
    return fallbackEntry.originQuatWxyz.slice(0, 4);
  }

  safeExportLayerText(layer) {
    if (!layer || typeof layer.ExportToString !== 'function') return '';
    try {
      const exported = layer.ExportToString();
      return typeof exported === 'string' ? exported : String(exported || '');
    } catch {
      return '';
    }
  }

  safeExportRootLayerText(stage) {
    if (!stage || typeof stage.GetRootLayer !== 'function') return '';
    try {
      const rootLayer = stage.GetRootLayer();
      return this.safeExportLayerText(rootLayer);
    } catch {
      return '';
    }
  }

  safeOpenUsdStage(stagePath) {
    if (!stagePath) return null;
    if (this._openedGuideStages.has(stagePath)) {
      return this._openedGuideStages.get(stagePath) || null;
    }

    const usdModule = typeof window !== 'undefined' ? window.USD : null;
    if (!usdModule?.UsdStage?.Open) {
      this._openedGuideStages.set(stagePath, null);
      return null;
    }

    try {
      const openedStage = usdModule.UsdStage.Open(stagePath);
      if (openedStage && typeof openedStage.then === 'function') {
        this._openedGuideStages.set(stagePath, null);
        return null;
      }
      const stage = openedStage || null;
      this._openedGuideStages.set(stagePath, stage);
      return stage;
    } catch {
      this._openedGuideStages.set(stagePath, null);
      return null;
    }
  }

  getGuideCollisionReferenceMapForCurrentStage() {
    const stageSourcePath = this.getStageSourcePath() || '__unknown_stage__';
    if (this._guideCollisionRefMapByStageSource.has(stageSourcePath)) {
      return this._guideCollisionRefMapByStageSource.get(stageSourcePath);
    }

    const mergedMap = new Map();
    const mergeMap = (nextMap) => {
      if (!(nextMap instanceof Map)) return;
      for (const [linkName, entries] of nextMap.entries()) {
        if (!linkName || !Array.isArray(entries)) continue;
        const existing = mergedMap.get(linkName) || [];
        for (const entry of entries) {
          if (!entry) continue;
          const entryName = String(entry.entryName || '').trim();
          const referencePath = entry.referencePath ? normalizeUsdPathToken(entry.referencePath) : null;
          if (!entryName) continue;
          const isDuplicate = existing.some((item) => item.entryName === entryName && item.referencePath === referencePath);
          if (isDuplicate) continue;
          existing.push({ entryName, referencePath });
        }
        mergedMap.set(linkName, existing);
      }
    };

    const stage = this.getStage();
    const rootLayerText = this.safeExportRootLayerText(stage);
    mergeMap(parseGuideCollisionReferencesFromLayerText(rootLayerText));
    mergeMap(parseColliderEntriesFromLayerText(rootLayerText));

    const referencedAssets = extractUsdAssetReferencesFromLayerText(rootLayerText);
    for (const assetPath of referencedAssets) {
      if (isPotentiallyLargeBaseAssetPath(assetPath)) continue;
      const resolvedPath = resolveUsdAssetPath(stageSourcePath, assetPath);
      if (!resolvedPath) continue;
      if (isPotentiallyLargeBaseAssetPath(resolvedPath)) continue;
      const referencedStage = this.safeOpenUsdStage(resolvedPath);
      if (!referencedStage) continue;
      const layerText = this.safeExportRootLayerText(referencedStage);
      mergeMap(parseGuideCollisionReferencesFromLayerText(layerText));
      mergeMap(parseColliderEntriesFromLayerText(layerText));
    }

    this._guideCollisionRefMapByStageSource.set(stageSourcePath, mergedMap);
    return mergedMap;
  }

  mergeVisualSemanticChildMaps(targetMap, nextMap) {
    if (!(targetMap instanceof Map) || !(nextMap instanceof Map)) return;

    for (const [linkName, childNames] of nextMap.entries()) {
      const normalizedLinkName = String(linkName || '').trim();
      if (!normalizedLinkName || !Array.isArray(childNames) || childNames.length === 0) continue;

      const existingNames = targetMap.get(normalizedLinkName) || [];
      for (const childName of childNames) {
        const normalizedChildName = String(childName || '').trim();
        if (!normalizedChildName || existingNames.includes(normalizedChildName)) continue;
        existingNames.push(normalizedChildName);
      }
      targetMap.set(normalizedLinkName, existingNames);
    }
  }

  getVisualSemanticChildMapForCurrentStage() {
    const stageSourcePath = this.getStageSourcePath();
    const cacheKey = stageSourcePath || '__unknown_stage__';
    if (this._visualSemanticChildMapByStageSource.has(cacheKey)) {
      return this._visualSemanticChildMapByStageSource.get(cacheKey);
    }

    const stage = this.getStage();
    const mergedMap = new Map();
    if (!stage) {
      this._visualSemanticChildMapByStageSource.set(cacheKey, mergedMap);
      return mergedMap;
    }

    const allowLargeBaseAssetScan = shouldAllowLargeBaseAssetScan(stageSourcePath);
    const visitedLayerPaths = new Set();
    const visitLayer = (layerPath, layerText) => {
      if (!layerText || typeof layerText !== 'string') return;

      this.mergeVisualSemanticChildMaps(mergedMap, parseVisualSemanticChildNamesFromLayerText(layerText));

      const resolveBasePath = (layerPath && layerPath.startsWith('/')) ? layerPath : stageSourcePath;
      const referencedAssets = extractUsdAssetReferencesFromLayerText(layerText);
      for (const assetPath of referencedAssets) {
        if (!allowLargeBaseAssetScan && isPotentiallyLargeBaseAssetPath(assetPath)) continue;
        const resolvedPath = resolveUsdAssetPath(resolveBasePath, assetPath);
        if (!resolvedPath || visitedLayerPaths.has(resolvedPath)) continue;
        if (!allowLargeBaseAssetScan && isPotentiallyLargeBaseAssetPath(resolvedPath)) continue;
        visitedLayerPaths.add(resolvedPath);
        const referencedStage = this.safeOpenUsdStage(resolvedPath);
        if (!referencedStage) continue;
        const referencedLayerText = this.safeExportRootLayerText(referencedStage);
        visitLayer(resolvedPath, referencedLayerText);
      }
    };

    const rootLayerText = this.safeExportRootLayerText(stage);
    if (stageSourcePath) {
      visitedLayerPaths.add(stageSourcePath);
    }
    visitLayer(stageSourcePath || '__current_stage__', rootLayerText);

    this._visualSemanticChildMapByStageSource.set(cacheKey, mergedMap);
    return mergedMap;
  }

  mergeXformOpFallbackMaps(targetMap, nextMap) {
    if (!(targetMap instanceof Map) || !(nextMap instanceof Map)) return;

    for (const [primPath, opMap] of nextMap.entries()) {
      if (!primPath || !(opMap instanceof Map)) continue;
      let mergedOpMap = targetMap.get(primPath);
      if (!(mergedOpMap instanceof Map)) {
        mergedOpMap = new Map();
        targetMap.set(primPath, mergedOpMap);
      }
      for (const [opName, opValue] of opMap.entries()) {
        if (!opName) continue;
        mergedOpMap.set(opName, Array.isArray(opValue) ? opValue.slice(0) : opValue);
      }
    }
  }

  getXformOpFallbackMapForCurrentStage() {
    const stageSourcePath = this.getStageSourcePath();
    const cacheKey = stageSourcePath || '__unknown_stage__';
    if (this._xformOpFallbackMapByStageSource.has(cacheKey)) {
      return this._xformOpFallbackMapByStageSource.get(cacheKey);
    }

    const stage = this.getStage();
    const mergedMap = new Map();
    if (!stage) {
      this._xformOpFallbackMapByStageSource.set(cacheKey, mergedMap);
      return mergedMap;
    }

    const allowLargeBaseAssetScan = shouldAllowLargeBaseAssetScan(stageSourcePath);

    const visitedLayerPaths = new Set();
    const visitLayer = (layerPath, layerText) => {
      if (!layerText || typeof layerText !== 'string') return;

      const resolveBasePath = (layerPath && layerPath.startsWith('/')) ? layerPath : stageSourcePath;
      const referencedAssets = extractUsdAssetReferencesFromLayerText(layerText);
      for (const assetPath of referencedAssets) {
        if (!allowLargeBaseAssetScan && isPotentiallyLargeBaseAssetPath(assetPath)) continue;
        const resolvedPath = resolveUsdAssetPath(resolveBasePath, assetPath);
        if (!resolvedPath || visitedLayerPaths.has(resolvedPath)) continue;
        if (!allowLargeBaseAssetScan && isPotentiallyLargeBaseAssetPath(resolvedPath)) continue;
        visitedLayerPaths.add(resolvedPath);
        const referencedStage = this.safeOpenUsdStage(resolvedPath);
        if (!referencedStage) continue;
        const referencedLayerText = this.safeExportRootLayerText(referencedStage);
        visitLayer(resolvedPath, referencedLayerText);
      }

      this.mergeXformOpFallbackMaps(mergedMap, parseXformOpFallbacksFromLayerText(layerText));
    };

    const rootLayerText = this.safeExportRootLayerText(stage);
    if (stageSourcePath) {
      visitedLayerPaths.add(stageSourcePath);
    }
    visitLayer(stageSourcePath || '__current_stage__', rootLayerText);

    this._xformOpFallbackMapByStageSource.set(cacheKey, mergedMap);
    return mergedMap;
  }

  getRootLayerXformOpFallbackMapForCurrentStage() {
    const stageSourcePath = this.getStageSourcePath();
    const cacheKey = stageSourcePath || '__unknown_stage__';
    if (this._rootLayerXformOpFallbackMapByStageSource.has(cacheKey)) {
      return this._rootLayerXformOpFallbackMapByStageSource.get(cacheKey);
    }

    const stage = this.getStage();
    if (!stage) {
      const empty = new Map();
      this._rootLayerXformOpFallbackMapByStageSource.set(cacheKey, empty);
      return empty;
    }

    const rootLayerText = this.safeExportRootLayerText(stage);
    const parsedMap = parseXformOpFallbacksFromLayerText(rootLayerText);
    const fallbackMap = parsedMap instanceof Map ? parsedMap : new Map();
    this._rootLayerXformOpFallbackMapByStageSource.set(cacheKey, fallbackMap);
    return fallbackMap;
  }

  getRootLayerFallbackXformOpValueForPrimPath(primPath, opName) {
    if (!primPath || !opName || !opName.startsWith('xformOp:')) return undefined;

    const fallbackMap = this.getRootLayerXformOpFallbackMapForCurrentStage();
    if (!(fallbackMap instanceof Map) || fallbackMap.size === 0) return undefined;

    const candidatePaths = this.getFallbackXformCandidatePaths(primPath);
    for (const candidatePath of candidatePaths) {
      const opMap = fallbackMap.get(candidatePath);
      if (!(opMap instanceof Map)) continue;

      if (opMap.has(opName)) {
        const value = opMap.get(opName);
        return Array.isArray(value) ? value.slice(0) : value;
      }

      const baseOpNameMatch = opName.match(/^(xformOp:(?:transform|translate|scale|orient|rotate(?:XYZ|XZY|YXZ|YZX|ZXY|ZYX|X|Y|Z)))/);
      const baseOpName = baseOpNameMatch ? baseOpNameMatch[1] : null;
      if (baseOpName && baseOpName !== opName && opMap.has(baseOpName)) {
        const value = opMap.get(baseOpName);
        return Array.isArray(value) ? value.slice(0) : value;
      }

      if (opName.startsWith('xformOp:orient') && opMap.has('xformOp:orient')) {
        const value = opMap.get('xformOp:orient');
        return Array.isArray(value) ? value.slice(0) : value;
      }
    }

    const suffixMatchedOpMap = this.getSuffixMatchedFallbackOpMap(fallbackMap, primPath);
    if (suffixMatchedOpMap instanceof Map) {
      if (suffixMatchedOpMap.has(opName)) {
        const value = suffixMatchedOpMap.get(opName);
        return Array.isArray(value) ? value.slice(0) : value;
      }

      const baseOpNameMatch = opName.match(/^(xformOp:(?:transform|translate|scale|orient|rotate(?:XYZ|XZY|YXZ|YZX|ZXY|ZYX|X|Y|Z)))/);
      const baseOpName = baseOpNameMatch ? baseOpNameMatch[1] : null;
      if (baseOpName && baseOpName !== opName && suffixMatchedOpMap.has(baseOpName)) {
        const value = suffixMatchedOpMap.get(baseOpName);
        return Array.isArray(value) ? value.slice(0) : value;
      }

      if (opName.startsWith('xformOp:orient') && suffixMatchedOpMap.has('xformOp:orient')) {
        const value = suffixMatchedOpMap.get('xformOp:orient');
        return Array.isArray(value) ? value.slice(0) : value;
      }
    }

    return undefined;
  }

  getCollisionGuideFallbackPrimPath(primPath) {
    if (!primPath || !primPath.includes('/collisions/')) return null;
    const marker = '/collisions/';
    const markerIndex = primPath.indexOf(marker);
    if (markerIndex <= 0) return null;

    const linkPath = primPath.slice(0, markerIndex);
    const linkName = getPathBasename(linkPath);
    const suffix = primPath.slice(markerIndex + marker.length);
    if (!linkName || !suffix) return null;

    return normalizeUsdPathToken(`/colliders/${linkName}/${suffix}`);
  }

  getVisualGuideFallbackPrimPath(primPath) {
    if (!primPath || !primPath.includes('/visuals/')) return null;
    const marker = '/visuals/';
    const markerIndex = primPath.indexOf(marker);
    if (markerIndex <= 0) return null;

    const linkPath = primPath.slice(0, markerIndex);
    const linkName = getPathBasename(linkPath);
    const suffix = primPath.slice(markerIndex + marker.length);
    if (!linkName || !suffix) return null;

    // Some Unitree layers author fallback xform ops under `/visuals/<link>/<child>`
    // instead of `/<root>/<link>/visuals/<child>`. Probe both layouts.
    return normalizeUsdPathToken(`/visuals/${linkName}/${suffix}`);
  }

  getSectionStrippedFallbackPrimPaths(primPath) {
    const normalizedPath = normalizeUsdPathToken(primPath);
    if (!normalizedPath) return [];

    const tokens = normalizedPath.split('/').filter(Boolean);
    if (tokens.length < 3) return [];

    const strippedPaths = [];
    const seen = new Set();
    const sectionNames = new Set(['visuals', 'collisions']);

    for (let index = 1; index < tokens.length - 1; index++) {
      const sectionToken = String(tokens[index] || '').toLowerCase();
      if (!sectionNames.has(sectionToken)) continue;

      const nextToken = String(tokens[index + 1] || '');
      if (!nextToken) continue;

      const parentToken = String(tokens[index - 1] || '');
      if (
        sectionToken === 'visuals'
        && parentToken
        && nextToken.toLowerCase() === parentToken.toLowerCase()
      ) {
        continue;
      }

      const strippedTokens = tokens.slice(0, index).concat(tokens.slice(index + 1));
      const strippedPath = normalizeUsdPathToken(`/${strippedTokens.join('/')}`);
      if (!strippedPath || seen.has(strippedPath)) continue;
      seen.add(strippedPath);
      strippedPaths.push(strippedPath);
    }

    return strippedPaths;
  }

  getFallbackXformCandidatePaths(primPath) {
    const candidatePaths = [];
    const addCandidatePath = (path) => {
      const normalizedPath = normalizeUsdPathToken(path);
      if (!normalizedPath || candidatePaths.includes(normalizedPath)) return;
      candidatePaths.push(normalizedPath);
    };

    addCandidatePath(primPath);
    addCandidatePath(getPathWithoutRoot(primPath));
    addCandidatePath(this.getCollisionGuideFallbackPrimPath(primPath));
    const visualGuideFallbackPath = this.getVisualGuideFallbackPrimPath(primPath);
    addCandidatePath(visualGuideFallbackPath);
    addCandidatePath(getPathWithoutRoot(visualGuideFallbackPath));
    const sectionStrippedPaths = this.getSectionStrippedFallbackPrimPaths(primPath);
    for (const strippedPath of sectionStrippedPaths) {
      addCandidatePath(strippedPath);
      addCandidatePath(getPathWithoutRoot(strippedPath));
    }
    return candidatePaths;
  }

  getSuffixMatchedFallbackOpMap(fallbackMap, primPath) {
    if (!(fallbackMap instanceof Map) || !primPath) return null;
    const normalizedPrimPath = normalizeUsdPathToken(primPath);
    if (!normalizedPrimPath) return null;
    const primSegments = normalizedPrimPath.split('/').filter(Boolean);
    if (primSegments.length === 0) return null;

    // Avoid overly loose basename-only matches that can leak parent-link transforms
    // into child visual/collision prims (e.g. `/visuals/<same_link_name>` paths).
    const minimumMatchedSuffixSegments = primSegments.length >= 2 ? 2 : 1;
    const rootPath = getRootPathFromPrimPath(normalizedPrimPath);

    let bestRootMatchedOpMap = null;
    let bestRootMatchedScore = 0;
    let bestMatchedOpMap = null;
    let bestMatchedScore = 0;

    const getMatchedTrailingSegmentCount = (leftSegments, rightSegments) => {
      const maxComparableSegments = Math.min(leftSegments.length, rightSegments.length);
      let matchedSegments = 0;
      while (matchedSegments < maxComparableSegments) {
        const leftSegment = leftSegments[leftSegments.length - 1 - matchedSegments];
        const rightSegment = rightSegments[rightSegments.length - 1 - matchedSegments];
        if (leftSegment !== rightSegment) break;
        matchedSegments++;
      }
      return matchedSegments;
    };

    for (const [fallbackPath, opMap] of fallbackMap.entries()) {
      if (!(opMap instanceof Map) || opMap.size === 0) continue;
      const normalizedFallbackPath = normalizeUsdPathToken(fallbackPath);
      if (!normalizedFallbackPath) continue;
      const fallbackSegments = normalizedFallbackPath.split('/').filter(Boolean);
      if (fallbackSegments.length === 0) continue;

      const matchedTrailingSegments = getMatchedTrailingSegmentCount(primSegments, fallbackSegments);
      if (matchedTrailingSegments < minimumMatchedSuffixSegments) continue;

      const sameRoot = !!rootPath && normalizedFallbackPath.startsWith(`${rootPath}/`);
      if (sameRoot && matchedTrailingSegments > bestRootMatchedScore) {
        bestRootMatchedScore = matchedTrailingSegments;
        bestRootMatchedOpMap = opMap;
      }
      if (matchedTrailingSegments > bestMatchedScore) {
        bestMatchedScore = matchedTrailingSegments;
        bestMatchedOpMap = opMap;
      }
    }

    return bestRootMatchedOpMap || bestMatchedOpMap || null;
  }

  getFallbackXformOpNamesForPrimPath(primPath) {
    if (!primPath) return [];
    const fallbackMap = this.getXformOpFallbackMapForCurrentStage();
    if (!(fallbackMap instanceof Map) || fallbackMap.size === 0) return [];

    const candidatePaths = this.getFallbackXformCandidatePaths(primPath);
    for (const candidatePath of candidatePaths) {
      const opMap = fallbackMap.get(candidatePath);
      if (!(opMap instanceof Map) || opMap.size === 0) continue;
      const opNames = Array.from(opMap.keys()).filter((opName) => typeof opName === 'string' && opName.startsWith('xformOp:'));
      if (opNames.length > 0) return opNames;
    }

    const suffixMatchedOpMap = this.getSuffixMatchedFallbackOpMap(fallbackMap, primPath);
    if (suffixMatchedOpMap instanceof Map) {
      const opNames = Array.from(suffixMatchedOpMap.keys()).filter((opName) => typeof opName === 'string' && opName.startsWith('xformOp:'));
      if (opNames.length > 0) return opNames;
    }

    return [];
  }

  getFallbackXformOpValueForPrimPath(primPath, opName) {
    if (!primPath || !opName || !opName.startsWith('xformOp:')) return undefined;

    const urdfFallbackValue = this.getUrdfFallbackXformOpValueForPrimPath(primPath, opName);
    if (urdfFallbackValue !== undefined && urdfFallbackValue !== null) {
      return Array.isArray(urdfFallbackValue) ? urdfFallbackValue.slice(0) : urdfFallbackValue;
    }

    const fallbackMap = this.getXformOpFallbackMapForCurrentStage();
    if (!(fallbackMap instanceof Map) || fallbackMap.size === 0) return undefined;

    const candidatePaths = this.getFallbackXformCandidatePaths(primPath);

    for (const candidatePath of candidatePaths) {
      const opMap = fallbackMap.get(candidatePath);
      if (!(opMap instanceof Map)) continue;

      if (opMap.has(opName)) {
        const value = opMap.get(opName);
        return Array.isArray(value) ? value.slice(0) : value;
      }

      const baseOpNameMatch = opName.match(/^(xformOp:(?:transform|translate|scale|orient|rotate(?:XYZ|XZY|YXZ|YZX|ZXY|ZYX|X|Y|Z)))/);
      const baseOpName = baseOpNameMatch ? baseOpNameMatch[1] : null;
      if (baseOpName && baseOpName !== opName && opMap.has(baseOpName)) {
        const value = opMap.get(baseOpName);
        return Array.isArray(value) ? value.slice(0) : value;
      }

      if (opName.startsWith('xformOp:orient') && opMap.has('xformOp:orient')) {
        const value = opMap.get('xformOp:orient');
        return Array.isArray(value) ? value.slice(0) : value;
      }
    }

    const suffixMatchedOpMap = this.getSuffixMatchedFallbackOpMap(fallbackMap, primPath);
    if (suffixMatchedOpMap instanceof Map) {
      if (suffixMatchedOpMap.has(opName)) {
        const value = suffixMatchedOpMap.get(opName);
        return Array.isArray(value) ? value.slice(0) : value;
      }

      const baseOpNameMatch = opName.match(/^(xformOp:(?:transform|translate|scale|orient|rotate(?:XYZ|XZY|YXZ|YZX|ZXY|ZYX|X|Y|Z)))/);
      const baseOpName = baseOpNameMatch ? baseOpNameMatch[1] : null;
      if (baseOpName && baseOpName !== opName && suffixMatchedOpMap.has(baseOpName)) {
        const value = suffixMatchedOpMap.get(baseOpName);
        return Array.isArray(value) ? value.slice(0) : value;
      }

      if (opName.startsWith('xformOp:orient') && suffixMatchedOpMap.has('xformOp:orient')) {
        const value = suffixMatchedOpMap.get('xformOp:orient');
        return Array.isArray(value) ? value.slice(0) : value;
      }
    }

    return undefined;
  }

  buildGuideCollisionPrimPathCandidates(meshId, guideEntry) {
    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto) return [];

    const candidates = [];
    const addCandidate = (path) => {
      if (!path || candidates.includes(path)) return;
      candidates.push(path);
    };

    const names = [];
    const addName = (value) => {
      const name = getPathBasename(value);
      if (!name || names.includes(name)) return;
      names.push(name);
    };

    addName(guideEntry?.entryName);
    addName(guideEntry?.referencePath);
    addName(proto.linkName);

    for (const name of names) {
      addCandidate(`${proto.linkPath}/collisions/${name}/mesh`);
      addCandidate(`${proto.linkPath}/collisions/${name}/collision_mesh`);
      addCandidate(`${proto.linkPath}/collisions/${name}/visual_mesh`);
      addCandidate(`${proto.linkPath}/collisions/${name}/cube`);
      addCandidate(`${proto.linkPath}/collisions/${name}/sphere`);
      addCandidate(`${proto.linkPath}/collisions/${name}/cylinder`);
      addCandidate(`${proto.linkPath}/collisions/${name}/capsule`);
    }

    addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/mesh`);
    addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/cube`);
    addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/sphere`);
    addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/cylinder`);
    addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/capsule`);

    return candidates;
  }

  resolveGuideCollisionPrimPath(meshId) {
    if (!meshId) return null;

    const stageKey = this.getStageSourcePath() || '__unknown_stage__';
    const cacheKey = `${stageKey}::${meshId}`;
    if (this._guideCollisionPrimPathCache.has(cacheKey)) {
      return this._guideCollisionPrimPathCache.get(cacheKey) || null;
    }

    const stage = this.getStage();
    const proto = parseProtoMeshIdentifier(meshId);
    if (!stage || !proto || proto.sectionName !== 'collisions' || proto.protoType !== 'mesh') {
      this._guideCollisionPrimPathCache.set(cacheKey, null);
      return null;
    }

    const guideMap = this.getGuideCollisionReferenceMapForCurrentStage();
    const guideEntries = guideMap.get(proto.linkName) || [];
    if (!guideEntries.length) {
      this._guideCollisionPrimPathCache.set(cacheKey, null);
      return null;
    }

    const orderedEntries = [];
    const preferredEntry = guideEntries[proto.protoIndex];
    if (preferredEntry) orderedEntries.push(preferredEntry);
    for (const entry of guideEntries) {
      if (!entry || orderedEntries.includes(entry)) continue;
      orderedEntries.push(entry);
    }

    const acceptableTypes = ['mesh', 'cube', 'sphere', 'cylinder', 'capsule'];
    for (const entry of orderedEntries) {
      const candidates = this.buildGuideCollisionPrimPathCandidates(meshId, entry);
      for (const candidatePath of candidates) {
        const prim = this.safeGetPrimAtPath(stage, candidatePath);
        if (!prim) continue;
        const primType = getSafePrimTypeName(prim);
        if (!primType || !acceptableTypes.includes(primType)) continue;
        this._guideCollisionPrimPathCache.set(cacheKey, candidatePath);
        return candidatePath;
      }
    }

    this._guideCollisionPrimPathCache.set(cacheKey, null);
    return null;
  }
}
