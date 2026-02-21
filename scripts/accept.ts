import { handleFatalError } from "./lib/fatal.ts";
import { buildProject } from "./lib/tasks.ts";
import { runCommand } from "./lib/run-command.ts";
import { cleanupHeadlessBrowserProcesses } from "./lib/cleanup-headless.ts";

async function main(): Promise<void> {
  let pendingError: unknown = null;

  try {
    await buildProject();
    await runCommand("node", ["--experimental-strip-types", "server.ts"], {
      env: { VALIDATE_ONLY: "1" },
    });
    process.stdout.write("Acceptance checks passed.\n");
  } catch (error) {
    pendingError = error;
  } finally {
    try {
      await cleanupHeadlessBrowserProcesses();
    } catch (cleanupError) {
      if (!pendingError) {
        throw cleanupError;
      }
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      process.stderr.write(`Cleanup warning: ${message}\n`);
    }
  }

  if (pendingError) {
    throw pendingError;
  }
}

main().catch(handleFatalError);
