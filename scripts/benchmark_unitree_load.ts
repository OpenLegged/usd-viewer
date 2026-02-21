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
  firstMeshVisibleMs: number | null;
  majorVisualReadyMs: number | null;
  finalMeshTotal: number;
  finalMeshReady: number;
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
  medianFirstMeshVisibleMs: number | null;
  medianMajorVisualReadyMs: number | null;
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
    output: "output/bench/unitree-load-benchmark.json",
    runs: 3,
    timeoutMs: 180_000,
    pollIntervalMs: 120,
    includeConfiguration: false,
    models: [],
    extraQuery: new URLSearchParams(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--server" && next) {
      defaults.server = next;
      i += 1;
      continue;
    }
    if (token === "--unitree-root" && next) {
      defaults.unitreeRoot = next;
      i += 1;
      continue;
    }
    if (token === "--output" && next) {
      defaults.output = next;
      i += 1;
      continue;
    }
    if (token === "--runs" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 1) defaults.runs = Math.max(1, Math.floor(parsed));
      i += 1;
      continue;
    }
    if (token === "--timeout-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) defaults.timeoutMs = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (token === "--poll-interval-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 10) defaults.pollIntervalMs = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (token === "--include-configuration" && next) {
      defaults.includeConfiguration = parseBooleanFlag(next, defaults.includeConfiguration);
      i += 1;
      continue;
    }
    if (token === "--model" && next) {
      defaults.models.push(next);
      i += 1;
      continue;
    }
    if (token === "--extra-query" && next) {
      defaults.extraQuery = new URLSearchParams(next);
      i += 1;
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
    // Keep permissive behavior for --model paths; this check only ensures no accidental path normalization issues.
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
  let firstMeshVisibleMs: number | null = null;
  let majorVisualReadyMs: number | null = null;
  let finalMeshTotal = 0;
  let finalMeshReady = 0;
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
        for (const [, hydraMesh] of meshEntries) {
          const geometry = (hydraMesh as any)?._mesh?.geometry;
          const positionAttribute = geometry?.getAttribute?.("position");
          if (positionAttribute && positionAttribute.count > 0) ready += 1;
        }
        return {
          message,
          total: meshEntries.length,
          ready,
        };
      });

      finalMeshTotal = Number(state.total || 0);
      finalMeshReady = Number(state.ready || 0);

      if (!failureReason && /Failed to initialize USD renderer/i.test(String(state.message || ""))) {
        failureReason = String(state.message || "Failed to initialize USD renderer.");
        break;
      }

      if (firstMeshVisibleMs === null && finalMeshReady > 0) {
        firstMeshVisibleMs = elapsedMs;
      }

      if (majorVisualReadyMs === null && finalMeshTotal > 0) {
        const threshold = Math.max(1, Math.floor(finalMeshTotal * 0.9));
        if (finalMeshReady >= threshold) {
          majorVisualReadyMs = elapsedMs;
        }
      }

      const signature = `${finalMeshReady}/${finalMeshTotal}`;
      if (signature === previousSignature) stableRounds += 1;
      else stableRounds = 0;
      previousSignature = signature;

      if (firstMeshVisibleMs !== null && stableRounds >= 10) {
        break;
      }

      if (elapsedMs >= timeoutMs) {
        failureReason = "Timed out while waiting for mesh readiness.";
        break;
      }

      await page.waitForTimeout(pollIntervalMs);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failureReason = message;
  } finally {
    page.off("console", onConsole);
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  const ok = failureReason === null && firstMeshVisibleMs !== null;

  return {
    ok,
    firstMeshVisibleMs,
    majorVisualReadyMs,
    finalMeshTotal,
    finalMeshReady,
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
      process.stdout.write(`[bench] model=${modelPath}\n`);
      const runResults: SingleRunResult[] = [];

      for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const page = await context.newPage();
        page.setDefaultTimeout(options.timeoutMs);

        const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${runIndex + 1}`;
        const viewerUrl = createViewerUrl(options, modelPath, cacheBust);
        const result = await runSingleBenchmark(page, viewerUrl, options.timeoutMs, options.pollIntervalMs);
        runResults.push(result);

        const firstText = result.firstMeshVisibleMs === null ? "n/a" : String(result.firstMeshVisibleMs);
        const majorText = result.majorVisualReadyMs === null ? "n/a" : String(result.majorVisualReadyMs);
        const statusText = result.ok ? "ok" : `fail(${result.failureReason || "unknown"})`;
        process.stdout.write(
          `[bench]   run=${runIndex + 1}/${options.runs} status=${statusText} first=${firstText}ms major=${majorText}ms ready=${result.finalMeshReady}/${result.finalMeshTotal}\n`,
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
        medianFirstMeshVisibleMs: median(okRuns.map((entry) => Number(entry.firstMeshVisibleMs || 0))),
        medianMajorVisualReadyMs: median(okRuns.map((entry) => Number(entry.majorVisualReadyMs || 0))),
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
    aggregate_median_first_mesh_visible_ms: median(
      modelSummariesWithOk
        .map((entry) => entry.medianFirstMeshVisibleMs)
        .filter((value): value is number => typeof value === "number"),
    ),
    aggregate_median_major_visual_ready_ms: median(
      modelSummariesWithOk
        .map((entry) => entry.medianMajorVisualReadyMs)
        .filter((value): value is number => typeof value === "number"),
    ),
    models: aggregated,
  };

  await writeFile(path.resolve(options.output), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  process.stdout.write(`[bench] output=${path.resolve(options.output)}\n`);
  process.stdout.write(
    `[bench] summary models=${summary.model_count} ok=${summary.model_ok_count} fail=${summary.model_fail_count} median_first=${summary.aggregate_median_first_mesh_visible_ms} median_major=${summary.aggregate_median_major_visual_ready_ms}\n`,
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
