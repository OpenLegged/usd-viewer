import { BoxGeometry, BufferGeometry, Group, Line, LineBasicMaterial, Matrix4, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, } from "three";
import { getRenderRobotMetadataSnapshot, warmupRenderRobotMetadataSnapshot, } from "./robot-metadata.js";
const linkDynamicsCacheByStagePath = new Map();
const maxLinkDynamicsCacheEntries = 8;
function getLinkPathFromMeshId(meshId) {
    if (!meshId)
        return null;
    const normalized = String(meshId || "").trim();
    if (!normalized)
        return null;
    const marker = ".proto_";
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex > 0) {
        let linkPath = normalized.substring(0, markerIndex);
        if (linkPath.endsWith("/visuals") || linkPath.endsWith("/collisions")) {
            const parentSlash = linkPath.lastIndexOf("/");
            if (parentSlash > 0)
                linkPath = linkPath.substring(0, parentSlash);
        }
        return linkPath || null;
    }
    const authoredPathMatch = normalized.match(/^(.*?)(?:\/(?:visuals?|collisions?))(?:$|[/.])/i);
    if (authoredPathMatch && authoredPathMatch[1]) {
        return authoredPathMatch[1];
    }
    return null;
}
function toFiniteNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string" && value.trim() === "")
        return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return null;
    return numeric;
}
function normalizeUsdPathToken(path) {
    const trimmed = String(path || "").trim().replace(/[<>]/g, "");
    if (!trimmed)
        return "";
    if (trimmed.startsWith("/"))
        return trimmed;
    return `/${trimmed}`;
}
function cloneMatrix4FromUnknown(value) {
    if (!value)
        return null;
    if (value instanceof Matrix4)
        return value.clone();
    if (typeof value?.clone === "function") {
        try {
            const cloned = value.clone();
            if (cloned instanceof Matrix4)
                return cloned;
            const clonedElementsSource = cloned?.elements;
            const clonedElements = (clonedElementsSource && typeof clonedElementsSource.length === "number")
                ? Array.from(clonedElementsSource)
                : null;
            if (clonedElements && clonedElements.length >= 16) {
                const numeric = clonedElements.slice(0, 16).map((entry) => Number(entry));
                if (numeric.every((entry) => Number.isFinite(entry))) {
                    return new Matrix4().fromArray(numeric);
                }
            }
        }
        catch {
            // Ignore and continue to generic array parsing.
        }
    }
    const elementsSource = value?.elements;
    const elements = (elementsSource && typeof elementsSource.length === "number")
        ? Array.from(elementsSource)
        : (value && typeof value.length === "number"
            ? Array.from(value)
            : null);
    if (!elements || elements.length < 16)
        return null;
    const numeric = elements.slice(0, 16).map((entry) => Number(entry));
    if (!numeric.every((entry) => Number.isFinite(entry)))
        return null;
    return new Matrix4().fromArray(numeric);
}
function getRequestedDynamicsFrameModeFromUrl() {
    if (typeof window === "undefined" || !window.location)
        return "auto";
    try {
        const params = new URLSearchParams(window.location.search || "");
        const rawValue = String(params.get("dynamicsFrame") || "").trim().toLowerCase();
        if (rawValue === "visual")
            return "visual";
        if (rawValue === "physics" || rawValue === "stage")
            return "stage";
        return "auto";
    }
    catch {
        return "auto";
    }
}
function getRootPathFromPrimPath(primPath) {
    if (!primPath || !primPath.startsWith("/"))
        return null;
    const segment = primPath.split("/").filter(Boolean)[0] || "";
    return segment ? `/${segment}` : null;
}
function toVector3FromValue(value) {
    if (!value)
        return null;
    if (typeof value === "object" && !Array.isArray(value)) {
        const xObject = toFiniteNumber(value.x ?? value.X);
        const yObject = toFiniteNumber(value.y ?? value.Y);
        const zObject = toFiniteNumber(value.z ?? value.Z);
        if (xObject !== null && yObject !== null && zObject !== null) {
            return new Vector3(xObject, yObject, zObject);
        }
    }
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 3)
        return null;
    const x = toFiniteNumber(source[0]);
    const y = toFiniteNumber(source[1]);
    const z = toFiniteNumber(source[2]);
    if (x === null || y === null || z === null)
        return null;
    return new Vector3(x, y, z);
}
function parseVector3FromTupleLiteral(tupleLiteral) {
    if (!tupleLiteral)
        return null;
    const source = tupleLiteral
        .split(",")
        .map((part) => toFiniteNumber(part.trim()))
        .filter((part) => part !== null);
    if (source.length < 3)
        return null;
    return new Vector3(source[0], source[1], source[2]);
}
function parseQuaternionFromTupleLiteral(tupleLiteral) {
    if (!tupleLiteral)
        return null;
    const source = tupleLiteral
        .split(",")
        .map((part) => toFiniteNumber(part.trim()))
        .filter((part) => part !== null);
    if (source.length < 4)
        return null;
    const quaternion = new Quaternion(source[1], source[2], source[3], source[0]);
    if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
        return null;
    }
    quaternion.normalize();
    return quaternion;
}
function toQuaternionFromWxyzTuple(value) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 4)
        return null;
    const w = toFiniteNumber(source[0]);
    const x = toFiniteNumber(source[1]);
    const y = toFiniteNumber(source[2]);
    const z = toFiniteNumber(source[3]);
    if (w === null || x === null || y === null || z === null)
        return null;
    const quaternion = new Quaternion(x, y, z, w);
    if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
        return null;
    }
    quaternion.normalize();
    return quaternion;
}
function toQuaternionFromValue(value) {
    if (!value)
        return null;
    if (typeof value === "object" && !Array.isArray(value)) {
        const realPart = toFiniteNumber(value.real ?? value.r ?? value.W ?? value.w);
        const imaginaryPart = value.imaginary ?? value.imag ?? value.v;
        if (realPart !== null && imaginaryPart) {
            const imagX = toFiniteNumber(imaginaryPart.x ?? imaginaryPart[0] ?? imaginaryPart.i);
            const imagY = toFiniteNumber(imaginaryPart.y ?? imaginaryPart[1] ?? imaginaryPart.j);
            const imagZ = toFiniteNumber(imaginaryPart.z ?? imaginaryPart[2] ?? imaginaryPart.k);
            if (imagX !== null && imagY !== null && imagZ !== null) {
                const quaternion = new Quaternion(imagX, imagY, imagZ, realPart);
                if (Number.isFinite(quaternion.lengthSq()) && quaternion.lengthSq() > 1e-12) {
                    quaternion.normalize();
                    return quaternion;
                }
            }
        }
        const xObject = toFiniteNumber(value.x ?? value.i ?? value.X);
        const yObject = toFiniteNumber(value.y ?? value.j ?? value.Y);
        const zObject = toFiniteNumber(value.z ?? value.k ?? value.Z);
        const wObject = toFiniteNumber(value.w ?? value.real ?? value.W ?? value.r);
        if (xObject !== null && yObject !== null && zObject !== null && wObject !== null) {
            const quaternion = new Quaternion(xObject, yObject, zObject, wObject);
            if (Number.isFinite(quaternion.lengthSq()) && quaternion.lengthSq() > 1e-12) {
                quaternion.normalize();
                return quaternion;
            }
        }
    }
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 4)
        return null;
    const c0 = toFiniteNumber(source[0]);
    const c1 = toFiniteNumber(source[1]);
    const c2 = toFiniteNumber(source[2]);
    const c3 = toFiniteNumber(source[3]);
    if (c0 === null || c1 === null || c2 === null || c3 === null)
        return null;
    const quaternion = new Quaternion(c0, c1, c2, c3);
    if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
        return null;
    }
    quaternion.normalize();
    return quaternion;
}
function toQuaternionFromXyzwTuple(value) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 4)
        return null;
    const x = toFiniteNumber(source[0]);
    const y = toFiniteNumber(source[1]);
    const z = toFiniteNumber(source[2]);
    const w = toFiniteNumber(source[3]);
    if (x === null || y === null || z === null || w === null)
        return null;
    const quaternion = new Quaternion(x, y, z, w);
    if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
        return null;
    }
    quaternion.normalize();
    return quaternion;
}
function isIdentityQuaternion(quaternion, epsilon = 1e-6) {
    if (!quaternion)
        return true;
    return (Math.abs(quaternion.x) <= epsilon
        && Math.abs(quaternion.y) <= epsilon
        && Math.abs(quaternion.z) <= epsilon
        && Math.abs(quaternion.w - 1) <= epsilon);
}
function safeGetPrimAtPath(stage, path) {
    if (!stage?.GetPrimAtPath)
        return null;
    try {
        return stage.GetPrimAtPath(path) || null;
    }
    catch {
        return null;
    }
}
function safeGetPrimAttribute(prim, name) {
    if (!prim?.GetAttribute)
        return null;
    try {
        return prim.GetAttribute(name)?.Get?.() ?? null;
    }
    catch {
        return null;
    }
}
function resolveUsdAssetPath(baseUsdPath, assetPath) {
    const normalizedAssetPath = String(assetPath || "").trim();
    if (!normalizedAssetPath)
        return null;
    if (/^[a-z]+:\/\//i.test(normalizedAssetPath))
        return normalizedAssetPath;
    if (normalizedAssetPath.startsWith("/"))
        return normalizedAssetPath;
    if (!baseUsdPath)
        return null;
    const baseWithoutQuery = baseUsdPath.split("?")[0];
    const baseSegments = baseWithoutQuery.split("/");
    if (baseSegments.length > 0)
        baseSegments.pop();
    for (const segment of normalizedAssetPath.split("/")) {
        if (!segment || segment === ".")
            continue;
        if (segment === "..") {
            if (baseSegments.length > 1)
                baseSegments.pop();
            continue;
        }
        baseSegments.push(segment);
    }
    const resolved = baseSegments.join("/");
    return resolved.startsWith("/") ? resolved : `/${resolved}`;
}
function extractUsdAssetReferencesFromLayerText(layerText) {
    if (!layerText)
        return [];
    const references = new Set();
    const referenceRegex = /@([^@]+\.usd(?:a|c|z)?)@/gi;
    let match = null;
    while ((match = referenceRegex.exec(layerText))) {
        const rawPath = String(match[1] || "").trim();
        if (!rawPath)
            continue;
        references.add(rawPath);
    }
    const sorted = Array.from(references);
    sorted.sort((left, right) => {
        const leftPhysics = left.toLowerCase().includes("physics") ? 1 : 0;
        const rightPhysics = right.toLowerCase().includes("physics") ? 1 : 0;
        if (leftPhysics !== rightPhysics)
            return rightPhysics - leftPhysics;
        return left.localeCompare(right);
    });
    return sorted;
}
function isLikelyPhysicsReferencePath(path) {
    const lowered = String(path || "").toLowerCase();
    return lowered.includes("physics") || lowered.includes("joint") || lowered.includes("dynamics");
}
async function shouldOpenReferencedStageForTextPatch(stagePath) {
    const normalizedPath = String(stagePath || "").trim();
    if (!normalizedPath)
        return false;
    const loweredPath = normalizedPath.toLowerCase();
    if (isLikelyPhysicsReferencePath(loweredPath))
        return true;
    if (/_robot\.usd[a-z]?$/i.test(loweredPath))
        return true;
    if (!normalizedPath.startsWith("/"))
        return false;
    if (/_base\.usd[a-z]?$/i.test(loweredPath))
        return false;
    if (/_sensor\.usd[a-z]?$/i.test(loweredPath))
        return false;
    return false;
}
function countBracesOutsideStrings(source) {
    let openCount = 0;
    let closeCount = 0;
    let insideString = false;
    for (let cursor = 0; cursor < source.length; cursor++) {
        const character = source[cursor];
        const previousCharacter = cursor > 0 ? source[cursor - 1] : "";
        if (character === "\"" && previousCharacter !== "\\") {
            insideString = !insideString;
            continue;
        }
        if (insideString)
            continue;
        if (character === "{")
            openCount++;
        if (character === "}")
            closeCount++;
    }
    return { openCount, closeCount };
}
function composeChildPrimPath(parentPrimPath, childPrimName) {
    const normalizedChildName = String(childPrimName || "").trim();
    if (!normalizedChildName)
        return "";
    if (normalizedChildName.startsWith("/"))
        return normalizeUsdPathToken(normalizedChildName);
    if (!parentPrimPath)
        return `/${normalizedChildName}`;
    return `${parentPrimPath}/${normalizedChildName}`;
}
function ensureLinkDynamicsPatch(target, linkPath) {
    const normalizedLinkPath = normalizeUsdPathToken(linkPath);
    const existing = target.get(normalizedLinkPath);
    if (existing)
        return existing;
    const created = {};
    target.set(normalizedLinkPath, created);
    return created;
}
function parseLinkDynamicsPatchesFromLayerText(layerText) {
    const patchesByLinkPath = new Map();
    if (!layerText)
        return patchesByLinkPath;
    const scopeStack = [];
    const primPathStack = [];
    let pendingPrimName = null;
    const lines = layerText.split(/\r?\n/g);
    for (const line of lines) {
        const primMatch = line.match(/^\s*(?:def|over)\s+[^\"]*\"([^\"]+)\"/);
        if (primMatch) {
            pendingPrimName = String(primMatch[1] || "").trim() || null;
        }
        const currentPrimPath = primPathStack.length > 0 ? primPathStack[primPathStack.length - 1] : null;
        if (currentPrimPath) {
            const massMatch = line.match(/physics:mass\s*=\s*([-+0-9.eE]+)/i);
            if (massMatch) {
                const mass = toFiniteNumber(massMatch[1]);
                if (mass !== null) {
                    const patch = ensureLinkDynamicsPatch(patchesByLinkPath, currentPrimPath);
                    patch.mass = mass;
                }
            }
            const centerOfMassMatch = line.match(/physics:centerOfMass\s*=\s*\(([^)]+)\)/i);
            if (centerOfMassMatch) {
                const centerOfMass = parseVector3FromTupleLiteral(centerOfMassMatch[1]);
                if (centerOfMass) {
                    const patch = ensureLinkDynamicsPatch(patchesByLinkPath, currentPrimPath);
                    patch.centerOfMassLocal = centerOfMass;
                }
            }
            const diagonalInertiaMatch = line.match(/physics:diagonalInertia\s*=\s*\(([^)]+)\)/i);
            if (diagonalInertiaMatch) {
                const diagonalInertia = parseVector3FromTupleLiteral(diagonalInertiaMatch[1]);
                if (diagonalInertia) {
                    const patch = ensureLinkDynamicsPatch(patchesByLinkPath, currentPrimPath);
                    patch.diagonalInertia = diagonalInertia;
                }
            }
            const principalAxesMatch = line.match(/physics:principalAxes\s*=\s*\(([^)]+)\)/i);
            if (principalAxesMatch) {
                const principalAxes = parseQuaternionFromTupleLiteral(principalAxesMatch[1]);
                if (principalAxes) {
                    const patch = ensureLinkDynamicsPatch(patchesByLinkPath, currentPrimPath);
                    patch.principalAxesLocal = principalAxes;
                }
            }
        }
        const { openCount, closeCount } = countBracesOutsideStrings(line);
        for (let openIndex = 0; openIndex < openCount; openIndex++) {
            if (pendingPrimName) {
                const parentPrimPath = primPathStack.length > 0 ? primPathStack[primPathStack.length - 1] : null;
                const primPath = composeChildPrimPath(parentPrimPath, pendingPrimName);
                scopeStack.push({ primPath });
                primPathStack.push(primPath);
                pendingPrimName = null;
            }
            else {
                scopeStack.push({ primPath: null });
            }
        }
        for (let closeIndex = 0; closeIndex < closeCount; closeIndex++) {
            const exitedScope = scopeStack.pop();
            if (!exitedScope?.primPath)
                continue;
            primPathStack.pop();
        }
    }
    return patchesByLinkPath;
}
function cloneLinkDynamicsRecord(record) {
    return {
        linkPath: record.linkPath,
        mass: record.mass,
        centerOfMassLocal: record.centerOfMassLocal.clone(),
        diagonalInertia: record.diagonalInertia ? record.diagonalInertia.clone() : null,
        principalAxesLocal: record.principalAxesLocal.clone(),
    };
}
export class LinkDynamicsController {
    constructor() {
        this.linkDynamicsGroup = null;
        this.stageSourcePath = null;
        this.linkDynamicsByLinkPath = new Map();
        this.markerGroupByLinkPath = new Map();
        this.currentLinkFrameResolver = null;
        this.preferredDynamicsFrameMode = null;
        this.linkDynamicsBuildPromise = null;
        this.rebuildRequestId = 0;
    }
    setStageSourcePath(stageSourcePath) {
        const normalized = String(stageSourcePath || "").trim();
        const nextValue = normalized ? normalized.split("?")[0] : null;
        if (nextValue === this.stageSourcePath)
            return;
        this.stageSourcePath = nextValue;
        this.linkDynamicsByLinkPath.clear();
        this.markerGroupByLinkPath.clear();
        this.preferredDynamicsFrameMode = null;
        this.linkDynamicsBuildPromise = null;
    }
    setCurrentLinkFrameResolver(resolver) {
        this.currentLinkFrameResolver = typeof resolver === "function" ? resolver : null;
    }
    clear(usdRoot, options = {}) {
        if (options.invalidateRequestId !== false) {
            this.rebuildRequestId++;
        }
        this.markerGroupByLinkPath.clear();
        this.preferredDynamicsFrameMode = null;
        if (!this.linkDynamicsGroup)
            return;
        usdRoot.remove(this.linkDynamicsGroup);
        this.linkDynamicsGroup.traverse((obj) => {
            obj.geometry?.dispose?.();
            if (Array.isArray(obj.material)) {
                for (const material of obj.material)
                    material?.dispose?.();
            }
            else {
                obj.material?.dispose?.();
            }
        });
        this.linkDynamicsGroup = null;
    }
    prewarmCatalog(renderInterface) {
        if (!renderInterface?.meshes)
            return;
        window.setTimeout(() => {
            this.prefetchLinkWorldTransforms(renderInterface, { force: false });
        }, 0);
        const buildPromise = this.startLinkDynamicsCatalogBuildIfNeeded(renderInterface);
        if (!buildPromise)
            return;
        void buildPromise.catch(() => {
            // Keep prewarm best-effort.
        });
    }
    async prewarmCatalogForInteractive(renderInterface) {
        if (!renderInterface?.meshes)
            return;
        this.prefetchLinkWorldTransforms(renderInterface, { force: true });
        const buildPromise = this.startLinkDynamicsCatalogBuildIfNeeded(renderInterface);
        if (!buildPromise)
            return;
        try {
            await buildPromise;
        }
        catch {
            // Keep one-shot preload resilient.
        }
    }
    async rebuild(usdRoot, renderInterface, showLinkDynamics) {
        const requestId = ++this.rebuildRequestId;
        if (!showLinkDynamics) {
            if (this.linkDynamicsGroup) {
                this.linkDynamicsGroup.visible = false;
            }
            return;
        }
        if (!renderInterface?.meshes)
            return;
        if (this.linkDynamicsGroup
            && this.markerGroupByLinkPath.size > 0
            && this.markerGroupByLinkPath.size === this.linkDynamicsByLinkPath.size) {
            this.linkDynamicsGroup.visible = true;
            this.syncLinkDynamicsTransforms(renderInterface);
            return;
        }
        this.clear(usdRoot, { invalidateRequestId: false });
        window.setTimeout(() => {
            if (requestId !== this.rebuildRequestId)
                return;
            this.prefetchLinkWorldTransforms(renderInterface, { force: false });
        }, 0);
        const buildPromise = this.startLinkDynamicsCatalogBuildIfNeeded(renderInterface);
        if (this.linkDynamicsByLinkPath.size <= 0) {
            if (buildPromise) {
                void buildPromise.then(() => {
                    if (requestId !== this.rebuildRequestId)
                        return;
                    if (this.linkDynamicsByLinkPath.size <= 0)
                        return;
                    void this.rebuild(usdRoot, renderInterface, true);
                }).catch(() => {
                    // Keep rebuild path resilient when warmup fails.
                });
            }
            return;
        }
        const renderedRecordCount = this.linkDynamicsByLinkPath.size;
        const group = new Group();
        group.name = "Link Dynamics";
        this.markerGroupByLinkPath.clear();
        const preferredFrameMode = this.resolvePreferredDynamicsFrameMode(renderInterface);
        for (const record of this.linkDynamicsByLinkPath.values()) {
            const linkMatrix = this.getRepresentativeMatrixForLinkPath(renderInterface, record.linkPath, preferredFrameMode);
            if (!linkMatrix)
                continue;
            const markerGroup = this.createMarkerGroupForLink(record);
            if (!markerGroup || markerGroup.children.length === 0)
                continue;
            this.applyLinkWorldMatrixToMarkerGroup(markerGroup, linkMatrix);
            this.markerGroupByLinkPath.set(record.linkPath, markerGroup);
            group.add(markerGroup);
        }
        if (requestId !== this.rebuildRequestId) {
            group.traverse((obj) => {
                obj.geometry?.dispose?.();
                obj.material?.dispose?.();
            });
            return;
        }
        if (group.children.length === 0)
            return;
        this.linkDynamicsGroup = group;
        usdRoot.add(group);
        if (buildPromise) {
            void buildPromise.then(() => {
                if (requestId !== this.rebuildRequestId)
                    return;
                if (this.linkDynamicsByLinkPath.size <= renderedRecordCount)
                    return;
                void this.rebuild(usdRoot, renderInterface, true);
            }).catch(() => {
                // Keep rebuild path resilient when warmup fails.
            });
        }
    }
    /**
     * Warm up stage transform caches in one bridge call.
     * Without this, first COM/inertia enable can fall back to per-prim transform
     * reads and block the main thread for several seconds on large stages.
     */
    prefetchLinkWorldTransforms(renderInterface, options = {}) {
        const cachedStagePath = String(renderInterface?.getStageSourcePath?.() || "").trim() || null;
        const cachedSceneSnapshot = typeof renderInterface?.getCachedRobotSceneSnapshot === "function"
            ? renderInterface.getCachedRobotSceneSnapshot(cachedStagePath)
            : null;
        if (renderInterface?._primTransformBatchPrimed === true || cachedSceneSnapshot) {
            return;
        }
        const prefetch = renderInterface?.prefetchPrimTransformsFromDriver;
        if (typeof prefetch !== "function")
            return;
        let driver = null;
        try {
            const driverGetter = renderInterface?.config?.driver;
            driver = typeof driverGetter === "function" ? driverGetter.call(renderInterface) : null;
        }
        catch {
            driver = null;
        }
        if (!driver) {
            driver = window?.driver || null;
        }
        if (!driver)
            return;
        try {
            prefetch.call(renderInterface, driver, { force: options.force === true });
        }
        catch {
            // Keep overlay rebuild resilient; fallback path remains available.
        }
    }
    syncLinkDynamicsTransforms(renderInterface) {
        if (!this.linkDynamicsGroup)
            return false;
        if (!renderInterface)
            return false;
        if (this.markerGroupByLinkPath.size <= 0)
            return false;
        let changed = false;
        const preferredFrameMode = this.resolvePreferredDynamicsFrameMode(renderInterface);
        for (const [linkPath, markerGroup] of this.markerGroupByLinkPath.entries()) {
            if (!markerGroup)
                continue;
            const linkMatrix = this.getRepresentativeMatrixForLinkPath(renderInterface, linkPath, preferredFrameMode);
            if (!linkMatrix)
                continue;
            if (this.applyLinkWorldMatrixToMarkerGroup(markerGroup, linkMatrix)) {
                changed = true;
            }
        }
        return changed;
    }
    async getAllLinkDynamics(renderInterface) {
        if (!renderInterface)
            return [];
        await this.ensureLinkDynamicsCatalogReady(renderInterface);
        const snapshots = [];
        for (const record of this.linkDynamicsByLinkPath.values()) {
            snapshots.push({
                linkPath: record.linkPath,
                mass: record.mass,
                centerOfMassLocal: [record.centerOfMassLocal.x, record.centerOfMassLocal.y, record.centerOfMassLocal.z],
                diagonalInertia: record.diagonalInertia
                    ? [record.diagonalInertia.x, record.diagonalInertia.y, record.diagonalInertia.z]
                    : null,
                principalAxesLocal: [
                    record.principalAxesLocal.x,
                    record.principalAxesLocal.y,
                    record.principalAxesLocal.z,
                    record.principalAxesLocal.w,
                ],
            });
        }
        snapshots.sort((left, right) => left.linkPath.localeCompare(right.linkPath));
        return snapshots;
    }
    async ensureLinkDynamicsCatalogReady(renderInterface) {
        const buildPromise = this.startLinkDynamicsCatalogBuildIfNeeded(renderInterface);
        if (!buildPromise)
            return;
        try {
            await buildPromise;
        }
        catch { }
    }
    startLinkDynamicsCatalogBuildIfNeeded(renderInterface) {
        if (this.linkDynamicsBuildPromise)
            return this.linkDynamicsBuildPromise;
        if (this.linkDynamicsByLinkPath.size > 0)
            return Promise.resolve();
        const cachedRenderSnapshot = getRenderRobotMetadataSnapshot(renderInterface, this.stageSourcePath);
        const importedFromCachedSnapshot = this.ingestLinkDynamicsFromRenderSnapshot(cachedRenderSnapshot, renderInterface);
        if (importedFromCachedSnapshot > 0) {
            return Promise.resolve();
        }
        const stage = renderInterface?.getStage?.() || null;
        const cacheKey = this.getLinkDynamicsCacheKey(renderInterface, stage);
        if (cacheKey && this.restoreLinkDynamicsFromCache(cacheKey)) {
            return Promise.resolve();
        }
        return null;
    }
    getLinkDynamicsCacheKey(renderInterface, stage) {
        const fromController = String(this.stageSourcePath || "").trim();
        if (fromController)
            return fromController.split("?")[0];
        const fromInterface = String(renderInterface?.getStageSourcePath?.() || "").trim();
        if (fromInterface)
            return fromInterface.split("?")[0];
        if (!stage?.GetRootLayer)
            return null;
        try {
            const rootLayer = stage.GetRootLayer();
            const identifier = String(rootLayer?.identifier || "").trim();
            if (!identifier)
                return null;
            return identifier.split("?")[0];
        }
        catch {
            return null;
        }
    }
    restoreLinkDynamicsFromCache(cacheKey) {
        const cacheEntry = linkDynamicsCacheByStagePath.get(cacheKey);
        if (!cacheEntry)
            return false;
        linkDynamicsCacheByStagePath.delete(cacheKey);
        linkDynamicsCacheByStagePath.set(cacheKey, cacheEntry);
        this.linkDynamicsByLinkPath.clear();
        for (const entry of cacheEntry.entries) {
            this.linkDynamicsByLinkPath.set(entry.linkPath, {
                linkPath: entry.linkPath,
                mass: entry.mass,
                centerOfMassLocal: new Vector3(...entry.centerOfMassLocal),
                diagonalInertia: entry.diagonalInertia ? new Vector3(...entry.diagonalInertia) : null,
                principalAxesLocal: new Quaternion(...entry.principalAxesLocal),
            });
        }
        return true;
    }
    saveLinkDynamicsToCache(cacheKey) {
        if (!cacheKey || this.linkDynamicsByLinkPath.size === 0)
            return;
        const entries = [];
        for (const record of this.linkDynamicsByLinkPath.values()) {
            entries.push({
                linkPath: record.linkPath,
                mass: record.mass,
                centerOfMassLocal: [record.centerOfMassLocal.x, record.centerOfMassLocal.y, record.centerOfMassLocal.z],
                diagonalInertia: record.diagonalInertia
                    ? [record.diagonalInertia.x, record.diagonalInertia.y, record.diagonalInertia.z]
                    : null,
                principalAxesLocal: [
                    record.principalAxesLocal.x,
                    record.principalAxesLocal.y,
                    record.principalAxesLocal.z,
                    record.principalAxesLocal.w,
                ],
            });
        }
        linkDynamicsCacheByStagePath.delete(cacheKey);
        linkDynamicsCacheByStagePath.set(cacheKey, { entries });
        while (linkDynamicsCacheByStagePath.size > maxLinkDynamicsCacheEntries) {
            const oldestKey = linkDynamicsCacheByStagePath.keys().next().value;
            if (!oldestKey)
                break;
            linkDynamicsCacheByStagePath.delete(oldestKey);
        }
    }
    async buildLinkDynamicsCatalog(stage, renderInterface) {
        this.linkDynamicsByLinkPath.clear();
        const importedFromRenderSnapshot = this.ingestLinkDynamicsFromRenderSnapshot(await warmupRenderRobotMetadataSnapshot(renderInterface, {
            stageSourcePath: this.stageSourcePath,
            skipIdleWait: true,
            skipUrdfTruthFallback: true,
        }), renderInterface);
        if (importedFromRenderSnapshot > 0) {
            return;
        }
        const linkPaths = new Set();
        for (const meshId of Object.keys(renderInterface?.meshes || {})) {
            const linkPath = getLinkPathFromMeshId(meshId);
            if (linkPath)
                linkPaths.add(linkPath);
        }
        if (linkPaths.size === 0)
            return;
        const textPatchesByLinkPath = await this.collectLinkDynamicsTextPatches(stage, renderInterface);
        for (const linkPath of linkPaths) {
            const prim = safeGetPrimAtPath(stage, linkPath);
            const textPatch = textPatchesByLinkPath.get(linkPath) || textPatchesByLinkPath.get(normalizeUsdPathToken(linkPath));
            const mass = toFiniteNumber(safeGetPrimAttribute(prim, "physics:mass")) ?? textPatch?.mass ?? null;
            const centerOfMassLocal = toVector3FromValue(safeGetPrimAttribute(prim, "physics:centerOfMass"))
                || textPatch?.centerOfMassLocal?.clone()
                || new Vector3();
            const diagonalInertia = toVector3FromValue(safeGetPrimAttribute(prim, "physics:diagonalInertia"))
                || textPatch?.diagonalInertia?.clone()
                || null;
            const principalAxesAttrValue = safeGetPrimAttribute(prim, "physics:principalAxes");
            const principalAxesLocal = toQuaternionFromWxyzTuple(principalAxesAttrValue)
                || toQuaternionFromValue(principalAxesAttrValue)
                || textPatch?.principalAxesLocal?.clone()
                || new Quaternion();
            principalAxesLocal.normalize();
            const hasMass = mass !== null;
            const hasCenterOffset = centerOfMassLocal.lengthSq() > 1e-12;
            const hasInertia = !!(diagonalInertia && diagonalInertia.lengthSq() > 1e-12);
            const hasPrincipalAxes = !isIdentityQuaternion(principalAxesLocal);
            if (!hasMass && !hasCenterOffset && !hasInertia && !hasPrincipalAxes)
                continue;
            this.linkDynamicsByLinkPath.set(linkPath, cloneLinkDynamicsRecord({
                linkPath,
                mass,
                centerOfMassLocal,
                diagonalInertia,
                principalAxesLocal,
            }));
        }
    }
    ingestLinkDynamicsFromRenderSnapshot(snapshot, renderInterface) {
        if (!snapshot)
            return 0;
        if (!Array.isArray(snapshot.linkDynamicsEntries) || snapshot.linkDynamicsEntries.length <= 0)
            return 0;
        const runtimeLinkPaths = new Set();
        for (const meshId of Object.keys(renderInterface?.meshes || {})) {
            const linkPath = getLinkPathFromMeshId(meshId);
            if (linkPath)
                runtimeLinkPaths.add(linkPath);
        }
        if (runtimeLinkPaths.size <= 0)
            return 0;
        let imported = 0;
        for (const entry of snapshot.linkDynamicsEntries) {
            const linkPath = normalizeUsdPathToken(String(entry?.linkPath || ""));
            if (!linkPath)
                continue;
            if (!runtimeLinkPaths.has(linkPath))
                continue;
            const mass = toFiniteNumber(entry.mass);
            const centerOfMassLocal = toVector3FromValue(entry.centerOfMassLocal) || new Vector3();
            const diagonalInertia = toVector3FromValue(entry.diagonalInertia);
            const principalAxesLocal = toQuaternionFromXyzwTuple(entry.principalAxesLocal)
                || toQuaternionFromWxyzTuple(entry.principalAxesLocalWxyz)
                || toQuaternionFromValue(entry.principalAxesLocal)
                || new Quaternion();
            principalAxesLocal.normalize();
            const hasMass = mass !== null;
            const hasCenterOffset = centerOfMassLocal.lengthSq() > 1e-12;
            const hasInertia = !!(diagonalInertia && diagonalInertia.lengthSq() > 1e-12);
            const hasPrincipalAxes = !isIdentityQuaternion(principalAxesLocal);
            if (!hasMass && !hasCenterOffset && !hasInertia && !hasPrincipalAxes)
                continue;
            this.linkDynamicsByLinkPath.set(linkPath, cloneLinkDynamicsRecord({
                linkPath,
                mass,
                centerOfMassLocal,
                diagonalInertia,
                principalAxesLocal,
            }));
            imported++;
        }
        return imported;
    }
    async collectLinkDynamicsTextPatches(stage, renderInterface) {
        const patchesByLinkPath = new Map();
        const rootText = this.safeExportRootLayerText(stage);
        if (!rootText)
            return patchesByLinkPath;
        this.mergeLinkDynamicsPatches(patchesByLinkPath, parseLinkDynamicsPatchesFromLayerText(rootText));
        const usdModule = window.USD;
        if (!usdModule?.UsdStage?.Open)
            return patchesByLinkPath;
        const visited = new Set();
        const maxOpenedStages = 12;
        const queue = [];
        const rootStagePath = this.getLinkDynamicsCacheKey(renderInterface, stage);
        queue.push({ stagePath: rootStagePath, layerText: rootText, depth: 0 });
        if (rootStagePath)
            visited.add(rootStagePath);
        while (queue.length > 0 && visited.size <= maxOpenedStages) {
            const current = queue.shift();
            if (current.depth >= 2)
                continue;
            const references = extractUsdAssetReferencesFromLayerText(current.layerText);
            for (const assetPath of references) {
                const resolvedPath = resolveUsdAssetPath(current.stagePath, assetPath);
                if (!resolvedPath)
                    continue;
                if (visited.has(resolvedPath))
                    continue;
                visited.add(resolvedPath);
                if (!(await shouldOpenReferencedStageForTextPatch(resolvedPath)))
                    continue;
                const openedStage = await this.safeOpenUsdStage(usdModule, resolvedPath);
                if (!openedStage)
                    continue;
                const layerText = this.safeExportRootLayerText(openedStage);
                if (!layerText)
                    continue;
                this.mergeLinkDynamicsPatches(patchesByLinkPath, parseLinkDynamicsPatchesFromLayerText(layerText));
                if (current.depth + 1 < 2 && visited.size < maxOpenedStages) {
                    queue.push({ stagePath: resolvedPath, layerText, depth: current.depth + 1 });
                }
            }
        }
        return patchesByLinkPath;
    }
    mergeLinkDynamicsPatches(target, source) {
        for (const [linkPath, sourcePatch] of source.entries()) {
            const patch = ensureLinkDynamicsPatch(target, linkPath);
            if (sourcePatch.mass !== undefined)
                patch.mass = sourcePatch.mass;
            if (sourcePatch.centerOfMassLocal)
                patch.centerOfMassLocal = sourcePatch.centerOfMassLocal.clone();
            if (sourcePatch.diagonalInertia)
                patch.diagonalInertia = sourcePatch.diagonalInertia.clone();
            if (sourcePatch.principalAxesLocal)
                patch.principalAxesLocal = sourcePatch.principalAxesLocal.clone();
        }
    }
    safeExportRootLayerText(stage) {
        if (!stage?.GetRootLayer)
            return "";
        try {
            const rootLayer = stage.GetRootLayer();
            if (!rootLayer?.ExportToString)
                return "";
            const exported = rootLayer.ExportToString();
            return typeof exported === "string" ? exported : String(exported || "");
        }
        catch {
            return "";
        }
    }
    async safeOpenUsdStage(usdModule, stagePath) {
        if (!usdModule?.UsdStage?.Open || !stagePath)
            return null;
        try {
            const openedStage = usdModule.UsdStage.Open(stagePath);
            if (openedStage && typeof openedStage.then === "function") {
                const resolvedStage = await openedStage;
                return resolvedStage || null;
            }
            return openedStage || null;
        }
        catch {
            return null;
        }
    }
    resolvePreferredDynamicsFrameMode(renderInterface) {
        if (this.preferredDynamicsFrameMode)
            return this.preferredDynamicsFrameMode;
        const requestedMode = getRequestedDynamicsFrameModeFromUrl();
        if (requestedMode === "stage") {
            this.preferredDynamicsFrameMode = "stage";
            return this.preferredDynamicsFrameMode;
        }
        if (requestedMode === "visual") {
            this.preferredDynamicsFrameMode = "visual";
            return this.preferredDynamicsFrameMode;
        }
        // Default to the delegate's preferred physical link frame. Visual mesh
        // matrices can include extra authored offsets (for example Go2 visuals are
        // rotated relative to the rigid-body link frame), which would rotate COM
        // and inertia overlays away from the actual physics frame.
        void renderInterface;
        this.preferredDynamicsFrameMode = "auto";
        return this.preferredDynamicsFrameMode;
    }
    getDirectStageLinkWorldMatrixForPath(renderInterface, linkPath) {
        if (!renderInterface || !linkPath)
            return null;
        const worldGetter = renderInterface?.getWorldTransformForPrimPath;
        if (typeof worldGetter === "function") {
            try {
                const matrix = cloneMatrix4FromUnknown(worldGetter.call(renderInterface, linkPath, { clone: true }));
                if (matrix)
                    return matrix;
            }
            catch {
                try {
                    const matrix = cloneMatrix4FromUnknown(worldGetter.call(renderInterface, linkPath));
                    if (matrix)
                        return matrix;
                }
                catch { }
            }
        }
        return null;
    }
    getPreferredLinkWorldMatrixForPath(renderInterface, linkPath) {
        if (!renderInterface || !linkPath)
            return null;
        const preferredGetter = renderInterface?.getPreferredLinkWorldTransform;
        if (typeof preferredGetter === "function") {
            try {
                const matrix = cloneMatrix4FromUnknown(preferredGetter.call(renderInterface, linkPath));
                if (matrix)
                    return matrix;
            }
            catch { }
        }
        const stageOrVisualGetter = renderInterface?.getStageOrVisualLinkWorldTransform;
        if (typeof stageOrVisualGetter === "function") {
            try {
                const matrix = cloneMatrix4FromUnknown(stageOrVisualGetter.call(renderInterface, linkPath));
                if (matrix)
                    return matrix;
            }
            catch { }
        }
        return this.getDirectStageLinkWorldMatrixForPath(renderInterface, linkPath)
            || this.getVisualLinkWorldMatrixForPath(renderInterface, linkPath);
    }
    getVisualLinkWorldMatrixForPath(renderInterface, linkPath) {
        if (!renderInterface || !linkPath)
            return null;
        const visualGetter = renderInterface?.getVisualLinkFrameTransform;
        if (typeof visualGetter === "function") {
            try {
                const matrix = cloneMatrix4FromUnknown(visualGetter.call(renderInterface, linkPath));
                if (matrix)
                    return matrix;
            }
            catch { }
        }
        if (!renderInterface.meshes)
            return null;
        const prefix = `${linkPath}/`;
        let fallbackMatrix = null;
        for (const [meshId, hydraMesh] of Object.entries(renderInterface.meshes)) {
            if (!meshId.startsWith(prefix))
                continue;
            const matrix = cloneMatrix4FromUnknown(hydraMesh?._mesh?.matrix);
            if (!matrix)
                continue;
            if (/\/visuals\.|\/visuals\//i.test(meshId)) {
                return matrix;
            }
            if (!fallbackMatrix)
                fallbackMatrix = matrix;
        }
        return fallbackMatrix;
    }
    getRepresentativeMatrixForLinkPath(renderInterface, linkPath, preferredFrameMode) {
        if (!linkPath)
            return null;
        const currentLinkFrameMatrix = this.currentLinkFrameResolver?.(linkPath) || null;
        const preferredMatrix = this.getPreferredLinkWorldMatrixForPath(renderInterface, linkPath);
        const stageMatrix = this.getDirectStageLinkWorldMatrixForPath(renderInterface, linkPath);
        const visualMatrix = this.getVisualLinkWorldMatrixForPath(renderInterface, linkPath);
        const currentPhysicalFrameMatrix = this.composeCurrentPhysicalLinkWorldMatrix(currentLinkFrameMatrix, preferredMatrix, stageMatrix);
        if (preferredFrameMode === "visual") {
            return currentLinkFrameMatrix || visualMatrix || preferredMatrix || stageMatrix || null;
        }
        if (preferredFrameMode === "stage") {
            return currentPhysicalFrameMatrix || stageMatrix || currentLinkFrameMatrix || preferredMatrix || visualMatrix || null;
        }
        return currentPhysicalFrameMatrix || stageMatrix || currentLinkFrameMatrix || preferredMatrix || visualMatrix || null;
    }
    composeCurrentPhysicalLinkWorldMatrix(currentLinkFrameMatrix, preferredLinkFrameMatrix, stageLinkFrameMatrix) {
        if (!stageLinkFrameMatrix)
            return currentLinkFrameMatrix || preferredLinkFrameMatrix || null;
        if (!currentLinkFrameMatrix || !preferredLinkFrameMatrix)
            return stageLinkFrameMatrix.clone();
        const preferredDeterminant = preferredLinkFrameMatrix.determinant();
        if (!Number.isFinite(preferredDeterminant) || Math.abs(preferredDeterminant) <= 1e-12) {
            return stageLinkFrameMatrix.clone();
        }
        // Link rotations are authored relative to the controller's preferred base
        // link frame, which may fall back to a visual basis when stage/world
        // transforms look degenerate. COM/inertia overlays must stay in the
        // physical link frame, so preserve the posed delta from the preferred base
        // and reapply it onto the direct stage/physics base.
        return currentLinkFrameMatrix.clone()
            .multiply(preferredLinkFrameMatrix.clone().invert())
            .multiply(stageLinkFrameMatrix.clone());
    }
    createMarkerGroupForLink(record) {
        const markerGroup = new Group();
        markerGroup.name = `dynamics:${record.linkPath}`;
        markerGroup.position.set(0, 0, 0);
        markerGroup.quaternion.set(0, 0, 0, 1);
        markerGroup.scale.set(1, 1, 1);
        const centerOfMassLocal = record.centerOfMassLocal.clone();
        const centerMarkerRadius = this.computeCenterMarkerRadius(record.mass);
        const centerMarker = new Mesh(new SphereGeometry(centerMarkerRadius, 10, 8), new MeshBasicMaterial({
            color: 0x70b8ff,
            transparent: true,
            opacity: 0.94,
            depthTest: false,
            depthWrite: false,
        }));
        centerMarker.position.copy(centerOfMassLocal);
        markerGroup.add(centerMarker);
        if (centerOfMassLocal.lengthSq() > 1e-10) {
            markerGroup.add(this.createLine(new Vector3(0, 0, 0), centerOfMassLocal, 0x70b8ff, 0.55));
        }
        if (record.diagonalInertia && record.diagonalInertia.lengthSq() > 1e-12) {
            const inertiaBoxSize = this.computeInertiaBoxSize(record.diagonalInertia, record.mass);
            const inertiaBox = new Mesh(new BoxGeometry(inertiaBoxSize.x, inertiaBoxSize.y, inertiaBoxSize.z), new MeshBasicMaterial({
                color: 0x2c7be5,
                transparent: true,
                opacity: 0.28,
                depthTest: false,
                depthWrite: false,
            }));
            inertiaBox.position.copy(centerOfMassLocal);
            inertiaBox.quaternion.copy(record.principalAxesLocal);
            markerGroup.add(inertiaBox);
        }
        return markerGroup.children.length > 0 ? markerGroup : null;
    }
    applyLinkWorldMatrixToMarkerGroup(markerGroup, linkWorldMatrix) {
        const linkPosition = new Vector3();
        const linkRotation = new Quaternion();
        const linkScale = new Vector3();
        linkWorldMatrix.decompose(linkPosition, linkRotation, linkScale);
        const positionChanged = markerGroup.position.distanceToSquared(linkPosition) > 1e-16;
        const rotationDot = Math.abs(markerGroup.quaternion.dot(linkRotation));
        const rotationChanged = (1 - Math.min(1, rotationDot)) > 1e-12;
        if (positionChanged) {
            markerGroup.position.copy(linkPosition);
        }
        if (rotationChanged) {
            markerGroup.quaternion.copy(linkRotation);
        }
        if (markerGroup.scale.x !== 1 || markerGroup.scale.y !== 1 || markerGroup.scale.z !== 1) {
            markerGroup.scale.set(1, 1, 1);
        }
        if (positionChanged || rotationChanged) {
            markerGroup.updateMatrixWorld(true);
            return true;
        }
        return false;
    }
    createLine(start, end, color, opacity) {
        const geometry = new BufferGeometry().setFromPoints([start, end]);
        const material = new LineBasicMaterial({
            color,
            transparent: true,
            opacity,
            depthTest: false,
            depthWrite: false,
        });
        return new Line(geometry, material);
    }
    computeCenterMarkerRadius(mass) {
        if (mass === null || mass <= 0)
            return 0.011;
        const radius = 0.008 + Math.log10(Math.max(mass, 1e-4) + 1) * 0.004;
        return Math.min(0.02, Math.max(0.009, radius));
    }
    computeInertiaBoxSize(diagonalInertia, mass) {
        const resolvedMass = mass !== null && mass > 1e-6 ? mass : 1;
        const ixx = Math.max(0, Number(diagonalInertia.x) || 0);
        const iyy = Math.max(0, Number(diagonalInertia.y) || 0);
        const izz = Math.max(0, Number(diagonalInertia.z) || 0);
        const dimensionFromPrincipalMoments = (left, right, subtract) => {
            const squared = (6 * Math.max(0, left + right - subtract)) / resolvedMass;
            if (!Number.isFinite(squared) || squared <= 0)
                return 0;
            return Math.sqrt(squared);
        };
        const fallbackDimensionFromMoment = (moment) => {
            const clampedMoment = Math.max(moment, 1e-9);
            const radiusOfGyration = Math.sqrt(clampedMoment / resolvedMass);
            return radiusOfGyration * 0.6;
        };
        const clampDimension = (value) => Math.min(0.5, Math.max(0.012, value));
        const sizeX = dimensionFromPrincipalMoments(iyy, izz, ixx) || fallbackDimensionFromMoment(ixx);
        const sizeY = dimensionFromPrincipalMoments(ixx, izz, iyy) || fallbackDimensionFromMoment(iyy);
        const sizeZ = dimensionFromPrincipalMoments(ixx, iyy, izz) || fallbackDimensionFromMoment(izz);
        return new Vector3(clampDimension(sizeX), clampDimension(sizeY), clampDimension(sizeZ));
    }
}
