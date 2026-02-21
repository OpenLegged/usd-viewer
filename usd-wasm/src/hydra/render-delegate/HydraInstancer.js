import { DynamicDrawUsage, InstancedMesh, Matrix4, Mesh, } from 'three';
import { debugInstancer, normalizeHydraPath } from './shared.js';
class HydraInstancer {
    constructor(id, hydraInterface) {
        this._prototypes = [];
        this._transforms = [];
        this._indices = [];
        this._instancedMeshes = [];
        this._translate = null;
        this._rotate = null;
        this._scale = null;
        this._instanceTransforms = null;
        this._instanceIndices = null;
        this._id = normalizeHydraPath(id);
        this._interface = hydraInterface;
        if (debugInstancer)
            console.log("Created HydraInstancer", id);
    }
    updatePrimvar(name, data, dimension, interpolation) {
        if (debugInstancer)
            console.log(`Instancer ${this._id} updatePrimvar: ${name}`, dimension, interpolation);
        switch (name) {
            case 'translate':
                this._translate = data;
                break;
            case 'rotate':
                // Hydra sends quaternions as (real, i, j, k) -> (w, x, y, z) usually? 
                // Or (x, y, z, w)? USD is usually (w, x, y, z). Three.js is (x, y, z, w).
                // Let's assume standard USD order if it's 4D.
                this._rotate = data;
                break;
            case 'scale':
                this._scale = data;
                break;
            case 'instanceTransforms':
                this._instanceTransforms = data;
                break;
            case 'instanceIndices':
                this._instanceIndices = data;
                break;
            default:
                console.warn(`Instancer ${this._id} unsupported primvar: ${name}`);
        }
    }
    commit() {
        if (debugInstancer)
            console.log(`Committing Instancer ${this._id}`);
        this._instancedMeshes.forEach(mesh => {
            this._interface.config.usdRoot.remove(mesh);
            mesh.dispose();
        });
        this._instancedMeshes = [];
        const prototypeIds = Object.keys(this._interface.meshes).filter(meshId => {
            const mesh = this._interface.meshes[meshId];
            return mesh._instancerId === this._id;
        });
        if (prototypeIds.length === 0) {
            if (debugInstancer)
                console.warn(`Instancer ${this._id} has no prototypes.`);
            return;
        }
        let instanceCount = 0;
        if (this._translate)
            instanceCount = this._translate.length / 3;
        else if (this._instanceTransforms)
            instanceCount = this._instanceTransforms.length / 16;
        if (instanceCount === 0)
            return;
        prototypeIds.forEach((protoId, protoIndex) => {
            const protoMesh = this._interface.meshes[protoId];
            if (!protoMesh?._geometry || !protoMesh?._mesh?.material)
                return;
            const geometry = protoMesh._geometry;
            const material = protoMesh._mesh.material;
            let countForThisProto = 0;
            if (this._instanceIndices) {
                for (let i = 0; i < this._instanceIndices.length; i++) {
                    if (Number(this._instanceIndices[i]) === protoIndex)
                        countForThisProto++;
                }
            }
            else {
                if (prototypeIds.length === 1)
                    countForThisProto = instanceCount;
                else if (protoIndex === 0)
                    countForThisProto = instanceCount;
            }
            if (!Number.isFinite(countForThisProto) || countForThisProto <= 0)
                return;
            const instancedMesh = new InstancedMesh(geometry, material, countForThisProto);
            instancedMesh.castShadow = true;
            instancedMesh.receiveShadow = true;
            instancedMesh.instanceMatrix.setUsage(DynamicDrawUsage);
            let currentInstanceIdx = 0;
            const dummy = new Mesh();
            for (let i = 0; i < instanceCount; i++) {
                if (this._instanceIndices && Number(this._instanceIndices[i]) !== protoIndex)
                    continue;
                if (!this._instanceIndices && protoIndex !== 0)
                    continue;
                dummy.position.set(0, 0, 0);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(1, 1, 1);
                if (this._translate) {
                    const tx = Number(this._translate[i * 3 + 0] ?? 0);
                    const ty = Number(this._translate[i * 3 + 1] ?? 0);
                    const tz = Number(this._translate[i * 3 + 2] ?? 0);
                    dummy.position.set(tx, ty, tz);
                }
                if (this._rotate) {
                    const qx = Number(this._rotate[i * 4 + 1] ?? 0);
                    const qy = Number(this._rotate[i * 4 + 2] ?? 0);
                    const qz = Number(this._rotate[i * 4 + 3] ?? 0);
                    const qw = Number(this._rotate[i * 4 + 0] ?? 1);
                    dummy.quaternion.set(qx, qy, qz, qw);
                    if (Number.isFinite(dummy.quaternion.lengthSq()) && dummy.quaternion.lengthSq() > 0) {
                        dummy.quaternion.normalize();
                    }
                }
                if (this._scale) {
                    const sx = Number(this._scale[i * 3 + 0] ?? 1);
                    const sy = Number(this._scale[i * 3 + 1] ?? 1);
                    const sz = Number(this._scale[i * 3 + 2] ?? 1);
                    dummy.scale.set(sx, sy, sz);
                }
                if (this._instanceTransforms) {
                    const mat = new Matrix4();
                    mat.fromArray(this._instanceTransforms, i * 16);
                    mat.transpose();
                    dummy.applyMatrix4(mat);
                }
                dummy.updateMatrix();
                instancedMesh.setMatrixAt(currentInstanceIdx, dummy.matrix);
                currentInstanceIdx++;
            }
            instancedMesh.instanceMatrix.needsUpdate = true;
            this._interface.config.usdRoot.add(instancedMesh);
            this._instancedMeshes.push(instancedMesh);
        });
    }
}
export { HydraInstancer };
