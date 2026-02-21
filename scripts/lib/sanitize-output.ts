import os from "node:os";
import path from "node:path";

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const repoRoot = normalizeSlashes(path.resolve(process.cwd()));
const homeDir = normalizeSlashes(os.homedir());

const repoRootPattern = new RegExp(escapeRegExp(repoRoot), "g");
const homeDirPattern = new RegExp(escapeRegExp(homeDir), "g");

const unixUserPattern = /\/(Users|home)\/[^/\s:]+/g;
const windowsUserPattern = /([A-Za-z]:\/Users\/)[^/\s:]+/g;

export function sanitizeOutput(raw: string): string {
  let output = normalizeSlashes(raw);
  output = output.replace(repoRootPattern, "<repo>");
  output = output.replace(homeDirPattern, "<home>");
  output = output.replace(unixUserPattern, "/$1/<user>");
  output = output.replace(windowsUserPattern, "$1<user>");
  return output;
}
