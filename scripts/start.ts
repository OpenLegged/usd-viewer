import { handleFatalError } from "./lib/fatal.ts";
import { buildProject } from "./lib/tasks.ts";
import { runCommand } from "./lib/run-command.ts";

async function main(): Promise<void> {
  await buildProject();
  await runCommand("node", ["--experimental-strip-types", "server.ts"]);
}

main().catch(handleFatalError);
