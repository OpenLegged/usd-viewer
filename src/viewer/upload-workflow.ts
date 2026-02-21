import { normalizeUploadedFiles, pickRootFileCandidate } from "./file-selection.js";
import { getDirectoryFromVirtualPath, isSupportedUsdFileName, normalizeUsdPath } from "./path-utils.js";
import { UsdFsHelper } from "./usd-fs.js";

export interface LoadVirtualFileArgs {
  USD: any;
  usdFsHelper: UsdFsHelper;
  messageLog: HTMLElement | null;
  file: File;
  fullPath: string;
  isRootFile: boolean;
  onLoadRootUsdPath: (rootVirtualPath: string) => Promise<void>;
}

export async function loadVirtualFile(args: LoadVirtualFileArgs): Promise<void> {
  const { USD, usdFsHelper, messageLog, file, fullPath, isRootFile, onLoadRootUsdPath } = args;
  if (!USD || !usdFsHelper.canOperateOnUsdFilesystem()) return;

  const normalizedFullPath = normalizeUsdPath(fullPath, file.name);
  if (!normalizedFullPath) return;

  const fileData = await file.arrayBuffer();
  if (!fileData || fileData.byteLength === 0) return;

  const fileName = normalizedFullPath.split("/").pop();
  if (!fileName) return;
  const directory = getDirectoryFromVirtualPath(normalizedFullPath);

  USD.FS_createPath("", directory, true, true);
  try {
    USD.FS_unlink(normalizedFullPath);
  } catch {}
  usdFsHelper.untrackVirtualFilePath(normalizedFullPath);

  USD.FS_createDataFile(directory, fileName, new Uint8Array(fileData), true, true, true);
  usdFsHelper.trackVirtualFilePath(normalizedFullPath);

  if (!isRootFile) return;
  await onLoadRootUsdPath(normalizedFullPath);
}

export interface HandleUploadedFilesArgs {
  fileList: FileList | File[];
  messageLog: HTMLElement | null;
  clearStage: () => Promise<void>;
  loadSingleFile: (file: File, isRootFile: boolean, fullPath: string) => Promise<void>;
}

async function runWithConcurrency<T>(
  items: T[],
  maxConcurrency: number,
  handler: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return;
  const concurrency = Math.max(1, Math.min(Math.floor(maxConcurrency) || 1, items.length));
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      await handler(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
}

export async function handleUploadedFileList(args: HandleUploadedFilesArgs): Promise<void> {
  const { fileList, messageLog, clearStage, loadSingleFile } = args;
  const normalizedFiles = normalizeUploadedFiles(fileList);
  if (normalizedFiles.length === 0) return;

  const rootFile = pickRootFileCandidate(normalizedFiles);
  if (!rootFile || !isSupportedUsdFileName(rootFile.name)) {
    if (messageLog) messageLog.textContent = "Please upload a USD file (.usd/.usda/.usdc/.usdz).";
    return;
  }

  const otherFiles = normalizedFiles.filter((entry) => entry !== rootFile);
  otherFiles.sort((a, b) => {
    if (isSupportedUsdFileName(a.name) && !isSupportedUsdFileName(b.name)) return 1;
    if (!isSupportedUsdFileName(a.name) && isSupportedUsdFileName(b.name)) return -1;
    return 0;
  });

  const container = document.querySelector("#container");
  container?.classList.add("have-custom-file");

  await clearStage();
  const totalDependencies = otherFiles.length;
  if (totalDependencies > 0 && messageLog) {
    messageLog.textContent = `Importing local resources... 0/${totalDependencies}`;
  }

  const hardwareConcurrency = Number((navigator as any)?.hardwareConcurrency || 4);
  const ingestConcurrency = Math.max(2, Math.min(8, hardwareConcurrency));
  let importedDependencyCount = 0;
  await runWithConcurrency(otherFiles, ingestConcurrency, async (entry) => {
    await loadSingleFile(entry.file, false, entry.fullPath);
    importedDependencyCount += 1;
    if (messageLog) {
      messageLog.textContent = `Importing local resources... ${importedDependencyCount}/${totalDependencies}`;
    }
  });

  if (messageLog) {
    messageLog.textContent = "Loading root USD...";
  }
  await loadSingleFile(rootFile.file, true, rootFile.fullPath);
}
