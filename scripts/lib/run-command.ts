import { spawn } from "node:child_process";
import path from "node:path";
import { sanitizeOutput } from "./sanitize-output.ts";

export type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  silent?: boolean;
};

const forwardedSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

function getExitCodeForSignal(signal: NodeJS.Signals): number {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    case "SIGHUP":
      return 129;
    default:
      return 1;
  }
}

function safeKillProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ESRCH") {
      return;
    }
    throw error;
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const printableCommand = [command, ...args]
      .map((part) => (part.includes(" ") ? JSON.stringify(part) : part))
      .join(" ");

    const handleChunk = (chunk: unknown, writer: (text: string) => void): void => {
      const text = sanitizeOutput(String(chunk));
      if (!options.silent) {
        writer(text);
      }
    };

    let settled = false;

    const terminateChild = (signal: NodeJS.Signals): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (!child.pid) return;
      safeKillProcess(child.pid, signal);
    };

    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const cleanupHandlers = (): void => {
      process.off("exit", handleParentExit);
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
    };

    const handleParentExit = (): void => {
      terminateChild("SIGTERM");
    };
    process.on("exit", handleParentExit);

    for (const signal of forwardedSignals) {
      const handler = (): void => {
        terminateChild(signal);
        cleanupHandlers();
        process.exit(getExitCodeForSignal(signal));
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    child.stdout?.on("data", (chunk) => handleChunk(chunk, (text) => process.stdout.write(text)));
    child.stderr?.on("data", (chunk) => handleChunk(chunk, (text) => process.stderr.write(text)));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanupHandlers();
      const message = sanitizeOutput(error instanceof Error ? error.message : String(error));
      reject(new Error(`Failed to run command: ${printableCommand}\n${message}`));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanupHandlers();
      if (code === 0) {
        resolve();
        return;
      }

      const codeText = code === null ? (signal ?? "unknown") : String(code);
      const relativeCwd = sanitizeOutput(path.relative(process.cwd(), options.cwd ?? process.cwd()) || ".");
      reject(
        new Error(
          `Command failed with exit code ${codeText}: ${printableCommand}\nWorking directory: ${relativeCwd}`,
        ),
      );
    });
  });
}
