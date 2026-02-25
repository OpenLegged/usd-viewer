import { Camera, MathUtils, Matrix4, Mesh, Object3D, Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  getRenderRobotMetadataSnapshot,
  normalizeRenderRobotMetadataSnapshot,
  warmupRenderRobotMetadataSnapshot,
  type RenderRobotMetadataSnapshot,
} from "./robot-metadata.js";
import {
  axisTokenFromAxisVector,
  buildRuntimeLinkPathIndex,
  clampJointAnglePreservingNeutralZero,
  cloneJointCatalogEntry,
  extractDefaultPrimPathFromLayerText,
  extractJointRecordsFromLayerText,
  extractPhysicsPayloadAssetPathsFromLayerText,
  getInteractiveJointLimits,
  getJointPathCandidatesForLinkPath,
  getLinkPathFromMeshId,
  getRootPathFromLinkPath,
  getRootPathsFromRenderInterface,
  hasFiniteLimitValue,
  isControllableRevoluteJointTypeName,
  isPhysicsJointTypeName,
  jointCatalogCacheByStagePath,
  maxJointCatalogCacheEntries,
  normalizeAxisToken,
  normalizeAxisVector,
  normalizeLimits,
  pickRuntimeParentLinkPath,
  resolveRuntimeLinkPathsFromLinkName,
  resolveRuntimeLinkPathsFromSourcePath,
  resolveUsdAssetPath,
  rotateAxisByQuaternion,
  roundAngleDegrees,
  safeGetPrimAtPath,
  safeGetPrimAttribute,
  safeGetPrimTypeName,
  toFiniteNumber,
  toQuaternionFromValue,
  toUsdPathListFromValue,
  toVector3FromValue,
  type JointCatalogEntry,
  type JointCatalogCacheSnapshot,
  type JointInfoSnapshot,
  type LinkJointState,
  type RenderInterfaceLike,
  type RuntimeLinkPathIndex,
  type StageLike,
} from "./link-rotation/shared.js";
import {
  ingestJointCatalogFromStage,
} from "./link-rotation/catalog-ingestion.js";
import { parseBooleanFlag } from "./path-utils.js";

export type { JointInfoSnapshot } from "./link-rotation/shared.js";
export class LinkRotationController {
  private enabled = false;
  private dragging = false;
  private selectedLinkPath: string | null = null;
  private activeLinkPath: string | null = null;
  private renderInterface: RenderInterfaceLike = null;
  private domElement: HTMLElement | null = null;
  private camera: Camera | null = null;
  private controls: OrbitControls | null = null;
  private onSelectionChanged: ((linkPath: string | null, jointInfo: JointInfoSnapshot | null) => void) | null = null;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly linkJointStateByLinkPath = new Map<string, LinkJointState>();
  private readonly jointCatalogByLinkPath = new Map<string, JointCatalogEntry>();
  private readonly linkParentPathByLinkPath = new Map<string, string | null>();
  private readonly linkPathByMeshId = new Map<string, string>();
  private readonly subtreeLinkPathsByAncestorLinkPath = new Map<string, Set<string>>();
  private readonly subtreeMeshIdsByAncestorLinkPath = new Map<string, string[]>();
  private readonly lastAppliedMeshIds = new Set<string>();
  private readonly baseMatrixByMeshId = new Map<string, Matrix4>();
  private readonly baseLinkFrameMatrixByLinkPath = new Map<string, Matrix4>();
  private readonly posedLinkFrameMatrixByLinkPath = new Map<string, Matrix4>();
  private subtreeIndexDirty = true;
  private jointCatalogBuildPromise: Promise<void> | null = null;
  private lastJointCatalogBuildAttemptAtMs = 0;
  private hasAppliedJointPose = false;
  private jointPoseDirty = false;
  private basePoseDirty = true;
  private lastIdleBasePoseRefreshAtMs = 0;
  private lastKnownMeshCount = -1;
  private readonly idleBasePoseRefreshIntervalMs = this.getDurationParamMsFromQuery(
    "idleBasePoseRefreshIntervalMs",
    2_500,
    120,
    120_000,
  );
  private readonly strictOneShot = this.getBooleanParamFromQuery("strictOneShot", true);
  private readonly allowStageJointCatalogFallback = this.getBooleanParamFromQuery(
    "allowStageJointCatalogFallback",
    !this.strictOneShot,
  );
  private readonly jointCatalogUiWaitBudgetMs = this.getDurationParamMsFromQuery("jointCatalogWaitBudgetMs", 96, 0, 10_000);
  private readonly jointCatalogStageFallbackDelayMs = this.getDurationParamMsFromQuery("jointCatalogStageFallbackDelayMs", 40, 0, 120_000);
  private readonly jointCatalogStageFallbackIdleTimeoutMs = this.getDurationParamMsFromQuery("jointCatalogStageFallbackIdleTimeoutMs", 40, 0, 120_000);
  private readonly jointCatalogRebuildCooldownMs = this.getDurationParamMsFromQuery("jointCatalogRebuildCooldownMs", 320, 0, 120_000);
  private stageSourcePath: string | null = null;
  private readonly tempTranslateToPivot = new Matrix4();
  private readonly tempTranslateFromPivot = new Matrix4();
  private readonly tempRotation = new Matrix4();
  private readonly tempComposed = new Matrix4();
  private readonly tempAxisWorld = new Vector3();
  private readonly tempPivotWorld = new Vector3();
  private readonly tempDragPointWorld = new Vector3();
  private readonly tempDragStartToPointWorld = new Vector3();
  private readonly tempDragCrossWorld = new Vector3();
  private readonly tempUsdRootInverseWorldMatrix = new Matrix4();
  private readonly tempRayOriginLocal = new Vector3();
  private readonly tempRayDirectionLocal = new Vector3();

  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private dragStartAngleDeg = 0;
  private dragHasProjectedStartDirection = false;
  private readonly dragAxisWorld = new Vector3();
  private readonly dragPivotWorld = new Vector3();
  private readonly dragStartDirectionWorld = new Vector3();
  private readonly degreesPerPixel = 0.25;

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;

    this.ensureJointCatalogBuildScheduled();
    const linkPath = this.pickLinkPathAtPointer(event);
    if (!linkPath) return;

    this.selectedLinkPath = linkPath;
    this.activeLinkPath = null;
    this.dragging = false;
    this.dragStartClientX = event.clientX;
    this.dragStartClientY = event.clientY;
    this.dragStartAngleDeg = 0;
    this.dragHasProjectedStartDirection = false;
    this.dragAxisWorld.set(0, 0, 0);
    this.dragPivotWorld.set(0, 0, 0);
    this.dragStartDirectionWorld.set(0, 0, 0);

    const jointState = this.getOrResolveJointStateForLinkPath(linkPath);
    if (!jointState) {
      this.updateCursor();
      this.emitSelectionChanged(linkPath);
      return;
    }

    this.activeLinkPath = linkPath;
    this.dragging = true;
    this.dragStartAngleDeg = jointState.angleDeg;
    this.initializeDragProjection(event, jointState);
    if (this.controls) this.controls.enabled = false;
    this.updateCursor();
    this.emitSelectionChanged(linkPath);

    try {
      this.domElement?.setPointerCapture(event.pointerId);
    } catch {}
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.dragging || !this.activeLinkPath) return;
    const jointState = this.getOrResolveJointStateForLinkPath(this.activeLinkPath);
    if (!jointState) return;

    let targetAngleDeg = jointState.angleDeg;
    if (
      this.dragHasProjectedStartDirection &&
      this.projectPointerToJointPlane(event, this.dragPivotWorld, this.dragAxisWorld, this.tempDragPointWorld)
    ) {
      this.tempDragStartToPointWorld.copy(this.tempDragPointWorld).sub(this.dragPivotWorld);
      if (this.tempDragStartToPointWorld.lengthSq() > 1e-12) {
        this.tempDragStartToPointWorld.normalize();
        this.tempDragCrossWorld.copy(this.dragStartDirectionWorld).cross(this.tempDragStartToPointWorld);
        const signedAngleRad = Math.atan2(
          this.dragAxisWorld.dot(this.tempDragCrossWorld),
          MathUtils.clamp(this.dragStartDirectionWorld.dot(this.tempDragStartToPointWorld), -1, 1)
        );
        targetAngleDeg = this.dragStartAngleDeg + MathUtils.radToDeg(signedAngleRad);
      }
    } else {
      const deltaX = event.clientX - this.dragStartClientX;
      const deltaY = event.clientY - this.dragStartClientY;
      const deltaPixels = deltaX - deltaY * 0.35;
      targetAngleDeg = this.dragStartAngleDeg + deltaPixels * this.degreesPerPixel;
    }

    const interactiveLimits = getInteractiveJointLimits(jointState.lowerLimitDeg, jointState.upperLimitDeg);
    const nextAngle = clampJointAnglePreservingNeutralZero(
      targetAngleDeg,
      interactiveLimits.lower,
      interactiveLimits.upper
    );

    if (Math.abs(nextAngle - jointState.angleDeg) <= 1e-8) return;
    jointState.angleDeg = nextAngle;
    this.jointPoseDirty = true;
    this.emitSelectionChanged(this.activeLinkPath);
    event.preventDefault();
  };

  private readonly handlePointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.activeLinkPath = null;
    this.dragHasProjectedStartDirection = false;
    if (this.controls) this.controls.enabled = true;
    this.updateCursor();
  };

  attach(domElement: HTMLElement | null | undefined, camera: Camera | null | undefined, controls: OrbitControls | null | undefined): void {
    if (this.domElement) {
      this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
      window.removeEventListener("pointermove", this.handlePointerMove);
      window.removeEventListener("pointerup", this.handlePointerUp);
      window.removeEventListener("pointercancel", this.handlePointerUp);
      window.removeEventListener("blur", this.handlePointerUp);
    }

    this.domElement = domElement || null;
    this.camera = camera || null;
    this.controls = controls || null;

    if (!this.domElement) return;
    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
    window.addEventListener("blur", this.handlePointerUp);
    this.updateCursor();
  }

  setRenderInterface(renderInterface: RenderInterfaceLike): void {
    this.renderInterface = renderInterface || null;
    this.linkJointStateByLinkPath.clear();
    this.jointCatalogByLinkPath.clear();
    this.linkParentPathByLinkPath.clear();
    this.linkPathByMeshId.clear();
    this.subtreeLinkPathsByAncestorLinkPath.clear();
    this.subtreeMeshIdsByAncestorLinkPath.clear();
    this.lastAppliedMeshIds.clear();
    this.baseMatrixByMeshId.clear();
    this.baseLinkFrameMatrixByLinkPath.clear();
    this.posedLinkFrameMatrixByLinkPath.clear();
    this.subtreeIndexDirty = true;
    this.jointCatalogBuildPromise = null;
    this.hasAppliedJointPose = false;
    this.jointPoseDirty = false;
    this.basePoseDirty = true;
    this.lastKnownMeshCount = -1;
    this.lastIdleBasePoseRefreshAtMs = 0;
    this.lastJointCatalogBuildAttemptAtMs = 0;
  }

  setStageSourcePath(path: string | null | undefined): void {
    const normalized = String(path || "").trim();
    this.stageSourcePath = normalized ? normalized.split("?")[0] : null;
  }

  getStageSourcePath(): string | null {
    return this.stageSourcePath;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this.dragging = false;
      this.activeLinkPath = null;
      if (this.controls) this.controls.enabled = true;
    }
    this.updateCursor();
  }

  prewarmJointPosePipeline(): void {
    if (!this.enabled || !this.renderInterface?.meshes) return;
    if (Object.keys(this.renderInterface.meshes).length <= 0) return;
    if (!this.basePoseDirty && this.baseMatrixByMeshId.size > 0 && this.posedLinkFrameMatrixByLinkPath.size > 0) {
      return;
    }

    try {
      this.apply(this.renderInterface, {
        force: true,
        suppressIdleRefresh: true,
      });
    } catch {}
  }

  async prewarmJointCatalog(): Promise<void> {
    this.ensureJointCatalogBuildScheduled();
    try {
      await this.ensureJointCatalogReady();
    } catch {
      // Keep preload best-effort.
    }
  }

  prewarmInteractivePoseCaches(): void {
    if (!this.enabled || !this.renderInterface?.meshes) return;
    if (Object.keys(this.renderInterface.meshes).length <= 0) return;

    this.refreshMeshLinkPathIndex();
    this.ensureSubtreeIndex({ resolveMissingParents: true });
    this.captureCurrentPoseAsBasePose();
    const baseLinkPoseByLinkPath = this.buildBaseLinkPoseMap();
    this.syncPosedLinkFrameMap(baseLinkPoseByLinkPath);
    this.basePoseDirty = false;
    this.jointPoseDirty = false;
    this.hasAppliedJointPose = false;
    const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
      ? performance.now()
      : Date.now();
    this.lastIdleBasePoseRefreshAtMs = nowMs;
  }

  setOnSelectionChanged(handler: ((linkPath: string | null, jointInfo: JointInfoSnapshot | null) => void) | null): void {
    this.onSelectionChanged = handler;
  }

  getSelectedLinkPath(): string | null {
    return this.selectedLinkPath;
  }

  getJointInfoForLink(linkPath: string): JointInfoSnapshot | null {
    const jointState = this.getOrResolveJointStateForLinkPath(linkPath);
    if (!jointState) return null;
    return {
      linkPath,
      jointPath: jointState.jointPath,
      axisToken: jointState.axisToken,
      lowerLimitDeg: roundAngleDegrees(jointState.lowerLimitDeg),
      upperLimitDeg: roundAngleDegrees(jointState.upperLimitDeg),
      angleDeg: roundAngleDegrees(jointState.angleDeg),
    };
  }

  async getAllJointInfos(): Promise<JointInfoSnapshot[]> {
    const profileJointCatalog = /(?:\?|&)profileJointCatalog=(?:1|true|yes|on)(?:&|$)/i.test(String(window.location?.search || ""));
    const profileStartMs = (typeof performance !== "undefined" && typeof performance.now === "function")
      ? performance.now()
      : Date.now();
    this.ensureJointCatalogBuildScheduled();
    await this.ensureJointCatalogReady({ maxWaitMs: this.jointCatalogUiWaitBudgetMs });

    const linkPaths = new Set<string>();
    for (const linkPath of this.jointCatalogByLinkPath.keys()) {
      linkPaths.add(linkPath);
    }
    for (const linkPath of this.linkJointStateByLinkPath.keys()) {
      linkPaths.add(linkPath);
    }
    const query = new URLSearchParams(String(window?.location?.search || ""));
    const scanMeshLinksForJoints = parseBooleanFlag(query.get("scanMeshLinksForJoints"), false);
    if (scanMeshLinksForJoints && this.renderInterface?.meshes) {
      for (const meshId of Object.keys(this.renderInterface.meshes)) {
        const linkPath = getLinkPathFromMeshId(meshId);
        if (linkPath) linkPaths.add(linkPath);
      }
    }

    const entries: JointInfoSnapshot[] = [];
    if (profileJointCatalog) {
      const readyAtMs = (typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now();
      console.info("[LinkRotation] getAllJointInfos collected candidate links:", linkPaths.size, "waited", Math.round(readyAtMs - profileStartMs), "ms");
    }
    for (const linkPath of linkPaths) {
      const isKnownLinkPath = this.jointCatalogByLinkPath.has(linkPath) || this.linkJointStateByLinkPath.has(linkPath);
      if (!isKnownLinkPath && !scanMeshLinksForJoints) continue;
      const info = this.getJointInfoForLink(linkPath);
      if (!info) continue;
      entries.push(info);
    }

    entries.sort((left, right) => left.linkPath.localeCompare(right.linkPath));
    if (profileJointCatalog) {
      const endMs = (typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now();
      console.info("[LinkRotation] getAllJointInfos returned", entries.length, "rows in", Math.round(endMs - profileStartMs), "ms");
    }
    return entries;
  }

  setJointAngleForLink(linkPath: string, angleDeg: number): JointInfoSnapshot | null {
    const jointState = this.getOrResolveJointStateForLinkPath(linkPath);
    if (!jointState) return null;
    if (!Number.isFinite(angleDeg)) return this.getJointInfoForLink(linkPath);

    const previousAngle = jointState.angleDeg;
    const interactiveLimits = getInteractiveJointLimits(jointState.lowerLimitDeg, jointState.upperLimitDeg);
    jointState.angleDeg = clampJointAnglePreservingNeutralZero(
      angleDeg,
      interactiveLimits.lower,
      interactiveLimits.upper
    );
    if (Math.abs(jointState.angleDeg - previousAngle) > 1e-8) {
      this.jointPoseDirty = true;
    }
    if (this.selectedLinkPath === linkPath || this.activeLinkPath === linkPath) {
      this.emitSelectionChanged(linkPath);
    }
    return this.getJointInfoForLink(linkPath);
  }

  clear(): void {
    this.linkJointStateByLinkPath.clear();
    this.jointCatalogByLinkPath.clear();
    this.linkParentPathByLinkPath.clear();
    this.linkPathByMeshId.clear();
    this.subtreeLinkPathsByAncestorLinkPath.clear();
    this.subtreeMeshIdsByAncestorLinkPath.clear();
    this.lastAppliedMeshIds.clear();
    this.baseMatrixByMeshId.clear();
    this.baseLinkFrameMatrixByLinkPath.clear();
    this.posedLinkFrameMatrixByLinkPath.clear();
    this.subtreeIndexDirty = true;
    this.jointCatalogBuildPromise = null;
    this.lastJointCatalogBuildAttemptAtMs = 0;
    this.hasAppliedJointPose = false;
    this.jointPoseDirty = false;
    this.basePoseDirty = true;
    this.lastKnownMeshCount = -1;
    this.lastIdleBasePoseRefreshAtMs = 0;
    this.selectedLinkPath = null;
    this.activeLinkPath = null;
    this.dragging = false;
    if (this.controls) this.controls.enabled = true;
    this.updateCursor();
  }

  apply(renderInterface: RenderInterfaceLike, options: { force?: boolean; suppressIdleRefresh?: boolean } = {}): boolean {
    const force = options.force === true;
    const suppressIdleRefresh = options.suppressIdleRefresh === true;
    if (renderInterface) this.renderInterface = renderInterface;
    if (!this.enabled || !this.renderInterface?.meshes) return false;

    const meshCount = Object.keys(this.renderInterface.meshes).length;
    if (meshCount !== this.lastKnownMeshCount) {
      this.lastKnownMeshCount = meshCount;
      this.refreshMeshLinkPathIndex();
      this.basePoseDirty = true;
      if (meshCount > 0) {
        this.ensureJointCatalogBuildScheduled();
      }
    }

    const activeJointStates = Array.from(this.linkJointStateByLinkPath.values())
      .filter((jointState) => Math.abs(jointState.angleDeg) > 1e-8)
      .sort((left, right) => this.getLinkDepth(left.linkPath) - this.getLinkDepth(right.linkPath));
    if (activeJointStates.length === 0) {
      if (this.hasAppliedJointPose) {
        const meshIdsToRestore = this.lastAppliedMeshIds.size > 0 ? this.lastAppliedMeshIds : null;
        this.restoreBasePoseToCurrentMeshes(meshIdsToRestore);
        this.lastAppliedMeshIds.clear();
        const restoredLinkPoseByLinkPath = this.buildBaseLinkPoseMap();
        this.syncPosedLinkFrameMap(restoredLinkPoseByLinkPath);
        this.hasAppliedJointPose = false;
        this.basePoseDirty = true;
        this.lastIdleBasePoseRefreshAtMs = 0;
        this.jointPoseDirty = false;
        return true;
      }

      if (!this.basePoseDirty && suppressIdleRefresh) {
        this.jointPoseDirty = false;
        return false;
      }

      const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now();
      if (
        !this.basePoseDirty
        && (nowMs - this.lastIdleBasePoseRefreshAtMs) < this.idleBasePoseRefreshIntervalMs
      ) {
        this.jointPoseDirty = false;
        return false;
      }

      this.captureCurrentPoseAsBasePose();
      const basePoseChanged = this.restoreBasePoseToCurrentMeshes();
      this.lastAppliedMeshIds.clear();
      const refreshedLinkPoseByLinkPath = this.buildBaseLinkPoseMap();
      this.syncPosedLinkFrameMap(refreshedLinkPoseByLinkPath);
      this.basePoseDirty = false;
      this.lastIdleBasePoseRefreshAtMs = nowMs;
      this.jointPoseDirty = false;
      return basePoseChanged;
    }

    if (!force && !this.jointPoseDirty && this.hasAppliedJointPose && !this.basePoseDirty) {
      return false;
    }

    this.ensureSubtreeIndex();

    const affectedLinkPaths = this.collectAffectedLinkPaths(activeJointStates);
    const affectedMeshIds = this.collectAffectedMeshIds(activeJointStates);
    const meshIdsToRestore = new Set<string>(this.lastAppliedMeshIds);
    for (const meshId of affectedMeshIds) {
      meshIdsToRestore.add(meshId);
    }
    if (meshIdsToRestore.size > 0) {
      this.restoreBasePoseToCurrentMeshes(meshIdsToRestore);
    } else {
      this.restoreBasePoseToCurrentMeshes();
    }
    this.lastAppliedMeshIds.clear();
    for (const meshId of affectedMeshIds) {
      this.lastAppliedMeshIds.add(meshId);
    }

    const linkPoseByLinkPath = new Map<string, Matrix4>();
    if (affectedLinkPaths.size > 0) {
      for (const linkPath of affectedLinkPaths) {
        const baseMatrix = this.getBaseLinkFrameMatrixForLinkPath(linkPath);
        if (!baseMatrix) continue;
        linkPoseByLinkPath.set(linkPath, baseMatrix.clone());
      }
    } else {
      const fullBaseLinkPose = this.buildBaseLinkPoseMap();
      for (const [linkPath, linkMatrix] of fullBaseLinkPose.entries()) {
        linkPoseByLinkPath.set(linkPath, linkMatrix.clone());
      }
    }

    for (const jointState of activeJointStates) {
      const linkMatrix = linkPoseByLinkPath.get(jointState.linkPath) || this.getBaseLinkFrameMatrixForLinkPath(jointState.linkPath);
      if (!linkMatrix) continue;

      this.tempAxisWorld.copy(jointState.axisLocal).transformDirection(linkMatrix).normalize();
      if (this.tempAxisWorld.lengthSq() <= 1e-12) continue;

      if (jointState.localPivotInLink) {
        this.tempPivotWorld.copy(jointState.localPivotInLink).applyMatrix4(linkMatrix);
      } else {
        this.tempPivotWorld.setFromMatrixPosition(linkMatrix);
      }

      this.tempTranslateToPivot.makeTranslation(this.tempPivotWorld.x, this.tempPivotWorld.y, this.tempPivotWorld.z);
      this.tempRotation.makeRotationAxis(this.tempAxisWorld, MathUtils.degToRad(jointState.angleDeg));
      this.tempTranslateFromPivot.makeTranslation(-this.tempPivotWorld.x, -this.tempPivotWorld.y, -this.tempPivotWorld.z);
      this.tempComposed.copy(this.tempTranslateToPivot);
      this.tempComposed.multiply(this.tempRotation);
      this.tempComposed.multiply(this.tempTranslateFromPivot);
      this.applyRotationToLinkSubtree(jointState.linkPath, this.tempComposed);
      this.applyRotationToLinkPoseSubtree(jointState.linkPath, this.tempComposed, linkPoseByLinkPath);
    }

    this.syncPosedLinkFrameMap(linkPoseByLinkPath);
    this.hasAppliedJointPose = true;
    this.basePoseDirty = false;
    this.jointPoseDirty = false;
    return true;
  }

  private captureCurrentPoseAsBasePose(): void {
    const meshes = this.renderInterface?.meshes;
    if (!meshes) return;

    const seen = new Set<string>();
    for (const [meshId, hydraMesh] of Object.entries(meshes)) {
      const mesh = hydraMesh?._mesh;
      if (!mesh?.matrix) continue;
      seen.add(meshId);
      this.baseMatrixByMeshId.set(meshId, this.getPreferredBaseMatrixForMesh(meshId, mesh.matrix));
    }

    for (const meshId of Array.from(this.baseMatrixByMeshId.keys())) {
      if (!seen.has(meshId)) {
        this.baseMatrixByMeshId.delete(meshId);
      }
    }

    // Base link frames should follow the currently displayed pose source.
    // Stage transforms can lag behind runtime mesh fallback corrections, so
    // reset this cache whenever we refresh the base snapshot.
    this.baseLinkFrameMatrixByLinkPath.clear();
  }

  private restoreBasePoseToCurrentMeshes(targetMeshIds: Iterable<string> | null = null): boolean {
    const meshes = this.renderInterface?.meshes;
    if (!meshes) return false;

    if (this.baseMatrixByMeshId.size === 0) {
      this.captureCurrentPoseAsBasePose();
    }

    const targetSet = targetMeshIds ? new Set<string>(targetMeshIds) : null;
    let changed = false;
    const seen = new Set<string>();
    for (const [meshId, hydraMesh] of Object.entries(meshes)) {
      if (targetSet && !targetSet.has(meshId)) continue;
      const mesh = hydraMesh?._mesh;
      if (!mesh?.matrix) continue;
      seen.add(meshId);

      let baseMatrix = this.baseMatrixByMeshId.get(meshId);
      if (!baseMatrix) {
        baseMatrix = this.getPreferredBaseMatrixForMesh(meshId, mesh.matrix);
        this.baseMatrixByMeshId.set(meshId, baseMatrix.clone());
        if (this.getMatrixMaxElementDelta(mesh.matrix, baseMatrix) > 1e-6) {
          changed = true;
        }
        mesh.matrix.copy(baseMatrix);
        mesh.matrixAutoUpdate = false;
        continue;
      }

      const preferredBaseMatrix = this.getPreferredBaseMatrixForMesh(meshId, baseMatrix);
      if (this.getMatrixMaxElementDelta(baseMatrix, preferredBaseMatrix) > 1e-6) {
        baseMatrix = preferredBaseMatrix.clone();
        this.baseMatrixByMeshId.set(meshId, baseMatrix.clone());
      }

      if (this.getMatrixMaxElementDelta(mesh.matrix, baseMatrix) > 1e-6) {
        changed = true;
      }
      mesh.matrix.copy(baseMatrix);
      mesh.matrixAutoUpdate = false;
    }

    if (!targetSet) {
      for (const meshId of Array.from(this.baseMatrixByMeshId.keys())) {
        if (!seen.has(meshId)) {
          this.baseMatrixByMeshId.delete(meshId);
        }
      }
    }
    return changed;
  }

  private getPreferredBaseMatrixForMesh(meshId: string, currentMatrix: Matrix4): Matrix4 {
    const currentClone = currentMatrix.clone();
    if (!this.renderInterface) return currentClone;
    if (!meshId.includes(".proto_") || !/\/visuals\.|\/visuals\//i.test(meshId)) return currentClone;

    const resolvedVisualPath = this.renderInterface.getResolvedVisualTransformPrimPathForMeshId?.(meshId) || null;
    if (!resolvedVisualPath) return currentClone;
    const resolvedVisualMatrix = this.renderInterface.getWorldTransformForPrimPath?.(resolvedVisualPath) || null;
    if (!resolvedVisualMatrix) return currentClone;

    const protoMeshMatch = meshId.match(/\/visuals\.proto_mesh_id(\d+)$/i);
    const protoMeshIndex = protoMeshMatch ? Number(protoMeshMatch[1]) : -1;
    const isVisualProtoSubMesh = Number.isFinite(protoMeshIndex) && protoMeshIndex > 0;
    if (isVisualProtoSubMesh) {
      const hydraMesh = (this.renderInterface as any)?.meshes?.[meshId] as any;
      const protoBlobMatrix = hydraMesh?._lastProtoBlobTransformMatrix as Matrix4 | undefined;
      if (protoBlobMatrix?.elements && protoBlobMatrix.elements.length >= 16) {
        const resolvedVsProtoBlobDelta = this.getMatrixMaxElementDelta(resolvedVisualMatrix, protoBlobMatrix);
        if (resolvedVsProtoBlobDelta > 1e-4) {
          const resolvedElements = resolvedVisualMatrix.elements;
          const protoElements = protoBlobMatrix.elements;
          const translationDelta = Math.hypot(
            Number(resolvedElements[12] || 0) - Number(protoElements[12] || 0),
            Number(resolvedElements[13] || 0) - Number(protoElements[13] || 0),
            Number(resolvedElements[14] || 0) - Number(protoElements[14] || 0),
          );
          if (Number.isFinite(translationDelta) && translationDelta <= 1e-3) {
            return protoBlobMatrix.clone();
          }
        }
      }
    }

    const currentVsResolvedDelta = this.getMatrixMaxElementDelta(currentClone, resolvedVisualMatrix);
    if (currentVsResolvedDelta <= 1e-6) return currentClone;

    const fallbackMatrix = this.renderInterface.getFallbackTransformForMeshId?.(meshId) || null;
    if (fallbackMatrix) {
      const currentVsFallbackDelta = this.getMatrixMaxElementDelta(currentClone, fallbackMatrix);
      const resolvedVsFallbackDelta = this.getMatrixMaxElementDelta(resolvedVisualMatrix, fallbackMatrix);
      if (currentVsFallbackDelta <= 1e-5 && resolvedVsFallbackDelta > 1e-5) {
        return resolvedVisualMatrix.clone();
      }
    }

    if (!/\/mesh_\d+(?:\/mesh)?$/i.test(resolvedVisualPath)) {
      return resolvedVisualMatrix.clone();
    }

    return currentClone;
  }

  private emitSelectionChanged(linkPath: string | null): void {
    if (!this.onSelectionChanged) return;
    if (!linkPath) {
      this.onSelectionChanged(null, null);
      return;
    }
    this.onSelectionChanged(linkPath, this.getJointInfoForLink(linkPath));
  }

  private updateCursor(): void {
    if (!this.domElement) return;
    if (!this.enabled) {
      this.domElement.style.cursor = "";
      return;
    }
    this.domElement.style.cursor = this.dragging ? "grabbing" : "grab";
  }

  private pickLinkPathAtPointer(event: PointerEvent): string | null {
    if (!this.camera || !this.domElement || !this.renderInterface?.meshes) return null;

    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const pickMeshes: Mesh[] = [];
    const pickMap = new Map<Object3D, string>();
    for (const [meshId, hydraMesh] of Object.entries(this.renderInterface.meshes)) {
      const mesh = hydraMesh?._mesh;
      if (!mesh || !mesh.visible) continue;
      pickMeshes.push(mesh);
      pickMap.set(mesh, meshId);
    }
    if (pickMeshes.length === 0) return null;

    const hits = this.raycaster.intersectObjects(pickMeshes, false);
    for (const hit of hits) {
      const hitMeshId = pickMap.get(hit.object);
      if (!hitMeshId) continue;
      const linkPath = getLinkPathFromMeshId(hitMeshId);
      if (linkPath) return linkPath;
    }

    return null;
  }

  private initializeDragProjection(event: PointerEvent, jointState: LinkJointState): void {
    this.dragHasProjectedStartDirection = false;

    const linkMatrix = this.getCurrentLinkFrameMatrixForLinkPath(jointState.linkPath);
    if (!linkMatrix) return;

    this.dragAxisWorld.copy(jointState.axisLocal).transformDirection(linkMatrix).normalize();
    if (this.dragAxisWorld.lengthSq() <= 1e-12) return;

    if (jointState.localPivotInLink) {
      this.dragPivotWorld.copy(jointState.localPivotInLink).applyMatrix4(linkMatrix);
    } else {
      this.dragPivotWorld.setFromMatrixPosition(linkMatrix);
    }

    if (!this.projectPointerToJointPlane(event, this.dragPivotWorld, this.dragAxisWorld, this.tempDragPointWorld)) return;
    this.dragStartDirectionWorld.copy(this.tempDragPointWorld).sub(this.dragPivotWorld);
    if (this.dragStartDirectionWorld.lengthSq() <= 1e-12) return;
    this.dragStartDirectionWorld.normalize();
    this.dragHasProjectedStartDirection = true;
  }

  private projectPointerToJointPlane(
    event: PointerEvent,
    pivotWorld: Vector3,
    axisWorld: Vector3,
    outPointWorld: Vector3
  ): boolean {
    if (!this.camera || !this.domElement) return false;
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Joint axes / pivots are tracked in the USD root's local space (stage space),
    // while the raycaster operates in renderer world space. Convert the ray into
    // USD-root space so drag math stays consistent even when we rotate usdRoot
    // for Z-up stages (e.g. Unitree robots).
    const usdRoot = (window as any).usdRoot as Object3D | null | undefined;
    const rayOrigin = this.tempRayOriginLocal.copy(this.raycaster.ray.origin);
    const rayDirection = this.tempRayDirectionLocal.copy(this.raycaster.ray.direction);
    if (usdRoot) {
      usdRoot.updateMatrixWorld(true);
      this.tempUsdRootInverseWorldMatrix.copy(usdRoot.matrixWorld).invert();
      rayOrigin.applyMatrix4(this.tempUsdRootInverseWorldMatrix);
      rayDirection.transformDirection(this.tempUsdRootInverseWorldMatrix);
    }

    const denominator = rayDirection.dot(axisWorld);
    if (Math.abs(denominator) <= 1e-8) return false;

    const distance = this.tempDragStartToPointWorld.copy(pivotWorld).sub(rayOrigin).dot(axisWorld) / denominator;
    if (!Number.isFinite(distance) || distance < 0) return false;

    outPointWorld.copy(rayDirection).multiplyScalar(distance).add(rayOrigin);
    return true;
  }

  private getOrResolveJointStateForLinkPath(linkPath: string): LinkJointState | null {
    if (!linkPath) return null;
    const cachedState = this.linkJointStateByLinkPath.get(linkPath);
    if (cachedState) return cachedState;

    this.ensureJointCatalogBuildScheduled();
    const catalogEntry = this.jointCatalogByLinkPath.get(linkPath);
    if (catalogEntry) {
      const state = this.createStateFromCatalogEntry(catalogEntry);
      this.linkJointStateByLinkPath.set(linkPath, state);
      return state;
    }

    const stage = this.renderInterface?.getStage?.() || null;
    if (!stage) return null;

    const jointCandidates = getJointPathCandidatesForLinkPath(linkPath);
    for (const jointPath of jointCandidates) {
      const prim = safeGetPrimAtPath(stage, jointPath);
      if (!prim) continue;

      const typeName = safeGetPrimTypeName(prim).toLowerCase();
      if (!isControllableRevoluteJointTypeName(typeName)) continue;

      const body1Path = toUsdPathListFromValue(safeGetPrimAttribute(prim, "physics:body1"))[0] || null;
      if (body1Path && body1Path !== linkPath) continue;
      const parentLinkPath = toUsdPathListFromValue(safeGetPrimAttribute(prim, "physics:body0"))[0] || null;

      const axisToken = normalizeAxisToken(safeGetPrimAttribute(prim, "physics:axis"));
      const localRot1 = toQuaternionFromValue(safeGetPrimAttribute(prim, "physics:localRot1"));
      const axisLocal = rotateAxisByQuaternion(axisToken, localRot1);
      const limits = normalizeLimits(
        toFiniteNumber(safeGetPrimAttribute(prim, "physics:lowerLimit")),
        toFiniteNumber(safeGetPrimAttribute(prim, "physics:upperLimit"))
      );
      const localPivotInLink = toVector3FromValue(safeGetPrimAttribute(prim, "physics:localPos1"));

      const state: LinkJointState = {
        linkPath,
        jointPath,
        parentLinkPath,
        axisToken,
        axisLocal,
        lowerLimitDeg: limits.lower,
        upperLimitDeg: limits.upper,
        angleDeg: 0,
        localPivotInLink,
      };

      this.linkJointStateByLinkPath.set(linkPath, state);
      this.setLinkParentPath(linkPath, parentLinkPath);
      this.jointCatalogByLinkPath.set(linkPath, {
        linkPath,
        jointPath,
        parentLinkPath,
        axisToken,
        axisLocal: axisLocal.clone(),
        lowerLimitDeg: limits.lower,
        upperLimitDeg: limits.upper,
        localPivotInLink: localPivotInLink ? localPivotInLink.clone() : null,
      });
      return state;
    }

    return null;
  }

  private getRepresentativeMatrixForLinkPath(linkPath: string): Matrix4 | null {
    if (!this.renderInterface?.meshes) return null;
    const prefix = `${linkPath}/`;
    let preferredVisualMatrix: Matrix4 | null = null;
    let fallbackMatrix: Matrix4 | null = null;
    for (const [meshId, hydraMesh] of Object.entries(this.renderInterface.meshes)) {
      if (!meshId.startsWith(prefix)) continue;
      const matrix = hydraMesh?._mesh?.matrix;
      if (!matrix) continue;

      if (/\/visuals\.proto_mesh_id0$/i.test(meshId)) {
        return matrix.clone();
      }

      if (/\/visuals\.|\/visuals\//i.test(meshId)) {
        if (!preferredVisualMatrix) {
          preferredVisualMatrix = matrix.clone();
        }
        continue;
      }

      if (!fallbackMatrix) {
        fallbackMatrix = matrix.clone();
      }
    }
    return preferredVisualMatrix || fallbackMatrix;
  }

  private getMatrixMaxElementDelta(lhs: Matrix4, rhs: Matrix4): number {
    if (!lhs || !rhs) return Number.POSITIVE_INFINITY;
    let maxDelta = 0;
    for (let elementIndex = 0; elementIndex < 16; elementIndex++) {
      const lhsValue = Number(lhs.elements[elementIndex] || 0);
      const rhsValue = Number(rhs.elements[elementIndex] || 0);
      const delta = Math.abs(lhsValue - rhsValue);
      if (delta > maxDelta) maxDelta = delta;
    }
    return maxDelta;
  }

  private collectKnownLinkPaths(): string[] {
    const linkPaths = new Set<string>();
    for (const linkPath of this.linkJointStateByLinkPath.keys()) {
      if (linkPath) linkPaths.add(linkPath);
    }
    for (const linkPath of this.jointCatalogByLinkPath.keys()) {
      if (linkPath) linkPaths.add(linkPath);
    }
    for (const linkPath of this.linkParentPathByLinkPath.keys()) {
      if (linkPath) linkPaths.add(linkPath);
    }
    if (this.renderInterface?.meshes) {
      for (const meshId of Object.keys(this.renderInterface.meshes)) {
        const linkPath = getLinkPathFromMeshId(meshId);
        if (linkPath) linkPaths.add(linkPath);
      }
    }
    return Array.from(linkPaths);
  }

  private getBaseLinkFrameMatrixForLinkPath(linkPath: string): Matrix4 | null {
    if (!linkPath) return null;
    const cached = this.baseLinkFrameMatrixByLinkPath.get(linkPath);
    if (cached) return cached.clone();

    const preferredLinkMatrix = this.renderInterface?.getPreferredLinkWorldTransform?.(linkPath) || null;
    const representativeMatrix = this.getRepresentativeMatrixForLinkPath(linkPath);
    const stage = this.renderInterface?.getStage?.() || null;
    const stagePrim = safeGetPrimAtPath(stage, linkPath);
    const stageMatrix = this.renderInterface?.getWorldTransformForPrimPath?.(linkPath) || null;

    let selectedMatrix: Matrix4 | null = null;
    if (preferredLinkMatrix) {
      // Prefer the delegate's link frame selection. It keeps joint rotation axes in
      // the physical link frame (e.g. Go2 thigh/calf), while still allowing visual
      // fallback only when the stage link transform is truly degenerate.
      selectedMatrix = preferredLinkMatrix.clone();
    } else if (stageMatrix && stagePrim) {
      selectedMatrix = stageMatrix.clone();
    } else if (representativeMatrix) {
      selectedMatrix = representativeMatrix;
    } else if (stageMatrix) {
      selectedMatrix = stageMatrix.clone();
    }

    if (selectedMatrix) {
      this.baseLinkFrameMatrixByLinkPath.set(linkPath, selectedMatrix.clone());
      return selectedMatrix.clone();
    }

    return null;
  }

  private buildBaseLinkPoseMap(): Map<string, Matrix4> {
    const linkPoseByLinkPath = new Map<string, Matrix4>();
    for (const linkPath of this.collectKnownLinkPaths()) {
      const baseMatrix = this.getBaseLinkFrameMatrixForLinkPath(linkPath);
      if (!baseMatrix) continue;
      linkPoseByLinkPath.set(linkPath, baseMatrix.clone());
    }
    return linkPoseByLinkPath;
  }

  private syncPosedLinkFrameMap(linkPoseByLinkPath: Map<string, Matrix4>): void {
    this.posedLinkFrameMatrixByLinkPath.clear();
    for (const [linkPath, linkMatrix] of linkPoseByLinkPath.entries()) {
      this.posedLinkFrameMatrixByLinkPath.set(linkPath, linkMatrix.clone());
    }
  }

  private getCurrentLinkFrameMatrixForLinkPath(linkPath: string): Matrix4 | null {
    const posedMatrix = this.posedLinkFrameMatrixByLinkPath.get(linkPath);
    if (posedMatrix) return posedMatrix.clone();
    return this.getBaseLinkFrameMatrixForLinkPath(linkPath);
  }

  private applyRotationToLinkPoseSubtree(
    ancestorLinkPath: string,
    rotationMatrix: Matrix4,
    linkPoseByLinkPath: Map<string, Matrix4>
  ): void {
    const subtreeLinkPaths = this.getSubtreeLinkPaths(ancestorLinkPath);
    if (subtreeLinkPaths && subtreeLinkPaths.size > 0) {
      for (const linkPath of subtreeLinkPaths) {
        const linkMatrix = linkPoseByLinkPath.get(linkPath);
        if (!linkMatrix) continue;
        linkMatrix.premultiply(rotationMatrix);
      }
      return;
    }

    for (const linkPath of this.collectKnownLinkPaths()) {
      if (!this.isLinkPathInSubtree(linkPath, ancestorLinkPath)) continue;
      const linkMatrix = linkPoseByLinkPath.get(linkPath);
      if (!linkMatrix) continue;
      linkMatrix.premultiply(rotationMatrix);
    }
  }

  private getParentLinkPath(linkPath: string): string | null {
    if (!linkPath) return null;
    if (this.linkParentPathByLinkPath.has(linkPath)) {
      return this.linkParentPathByLinkPath.get(linkPath) || null;
    }

    const stage = this.renderInterface?.getStage?.() || null;
    if (!stage) return null;

    const jointCandidates = getJointPathCandidatesForLinkPath(linkPath);
    for (const jointPath of jointCandidates) {
      const prim = safeGetPrimAtPath(stage, jointPath);
      if (!prim) continue;

      const typeName = safeGetPrimTypeName(prim);
      if (!isPhysicsJointTypeName(typeName)) continue;

      const body1Path = toUsdPathListFromValue(safeGetPrimAttribute(prim, "physics:body1"))[0] || null;
      if (body1Path && body1Path !== linkPath) continue;

      const parentLinkPath = toUsdPathListFromValue(safeGetPrimAttribute(prim, "physics:body0"))[0] || null;
      this.setLinkParentPath(linkPath, parentLinkPath);
      return parentLinkPath;
    }

    this.setLinkParentPath(linkPath, null);
    return null;
  }

  private applyRotationToLinkSubtree(ancestorLinkPath: string, rotationMatrix: Matrix4): void {
    if (!this.renderInterface?.meshes) return;
    if (this.linkPathByMeshId.size <= 0) {
      this.refreshMeshLinkPathIndex();
    }

    const subtreeMeshIds = this.getSubtreeMeshIds(ancestorLinkPath);
    if (subtreeMeshIds && subtreeMeshIds.length > 0) {
      for (const meshId of subtreeMeshIds) {
        const hydraMesh = (this.renderInterface.meshes as Record<string, any>)[meshId];
        const mesh = hydraMesh?._mesh;
        if (!mesh) continue;
        mesh.matrix.premultiply(rotationMatrix);
        mesh.matrixAutoUpdate = false;
      }
      return;
    }

    const inSubtreeByLinkPath = new Map<string, boolean>();
    for (const [meshId, linkPath] of this.linkPathByMeshId.entries()) {
      const cached = inSubtreeByLinkPath.get(linkPath);
      const inSubtree = cached !== undefined ? cached : this.isLinkPathInSubtree(linkPath, ancestorLinkPath);
      if (cached === undefined) inSubtreeByLinkPath.set(linkPath, inSubtree);
      if (!inSubtree) continue;
      const hydraMesh = (this.renderInterface.meshes as Record<string, any>)[meshId];
      const mesh = hydraMesh?._mesh;
      if (!mesh) continue;
      mesh.matrix.premultiply(rotationMatrix);
      mesh.matrixAutoUpdate = false;
    }
  }

  private refreshMeshLinkPathIndex(): void {
    this.linkPathByMeshId.clear();
    const meshes = this.renderInterface?.meshes;
    this.markSubtreeIndexDirty();
    if (!meshes) return;
    for (const meshId of Object.keys(meshes)) {
      const linkPath = getLinkPathFromMeshId(meshId);
      if (!linkPath) continue;
      this.linkPathByMeshId.set(meshId, linkPath);
    }
  }

  private isLinkPathInSubtree(linkPath: string, ancestorLinkPath: string): boolean {
    if (linkPath === ancestorLinkPath) return true;

    const subtreeLinkPaths = this.getSubtreeLinkPaths(ancestorLinkPath);
    if (subtreeLinkPaths) {
      return subtreeLinkPaths.has(linkPath);
    }

    const visited = new Set<string>();
    let currentLinkPath = linkPath;
    while (true) {
      if (visited.has(currentLinkPath)) return false;
      visited.add(currentLinkPath);
      const parentLinkPath = this.getParentLinkPath(currentLinkPath);
      if (!parentLinkPath) return false;
      if (parentLinkPath === ancestorLinkPath) return true;
      currentLinkPath = parentLinkPath;
    }
  }

  private getLinkDepth(linkPath: string): number {
    let depth = 0;
    const visited = new Set<string>();
    let currentLinkPath = linkPath;
    while (true) {
      if (visited.has(currentLinkPath)) return depth;
      visited.add(currentLinkPath);
      const parentLinkPath = this.getParentLinkPath(currentLinkPath);
      if (!parentLinkPath) return depth;
      depth++;
      currentLinkPath = parentLinkPath;
    }
  }

  private setLinkParentPath(linkPath: string, parentLinkPath: string | null | undefined): void {
    if (!linkPath) return;
    const normalizedParent = parentLinkPath || null;
    const existingParent = this.linkParentPathByLinkPath.has(linkPath)
      ? (this.linkParentPathByLinkPath.get(linkPath) || null)
      : undefined;
    if (existingParent !== undefined && existingParent === normalizedParent) return;
    this.linkParentPathByLinkPath.set(linkPath, normalizedParent);
    this.markSubtreeIndexDirty();
  }

  private markSubtreeIndexDirty(): void {
    this.subtreeIndexDirty = true;
  }

  private ensureSubtreeIndex(options: { resolveMissingParents?: boolean } = {}): void {
    if (this.linkPathByMeshId.size <= 0) {
      this.refreshMeshLinkPathIndex();
    }

    if (options.resolveMissingParents === true) {
      const knownLinkPaths = new Set<string>();
      for (const linkPath of this.linkPathByMeshId.values()) {
        if (linkPath) knownLinkPaths.add(linkPath);
      }
      for (const linkPath of this.linkJointStateByLinkPath.keys()) {
        if (linkPath) knownLinkPaths.add(linkPath);
      }
      for (const linkPath of this.jointCatalogByLinkPath.keys()) {
        if (linkPath) knownLinkPaths.add(linkPath);
      }
      for (const linkPath of knownLinkPaths) {
        if (!this.linkParentPathByLinkPath.has(linkPath)) {
          this.getParentLinkPath(linkPath);
        }
      }
    }

    if (!this.subtreeIndexDirty && this.subtreeLinkPathsByAncestorLinkPath.size > 0) {
      return;
    }

    this.subtreeLinkPathsByAncestorLinkPath.clear();
    this.subtreeMeshIdsByAncestorLinkPath.clear();

    const allLinkPaths = new Set<string>();
    for (const linkPath of this.collectKnownLinkPaths()) {
      if (linkPath) allLinkPaths.add(linkPath);
    }
    for (const [childLinkPath, parentLinkPath] of this.linkParentPathByLinkPath.entries()) {
      if (childLinkPath) allLinkPaths.add(childLinkPath);
      if (parentLinkPath) allLinkPaths.add(parentLinkPath);
    }
    if (allLinkPaths.size <= 0) {
      this.subtreeIndexDirty = false;
      return;
    }

    const childLinkPathsByParentLinkPath = new Map<string, string[]>();
    for (const [childLinkPath, parentLinkPath] of this.linkParentPathByLinkPath.entries()) {
      if (!childLinkPath || !parentLinkPath) continue;
      const children = childLinkPathsByParentLinkPath.get(parentLinkPath) || [];
      children.push(childLinkPath);
      childLinkPathsByParentLinkPath.set(parentLinkPath, children);
    }

    const meshIdsByLinkPath = new Map<string, string[]>();
    for (const [meshId, linkPath] of this.linkPathByMeshId.entries()) {
      const meshIds = meshIdsByLinkPath.get(linkPath) || [];
      meshIds.push(meshId);
      meshIdsByLinkPath.set(linkPath, meshIds);
    }

    for (const ancestorLinkPath of allLinkPaths) {
      const descendants = new Set<string>();
      const queue: string[] = [ancestorLinkPath];
      while (queue.length > 0) {
        const currentLinkPath = queue.pop() || "";
        if (!currentLinkPath || descendants.has(currentLinkPath)) continue;
        descendants.add(currentLinkPath);
        const children = childLinkPathsByParentLinkPath.get(currentLinkPath) || [];
        for (const childLinkPath of children) {
          if (!descendants.has(childLinkPath)) {
            queue.push(childLinkPath);
          }
        }
      }
      this.subtreeLinkPathsByAncestorLinkPath.set(ancestorLinkPath, descendants);

      const meshIds: string[] = [];
      for (const descendantLinkPath of descendants) {
        const descendantMeshIds = meshIdsByLinkPath.get(descendantLinkPath);
        if (!descendantMeshIds || descendantMeshIds.length <= 0) continue;
        meshIds.push(...descendantMeshIds);
      }
      this.subtreeMeshIdsByAncestorLinkPath.set(ancestorLinkPath, meshIds);
    }

    this.subtreeIndexDirty = false;
  }

  private getSubtreeLinkPaths(ancestorLinkPath: string): Set<string> | null {
    if (!ancestorLinkPath) return null;
    this.ensureSubtreeIndex();
    return this.subtreeLinkPathsByAncestorLinkPath.get(ancestorLinkPath) || null;
  }

  private getSubtreeMeshIds(ancestorLinkPath: string): string[] | null {
    if (!ancestorLinkPath) return null;
    this.ensureSubtreeIndex();
    return this.subtreeMeshIdsByAncestorLinkPath.get(ancestorLinkPath) || null;
  }

  private collectAffectedLinkPaths(activeJointStates: LinkJointState[]): Set<string> {
    const affectedLinkPaths = new Set<string>();
    for (const jointState of activeJointStates) {
      const subtreeLinkPaths = this.getSubtreeLinkPaths(jointState.linkPath);
      if (!subtreeLinkPaths || subtreeLinkPaths.size <= 0) {
        affectedLinkPaths.add(jointState.linkPath);
        continue;
      }
      for (const linkPath of subtreeLinkPaths) {
        affectedLinkPaths.add(linkPath);
      }
    }
    return affectedLinkPaths;
  }

  private collectAffectedMeshIds(activeJointStates: LinkJointState[]): Set<string> {
    const affectedMeshIds = new Set<string>();
    for (const jointState of activeJointStates) {
      const subtreeMeshIds = this.getSubtreeMeshIds(jointState.linkPath);
      if (!subtreeMeshIds || subtreeMeshIds.length <= 0) continue;
      for (const meshId of subtreeMeshIds) {
        affectedMeshIds.add(meshId);
      }
    }
    return affectedMeshIds;
  }

  private createStateFromCatalogEntry(entry: JointCatalogEntry): LinkJointState {
    return {
      linkPath: entry.linkPath,
      jointPath: entry.jointPath,
      parentLinkPath: entry.parentLinkPath,
      axisToken: entry.axisToken,
      axisLocal: entry.axisLocal.clone(),
      lowerLimitDeg: entry.lowerLimitDeg,
      upperLimitDeg: entry.upperLimitDeg,
      angleDeg: 0,
      localPivotInLink: entry.localPivotInLink ? entry.localPivotInLink.clone() : null,
    };
  }

  private ensureJointCatalogBuildScheduled(): void {
    this.startJointCatalogBuildIfNeeded();
  }

  private async ensureJointCatalogReady(options: { maxWaitMs?: number } = {}): Promise<void> {
    const buildPromise = this.startJointCatalogBuildIfNeeded();
    if (!buildPromise) return;
    const maxWaitMs = Number(options.maxWaitMs);
    if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
      try {
        await buildPromise;
      } catch {}
      return;
    }
    if (maxWaitMs <= 0) return;

    let timeoutHandle: number | null = null;
    try {
      await Promise.race([
        buildPromise,
        new Promise<void>((resolve) => {
          timeoutHandle = window.setTimeout(resolve, maxWaitMs);
        }),
      ]);
    } catch {}
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
    }
  }

  private startJointCatalogBuildIfNeeded(): Promise<void> | null {
    if (this.jointCatalogBuildPromise) return this.jointCatalogBuildPromise;
    if (this.jointCatalogByLinkPath.size > 0 || this.linkParentPathByLinkPath.size > 0) {
      return Promise.resolve();
    }

    const cacheKey = this.getJointCatalogCacheKey();
    if (cacheKey && this.restoreJointCatalogFromCache(cacheKey)) {
      return Promise.resolve();
    }

    const runtimeLinkPathIndex = buildRuntimeLinkPathIndex(this.renderInterface);
    if (runtimeLinkPathIndex.allLinkPaths.size <= 0) {
      return null;
    }

    const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
      ? performance.now()
      : Date.now();
    if (
      this.lastJointCatalogBuildAttemptAtMs > 0
      && (nowMs - this.lastJointCatalogBuildAttemptAtMs) < this.jointCatalogRebuildCooldownMs
    ) {
      return null;
    }

    const cachedRenderSnapshot = getRenderRobotMetadataSnapshot(this.renderInterface, this.stageSourcePath);
    const importedFromCachedSnapshot = this.ingestJointCatalogFromRenderSnapshot(cachedRenderSnapshot, runtimeLinkPathIndex);
    if (importedFromCachedSnapshot > 0) {
      return Promise.resolve();
    }

    const importedFromDriverSnapshot = this.tryHydrateJointCatalogFromDriverSnapshot(runtimeLinkPathIndex);
    if (importedFromDriverSnapshot > 0) {
      return Promise.resolve();
    }

    if (!this.allowStageJointCatalogFallback) {
      this.jointCatalogBuildPromise = Promise.resolve()
        .then(async () => {
          const refreshedRuntimeLinkPathIndex = buildRuntimeLinkPathIndex(this.renderInterface);
          if (refreshedRuntimeLinkPathIndex.allLinkPaths.size <= 0) return;
          const warmedSnapshot = await warmupRenderRobotMetadataSnapshot(this.renderInterface, {
            stageSourcePath: this.stageSourcePath,
            force: true,
            skipIdleWait: true,
            skipUrdfTruthFallback: true,
          });
          this.ingestJointCatalogFromRenderSnapshot(warmedSnapshot, refreshedRuntimeLinkPathIndex);
          if (!cacheKey) return;
          this.saveJointCatalogToCache(cacheKey);
        })
        .catch(() => {
          // Keep strict one-shot fallback disabled path resilient.
        })
        .finally(() => {
          this.jointCatalogBuildPromise = null;
        });
      return this.jointCatalogBuildPromise;
    }

    this.lastJointCatalogBuildAttemptAtMs = nowMs;
    const stage = ((window as any).usdStage || null) as StageLike | null;
    this.jointCatalogBuildPromise = this.buildJointCatalog(stage)
      .then(() => {
        if (!cacheKey) return;
        this.saveJointCatalogToCache(cacheKey);
      })
      .catch((error) => {
        console.warn("Failed to build joint catalog for link rotation.", error);
      })
      .finally(() => {
        this.jointCatalogBuildPromise = null;
      });
    return this.jointCatalogBuildPromise;
  }

  private tryHydrateJointCatalogFromDriverSnapshot(runtimeLinkPathIndex: RuntimeLinkPathIndex): number {
    const activeDriver = (window as any).driver;
    if (!activeDriver || typeof activeDriver.GetRobotMetadataSnapshot !== "function") return 0;

    const sortedLinkPaths = Array.from(runtimeLinkPathIndex.allLinkPaths)
      .filter((linkPath) => !!linkPath)
      .sort((left, right) => left.localeCompare(right));
    if (sortedLinkPaths.length <= 0) return 0;

    try {
      const rawSnapshot = activeDriver.GetRobotMetadataSnapshot(
        sortedLinkPaths,
        String(this.stageSourcePath || ""),
      );
      const normalizedSnapshot = normalizeRenderRobotMetadataSnapshot(rawSnapshot);
      return this.ingestJointCatalogFromRenderSnapshot(normalizedSnapshot, runtimeLinkPathIndex);
    } catch {
      return 0;
    }
  }

  private getDurationParamMsFromQuery(paramName: string, fallbackMs: number, minMs: number, maxMs: number): number {
    const search = String(window?.location?.search || "");
    const params = new URLSearchParams(search);
    const requestedRaw = params.get(paramName);
    if (requestedRaw === null || requestedRaw === "") return fallbackMs;
    const requested = Number(requestedRaw);
    if (!Number.isFinite(requested)) return fallbackMs;
    return Math.max(minMs, Math.min(maxMs, Math.floor(requested)));
  }

  private getBooleanParamFromQuery(paramName: string, fallback: boolean): boolean {
    const search = String(window?.location?.search || "");
    const params = new URLSearchParams(search);
    return parseBooleanFlag(params.get(paramName), fallback);
  }

  private async waitForBrowserIdleSlice(timeoutMs: number): Promise<void> {
    const normalizedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
    const requestIdle = (window as any).requestIdleCallback as
      | ((callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void, options?: { timeout: number }) => number)
      | undefined;
    if (typeof requestIdle !== "function") {
      await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(120, normalizedTimeoutMs)));
      return;
    }

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      try {
        requestIdle(() => finish(), { timeout: normalizedTimeoutMs });
      } catch {
        finish();
        return;
      }
      window.setTimeout(finish, normalizedTimeoutMs + 40);
    });
  }

  private getJointCatalogCacheKey(): string | null {
    const normalizedPath = String(this.stageSourcePath || "").trim();
    if (!normalizedPath) return null;
    return normalizedPath.split("?")[0];
  }

  private restoreJointCatalogFromCache(cacheKey: string): boolean {
    if (!cacheKey) return false;
    const cacheEntry = jointCatalogCacheByStagePath.get(cacheKey);
    if (!cacheEntry) return false;

    jointCatalogCacheByStagePath.delete(cacheKey);
    jointCatalogCacheByStagePath.set(cacheKey, cacheEntry);

    this.linkParentPathByLinkPath.clear();
    this.markSubtreeIndexDirty();
    for (const [linkPath, parentLinkPath] of cacheEntry.linkParentPairs) {
      this.setLinkParentPath(linkPath, parentLinkPath);
    }

    this.jointCatalogByLinkPath.clear();
    for (const entry of cacheEntry.jointCatalogEntries) {
      this.jointCatalogByLinkPath.set(entry.linkPath, cloneJointCatalogEntry(entry));
    }

    for (const [linkPath, existingState] of this.linkJointStateByLinkPath) {
      const cachedEntry = this.jointCatalogByLinkPath.get(linkPath);
      if (!cachedEntry) continue;
      existingState.jointPath = cachedEntry.jointPath;
      existingState.parentLinkPath = cachedEntry.parentLinkPath;
      existingState.axisToken = cachedEntry.axisToken;
      existingState.axisLocal = cachedEntry.axisLocal.clone();
      existingState.lowerLimitDeg = cachedEntry.lowerLimitDeg;
      existingState.upperLimitDeg = cachedEntry.upperLimitDeg;
      existingState.localPivotInLink = cachedEntry.localPivotInLink ? cachedEntry.localPivotInLink.clone() : null;
      existingState.angleDeg = clampJointAnglePreservingNeutralZero(
        existingState.angleDeg,
        existingState.lowerLimitDeg,
        existingState.upperLimitDeg
      );
    }

    return true;
  }

  private saveJointCatalogToCache(cacheKey: string): void {
    if (!cacheKey) return;
    if (this.jointCatalogByLinkPath.size === 0 && this.linkParentPathByLinkPath.size === 0) return;

    const cacheEntry: JointCatalogCacheSnapshot = {
      linkParentPairs: Array.from(this.linkParentPathByLinkPath.entries()),
      jointCatalogEntries: Array.from(this.jointCatalogByLinkPath.values()).map((entry) => cloneJointCatalogEntry(entry)),
    };

    jointCatalogCacheByStagePath.delete(cacheKey);
    jointCatalogCacheByStagePath.set(cacheKey, cacheEntry);
    while (jointCatalogCacheByStagePath.size > maxJointCatalogCacheEntries) {
      const oldestKey = jointCatalogCacheByStagePath.keys().next().value;
      if (!oldestKey) break;
      jointCatalogCacheByStagePath.delete(oldestKey);
    }
  }

  private async buildJointCatalog(initialStage: StageLike | null): Promise<void> {
    const profileJointCatalog = /(?:\?|&)profileJointCatalog=(?:1|true|yes|on)(?:&|$)/i.test(String(window.location?.search || ""));
    const runtimeLinkPathIndex = buildRuntimeLinkPathIndex(this.renderInterface);
    const importedFromRenderSnapshot = this.ingestJointCatalogFromRenderSnapshot(
      await warmupRenderRobotMetadataSnapshot(this.renderInterface, {
        stageSourcePath: this.stageSourcePath,
        skipIdleWait: true,
        skipUrdfTruthFallback: true,
      }),
      runtimeLinkPathIndex,
    );
    if (importedFromRenderSnapshot > 0) {
      if (profileJointCatalog) {
        const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
          ? Math.round(performance.now())
          : Date.now();
        console.info("[LinkRotation] Render snapshot joint import count:", importedFromRenderSnapshot, "at", nowMs, "ms");
      }
      return;
    }

    const rootPathSet = new Set<string>([
      ...getRootPathsFromRenderInterface(this.renderInterface),
      ...runtimeLinkPathIndex.rootPaths,
    ]);
    const rootPaths = Array.from(rootPathSet);

    let stage = initialStage;
    const usdModule = (window as any).USD;
    if (!stage && this.stageSourcePath && usdModule?.UsdStage?.Open) {
      stage = await this.safeOpenUsdStage(usdModule, this.stageSourcePath);
    }
    if (!stage) return;

    const fallbackDelayMs = Math.max(0, Math.floor(this.jointCatalogStageFallbackDelayMs));
    if (fallbackDelayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, fallbackDelayMs));
    }
    await this.waitForBrowserIdleSlice(this.jointCatalogStageFallbackIdleTimeoutMs);

    const rootLayerText = this.safeExportRootLayerText(stage);
    this.ingestJointCatalogFromStage(stage, rootLayerText, rootPaths, runtimeLinkPathIndex);

    const physicsPayloadAssets = extractPhysicsPayloadAssetPathsFromLayerText(rootLayerText);
    if (physicsPayloadAssets.length > 0 && usdModule?.UsdStage?.Open) {
      for (const payloadAssetPath of physicsPayloadAssets) {
        const resolvedPath = resolveUsdAssetPath(this.stageSourcePath, payloadAssetPath);
        if (!resolvedPath) continue;

        const payloadStage = await this.safeOpenUsdStage(usdModule, resolvedPath);
        if (!payloadStage) continue;

        const payloadText = this.safeExportRootLayerText(payloadStage);
        this.ingestJointCatalogFromStage(payloadStage, payloadText, rootPaths, runtimeLinkPathIndex);
      }
    }
  }

  private safeExportRootLayerText(stage: StageLike | null): string {
    if (!stage?.GetRootLayer) return "";
    try {
      const rootLayer = stage.GetRootLayer();
      if (!rootLayer?.ExportToString) return "";
      const exported = rootLayer.ExportToString();
      return typeof exported === "string" ? exported : String(exported || "");
    } catch {
      return "";
    }
  }

  private async safeOpenUsdStage(usdModule: any, stagePath: string): Promise<StageLike | null> {
    if (!usdModule?.UsdStage?.Open || !stagePath) return null;
    try {
      const openedStage = usdModule.UsdStage.Open(stagePath);
      if (openedStage && typeof openedStage.then === "function") {
        const resolvedStage = await openedStage;
        return resolvedStage || null;
      }
      return openedStage || null;
    } catch {
      return null;
    }
  }

  private ingestJointCatalogFromStage(
    stage: StageLike,
    layerText: string,
    fallbackRootPaths: string[],
    runtimeLinkPathIndex: RuntimeLinkPathIndex
  ): number {
    return ingestJointCatalogFromStage(this, stage, layerText, fallbackRootPaths, runtimeLinkPathIndex);
  }

  private ingestJointCatalogFromRenderSnapshot(
    snapshot: RenderRobotMetadataSnapshot | null,
    runtimeLinkPathIndex: RuntimeLinkPathIndex,
  ): number {
    if (!snapshot) return 0;

    if (Array.isArray(snapshot.linkParentPairs) && snapshot.linkParentPairs.length > 0) {
      for (const pair of snapshot.linkParentPairs) {
        if (!Array.isArray(pair) || pair.length <= 0) continue;
        const childCandidates = resolveRuntimeLinkPathsFromSourcePath(pair[0], runtimeLinkPathIndex);
        if (childCandidates.length <= 0) continue;

        for (const childLinkPath of childCandidates) {
          if (!childLinkPath) continue;
          const preferredRootPath = getRootPathFromLinkPath(childLinkPath);
          const parentCandidates = resolveRuntimeLinkPathsFromSourcePath(
            pair[1],
            runtimeLinkPathIndex,
            preferredRootPath,
          );
          const parentLinkPath = pickRuntimeParentLinkPath(parentCandidates, preferredRootPath);
          this.setLinkParentPath(childLinkPath, parentLinkPath);
        }
      }
    }

    if (!Array.isArray(snapshot.jointCatalogEntries) || snapshot.jointCatalogEntries.length <= 0) return 0;

    let imported = 0;
    for (const entry of snapshot.jointCatalogEntries) {
      if (!entry?.linkPath) continue;
      const resolvedLinkPaths = resolveRuntimeLinkPathsFromSourcePath(entry.linkPath, runtimeLinkPathIndex);
      if (resolvedLinkPaths.length <= 0) continue;

      for (const linkPath of resolvedLinkPaths) {
        if (!linkPath) continue;
        const preferredRootPath = getRootPathFromLinkPath(linkPath);
        const parentCandidates = resolveRuntimeLinkPathsFromSourcePath(
          entry.parentLinkPath,
          runtimeLinkPathIndex,
          preferredRootPath,
        );
        const parentLinkPath = pickRuntimeParentLinkPath(parentCandidates, preferredRootPath);
        this.setLinkParentPath(linkPath, parentLinkPath);

        const axisLocal = normalizeAxisVector(new Vector3(
          Number(entry.axisLocal?.[0] || 0),
          Number(entry.axisLocal?.[1] || 0),
          Number(entry.axisLocal?.[2] || 0),
        ));
        const limits = normalizeLimits(
          toFiniteNumber(entry.lowerLimitDeg),
          toFiniteNumber(entry.upperLimitDeg),
        );
        const localPivotInLink = Array.isArray(entry.localPivotInLink)
          ? new Vector3(
            Number(entry.localPivotInLink[0] || 0),
            Number(entry.localPivotInLink[1] || 0),
            Number(entry.localPivotInLink[2] || 0),
          )
          : null;

        const fallbackJointName = String(entry.jointName || `${linkPath.split("/").pop() || "link"}_joint`).trim();
        const jointPath = String(entry.jointPath || "").trim()
          || (preferredRootPath
            ? `${preferredRootPath}/joints/${fallbackJointName}`
            : `/joints/${fallbackJointName}`);

        this.applyJointCatalogEntry({
          linkPath,
          jointPath,
          parentLinkPath,
          axisToken: normalizeAxisToken(entry.axisToken || axisTokenFromAxisVector(axisLocal)),
          axisLocal,
          lowerLimitDeg: limits.lower,
          upperLimitDeg: limits.upper,
          localPivotInLink,
        });
        imported++;
      }
    }

    return imported;
  }

  private buildJointSearchRoots(rootPaths: string[], preferredRootPath: string | null): string[] {
    const ordered = new Set<string>();
    if (preferredRootPath) ordered.add(preferredRootPath);
    for (const rootPath of rootPaths || []) {
      if (!rootPath) continue;
      ordered.add(rootPath);
    }
    return Array.from(ordered);
  }

  private applyJointCatalogEntry(entry: JointCatalogEntry): void {
    if (!entry?.linkPath || !entry.jointPath) return;
    const normalizedEntry: JointCatalogEntry = {
      ...entry,
      axisLocal: normalizeAxisVector(entry.axisLocal),
      localPivotInLink: entry.localPivotInLink ? entry.localPivotInLink.clone() : null,
    };

    this.jointCatalogByLinkPath.set(normalizedEntry.linkPath, {
      ...normalizedEntry,
      axisLocal: normalizedEntry.axisLocal.clone(),
      localPivotInLink: normalizedEntry.localPivotInLink ? normalizedEntry.localPivotInLink.clone() : null,
    });
    this.setLinkParentPath(normalizedEntry.linkPath, normalizedEntry.parentLinkPath);

    const existingState = this.linkJointStateByLinkPath.get(normalizedEntry.linkPath);
    if (!existingState) return;
    existingState.jointPath = normalizedEntry.jointPath;
    existingState.parentLinkPath = normalizedEntry.parentLinkPath;
    existingState.axisToken = normalizedEntry.axisToken;
    existingState.axisLocal = normalizedEntry.axisLocal.clone();
    existingState.lowerLimitDeg = normalizedEntry.lowerLimitDeg;
    existingState.upperLimitDeg = normalizedEntry.upperLimitDeg;
    existingState.localPivotInLink = normalizedEntry.localPivotInLink ? normalizedEntry.localPivotInLink.clone() : null;
    existingState.angleDeg = clampJointAnglePreservingNeutralZero(
      existingState.angleDeg,
      existingState.lowerLimitDeg,
      existingState.upperLimitDeg
    );
  }

  private resolveJointPathFromName(stage: StageLike, rootPaths: string[], jointName: string): string | null {
    if (!jointName) return null;
    const candidates = new Set<string>();
    if (rootPaths.length === 0) {
      candidates.add(`/joints/${jointName}`);
      candidates.add(`/${jointName}`);
    } else {
      for (const rootPath of rootPaths) {
        candidates.add(`${rootPath}/joints/${jointName}`);
        candidates.add(`${rootPath}/${jointName}`);
      }
    }

    for (const candidatePath of candidates) {
      const prim = safeGetPrimAtPath(stage, candidatePath);
      const typeName = safeGetPrimTypeName(prim).toLowerCase();
      if (!isControllableRevoluteJointTypeName(typeName)) continue;
      return candidatePath;
    }

    for (const candidatePath of candidates) {
      if (candidatePath.includes(`/joints/${jointName}`)) return candidatePath;
    }
    return Array.from(candidates)[0] || null;
  }
}
