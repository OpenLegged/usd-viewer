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
    output: "output/dev/viewer_collision_dump.json",
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
  // Force deterministic one-shot load path while dumping mesh/collision state.
  url.searchParams.set("strictOneShot", "1");
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
  const terminalMessagePattern = /(?:loaded\s+\d+\s+meshes|no geometry loaded|contains no renderable meshes|both visual and collision meshes are disabled|failed to initialize usd renderer|cannot find usd file)/i;
  const noGeometryMessagePattern = /(?:no geometry loaded|contains no renderable meshes|both visual and collision meshes are disabled)/i;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(options.timeoutMs);

  try {
    const waitForLoadCompletionSignal = async (): Promise<void> => {
      await page.waitForFunction(
        ({ terminalPatternSource }) => {
          const renderInterface = (window as any).renderInterface;
          if (!renderInterface) return false;
          const stageSourcePath = String(renderInterface?.getStageSourcePath?.() || "").trim();
          const message = String((document.querySelector("#message-log") as HTMLElement | null)?.textContent || "").trim();
          const terminalPattern = new RegExp(terminalPatternSource, "i");
          if (terminalPattern.test(message)) return true;
          return !!(window as any).usdStage && stageSourcePath.length > 0;
        },
        { terminalPatternSource: terminalMessagePattern.source },
        { timeout: options.timeoutMs },
      );
    };

    const waitForRequestedMeshReadiness = async (timeoutMs: number): Promise<void> => {
      await page.waitForFunction(
        ({ expectVisuals, expectCollisions, noGeometryPatternSource }) => {
          const renderInterface = (window as any).renderInterface;
          const message = String((document.querySelector("#message-log") as HTMLElement | null)?.textContent || "").trim();
          const noGeometryPattern = new RegExp(noGeometryPatternSource, "i");
          if (noGeometryPattern.test(message)) return true;
          if (!renderInterface?.meshes) return false;
          const meshEntries = Object.entries(renderInterface.meshes || {});
          if (meshEntries.length === 0) return false;

          const classifyCategory = (meshId: string): "visual" | "collision" | "other" => {
            const lowered = String(meshId || "").toLowerCase();
            if (/\/collisions(?:[/.]|$)/i.test(lowered)) return "collision";
            if (/\/visuals(?:[/.]|$)/i.test(lowered)) return "visual";
            return "other";
          };

          const visualEntries = meshEntries.filter(([meshId]) => classifyCategory(meshId) === "visual");
          const collisionEntries = meshEntries.filter(([meshId]) => classifyCategory(meshId) === "collision");
          const hasExplicitCollisionEntries = collisionEntries.length > 0;
          const targetEntries = (() => {
            if (expectVisuals && expectCollisions) return meshEntries;
            if (expectVisuals) return visualEntries.length > 0 ? visualEntries : meshEntries;
            if (expectCollisions) return collisionEntries.length > 0 ? collisionEntries : meshEntries;
            return meshEntries;
          })();
          if (targetEntries.length === 0) return false;

          const readyCount = targetEntries.filter(([, hydraMesh]) => {
            const geometry = (hydraMesh as any)?._mesh?.geometry;
            const positionAttribute = geometry?.getAttribute?.("position");
            return !!positionAttribute && positionAttribute.count > 0;
          }).length;
          const collisionOverrideReadyCount = targetEntries.filter(([meshId, hydraMesh]) => {
            if (!hasExplicitCollisionEntries) return true;
            const category = classifyCategory(meshId);
            if (category !== "collision" || !expectCollisions) return true;
            const resolvedCollisionPath = renderInterface?.getResolvedPrimPathForMeshId?.(meshId) || null;
            if (!resolvedCollisionPath) return true;
            return !!(hydraMesh as any)?._appliedCollisionOverride;
          }).length;

          return (
            readyCount >= Math.max(1, Math.floor(targetEntries.length * 0.8))
            && collisionOverrideReadyCount >= Math.max(1, Math.floor(targetEntries.length * 0.8))
          );
        },
        {
          expectVisuals: options.showVisuals,
          expectCollisions: options.showCollisions,
          noGeometryPatternSource: noGeometryMessagePattern.source,
        },
        { timeout: timeoutMs },
      );
    };

    await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    await waitForLoadCompletionSignal();
    try {
      await waitForRequestedMeshReadiness(Math.min(30_000, options.timeoutMs));
    } catch {}

    if (options.settleMs > 0) {
      await page.waitForTimeout(options.settleMs);
      // Scene can transiently clear during visual/collision upgrade reload.
      // Re-check readiness after settling so the snapshot captures final state.
      try {
        await waitForRequestedMeshReadiness(Math.min(15_000, options.timeoutMs));
      } catch {}
    }

    const payload = await page.evaluate(({ showVisuals, showCollisions }) => {
      const renderInterface = (window as any).renderInterface;
      const stage = (window as any).usdStage;
      const classifyCategory = (meshId: string): "visual" | "collision" | "other" => {
        const loweredMeshId = String(meshId || "").toLowerCase();
        if (/\/collisions(?:[/.]|$)/i.test(loweredMeshId)) return "collision";
        if (/\/visuals(?:[/.]|$)/i.test(loweredMeshId)) return "visual";
        if (showVisuals && !showCollisions) return "visual";
        if (showCollisions && !showVisuals) return "collision";
        return "other";
      };
      const toMatrixArray = (matrix: any): number[] | null => {
        if (!matrix?.elements) return null;
        return Array.from(matrix.elements);
      };
      const getMatrixMaxElementDelta = (left: any, right: any): number => {
        const leftElements = left?.elements;
        const rightElements = right?.elements;
        if (!leftElements || !rightElements) return Number.POSITIVE_INFINITY;
        let maxDelta = 0;
        for (let index = 0; index < 16; index += 1) {
          const lhs = Number(leftElements[index]);
          const rhs = Number(rightElements[index]);
          if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) return Number.POSITIVE_INFINITY;
          const delta = Math.abs(lhs - rhs);
          if (delta > maxDelta) maxDelta = delta;
        }
        return maxDelta;
      };
      const readBounds = (geometry: any): { min: number[]; max: number[]; size: number[] } | null => {
        if (!geometry) return null;
        try {
          if (!geometry.boundingBox && typeof geometry.computeBoundingBox === "function") {
            geometry.computeBoundingBox();
          }
          const bounds = geometry.boundingBox;
          if (!bounds?.min || !bounds?.max) return null;
          return {
            min: [Number(bounds.min.x), Number(bounds.min.y), Number(bounds.min.z)],
            max: [Number(bounds.max.x), Number(bounds.max.y), Number(bounds.max.z)],
            size: [
              Number(bounds.max.x - bounds.min.x),
              Number(bounds.max.y - bounds.min.y),
              Number(bounds.max.z - bounds.min.z),
            ],
          };
        } catch {
          return null;
        }
      };

      const meshRecords: Array<Record<string, unknown>> = [];
      const usdRootMatrixWorld = (window as any)?.usdRoot?.matrixWorld || null;
      const toStageSpaceWorldMatrix = (matrix: any): any => {
        if (!matrix || typeof matrix.clone !== "function") return matrix || null;
        const clonedMatrix = matrix.clone();
        if (!usdRootMatrixWorld || typeof usdRootMatrixWorld.clone !== "function") {
          return clonedMatrix;
        }
        try {
          const inverseRoot = usdRootMatrixWorld.clone();
          if (typeof inverseRoot.invert === "function") {
            inverseRoot.invert();
          } else if (typeof inverseRoot.getInverse === "function") {
            inverseRoot.getInverse(usdRootMatrixWorld);
          } else {
            return clonedMatrix;
          }
          return inverseRoot.multiply(clonedMatrix);
        } catch {
          return clonedMatrix;
        }
      };
      for (const [meshId, hydraMesh] of Object.entries(renderInterface?.meshes || {})) {
        const category: "visual" | "collision" | "other" = classifyCategory(meshId);

        const meshObject = (hydraMesh as any)?._mesh || null;
        const resolvedCollisionPath = category === "collision"
          ? renderInterface?.getResolvedPrimPathForMeshId?.(meshId) || null
          : null;
        const resolvedVisualPath = category === "visual"
          ? renderInterface?.getResolvedVisualTransformPrimPathForMeshId?.(meshId) || null
          : null;
        const resolvedPath = resolvedCollisionPath || resolvedVisualPath || null;
        const stageResolvedMatrix = resolvedPath ? renderInterface?.getWorldTransformForPrimPath?.(resolvedPath) || null : null;
        const fallbackLinkMatrix = renderInterface?.getFallbackTransformForMeshId?.(meshId) || null;
        const geometry = meshObject?.geometry || null;
        const isProtoMeshId = String(meshId || "").includes(".proto_");
        const isVisualProtoMeshId = isProtoMeshId && category === "visual";
        const isCollisionProtoMeshId = isProtoMeshId && category === "collision";

        // In this render path, prim/link world transforms can be available before mesh world matrices are updated.
        const rawWorldMatrix = meshObject?.matrixWorld || meshObject?.matrix || null;
        const rawStageSpaceWorldMatrix = toStageSpaceWorldMatrix(rawWorldMatrix);
        // Prefer stage-resolved transforms whenever a semantic prim path is available.
        // Raw matrixWorld can include scene-level up-axis presentation transforms
        // (e.g. root -90deg X) that should not be part of stage-truth comparisons.
        const preferRawVisualProtoWorld = isVisualProtoMeshId && (hydraMesh as any)?._hasCompletedProtoSync === true;
        const collisionOverrideApplied = isCollisionProtoMeshId && (hydraMesh as any)?._appliedCollisionOverride === true;
        const rawVsStageResolvedDelta = getMatrixMaxElementDelta(rawStageSpaceWorldMatrix, stageResolvedMatrix);
        const preferRawCollisionProtoWorld = category === "collision" && (
          collisionOverrideApplied
          || (isProtoMeshId && (!stageResolvedMatrix || rawVsStageResolvedDelta > 1e-4))
        );
        const shouldPreferStageWorldMatrix = category === "collision"
          ? ((!!resolvedPath || isProtoMeshId) && !preferRawCollisionProtoWorld)
          : (!!resolvedPath && !preferRawVisualProtoWorld);
        const effectiveWorldMatrix = shouldPreferStageWorldMatrix
          ? (stageResolvedMatrix || rawStageSpaceWorldMatrix || fallbackLinkMatrix || rawWorldMatrix)
          : (rawStageSpaceWorldMatrix || stageResolvedMatrix || fallbackLinkMatrix || rawWorldMatrix);
        meshRecords.push({
          id: meshId,
          category,
          resolved_path: resolvedPath,
          resolved_collision_path: resolvedCollisionPath,
          resolved_visual_path: resolvedVisualPath,
          world_matrix: toMatrixArray(effectiveWorldMatrix),
          stage_resolved_matrix: toMatrixArray(stageResolvedMatrix),
          fallback_link_matrix: toMatrixArray(fallbackLinkMatrix),
          local_bounds: readBounds(geometry),
          geometry_type: String(geometry?.type || ""),
          primitive_fallback_type: (hydraMesh as any)?._primitiveFallbackType || null,
          vertex_count: Number(geometry?.getAttribute?.("position")?.count || 0),
          index_count: Number(geometry?.index?.count || 0),
          visible: !!meshObject?.visible,
        });
      }

      meshRecords.sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
      const collisionRecords = meshRecords.filter((entry) => entry.category === "collision");
      const visualRecords = meshRecords.filter((entry) => entry.category === "visual");
      return {
        generated_at: new Date().toISOString(),
        stage_source_path: renderInterface?.getStageSourcePath?.() || null,
        usd_stage_default_prim: stage?.GetDefaultPrim?.()?.GetPath?.()?.pathString || null,
        mesh_count: Object.keys(renderInterface?.meshes || {}).length,
        visual_count: visualRecords.length,
        collision_count: collisionRecords.length,
        meshes: meshRecords,
        visuals: visualRecords,
        collisions: collisionRecords,
      };
    }, {
      showVisuals: options.showVisuals,
      showCollisions: options.showCollisions,
    });

    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

    process.stdout.write(`URL: ${viewerUrl}\n`);
    process.stdout.write(`Output: ${outputPath}\n`);
    process.stdout.write(
      `Summary: meshes=${payload.mesh_count}, visuals=${payload.visual_count}, collisions=${payload.collision_count}\n`,
    );
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
