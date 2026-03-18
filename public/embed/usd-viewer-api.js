function isViewerApiCandidate(value) {
    if (!value || typeof value !== "object")
        return false;
    return typeof value.getState === "function"
        && typeof value.waitUntilReady === "function"
        && typeof value.setVisibility === "function";
}
function isHtmlIFrameElement(value) {
    if (typeof HTMLIFrameElement === "undefined")
        return false;
    return value instanceof HTMLIFrameElement;
}
function resolveViewerApiHost(target) {
    if (isHtmlIFrameElement(target)) {
        return target.contentWindow;
    }
    if (target)
        return target;
    if (typeof window !== "undefined")
        return window;
    return null;
}
export function getUsdViewerApi(target) {
    const host = resolveViewerApiHost(target);
    const candidate = host?.usdViewerApi;
    return isViewerApiCandidate(candidate) ? candidate : null;
}
export function assertUsdViewerApi(target) {
    const api = getUsdViewerApi(target);
    if (api)
        return api;
    throw new Error("USD viewer API is not available on the target window.");
}
export async function waitForUsdViewerApi(target, options = {}) {
    const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 15000));
    const pollIntervalMs = Math.max(10, Math.floor(options.pollIntervalMs ?? 50));
    const startMs = Date.now();
    const delay = typeof globalThis.setTimeout === "function"
        ? globalThis.setTimeout.bind(globalThis)
        : ((handler, timeout) => setTimeout(handler, timeout));
    for (;;) {
        const api = getUsdViewerApi(target);
        if (api)
            return api;
        if (timeoutMs > 0 && Date.now() - startMs >= timeoutMs) {
            throw new Error(`USD viewer API was not discovered within ${timeoutMs}ms.`);
        }
        await new Promise((resolve) => delay(resolve, pollIntervalMs));
    }
}
function setBooleanSearchParam(url, key, value) {
    if (typeof value !== "boolean")
        return;
    url.searchParams.set(key, value ? "1" : "0");
}
export function createUsdViewerUrl(baseUrl, options = {}) {
    const resolvedBaseUrl = String(baseUrl || "").trim();
    if (!resolvedBaseUrl) {
        throw new Error("createUsdViewerUrl requires a non-empty baseUrl.");
    }
    const url = new URL(resolvedBaseUrl, typeof window !== "undefined" ? window.location.href : undefined);
    const { file, ...rest } = options;
    if (file) {
        url.searchParams.set("file", String(file));
    }
    setBooleanSearchParam(url, "showVisuals", options.showVisuals);
    setBooleanSearchParam(url, "showCollisions", options.showCollisions);
    setBooleanSearchParam(url, "showDynamics", options.showDynamics);
    setBooleanSearchParam(url, "readStageMetadata", options.readStageMetadata);
    setBooleanSearchParam(url, "strictOneShot", options.strictOneShot);
    setBooleanSearchParam(url, "sceneSnapshotMode", options.sceneSnapshotMode);
    for (const [key, rawValue] of Object.entries(rest)) {
        if (rawValue === null || rawValue === undefined) {
            url.searchParams.delete(key);
            continue;
        }
        if (key === "showVisuals"
            || key === "showCollisions"
            || key === "showDynamics"
            || key === "readStageMetadata"
            || key === "strictOneShot"
            || key === "sceneSnapshotMode") {
            continue;
        }
        url.searchParams.set(key, String(rawValue));
    }
    return url.toString();
}
