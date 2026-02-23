// @ts-nocheck
import {
  Color,
  LinearSRGBColorSpace,
  Matrix4,
  MeshPhysicalMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import * as Shared from './shared.js?v=20260222h';
import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js?v=20260222h';
import { HydraInstancer } from './HydraInstancer.js?v=20260222h';
import { HydraMaterial } from './HydraMaterial.js?v=20260222h';
import { HydraMesh } from './HydraMesh.js?v=20260222h';
import { getDefaultMaterial } from './default-material-state.js?v=20260222h';

const { buildProtoPrimPathCandidates,clamp01,createMatrixFromXformOp,debugInstancer,debugMaterials,debugMeshes,debugPrims,debugTextures,defaultGrayComponent,disableMaterials,disableTextures,extractPrimPathFromMaterialBindingWarning,extractReferencePrimTargets,extractScopeBodyText,extractUsdAssetReferencesFromLayerText,getActiveMaterialBindingWarningOwner,getAngleInRadians,getCollisionGeometryTypeFromUrdfElement,getExpectedPrimTypesForCollisionProto,getExpectedPrimTypesForProtoType,getMatrixMaxElementDelta,getPathBasename,getPathWithoutRoot,getRawConsoleMethod,getRootPathFromPrimPath,getSafePrimTypeName,hasNonZeroTranslation,hydraCallbackErrorCounts,installMaterialBindingApiWarningInterceptor,isIdentityQuaternion,isLikelyDefaultGrayMaterial,isLikelyInverseTransform,isMaterialBindingApiWarningMessage,isMatrixApproximatelyIdentity,isNonZero,isPotentiallyLargeBaseAssetPath,logHydraCallbackError,materialBindingRepairMaxLayerTextLength,materialBindingWarningHandlers,maxHydraCallbackErrorLogsPerMethod,nearlyEqual,normalizeHydraPath,normalizeUsdPathToken,parseGuideCollisionReferencesFromLayerText,parseProtoMeshIdentifier,parseUrdfTruthFromText,parseVector3Text,parseXformOpFallbacksFromLayerText,rawConsoleError,rawConsoleWarn,registerMaterialBindingApiWarningHandler,remapRootPathIfNeeded,resolveUrdfTruthFileNameForStagePath,resolveUsdAssetPath,setActiveMaterialBindingWarningOwner,shouldAllowLargeBaseAssetScan,stringifyConsoleArgs,toArrayLike,toColorArray,toFiniteNumber,toFiniteQuaternionWxyzTuple,toFiniteVector2Tuple,toFiniteVector3Tuple,toMatrixFromUrdfOrigin,toQuaternionWxyzFromRpy,transformEpsilon,wrapHydraCallbackObject } = Shared;

export class ThreeRenderDelegateInterface extends ThreeRenderDelegateMaterialOps {
  applyStageFallbackMaterialParameters(material, shaderPrim) {
    if (!material || !shaderPrim) return;
    const treatNamedHexDiffuseAsSrgb = this.shouldTreatNamedHexDiffuseAsSrgb();

    this.applyStageFallbackColorInput(material, shaderPrim, [
      'inputs:diffuseColor',
      'inputs:diffuse_color_constant',
      'inputs:diffuse_color',
      'inputs:baseColor',
      'inputs:base_color',
      'inputs:base_color_constant',
      'inputs:albedo',
      'inputs:albedo_constant',
    ], 'color', {
      treatAsSrgbWhenMatchingMaterialName: treatNamedHexDiffuseAsSrgb,
    });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:roughness',
      'inputs:roughness_constant',
      'inputs:reflection_roughness_constant',
      'inputs:specular_roughness',
    ], 'roughness', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:metallic',
      'inputs:metallic_constant',
      'inputs:metalness',
      'inputs:metalness_constant',
    ], 'metalness', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:opacity',
      'inputs:opacity_constant',
    ], 'opacity', {
      clamp01: true,
      onAssigned: (value) => {
        if (value < 1) material.transparent = true;
      },
    });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:opacityThreshold',
      'inputs:opacity_threshold',
      'inputs:alphaCutoff',
      'inputs:alpha_cutoff',
    ], 'alphaTest', {
      clamp01: true,
      onAssigned: (value) => {
        if (value > 0) material.transparent = false;
      },
    });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:clearcoat',
      'inputs:coat',
      'inputs:coat_weight',
    ], 'clearcoat', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:clearcoatRoughness',
      'inputs:clearcoat_roughness',
      'inputs:coat_roughness',
    ], 'clearcoatRoughness', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:ior',
      'inputs:indexOfRefraction',
      'inputs:index_of_refraction',
    ], 'ior', { min: 1 });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:specular',
      'inputs:specular_constant',
      'inputs:specularIntensity',
      'inputs:specular_intensity',
    ], 'specularIntensity', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:transmission',
      'inputs:transmission_weight',
    ], 'transmission', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:thickness',
      'inputs:thickness_constant',
    ], 'thickness', { min: 0 });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:attenuationDistance',
      'inputs:attenuation_distance',
    ], 'attenuationDistance', { min: 0 });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:ao_strength',
      'inputs:occlusion_strength',
      'inputs:occlusion',
    ], 'aoMapIntensity', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:sheen',
      'inputs:sheen_weight',
    ], 'sheen', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:sheenRoughness',
      'inputs:sheen_roughness',
    ], 'sheenRoughness', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:iridescence',
      'inputs:iridescence_weight',
    ], 'iridescence', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:iridescenceIOR',
      'inputs:iridescence_ior',
    ], 'iridescenceIOR', { min: 1 });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:anisotropy',
      'inputs:anisotropy_level',
    ], 'anisotropy', { clamp01: true });

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:anisotropyRotation',
      'inputs:anisotropy_rotation',
    ], 'anisotropyRotation');

    this.applyStageFallbackColorInput(material, shaderPrim, [
      'inputs:specularColor',
      'inputs:specular_color',
    ], 'specularColor');

    this.applyStageFallbackColorInput(material, shaderPrim, [
      'inputs:attenuationColor',
      'inputs:attenuation_color',
    ], 'attenuationColor');

    this.applyStageFallbackColorInput(material, shaderPrim, [
      'inputs:sheenColor',
      'inputs:sheen_color',
    ], 'sheenColor');

    const emissiveEnabledValue = this.readPrimAttribute(shaderPrim, [
      'inputs:enable_emission',
      'inputs:enableEmission',
    ]);
    const emissiveEnabledNumeric = toFiniteNumber(emissiveEnabledValue);
    const emissiveEnabled = typeof emissiveEnabledValue === 'boolean'
      ? emissiveEnabledValue
      : (emissiveEnabledNumeric !== undefined ? emissiveEnabledNumeric > 0 : undefined);

    const emissiveColor = this.applyStageFallbackColorInput(material, shaderPrim, [
      'inputs:emissiveColor',
      'inputs:emissive_color',
      'inputs:emissive_color_constant',
    ], 'emissive', {
      requireValue: emissiveEnabled === true || emissiveEnabled === undefined,
    });
    if (emissiveColor && emissiveEnabled === false) {
      material.emissive = new Color(0x000000);
    }

    this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:emissive_intensity',
    ], 'emissiveIntensity', { min: 0 });

    const normalScaleValue = this.readPrimAttribute(shaderPrim, [
      'inputs:normalScale',
      'inputs:normal_scale',
    ]);
    const normalScaleTuple = toFiniteVector2Tuple(normalScaleValue)
      || (() => {
        const scalar = toFiniteNumber(normalScaleValue);
        if (scalar === undefined) return null;
        return [scalar, scalar];
      })();
    if (normalScaleTuple) {
      material.normalScale = new Vector2(normalScaleTuple[0], normalScaleTuple[1]);
    }

    const clearcoatNormalScaleValue = this.readPrimAttribute(shaderPrim, [
      'inputs:clearcoatNormalScale',
      'inputs:clearcoat_normal_scale',
    ]);
    const clearcoatNormalScaleTuple = toFiniteVector2Tuple(clearcoatNormalScaleValue)
      || (() => {
        const scalar = toFiniteNumber(clearcoatNormalScaleValue);
        if (scalar === undefined) return null;
        return [scalar, scalar];
      })();
    if (clearcoatNormalScaleTuple) {
      material.clearcoatNormalScale = new Vector2(clearcoatNormalScaleTuple[0], clearcoatNormalScaleTuple[1]);
    }

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:diffuseColor_texture',
      'inputs:diffuse_color_texture',
      'inputs:baseColor_texture',
      'inputs:base_color_texture',
      'inputs:albedo_texture',
    ], 'map', {
      colorSpace: SRGBColorSpace,
      onAssigned: () => {
        material.color = new Color(0xffffff);
      },
    });

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:emissiveColor_texture',
      'inputs:emissive_color_texture',
      'inputs:emissive_texture',
    ], 'emissiveMap', {
      colorSpace: SRGBColorSpace,
      onAssigned: () => {
        material.emissive = new Color(0xffffff);
      },
    });

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:roughness_texture',
      'inputs:reflection_roughness_texture',
      'inputs:specular_roughness_texture',
    ], 'roughnessMap', {
      onAssigned: () => {
        material.roughness = 1;
      },
    });

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:metallic_texture',
      'inputs:metalness_texture',
    ], 'metalnessMap', {
      onAssigned: () => {
        material.metalness = 1;
      },
    });

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:normal_texture',
      'inputs:normalmap_texture',
      'inputs:normal_map_texture',
    ], 'normalMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:occlusion_texture',
      'inputs:occlusion_map',
      'inputs:ao_texture',
    ], 'aoMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:opacity_texture',
      'inputs:opacity_mask_texture',
      'inputs:opacityMask_texture',
    ], 'alphaMap', {
      onAssigned: () => {
        if (!(material.alphaTest > 0)) material.transparent = true;
      },
    });

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:clearcoat_texture',
      'inputs:coat_texture',
    ], 'clearcoatMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:clearcoatRoughness_texture',
      'inputs:clearcoat_roughness_texture',
      'inputs:coat_roughness_texture',
    ], 'clearcoatRoughnessMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:clearcoatNormal_texture',
      'inputs:clearcoat_normal_texture',
    ], 'clearcoatNormalMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:specularColor_texture',
      'inputs:specular_color_texture',
    ], 'specularColorMap', {
      colorSpace: SRGBColorSpace,
    });

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:specular_texture',
      'inputs:specular_intensity_texture',
    ], 'specularIntensityMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:transmission_texture',
      'inputs:transmission_weight_texture',
    ], 'transmissionMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:thickness_texture',
    ], 'thicknessMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:sheenColor_texture',
      'inputs:sheen_color_texture',
    ], 'sheenColorMap', {
      colorSpace: SRGBColorSpace,
    });

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:sheenRoughness_texture',
      'inputs:sheen_roughness_texture',
    ], 'sheenRoughnessMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:anisotropy_texture',
    ], 'anisotropyMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:iridescence_texture',
      'inputs:iridescence_weight_texture',
    ], 'iridescenceMap');

    this.applyStageFallbackTextureInput(material, shaderPrim, [
      'inputs:iridescenceThickness_texture',
      'inputs:iridescence_thickness_texture',
    ], 'iridescenceThicknessMap');
  }

  applyStageFallbackScalarInput(material, shaderPrim, attributeNames, materialProperty, options = {}) {
    const value = this.readPrimAttribute(shaderPrim, attributeNames);
    const numericValue = toFiniteNumber(value);
    if (numericValue === undefined) return false;

    let normalizedValue = numericValue;
    if (options.clamp01) normalizedValue = clamp01(normalizedValue);
    if (Number.isFinite(options.min)) normalizedValue = Math.max(Number(options.min), normalizedValue);
    if (Number.isFinite(options.max)) normalizedValue = Math.min(Number(options.max), normalizedValue);

    material[materialProperty] = normalizedValue;
    if (typeof options.onAssigned === 'function') {
      options.onAssigned(normalizedValue);
    }
    return true;
  }

  applyStageFallbackColorInput(material, shaderPrim, attributeNames, materialProperty, options = {}) {
    const value = this.readPrimAttribute(shaderPrim, attributeNames);
    const color = toColorArray(value);
    if (!color) return null;

    if (options.requireValue === false) return color;
    let nextColor = new Color().fromArray(color);

    if (options.treatAsSrgbWhenMatchingMaterialName && material?.name) {
      const inferredHex = this.inferColorHexFromMaterialName(material.name);
      if (Number.isFinite(inferredHex)) {
        const sr = ((inferredHex >> 16) & 0xff) / 255;
        const sg = ((inferredHex >> 8) & 0xff) / 255;
        const sb = (inferredHex & 0xff) / 255;
        const colorEpsilon = 1 / 255 + 1e-4;
        const matchesNamedSrgbColor = Math.abs(color[0] - sr) <= colorEpsilon
          && Math.abs(color[1] - sg) <= colorEpsilon
          && Math.abs(color[2] - sb) <= colorEpsilon;
        if (matchesNamedSrgbColor) {
          nextColor = new Color(inferredHex);
        }
      }
    }

    material[materialProperty] = nextColor;
    return color;
  }

  applyStageFallbackTextureInput(material, shaderPrim, attributeNames, materialProperty, options = {}) {
    const texturePath = this.resolveMaterialTexturePath(shaderPrim, attributeNames);
    if (!texturePath) return false;

    this.registry.getTexture(texturePath).then((texture) => {
      const nextTexture = texture?.clone ? texture.clone() : texture;
      if (!nextTexture) return;
      nextTexture.colorSpace = options.colorSpace || LinearSRGBColorSpace;
      nextTexture.needsUpdate = true;
      material[materialProperty] = nextTexture;
      if (typeof options.onAssigned === 'function') {
        options.onAssigned(nextTexture);
      }
      material.needsUpdate = true;
    }).catch(() => {});

    return true;
  }

  safeGetPrimAtPath(stage, path) {
    if (!stage || !path) return null;
    const normalizedPath = normalizeHydraPath(path);
    if (!normalizedPath) return null;

    if (this._primPathExistenceCache.has(normalizedPath)) {
      if (this._primPathExistenceCache.get(normalizedPath) === false) {
        return null;
      }
    } else if (this._knownPrimPathSetPrimed === true && this._knownPrimPathSet instanceof Set) {
      if (!this._knownPrimPathSet.has(normalizedPath)) {
        this._primPathExistenceCache.set(normalizedPath, false);
        return null;
      }
    } else if (this._knownPrimPathSetPrimed !== true) {
      const driver = this.config?.driver?.();
      if (driver) {
        try {
          this.prefetchPrimPathSetFromDriver(driver, { force: false });
        } catch {
          // Keep fallback path resilient.
        }
      }
      if (this._knownPrimPathSetPrimed === true && this._knownPrimPathSet instanceof Set && !this._knownPrimPathSet.has(normalizedPath)) {
        this._primPathExistenceCache.set(normalizedPath, false);
        return null;
      }
    }

    try {
      const prim = stage.GetPrimAtPath(normalizedPath);
      if (!prim) {
        this._primPathExistenceCache.set(normalizedPath, false);
        return null;
      }
      this._primPathExistenceCache.set(normalizedPath, true);
      if (this._knownPrimPathSet instanceof Set) {
        this._knownPrimPathSet.add(normalizedPath);
      }
      return prim;
    } catch {
      this._primPathExistenceCache.set(normalizedPath, false);
      return null;
    }
  }

  findMaterialShaderPrim(stage, materialPath, materialName) {
    const candidateNames = [];
    const addCandidate = (name) => {
      if (!name || candidateNames.includes(name)) return;
      candidateNames.push(name);
    };

    addCandidate('Shader');
    addCandidate(this.getPreferredShaderName(materialName));
    addCandidate(materialName);
    addCandidate('PreviewSurface');
    addCandidate('UsdPreviewSurface');
    addCandidate('surfaceShader');
    addCandidate('Surface');
    addCandidate('PBRShader');
    addCandidate('MtlxStandardSurface');
    addCandidate('mtlxstandard_surface');
    addCandidate('ND_standard_surface_surfaceshader');

    for (const candidateName of candidateNames) {
      const shaderPath = `${materialPath}/${candidateName}`;
      const shaderPrim = this.safeGetPrimAtPath(stage, shaderPath);
      if (!shaderPrim) continue;
      if (this.isUsableMaterialShaderPrim(shaderPrim)) {
        return shaderPrim;
      }
    }

    return null;
  }

  isUsableMaterialShaderPrim(shaderPrim) {
    if (!shaderPrim) return false;

    const shaderType = getSafePrimTypeName(shaderPrim);
    if (shaderType === 'shader') return true;
    if (shaderType && shaderType !== 'shader') return false;

    let propertyNames = [];
    try {
      propertyNames = shaderPrim.GetPropertyNames?.() || [];
    } catch {
      propertyNames = [];
    }

    if (!Array.isArray(propertyNames) && propertyNames && typeof propertyNames[Symbol.iterator] === 'function') {
      propertyNames = Array.from(propertyNames);
    }

    if (!Array.isArray(propertyNames) || propertyNames.length === 0) return false;

    return propertyNames.some((name) =>
      name === 'info:id' ||
      name.startsWith('inputs:') ||
      name.startsWith('outputs:')
    );
  }

  getPreferredShaderName(materialName) {
    if (!materialName) return 'Shader';

    const lowered = materialName.toLowerCase();
    if (lowered === 'material_dark' || lowered === 'material_white') return 'Shader';
    if (/^material_[0-9]{9}$/i.test(materialName)) return 'Shader';

    return materialName;
  }

  inferColorHexFromMaterialName(materialName) {
    const normalized = String(materialName || '').trim();
    if (!normalized) return null;
    const match = normalized.match(/([0-9a-f]{6})$/i);
    if (!match) return null;
    const parsed = Number.parseInt(match[1], 16);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }

  readPrimAttribute(prim, attributeNames) {
    if (!prim || !Array.isArray(attributeNames)) return undefined;

    for (const attributeName of attributeNames) {
      let value = undefined;
      try {
        value = prim.GetAttribute(attributeName)?.Get();
      } catch {
        value = undefined;
      }
      if (value !== undefined && value !== null) return value;
    }

    return undefined;
  }

  normalizeMaterialTexturePath(pathValue) {
    if (pathValue === null || pathValue === undefined) return null;
    const text = String(pathValue || '').trim();
    if (!text) return null;
    const withoutAssetDelimiters = text.replace(/^@+/, '').replace(/@+$/, '');
    const normalizedPath = withoutAssetDelimiters.replace(/\\/g, '/');
    if (!normalizedPath) return null;
    return normalizedPath.replace('./', '');
  }

  extractMaterialTexturePath(texturePathValue) {
    if (!texturePathValue) return null;

    if (typeof texturePathValue === 'string') {
      return this.normalizeMaterialTexturePath(texturePathValue);
    }

    const objectPath = texturePathValue?.resolvedPath || texturePathValue?.path || texturePathValue?.assetPath;
    if (typeof objectPath === 'string' && objectPath.length > 0) {
      return this.normalizeMaterialTexturePath(objectPath);
    }

    try {
      if (typeof texturePathValue.GetResolvedPath === 'function') {
        const resolvedPath = texturePathValue.GetResolvedPath();
        if (typeof resolvedPath === 'string' && resolvedPath.length > 0) {
          return this.normalizeMaterialTexturePath(resolvedPath);
        }
      }
    } catch {}

    try {
      if (typeof texturePathValue.GetAssetPath === 'function') {
        const assetPath = texturePathValue.GetAssetPath();
        if (typeof assetPath === 'string' && assetPath.length > 0) {
          return this.normalizeMaterialTexturePath(assetPath);
        }
      }
    } catch {}

    return null;
  }

  resolveMaterialTexturePath(shaderPrim, attributeNames = null) {
    const candidateAttributeNames = Array.isArray(attributeNames) && attributeNames.length > 0
      ? attributeNames
      : [
        'inputs:diffuseColor_texture',
        'inputs:diffuse_color_texture',
        'inputs:albedo_texture',
        'inputs:base_color_texture',
      ];
    const texturePathValue = this.readPrimAttribute(shaderPrim, candidateAttributeNames);
    if (!texturePathValue) return null;
    return this.extractMaterialTexturePath(texturePathValue);
  }

  getNamedNonDefaultMaterial(materialValue) {
    const materials = Array.isArray(materialValue) ? materialValue : [materialValue];
    let fallbackMaterial = null;

    for (const material of materials) {
      if (!material || material === getDefaultMaterial()) continue;
      if (isLikelyDefaultGrayMaterial(material)) continue;

      const materialName = String(material.name || '').trim();
      const hasExplicitName = materialName.length > 0 && materialName !== 'DefaultMaterial';
      if (hasExplicitName) return material;
      if (!fallbackMaterial) fallbackMaterial = material;
    }

    return fallbackMaterial;
  }

  getPreferredVisualMaterialForLink(linkPath, requestingMeshId = null) {
    if (!linkPath) return null;
    if (this._preferredVisualMaterialByLinkCache.has(linkPath)) {
      return this._preferredVisualMaterialByLinkCache.get(linkPath) || null;
    }

    const prefix = `${linkPath}/visuals.proto_`;
    let preferredMaterial = null;
    let bestScore = -1;

    for (const [meshId, mesh] of Object.entries(this.meshes)) {
      if (!meshId || !meshId.startsWith(prefix) || meshId === requestingMeshId) continue;
      const candidateMaterial = this.getNamedNonDefaultMaterial(mesh?._mesh?.material);
      if (!candidateMaterial) continue;

      let score = 0;
      if (meshId.endsWith('/visuals.proto_mesh_id0')) score += 100;
      else if (meshId.includes('/visuals.proto_mesh_id')) score += 80;
      else if (meshId.includes('/visuals.proto_')) score += 40;

      const materialName = String(candidateMaterial.name || '').trim();
      if (materialName.length > 0 && materialName !== 'DefaultMaterial') score += 20;

      if (score > bestScore) {
        preferredMaterial = candidateMaterial;
        bestScore = score;
      }
    }

    if (preferredMaterial) {
      this._preferredVisualMaterialByLinkCache.set(linkPath, preferredMaterial);
    }
    return preferredMaterial || null;
  }

  runStageTruthAlignmentDiagnostics() {
    if (this._hasRunStageTruthAlignmentDiagnostics) return;
    this._hasRunStageTruthAlignmentDiagnostics = true;
    const diagnosticsEnabled = typeof window !== 'undefined'
      && /\bdebugStageAlignment=1\b/.test(String(window.location?.search || ''));
    if (!diagnosticsEnabled) return;

    const linkPaths = new Set();
    for (const meshId of Object.keys(this.meshes)) {
      const proto = parseProtoMeshIdentifier(meshId);
      if (!proto?.linkPath) continue;
      linkPaths.add(proto.linkPath);
    }
    if (linkPaths.size === 0) return;

    const mismatches = [];
    const sampledLinkPaths = Array.from(linkPaths).sort().slice(0, 24);
    for (const linkPath of sampledLinkPaths) {
      const stageMatrix = this.getWorldTransformForPrimPath(linkPath);
      if (!stageMatrix) continue;

      const meshMatrix = this.getRepresentativeVisualTransformForLinkPath(linkPath)
        || this.meshes[`${linkPath}/visuals.proto_mesh_id0`]?._mesh?.matrix
        || null;
      if (!meshMatrix) continue;

      let maxElementDelta = 0;
      for (let elementIndex = 0; elementIndex < 16; elementIndex++) {
        const delta = Math.abs((meshMatrix.elements[elementIndex] || 0) - (stageMatrix.elements[elementIndex] || 0));
        if (delta > maxElementDelta) maxElementDelta = delta;
      }

      if (maxElementDelta > transformEpsilon) {
        mismatches.push(`${linkPath} (maxΔ=${maxElementDelta.toExponential(2)})`);
      }
    }

    void mismatches;
  }

  getRepresentativeVisualTransformForMeshId(meshId) {
    if (!meshId || !meshId.includes('.proto_')) return null;
    const proto = this._protoMeshMetadataByMeshId.get(meshId) || parseProtoMeshIdentifier(meshId);
    if (!proto || !proto.linkPath) return null;
    return this.getRepresentativeVisualTransformForLinkPath(proto.linkPath);
  }

  registerMeshLinkPathIndex(meshId) {
    if (!meshId || !meshId.includes('.proto_')) return null;
    const proto = parseProtoMeshIdentifier(meshId);
    if (!proto?.linkPath) return null;
    this._protoMeshMetadataByMeshId.set(meshId, proto);
    const meshMatrix = this.meshes[meshId]?._mesh?.matrix || null;
    const indexedMeshId = this._meshIdByLinkPath.get(proto.linkPath);
    if (!indexedMeshId || !this.meshes[indexedMeshId] || this.matrixHasNonIdentityRotation(meshMatrix)) {
      this._meshIdByLinkPath.set(proto.linkPath, meshId);
    }
    const indexedVisualMeshId = this._visualMeshIdByLinkPath.get(proto.linkPath);
    if (proto.sectionName === 'visuals' && (!indexedVisualMeshId || !this.meshes[indexedVisualMeshId])) {
      this._visualMeshIdByLinkPath.set(proto.linkPath, meshId);
    }
    return proto;
  }

  matrixHasNonIdentityRotation(matrix) {
    if (!matrix) return false;
    const position = this._decomposeScratchPosition;
    const quaternion = this._decomposeScratchQuaternion;
    const scale = this._decomposeScratchScale;
    matrix.decompose(position, quaternion, scale);
    return !isIdentityQuaternion(quaternion);
  }

  updateRepresentativeVisualTransformIndex(meshId, matrix) {
    if (!meshId || !meshId.includes('.proto_')) return;
    const proto = this._protoMeshMetadataByMeshId.get(meshId) || this.registerMeshLinkPathIndex(meshId);
    if (!proto?.linkPath) return;

    const indexedMeshId = this._meshIdByLinkPath.get(proto.linkPath);
    if (!indexedMeshId || !this.meshes[indexedMeshId]) {
      this._meshIdByLinkPath.set(proto.linkPath, meshId);
    }

    if (proto.sectionName === 'visuals') {
      const currentVisualMeshId = this._visualMeshIdByLinkPath.get(proto.linkPath);
      if (!currentVisualMeshId || !this.meshes[currentVisualMeshId] || this.matrixHasNonIdentityRotation(matrix)) {
        this._visualMeshIdByLinkPath.set(proto.linkPath, meshId);
      }
    }

    this._linkVisualTransformCache.delete(proto.linkPath);
  }

  getRepresentativeVisualTransformForLinkPath(linkPath) {
    if (!linkPath) return null;
    if (this._linkVisualTransformCache.has(linkPath)) {
      const cached = this._linkVisualTransformCache.get(linkPath);
      return cached ? cached.clone() : null;
    }

    const visualMeshId = this._visualMeshIdByLinkPath.get(linkPath);
    const fallbackMeshId = this._meshIdByLinkPath.get(linkPath);

    const visualMatrix = visualMeshId
      ? this.meshes[visualMeshId]?._mesh?.matrix
      : null;
    const fallbackMatrix = fallbackMeshId
      ? this.meshes[fallbackMeshId]?._mesh?.matrix
      : null;

    let bestMatrix = visualMatrix || null;
    let bestMatrixHasRotation = this.matrixHasNonIdentityRotation(bestMatrix);

    if ((!bestMatrix || !bestMatrixHasRotation) && fallbackMatrix) {
      const fallbackHasRotation = this.matrixHasNonIdentityRotation(fallbackMatrix);
      if (!bestMatrix || !bestMatrixHasRotation || fallbackHasRotation) {
        bestMatrix = fallbackMatrix;
        bestMatrixHasRotation = fallbackHasRotation;
      }
    }

    if (!bestMatrix) {
      const directVisualId = `${linkPath}/visuals.proto_mesh_id0`;
      bestMatrix = this.meshes[directVisualId]?._mesh?.matrix || null;
      if (bestMatrix) {
        this._visualMeshIdByLinkPath.set(linkPath, directVisualId);
        this._meshIdByLinkPath.set(linkPath, directVisualId);
      }
    }

    this._linkVisualTransformCache.set(linkPath, bestMatrix ? bestMatrix.clone() : null);
    return bestMatrix ? bestMatrix.clone() : null;
  }

  getFallbackTransformForMeshId(meshId) {
    if (!meshId || !meshId.includes('.proto_')) return null;

    if (this._meshFallbackCache.has(meshId)) {
      const cached = this._meshFallbackCache.get(meshId);
      return cached ? cached.clone() : null;
    }

    const pathEnd = meshId.indexOf('.proto_');
    const primPath = meshId.substring(0, pathEnd);
    const fallback = this.getWorldTransformForPrimPath(primPath);

    this._meshFallbackCache.set(meshId, fallback ? fallback.clone() : null);
    return fallback;
  }

  getSafeFallbackTransformForMeshId(meshId) {
    try {
      return this.getFallbackTransformForMeshId(meshId);
    } catch {
      return null;
    }
  }

  matrixFromWasmTransform(rawMatrix) {
    const rawValues = (
      rawMatrix && (
        Array.isArray(rawMatrix)
        || ArrayBuffer.isView(rawMatrix)
        || typeof (rawMatrix as any).length === "number"
      )
    )
      ? rawMatrix
      : toArrayLike(rawMatrix);
    if (!rawValues || Number(rawValues.length) < 16) return null;

    const m00 = Number(rawValues[0]); const m01 = Number(rawValues[1]); const m02 = Number(rawValues[2]); const m03 = Number(rawValues[3]);
    const m10 = Number(rawValues[4]); const m11 = Number(rawValues[5]); const m12 = Number(rawValues[6]); const m13 = Number(rawValues[7]);
    const m20 = Number(rawValues[8]); const m21 = Number(rawValues[9]); const m22 = Number(rawValues[10]); const m23 = Number(rawValues[11]);
    const m30 = Number(rawValues[12]); const m31 = Number(rawValues[13]); const m32 = Number(rawValues[14]); const m33 = Number(rawValues[15]);
    if (
      !Number.isFinite(m00) || !Number.isFinite(m01) || !Number.isFinite(m02) || !Number.isFinite(m03)
      || !Number.isFinite(m10) || !Number.isFinite(m11) || !Number.isFinite(m12) || !Number.isFinite(m13)
      || !Number.isFinite(m20) || !Number.isFinite(m21) || !Number.isFinite(m22) || !Number.isFinite(m23)
      || !Number.isFinite(m30) || !Number.isFinite(m31) || !Number.isFinite(m32) || !Number.isFinite(m33)
    ) return null;

    // USD bindings expose row-major matrix values; Three.js Matrix4 expects
    // column-major storage internally, so transpose once after assignment.
    const matrix = new Matrix4();
    matrix.set(
      m00, m01, m02, m03,
      m10, m11, m12, m13,
      m20, m21, m22, m23,
      m30, m31, m32, m33,
    );
    matrix.transpose();
    return matrix;
  }

  normalizeProtoDataBlob(rawBlob) {
    if (!rawBlob || typeof rawBlob !== 'object') return null;
    if (rawBlob.valid !== true) return null;

    const toNonNegativeInt = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) return 0;
      return Math.floor(numeric);
    };
    const toAlignedPtr = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return 0;
      const ptr = Math.floor(numeric);
      return (ptr % 4) === 0 ? ptr : 0;
    };
    const keepTypedArrayView = (value) => {
      if (!value || typeof value.length !== 'number') return undefined;
      return ArrayBuffer.isView(value) ? value : undefined;
    };
    const keepSmallArrayLike = (value, maxLength) => {
      if (!value || typeof value.length !== 'number') return undefined;
      if (ArrayBuffer.isView(value)) return value;
      const length = Number(value.length);
      if (!Number.isFinite(length) || length <= 0 || length > maxLength) return undefined;
      return value;
    };

    // Return a plain JS object with pointer/count metadata.
    // This prevents accidental high-frequency proxy reads on large payloads.
    return {
      valid: true,
      numVertices: toNonNegativeInt(rawBlob.numVertices),
      numIndices: toNonNegativeInt(rawBlob.numIndices),
      numUVs: toNonNegativeInt(rawBlob.numUVs),
      uvDimension: toNonNegativeInt(rawBlob.uvDimension),
      pointsPtr: toAlignedPtr(rawBlob.pointsPtr),
      indicesPtr: toAlignedPtr(rawBlob.indicesPtr),
      uvPtr: toAlignedPtr(rawBlob.uvPtr),
      transformPtr: toAlignedPtr(rawBlob.transformPtr),
      normalsPtr: toAlignedPtr((rawBlob as any).normalsPtr),
      numNormals: toNonNegativeInt((rawBlob as any).numNormals),
      normalsDimension: toNonNegativeInt((rawBlob as any).normalsDimension),
      materialId: typeof (rawBlob as any).materialId === 'string'
        ? normalizeHydraPath((rawBlob as any).materialId)
        : '',
      points: keepTypedArrayView(rawBlob.points),
      indices: keepTypedArrayView(rawBlob.indices),
      uv: keepTypedArrayView(rawBlob.uv),
      normals: keepTypedArrayView((rawBlob as any).normals),
      transform: keepSmallArrayLike(rawBlob.transform, 32),
    };
  }

  normalizeCollisionProtoOverride(rawOverride) {
    if (!rawOverride || typeof rawOverride !== 'object') return null;
    if (rawOverride.valid !== true) return null;

    const normalizeFiniteNumber = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const normalizeAxis = (value) => {
      const normalized = String(value || '').trim().toUpperCase();
      if (normalized === 'X' || normalized === 'Y' || normalized === 'Z') return normalized;
      return 'Z';
    };
    const normalizeExtentSize = (value) => {
      if (!value || typeof value.length !== 'number' || Number(value.length) < 3) return null;
      const x = normalizeFiniteNumber(value[0]);
      const y = normalizeFiniteNumber(value[1]);
      const z = normalizeFiniteNumber(value[2]);
      if (x === undefined || y === undefined || z === undefined) return null;
      return [Math.max(0, x), Math.max(0, y), Math.max(0, z)];
    };
    const worldTransform = this.matrixFromWasmTransform(rawOverride.worldTransform) || null;
    if (!worldTransform) return null;

    const primType = String(rawOverride.primType || '').trim().toLowerCase();
    if (!primType) return null;

    return {
      valid: true,
      meshId: normalizeHydraPath(rawOverride.meshId || ''),
      resolvedPrimPath: normalizeHydraPath(rawOverride.resolvedPrimPath || ''),
      primType,
      axis: normalizeAxis(rawOverride.axis),
      size: normalizeFiniteNumber(rawOverride.size),
      radius: normalizeFiniteNumber(rawOverride.radius),
      height: normalizeFiniteNumber(rawOverride.height),
      extentSize: normalizeExtentSize(rawOverride.extentSize),
      worldTransform,
      worldTransformElements: (
        rawOverride.worldTransform
        && (Array.isArray(rawOverride.worldTransform)
          || ArrayBuffer.isView(rawOverride.worldTransform)
          || typeof rawOverride.worldTransform.length === 'number')
      )
        ? rawOverride.worldTransform
        : undefined,
    };
  }

  normalizeVisualProtoOverride(rawOverride) {
    return this.normalizeCollisionProtoOverride(rawOverride);
  }

  cacheResolvedWorldTransformFromOverride(overridePayload) {
    const resolvedPath = normalizeHydraPath(overridePayload?.resolvedPrimPath || '');
    const worldTransform = overridePayload?.worldTransform;
    if (!resolvedPath || !resolvedPath.startsWith('/')) return;
    if (!worldTransform || typeof worldTransform.clone !== 'function') return;
    this._worldXformCache?.set?.(resolvedPath, worldTransform.clone());
  }

  normalizePrimOverrideData(rawData) {
    if (!rawData || typeof rawData !== 'object') return null;
    if (rawData.valid !== true) return null;

    const normalizeFiniteNumber = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const normalizeAxis = (value) => {
      const normalized = String(value || '').trim().toUpperCase();
      if (normalized === 'X' || normalized === 'Y' || normalized === 'Z') return normalized;
      return 'Z';
    };
    const normalizeExtentSize = (value) => {
      if (!value || typeof value.length !== 'number' || Number(value.length) < 3) return null;
      const x = normalizeFiniteNumber(value[0]);
      const y = normalizeFiniteNumber(value[1]);
      const z = normalizeFiniteNumber(value[2]);
      if (x === undefined || y === undefined || z === undefined) return null;
      return [Math.max(0, x), Math.max(0, y), Math.max(0, z)];
    };
    const worldTransform = this.matrixFromWasmTransform(rawData.worldTransform) || null;
    if (!worldTransform) return null;

    const primType = String(rawData.primType || '').trim().toLowerCase();
    if (!primType) return null;

    return {
      valid: true,
      resolvedPrimPath: normalizeHydraPath(rawData.resolvedPrimPath || ''),
      primType,
      axis: normalizeAxis(rawData.axis),
      size: normalizeFiniteNumber(rawData.size),
      radius: normalizeFiniteNumber(rawData.radius),
      height: normalizeFiniteNumber(rawData.height),
      extentSize: normalizeExtentSize(rawData.extentSize),
      worldTransform,
      worldTransformElements: (
        rawData.worldTransform
        && (Array.isArray(rawData.worldTransform)
          || ArrayBuffer.isView(rawData.worldTransform)
          || typeof rawData.worldTransform.length === 'number')
      )
        ? rawData.worldTransform
        : undefined,
    };
  }

  prefetchProtoDataBlobsFromDriver(driver, options = {}) {
    const forceRefresh = options?.force === true;
    const resolvedDriver = driver || this.config?.driver?.();
    if (!resolvedDriver) return { count: 0, source: "none" };
    if (this._protoDataBlobBatchPrimed === true && !forceRefresh) {
      const cachedCount = Number(this._protoDataBlobBatchCache?.size || 0);
      if (cachedCount > 0) {
        return { count: cachedCount, source: "cache" };
      }
    }

    this._protoDataBlobBatchPrimed = true;
    this._protoDataBlobBatchCache?.clear?.();

    if (typeof resolvedDriver.GetAllProtoDataBlobs !== 'function') {
      return { count: 0, source: "single-only" };
    }

    let payload = null;
    try {
      payload = resolvedDriver.GetAllProtoDataBlobs();
    } catch {
      return { count: 0, source: "error" };
    }

    if (!payload || typeof payload !== 'object') {
      return { count: 0, source: "empty" };
    }

    let loaded = 0;
    for (const [protoPath, rawBlob] of Object.entries(payload)) {
      if (!protoPath || !protoPath.startsWith('/')) continue;
      const normalizedBlob = this.normalizeProtoDataBlob(rawBlob);
      if (!normalizedBlob) continue;
      this._protoDataBlobBatchCache.set(protoPath, normalizedBlob);
      loaded += 1;
    }

    return { count: loaded, source: forceRefresh ? "batch-refresh" : "batch" };
  }

  prefetchProtoMeshOverridesFromDriver(driver, options = {}) {
    const forceRefresh = options?.force === true;
    const resolvedDriver = driver || this.config?.driver?.();
    if (!resolvedDriver) {
      return {
        count: 0,
        collisionCount: 0,
        visualCount: 0,
        primOverrideCount: 0,
        source: "none",
      };
    }

    if (
      this._collisionProtoOverrideBatchPrimed === true
      && this._visualProtoOverrideBatchPrimed === true
      && !forceRefresh
    ) {
      const cachedCollisionCount = Number(this._collisionProtoOverrideCache?.size || 0);
      const cachedVisualCount = Number(this._visualProtoOverrideCache?.size || 0);
      if (cachedCollisionCount > 0 || cachedVisualCount > 0) {
        return {
          count: cachedCollisionCount + cachedVisualCount,
          collisionCount: cachedCollisionCount,
          visualCount: cachedVisualCount,
          primOverrideCount: 0,
          source: "cache",
        };
      }
    }

    this._collisionProtoOverrideBatchPrimed = true;
    this._visualProtoOverrideBatchPrimed = true;
    this._collisionProtoOverrideCache?.clear?.();
    this._visualProtoOverrideCache?.clear?.();
    if (forceRefresh) {
      this._primOverrideDataCache?.clear?.();
      this._resolvedProtoPrimPathCache?.clear?.();
      this._resolvedVisualPrimPathCache?.clear?.();
    }

    if (typeof resolvedDriver.GetProtoMeshOverrides !== 'function') {
      return {
        count: 0,
        collisionCount: 0,
        visualCount: 0,
        primOverrideCount: 0,
        source: "single-only",
      };
    }

    let payload = null;
    try {
      payload = resolvedDriver.GetProtoMeshOverrides();
    } catch {
      return {
        count: 0,
        collisionCount: 0,
        visualCount: 0,
        primOverrideCount: 0,
        source: "error",
      };
    }

    if (!payload || typeof payload !== 'object') {
      return {
        count: 0,
        collisionCount: 0,
        visualCount: 0,
        primOverrideCount: 0,
        source: "empty",
      };
    }

    const collisionPayload = (payload.collision && typeof payload.collision === 'object')
      ? payload.collision
      : {};
    const visualPayload = (payload.visual && typeof payload.visual === 'object')
      ? payload.visual
      : {};
    const primOverridePaths = new Set<string>();
    let collisionCount = 0;
    let visualCount = 0;

    const ingestOverride = (rawMeshId, rawOverride, sectionName) => {
      if (!rawMeshId || !String(rawMeshId).includes('.proto_')) return;
      const normalizedOverride = sectionName === 'collisions'
        ? this.normalizeCollisionProtoOverride(rawOverride)
        : this.normalizeVisualProtoOverride(rawOverride);
      if (!normalizedOverride) return;

      const normalizedMeshId = normalizeHydraPath(normalizedOverride.meshId || rawMeshId);
      if (!normalizedMeshId || !normalizedMeshId.includes('.proto_')) return;
      normalizedOverride.meshId = normalizedMeshId;

      if (sectionName === 'collisions') {
        this._collisionProtoOverrideCache.set(normalizedMeshId, normalizedOverride);
        collisionCount += 1;
      } else if (sectionName === 'visuals') {
        this._visualProtoOverrideCache.set(normalizedMeshId, normalizedOverride);
        visualCount += 1;
      } else {
        return;
      }

      this.cacheResolvedWorldTransformFromOverride(normalizedOverride);

      const resolvedPrimPath = normalizeHydraPath(normalizedOverride.resolvedPrimPath || '');
      if (resolvedPrimPath) {
        if (sectionName === 'collisions') {
          this._resolvedProtoPrimPathCache.set(normalizedMeshId, resolvedPrimPath);
        } else {
          this._resolvedVisualPrimPathCache.set(normalizedMeshId, resolvedPrimPath);
        }
      }

      const normalizedPrimOverride = this.normalizePrimOverrideData(rawOverride);
      if (!normalizedPrimOverride) return;
      const normalizedPrimPath = normalizeHydraPath(normalizedPrimOverride.resolvedPrimPath || '');
      if (!normalizedPrimPath) return;
      this._primOverrideDataCache.set(normalizedPrimPath, normalizedPrimOverride);
      primOverridePaths.add(normalizedPrimPath);
    };

    for (const [meshId, rawOverride] of Object.entries(collisionPayload)) {
      ingestOverride(meshId, rawOverride, 'collisions');
    }
    for (const [meshId, rawOverride] of Object.entries(visualPayload)) {
      ingestOverride(meshId, rawOverride, 'visuals');
    }

    return {
      count: collisionCount + visualCount,
      collisionCount,
      visualCount,
      primOverrideCount: primOverridePaths.size,
      source: forceRefresh ? "batch-refresh" : "batch",
    };
  }

  prefetchCollisionProtoOverridesFromDriver(driver, options = {}) {
    const forceRefresh = options?.force === true;
    const resolvedDriver = driver || this.config?.driver?.();
    if (!resolvedDriver) return { count: 0, source: "none" };
    if (this._collisionProtoOverrideBatchPrimed === true && !forceRefresh) {
      const cachedCount = Number(this._collisionProtoOverrideCache?.size || 0);
      if (cachedCount > 0) {
        return { count: cachedCount, source: "cache" };
      }
    }

    this._collisionProtoOverrideBatchPrimed = true;
    this._collisionProtoOverrideCache?.clear?.();

    if (typeof resolvedDriver.GetCollisionProtoOverrides !== 'function') {
      return { count: 0, source: "single-only" };
    }

    let payload = null;
    try {
      payload = resolvedDriver.GetCollisionProtoOverrides();
    } catch {
      return { count: 0, source: "error" };
    }

    if (!payload || typeof payload !== 'object') {
      return { count: 0, source: "empty" };
    }

    let loaded = 0;
    for (const [meshId, rawOverride] of Object.entries(payload)) {
      if (!meshId || !meshId.includes('.proto_')) continue;
      const normalizedOverride = this.normalizeCollisionProtoOverride(rawOverride);
      if (!normalizedOverride) continue;
      this._collisionProtoOverrideCache.set(meshId, normalizedOverride);
      this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
      loaded += 1;
    }

    return {
      count: loaded,
      source: forceRefresh ? "batch-refresh" : "batch",
    };
  }

  prefetchVisualProtoOverridesFromDriver(driver, options = {}) {
    const forceRefresh = options?.force === true;
    const resolvedDriver = driver || this.config?.driver?.();
    if (!resolvedDriver) return { count: 0, source: "none" };
    if (this._visualProtoOverrideBatchPrimed === true && !forceRefresh) {
      const cachedCount = Number(this._visualProtoOverrideCache?.size || 0);
      if (cachedCount > 0) {
        return { count: cachedCount, source: "cache" };
      }
    }

    this._visualProtoOverrideBatchPrimed = true;
    this._visualProtoOverrideCache?.clear?.();

    if (typeof resolvedDriver.GetVisualProtoOverrides !== 'function') {
      return { count: 0, source: "single-only" };
    }

    let payload = null;
    try {
      payload = resolvedDriver.GetVisualProtoOverrides();
    } catch {
      return { count: 0, source: "error" };
    }

    if (!payload || typeof payload !== 'object') {
      return { count: 0, source: "empty" };
    }

    let loaded = 0;
    for (const [meshId, rawOverride] of Object.entries(payload)) {
      if (!meshId || !meshId.includes('.proto_')) continue;
      const normalizedOverride = this.normalizeVisualProtoOverride(rawOverride);
      if (!normalizedOverride) continue;
      this._visualProtoOverrideCache.set(meshId, normalizedOverride);
      this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
      loaded += 1;
    }

    return {
      count: loaded,
      source: forceRefresh ? "batch-refresh" : "batch",
    };
  }

  prefetchPrimOverrideDataFromDriver(driver, primPaths = [], options = {}) {
    const forceRefresh = options?.force === true;
    const resolvedDriver = driver || this.config?.driver?.();
    if (!resolvedDriver) return { count: 0, source: "none" };

    const normalizedPaths = [];
    const seenPaths = new Set<string>();
    const ingestPath = (pathValue) => {
      const normalizedPath = normalizeHydraPath(pathValue);
      if (!normalizedPath || !normalizedPath.startsWith('/')) return;
      if (seenPaths.has(normalizedPath)) return;
      seenPaths.add(normalizedPath);
      normalizedPaths.push(normalizedPath);
    };

    if (Array.isArray(primPaths) || ArrayBuffer.isView(primPaths) || typeof primPaths?.length === 'number') {
      const length = Number(primPaths?.length);
      const safeLength = Number.isFinite(length) && length >= 0 ? Math.floor(length) : 0;
      for (let index = 0; index < safeLength; index++) {
        ingestPath(primPaths[index]);
      }
    } else if (primPaths && typeof primPaths[Symbol.iterator] === 'function') {
      for (const pathValue of primPaths as Iterable<unknown>) {
        ingestPath(pathValue);
      }
    }

    if (normalizedPaths.length === 0) return { count: 0, source: "empty" };
    if (forceRefresh) {
      for (const primPath of normalizedPaths) {
        this._primOverrideDataCache.delete(primPath);
      }
    }

    if (typeof resolvedDriver.GetPrimOverrideDataMap === 'function') {
      let payload = null;
      try {
        payload = resolvedDriver.GetPrimOverrideDataMap(normalizedPaths);
      } catch {
        payload = null;
      }

      if (payload && typeof payload === 'object') {
        let loaded = 0;
        for (const [primPath, rawData] of Object.entries(payload)) {
          const normalizedPath = normalizeHydraPath(primPath);
          if (!normalizedPath || !normalizedPath.startsWith('/')) continue;
          const normalizedData = this.normalizePrimOverrideData(rawData);
          if (!normalizedData) continue;
          this._primOverrideDataCache.set(normalizedPath, normalizedData);
          loaded += 1;
        }
        return {
          count: loaded,
          source: forceRefresh ? "batch-refresh" : "batch",
        };
      }
    }

    let loaded = 0;
    for (const primPath of normalizedPaths) {
      const normalizedData = this.getPrimOverrideData(primPath);
      if (!normalizedData) continue;
      loaded += 1;
    }
    return { count: loaded, source: "single" };
  }

  prefetchPrimPathSetFromDriver(driver, options = {}) {
    const forceRefresh = options?.force === true;
    if (!driver || typeof driver.GetPrimPathSet !== 'function') {
      return { count: 0, source: "none" };
    }
    if (this._knownPrimPathSetPrimed === true && this._knownPrimPathSet instanceof Set && !forceRefresh) {
      return { count: Number(this._knownPrimPathSet.size || 0), source: "cache" };
    }

    let payload = null;
    try {
      payload = driver.GetPrimPathSet();
    } catch {
      return { count: 0, source: "error" };
    }
    if (!payload) {
      this._knownPrimPathSet = new Set();
      this._knownPrimPathSetPrimed = true;
      return { count: 0, source: "empty" };
    }

    const nextPathSet = new Set<string>();
    const ingestPath = (pathValue: unknown) => {
      const normalizedPath = normalizeHydraPath(pathValue);
      if (!normalizedPath || !normalizedPath.startsWith('/')) return;
      nextPathSet.add(normalizedPath);
    };

    if (Array.isArray(payload) || ArrayBuffer.isView(payload) || typeof payload.length === 'number') {
      const length = Number(payload.length);
      const safeLength = Number.isFinite(length) && length >= 0 ? Math.floor(length) : 0;
      for (let index = 0; index < safeLength; index++) {
        ingestPath(payload[index]);
      }
    } else if (typeof payload[Symbol.iterator] === 'function') {
      for (const pathValue of payload as Iterable<unknown>) {
        ingestPath(pathValue);
      }
    }

    this._knownPrimPathSet = nextPathSet;
    this._knownPrimPathSetPrimed = true;

    // Keep the path existence cache bounded to currently known stage paths.
    for (const cachedPath of Array.from(this._primPathExistenceCache.keys())) {
      if (!nextPathSet.has(cachedPath)) {
        this._primPathExistenceCache.delete(cachedPath);
      }
    }
    for (const knownPath of nextPathSet) {
      if (!this._primPathExistenceCache.has(knownPath)) continue;
      if (this._primPathExistenceCache.get(knownPath) === false) {
        this._primPathExistenceCache.set(knownPath, true);
      }
    }

    return {
      count: nextPathSet.size,
      source: forceRefresh ? "batch-refresh" : "batch",
    };
  }

  warmupRuntimeBridgeFromDriver(driver, options = {}) {
    const resolvedDriver = driver || this.config?.driver?.();
    const forceRefresh = options?.force === true;
    const includePrimPathSet = options?.includePrimPathSet !== false;
    const includePrimTransforms = options?.includePrimTransforms !== false;
    const includeProtoDataBlobs = options?.includeProtoDataBlobs !== false;
    const includeCollisionProtoOverrides = options?.includeCollisionProtoOverrides !== false;
    const includeVisualProtoOverrides = options?.includeVisualProtoOverrides !== false;
    const includeResolvedPrimPathIndex = options?.includeResolvedPrimPathIndex !== false;
    const includeRobotMetadata = options?.includeRobotMetadata === true;
    const summary = {
      driverReady: !!resolvedDriver,
      primPathCount: 0,
      primPathSource: "none",
      protoBlobCount: 0,
      protoBlobSource: "none",
      collisionOverrideCount: 0,
      collisionOverrideSource: "none",
      visualOverrideCount: 0,
      visualOverrideSource: "none",
      primOverrideCount: 0,
      primOverrideSource: "none",
      worldTransformCount: 0,
      localTransformCount: 0,
      transformTotalCount: 0,
      transformSource: "none",
      protoMeshCount: 0,
      resolvedCollisionPrimCount: 0,
      resolvedVisualPrimCount: 0,
      robotMetadataWarmupStarted: false,
    };
    if (!resolvedDriver) return summary;

    const resolvedCollisionPrimPaths = [];
    let usedCombinedProtoOverridePrefetch = false;
    let combinedProtoOverrideSummary = null;

    if (includePrimPathSet) {
      try {
        const pathSummary = this.prefetchPrimPathSetFromDriver(resolvedDriver, { force: forceRefresh }) || {};
        summary.primPathCount = Number(pathSummary.count || 0);
        summary.primPathSource = String(pathSummary.source || "batch");
      } catch {}
    }

    if (includePrimTransforms) {
      try {
        const transformSummary = this.prefetchPrimTransformsFromDriver(resolvedDriver, { force: forceRefresh }) || {};
        summary.worldTransformCount = Number(transformSummary.world || 0);
        summary.localTransformCount = Number(transformSummary.local || 0);
        summary.transformTotalCount = Number(transformSummary.total || 0);
        summary.transformSource = String(transformSummary.source || "batch");
      } catch {}
    }

    if (includeProtoDataBlobs) {
      try {
        const protoSummary = this.prefetchProtoDataBlobsFromDriver(resolvedDriver, { force: forceRefresh }) || {};
        summary.protoBlobCount = Number(protoSummary.count || 0);
        summary.protoBlobSource = String(protoSummary.source || "batch");
      } catch {}
    }

    if (includeCollisionProtoOverrides && includeVisualProtoOverrides) {
      try {
        const combinedSummary = this.prefetchProtoMeshOverridesFromDriver(resolvedDriver, { force: forceRefresh }) || {};
        const combinedSource = String(combinedSummary.source || "none");
        if (combinedSource !== "single-only" && combinedSource !== "error") {
          usedCombinedProtoOverridePrefetch = true;
          combinedProtoOverrideSummary = combinedSummary;
          summary.collisionOverrideCount = Number(combinedSummary.collisionCount || 0);
          summary.collisionOverrideSource = combinedSource;
          summary.visualOverrideCount = Number(combinedSummary.visualCount || 0);
          summary.visualOverrideSource = combinedSource;
          summary.primOverrideCount = Number(combinedSummary.primOverrideCount || 0);
          summary.primOverrideSource = combinedSource;
        }
      } catch {}
    }

    if (includeCollisionProtoOverrides && !usedCombinedProtoOverridePrefetch) {
      try {
        const collisionSummary = this.prefetchCollisionProtoOverridesFromDriver(resolvedDriver, { force: forceRefresh }) || {};
        summary.collisionOverrideCount = Number(collisionSummary.count || 0);
        summary.collisionOverrideSource = String(collisionSummary.source || "batch");
      } catch {}
    }

    if (includeVisualProtoOverrides && !usedCombinedProtoOverridePrefetch) {
      try {
        const visualSummary = this.prefetchVisualProtoOverridesFromDriver(resolvedDriver, { force: forceRefresh }) || {};
        summary.visualOverrideCount = Number(visualSummary.count || 0);
        summary.visualOverrideSource = String(visualSummary.source || "batch");
      } catch {}
    }

    for (const meshId of Object.keys(this.meshes || {})) {
      if (!meshId || !meshId.includes('.proto_')) continue;
      const proto = this.registerMeshLinkPathIndex(meshId);
      if (!proto) continue;
      summary.protoMeshCount += 1;
      if (!includeResolvedPrimPathIndex) continue;
      if (proto.sectionName === 'collisions') {
        const resolvedCollisionPath = usedCombinedProtoOverridePrefetch
          ? normalizeHydraPath(this._collisionProtoOverrideCache.get(meshId)?.resolvedPrimPath || '')
          : this.getResolvedPrimPathForMeshId(meshId);
        if (resolvedCollisionPath) {
          summary.resolvedCollisionPrimCount += 1;
          resolvedCollisionPrimPaths.push(resolvedCollisionPath);
        }
      } else if (proto.sectionName === 'visuals') {
        const resolvedVisualPath = usedCombinedProtoOverridePrefetch
          ? normalizeHydraPath(this._visualProtoOverrideCache.get(meshId)?.resolvedPrimPath || '')
          : this.getResolvedVisualTransformPrimPathForMeshId(meshId);
        if (resolvedVisualPath) summary.resolvedVisualPrimCount += 1;
      }
    }

    if (!usedCombinedProtoOverridePrefetch && resolvedCollisionPrimPaths.length > 0) {
      try {
        const primOverrideSummary = this.prefetchPrimOverrideDataFromDriver(
          resolvedDriver,
          resolvedCollisionPrimPaths,
          { force: forceRefresh },
        ) || {};
        summary.primOverrideCount = Number(primOverrideSummary.count || 0);
        summary.primOverrideSource = String(primOverrideSummary.source || "batch");
      } catch {}
    } else if (usedCombinedProtoOverridePrefetch && combinedProtoOverrideSummary) {
      summary.primOverrideCount = Number(combinedProtoOverrideSummary.primOverrideCount || summary.primOverrideCount || 0);
      summary.primOverrideSource = String(combinedProtoOverrideSummary.source || summary.primOverrideSource || "batch");
    }

    const resolvedStageSourcePath = String(this.getStageSourcePath() || '').split('?')[0];
    if (resolvedStageSourcePath) {
      this._runtimeBridgeCacheStageKey = resolvedStageSourcePath;
    }

    if (includeRobotMetadata && typeof this.startRobotMetadataWarmupForStage === 'function') {
      try {
        const maybePromise = this.startRobotMetadataWarmupForStage({ force: forceRefresh });
        summary.robotMetadataWarmupStarted = !!maybePromise;
      } catch {
        summary.robotMetadataWarmupStarted = false;
      }
    }

    return summary;
  }

  getProtoDataBlob(protoPath) {
    if (!protoPath || !protoPath.startsWith('/')) return null;
    if (!this.config?.driver || typeof this.config.driver !== 'function') return null;

    const driver = this.config.driver();
    if (!driver || typeof driver.GetProtoDataBlob !== 'function') return null;

    // Hot path: prefer cache hit or single-proto fetch. Avoid forcing
    // GetAllProtoDataBlobs() here, which can create large first-sync stalls.
    const cached = this._protoDataBlobBatchCache.get(protoPath);
    if (cached) return cached;
    if (this.autoBatchProtoBlobsOnFirstAccess === true && this._protoDataBlobBatchPrimed !== true) {
      try {
        this.prefetchProtoDataBlobsFromDriver(driver, { force: false });
        const batchCached = this._protoDataBlobBatchCache.get(protoPath);
        if (batchCached) return batchCached;
      } catch {
        // Fall through to per-proto fallback.
      }
    }

    try {
      const blob = driver.GetProtoDataBlob(protoPath);
      const normalizedBlob = this.normalizeProtoDataBlob(blob);
      if (!normalizedBlob) return null;
      this._protoDataBlobBatchCache.set(protoPath, normalizedBlob);
      return normalizedBlob;
    } catch {
      return null;
    }
  }

  getCollisionProtoOverride(meshId) {
    if (!meshId || !meshId.includes('.proto_')) return null;
    if (!this.config?.driver || typeof this.config.driver !== 'function') return null;

    if (this._collisionProtoOverrideCache.has(meshId)) {
      const cached = this._collisionProtoOverrideCache.get(meshId);
      return cached || null;
    }

    const driver = this.config.driver();
    if (!driver) return null;

    if (this.autoBatchCollisionProtoOverridesOnFirstAccess === true && this._collisionProtoOverrideBatchPrimed !== true) {
      try {
        this.prefetchProtoMeshOverridesFromDriver(driver, { force: false });
        const batchCached = this._collisionProtoOverrideCache.get(meshId);
        if (batchCached) return batchCached;
      } catch {
        try {
          this.prefetchCollisionProtoOverridesFromDriver(driver, { force: false });
          const batchCached = this._collisionProtoOverrideCache.get(meshId);
          if (batchCached) return batchCached;
        } catch {
          // Fall through to per-mesh fetch.
        }
      }
    }

    if (typeof driver.GetCollisionProtoOverride !== 'function') return null;
    try {
      const rawOverride = driver.GetCollisionProtoOverride(meshId);
      const normalizedOverride = this.normalizeCollisionProtoOverride(rawOverride);
      if (!normalizedOverride) return null;
      this._collisionProtoOverrideCache.set(meshId, normalizedOverride);
      this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
      return normalizedOverride;
    } catch {
      return null;
    }
  }

  getVisualProtoOverride(meshId) {
    if (!meshId || !meshId.includes('.proto_')) return null;
    if (!this.config?.driver || typeof this.config.driver !== 'function') return null;

    if (this._visualProtoOverrideCache.has(meshId)) {
      const cached = this._visualProtoOverrideCache.get(meshId);
      return cached || null;
    }

    const driver = this.config.driver();
    if (!driver) return null;

    if (this.autoBatchVisualProtoOverridesOnFirstAccess === true && this._visualProtoOverrideBatchPrimed !== true) {
      try {
        this.prefetchProtoMeshOverridesFromDriver(driver, { force: false });
        const batchCached = this._visualProtoOverrideCache.get(meshId);
        if (batchCached) return batchCached;
      } catch {
        try {
          this.prefetchVisualProtoOverridesFromDriver(driver, { force: false });
          const batchCached = this._visualProtoOverrideCache.get(meshId);
          if (batchCached) return batchCached;
        } catch {
          // Fall through to per-mesh fetch.
        }
      }
    }

    if (typeof driver.GetVisualProtoOverride !== 'function') return null;
    try {
      const rawOverride = driver.GetVisualProtoOverride(meshId);
      const normalizedOverride = this.normalizeVisualProtoOverride(rawOverride);
      if (!normalizedOverride) return null;
      this._visualProtoOverrideCache.set(meshId, normalizedOverride);
      this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
      return normalizedOverride;
    } catch {
      return null;
    }
  }

  getPrimOverrideData(primPath) {
    const normalizedPath = normalizeHydraPath(primPath);
    if (!normalizedPath || !normalizedPath.startsWith('/')) return null;
    if (!this.config?.driver || typeof this.config.driver !== 'function') return null;

    if (this._primOverrideDataCache.has(normalizedPath)) {
      const cached = this._primOverrideDataCache.get(normalizedPath);
      return cached || null;
    }

    const driver = this.config.driver();
    if (!driver || typeof driver.GetPrimOverrideData !== 'function') return null;

    try {
      const rawData = driver.GetPrimOverrideData(normalizedPath);
      const normalizedData = this.normalizePrimOverrideData(rawData);
      if (!normalizedData) return null;
      this._primOverrideDataCache.set(normalizedPath, normalizedData);
      return normalizedData;
    } catch {
      return null;
    }
  }

  prefetchPrimTransformsFromDriver(driver, options = {}) {
    const forceRefresh = options?.force === true;
    if (!driver || typeof driver.GetPrimTransforms !== 'function') {
      return { world: 0, local: 0, total: 0, source: "none" };
    }
    if (this._primTransformBatchPrimed === true && !forceRefresh) {
      const world = Number(this._worldXformCache?.size || 0);
      const local = Number(this._localXformCache?.size || 0);
      return { world, local, total: Math.max(world, local), source: "cache" };
    }
    this._primTransformBatchPrimed = true;

    let payload = null;
    try {
      payload = driver.GetPrimTransforms();
    } catch {
      return { world: 0, local: 0, total: 0, source: "error" };
    }
    if (!payload || typeof payload !== 'object') {
      return { world: 0, local: 0, total: 0, source: "empty" };
    }

    const ingestTransformMap = (sourceMap, targetCache) => {
      if (!sourceMap || typeof sourceMap !== 'object') return 0;
      let loaded = 0;
      for (const [primPath, rawMatrix] of Object.entries(sourceMap)) {
        if (!primPath || !primPath.startsWith('/')) continue;
        const matrix = this.matrixFromWasmTransform(rawMatrix);
        if (!matrix) continue;
        targetCache.set(primPath, matrix);
        loaded += 1;
      }
      return loaded;
    };

    this._localXformCache.clear();
    this._worldXformCache.clear();
    this._meshFallbackCache.clear();
    this._linkVisualTransformCache.clear();
    this._urdfLinkWorldTransformCacheByStageSource.clear();

    const world = ingestTransformMap(payload.world, this._worldXformCache);
    const local = ingestTransformMap(payload.local, this._localXformCache);
    const total = Number(payload.count);
    return {
      world,
      local,
      total: Number.isFinite(total) ? total : Math.max(world, local),
      source: forceRefresh ? "batch-refresh" : "batch",
    };
  }

  getWorldTransformForPrimPath(primPath, options = {}) {
    if (!this || typeof this !== 'object') return null;
    if (!primPath || !primPath.startsWith('/')) return null;
    const shouldClone = options?.clone !== false;

    if (this._worldXformCache.has(primPath)) {
      const cached = this._worldXformCache.get(primPath);
      if (!cached) return null;
      return shouldClone ? cached.clone() : cached;
    }
    if (this.autoBatchPrimTransformsOnFirstAccess === true && this._primTransformBatchPrimed !== true) {
      const driver = this.config?.driver?.();
      if (driver) {
        try {
          this.prefetchPrimTransformsFromDriver(driver, { force: false });
        } catch {
          // Keep fallback path resilient.
        }
      }
      if (this._worldXformCache.has(primPath)) {
        const batchCached = this._worldXformCache.get(primPath);
        if (!batchCached) return null;
        return shouldClone ? batchCached.clone() : batchCached;
      }
    }

    const stage = this.getStage();
    if (!stage) return null;

    const pathSegments = primPath.split('/').filter(Boolean);
    const worldMatrix = new Matrix4().identity();
    let currentPath = '';
    let hasTransform = false;

    for (const pathSegment of pathSegments) {
      currentPath += '/' + pathSegment;
      const localMatrix = this.getLocalTransformForPrimPath(stage, currentPath, { clone: false });
      if (!localMatrix) continue;
      worldMatrix.multiply(localMatrix);
      hasTransform = true;
    }

    // For collision prims (and other prims) that may have only identity transforms,
    // we should return the identity matrix instead of null.
    // This ensures collision geometry gets proper transforms from parent nodes.
    const result = hasTransform ? worldMatrix : new Matrix4().identity();
    const cachedResult = result.clone();
    this._worldXformCache.set(primPath, cachedResult);
    return shouldClone ? cachedResult.clone() : cachedResult;
  }

  getLocalTransformForPrimPath(stage, primPath, options = {}) {
    if (!this || typeof this !== 'object') return null;
    const shouldClone = options?.clone !== false;
    if (this._localXformCache.has(primPath)) {
      const cached = this._localXformCache.get(primPath);
      if (!cached) return null;
      return shouldClone ? cached.clone() : cached;
    }

    if (!stage || typeof stage.GetPrimAtPath !== 'function') {
      this._localXformCache.set(primPath, null);
      return null;
    }

    let prim = null;
    try {
      prim = stage.GetPrimAtPath(primPath);
    } catch {
      this._localXformCache.set(primPath, null);
      return null;
    }
    if (!prim) {
      this._localXformCache.set(primPath, null);
      return null;
    }
    if (typeof prim.GetAttribute !== 'function') {
      this._localXformCache.set(primPath, null);
      return null;
    }

    const allowLayerTextXformFallback = this.enableXformOpFallbackFromLayerText === true;
    let xformOrder = [];
    const xformOpOrderAttr = prim.GetAttribute('xformOpOrder');
    if (xformOpOrderAttr) {
      try {
        xformOrder = xformOpOrderAttr.Get() || [];
      } catch {
      }
    }

    if (!Array.isArray(xformOrder) && xformOrder && typeof xformOrder[Symbol.iterator] === 'function') {
      xformOrder = Array.from(xformOrder);
    }
    if (Array.isArray(xformOrder)) {
      xformOrder = xformOrder
        .map((entry) => normalizeHydraPath(entry))
        .filter((entry) => !!entry);
    }

    if (!Array.isArray(xformOrder) || xformOrder.length === 0) {
      let fallbackOps = [];
      try {
        fallbackOps = prim.GetPropertyNames?.() || [];
      } catch {
        fallbackOps = [];
      }
      fallbackOps = Array.isArray(fallbackOps) ? fallbackOps : Array.from(fallbackOps || []);
      fallbackOps = fallbackOps
        .map((name) => normalizeHydraPath(name))
        .filter((name) => !!name && name.startsWith('xformOp:') && name !== 'xformOpOrder');
      xformOrder = fallbackOps;
    }

    if (xformOrder.length === 0 && allowLayerTextXformFallback) {
      const fallbackOpNames = this.getFallbackXformOpNamesForPrimPath(primPath);
      if (Array.isArray(fallbackOpNames) && fallbackOpNames.length > 0) {
        xformOrder = fallbackOpNames
          .map((entry) => normalizeHydraPath(entry))
          .filter((entry) => !!entry && entry.startsWith('xformOp:'));
      }
    }

    if (xformOrder.length === 0) {
      // Return identity matrix for prims with no explicit transform (like primitive geometry nodes)
      // This allows parent transforms to be properly applied through the hierarchy
      const identityMatrix = new Matrix4().identity();
      this._localXformCache.set(primPath, identityMatrix);
      return shouldClone ? identityMatrix.clone() : identityMatrix;
    }

    const localMatrix = new Matrix4().identity();
    let hasTransform = false;
    const invertPrefix = '!invert!';

    for (const rawOpName of xformOrder) {
      const opToken = normalizeHydraPath(rawOpName);
      if (!opToken) continue;

      if (opToken === '!resetXformStack!') {
        localMatrix.identity();
        hasTransform = true;
        continue;
      }

      let opName = opToken;
      let invert = false;
      if (opName.startsWith(invertPrefix)) {
        invert = true;
        opName = opName.substring(invertPrefix.length);
      }

      let opValue = undefined;
      let opReadError = null;
      try {
        opValue = prim.GetAttribute(opName)?.Get();
      } catch (error) {
        opReadError = error;
        opValue = allowLayerTextXformFallback
          ? this.getFallbackXformOpValueForPrimPath(primPath, opName)
          : undefined;
      }

      if (opValue === undefined || opValue === null) {
        const errorText = String(opReadError || '');
        const isQuatReadFailure = (
          opName.startsWith('xformOp:orient')
          && errorText.includes('BindingError')
          && errorText.includes('GfQuat')
        );
        if (isQuatReadFailure) {
          // Quat reads can fail in WASM bindings for some prims. Try fast root-layer
          // fallback first, then URDF collision fallback, and escalate to full layer
          // scan only when necessary.
          if (typeof this.getRootLayerFallbackXformOpValueForPrimPath === 'function') {
            opValue = this.getRootLayerFallbackXformOpValueForPrimPath(primPath, opName);
          }
          if ((opValue === undefined || opValue === null) && typeof this.getUrdfFallbackXformOpValueForPrimPath === 'function') {
            opValue = this.getUrdfFallbackXformOpValueForPrimPath(primPath, opName);
          }
          if (opValue === undefined || opValue === null) {
            opValue = this.getFallbackXformOpValueForPrimPath(primPath, opName);
          }
        }
      }

      if ((opValue === undefined || opValue === null) && allowLayerTextXformFallback) {
        opValue = this.getFallbackXformOpValueForPrimPath(primPath, opName);
      }
      if (opValue === undefined || opValue === null) continue;

      const opMatrix = createMatrixFromXformOp(opName, opValue);
      if (!opMatrix) continue;

      if (invert) opMatrix.invert();
      localMatrix.multiply(opMatrix);
      hasTransform = true;
    }

    const result = hasTransform ? localMatrix : null;
    const cachedResult = result ? result.clone() : null;
    this._localXformCache.set(primPath, cachedResult);
    if (!cachedResult) return null;
    return shouldClone ? cachedResult.clone() : cachedResult;
  }

  /**
   * Render Prims. See webRenderDelegate.h and webRenderDelegate.cpp
   * @param {string} typeId // translated from TfToken
   * @param {string} id // SdfPath.GetAsString()
   * @param {*} instancerId
   * @returns 
   */
  createNoopRPrim() {
    const noop = () => {};
    return new Proxy({}, {
      get() {
        return noop;
      },
    });
  }

  createRPrim(typeId, id, instancerId) {
    const normalizedId = normalizeHydraPath(id);
    const normalizedInstancerId = normalizeHydraPath(instancerId);
    const loweredId = String(normalizedId || '').toLowerCase();
    const isCollisionPrim = loweredId.includes('/collisions.') || loweredId.includes('/collisions/');
    if (this.loadVisualPrims === false && !isCollisionPrim) {
      return this.createNoopRPrim();
    }
    if (!isCollisionPrim && Number.isFinite(this.maxVisualPrims) && this.maxVisualPrims >= 0) {
      if ((this.loadedVisualPrimCount || 0) >= this.maxVisualPrims) {
        return this.createNoopRPrim();
      }
      this.loadedVisualPrimCount = (this.loadedVisualPrimCount || 0) + 1;
    }
    if (this.loadCollisionPrims === false && !normalizedInstancerId) {
      if (isCollisionPrim) {
        return this.createNoopRPrim();
      }
    }
    let mesh = new HydraMesh(typeId, normalizedId, this, normalizedInstancerId);
    if (normalizedInstancerId) {
        // This is a prototype for an instancer. Hide it by default.
        // The instancer will manage the display of instances.
        mesh._mesh.visible = false;
        mesh.isPrototype = true;
        // console.log("Hiding prototype mesh:", id, "for instancer:", instancerId);
    }
    this.meshes[normalizedId] = mesh;
    this.registerMeshLinkPathIndex(normalizedId);
    this.updateRepresentativeVisualTransformIndex(normalizedId, mesh?._mesh?.matrix);
    return wrapHydraCallbackObject(mesh, "RPrim");
  }

  createBPrim(typeId, id) {
    /*let mesh = new HydraMesh(id, this);
    this.meshes[id] = mesh;
    return mesh;*/
  }

  createInstancer(typeId, id) {
      const normalizedId = normalizeHydraPath(id);
      let instancer = new HydraInstancer(normalizedId, this);
      this.instancers[normalizedId] = instancer;
      return wrapHydraCallbackObject(instancer, "Instancer");
  }

  createSPrim(typeId, id) {
    const normalizedId = normalizeHydraPath(id);

    if (typeId === 'material') {
      if (this.loadVisualPrims === false) {
        return undefined;
      }
      let material = new HydraMaterial(normalizedId, this);
      this.materials[normalizedId] = material;
      return wrapHydraCallbackObject(material, "SPrimMaterial");
    } else if (typeId === 'skeleton') {
      let skeleton = new HydraSkeleton(normalizedId, this);
      this.skeletons[normalizedId] = skeleton;
      return wrapHydraCallbackObject(skeleton, "SPrimSkeleton");
    } else {
      return undefined;
    }
  }

  CommitResources() {
    const phaseInstrumentationEnabled = this.isHydraPhaseInstrumentationEnabled?.() === true;
    const commitStartedAtMs = phaseInstrumentationEnabled ? this._nowPerfMs?.() : 0;
    const activeDrawSeq = Number(this._hydraPhasePerfState?.activeDraw?.seq || this._hydraPhasePerfState?.drawSeq || 0);
    const commitStartMark = phaseInstrumentationEnabled
      ? `hydra.phase.commit.${activeDrawSeq}.start`
      : '';
    const commitProfile = phaseInstrumentationEnabled
      ? {
        meshCount: 0,
        meshTotalMs: 0,
        pendingMaterialMs: 0,
        primitiveFallbackMs: 0,
        normalFallbackMs: 0,
        visualColorMs: 0,
        inheritMaterialMs: 0,
        protoSyncMs: 0,
      }
      : null;
    if (phaseInstrumentationEnabled && commitStartMark) {
      this._markPerf?.(commitStartMark);
    }

    const hasSyncHotPathGuard = typeof this.enterHydraSyncHotPath === 'function'
      && typeof this.leaveHydraSyncHotPath === 'function';
    if (hasSyncHotPathGuard) {
      this.enterHydraSyncHotPath();
    }
    try {
      for (const id in this.meshes) {
        const hydraMesh = this.meshes[id]
        hydraMesh.commit(commitProfile);
      }
      for (const id in this.instancers) {
        const instancer = this.instancers[id];
        instancer.commit();
      }
    } finally {
      if (hasSyncHotPathGuard) {
        this.leaveHydraSyncHotPath();
      }
    }

    if (phaseInstrumentationEnabled) {
      const commitEndedAtMs = this._nowPerfMs?.() || commitStartedAtMs;
      const commitMs = Math.max(0, Number(commitEndedAtMs) - Number(commitStartedAtMs || commitEndedAtMs));
      const commitEndMark = `hydra.phase.commit.${activeDrawSeq}.end`;
      this._markPerf?.(commitEndMark);
      this._measurePerf?.(`hydra.phase.commit.${activeDrawSeq}`, commitStartMark, commitEndMark);
      this.recordHydraCommitPhase?.(commitMs);
      void commitMs;
    }
  }
}
