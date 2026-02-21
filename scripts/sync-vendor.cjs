#!/usr/bin/env node

const { cp, mkdir } = require("node:fs/promises");
const path = require("node:path");

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

syncThreeVendorFiles().catch((error) => {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
