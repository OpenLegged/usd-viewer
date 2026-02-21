#!/usr/bin/env node

const { execSync } = require("node:child_process");

const cleanupMatchers = [
  /\bchrome-devtools-mcp\b/i,
  /\bplaywright-mcp\b/i,
  /@playwright\/mcp\b/i,
  /\bpuppeteer_dev_chrome_profile-/i,
  /\/\.cache\/chrome-devtools-mcp\/chrome-profile\b/i,
  /\/\.cache\/ms-playwright\/mcp-chrome\b/i,
  /\bplaywright_chromiumdev_profile-/i,
];

function readProcessTable() {
  try {
    return execSync("ps -eo pid=,args=", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function killProcess(pid) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function main() {
  const rows = readProcessTable();
  const killed = [];

  for (const row of rows) {
    const firstSpace = row.indexOf(" ");
    if (firstSpace <= 0) continue;

    const pidText = row.slice(0, firstSpace).trim();
    const command = row.slice(firstSpace + 1);
    const pid = Number(pidText);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (pid === process.pid) continue;

    const shouldKill = cleanupMatchers.some((matcher) => matcher.test(command));
    if (!shouldKill) continue;

    if (killProcess(pid)) {
      killed.push({ pid, command });
    }
  }

  if (killed.length === 0) {
    process.stdout.write("Cleanup: no stale headless browser processes found.\n");
    return;
  }

  process.stdout.write(`Cleanup: terminated ${killed.length} process(es).\n`);
}

main();
