// @ts-nocheck
import { Bone, Matrix4, Skeleton } from 'three';
import * as Shared from './shared.js';
const { buildProtoPrimPathCandidates, clamp01, createMatrixFromXformOp, debugInstancer, debugMaterials, debugMeshes, debugPrims, debugTextures, defaultGrayComponent, disableMaterials, disableTextures, extractPrimPathFromMaterialBindingWarning, extractReferencePrimTargets, extractScopeBodyText, extractUsdAssetReferencesFromLayerText, getActiveMaterialBindingWarningOwner, getAngleInRadians, getCollisionGeometryTypeFromUrdfElement, getExpectedPrimTypesForCollisionProto, getExpectedPrimTypesForProtoType, getMatrixMaxElementDelta, getPathBasename, getPathWithoutRoot, getRawConsoleMethod, getRootPathFromPrimPath, getSafePrimTypeName, hasNonZeroTranslation, hydraCallbackErrorCounts, installMaterialBindingApiWarningInterceptor, isIdentityQuaternion, isLikelyDefaultGrayMaterial, isLikelyInverseTransform, isMaterialBindingApiWarningMessage, isMatrixApproximatelyIdentity, isNonZero, isPotentiallyLargeBaseAssetPath, logHydraCallbackError, materialBindingRepairMaxLayerTextLength, materialBindingWarningHandlers, maxHydraCallbackErrorLogsPerMethod, nearlyEqual, normalizeHydraPath, normalizeUsdPathToken, parseGuideCollisionReferencesFromLayerText, parseProtoMeshIdentifier, parseUrdfTruthFromText, parseVector3Text, parseXformOpFallbacksFromLayerText, rawConsoleError, rawConsoleWarn, registerMaterialBindingApiWarningHandler, remapRootPathIfNeeded, resolveUrdfTruthFileNameForStagePath, resolveUsdAssetPath, setActiveMaterialBindingWarningOwner, shouldAllowLargeBaseAssetScan, stringifyConsoleArgs, toArrayLike, toColorArray, toFiniteNumber, toFiniteQuaternionWxyzTuple, toFiniteVector2Tuple, toFiniteVector3Tuple, toMatrixFromUrdfOrigin, toQuaternionWxyzFromRpy, transformEpsilon, wrapHydraCallbackObject } = Shared;
class HydraSkeleton {
    constructor(id, hydraInterface) {
        this._id = normalizeHydraPath(id);
        this._interface = hydraInterface;
        this._bones = [];
        this._skeleton = null;
        // Data storage
        this._jointNames = [];
        this._restTransforms = [];
        this._bindTransforms = [];
        this._topology = []; // parent indices
    }
    updateNode(networkId, path, parameters) {
        if (debugPrims)
            console.log("HydraSkeleton updateNode", networkId, path, parameters);
        // Hydra/USD parameters often come with specific names
        // We check for common ones used in UsdSkel
        if (parameters.joints)
            this._jointNames = parameters.joints;
        if (parameters.bindTransforms)
            this._bindTransforms = parameters.bindTransforms;
        if (parameters.restTransforms)
            this._restTransforms = parameters.restTransforms;
        // topology might be passed differently, but let's check for it
        if (parameters.topology && parameters.topology.parentIndices) {
            this._topology = parameters.topology.parentIndices;
        }
    }
    updateFinished() {
        if (debugPrims)
            console.log("HydraSkeleton updateFinished", this._id);
        if (!this._jointNames || this._jointNames.length === 0)
            return;
        this._bones = [];
        // Create bones
        for (let i = 0; i < this._jointNames.length; i++) {
            const bone = new Bone();
            bone.name = this._jointNames[i];
            this._bones.push(bone);
        }
        // Build hierarchy
        // Use topology if available (parent indices)
        // If not, try to infer from names (less robust)
        // Check if we have topology as a flat array in parameters directly?
        // Sometimes it's passed as 'topology' object.
        // Fallback: If no topology found, try to use names if they look like paths
        let usePathInference = false;
        if (!this._topology || this._topology.length === 0) {
            usePathInference = true;
        }
        if (!usePathInference) {
            for (let i = 0; i < this._bones.length; i++) {
                const parentIndex = this._topology[i];
                if (parentIndex >= 0 && parentIndex < this._bones.length) {
                    this._bones[parentIndex].add(this._bones[i]);
                }
                else {
                    // Root bone, do nothing (or add to a root group if we had one, but Skeleton takes array)
                }
            }
        }
        else {
            // Path inference
            const pathToIndex = {};
            this._jointNames.forEach((name, idx) => pathToIndex[name] = idx);
            this._jointNames.forEach((name, idx) => {
                // Assume '/' separator
                const lastSlash = name.lastIndexOf('/');
                if (lastSlash > 0) {
                    const parentName = name.substring(0, lastSlash);
                    if (pathToIndex.hasOwnProperty(parentName)) {
                        this._bones[pathToIndex[parentName]].add(this._bones[idx]);
                    }
                }
            });
        }
        // Set Rest Transforms (Local)
        if (this._restTransforms) {
            for (let i = 0; i < this._bones.length; i++) {
                if ((i + 1) * 16 <= this._restTransforms.length) {
                    const mat = new Matrix4().fromArray(this._restTransforms, i * 16);
                    mat.transpose(); // Hydra matrices are often column-major, Three.js is column-major but array order might differ?
                    // Actually USD is row-major. Three.js is column-major.
                    // Usually we transpose when coming from USD.
                    this._bones[i].position.setFromMatrixPosition(mat);
                    this._bones[i].quaternion.setFromRotationMatrix(mat);
                    this._bones[i].scale.setFromMatrixScale(mat);
                }
            }
        }
        // Create Skeleton
        this._skeleton = new Skeleton(this._bones);
        // Set Bone Inverses (from Bind Transforms)
        if (this._bindTransforms) {
            // boneInverses should be inverse of the World Matrix of the bone at bind time.
            // bindTransforms ARE the World Matrix at bind time (usually).
            this._skeleton.boneInverses = [];
            for (let i = 0; i < this._bones.length; i++) {
                if ((i + 1) * 16 <= this._bindTransforms.length) {
                    const mat = new Matrix4().fromArray(this._bindTransforms, i * 16);
                    mat.transpose(); // Transpose for Three.js
                    this._skeleton.boneInverses.push(mat.invert());
                }
                else {
                    this._skeleton.boneInverses.push(new Matrix4());
                }
            }
        }
        // If we have no bind transforms, we might need to compute them from rest transforms if the skeleton is in bind pose?
        // But usually UsdSkel provides them.
    }
}
export { HydraSkeleton };
