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
            if (/\/(?:collisions|colliders)(?:[/.]|$)/i.test(lowered)) return "collision";
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

    const waitForStableMeshTopology = async (timeoutMs: number): Promise<void> => {
      await page.waitForFunction(
        ({ noGeometryPatternSource }) => {
          const renderInterface = (window as any).renderInterface;
          const message = String((document.querySelector("#message-log") as HTMLElement | null)?.textContent || "").trim();
          const noGeometryPattern = new RegExp(noGeometryPatternSource, "i");
          if (noGeometryPattern.test(message)) return true;
          if (!renderInterface?.meshes) return false;

          const meshIds = Object.keys(renderInterface.meshes || {}).sort();
          if (meshIds.length === 0) return false;

          const signature = JSON.stringify({
            message,
            meshIds,
          });
          const stateKey = "__viewerDumpStableMeshTopology";
          const now = Date.now();
          const previousState = (window as any)[stateKey] || null;
          if (!previousState || previousState.signature !== signature) {
            (window as any)[stateKey] = {
              signature,
              stableSinceMs: now,
            };
            return false;
          }

          const stableForMs = now - Number(previousState.stableSinceMs || now);
          const hasTerminalMessage = /loaded\s+\d+\s+meshes/i.test(message);
          const isTransientMessage = /finishing load|applying transform\/collision fixes/i.test(message);
          if (hasTerminalMessage && stableForMs >= 500) return true;
          if (!isTransientMessage && stableForMs >= 1500) return true;
          return false;
        },
        { noGeometryPatternSource: noGeometryMessagePattern.source },
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

    try {
      await waitForStableMeshTopology(Math.min(20_000, options.timeoutMs));
    } catch {}

    const payload = await page.evaluate(String.raw`(() => {
      const showVisuals = ${JSON.stringify(options.showVisuals)};
      const showCollisions = ${JSON.stringify(options.showCollisions)};
      const win = window;
      const renderInterface = win.renderInterface;
      const stage = win.usdStage;
      const classifyCategory = (meshId) => {
        const loweredMeshId = String(meshId || "").toLowerCase();
        if (/\/(?:collisions|colliders)(?:[/.]|$)/i.test(loweredMeshId)) return "collision";
        if (/\/visuals(?:[/.]|$)/i.test(loweredMeshId)) return "visual";
        return "other";
      };
      const toMatrixArray = (matrix) => {
        if (!matrix?.elements) return null;
        return Array.from(matrix.elements);
      };
      const getMatrixMaxElementDelta = (left, right) => {
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
      const readBounds = (geometry) => {
        if (!geometry) return null;
        try {
          if (!geometry.boundingBox && typeof geometry.computeBoundingBox === "function") {
            geometry.computeBoundingBox();
          }
          const bounds = geometry.boundingBox;
          if (!bounds?.min || !bounds?.max) return null;
          const min = [Number(bounds.min.x), Number(bounds.min.y), Number(bounds.min.z)];
          const max = [Number(bounds.max.x), Number(bounds.max.y), Number(bounds.max.z)];
          const size = [
            Number(bounds.max.x - bounds.min.x),
            Number(bounds.max.y - bounds.min.y),
            Number(bounds.max.z - bounds.min.z),
          ];
          const allFinite = [...min, ...max, ...size].every((value) => Number.isFinite(value));
          if (!allFinite) return null;
          return { min, max, size };
        } catch {
          return null;
        }
      };

      const meshRecords = [];
      const stageSourcePath = renderInterface?.getStageSourcePath?.() || null;
      const sceneSnapshot = typeof renderInterface?.getCachedRobotSceneSnapshot === "function"
        ? renderInterface.getCachedRobotSceneSnapshot(stageSourcePath)
        : null;
      const snapshotDescriptorByMeshId = new Map();
      const snapshotPositions = sceneSnapshot?.buffers?.positions || null;
      if (Array.isArray(sceneSnapshot?.render?.meshDescriptors)) {
        for (const descriptor of sceneSnapshot.render.meshDescriptors) {
          const meshId = String(descriptor?.meshId || "").trim();
          if (!meshId) continue;
          snapshotDescriptorByMeshId.set(meshId, descriptor);
        }
      }
      const readSnapshotBounds = (meshId) => {
        const descriptor = snapshotDescriptorByMeshId.get(String(meshId || "").trim());
        const range = descriptor?.ranges?.positions;
        if (!descriptor || !range || !snapshotPositions || typeof snapshotPositions.length !== "number") return null;
        const offset = Number(range.offset);
        const count = Number(range.count);
        const stride = Math.max(1, Number(range.stride || 3));
        if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(count) || count < 3) return null;
        const end = Math.min(snapshotPositions.length, offset + count);
        if (end - offset < 3) return null;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;
        for (let index = offset; index + 2 < end; index += stride) {
          const x = Number(snapshotPositions[index + 0]);
          const y = Number(snapshotPositions[index + 1]);
          const z = Number(snapshotPositions[index + 2]);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(minZ)
          || !Number.isFinite(maxX) || !Number.isFinite(maxY) || !Number.isFinite(maxZ)) {
          return null;
        }
        return {
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ],
          size: [maxX - minX, maxY - minY, maxZ - minZ],
          vertex_count: Math.max(0, Math.floor(Number(descriptor?.geometry?.numVertices || 0) || Math.floor((end - offset) / Math.max(1, stride)))),
          index_count: Math.max(0, Math.floor(Number(descriptor?.geometry?.numIndices || 0))),
        };
      };
      const usdRootMatrixWorld = win?.usdRoot?.matrixWorld || null;
      const toStageSpaceWorldMatrix = (matrix) => {
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
        const category = classifyCategory(meshId);

        const meshObject = hydraMesh?._mesh || null;
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

        const rawWorldMatrix = meshObject?.matrixWorld || meshObject?.matrix || null;
        const rawStageSpaceWorldMatrix = toStageSpaceWorldMatrix(rawWorldMatrix);
        const preferRawVisualProtoWorld = isVisualProtoMeshId && hydraMesh?._hasCompletedProtoSync === true;
        const collisionOverrideApplied = isCollisionProtoMeshId && hydraMesh?._appliedCollisionOverride === true;
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
        const snapshotBounds = readSnapshotBounds(meshId);
        const geometryBounds = readBounds(geometry);
        const vertexCount = Number(geometry?.getAttribute?.("position")?.count || snapshotBounds?.vertex_count || 0);
        const indexCount = Number(geometry?.index?.count || snapshotBounds?.index_count || 0);
        meshRecords.push({
          id: meshId,
          category,
          resolved_path: resolvedPath,
          resolved_collision_path: resolvedCollisionPath,
          resolved_visual_path: resolvedVisualPath,
          world_matrix: toMatrixArray(effectiveWorldMatrix),
          stage_resolved_matrix: toMatrixArray(stageResolvedMatrix),
          fallback_link_matrix: toMatrixArray(fallbackLinkMatrix),
          local_bounds: geometryBounds || (snapshotBounds ? {
            min: snapshotBounds.min,
            max: snapshotBounds.max,
            size: snapshotBounds.size,
          } : null),
          geometry_type: String(geometry?.type || (snapshotBounds ? "SnapshotGeometry" : "")),
          primitive_fallback_type: hydraMesh?._primitiveFallbackType || null,
          vertex_count: vertexCount,
          index_count: indexCount,
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
    })()`);

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
