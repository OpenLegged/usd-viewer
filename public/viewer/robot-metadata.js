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
function normalizePath(value) {
    const trimmed = String(value || "").trim().replace(/[<>]/g, "");
    if (!trimmed)
        return null;
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
function toAxisToken(value) {
    const token = String(value || "").trim().toUpperCase();
    if (token.startsWith("Y"))
        return "Y";
    if (token.startsWith("Z"))
        return "Z";
    return "X";
}
function toVector3Tuple(value, fallback) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 3)
        return fallback;
    const x = toFiniteNumber(source[0]);
    const y = toFiniteNumber(source[1]);
    const z = toFiniteNumber(source[2]);
    if (x === null || y === null || z === null)
        return fallback;
    return [x, y, z];
}
function toQuaternionTuple(value, fallback) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 4)
        return fallback;
    const x = toFiniteNumber(source[0]);
    const y = toFiniteNumber(source[1]);
    const z = toFiniteNumber(source[2]);
    const w = toFiniteNumber(source[3]);
    if (x === null || y === null || z === null || w === null)
        return fallback;
    return [x, y, z, w];
}
function toQuaternionWxyzTupleAsXyzw(value, fallback) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value.length === "number" ? Array.from(value) : null);
    if (!source || source.length < 4)
        return fallback;
    const w = toFiniteNumber(source[0]);
    const x = toFiniteNumber(source[1]);
    const y = toFiniteNumber(source[2]);
    const z = toFiniteNumber(source[3]);
    if (x === null || y === null || z === null || w === null)
        return fallback;
    return [x, y, z, w];
}
function toCollisionPrimitiveCounts(value) {
    if (!value || typeof value !== "object")
        return {};
    const output = {};
    for (const [shape, countRaw] of Object.entries(value)) {
        const count = Number(countRaw);
        if (!shape || !Number.isFinite(count) || count <= 0)
            continue;
        output[String(shape)] = Math.floor(count);
    }
    return output;
}
export function normalizeRenderRobotMetadataSnapshot(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const normalizedJointCatalogEntries = [];
    const rawJointCatalogEntries = Array.isArray(raw.jointCatalogEntries)
        ? raw.jointCatalogEntries
        : [];
    for (const entry of rawJointCatalogEntries) {
        const linkPath = normalizePath(entry?.linkPath || entry?.childLinkPath);
        if (!linkPath)
            continue;
        const jointPath = normalizePath(entry?.jointPath);
        const jointName = String(entry?.jointName || "").trim();
        const jointType = String(entry?.jointType || "PhysicsJoint").trim() || "PhysicsJoint";
        const jointTypeNameRaw = String(entry?.jointTypeName || "").trim();
        const parentLinkPath = normalizePath(entry?.parentLinkPath);
        const lowerLimitDeg = toFiniteNumber(entry?.lowerLimitDeg);
        const upperLimitDeg = toFiniteNumber(entry?.upperLimitDeg);
        const localPivotSource = entry?.localPivotInLink;
        normalizedJointCatalogEntries.push({
            linkPath,
            jointPath,
            jointName: jointName || (jointPath ? jointPath.split("/").pop() || "" : ""),
            jointType,
            jointTypeName: jointTypeNameRaw || null,
            parentLinkPath,
            axisToken: toAxisToken(entry?.axisToken),
            axisLocal: toVector3Tuple(entry?.axisLocal, [1, 0, 0]),
            lowerLimitDeg: lowerLimitDeg ?? -180,
            upperLimitDeg: upperLimitDeg ?? 180,
            localPivotInLink: Array.isArray(localPivotSource)
                ? toVector3Tuple(localPivotSource, [0, 0, 0])
                : null,
        });
    }
    const normalizedLinkDynamicsEntries = [];
    const rawLinkDynamicsEntries = Array.isArray(raw.linkDynamicsEntries)
        ? raw.linkDynamicsEntries
        : [];
    for (const entry of rawLinkDynamicsEntries) {
        const linkPath = normalizePath(entry?.linkPath);
        if (!linkPath)
            continue;
        const mass = toFiniteNumber(entry?.mass);
        const diagonalInertiaSource = entry?.diagonalInertia;
        const diagonalInertia = Array.isArray(diagonalInertiaSource)
            ? toVector3Tuple(diagonalInertiaSource, [0, 0, 0])
            : null;
        normalizedLinkDynamicsEntries.push({
            linkPath,
            mass,
            centerOfMassLocal: toVector3Tuple(entry?.centerOfMassLocal, [0, 0, 0]),
            diagonalInertia,
            principalAxesLocal: Array.isArray(entry?.principalAxesLocal)
                ? toQuaternionTuple(entry?.principalAxesLocal, [0, 0, 0, 1])
                : toQuaternionWxyzTupleAsXyzw(entry?.principalAxesLocalWxyz, [0, 0, 0, 1]),
        });
    }
    const meshCountsByLinkPathRaw = raw.meshCountsByLinkPath;
    const meshCountsByLinkPath = {};
    if (meshCountsByLinkPathRaw && typeof meshCountsByLinkPathRaw === "object") {
        for (const [rawLinkPath, rawCounts] of Object.entries(meshCountsByLinkPathRaw)) {
            const linkPath = normalizePath(rawLinkPath);
            if (!linkPath)
                continue;
            const visualMeshCount = Number(rawCounts?.visualMeshCount);
            const collisionMeshCount = Number(rawCounts?.collisionMeshCount);
            meshCountsByLinkPath[linkPath] = {
                visualMeshCount: Number.isFinite(visualMeshCount) ? Math.max(0, Math.floor(visualMeshCount)) : 0,
                collisionMeshCount: Number.isFinite(collisionMeshCount) ? Math.max(0, Math.floor(collisionMeshCount)) : 0,
                collisionPrimitiveCounts: toCollisionPrimitiveCounts(rawCounts?.collisionPrimitiveCounts),
            };
        }
    }
    const linkParentPairsRaw = Array.isArray(raw.linkParentPairs)
        ? raw.linkParentPairs
        : [];
    const linkParentPairs = [];
    for (const pair of linkParentPairsRaw) {
        if (!Array.isArray(pair) || pair.length <= 0)
            continue;
        const childLinkPath = normalizePath(pair[0]);
        if (!childLinkPath)
            continue;
        const parentLinkPath = normalizePath(pair[1]) || null;
        linkParentPairs.push([childLinkPath, parentLinkPath]);
    }
    return {
        stageSourcePath: String(raw.stageSourcePath || "").trim() || null,
        generatedAtMs: Number.isFinite(Number(raw.generatedAtMs))
            ? Number(raw.generatedAtMs)
            : Date.now(),
        source: String(raw.source || "unknown"),
        linkParentPairs,
        jointCatalogEntries: normalizedJointCatalogEntries,
        linkDynamicsEntries: normalizedLinkDynamicsEntries,
        meshCountsByLinkPath,
    };
}
export function getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath = null) {
    const getter = renderInterface?.getCachedRobotMetadataSnapshot;
    if (typeof getter !== "function")
        return null;
    try {
        return normalizeRenderRobotMetadataSnapshot(getter.call(renderInterface, stageSourcePath || null));
    }
    catch {
        return null;
    }
}
export async function warmupRenderRobotMetadataSnapshot(renderInterface, options = {}) {
    const starter = renderInterface?.startRobotMetadataWarmupForStage;
    const stageSourcePath = String(options.stageSourcePath || "").trim() || null;
    const starterOptions = { ...options };
    delete starterOptions.stageSourcePath;
    if (typeof starter !== "function") {
        return getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath);
    }
    try {
        const maybePromise = stageSourcePath
            ? starter.call(renderInterface, stageSourcePath, starterOptions)
            : starter.call(renderInterface, starterOptions);
        if (maybePromise && typeof maybePromise.then === "function") {
            const resolved = await maybePromise;
            return normalizeRenderRobotMetadataSnapshot(resolved) || getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath);
        }
        return normalizeRenderRobotMetadataSnapshot(maybePromise) || getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath);
    }
    catch {
        return getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath);
    }
}
