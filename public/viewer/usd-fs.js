export class UsdFsHelper {
    constructor(getUsdModule, debugFileHandling) {
        this.getUsdModule = getUsdModule;
        this.debugFileHandling = debugFileHandling;
        this.trackedVirtualFilePaths = new Set();
    }
    hasCreateFileOps(usd) {
        return !!usd
            && typeof usd.FS_createPath === "function"
            && typeof usd.FS_createDataFile === "function"
            && typeof usd.FS_unlink === "function";
    }
    hasDirectoryListingOps(usd) {
        return !!usd
            && typeof usd.FS_readdir === "function"
            && typeof usd.FS_analyzePath === "function";
    }
    canOperateOnUsdFilesystem() {
        const usd = this.getUsdModule();
        return this.hasCreateFileOps(usd);
    }
    trackVirtualFilePath(filePath) {
        if (!filePath)
            return;
        this.trackedVirtualFilePaths.add(filePath);
    }
    untrackVirtualFilePath(filePath) {
        if (!filePath)
            return;
        this.trackedVirtualFilePaths.delete(filePath);
    }
    hasVirtualFilePath(filePath) {
        const usd = this.getUsdModule();
        if (!this.canOperateOnUsdFilesystem() || !filePath)
            return false;
        if (this.trackedVirtualFilePaths.has(filePath))
            return true;
        if (!this.hasDirectoryListingOps(usd))
            return false;
        try {
            return !!usd.FS_analyzePath(filePath)?.exists;
        }
        catch {
            return false;
        }
    }
    getAllLoadedFiles() {
        const usd = this.getUsdModule();
        if (!this.canOperateOnUsdFilesystem())
            return [];
        if (!this.hasDirectoryListingOps(usd)) {
            return Array.from(this.trackedVirtualFilePaths.values());
        }
        const filePaths = [];
        const collect = (currentPath) => {
            const files = usd.FS_readdir(currentPath);
            for (const file of files) {
                if (file === "." || file === "..")
                    continue;
                const newPath = currentPath + file + "/";
                const data = usd.FS_analyzePath(currentPath + file + "/");
                if (data?.object?.node_ops?.readdir) {
                    if (newPath === "/dev/" || newPath === "/proc/" || newPath === "/home/" || newPath === "/tmp/" || newPath === "/usd/")
                        continue;
                    collect(newPath);
                }
                else {
                    filePaths.push(data.path);
                }
            }
        };
        collect("/");
        return filePaths;
    }
    clearStageFiles(usdRoot) {
        const usd = this.getUsdModule();
        if (!usdRoot)
            return;
        if (!this.canOperateOnUsdFilesystem()) {
            usdRoot.clear?.();
            return;
        }
        const allFilePaths = this.getAllLoadedFiles();
        if (this.debugFileHandling) {
            console.log("Clearing stage.", allFilePaths);
        }
        for (const file of allFilePaths) {
            try {
                usd.FS_unlink(file, true);
            }
            catch { }
        }
        this.trackedVirtualFilePaths.clear();
        usdRoot.clear?.();
    }
    addPath(root, path) {
        const usd = this.getUsdModule();
        if (!this.canOperateOnUsdFilesystem())
            return;
        if (!this.hasDirectoryListingOps(usd)) {
            for (const filePath of this.trackedVirtualFilePaths) {
                root[filePath] = { path: filePath };
            }
            return;
        }
        const files = usd.FS_readdir(path);
        for (const file of files) {
            if (file === "." || file === "..")
                continue;
            const newPath = path + file + "/";
            const data = usd.FS_analyzePath(path + file + "/");
            if (data?.object?.node_ops?.readdir) {
                if (newPath === "/dev/" || newPath === "/proc/" || newPath === "/home/" || newPath === "/tmp/" || newPath === "/usd/")
                    continue;
                root[file] = {};
                this.addPath(root[file], newPath);
            }
            else {
                root[file] = data;
            }
        }
    }
}
