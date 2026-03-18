export function normalizeUsdPathToken(path) {
    if (!path || typeof path !== "string")
        return "";
    const normalized = path.trim().replace(/[<>]/g, "");
    if (!normalized)
        return "";
    if (normalized.startsWith("/"))
        return normalized;
    return `/${normalized}`;
}
export function extractUsdAssetReferencesFromLayerText(layerText, options = {}) {
    if (!layerText || typeof layerText !== "string")
        return [];
    const { baseOnly = false } = options;
    const paths = new Set();
    const assetRegex = /@([^@]+\.usd[a-z]?)@/gi;
    let match = null;
    while ((match = assetRegex.exec(layerText))) {
        const assetPath = String(match[1] || "").trim();
        if (!assetPath)
            continue;
        if (baseOnly && !/base/i.test(assetPath))
            continue;
        paths.add(assetPath);
    }
    return Array.from(paths);
}
export function extractReferencePrimTargets(value) {
    const source = String(value || "");
    if (!source)
        return [];
    const targets = [];
    const addTarget = (candidate) => {
        const normalized = normalizeUsdPathToken(candidate || "");
        if (!normalized || targets.includes(normalized))
            return;
        targets.push(normalized);
    };
    const primTargetRegex = /<([^>]+)>/g;
    let match = null;
    while ((match = primTargetRegex.exec(source))) {
        addTarget(match[1]);
    }
    return targets;
}
export function findMatchingClosingBraceIndex(source, openingBraceIndex) {
    if (!source || openingBraceIndex < 0 || source[openingBraceIndex] !== "{")
        return -1;
    let depth = 0;
    let insideString = false;
    for (let cursor = openingBraceIndex; cursor < source.length; cursor += 1) {
        const character = source[cursor];
        const previousCharacter = cursor > 0 ? source[cursor - 1] : "";
        if (character === '"' && previousCharacter !== "\\") {
            insideString = !insideString;
            continue;
        }
        if (insideString)
            continue;
        if (character === "{") {
            depth += 1;
            continue;
        }
        if (character === "}") {
            depth -= 1;
            if (depth === 0)
                return cursor;
            if (depth < 0)
                return -1;
        }
    }
    return -1;
}
export function extractScopeBodyText(layerText, scopeName) {
    if (!layerText || !scopeName)
        return "";
    const escapedScopeName = String(scopeName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const scopeRegex = new RegExp(`(?:def|over|class)(?:\\s+\\w+)?\\s+"${escapedScopeName}"`, "i");
    const startIndex = layerText.search(scopeRegex);
    if (startIndex < 0)
        return "";
    const openBrace = layerText.indexOf("{", startIndex);
    if (openBrace < 0)
        return "";
    let depth = 0;
    for (let index = openBrace; index < layerText.length; index += 1) {
        const character = layerText[index];
        if (character === "{")
            depth += 1;
        else if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return layerText.slice(startIndex, index + 1);
            }
        }
    }
    return layerText.slice(startIndex);
}
export function parseVisualSemanticChildNamesFromLayerText(layerText) {
    const visualsScopeText = extractScopeBodyText(layerText, "visuals");
    if (!visualsScopeText)
        return new Map();
    const linkToChildNames = new Map();
    const stack = [];
    let pendingContextName = null;
    const addChildName = (linkName, childName) => {
        const normalizedLinkName = String(linkName || "").trim();
        const normalizedChildName = String(childName || "").trim();
        if (!normalizedLinkName || !normalizedChildName)
            return;
        const existingNames = linkToChildNames.get(normalizedLinkName) || [];
        if (existingNames.includes(normalizedChildName))
            return;
        existingNames.push(normalizedChildName);
        linkToChildNames.set(normalizedLinkName, existingNames);
    };
    const lines = visualsScopeText.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        const primMatch = trimmed.match(/^(?:def|over|class)(?:\s+\w+)?\s+"([^"]+)"/);
        if (primMatch) {
            pendingContextName = String(primMatch[1] || "");
        }
        for (const character of line) {
            if (character === "{") {
                const contextName = pendingContextName || "";
                pendingContextName = null;
                stack.push({ name: contextName });
                const hierarchy = stack
                    .map((context) => String(context?.name || "").trim())
                    .filter((name) => !!name);
                if (hierarchy.length < 3)
                    continue;
                if (String(hierarchy[0] || "").toLowerCase() !== "visuals")
                    continue;
                const linkName = hierarchy[1];
                const childName = hierarchy[2];
                addChildName(linkName, childName);
            }
            else if (character === "}") {
                if (stack.length > 0)
                    stack.pop();
            }
        }
    }
    return linkToChildNames;
}
export function parseGuideCollisionReferencesFromLayerText(layerText) {
    const collidersText = extractScopeBodyText(layerText, "colliders");
    if (!collidersText)
        return new Map();
    const linkToGuideEntries = new Map();
    const stack = [];
    let pendingContext = null;
    const addGuideEntry = (linkName, entryName, referencePath) => {
        if (!linkName || !entryName)
            return;
        const existing = linkToGuideEntries.get(linkName) || [];
        if (existing.some((entry) => entry.entryName === entryName && entry.referencePath === referencePath))
            return;
        existing.push({ entryName, referencePath });
        linkToGuideEntries.set(linkName, existing);
    };
    const applyMetadataLine = (context, line) => {
        if (!context || !line)
            return;
        const hasGuidePurpose = /purpose\s*=\s*"guide"/i.test(line);
        if (hasGuidePurpose) {
            context.hasGuidePurpose = true;
        }
        if (line.includes("references")) {
            const targets = extractReferencePrimTargets(line);
            for (const target of targets) {
                if (!context.referencePaths.includes(target)) {
                    context.referencePaths.push(target);
                }
            }
        }
    };
    const getCurrentLinkName = (parentNames, poppedName) => {
        if (!Array.isArray(parentNames) || parentNames.length === 0) {
            return poppedName || null;
        }
        const namedParents = parentNames
            .map((name) => String(name || "").trim())
            .filter((name) => !!name && name !== "colliders");
        if (namedParents.length > 0) {
            return namedParents[namedParents.length - 1];
        }
        return poppedName || null;
    };
    const lines = collidersText.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (pendingContext) {
            applyMetadataLine(pendingContext, trimmed);
        }
        if (stack.length > 0) {
            const currentContext = stack[stack.length - 1];
            applyMetadataLine(currentContext, trimmed);
        }
        const defMatch = trimmed.match(/^(?:def|over|class)\s+Xform\s+"([^"]+)"/);
        if (defMatch) {
            pendingContext = {
                name: String(defMatch[1] || ""),
                hasGuidePurpose: false,
                referencePaths: [],
            };
            applyMetadataLine(pendingContext, trimmed);
        }
        for (const character of line) {
            if (character === "{") {
                if (pendingContext) {
                    stack.push(pendingContext);
                    pendingContext = null;
                }
                else {
                    stack.push({ name: "", hasGuidePurpose: false, referencePaths: [] });
                }
            }
            else if (character === "}") {
                const poppedContext = stack.pop();
                if (!poppedContext || !poppedContext.name || !poppedContext.hasGuidePurpose)
                    continue;
                const parentNames = stack.map((item) => item.name).filter(Boolean);
                const linkName = getCurrentLinkName(parentNames, poppedContext.name);
                if (!linkName || linkName === "colliders")
                    continue;
                if (poppedContext.referencePaths.length === 0) {
                    addGuideEntry(linkName, poppedContext.name, null);
                    continue;
                }
                for (const referencePath of poppedContext.referencePaths) {
                    addGuideEntry(linkName, poppedContext.name, referencePath);
                }
            }
        }
    }
    return linkToGuideEntries;
}
export function parseColliderEntriesFromLayerText(layerText) {
    const collidersText = extractScopeBodyText(layerText, "colliders");
    if (!collidersText)
        return new Map();
    const linkToColliderEntries = new Map();
    const stack = [];
    let pendingContextName = null;
    const allowedGeometryNames = new Set(["mesh", "box", "cube", "sphere", "cylinder", "capsule"]);
    const addColliderEntry = (linkName, entryName) => {
        const normalizedLinkName = String(linkName || "").trim();
        const normalizedEntryName = String(entryName || "").trim();
        if (!normalizedLinkName || !normalizedEntryName)
            return;
        if (normalizedLinkName === "colliders")
            return;
        const existingEntries = linkToColliderEntries.get(normalizedLinkName) || [];
        const duplicate = existingEntries.some((entry) => entry.entryName === normalizedEntryName);
        if (!duplicate) {
            existingEntries.push({ entryName: normalizedEntryName, referencePath: null });
            linkToColliderEntries.set(normalizedLinkName, existingEntries);
        }
    };
    const lines = collidersText.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        const primMatch = trimmed.match(/^(?:def|over|class)(?:\s+\w+)?\s+"([^"]+)"/);
        if (primMatch) {
            pendingContextName = String(primMatch[1] || "");
        }
        for (const character of line) {
            if (character === "{") {
                const contextName = pendingContextName || "";
                pendingContextName = null;
                stack.push({ name: contextName });
                const hierarchy = stack
                    .map((context) => String(context?.name || "").trim())
                    .filter((name) => !!name);
                if (hierarchy.length < 4)
                    continue;
                if (String(hierarchy[0] || "").toLowerCase() !== "colliders")
                    continue;
                const geometryName = String(hierarchy[hierarchy.length - 1] || "").toLowerCase();
                if (!allowedGeometryNames.has(geometryName))
                    continue;
                const entryName = hierarchy[hierarchy.length - 2];
                const linkName = hierarchy[hierarchy.length - 3];
                addColliderEntry(linkName, entryName);
            }
            else if (character === "}") {
                if (stack.length > 0)
                    stack.pop();
            }
        }
    }
    return linkToColliderEntries;
}
function parseVector3FromTupleLiteral(tupleLiteral) {
    if (!tupleLiteral)
        return null;
    const source = String(tupleLiteral || "")
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((part) => Number.isFinite(part));
    if (source.length < 3)
        return null;
    return [source[0], source[1], source[2]];
}
function normalizeQuaternionWxyzTuple(tupleValue) {
    if (!Array.isArray(tupleValue) || tupleValue.length < 4)
        return null;
    const w = Number(tupleValue[0]);
    const x = Number(tupleValue[1]);
    const y = Number(tupleValue[2]);
    const z = Number(tupleValue[3]);
    if (![w, x, y, z].every((value) => Number.isFinite(value)))
        return null;
    const length = Math.hypot(w, x, y, z);
    if (!Number.isFinite(length) || length <= 1e-12)
        return null;
    return [w / length, x / length, y / length, z / length];
}
function parseQuaternionWxyzFromTupleLiteral(tupleLiteral) {
    if (!tupleLiteral)
        return null;
    const source = String(tupleLiteral || "")
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((part) => Number.isFinite(part));
    if (source.length < 4)
        return null;
    return normalizeQuaternionWxyzTuple([source[0], source[1], source[2], source[3]]);
}
function normalizeAxisToken(value) {
    const token = String(value || "X").trim().toUpperCase();
    if (token.startsWith("Y"))
        return "Y";
    if (token.startsWith("Z"))
        return "Z";
    return "X";
}
export function extractJointRecordsFromLayerText(layerText) {
    if (!layerText || typeof layerText !== "string")
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
        const body = layerText.slice(openingBraceIndex + 1, closingBraceIndex);
        const body0Path = normalizeUsdPathToken(String(body.match(/physics:body0\s*=\s*([^\n\r]+)/i)?.[1] || "")) || null;
        const body1Path = normalizeUsdPathToken(String(body.match(/physics:body1\s*=\s*([^\n\r]+)/i)?.[1] || "")) || null;
        const axisToken = normalizeAxisToken(body.match(/physics:axis\s*=\s*"?([A-Za-z]+)"?/i)?.[1] || "X");
        const lowerLimitDeg = toFiniteNumberLocal(body.match(/physics:lowerLimit\s*=\s*([-+0-9.eE]+)/i)?.[1]);
        const upperLimitDeg = toFiniteNumberLocal(body.match(/physics:upperLimit\s*=\s*([-+0-9.eE]+)/i)?.[1]);
        const localPos1 = parseVector3FromTupleLiteral(body.match(/physics:localPos1\s*=\s*\(([^)]+)\)/i)?.[1] || "");
        const localRot1Wxyz = parseQuaternionWxyzFromTupleLiteral(body.match(/physics:localRot1\s*=\s*\(([^)]+)\)/i)?.[1] || "");
        records.push({
            jointTypeName,
            jointName,
            body0Path,
            body1Path,
            axisToken,
            lowerLimitDeg: lowerLimitDeg === undefined ? null : lowerLimitDeg,
            upperLimitDeg: upperLimitDeg === undefined ? null : upperLimitDeg,
            localPos1,
            localRot1Wxyz,
        });
        headerRegex.lastIndex = closingBraceIndex + 1;
    }
    return records;
}
function countBracesOutsideStrings(source) {
    let openCount = 0;
    let closeCount = 0;
    let insideString = false;
    for (let cursor = 0; cursor < source.length; cursor += 1) {
        const character = source[cursor];
        const previousCharacter = cursor > 0 ? source[cursor - 1] : "";
        if (character === '"' && previousCharacter !== "\\") {
            insideString = !insideString;
            continue;
        }
        if (insideString)
            continue;
        if (character === "{")
            openCount += 1;
        else if (character === "}")
            closeCount += 1;
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
    if (!normalizedLinkPath)
        return null;
    const existing = target.get(normalizedLinkPath);
    if (existing)
        return existing;
    const created = {};
    target.set(normalizedLinkPath, created);
    return created;
}
export function parseLinkDynamicsPatchesFromLayerText(layerText) {
    const patchesByLinkPath = new Map();
    if (!layerText || typeof layerText !== "string")
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
                const mass = toFiniteNumberLocal(massMatch[1]);
                if (mass !== undefined) {
                    const patch = ensureLinkDynamicsPatch(patchesByLinkPath, currentPrimPath);
                    if (patch)
                        patch.mass = mass;
                }
            }
            const centerOfMassMatch = line.match(/physics:centerOfMass\s*=\s*\(([^)]+)\)/i);
            if (centerOfMassMatch) {
                const centerOfMassLocal = parseVector3FromTupleLiteral(centerOfMassMatch[1]);
                if (centerOfMassLocal) {
                    const patch = ensureLinkDynamicsPatch(patchesByLinkPath, currentPrimPath);
                    if (patch)
                        patch.centerOfMassLocal = centerOfMassLocal;
                }
            }
            const diagonalInertiaMatch = line.match(/physics:diagonalInertia\s*=\s*\(([^)]+)\)/i);
            if (diagonalInertiaMatch) {
                const diagonalInertia = parseVector3FromTupleLiteral(diagonalInertiaMatch[1]);
                if (diagonalInertia) {
                    const patch = ensureLinkDynamicsPatch(patchesByLinkPath, currentPrimPath);
                    if (patch)
                        patch.diagonalInertia = diagonalInertia;
                }
            }
            const principalAxesMatch = line.match(/physics:principalAxes\s*=\s*\(([^)]+)\)/i);
            if (principalAxesMatch) {
                const principalAxesLocalWxyz = parseQuaternionWxyzFromTupleLiteral(principalAxesMatch[1]);
                if (principalAxesLocalWxyz) {
                    const patch = ensureLinkDynamicsPatch(patchesByLinkPath, currentPrimPath);
                    if (patch)
                        patch.principalAxesLocalWxyz = principalAxesLocalWxyz;
                }
            }
        }
        const { openCount, closeCount } = countBracesOutsideStrings(line);
        for (let openIndex = 0; openIndex < openCount; openIndex += 1) {
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
        for (let closeIndex = 0; closeIndex < closeCount; closeIndex += 1) {
            const exitedScope = scopeStack.pop();
            if (!exitedScope?.primPath)
                continue;
            primPathStack.pop();
        }
    }
    return patchesByLinkPath;
}
export function parseXformOpFallbacksFromLayerText(layerText) {
    if (!layerText || typeof layerText !== "string" || !layerText.includes("xformOp:")) {
        return new Map();
    }
    const parsedByPrimPath = new Map();
    const contextStack = [];
    let pendingContextName = null;
    const getCurrentPath = () => {
        if (contextStack.length === 0)
            return "";
        return contextStack[contextStack.length - 1].path || "";
    };
    const pushContext = (contextName) => {
        const normalizedName = String(contextName || "").trim();
        const parentPath = getCurrentPath();
        let nextPath = parentPath;
        if (normalizedName) {
            nextPath = normalizedName.startsWith("/")
                ? normalizeUsdPathToken(normalizedName)
                : normalizeUsdPathToken(parentPath ? `${parentPath}/${normalizedName}` : `/${normalizedName}`);
        }
        else {
            nextPath = normalizeUsdPathToken(parentPath || "/");
        }
        contextStack.push({
            name: normalizedName,
            path: nextPath,
        });
    };
    const parseXformOpValue = (opName, literal) => {
        if (!opName || !literal)
            return undefined;
        const numberMatches = String(literal).match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
        const numbers = numberMatches
            .map((entry) => Number(entry))
            .filter((entry) => Number.isFinite(entry));
        if (numbers.length === 0)
            return undefined;
        if (opName.startsWith("xformOp:orient")) {
            if (numbers.length < 4)
                return undefined;
            return [numbers[0], numbers[1], numbers[2], numbers[3]];
        }
        if (opName.startsWith("xformOp:translate") || opName.startsWith("xformOp:scale")) {
            if (numbers.length < 3)
                return undefined;
            return [numbers[0], numbers[1], numbers[2]];
        }
        if (opName.startsWith("xformOp:rotateXYZ")
            || opName.startsWith("xformOp:rotateXZY")
            || opName.startsWith("xformOp:rotateYXZ")
            || opName.startsWith("xformOp:rotateYZX")
            || opName.startsWith("xformOp:rotateZXY")
            || opName.startsWith("xformOp:rotateZYX")) {
            if (numbers.length < 3)
                return undefined;
            return [numbers[0], numbers[1], numbers[2]];
        }
        if (opName.startsWith("xformOp:rotateX")
            || opName.startsWith("xformOp:rotateY")
            || opName.startsWith("xformOp:rotateZ")) {
            return numbers[0];
        }
        if (opName.startsWith("xformOp:transform")) {
            if (numbers.length < 16)
                return undefined;
            return [
                numbers[0], numbers[1], numbers[2], numbers[3],
                numbers[4], numbers[5], numbers[6], numbers[7],
                numbers[8], numbers[9], numbers[10], numbers[11],
                numbers[12], numbers[13], numbers[14], numbers[15],
            ];
        }
        return undefined;
    };
    const recordXformOpValue = (primPath, opName, literal) => {
        if (!primPath || !opName || !literal)
            return;
        const parsedValue = parseXformOpValue(opName, literal);
        if (parsedValue === undefined)
            return;
        let opMap = parsedByPrimPath.get(primPath);
        if (!(opMap instanceof Map)) {
            opMap = new Map();
            parsedByPrimPath.set(primPath, opMap);
        }
        opMap.set(opName, Array.isArray(parsedValue) ? [...parsedValue] : parsedValue);
    };
    const lineRegex = /[^\r\n]+/g;
    let lineMatch = null;
    while ((lineMatch = lineRegex.exec(layerText))) {
        const line = lineMatch[0];
        const trimmed = line.trim();
        const defMatch = trimmed.match(/^(?:def|over|class)\s+\w+\s+"([^"]+)"/);
        if (defMatch) {
            pendingContextName = String(defMatch[1] || "").trim();
        }
        const currentPath = getCurrentPath();
        if (currentPath && trimmed.includes("xformOp:")) {
            const xformMatch = trimmed.match(/(?:\w+\s+)?(xformOp:[\w:]+)\s*=\s*(.+)$/i);
            if (xformMatch) {
                recordXformOpValue(currentPath, String(xformMatch[1] || "").trim(), String(xformMatch[2] || "").trim());
            }
        }
        let insideString = false;
        for (let index = 0; index < line.length; index += 1) {
            const character = line[index];
            const previousCharacter = index > 0 ? line[index - 1] : "";
            if (character === '"' && previousCharacter !== "\\") {
                insideString = !insideString;
                continue;
            }
            if (insideString)
                continue;
            if (character === "{") {
                pushContext(pendingContextName || "");
                pendingContextName = null;
            }
            else if (character === "}") {
                if (contextStack.length > 0) {
                    contextStack.pop();
                }
            }
        }
    }
    return parsedByPrimPath;
}
function toFiniteNumberLocal(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return undefined;
    return numeric;
}
