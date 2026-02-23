
declare type FSNode = {
    contents: ArrayLike,
    id: number,
    mode: number,
    name: string,
    timestamp: number,
    isFolder: boolean,
    isDevice: boolean,
    read: boolean,
    write: boolean,
}

declare type USD = {
    FS_createDataFile: (parent: string, filepath: string, data: Uint8Array, canRead: boolean, canWrite: boolean, canOwn: boolean) => FSNode,
    FS_createPath: (parent: string, path: string, canRead: boolean, canWrite: boolean) => FSNode,
    FS_unlink: (path: string) => void,
    FS_readdir: (path: string) => string[],
    FS_rmdir: (path: string) => void,
    FS_analyzePath: (path: string) => FSNode,
    HdWebSyncDriver: new (delegate: hydraDelegate, filepath: string) => HdWebSyncDriver,
    flushPendingDeletes: () => void,
    ready: Promise<any>,
    debug: boolean;
    calledRun: boolean;
    stderr: any;
    stdin: any;
    stdout: any;
};

declare type USDStage = {
    GetStartTimeCode(): number,
    GetEndTimeCode(): number,
    GetTimeCodesPerSecond(): number,
    GetUpAxis(): number,
}

declare type HdWebSyncDriver = {
    GetProtoDataBlob: (protoPath: string) => {
        valid: boolean,
        numVertices: number,
        numIndices: number,
        numUVs: number,
        uvDimension: number,
        pointsPtr: number,
        indicesPtr: number,
        uvPtr: number,
        transformPtr: number,
        normalsPtr?: number,
        numNormals?: number,
        normalsDimension?: number,
        materialId?: string,
        points?: ArrayLike<number>,
        indices?: ArrayLike<number>,
        uv?: ArrayLike<number>,
        transform?: ArrayLike<number>,
        normals?: ArrayLike<number>,
        [key: string]: unknown,
    },
    GetAllProtoDataBlobs: () => Record<string, {
        valid: boolean,
        numVertices: number,
        numIndices: number,
        numUVs: number,
        uvDimension: number,
        numNormals?: number,
        normalsDimension?: number,
        materialId?: string,
        pointsPtr: number,
        indicesPtr: number,
        uvPtr: number,
        normalsPtr?: number,
        transformPtr: number,
        transform?: ArrayLike<number>,
        [key: string]: unknown,
    }>,
    GetCollisionProtoOverride?: (meshId: string) => {
        valid: boolean,
        meshId?: string,
        resolvedPrimPath?: string,
        primType?: string,
        worldTransform?: ArrayLike<number>,
        extentSize?: ArrayLike<number>,
        size?: number,
        radius?: number,
        height?: number,
        axis?: string,
        [key: string]: unknown,
    },
    GetCollisionProtoOverrides?: () => Record<string, {
        valid: boolean,
        meshId?: string,
        resolvedPrimPath?: string,
        primType?: string,
        worldTransform?: ArrayLike<number>,
        extentSize?: ArrayLike<number>,
        size?: number,
        radius?: number,
        height?: number,
        axis?: string,
        [key: string]: unknown,
    }>,
    GetVisualProtoOverride?: (meshId: string) => {
        valid: boolean,
        meshId?: string,
        resolvedPrimPath?: string,
        primType?: string,
        worldTransform?: ArrayLike<number>,
        extentSize?: ArrayLike<number>,
        size?: number,
        radius?: number,
        height?: number,
        axis?: string,
        [key: string]: unknown,
    },
    GetVisualProtoOverrides?: () => Record<string, {
        valid: boolean,
        meshId?: string,
        resolvedPrimPath?: string,
        primType?: string,
        worldTransform?: ArrayLike<number>,
        extentSize?: ArrayLike<number>,
        size?: number,
        radius?: number,
        height?: number,
        axis?: string,
        [key: string]: unknown,
    }>,
    GetProtoMeshOverrides?: () => {
        collision?: Record<string, {
            valid: boolean,
            meshId?: string,
            resolvedPrimPath?: string,
            primType?: string,
            worldTransform?: ArrayLike<number>,
            extentSize?: ArrayLike<number>,
            size?: number,
            radius?: number,
            height?: number,
            axis?: string,
            [key: string]: unknown,
        }>,
        visual?: Record<string, {
            valid: boolean,
            meshId?: string,
            resolvedPrimPath?: string,
            primType?: string,
            worldTransform?: ArrayLike<number>,
            extentSize?: ArrayLike<number>,
            size?: number,
            radius?: number,
            height?: number,
            axis?: string,
            [key: string]: unknown,
        }>,
        collisionCount?: number,
        visualCount?: number,
        [key: string]: unknown,
    },
    GetRprimDeltaBatch?: () => {
        entries?: Record<string, {
            dirtyMask?: number,
            materialId?: string,
            geomSubsetSections?: ArrayLike<{
                start?: number,
                length?: number,
                materialId?: string,
                [key: string]: unknown,
            }>,
            pointsPtr?: number,
            pointsCount?: number,
            indicesPtr?: number,
            indicesCount?: number,
            normalsPtr?: number,
            normalsCount?: number,
            transformPtr?: number,
            transformCount?: number,
            primvars?: ArrayLike<{
                name?: string,
                interpolation?: string,
                dimension?: number,
                dataPtr?: number,
                dataCount?: number,
                [key: string]: unknown,
            }>,
            [key: string]: unknown,
        }>,
        count?: number,
        [key: string]: unknown,
    },
    GetFinalStageOverrideBatch?: () => {
        entries?: Record<string, {
            valid: boolean,
            meshId?: string,
            sectionName?: string,
            applyGeometry?: boolean,
            dirtyMask?: number,
            resolvedPrimPath?: string,
            primType?: string,
            worldTransform?: ArrayLike<number>,
            extentSize?: ArrayLike<number>,
            size?: number,
            radius?: number,
            height?: number,
            axis?: string,
            [key: string]: unknown,
        }>,
        count?: number,
        collisionCount?: number,
        visualCount?: number,
        [key: string]: unknown,
    },
    GetPrimOverrideData?: (primPath: string) => {
        valid: boolean,
        resolvedPrimPath?: string,
        primType?: string,
        worldTransform?: ArrayLike<number>,
        extentSize?: ArrayLike<number>,
        size?: number,
        radius?: number,
        height?: number,
        axis?: string,
        [key: string]: unknown,
    },
    GetPrimOverrideDataMap?: (primPaths: ArrayLike<string>) => Record<string, {
        valid: boolean,
        resolvedPrimPath?: string,
        primType?: string,
        worldTransform?: ArrayLike<number>,
        extentSize?: ArrayLike<number>,
        size?: number,
        radius?: number,
        height?: number,
        axis?: string,
        [key: string]: unknown,
    }>,
    getFile: (path: string, cb: (loadedFile: ArrayBufferLike) => void) => void,
    GetStage: () => USDStage,
    GetPrimPathSet?: () => ArrayLike<string>,
    GetPhysicsJointRecords?: () => ArrayLike<{
        path?: string,
        jointPath?: string,
        jointName?: string,
        jointTypeName?: string,
        jointType?: string,
        body0Path?: string,
        body1Path?: string,
        axisToken?: string,
        localPos0?: ArrayLike<number>,
        localPos1?: ArrayLike<number>,
        localRot0Wxyz?: ArrayLike<number>,
        localRot1Wxyz?: ArrayLike<number>,
        lowerLimitDeg?: number,
        upperLimitDeg?: number,
        [key: string]: unknown,
    }>,
    GetPrimTransforms: () => { world?: Record<string, ArrayLike<number>>, local?: Record<string, ArrayLike<number>>, count?: number },
    SetTime(timecode: number): void,
    GetTime(): number,
    Draw(): void,

    /** ??? */
    clone(): HdWebSyncDriver,
    /** ??? */
    delete(): void,
    /** ??? */
    deleteLater(): void,
    isDeleted(): boolean,
    /** ??? */
    isAliasOf(): boolean,
}

export type GetUsdModuleOptions = {
    debug?: boolean,
    mainScriptUrlOrBlob?: string,
    wasmBinary?: ArrayBufferLike,
    locateFile?: (path: string) => string,
    getPreloadedPackage?: (file: string, size: number) => ArrayBuffer | null,
    setStatus?: (status: string) => void,
    onDownloadProgress?: (downloaded: number, total: number) => void,
    /** Returns a transferable object that can be resolved to an ArrayBuffer, 
     *  or an URL that can be fetched to get an ArrayBuffer.
    */
    urlModifier?: (url: string) =>
        Promise<
            ArrayBuffer | File | FileSystemFileHandle | FileSystemFileEntry | string
        > | ArrayBuffer | File | FileSystemFileHandle | FileSystemFileEntry | string,
}

/**
 * Loads the USD Module.
 * @example
 * ```javascript
 * getUsdModule({ mainScriptUrlOrBlob: "/emHdBindings.js" }).then(USD => { ... })
 * ```
 */
export function getUsdModule(opts?: GetUsdModuleOptions): Promise<USD>;

export type USDRoot = {}
