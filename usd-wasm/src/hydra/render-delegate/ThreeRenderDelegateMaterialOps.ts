// @ts-nocheck
import { Color, DoubleSide, Matrix4, MeshPhysicalMaterial, Quaternion, Vector2 } from 'three';
import * as Shared from './shared.js';
import { ThreeRenderDelegateCore } from './ThreeRenderDelegateCore.js';
import { HydraMaterial } from './HydraMaterial.js';
import { getDefaultMaterial } from './default-material-state.js';

const { buildProtoPrimPathCandidates,clamp01,createMatrixFromXformOp,debugInstancer,debugMaterials,debugMeshes,debugPrims,debugTextures,defaultGrayComponent,disableMaterials,disableTextures,extractPrimPathFromMaterialBindingWarning,extractReferencePrimTargets,extractScopeBodyText,extractUsdAssetReferencesFromLayerText,getActiveMaterialBindingWarningOwner,getAngleInRadians,getCollisionGeometryTypeFromUrdfElement,getExpectedPrimTypesForCollisionProto,getExpectedPrimTypesForProtoType,getMatrixMaxElementDelta,getPathBasename,getPathWithoutRoot,getRawConsoleMethod,getRootPathFromPrimPath,getSafePrimTypeName,hasNonZeroTranslation,hydraCallbackErrorCounts,installMaterialBindingApiWarningInterceptor,isIdentityQuaternion,isLikelyDefaultGrayMaterial,isLikelyInverseTransform,isMaterialBindingApiWarningMessage,isMatrixApproximatelyIdentity,isNonZero,isPotentiallyLargeBaseAssetPath,logHydraCallbackError,materialBindingRepairMaxLayerTextLength,materialBindingWarningHandlers,maxHydraCallbackErrorLogsPerMethod,nearlyEqual,normalizeHydraPath,normalizeUsdPathToken,parseGuideCollisionReferencesFromLayerText,parseProtoMeshIdentifier,parseUrdfTruthFromText,parseVector3Text,parseXformOpFallbacksFromLayerText,rawConsoleError,rawConsoleWarn,registerMaterialBindingApiWarningHandler,remapRootPathIfNeeded,resolveUrdfTruthFileNameForStagePath,resolveUsdAssetPath,setActiveMaterialBindingWarningOwner,shouldAllowLargeBaseAssetScan,stringifyConsoleArgs,toArrayLike,toColorArray,toFiniteNumber,toFiniteQuaternionWxyzTuple,toFiniteVector2Tuple,toFiniteVector3Tuple,toMatrixFromUrdfOrigin,toQuaternionWxyzFromRpy,transformEpsilon,wrapHydraCallbackObject } = Shared;

export class ThreeRenderDelegateMaterialOps extends ThreeRenderDelegateCore {
  handleMaterialBindingApiWarning({ message }) {
    if (getActiveMaterialBindingWarningOwner() !== this) return false;
    if (!message || !this.suppressMaterialBindingApiWarnings) return false;
    // Zero-overhead suppression path: swallow MaterialBindingAPI warnings
    // immediately so Hydra sync does not enqueue async callback work.
    if (!isMaterialBindingApiWarningMessage(message)) return false;
    return true;
  }

  flushMaterialBindingApiWarningSummary() {
    if (this._materialBindingWarningSummaryTimer) {
      clearTimeout(this._materialBindingWarningSummaryTimer);
      this._materialBindingWarningSummaryTimer = null;
    }

    const warningSummary = this._materialBindingWarningSummary;
    if (!warningSummary) return;

    warningSummary.count = 0;
    warningSummary.primPaths.clear();
    warningSummary.sampleMessages.length = 0;
  }

  tryRepairMaterialBindingApiSchemas() {
    if (this._materialBindingSchemaRepairAttempted) {
      return this._materialBindingSchemaRepairSucceeded;
    }

    this._materialBindingSchemaRepairAttempted = true;
    this._materialBindingSchemaRepairSucceeded = false;
    this._materialBindingSchemaWriteSupported = false;

    const stage = this.getStage();
    if (!stage) return false;

    const candidateLayers = [];
    const seenLayers = new Set();
    const addLayer = (layer, label) => {
      if (!layer) return;
      const identifier = normalizeHydraPath(layer.identifier || layer.GetDisplayName?.() || label || '');
      if (!identifier || seenLayers.has(identifier)) return;
      seenLayers.add(identifier);
      candidateLayers.push({ layer, identifier });
    };

    const rootLayer = stage.GetRootLayer?.();
    addLayer(rootLayer, 'rootLayer');

    try {
      const layerStack = stage.GetLayerStack?.(false);
      if (layerStack && typeof layerStack.size === 'function' && typeof layerStack.get === 'function') {
        const stackSize = Number(layerStack.size()) || 0;
        for (let layerIndex = 0; layerIndex < stackSize; layerIndex++) {
          addLayer(layerStack.get(layerIndex), `layerStack[${layerIndex}]`);
        }
      }
    } catch {}

    const rootLayerText = this.safeExportLayerText(rootLayer);
    const referencedAssets = extractUsdAssetReferencesFromLayerText(rootLayerText, { baseOnly: true });
    const stageSourcePath = this.getStageSourcePath();
    for (const assetPath of referencedAssets) {
      if (isPotentiallyLargeBaseAssetPath(assetPath)) continue;
      const resolvedAssetPath = resolveUsdAssetPath(stageSourcePath, assetPath);
      if (!resolvedAssetPath) continue;
      if (isPotentiallyLargeBaseAssetPath(resolvedAssetPath)) continue;
      const referencedStage = this.safeOpenUsdStage(resolvedAssetPath);
      if (!referencedStage) continue;
      addLayer(referencedStage.GetRootLayer?.(), resolvedAssetPath);
    }

    let detectedRepairCandidates = 0;
    for (const { layer } of candidateLayers) {
      const beforeText = this.safeExportLayerText(layer);
      if (!beforeText || beforeText.length > materialBindingRepairMaxLayerTextLength || !beforeText.includes('material:binding')) continue;
      const repairedText = this.repairMaterialBindingApiSchemasInLayerText(beforeText);
      if (!repairedText.changed) continue;
      detectedRepairCandidates += repairedText.count;

      if (typeof layer.ImportFromString !== 'function') continue;
      try {
        layer.ImportFromString(repairedText.text);
      } catch {}

      const afterText = this.safeExportLayerText(layer);
      const writeSucceeded = !!afterText && afterText !== beforeText && afterText.includes('MaterialBindingAPI');
      if (writeSucceeded) {
        this._materialBindingSchemaWriteSupported = true;
        this._materialBindingSchemaRepairSucceeded = true;
      }
    }

    if (!this._materialBindingSchemaWriteSupported && detectedRepairCandidates > 0) {
      this.suppressMaterialBindingApiWarnings = true;
      getRawConsoleMethod('warn')('[HydraDelegate] MaterialBindingAPI schema repair is unavailable in current WASM bindings; using aggregated warning fallback.');
    }

    return this._materialBindingSchemaRepairSucceeded;
  }

  repairMaterialBindingApiSchemasInLayerText(layerText) {
    if (!layerText || !layerText.includes('material:binding')) {
      return { text: layerText, changed: false, count: 0 };
    }

    const lines = layerText.split(/\r?\n/);
    const injectionMap = new Map();

    const stack = [];
    let pendingContext = null;

    const registerApiSchemasLine = (context, lineIndex, lineText) => {
      if (!context || context.apiSchemasLineIndex !== null) return;
      if (!/apiSchemas\s*=/.test(lineText)) return;
      context.apiSchemasLineIndex = lineIndex;
      context.hasMaterialBindingApi = /MaterialBindingAPI/.test(lineText);
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const trimmed = line.trim();

      if (pendingContext) {
        if (trimmed.includes('material:binding')) pendingContext.hasMaterialBinding = true;
        registerApiSchemasLine(pendingContext, lineIndex, line);
      }
      if (stack.length > 0) {
        const current = stack[stack.length - 1];
        if (trimmed.includes('material:binding')) current.hasMaterialBinding = true;
        registerApiSchemasLine(current, lineIndex, line);
      }

      const defMatch = trimmed.match(/^(?:def|over|class)\s+\w+\s+"[^"]+"/);
      if (defMatch) {
        pendingContext = {
          hasMaterialBinding: false,
          hasMaterialBindingApi: false,
          apiSchemasLineIndex: null,
          metadataStartLineIndex: null,
          metadataEndLineIndex: null,
          openBraceLineIndex: null,
        };
      }

      for (const character of line) {
        if (character === '(') {
          if (pendingContext && pendingContext.metadataStartLineIndex === null && pendingContext.openBraceLineIndex === null) {
            pendingContext.metadataStartLineIndex = lineIndex;
          }
        } else if (character === ')') {
          if (pendingContext && pendingContext.metadataStartLineIndex !== null && pendingContext.metadataEndLineIndex === null) {
            pendingContext.metadataEndLineIndex = lineIndex;
          }
          if (stack.length > 0) {
            const top = stack[stack.length - 1];
            if (top.metadataStartLineIndex !== null && top.metadataEndLineIndex === null) {
              top.metadataEndLineIndex = lineIndex;
            }
          }
        } else if (character === '{') {
          if (pendingContext) {
            pendingContext.openBraceLineIndex = lineIndex;
            stack.push(pendingContext);
            pendingContext = null;
          } else {
            stack.push({
              hasMaterialBinding: false,
              hasMaterialBindingApi: false,
              apiSchemasLineIndex: null,
              metadataStartLineIndex: null,
              metadataEndLineIndex: null,
              openBraceLineIndex: lineIndex,
              anonymous: true,
            });
          }
        } else if (character === '}') {
          const poppedContext = stack.pop();
          if (!poppedContext || poppedContext.anonymous) continue;
          if (!poppedContext.hasMaterialBinding || poppedContext.hasMaterialBindingApi) continue;

          if (poppedContext.apiSchemasLineIndex !== null) {
            injectionMap.set(poppedContext.apiSchemasLineIndex, { type: 'appendApiSchema' });
            continue;
          }

          const targetLine = poppedContext.metadataEndLineIndex !== null
            ? poppedContext.metadataEndLineIndex
            : poppedContext.openBraceLineIndex;
          if (targetLine !== null) {
            injectionMap.set(targetLine, { type: 'injectApiSchemaLine' });
          }
        }
      }
    }

    if (injectionMap.size === 0) {
      return { text: layerText, changed: false, count: 0 };
    }

    const outputLines = [];
    let changedCount = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      let line = lines[lineIndex];
      const instruction = injectionMap.get(lineIndex);
      if (instruction?.type === 'appendApiSchema') {
        if (/\[\s*\]/.test(line)) {
          line = line.replace(/\[\s*\]/, '["MaterialBindingAPI"]');
        } else if (/\]/.test(line)) {
          line = line.replace(/\]/, ', "MaterialBindingAPI"]');
        } else if (/apiSchemas\s*=/.test(line)) {
          line = `${line.trimEnd()} = ["MaterialBindingAPI"]`;
        }
        changedCount += 1;
      } else if (instruction?.type === 'injectApiSchemaLine') {
        const indentation = (line.match(/^(\s*)/) || [''])[0];
        outputLines.push(`${indentation}prepend apiSchemas = ["MaterialBindingAPI"]`);
        changedCount += 1;
      }
      outputLines.push(line);
    }

    return {
      text: outputLines.join('\n'),
      changed: changedCount > 0,
      count: changedCount,
    };
  }

  getCollisionOverridePrimPath(meshId) {
    if (!meshId) return null;

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto) return null;
    const expectedTypes = getExpectedPrimTypesForCollisionProto(proto);
    if (expectedTypes.length === 0) return null;

    const driverOverride = this.getCollisionProtoOverride?.(meshId);
    const overrideType = String(driverOverride?.primType || '').toLowerCase();
    const overridePath = normalizeHydraPath(driverOverride?.resolvedPrimPath);
    if (overridePath && overrideType && expectedTypes.includes(overrideType)) {
      return overridePath;
    }

    const resolved = this.getResolvedPrimPathForMeshId(meshId);
    if (!resolved) return null;

    const primOverrideData = this.getPrimOverrideData?.(resolved);
    const overridePrimType = String(primOverrideData?.primType || '').toLowerCase();
    if (overridePrimType && expectedTypes.includes(overridePrimType)) {
      return resolved;
    }

    const prim = this.safeGetPrimAtPath(this.getStage(), resolved);
    const primType = getSafePrimTypeName(prim);
    if (!expectedTypes.includes(primType)) return null;

    return resolved;
  }

  getResolvedPrimPathForMeshId(meshId) {
    if (!meshId || !meshId.includes('.proto_')) return null;

    if (this._resolvedProtoPrimPathCache.has(meshId)) {
      return this._resolvedProtoPrimPathCache.get(meshId) || null;
    }

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto || proto.sectionName !== 'collisions') {
      return null;
    }

    const driverOverride = this.getCollisionProtoOverride?.(meshId);
    const overridePrimPath = normalizeHydraPath(driverOverride?.resolvedPrimPath);
    if (overridePrimPath) {
      this._resolvedProtoPrimPathCache.set(meshId, overridePrimPath);
      return overridePrimPath;
    }

    let stageResolved = null;
    try {
      stageResolved = this.resolveProtoPrimPathFromStage(meshId);
    } catch {
      stageResolved = null;
    }
    if (stageResolved) {
      this._resolvedProtoPrimPathCache.set(meshId, stageResolved);
    }
    return stageResolved;
  }

  getResolvedVisualTransformPrimPathForMeshId(meshId) {
    if (!meshId || !meshId.includes('.proto_')) return null;

    if (this._resolvedVisualPrimPathCache.has(meshId)) {
      return this._resolvedVisualPrimPathCache.get(meshId) || null;
    }

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto || proto.sectionName !== 'visuals' || proto.protoType !== 'mesh') return null;

    const driverOverride = this.getVisualProtoOverride?.(meshId);
    const overridePrimPath = normalizeHydraPath(driverOverride?.resolvedPrimPath);
    if (overridePrimPath) {
      this._resolvedVisualPrimPathCache.set(meshId, overridePrimPath);
      return overridePrimPath;
    }

    const stage = this.getStage();
    if (!stage) return null;

    const containerPrim = this.safeGetPrimAtPath(stage, proto.containerPath);
    if (!containerPrim) return null;

    const transformChildren = [];
    try {
      let rawChildren = null;
      let useContainerPathAsPrefix = false;
      if (containerPrim.IsInstance?.()) {
        const prototypePrim = containerPrim.GetPrototype?.();
        rawChildren = prototypePrim?.GetChildren?.() || null;
        useContainerPathAsPrefix = true;
      }
      if (!rawChildren) {
        rawChildren = containerPrim.GetChildren?.();
      }
      const children = Array.isArray(rawChildren)
        ? rawChildren
        : (rawChildren && typeof rawChildren[Symbol.iterator] === 'function'
          ? Array.from(rawChildren)
          : []);
      for (const childPrim of children) {
        if (!childPrim) continue;
        const childType = getSafePrimTypeName(childPrim);
        const isRecognizedType = childType === 'xform'
          || childType === 'mesh'
          || childType === 'cube'
          || childType === 'sphere'
          || childType === 'cylinder'
          || childType === 'capsule';
        // Some Unitree USD crates report empty type names for valid child prims in
        // WASM bindings. Keep unknown/empty types instead of dropping them so proto
        // index mapping can still resolve sub-mesh transform prims.
        if (childType && !isRecognizedType) {
          continue;
        }
        const childName = normalizeHydraPath(childPrim.GetName?.());
        let childPath = '';
        if (useContainerPathAsPrefix) {
          if (childName) {
            childPath = `${proto.containerPath}/${childName}`;
          }
        }
        if (!childPath) {
          childPath = normalizeHydraPath(childPrim.GetPath?.());
        }
        if (!childPath) continue;
        transformChildren.push({
          path: childPath,
          name: childName || getPathBasename(childPath),
        });
      }
    } catch {}

    const extractMeshIndexFromName = (name) => {
      const normalizedName = String(name || '').toLowerCase();
      const match = normalizedName.match(/(?:^|_)mesh_(\d+)(?:$|_)/i);
      if (!match) return null;
      const parsedIndex = Number(match[1]);
      return Number.isFinite(parsedIndex) ? parsedIndex : null;
    };

    const normalizeLinkToken = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return '';
      return normalized.endsWith('_link') ? normalized.slice(0, -'_link'.length) : normalized;
    };
    const normalizedLinkName = String(proto.linkName || '').toLowerCase();
    const normalizedLinkStem = normalizeLinkToken(normalizedLinkName);
    const normalizedLinkToken = normalizeLinkToken(normalizedLinkName);
    const isLikelyLinkNameMatch = (childName) => {
      const normalizedChildName = String(childName || '').toLowerCase();
      if (!normalizedChildName) return false;
      if (normalizedChildName === normalizedLinkName || normalizedChildName === normalizedLinkStem) return true;
      if (normalizedLinkName && normalizedChildName.includes(normalizedLinkName)) return true;
      if (!normalizedLinkStem) return false;
      return normalizedChildName.includes(`${normalizedLinkStem}_`) || normalizedChildName.startsWith(`${normalizedLinkStem}-`);
    };
    const isGenericMeshPath = (path) => /\/mesh_\d+(?:\/mesh)?$/i.test(String(path || ''));

    const buildFallbackSemanticChildrenFromMap = (candidateMap) => {
      if (!(candidateMap instanceof Map) || candidateMap.size === 0) return [];

      const semanticChildren = [];
      const semanticChildNameSet = new Set();
      const extractLinkAndChildFromFallbackPath = (fallbackPath) => {
        const normalizedFallbackPath = normalizeUsdPathToken(fallbackPath);
        if (!normalizedFallbackPath) return null;
        const segments = normalizedFallbackPath.split('/').filter(Boolean);
        if (segments.length < 3) return null;

        const leadingVisuals = String(segments[0] || '').toLowerCase() === 'visuals';
        if (leadingVisuals) {
          return {
            linkName: String(segments[1] || '').trim(),
            childName: String(segments[2] || '').trim(),
          };
        }

        const visualsIndex = segments.findIndex((segment) => String(segment || '').toLowerCase() === 'visuals');
        if (visualsIndex <= 0 || visualsIndex + 1 >= segments.length) return null;
        return {
          linkName: String(segments[visualsIndex - 1] || '').trim(),
          childName: String(segments[visualsIndex + 1] || '').trim(),
        };
      };

      for (const [fallbackPath] of candidateMap.entries()) {
        const parsed = extractLinkAndChildFromFallbackPath(fallbackPath);
        if (!parsed) continue;

        const fallbackLinkName = parsed.linkName;
        if (!fallbackLinkName) continue;
        if (normalizeLinkToken(fallbackLinkName) !== normalizedLinkToken) continue;

        const childName = parsed.childName;
        if (!childName) continue;
        const childNameKey = childName.toLowerCase();
        if (semanticChildNameSet.has(childNameKey)) continue;

        const stagePathCandidates = [
          `${proto.linkPath}/visuals/${childName}/mesh`,
          `${proto.linkPath}/visuals/${childName}`,
        ];
        let stageResolvedPath = null;
        for (const candidatePath of stagePathCandidates) {
          if (!candidatePath) continue;
          if (!this.safeGetPrimAtPath(stage, candidatePath)) continue;
          stageResolvedPath = candidatePath;
          break;
        }
        if (!stageResolvedPath) continue;

        semanticChildNameSet.add(childNameKey);
        semanticChildren.push({
          name: childName,
          path: stageResolvedPath,
        });
      }

      return semanticChildren;
    };

    let fallbackSemanticChildrenCache = null;
    const getFallbackSemanticChildren = () => {
      if (fallbackSemanticChildrenCache) {
        return fallbackSemanticChildrenCache;
      }

      const rootLayerMap = this.enableXformOpFallbackFromLayerText === true
        ? this.getXformOpFallbackMapForCurrentStage()
        : (typeof this.getRootLayerXformOpFallbackMapForCurrentStage === 'function'
          ? this.getRootLayerXformOpFallbackMapForCurrentStage()
          : null);
      let semanticChildren = buildFallbackSemanticChildrenFromMap(rootLayerMap);

      // Root layer can be sparse (e.g. only `/`) while semantic child xformOps are
      // authored in referenced layers. Prefer a lightweight visuals-scope parser
      // before escalating to the full xform fallback scan.
      if (
        semanticChildren.length === 0
        && this.enableXformOpFallbackFromLayerText !== true
      ) {
        const visualSemanticChildMap = typeof this.getVisualSemanticChildMapForCurrentStage === 'function'
          ? this.getVisualSemanticChildMapForCurrentStage()
          : null;
        if (visualSemanticChildMap instanceof Map && visualSemanticChildMap.size > 0) {
          const visualChildren = [];
          for (const [fallbackLinkName, childNames] of visualSemanticChildMap.entries()) {
            if (normalizeLinkToken(fallbackLinkName) !== normalizedLinkToken) continue;
            if (!Array.isArray(childNames) || childNames.length === 0) continue;
            for (const childName of childNames) {
              const normalizedChildName = String(childName || '').trim();
              if (!normalizedChildName) continue;
              const stagePathCandidates = [
                `${proto.linkPath}/visuals/${normalizedChildName}/mesh`,
                `${proto.linkPath}/visuals/${normalizedChildName}`,
              ];
              let stageResolvedPath = null;
              for (const candidatePath of stagePathCandidates) {
                if (!candidatePath) continue;
                if (!this.safeGetPrimAtPath(stage, candidatePath)) continue;
                stageResolvedPath = candidatePath;
                break;
              }
              if (!stageResolvedPath) continue;
              if (visualChildren.some((child) => String(child.name || '').toLowerCase() === normalizedChildName.toLowerCase())) {
                continue;
              }
              visualChildren.push({
                name: normalizedChildName,
                path: stageResolvedPath,
              });
            }
          }
          semanticChildren = visualChildren;
        }

        if (semanticChildren.length === 0) {
          const fullLayerMap = this.getXformOpFallbackMapForCurrentStage();
          if (fullLayerMap !== rootLayerMap) {
            semanticChildren = buildFallbackSemanticChildrenFromMap(fullLayerMap);
          }
        }
      }

      fallbackSemanticChildrenCache = semanticChildren;
      return semanticChildren;
    };

    let resolvedPath = null;
    const nameMatchedChild = transformChildren.find((child) => {
      const normalizedName = String(child.name || '').toLowerCase();
      if (normalizedName === `mesh_${proto.protoIndex}`) return true;
      const meshIndex = extractMeshIndexFromName(child.name);
      return meshIndex === proto.protoIndex;
    });
    if (nameMatchedChild?.path) {
      resolvedPath = nameMatchedChild.path;
    }

    // When child prim names are semantic (e.g. torso/head/logo, wrist/rubber_hand),
    // proto index 0 should map to the child that best matches the owning link name.
    if (!resolvedPath && proto.protoIndex === 0) {
      const linkMatchedChild = transformChildren.find((child) => isLikelyLinkNameMatch(child.name));
      if (linkMatchedChild?.path) {
        resolvedPath = linkMatchedChild.path;
      }
    }

    // Keep authored child order from USD instead of lexicographic sorting.
    // Sorting can swap semantic children and cause cross-link drift.
    if (!resolvedPath && proto.protoIndex >= 0 && proto.protoIndex < transformChildren.length) {
      resolvedPath = transformChildren[proto.protoIndex]?.path || null;
    }

    // If stage children are generic (`mesh_0`, `mesh_1`, ...), prefer semantic
    // visual child paths parsed from authored xformOps (`/visuals/<link>/<child>`).
    // This preserves per-submesh transforms for models that mix link-local and
    // world-space visual children (e.g. torso + head/logo style layouts).
    if (!resolvedPath || isGenericMeshPath(resolvedPath)) {
      const fallbackSemanticChildren = getFallbackSemanticChildren();
      if (fallbackSemanticChildren.length > 0) {
        if (proto.protoIndex === 0) {
          const semanticLinkMatchedChild = fallbackSemanticChildren.find((child) => isLikelyLinkNameMatch(child.name));
          if (semanticLinkMatchedChild?.path) {
            resolvedPath = semanticLinkMatchedChild.path;
          }
        }
        if ((!resolvedPath || isGenericMeshPath(resolvedPath)) && proto.protoIndex >= 0 && proto.protoIndex < fallbackSemanticChildren.length) {
          resolvedPath = fallbackSemanticChildren[proto.protoIndex]?.path || resolvedPath;
        }
      }
    }

    if (!resolvedPath) {
      const fallbackCandidates = [
        ...buildProtoPrimPathCandidates(meshId),
        `${proto.containerPath}/mesh_${proto.protoIndex}`,
      ];

      for (const candidatePath of fallbackCandidates) {
        if (!candidatePath) continue;
        if (!this.safeGetPrimAtPath(stage, candidatePath)) continue;
        resolvedPath = candidatePath;
        break;
      }
    }

    if (!resolvedPath && proto.protoIndex === 0 && transformChildren.length === 1) {
      resolvedPath = transformChildren[0].path;
    }

    if (!resolvedPath && proto.protoIndex === 0) {
      resolvedPath = proto.containerPath;
    }

    this._resolvedVisualPrimPathCache.set(meshId, resolvedPath || null);
    return resolvedPath || null;
  }

  shouldPreferResolvedVisualTransformForMeshId(meshId) {
    if (!meshId || !meshId.includes('.proto_')) return false;

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto || proto.sectionName !== 'visuals' || proto.protoType !== 'mesh' || !proto.linkPath) {
      return false;
    }

    const resolvedPath = this.getResolvedVisualTransformPrimPathForMeshId(meshId);
    if (!resolvedPath) return false;

    // Generic mesh_N paths typically still require link fallback composition.
    if (/\/mesh_\d+(?:\/mesh)?$/i.test(resolvedPath)) return false;

    // Prefer semantic visual children authored under `<link>/visuals/<child>`.
    const semanticPrefix = `${proto.linkPath}/visuals/`;
    if (!resolvedPath.startsWith(semanticPrefix)) return false;

    return true;
  }

  resolveProtoPrimPathFromStage(meshId) {
    const stage = this.getStage();
    if (!stage) return null;

    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto) return null;

    const expectedTypes = getExpectedPrimTypesForCollisionProto(proto);
    if (expectedTypes.length === 0) return null;

    if (proto.sectionName === 'collisions' && proto.protoType === 'mesh') {
      const guideResolvedPath = this.resolveGuideCollisionPrimPath(meshId);
      if (guideResolvedPath) return guideResolvedPath;
    }

    const candidates = buildProtoPrimPathCandidates(meshId);
    for (const candidatePath of candidates) {
      const prim = this.safeGetPrimAtPath(stage, candidatePath);
      if (!prim) continue;
      const primType = getSafePrimTypeName(prim);
      if (!primType || !expectedTypes.includes(primType)) continue;
      return candidatePath;
    }

    return null;
  }

  getStageGeometryCandidatePrimPathsForMeshId(meshId) {
    const normalizedMeshId = normalizeHydraPath(meshId);
    if (!normalizedMeshId) return [];

    const candidatePaths = [];
    const seenPaths = new Set();
    const addCandidate = (candidatePath) => {
      const normalizedPath = normalizeHydraPath(candidatePath);
      if (!normalizedPath || seenPaths.has(normalizedPath)) return;
      seenPaths.add(normalizedPath);
      candidatePaths.push(normalizedPath);
    };

    if (normalizedMeshId.includes('.proto_')) {
      const proto = parseProtoMeshIdentifier(normalizedMeshId);
      if (proto?.sectionName === 'collisions') {
        addCandidate(this.getResolvedPrimPathForMeshId(normalizedMeshId));
      } else if (proto?.sectionName === 'visuals') {
        addCandidate(this.getResolvedVisualTransformPrimPathForMeshId(normalizedMeshId));
      }

      for (const candidatePath of buildProtoPrimPathCandidates(normalizedMeshId)) {
        addCandidate(candidatePath);
      }

      if (proto?.containerPath && Number.isFinite(proto.protoIndex)) {
        addCandidate(`${proto.containerPath}/mesh_${proto.protoIndex}`);
      }
    } else {
      addCandidate(normalizedMeshId);
    }

    return candidatePaths;
  }

  hydrateMissingMeshGeometryFromStage() {
    const stage = this.getStage();
    if (!stage) {
      return { attempted: 0, hydrated: 0, skippedReady: 0, durationMs: 0 };
    }

    const startedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    let attempted = 0;
    let hydrated = 0;
    let skippedReady = 0;

    for (const mesh of Object.values(this.meshes)) {
      if (!mesh || typeof mesh._id !== 'string') continue;
      if (typeof mesh.applyResolvedPrimGeometry !== 'function') continue;

      const positionAttribute = mesh?._mesh?.geometry?.getAttribute?.('position');
      if (positionAttribute && Number(positionAttribute.count) > 0) {
        skippedReady += 1;
        continue;
      }

      const candidatePaths = this.getStageGeometryCandidatePrimPathsForMeshId(mesh._id);
      if (candidatePaths.length === 0) continue;
      attempted += 1;

      for (const candidatePath of candidatePaths) {
        let geometryApplied = false;
        try {
          geometryApplied = mesh.applyResolvedPrimGeometry(candidatePath) === true;
        } catch {
          geometryApplied = false;
        }
        if (!geometryApplied) continue;

        if (typeof mesh.syncProtoTransformFromFallback === 'function') {
          mesh.syncProtoTransformFromFallback();
        }
        if (typeof mesh.syncCollisionRotationFromVisualLink === 'function') {
          mesh.syncCollisionRotationFromVisualLink();
        }
        hydrated += 1;
        break;
      }
    }

    const finishedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    return {
      attempted,
      hydrated,
      skippedReady,
      durationMs: Math.max(0, finishedAt - startedAt),
    };
  }

  invalidateStageCaches(options = {}) {
    const preserveResolvedPrimCaches = options?.preserveResolvedPrimCaches === true;
    const preserveDriverCaches = options?.preserveDriverCaches === true;
    this._localXformCache.clear();
    this._worldXformCache.clear();
    this._primPathExistenceCache.clear();
    this._knownPrimPathSet = null;
    this._knownPrimPathSetPrimed = false;
    this._meshFallbackCache.clear();
    if (!preserveResolvedPrimCaches) {
      this._resolvedProtoPrimPathCache.clear();
      this._resolvedVisualPrimPathCache.clear();
    }
    this._xformOpFallbackMapByStageSource.clear();
    this._rootLayerXformOpFallbackMapByStageSource.clear();
    this._linkVisualTransformCache.clear();
    this._guideCollisionPrimPathCache.clear();
    this._guideCollisionRefMapByStageSource.clear();
    this._visualSemanticChildMapByStageSource.clear();
    this._openedGuideStages.clear();
    if (!preserveDriverCaches) {
      this._collisionProtoOverrideCache.clear();
      this._collisionProtoOverrideBatchPrimed = false;
      this._visualProtoOverrideCache.clear();
      this._visualProtoOverrideBatchPrimed = false;
      this._finalStageOverrideBatchCache.clear();
      this._finalStageOverrideBatchPrimed = false;
      this._primOverrideDataCache.clear();
    }
    this._urdfLinkWorldTransformCacheByStageSource.clear();
    this._urdfVisualFallbackDecisionCache.clear();
    this._urdfVisualFallbackLinkDecisionCache.clear();
    this._preferredVisualMaterialByLinkCache.clear();
    this._resolvedDriverStage = null;
    this._pendingDriverStagePromise = null;
    this._hasRunStageTruthAlignmentDiagnostics = false;
    if (!preserveResolvedPrimCaches && !preserveDriverCaches) {
      this._runtimeBridgeCacheStageKey = null;
    }
    this.flushMaterialBindingApiWarningSummary();
  }

  refreshMeshStageOverrides(options = {}) {
    const stage = this.getStage();
    const includeCollision = options?.includeCollision !== false;
    const includeVisual = options?.includeVisual !== false;
    const startIndexRaw = Number(options?.startIndex);
    const startIndex = Number.isFinite(startIndexRaw) ? Math.max(0, Math.floor(startIndexRaw)) : 0;
    const chunkSizeRaw = Number(options?.chunkSize);
    const chunkSize = Number.isFinite(chunkSizeRaw) && chunkSizeRaw > 0
      ? Math.max(1, Math.floor(chunkSizeRaw))
      : Number.POSITIVE_INFINITY;

    if (startIndex === 0) {
      const stageSourcePath = String(this.getStageSourcePath() || '').split('?')[0];
      const canPreserveRuntimeBridgeCaches = (
        !!stageSourcePath
        && stageSourcePath === String(this._runtimeBridgeCacheStageKey || '')
      );
      this.invalidateStageCaches({
        preserveResolvedPrimCaches: canPreserveRuntimeBridgeCaches,
        preserveDriverCaches: canPreserveRuntimeBridgeCaches,
      });
      if (!this.suppressMaterialBindingApiWarnings && stage) {
        this.tryRepairMaterialBindingApiSchemas();
      }
    }

    const protoMeshes = Object.values(this.meshes).filter((mesh) => !!mesh && typeof mesh._id === 'string' && mesh._id.includes('.proto_'));
    const resolvedDriver = typeof this.config?.driver === 'function'
      ? this.config.driver()
      : null;
    let finalStageBatchEntries = null;
    let finalStageBatchEnabled = false;
    if (resolvedDriver && typeof this.prefetchFinalStageOverrideBatchFromDriver === 'function') {
      try {
        const batchSummary = this.prefetchFinalStageOverrideBatchFromDriver(resolvedDriver, {
          force: startIndex === 0,
        }) || {};
        const batchSource = String(batchSummary?.source || '');
        const batchEntries = batchSummary?.entries;
        if (
          batchEntries instanceof Map
          && batchEntries.size > 0
          && batchSource !== 'single-only'
          && batchSource !== 'error'
        ) {
          finalStageBatchEntries = batchEntries;
          finalStageBatchEnabled = true;
        }
      } catch {}
    }

    if (!stage && !finalStageBatchEnabled) return;

    let nextIndex = startIndex;
    let processed = 0;
    for (let meshIndex = startIndex; meshIndex < protoMeshes.length; meshIndex++) {
      if (processed >= chunkSize) break;
      const mesh = protoMeshes[meshIndex];
      if (!mesh || typeof mesh._id !== 'string' || !mesh._id.includes('.proto_')) continue;
      try {
        const isCollisionProto = typeof mesh.isCollisionProtoMesh === 'function' ? mesh.isCollisionProtoMesh() : false;
        if (isCollisionProto && !includeCollision) continue;
        if (!isCollisionProto && !includeVisual) continue;

        if (finalStageBatchEnabled && finalStageBatchEntries) {
          const finalOverride = finalStageBatchEntries.get(mesh._id) || null;
          if (finalOverride?.valid === true) {
            if (typeof mesh.applyFinalStageOverrideFromDriver === 'function') {
              mesh.applyFinalStageOverrideFromDriver(finalOverride, {
                skipTransformFallback: true,
                skipCollisionRotationFallback: true,
              });
            } else if (
              isCollisionProto
              && typeof mesh.applyCollisionGeometryFromDriverOverride === 'function'
            ) {
              mesh.applyCollisionGeometryFromDriverOverride(finalOverride);
            }
          }
        } else {
          const collisionOverride = isCollisionProto
            ? this.getCollisionProtoOverride?.(mesh._id)
            : null;
          const primPath = isCollisionProto
            ? normalizeHydraPath(collisionOverride?.resolvedPrimPath || this.getResolvedPrimPathForMeshId(mesh._id))
            : null;
          const shouldSkipCollisionReapply = (
            isCollisionProto
            && primPath
            && typeof mesh.hasAppliedCollisionOverrideForPrimPath === 'function'
            && mesh.hasAppliedCollisionOverrideForPrimPath(primPath) === true
          );
          if (
            isCollisionProto
            && collisionOverride?.valid === true
            && !shouldSkipCollisionReapply
            && typeof mesh.applyCollisionGeometryFromDriverOverride === 'function'
          ) {
            mesh.applyCollisionGeometryFromDriverOverride(collisionOverride);
          } else if (
            isCollisionProto
            && primPath
            && !shouldSkipCollisionReapply
            && typeof mesh.applyResolvedPrimGeometryAndTransform === 'function'
          ) {
            mesh.applyResolvedPrimGeometryAndTransform(primPath);
          }
          if (typeof mesh.syncProtoTransformFromFallback === 'function') {
            mesh.syncProtoTransformFromFallback();
          }
          if (isCollisionProto && typeof mesh.syncCollisionRotationFromVisualLink === 'function') {
            mesh.syncCollisionRotationFromVisualLink();
          }
        }
      } catch {}
      processed += 1;
      nextIndex = meshIndex + 1;
    }

    const done = nextIndex >= protoMeshes.length;
    if (done && options?.skipDiagnostics !== true) {
      this.runStageTruthAlignmentDiagnostics();
    }
    return {
      done,
      nextIndex,
      processed,
      total: protoMeshes.length,
    };
  }

  getVisualColorOverride(meshId) {
    if (!meshId || !this.modelOverrides) return null;
    const value = this.modelOverrides.visualColorByMeshId?.[meshId];
    if (!Array.isArray(value) || value.length < 3) return null;
    const r = toFiniteNumber(value[0]);
    const g = toFiniteNumber(value[1]);
    const b = toFiniteNumber(value[2]);
    if (r === undefined || g === undefined || b === undefined) return null;
    return [clamp01(r), clamp01(g), clamp01(b)];
  }

  getCollisionLocalXformOverride(meshId) {
    if (!meshId || !this.modelOverrides) return null;
    const value = this.modelOverrides.collisionLocalXformByMeshId?.[meshId];
    if (!value || typeof value !== 'object') return null;

    const translateSource = toArrayLike(value.translate);
    const orientSource = toArrayLike(value.orient);
    const scaleSource = toArrayLike(value.scale);
    if (!translateSource || translateSource.length < 3 || !orientSource || orientSource.length < 4 || !scaleSource || scaleSource.length < 3) {
      return null;
    }

    const tx = toFiniteNumber(translateSource[0]);
    const ty = toFiniteNumber(translateSource[1]);
    const tz = toFiniteNumber(translateSource[2]);
    const qw = toFiniteNumber(orientSource[0]);
    const qx = toFiniteNumber(orientSource[1]);
    const qy = toFiniteNumber(orientSource[2]);
    const qz = toFiniteNumber(orientSource[3]);
    const sx = toFiniteNumber(scaleSource[0]);
    const sy = toFiniteNumber(scaleSource[1]);
    const sz = toFiniteNumber(scaleSource[2]);
    if (
      tx === undefined || ty === undefined || tz === undefined ||
      qw === undefined || qx === undefined || qy === undefined || qz === undefined ||
      sx === undefined || sy === undefined || sz === undefined
    ) {
      return null;
    }

    const orientation = new Quaternion(qx, qy, qz, qw);
    if (orientation.lengthSq() <= 1e-12 || !Number.isFinite(orientation.lengthSq())) {
      return null;
    }
    orientation.normalize();

    const linkPath = typeof value.linkPath === 'string' && value.linkPath.startsWith('/') ? value.linkPath : null;
    return {
      linkPath,
      translation: new Vector3(tx, ty, tz),
      orientation,
      scale: new Vector3(sx, sy, sz),
    };
  }

  getUrdfVisualFallbackDecisionForLink(linkPath) {
    if (!linkPath || !linkPath.startsWith('/')) return false;
    if (this._urdfVisualFallbackLinkDecisionCache.has(linkPath)) {
      return this._urdfVisualFallbackLinkDecisionCache.get(linkPath) === true;
    }

    const currentLinkFrameMatrix = this.getVisualLinkFrameTransform(linkPath) || null;
    const urdfLinkWorldMatrix = this.getUrdfLinkWorldTransformFromJointChain(linkPath) || null;
    const stageLinkWorldMatrix = this.getWorldTransformForPrimPath(linkPath) || null;

    const looksDegenerate = (matrix) => !matrix || (isMatrixApproximatelyIdentity(matrix) && !hasNonZeroTranslation(matrix));
    const looksAuthored = (matrix) => !!matrix && (!isMatrixApproximatelyIdentity(matrix) || hasNonZeroTranslation(matrix));

    let shouldUseFallback = false;
    if (!urdfLinkWorldMatrix) {
      shouldUseFallback = false;
    } else if (looksDegenerate(currentLinkFrameMatrix) && looksAuthored(urdfLinkWorldMatrix)) {
      shouldUseFallback = true;
    } else if (looksDegenerate(stageLinkWorldMatrix) && looksAuthored(urdfLinkWorldMatrix)) {
      shouldUseFallback = true;
    } else if (currentLinkFrameMatrix && urdfLinkWorldMatrix) {
      const deltaCurrentUrdf = getMatrixMaxElementDelta(currentLinkFrameMatrix, urdfLinkWorldMatrix);
      shouldUseFallback = deltaCurrentUrdf > 0.25;
    }

    this._urdfVisualFallbackLinkDecisionCache.set(linkPath, shouldUseFallback);
    return shouldUseFallback;
  }

  shouldUseUrdfVisualFallbackForMesh(meshId) {
    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto || proto.sectionName !== 'visuals') return false;

    if (this._urdfVisualFallbackDecisionCache.has(meshId)) {
      return this._urdfVisualFallbackDecisionCache.get(meshId) === true;
    }

    if (this.config?.forceUrdfVisualFallback === false) return false;
    if (this.config?.forceUrdfVisualFallback === true) return true;

    const linkPath = proto.linkPath;
    if (!linkPath) return false;

    const urdfLinkWorldMatrix = this.getUrdfLinkWorldTransformFromJointChain(linkPath) || null;
    const urdfVisualEntry = this.getUrdfVisualEntryForMeshId(meshId);
    const hasUrdfVisualLocalMatrix = !!urdfVisualEntry?.localMatrix;
    if (!urdfLinkWorldMatrix) {
      this._urdfVisualFallbackDecisionCache.set(meshId, false);
      return false;
    }

    const looksAuthored = (matrix) => !!matrix && (!isMatrixApproximatelyIdentity(matrix) || hasNonZeroTranslation(matrix));
    const looksDegenerate = (matrix) => !looksAuthored(matrix);
    const stageLinkWorldMatrix = this.getWorldTransformForPrimPath(linkPath) || null;
    const resolvedVisualPrimPath = this.getResolvedVisualTransformPrimPathForMeshId(meshId);
    const resolvedVisualWorldMatrix = resolvedVisualPrimPath
      ? this.getWorldTransformForPrimPath(resolvedVisualPrimPath)
      : null;
    const resolvedLooksAuthored = looksAuthored(resolvedVisualWorldMatrix);
    const stageLooksAuthored = looksAuthored(stageLinkWorldMatrix);

    if (!hasUrdfVisualLocalMatrix && proto.protoIndex > 0) {
      this._urdfVisualFallbackDecisionCache.set(meshId, false);
      return false;
    }

    if (resolvedLooksAuthored) {
      if (hasUrdfVisualLocalMatrix && stageLinkWorldMatrix) {
        const resolvedLocalVisualMatrix = stageLinkWorldMatrix.clone().invert().multiply(resolvedVisualWorldMatrix.clone());
        const resolvedLocalLooksBroken = looksDegenerate(resolvedLocalVisualMatrix);
        const urdfLocalLooksAuthored = looksAuthored(urdfVisualEntry.localMatrix);
        const shouldFallback = resolvedLocalLooksBroken && urdfLocalLooksAuthored;
        this._urdfVisualFallbackDecisionCache.set(meshId, shouldFallback);
        return shouldFallback;
      }

      this._urdfVisualFallbackDecisionCache.set(meshId, false);
      return false;
    }

    let shouldFallback = false;
    if (hasUrdfVisualLocalMatrix) {
      shouldFallback = true;
    } else if (proto.protoIndex === 0) {
      shouldFallback = !stageLooksAuthored;
    }

    this._urdfVisualFallbackDecisionCache.set(meshId, shouldFallback);
    return shouldFallback;
  }

  shouldTreatNamedHexDiffuseAsSrgb() {
    // By default keep named hex diffuse values in authored linear space.
    // This avoids over-darkening colors like material_333333 on Unitree G1.
    if (this.config?.forceNamedHexDiffuseAsSrgb === true) return true;
    return false;
  }

  shouldUseAggressiveVisualFallbackSync(meshId) {
    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto || proto.sectionName !== 'visuals' || proto.protoType !== 'mesh' || proto.protoIndex <= 0) {
      return false;
    }

    const resolvedVisualPrimPath = this.getResolvedVisualTransformPrimPathForMeshId(meshId);
    if (!resolvedVisualPrimPath) return false;

    const resolvedVisualWorldMatrix = this.getWorldTransformForPrimPath(resolvedVisualPrimPath);
    const fallbackTransform = this.getSafeFallbackTransformForMeshId(meshId);
    if (!resolvedVisualWorldMatrix || !fallbackTransform) return false;

    const resolvedHasAuthoredTransform = !isMatrixApproximatelyIdentity(resolvedVisualWorldMatrix)
      || hasNonZeroTranslation(resolvedVisualWorldMatrix);
    if (!resolvedHasAuthoredTransform) return false;

    const resolvedVsFallbackDelta = getMatrixMaxElementDelta(resolvedVisualWorldMatrix, fallbackTransform);
    return resolvedVsFallbackDelta > 1e-4;
  }

  getStage() {
    if (this._resolvedDriverStage) {
      return this._resolvedDriverStage;
    }

    if (typeof this.config.stage === 'function') {
      try {
        const staged = this.config.stage();
        if (staged) {
          this._resolvedDriverStage = staged;
          return staged;
        }
      } catch {}
    }

    if (this.allowDriverStageLookup === false) return null;

    const shouldSkipDriverStageLookup = this.deferDriverStageLookupInSyncHotPath !== false
      && this.isHydraSyncHotPathActive?.() === true;
    if (shouldSkipDriverStageLookup) return null;

    if (!this.config.driver) return null;
    const driver = this.config.driver();
    if (!driver || !driver.GetStage) return null;
    const stage = driver.GetStage();
    const isAsyncStage = !!stage && typeof stage.then === 'function';
    if (isAsyncStage) {
      if (!this._pendingDriverStagePromise) {
        this._pendingDriverStagePromise = Promise.resolve(stage)
          .then((resolvedStage) => {
            const maybeSyncStage = driver.GetStage?.();
            const candidateStage = (
              maybeSyncStage && typeof maybeSyncStage.then !== 'function'
                ? maybeSyncStage
                : resolvedStage
            ) || null;
            if (!candidateStage || typeof candidateStage.then === 'function') {
              return null;
            }
            this._resolvedDriverStage = candidateStage;
            if (typeof this.config?.setStage === 'function') {
              try {
                this.config.setStage(candidateStage);
              } catch {}
            }
            return candidateStage;
          })
          .catch(() => null)
          .finally(() => {
            this._pendingDriverStagePromise = null;
          });
      }
      return null;
    }

    if (!stage) return null;
    this._resolvedDriverStage = stage;
    if (typeof this.config?.setStage === 'function') {
      try {
        this.config.setStage(stage);
      } catch {}
    }
    return stage;
  }

  resolveMaterialIdForMesh(materialId, meshId) {
    const normalizedMaterialId = normalizeHydraPath(materialId);
    if (!normalizedMaterialId) return null;

    const candidates = [];
    const addCandidate = (candidatePath) => {
      const normalized = normalizeHydraPath(candidatePath);
      if (!normalized || candidates.includes(normalized)) return;
      candidates.push(normalized);
    };

    addCandidate(normalizedMaterialId);

    const looksMarkerIndex = normalizedMaterialId.toLowerCase().indexOf('/looks/');
    const looksSuffix = looksMarkerIndex >= 0 ? normalizedMaterialId.slice(looksMarkerIndex) : '';
    const materialBasename = getPathBasename(normalizedMaterialId);

    const proto = parseProtoMeshIdentifier(meshId);
    const meshRootPath = proto?.linkPath ? getRootPathFromPrimPath(proto.linkPath) : null;
    if (meshRootPath) {
      if (looksSuffix) addCandidate(`${meshRootPath}${looksSuffix}`);
      if (materialBasename) addCandidate(`${meshRootPath}/Looks/${materialBasename}`);
      if (materialBasename) addCandidate(`${meshRootPath}/looks/${materialBasename}`);
    }

    const stagePath = String(this.getNormalizedStageSourcePath() || '');
    const stageFileName = stagePath.split('/').pop() || '';
    const stageRootStem = stageFileName.replace(/\.usd[a-z]?$/i, '');
    if (stageRootStem) {
      if (looksSuffix) addCandidate(`/${stageRootStem}${looksSuffix}`);
      if (materialBasename) addCandidate(`/${stageRootStem}/Looks/${materialBasename}`);
    }

    const stage = this.getStage();
    for (const candidate of candidates) {
      if (this.materials[candidate]) return candidate;
      if (stage && this.safeGetPrimAtPath(stage, candidate)) {
        return candidate;
      }
    }

    return normalizedMaterialId;
  }

  getOrCreateMaterialById(materialId, meshId = null) {
    const normalizedMaterialId = normalizeHydraPath(materialId);
    if (!normalizedMaterialId) return null;
    const resolvedMaterialId = this.resolveMaterialIdForMesh(normalizedMaterialId, meshId) || normalizedMaterialId;

    const existingMaterial = this.materials[resolvedMaterialId] || this.materials[normalizedMaterialId];
    if (existingMaterial) return existingMaterial;

    const fallbackMaterial = this.createFallbackMaterialFromStage(resolvedMaterialId);
    if (!fallbackMaterial) return null;

    this.materials[resolvedMaterialId] = fallbackMaterial;
    if (resolvedMaterialId !== normalizedMaterialId) {
      this.materials[normalizedMaterialId] = fallbackMaterial;
    }
    return fallbackMaterial;
  }

  createFallbackMaterialFromStage(materialPath) {
    if (!materialPath) return null;

    if (this._stageFallbackMaterialCache.has(materialPath)) {
      return this._stageFallbackMaterialCache.get(materialPath);
    }

    const stage = this.getStage();
    if (!stage) {
      this._stageFallbackMaterialCache.set(materialPath, null);
      return null;
    }

    const materialPrim = this.safeGetPrimAtPath(stage, materialPath);
    if (!materialPrim) {
      this._stageFallbackMaterialCache.set(materialPath, null);
      return null;
    }

    const materialName = materialPath.split('/').filter(Boolean).pop() || materialPath;
    const inferredColorHex = this.inferColorHexFromMaterialName(materialName);
    const shaderPrim = this.findMaterialShaderPrim(stage, materialPath, materialName);

    const material = new MeshPhysicalMaterial({
      side: DoubleSide,
      color: new Color(inferredColorHex ?? 0xB4B4B4),
      name: materialName,
    });

    if (shaderPrim) {
      this.applyStageFallbackMaterialParameters(material, shaderPrim);
    }

    const wrappedMaterial = {
      _id: materialPath,
      _nodes: {},
      _interface: this,
      _material: material,
    };

    this._stageFallbackMaterialCache.set(materialPath, wrappedMaterial);
    return wrappedMaterial;
  }

}
