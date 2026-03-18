import { MathUtils, Quaternion, Vector3 } from "three";
export const jointCatalogCacheByStagePath = new Map();
export const maxJointCatalogCacheEntries = 8;
export function getLinkPathFromMeshId(meshId) {
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
export function getRootPathFromLinkPath(linkPath) {
    if (!linkPath.startsWith("/"))
        return null;
    const segments = linkPath.split("/").filter(Boolean);
    if (segments.length === 0)
        return null;
    return `/${segments[0]}`;
}
export function getPathBasename(path) {
    const normalized = String(path || "").trim();
    if (!normalized)
        return "";
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] || "";
}
export function toTokenString(value) {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value) && value.length > 0) {
        if (value.every((entry) => typeof entry === "string")) {
            const joined = value.join("");
            if (joined.length > 0)
                return joined;
        }
        return String(value[0]);
    }
    if (value && typeof value.length === "number" && typeof value !== "string") {
        try {
            const arrayValue = Array.from(value);
            if (arrayValue.every((entry) => typeof entry === "string")) {
                return arrayValue.join("");
            }
            if (arrayValue.length > 0)
                return String(arrayValue[0]);
        }
        catch { }
    }
    return String(value ?? "");
}
export function toFiniteNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string" && value.trim() === "")
        return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return null;
    return numeric;
}
export function toVector3FromValue(value) {
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
export function normalizeAxisToken(value) {
    const token = toTokenString(value).trim().toUpperCase();
    if (token.startsWith("X"))
        return "X";
    if (token.startsWith("Y"))
        return "Y";
    if (token.startsWith("Z"))
        return "Z";
    return "X";
}
export function axisTokenToVector(axisToken) {
    if (axisToken === "Y")
        return new Vector3(0, 1, 0);
    if (axisToken === "Z")
        return new Vector3(0, 0, 1);
    return new Vector3(1, 0, 0);
}
export function normalizeLimits(lowerLimitDeg, upperLimitDeg) {
    let lower = lowerLimitDeg ?? -180;
    let upper = upperLimitDeg ?? 180;
    if (!Number.isFinite(lower))
        lower = -180;
    if (!Number.isFinite(upper))
        upper = 180;
    if (lower > upper) {
        const midpoint = (lower + upper) * 0.5;
        lower = midpoint;
        upper = midpoint;
    }
    return { lower, upper };
}
export function roundAngleDegrees(value) {
    return Math.round(value * 100) / 100;
}
export function clampJointAnglePreservingNeutralZero(angleDeg, lowerLimitDeg, upperLimitDeg) {
    const numericAngle = Number(angleDeg);
    if (!Number.isFinite(numericAngle))
        return 0;
    if (Math.abs(numericAngle) <= 1e-8)
        return 0;
    return MathUtils.clamp(numericAngle, lowerLimitDeg, upperLimitDeg);
}
export function getInteractiveJointLimits(lowerLimitDeg, upperLimitDeg) {
    const lower = Number.isFinite(lowerLimitDeg) ? lowerLimitDeg : -180;
    const upper = Number.isFinite(upperLimitDeg) ? upperLimitDeg : 180;
    return {
        lower: Math.min(lower, 0),
        upper: Math.max(upper, 0),
    };
}
export function hasFiniteLimitValue(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
}
export function getJointPathCandidatesForLinkPath(linkPath) {
    const rootPath = getRootPathFromLinkPath(linkPath);
    if (!rootPath)
        return [];
    const linkName = linkPath.split("/").pop() || "";
    if (!linkName)
        return [];
    const baseName = linkName.endsWith("_link") ? linkName.substring(0, linkName.length - "_link".length) : linkName;
    const candidates = new Set();
    candidates.add(`${rootPath}/joints/${baseName}_joint`);
    candidates.add(`${rootPath}/joints/${linkName}_joint`);
    candidates.add(`${rootPath}/joints/${linkName}`);
    candidates.add(`${rootPath}/${baseName}_joint`);
    candidates.add(`${rootPath}/${linkName}_joint`);
    candidates.add(`${rootPath}/${linkName}`);
    return Array.from(candidates);
}
export function safeGetPrimAtPath(stage, path) {
    if (!stage?.GetPrimAtPath || !path)
        return null;
    try {
        return stage.GetPrimAtPath(path);
    }
    catch {
        return null;
    }
}
export function safeGetPrimAttribute(prim, name) {
    if (!prim?.GetAttribute || !name)
        return undefined;
    try {
        return prim.GetAttribute(name)?.Get?.();
    }
    catch {
        return undefined;
    }
}
export function safeGetPrimTypeName(prim) {
    try {
        return String(prim?.GetTypeName?.() || "");
    }
    catch {
        return "";
    }
}
export function isControllableRevoluteJointTypeName(typeName) {
    const normalized = String(typeName || "").trim().toLowerCase();
    if (!normalized)
        return false;
    if (normalized === "revolute" || normalized === "continuous")
        return true;
    if (normalized.includes("continuousjoint") || normalized.endsWith("continuousjoint"))
        return true;
    return normalized.includes("revolutejoint") || normalized === "revolutejoint" || normalized.endsWith("revolutejoint");
}
export function isPhysicsJointTypeName(typeName) {
    const normalized = String(typeName || "").trim().toLowerCase();
    if (!normalized)
        return false;
    if (normalized === "joint")
        return true;
    return normalized.includes("joint") && (normalized.includes("physics") || normalized.endsWith("joint"));
}
export function normalizeUsdPathToken(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed)
        return null;
    const bracketMatches = Array.from(trimmed.matchAll(/<([^>]+)>/g));
    if (bracketMatches.length > 0) {
        for (const match of bracketMatches) {
            const candidate = String(match?.[1] || "").trim();
            if (candidate.startsWith("/"))
                return candidate;
        }
    }
    if (trimmed.startsWith("/"))
        return trimmed;
    return null;
}
export function toUsdPathListFromValue(value) {
    const output = new Set();
    const visited = new Set();
    const visit = (source) => {
        if (source === null || source === undefined)
            return;
        if (typeof source === "string") {
            const normalized = normalizeUsdPathToken(source);
            if (normalized)
                output.add(normalized);
            return;
        }
        if (typeof source === "object") {
            if (visited.has(source))
                return;
            visited.add(source);
        }
        if (Array.isArray(source) || (source && typeof source.length === "number" && typeof source !== "string")) {
            try {
                for (const entry of Array.from(source)) {
                    visit(entry);
                }
            }
            catch { }
        }
        if (source && typeof source === "object") {
            const pathCandidates = [
                source.path,
                source.resolvedPath,
                source.assetPath,
                source.targetPath,
                typeof source.GetString === "function" ? source.GetString() : undefined,
            ];
            for (const candidate of pathCandidates) {
                if (!candidate)
                    continue;
                const normalized = normalizeUsdPathToken(String(candidate));
                if (normalized)
                    output.add(normalized);
            }
            try {
                const objectAsString = String(source);
                const normalized = normalizeUsdPathToken(objectAsString);
                if (normalized)
                    output.add(normalized);
            }
            catch { }
        }
    };
    visit(value);
    return Array.from(output);
}
export function normalizeAxisVector(axisVector) {
    if (!axisVector)
        return new Vector3(1, 0, 0);
    const normalized = axisVector.clone();
    if (!Number.isFinite(normalized.lengthSq()) || normalized.lengthSq() <= 1e-12) {
        return new Vector3(1, 0, 0);
    }
    normalized.normalize();
    return normalized;
}
export function axisTokenFromAxisVector(axisVector) {
    const axis = normalizeAxisVector(axisVector);
    const absX = Math.abs(axis.x);
    const absY = Math.abs(axis.y);
    const absZ = Math.abs(axis.z);
    if (absY >= absX && absY >= absZ)
        return "Y";
    if (absZ >= absX && absZ >= absY)
        return "Z";
    return "X";
}
export function buildRuntimeLinkPathIndex(renderInterface) {
    const allLinkPaths = new Set();
    const linkPathsByLinkName = new Map();
    const rootPathSet = new Set();
    if (renderInterface?.meshes) {
        for (const meshId of Object.keys(renderInterface.meshes)) {
            const linkPath = getLinkPathFromMeshId(meshId);
            if (!linkPath || allLinkPaths.has(linkPath))
                continue;
            allLinkPaths.add(linkPath);
            const linkName = getPathBasename(linkPath);
            if (linkName) {
                const entries = linkPathsByLinkName.get(linkName) || [];
                entries.push(linkPath);
                linkPathsByLinkName.set(linkName, entries);
            }
            const rootPath = getRootPathFromLinkPath(linkPath);
            if (rootPath)
                rootPathSet.add(rootPath);
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
export function sortLinkPathsForPreferredRoot(linkPaths, preferredRootPath) {
    const deduped = Array.from(new Set(linkPaths.filter(Boolean)));
    deduped.sort((left, right) => left.localeCompare(right));
    if (!preferredRootPath)
        return deduped;
    return deduped.sort((left, right) => {
        const leftPreferred = getRootPathFromLinkPath(left) === preferredRootPath ? 0 : 1;
        const rightPreferred = getRootPathFromLinkPath(right) === preferredRootPath ? 0 : 1;
        if (leftPreferred !== rightPreferred)
            return leftPreferred - rightPreferred;
        return left.localeCompare(right);
    });
}
export function resolveRuntimeLinkPathsFromLinkName(linkName, runtimeIndex, preferredRootPath = null) {
    const normalizedName = String(linkName || "").trim();
    if (!normalizedName)
        return [];
    const candidates = runtimeIndex.linkPathsByLinkName.get(normalizedName) || [];
    return sortLinkPathsForPreferredRoot(candidates, preferredRootPath);
}
export function resolveRuntimeLinkPathsFromSourcePath(sourcePath, runtimeIndex, preferredRootPath = null) {
    const rawSource = String(sourcePath || "").trim();
    const normalized = normalizeUsdPathToken(rawSource);
    if (!normalized) {
        const fallbackName = getPathBasename(rawSource.replace(/[<>]/g, ""));
        if (!fallbackName)
            return [];
        return resolveRuntimeLinkPathsFromLinkName(fallbackName, runtimeIndex, preferredRootPath);
    }
    const matches = [];
    const addMatch = (candidatePath) => {
        if (!candidatePath)
            return;
        if (!runtimeIndex.allLinkPaths.has(candidatePath))
            return;
        if (matches.includes(candidatePath))
            return;
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
export function pickRuntimeParentLinkPath(parentCandidates, preferredRootPath) {
    if (!Array.isArray(parentCandidates) || parentCandidates.length === 0)
        return null;
    if (preferredRootPath) {
        for (const candidate of parentCandidates) {
            if (getRootPathFromLinkPath(candidate) === preferredRootPath)
                return candidate;
        }
    }
    return parentCandidates[0] || null;
}
export function parseVector3FromTupleLiteral(tupleLiteral) {
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
export function parseQuaternionFromTupleLiteral(tupleLiteral) {
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
export function toQuaternionFromValue(value) {
    if (!value)
        return null;
    if (typeof value === "object" && !Array.isArray(value)) {
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
export function rotateAxisByQuaternion(axisToken, localRotation) {
    const axisVector = axisTokenToVector(axisToken);
    if (!localRotation)
        return axisVector;
    axisVector.applyQuaternion(localRotation).normalize();
    return axisVector;
}
export function findMatchingClosingBraceIndex(source, openingBraceIndex) {
    if (!source || openingBraceIndex < 0 || source[openingBraceIndex] !== "{")
        return -1;
    let depth = 0;
    let insideString = false;
    for (let cursor = openingBraceIndex; cursor < source.length; cursor++) {
        const character = source[cursor];
        const previousCharacter = cursor > 0 ? source[cursor - 1] : "";
        if (character === "\"" && previousCharacter !== "\\") {
            insideString = !insideString;
            continue;
        }
        if (insideString)
            continue;
        if (character === "{") {
            depth++;
            continue;
        }
        if (character === "}") {
            depth--;
            if (depth === 0)
                return cursor;
            if (depth < 0)
                return -1;
        }
    }
    return -1;
}
export function extractJointBlockRecordsFromLayerText(layerText) {
    if (!layerText)
        return [];
    const records = [];
    const headerRegex = /def\s+(Physics[A-Za-z]*Joint)\s+"([^"]+)"/g;
    let match = null;
    while ((match = headerRegex.exec(layerText))) {
        const jointTypeName = String(match?.[1] || "").trim();
        const jointName = String(match?.[2] || "").trim();
        if (!jointName)
            continue;
        const openingBraceIndex = layerText.indexOf("{", headerRegex.lastIndex);
        if (openingBraceIndex < 0)
            break;
        const closingBraceIndex = findMatchingClosingBraceIndex(layerText, openingBraceIndex);
        if (closingBraceIndex < 0)
            continue;
        records.push({
            jointTypeName,
            jointName,
            body: layerText.slice(openingBraceIndex + 1, closingBraceIndex),
        });
        headerRegex.lastIndex = closingBraceIndex + 1;
    }
    return records;
}
export function extractUsdPathAttributeFromJointBlock(body, attributeName) {
    if (!body)
        return null;
    const pattern = new RegExp(`physics:${attributeName}\\s*=\\s*([^\\n\\r]+)`, "i");
    const literal = String(body.match(pattern)?.[1] || "").trim();
    if (!literal)
        return null;
    return normalizeUsdPathToken(literal);
}
export function extractJointRecordsFromLayerText(layerText) {
    if (!layerText)
        return [];
    const records = [];
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
export function extractDefaultPrimPathFromLayerText(layerText) {
    if (!layerText)
        return null;
    const match = layerText.match(/defaultPrim\s*=\s*"([^"]+)"/);
    const primName = String(match?.[1] || "").trim();
    if (!primName)
        return null;
    return primName.startsWith("/") ? primName : `/${primName}`;
}
export function extractPhysicsPayloadAssetPathsFromLayerText(layerText) {
    if (!layerText)
        return [];
    const paths = new Set();
    const payloadRegex = /payload\s*=\s*@([^@]*physics[^@]*\.usd)@/gi;
    let match = null;
    while ((match = payloadRegex.exec(layerText))) {
        const rawPath = String(match[1] || "").trim();
        if (rawPath)
            paths.add(rawPath);
    }
    return Array.from(paths);
}
export function resolveUsdAssetPath(baseUsdPath, assetPath) {
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
export function getRootPathsFromRenderInterface(renderInterface) {
    if (!renderInterface?.meshes)
        return [];
    const rootPaths = new Set();
    for (const meshId of Object.keys(renderInterface.meshes)) {
        const linkPath = getLinkPathFromMeshId(meshId);
        if (!linkPath)
            continue;
        const rootPath = getRootPathFromLinkPath(linkPath);
        if (rootPath)
            rootPaths.add(rootPath);
    }
    return Array.from(rootPaths);
}
export function cloneJointCatalogEntry(entry) {
    return {
        ...entry,
        axisLocal: entry.axisLocal.clone(),
        localPivotInLink: entry.localPivotInLink ? entry.localPivotInLink.clone() : null,
    };
}
