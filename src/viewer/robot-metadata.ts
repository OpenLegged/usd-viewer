export type RenderRobotJointCatalogEntry = {
  linkPath: string;
  jointPath: string | null;
  jointName: string;
  jointType: string;
  jointTypeName?: string | null;
  parentLinkPath: string | null;
  axisToken: "X" | "Y" | "Z";
  axisLocal: [number, number, number];
  lowerLimitDeg: number;
  upperLimitDeg: number;
  localPivotInLink: [number, number, number] | null;
};

export type RenderRobotLinkDynamicsEntry = {
  linkPath: string;
  mass: number | null;
  centerOfMassLocal: [number, number, number];
  diagonalInertia: [number, number, number] | null;
  principalAxesLocal: [number, number, number, number];
};

export type RenderRobotMetadataSnapshot = {
  stageSourcePath: string | null;
  generatedAtMs: number;
  source: string;
  linkParentPairs: Array<[string, string | null]>;
  jointCatalogEntries: RenderRobotJointCatalogEntry[];
  linkDynamicsEntries: RenderRobotLinkDynamicsEntry[];
  meshCountsByLinkPath: Record<string, {
    visualMeshCount: number;
    collisionMeshCount: number;
    collisionPrimitiveCounts: Record<string, number>;
  }>;
};

function toFiniteNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function normalizePath(value: any): string | null {
  const trimmed = String(value || "").trim().replace(/[<>]/g, "");
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function toAxisToken(value: any): "X" | "Y" | "Z" {
  const token = String(value || "").trim().toUpperCase();
  if (token.startsWith("Y")) return "Y";
  if (token.startsWith("Z")) return "Z";
  return "X";
}

function toVector3Tuple(value: any, fallback: [number, number, number]): [number, number, number] {
  const source = Array.isArray(value)
    ? value
    : (value && typeof value.length === "number" ? Array.from(value) : null);
  if (!source || source.length < 3) return fallback;
  const x = toFiniteNumber(source[0]);
  const y = toFiniteNumber(source[1]);
  const z = toFiniteNumber(source[2]);
  if (x === null || y === null || z === null) return fallback;
  return [x, y, z];
}

function toQuaternionTuple(value: any, fallback: [number, number, number, number]): [number, number, number, number] {
  const source = Array.isArray(value)
    ? value
    : (value && typeof value.length === "number" ? Array.from(value) : null);
  if (!source || source.length < 4) return fallback;
  const x = toFiniteNumber(source[0]);
  const y = toFiniteNumber(source[1]);
  const z = toFiniteNumber(source[2]);
  const w = toFiniteNumber(source[3]);
  if (x === null || y === null || z === null || w === null) return fallback;
  return [x, y, z, w];
}

function toQuaternionWxyzTupleAsXyzw(
  value: any,
  fallback: [number, number, number, number],
): [number, number, number, number] {
  const source = Array.isArray(value)
    ? value
    : (value && typeof value.length === "number" ? Array.from(value) : null);
  if (!source || source.length < 4) return fallback;
  const w = toFiniteNumber(source[0]);
  const x = toFiniteNumber(source[1]);
  const y = toFiniteNumber(source[2]);
  const z = toFiniteNumber(source[3]);
  if (x === null || y === null || z === null || w === null) return fallback;
  return [x, y, z, w];
}

function toCollisionPrimitiveCounts(value: any): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, number> = {};
  for (const [shape, countRaw] of Object.entries(value)) {
    const count = Number(countRaw);
    if (!shape || !Number.isFinite(count) || count <= 0) continue;
    output[String(shape)] = Math.floor(count);
  }
  return output;
}

export function normalizeRenderRobotMetadataSnapshot(raw: any): RenderRobotMetadataSnapshot | null {
  if (!raw || typeof raw !== "object") return null;

  const normalizedJointCatalogEntries: RenderRobotJointCatalogEntry[] = [];
  const rawJointCatalogEntries = Array.isArray((raw as any).jointCatalogEntries)
    ? (raw as any).jointCatalogEntries
    : [];
  for (const entry of rawJointCatalogEntries) {
    const linkPath = normalizePath((entry as any)?.linkPath || (entry as any)?.childLinkPath);
    if (!linkPath) continue;
    const jointPath = normalizePath((entry as any)?.jointPath);
    const jointName = String((entry as any)?.jointName || "").trim();
    const jointType = String((entry as any)?.jointType || "PhysicsJoint").trim() || "PhysicsJoint";
    const jointTypeNameRaw = String((entry as any)?.jointTypeName || "").trim();
    const parentLinkPath = normalizePath((entry as any)?.parentLinkPath);
    const lowerLimitDeg = toFiniteNumber((entry as any)?.lowerLimitDeg);
    const upperLimitDeg = toFiniteNumber((entry as any)?.upperLimitDeg);
    const localPivotSource = (entry as any)?.localPivotInLink;
    normalizedJointCatalogEntries.push({
      linkPath,
      jointPath,
      jointName: jointName || (jointPath ? jointPath.split("/").pop() || "" : ""),
      jointType,
      jointTypeName: jointTypeNameRaw || null,
      parentLinkPath,
      axisToken: toAxisToken((entry as any)?.axisToken),
      axisLocal: toVector3Tuple((entry as any)?.axisLocal, [1, 0, 0]),
      lowerLimitDeg: lowerLimitDeg ?? -180,
      upperLimitDeg: upperLimitDeg ?? 180,
      localPivotInLink: Array.isArray(localPivotSource)
        ? toVector3Tuple(localPivotSource, [0, 0, 0])
        : null,
    });
  }

  const normalizedLinkDynamicsEntries: RenderRobotLinkDynamicsEntry[] = [];
  const rawLinkDynamicsEntries = Array.isArray((raw as any).linkDynamicsEntries)
    ? (raw as any).linkDynamicsEntries
    : [];
  for (const entry of rawLinkDynamicsEntries) {
    const linkPath = normalizePath((entry as any)?.linkPath);
    if (!linkPath) continue;
    const mass = toFiniteNumber((entry as any)?.mass);
    const diagonalInertiaSource = (entry as any)?.diagonalInertia;
    const diagonalInertia = Array.isArray(diagonalInertiaSource)
      ? toVector3Tuple(diagonalInertiaSource, [0, 0, 0])
      : null;
    normalizedLinkDynamicsEntries.push({
      linkPath,
      mass,
      centerOfMassLocal: toVector3Tuple((entry as any)?.centerOfMassLocal, [0, 0, 0]),
      diagonalInertia,
      principalAxesLocal: Array.isArray((entry as any)?.principalAxesLocal)
        ? toQuaternionTuple((entry as any)?.principalAxesLocal, [0, 0, 0, 1])
        : toQuaternionWxyzTupleAsXyzw((entry as any)?.principalAxesLocalWxyz, [0, 0, 0, 1]),
    });
  }

  const meshCountsByLinkPathRaw = (raw as any).meshCountsByLinkPath;
  const meshCountsByLinkPath: RenderRobotMetadataSnapshot["meshCountsByLinkPath"] = {};
  if (meshCountsByLinkPathRaw && typeof meshCountsByLinkPathRaw === "object") {
    for (const [rawLinkPath, rawCounts] of Object.entries(meshCountsByLinkPathRaw)) {
      const linkPath = normalizePath(rawLinkPath);
      if (!linkPath) continue;
      const visualMeshCount = Number((rawCounts as any)?.visualMeshCount);
      const collisionMeshCount = Number((rawCounts as any)?.collisionMeshCount);
      meshCountsByLinkPath[linkPath] = {
        visualMeshCount: Number.isFinite(visualMeshCount) ? Math.max(0, Math.floor(visualMeshCount)) : 0,
        collisionMeshCount: Number.isFinite(collisionMeshCount) ? Math.max(0, Math.floor(collisionMeshCount)) : 0,
        collisionPrimitiveCounts: toCollisionPrimitiveCounts((rawCounts as any)?.collisionPrimitiveCounts),
      };
    }
  }

  const linkParentPairsRaw = Array.isArray((raw as any).linkParentPairs)
    ? (raw as any).linkParentPairs
    : [];
  const linkParentPairs: RenderRobotMetadataSnapshot["linkParentPairs"] = [];
  for (const pair of linkParentPairsRaw) {
    if (!Array.isArray(pair) || pair.length <= 0) continue;
    const childLinkPath = normalizePath(pair[0]);
    if (!childLinkPath) continue;
    const parentLinkPath = normalizePath(pair[1]) || null;
    linkParentPairs.push([childLinkPath, parentLinkPath]);
  }

  return {
    stageSourcePath: String((raw as any).stageSourcePath || "").trim() || null,
    generatedAtMs: Number.isFinite(Number((raw as any).generatedAtMs))
      ? Number((raw as any).generatedAtMs)
      : Date.now(),
    source: String((raw as any).source || "unknown"),
    linkParentPairs,
    jointCatalogEntries: normalizedJointCatalogEntries,
    linkDynamicsEntries: normalizedLinkDynamicsEntries,
    meshCountsByLinkPath,
  };
}

export function getRenderRobotMetadataSnapshot(
  renderInterface: any,
  stageSourcePath: string | null = null,
): RenderRobotMetadataSnapshot | null {
  const getter = renderInterface?.getCachedRobotMetadataSnapshot;
  if (typeof getter !== "function") return null;
  try {
    return normalizeRenderRobotMetadataSnapshot(getter.call(renderInterface, stageSourcePath || null));
  } catch {
    return null;
  }
}

export async function warmupRenderRobotMetadataSnapshot(
  renderInterface: any,
  options: {
    force?: boolean;
    stageSourcePath?: string | null;
    skipIdleWait?: boolean;
    skipUrdfTruthFallback?: boolean;
  } = {},
): Promise<RenderRobotMetadataSnapshot | null> {
  const starter = renderInterface?.startRobotMetadataWarmupForStage;
  const stageSourcePath = String(options.stageSourcePath || "").trim() || null;
  const starterOptions = { ...options };
  delete (starterOptions as any).stageSourcePath;
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
  } catch {
    return getRenderRobotMetadataSnapshot(renderInterface, stageSourcePath);
  }
}
