import { handleFatalError } from "./lib/fatal.ts";
import { buildProject } from "./lib/tasks.ts";

async function main(): Promise<void> {
  await buildProject();
}

main().catch(handleFatalError);
