#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const path = require("node:path");
const playwright_1 = require("playwright");
function parseBooleanFlag(raw, fallback) {
    if (raw === undefined)
        return fallback;
    const lowered = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(lowered))
        return true;
    if (["0", "false", "no", "off"].includes(lowered))
        return false;
    return fallback;
}
function parseArgs(argv) {
    const defaults = {
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
        }
        else if (token === "--file" && next) {
            defaults.file = next;
            i += 1;
        }
        else if (token === "--output" && next) {
            defaults.output = next;
            i += 1;
        }
        else if (token === "--timeout-ms" && next) {
            const parsed = Number(next);
            if (Number.isFinite(parsed) && parsed > 0)
                defaults.timeoutMs = parsed;
            i += 1;
        }
        else if (token === "--settle-ms" && next) {
            const parsed = Number(next);
            if (Number.isFinite(parsed) && parsed >= 0)
                defaults.settleMs = parsed;
            i += 1;
        }
        else if (token === "--show-visuals" && next) {
            defaults.showVisuals = parseBooleanFlag(next, defaults.showVisuals);
            i += 1;
        }
        else if (token === "--show-collisions" && next) {
            defaults.showCollisions = parseBooleanFlag(next, defaults.showCollisions);
            i += 1;
        }
    }
    if (!defaults.file) {
        throw new Error("Missing required argument: --file /unitree_model/.../robot.usd");
    }
    return defaults;
}
function createViewerUrl(options) {
    const root = options.server.endsWith("/") ? options.server.slice(0, -1) : options.server;
    const url = new URL(`${root}/`);
    url.searchParams.set("file", options.file);
    url.searchParams.set("showVisuals", options.showVisuals ? "1" : "0");
    url.searchParams.set("showCollisions", options.showCollisions ? "1" : "0");
    url.searchParams.set("showLinkAxes", "0");
    url.searchParams.set("showDynamics", "0");
    url.searchParams.set("showRobotInspector", "0");
    url.searchParams.set("readStageMetadata", "1");
    return url.toString();
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const viewerUrl = createViewerUrl(options);
    const browser = await playwright_1.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(options.timeoutMs);
    try {
        const waitForRequestedMeshReadiness = async () => {
            await page.waitForFunction(({ expectVisuals, expectCollisions }) => {
                const renderInterface = window.renderInterface;
                if (!renderInterface?.meshes)
                    return false;
                const meshEntries = Object.entries(renderInterface.meshes || {});
                if (meshEntries.length === 0)
                    return false;
                const classifyCategory = (meshId) => {
                    const lowered = String(meshId || "").toLowerCase();
                    if (lowered.includes("/collisions.") || lowered.includes("/collisions/"))
                        return "collision";
                    if (lowered.includes("/visuals.") || lowered.includes("/visuals/"))
                        return "visual";
                    return "other";
                };
                const visualEntries = meshEntries.filter(([meshId]) => classifyCategory(meshId) === "visual");
                const collisionEntries = meshEntries.filter(([meshId]) => classifyCategory(meshId) === "collision");
                if (expectVisuals && visualEntries.length === 0)
                    return false;
                if (expectCollisions && collisionEntries.length === 0)
                    return false;
                const targetEntries = meshEntries.filter(([meshId]) => {
                    const category = classifyCategory(meshId);
                    if (category === "visual" && expectVisuals)
                        return true;
                    if (category === "collision" && expectCollisions)
                        return true;
                    return false;
                });
                if (targetEntries.length === 0)
                    return false;
                const readyCount = targetEntries.filter(([, hydraMesh]) => {
                    const geometry = hydraMesh?._mesh?.geometry;
                    const positionAttribute = geometry?.getAttribute?.("position");
                    return !!positionAttribute && positionAttribute.count > 0;
                }).length;
                const collisionOverrideReadyCount = targetEntries.filter(([meshId, hydraMesh]) => {
                    const category = classifyCategory(meshId);
                    if (category !== "collision" || !expectCollisions)
                        return true;
                    const resolvedCollisionPath = renderInterface?.getResolvedPrimPathForMeshId?.(meshId) || null;
                    if (!resolvedCollisionPath)
                        return true;
                    return !!hydraMesh?._appliedCollisionOverride;
                }).length;
                return (readyCount >= Math.max(1, Math.floor(targetEntries.length * 0.8))
                    && collisionOverrideReadyCount >= Math.max(1, Math.floor(targetEntries.length * 0.8)));
            }, { expectVisuals: options.showVisuals, expectCollisions: options.showCollisions }, { timeout: options.timeoutMs });
        };
        await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
        await waitForRequestedMeshReadiness();
        if (options.settleMs > 0) {
            await page.waitForTimeout(options.settleMs);
            // Scene can transiently clear during visual/collision upgrade reload.
            // Re-check readiness after settling so the snapshot captures final state.
            await waitForRequestedMeshReadiness();
        }
        const payload = await page.evaluate(() => {
            const renderInterface = window.renderInterface;
            const stage = window.usdStage;
            const toMatrixArray = (matrix) => {
                if (!matrix?.elements)
                    return null;
                return Array.from(matrix.elements);
            };
            const readBounds = (geometry) => {
                if (!geometry)
                    return null;
                try {
                    if (!geometry.boundingBox && typeof geometry.computeBoundingBox === "function") {
                        geometry.computeBoundingBox();
                    }
                    const bounds = geometry.boundingBox;
                    if (!bounds?.min || !bounds?.max)
                        return null;
                    return {
                        min: [Number(bounds.min.x), Number(bounds.min.y), Number(bounds.min.z)],
                        max: [Number(bounds.max.x), Number(bounds.max.y), Number(bounds.max.z)],
                        size: [
                            Number(bounds.max.x - bounds.min.x),
                            Number(bounds.max.y - bounds.min.y),
                            Number(bounds.max.z - bounds.min.z),
                        ],
                    };
                }
                catch {
                    return null;
                }
            };
            const meshRecords = [];
            for (const [meshId, hydraMesh] of Object.entries(renderInterface?.meshes || {})) {
                const loweredMeshId = String(meshId || "").toLowerCase();
                let category = "other";
                if (loweredMeshId.includes("/collisions.") || loweredMeshId.includes("/collisions/")) {
                    category = "collision";
                }
                else if (loweredMeshId.includes("/visuals.") || loweredMeshId.includes("/visuals/")) {
                    category = "visual";
                }
                if (category === "other")
                    continue;
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
                // In this render path, prim/link world transforms can be available before mesh world matrices are updated.
                const rawWorldMatrix = meshObject?.matrixWorld || meshObject?.matrix || null;
                const effectiveWorldMatrix = stageResolvedMatrix || fallbackLinkMatrix || rawWorldMatrix;
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
                    primitive_fallback_type: hydraMesh?._primitiveFallbackType || null,
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
        });
        const outputPath = path.resolve(options.output);
        await (0, promises_1.mkdir)(path.dirname(outputPath), { recursive: true });
        await (0, promises_1.writeFile)(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
        process.stdout.write(`URL: ${viewerUrl}\n`);
        process.stdout.write(`Output: ${outputPath}\n`);
        process.stdout.write(`Summary: meshes=${payload.mesh_count}, visuals=${payload.visual_count}, collisions=${payload.collision_count}\n`);
    }
    finally {
        await page.close();
        await browser.close();
    }
}
main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
