import { Camera, MathUtils, Matrix4, Mesh, Object3D, Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type HydraMeshLike = { _mesh?: Mesh };
export type RevoluteJointPrimLike = {
  GetTypeName?: () => string;
  GetAttribute?: (name: string) => { Get?: () => any } | null;
};
export type SdfLayerLike = {
  ExportToString?: () => string;
};
export type StageLike = {
  GetPrimAtPath?: (path: string) => RevoluteJointPrimLike | null;
  GetRootLayer?: () => SdfLayerLike | null;
};
export type RenderInterfaceLike = {
  meshes?: Record<string, HydraMeshLike>;
  getWorldTransformForPrimPath?: (path: string) => Matrix4 | null;
  getPreferredLinkWorldTransform?: (path: string) => Matrix4 | null;
  getResolvedVisualTransformPrimPathForMeshId?: (meshId: string) => string | null;
  getFallbackTransformForMeshId?: (meshId: string) => Matrix4 | null;
  getStage?: () => StageLike | null;
} | null | undefined;

export type JointInfoSnapshot = {
  linkPath: string;
  jointPath: string;
  axisToken: "X" | "Y" | "Z";
  lowerLimitDeg: number;
  upperLimitDeg: number;
  angleDeg: number;
};

export type LinkJointState = {
  linkPath: string;
  jointPath: string;
  parentLinkPath: string | null;
  axisToken: "X" | "Y" | "Z";
  axisLocal: Vector3;
  lowerLimitDeg: number;
  upperLimitDeg: number;
  angleDeg: number;
  localPivotInLink: Vector3 | null;
};

export type JointCatalogEntry = {
  linkPath: string;
  jointPath: string;
  parentLinkPath: string | null;
  axisToken: "X" | "Y" | "Z";
  axisLocal: Vector3;
  lowerLimitDeg: number;
  upperLimitDeg: number;
  localPivotInLink: Vector3 | null;
};

export type JointCatalogCacheSnapshot = {
  linkParentPairs: Array<[string, string | null]>;
  jointCatalogEntries: JointCatalogEntry[];
};

export const jointCatalogCacheByStagePath = new Map<string, JointCatalogCacheSnapshot>();
export const maxJointCatalogCacheEntries = 8;

export function getLinkPathFromMeshId(meshId: string): string | null {
  if (!meshId) return null;
  const marker = ".proto_";
  const markerIndex = meshId.indexOf(marker);
  if (markerIndex <= 0) return null;

  let linkPath = meshId.substring(0, markerIndex);
  if (linkPath.endsWith("/visuals") || linkPath.endsWith("/collisions")) {
    const parentSlash = linkPath.lastIndexOf("/");
    if (parentSlash > 0) linkPath = linkPath.substring(0, parentSlash);
  }

  return linkPath || null;
}

export function getRootPathFromLinkPath(linkPath: string): string | null {
  if (!linkPath.startsWith("/")) return null;
  const segments = linkPath.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  return `/${segments[0]}`;
}

export function getPathBasename(path: string): string {
  const normalized = String(path || "").trim();
  if (!normalized) return "";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || "";
}

export function toTokenString(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    if (value.every((entry) => typeof entry === "string")) {
      const joined = value.join("");
      if (joined.length > 0) return joined;
    }
    return String(value[0]);
  }
  if (value && typeof value.length === "number" && typeof value !== "string") {
    try {
      const arrayValue = Array.from(value);
      if (arrayValue.every((entry) => typeof entry === "string")) {
        return arrayValue.join("");
      }
      if (arrayValue.length > 0) return String(arrayValue[0]);
    } catch {}
  }
  return String(value ?? "");
}

export function toFiniteNumber(value: any): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

export function toVector3FromValue(value: any): Vector3 | null {
  if (!value) return null;

  if (typeof value === "object" && !Array.isArray(value)) {
    const xObject = toFiniteNumber((value as any).x ?? (value as any).X);
    const yObject = toFiniteNumber((value as any).y ?? (value as any).Y);
    const zObject = toFiniteNumber((value as any).z ?? (value as any).Z);
    if (xObject !== null && yObject !== null && zObject !== null) {
      return new Vector3(xObject, yObject, zObject);
    }
  }

  const source = Array.isArray(value)
    ? value
    : (value && typeof value.length === "number" ? Array.from(value) : null);
  if (!source || source.length < 3) return null;
  const x = toFiniteNumber(source[0]);
  const y = toFiniteNumber(source[1]);
  const z = toFiniteNumber(source[2]);
  if (x === null || y === null || z === null) return null;
  return new Vector3(x, y, z);
}

export function normalizeAxisToken(value: any): "X" | "Y" | "Z" {
  const token = toTokenString(value).trim().toUpperCase();
  if (token.startsWith("X")) return "X";
  if (token.startsWith("Y")) return "Y";
  if (token.startsWith("Z")) return "Z";
  return "X";
}

export function axisTokenToVector(axisToken: "X" | "Y" | "Z"): Vector3 {
  if (axisToken === "Y") return new Vector3(0, 1, 0);
  if (axisToken === "Z") return new Vector3(0, 0, 1);
  return new Vector3(1, 0, 0);
}

export function normalizeLimits(lowerLimitDeg: number | null, upperLimitDeg: number | null): { lower: number; upper: number } {
  let lower = lowerLimitDeg ?? -180;
  let upper = upperLimitDeg ?? 180;
  if (!Number.isFinite(lower)) lower = -180;
  if (!Number.isFinite(upper)) upper = 180;
  if (lower > upper) {
    const midpoint = (lower + upper) * 0.5;
    lower = midpoint;
    upper = midpoint;
  }
  return { lower, upper };
}

export function roundAngleDegrees(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampJointAnglePreservingNeutralZero(
  angleDeg: number,
  lowerLimitDeg: number,
  upperLimitDeg: number
): number {
  const numericAngle = Number(angleDeg);
  if (!Number.isFinite(numericAngle)) return 0;
  if (Math.abs(numericAngle) <= 1e-8) return 0;
  return MathUtils.clamp(numericAngle, lowerLimitDeg, upperLimitDeg);
}

export function getInteractiveJointLimits(
  lowerLimitDeg: number,
  upperLimitDeg: number
): { lower: number; upper: number } {
  const lower = Number.isFinite(lowerLimitDeg) ? lowerLimitDeg : -180;
  const upper = Number.isFinite(upperLimitDeg) ? upperLimitDeg : 180;
  return {
    lower: Math.min(lower, 0),
    upper: Math.max(upper, 0),
  };
}

export function hasFiniteLimitValue(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function getJointPathCandidatesForLinkPath(linkPath: string): string[] {
  const rootPath = getRootPathFromLinkPath(linkPath);
  if (!rootPath) return [];
  const linkName = linkPath.split("/").pop() || "";
  if (!linkName) return [];

  const baseName = linkName.endsWith("_link") ? linkName.substring(0, linkName.length - "_link".length) : linkName;
  const candidates = new Set<string>();
  candidates.add(`${rootPath}/joints/${baseName}_joint`);
  candidates.add(`${rootPath}/joints/${linkName}_joint`);
  candidates.add(`${rootPath}/joints/${linkName}`);
  candidates.add(`${rootPath}/${baseName}_joint`);
  candidates.add(`${rootPath}/${linkName}_joint`);
  candidates.add(`${rootPath}/${linkName}`);
  return Array.from(candidates);
}

export function safeGetPrimAtPath(stage: StageLike | null, path: string): RevoluteJointPrimLike | null {
  if (!stage?.GetPrimAtPath || !path) return null;
  try {
    return stage.GetPrimAtPath(path);
  } catch {
    return null;
  }
}

export function safeGetPrimAttribute(prim: RevoluteJointPrimLike | null, name: string): any {
  if (!prim?.GetAttribute || !name) return undefined;
  try {
    return prim.GetAttribute(name)?.Get?.();
  } catch {
    return undefined;
  }
}

export function safeGetPrimTypeName(prim: RevoluteJointPrimLike | null): string {
  try {
    return String(prim?.GetTypeName?.() || "");
  } catch {
    return "";
  }
}

export function isControllableRevoluteJointTypeName(typeName: string): boolean {
  const normalized = String(typeName || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("revolutejoint") || normalized === "revolutejoint" || normalized.endsWith("revolutejoint");
}

export function isPhysicsJointTypeName(typeName: string): boolean {
  const normalized = String(typeName || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "joint") return true;
  return normalized.includes("joint") && (normalized.includes("physics") || normalized.endsWith("joint"));
}

export function normalizeUsdPathToken(value: string): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  const bracketMatches = Array.from(trimmed.matchAll(/<([^>]+)>/g));
  if (bracketMatches.length > 0) {
    for (const match of bracketMatches) {
      const candidate = String(match?.[1] || "").trim();
      if (candidate.startsWith("/")) return candidate;
    }
  }

  if (trimmed.startsWith("/")) return trimmed;
  return null;
}

export function toUsdPathListFromValue(value: any): string[] {
  const output = new Set<string>();
  const visited = new Set<any>();

  const visit = (source: any): void => {
    if (source === null || source === undefined) return;
    if (typeof source === "string") {
      const normalized = normalizeUsdPathToken(source);
      if (normalized) output.add(normalized);
      return;
    }

    if (typeof source === "object") {
      if (visited.has(source)) return;
      visited.add(source);
    }

    if (Array.isArray(source) || (source && typeof source.length === "number" && typeof source !== "string")) {
      try {
        for (const entry of Array.from(source as Iterable<any>)) {
          visit(entry);
        }
      } catch {}
    }

    if (source && typeof source === "object") {
      const pathCandidates = [
        (source as any).path,
        (source as any).resolvedPath,
        (source as any).assetPath,
        (source as any).targetPath,
        typeof (source as any).GetString === "function" ? (source as any).GetString() : undefined,
      ];
      for (const candidate of pathCandidates) {
        if (!candidate) continue;
        const normalized = normalizeUsdPathToken(String(candidate));
        if (normalized) output.add(normalized);
      }

      try {
        const objectAsString = String(source);
        const normalized = normalizeUsdPathToken(objectAsString);
        if (normalized) output.add(normalized);
      } catch {}
    }
  };

  visit(value);
  return Array.from(output);
}

export type ParsedJointRecord = {
  jointTypeName: string;
  jointName: string;
  body0Path: string | null;
  body1Path: string | null;
  axisToken: "X" | "Y" | "Z";
  lowerLimitDeg: number | null;
  upperLimitDeg: number | null;
  localPos1: Vector3 | null;
  localRot1: Quaternion | null;
};

export type RuntimeLinkPathIndex = {
  allLinkPaths: Set<string>;
  linkPathsByLinkName: Map<string, string[]>;
  rootPaths: string[];
};

export function normalizeAxisVector(axisVector: Vector3 | null | undefined): Vector3 {
  if (!axisVector) return new Vector3(1, 0, 0);
  const normalized = axisVector.clone();
  if (!Number.isFinite(normalized.lengthSq()) || normalized.lengthSq() <= 1e-12) {
    return new Vector3(1, 0, 0);
  }
  normalized.normalize();
  return normalized;
}

export function axisTokenFromAxisVector(axisVector: Vector3 | null | undefined): "X" | "Y" | "Z" {
  const axis = normalizeAxisVector(axisVector);
  const absX = Math.abs(axis.x);
  const absY = Math.abs(axis.y);
  const absZ = Math.abs(axis.z);
  if (absY >= absX && absY >= absZ) return "Y";
  if (absZ >= absX && absZ >= absY) return "Z";
  return "X";
}

export function buildRuntimeLinkPathIndex(renderInterface: RenderInterfaceLike): RuntimeLinkPathIndex {
  const allLinkPaths = new Set<string>();
  const linkPathsByLinkName = new Map<string, string[]>();
  const rootPathSet = new Set<string>();

  if (renderInterface?.meshes) {
    for (const meshId of Object.keys(renderInterface.meshes)) {
      const linkPath = getLinkPathFromMeshId(meshId);
      if (!linkPath || allLinkPaths.has(linkPath)) continue;
      allLinkPaths.add(linkPath);
      const linkName = getPathBasename(linkPath);
      if (linkName) {
        const entries = linkPathsByLinkName.get(linkName) || [];
        entries.push(linkPath);
        linkPathsByLinkName.set(linkName, entries);
      }
      const rootPath = getRootPathFromLinkPath(linkPath);
      if (rootPath) rootPathSet.add(rootPath);
    }
  }

  const rootPaths = Array.from(rootPathSet);
  for (const [linkName, linkPaths] of linkPathsByLinkName.entries()) {
    linkPaths.sort((left, right) => left.localeCompare(right));
    linkPathsByLinkName.set(linkName, linkPaths);
  }

  return {
    allLinkPaths,
    linkPathsByLinkName,
    rootPaths,
  };
}

export function sortLinkPathsForPreferredRoot(linkPaths: string[], preferredRootPath: string | null): string[] {
  const deduped = Array.from(new Set(linkPaths.filter(Boolean)));
  deduped.sort((left, right) => left.localeCompare(right));
  if (!preferredRootPath) return deduped;

  return deduped.sort((left, right) => {
    const leftPreferred = getRootPathFromLinkPath(left) === preferredRootPath ? 0 : 1;
    const rightPreferred = getRootPathFromLinkPath(right) === preferredRootPath ? 0 : 1;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
    return left.localeCompare(right);
  });
}

export function resolveRuntimeLinkPathsFromLinkName(
  linkName: string | null | undefined,
  runtimeIndex: RuntimeLinkPathIndex,
  preferredRootPath: string | null = null
): string[] {
  const normalizedName = String(linkName || "").trim();
  if (!normalizedName) return [];
  const candidates = runtimeIndex.linkPathsByLinkName.get(normalizedName) || [];
  return sortLinkPathsForPreferredRoot(candidates, preferredRootPath);
}

export function resolveRuntimeLinkPathsFromSourcePath(
  sourcePath: string | null | undefined,
  runtimeIndex: RuntimeLinkPathIndex,
  preferredRootPath: string | null = null
): string[] {
  const rawSource = String(sourcePath || "").trim();
  const normalized = normalizeUsdPathToken(rawSource);
  if (!normalized) {
    const fallbackName = getPathBasename(rawSource.replace(/[<>]/g, ""));
    if (!fallbackName) return [];
    return resolveRuntimeLinkPathsFromLinkName(fallbackName, runtimeIndex, preferredRootPath);
  }

  const matches: string[] = [];
  const addMatch = (candidatePath: string | null): void => {
    if (!candidatePath) return;
    if (!runtimeIndex.allLinkPaths.has(candidatePath)) return;
    if (matches.includes(candidatePath)) return;
    matches.push(candidatePath);
  };

  addMatch(normalized);
  const linkName = getPathBasename(normalized);
  if (linkName) {
    for (const byNameCandidate of runtimeIndex.linkPathsByLinkName.get(linkName) || []) {
      addMatch(byNameCandidate);
    }
  }

  const pathSegments = normalized.split("/").filter(Boolean);
  const relativeSegments = pathSegments.length > 1 ? pathSegments.slice(1) : [];
  if (relativeSegments.length > 0) {
    const rootSearchOrder = preferredRootPath
      ? [preferredRootPath, ...runtimeIndex.rootPaths.filter((entry) => entry !== preferredRootPath)]
      : runtimeIndex.rootPaths;
    for (const rootPath of rootSearchOrder) {
      const remapped = `${rootPath}/${relativeSegments.join("/")}`;
      addMatch(remapped);
    }
  }

  return sortLinkPathsForPreferredRoot(matches, preferredRootPath);
}

export function pickRuntimeParentLinkPath(parentCandidates: string[], preferredRootPath: string | null): string | null {
  if (!Array.isArray(parentCandidates) || parentCandidates.length === 0) return null;
  if (preferredRootPath) {
    for (const candidate of parentCandidates) {
      if (getRootPathFromLinkPath(candidate) === preferredRootPath) return candidate;
    }
  }
  return parentCandidates[0] || null;
}

export function parseVector3FromTupleLiteral(tupleLiteral: string): Vector3 | null {
  if (!tupleLiteral) return null;
  const source = tupleLiteral
    .split(",")
    .map((part) => toFiniteNumber(part.trim()))
    .filter((part): part is number => part !== null);
  if (source.length < 3) return null;
  return new Vector3(source[0], source[1], source[2]);
}

export function parseQuaternionFromTupleLiteral(tupleLiteral: string): Quaternion | null {
  if (!tupleLiteral) return null;
  const source = tupleLiteral
    .split(",")
    .map((part) => toFiniteNumber(part.trim()))
    .filter((part): part is number => part !== null);
  if (source.length < 4) return null;

  const quaternion = new Quaternion(source[1], source[2], source[3], source[0]);
  if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
    return null;
  }
  quaternion.normalize();
  return quaternion;
}

export function toQuaternionFromValue(value: any): Quaternion | null {
  if (!value) return null;

  if (typeof value === "object" && !Array.isArray(value)) {
    const xObject = toFiniteNumber((value as any).x ?? (value as any).i ?? (value as any).X);
    const yObject = toFiniteNumber((value as any).y ?? (value as any).j ?? (value as any).Y);
    const zObject = toFiniteNumber((value as any).z ?? (value as any).k ?? (value as any).Z);
    const wObject = toFiniteNumber((value as any).w ?? (value as any).real ?? (value as any).W ?? (value as any).r);
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
  if (!source || source.length < 4) return null;

  const w = toFiniteNumber(source[0]);
  const x = toFiniteNumber(source[1]);
  const y = toFiniteNumber(source[2]);
  const z = toFiniteNumber(source[3]);
  if (w === null || x === null || y === null || z === null) return null;

  const quaternion = new Quaternion(x, y, z, w);
  if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
    return null;
  }
  quaternion.normalize();
  return quaternion;
}

export function rotateAxisByQuaternion(axisToken: "X" | "Y" | "Z", localRotation: Quaternion | null): Vector3 {
  const axisVector = axisTokenToVector(axisToken);
  if (!localRotation) return axisVector;
  axisVector.applyQuaternion(localRotation).normalize();
  return axisVector;
}

export type JointBlockRecord = {
  jointTypeName: string;
  jointName: string;
  body: string;
};

export function findMatchingClosingBraceIndex(source: string, openingBraceIndex: number): number {
  if (!source || openingBraceIndex < 0 || source[openingBraceIndex] !== "{") return -1;
  let depth = 0;
  let insideString = false;

  for (let cursor = openingBraceIndex; cursor < source.length; cursor++) {
    const character = source[cursor];
    const previousCharacter = cursor > 0 ? source[cursor - 1] : "";

    if (character === "\"" && previousCharacter !== "\\") {
      insideString = !insideString;
      continue;
    }
    if (insideString) continue;

    if (character === "{") {
      depth++;
      continue;
    }
    if (character === "}") {
      depth--;
      if (depth === 0) return cursor;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

export function extractJointBlockRecordsFromLayerText(layerText: string): JointBlockRecord[] {
  if (!layerText) return [];
  const records: JointBlockRecord[] = [];
  const headerRegex = /def\s+(Physics[A-Za-z]*Joint)\s+"([^"]+)"/g;
  let match: RegExpExecArray | null = null;

  while ((match = headerRegex.exec(layerText))) {
    const jointTypeName = String(match?.[1] || "").trim();
    const jointName = String(match?.[2] || "").trim();
    if (!jointName) continue;

    const openingBraceIndex = layerText.indexOf("{", headerRegex.lastIndex);
    if (openingBraceIndex < 0) break;

    const closingBraceIndex = findMatchingClosingBraceIndex(layerText, openingBraceIndex);
    if (closingBraceIndex < 0) continue;

    records.push({
      jointTypeName,
      jointName,
      body: layerText.slice(openingBraceIndex + 1, closingBraceIndex),
    });

    headerRegex.lastIndex = closingBraceIndex + 1;
  }

  return records;
}

export function extractUsdPathAttributeFromJointBlock(body: string, attributeName: "body0" | "body1"): string | null {
  if (!body) return null;
  const pattern = new RegExp(`physics:${attributeName}\\s*=\\s*([^\\n\\r]+)`, "i");
  const literal = String(body.match(pattern)?.[1] || "").trim();
  if (!literal) return null;
  return normalizeUsdPathToken(literal);
}

export function extractJointRecordsFromLayerText(layerText: string): ParsedJointRecord[] {
  if (!layerText) return [];
  const records: ParsedJointRecord[] = [];
  const jointBlocks = extractJointBlockRecordsFromLayerText(layerText);

  for (const jointBlock of jointBlocks) {
    const body = jointBlock.body;
    const body0Path = extractUsdPathAttributeFromJointBlock(body, "body0");
    const body1Path = extractUsdPathAttributeFromJointBlock(body, "body1");
    const axisToken = normalizeAxisToken(body.match(/physics:axis\s*=\s*"?([A-Za-z]+)"?/i)?.[1] || "X");
    const lowerLimitDeg = toFiniteNumber(body.match(/physics:lowerLimit\s*=\s*([-+0-9.eE]+)/i)?.[1]);
    const upperLimitDeg = toFiniteNumber(body.match(/physics:upperLimit\s*=\s*([-+0-9.eE]+)/i)?.[1]);
    const localPos1 = parseVector3FromTupleLiteral(String(body.match(/physics:localPos1\s*=\s*\(([^)]+)\)/i)?.[1] || ""));
    const localRot1 = parseQuaternionFromTupleLiteral(String(body.match(/physics:localRot1\s*=\s*\(([^)]+)\)/i)?.[1] || ""));

    records.push({
      jointTypeName: jointBlock.jointTypeName,
      jointName: jointBlock.jointName,
      body0Path,
      body1Path,
      axisToken,
      lowerLimitDeg,
      upperLimitDeg,
      localPos1,
      localRot1,
    });
  }

  return records;
}

export function extractDefaultPrimPathFromLayerText(layerText: string): string | null {
  if (!layerText) return null;
  const match = layerText.match(/defaultPrim\s*=\s*"([^"]+)"/);
  const primName = String(match?.[1] || "").trim();
  if (!primName) return null;
  return primName.startsWith("/") ? primName : `/${primName}`;
}

export function extractPhysicsPayloadAssetPathsFromLayerText(layerText: string): string[] {
  if (!layerText) return [];
  const paths = new Set<string>();
  const payloadRegex = /payload\s*=\s*@([^@]*physics[^@]*\.usd)@/gi;
  let match: RegExpExecArray | null = null;
  while ((match = payloadRegex.exec(layerText))) {
    const rawPath = String(match[1] || "").trim();
    if (rawPath) paths.add(rawPath);
  }
  return Array.from(paths);
}

export function resolveUsdAssetPath(baseUsdPath: string | null, assetPath: string): string | null {
  const normalizedAssetPath = String(assetPath || "").trim();
  if (!normalizedAssetPath) return null;
  if (/^[a-z]+:\/\//i.test(normalizedAssetPath)) return normalizedAssetPath;
  if (normalizedAssetPath.startsWith("/")) return normalizedAssetPath;
  if (!baseUsdPath) return null;

  const baseWithoutQuery = baseUsdPath.split("?")[0];
  const baseSegments = baseWithoutQuery.split("/");
  if (baseSegments.length > 0) baseSegments.pop();

  for (const segment of normalizedAssetPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (baseSegments.length > 1) baseSegments.pop();
      continue;
    }
    baseSegments.push(segment);
  }

  const resolved = baseSegments.join("/");
  return resolved.startsWith("/") ? resolved : `/${resolved}`;
}

export function getRootPathsFromRenderInterface(renderInterface: RenderInterfaceLike): string[] {
  if (!renderInterface?.meshes) return [];
  const rootPaths = new Set<string>();
  for (const meshId of Object.keys(renderInterface.meshes)) {
    const linkPath = getLinkPathFromMeshId(meshId);
    if (!linkPath) continue;
    const rootPath = getRootPathFromLinkPath(linkPath);
    if (rootPath) rootPaths.add(rootPath);
  }
  return Array.from(rootPaths);
}

export function cloneJointCatalogEntry(entry: JointCatalogEntry): JointCatalogEntry {
  return {
    ...entry,
    axisLocal: entry.axisLocal.clone(),
    localPivotInLink: entry.localPivotInLink ? entry.localPivotInLink.clone() : null,
  };
}
