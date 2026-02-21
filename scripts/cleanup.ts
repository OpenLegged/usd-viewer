import { handleFatalError } from "./lib/fatal.ts";
import { cleanupHeadlessBrowserProcesses } from "./lib/cleanup-headless.ts";

async function main(): Promise<void> {
  await cleanupHeadlessBrowserProcesses();
}

main().catch(handleFatalError);
