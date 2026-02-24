#!/usr/bin/env node

const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { chromium } = require("playwright");

function parseArgs(argv) {
  const options = {
    server: "http://127.0.0.1:3003",
    model: "/unitree_model/B2/usd/b2.usd",
    runs: 3,
    timeoutMs: 180000,
    pollMs: 120,
    output: "output/bench/load_pipeline_profile.json",
    extraQuery: new URLSearchParams(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--server" && next) {
      options.server = next;
      index += 1;
      continue;
    }
    if (token === "--model" && next) {
      options.model = next;
      index += 1;
      continue;
    }
    if (token === "--runs" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value >= 1) {
        options.runs = Math.max(1, Math.floor(value));
      }
      index += 1;
      continue;
    }
    if (token === "--timeout-ms" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value > 0) {
        options.timeoutMs = Math.floor(value);
      }
      index += 1;
      continue;
    }
    if (token === "--poll-ms" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value > 0) {
        options.pollMs = Math.floor(value);
      }
      index += 1;
      continue;
    }
    if (token === "--output" && next) {
      options.output = next;
      index += 1;
      continue;
    }
    if (token === "--extra-query" && next) {
      options.extraQuery = new URLSearchParams(next);
      index += 1;
      continue;
    }
  }

  return options;
}

function ensureModelPath(model) {
  const normalized = String(model || "").trim().replace(/\\/g, "/");
  if (!normalized) return "/unitree_model/B2/usd/b2.usd";
  if (normalized.startsWith("/")) return normalized;
  return `/${normalized}`;
}

function createViewerUrl(options, runIndex) {
  const root = options.server.endsWith("/") ? options.server.slice(0, -1) : options.server;
  const url = new URL(`${root}/`);
  url.searchParams.set("file", ensureModelPath(options.model));
  url.searchParams.set("showVisuals", "1");
  url.searchParams.set("showCollisions", "1");
  url.searchParams.set("showDynamics", "1");
  url.searchParams.set("showRobotInspector", "1");
  url.searchParams.set("readStageMetadata", "1");
  url.searchParams.set("profileLoad", "1");
  url.searchParams.set("profileHydraPhases", "1");
  url.searchParams.set("cb", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${runIndex + 1}`);
  for (const [key, value] of options.extraQuery.entries()) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if ((sorted.length % 2) === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function categorizeNetwork(records) {
  const stageRequests = records.filter((record) => /\/unitree_model\/|\.usd(?:$|\?)/i.test(record.url));
  const wasmRequests = records.filter((record) => /emHdBindings\.wasm/i.test(record.url));
  const dataRequests = records.filter((record) => /emHdBindings\.data/i.test(record.url));
  const failedRequests = records.filter((record) => record.failed || !record.status || record.status >= 400);

  const sumBytes = (items) => items.reduce((sum, item) => sum + Math.max(0, Number(item.contentLength || 0)), 0);
  return {
    requestCount: records.length,
    totalTransferBytes: sumBytes(records),
    stageTransferBytes: sumBytes(stageRequests),
    wasmTransferBytes: sumBytes(wasmRequests),
    dataTransferBytes: sumBytes(dataRequests),
    stageRequests: stageRequests.slice(0, 20),
    wasmRequests: wasmRequests.slice(0, 8),
    dataRequests: dataRequests.slice(0, 8),
    failedRequests: failedRequests.slice(0, 20),
  };
}

function buildHydraMetrics(snapshot) {
  const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
  const commits = history.map((entry) => Number(entry?.commitMs || 0)).filter((value) => Number.isFinite(value));
  const wasmFetch = history.map((entry) => Number(entry?.wasmFetchMs || 0)).filter((value) => Number.isFinite(value));
  const threeBuild = history.map((entry) => Number(entry?.threeBuildMs || 0)).filter((value) => Number.isFinite(value));
  return {
    hydraCommitMs: commits.length > 0 ? Math.max(...commits) : 0,
    hydraWasmFetchMs: wasmFetch.length > 0 ? Math.max(...wasmFetch) : 0,
    hydraThreeBuildMs: threeBuild.length > 0 ? Math.max(...threeBuild) : 0,
  };
}

async function runSingle(page, options, runIndex) {
  const url = createViewerUrl(options, runIndex);
  const startedAt = performance.now();
  const consoleErrors = [];
  const consoleWarnings = [];
  const consoleInfos = [];
  const pageErrors = [];
  const networkRecords = [];

  page.on("console", (message) => {
    const text = message.text();
    const type = message.type();
    if (type === "error") {
      consoleErrors.push(text);
    } else if (type === "warning") {
      consoleWarnings.push(text);
    } else if (type === "info" || type === "log") {
      if (consoleInfos.length < 24) {
        consoleInfos.push(text);
      }
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error?.stack || error?.message || String(error));
  });

  page.on("requestfinished", async (request) => {
    const response = await request.response().catch(() => null);
    const headers = response ? await response.allHeaders().catch(() => ({})) : {};
    const contentLength = Number(headers?.["content-length"] || headers?.["Content-Length"] || 0);
    networkRecords.push({
      url: request.url(),
      method: request.method(),
      status: response?.status() ?? null,
      contentLength: Number.isFinite(contentLength) ? Math.max(0, Math.floor(contentLength)) : 0,
      failed: false,
      errorText: null,
    });
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure();
    networkRecords.push({
      url: request.url(),
      method: request.method(),
      status: null,
      contentLength: 0,
      failed: true,
      errorText: failure?.errorText || null,
    });
  });

  await page.addInitScript(() => {
    window.__usdLongTaskStats = {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      top10: [],
    };
    try {
      const observer = new PerformanceObserver((list) => {
        const stats = window.__usdLongTaskStats;
        for (const entry of list.getEntries()) {
          const duration = Number(entry?.duration || 0);
          if (!Number.isFinite(duration) || duration <= 0) continue;
          stats.count += 1;
          stats.totalMs += duration;
          stats.maxMs = Math.max(stats.maxMs, duration);
          stats.top10.push({
            startTime: Number(entry?.startTime || 0),
            duration,
          });
        }
        stats.top10.sort((left, right) => Number(right.duration || 0) - Number(left.duration || 0));
        if (stats.top10.length > 10) {
          stats.top10.splice(10);
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      window.__usdLongTaskObserver = observer;
    } catch {}
  });

  let firstMeshReadyMs = null;
  let allMeshReadyMs = null;
  let jointRowsReadyMs = null;
  let jointMoveVerifiedMs = null;
  let failureReason = null;
  let finalState = {};
  let stableRounds = 0;
  let previousSignature = "";

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

    for (;;) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const state = await page.evaluate(async () => {
        const renderInterface = window.renderInterface;
        const meshes = renderInterface?.meshes || {};
        const meshEntries = Object.entries(meshes);
        let meshReady = 0;
        for (const [, hydraMesh] of meshEntries) {
          const position = hydraMesh?._mesh?.geometry?.getAttribute?.("position");
          if (position && Number(position.count || 0) > 0) {
            meshReady += 1;
          }
        }

        const linkRotationController = window.linkRotationController;
        const jointInfos = (typeof linkRotationController?.getAllJointInfos === "function")
          ? await Promise.resolve(linkRotationController.getAllJointInfos()).catch(() => [])
          : [];
        const message = String(document.querySelector("#message-log")?.textContent || "").trim();
        const previousProbe = window.__usdJointProbe || null;
        let jointMoveProbe = previousProbe;

        if (!jointMoveProbe?.attempted && jointInfos.length > 0 && typeof linkRotationController?.setJointAngleForLink === "function") {
          const candidateJoint = jointInfos.find((entry) => (
            entry
            && typeof entry.linkPath === "string"
            && entry.linkPath.startsWith("/")
            && Number.isFinite(Number(entry.angleDeg))
          ));
          if (candidateJoint) {
            const linkPath = String(candidateJoint.linkPath);
            const targetMeshes = Object.entries(meshes)
              .filter(([meshId]) => String(meshId || "").startsWith(`${linkPath}/`) && !String(meshId || "").includes("/collisions"))
              .slice(0, 4);
            const beforeMatrices = targetMeshes.map(([, hydraMesh]) => {
              const elements = hydraMesh?._mesh?.matrix?.elements;
              return Array.isArray(elements) ? elements.slice(0, 16) : [];
            });
            const lower = Number.isFinite(Number(candidateJoint.lowerLimitDeg)) ? Number(candidateJoint.lowerLimitDeg) : -180;
            const upper = Number.isFinite(Number(candidateJoint.upperLimitDeg)) ? Number(candidateJoint.upperLimitDeg) : 180;
            const current = Number(candidateJoint.angleDeg || 0);
            const requested = Math.max(lower, Math.min(upper, current + 12));
            linkRotationController.setJointAngleForLink(linkPath, requested);
            const afterMatrices = targetMeshes.map(([, hydraMesh]) => {
              const elements = hydraMesh?._mesh?.matrix?.elements;
              return Array.isArray(elements) ? elements.slice(0, 16) : [];
            });

            let matrixDelta = 0;
            for (let meshIndex = 0; meshIndex < beforeMatrices.length; meshIndex += 1) {
              const before = beforeMatrices[meshIndex];
              const after = afterMatrices[meshIndex];
              const size = Math.min(before.length, after.length);
              for (let valueIndex = 0; valueIndex < size; valueIndex += 1) {
                const delta = Math.abs(Number(after[valueIndex] || 0) - Number(before[valueIndex] || 0));
                matrixDelta = Math.max(matrixDelta, delta);
              }
            }

            jointMoveProbe = {
              attempted: true,
              success: matrixDelta > 1e-5,
              linkPath,
              beforeAngleDeg: current,
              afterAngleDeg: requested,
              matrixDelta,
              trackedMeshCount: targetMeshes.length,
            };
          } else {
            jointMoveProbe = {
              attempted: true,
              success: false,
              reason: "no_joint_candidates",
            };
          }
          window.__usdJointProbe = jointMoveProbe;
        }

        return {
          message,
          meshTotal: meshEntries.length,
          meshReady,
          jointRows: Array.isArray(jointInfos) ? jointInfos.length : 0,
          jointMoveProbe: jointMoveProbe || null,
          hydraSnapshot: renderInterface?.getHydraPhasePerfSnapshot?.() || null,
          longTask: window.__usdLongTaskStats || null,
        };
      });

      finalState = state;
      const meshTotal = Number(state.meshTotal || 0);
      const meshReady = Number(state.meshReady || 0);
      const jointRows = Number(state.jointRows || 0);
      const moveSuccess = Boolean(state.jointMoveProbe?.success);

      if (firstMeshReadyMs === null && meshReady > 0) {
        firstMeshReadyMs = elapsedMs;
      }
      if (allMeshReadyMs === null && meshTotal > 0 && meshReady >= meshTotal) {
        allMeshReadyMs = elapsedMs;
      }
      if (jointRowsReadyMs === null && jointRows > 0) {
        jointRowsReadyMs = elapsedMs;
      }
      if (jointMoveVerifiedMs === null && moveSuccess) {
        jointMoveVerifiedMs = elapsedMs;
      }

      if (!failureReason && /Failed to initialize USD renderer/i.test(String(state.message || ""))) {
        failureReason = String(state.message || "Failed to initialize USD renderer.");
        break;
      }

      const signature = `${meshReady}/${meshTotal}:${jointRows}:${moveSuccess ? 1 : 0}`;
      if (signature === previousSignature) stableRounds += 1;
      else stableRounds = 0;
      previousSignature = signature;

      if (allMeshReadyMs !== null && jointMoveVerifiedMs !== null && stableRounds >= 8) {
        break;
      }
      if (elapsedMs >= options.timeoutMs) {
        failureReason = "Timed out waiting for full mesh + joint move readiness.";
        break;
      }
      await page.waitForTimeout(options.pollMs);
    }
  } catch (error) {
    failureReason = error instanceof Error ? error.message : String(error);
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  const success = !failureReason && firstMeshReadyMs !== null && allMeshReadyMs !== null && jointMoveVerifiedMs !== null;
  const hydraSnapshot = finalState?.hydraSnapshot || null;
  const longTask = finalState?.longTask || {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    top10: [],
  };

  return {
    run: runIndex + 1,
    url,
    success,
    failureReason: failureReason || null,
    firstMeshReadyMs,
    allMeshReadyMs,
    jointRowsReadyMs,
    jointMoveVerifiedMs,
    totalElapsedMs: elapsedMs,
    state: finalState,
    hydraSnapshot,
    network: categorizeNetwork(networkRecords),
    longTask,
    console: {
      total: consoleErrors.length + consoleWarnings.length + consoleInfos.length,
      errorCount: consoleErrors.length,
      errors: consoleErrors,
      warnings: consoleWarnings,
      infoSample: consoleInfos.slice(0, 12),
    },
    pageErrors,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
      const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeoutMs);
      const result = await runSingle(page, options, runIndex);
      results.push(result);

      const status = result.success ? "ok" : `fail(${result.failureReason || "unknown"})`;
      process.stdout.write(
        `[pipeline] run=${runIndex + 1}/${options.runs} status=${status} first=${result.firstMeshReadyMs ?? "n/a"}ms all=${result.allMeshReadyMs ?? "n/a"}ms joint=${result.jointMoveVerifiedMs ?? "n/a"}ms\n`,
      );

      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const successfulRuns = results.filter((entry) => entry.success);
  const metricsMedian = {
    firstMeshReadyMs: median(successfulRuns.map((entry) => Number(entry.firstMeshReadyMs || 0))),
    allMeshReadyMs: median(successfulRuns.map((entry) => Number(entry.allMeshReadyMs || 0))),
    jointRowsReadyMs: median(successfulRuns.map((entry) => Number(entry.jointRowsReadyMs || 0))),
    jointMoveVerifiedMs: median(successfulRuns.map((entry) => Number(entry.jointMoveVerifiedMs || 0))),
    longTaskTotalMs: median(successfulRuns.map((entry) => Number(entry.longTask?.totalMs || 0))),
    longTaskMaxMs: median(successfulRuns.map((entry) => Number(entry.longTask?.maxMs || 0))),
    hydraCommitMs: median(successfulRuns.map((entry) => buildHydraMetrics(entry.hydraSnapshot).hydraCommitMs)),
    hydraWasmFetchMs: median(successfulRuns.map((entry) => buildHydraMetrics(entry.hydraSnapshot).hydraWasmFetchMs)),
    hydraThreeBuildMs: median(successfulRuns.map((entry) => buildHydraMetrics(entry.hydraSnapshot).hydraThreeBuildMs)),
    networkTransferBytes: median(successfulRuns.map((entry) => Number(entry.network?.totalTransferBytes || 0))),
    stageTransferBytes: median(successfulRuns.map((entry) => Number(entry.network?.stageTransferBytes || 0))),
    wasmTransferBytes: median(successfulRuns.map((entry) => Number(entry.network?.wasmTransferBytes || 0))),
    dataTransferBytes: median(successfulRuns.map((entry) => Number(entry.network?.dataTransferBytes || 0))),
  };

  const output = {
    generatedAtUtc: new Date().toISOString(),
    server: options.server,
    model: ensureModelPath(options.model),
    runs: options.runs,
    successfulRuns: successfulRuns.length,
    metricsMedian,
    runResults: results,
  };

  await writeFile(path.resolve(options.output), `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  process.stdout.write(`[pipeline] output=${path.resolve(options.output)}\n`);
  process.stdout.write(
    `[pipeline] summary success=${successfulRuns.length}/${options.runs} median_all=${metricsMedian.allMeshReadyMs ?? "n/a"}ms median_joint=${metricsMedian.jointMoveVerifiedMs ?? "n/a"}ms median_commit=${metricsMedian.hydraCommitMs ?? "n/a"}ms\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
