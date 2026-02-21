#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

import { cleanupHeadlessBrowserProcesses } from "./lib/cleanup-headless.ts";
import { handleFatalError } from "./lib/fatal.ts";

type BenchmarkOptions = {
  server: string;
  unitreeRoot: string;
  output: string;
  runs: number;
  timeoutMs: number;
  pollIntervalMs: number;
  includeConfiguration: boolean;
  models: string[];
  extraQuery: URLSearchParams;
};

type SingleRunResult = {
  ok: boolean;
  firstUiVisibleMs: number | null;
  majorUiVisibleMs: number | null;
  firstMeshReadyMs: number | null;
  majorMeshReadyMs: number | null;
  finalMeshTotal: number;
  finalMeshReady: number;
  finalVisibleReadyMeshCount: number;
  finalUiNonBackgroundSamples: number;
  elapsedMs: number;
  failureReason: string | null;
  consoleErrorCount: number;
  consoleErrors: string[];
  url: string;
};

type AggregatedModelResult = {
  model: string;
  runs: SingleRunResult[];
  okRunCount: number;
  failRunCount: number;
  medianFirstUiVisibleMs: number | null;
  medianMajorUiVisibleMs: number | null;
  medianFirstMeshReadyMs: number | null;
  medianMajorMeshReadyMs: number | null;
  medianElapsedMs: number | null;
};

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const lowered = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(lowered)) return true;
  if (["0", "false", "no", "off"].includes(lowered)) return false;
  return fallback;
}

function parseArgs(argv: string[]): BenchmarkOptions {
  const defaults: BenchmarkOptions = {
    server: "http://127.0.0.1:3003",
    unitreeRoot: "unitree_model",
    output: "output/bench/unitree-ui-visible-benchmark.json",
    runs: 3,
    timeoutMs: 180_000,
    pollIntervalMs: 100,
    includeConfiguration: false,
    models: [],
    extraQuery: new URLSearchParams(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--server" && next) {
      defaults.server = next;
      index += 1;
      continue;
    }
    if (token === "--unitree-root" && next) {
      defaults.unitreeRoot = next;
      index += 1;
      continue;
    }
    if (token === "--output" && next) {
      defaults.output = next;
      index += 1;
      continue;
    }
    if (token === "--runs" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) defaults.runs = Math.max(1, Math.floor(parsed));
      index += 1;
      continue;
    }
    if (token === "--timeout-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) defaults.timeoutMs = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token === "--poll-interval-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 10) defaults.pollIntervalMs = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token === "--include-configuration" && next) {
      defaults.includeConfiguration = parseBooleanFlag(next, defaults.includeConfiguration);
      index += 1;
      continue;
    }
    if (token === "--model" && next) {
      defaults.models.push(next);
      index += 1;
      continue;
    }
    if (token === "--extra-query" && next) {
      defaults.extraQuery = new URLSearchParams(next);
      index += 1;
      continue;
    }
  }

  return defaults;
}

async function walkUsdFiles(rootDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const results: string[] = [];
  async function visit(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".usd")) continue;
      results.push(absolute);
    }
  }
  await visit(path.resolve(rootDir));
  return results;
}

function toRelativeUnixPath(baseDir: string, absoluteFilePath: string): string {
  const relative = path.relative(path.resolve("."), absoluteFilePath);
  if (relative.startsWith("..")) {
    throw new Error(`Model path is outside workspace: ${absoluteFilePath}`);
  }
  const _base = path.resolve(baseDir);
  const _abs = path.resolve(absoluteFilePath);
  if (!_abs.startsWith(_base)) {
    // Keep permissive behavior for --model paths.
  }
  return relative.split(path.sep).join("/");
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function createViewerUrl(options: BenchmarkOptions, modelPath: string, cacheBust: string): string {
  const root = options.server.endsWith("/") ? options.server.slice(0, -1) : options.server;
  const url = new URL(`${root}/`);
  url.searchParams.set("file", `/${modelPath}`);
  url.searchParams.set("showVisuals", "1");
  url.searchParams.set("showCollisions", "0");
  url.searchParams.set("showLinkAxes", "0");
  url.searchParams.set("showDynamics", "0");
  url.searchParams.set("showRobotInspector", "0");
  url.searchParams.set("readStageMetadata", "1");
  url.searchParams.set("cb", cacheBust);
  for (const [key, value] of options.extraQuery.entries()) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function runSingleBenchmark(
  page: import("playwright").Page,
  viewerUrl: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<SingleRunResult> {
  const consoleErrors: string[] = [];
  const onConsole = (message: import("playwright").ConsoleMessage): void => {
    if (message.type() !== "error") return;
    consoleErrors.push(message.text());
  };
  page.on("console", onConsole);

  const startedAt = performance.now();
  let firstUiVisibleMs: number | null = null;
  let majorUiVisibleMs: number | null = null;
  let firstMeshReadyMs: number | null = null;
  let majorMeshReadyMs: number | null = null;
  let finalMeshTotal = 0;
  let finalMeshReady = 0;
  let finalVisibleReadyMeshCount = 0;
  let finalUiNonBackgroundSamples = 0;
  let failureReason: string | null = null;
  let stableRounds = 0;
  let previousSignature = "";

  try {
    await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    for (;;) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const state = await page.evaluate(() => {
        const message = String((document.querySelector("#message-log") as HTMLElement | null)?.textContent || "").trim();
        const renderInterface = (window as any).renderInterface;
        const meshes = renderInterface?.meshes || {};
        const meshEntries = Object.entries(meshes);
        let ready = 0;
        let visibleReady = 0;
        for (const [, hydraMesh] of meshEntries) {
          const mesh = (hydraMesh as any)?._mesh;
          const geometry = mesh?.geometry;
          const positionAttribute = geometry?.getAttribute?.("position");
          const isReady = !!positionAttribute && positionAttribute.count > 0;
          if (isReady) ready += 1;
          if (isReady && mesh?.visible !== false) visibleReady += 1;
        }

        const renderer = (window as any).renderer;
        let nonBackgroundSampleCount = 0;
        let sampleCount = 0;
        let sampleReadError = false;
        try {
          const canvas = renderer?.domElement as HTMLCanvasElement | undefined;
          const gl = canvas
            ? ((canvas.getContext("webgl2") as WebGL2RenderingContext | null)
              || (canvas.getContext("webgl") as WebGLRenderingContext | null)
              || (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null))
            : null;
          if (gl && canvas) {
            const bgR = 0xd7;
            const bgG = 0xdd;
            const bgB = 0xe8;
            const threshold = 36;
            const points = [
              [0.2, 0.2], [0.5, 0.2], [0.8, 0.2],
              [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
              [0.2, 0.8], [0.5, 0.8], [0.8, 0.8],
            ];
            const pixel = new Uint8Array(4);
            const drawingWidth = Number((gl as any).drawingBufferWidth || canvas.width || 0);
            const drawingHeight = Number((gl as any).drawingBufferHeight || canvas.height || 0);
            if (drawingWidth > 1 && drawingHeight > 1) {
              for (const [u, v] of points) {
                const x = Math.max(0, Math.min(drawingWidth - 1, Math.floor(drawingWidth * Number(u))));
                const yTopLeft = Math.max(0, Math.min(drawingHeight - 1, Math.floor(drawingHeight * Number(v))));
                const yBottomLeft = drawingHeight - 1 - yTopLeft;
                gl.readPixels(x, yBottomLeft, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                sampleCount += 1;
                const delta = Math.abs(pixel[0] - bgR) + Math.abs(pixel[1] - bgG) + Math.abs(pixel[2] - bgB);
                if (delta > threshold) nonBackgroundSampleCount += 1;
              }
            }
          }
        } catch {
          sampleReadError = true;
        }

        return {
          message,
          total: meshEntries.length,
          ready,
          visibleReady,
          nonBackgroundSampleCount,
          sampleCount,
          sampleReadError,
        };
      });

      finalMeshTotal = Number(state.total || 0);
      finalMeshReady = Number(state.ready || 0);
      finalVisibleReadyMeshCount = Number(state.visibleReady || 0);
      finalUiNonBackgroundSamples = Number(state.nonBackgroundSampleCount || 0);

      if (!failureReason && /Failed to initialize USD renderer/i.test(String(state.message || ""))) {
        failureReason = String(state.message || "Failed to initialize USD renderer.");
        break;
      }

      if (firstMeshReadyMs === null && finalMeshReady > 0) {
        firstMeshReadyMs = elapsedMs;
      }

      if (majorMeshReadyMs === null && finalMeshTotal > 0) {
        const threshold = Math.max(1, Math.floor(finalMeshTotal * 0.9));
        if (finalMeshReady >= threshold) {
          majorMeshReadyMs = elapsedMs;
        }
      }

      const uiVisibleNow = finalVisibleReadyMeshCount > 0 && finalUiNonBackgroundSamples >= 2;
      const uiMajorNow = finalVisibleReadyMeshCount > 0 && finalUiNonBackgroundSamples >= 5;
      if (firstUiVisibleMs === null && uiVisibleNow) {
        firstUiVisibleMs = elapsedMs;
      }
      if (majorUiVisibleMs === null && uiMajorNow) {
        majorUiVisibleMs = elapsedMs;
      }

      const signature = `${finalMeshReady}/${finalMeshTotal}:${finalVisibleReadyMeshCount}:${finalUiNonBackgroundSamples}`;
      if (signature === previousSignature) stableRounds += 1;
      else stableRounds = 0;
      previousSignature = signature;

      if (firstUiVisibleMs !== null && stableRounds >= 8) {
        break;
      }
      if (elapsedMs >= timeoutMs) {
        failureReason = "Timed out while waiting for UI visibility.";
        break;
      }

      await page.waitForTimeout(pollIntervalMs);
    }
  } catch (error) {
    failureReason = error instanceof Error ? error.message : String(error);
  } finally {
    page.off("console", onConsole);
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  const ok = failureReason === null && firstUiVisibleMs !== null;
  return {
    ok,
    firstUiVisibleMs,
    majorUiVisibleMs,
    firstMeshReadyMs,
    majorMeshReadyMs,
    finalMeshTotal,
    finalMeshReady,
    finalVisibleReadyMeshCount,
    finalUiNonBackgroundSamples,
    elapsedMs,
    failureReason,
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
    url: viewerUrl,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(".");

  let modelPaths = options.models.map((modelPath) => modelPath.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!modelPaths.length) {
    const discovered = await walkUsdFiles(options.unitreeRoot);
    modelPaths = discovered
      .map((absolutePath) => toRelativeUnixPath(options.unitreeRoot, absolutePath))
      .filter((relativePath) => options.includeConfiguration || !relativePath.includes("/configuration/"))
      .sort((left, right) => left.localeCompare(right));
  }
  if (!modelPaths.length) {
    throw new Error(`No USD files found under ${options.unitreeRoot}`);
  }

  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const aggregated: AggregatedModelResult[] = [];

  try {
    for (const modelPath of modelPaths) {
      process.stdout.write(`[ui-bench] model=${modelPath}\n`);
      const runResults: SingleRunResult[] = [];

      for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const page = await context.newPage();
        page.setDefaultTimeout(options.timeoutMs);

        const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${runIndex + 1}`;
        const viewerUrl = createViewerUrl(options, modelPath, cacheBust);
        const result = await runSingleBenchmark(page, viewerUrl, options.timeoutMs, options.pollIntervalMs);
        runResults.push(result);

        const firstUiText = result.firstUiVisibleMs === null ? "n/a" : String(result.firstUiVisibleMs);
        const majorUiText = result.majorUiVisibleMs === null ? "n/a" : String(result.majorUiVisibleMs);
        const firstMeshText = result.firstMeshReadyMs === null ? "n/a" : String(result.firstMeshReadyMs);
        const statusText = result.ok ? "ok" : `fail(${result.failureReason || "unknown"})`;
        process.stdout.write(
          `[ui-bench]   run=${runIndex + 1}/${options.runs} status=${statusText} ui_first=${firstUiText}ms ui_major=${majorUiText}ms mesh_first=${firstMeshText}ms ui_samples=${result.finalUiNonBackgroundSamples}/9 ready=${result.finalMeshReady}/${result.finalMeshTotal}\n`,
        );

        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }

      const okRuns = runResults.filter((entry) => entry.ok);
      aggregated.push({
        model: modelPath,
        runs: runResults,
        okRunCount: okRuns.length,
        failRunCount: runResults.length - okRuns.length,
        medianFirstUiVisibleMs: median(okRuns.map((entry) => Number(entry.firstUiVisibleMs || 0))),
        medianMajorUiVisibleMs: median(okRuns.map((entry) => Number(entry.majorUiVisibleMs || 0))),
        medianFirstMeshReadyMs: median(okRuns.map((entry) => Number(entry.firstMeshReadyMs || 0))),
        medianMajorMeshReadyMs: median(okRuns.map((entry) => Number(entry.majorMeshReadyMs || 0))),
        medianElapsedMs: median(okRuns.map((entry) => Number(entry.elapsedMs || 0))),
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const modelSummariesWithOk = aggregated.filter((entry) => entry.okRunCount > 0);
  const summary = {
    generated_at_utc: new Date().toISOString(),
    workspace: workspaceRoot,
    server: options.server,
    model_count: aggregated.length,
    model_ok_count: modelSummariesWithOk.length,
    model_fail_count: aggregated.length - modelSummariesWithOk.length,
    runs_per_model: options.runs,
    extra_query: Object.fromEntries(options.extraQuery.entries()),
    aggregate_median_first_ui_visible_ms: median(
      modelSummariesWithOk
        .map((entry) => entry.medianFirstUiVisibleMs)
        .filter((value): value is number => typeof value === "number"),
    ),
    aggregate_median_major_ui_visible_ms: median(
      modelSummariesWithOk
        .map((entry) => entry.medianMajorUiVisibleMs)
        .filter((value): value is number => typeof value === "number"),
    ),
    aggregate_median_first_mesh_ready_ms: median(
      modelSummariesWithOk
        .map((entry) => entry.medianFirstMeshReadyMs)
        .filter((value): value is number => typeof value === "number"),
    ),
    models: aggregated,
  };

  await writeFile(path.resolve(options.output), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  process.stdout.write(`[ui-bench] output=${path.resolve(options.output)}\n`);
  process.stdout.write(
    `[ui-bench] summary models=${summary.model_count} ok=${summary.model_ok_count} fail=${summary.model_fail_count} median_ui_first=${summary.aggregate_median_first_ui_visible_ms} median_ui_major=${summary.aggregate_median_major_ui_visible_ms}\n`,
  );
}

main()
  .catch(handleFatalError)
  .finally(async () => {
    try {
      await cleanupHeadlessBrowserProcesses({ silent: false });
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      process.stderr.write(`Cleanup warning: ${message}\n`);
    }
  });
