import { getFileExtension, isLikelyNonRenderableUsdConfig, isSupportedUsdFileName, normalizeUsdPath } from "./path-utils.js";
function getPathDepth(path) {
    return String(path || "").split("/").filter(Boolean).length;
}
function isLikelyConfigDependencyPath(path) {
    const normalized = String(path || "").toLowerCase();
    if (isLikelyNonRenderableUsdConfig(normalized))
        return true;
    if (!normalized.includes("/configuration/"))
        return false;
    return /_(base|physics|sensor|robot)\.usd[a-z]?$/i.test(normalized);
}
function getRootCandidateScore(entry) {
    const extension = getFileExtension(entry.name);
    if (extension === "usd")
        return 0;
    if (extension === "usda")
        return 1;
    if (extension === "usdc")
        return 2;
    if (extension === "usdz")
        return 3;
    return 4;
}
export function pickRootFileCandidate(files) {
    const usdCandidates = files.filter((entry) => isSupportedUsdFileName(entry.name));
    if (usdCandidates.length === 0)
        return files[0];
    const preferredCandidates = usdCandidates.filter((entry) => !isLikelyConfigDependencyPath(entry.fullPath));
    const candidatePool = preferredCandidates.length > 0 ? preferredCandidates : usdCandidates;
    candidatePool.sort((left, right) => {
        const depthDiff = getPathDepth(left.fullPath) - getPathDepth(right.fullPath);
        if (depthDiff !== 0)
            return depthDiff;
        const leftConfigPenalty = isLikelyConfigDependencyPath(left.fullPath) ? 1 : 0;
        const rightConfigPenalty = isLikelyConfigDependencyPath(right.fullPath) ? 1 : 0;
        if (leftConfigPenalty !== rightConfigPenalty)
            return leftConfigPenalty - rightConfigPenalty;
        const extensionScoreDiff = getRootCandidateScore(left) - getRootCandidateScore(right);
        if (extensionScoreDiff !== 0)
            return extensionScoreDiff;
        return left.fullPath.localeCompare(right.fullPath);
    });
    return candidatePool[0];
}
export function normalizeUploadedFiles(fileList) {
    const files = Array.from(fileList || []);
    const normalized = files.map((file) => ({
        file,
        name: file.name,
        fullPath: normalizeUsdPath(file.webkitRelativePath || file.name),
    }));
    normalized.sort((a, b) => {
        const diff = a.fullPath.split("/").length - b.fullPath.split("/").length;
        if (diff !== 0)
            return diff;
        return a.fullPath.localeCompare(b.fullPath);
    });
    return normalized;
}
