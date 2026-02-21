import { sanitizeOutput } from "./sanitize-output.ts";

export function handleFatalError(error: unknown): never {
  const rawMessage = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const safeMessage = sanitizeOutput(rawMessage);
  process.stderr.write(`${safeMessage}\n`);
  process.exit(1);
}
