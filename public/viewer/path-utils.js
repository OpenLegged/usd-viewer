export const supportedUsdExtensions = new Set(["usd", "usda", "usdc", "usdz"]);
export function parseBooleanFlag(value, fallback = false) {
    if (value === null || value === undefined)
        return fallback;
    const normalized = String(value).toLowerCase();
    if (normalized === "1" || normalized === "true")
        return true;
    if (normalized === "0" || normalized === "false")
        return false;
    return fallback;
}
export function getSavedBooleanState(storageKey, fallback = false) {
    try {
        return parseBooleanFlag(localStorage.getItem(storageKey), fallback);
    }
    catch {
        return fallback;
    }
}
export function saveBooleanState(storageKey, enabled) {
    try {
        localStorage.setItem(storageKey, enabled ? "1" : "0");
    }
    catch { }
}
export function getFileExtension(fileName = "") {
    const normalizedName = String(fileName).trim();
    const dotIndex = normalizedName.lastIndexOf(".");
    if (dotIndex < 0)
        return "";
    return normalizedName.substring(dotIndex + 1).toLowerCase();
}
export function isSupportedUsdFileName(fileName = "") {
    return supportedUsdExtensions.has(getFileExtension(fileName));
}
export function normalizeUsdPath(inputPath, fallbackFileName = "") {
    const rawPath = String(inputPath || fallbackFileName || "").trim();
    if (!rawPath)
        return "";
    if (/^[a-z]+:\/\//i.test(rawPath))
        return rawPath;
    if (rawPath.startsWith("/"))
        return rawPath;
    return "/" + rawPath;
}
export function getDirectoryFromVirtualPath(filePath = "/") {
    const normalized = normalizeUsdPath(filePath);
    const slashIndex = normalized.lastIndexOf("/");
    if (slashIndex < 0)
        return "/";
    return normalized.substring(0, slashIndex + 1);
}
export function isTopLevelVirtualFilePath(filePath = "") {
    const segments = normalizeUsdPath(filePath).split("/").filter(Boolean);
    return segments.length === 1;
}
export function isLikelyNonRenderableUsdConfig(pathToFile = "") {
    const normalized = String(pathToFile || "").toLowerCase();
    if (!normalized.includes("/configuration/"))
        return false;
    return (normalized.endsWith("_sensor.usd")
        || normalized.endsWith("_robot.usd")
        || normalized.endsWith("h1_2_handless_robot.usd"));
}
