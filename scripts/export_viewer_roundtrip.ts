#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { chromium } from "playwright";

type ExportOptions = {
  server: string;
  file: string;
  output: string;
  timeoutMs: number;
  settleMs: number;
  flattenStage: boolean;
};

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const lowered = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(lowered)) return true;
  if (["0", "false", "no", "off"].includes(lowered)) return false;
  return fallback;
}

function parseArgs(argv: string[]): ExportOptions {
  const defaults: ExportOptions = {
    server: "http://127.0.0.1:3003",
    file: "",
    output: "output/dev/viewer_roundtrip_export.json",
    timeoutMs: 180_000,
    settleMs: 1_500,
    flattenStage: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--server" && next) {
      defaults.server = next;
      index += 1;
    } else if (token === "--file" && next) {
      defaults.file = next;
      index += 1;
    } else if (token === "--output" && next) {
      defaults.output = next;
      index += 1;
    } else if (token === "--timeout-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) defaults.timeoutMs = parsed;
      index += 1;
    } else if (token === "--settle-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) defaults.settleMs = parsed;
      index += 1;
    } else if (token === "--flatten-stage" && next) {
      defaults.flattenStage = parseBooleanFlag(next, defaults.flattenStage);
      index += 1;
    }
  }

  if (!defaults.file) {
    throw new Error("Missing required argument: --file /unitree_model/.../robot.usd");
  }
  return defaults;
}

function createViewerUrl(options: ExportOptions): string {
  const root = options.server.endsWith("/") ? options.server.slice(0, -1) : options.server;
  const url = new URL(`${root}/`);
  url.searchParams.set("file", options.file);
  url.searchParams.set("showVisuals", "1");
  url.searchParams.set("showCollisions", "1");
  url.searchParams.set("strictOneShot", "1");
  url.searchParams.set("sceneSnapshotMode", "1");
  url.searchParams.set("twoPassSelectionUpgrade", "0");
  url.searchParams.set("preloadHiddenPrims", "1");
  url.searchParams.set("deferStageOverrides", "0");
  url.searchParams.set("resolveRobotMetadataBeforeReady", "1");
  url.searchParams.set("prefetchProtoDataBlobsBeforeDraw", "1");
  url.searchParams.set("prefetchProtoDataBlobsMode", "immediate");
  url.searchParams.set("prefetchProtoDataBlobsStartDelayMs", "0");
  url.searchParams.set("showLinkAxes", "0");
  url.searchParams.set("showDynamics", "0");
  url.searchParams.set("showRobotInspector", "0");
  url.searchParams.set("readStageMetadata", "1");
  return url.toString();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const viewerUrl = createViewerUrl(options);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(options.timeoutMs);

  try {
    await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    await page.waitForFunction(() => {
      const renderInterface = (window as any).renderInterface;
      if (!renderInterface || typeof renderInterface.exportLoadedStageSnapshot !== "function") return false;
      const meshes = Object.keys(renderInterface?.meshes || {});
      const snapshot = renderInterface.getCachedRobotSceneSnapshot?.(renderInterface.getStageSourcePath?.() || null) || null;
      return meshes.length > 0 || !!snapshot || !!(window as any).usdStage;
    }, undefined, { timeout: options.timeoutMs });

    if (options.settleMs > 0) {
      await page.waitForTimeout(options.settleMs);
    }

    const payload = await page.evaluate(async ({ flattenStage }) => {
      const exporter = (window as any).exportLoadedStageSnapshot;
      if (typeof exporter !== "function") {
        return { ok: false, error: "exporter-missing" };
      }
      return await exporter({
        flattenStage,
        persistToServer: true,
        overwrite: true,
      });
    }, { flattenStage: options.flattenStage });

    if (!payload || payload.ok !== true) {
      throw new Error(`Roundtrip export failed: ${String(payload?.error || "unknown-error")}`);
    }

    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

    process.stdout.write(`URL: ${viewerUrl}\n`);
    process.stdout.write(`Output: ${outputPath}\n`);
    process.stdout.write(`Exported USD: ${String(payload.filePath || payload.outputVirtualPath || payload.outputFileName || "<unknown>")}\n`);
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
