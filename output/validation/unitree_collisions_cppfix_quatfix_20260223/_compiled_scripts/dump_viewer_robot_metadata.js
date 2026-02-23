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
        await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
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
            return true;
        }, { expectVisuals: options.showVisuals, expectCollisions: options.showCollisions }, { timeout: options.timeoutMs });
        await page.evaluate(async () => {
            const renderInterface = window.renderInterface;
            if (!renderInterface)
                return;
            const stageSourcePath = renderInterface?.getStageSourcePath?.() || null;
            const starter = renderInterface?.startRobotMetadataWarmupForStage;
            if (typeof starter === "function") {
                try {
                    const maybePromise = stageSourcePath
                        ? starter.call(renderInterface, stageSourcePath, { force: true })
                        : starter.call(renderInterface, { force: true });
                    if (maybePromise && typeof maybePromise.then === "function") {
                        await maybePromise;
                    }
                }
                catch { }
            }
        });
        await page.waitForFunction(() => {
            const renderInterface = window.renderInterface;
            const getter = renderInterface?.getCachedRobotMetadataSnapshot;
            if (typeof getter !== "function")
                return false;
            const stageSourcePath = renderInterface?.getStageSourcePath?.() || null;
            const snapshot = stageSourcePath
                ? getter.call(renderInterface, stageSourcePath)
                : getter.call(renderInterface, null);
            return !!snapshot;
        }, undefined, { timeout: options.timeoutMs });
        if (options.settleMs > 0) {
            await page.waitForTimeout(options.settleMs);
        }
        const payload = await page.evaluate(() => {
            const renderInterface = window.renderInterface;
            const stageSourcePath = renderInterface?.getStageSourcePath?.() || null;
            const snapshot = renderInterface?.getCachedRobotMetadataSnapshot?.(stageSourcePath || null) || null;
            const rawJoints = Array.isArray(snapshot?.jointCatalogEntries) ? snapshot.jointCatalogEntries : [];
            const joints = rawJoints
                .map((entry) => ({
                linkPath: String(entry?.linkPath || ""),
                jointPath: String(entry?.jointPath || ""),
                jointName: String(entry?.jointName || ""),
                jointType: String(entry?.jointType || ""),
                parentLinkPath: entry?.parentLinkPath ? String(entry.parentLinkPath) : null,
                axisToken: String(entry?.axisToken || ""),
                axisLocal: Array.isArray(entry?.axisLocal) ? entry.axisLocal.map((value) => Number(value)) : null,
                lowerLimitDeg: Number(entry?.lowerLimitDeg),
                upperLimitDeg: Number(entry?.upperLimitDeg),
                localPivotInLink: Array.isArray(entry?.localPivotInLink) ? entry.localPivotInLink.map((value) => Number(value)) : null,
            }))
                .sort((left, right) => String(left.linkPath || "").localeCompare(String(right.linkPath || "")));
            return {
                generated_at: new Date().toISOString(),
                stage_source_path: stageSourcePath,
                snapshot_source: String(snapshot?.source || ""),
                joint_count: joints.length,
                joints,
            };
        });
        const outputPath = path.resolve(options.output);
        await (0, promises_1.mkdir)(path.dirname(outputPath), { recursive: true });
        await (0, promises_1.writeFile)(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
        process.stdout.write(`URL: ${viewerUrl}\n`);
        process.stdout.write(`Output: ${outputPath}\n`);
        process.stdout.write(`Summary: joint_count=${payload.joint_count}\n`);
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
