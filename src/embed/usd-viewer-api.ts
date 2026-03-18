import type { JointInfoSnapshot } from "../viewer/link-rotation.js";
import type { RenderRobotMetadataSnapshot } from "../viewer/robot-metadata.js";

export type ViewerVisibilityState = {
  visuals: boolean;
  collisions: boolean;
  dynamics: boolean;
};

export type ViewerStateSnapshot = {
  file: string;
  displayName: string;
  ready: boolean;
  stopped: boolean;
  disposed: boolean;
  loadedVisualPrims: boolean;
  loadedCollisionPrims: boolean;
  visibility: ViewerVisibilityState;
};

export type ViewerWaitUntilReadyOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type ViewerClearOptions = {
  clearVirtualFs?: boolean;
};

export type ViewerLoadUsdFromPathOptions = ViewerClearOptions;

export type ViewerRobotMetadataWarmupOptions = {
  force?: boolean;
  skipIdleWait?: boolean;
  skipUrdfTruthFallback?: boolean;
};

export type ViewerRoundtripExportResult = {
  ok: boolean;
  error?: string;
  filePath?: string;
  outputVirtualPath?: string;
  outputFileName?: string;
  [key: string]: unknown;
};

export interface UsdViewerApi {
  getState(): ViewerStateSnapshot;
  waitUntilReady(options?: ViewerWaitUntilReadyOptions): Promise<ViewerStateSnapshot>;
  loadUsdFromPath(path: string, options?: ViewerLoadUsdFromPathOptions): Promise<ViewerStateSnapshot>;
  loadFiles(fileList: FileList | File[]): Promise<ViewerStateSnapshot>;
  clear(options?: ViewerClearOptions): Promise<void>;
  getVisibility(): ViewerVisibilityState;
  setVisibility(visibility: Partial<ViewerVisibilityState>): Promise<ViewerStateSnapshot>;
  getJointInfos(): Promise<JointInfoSnapshot[]>;
  setJointAngle(linkPath: string, angleDeg: number): JointInfoSnapshot | null;
  getRobotMetadata(): RenderRobotMetadataSnapshot | null;
  warmupRobotMetadata(options?: ViewerRobotMetadataWarmupOptions): Promise<RenderRobotMetadataSnapshot | null>;
  exportRoundtripUsd(options?: Record<string, unknown>): Promise<ViewerRoundtripExportResult>;
  dispose(): Promise<void>;
}

export type ViewerInitOptions = {
  exposeGlobal?: boolean;
};

export type ViewerApiHostLike = {
  usdViewerApi?: UsdViewerApi | null;
} | null | undefined;

export type ViewerEmbedTarget = ViewerApiHostLike | HTMLIFrameElement;

export type ViewerApiDiscoveryOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type ViewerEmbedUrlOptions = {
  file?: string;
  showVisuals?: boolean;
  showCollisions?: boolean;
  showDynamics?: boolean;
  readStageMetadata?: boolean;
  strictOneShot?: boolean;
  sceneSnapshotMode?: boolean;
  [key: string]: string | number | boolean | null | undefined;
};

function isViewerApiCandidate(value: unknown): value is UsdViewerApi {
  if (!value || typeof value !== "object") return false;
  return typeof (value as UsdViewerApi).getState === "function"
    && typeof (value as UsdViewerApi).waitUntilReady === "function"
    && typeof (value as UsdViewerApi).setVisibility === "function";
}

function isHtmlIFrameElement(value: unknown): value is HTMLIFrameElement {
  if (typeof HTMLIFrameElement === "undefined") return false;
  return value instanceof HTMLIFrameElement;
}

function resolveViewerApiHost(target?: ViewerEmbedTarget): ViewerApiHostLike {
  if (isHtmlIFrameElement(target)) {
    return target.contentWindow;
  }
  if (target) return target;
  if (typeof window !== "undefined") return window;
  return null;
}

export function getUsdViewerApi(target?: ViewerEmbedTarget): UsdViewerApi | null {
  const host = resolveViewerApiHost(target);
  const candidate = host?.usdViewerApi;
  return isViewerApiCandidate(candidate) ? candidate : null;
}

export function assertUsdViewerApi(target?: ViewerEmbedTarget): UsdViewerApi {
  const api = getUsdViewerApi(target);
  if (api) return api;
  throw new Error("USD viewer API is not available on the target window.");
}

export async function waitForUsdViewerApi(
  target?: ViewerEmbedTarget,
  options: ViewerApiDiscoveryOptions = {},
): Promise<UsdViewerApi> {
  const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 15_000));
  const pollIntervalMs = Math.max(10, Math.floor(options.pollIntervalMs ?? 50));
  const startMs = Date.now();
  const delay = typeof globalThis.setTimeout === "function"
    ? globalThis.setTimeout.bind(globalThis)
    : ((handler: () => void, timeout: number) => setTimeout(handler, timeout));

  for (;;) {
    const api = getUsdViewerApi(target);
    if (api) return api;
    if (timeoutMs > 0 && Date.now() - startMs >= timeoutMs) {
      throw new Error(`USD viewer API was not discovered within ${timeoutMs}ms.`);
    }
    await new Promise<void>((resolve) => delay(resolve, pollIntervalMs));
  }
}

function setBooleanSearchParam(url: URL, key: string, value: boolean | undefined): void {
  if (typeof value !== "boolean") return;
  url.searchParams.set(key, value ? "1" : "0");
}

export function createUsdViewerUrl(baseUrl: string, options: ViewerEmbedUrlOptions = {}): string {
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
    if (
      key === "showVisuals"
      || key === "showCollisions"
      || key === "showDynamics"
      || key === "readStageMetadata"
      || key === "strictOneShot"
      || key === "sceneSnapshotMode"
    ) {
      continue;
    }
    url.searchParams.set(key, String(rawValue));
  }

  return url.toString();
}
