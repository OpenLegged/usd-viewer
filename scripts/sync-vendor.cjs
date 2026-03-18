#!/usr/bin/env node

const { cp, mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const hydraSharedCacheKey = "20260318a";

async function syncThreeVendorFiles() {
  const publicVendorRoot = path.resolve("public", "vendor");
  const threeSourceRoot = path.resolve("node_modules", "three");
  const threeDestRoot = path.join(publicVendorRoot, "three");

  await mkdir(path.join(threeDestRoot, "build"), { recursive: true });
  await mkdir(path.join(threeDestRoot, "examples"), { recursive: true });

  await cp(
    path.join(threeSourceRoot, "build"),
    path.join(threeDestRoot, "build"),
    { recursive: true, force: true },
  );
  await cp(
    path.join(threeSourceRoot, "examples", "jsm"),
    path.join(threeDestRoot, "examples", "jsm"),
    { recursive: true, force: true },
  );
}

async function syncUsdTextParserVendorFiles() {
  const publicVendorRoot = path.resolve("public", "vendor");
  const usdTextParserSourceRoot = path.resolve("packages", "usd-text-parser", "dist");
  const usdTextParserDestRoot = path.join(publicVendorRoot, "usd-text-parser");

  await mkdir(usdTextParserDestRoot, { recursive: true });
  await cp(
    path.join(usdTextParserSourceRoot, "index.js"),
    path.join(usdTextParserDestRoot, "index.js"),
    { force: true },
  );
}

async function patchHydraGeneratedImports() {
  const sharedJsPath = path.resolve("usd-wasm", "src", "hydra", "render-delegate", "shared.js");
  const sharedXformJsPath = path.resolve("usd-wasm", "src", "hydra", "render-delegate", "shared-xform.js");

  const sharedJsSource = await readFile(sharedJsPath, "utf8");
  const patchedSharedJsSource = sharedJsSource
    .replace("export * from './shared-basic.js';", `export * from './shared-basic.js?v=${hydraSharedCacheKey}';`)
    .replace("export * from './shared-xform.js';", `export * from './shared-xform.js?v=${hydraSharedCacheKey}';`);
  if (patchedSharedJsSource !== sharedJsSource) {
    await writeFile(sharedJsPath, patchedSharedJsSource, "utf8");
  }

  const sharedXformJsSource = await readFile(sharedXformJsPath, "utf8");
  const patchedSharedXformJsSource = sharedXformJsSource.replace(
    "from './shared-basic.js';",
    `from './shared-basic.js?v=${hydraSharedCacheKey}';`,
  );
  if (patchedSharedXformJsSource !== sharedXformJsSource) {
    await writeFile(sharedXformJsPath, patchedSharedXformJsSource, "utf8");
  }
}

Promise.all([
  syncThreeVendorFiles(),
  syncUsdTextParserVendorFiles(),
  patchHydraGeneratedImports(),
]).catch((error) => {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
