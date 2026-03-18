#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { chromium } from "playwright";

type DumpOptions = {
  server: string;
  file: string;
  output: string;
  timeoutMs: number;
  settleMs: number;
  showVisuals: boolean;
  showCollisions: boolean;
};

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const lowered = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(lowered)) return true;
  if (["0", "false", "no", "off"].includes(lowered)) return false;
  return fallback;
}

function parseArgs(argv: string[]): DumpOptions {
  const defaults: DumpOptions = {
    server: "http://127.0.0.1:3003",
    file: "",
    output: "output/dev/viewer_robot_metadata.json",
    timeoutMs: 180_000,
    settleMs: 1_500,
    showVisuals: true,
    showCollisions: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--server" && next) {
      defaults.server = next;
      i += 1;
    } else if (token === "--file" && next) {
      defaults.file = next;
      i += 1;
    } else if (token === "--output" && next) {
      defaults.output = next;
      i += 1;
    } else if (token === "--timeout-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) defaults.timeoutMs = parsed;
      i += 1;
    } else if (token === "--settle-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) defaults.settleMs = parsed;
      i += 1;
    } else if (token === "--show-visuals" && next) {
      defaults.showVisuals = parseBooleanFlag(next, defaults.showVisuals);
      i += 1;
    } else if (token === "--show-collisions" && next) {
      defaults.showCollisions = parseBooleanFlag(next, defaults.showCollisions);
      i += 1;
    }
  }

  if (!defaults.file) {
    throw new Error("Missing required argument: --file /unitree_model/.../robot.usd");
  }

  return defaults;
}

function createViewerUrl(options: DumpOptions): string {
  const root = options.server.endsWith("/") ? options.server.slice(0, -1) : options.server;
  const url = new URL(`${root}/`);
  url.searchParams.set("file", options.file);
  url.searchParams.set("showVisuals", options.showVisuals ? "1" : "0");
  url.searchParams.set("showCollisions", options.showCollisions ? "1" : "0");
  // Force deterministic one-shot load path to avoid async reload/upgrades while dumping metadata.
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

function isExecutionContextDestroyed(error: unknown): boolean {
  const message = error instanceof Error ? (error.stack || error.message) : String(error || "");
  return message.includes("Execution context was destroyed");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const viewerUrl = createViewerUrl(options);
  const terminalMessagePattern = /(?:loaded\s+\d+\s+meshes|no geometry loaded|contains no renderable meshes|both visual and collision meshes are disabled|failed to initialize usd renderer|cannot find usd file)/i;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(options.timeoutMs);

  try {
    await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

    await page.waitForFunction(
      ({ terminalPatternSource }) => {
        const renderInterface = (window as any).renderInterface;
        if (!renderInterface) return false;
        const stageSourcePath = String(renderInterface?.getStageSourcePath?.() || "").trim();
        const message = String((document.querySelector("#message-log") as HTMLElement | null)?.textContent || "").trim();
        const terminalPattern = new RegExp(terminalPatternSource, "i");
        if (terminalPattern.test(message)) return true;
        if (!!(window as any).usdStage && stageSourcePath.length > 0) return true;
        const meshEntries = Object.entries(renderInterface?.meshes || {});
        return meshEntries.length > 0;
      },
      { terminalPatternSource: terminalMessagePattern.source },
      { timeout: options.timeoutMs },
    );

    const maxSnapshotAttempts = 3;
    for (let attempt = 1; attempt <= maxSnapshotAttempts; attempt++) {
      try {
        await page.evaluate(async () => {
          const renderInterface = (window as any).renderInterface;
          if (!renderInterface) return;
          const stageSourcePath = renderInterface?.getStageSourcePath?.() || null;
          const starter = renderInterface?.startRobotMetadataWarmupForStage;
          if (typeof starter === "function") {
            try {
              const maybePromise = stageSourcePath
                ? starter.call(renderInterface, stageSourcePath, { force: true, skipIdleWait: true, skipUrdfTruthFallback: true })
                : starter.call(renderInterface, { force: true, skipIdleWait: true, skipUrdfTruthFallback: true });
              if (maybePromise && typeof maybePromise.then === "function") {
                await maybePromise;
              }
            } catch {}
          }
        });

        await page.waitForFunction(
          () => {
            const renderInterface = (window as any).renderInterface;
            const getter = renderInterface?.getCachedRobotMetadataSnapshot;
            if (typeof getter !== "function") return false;
            const stageSourcePath = renderInterface?.getStageSourcePath?.() || null;
            const snapshot = stageSourcePath
              ? getter.call(renderInterface, stageSourcePath)
              : getter.call(renderInterface, null);
            return !!snapshot;
          },
          undefined,
          { timeout: options.timeoutMs },
        );
        break;
      } catch (error) {
        if (!isExecutionContextDestroyed(error) || attempt >= maxSnapshotAttempts) {
          throw error;
        }
        await page.waitForLoadState("domcontentloaded", { timeout: options.timeoutMs });
        await page.waitForTimeout(250);
      }
    }

    if (options.settleMs > 0) {
      await page.waitForTimeout(options.settleMs);
    }

    const payload = await page.evaluate(() => {
      const renderInterface = (window as any).renderInterface;
      const stageSourcePath = renderInterface?.getStageSourcePath?.() || null;
      const snapshot = renderInterface?.getCachedRobotMetadataSnapshot?.(stageSourcePath || null) || null;
      const rawJoints = Array.isArray(snapshot?.jointCatalogEntries) ? snapshot.jointCatalogEntries : [];
      const rawLinkDynamics = Array.isArray(snapshot?.linkDynamicsEntries) ? snapshot.linkDynamicsEntries : [];
      const joints = rawJoints
        .map((entry: any) => ({
          linkPath: String(entry?.linkPath || entry?.childLinkPath || ""),
          childLinkPath: String(entry?.childLinkPath || entry?.linkPath || ""),
          jointPath: String(entry?.jointPath || ""),
          jointName: String(entry?.jointName || ""),
          jointType: String(entry?.jointType || ""),
          parentLinkPath: entry?.parentLinkPath ? String(entry.parentLinkPath) : null,
          axisToken: String(entry?.axisToken || ""),
          axisLocal: Array.isArray(entry?.axisLocal) ? entry.axisLocal.map((value: any) => Number(value)) : null,
          lowerLimitDeg: Number(entry?.lowerLimitDeg),
          upperLimitDeg: Number(entry?.upperLimitDeg),
          localPivotInLink: Array.isArray(entry?.localPivotInLink) ? entry.localPivotInLink.map((value: any) => Number(value)) : null,
        }))
        .sort((left: any, right: any) => String(left.linkPath || "").localeCompare(String(right.linkPath || "")));

      const linkDynamics = rawLinkDynamics
        .map((entry: any) => ({
          linkPath: String(entry?.linkPath || ""),
          mass: Number.isFinite(Number(entry?.mass)) ? Number(entry.mass) : null,
          centerOfMassLocal: Array.isArray(entry?.centerOfMassLocal)
            ? entry.centerOfMassLocal.map((value: any) => Number(value))
            : [0, 0, 0],
          diagonalInertia: Array.isArray(entry?.diagonalInertia)
            ? entry.diagonalInertia.map((value: any) => Number(value))
            : null,
          principalAxesLocal: Array.isArray(entry?.principalAxesLocal)
            ? entry.principalAxesLocal.map((value: any) => Number(value))
            : (
              Array.isArray(entry?.principalAxesLocalWxyz)
                ? [
                  Number(entry.principalAxesLocalWxyz[1]),
                  Number(entry.principalAxesLocalWxyz[2]),
                  Number(entry.principalAxesLocalWxyz[3]),
                  Number(entry.principalAxesLocalWxyz[0]),
                ]
                : [0, 0, 0, 1]
            ),
          principalAxesLocalWxyz: Array.isArray(entry?.principalAxesLocalWxyz)
            ? entry.principalAxesLocalWxyz.map((value: any) => Number(value))
            : null,
        }))
        .sort((left: any, right: any) => String(left.linkPath || "").localeCompare(String(right.linkPath || "")));

      return {
        generated_at: new Date().toISOString(),
        stage_source_path: stageSourcePath,
        snapshot_source: String(snapshot?.source || ""),
        joint_count: joints.length,
        link_dynamics_count: linkDynamics.length,
        joints,
        link_dynamics: linkDynamics,
      };
    });

    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

    process.stdout.write(`URL: ${viewerUrl}\n`);
    process.stdout.write(`Output: ${outputPath}\n`);
    process.stdout.write(`Summary: joint_count=${payload.joint_count}, link_dynamics_count=${payload.link_dynamics_count}\n`);
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
