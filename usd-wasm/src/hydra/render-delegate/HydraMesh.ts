// @ts-nocheck
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Uint32BufferAttribute,
  Vector3,
} from 'three';
import * as Shared from './shared.js';
import { getDefaultMaterial } from './default-material-state.js';

const { buildProtoPrimPathCandidates,clamp01,createMatrixFromXformOp,debugInstancer,debugMaterials,debugMeshes,debugPrims,debugTextures,defaultGrayComponent,disableMaterials,disableTextures,extractPrimPathFromMaterialBindingWarning,extractReferencePrimTargets,extractScopeBodyText,extractUsdAssetReferencesFromLayerText,getActiveMaterialBindingWarningOwner,getAngleInRadians,getCollisionGeometryTypeFromUrdfElement,getExpectedPrimTypesForCollisionProto,getExpectedPrimTypesForProtoType,getMatrixMaxElementDelta,getPathBasename,getPathWithoutRoot,getRawConsoleMethod,getRootPathFromPrimPath,getSafePrimTypeName,hasNonZeroTranslation,hydraCallbackErrorCounts,installMaterialBindingApiWarningInterceptor,isIdentityQuaternion,isLikelyDefaultGrayMaterial,isLikelyInverseTransform,isMaterialBindingApiWarningMessage,isMatrixApproximatelyIdentity,isNonZero,isPotentiallyLargeBaseAssetPath,logHydraCallbackError,materialBindingRepairMaxLayerTextLength,materialBindingWarningHandlers,maxHydraCallbackErrorLogsPerMethod,nearlyEqual,normalizeHydraPath,normalizeUsdPathToken,parseGuideCollisionReferencesFromLayerText,parseProtoMeshIdentifier,parseUrdfTruthFromText,parseVector3Text,parseXformOpFallbacksFromLayerText,rawConsoleError,rawConsoleWarn,registerMaterialBindingApiWarningHandler,remapRootPathIfNeeded,resolveUrdfTruthFileNameForStagePath,resolveUsdAssetPath,setActiveMaterialBindingWarningOwner,shouldAllowLargeBaseAssetScan,stringifyConsoleArgs,toArrayLike,toColorArray,toFiniteNumber,toFiniteQuaternionWxyzTuple,toFiniteVector2Tuple,toFiniteVector3Tuple,toMatrixFromUrdfOrigin,toQuaternionWxyzFromRpy,transformEpsilon,wrapHydraCallbackObject } = Shared;

const HYDRA_SYNC_PROFILE_FROM_QUERY = (() => {
  try {
    const search = typeof window !== 'undefined' ? String(window.location?.search || '') : '';
    return /\b(profileHydraSync|profileHydraMesh|debugHydraPerf)=1\b/.test(search);
  } catch {
    return false;
  }
})();

const PREFER_HYDRA_COLLISION_GEOMETRY = (() => {
  try {
    const search = typeof window !== 'undefined' ? String(window.location?.search || '') : '';
    if (!search) return true;
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const raw = params.get('preferHydraCollisionGeometry');
    if (raw === null || raw === undefined) return true;
    const normalized = String(raw).trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    return true;
  } catch {
    return true;
  }
})();

const DEFER_COLLISION_OVERRIDE_IN_COMMIT = (() => {
  try {
    const search = typeof window !== 'undefined' ? String(window.location?.search || '') : '';
    if (!search) return true;
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const raw = params.get('deferCollisionOverrideInCommit');
    if (raw === null || raw === undefined) return true;
    const normalized = String(raw).trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    return true;
  } catch {
    return true;
  }
})();

const EMPTY_UINT32_ARRAY = new Uint32Array(0);
// Keep primitive tessellation multiples of 4 so cardinal directions land on
// vertices; this avoids ~1.5% AABB shrink on spheres/cylinders.
const PRIMITIVE_SEGMENTS = {
  sphereWidth: 24,
  sphereHeight: 16,
  cylinderRadial: 24,
  cylinderHeight: 1,
  capsuleCap: 12,
  capsuleRadial: 24,
};

function shouldProfileHydraSync(): boolean {
  return HYDRA_SYNC_PROFILE_FROM_QUERY || globalThis?.__HYDRA_PROFILE_SYNC__ === true;
}

class HydraMesh {
  /**
   * @param {string} typeId
   * @param {string} id
   * @param {ThreeRenderDelegateInterface} hydraInterface
   * @param {string} instancerId
   */
  constructor(typeId, id, hydraInterface, instancerId = null) {
    this._geometry = new BufferGeometry();
    this._typeId = normalizeHydraPath(typeId).toLowerCase();
    this._id = normalizeHydraPath(id);
    this._interface = hydraInterface;
    this._instancerId = normalizeHydraPath(instancerId); // Store relationship
    this._points = undefined;
    this._normals = undefined;
    this._colors = undefined;
    this._uvs = undefined;
    this._indices = undefined;
    this._materials = [];
    this._hasEverReceivedTransform = false;
    this._hasCompletedProtoSync = false;
    this._primitiveFallbackType = this.getPrimitiveFallbackType();
    this._hasGeneratedPrimitiveFallback = false;
    this._appliedCollisionOverride = false;
    this._lastAppliedResolvedPrimPath = null;
    this._needsNormalFallback = false;
    // Track whether this mesh already received authored topology/vertex payloads
    // from Hydra. When true, proto blob fast-path is redundant and can add avoidable
    // first-sync stalls (especially if it triggers driver-side batch blob fetch).
    this._hasHydraGeometryPayload = false;
    this._lastGeomSubsetSignature = '';
    this._decomposeScratchPositionA = new Vector3();
    this._decomposeScratchQuaternionA = new Quaternion();
    this._decomposeScratchScaleA = new Vector3();
    this._decomposeScratchPositionB = new Vector3();
    this._decomposeScratchQuaternionB = new Quaternion();
    this._decomposeScratchScaleB = new Vector3();

    let material = new MeshPhysicalMaterial({
      side: DoubleSide,
      color: new Color(0xB4B4B4),
      // envMap: hydraInterface.config.envMap,
    });
    this._materials.push(material);
    this._mesh = new Mesh(this._geometry, material);
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = true;

    // ID can contain paths, we strip those here
    let _name = id;
    let lastSlash = _name.lastIndexOf('/');
    if (lastSlash >= 0) {
      _name = _name.substring(lastSlash + 1);
    }
    this._mesh.name = _name;

    // console.log("Creating HydraMesh: " + id + " -> " + _name);

    hydraInterface.config.usdRoot.add(this._mesh); // FIXME
  }

  getPrimitiveFallbackType() {
    const typeId = this._typeId || "";
    const meshId = this._id || "";
    const source = `${typeId}|${meshId}`.toLowerCase();
    const isCollisionMeshId = source.includes('/collisions.') || source.includes('/collisions/') || source.includes('/collision.') || source.includes('/collision/');

    if (source.includes("proto_box") || source.includes("cube") || source.includes("box")) {
      return "box";
    }
    if (source.includes("proto_sphere") || source.includes("sphere")) {
      return "sphere";
    }
    if (source.includes("proto_cylinder") || source.includes("cylinder") || source.includes("capsule")) {
      return "cylinder";
    }
    if (isCollisionMeshId && source.includes("proto_mesh")) {
      return "collisionProxy";
    }

    return null;
  }

  isCollisionProtoMesh() {
    if (!this._id || !this._id.includes(".proto_")) return false;
    const loweredId = this._id.toLowerCase();
    return loweredId.includes('/collisions.') || loweredId.includes('/collisions/') || loweredId.includes('/collision.') || loweredId.includes('/collision/');
  }

  isVisualProtoMesh() {
    if (!this._id || !this._id.includes(".proto_")) return false;
    const proto = parseProtoMeshIdentifier(this._id);
    return !!proto && proto.sectionName === 'visuals';
  }

  tryInheritVisualMaterialFromLink() {
    if (!this.isVisualProtoMesh()) return false;

    const proto = parseProtoMeshIdentifier(this._id);
    if (!proto?.linkPath) return false;

    const currentMaterial = this._mesh.material;
    const looksDefaultMaterial = currentMaterial === getDefaultMaterial()
      || isLikelyDefaultGrayMaterial(Array.isArray(currentMaterial) ? currentMaterial.find(Boolean) : currentMaterial);
    if (!looksDefaultMaterial) return false;

    const inheritedMaterial = this._interface.getPreferredVisualMaterialForLink(proto.linkPath, this._id);
    if (!inheritedMaterial) return false;

    this._mesh.material = inheritedMaterial;
    this._pendingMaterialId = undefined;
    return true;
  }

  ensurePrimitiveFallbackGeometry() {
    if (!this._primitiveFallbackType) return;
    if (this._hasGeneratedPrimitiveFallback) {
      if (this.isCollisionProtoMesh() && !this._appliedCollisionOverride) {
        this.applyCollisionGeometryFromOverrides();
      }
      return;
    }

    const existingPositions = this._geometry.getAttribute('position');
    const hasExistingGeometry = !!(existingPositions && existingPositions.count > 0);
    if (PREFER_HYDRA_COLLISION_GEOMETRY && hasExistingGeometry && this._hasHydraGeometryPayload) {
      // If Hydra already provided authored geometry, skip expensive stage/URDF
      // collision override resolution in the first commit hot-path.
      this._hasGeneratedPrimitiveFallback = true;
      return;
    }

    if (this.applyCollisionGeometryFromOverrides()) return;

    if (existingPositions && existingPositions.count > 0) {
      this._hasGeneratedPrimitiveFallback = true;
      return;
    }

    let fallbackGeometry = null;
    switch (this._primitiveFallbackType) {
      case "box":
        fallbackGeometry = new BoxGeometry(1, 1, 1);
        break;
      case "sphere":
        fallbackGeometry = new SphereGeometry(0.5, PRIMITIVE_SEGMENTS.sphereWidth, PRIMITIVE_SEGMENTS.sphereHeight);
        break;
      case "cylinder":
        fallbackGeometry = new CylinderGeometry(
          0.5,
          0.5,
          1,
          PRIMITIVE_SEGMENTS.cylinderRadial,
          PRIMITIVE_SEGMENTS.cylinderHeight,
          false,
        );
        break;
      case "collisionProxy":
        fallbackGeometry = new BoxGeometry(0.12, 0.12, 0.12);
        break;
      default:
        return;
    }

    this._geometry.copy(fallbackGeometry);
    fallbackGeometry.dispose();
    this._hasGeneratedPrimitiveFallback = true;
  }

  replaceGeometry(nextGeometry) {
    if (!nextGeometry) return;
    const previousGeometry = this._geometry;
    this._geometry = nextGeometry;
    this._mesh.geometry = nextGeometry;
    this._needsNormalFallback = true;
    if (previousGeometry && previousGeometry !== nextGeometry && previousGeometry.dispose) {
      previousGeometry.dispose();
    }
  }

  applyResolvedPrimGeometry(primPath) {
    if (!primPath) return false;
    const stage = this._interface.getStage();
    if (!stage) return false;

    const prim = this._interface.safeGetPrimAtPath(stage, primPath);
    if (!prim) return false;

    const primType = String(getSafePrimTypeName(prim) || '').toLowerCase();
    if (primType === 'mesh') {
      return this.applyUsdMeshGeometry(prim);
    }
    if (primType === 'cube' || primType === 'sphere' || primType === 'cylinder' || primType === 'capsule') {
      return this.applyUsdPrimitiveGeometry(prim, primType);
    }
    return false;
  }

  getExtentDimensionsFromDescriptor(descriptor) {
    if (!descriptor || !descriptor.extentSize || typeof descriptor.extentSize.length !== 'number') return null;
    if (Number(descriptor.extentSize.length) < 3) return null;
    const width = Math.abs(Number(descriptor.extentSize[0] ?? 0));
    const height = Math.abs(Number(descriptor.extentSize[1] ?? 0));
    const depth = Math.abs(Number(descriptor.extentSize[2] ?? 0));
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth)) return null;
    return [Math.max(width, 1e-6), Math.max(height, 1e-6), Math.max(depth, 1e-6)];
  }

  applyPrimitiveGeometryFromDescriptor(primType, descriptor) {
    let generated = null;
    const normalizedType = String(primType || '').toLowerCase();
    const dimensionsFromExtent = this.getExtentDimensionsFromDescriptor(descriptor);
    const sizeValue = toFiniteNumber(descriptor?.size);
    const radiusValue = toFiniteNumber(descriptor?.radius);
    const heightValue = toFiniteNumber(descriptor?.height);
    const axis = String(descriptor?.axis || 'Z').toUpperCase();

    if (normalizedType === 'cube') {
      const extentMatchesSize = dimensionsFromExtent && sizeValue !== undefined
        ? nearlyEqual(dimensionsFromExtent[0], sizeValue)
          && nearlyEqual(dimensionsFromExtent[1], sizeValue)
          && nearlyEqual(dimensionsFromExtent[2], sizeValue)
        : false;

      const width = dimensionsFromExtent
        ? (sizeValue !== undefined && !extentMatchesSize ? sizeValue : dimensionsFromExtent[0])
        : (sizeValue ?? 1);
      const height = dimensionsFromExtent
        ? (sizeValue !== undefined && !extentMatchesSize ? sizeValue : dimensionsFromExtent[1])
        : (sizeValue ?? 1);
      const depth = dimensionsFromExtent
        ? (sizeValue !== undefined && !extentMatchesSize ? sizeValue : dimensionsFromExtent[2])
        : (sizeValue ?? 1);
      generated = new BoxGeometry(width, height, depth);
    } else if (normalizedType === 'sphere') {
      const radiusFromExtent = dimensionsFromExtent
        ? Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5
        : undefined;
      const radius = radiusValue ?? radiusFromExtent ?? 0.5;
      generated = new SphereGeometry(
        Math.max(radius, 1e-6),
        PRIMITIVE_SEGMENTS.sphereWidth,
        PRIMITIVE_SEGMENTS.sphereHeight,
      );
    } else if (normalizedType === 'cylinder') {
      let radiusFromExtent = undefined;
      let heightFromExtent = undefined;
      if (dimensionsFromExtent) {
        if (axis === 'X') {
          heightFromExtent = dimensionsFromExtent[0];
          radiusFromExtent = Math.max(dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5;
        } else if (axis === 'Y') {
          heightFromExtent = dimensionsFromExtent[1];
          radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[2]) * 0.5;
        } else {
          heightFromExtent = dimensionsFromExtent[2];
          radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1]) * 0.5;
        }
      }
      const radius = radiusValue ?? radiusFromExtent ?? 0.5;
      const height = heightValue ?? heightFromExtent ?? 1;
      generated = new CylinderGeometry(
        Math.max(radius, 1e-6),
        Math.max(radius, 1e-6),
        Math.max(height, 1e-6),
        PRIMITIVE_SEGMENTS.cylinderRadial,
        PRIMITIVE_SEGMENTS.cylinderHeight,
        false,
      );
      if (axis === 'X') {
        generated.rotateZ(-Math.PI / 2);
      } else if (axis === 'Z') {
        generated.rotateX(Math.PI / 2);
      }
    } else if (normalizedType === 'capsule') {
      let radiusFromExtent = undefined;
      let totalHeightFromExtent = undefined;
      if (dimensionsFromExtent) {
        if (axis === 'X') {
          totalHeightFromExtent = dimensionsFromExtent[0];
          radiusFromExtent = Math.max(dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5;
        } else if (axis === 'Y') {
          totalHeightFromExtent = dimensionsFromExtent[1];
          radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[2]) * 0.5;
        } else {
          totalHeightFromExtent = dimensionsFromExtent[2];
          radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1]) * 0.5;
        }
      }
      const radius = Math.max(radiusValue ?? radiusFromExtent ?? 0.5, 1e-6);
      const totalHeight = Math.max(heightValue ?? totalHeightFromExtent ?? 1, 1e-6);
      const capsuleBodyHeight = Math.max(totalHeight - 2 * radius, 1e-6);
      generated = new CapsuleGeometry(
        radius,
        capsuleBodyHeight,
        PRIMITIVE_SEGMENTS.capsuleCap,
        PRIMITIVE_SEGMENTS.capsuleRadial,
      );
      if (axis === 'X') {
        generated.rotateZ(-Math.PI / 2);
      } else if (axis === 'Z') {
        generated.rotateX(Math.PI / 2);
      }
    }

    if (!generated) return false;
    generated.computeBoundingBox();
    generated.computeBoundingSphere();
    this.replaceGeometry(generated);
    return true;
  }

  applyCollisionGeometryFromDriverOverride(overridePayload) {
    if (!overridePayload || overridePayload.valid !== true) return false;
    const primType = String(overridePayload.primType || '').toLowerCase();
    if (!primType) return false;

    let geometryApplied = false;
    if (primType === 'mesh') {
      try {
        geometryApplied = this.tryApplyProtoDataBlobFastPath() === true;
      } catch {
        geometryApplied = false;
      }
      if (!geometryApplied) {
        const resolvedPath = normalizeHydraPath(overridePayload.resolvedPrimPath);
        if (resolvedPath) {
          geometryApplied = this.applyResolvedPrimGeometry(resolvedPath) === true;
        }
      }
      if (!geometryApplied) {
        // Mesh proto IDs can still provide authored extents even when direct
        // mesh payload hydration fails. Use a box proxy from extents so collider
        // dimensions remain physically meaningful instead of default 0.12 cubes.
        geometryApplied = this.applyPrimitiveGeometryFromDescriptor('cube', overridePayload) === true;
      }
    } else if (primType === 'cube' || primType === 'sphere' || primType === 'cylinder' || primType === 'capsule') {
      geometryApplied = this.applyPrimitiveGeometryFromDescriptor(primType, overridePayload) === true;
    }
    if (!geometryApplied) return false;

    const localXformOverride = this._interface.getCollisionLocalXformOverride(this._id);
    if (localXformOverride) {
      const proto = parseProtoMeshIdentifier(this._id);
      const linkPath = localXformOverride.linkPath || proto?.linkPath || null;
      const linkTransform = linkPath ? this._interface.getWorldTransformForPrimPath(linkPath) : null;
      const localMatrix = new Matrix4().compose(
        localXformOverride.translation,
        localXformOverride.orientation,
        localXformOverride.scale
      );
      if (linkTransform) {
        localMatrix.premultiply(linkTransform);
      }
      this._mesh.matrix.copy(localMatrix);
      this._mesh.matrixAutoUpdate = false;
    } else if (overridePayload.worldTransform && this._setMatrixFromRowMajorSource(overridePayload.worldTransform)) {
      this._mesh.matrixAutoUpdate = false;
    } else {
      const resolvedPath = normalizeHydraPath(overridePayload.resolvedPrimPath);
      if (resolvedPath) {
        const resolvedTransform = this._interface.getWorldTransformForPrimPath(resolvedPath);
        if (resolvedTransform) {
          this._mesh.matrix.copy(resolvedTransform);
          this._mesh.matrixAutoUpdate = false;
        }
      }
    }

    this._appliedCollisionOverride = true;
    this._lastAppliedResolvedPrimPath = normalizeHydraPath(overridePayload.resolvedPrimPath) || this._lastAppliedResolvedPrimPath;
    this._hasGeneratedPrimitiveFallback = true;
    return true;
  }

  applyFinalStageOverrideFromDriver(overridePayload, options = {}) {
    if (!overridePayload || overridePayload.valid !== true) return false;
    const normalizedMeshId = normalizeHydraPath(overridePayload.meshId || this._id) || this._id;
    const sectionNameRaw = String(overridePayload.sectionName || '').toLowerCase();
    const sectionName = sectionNameRaw
      || (normalizedMeshId.includes('/visuals.proto_') ? 'visuals' : '')
      || (normalizedMeshId.includes('/collisions.proto_') ? 'collisions' : '');

    const isCollisionSection = sectionName === 'collisions' || this.isCollisionProtoMesh();
    const isVisualSection = !isCollisionSection && (sectionName === 'visuals' || this.isVisualProtoMesh());

    if (isCollisionSection) {
      const geometryApplied = this.applyCollisionGeometryFromDriverOverride(overridePayload) === true;
      if (!geometryApplied) return false;

      if (options?.skipTransformFallback !== true) {
        this.syncProtoTransformFromFallback();
      }
      if (options?.skipCollisionRotationFallback !== true) {
        this.syncCollisionRotationFromVisualLink();
      }
      this._hasCompletedProtoSync = true;
      return true;
    }

    if (isVisualSection) {
      const existingPosition = this._geometry?.getAttribute?.('position');
      let geometryReady = !!existingPosition && Number(existingPosition.count || 0) > 0;
      if (!geometryReady) {
        try {
          geometryReady = this.tryApplyProtoDataBlobFastPath() === true;
        } catch {
          geometryReady = false;
        }
      }
      if (!geometryReady && this._hasHydraGeometryPayload === true) {
        geometryReady = true;
      }
      if (!geometryReady) {
        // Keep proto sync pending so applyProtoStageSync() can continue with fallback chains.
        return false;
      }

      let transformApplied = false;
      const worldTransform = overridePayload?.worldTransform || null;
      if (worldTransform && worldTransform.isMatrix4 === true) {
        this._mesh.matrix.copy(worldTransform);
        transformApplied = true;
      } else {
        const worldElements = overridePayload?.worldTransformElements || worldTransform;
        transformApplied = this._setMatrixFromRowMajorSource(worldElements);
      }

      if (!transformApplied) {
        const resolvedPrimPath = normalizeHydraPath(overridePayload?.resolvedPrimPath || '');
        if (resolvedPrimPath) {
          const resolvedTransform = this._interface.getWorldTransformForPrimPath(resolvedPrimPath);
          if (resolvedTransform) {
            this._mesh.matrix.copy(resolvedTransform);
            transformApplied = true;
          }
        }
      }

      if (!transformApplied) return false;
      this._mesh.matrixAutoUpdate = false;
      this._hasCompletedProtoSync = true;
      return true;
    }

    return false;
  }

  hasAppliedCollisionOverrideForPrimPath(primPath) {
    const normalizedPath = normalizeHydraPath(primPath);
    if (!normalizedPath || !normalizedPath.startsWith('/')) return false;
    if (this._appliedCollisionOverride !== true) return false;
    return this._lastAppliedResolvedPrimPath === normalizedPath;
  }

  applyResolvedPrimGeometryAndTransform(primPath) {
    const normalizedPrimPath = normalizeHydraPath(primPath);
    if (!normalizedPrimPath || !normalizedPrimPath.startsWith('/')) return false;

    if (this.hasAppliedCollisionOverrideForPrimPath(normalizedPrimPath)) {
      const resolvedTransform = this._interface.getWorldTransformForPrimPath(normalizedPrimPath);
      if (resolvedTransform) {
        this._mesh.matrix.copy(resolvedTransform);
        this._mesh.matrixAutoUpdate = false;
      }
      return true;
    }

    const primOverrideData = this._interface?.getPrimOverrideData?.(normalizedPrimPath) || null;
    if (primOverrideData && primOverrideData.valid === true) {
      let geometryApplied = false;
      if (primOverrideData.primType === 'mesh') {
        try {
          geometryApplied = this.tryApplyProtoDataBlobFastPath() === true;
        } catch {
          geometryApplied = false;
        }
        if (!geometryApplied) {
          geometryApplied = this.applyResolvedPrimGeometry(normalizedPrimPath) === true;
        }
      } else if (
        primOverrideData.primType === 'cube'
        || primOverrideData.primType === 'sphere'
        || primOverrideData.primType === 'cylinder'
        || primOverrideData.primType === 'capsule'
      ) {
        geometryApplied = this.applyPrimitiveGeometryFromDescriptor(primOverrideData.primType, primOverrideData) === true;
      }

      if (geometryApplied) {
        const localXformOverride = this._interface.getCollisionLocalXformOverride(this._id);
        if (localXformOverride) {
          const proto = parseProtoMeshIdentifier(this._id);
          const linkPath = localXformOverride.linkPath || proto?.linkPath || null;
          const linkTransform = linkPath ? this._interface.getWorldTransformForPrimPath(linkPath) : null;
          const localMatrix = new Matrix4().compose(
            localXformOverride.translation,
            localXformOverride.orientation,
            localXformOverride.scale
          );
          if (linkTransform) {
            localMatrix.premultiply(linkTransform);
          }
          this._mesh.matrix.copy(localMatrix);
          this._mesh.matrixAutoUpdate = false;
        } else if (primOverrideData.worldTransform && this._setMatrixFromRowMajorSource(primOverrideData.worldTransform)) {
          this._mesh.matrixAutoUpdate = false;
        }

        this._appliedCollisionOverride = true;
        this._lastAppliedResolvedPrimPath = normalizedPrimPath;
        this._hasGeneratedPrimitiveFallback = true;
        return true;
      }
    }

    if (!this.applyResolvedPrimGeometry(normalizedPrimPath)) return false;

    const localXformOverride = this._interface.getCollisionLocalXformOverride(this._id);
    if (localXformOverride) {
      const proto = parseProtoMeshIdentifier(this._id);
      const linkPath = localXformOverride.linkPath || proto?.linkPath || null;
      const linkTransform = linkPath ? this._interface.getWorldTransformForPrimPath(linkPath) : null;
      const localMatrix = new Matrix4().compose(
        localXformOverride.translation,
        localXformOverride.orientation,
        localXformOverride.scale
      );
      if (linkTransform) {
        localMatrix.premultiply(linkTransform);
      }
      this._mesh.matrix.copy(localMatrix);
      this._mesh.matrixAutoUpdate = false;
    } else {
      const resolvedTransform = this._interface.getWorldTransformForPrimPath(normalizedPrimPath);
      if (resolvedTransform) {
        this._mesh.matrix.copy(resolvedTransform);
        this._mesh.matrixAutoUpdate = false;
      } else {
        const urdfWorldTransform = this.isCollisionProtoMesh()
          ? this._interface.getCollisionWorldTransformFromUrdfTruth(this._id)
          : null;
        if (urdfWorldTransform) {
          this._mesh.matrix.copy(urdfWorldTransform);
          this._mesh.matrixAutoUpdate = false;
        }
      }
    }

    this._appliedCollisionOverride = true;
    this._lastAppliedResolvedPrimPath = normalizedPrimPath;
    this._hasGeneratedPrimitiveFallback = true;
    return true;
  }

  syncVisualTransformFromResolvedPrim() {
    if (!this.isVisualProtoMesh()) return false;

    const resolvedPrimPath = this._interface.getResolvedVisualTransformPrimPathForMeshId(this._id);
    if (!resolvedPrimPath) return false;

    const resolvedTransform = this._interface.getWorldTransformForPrimPath(resolvedPrimPath);
    if (!resolvedTransform) return false;

    const currentMatrix = this._mesh.matrix;
    const currentVsResolvedDelta = getMatrixMaxElementDelta(currentMatrix, resolvedTransform);
    const preferResolvedTransform = this._interface.shouldPreferResolvedVisualTransformForMeshId?.(this._id) === true;
    if (preferResolvedTransform) {
      if (currentVsResolvedDelta > transformEpsilon) {
        this._mesh.matrix.copy(resolvedTransform);
        this._mesh.matrixAutoUpdate = false;
      }
      return true;
    }

    const fallbackTransform = this._interface.getSafeFallbackTransformForMeshId(this._id);
    if (!fallbackTransform) {
      if (currentVsResolvedDelta > transformEpsilon) {
        this._mesh.matrix.copy(resolvedTransform);
        this._mesh.matrixAutoUpdate = false;
      }
      return true;
    }

    const nearFallbackEpsilon = Math.max(transformEpsilon, 1e-4);
    const currentVsFallbackDelta = getMatrixMaxElementDelta(currentMatrix, fallbackTransform);
    const resolvedVsFallbackDelta = getMatrixMaxElementDelta(resolvedTransform, fallbackTransform);
    const currentNearFallback = currentVsFallbackDelta <= nearFallbackEpsilon;
    const resolvedNearFallback = resolvedVsFallbackDelta <= nearFallbackEpsilon;

    const currentElements = currentMatrix.elements;
    const resolvedElements = resolvedTransform.elements;
    const fallbackElements = fallbackTransform.elements;
    const currentTranslationLength = Math.hypot(currentElements[12], currentElements[13], currentElements[14]);
    const resolvedTranslationLength = Math.hypot(resolvedElements[12], resolvedElements[13], resolvedElements[14]);
    const fallbackTranslationLength = Math.hypot(fallbackElements[12], fallbackElements[13], fallbackElements[14]);
    const currentLooksLocalRelativeToFallback = fallbackTranslationLength > 1e-6
      && currentTranslationLength < fallbackTranslationLength * 0.5;
    const resolvedLooksWorldRelativeToFallback = fallbackTranslationLength <= 1e-6
      || resolvedTranslationLength >= fallbackTranslationLength * 0.5;

    const keepResolvedPose = currentVsResolvedDelta <= transformEpsilon && resolvedLooksWorldRelativeToFallback;
    if (keepResolvedPose) return true;

    const shouldUseResolved = (
      (currentNearFallback && !resolvedNearFallback)
      || (resolvedLooksWorldRelativeToFallback && currentLooksLocalRelativeToFallback)
      || (resolvedLooksWorldRelativeToFallback && resolvedVsFallbackDelta + 1e-4 < currentVsFallbackDelta)
    );
    if (!shouldUseResolved) return false;

    this._mesh.matrix.copy(resolvedTransform);
    this._mesh.matrixAutoUpdate = false;
    return true;
  }

  syncProtoTransformFromFallback() {
    if (!this._id.includes(".proto_")) return false;
    if (this.isCollisionProtoMesh()) {
      const resolvedCollisionPrimPath = this._interface.getResolvedPrimPathForMeshId(this._id);
      if (resolvedCollisionPrimPath) return false;
    }
    if (this.isVisualProtoMesh()) {
      const urdfVisualWorldTransform = this._interface.getVisualWorldTransformFromUrdfTruth(this._id);
      if (urdfVisualWorldTransform) {
        const shouldUpdate = getMatrixMaxElementDelta(this._mesh.matrix, urdfVisualWorldTransform) > transformEpsilon;
        if (!shouldUpdate) return false;
        this._mesh.matrix.copy(urdfVisualWorldTransform);
        this._mesh.matrixAutoUpdate = false;
        return true;
      }
    }
    if (this.syncVisualTransformFromResolvedPrim()) return true;

    const fallbackTransform = this._interface.getSafeFallbackTransformForMeshId(this._id);
    if (!fallbackTransform || !hasNonZeroTranslation(fallbackTransform)) return false;

    const proto = parseProtoMeshIdentifier(this._id);

    const hasNoMeshTranslation = !hasNonZeroTranslation(this._mesh.matrix);
    if (!hasNoMeshTranslation) {
      // Some assets author proto transforms in link-local space (or even as inverse link
      // transforms). If we detect an inverse-link transform, compose fallback once so the
      // final mesh transform lands in world space consistently.
      const fallbackTranslationLength = Math.hypot(
        fallbackTransform.elements[12],
        fallbackTransform.elements[13],
        fallbackTransform.elements[14]
      );
      if (
        proto &&
        proto.sectionName === 'visuals' &&
        fallbackTranslationLength > 1e-3 &&
        isLikelyInverseTransform(this._mesh.matrix, fallbackTransform)
      ) {
        this._mesh.matrix.premultiply(fallbackTransform);
        this._mesh.matrixAutoUpdate = false;
        return true;
      }

      // Some USD assets (notably H1-2 wrists) report sub-mesh local transforms for
      // additional visual prototypes (proto_mesh_id1+) while the sibling proto_mesh_id0
      // is already authored in link/world space. In that case we need to compose the
      // fallback link transform exactly once.
      if (!proto || proto.sectionName !== 'visuals' || proto.protoType !== 'mesh' || proto.protoIndex <= 0) {
        return false;
      }

      const meshElements = this._mesh.matrix.elements;
      const fallbackElements = fallbackTransform.elements;
      const fallbackTranslation = new Vector3(fallbackElements[12], fallbackElements[13], fallbackElements[14]);
      const meshTranslation = new Vector3(meshElements[12], meshElements[13], meshElements[14]);
      const translationDelta = meshTranslation.distanceTo(fallbackTranslation);
      if (translationDelta <= 1e-4) return false;

      const fallbackLength = fallbackTranslation.length();
      const meshLength = meshTranslation.length();
      if (fallbackLength > 1e-6 && meshLength >= fallbackLength * 0.8) return false;

      const siblingMeshId = `${proto.linkPath}/visuals.proto_mesh_id0`;
      const siblingMatrix = this._interface?.meshes?.[siblingMeshId]?._mesh?.matrix;
      if (!siblingMatrix) return false;
      const siblingElements = siblingMatrix.elements;
      const siblingTranslation = new Vector3(siblingElements[12], siblingElements[13], siblingElements[14]);
      const siblingLength = siblingTranslation.length();
      if (fallbackLength > 1e-6 && siblingLength < fallbackLength * 0.5) return false;
    }

    if (hasNoMeshTranslation && proto && proto.sectionName === 'visuals' && proto.protoType === 'mesh' && proto.protoIndex > 0) {
      const fallbackElements = fallbackTransform.elements;
      const fallbackTranslationLength = Math.hypot(
        fallbackElements[12],
        fallbackElements[13],
        fallbackElements[14]
      );

      if (fallbackTranslationLength > 1e-6) {
        const candidateMatrix = this._mesh.matrix.clone().premultiply(fallbackTransform);
        const siblingMeshId = `${proto.linkPath}/visuals.proto_mesh_id0`;
        const siblingMatrix = this._interface?.meshes?.[siblingMeshId]?._mesh?.matrix;
        if (siblingMatrix && getMatrixMaxElementDelta(candidateMatrix, siblingMatrix) <= transformEpsilon) {
          // Only keep this conservative guard for stages that explicitly need it.
          // For models like G1, unresolved proto_mesh_id1+ often start at identity and
          // must still receive fallback link transforms to avoid visible detachment.
          const shouldAvoidVisualSubmeshCollapse = this._interface?.shouldUseAggressiveVisualFallbackSync?.(this._id) === true;
          if (shouldAvoidVisualSubmeshCollapse) return false;
        }
      }
    }

    this._mesh.matrix.premultiply(fallbackTransform);
    this._mesh.matrixAutoUpdate = false;
    return true;
  }

  syncCollisionRotationFromVisualLink() {
    if (!this.isCollisionProtoMesh()) return false;
    if (this._appliedCollisionOverride) return false;
    const resolvedPrimPath = this._interface.getResolvedPrimPathForMeshId(this._id);
    if (resolvedPrimPath) return false;

    const urdfWorldTransform = this._interface.getCollisionWorldTransformFromUrdfTruth(this._id);
    if (urdfWorldTransform) {
      this._mesh.matrix.copy(urdfWorldTransform);
      this._mesh.matrixAutoUpdate = false;
      return true;
    }

    const visualTransform = this._interface.getRepresentativeVisualTransformForMeshId(this._id);
    if (!visualTransform) return false;

    const currentPosition = this._decomposeScratchPositionA;
    const currentQuaternion = this._decomposeScratchQuaternionA;
    const currentScale = this._decomposeScratchScaleA;
    this._mesh.matrix.decompose(currentPosition, currentQuaternion, currentScale);

    const visualPosition = this._decomposeScratchPositionB;
    const visualQuaternion = this._decomposeScratchQuaternionB;
    const visualScale = this._decomposeScratchScaleB;
    visualTransform.decompose(visualPosition, visualQuaternion, visualScale);

    // Always apply visual rotation if it's not identity, regardless of current rotation
    // This ensures collision meshes follow visual meshes even if they have incorrect transforms
    if (!isIdentityQuaternion(visualQuaternion)) {
      this._mesh.matrix.compose(currentPosition, visualQuaternion, currentScale);
      this._mesh.matrixAutoUpdate = false;
      return true;
    }

    return false;
  }

  toTriangleIndexArray(faceVertexIndices, faceVertexCounts) {
    const sourceIndices = (faceVertexIndices && typeof faceVertexIndices.length === 'number')
      ? faceVertexIndices
      : EMPTY_UINT32_ARRAY;
    const sourceIndexLength = sourceIndices.length >>> 0;
    if (sourceIndexLength === 0) return EMPTY_UINT32_ARRAY;

    const sourceCounts = (faceVertexCounts && typeof faceVertexCounts.length === 'number')
      ? faceVertexCounts
      : null;
    if (!sourceCounts || sourceCounts.length === 0) {
      return sourceIndices;
    }

    let totalTriangles = 0;
    let cursor = 0;
    let allTriangles = true;
    for (let i = 0; i < sourceCounts.length; i++) {
      const countValue = sourceCounts[i];
      const count = countValue > 0 ? countValue : 0;
      if (count !== 3) allTriangles = false;
      if (count >= 3) totalTriangles += (count - 2);
      cursor += count;
      if (cursor >= sourceIndexLength) {
        if (cursor > sourceIndexLength) allTriangles = false;
        break;
      }
    }

    if (allTriangles) {
      return sourceIndices;
    }
    if (totalTriangles <= 0) {
      return EMPTY_UINT32_ARRAY;
    }

    const triangles = new Uint32Array(totalTriangles * 3);
    cursor = 0;
    let writeOffset = 0;
    for (let i = 0; i < sourceCounts.length; i++) {
      const countValue = sourceCounts[i];
      const count = countValue > 0 ? countValue : 0;
      if (count >= 3) {
        if (cursor + count > sourceIndexLength) break;
        const first = sourceIndices[cursor];
        for (let vertexIndex = 1; vertexIndex < count - 1; vertexIndex++) {
          triangles[writeOffset++] = first;
          triangles[writeOffset++] = sourceIndices[cursor + vertexIndex];
          triangles[writeOffset++] = sourceIndices[cursor + vertexIndex + 1];
        }
      }
      cursor += count;
      if (cursor >= sourceIndexLength) break;
    }
    return writeOffset === triangles.length ? triangles : triangles.subarray(0, writeOffset);
  }

  applyUsdMeshGeometry(prim) {
    const pointsValue = prim?.GetAttribute?.('points')?.Get?.();
    if (!pointsValue || typeof pointsValue.length !== 'number' || pointsValue.length === 0) return false;

    const positions = new Float32Array(pointsValue.length * 3);
    for (let index = 0; index < pointsValue.length; index++) {
      const point = pointsValue[index];
      const x = Number(point?.[0] ?? point?.x ?? 0);
      const y = Number(point?.[1] ?? point?.y ?? 0);
      const z = Number(point?.[2] ?? point?.z ?? 0);
      positions[index * 3 + 0] = Number.isFinite(x) ? x : 0;
      positions[index * 3 + 1] = Number.isFinite(y) ? y : 0;
      positions[index * 3 + 2] = Number.isFinite(z) ? z : 0;
    }

    const faceVertexIndices = prim.GetAttribute('faceVertexIndices')?.Get?.();
    const faceVertexCounts = prim.GetAttribute('faceVertexCounts')?.Get?.();
    const triangulatedIndices = this.toTriangleIndexArray(faceVertexIndices, faceVertexCounts);

    const nextGeometry = new BufferGeometry();
    nextGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    if (triangulatedIndices.length > 0) {
      nextGeometry.setIndex(triangulatedIndices);
    }
    nextGeometry.computeVertexNormals();
    nextGeometry.computeBoundingBox();
    nextGeometry.computeBoundingSphere();
    this.replaceGeometry(nextGeometry);
    return true;
  }

  getExtentDimensions(prim) {
    const extent = prim?.GetAttribute?.('extent')?.Get?.();
    if (!extent || extent.length < 2) return null;
    const minimum = extent[0];
    const maximum = extent[1];
    const width = Math.abs(Number(maximum?.[0] ?? 0) - Number(minimum?.[0] ?? 0));
    const height = Math.abs(Number(maximum?.[1] ?? 0) - Number(minimum?.[1] ?? 0));
    const depth = Math.abs(Number(maximum?.[2] ?? 0) - Number(minimum?.[2] ?? 0));
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth)) return null;
    return [Math.max(width, 1e-6), Math.max(height, 1e-6), Math.max(depth, 1e-6)];
  }

  applyUsdPrimitiveGeometry(prim, primType) {
    let generated = null;
    const normalizedType = String(primType || '').toLowerCase();
    const dimensionsFromExtent = this.getExtentDimensions(prim);

    if (normalizedType === 'cube') {
      const sizeAttribute = toFiniteNumber(prim.GetAttribute('size')?.Get?.());
      const extentMatchesSize = dimensionsFromExtent && sizeAttribute !== undefined
        ? nearlyEqual(dimensionsFromExtent[0], sizeAttribute) &&
          nearlyEqual(dimensionsFromExtent[1], sizeAttribute) &&
          nearlyEqual(dimensionsFromExtent[2], sizeAttribute)
        : false;

      const width = dimensionsFromExtent
        ? (sizeAttribute !== undefined && !extentMatchesSize ? sizeAttribute : dimensionsFromExtent[0])
        : (sizeAttribute ?? 1);
      const height = dimensionsFromExtent
        ? (sizeAttribute !== undefined && !extentMatchesSize ? sizeAttribute : dimensionsFromExtent[1])
        : (sizeAttribute ?? 1);
      const depth = dimensionsFromExtent
        ? (sizeAttribute !== undefined && !extentMatchesSize ? sizeAttribute : dimensionsFromExtent[2])
        : (sizeAttribute ?? 1);
      generated = new BoxGeometry(width, height, depth);
    } else if (normalizedType === 'sphere') {
      const radiusAttribute = toFiniteNumber(prim.GetAttribute('radius')?.Get?.());
      const radiusFromExtent = dimensionsFromExtent ? Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5 : undefined;
      const radius = radiusAttribute ?? radiusFromExtent ?? 0.5;
      generated = new SphereGeometry(
        Math.max(radius, 1e-6),
        PRIMITIVE_SEGMENTS.sphereWidth,
        PRIMITIVE_SEGMENTS.sphereHeight,
      );
    } else if (normalizedType === 'cylinder') {
      const radiusAttribute = toFiniteNumber(prim.GetAttribute('radius')?.Get?.());
      const heightAttribute = toFiniteNumber(prim.GetAttribute('height')?.Get?.());
      const axis = String(prim.GetAttribute('axis')?.Get?.() || 'Z').toUpperCase();
      let radiusFromExtent = undefined;
      let heightFromExtent = undefined;

      if (dimensionsFromExtent) {
        if (axis === 'X') {
          heightFromExtent = dimensionsFromExtent[0];
          radiusFromExtent = Math.max(dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5;
        } else if (axis === 'Y') {
          heightFromExtent = dimensionsFromExtent[1];
          radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[2]) * 0.5;
        } else {
          heightFromExtent = dimensionsFromExtent[2];
          radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1]) * 0.5;
        }
      }

      const radius = radiusAttribute ?? radiusFromExtent ?? 0.5;
      const height = heightAttribute ?? heightFromExtent ?? 1;
      generated = new CylinderGeometry(
        Math.max(radius, 1e-6),
        Math.max(radius, 1e-6),
        Math.max(height, 1e-6),
        PRIMITIVE_SEGMENTS.cylinderRadial,
        PRIMITIVE_SEGMENTS.cylinderHeight,
        false,
      );

      if (axis === 'X') {
        generated.rotateZ(-Math.PI / 2);
      } else if (axis === 'Z') {
        generated.rotateX(Math.PI / 2);
      }
    } else if (normalizedType === 'capsule') {
      const radiusAttribute = toFiniteNumber(prim.GetAttribute('radius')?.Get?.());
      const heightAttribute = toFiniteNumber(prim.GetAttribute('height')?.Get?.());
      const axis = String(prim.GetAttribute('axis')?.Get?.() || 'Z').toUpperCase();
      let radiusFromExtent = undefined;
      let totalHeightFromExtent = undefined;

      if (dimensionsFromExtent) {
        if (axis === 'X') {
          totalHeightFromExtent = dimensionsFromExtent[0];
          radiusFromExtent = Math.max(dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5;
        } else if (axis === 'Y') {
          totalHeightFromExtent = dimensionsFromExtent[1];
          radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[2]) * 0.5;
        } else {
          totalHeightFromExtent = dimensionsFromExtent[2];
          radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1]) * 0.5;
        }
      }

      const radius = Math.max(radiusAttribute ?? radiusFromExtent ?? 0.5, 1e-6);
      const totalHeight = Math.max(heightAttribute ?? totalHeightFromExtent ?? 1, 1e-6);
      const capsuleBodyHeight = Math.max(totalHeight - 2 * radius, 1e-6);
      generated = new CapsuleGeometry(
        radius,
        capsuleBodyHeight,
        PRIMITIVE_SEGMENTS.capsuleCap,
        PRIMITIVE_SEGMENTS.capsuleRadial,
      );

      if (axis === 'X') {
        generated.rotateZ(-Math.PI / 2);
      } else if (axis === 'Z') {
        generated.rotateX(Math.PI / 2);
      }
    }

    if (!generated) return false;
    generated.computeBoundingBox();
    generated.computeBoundingSphere();
    this.replaceGeometry(generated);
    return true;
  }

  applyCollisionGeometryFromOverrides() {
    if (!this._id) return false;
    const loweredId = this._id.toLowerCase();
    const isCollision = loweredId.includes('/collisions.') || loweredId.includes('/collisions/') || loweredId.includes('/collision.') || loweredId.includes('/collision/');
    if (!isCollision) return false;

    const driverOverride = this._interface?.getCollisionProtoOverride?.(this._id) || null;
    if (driverOverride && this.applyCollisionGeometryFromDriverOverride(driverOverride)) {
      this._primitiveFallbackType = null;
      this._hasGeneratedPrimitiveFallback = true;
      return true;
    }

    const primPath = this._interface.getCollisionOverridePrimPath(this._id);
    if (!primPath) return false;
    if (!this.applyResolvedPrimGeometryAndTransform(primPath)) return false;
    this._primitiveFallbackType = null;
    this._hasGeneratedPrimitiveFallback = true;
    return true;
  }

  applyVisualColorOverride() {
    if (!this._id || this._id.includes('/collisions.')) return;
    const override = this._interface.getVisualColorOverride(this._id);
    if (!override) return;

    const materials = Array.isArray(this._mesh.material) ? this._mesh.material : [this._mesh.material];
    for (const material of materials) {
      if (!material || !material.color || material.map) continue;
      material.color.setRGB(override[0], override[1], override[2]);
      material.needsUpdate = true;
    }
  }

  _nowMs() {
    return (typeof performance !== "undefined" && typeof performance.now === "function")
      ? performance.now()
      : Date.now();
  }

  _addGpuUploadSample(profile, durationMs) {
    if (!profile) return;
    profile.gpuUploadMs = (Number(profile.gpuUploadMs) || 0) + (Number(durationMs) || 0);
  }

  _isHeapBackedView(view, heapView) {
    return !!(view && ArrayBuffer.isView(view) && heapView && view.buffer === heapView.buffer);
  }

  _resolveWasmHeapViews() {
    const candidates = [
      globalThis?.Module,
      globalThis?.USD,
      globalThis?.USD_WASM_MODULE,
    ];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const heapF32 = candidate.HEAPF32;
      const heapU32 = candidate.HEAPU32;
      if ((heapF32 && Number(heapF32.length || 0) > 0) || (heapU32 && Number(heapU32.length || 0) > 0)) {
        return {
          moduleRef: candidate,
          heapF32: heapF32 || null,
          heapU32: heapU32 || null,
        };
      }
    }
    const fallback = candidates.find((candidate) => candidate && typeof candidate === 'object') || null;
    return {
      moduleRef: fallback,
      heapF32: fallback?.HEAPF32 || null,
      heapU32: fallback?.HEAPU32 || null,
    };
  }

  _toStableFloat32Array(data, expectedLength = null) {
    if (!data || typeof data.length !== 'number') return null;
    const rawLength = Number(data.length);
    if (!Number.isFinite(rawLength) || rawLength <= 0) return null;
    const normalizedLength = Number.isFinite(Number(expectedLength)) && Number(expectedLength) >= 0
      ? Math.min(Math.floor(Number(expectedLength)), Math.floor(rawLength))
      : Math.floor(rawLength);
    if (normalizedLength <= 0) return null;

    const heapF32 = this._resolveWasmHeapViews().heapF32;
    if (data instanceof Float32Array) {
      const view = normalizedLength === data.length ? data : data.subarray(0, normalizedLength);
      if (!this._isHeapBackedView(view, heapF32)) return view;
      return view.slice(0);
    }

    if (ArrayBuffer.isView(data)) {
      const source = typeof data.subarray === 'function'
        ? data.subarray(0, normalizedLength)
        : data;
      const copied = new Float32Array(normalizedLength);
      copied.set(source);
      return copied;
    }

    if (Array.isArray(data)) {
      return Float32Array.from(data.slice(0, normalizedLength));
    }

    return null;
  }

  _toStableUint32Array(data, expectedLength = null) {
    if (!data || typeof data.length !== 'number') return null;
    const rawLength = Number(data.length);
    if (!Number.isFinite(rawLength) || rawLength <= 0) return null;
    const normalizedLength = Number.isFinite(Number(expectedLength)) && Number(expectedLength) >= 0
      ? Math.min(Math.floor(Number(expectedLength)), Math.floor(rawLength))
      : Math.floor(rawLength);
    if (normalizedLength <= 0) return null;

    const heapU32 = this._resolveWasmHeapViews().heapU32;
    if (data instanceof Uint32Array) {
      const view = normalizedLength === data.length ? data : data.subarray(0, normalizedLength);
      if (!this._isHeapBackedView(view, heapU32)) return view;
      return view.slice(0);
    }

    if (ArrayBuffer.isView(data)) {
      const source = typeof data.subarray === 'function'
        ? data.subarray(0, normalizedLength)
        : data;
      const copied = new Uint32Array(normalizedLength);
      copied.set(source);
      return copied;
    }

    if (Array.isArray(data)) {
      return Uint32Array.from(data.slice(0, normalizedLength));
    }

    return null;
  }

  _setMatrixFromRowMajorSource(matrixLike) {
    if (!matrixLike) return false;
    let source = null;
    if (Array.isArray(matrixLike) || ArrayBuffer.isView(matrixLike) || typeof matrixLike.length === 'number') {
      source = matrixLike;
    } else if (typeof matrixLike[Symbol.iterator] === 'function') {
      const materialized = new Float64Array(16);
      let index = 0;
      for (const value of matrixLike) {
        if (index >= 16) break;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return false;
        materialized[index] = numeric;
        index += 1;
      }
      if (index < 16) return false;
      source = materialized;
    } else {
      return false;
    }

    if (!source || Number(source.length) < 16) return false;
    const m00 = Number(source[0]); const m01 = Number(source[1]); const m02 = Number(source[2]); const m03 = Number(source[3]);
    const m10 = Number(source[4]); const m11 = Number(source[5]); const m12 = Number(source[6]); const m13 = Number(source[7]);
    const m20 = Number(source[8]); const m21 = Number(source[9]); const m22 = Number(source[10]); const m23 = Number(source[11]);
    const m30 = Number(source[12]); const m31 = Number(source[13]); const m32 = Number(source[14]); const m33 = Number(source[15]);
    if (
      !Number.isFinite(m00) || !Number.isFinite(m01) || !Number.isFinite(m02) || !Number.isFinite(m03)
      || !Number.isFinite(m10) || !Number.isFinite(m11) || !Number.isFinite(m12) || !Number.isFinite(m13)
      || !Number.isFinite(m20) || !Number.isFinite(m21) || !Number.isFinite(m22) || !Number.isFinite(m23)
      || !Number.isFinite(m30) || !Number.isFinite(m31) || !Number.isFinite(m32) || !Number.isFinite(m33)
    ) {
      return false;
    }
    this._mesh.matrix.set(
      m00, m01, m02, m03,
      m10, m11, m12, m13,
      m20, m21, m22, m23,
      m30, m31, m32, m33,
    );
    this._mesh.matrix.transpose();
    return true;
  }

  _buildGeomSubsetSignature(sections) {
    if (!Array.isArray(sections) || sections.length === 0) return '';
    if (sections.length > 2048) return `sections:${sections.length}`;

    const signatureParts = new Array(sections.length);
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index];
      if (!section) {
        signatureParts[index] = '#';
        continue;
      }
      const start = Number(section.start);
      const length = Number(section.length);
      const materialId = normalizeHydraPath(section.materialId);
      signatureParts[index] = `${Number.isFinite(start) ? start : 'n'}:${Number.isFinite(length) ? length : 'n'}:${materialId}`;
    }
    return signatureParts.join('|');
  }

  reorderIndexedAttributes(profile = null, phase = "unknown") {
    if (!this._indices) return;
    const reorderStart = this._nowMs();
    this.updateOrder(this._points, 'position', 3, profile, phase);
    this.updateOrder(this._normals, 'normal', 3, profile, phase);
    if (this._colors) {
      this.updateOrder(this._colors, 'color', 3, profile, phase);
    }
    if (this._uvs) {
      this.updateOrder(this._uvs, 'uv', 2, profile, phase);
      this._geometry.attributes.uv2 = this._geometry.attributes.uv;
    }
    const reorderEnd = this._nowMs();
    const reorderMs = reorderEnd - reorderStart;
    if (profile) {
      if (phase === "indices") {
        profile.indicesReorderMs = (Number(profile.indicesReorderMs) || 0) + reorderMs;
      } else if (phase === "points") {
        profile.pointsReorderMs = (Number(profile.pointsReorderMs) || 0) + reorderMs;
      } else {
        profile.deferredReorderMs = (Number(profile.deferredReorderMs) || 0) + reorderMs;
      }
    }
    this._needsNormalFallback = true;
  }

  updateOrder(attribute, attributeName, dimension = 3, profile = null, phase = "unknown", options = null) {
    if (!attribute || !this._indices) return;

    const loopStart = this._nowMs();
    const indices = this._indices;
    const indexCount = indices.length >>> 0;
    if (indexCount <= 0) return;

    const targetLength = indexCount * dimension;
    let reusableAttribute = null;
    let values = null;
    if (options?.reuse !== false) {
      const existingAttribute = this._geometry.getAttribute(attributeName);
      if (
        existingAttribute
        && existingAttribute.itemSize === dimension
        && existingAttribute.array instanceof Float32Array
        && existingAttribute.array.length === targetLength
      ) {
        reusableAttribute = existingAttribute;
        values = existingAttribute.array;
        values.fill(0);
      }
    }
    if (!values) {
      values = new Float32Array(targetLength);
    }

    const attributeLength = attribute.length >>> 0;
    const useTypedArrayFastPath = attribute instanceof Float32Array && indices instanceof Uint32Array;
    if (useTypedArrayFastPath && dimension === 3) {
      for (let i = 0; i < indexCount; i++) {
        const sourceBase = indices[i] * 3;
        const targetBase = i * 3;
        if ((sourceBase + 2) >= attributeLength) continue;
        values[targetBase + 0] = attribute[sourceBase + 0];
        values[targetBase + 1] = attribute[sourceBase + 1];
        values[targetBase + 2] = attribute[sourceBase + 2];
      }
    } else if (useTypedArrayFastPath && dimension === 2) {
      for (let i = 0; i < indexCount; i++) {
        const sourceBase = indices[i] * 2;
        const targetBase = i * 2;
        if ((sourceBase + 1) >= attributeLength) continue;
        values[targetBase + 0] = attribute[sourceBase + 0];
        values[targetBase + 1] = attribute[sourceBase + 1];
      }
    } else {
      for (let i = 0; i < indexCount; i++) {
        const sourceBase = indices[i] * dimension;
        const targetBase = i * dimension;
        if ((sourceBase + dimension) > attributeLength) continue;
        for (let j = 0; j < dimension; ++j) {
          values[targetBase + j] = attribute[sourceBase + j];
        }
      }
    }
    const loopEnd = this._nowMs();
    if (profile) {
      const loopMs = loopEnd - loopStart;
      if (phase === "indices") profile.indicesLoopMs = (Number(profile.indicesLoopMs) || 0) + loopMs;
      if (phase === "points") profile.pointsLoopMs = (Number(profile.pointsLoopMs) || 0) + loopMs;
      if (phase === "primvars") profile.primvarLoopMs = (Number(profile.primvarLoopMs) || 0) + loopMs;
      if (phase === "deferred") {
        profile.indicesLoopMs = (Number(profile.indicesLoopMs) || 0) + loopMs;
        profile.pointsLoopMs = (Number(profile.pointsLoopMs) || 0) + loopMs;
      }
    }

    const uploadStart = this._nowMs();
    if (reusableAttribute) {
      reusableAttribute.needsUpdate = true;
    } else {
      this._geometry.setAttribute(attributeName, new Float32BufferAttribute(values, dimension));
    }
    const uploadEnd = this._nowMs();
    this._addGpuUploadSample(profile, uploadEnd - uploadStart);
  }

  updateIndices(indices, profile = null, options = null) {
    if (!indices || typeof indices.length !== "number") return;

    const deferReorder = options?.deferReorder === true;
    const totalStart = this._nowMs();
    if (profile) {
      profile.indicesForLoopUsed = true;
      const heapU32 = this._resolveWasmHeapViews().heapU32;
      profile.indicesFromHeapU32 = !!(ArrayBuffer.isView(indices) && heapU32 && indices.buffer === heapU32.buffer);
    }

    const copyStart = this._nowMs();
    const indexCount = indices.length >>> 0;
    const copied = this._toStableUint32Array(indices, indexCount);
    if (!copied) return;
    const copyEnd = this._nowMs();
    if (copied.length > 0) {
      this._hasHydraGeometryPayload = true;
    }
    if (profile) {
      profile.indicesCopyMs = (Number(profile.indicesCopyMs) || 0) + (copyEnd - copyStart);
    }

    this._indices = copied;

    if (!deferReorder) {
      this.reorderIndexedAttributes(profile, "indices");
    }
    if (profile) {
      profile.indicesTotalMs = (Number(profile.indicesTotalMs) || 0) + (this._nowMs() - totalStart);
    }
  }

  /**
   * Sets the transform of the mesh.
   * @param {Iterable<number>} matrix - The 4x4 matrix to set on the mesh.
   */
  setTransform(matrix) {
    if (!matrix) return;
    const canIndexMatrix = Array.isArray(matrix)
      || ArrayBuffer.isView(matrix)
      || typeof matrix.length === "number"
      || typeof matrix[Symbol.iterator] === "function";
    if (!canIndexMatrix) return;

    const interfaceRef = this._interface;
    const hasSyncHotPathGuard = !!interfaceRef
      && typeof interfaceRef.enterHydraSyncHotPath === "function"
      && typeof interfaceRef.leaveHydraSyncHotPath === "function";
    if (hasSyncHotPathGuard) {
      interfaceRef.enterHydraSyncHotPath();
    }

    try {
      this._hasEverReceivedTransform = true;
      if (!this._setMatrixFromRowMajorSource(matrix)) {
        return;
      }

      if (this._id.includes(".proto_")) {
        if (this.isCollisionProtoMesh()) {
          const resolvedPrimPath = this._interface.getResolvedPrimPathForMeshId(this._id);
          let geometryApplied = this._appliedCollisionOverride === true;
          if (!geometryApplied) {
            geometryApplied = this.applyCollisionGeometryFromOverrides() === true;
          }
          if (resolvedPrimPath && !geometryApplied) {
            geometryApplied = this.applyResolvedPrimGeometryAndTransform(resolvedPrimPath) === true;
          }
          this.syncCollisionRotationFromVisualLink();
          // Keep sync pending until collision override geometry is actually resolved.
          this._hasCompletedProtoSync = geometryApplied;
          this._mesh.matrixAutoUpdate = false;
          return;
        } else if (this.isVisualProtoMesh()) {
          const urdfVisualWorldTransform = this._interface.getVisualWorldTransformFromUrdfTruth(this._id);
          if (urdfVisualWorldTransform) {
            this._mesh.matrix.copy(urdfVisualWorldTransform);
            this._hasCompletedProtoSync = true;
            this._mesh.matrixAutoUpdate = false;
            return;
          }
        }
        this.applyProtoStageSync();
      }

      this._mesh.matrixAutoUpdate = false;
    } finally {
      if (typeof interfaceRef?.updateRepresentativeVisualTransformIndex === 'function') {
        interfaceRef.updateRepresentativeVisualTransformIndex(this._id, this._mesh.matrix);
      }
      if (hasSyncHotPathGuard) {
        interfaceRef.leaveHydraSyncHotPath();
      }
    }
  }

  /**
   * Sets automatically generated normals on the mesh. Should only be used if there are no authored normals.
   * @param {} normals 
   */
  updateNormals(normals, profile = null) {
    // don't apply automatically generated normals if there are already authored normals.
    if (this._geometry.hasAttribute('normal')) return;
    if (!normals || typeof normals.length !== 'number') return;

    const copyStart = this._nowMs();
    this._normals = this._toStableFloat32Array(normals);
    if (!this._normals) return;
    const copyEnd = this._nowMs();
    if (profile) {
      profile.primvarCopyMs = (Number(profile.primvarCopyMs) || 0) + (copyEnd - copyStart);
    }
    this.updateOrder(this._normals, 'normal', 3, profile, "primvars");
    this._needsNormalFallback = false;
  }

  setNormals(data, interpolation, profile = null) {
    if (!data) return;
    if (interpolation === 'facevarying') {
      // The UV buffer has already been prepared on the C++ side, so we just set it
      const stable = this._toStableFloat32Array(data);
      if (!stable) return;
      const uploadStart = this._nowMs();
      this._geometry.setAttribute('normal', new Float32BufferAttribute(stable, 3));
      const uploadEnd = this._nowMs();
      this._addGpuUploadSample(profile, uploadEnd - uploadStart);
      this._needsNormalFallback = false;
    } else if (interpolation === 'vertex') {
      // We have per-vertex UVs, so we need to sort them accordingly
      const copyStart = this._nowMs();
      this._normals = this._toStableFloat32Array(data);
      if (!this._normals) return;
      const copyEnd = this._nowMs();
      if (profile) {
        profile.primvarCopyMs = (Number(profile.primvarCopyMs) || 0) + (copyEnd - copyStart);
      }
      this.updateOrder(this._normals, 'normal', 3, profile, "primvars");
      this._needsNormalFallback = false;
    }
  }

  // This is always called before prims are updated
  setMaterial(materialId) {
    materialId = normalizeHydraPath(materialId);
    const resolvedMaterialId = this._interface.resolveMaterialIdForMesh(materialId, this._id) || materialId;
    this._pendingMaterialId = resolvedMaterialId;
    const proto = parseProtoMeshIdentifier(this._id);
    const linkPath = proto?.sectionName === 'visuals' ? proto.linkPath : null;

    const resolvedMaterial = this._interface.materials[resolvedMaterialId]
      || this._interface.getOrCreateMaterialById(resolvedMaterialId, this._id)
      || (resolvedMaterialId !== materialId ? this._interface.getOrCreateMaterialById(materialId, this._id) : null);

    if (resolvedMaterial?._material) {
      this._mesh.material = resolvedMaterial._material;
      this._pendingMaterialId = undefined;
    }
    else {
      const warningKey = `${materialId}=>${resolvedMaterialId}`;
      if (!warnedMissingMaterials.has(warningKey)) {
        warnedMissingMaterials.add(warningKey);
      }
      if (this._materials.length > 0) {
        this._mesh.material = this._materials[0];
      }
      else if (getDefaultMaterial()) {
        this._mesh.material = getDefaultMaterial();
      }
    }

    if (linkPath) {
      this._interface._preferredVisualMaterialByLinkCache?.delete?.(linkPath);
    }
  }

  setGeomSubsetMaterial(sections, profile = null) {
    const subsetsTotalStart = this._nowMs();
    if (!Array.isArray(sections) || sections.length === 0) {
      this._lastGeomSubsetSignature = '';
      if (profile) {
        profile.subsetCount = 0;
      }
      return;
    }
    const subsetSignature = this._buildGeomSubsetSignature(sections);
    if (subsetSignature && subsetSignature === this._lastGeomSubsetSignature) {
      if (profile) {
        profile.subsetCount = Number(sections.length) || 0;
        profile.subsetsTotalMs = (Number(profile.subsetsTotalMs) || 0) + (this._nowMs() - subsetsTotalStart);
      }
      return;
    }
    if (profile) {
      profile.subsetCount = Number(sections.length) || 0;
    }

    //console.log("setting subset material: ", this._id, sections)
    const previousMaterial = Array.isArray(this._mesh.material) ? this._mesh.material.find(Boolean) : this._mesh.material;
    const fallbackMaterial = previousMaterial || this._materials.find(Boolean) || getDefaultMaterial() || new MeshPhysicalMaterial({
      side: DoubleSide,
      color: new Color(0xB4B4B4),
    });

    this._geometry.clearGroups();
    const nextMaterials = [];
    const subsetsLoopStart = this._nowMs();

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (!section) continue;

      const start = Number(section.start);
      const length = Number(section.length);
      if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) continue;

      const sectionMaterialId = normalizeHydraPath(section.materialId);
      let sectionMaterial = this._interface.getOrCreateMaterialById(sectionMaterialId, this._id)?._material || this._interface.materials[sectionMaterialId]?._material;
      if (!sectionMaterial) {
        sectionMaterial = fallbackMaterial;
      }

      let materialIndex = nextMaterials.indexOf(sectionMaterial);
      if (materialIndex < 0) {
        materialIndex = nextMaterials.length;
        nextMaterials.push(sectionMaterial);
      }

      this._geometry.addGroup(start, length, materialIndex);
    }
    const subsetsLoopEnd = this._nowMs();
    if (profile) {
      profile.subsetsLoopMs = (Number(profile.subsetsLoopMs) || 0) + (subsetsLoopEnd - subsetsLoopStart);
    }

    let meshMaterial = fallbackMaterial;
    if (nextMaterials.length === 1) {
      meshMaterial = nextMaterials[0];
    } else if (nextMaterials.length > 1) {
      meshMaterial = nextMaterials;
    }

    const meshCreateStart = this._nowMs();
    this._mesh.material = meshMaterial;
    this._mesh.geometry = this._geometry;
    const meshCreateEnd = this._nowMs();
    if (profile) {
      profile.meshCreateMs = (Number(profile.meshCreateMs) || 0) + (meshCreateEnd - meshCreateStart);
    }

    this._materials = Array.isArray(meshMaterial) ? meshMaterial : [meshMaterial];
    this._lastGeomSubsetSignature = subsetSignature;
    const proto = parseProtoMeshIdentifier(this._id);
    if (proto?.sectionName === 'visuals' && proto.linkPath) {
      this._interface._preferredVisualMaterialByLinkCache?.delete?.(proto.linkPath);
    }
    const subsetsTotalEnd = this._nowMs();
    if (profile) {
      profile.subsetsTotalMs = (Number(profile.subsetsTotalMs) || 0) + (subsetsTotalEnd - subsetsTotalStart);
    }
  }

  setDisplayColor(data, interpolation) {
    if (disableMaterials) return;

    let wasDefaultMaterial = false;
    if (this._mesh.material === getDefaultMaterial()) {
      this._mesh.material = this._mesh.material.clone();
      wasDefaultMaterial = true;
    }

    this._colors = null;

    if (interpolation === 'constant') {
      this._mesh.material.color = new Color().fromArray(data);
    } else if (interpolation === 'vertex') {
      // Per-vertex buffer attribute
      this._mesh.material.vertexColors = true;
      if (wasDefaultMaterial) {
        // Reset the pink debugging color
        this._mesh.material.color = new Color(0xffffff);
      }
      this._colors = this._toStableFloat32Array(data);
      if (!this._colors) return;
      this.updateOrder(this._colors, 'color');
    } else {
      if (warningMessagesToCount.has(interpolation)) {
        warningMessagesToCount.set(interpolation, warningMessagesToCount.get(interpolation) + 1);
      }
      else {
        warningMessagesToCount.set(interpolation, 1);
      }
    }
  }

  setUV(data, dimension, interpolation, profile = null) {
    // TODO: Support multiple UVs. For now, we simply set uv = uv2, which is required when a material has an aoMap.
    this._uvs = null;

    if (interpolation === 'facevarying') {
      // The UV buffer has already been prepared on the C++ side, so we just set it
      const stable = this._toStableFloat32Array(data);
      if (!stable) return;
      const uploadStart = this._nowMs();
      this._geometry.setAttribute('uv', new Float32BufferAttribute(stable, dimension));
      const uploadEnd = this._nowMs();
      this._addGpuUploadSample(profile, uploadEnd - uploadStart);
    } else if (interpolation === 'vertex') {
      // We have per-vertex UVs, so we need to sort them accordingly
      const copyStart = this._nowMs();
      this._uvs = this._toStableFloat32Array(data);
      if (!this._uvs) return;
      const copyEnd = this._nowMs();
      if (profile) {
        profile.primvarCopyMs = (Number(profile.primvarCopyMs) || 0) + (copyEnd - copyStart);
      }
      this.updateOrder(this._uvs, 'uv', 2, profile, "primvars");
    }

    if (this._geometry.hasAttribute('uv'))
      this._geometry.attributes.uv2 = this._geometry.attributes.uv;
  }

  updatePrimvar(name, data, dimension, interpolation, profile = null) {
    if (!name) return;

    if (name === 'points') { // || name === 'normals') {
      // Points and normals are set separately
      return;
    }

    // TODO: Support multiple UVs. For now, we simply set uv = uv2, which is required when a material has an aoMap.
    if (name.startsWith('st')) {
      name = 'uv';
    }

    switch (name) {
      case 'displayColor':
        this.setDisplayColor(data, interpolation);
        break;
      case 'uv':
      case "UVMap":
      case "uvmap":
      case "uv0":
      case "UVW":
      case "uvw":
      case "map1":
        this.setUV(data, dimension, interpolation, profile);
        break;
      case "normals":
        this.setNormals(data, interpolation, profile);
        break;
      default:
        if (warningMessagesToCount.has(name)) {
          warningMessagesToCount.set(name, warningMessagesToCount.get(name) + 1);
        }
        else {
          warningMessagesToCount.set(name, 1);
        }
    }
  }

  updatePoints(points, profile = null, options = null) {
    if (!points || typeof points.length !== 'number') return;
    const deferReorder = options?.deferReorder === true;
    const totalStart = this._nowMs();
    if (profile) {
      const heapF32 = this._resolveWasmHeapViews().heapF32;
      profile.pointsFromHeapF32 = !!(ArrayBuffer.isView(points) && heapF32 && points.buffer === heapF32.buffer);
      // We currently do no explicit Y-up/Z-up conversion here; keep this metric to verify.
      profile.pointsAxisTransformMs = (Number(profile.pointsAxisTransformMs) || 0);
      profile.pointsAxisTransformLoopUsed = false;
    }

    const copyStart = this._nowMs();
    const pointCount = points.length >>> 0;
    this._points = this._toStableFloat32Array(points, pointCount);
    if (!this._points) return;
    const copyEnd = this._nowMs();
    if (this._points && Number(this._points.length || 0) > 0) {
      this._hasHydraGeometryPayload = true;
    }
    if (profile) {
      profile.pointsCopyMs = (Number(profile.pointsCopyMs) || 0) + (copyEnd - copyStart);
    }

    if (!deferReorder) {
      this.reorderIndexedAttributes(profile, "points");
    }
    if (profile) {
      profile.pointsTotalMs = (Number(profile.pointsTotalMs) || 0) + (this._nowMs() - totalStart);
    }
  }

  ensureFallbackNormalsIfMissing() {
    if (!this._needsNormalFallback) return;
    if (!this._id || !/\/visuals\.|\/visuals\//i.test(this._id)) {
      this._needsNormalFallback = false;
      return;
    }
    const geometry = this._geometry;
    if (!geometry) {
      this._needsNormalFallback = false;
      return;
    }
    const position = geometry.getAttribute?.('position');
    if (!position || position.count <= 0) return;
    const existingNormals = geometry.getAttribute?.('normal');
    if (existingNormals && existingNormals.count > 0) {
      this._needsNormalFallback = false;
      return;
    }
    try {
      geometry.computeVertexNormals?.();
    } catch {}
    // If geometry is refreshed later, updatePoints/updateIndices will re-arm this flag.
    this._needsNormalFallback = false;
  }

  applyUpdates(updates) {
    if (!updates || typeof updates !== 'object') return;

    const phaseInstrumentationEnabled = this._interface?.isHydraPhaseInstrumentationEnabled?.() === true;
    const shouldCollectProfile = shouldProfileHydraSync() || phaseInstrumentationEnabled;
    const t0 = this._nowMs();
    const profile = shouldCollectProfile ? {
      gpuUploadMs: 0,
      indicesCopyMs: 0,
      indicesLoopMs: 0,
      indicesReorderMs: 0,
      indicesTotalMs: 0,
      indicesForLoopUsed: false,
      indicesFromHeapU32: false,
      pointsCopyMs: 0,
      pointsLoopMs: 0,
      pointsReorderMs: 0,
      pointsAxisTransformMs: 0,
      pointsAxisTransformLoopUsed: false,
      pointsTotalMs: 0,
      pointsFromHeapF32: false,
      primvarLoopMs: 0,
      primvarCopyMs: 0,
      subsetCount: 0,
      subsetsLoopMs: 0,
      subsetsTotalMs: 0,
      deferredReorderMs: 0,
      meshCreateMs: 0,
      visibilityOps: 0,
      loggingMs: 0,
    } : null;

    const materialId = (typeof updates.materialId === 'string' && updates.materialId.length > 0)
      ? updates.materialId
      : null;
    const geomSubsetSections = Array.isArray(updates.geomSubsetSections) ? updates.geomSubsetSections : [];
    const preferProtoPayload = this._id.includes(".proto_")
      && this._interface?.enableProtoBlobFastPath === true
      && this._interface?.preferProtoBlobOverHydraPayload === true;
    const points = !preferProtoPayload && (updates.points && typeof updates.points.length === 'number')
      ? updates.points
      : null;
    const indices = !preferProtoPayload && (updates.indices && typeof updates.indices.length === 'number')
      ? updates.indices
      : null;
    const primvars = !preferProtoPayload && Array.isArray(updates.primvars)
      ? updates.primvars
      : [];
    const normals = !preferProtoPayload && (updates.normals && typeof updates.normals.slice === 'function')
      ? updates.normals
      : null;
    const transform = (updates.transform && typeof updates.transform[Symbol.iterator] === 'function')
      ? updates.transform
      : null;
    const deferGeometryReorder = !!indices && !!points;
    const t1 = this._nowMs();

    if (materialId) {
      this.setMaterial(materialId);
    }

    if (geomSubsetSections.length > 0) {
      this.setGeomSubsetMaterial(geomSubsetSections, profile);
    }

    if (indices) {
      this.updateIndices(indices, profile, { deferReorder: deferGeometryReorder });
    }
    if (points) {
      this.updatePoints(points, profile, { deferReorder: deferGeometryReorder });
    }
    for (const primvar of primvars) {
      if (!primvar) continue;
      const name = primvar.name;
      const data = primvar.data;
      const dimension = Number(primvar.dimension);
      const interpolation = primvar.interpolation;
      if (!name || !data || !Number.isFinite(dimension) || dimension <= 0) continue;
      this.updatePrimvar(name, data, dimension, interpolation, profile);
    }

    if (normals) {
      this.updateNormals(normals, profile);
    }
    if (deferGeometryReorder) {
      this.reorderIndexedAttributes(profile, "deferred");
    }
    if (transform) {
      this.setTransform(transform);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "visible")) {
      if (profile) profile.visibilityOps += 1;
      if (typeof (this as any).setVisible === "function") {
        (this as any).setVisible((updates as any).visible);
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "doubleSided")) {
      if (profile) profile.visibilityOps += 1;
      if (typeof (this as any).setDoubleSided === "function") {
        (this as any).setDoubleSided((updates as any).doubleSided);
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "cullStyle")) {
      if (profile) profile.visibilityOps += 1;
      if (typeof (this as any).setCullStyle === "function") {
        (this as any).setCullStyle((updates as any).cullStyle);
      }
    }
    if (profile) {
      profile.loggingMs = 0;
    }

    const unpackMs = t1 - t0;

    if (phaseInstrumentationEnabled && profile) {
      // "WASM Stage": time spent reading/copying topology/points/primvars payloads from
      // Hydra callback data into JS-owned arrays.
      const wasmFetchMs = Math.max(
        0,
        unpackMs
        + Number(profile.indicesCopyMs || 0)
        + Number(profile.pointsCopyMs || 0)
        + Number(profile.primvarCopyMs || 0),
      );
      // "Three.js Build": time spent building Three-side data structures
      // (BufferAttribute uploads and mesh recreation for geomSubsets).
      const threeBuildMs = Math.max(
        0,
        Number(profile.gpuUploadMs || 0)
        + Number(profile.meshCreateMs || 0),
      );
      this._interface?.recordHydraWasmFetchPhase?.(wasmFetchMs, this._id);
      this._interface?.recordHydraThreeBuildPhase?.(threeBuildMs, this._id);
    }
  }

  commit(profileAccumulator = null) {
    const trackStep = (fieldName, durationMs) => {
      if (!profileAccumulator || typeof profileAccumulator !== 'object') return;
      const safe = Number.isFinite(Number(durationMs)) ? Math.max(0, Number(durationMs)) : 0;
      profileAccumulator[fieldName] = Number(profileAccumulator[fieldName] || 0) + safe;
    };
    const commitStart = this._nowMs();
    if (this._pendingMaterialId && this._interface.materials[this._pendingMaterialId]?._material) {
      const materialStart = this._nowMs();
      this._mesh.material = this._interface.materials[this._pendingMaterialId]._material;
      this._pendingMaterialId = undefined;
      trackStep('pendingMaterialMs', this._nowMs() - materialStart);
    }

    const primitiveFallbackStart = this._nowMs();
    this.ensurePrimitiveFallbackGeometry();
    trackStep('primitiveFallbackMs', this._nowMs() - primitiveFallbackStart);

    const normalFallbackStart = this._nowMs();
    this.ensureFallbackNormalsIfMissing();
    trackStep('normalFallbackMs', this._nowMs() - normalFallbackStart);

    const visualColorStart = this._nowMs();
    this.applyVisualColorOverride();
    trackStep('visualColorMs', this._nowMs() - visualColorStart);

    const inheritMaterialStart = this._nowMs();
    this.tryInheritVisualMaterialFromLink();
    trackStep('inheritMaterialMs', this._nowMs() - inheritMaterialStart);

    if (!this._id.includes(".proto_")) {
      trackStep('meshTotalMs', this._nowMs() - commitStart);
      trackStep('meshCount', 1);
      return;
    }
    if (this._hasCompletedProtoSync) {
      trackStep('meshTotalMs', this._nowMs() - commitStart);
      trackStep('meshCount', 1);
      return;
    }
    const protoSyncStart = this._nowMs();
    this.applyProtoStageSync();
    trackStep('protoSyncMs', this._nowMs() - protoSyncStart);
    trackStep('meshTotalMs', this._nowMs() - commitStart);
    trackStep('meshCount', 1);
  }

  tryApplyProtoDataBlobFastPath(options = {}) {
    const phaseInstrumentationEnabled = this._interface?.isHydraPhaseInstrumentationEnabled?.() === true;
    const forceRefresh = options?.forceRefresh === true;
    const allowForceRefreshRetry = options?.allowForceRefreshRetry !== false;
    let wasmFetchMs = 0;
    let threeBuildMs = 0;
    const measureWasmStage = (fn) => {
      const startedAt = this._nowMs();
      const result = fn();
      const endedAt = this._nowMs();
      wasmFetchMs += Math.max(0, endedAt - startedAt);
      return result;
    };
    const measureThreeBuildStage = (fn) => {
      const startedAt = this._nowMs();
      const result = fn();
      const endedAt = this._nowMs();
      threeBuildMs += Math.max(0, endedAt - startedAt);
      return result;
    };

    try {
    const blob = this._interface?.getProtoDataBlob?.(this._id, { forceRefresh });
    if ((!blob || blob.valid !== true) && allowForceRefreshRetry && !forceRefresh) {
      return this.tryApplyProtoDataBlobFastPath({
        forceRefresh: true,
        allowForceRefreshRetry: false,
      });
    }
    if (!blob || blob.valid !== true) return false;

    const heapViews = this._resolveWasmHeapViews();
    const moduleRef = heapViews?.moduleRef || null;
    const heapF32 = heapViews?.heapF32 || null;
    const heapU32 = heapViews?.heapU32 || null;
    const normalizeLength = (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return 0;
      return Math.floor(parsed);
    };
    const normalizePtr = (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return 0;
      const floored = Math.floor(parsed);
      if ((floored % 4) !== 0) return 0;
      return floored;
    };
    const getHeapFloat32View = (ptr, valueCount) => {
      const normalizedPtr = normalizePtr(ptr);
      const normalizedCount = normalizeLength(valueCount);
      if (!normalizedPtr || !normalizedCount || !heapF32 || typeof heapF32.subarray !== 'function') return null;
      const start = normalizedPtr >>> 2;
      const end = start + normalizedCount;
      if (end > heapF32.length) return null;
      return heapF32.subarray(start, end);
    };
    const getHeapUint32View = (ptr, valueCount) => {
      const normalizedPtr = normalizePtr(ptr);
      const normalizedCount = normalizeLength(valueCount);
      if (!normalizedPtr || !normalizedCount || !heapU32 || typeof heapU32.subarray !== 'function') return null;
      const start = normalizedPtr >>> 2;
      const end = start + normalizedCount;
      if (end > heapU32.length) return null;
      return heapU32.subarray(start, end);
    };
    const isHeapBackedView = (view, heapView) => {
      return !!(view && ArrayBuffer.isView(view) && heapView && view.buffer === heapView.buffer);
    };
    const resolveFloatSource = (ptr, valueCount, fallback) => {
      const fromHeap = getHeapFloat32View(ptr, valueCount);
      if (fromHeap) return fromHeap;
      if (!fallback || typeof fallback.length !== 'number') return null;
      // Large non-typed ArrayLike payloads usually mean embind proxy objects,
      // where indexed reads cross the JS<->WASM boundary per element.
      if (!ArrayBuffer.isView(fallback) && normalizeLength(valueCount) > 2048) return null;
      return fallback;
    };
    const resolveUintSource = (ptr, valueCount, fallback) => {
      const fromHeap = getHeapUint32View(ptr, valueCount);
      if (fromHeap) return fromHeap;
      if (!fallback || typeof fallback.length !== 'number') return null;
      if (!ArrayBuffer.isView(fallback) && normalizeLength(valueCount) > 2048) return null;
      return fallback;
    };
    const copyFloat32Payload = (source, expectedLength) => {
      const normalizedLength = normalizeLength(expectedLength);
      if (!source || !normalizedLength || Number(source.length) < normalizedLength) return null;
      if (source instanceof Float32Array) {
        const sampled = source.subarray(0, normalizedLength);
        if (!isHeapBackedView(sampled, heapF32)) return sampled;
        return sampled.slice();
      }
      if (ArrayBuffer.isView(source) && typeof source.subarray === 'function') {
        const sampled = source.subarray(0, normalizedLength);
        if (sampled instanceof Float32Array && !isHeapBackedView(sampled, heapF32)) return sampled;
        const copied = new Float32Array(normalizedLength);
        copied.set(sampled);
        return copied;
      }

      const copied = new Float32Array(normalizedLength);
      for (let index = 0; index < normalizedLength; index++) {
        copied[index] = source[index];
      }
      return copied;
    };
    const copyUint32Payload = (source, expectedLength) => {
      const normalizedLength = normalizeLength(expectedLength);
      if (!source || !normalizedLength || Number(source.length) < normalizedLength) return null;
      if (source instanceof Uint32Array) {
        const sampled = source.subarray(0, normalizedLength);
        if (!isHeapBackedView(sampled, heapU32)) return sampled;
        return sampled.slice();
      }
      if (ArrayBuffer.isView(source) && typeof source.subarray === 'function') {
        const sampled = source.subarray(0, normalizedLength);
        if (sampled instanceof Uint32Array && !isHeapBackedView(sampled, heapU32)) return sampled;
        const copied = new Uint32Array(normalizedLength);
        copied.set(sampled);
        return copied;
      }

      const copied = new Uint32Array(normalizedLength);
      for (let index = 0; index < normalizedLength; index++) {
        copied[index] = source[index];
      }
      return copied;
    };

    // Single-shot path: resolve matrix from direct heap pointer first.
    // Fallback to blob.transform only when pointer-based view is unavailable.
    const transformSource = resolveFloatSource(
      blob.transformPtr,
      16,
      (blob.transform && typeof blob.transform.length === 'number') ? blob.transform : null,
    );
    if (!transformSource || Number(transformSource.length) < 16) return false;

    measureThreeBuildStage(() => {
      this._mesh.matrix.set(
        transformSource[0], transformSource[1], transformSource[2], transformSource[3],
        transformSource[4], transformSource[5], transformSource[6], transformSource[7],
        transformSource[8], transformSource[9], transformSource[10], transformSource[11],
        transformSource[12], transformSource[13], transformSource[14], transformSource[15],
      );
      this._mesh.matrix.transpose();
      this._mesh.matrixAutoUpdate = false;
    });

    // Geometry payload from WASM must be copied before storing in BufferAttributes.
    // Keeping HEAP-backed views here causes silent corruption after later draws/reallocations.
    const numVertices = normalizeLength(blob.numVertices);
    const pointValueCount = numVertices * 3;
    const positionAttribute = this._geometry.getAttribute('position');
    if ((!positionAttribute || positionAttribute.count === 0) && pointValueCount > 0) {
      const pointsSource = resolveFloatSource(
        blob.pointsPtr,
        pointValueCount,
        (blob.points && typeof blob.points.length === 'number') ? blob.points : null,
      );
      const pointsCopy = pointsSource ? measureWasmStage(() => copyFloat32Payload(pointsSource, pointValueCount)) : null;
      if (pointsCopy) {
        this._points = pointsCopy;
        this._hasHydraGeometryPayload = true;
        measureThreeBuildStage(() => {
          this._geometry.setAttribute('position', new Float32BufferAttribute(pointsCopy, 3));
        });
      }
    }

    const numIndices = normalizeLength(blob.numIndices);
    const existingIndex = this._geometry.getIndex();
    if ((!existingIndex || existingIndex.count === 0) && numIndices > 0) {
      const indicesSource = resolveUintSource(
        blob.indicesPtr,
        numIndices,
        (blob.indices && typeof blob.indices.length === 'number') ? blob.indices : null,
      );
      const indicesCopy = indicesSource ? measureWasmStage(() => copyUint32Payload(indicesSource, numIndices)) : null;
      if (indicesCopy) {
        this._indices = indicesCopy;
        this._hasHydraGeometryPayload = true;
        measureThreeBuildStage(() => {
          this._geometry.setIndex(new Uint32BufferAttribute(indicesCopy, 1));
        });
      }
    }

    const uvDimension = Math.max(0, normalizeLength(blob.uvDimension));
    const numUVs = normalizeLength(blob.numUVs);
    const uvValueCount = uvDimension * numUVs;
    const uvAttribute = this._geometry.getAttribute('uv');
    if ((!uvAttribute || uvAttribute.count === 0) && uvDimension >= 2 && uvValueCount > 0) {
      const uvSource = resolveFloatSource(
        blob.uvPtr,
        uvValueCount,
        (blob.uv && typeof blob.uv.length === 'number') ? blob.uv : null,
      );
      const uvCopy = uvSource ? measureWasmStage(() => copyFloat32Payload(uvSource, uvValueCount)) : null;
      if (uvCopy) {
        this._uvs = uvCopy;
        measureThreeBuildStage(() => {
          this._geometry.setAttribute('uv', new Float32BufferAttribute(uvCopy, uvDimension));
        });
        this._geometry.attributes.uv2 = this._geometry.attributes.uv;
      }
    }

    const normalsDimension = Math.max(3, normalizeLength((blob as any).normalsDimension || 3));
    const numNormals = normalizeLength((blob as any).numNormals || numVertices);
    const normalValueCount = numNormals * normalsDimension;
    const normalAttribute = this._geometry.getAttribute('normal');
    if ((!normalAttribute || normalAttribute.count === 0) && normalValueCount > 0) {
      const normalsSource = resolveFloatSource(
        (blob as any).normalsPtr,
        normalValueCount,
        ((blob as any).normals && typeof (blob as any).normals.length === 'number') ? (blob as any).normals : null,
      );
      const normalsCopy = normalsSource ? measureWasmStage(() => copyFloat32Payload(normalsSource, normalValueCount)) : null;
      if (normalsCopy) {
        this._normals = normalsCopy;
        measureThreeBuildStage(() => {
          this._geometry.setAttribute('normal', new Float32BufferAttribute(normalsCopy, normalsDimension));
        });
      }
    }

    const materialId = normalizeHydraPath((blob as any).materialId);
    if (typeof materialId === 'string' && materialId.length > 0) {
      measureThreeBuildStage(() => this.setMaterial(materialId));
    }

    if (this._geometry.getAttribute('normal')?.count > 0) {
      this._needsNormalFallback = false;
    } else {
      this._needsNormalFallback = true;
      this.ensureFallbackNormalsIfMissing();
    }

    const finalPositionCount = Number(this._geometry.getAttribute('position')?.count || 0);
    const finalIndexCount = Number(this._geometry.getIndex()?.count || 0);
    const expectsPositionPayload = pointValueCount > 0;
    const expectsIndexPayload = numIndices > 0;
    const positionReady = !expectsPositionPayload || finalPositionCount > 0;
    const indexReady = !expectsIndexPayload || finalIndexCount > 0;
    const geometryReady = positionReady && indexReady;

    if (!geometryReady) {
      if (allowForceRefreshRetry && !forceRefresh) {
        return this.tryApplyProtoDataBlobFastPath({
          forceRefresh: true,
          allowForceRefreshRetry: false,
        });
      }
      return false;
    }

    return true;
    } finally {
      if (phaseInstrumentationEnabled) {
        this._interface?.recordHydraWasmFetchPhase?.(Math.max(0, wasmFetchMs), this._id);
        this._interface?.recordHydraThreeBuildPhase?.(Math.max(0, threeBuildMs), this._id);
      }
    }
  }

  applyProtoStageSync() {
    if (!this._id.includes(".proto_")) return;
    const finalizeProtoSync = () => {
      if (this.isCollisionProtoMesh() && !this._appliedCollisionOverride) {
        this._hasCompletedProtoSync = false;
        return;
      }
      this._hasCompletedProtoSync = true;
    };
    const finalStageOverride = this._interface?._finalStageOverrideBatchCache?.get?.(this._id) || null;
    if (finalStageOverride?.valid === true) {
      const applied = this.applyFinalStageOverrideFromDriver(finalStageOverride, {
        skipTransformFallback: true,
        skipCollisionRotationFallback: true,
      }) === true;
      if (applied) {
        finalizeProtoSync();
        return;
      }
    }
    const preferFinalBatchSync = this._interface?.preferFinalStageOverrideBatchInProtoSync === true;
    const finalBatchPrimed = this._interface?._finalStageOverrideBatchPrimed === true;
    if (preferFinalBatchSync && !finalBatchPrimed) {
      // Defer expensive per-mesh fallback sync until a final-stage override batch
      // is primed. This avoids duplicating heavy sync work in the first draw burst.
      return;
    }
    const useProtoBlobFastPath = this._interface?.enableProtoBlobFastPath === true;
    // If Hydra has already streamed geometry payloads for this mesh, the proto blob
    // path is redundant and may trigger expensive driver batch fetches on the hot path.
    const shouldAttemptProtoBlobFastPath = this._hasHydraGeometryPayload !== true;
    if (useProtoBlobFastPath && shouldAttemptProtoBlobFastPath && this.tryApplyProtoDataBlobFastPath()) {
      // Keep initial fast-load pose stable: geometry comes from proto blob,
      // while transform alignment still follows the existing fallback sync path.
      this.syncProtoTransformFromFallback();
      this.syncCollisionRotationFromVisualLink();
      finalizeProtoSync();
      return;
    }
    if (this._appliedCollisionOverride) {
      this.syncProtoTransformFromFallback();
      this.syncCollisionRotationFromVisualLink();
      finalizeProtoSync();
      return;
    }

    if (this.isCollisionProtoMesh() && this.applyCollisionGeometryFromOverrides()) {
      this.syncProtoTransformFromFallback();
      this.syncCollisionRotationFromVisualLink();
      finalizeProtoSync();
      return;
    }

    const resolvedPrimPath = this.isCollisionProtoMesh() ? this._interface.getResolvedPrimPathForMeshId(this._id) : null;
    if (resolvedPrimPath && this.applyResolvedPrimGeometryAndTransform(resolvedPrimPath)) {
      this.syncProtoTransformFromFallback();
      this.syncCollisionRotationFromVisualLink();
      finalizeProtoSync();
      return;
    }

    this.syncProtoTransformFromFallback();
    this.syncCollisionRotationFromVisualLink();
    finalizeProtoSync();
  }

  // Lightweight post-draw resync path:
  // keep transform/collision alignment up to date without re-running proto geometry hydration.
  resyncProtoTransformOnly() {
    if (!this._id.includes(".proto_")) return;
    if (this.isCollisionProtoMesh() && !this._appliedCollisionOverride) {
      if (this.applyCollisionGeometryFromOverrides()) {
        this.syncProtoTransformFromFallback();
        this.syncCollisionRotationFromVisualLink();
        this._hasCompletedProtoSync = true;
        return;
      }
      const resolvedPrimPath = this._interface.getResolvedPrimPathForMeshId(this._id);
      if (resolvedPrimPath) {
        this.applyResolvedPrimGeometryAndTransform(resolvedPrimPath);
      }
    }
    this.syncProtoTransformFromFallback();
    this.syncCollisionRotationFromVisualLink();
    this._hasCompletedProtoSync = !this.isCollisionProtoMesh() || this._appliedCollisionOverride;
  }

  skelDetected(skelId, jointIndices, jointWeights, bindTransform) {
      const skeletonHandler = this._interface.skeletons[skelId];
      if (!skeletonHandler || !skeletonHandler._skeleton) {
          return;
      }

      // Prepare Geometry Attributes
      if (!this._geometry.attributes.skinIndex && jointIndices) {
          // Check stride
          const vertexCount = this._points ? this._points.length / 3 : 0; // _points might be null if not loaded yet? Usually it is.
          // Note: jointIndices is a Float32Array or similar.
          
          let stride = 4;
          if (vertexCount > 0) {
              stride = Math.floor(jointIndices.length / vertexCount);
          }
          
          // Three.js expects 4 indices/weights per vertex
          if (stride === 4) {
              this._geometry.setAttribute('skinIndex', new Float32BufferAttribute(jointIndices, 4));
              this._geometry.setAttribute('skinWeight', new Float32BufferAttribute(jointWeights, 4));
          } else {
              // We need to re-stride. This is expensive but necessary if data doesn't match.
              // For now, assume 4 or warn.
              // Often stride is defined by the elementSize.
              // Fallback: If stride is not 4, we might need to pad or truncate.
              // Let's try to just set it and hope Three.js handles it or we're lucky it's 4.
               this._geometry.setAttribute('skinIndex', new Float32BufferAttribute(jointIndices, stride));
               this._geometry.setAttribute('skinWeight', new Float32BufferAttribute(jointWeights, stride));
          }
      }

      // Create SkinnedMesh
      const newMesh = new SkinnedMesh(this._geometry, this._mesh.material);
      newMesh.castShadow = this._mesh.castShadow;
      newMesh.receiveShadow = this._mesh.receiveShadow;
      newMesh.name = this._mesh.name;
      newMesh.matrixAutoUpdate = false;
      newMesh.matrix.copy(this._mesh.matrix);
      newMesh.visible = this._mesh.visible;

      // Bind Skeleton
      const skeleton = skeletonHandler._skeleton;
      newMesh.add(skeleton.bones[0]); // Add root bone to mesh? Or to scene? 
      // Usually bones are added to the scene hierarchy. 
      // If we just add them to the mesh, they move with it.
      // But we need to make sure the bones are in the scene graph.
      
      // For simplicity, let's add the root bone(s) to the mesh so they are part of the object.
      // Or we should add them to the usdRoot if they are shared?
      // UsdSkel skeletons are often shared. If we add to mesh, we duplicate if shared?
      // Clone the skeleton for each mesh? 
      // Three.js SkinnedMesh usually takes a Skeleton instance.
      // If multiple meshes share a skeleton, the bones should probably be in a common parent.
      
      // Let's check if bones are already in scene.
      if (!skeleton.bones[0].parent) {
          // add root bones to the mesh or a common group
          // newMesh.add(skeleton.bones[0]);
          // Actually, let's add them to the mesh for now.
          skeleton.bones.forEach(b => {
              if (!b.parent) newMesh.add(b);
          });
      }
      
      newMesh.bind(skeleton, bindTransform ? new Matrix4().fromArray(bindTransform).transpose().invert() : undefined);
      
      // Replace old mesh
      this._interface.config.usdRoot.remove(this._mesh);
      this._interface.config.usdRoot.add(newMesh);
      this._mesh = newMesh;
      
  }

}

export { HydraMesh };
