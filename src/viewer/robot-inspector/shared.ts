import type { JointInfoSnapshot } from "../link-rotation.js";
import type { LinkDynamicsSnapshot } from "../link-dynamics.js";
import type { RenderRobotMetadataSnapshot } from "../robot-metadata.js";

export type PrimLike = {
  GetTypeName?: () => string;
  GetAttribute?: (name: string) => { Get?: () => any } | null;
};

export type StageLike = {
  GetRootLayer?: () => { identifier?: string; ExportToString?: () => any } | null;
  GetPrimAtPath?: (path: string) => PrimLike | null;
} | null | undefined;

export type RenderInterfaceLike = {
  meshes?: Record<string, any>;
  materials?: Record<string, any>;
  getStageSourcePath?: () => string | null;
} | null | undefined;

export type MutableLinkMetadata = {
  linkPath: string;
  visualMeshCount: number;
  collisionMeshCount: number;
  collisionPrimitiveCounts: Record<string, number>;
  materialTags: Set<string>;
  mass: number | null;
  centerOfMassLocal: [number, number, number] | null;
  diagonalInertia: [number, number, number] | null;
  principalAxesLocal: [number, number, number, number] | null;
};

export type ParsedJointRecord = {
  jointName: string;
  jointTypeName: string;
  body0Path: string | null;
  body1Path: string | null;
  axisToken: "X" | "Y" | "Z";
  lowerLimitDeg: number | null;
  upperLimitDeg: number | null;
};

export type JointBlockRecord = {
  jointTypeName: string;
  jointName: string;
  body: string;
};

export type RobotLinkMetadata = {
  linkPath: string;
  visualMeshCount: number;
  collisionMeshCount: number;
  collisionPrimitiveCounts: Record<string, number>;
  materialTags: string[];
  mass: number | null;
  centerOfMassLocal: [number, number, number] | null;
  diagonalInertia: [number, number, number] | null;
  principalAxesLocal: [number, number, number, number] | null;
};

export type RobotJointMetadata = {
  jointName: string;
  jointPath: string | null;
  jointType: string;
  body0Path: string | null;
  body1Path: string | null;
  axisToken: "X" | "Y" | "Z";
  lowerLimitDeg: number | null;
  upperLimitDeg: number | null;
  controllable: boolean;
};

export type RobotMetadataTotals = {
  linkCount: number;
  jointCount: number;
  controllableJointCount: number;
  visualMeshCount: number;
  collisionMeshCount: number;
  materialCount: number;
  totalMass: number | null;
  linksWithMass: number;
  linksWithInertia: number;
  linksWithCenterOfMass: number;
  collisionPrimitiveCounts: Record<string, number>;
};

export type RobotMetadataSnapshot = {
  robotName: string;
  stageSourcePath: string | null;
  totals: RobotMetadataTotals;
  links: RobotLinkMetadata[];
  joints: RobotJointMetadata[];
};

export interface BuildRobotMetadataSnapshotArgs {
  renderInterface: RenderInterfaceLike;
  stage: StageLike;
  stageSourcePath?: string | null;
  jointInfos: JointInfoSnapshot[];
  linkDynamics: LinkDynamicsSnapshot[];
  precomputedRobotMetadata?: RenderRobotMetadataSnapshot | null;
}

export interface RobotInspectorControllerOptions {
  panel: HTMLElement | null;
  header: HTMLElement | null;
  list: HTMLElement | null;
  requestSnapshot: () => Promise<RobotMetadataSnapshot | null>;
}

export const robotMetadataCacheByStagePath = new Map<string, RobotMetadataSnapshot>();
export const maxRobotMetadataCacheEntries = 8;

export function toFiniteNumber(value: any): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

export function normalizeUsdPathToken(value: string): string | null {
  const trimmed = String(value || "").trim().replace(/[<>]/g, "");
  if (!trimmed) return null;

  const bracketMatches = Array.from(String(value || "").matchAll(/<([^>]+)>/g));
  for (const match of bracketMatches) {
    const candidate = String(match?.[1] || "").trim();
    if (candidate.startsWith("/")) return candidate;
  }

  if (trimmed.startsWith("/")) return trimmed;
  return null;
}

export function normalizeAxisToken(value: any): "X" | "Y" | "Z" {
  const token = String(value || "").trim().toUpperCase();
  if (token.startsWith("Y")) return "Y";
  if (token.startsWith("Z")) return "Z";
  return "X";
}

export function getRootPathFromPrimPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/")) return null;
  const firstSegment = path.split("/").filter(Boolean)[0] || "";
  return firstSegment ? `/${firstSegment}` : null;
}

export function getBasename(path: string | null | undefined): string {
  const normalized = String(path || "");
  const noQuery = normalized.split("?")[0];
  const segment = noQuery.split("/").filter(Boolean).pop() || "";
  return segment;
}

export function getUsdPathWithoutExtension(path: string | null | undefined): string {
  const basename = getBasename(path);
  return basename.replace(/\.usd[a-z]?$/i, "");
}

export function deriveRobotName(stageSourcePath: string | null, linkPaths: string[]): string {
  const fromPath = getUsdPathWithoutExtension(stageSourcePath);
  if (fromPath) return fromPath;
  const rootNames = new Set<string>();
  for (const linkPath of linkPaths) {
    const root = getRootPathFromPrimPath(linkPath);
    if (!root) continue;
    rootNames.add(root.replace(/^\//, ""));
  }
  if (rootNames.size > 0) return Array.from(rootNames)[0];
  return "Robot";
}

export function normalizeDisplayMaterialTag(tag: string): string {
  const trimmed = String(tag || "").trim();
  if (!trimmed) return "";
  const slash = trimmed.lastIndexOf("/");
  if (slash >= 0) return trimmed.substring(slash + 1);
  return trimmed;
}

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

export function isCollisionMeshId(meshId: string): boolean {
  const lowered = String(meshId || "").toLowerCase();
  return lowered.includes("/collisions.") || lowered.includes("/collisions/") || lowered.includes("/collision.") || lowered.includes("/collision/");
}

export function parseCollisionPrimitiveTypeFromMeshId(meshId: string): string | null {
  const match = String(meshId || "").toLowerCase().match(/\.proto_([a-z]+)_id\d+/);
  const primitive = String(match?.[1] || "").trim();
  if (!primitive) return null;
  if (primitive === "mesh") return "mesh";
  if (primitive === "box" || primitive === "cube") return "box";
  if (primitive === "sphere") return "sphere";
  if (primitive === "capsule") return "capsule";
  if (primitive === "cylinder") return "cylinder";
  return primitive;
}

export function collectMaterialTagsFromHydraMesh(hydraMesh: any): string[] {
  const tags = new Set<string>();
  const pendingMaterialId = String(hydraMesh?._pendingMaterialId || "").trim();
  if (pendingMaterialId) tags.add(pendingMaterialId);

  const meshMaterial = hydraMesh?._mesh?.material;
  const materials = Array.isArray(meshMaterial) ? meshMaterial : [meshMaterial];
  for (const material of materials) {
    if (!material) continue;
    const materialName = String(material.name || "").trim();
    if (materialName) {
      tags.add(materialName);
      continue;
    }
    const materialId = String(material.uuid || "").trim();
    if (materialId) tags.add(`uuid:${materialId}`);
  }

  const sourceMaterials = Array.isArray(hydraMesh?._materials) ? hydraMesh._materials : [];
  for (const material of sourceMaterials) {
    if (!material) continue;
    const materialName = String(material.name || "").trim();
    if (materialName) {
      tags.add(materialName);
      continue;
    }
    const materialId = String(material.uuid || "").trim();
    if (materialId) tags.add(`uuid:${materialId}`);
  }

  return Array.from(tags);
}

export function ensureMutableLinkMetadata(target: Map<string, MutableLinkMetadata>, linkPath: string): MutableLinkMetadata {
  const normalizedPath = normalizeUsdPathToken(linkPath) || String(linkPath || "").trim();
  const existing = target.get(normalizedPath);
  if (existing) return existing;

  const created: MutableLinkMetadata = {
    linkPath: normalizedPath,
    visualMeshCount: 0,
    collisionMeshCount: 0,
    collisionPrimitiveCounts: {},
    materialTags: new Set<string>(),
    mass: null,
    centerOfMassLocal: null,
    diagonalInertia: null,
    principalAxesLocal: null,
  };
  target.set(normalizedPath, created);
  return created;
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

export function extractUsdAssetReferencesFromLayerText(layerText: string): string[] {
  if (!layerText) return [];
  const references = new Set<string>();
  const referenceRegex = /@([^@]+\.usd(?:a|c|z)?)@/gi;
  let match: RegExpExecArray | null = null;
  while ((match = referenceRegex.exec(layerText))) {
    const rawPath = String(match[1] || "").trim();
    if (!rawPath) continue;
    references.add(rawPath);
  }

  const ordered = Array.from(references);
  const scorePath = (path: string): number => {
    const lowered = path.toLowerCase();
    if (lowered.includes("physics")) return 3;
    if (lowered.includes("base")) return 2;
    if (lowered.includes("sensor")) return 0;
    return 1;
  };
  ordered.sort((left, right) => {
    const scoreDifference = scorePath(right) - scorePath(left);
    if (scoreDifference !== 0) return scoreDifference;
    return left.localeCompare(right);
  });
  return ordered;
}

export function isLikelyPhysicsReferencePath(path: string): boolean {
  const lowered = String(path || "").toLowerCase();
  return lowered.includes("physics") || lowered.includes("joint") || lowered.includes("dynamics");
}

async function shouldOpenReferencedStageForRobotMetadata(stagePath: string): Promise<boolean> {
  const normalizedPath = String(stagePath || "").trim();
  if (!normalizedPath) return false;
  const loweredPath = normalizedPath.toLowerCase();
  if (isLikelyPhysicsReferencePath(loweredPath)) return true;
  if (/_robot\.usd[a-z]?$/i.test(loweredPath)) return true;
  if (!normalizedPath.startsWith("/")) return false;
  if (/_base\.usd[a-z]?$/i.test(loweredPath)) return false;
  if (/_sensor\.usd[a-z]?$/i.test(loweredPath)) return false;
  return false;
}

export function safeExportRootLayerText(stage: StageLike): string {
  if (!stage?.GetRootLayer) return "";
  try {
    const rootLayer = stage.GetRootLayer();
    if (!rootLayer?.ExportToString) return "";
    const exported = rootLayer.ExportToString();
    return typeof exported === "string" ? exported : String(exported || "");
  } catch {
    return "";
  }
}

async function safeOpenUsdStage(usdModule: any, stagePath: string): Promise<StageLike> {
  if (!usdModule?.UsdStage?.Open || !stagePath) return null;
  try {
    const openedStage = usdModule.UsdStage.Open(stagePath);
    if (openedStage && typeof openedStage.then === "function") {
      const resolvedStage = await openedStage;
      return resolvedStage || null;
    }
    return openedStage || null;
  } catch {
    return null;
  }
}

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

    records.push({
      jointName: jointBlock.jointName,
      jointTypeName: jointBlock.jointTypeName,
      body0Path,
      body1Path,
      axisToken,
      lowerLimitDeg,
      upperLimitDeg,
    });
  }

  return records;
}

export function remapPathRootIfNeeded(path: string | null, availableRootPaths: Set<string>): string | null {
  if (!path) return null;
  const sourceRoot = getRootPathFromPrimPath(path);
  if (!sourceRoot) return path;
  if (availableRootPaths.has(sourceRoot)) return path;
  if (availableRootPaths.size !== 1) return path;
  const targetRoot = Array.from(availableRootPaths)[0];
  if (!targetRoot) return path;
  if (path === sourceRoot) return targetRoot;
  if (!path.startsWith(`${sourceRoot}/`)) return path;
  return `${targetRoot}${path.slice(sourceRoot.length)}`;
}

async function collectLayerTextsForRobotMetadata(
  rootStage: StageLike,
  rootStagePath: string | null,
): Promise<Array<{ stagePath: string | null; layerText: string }>> {
  const output: Array<{ stagePath: string | null; layerText: string }> = [];
  const rootText = safeExportRootLayerText(rootStage);
  if (!rootText) return output;

  output.push({ stagePath: rootStagePath, layerText: rootText });
  const usdModule = (window as any).USD;
  if (!usdModule?.UsdStage?.Open) return output;

  const visited = new Set<string>();
  const maxOpenedStages = 16;
  const queue: Array<{ stagePath: string | null; layerText: string; depth: number }> = [];
  queue.push({ stagePath: rootStagePath, layerText: rootText, depth: 0 });
  if (rootStagePath) visited.add(rootStagePath);

  while (queue.length > 0 && visited.size <= maxOpenedStages) {
    const current = queue.shift()!;
    if (current.depth >= 2) continue;

    const references = extractUsdAssetReferencesFromLayerText(current.layerText);
    for (const assetPath of references) {
      const resolvedPath = resolveUsdAssetPath(current.stagePath, assetPath);
      if (!resolvedPath) continue;
      if (visited.has(resolvedPath)) continue;
      visited.add(resolvedPath);
      if (!(await shouldOpenReferencedStageForRobotMetadata(resolvedPath))) continue;

      const openedStage = await safeOpenUsdStage(usdModule, resolvedPath);
      if (!openedStage) continue;
      const layerText = safeExportRootLayerText(openedStage);
      if (!layerText) continue;

      output.push({ stagePath: resolvedPath, layerText });
      if (current.depth + 1 < 2 && visited.size < maxOpenedStages) {
        queue.push({ stagePath: resolvedPath, layerText, depth: current.depth + 1 });
      }
    }
  }

  return output;
}

export async function buildRobotMetadataSnapshot(args: BuildRobotMetadataSnapshotArgs): Promise<RobotMetadataSnapshot | null> {
  const {
    renderInterface,
    stage,
    stageSourcePath: stageSourcePathInput,
    jointInfos,
    linkDynamics,
    precomputedRobotMetadata,
  } = args;

  if (!renderInterface?.meshes) return null;

  const stageSourcePath = String(
    stageSourcePathInput
    || renderInterface.getStageSourcePath?.()
    || stage?.GetRootLayer?.()?.identifier
    || ""
  ).trim() || null;
  const cacheKey = stageSourcePath ? stageSourcePath.split("?")[0] : null;
  if (cacheKey) {
    const cached = robotMetadataCacheByStagePath.get(cacheKey);
    if (cached) {
      robotMetadataCacheByStagePath.delete(cacheKey);
      robotMetadataCacheByStagePath.set(cacheKey, cached);
      return cached;
    }
  }

  const linkMetadataByPath = new Map<string, MutableLinkMetadata>();
  const globalMaterialTags = new Set<string>();
  const totalCollisionPrimitiveCounts: Record<string, number> = {};

  let visualMeshCount = 0;
  let collisionMeshCount = 0;

  for (const [meshId, hydraMesh] of Object.entries(renderInterface.meshes || {})) {
    const linkPath = getLinkPathFromMeshId(meshId);
    if (!linkPath) continue;

    const linkRecord = ensureMutableLinkMetadata(linkMetadataByPath, linkPath);
    const collisionMesh = isCollisionMeshId(meshId);

    if (collisionMesh) {
      linkRecord.collisionMeshCount++;
      collisionMeshCount++;
      const primitiveType = parseCollisionPrimitiveTypeFromMeshId(meshId);
      if (primitiveType) {
        linkRecord.collisionPrimitiveCounts[primitiveType] = (linkRecord.collisionPrimitiveCounts[primitiveType] || 0) + 1;
        totalCollisionPrimitiveCounts[primitiveType] = (totalCollisionPrimitiveCounts[primitiveType] || 0) + 1;
      }
    } else {
      linkRecord.visualMeshCount++;
      visualMeshCount++;
    }

    const materialTags = collectMaterialTagsFromHydraMesh(hydraMesh);
    for (const materialTag of materialTags) {
      if (!materialTag) continue;
      const normalizedTag = normalizeDisplayMaterialTag(materialTag);
      if (!normalizedTag) continue;
      linkRecord.materialTags.add(normalizedTag);
      globalMaterialTags.add(normalizedTag);
    }
  }

  for (const [materialId] of Object.entries(renderInterface.materials || {})) {
    const normalizedTag = normalizeDisplayMaterialTag(materialId);
    if (normalizedTag) globalMaterialTags.add(normalizedTag);
  }

  const dynamicsRecords = (Array.isArray(linkDynamics) && linkDynamics.length > 0)
    ? linkDynamics
    : (Array.isArray(precomputedRobotMetadata?.linkDynamicsEntries)
      ? precomputedRobotMetadata.linkDynamicsEntries.map((entry) => ({
        linkPath: entry.linkPath,
        mass: entry.mass,
        centerOfMassLocal: entry.centerOfMassLocal,
        diagonalInertia: entry.diagonalInertia,
        principalAxesLocal: entry.principalAxesLocal,
      }))
      : []);

  for (const dynamicsRecord of dynamicsRecords) {
    if (!dynamicsRecord?.linkPath) continue;
    const linkRecord = ensureMutableLinkMetadata(linkMetadataByPath, dynamicsRecord.linkPath);
    linkRecord.mass = toFiniteNumber(dynamicsRecord.mass);
    linkRecord.centerOfMassLocal = dynamicsRecord.centerOfMassLocal
      ? [dynamicsRecord.centerOfMassLocal[0], dynamicsRecord.centerOfMassLocal[1], dynamicsRecord.centerOfMassLocal[2]]
      : null;
    linkRecord.diagonalInertia = dynamicsRecord.diagonalInertia
      ? [dynamicsRecord.diagonalInertia[0], dynamicsRecord.diagonalInertia[1], dynamicsRecord.diagonalInertia[2]]
      : null;
    linkRecord.principalAxesLocal = dynamicsRecord.principalAxesLocal
      ? [
        dynamicsRecord.principalAxesLocal[0],
        dynamicsRecord.principalAxesLocal[1],
        dynamicsRecord.principalAxesLocal[2],
        dynamicsRecord.principalAxesLocal[3],
      ]
      : null;
  }

  const availableRootPaths = new Set<string>();
  for (const linkPath of linkMetadataByPath.keys()) {
    const rootPath = getRootPathFromPrimPath(linkPath);
    if (rootPath) availableRootPaths.add(rootPath);
  }

  const jointRecordByKey = new Map<string, RobotJointMetadata>();
  const precomputedJointCatalogEntries = Array.isArray(precomputedRobotMetadata?.jointCatalogEntries)
    ? precomputedRobotMetadata.jointCatalogEntries
    : [];
  if (precomputedJointCatalogEntries.length > 0) {
    for (const entry of precomputedJointCatalogEntries) {
      if (!entry?.linkPath) continue;
      const body0Path = remapPathRootIfNeeded(entry.parentLinkPath, availableRootPaths);
      const body1Path = remapPathRootIfNeeded(entry.linkPath, availableRootPaths);
      if (body0Path) ensureMutableLinkMetadata(linkMetadataByPath, body0Path);
      if (body1Path) ensureMutableLinkMetadata(linkMetadataByPath, body1Path);
      const jointName = String(entry.jointName || getBasename(entry.jointPath) || `${getBasename(body1Path)}_joint`).trim();
      const key = `${jointName}|${body0Path || ""}|${body1Path || ""}|${entry.axisToken}`;
      if (jointRecordByKey.has(key)) continue;
      jointRecordByKey.set(key, {
        jointName,
        jointPath: entry.jointPath || null,
        jointType: String(entry.jointType || "PhysicsJoint"),
        body0Path,
        body1Path,
        axisToken: entry.axisToken,
        lowerLimitDeg: toFiniteNumber(entry.lowerLimitDeg),
        upperLimitDeg: toFiniteNumber(entry.upperLimitDeg),
        controllable: false,
      });
    }
  } else {
    const layerTexts = await collectLayerTextsForRobotMetadata(stage, stageSourcePath);
    for (const layerEntry of layerTexts) {
      const parsedJointRecords = extractJointRecordsFromLayerText(layerEntry.layerText);
      for (const parsed of parsedJointRecords) {
        const body0Path = remapPathRootIfNeeded(parsed.body0Path, availableRootPaths);
        const body1Path = remapPathRootIfNeeded(parsed.body1Path, availableRootPaths);
        if (body0Path) ensureMutableLinkMetadata(linkMetadataByPath, body0Path);
        if (body1Path) ensureMutableLinkMetadata(linkMetadataByPath, body1Path);

        const key = `${parsed.jointName}|${body0Path || ""}|${body1Path || ""}|${parsed.axisToken}`;
        if (jointRecordByKey.has(key)) continue;

        jointRecordByKey.set(key, {
          jointName: parsed.jointName,
          jointPath: null,
          jointType: parsed.jointTypeName || "PhysicsJoint",
          body0Path,
          body1Path,
          axisToken: parsed.axisToken,
          lowerLimitDeg: parsed.lowerLimitDeg,
          upperLimitDeg: parsed.upperLimitDeg,
          controllable: false,
        });
      }
    }
  }

  const jointInfoByLinkPath = new Map<string, JointInfoSnapshot>();
  for (const jointInfo of jointInfos || []) {
    if (!jointInfo?.linkPath) continue;
    jointInfoByLinkPath.set(jointInfo.linkPath, jointInfo);
  }

  for (const jointInfo of jointInfoByLinkPath.values()) {
    const matchingEntry = Array.from(jointRecordByKey.values()).find((jointRecord) => {
      if (jointRecord.jointPath && jointRecord.jointPath === jointInfo.jointPath) return true;
      if (jointRecord.body1Path && jointRecord.body1Path === jointInfo.linkPath) return true;
      return false;
    });

    if (matchingEntry) {
      matchingEntry.jointPath = jointInfo.jointPath || matchingEntry.jointPath;
      matchingEntry.axisToken = jointInfo.axisToken || matchingEntry.axisToken;
      matchingEntry.lowerLimitDeg = jointInfo.lowerLimitDeg;
      matchingEntry.upperLimitDeg = jointInfo.upperLimitDeg;
      matchingEntry.controllable = true;
      continue;
    }

    const fallbackJointName = getBasename(jointInfo.jointPath) || `${getBasename(jointInfo.linkPath)}_joint`;
    const key = `${fallbackJointName}|${jointInfo.linkPath}|${jointInfo.axisToken}`;
    if (jointRecordByKey.has(key)) continue;

    jointRecordByKey.set(key, {
      jointName: fallbackJointName,
      jointPath: jointInfo.jointPath,
      jointType: "PhysicsRevoluteJoint",
      body0Path: null,
      body1Path: jointInfo.linkPath,
      axisToken: jointInfo.axisToken,
      lowerLimitDeg: jointInfo.lowerLimitDeg,
      upperLimitDeg: jointInfo.upperLimitDeg,
      controllable: true,
    });
  }

  const linkRecords: RobotLinkMetadata[] = [];
  let totalMass = 0;
  let linksWithMass = 0;
  let linksWithInertia = 0;
  let linksWithCenterOfMass = 0;

  for (const linkRecord of linkMetadataByPath.values()) {
    const hasMass = linkRecord.mass !== null;
    const hasInertia = !!(
      linkRecord.diagonalInertia
      && linkRecord.diagonalInertia.some((component) => Math.abs(component) > 1e-9)
    );
    const hasCenterOfMass = !!(
      linkRecord.centerOfMassLocal
      && linkRecord.centerOfMassLocal.some((component) => Math.abs(component) > 1e-9)
    );

    if (hasMass) {
      linksWithMass++;
      totalMass += Number(linkRecord.mass || 0);
    }
    if (hasInertia) linksWithInertia++;
    if (hasCenterOfMass) linksWithCenterOfMass++;

    linkRecords.push({
      linkPath: linkRecord.linkPath,
      visualMeshCount: linkRecord.visualMeshCount,
      collisionMeshCount: linkRecord.collisionMeshCount,
      collisionPrimitiveCounts: { ...linkRecord.collisionPrimitiveCounts },
      materialTags: Array.from(linkRecord.materialTags).sort((left, right) => left.localeCompare(right)),
      mass: linkRecord.mass,
      centerOfMassLocal: linkRecord.centerOfMassLocal,
      diagonalInertia: linkRecord.diagonalInertia,
      principalAxesLocal: linkRecord.principalAxesLocal,
    });
  }

  linkRecords.sort((left, right) => left.linkPath.localeCompare(right.linkPath));

  const jointRecords = Array.from(jointRecordByKey.values());
  jointRecords.sort((left, right) => {
    const leftBody = left.body1Path || left.jointPath || left.jointName;
    const rightBody = right.body1Path || right.jointPath || right.jointName;
    return leftBody.localeCompare(rightBody);
  });

  const controllableJointCount = jointRecords.filter((record) => record.controllable).length;

  const snapshot: RobotMetadataSnapshot = {
    robotName: deriveRobotName(stageSourcePath, linkRecords.map((record) => record.linkPath)),
    stageSourcePath,
    totals: {
      linkCount: linkRecords.length,
      jointCount: jointRecords.length,
      controllableJointCount,
      visualMeshCount,
      collisionMeshCount,
      materialCount: globalMaterialTags.size,
      totalMass: linksWithMass > 0 ? totalMass : null,
      linksWithMass,
      linksWithInertia,
      linksWithCenterOfMass,
      collisionPrimitiveCounts: { ...totalCollisionPrimitiveCounts },
    },
    links: linkRecords,
    joints: jointRecords,
  };

  if (cacheKey) {
    robotMetadataCacheByStagePath.delete(cacheKey);
    robotMetadataCacheByStagePath.set(cacheKey, snapshot);
    while (robotMetadataCacheByStagePath.size > maxRobotMetadataCacheEntries) {
      const oldestKey = robotMetadataCacheByStagePath.keys().next().value;
      if (!oldestKey) break;
      robotMetadataCacheByStagePath.delete(oldestKey);
    }
  }

  return snapshot;
}

export function formatMass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(3)} kg`;
}

export function formatVector3(value: [number, number, number] | null): string {
  if (!value) return "-";
  return `${value[0].toFixed(3)}, ${value[1].toFixed(3)}, ${value[2].toFixed(3)}`;
}

export function formatJointLimits(lower: number | null, upper: number | null): string {
  if (lower === null || upper === null) return "-";
  return `${lower.toFixed(1)}° ~ ${upper.toFixed(1)}°`;
}

export function formatCollisionPrimitiveCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (entries.length === 0) return "-";
  return entries.map(([shape, count]) => `${shape}:${count}`).join(", ");
}

export function createDomElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  textContent: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = textContent;
  return element;
}
