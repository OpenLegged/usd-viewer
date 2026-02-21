// @ts-nocheck
import { Color, LinearSRGBColorSpace, Matrix4, SRGBColorSpace, Vector2, } from 'three';
import * as Shared from './shared.js';
import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js';
import { HydraInstancer } from './HydraInstancer.js';
import { HydraMaterial } from './HydraMaterial.js';
import { HydraMesh } from './HydraMesh.js';
import { getDefaultMaterial } from './default-material-state.js';
const { buildProtoPrimPathCandidates, clamp01, createMatrixFromXformOp, debugInstancer, debugMaterials, debugMeshes, debugPrims, debugTextures, defaultGrayComponent, disableMaterials, disableTextures, extractPrimPathFromMaterialBindingWarning, extractReferencePrimTargets, extractScopeBodyText, extractUsdAssetReferencesFromLayerText, getActiveMaterialBindingWarningOwner, getAngleInRadians, getCollisionGeometryTypeFromUrdfElement, getExpectedPrimTypesForCollisionProto, getExpectedPrimTypesForProtoType, getMatrixMaxElementDelta, getPathBasename, getPathWithoutRoot, getRawConsoleMethod, getRootPathFromPrimPath, getSafePrimTypeName, hasNonZeroTranslation, hydraCallbackErrorCounts, installMaterialBindingApiWarningInterceptor, isIdentityQuaternion, isLikelyDefaultGrayMaterial, isLikelyInverseTransform, isMaterialBindingApiWarningMessage, isMatrixApproximatelyIdentity, isNonZero, isPotentiallyLargeBaseAssetPath, logHydraCallbackError, materialBindingRepairMaxLayerTextLength, materialBindingWarningHandlers, maxHydraCallbackErrorLogsPerMethod, nearlyEqual, normalizeHydraPath, normalizeUsdPathToken, parseGuideCollisionReferencesFromLayerText, parseProtoMeshIdentifier, parseUrdfTruthFromText, parseVector3Text, parseXformOpFallbacksFromLayerText, rawConsoleError, rawConsoleWarn, registerMaterialBindingApiWarningHandler, remapRootPathIfNeeded, resolveUrdfTruthFileNameForStagePath, resolveUsdAssetPath, setActiveMaterialBindingWarningOwner, shouldAllowLargeBaseAssetScan, stringifyConsoleArgs, toArrayLike, toColorArray, toFiniteNumber, toFiniteQuaternionWxyzTuple, toFiniteVector2Tuple, toFiniteVector3Tuple, toMatrixFromUrdfOrigin, toQuaternionWxyzFromRpy, transformEpsilon, wrapHydraCallbackObject } = Shared;
export class ThreeRenderDelegateInterface extends ThreeRenderDelegateMaterialOps {
    applyStageFallbackMaterialParameters(material, shaderPrim) {
        if (!material || !shaderPrim)
            return;
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
                if (value < 1)
                    material.transparent = true;
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
                if (value > 0)
                    material.transparent = false;
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
                if (scalar === undefined)
                    return null;
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
                if (scalar === undefined)
                    return null;
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
                if (!(material.alphaTest > 0))
                    material.transparent = true;
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
        if (numericValue === undefined)
            return false;
        let normalizedValue = numericValue;
        if (options.clamp01)
            normalizedValue = clamp01(normalizedValue);
        if (Number.isFinite(options.min))
            normalizedValue = Math.max(Number(options.min), normalizedValue);
        if (Number.isFinite(options.max))
            normalizedValue = Math.min(Number(options.max), normalizedValue);
        material[materialProperty] = normalizedValue;
        if (typeof options.onAssigned === 'function') {
            options.onAssigned(normalizedValue);
        }
        return true;
    }
    applyStageFallbackColorInput(material, shaderPrim, attributeNames, materialProperty, options = {}) {
        const value = this.readPrimAttribute(shaderPrim, attributeNames);
        const color = toColorArray(value);
        if (!color)
            return null;
        if (options.requireValue === false)
            return color;
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
        if (!texturePath)
            return false;
        this.registry.getTexture(texturePath).then((texture) => {
            const nextTexture = texture?.clone ? texture.clone() : texture;
            if (!nextTexture)
                return;
            nextTexture.colorSpace = options.colorSpace || LinearSRGBColorSpace;
            nextTexture.needsUpdate = true;
            material[materialProperty] = nextTexture;
            if (typeof options.onAssigned === 'function') {
                options.onAssigned(nextTexture);
            }
            material.needsUpdate = true;
        }).catch(() => { });
        return true;
    }
    safeGetPrimAtPath(stage, path) {
        if (!stage || !path)
            return null;
        try {
            const prim = stage.GetPrimAtPath(path);
            if (!prim)
                return null;
            return prim;
        }
        catch {
            return null;
        }
    }
    findMaterialShaderPrim(stage, materialPath, materialName) {
        const candidateNames = [];
        const addCandidate = (name) => {
            if (!name || candidateNames.includes(name))
                return;
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
            if (!shaderPrim)
                continue;
            if (this.isUsableMaterialShaderPrim(shaderPrim)) {
                return shaderPrim;
            }
        }
        return null;
    }
    isUsableMaterialShaderPrim(shaderPrim) {
        if (!shaderPrim)
            return false;
        const shaderType = getSafePrimTypeName(shaderPrim);
        if (shaderType === 'shader')
            return true;
        if (shaderType && shaderType !== 'shader')
            return false;
        let propertyNames = [];
        try {
            propertyNames = shaderPrim.GetPropertyNames?.() || [];
        }
        catch {
            propertyNames = [];
        }
        if (!Array.isArray(propertyNames) && propertyNames && typeof propertyNames[Symbol.iterator] === 'function') {
            propertyNames = Array.from(propertyNames);
        }
        if (!Array.isArray(propertyNames) || propertyNames.length === 0)
            return false;
        return propertyNames.some((name) => name === 'info:id' ||
            name.startsWith('inputs:') ||
            name.startsWith('outputs:'));
    }
    getPreferredShaderName(materialName) {
        if (!materialName)
            return 'Shader';
        const lowered = materialName.toLowerCase();
        if (lowered === 'material_dark' || lowered === 'material_white')
            return 'Shader';
        if (/^material_[0-9]{9}$/i.test(materialName))
            return 'Shader';
        return materialName;
    }
    inferColorHexFromMaterialName(materialName) {
        const normalized = String(materialName || '').trim();
        if (!normalized)
            return null;
        const match = normalized.match(/([0-9a-f]{6})$/i);
        if (!match)
            return null;
        const parsed = Number.parseInt(match[1], 16);
        if (!Number.isFinite(parsed))
            return null;
        return parsed;
    }
    readPrimAttribute(prim, attributeNames) {
        if (!prim || !Array.isArray(attributeNames))
            return undefined;
        for (const attributeName of attributeNames) {
            let value = undefined;
            try {
                value = prim.GetAttribute(attributeName)?.Get();
            }
            catch {
                value = undefined;
            }
            if (value !== undefined && value !== null)
                return value;
        }
        return undefined;
    }
    normalizeMaterialTexturePath(pathValue) {
        if (pathValue === null || pathValue === undefined)
            return null;
        const text = String(pathValue || '').trim();
        if (!text)
            return null;
        const withoutAssetDelimiters = text.replace(/^@+/, '').replace(/@+$/, '');
        const normalizedPath = withoutAssetDelimiters.replace(/\\/g, '/');
        if (!normalizedPath)
            return null;
        return normalizedPath.replace('./', '');
    }
    extractMaterialTexturePath(texturePathValue) {
        if (!texturePathValue)
            return null;
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
        }
        catch { }
        try {
            if (typeof texturePathValue.GetAssetPath === 'function') {
                const assetPath = texturePathValue.GetAssetPath();
                if (typeof assetPath === 'string' && assetPath.length > 0) {
                    return this.normalizeMaterialTexturePath(assetPath);
                }
            }
        }
        catch { }
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
        if (!texturePathValue)
            return null;
        return this.extractMaterialTexturePath(texturePathValue);
    }
    getNamedNonDefaultMaterial(materialValue) {
        const materials = Array.isArray(materialValue) ? materialValue : [materialValue];
        let fallbackMaterial = null;
        for (const material of materials) {
            if (!material || material === getDefaultMaterial())
                continue;
            if (isLikelyDefaultGrayMaterial(material))
                continue;
            const materialName = String(material.name || '').trim();
            const hasExplicitName = materialName.length > 0 && materialName !== 'DefaultMaterial';
            if (hasExplicitName)
                return material;
            if (!fallbackMaterial)
                fallbackMaterial = material;
        }
        return fallbackMaterial;
    }
    getPreferredVisualMaterialForLink(linkPath, requestingMeshId = null) {
        if (!linkPath)
            return null;
        if (this._preferredVisualMaterialByLinkCache.has(linkPath)) {
            return this._preferredVisualMaterialByLinkCache.get(linkPath) || null;
        }
        const prefix = `${linkPath}/visuals.proto_`;
        let preferredMaterial = null;
        let bestScore = -1;
        for (const [meshId, mesh] of Object.entries(this.meshes)) {
            if (!meshId || !meshId.startsWith(prefix) || meshId === requestingMeshId)
                continue;
            const candidateMaterial = this.getNamedNonDefaultMaterial(mesh?._mesh?.material);
            if (!candidateMaterial)
                continue;
            let score = 0;
            if (meshId.endsWith('/visuals.proto_mesh_id0'))
                score += 100;
            else if (meshId.includes('/visuals.proto_mesh_id'))
                score += 80;
            else if (meshId.includes('/visuals.proto_'))
                score += 40;
            const materialName = String(candidateMaterial.name || '').trim();
            if (materialName.length > 0 && materialName !== 'DefaultMaterial')
                score += 20;
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
        if (this._hasRunStageTruthAlignmentDiagnostics)
            return;
        this._hasRunStageTruthAlignmentDiagnostics = true;
        const diagnosticsEnabled = typeof window !== 'undefined'
            && /\bdebugStageAlignment=1\b/.test(String(window.location?.search || ''));
        if (!diagnosticsEnabled)
            return;
        const linkPaths = new Set();
        for (const meshId of Object.keys(this.meshes)) {
            const proto = parseProtoMeshIdentifier(meshId);
            if (!proto?.linkPath)
                continue;
            linkPaths.add(proto.linkPath);
        }
        if (linkPaths.size === 0)
            return;
        const mismatches = [];
        const sampledLinkPaths = Array.from(linkPaths).sort().slice(0, 24);
        for (const linkPath of sampledLinkPaths) {
            const stageMatrix = this.getWorldTransformForPrimPath(linkPath);
            if (!stageMatrix)
                continue;
            const meshMatrix = this.getRepresentativeVisualTransformForLinkPath(linkPath)
                || this.meshes[`${linkPath}/visuals.proto_mesh_id0`]?._mesh?.matrix
                || null;
            if (!meshMatrix)
                continue;
            let maxElementDelta = 0;
            for (let elementIndex = 0; elementIndex < 16; elementIndex++) {
                const delta = Math.abs((meshMatrix.elements[elementIndex] || 0) - (stageMatrix.elements[elementIndex] || 0));
                if (delta > maxElementDelta)
                    maxElementDelta = delta;
            }
            if (maxElementDelta > transformEpsilon) {
                mismatches.push(`${linkPath} (maxΔ=${maxElementDelta.toExponential(2)})`);
            }
        }
        void mismatches;
    }
    getRepresentativeVisualTransformForMeshId(meshId) {
        if (!meshId || !meshId.includes('.proto_'))
            return null;
        const proto = this._protoMeshMetadataByMeshId.get(meshId) || parseProtoMeshIdentifier(meshId);
        if (!proto || !proto.linkPath)
            return null;
        return this.getRepresentativeVisualTransformForLinkPath(proto.linkPath);
    }
    registerMeshLinkPathIndex(meshId) {
        if (!meshId || !meshId.includes('.proto_'))
            return null;
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto?.linkPath)
            return null;
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
        if (!matrix)
            return false;
        const position = this._decomposeScratchPosition;
        const quaternion = this._decomposeScratchQuaternion;
        const scale = this._decomposeScratchScale;
        matrix.decompose(position, quaternion, scale);
        return !isIdentityQuaternion(quaternion);
    }
    updateRepresentativeVisualTransformIndex(meshId, matrix) {
        if (!meshId || !meshId.includes('.proto_'))
            return;
        const proto = this._protoMeshMetadataByMeshId.get(meshId) || this.registerMeshLinkPathIndex(meshId);
        if (!proto?.linkPath)
            return;
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
        if (!linkPath)
            return null;
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
        if (!meshId || !meshId.includes('.proto_'))
            return null;
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
        }
        catch {
            return null;
        }
    }
    matrixFromWasmTransform(rawMatrix) {
        const rawValues = (rawMatrix && (Array.isArray(rawMatrix)
            || ArrayBuffer.isView(rawMatrix)
            || typeof rawMatrix.length === "number"))
            ? rawMatrix
            : toArrayLike(rawMatrix);
        if (!rawValues || Number(rawValues.length) < 16)
            return null;
        const m00 = Number(rawValues[0]);
        const m01 = Number(rawValues[1]);
        const m02 = Number(rawValues[2]);
        const m03 = Number(rawValues[3]);
        const m10 = Number(rawValues[4]);
        const m11 = Number(rawValues[5]);
        const m12 = Number(rawValues[6]);
        const m13 = Number(rawValues[7]);
        const m20 = Number(rawValues[8]);
        const m21 = Number(rawValues[9]);
        const m22 = Number(rawValues[10]);
        const m23 = Number(rawValues[11]);
        const m30 = Number(rawValues[12]);
        const m31 = Number(rawValues[13]);
        const m32 = Number(rawValues[14]);
        const m33 = Number(rawValues[15]);
        if (!Number.isFinite(m00) || !Number.isFinite(m01) || !Number.isFinite(m02) || !Number.isFinite(m03)
            || !Number.isFinite(m10) || !Number.isFinite(m11) || !Number.isFinite(m12) || !Number.isFinite(m13)
            || !Number.isFinite(m20) || !Number.isFinite(m21) || !Number.isFinite(m22) || !Number.isFinite(m23)
            || !Number.isFinite(m30) || !Number.isFinite(m31) || !Number.isFinite(m32) || !Number.isFinite(m33))
            return null;
        // USD bindings expose row-major matrix values; Three.js Matrix4 expects
        // column-major storage internally, so transpose once after assignment.
        const matrix = new Matrix4();
        matrix.set(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33);
        matrix.transpose();
        return matrix;
    }
    normalizeProtoDataBlob(rawBlob) {
        if (!rawBlob || typeof rawBlob !== 'object')
            return null;
        if (rawBlob.valid !== true)
            return null;
        const toNonNegativeInt = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric < 0)
                return 0;
            return Math.floor(numeric);
        };
        const toAlignedPtr = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric <= 0)
                return 0;
            const ptr = Math.floor(numeric);
            return (ptr % 4) === 0 ? ptr : 0;
        };
        const keepTypedArrayView = (value) => {
            if (!value || typeof value.length !== 'number')
                return undefined;
            return ArrayBuffer.isView(value) ? value : undefined;
        };
        const keepSmallArrayLike = (value, maxLength) => {
            if (!value || typeof value.length !== 'number')
                return undefined;
            if (ArrayBuffer.isView(value))
                return value;
            const length = Number(value.length);
            if (!Number.isFinite(length) || length <= 0 || length > maxLength)
                return undefined;
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
            normalsPtr: toAlignedPtr(rawBlob.normalsPtr),
            numNormals: toNonNegativeInt(rawBlob.numNormals),
            normalsDimension: toNonNegativeInt(rawBlob.normalsDimension),
            materialId: typeof rawBlob.materialId === 'string'
                ? normalizeHydraPath(rawBlob.materialId)
                : '',
            points: keepTypedArrayView(rawBlob.points),
            indices: keepTypedArrayView(rawBlob.indices),
            uv: keepTypedArrayView(rawBlob.uv),
            normals: keepTypedArrayView(rawBlob.normals),
            transform: keepSmallArrayLike(rawBlob.transform, 32),
        };
    }
    prefetchProtoDataBlobsFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        const resolvedDriver = driver || this.config?.driver?.();
        if (!resolvedDriver)
            return { count: 0, source: "none" };
        if (this._protoDataBlobBatchPrimed === true && !forceRefresh) {
            return { count: Number(this._protoDataBlobBatchCache?.size || 0), source: "cache" };
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
    warmupRuntimeBridgeFromDriver(driver, options = {}) {
        const resolvedDriver = driver || this.config?.driver?.();
        const forceRefresh = options?.force === true;
        const includePrimTransforms = options?.includePrimTransforms !== false;
        const includeProtoDataBlobs = options?.includeProtoDataBlobs !== false;
        const includeResolvedPrimPathIndex = options?.includeResolvedPrimPathIndex !== false;
        const includeRobotMetadata = options?.includeRobotMetadata === true;
        const summary = {
            driverReady: !!resolvedDriver,
            protoBlobCount: 0,
            protoBlobSource: "none",
            worldTransformCount: 0,
            localTransformCount: 0,
            transformTotalCount: 0,
            transformSource: "none",
            protoMeshCount: 0,
            resolvedCollisionPrimCount: 0,
            resolvedVisualPrimCount: 0,
            robotMetadataWarmupStarted: false,
        };
        if (!resolvedDriver)
            return summary;
        if (includePrimTransforms) {
            try {
                const transformSummary = this.prefetchPrimTransformsFromDriver(resolvedDriver, { force: forceRefresh }) || {};
                summary.worldTransformCount = Number(transformSummary.world || 0);
                summary.localTransformCount = Number(transformSummary.local || 0);
                summary.transformTotalCount = Number(transformSummary.total || 0);
                summary.transformSource = String(transformSummary.source || "batch");
            }
            catch { }
        }
        if (includeProtoDataBlobs) {
            try {
                const protoSummary = this.prefetchProtoDataBlobsFromDriver(resolvedDriver, { force: forceRefresh }) || {};
                summary.protoBlobCount = Number(protoSummary.count || 0);
                summary.protoBlobSource = String(protoSummary.source || "batch");
            }
            catch { }
        }
        for (const meshId of Object.keys(this.meshes || {})) {
            if (!meshId || !meshId.includes('.proto_'))
                continue;
            const proto = this.registerMeshLinkPathIndex(meshId);
            if (!proto)
                continue;
            summary.protoMeshCount += 1;
            if (!includeResolvedPrimPathIndex)
                continue;
            if (proto.sectionName === 'collisions') {
                const resolvedCollisionPath = this.getResolvedPrimPathForMeshId(meshId);
                if (resolvedCollisionPath)
                    summary.resolvedCollisionPrimCount += 1;
            }
            else if (proto.sectionName === 'visuals') {
                const resolvedVisualPath = this.getResolvedVisualTransformPrimPathForMeshId(meshId);
                if (resolvedVisualPath)
                    summary.resolvedVisualPrimCount += 1;
            }
        }
        if (includeRobotMetadata && typeof this.startRobotMetadataWarmupForStage === 'function') {
            try {
                const maybePromise = this.startRobotMetadataWarmupForStage({ force: forceRefresh });
                summary.robotMetadataWarmupStarted = !!maybePromise;
            }
            catch {
                summary.robotMetadataWarmupStarted = false;
            }
        }
        return summary;
    }
    getProtoDataBlob(protoPath) {
        if (!protoPath || !protoPath.startsWith('/'))
            return null;
        if (!this.config?.driver || typeof this.config.driver !== 'function')
            return null;
        const driver = this.config.driver();
        if (!driver || typeof driver.GetProtoDataBlob !== 'function')
            return null;
        // Hot path: prefer cache hit or single-proto fetch. Avoid forcing
        // GetAllProtoDataBlobs() here, which can create large first-sync stalls.
        const cached = this._protoDataBlobBatchCache.get(protoPath);
        if (cached)
            return cached;
        if (this.autoBatchProtoBlobsOnFirstAccess === true && this._protoDataBlobBatchPrimed !== true) {
            try {
                this.prefetchProtoDataBlobsFromDriver(driver, { force: false });
                const batchCached = this._protoDataBlobBatchCache.get(protoPath);
                if (batchCached)
                    return batchCached;
            }
            catch {
                // Fall through to per-proto fallback.
            }
        }
        try {
            const blob = driver.GetProtoDataBlob(protoPath);
            const normalizedBlob = this.normalizeProtoDataBlob(blob);
            if (!normalizedBlob)
                return null;
            this._protoDataBlobBatchCache.set(protoPath, normalizedBlob);
            return normalizedBlob;
        }
        catch {
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
        }
        catch {
            return { world: 0, local: 0, total: 0, source: "error" };
        }
        if (!payload || typeof payload !== 'object') {
            return { world: 0, local: 0, total: 0, source: "empty" };
        }
        const ingestTransformMap = (sourceMap, targetCache) => {
            if (!sourceMap || typeof sourceMap !== 'object')
                return 0;
            let loaded = 0;
            for (const [primPath, rawMatrix] of Object.entries(sourceMap)) {
                if (!primPath || !primPath.startsWith('/'))
                    continue;
                const matrix = this.matrixFromWasmTransform(rawMatrix);
                if (!matrix)
                    continue;
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
        if (!this || typeof this !== 'object')
            return null;
        if (!primPath || !primPath.startsWith('/'))
            return null;
        const shouldClone = options?.clone !== false;
        if (this._worldXformCache.has(primPath)) {
            const cached = this._worldXformCache.get(primPath);
            if (!cached)
                return null;
            return shouldClone ? cached.clone() : cached;
        }
        if (this.autoBatchPrimTransformsOnFirstAccess === true && this._primTransformBatchPrimed !== true) {
            const driver = this.config?.driver?.();
            if (driver) {
                try {
                    this.prefetchPrimTransformsFromDriver(driver, { force: false });
                }
                catch {
                    // Keep fallback path resilient.
                }
            }
            if (this._worldXformCache.has(primPath)) {
                const batchCached = this._worldXformCache.get(primPath);
                if (!batchCached)
                    return null;
                return shouldClone ? batchCached.clone() : batchCached;
            }
        }
        const stage = this.getStage();
        if (!stage)
            return null;
        const pathSegments = primPath.split('/').filter(Boolean);
        const worldMatrix = new Matrix4().identity();
        let currentPath = '';
        let hasTransform = false;
        for (const pathSegment of pathSegments) {
            currentPath += '/' + pathSegment;
            const localMatrix = this.getLocalTransformForPrimPath(stage, currentPath, { clone: false });
            if (!localMatrix)
                continue;
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
        if (!this || typeof this !== 'object')
            return null;
        const shouldClone = options?.clone !== false;
        if (this._localXformCache.has(primPath)) {
            const cached = this._localXformCache.get(primPath);
            if (!cached)
                return null;
            return shouldClone ? cached.clone() : cached;
        }
        if (!stage || typeof stage.GetPrimAtPath !== 'function') {
            this._localXformCache.set(primPath, null);
            return null;
        }
        let prim = null;
        try {
            prim = stage.GetPrimAtPath(primPath);
        }
        catch {
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
            }
            catch {
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
            }
            catch {
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
            if (!opToken)
                continue;
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
            }
            catch (error) {
                opReadError = error;
                opValue = allowLayerTextXformFallback
                    ? this.getFallbackXformOpValueForPrimPath(primPath, opName)
                    : undefined;
            }
            if (opValue === undefined || opValue === null) {
                const errorText = String(opReadError || '');
                const isQuatReadFailure = (opName.startsWith('xformOp:orient')
                    && errorText.includes('BindingError')
                    && errorText.includes('GfQuat'));
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
            if (opValue === undefined || opValue === null)
                continue;
            const opMatrix = createMatrixFromXformOp(opName, opValue);
            if (!opMatrix)
                continue;
            if (invert)
                opMatrix.invert();
            localMatrix.multiply(opMatrix);
            hasTransform = true;
        }
        const result = hasTransform ? localMatrix : null;
        const cachedResult = result ? result.clone() : null;
        this._localXformCache.set(primPath, cachedResult);
        if (!cachedResult)
            return null;
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
        const noop = () => { };
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
        }
        else if (typeId === 'skeleton') {
            let skeleton = new HydraSkeleton(normalizedId, this);
            this.skeletons[normalizedId] = skeleton;
            return wrapHydraCallbackObject(skeleton, "SPrimSkeleton");
        }
        else {
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
                const hydraMesh = this.meshes[id];
                hydraMesh.commit(commitProfile);
            }
            for (const id in this.instancers) {
                const instancer = this.instancers[id];
                instancer.commit();
            }
        }
        finally {
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
