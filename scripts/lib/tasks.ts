import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

import { runCommand } from "./run-command.ts";

async function syncBrowserVendorDeps(): Promise<void> {
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

export async function buildProject(): Promise<void> {
  await runCommand("npx", ["tsc", "-p", "tsconfig.json"]);
  await syncBrowserVendorDeps();
}
