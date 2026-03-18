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
import * as Shared from './shared.js?v=20260318a';
import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js?v=20260317d';
import { HydraInstancer } from './HydraInstancer.js?v=20260315c';
import { HydraMaterial } from './HydraMaterial.js?v=20260315c';
import { HydraMesh } from './HydraMesh.js?v=20260317d';
import { getDefaultMaterial } from './default-material-state.js?v=20260315c';

const { buildProtoPrimPathCandidates,clamp01,createMatrixFromXformOp,debugInstancer,debugMaterials,debugMeshes,debugPrims,debugTextures,defaultGrayComponent,disableMaterials,disableTextures,extractPrimPathFromMaterialBindingWarning,extractReferencePrimTargets,extractScopeBodyText,extractUsdAssetReferencesFromLayerText,getActiveMaterialBindingWarningOwner,getAngleInRadians,getCollisionGeometryTypeFromUrdfElement,getExpectedPrimTypesForCollisionProto,getExpectedPrimTypesForProtoType,getMatrixMaxElementDelta,getPathBasename,getPathWithoutRoot,getRawConsoleMethod,getRootPathFromPrimPath,getSafePrimTypeName,hasNonZeroTranslation,hydraCallbackErrorCounts,installMaterialBindingApiWarningInterceptor,isIdentityQuaternion,isLikelyDefaultGrayMaterial,isLikelyInverseTransform,isMaterialBindingApiWarningMessage,isMatrixApproximatelyIdentity,isNonZero,isPotentiallyLargeBaseAssetPath,logHydraCallbackError,materialBindingRepairMaxLayerTextLength,materialBindingWarningHandlers,maxHydraCallbackErrorLogsPerMethod,nearlyEqual,normalizeHydraPath,normalizeUsdPathToken,parseGuideCollisionReferencesFromLayerText,parseProtoMeshIdentifier,parseUrdfTruthFromText,parseVector3Text,parseXformOpFallbacksFromLayerText,rawConsoleError,rawConsoleWarn,registerMaterialBindingApiWarningHandler,remapRootPathIfNeeded,resolveUrdfTruthFileNameForStagePath,resolveUsdAssetPath,setActiveMaterialBindingWarningOwner,shouldAllowLargeBaseAssetScan,stringifyConsoleArgs,toArrayLike,toColorArray,toFiniteNumber,toFiniteQuaternionWxyzTuple,toFiniteVector2Tuple,toFiniteVector3Tuple,toMatrixFromUrdfOrigin,toQuaternionWxyzFromRpy,transformEpsilon,wrapHydraCallbackObject } = Shared;

const COLLISION_SEGMENT_PATTERN = /(?:^|\/)collisions?(?:$|[/.])/i;

export class ThreeRenderDelegateInterface extends ThreeRenderDelegateMaterialOps {
  applyStageFallbackMaterialParameters(material, shaderPrim) {
    if (!material || !shaderPrim) return;
    const treatNamedHexDiffuseAsSrgb = this.shouldTreatNamedHexDiffuseAsSrgb();
    const isOmniPbrShader = this.isLikelyOmniPbrShaderPrim(shaderPrim);
    const emissiveEnabled = this.readPrimBooleanAttribute(shaderPrim, [
      'inputs:enable_emission',
      'inputs:enableEmission',
    ]);
    const opacityEnabled = this.readPrimBooleanAttribute(shaderPrim, [
      'inputs:enable_opacity',
      'inputs:enableOpacity',
    ]);
    const opacityTextureEnabled = this.readPrimBooleanAttribute(shaderPrim, [
      'inputs:enable_opacity_texture',
      'inputs:enableOpacityTexture',
    ]);

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

    const roughnessAssigned = this.applyStageFallbackScalarInput(material, shaderPrim, [
      'inputs:roughness',
      'inputs:roughness_constant',
      'inputs:reflection_roughness',
      'inputs:reflection_roughness_constant',
      'inputs:specular_roughness',
    ], 'roughness', { clamp01: true });
    if (!roughnessAssigned && isOmniPbrShader) {
      // OmniPBR often omits explicit roughness attributes in exported USD.
      // A middle-ground default avoids the fully matte MeshPhysical default.
      material.roughness = 0.5;
    }

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

    if (opacityEnabled === false) {
      material.opacity = 1;
      material.transparent = false;
      material.alphaTest = 0;
    }

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

    if (emissiveEnabled === false) {
      material.emissive = new Color(0x000000);
      material.emissiveIntensity = 1;
    } else {
      this.applyStageFallbackScalarInput(material, shaderPrim, [
        'inputs:emissive_intensity',
      ], 'emissiveIntensity', { min: 0 });
    }

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

    if (emissiveEnabled !== false) {
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
    }

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

    if (opacityEnabled !== false && opacityTextureEnabled !== false) {
      this.applyStageFallbackTextureInput(material, shaderPrim, [
        'inputs:opacity_texture',
        'inputs:opacity_mask_texture',
        'inputs:opacityMask_texture',
      ], 'alphaMap', {
        onAssigned: () => {
          if (!(material.alphaTest > 0)) material.transparent = true;
        },
      });
    }

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
    const inferredHex = this.inferColorHexFromMaterialName(material?.name);
    if (
      Number.isFinite(inferredHex)
      && color.every((channel) => Math.abs(channel - 1) <= 1e-4)
      && inferredHex !== 0xffffff
    ) {
      nextColor = new Color(inferredHex);
    }

    if (options.treatAsSrgbWhenMatchingMaterialName && material?.name) {
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
      const allowOnDemandPrimPathBatch = this.autoBatchPrimTransformsOnFirstAccess === true
        || this.autoBatchProtoBlobsOnFirstAccess === true
        || this.autoBatchCollisionProtoOverridesOnFirstAccess === true
        || this.autoBatchVisualProtoOverridesOnFirstAccess === true;
      if (allowOnDemandPrimPathBatch) {
        const driver = this.config?.driver?.();
        if (driver) {
          try {
            this.prefetchPrimPathSetFromDriver(driver, { force: false });
          } catch {
            // Keep fallback path resilient.
          }
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
    const basename = normalized.split('/').filter(Boolean).pop() || normalized;
    const decimalRgbMatch = basename.match(/^material_(\d{3})(\d{3})(\d{3})$/i);
    if (decimalRgbMatch) {
      const red = Number.parseInt(decimalRgbMatch[1], 10);
      const green = Number.parseInt(decimalRgbMatch[2], 10);
      const blue = Number.parseInt(decimalRgbMatch[3], 10);
      const isValidTriplet = [red, green, blue].every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255);
      if (isValidTriplet) {
        return (red << 16) | (green << 8) | blue;
      }
    }
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

  readPrimBooleanAttribute(prim, attributeNames) {
    const value = this.readPrimAttribute(prim, attributeNames);
    if (typeof value === 'boolean') return value;

    const numeric = toFiniteNumber(value);
    if (numeric !== undefined) return numeric !== 0;

    if (value === null || value === undefined) return undefined;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return undefined;
  }

  isLikelyOmniPbrShaderPrim(shaderPrim) {
    if (!shaderPrim) return false;
    const signatures = [
      this.readPrimAttribute(shaderPrim, ['info:id']),
      this.readPrimAttribute(shaderPrim, ['info:mdl:sourceAsset:subIdentifier']),
      this.readPrimAttribute(shaderPrim, ['info:mdl:sourceAsset']),
    ];
    return signatures.some((value) => String(value || '').toLowerCase().includes('omnipbr'));
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
    const normalizeGeomSubsetSections = (value) => {
      if (!value || typeof value.length !== 'number') return [];
      const out = [];
      const length = Number(value.length);
      const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
      for (let index = 0; index < safeLength; index += 1) {
        const rawSection = value[index];
        const start = Number(rawSection?.start);
        const sectionLength = Number(rawSection?.length);
        if (!Number.isFinite(start) || !Number.isFinite(sectionLength) || sectionLength <= 0) continue;
        out.push({
          start: Math.max(0, Math.floor(start)),
          length: Math.max(0, Math.floor(sectionLength)),
          materialId: typeof rawSection?.materialId === 'string'
            ? normalizeHydraPath(rawSection.materialId)
            : '',
        });
      }
      return out;
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
      geomSubsetSections: normalizeGeomSubsetSections((rawBlob as any).geomSubsetSections),
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
    const meshPayload = primType === 'mesh'
      ? (this.normalizeProtoDataBlob((rawOverride as any).meshPayload || rawOverride) || null)
      : null;

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
      meshPayload: meshPayload || undefined,
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
    const meshPayload = primType === 'mesh'
      ? (this.normalizeProtoDataBlob((rawData as any).meshPayload || rawData) || null)
      : null;

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
      meshPayload: meshPayload || undefined,
    };
  }

  prefetchProtoDataBlobsFromDriver(driver, options = {}) {
      const forceRefresh = options?.force === true;
      const resolvedDriver = driver || this.config?.driver?.();
      if (!resolvedDriver)
          return { count: 0, source: "none" };
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
      }
      catch {
          return { count: 0, source: "error" };
      }
      if (!payload || typeof payload !== 'object') {
          return { count: 0, source: "empty" };
      }
      let loaded = 0;
      for (const [protoPath, rawBlob] of Object.entries(payload)) {
          if (!protoPath || !protoPath.startsWith('/'))
              continue;
          const normalizedBlob = this.normalizeProtoDataBlob(rawBlob);
          if (!normalizedBlob)
              continue;
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
      if (this._collisionProtoOverrideBatchPrimed === true
          && this._visualProtoOverrideBatchPrimed === true
          && !forceRefresh) {
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
      }
      catch {
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
      const primOverridePaths = new Set();
      let collisionCount = 0;
      let visualCount = 0;
      const ingestOverride = (rawMeshId, rawOverride, sectionName) => {
          if (!rawMeshId || !String(rawMeshId).includes('.proto_'))
              return;
          const normalizedOverride = sectionName === 'collisions'
              ? this.normalizeCollisionProtoOverride(rawOverride)
              : this.normalizeVisualProtoOverride(rawOverride);
          if (!normalizedOverride)
              return;
          const normalizedMeshId = normalizeHydraPath(normalizedOverride.meshId || rawMeshId);
          if (!normalizedMeshId || !normalizedMeshId.includes('.proto_'))
              return;
          normalizedOverride.meshId = normalizedMeshId;
          if (sectionName === 'collisions') {
              this._collisionProtoOverrideCache.set(normalizedMeshId, normalizedOverride);
              collisionCount += 1;
          }
          else if (sectionName === 'visuals') {
              this._visualProtoOverrideCache.set(normalizedMeshId, normalizedOverride);
              visualCount += 1;
          }
          else {
              return;
          }
          this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
          const resolvedPrimPath = normalizeHydraPath(normalizedOverride.resolvedPrimPath || '');
          if (resolvedPrimPath) {
              if (sectionName === 'collisions') {
                  this._resolvedProtoPrimPathCache.set(normalizedMeshId, resolvedPrimPath);
              }
              else {
                  this._resolvedVisualPrimPathCache.set(normalizedMeshId, resolvedPrimPath);
              }
          }
          const normalizedPrimOverride = this.normalizePrimOverrideData(rawOverride);
          if (!normalizedPrimOverride)
              return;
          const normalizedPrimPath = normalizeHydraPath(normalizedPrimOverride.resolvedPrimPath || '');
          if (!normalizedPrimPath)
              return;
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
  prefetchFinalStageOverrideBatchFromDriver(driver, options = {}) {
      const forceRefresh = options?.force === true;
      const resolvedDriver = driver || this.config?.driver?.();
      if (!resolvedDriver) {
          return {
              count: 0,
              collisionCount: 0,
              visualCount: 0,
              protoMeshCount: Number(this._finalStageOverrideBatchProtoMeshCount || 0),
              source: "none",
              entries: this._finalStageOverrideBatchCache,
          };
      }
      if (this._finalStageOverrideBatchPrimed === true && !forceRefresh) {
          const cachedCount = Number(this._finalStageOverrideBatchCache?.size || 0);
          if (cachedCount > 0) {
              return {
                  count: cachedCount,
                  collisionCount: Number(this._collisionProtoOverrideCache?.size || 0),
                  visualCount: Number(this._visualProtoOverrideCache?.size || 0),
                  protoMeshCount: Number(this._finalStageOverrideBatchProtoMeshCount || 0),
                  source: "cache",
                  entries: this._finalStageOverrideBatchCache,
              };
          }
      }
      if (forceRefresh) {
          this._collisionProtoOverrideCache?.clear?.();
          this._visualProtoOverrideCache?.clear?.();
          this._primOverrideDataCache?.clear?.();
          this._resolvedProtoPrimPathCache?.clear?.();
          this._resolvedVisualPrimPathCache?.clear?.();
          this._finalStageOverrideBatchProtoMeshCount = 0;
      }
      this._finalStageOverrideBatchPrimed = true;
      this._finalStageOverrideBatchCache?.clear?.();
      if (typeof resolvedDriver.GetFinalStageOverrideBatch !== 'function') {
          return {
              count: 0,
              collisionCount: 0,
              visualCount: 0,
              protoMeshCount: 0,
              source: "single-only",
              entries: this._finalStageOverrideBatchCache,
          };
      }
      let payload = null;
      try {
          payload = resolvedDriver.GetFinalStageOverrideBatch();
      }
      catch {
          return {
              count: 0,
              collisionCount: 0,
              visualCount: 0,
              protoMeshCount: 0,
              source: "error",
              entries: this._finalStageOverrideBatchCache,
          };
      }
      if (!payload || typeof payload !== 'object') {
          this._finalStageOverrideBatchProtoMeshCount = 0;
          return {
              count: 0,
              collisionCount: 0,
              visualCount: 0,
              protoMeshCount: 0,
              source: "empty",
              entries: this._finalStageOverrideBatchCache,
          };
      }
      const payloadProtoMeshCount = Number(payload.protoMeshCount);
      this._finalStageOverrideBatchProtoMeshCount = Number.isFinite(payloadProtoMeshCount)
          ? Math.max(0, Math.floor(payloadProtoMeshCount))
          : 0;
      const rawEntries = (payload.entries && typeof payload.entries === 'object')
          ? payload.entries
          : {};
      let collisionCount = 0;
      let visualCount = 0;
      const primOverridePaths = new Set();
      for (const [meshId, rawOverride] of Object.entries(rawEntries)) {
          const normalizedMeshId = normalizeHydraPath(meshId);
          if (!normalizedMeshId || !normalizedMeshId.includes('.proto_'))
              continue;
          const sectionName = String(rawOverride?.sectionName || '').toLowerCase();
          const normalizedOverride = sectionName === 'visuals'
              ? this.normalizeVisualProtoOverride(rawOverride)
              : this.normalizeCollisionProtoOverride(rawOverride);
          if (!normalizedOverride)
              continue;
          normalizedOverride.meshId = normalizeHydraPath(normalizedOverride.meshId || normalizedMeshId);
          normalizedOverride.sectionName = sectionName || (normalizedOverride?.meshId?.includes('/visuals.proto_') ? 'visuals' : 'collisions');
          normalizedOverride.applyGeometry = rawOverride?.applyGeometry === true || normalizedOverride.sectionName === 'collisions';
          const dirtyMaskValue = Number(rawOverride?.dirtyMask);
          normalizedOverride.dirtyMask = Number.isFinite(dirtyMaskValue) ? Math.max(0, Math.floor(dirtyMaskValue)) : 0;
          if (!normalizedOverride.worldTransformElements) {
              normalizedOverride.worldTransformElements = rawOverride?.worldTransform;
          }
          const cacheMeshId = normalizeHydraPath(normalizedOverride.meshId || normalizedMeshId) || normalizedMeshId;
          this._finalStageOverrideBatchCache.set(cacheMeshId, normalizedOverride);
          this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
          const resolvedPrimPath = normalizeHydraPath(normalizedOverride.resolvedPrimPath || '');
          if (resolvedPrimPath) {
              const normalizedPrimOverride = this.normalizePrimOverrideData(rawOverride);
              if (normalizedPrimOverride) {
                  this._primOverrideDataCache.set(resolvedPrimPath, normalizedPrimOverride);
                  primOverridePaths.add(resolvedPrimPath);
              }
          }
          if (normalizedOverride.sectionName === 'visuals') {
              this._visualProtoOverrideCache.set(cacheMeshId, normalizedOverride);
              if (resolvedPrimPath)
                  this._resolvedVisualPrimPathCache.set(cacheMeshId, resolvedPrimPath);
              visualCount += 1;
          }
          else {
              this._collisionProtoOverrideCache.set(cacheMeshId, normalizedOverride);
              if (resolvedPrimPath)
                  this._resolvedProtoPrimPathCache.set(cacheMeshId, resolvedPrimPath);
              collisionCount += 1;
          }
      }
      this._collisionProtoOverrideBatchPrimed = true;
      this._visualProtoOverrideBatchPrimed = true;
      return {
          count: Number(this._finalStageOverrideBatchCache?.size || (collisionCount + visualCount)),
          collisionCount,
          visualCount,
          protoMeshCount: Number(this._finalStageOverrideBatchProtoMeshCount || 0),
          primOverrideCount: primOverridePaths.size,
          source: forceRefresh ? "batch-refresh" : "batch",
          entries: this._finalStageOverrideBatchCache,
      };
  }
  ingestFinalStageOverrideSnapshotDescriptors(rawDescriptors, options = {}) {
      const forceRefresh = options?.force === true;
      const descriptors = Array.isArray(rawDescriptors)
          ? rawDescriptors
          : (rawDescriptors && typeof rawDescriptors.length === 'number' ? Array.from(rawDescriptors) : []);
      if (forceRefresh) {
          this._collisionProtoOverrideCache?.clear?.();
          this._visualProtoOverrideCache?.clear?.();
          this._primOverrideDataCache?.clear?.();
          this._resolvedProtoPrimPathCache?.clear?.();
          this._resolvedVisualPrimPathCache?.clear?.();
          this._finalStageOverrideBatchProtoMeshCount = 0;
      }
      this._finalStageOverrideBatchPrimed = true;
      this._finalStageOverrideBatchCache?.clear?.();
      if (descriptors.length <= 0) {
          this._collisionProtoOverrideBatchPrimed = true;
          this._visualProtoOverrideBatchPrimed = true;
          this._finalStageOverrideBatchProtoMeshCount = 0;
          return {
              count: 0,
              collisionCount: 0,
              visualCount: 0,
              protoMeshCount: 0,
              primOverrideCount: 0,
              source: 'empty',
              entries: this._finalStageOverrideBatchCache,
          };
      }
      let collisionCount = 0;
      let visualCount = 0;
      let protoMeshCount = 0;
      const primOverridePaths = new Set();
      for (const rawDescriptor of descriptors) {
          const normalizedMeshId = normalizeHydraPath(rawDescriptor?.meshId || '');
          if (!normalizedMeshId || !normalizedMeshId.includes('.proto_'))
              continue;
          protoMeshCount += 1;
          const sectionName = String(rawDescriptor?.sectionName || '').toLowerCase();
          const normalizedOverride = sectionName === 'visuals'
              ? this.normalizeVisualProtoOverride(rawDescriptor)
              : this.normalizeCollisionProtoOverride(rawDescriptor);
          if (!normalizedOverride)
              continue;
          normalizedOverride.meshId = normalizeHydraPath(normalizedOverride.meshId || normalizedMeshId) || normalizedMeshId;
          normalizedOverride.sectionName = sectionName || (normalizedOverride?.meshId?.includes('/visuals.proto_') ? 'visuals' : 'collisions');
          normalizedOverride.applyGeometry = rawDescriptor?.applyGeometry === true || normalizedOverride.sectionName === 'collisions';
          const dirtyMaskValue = Number(rawDescriptor?.dirtyMask);
          normalizedOverride.dirtyMask = Number.isFinite(dirtyMaskValue) ? Math.max(0, Math.floor(dirtyMaskValue)) : 0;
          if (!normalizedOverride.worldTransformElements) {
              normalizedOverride.worldTransformElements = rawDescriptor?.worldTransform;
          }
          const cacheMeshId = normalizeHydraPath(normalizedOverride.meshId || normalizedMeshId) || normalizedMeshId;
          this._finalStageOverrideBatchCache.set(cacheMeshId, normalizedOverride);
          this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
          const resolvedPrimPath = normalizeHydraPath(normalizedOverride.resolvedPrimPath || '');
          if (resolvedPrimPath) {
              const normalizedPrimOverride = this.normalizePrimOverrideData(rawDescriptor);
              if (normalizedPrimOverride) {
                  this._primOverrideDataCache.set(resolvedPrimPath, normalizedPrimOverride);
                  primOverridePaths.add(resolvedPrimPath);
              }
          }
          if (normalizedOverride.sectionName === 'visuals') {
              this._visualProtoOverrideCache.set(cacheMeshId, normalizedOverride);
              if (resolvedPrimPath)
                  this._resolvedVisualPrimPathCache.set(cacheMeshId, resolvedPrimPath);
              visualCount += 1;
          }
          else {
              this._collisionProtoOverrideCache.set(cacheMeshId, normalizedOverride);
              if (resolvedPrimPath)
                  this._resolvedProtoPrimPathCache.set(cacheMeshId, resolvedPrimPath);
              collisionCount += 1;
          }
      }
      this._collisionProtoOverrideBatchPrimed = true;
      this._visualProtoOverrideBatchPrimed = true;
      this._finalStageOverrideBatchProtoMeshCount = protoMeshCount;
      return {
          count: Number(this._finalStageOverrideBatchCache?.size || (collisionCount + visualCount)),
          collisionCount,
          visualCount,
          protoMeshCount,
          primOverrideCount: primOverridePaths.size,
          source: forceRefresh ? 'snapshot-refresh' : 'snapshot',
          entries: this._finalStageOverrideBatchCache,
      };
  }
  hasResolvedRobotSceneSnapshot(stageSourcePath = null) {
      const normalizedStagePath = String(stageSourcePath
          || this.getStageSourcePath?.()
          || '').trim().split('?')[0];
      if (!normalizedStagePath || typeof this.getCachedRobotSceneSnapshot !== 'function')
          return false;
      try {
          return !!this.getCachedRobotSceneSnapshot(normalizedStagePath);
      }
      catch {
          return false;
      }
  }
  shouldDeferProtoStageSyncUntilSceneSnapshot(stageSourcePath = null) {
      return this.strictOneShotSceneLoad === true
          && !this.hasResolvedRobotSceneSnapshot(stageSourcePath);
  }
  _resolveWasmHeaps() {
      const candidates = [
          globalThis?.Module,
          globalThis?.USD,
          globalThis?.USD_WASM_MODULE,
      ];
      for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object')
              continue;
          const heapF32 = candidate.HEAPF32;
          const heapU32 = candidate.HEAPU32;
          if ((heapF32 && Number(heapF32.length || 0) > 0) || (heapU32 && Number(heapU32.length || 0) > 0)) {
              return {
                  heapF32: heapF32 || null,
                  heapU32: heapU32 || null,
              };
          }
      }
      const fallback = candidates.find((candidate) => candidate && typeof candidate === 'object') || null;
      return {
          heapF32: fallback?.HEAPF32 || null,
          heapU32: fallback?.HEAPU32 || null,
      };
  }
  _readHeapFloat32View(ptrValue, countValue) {
      const heap = this._resolveWasmHeaps().heapF32;
      if (!heap || !heap.buffer)
          return null;
      const ptr = Number(ptrValue);
      const count = Number(countValue);
      if (!Number.isFinite(ptr) || !Number.isFinite(count))
          return null;
      if (ptr <= 0 || count <= 0)
          return null;
      const ptrInt = Math.floor(ptr);
      const countInt = Math.floor(count);
      if ((ptrInt % 4) !== 0)
          return null;
      const start = ptrInt >>> 2;
      const end = start + countInt;
      if (start < 0 || end > heap.length)
          return null;
      return heap.subarray(start, end);
  }
  _readHeapUint32View(ptrValue, countValue) {
      const heap = this._resolveWasmHeaps().heapU32;
      if (!heap || !heap.buffer)
          return null;
      const ptr = Number(ptrValue);
      const count = Number(countValue);
      if (!Number.isFinite(ptr) || !Number.isFinite(count))
          return null;
      if (ptr <= 0 || count <= 0)
          return null;
      const ptrInt = Math.floor(ptr);
      const countInt = Math.floor(count);
      if ((ptrInt % 4) !== 0)
          return null;
      const start = ptrInt >>> 2;
      const end = start + countInt;
      if (start < 0 || end > heap.length)
          return null;
      return heap.subarray(start, end);
  }
  pullRprimDeltaBatchFromDriver(driver = null) {
      const resolvedDriver = driver || this.config?.driver?.();
      const summary = {
          ok: false,
          source: "none",
          count: 0,
          applied: 0,
          meshIds: new Set(),
      };
      if (!resolvedDriver || typeof resolvedDriver.GetRprimDeltaBatch !== 'function') {
          return summary;
      }
      let payload = null;
      try {
          payload = resolvedDriver.GetRprimDeltaBatch();
      }
      catch {
          summary.source = "error";
          return summary;
      }
      summary.ok = true;
      if (!payload || typeof payload !== 'object') {
          summary.source = "empty";
          return summary;
      }
      const rawEntries = (payload.entries && typeof payload.entries === 'object')
          ? payload.entries
          : {};
      summary.source = "batch";
      summary.count = Number(payload.count || Object.keys(rawEntries).length || 0);
      const toObjectArray = (value) => {
          if (Array.isArray(value))
              return value;
          if (!value || typeof value !== 'object')
              return [];
          if (typeof value.length === 'number') {
              const length = Number(value.length);
              const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
              const out = [];
              for (let index = 0; index < safeLength; index++) {
                  out.push(value[index]);
              }
              return out;
          }
          const fallback = toArrayLike(value);
          if (!fallback || typeof fallback.length !== 'number')
              return [];
          const out = [];
          const length = Number(fallback.length);
          const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
          for (let index = 0; index < safeLength; index++) {
              out.push(fallback[index]);
          }
          return out;
      };
      for (const [rawMeshId, rawDelta] of Object.entries(rawEntries)) {
          const meshId = normalizeHydraPath(rawMeshId);
          if (!meshId)
              continue;
          const hydraMesh = this.meshes[meshId];
          if (!hydraMesh || typeof hydraMesh.applyUpdates !== 'function')
              continue;
          if (!rawDelta || typeof rawDelta !== 'object')
              continue;
          const skipHydraPayloadReadForProto = (this.preferProtoBlobOverHydraPayload === true
              && meshId.includes('.proto_'));
          const updates = {};
          let hasUpdates = false;
          const materialId = normalizeHydraPath(rawDelta.materialId);
          if (materialId) {
              updates.materialId = materialId;
              hasUpdates = true;
          }
          const rawSections = toObjectArray(rawDelta.geomSubsetSections);
          if (rawSections.length > 0) {
              const normalizedSections = [];
              for (const rawSection of rawSections) {
                  const start = Number(rawSection?.start);
                  const length = Number(rawSection?.length);
                  if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0)
                      continue;
                  normalizedSections.push({
                      start: Math.max(0, Math.floor(start)),
                      length: Math.max(0, Math.floor(length)),
                      materialId: normalizeHydraPath(rawSection?.materialId || ''),
                  });
              }
              if (normalizedSections.length > 0) {
                  updates.geomSubsetSections = normalizedSections;
                  hasUpdates = true;
              }
          }
          if (!skipHydraPayloadReadForProto) {
              const points = this._readHeapFloat32View(rawDelta.pointsPtr, rawDelta.pointsCount);
              if (points && points.length > 0) {
                  updates.points = points;
                  hasUpdates = true;
              }
              const indices = this._readHeapUint32View(rawDelta.indicesPtr, rawDelta.indicesCount);
              if (indices && indices.length > 0) {
                  updates.indices = indices;
                  hasUpdates = true;
              }
              const normals = this._readHeapFloat32View(rawDelta.normalsPtr, rawDelta.normalsCount);
              if (normals && normals.length > 0) {
                  updates.normals = normals;
                  hasUpdates = true;
              }
              const transform = this._readHeapFloat32View(rawDelta.transformPtr, rawDelta.transformCount);
              if (transform && transform.length >= 16) {
                  updates.transform = transform.subarray(0, 16);
                  hasUpdates = true;
              }
              const rawPrimvars = toObjectArray(rawDelta.primvars);
              if (rawPrimvars.length > 0) {
                  const primvars = [];
                  for (const rawPrimvar of rawPrimvars) {
                      const name = String(rawPrimvar?.name || '').trim();
                      if (!name)
                          continue;
                      const dimension = Number(rawPrimvar?.dimension);
                      if (!Number.isFinite(dimension) || dimension <= 0)
                          continue;
                      const data = this._readHeapFloat32View(rawPrimvar?.dataPtr, rawPrimvar?.dataCount);
                      if (!data || data.length <= 0)
                          continue;
                      const interpolation = String(rawPrimvar?.interpolation || 'vertex').trim().toLowerCase() || 'vertex';
                      primvars.push({
                          name,
                          data,
                          dimension: Math.max(1, Math.floor(dimension)),
                          interpolation,
                      });
                  }
                  if (primvars.length > 0) {
                      updates.primvars = primvars;
                      hasUpdates = true;
                  }
              }
          }
          if (!hasUpdates)
              continue;
          hydraMesh.applyUpdates(updates);
          summary.meshIds.add(meshId);
          summary.applied += 1;
      }
      return summary;
  }
  prefetchCollisionProtoOverridesFromDriver(driver, options = {}) {
      const forceRefresh = options?.force === true;
      const resolvedDriver = driver || this.config?.driver?.();
      if (!resolvedDriver)
          return { count: 0, source: "none" };
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
      }
      catch {
          return { count: 0, source: "error" };
      }
      if (!payload || typeof payload !== 'object') {
          return { count: 0, source: "empty" };
      }
      let loaded = 0;
      for (const [meshId, rawOverride] of Object.entries(payload)) {
          if (!meshId || !meshId.includes('.proto_'))
              continue;
          const normalizedOverride = this.normalizeCollisionProtoOverride(rawOverride);
          if (!normalizedOverride)
              continue;
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
      if (!resolvedDriver)
          return { count: 0, source: "none" };
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
      }
      catch {
          return { count: 0, source: "error" };
      }
      if (!payload || typeof payload !== 'object') {
          return { count: 0, source: "empty" };
      }
      let loaded = 0;
      for (const [meshId, rawOverride] of Object.entries(payload)) {
          if (!meshId || !meshId.includes('.proto_'))
              continue;
          const normalizedOverride = this.normalizeVisualProtoOverride(rawOverride);
          if (!normalizedOverride)
              continue;
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
      if (!resolvedDriver)
          return { count: 0, source: "none" };
      const normalizedPaths = [];
      const seenPaths = new Set();
      const ingestPath = (pathValue) => {
          const normalizedPath = normalizeHydraPath(pathValue);
          if (!normalizedPath || !normalizedPath.startsWith('/'))
              return;
          if (seenPaths.has(normalizedPath))
              return;
          seenPaths.add(normalizedPath);
          normalizedPaths.push(normalizedPath);
      };
      if (Array.isArray(primPaths) || ArrayBuffer.isView(primPaths) || typeof primPaths?.length === 'number') {
          const length = Number(primPaths?.length);
          const safeLength = Number.isFinite(length) && length >= 0 ? Math.floor(length) : 0;
          for (let index = 0; index < safeLength; index++) {
              ingestPath(primPaths[index]);
          }
      }
      else if (primPaths && typeof primPaths[Symbol.iterator] === 'function') {
          for (const pathValue of primPaths) {
              ingestPath(pathValue);
          }
      }
      if (normalizedPaths.length === 0)
          return { count: 0, source: "empty" };
      if (forceRefresh) {
          for (const primPath of normalizedPaths) {
              this._primOverrideDataCache.delete(primPath);
          }
      }
      if (typeof resolvedDriver.GetPrimOverrideDataMap === 'function') {
          let payload = null;
          try {
              payload = resolvedDriver.GetPrimOverrideDataMap(normalizedPaths);
          }
          catch {
              payload = null;
          }
          if (payload && typeof payload === 'object') {
              let loaded = 0;
              for (const [primPath, rawData] of Object.entries(payload)) {
                  const normalizedPath = normalizeHydraPath(primPath);
                  if (!normalizedPath || !normalizedPath.startsWith('/'))
                      continue;
                  const normalizedData = this.normalizePrimOverrideData(rawData);
                  if (!normalizedData)
                      continue;
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
          if (!normalizedData)
              continue;
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
      }
      catch {
          return { count: 0, source: "error" };
      }
      if (!payload) {
          this._knownPrimPathSet = new Set();
          this._knownPrimPathSetPrimed = true;
          return { count: 0, source: "empty" };
      }
      const nextPathSet = new Set();
      const ingestPath = (pathValue) => {
          const normalizedPath = normalizeHydraPath(pathValue);
          if (!normalizedPath || !normalizedPath.startsWith('/'))
              return;
          nextPathSet.add(normalizedPath);
      };
      if (Array.isArray(payload) || ArrayBuffer.isView(payload) || typeof payload.length === 'number') {
          const length = Number(payload.length);
          const safeLength = Number.isFinite(length) && length >= 0 ? Math.floor(length) : 0;
          for (let index = 0; index < safeLength; index++) {
              ingestPath(payload[index]);
          }
      }
      else if (typeof payload[Symbol.iterator] === 'function') {
          for (const pathValue of payload) {
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
          if (!this._primPathExistenceCache.has(knownPath))
              continue;
          if (this._primPathExistenceCache.get(knownPath) === false) {
              this._primPathExistenceCache.set(knownPath, true);
          }
      }
      return {
          count: nextPathSet.size,
          source: forceRefresh ? "batch-refresh" : "batch",
      };
  }
  normalizeRobotSceneSnapshot(rawSnapshot, options = {}) {
      if (!rawSnapshot || typeof rawSnapshot !== 'object')
          return null;
      const toPlainArray = (value) => (Array.isArray(value)
          ? value.slice()
          : (value && typeof value.length === 'number' ? Array.from(value) : []));
      const toPlainObject = (value) => (value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value))
          : {});
      const copyFloat32 = (value) => {
          if (!value || typeof value.length !== 'number')
              return new Float32Array(0);
          if (ArrayBuffer.isView(value))
              return Float32Array.from(value);
          return Float32Array.from(Array.from(value));
      };
      const useFloat32 = (value) => (value instanceof Float32Array
          ? value
          : copyFloat32(value));
      const copyUint32 = (value) => {
          if (!value || typeof value.length !== 'number')
              return new Uint32Array(0);
          if (ArrayBuffer.isView(value))
              return Uint32Array.from(value);
          return Uint32Array.from(Array.from(value));
      };
      const useUint32 = (value) => (value instanceof Uint32Array
          ? value
          : copyUint32(value));
      const copyInt32 = (value) => {
          if (!value || typeof value.length !== 'number')
              return new Int32Array(0);
          if (ArrayBuffer.isView(value))
              return Int32Array.from(value);
          return Int32Array.from(Array.from(value));
      };
      const useInt32 = (value) => (value instanceof Int32Array
          ? value
          : copyInt32(value));
      const readFloatPayload = (payload, directField, ptrField, count) => {
          const directValue = payload?.[directField];
          if (directValue && typeof directValue.length === 'number') {
              return copyFloat32(directValue);
          }
          const heapView = this._readHeapFloat32View(payload?.[ptrField], count);
          return heapView ? Float32Array.from(heapView) : new Float32Array(0);
      };
      const readUintPayload = (payload, directField, ptrField, count) => {
          const directValue = payload?.[directField];
          if (directValue && typeof directValue.length === 'number') {
              return copyUint32(directValue);
          }
          const heapView = this._readHeapUint32View(payload?.[ptrField], count);
          return heapView ? Uint32Array.from(heapView) : new Uint32Array(0);
      };
      const rawStage = rawSnapshot.stage && typeof rawSnapshot.stage === 'object'
          ? rawSnapshot.stage
          : {};
      const renderPayload = rawSnapshot.render && typeof rawSnapshot.render === 'object'
          ? rawSnapshot.render
          : rawSnapshot;
      const resolvedStageSourcePath = String(options?.stageSourcePath
          || rawStage.stageSourcePath
          || rawSnapshot.stageSourcePath
          || this.getStageSourcePath()
          || '').trim().split('?')[0];
      if (resolvedStageSourcePath) {
          this._runtimeBridgeCacheStageKey = resolvedStageSourcePath;
      }
      const robotMetadataRaw = rawSnapshot.robotMetadataSnapshot && typeof rawSnapshot.robotMetadataSnapshot === 'object'
          ? rawSnapshot.robotMetadataSnapshot
          : {
              stageSourcePath: resolvedStageSourcePath || null,
              generatedAtMs: Number(rawSnapshot.generatedAtMs || Date.now()),
              source: 'robot-scene-snapshot',
              linkParentPairs: rawSnapshot.robotTree?.linkParentPairs || [],
              jointCatalogEntries: rawSnapshot.robotTree?.jointCatalogEntries || [],
              linkDynamicsEntries: rawSnapshot.physics?.linkDynamicsEntries || [],
              meshCountsByLinkPath: {},
          };
      const forceRefresh = options?.force === true;
      let rawMeshDescriptors = toPlainArray(renderPayload.meshDescriptors);
      const rawBuffers = rawSnapshot.buffers && typeof rawSnapshot.buffers === 'object'
          ? rawSnapshot.buffers
          : {};
      const packedDescriptorFormat = String(renderPayload?.meshDescriptorFormat || '').trim().toLowerCase();
      const packedRangesByMeshId = rawBuffers.rangesByMeshId && typeof rawBuffers.rangesByMeshId === 'object'
          ? rawBuffers.rangesByMeshId
          : null;
      const packedGeomSubsetSectionsByMeshId = renderPayload.meshDescriptorGeomSubsetSections
          && typeof renderPayload.meshDescriptorGeomSubsetSections === 'object'
          ? renderPayload.meshDescriptorGeomSubsetSections
          : null;
      const hasPackedDescriptorRecords = packedDescriptorFormat === 'packed-v2';
      const hasPackedMeshBuffers = hasPackedDescriptorRecords || !!packedRangesByMeshId;
      const normalizeBufferRange = (rawRange, fallbackStride = 1) => {
          if (!rawRange || typeof rawRange !== 'object')
              return null;
          const offset = Number(rawRange.offset);
          const count = Number(rawRange.count);
          if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(count) || count <= 0)
              return null;
          const stride = Number(rawRange.stride);
          return {
              offset: Math.max(0, Math.floor(offset)),
              count: Math.max(0, Math.floor(count)),
              stride: Number.isFinite(stride) && stride > 0 ? Math.floor(stride) : fallbackStride,
          };
      };
      const normalizeMeshRanges = (rawRanges) => {
          if (!rawRanges || typeof rawRanges !== 'object')
              return null;
          const positions = normalizeBufferRange(rawRanges.positions, 3);
          const indices = normalizeBufferRange(rawRanges.indices, 1);
          const normals = normalizeBufferRange(rawRanges.normals, 3);
          const uvs = normalizeBufferRange(rawRanges.uvs, 2);
          const transform = normalizeBufferRange(rawRanges.transform, 16);
          if (!positions && !indices && !normals && !uvs && !transform)
              return null;
          return { positions, indices, normals, uvs, transform };
      };
      const normalizeGeomSubsetSections = (value) => {
          if (!value || typeof value.length !== 'number')
              return [];
          const out = [];
          const safeLength = Math.max(0, Math.floor(Number(value.length) || 0));
          for (let index = 0; index < safeLength; index += 1) {
              const rawSection = value[index];
              const start = Number(rawSection?.start);
              const length = Number(rawSection?.length);
              if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0)
                  continue;
              out.push({
                  start: Math.max(0, Math.floor(start)),
                  length: Math.max(0, Math.floor(length)),
                  materialId: normalizeHydraPath(rawSection?.materialId || '') || '',
              });
          }
          return out;
      };
      const normalizeGeometrySummary = (rawGeometry, fallbackBlob = null) => {
          const source = rawGeometry && typeof rawGeometry === 'object'
              ? rawGeometry
              : fallbackBlob;
          if (!source || typeof source !== 'object')
              return null;
          const materialId = normalizeHydraPath(source.materialId || '');
          return {
              numVertices: Number(source.numVertices || 0),
              numIndices: Number(source.numIndices || 0),
              numNormals: Number(source.numNormals || 0),
              numUVs: Number(source.numUVs || 0),
              uvDimension: Number(source.uvDimension || 0),
              normalsDimension: Number(source.normalsDimension || 0),
              materialId: materialId || null,
              geomSubsetSections: normalizeGeomSubsetSections(source.geomSubsetSections),
          };
      };
      const sliceFloatPool = (pool, range) => {
          if (!range || !pool || typeof pool.subarray !== 'function')
              return new Float32Array(0);
          const start = Math.max(0, Math.floor(Number(range.offset) || 0));
          const count = Math.max(0, Math.floor(Number(range.count) || 0));
          if (count <= 0 || start >= pool.length)
              return new Float32Array(0);
          const end = Math.min(pool.length, start + count);
          return pool.subarray(start, end);
      };
      const sliceUintPool = (pool, range) => {
          if (!range || !pool || typeof pool.subarray !== 'function')
              return new Uint32Array(0);
          const start = Math.max(0, Math.floor(Number(range.offset) || 0));
          const count = Math.max(0, Math.floor(Number(range.count) || 0));
          if (count <= 0 || start >= pool.length)
              return new Uint32Array(0);
          const end = Math.min(pool.length, start + count);
          return pool.subarray(start, end);
      };
      let positionPool = new Float32Array(0);
      let indexPool = new Uint32Array(0);
      let normalPool = new Float32Array(0);
      let uvPool = new Float32Array(0);
      let transformPool = new Float32Array(0);
      let bufferRangesByMeshId = {} as Record<string, any>;
      let normalizedMeshDescriptors = [] as Array<Record<string, any>>;
      if (hasPackedDescriptorRecords) {
          positionPool = useFloat32(rawBuffers.positions);
          indexPool = useUint32(rawBuffers.indices);
          normalPool = useFloat32(rawBuffers.normals);
          uvPool = useFloat32(rawBuffers.uvs);
          transformPool = useFloat32(rawBuffers.transforms);
          const packedDescriptorStrings = toPlainArray(renderPayload.meshDescriptorStrings)
              .map((value) => String(value || ''));
          const packedDescriptorHeaders = useInt32(renderPayload.meshDescriptorHeaders);
          const packedDescriptorScalars = useFloat32(renderPayload.meshDescriptorScalars);
          const headerStride = Math.max(1, Math.floor(Number(renderPayload.meshDescriptorHeaderStride || 30)));
          const scalarStride = Math.max(1, Math.floor(Number(renderPayload.meshDescriptorScalarStride || 6)));
          const readPackedString = (rawIndex) => {
              const index = Number(rawIndex);
              if (!Number.isFinite(index))
                  return '';
              const normalizedIndex = Math.floor(index);
              if (normalizedIndex < 0 || normalizedIndex >= packedDescriptorStrings.length)
                  return '';
              return packedDescriptorStrings[normalizedIndex] || '';
          };
          const readPackedRange = (headerBase, offsetIndex, countIndex, strideIndex, fallbackStride) => {
              const offset = Number(packedDescriptorHeaders[headerBase + offsetIndex]);
              const count = Number(packedDescriptorHeaders[headerBase + countIndex]);
              const stride = Number(packedDescriptorHeaders[headerBase + strideIndex]);
              return normalizeBufferRange({ offset, count, stride }, fallbackStride);
          };
          const readPackedScalar = (scalarBase, index) => {
              const value = Number(packedDescriptorScalars[scalarBase + index]);
              return Number.isFinite(value) ? value : undefined;
          };
          const makeFloatView = (pool, range) => (range
              ? pool.subarray(range.offset, range.offset + range.count)
              : new Float32Array(0));
          const makeUintView = (pool, range) => (range
              ? pool.subarray(range.offset, range.offset + range.count)
              : new Uint32Array(0));
          const descriptorCount = Math.min(Math.floor(packedDescriptorHeaders.length / headerStride), Math.floor(packedDescriptorScalars.length / scalarStride));
          rawMeshDescriptors = [];
          for (let descriptorIndex = 0; descriptorIndex < descriptorCount; descriptorIndex += 1) {
              const headerBase = descriptorIndex * headerStride;
              const scalarBase = descriptorIndex * scalarStride;
              const meshId = readPackedString(packedDescriptorHeaders[headerBase + 0]);
              const sectionName = readPackedString(packedDescriptorHeaders[headerBase + 1]);
              const resolvedPrimPath = readPackedString(packedDescriptorHeaders[headerBase + 2]);
              const primType = readPackedString(packedDescriptorHeaders[headerBase + 3]);
              const axis = readPackedString(packedDescriptorHeaders[headerBase + 4]);
              const materialId = normalizeHydraPath(readPackedString(packedDescriptorHeaders[headerBase + 5])) || null;
              const geomSubsetSections = normalizeGeomSubsetSections(
                  packedGeomSubsetSectionsByMeshId && meshId
                      ? packedGeomSubsetSectionsByMeshId[meshId]
                      : null,
              );
              const valid = Number(packedDescriptorHeaders[headerBase + 6]) === 1;
              const applyGeometry = Number(packedDescriptorHeaders[headerBase + 7]) === 1;
              const dirtyMask = Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 8]) || 0));
              const ranges = {
                  positions: readPackedRange(headerBase, 9, 10, 11, 3),
                  indices: readPackedRange(headerBase, 12, 13, 14, 1),
                  normals: readPackedRange(headerBase, 15, 16, 17, 3),
                  uvs: readPackedRange(headerBase, 18, 19, 20, 2),
                  transform: readPackedRange(headerBase, 21, 22, 23, 16),
              };
              const normalizedRanges = normalizeMeshRanges(ranges);
              const geometry = {
                  numVertices: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 24]) || 0)),
                  numIndices: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 25]) || 0)),
                  numNormals: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 26]) || 0)),
                  numUVs: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 27]) || 0)),
                  uvDimension: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 28]) || 0)),
                  normalsDimension: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 29]) || 0)),
                  materialId,
                  geomSubsetSections,
              };
              const extentValues = [
                  readPackedScalar(scalarBase, 3),
                  readPackedScalar(scalarBase, 4),
                  readPackedScalar(scalarBase, 5),
              ];
              const extentSize = extentValues.every((value) => Number.isFinite(value))
                  ? extentValues.map((value) => Math.max(0, Number(value)))
                  : undefined;
              const meshPayload = primType === 'mesh'
                  ? {
                      valid,
                      numVertices: geometry.numVertices,
                      numIndices: geometry.numIndices,
                      numNormals: geometry.numNormals,
                      numUVs: geometry.numUVs,
                      uvDimension: geometry.uvDimension,
                      normalsDimension: geometry.normalsDimension,
                      materialId: geometry.materialId,
                      geomSubsetSections: geometry.geomSubsetSections,
                      points: makeFloatView(positionPool, normalizedRanges?.positions || null),
                      indices: makeUintView(indexPool, normalizedRanges?.indices || null),
                      normals: makeFloatView(normalPool, normalizedRanges?.normals || null),
                      uv: makeFloatView(uvPool, normalizedRanges?.uvs || null),
                      transform: makeFloatView(transformPool, normalizedRanges?.transform || null),
                  }
                  : undefined;
              const worldTransform = normalizedRanges?.transform
                  ? makeFloatView(transformPool, normalizedRanges.transform)
                  : undefined;
              rawMeshDescriptors.push({
                  valid,
                  meshId,
                  sectionName,
                  resolvedPrimPath,
                  primType,
                  axis,
                  size: readPackedScalar(scalarBase, 0),
                  radius: readPackedScalar(scalarBase, 1),
                  height: readPackedScalar(scalarBase, 2),
                  extentSize,
                  worldTransform,
                  applyGeometry,
                  dirtyMask,
                  ranges: normalizedRanges,
                  geometry,
                  meshPayload,
              });
              const normalizedMeshId = normalizeHydraPath(meshId || '');
              if (normalizedMeshId && normalizedRanges) {
                  bufferRangesByMeshId[normalizedMeshId] = normalizedRanges;
              }
          }
      }
      const primPathSummary = renderPayload.primPathSet !== undefined
          ? (this.prefetchPrimPathSetFromDriver({ GetPrimPathSet: () => renderPayload.primPathSet }, { force: forceRefresh }) || { count: 0, source: 'none' })
          : { count: 0, source: 'none' };
      const transformSummary = renderPayload.primTransforms !== undefined
          ? (this.prefetchPrimTransformsFromDriver({ GetPrimTransforms: () => renderPayload.primTransforms }, { force: forceRefresh }) || { world: 0, local: 0, total: 0, source: 'none' })
          : { world: 0, local: 0, total: 0, source: 'none' };
      let protoBlobSummary = renderPayload.protoDataBlobs !== undefined && !hasPackedMeshBuffers
          ? (this.prefetchProtoDataBlobsFromDriver({ GetAllProtoDataBlobs: () => renderPayload.protoDataBlobs }, { force: forceRefresh }) || { count: 0, source: 'none' })
          : { count: 0, source: hasPackedMeshBuffers ? 'packed-buffers' : 'none' };
      const descriptorHasProtoOverride = rawMeshDescriptors.some((descriptor) => String(descriptor?.meshId || '').includes('.proto_'));
      const finalOverrideSummary = descriptorHasProtoOverride
          ? (this.ingestFinalStageOverrideSnapshotDescriptors(rawMeshDescriptors, { force: forceRefresh }) || {
              count: 0,
              collisionCount: 0,
              visualCount: 0,
              primOverrideCount: 0,
              source: 'none',
          })
          : renderPayload.finalStageOverrideBatch !== undefined
              ? (this.prefetchFinalStageOverrideBatchFromDriver({ GetFinalStageOverrideBatch: () => renderPayload.finalStageOverrideBatch }, { force: forceRefresh }) || {
                  count: 0,
                  collisionCount: 0,
                  visualCount: 0,
                  primOverrideCount: 0,
                  source: 'none',
              })
              : {
                  count: 0,
                  collisionCount: 0,
                  visualCount: 0,
                  primOverrideCount: 0,
                  source: 'none',
              };
      const robotMetadataSummary = this.ingestRobotMetadataSnapshotFromBootstrapPayload(robotMetadataRaw, {
          stageSourcePath: resolvedStageSourcePath,
          emitEvent: options?.emitRobotMetadataEvent === true,
          allowEmptySnapshot: true,
      }) || { ready: false, jointCount: 0, dynamicsCount: 0, source: 'none' };
      if (hasPackedMeshBuffers) {
          if (!hasPackedDescriptorRecords) {
              positionPool = useFloat32(rawBuffers.positions);
              indexPool = useUint32(rawBuffers.indices);
              normalPool = useFloat32(rawBuffers.normals);
              uvPool = useFloat32(rawBuffers.uvs);
              transformPool = useFloat32(rawBuffers.transforms);
              for (const [rawMeshId, rawRanges] of Object.entries(packedRangesByMeshId || {})) {
                  const meshId = normalizeHydraPath(rawMeshId);
                  const normalizedRanges = normalizeMeshRanges(rawRanges);
                  if (!meshId || !normalizedRanges)
                      continue;
                  bufferRangesByMeshId[meshId] = normalizedRanges;
              }
          }
          normalizedMeshDescriptors = rawMeshDescriptors.map((rawDescriptor) => {
              const meshId = normalizeHydraPath(rawDescriptor?.meshId || '');
              const resolvedPrimPath = normalizeHydraPath(rawDescriptor?.resolvedPrimPath || '');
              return {
                  meshId: meshId || null,
                  sectionName: String(rawDescriptor?.sectionName || '').trim() || null,
                  resolvedPrimPath: resolvedPrimPath || null,
                  primType: String(rawDescriptor?.primType || '').trim() || null,
                  applyGeometry: rawDescriptor?.applyGeometry === true,
                  dirtyMask: Number(rawDescriptor?.dirtyMask || 0),
                  ranges: normalizeMeshRanges(rawDescriptor?.ranges) || (meshId ? (bufferRangesByMeshId[meshId] || null) : null),
                  geometry: normalizeGeometrySummary(rawDescriptor?.geometry, null),
              };
          });
          if (protoBlobSummary.count <= 0) {
              protoBlobSummary = {
                  count: Object.keys(bufferRangesByMeshId).length,
                  source: 'packed-buffers',
              };
          }
      }
      else {
          const protoPayloadByKey = new Map();
          const rawProtoDataBlobs = renderPayload.protoDataBlobs && typeof renderPayload.protoDataBlobs === 'object'
              ? renderPayload.protoDataBlobs
              : {};
          for (const [rawKey, rawBlob] of Object.entries(rawProtoDataBlobs)) {
              const normalizedKey = normalizeHydraPath(rawKey);
              if (!normalizedKey)
                  continue;
              const normalizedBlob = this.normalizeProtoDataBlob(rawBlob);
              if (!normalizedBlob)
                  continue;
              protoPayloadByKey.set(normalizedKey, {
                  payload: normalizedBlob,
                  positions: readFloatPayload(normalizedBlob, 'points', 'pointsPtr', Number(normalizedBlob.numVertices || 0) * 3),
                  indices: readUintPayload(normalizedBlob, 'indices', 'indicesPtr', Number(normalizedBlob.numIndices || 0)),
                  normals: readFloatPayload(normalizedBlob, 'normals', 'normalsPtr', Number(normalizedBlob.numNormals || 0) * Math.max(1, Number(normalizedBlob.normalsDimension || 3))),
                  uvs: readFloatPayload(normalizedBlob, 'uv', 'uvPtr', Number(normalizedBlob.numUVs || 0) * Math.max(1, Number(normalizedBlob.uvDimension || 2))),
                  transform: readFloatPayload(normalizedBlob, 'transform', 'transformPtr', 16),
              });
          }
          for (const rawDescriptor of rawMeshDescriptors) {
              const meshId = normalizeHydraPath(rawDescriptor?.meshId || '');
              if (!meshId || protoPayloadByKey.has(meshId) || !rawDescriptor?.meshPayload)
                  continue;
              const normalizedBlob = this.normalizeProtoDataBlob(rawDescriptor.meshPayload);
              if (!normalizedBlob)
                  continue;
              protoPayloadByKey.set(meshId, {
                  payload: normalizedBlob,
                  positions: readFloatPayload(normalizedBlob, 'points', 'pointsPtr', Number(normalizedBlob.numVertices || 0) * 3),
                  indices: readUintPayload(normalizedBlob, 'indices', 'indicesPtr', Number(normalizedBlob.numIndices || 0)),
                  normals: readFloatPayload(normalizedBlob, 'normals', 'normalsPtr', Number(normalizedBlob.numNormals || 0) * Math.max(1, Number(normalizedBlob.normalsDimension || 3))),
                  uvs: readFloatPayload(normalizedBlob, 'uv', 'uvPtr', Number(normalizedBlob.numUVs || 0) * Math.max(1, Number(normalizedBlob.uvDimension || 2))),
                  transform: readFloatPayload(normalizedBlob, 'transform', 'transformPtr', 16),
              });
          }
          const pooledEntries = Array.from(protoPayloadByKey.entries());
          let totalPositionCount = 0;
          let totalIndexCount = 0;
          let totalNormalCount = 0;
          let totalUvCount = 0;
          let totalTransformCount = 0;
          for (const [, packed] of pooledEntries) {
              totalPositionCount += Number(packed.positions?.length || 0);
              totalIndexCount += Number(packed.indices?.length || 0);
              totalNormalCount += Number(packed.normals?.length || 0);
              totalUvCount += Number(packed.uvs?.length || 0);
              totalTransformCount += Number(packed.transform?.length || 0);
          }
          positionPool = new Float32Array(totalPositionCount);
          indexPool = new Uint32Array(totalIndexCount);
          normalPool = new Float32Array(totalNormalCount);
          uvPool = new Float32Array(totalUvCount);
          transformPool = new Float32Array(totalTransformCount);
          bufferRangesByMeshId = {};
          let positionOffset = 0;
          let indexOffset = 0;
          let normalOffset = 0;
          let uvOffset = 0;
          let transformOffset = 0;
          for (const [meshId, packed] of pooledEntries) {
              const positions = packed.positions || new Float32Array(0);
              const indices = packed.indices || new Uint32Array(0);
              const normals = packed.normals || new Float32Array(0);
              const uvs = packed.uvs || new Float32Array(0);
              const transform = packed.transform || new Float32Array(0);
              if (positions.length > 0)
                  positionPool.set(positions, positionOffset);
              if (indices.length > 0)
                  indexPool.set(indices, indexOffset);
              if (normals.length > 0)
                  normalPool.set(normals, normalOffset);
              if (uvs.length > 0)
                  uvPool.set(uvs, uvOffset);
              if (transform.length > 0)
                  transformPool.set(transform, transformOffset);
              bufferRangesByMeshId[meshId] = {
                  positions: positions.length > 0 ? { offset: positionOffset, count: positions.length, stride: 3 } : null,
                  indices: indices.length > 0 ? { offset: indexOffset, count: indices.length, stride: 1 } : null,
                  normals: normals.length > 0 ? {
                      offset: normalOffset,
                      count: normals.length,
                      stride: Math.max(1, Number(packed.payload?.normalsDimension || 3)),
                  } : null,
                  uvs: uvs.length > 0 ? {
                      offset: uvOffset,
                      count: uvs.length,
                      stride: Math.max(1, Number(packed.payload?.uvDimension || 2)),
                  } : null,
                  transform: transform.length > 0 ? { offset: transformOffset, count: transform.length, stride: 16 } : null,
              };
              positionOffset += positions.length;
              indexOffset += indices.length;
              normalOffset += normals.length;
              uvOffset += uvs.length;
              transformOffset += transform.length;
          }
          normalizedMeshDescriptors = rawMeshDescriptors.map((rawDescriptor) => {
              const meshId = normalizeHydraPath(rawDescriptor?.meshId || '');
              const resolvedPrimPath = normalizeHydraPath(rawDescriptor?.resolvedPrimPath || '');
              const normalizedBlob = meshId ? protoPayloadByKey.get(meshId)?.payload || null : null;
              return {
                  meshId: meshId || null,
                  sectionName: String(rawDescriptor?.sectionName || '').trim() || null,
                  resolvedPrimPath: resolvedPrimPath || null,
                  primType: String(rawDescriptor?.primType || '').trim() || null,
                  applyGeometry: rawDescriptor?.applyGeometry === true,
                  dirtyMask: Number(rawDescriptor?.dirtyMask || 0),
                  ranges: meshId ? (bufferRangesByMeshId[meshId] || null) : null,
              geometry: normalizedBlob ? {
                  numVertices: Number(normalizedBlob.numVertices || 0),
                  numIndices: Number(normalizedBlob.numIndices || 0),
                  numNormals: Number(normalizedBlob.numNormals || 0),
                  numUVs: Number(normalizedBlob.numUVs || 0),
                  uvDimension: Number(normalizedBlob.uvDimension || 0),
                  normalsDimension: Number(normalizedBlob.normalsDimension || 0),
                  materialId: normalizeHydraPath(normalizedBlob.materialId || '') || null,
                  geomSubsetSections: Array.isArray(normalizedBlob.geomSubsetSections)
                    ? normalizedBlob.geomSubsetSections
                    : [],
              } : null,
              };
          });
      }
      if (hasPackedMeshBuffers) {
          this._protoDataBlobBatchCache?.clear?.();
          let packedBlobCount = 0;
          for (const descriptor of normalizedMeshDescriptors) {
              const meshId = normalizeHydraPath(descriptor?.meshId || '');
              if (!meshId || !meshId.includes('.proto_'))
                  continue;
              const ranges = normalizeMeshRanges(descriptor?.ranges) || null;
              const geometry = descriptor?.geometry && typeof descriptor.geometry === 'object'
                  ? descriptor.geometry
                  : {};
              const normalizedBlob = this.normalizeProtoDataBlob({
                  valid: true,
                  numVertices: Number(geometry?.numVertices || 0),
                  numIndices: Number(geometry?.numIndices || 0),
                  numNormals: Number(geometry?.numNormals || 0),
                  numUVs: Number(geometry?.numUVs || 0),
                  uvDimension: Number(geometry?.uvDimension || 0),
                  normalsDimension: Number(geometry?.normalsDimension || 0),
                  materialId: normalizeHydraPath(geometry?.materialId || '') || '',
                  points: sliceFloatPool(positionPool, ranges?.positions || null),
                  indices: sliceUintPool(indexPool, ranges?.indices || null),
                  normals: sliceFloatPool(normalPool, ranges?.normals || null),
                  uv: sliceFloatPool(uvPool, ranges?.uvs || null),
                  transform: sliceFloatPool(transformPool, ranges?.transform || null),
                  geomSubsetSections: Array.isArray(geometry?.geomSubsetSections)
                    ? geometry.geomSubsetSections
                    : [],
              });
              if (!normalizedBlob)
                  continue;
              this._protoDataBlobBatchCache.set(meshId, normalizedBlob);
              packedBlobCount += 1;
          }
          this._protoDataBlobBatchPrimed = true;
          if (protoBlobSummary.count <= 0) {
              protoBlobSummary = {
                  count: packedBlobCount,
                  source: 'packed-buffers',
              };
          }
      }
      const normalizedMaterials = this.ingestSnapshotMaterialRecords(renderPayload.materials, {
          stageSourcePath: resolvedStageSourcePath,
          force: forceRefresh,
      });
      const normalizedRobotMetadataSnapshot = this.getCachedRobotMetadataSnapshot(resolvedStageSourcePath) || {
          stageSourcePath: resolvedStageSourcePath || null,
          generatedAtMs: Number(robotMetadataRaw.generatedAtMs || rawSnapshot.generatedAtMs || Date.now()),
          source: String(robotMetadataRaw.source || robotMetadataSummary.source || 'robot-scene-snapshot'),
          linkParentPairs: toPlainArray(robotMetadataRaw.linkParentPairs),
          jointCatalogEntries: toPlainArray(robotMetadataRaw.jointCatalogEntries),
          linkDynamicsEntries: toPlainArray(robotMetadataRaw.linkDynamicsEntries),
          meshCountsByLinkPath: toPlainObject(robotMetadataRaw.meshCountsByLinkPath),
      };
      const normalizedStage = {
          stageSourcePath: resolvedStageSourcePath || null,
          rootLayerIdentifier: rawStage.rootLayerIdentifier || null,
          defaultPrimPath: rawStage.defaultPrimPath || null,
          upAxis: rawStage.upAxis || null,
          startTimeCode: Number(rawStage.startTimeCode || 0),
          endTimeCode: Number(rawStage.endTimeCode || 0),
          timeCodesPerSecond: Number(rawStage.timeCodesPerSecond || 0),
          framesPerSecond: Number(rawStage.framesPerSecond || 0),
          metersPerUnit: Number(rawStage.metersPerUnit || 0),
      };
      return {
          generatedAtMs: Number(rawSnapshot.generatedAtMs || Date.now()),
          source: 'robot-scene-snapshot',
          stageSourcePath: resolvedStageSourcePath || null,
          stage: normalizedStage,
          robotTree: {
              linkParentPairs: Array.isArray(normalizedRobotMetadataSnapshot.linkParentPairs)
                  ? normalizedRobotMetadataSnapshot.linkParentPairs
                  : [],
              jointCatalogEntries: Array.isArray(normalizedRobotMetadataSnapshot.jointCatalogEntries)
                  ? normalizedRobotMetadataSnapshot.jointCatalogEntries
                  : [],
              rootLinkPaths: toPlainArray(rawSnapshot.robotTree?.rootLinkPaths),
          },
          physics: {
              linkDynamicsEntries: Array.isArray(normalizedRobotMetadataSnapshot.linkDynamicsEntries)
                  ? normalizedRobotMetadataSnapshot.linkDynamicsEntries
                  : [],
          },
          render: {
              primPathCount: Number(primPathSummary.count || this._knownPrimPathSet?.size || 0),
              primTransformCount: Number(transformSummary.total || 0),
              protoBlobCount: Number(protoBlobSummary.count || 0),
              finalStageOverrideCount: Number(finalOverrideSummary.count || 0),
              collisionOverrideCount: Number(finalOverrideSummary.collisionCount || 0),
              visualOverrideCount: Number(finalOverrideSummary.visualCount || 0),
              primOverrideCount: Number(finalOverrideSummary.primOverrideCount || 0),
              materialCount: Number(normalizedMaterials?.length || 0),
              meshDescriptors: normalizedMeshDescriptors,
              materials: normalizedMaterials,
          },
          buffers: {
              positions: positionPool,
              indices: indexPool,
              normals: normalPool,
              uvs: uvPool,
              transforms: transformPool,
              rangesByMeshId: bufferRangesByMeshId,
          },
          robotMetadataSnapshot: normalizedRobotMetadataSnapshot,
      };
  }
  warmupRobotSceneSnapshotFromDriver(driver, options = {}) {
    const forceRefresh = options?.force === true;
    const resolvedDriver = driver || this.config?.driver?.();
    const summary = {
      source: 'none',
      used: false,
      sceneSnapshotReady: false,
      primPathCount: 0,
      transformTotalCount: 0,
      protoBlobCount: 0,
      collisionOverrideCount: 0,
      visualOverrideCount: 0,
      primOverrideCount: 0,
      robotMetadataJointCount: 0,
      robotMetadataDynamicsCount: 0,
      meshDescriptorCount: 0,
      driverSnapshotSource: 'none',
      hydratedProtoMeshAttemptedCount: 0,
      hydratedProtoMeshPendingCount: 0,
    };
    if (!resolvedDriver) return summary;

    const stageSourcePath = String(options?.stageSourcePath || this.getStageSourcePath() || '').trim().split('?')[0];
    const snapshotResult = this.getRobotSceneSnapshotFromDriver(resolvedDriver, {
      stageSourcePath,
    });
    summary.driverSnapshotSource = String(snapshotResult?.source || 'none');
    const rawSnapshot = snapshotResult?.rawSnapshot || null;

    if (!rawSnapshot || typeof rawSnapshot !== 'object') {
      summary.source = String(summary.driverSnapshotSource || 'empty');
      return summary;
    }

    const normalizedSnapshot = this.normalizeRobotSceneSnapshot(rawSnapshot, {
      force: forceRefresh,
      stageSourcePath,
      emitRobotMetadataEvent: options?.emitRobotMetadataEvent === true,
    });
    if (!normalizedSnapshot) {
      summary.source = 'normalize-failed';
      return summary;
    }

    const cacheKey = String(normalizedSnapshot.stageSourcePath || stageSourcePath || '').trim().split('?')[0];
    if (cacheKey) {
      this._runtimeBridgeCacheStageKey = cacheKey;
      this._robotSceneSnapshotByStageSource.set(cacheKey, normalizedSnapshot);
    }
    const hydrateSummary = this.hydratePendingProtoMeshes({ allowDeferredFinalBatch: false });
    const materialApplySummary = this.applySnapshotMaterialsToMeshes();
    this.emitRobotSceneSnapshotReady(normalizedSnapshot);

    summary.source = 'scene-snapshot';
    summary.used = true;
    summary.sceneSnapshotReady = true;
    summary.primPathCount = Number(normalizedSnapshot.render?.primPathCount || 0);
    summary.transformTotalCount = Number(normalizedSnapshot.render?.primTransformCount || 0);
    summary.protoBlobCount = Number(normalizedSnapshot.render?.protoBlobCount || 0);
    summary.collisionOverrideCount = Number(normalizedSnapshot.render?.collisionOverrideCount || 0);
    summary.visualOverrideCount = Number(normalizedSnapshot.render?.visualOverrideCount || 0);
    summary.primOverrideCount = Number(normalizedSnapshot.render?.primOverrideCount || 0);
    summary.robotMetadataJointCount = Number(normalizedSnapshot.robotMetadataSnapshot?.jointCatalogEntries?.length || 0);
    summary.robotMetadataDynamicsCount = Number(normalizedSnapshot.robotMetadataSnapshot?.linkDynamicsEntries?.length || 0);
    summary.meshDescriptorCount = Number(normalizedSnapshot.render?.meshDescriptors?.length || 0);
    summary.hydratedProtoMeshAttemptedCount = Number(hydrateSummary?.attemptedCount || 0);
    summary.hydratedProtoMeshCount = Number(hydrateSummary?.completedCount || 0);
    summary.hydratedProtoMeshPendingCount = Number(hydrateSummary?.pendingCount || 0);
    summary.snapshotMaterialBindCount = Number(materialApplySummary?.boundCount || 0);
    summary.snapshotMaterialInheritCount = Number(materialApplySummary?.inheritedCount || 0);
    return summary;
  }

  getRobotSceneSnapshotFromDriver(driver, options = {}) {
    const resolvedDriver = driver || this.config?.driver?.();
    const stageSourcePath = String(options?.stageSourcePath || this.getStageSourcePath() || '').trim().split('?')[0];
    const runtimeLinkPaths = Array.isArray(options?.runtimeLinkPaths)
      ? options.runtimeLinkPaths
      : [];
    const supportsRobotSceneSnapshot = typeof resolvedDriver?.GetRobotSceneSnapshot === 'function';

    if (supportsRobotSceneSnapshot) {
      try {
        const rawSnapshot = resolvedDriver.GetRobotSceneSnapshot(runtimeLinkPaths, stageSourcePath);
        if (rawSnapshot && typeof rawSnapshot === 'object') {
          return {
            source: 'robot-scene-snapshot',
            rawSnapshot,
            stageSourcePath,
            runtimeLinkPaths,
          };
        }
      } catch {}
    }

    return {
      source: supportsRobotSceneSnapshot ? 'empty-robot-scene-snapshot' : 'unsupported',
      rawSnapshot: null,
      stageSourcePath,
      runtimeLinkPaths,
    };
  }

  hydratePendingProtoMeshes(options = {}) {
    const summary = {
      totalProtoMeshCount: 0,
      attemptedCount: 0,
      completedCount: 0,
      pendingCount: 0,
    };
    for (const hydraMesh of Object.values(this.meshes || {})) {
      if (!hydraMesh || typeof hydraMesh !== 'object') continue;
      if (!String((hydraMesh as any)._id || '').includes('.proto_')) continue;
      summary.totalProtoMeshCount += 1;
      if ((hydraMesh as any)._hasCompletedProtoSync === true) continue;
      summary.attemptedCount += 1;
      try {
        (hydraMesh as any).applyProtoStageSync?.({
          allowDeferredFinalBatch: options?.allowDeferredFinalBatch === true,
        });
        (hydraMesh as any).sanitizeNormalsIfNeeded?.();
        if ((hydraMesh as any)._hasCompletedProtoSync === true) {
          summary.completedCount += 1;
        } else {
          summary.pendingCount += 1;
        }
      } catch {
        summary.pendingCount += 1;
        // Keep one-shot warmup resilient even if a single proto mesh fails.
      }
    }
    return summary;
  }

  hydratePendingResolvedPrimMeshes(options = {}) {
    const summary = {
      totalMeshCount: 0,
      attemptedCount: 0,
      completedCount: 0,
      pendingCount: 0,
      prefetchedPrimOverrideCount: 0,
    };

    const pendingMeshIds = [];
    for (const hydraMesh of Object.values(this.meshes || {})) {
      if (!hydraMesh || typeof hydraMesh !== 'object') continue;

      const meshId = normalizeHydraPath((hydraMesh as any)._id || '');
      if (!meshId || !meshId.startsWith('/')) continue;
      if (meshId.includes('.proto_')) continue;

      const geometry = (hydraMesh as any)?._mesh?.geometry || (hydraMesh as any)?._geometry || null;
      const positionCount = Number(geometry?.getAttribute?.('position')?.count || 0);
      if (positionCount > 0) continue;

      summary.totalMeshCount += 1;
      pendingMeshIds.push(meshId);
    }

    if (pendingMeshIds.length <= 0) {
      return summary;
    }

    const driver = options?.driver || this.config?.driver?.();
    const prefetchSummary = this.prefetchPrimOverrideDataFromDriver(driver, pendingMeshIds, {
      force: options?.force === true,
    });
    summary.prefetchedPrimOverrideCount = Number(prefetchSummary?.count || 0);

    for (const meshId of pendingMeshIds) {
      const hydraMesh = this.meshes?.[meshId];
      if (!hydraMesh || typeof hydraMesh !== 'object') continue;

      summary.attemptedCount += 1;
      try {
        (hydraMesh as any).applyResolvedPrimGeometryAndTransform?.(meshId);
        (hydraMesh as any).sanitizeNormalsIfNeeded?.();
      } catch {
        summary.pendingCount += 1;
        continue;
      }

      const geometry = (hydraMesh as any)?._mesh?.geometry || (hydraMesh as any)?._geometry || null;
      const positionCount = Number(geometry?.getAttribute?.('position')?.count || 0);
      if (positionCount > 0) {
        summary.completedCount += 1;
      } else {
        summary.pendingCount += 1;
      }
    }

    return summary;
  }

  ingestRobotMetadataSnapshotFromBootstrapPayload(rawSnapshot, options = {}) {
    if (!rawSnapshot || typeof rawSnapshot !== 'object') {
      return {
        source: "none",
        ready: false,
        jointCount: 0,
        dynamicsCount: 0,
      };
    }

    const toPlainArray = (value) => (
      Array.isArray(value)
        ? value.slice()
        : (value && typeof value.length === 'number' ? Array.from(value) : [])
    );
    const toPlainObject = (value) => {
      if (!value || typeof value !== 'object') return {};
      return Object.fromEntries(Object.entries(value));
    };
    const resolvedStageSourcePath = String(
      options?.stageSourcePath
      || rawSnapshot.stageSourcePath
      || this.getStageSourcePath()
      || ''
    ).trim().split('?')[0];
    const generatedAtMs = Number(rawSnapshot.generatedAtMs);
    const normalizedSnapshot = {
      stageSourcePath: resolvedStageSourcePath || null,
      generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now(),
      source: String(rawSnapshot.source || 'usd-stage-cpp') || 'usd-stage-cpp',
      linkParentPairs: toPlainArray(rawSnapshot.linkParentPairs),
      jointCatalogEntries: toPlainArray(rawSnapshot.jointCatalogEntries),
      linkDynamicsEntries: toPlainArray(rawSnapshot.linkDynamicsEntries),
      meshCountsByLinkPath: toPlainObject(rawSnapshot.meshCountsByLinkPath),
    };
    const jointCount = normalizedSnapshot.jointCatalogEntries.length;
    const dynamicsCount = normalizedSnapshot.linkDynamicsEntries.length;
    const hasMetadata = jointCount > 0 || dynamicsCount > 0;
    if (!normalizedSnapshot.stageSourcePath) {
      return {
        source: "empty",
        ready: hasMetadata,
        jointCount,
        dynamicsCount,
      };
    }
    if (!hasMetadata && options?.allowEmptySnapshot !== true) {
      // Driver-init bootstrap can run before runtime link paths are fully
      // discovered. Avoid caching empty metadata snapshots, otherwise later
      // warmup calls may incorrectly treat metadata as already ready.
      return {
        source: "empty",
        ready: false,
        jointCount,
        dynamicsCount,
      };
    }

    this._robotMetadataSnapshotByStageSource.set(normalizedSnapshot.stageSourcePath, normalizedSnapshot);
    if (options?.emitEvent === true && typeof this.emitRobotMetadataSnapshotReady === 'function') {
      try {
        this.emitRobotMetadataSnapshotReady(normalizedSnapshot);
      } catch {}
    }

    return {
      source: "bootstrap",
      ready: hasMetadata,
      jointCount,
      dynamicsCount,
    };
  }

  getProtoDataBlob(protoPath, options = {}) {
    if (!protoPath || !protoPath.startsWith('/')) return null;
    if (!this.config?.driver || typeof this.config.driver !== 'function') return null;
    const forceRefresh = options?.forceRefresh === true || options?.force === true;
    const strictOneShotSceneLoad = this.strictOneShotSceneLoad === true;
    const hasSceneSnapshot = this.hasResolvedRobotSceneSnapshot();

    const driver = this.config.driver();
    if (!driver || typeof driver.GetProtoDataBlob !== 'function') return null;

    // Hot path: prefer cache hit or single-proto fetch. Avoid forcing
    // GetAllProtoDataBlobs() here, which can create large first-sync stalls.
    const cached = this._protoDataBlobBatchCache.get(protoPath);
    if (cached && (!forceRefresh || strictOneShotSceneLoad)) return cached;
    if (strictOneShotSceneLoad) return cached || null;
    if (hasSceneSnapshot) return null;
    if (!forceRefresh && this.autoBatchProtoBlobsOnFirstAccess === true && this._protoDataBlobBatchPrimed !== true) {
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
      if (!normalizedBlob) {
        if (forceRefresh) {
          this._protoDataBlobBatchCache.delete(protoPath);
        }
        return null;
      }
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
    if (this.strictOneShotSceneLoad === true) return null;

    const hasSceneSnapshot = this.hasResolvedRobotSceneSnapshot();
    const driver = this.config.driver();
    if (!driver) return null;
    if (hasSceneSnapshot) return null;

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
    if (this.strictOneShotSceneLoad === true) return null;

    const hasSceneSnapshot = this.hasResolvedRobotSceneSnapshot();
    const driver = this.config.driver();
    if (!driver) return null;
    if (hasSceneSnapshot) return null;

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
    if (this.strictOneShotSceneLoad === true) return null;

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
      const primPathCount = Number(this._knownPrimPathSet?.size || 0);
      return { world, local, total: Math.max(world, local, primPathCount), source: "cache" };
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

    const clearTransformCaches = () => {
      this._localXformCache.clear();
      if (this._localXformResetsStackCache instanceof Map) {
        this._localXformResetsStackCache.clear();
      }
      if (this._localXformAuthoredOpsCache instanceof Map) {
        this._localXformAuthoredOpsCache.clear();
      }
      this._worldXformCache.clear();
      if (this._worldXformCacheSourceByPath instanceof Map) {
        this._worldXformCacheSourceByPath.clear();
      }
      this._meshFallbackCache.clear();
      this._linkVisualTransformCache.clear();
      this._urdfLinkWorldTransformCacheByStageSource.clear();
    };

    const syncKnownPrimPathCache = (nextPathSet: Set<string>) => {
      this._knownPrimPathSet = nextPathSet;
      this._knownPrimPathSetPrimed = true;
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
    };
    const packedFormat = String((payload as any)?.format || '').trim().toLowerCase();
    if (packedFormat !== 'packed-v1') {
      return { world: 0, local: 0, total: 0, source: 'unsupported-format' };
    }

    const rawPaths = (payload as any).paths;
    const worldValues = (payload as any).world;
    const localValues = (payload as any).local;
    const strideRaw = Number((payload as any).stride);
    const stride = Number.isFinite(strideRaw) && strideRaw >= 16 ? Math.floor(strideRaw) : 16;
    const pathLength = Number(rawPaths?.length);
    const safePathLength = Number.isFinite(pathLength) && pathLength >= 0 ? Math.floor(pathLength) : 0;
    if (!(worldValues instanceof Float32Array) || !(localValues instanceof Float32Array) || safePathLength <= 0) {
      return { world: 0, local: 0, total: 0, source: 'malformed-packed' };
    }

    clearTransformCaches();
    const nextPathSet = new Set<string>();
    let world = 0;
    let local = 0;
    for (let index = 0; index < safePathLength; index += 1) {
      const primPath = normalizeHydraPath(rawPaths[index]);
      if (!primPath || !primPath.startsWith('/')) continue;
      nextPathSet.add(primPath);

      const worldOffset = index * stride;
      if (worldOffset + 16 <= worldValues.length) {
        const matrix = this.matrixFromWasmTransform(worldValues.subarray(worldOffset, worldOffset + 16));
        if (matrix) {
          this._worldXformCache.set(primPath, matrix);
          if (this._worldXformCacheSourceByPath instanceof Map) {
            this._worldXformCacheSourceByPath.set(primPath, 'driver');
          }
          world += 1;
        }
      }

      const localOffset = index * stride;
      if (localOffset + 16 <= localValues.length) {
        const matrix = this.matrixFromWasmTransform(localValues.subarray(localOffset, localOffset + 16));
        if (matrix) {
          this._localXformCache.set(primPath, matrix);
          local += 1;
        }
      }
    }
    syncKnownPrimPathCache(nextPathSet);

    const collisionContainerRegex = /\/collisions\/mesh_\d+$/i;
    const collisionPrimitiveLeafNames = ['mesh', 'collision_mesh', 'visual_mesh', 'cube', 'sphere', 'cylinder', 'capsule'];
    for (const containerPath of Array.from(this._worldXformCache.keys())) {
      if (!collisionContainerRegex.test(containerPath)) continue;
      for (const primitiveLeafName of collisionPrimitiveLeafNames) {
        const primitivePath = `${containerPath}/${primitiveLeafName}`;
        const primitiveWorld = this._worldXformCache.get(primitivePath);
        if (!primitiveWorld) continue;
        this._worldXformCache.set(containerPath, primitiveWorld.clone());
        if (this._worldXformCacheSourceByPath instanceof Map) {
          this._worldXformCacheSourceByPath.set(containerPath, 'driver');
        }
        break;
      }
    }
    const total = Number((payload as any).count);
    return {
      world,
      local,
      total: Number.isFinite(total) && total > 0 ? total : Math.max(world, local, nextPathSet.size),
      source: forceRefresh ? 'packed-refresh' : 'packed',
    };
  }
  getWorldTransformForPrimPath(primPath, options = {}) {
    if (!this || typeof this !== 'object') return null;
    if (!primPath || !primPath.startsWith('/')) return null;
    const shouldClone = options?.clone !== false;
    const hasSceneSnapshot = this.hasResolvedRobotSceneSnapshot();
    if (!hasSceneSnapshot && this.strictOneShotSceneLoad !== true && this.autoBatchPrimTransformsOnFirstAccess === true && this._primTransformBatchPrimed !== true) {
      const driver = this.config?.driver?.();
      if (driver) {
        try {
          this.prefetchPrimTransformsFromDriver(driver, { force: false });
        } catch {
          // Keep fallback path resilient.
        }
      }
    }

    const cachedWorld = this._worldXformCache.has(primPath)
      ? (this._worldXformCache.get(primPath) || null)
      : null;
    const cachedWorldSource = (this._worldXformCacheSourceByPath instanceof Map)
      ? String(this._worldXformCacheSourceByPath.get(primPath) || '')
      : '';
    const cachedWorldFromDriver = cachedWorld && cachedWorldSource === 'driver';
    if (cachedWorld && !cachedWorldFromDriver) {
      return shouldClone ? cachedWorld.clone() : cachedWorld;
    }
    if (this.strictOneShotSceneLoad === true && !hasSceneSnapshot) {
      if (!cachedWorld) return null;
      return shouldClone ? cachedWorld.clone() : cachedWorld;
    }

    const stage = hasSceneSnapshot ? null : this.getStage();
    if (!stage && !hasSceneSnapshot) {
      if (!cachedWorld) return null;
      return shouldClone ? cachedWorld.clone() : cachedWorld;
    }

    const pathSegments = primPath.split('/').filter(Boolean);
    const worldMatrix = new Matrix4().identity();
    let currentPath = '';
    let hasTransform = false;

    for (const pathSegment of pathSegments) {
      currentPath += '/' + pathSegment;
      const localMatrix = this.getLocalTransformForPrimPath(stage, currentPath, {
        clone: false,
        allowStageFallback: !hasSceneSnapshot,
      });
      if (!localMatrix) continue;
      const resetsXformStack = this.getLocalTransformResetsXformStack(stage, currentPath, {
        allowStageFallback: !hasSceneSnapshot,
      });
      if (resetsXformStack) {
        worldMatrix.copy(localMatrix);
      } else {
        worldMatrix.multiply(localMatrix);
      }
      hasTransform = true;
    }

    // For prims with no explicit transform, keep identity so parent chain still
    // resolves deterministically.
    const recomposedWorld = hasTransform ? worldMatrix : new Matrix4().identity();
    const leafHasAuthoredLocalOps = this.hasAuthoredLocalXformOpsForPrimPath(stage, primPath);

    // Driver-batched world transforms can be inconsistent with local xform-chain
    // composition on some stages. Prefer recomposed results for authored prims,
    // but keep driver values for leaves with no authored xform ops (e.g. some
    // instance-proxy meshes whose extra transform lives in prototype data).
    let resolvedWorld = recomposedWorld;
    if (cachedWorld && cachedWorldFromDriver) {
      const maxDelta = getMatrixMaxElementDelta(cachedWorld, recomposedWorld);
      if (Number.isFinite(maxDelta) && maxDelta <= transformEpsilon) {
        resolvedWorld = cachedWorld;
      } else if (leafHasAuthoredLocalOps !== true) {
        resolvedWorld = cachedWorld;
      }
    }

    const cachedResult = resolvedWorld.clone();
    this._worldXformCache.set(primPath, cachedResult);
    if (this._worldXformCacheSourceByPath instanceof Map) {
      this._worldXformCacheSourceByPath.set(primPath, 'computed');
    }
    return shouldClone ? cachedResult.clone() : cachedResult;
  }

  hasAuthoredLocalXformOpsForPrimPath(stage, primPath) {
    if (!primPath || !primPath.startsWith('/')) return false;
    if (this._localXformAuthoredOpsCache instanceof Map && this._localXformAuthoredOpsCache.has(primPath)) {
      return this._localXformAuthoredOpsCache.get(primPath) === true;
    }
    if (!stage || typeof stage.GetPrimAtPath !== 'function') {
      if (this._localXformAuthoredOpsCache instanceof Map) {
        this._localXformAuthoredOpsCache.set(primPath, false);
      }
      return false;
    }

    let hasAuthoredOps = false;
    try {
      const prim = stage.GetPrimAtPath(primPath);
      if (!prim || typeof prim.GetAttribute !== 'function') {
        hasAuthoredOps = false;
      } else {
        let xformOrder = [];
        const xformOpOrderAttr = prim.GetAttribute('xformOpOrder');
        if (xformOpOrderAttr) {
          try {
            xformOrder = xformOpOrderAttr.Get() || [];
          } catch {
            xformOrder = [];
          }
        }
        if (!Array.isArray(xformOrder) && xformOrder && typeof xformOrder[Symbol.iterator] === 'function') {
          xformOrder = Array.from(xformOrder);
        }
        if (Array.isArray(xformOrder)) {
          const normalizedOrder = xformOrder
            .map((entry) => normalizeHydraPath(entry))
            .filter((entry) => !!entry);
          hasAuthoredOps = normalizedOrder.some((entry) => entry === '!resetXformStack!' || entry.startsWith('xformOp:'));
        }

        if (!hasAuthoredOps) {
          let propertyNames = [];
          try {
            propertyNames = prim.GetPropertyNames?.() || [];
          } catch {
            propertyNames = [];
          }
          propertyNames = Array.isArray(propertyNames) ? propertyNames : Array.from(propertyNames || []);
          hasAuthoredOps = propertyNames
            .map((name) => normalizeHydraPath(name))
            .some((name) => !!name && name.startsWith('xformOp:') && name !== 'xformOpOrder');
        }

        if (!hasAuthoredOps && this.enableXformOpFallbackFromLayerText === true) {
          const fallbackOpNames = this.getFallbackXformOpNamesForPrimPath(primPath);
          hasAuthoredOps = Array.isArray(fallbackOpNames) && fallbackOpNames.length > 0;
        }
      }
    } catch {
      hasAuthoredOps = false;
    }

    if (this._localXformAuthoredOpsCache instanceof Map) {
      this._localXformAuthoredOpsCache.set(primPath, hasAuthoredOps === true);
    }
    return hasAuthoredOps === true;
  }

  getLocalTransformResetsXformStack(stage, primPath, options = {}) {
    if (this._localXformResetsStackCache instanceof Map && this._localXformResetsStackCache.has(primPath)) {
      return this._localXformResetsStackCache.get(primPath) === true;
    }
    const allowStageFallback = options?.allowStageFallback !== false;
    if (!allowStageFallback || !stage || typeof stage.GetPrimAtPath !== 'function') {
      if (this._localXformResetsStackCache instanceof Map) {
        this._localXformResetsStackCache.set(primPath, false);
      }
      return false;
    }

    let resetsXformStack = false;
    try {
      const prim = stage.GetPrimAtPath(primPath);
      const xformOpOrderAttr = prim?.GetAttribute?.('xformOpOrder');
      if (xformOpOrderAttr) {
        let xformOrder = [];
        try {
          xformOrder = xformOpOrderAttr.Get() || [];
        } catch {
          xformOrder = [];
        }
        if (!Array.isArray(xformOrder) && xformOrder && typeof xformOrder[Symbol.iterator] === 'function') {
          xformOrder = Array.from(xformOrder);
        }
        if (Array.isArray(xformOrder)) {
          resetsXformStack = xformOrder.some((entry) => normalizeHydraPath(entry) === '!resetXformStack!');
        }
      }
    } catch {
      resetsXformStack = false;
    }

    if (this._localXformResetsStackCache instanceof Map) {
      this._localXformResetsStackCache.set(primPath, resetsXformStack);
    }
    return resetsXformStack;
  }

  getLocalTransformForPrimPath(stage, primPath, options = {}) {
    if (!this || typeof this !== 'object') return null;
    const shouldClone = options?.clone !== false;
    const allowStageFallback = options?.allowStageFallback !== false;
    if (this._localXformCache.has(primPath)) {
      const cached = this._localXformCache.get(primPath);
      if (!cached) return null;
      return shouldClone ? cached.clone() : cached;
    }

    if (!allowStageFallback || !stage || typeof stage.GetPrimAtPath !== 'function') {
      return null;
    }

    let prim = null;
    try {
      prim = stage.GetPrimAtPath(primPath);
    } catch {
      this._localXformCache.set(primPath, null);
      if (this._localXformResetsStackCache instanceof Map) {
        this._localXformResetsStackCache.set(primPath, false);
      }
      return null;
    }
    if (!prim) {
      this._localXformCache.set(primPath, null);
      if (this._localXformResetsStackCache instanceof Map) {
        this._localXformResetsStackCache.set(primPath, false);
      }
      return null;
    }
    if (typeof prim.GetAttribute !== 'function') {
      this._localXformCache.set(primPath, null);
      if (this._localXformResetsStackCache instanceof Map) {
        this._localXformResetsStackCache.set(primPath, false);
      }
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
      if (this._localXformResetsStackCache instanceof Map) {
        this._localXformResetsStackCache.set(primPath, false);
      }
      return shouldClone ? identityMatrix.clone() : identityMatrix;
    }

    const localMatrix = new Matrix4().identity();
    let hasTransform = false;
    let resetsXformStack = false;
    const invertPrefix = '!invert!';

    for (const rawOpName of xformOrder) {
      const opToken = normalizeHydraPath(rawOpName);
      if (!opToken) continue;

      if (opToken === '!resetXformStack!') {
        localMatrix.identity();
        resetsXformStack = true;
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
    if (this._localXformResetsStackCache instanceof Map) {
      this._localXformResetsStackCache.set(primPath, resetsXformStack === true);
    }
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
    if (!normalizedInstancerId && this.shouldSuppressSyntheticTopLevelMesh?.(normalizedId) === true) {
      return this.createNoopRPrim();
    }
    const loweredId = String(normalizedId || '').toLowerCase();
    const isCollisionPrim = COLLISION_SEGMENT_PATTERN.test(loweredId);
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
    this._meshMutationVersion = Number(this._meshMutationVersion || 0) + 1;
    this._stageOverrideProtoMeshCache = null;
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
    const resolvedDriver = typeof this.config?.driver === 'function'
      ? this.config.driver()
      : null;
    const shouldPrimeFinalStageOverrides = (
      this.preferFinalStageOverrideBatchInProtoSync === true
      && !this.hasResolvedRobotSceneSnapshot()
      && !!resolvedDriver
      && typeof this.prefetchFinalStageOverrideBatchFromDriver === 'function'
      && (
        this.autoBatchCollisionProtoOverridesOnFirstAccess === true
        || this.autoBatchVisualProtoOverridesOnFirstAccess === true
      )
      && this._finalStageOverrideBatchPrimed !== true
      && Object.keys(this.meshes || {}).some((meshId) => String(meshId).includes('.proto_'))
    );
    if (shouldPrimeFinalStageOverrides) {
      try {
        this.prefetchFinalStageOverrideBatchFromDriver(resolvedDriver, { force: false });
      } catch {}
    }
    const deltaBatchSummary = this.pullRprimDeltaBatchFromDriver?.(resolvedDriver) || null;
    const shouldUseDirtyMeshCommit = deltaBatchSummary?.ok === true;
    const dirtyMeshIds = shouldUseDirtyMeshCommit
      ? new Set<string>(deltaBatchSummary?.meshIds || [])
      : null;
    if (dirtyMeshIds) {
      for (const [meshId, hydraMesh] of Object.entries(this.meshes || {})) {
        if (!hydraMesh) continue;
        if (hydraMesh?._pendingMaterialId) {
          dirtyMeshIds.add(meshId);
          continue;
        }
        if (meshId.includes(".proto_") && hydraMesh?._hasCompletedProtoSync !== true) {
          dirtyMeshIds.add(meshId);
        }
      }
    }

    if (hasSyncHotPathGuard) {
      this.enterHydraSyncHotPath();
    }
    try {
      if (dirtyMeshIds) {
        for (const meshId of dirtyMeshIds) {
          const hydraMesh = this.meshes[meshId];
          if (!hydraMesh) continue;
          hydraMesh.commit(commitProfile);
        }
      } else {
        for (const id in this.meshes) {
          const hydraMesh = this.meshes[id];
          hydraMesh.commit(commitProfile);
        }
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
