import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CleanupCandidate = {
  pid: number;
  command: string;
  reason: string;
};

type CandidateSnapshot = {
  scannedProcessCount: number;
  candidates: CleanupCandidate[];
};

export type CleanupHeadlessOptions = {
  silent?: boolean;
  graceMs?: number;
};

export type CleanupHeadlessResult = {
  scannedProcessCount: number;
  matchedProcessCount: number;
  terminatedProcessCount: number;
  forceKilledProcessCount: number;
  remainingProcessCount: number;
};

const commandMatchers = [
  { reason: "chrome-devtools-mcp process", regex: /\bchrome-devtools-mcp\b/i },
  { reason: "playwright-mcp process", regex: /\bplaywright-mcp\b/i },
  { reason: "@playwright/mcp process", regex: /@playwright\/mcp\b/i },
  { reason: "puppeteer temp profile", regex: /\bpuppeteer_dev_chrome_profile-/i },
  { reason: "mcp chrome cache profile", regex: /\/\.cache\/chrome-devtools-mcp\/chrome-profile\b/i },
  { reason: "playwright mcp cache profile", regex: /\/\.cache\/ms-playwright\/mcp-chrome\b/i },
  { reason: "playwright temp profile", regex: /\bplaywright_chromiumdev_profile-/i },
];

function parsePsLine(line: string): { pid: number; command: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const firstSpaceIndex = trimmed.indexOf(" ");
  if (firstSpaceIndex <= 0) return null;

  const pidValue = Number(trimmed.slice(0, firstSpaceIndex).trim());
  if (!Number.isFinite(pidValue)) return null;

  const command = trimmed.slice(firstSpaceIndex + 1).trim();
  if (!command) return null;

  return { pid: pidValue, command };
}

function getMatchReason(command: string): string | null {
  for (const matcher of commandMatchers) {
    if (matcher.regex.test(command)) return matcher.reason;
  }
  return null;
}

function dedupeCandidates(candidates: CleanupCandidate[]): CleanupCandidate[] {
  const uniqueByPid = new Map<number, CleanupCandidate>();
  for (const candidate of candidates) {
    if (!uniqueByPid.has(candidate.pid)) {
      uniqueByPid.set(candidate.pid, candidate);
    }
  }
  return Array.from(uniqueByPid.values());
}

async function listCleanupCandidates(): Promise<CandidateSnapshot> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,command="], { maxBuffer: 10 * 1024 * 1024 });
  const lines = String(stdout).split("\n");
  const candidates: CleanupCandidate[] = [];
  let scannedProcessCount = 0;

  for (const line of lines) {
    const parsed = parsePsLine(line);
    if (!parsed) continue;
    scannedProcessCount += 1;

    if (parsed.pid === process.pid) continue;
    const reason = getMatchReason(parsed.command);
    if (!reason) continue;

    candidates.push({
      pid: parsed.pid,
      command: parsed.command,
      reason,
    });
  }

  return {
    scannedProcessCount,
    candidates: dedupeCandidates(candidates),
  };
}

function safeKill(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logLine(text: string, silent: boolean): void {
  if (silent) return;
  process.stdout.write(`${text}\n`);
}

export async function cleanupHeadlessBrowserProcesses(
  options: CleanupHeadlessOptions = {},
): Promise<CleanupHeadlessResult> {
  const silent = options.silent ?? false;
  const graceMs = options.graceMs ?? 1200;

  const initialSnapshot = await listCleanupCandidates();
  const initialCandidates = initialSnapshot.candidates;
  const initialPids = new Set(initialCandidates.map((candidate) => candidate.pid));

  if (initialCandidates.length === 0) {
    logLine("Cleanup: no stale headless browser processes found.", silent);
    return {
      scannedProcessCount: initialSnapshot.scannedProcessCount,
      matchedProcessCount: 0,
      terminatedProcessCount: 0,
      forceKilledProcessCount: 0,
      remainingProcessCount: 0,
    };
  }

  logLine(`Cleanup: found ${initialCandidates.length} stale process(es), sending SIGTERM...`, silent);

  let terminatedProcessCount = 0;
  for (const candidate of initialCandidates) {
    if (safeKill(candidate.pid, "SIGTERM")) {
      terminatedProcessCount += 1;
    }
  }

  await sleep(graceMs);

  const afterTermSnapshot = await listCleanupCandidates();
  const survivorsAfterTerm = afterTermSnapshot.candidates.filter((candidate) => initialPids.has(candidate.pid));

  let forceKilledProcessCount = 0;
  if (survivorsAfterTerm.length > 0) {
    logLine(`Cleanup: ${survivorsAfterTerm.length} process(es) still alive, sending SIGKILL...`, silent);
    for (const candidate of survivorsAfterTerm) {
      if (safeKill(candidate.pid, "SIGKILL")) {
        forceKilledProcessCount += 1;
      }
    }
    await sleep(200);
  }

  const finalSnapshot = await listCleanupCandidates();
  const remainingProcessCount = finalSnapshot.candidates.filter((candidate) => initialPids.has(candidate.pid)).length;

  if (remainingProcessCount > 0) {
    logLine(`Cleanup: ${remainingProcessCount} process(es) are still running.`, silent);
  } else {
    logLine("Cleanup: done, no stale headless browser process remains.", silent);
  }

  return {
    scannedProcessCount: initialSnapshot.scannedProcessCount,
    matchedProcessCount: initialCandidates.length,
    terminatedProcessCount,
    forceKilledProcessCount,
    remainingProcessCount,
  };
}
