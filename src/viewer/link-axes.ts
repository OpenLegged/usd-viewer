import { AxesHelper, CanvasTexture, Group, Matrix4, Sprite, SpriteMaterial } from "three";

type RenderInterfaceLike = {
  meshes?: Record<string, unknown>;
  getWorldTransformForPrimPath?: (path: string) => Matrix4 | null;
  getPreferredLinkWorldTransform?: (path: string) => Matrix4 | null;
};

const LINK_AXIS_SIZE = 0.08;
const LABEL_CLUSTER_SLOT_COUNT = 10;
const LABEL_CLUSTER_RADIUS_STEP = 0.018;
const LABEL_OFFSET_BASE = 0.02;

function getLinkPathFromMeshId(meshId: string): string | null {
  if (!meshId) return null;
  const marker = ".proto_";
  const markerIndex = meshId.indexOf(marker);
  if (markerIndex <= 0) return null;
  let linkPath = meshId.substring(0, markerIndex);
  if (linkPath.endsWith("/visuals") || linkPath.endsWith("/collisions")) {
    const parentSlash = linkPath.lastIndexOf("/");
    if (parentSlash > 0) linkPath = linkPath.substring(0, parentSlash);
  }
  return linkPath;
}

function getRootPathFromLinkPath(linkPath: string): string | null {
  const segments = String(linkPath || "").split("/").filter(Boolean);
  if (segments.length === 0) return null;
  return `/${segments[0]}`;
}

function getLinkDisplayName(linkPath: string): string {
  const segments = String(linkPath || "").split("/").filter(Boolean);
  return segments[segments.length - 1] || linkPath;
}

function getLabelClusterKey(matrix: Matrix4): string {
  const x = Math.round((matrix.elements[12] || 0) * 100);
  const y = Math.round((matrix.elements[13] || 0) * 100);
  const z = Math.round((matrix.elements[14] || 0) * 100);
  return `${x}:${y}:${z}`;
}

function getLabelOffsetForClusterIndex(clusterIndex: number): { x: number; y: number; z: number } {
  const slot = clusterIndex % LABEL_CLUSTER_SLOT_COUNT;
  const ring = Math.floor(clusterIndex / LABEL_CLUSTER_SLOT_COUNT);
  const angle = (slot / LABEL_CLUSTER_SLOT_COUNT) * Math.PI * 2;
  const radius = LABEL_OFFSET_BASE + ring * LABEL_CLUSTER_RADIUS_STEP;
  return {
    x: LABEL_OFFSET_BASE + Math.cos(angle) * radius,
    y: LABEL_OFFSET_BASE + Math.sin(angle) * radius,
    z: LABEL_OFFSET_BASE * 0.5,
  };
}

function createLinkLabelSprite(linkPath: string): Sprite {
  const label = getLinkDisplayName(linkPath);
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 72;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(18, 20, 24, 0.72)";
    context.fillRect(0, 8, canvas.width, canvas.height - 16);
    context.strokeStyle = "rgba(255, 255, 255, 0.22)";
    context.lineWidth = 2;
    context.strokeRect(1, 9, canvas.width - 2, canvas.height - 18);
    context.font = "bold 24px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.fillText(label, canvas.width / 2, canvas.height / 2);
  }

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  material.toneMapped = false;

  const sprite = new Sprite(material);
  sprite.name = `axisLabel:${linkPath}`;
  const labelLength = Math.max(label.length, 4);
  const widthScale = Math.min(0.16, Math.max(0.08, 0.056 + labelLength * 0.0032));
  sprite.scale.set(widthScale, 0.018, 1);
  sprite.renderOrder = 2200;
  return sprite;
}

function getMatrixMaxElementDelta(left: Matrix4 | null, right: Matrix4 | null): number {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  let maxDelta = 0;
  for (let elementIndex = 0; elementIndex < 16; elementIndex++) {
    const leftValue = Number(left.elements[elementIndex] || 0);
    const rightValue = Number(right.elements[elementIndex] || 0);
    const delta = Math.abs(leftValue - rightValue);
    if (delta > maxDelta) maxDelta = delta;
  }
  return maxDelta;
}

function getRepresentativeMeshMatrixForLinkPath(
  renderInterface: RenderInterfaceLike | null | undefined,
  linkPath: string
): Matrix4 | null {
  if (!renderInterface?.meshes || !linkPath) return null;
  const prefix = `${linkPath}/`;
  let preferredVisual: Matrix4 | null = null;
  let fallback: Matrix4 | null = null;
  for (const [meshId, hydraMesh] of Object.entries(renderInterface.meshes)) {
    if (!meshId.startsWith(prefix)) continue;
    const matrix = (hydraMesh as any)?._mesh?.matrix as Matrix4 | undefined;
    if (!matrix) continue;

    if (/\/visuals\.proto_mesh_id0$/i.test(meshId)) {
      return matrix.clone();
    }
    if (/\/visuals\.proto_/i.test(meshId)) {
      if (!preferredVisual) preferredVisual = matrix.clone();
      continue;
    }
    if (!fallback) fallback = matrix.clone();
  }
  return preferredVisual || fallback || null;
}

export class LinkAxesController {
  private linkAxesGroup: Group | null = null;

  clear(usdRoot: Group): void {
    if (!this.linkAxesGroup) return;
    usdRoot.remove(this.linkAxesGroup);
    this.linkAxesGroup.traverse((obj: any) => {
      obj.geometry?.dispose?.();
      const disposeMaterial = (material: any) => {
        if (!material) return;
        material.map?.dispose?.();
        material.alphaMap?.dispose?.();
        material.dispose?.();
      };
      if (Array.isArray(obj.material)) {
        for (const material of obj.material) disposeMaterial(material);
      } else {
        disposeMaterial(obj.material);
      }
    });
    this.linkAxesGroup = null;
  }

  rebuild(usdRoot: Group, renderInterface: RenderInterfaceLike | null | undefined, showLinkAxes: boolean): void {
    this.clear(usdRoot);
    if (!showLinkAxes || !renderInterface?.meshes || !renderInterface.getWorldTransformForPrimPath) return;

    const group = new Group();
    group.name = "Link Axes";
    const linkPaths = new Set<string>();
    for (const meshId of Object.keys(renderInterface.meshes)) {
      const linkPath = getLinkPathFromMeshId(meshId);
      if (!linkPath) continue;
      linkPaths.add(linkPath);
    }

    const rootPaths = new Set<string>();
    for (const linkPath of linkPaths) {
      const rootPath = getRootPathFromLinkPath(linkPath);
      if (rootPath) rootPaths.add(rootPath);
    }

    const getWorldTransformForLink = (linkPath: string): Matrix4 | null => {
      const meshMatrix = getRepresentativeMeshMatrixForLinkPath(renderInterface, linkPath);
      if (meshMatrix) {
        const preferred = typeof renderInterface.getPreferredLinkWorldTransform === "function"
          ? renderInterface.getPreferredLinkWorldTransform(linkPath)
          : null;
        if (!preferred) return meshMatrix;

        const preferredMeshDelta = getMatrixMaxElementDelta(preferred, meshMatrix);
        return preferredMeshDelta <= 1e-4 ? preferred : meshMatrix;
      }

      if (typeof renderInterface.getPreferredLinkWorldTransform === "function") {
        const preferred = renderInterface.getPreferredLinkWorldTransform(linkPath);
        if (preferred) return preferred;
      }
      return renderInterface.getWorldTransformForPrimPath?.(linkPath) || null;
    };

    const labelClusterCounts = new Map<string, number>();
    const sortedPaths = Array.from(linkPaths).sort((left, right) => left.localeCompare(right));
    for (const linkPath of sortedPaths) {
      const matrix = getWorldTransformForLink(linkPath);
      if (!matrix) continue;
      const axesHelper = new AxesHelper(LINK_AXIS_SIZE);
      axesHelper.name = "axis:" + linkPath;
      axesHelper.matrixAutoUpdate = false;
      axesHelper.matrix.copy(matrix);
      axesHelper.renderOrder = 2100;
      group.add(axesHelper);

      const labelSprite = createLinkLabelSprite(linkPath);
      const clusterKey = getLabelClusterKey(matrix);
      const clusterIndex = labelClusterCounts.get(clusterKey) || 0;
      labelClusterCounts.set(clusterKey, clusterIndex + 1);
      const labelOffset = getLabelOffsetForClusterIndex(clusterIndex);
      labelSprite.position.set(
        matrix.elements[12] + labelOffset.x,
        matrix.elements[13] + labelOffset.y,
        matrix.elements[14] + labelOffset.z
      );
      group.add(labelSprite);
    }

    if (group.children.length === 0) return;
    this.linkAxesGroup = group;
    usdRoot.add(group);
  }
}
