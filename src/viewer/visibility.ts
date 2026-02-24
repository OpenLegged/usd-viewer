import { Mesh, Material } from "three";

type HydraMeshLike = {
  _mesh?: Mesh;
  ensureProtoReadyForVisibility?: () => boolean;
};
type RenderInterfaceLike = { meshes?: Record<string, HydraMeshLike> } | null | undefined;

function matchesVisualIdentifier(value = ""): boolean {
  const source = String(value || "").toLowerCase();
  return source.includes("/visuals.") || source.includes("/visuals/") || source.includes("/visual.");
}

function matchesCollisionIdentifier(value = ""): boolean {
  const source = String(value || "").toLowerCase();
  return (
    source.includes("/collisions.") ||
    source.includes("/collisions/") ||
    source.includes("/collision.") ||
    source.includes("/collision/")
  );
}

export function isVisualMeshId(meshId: string, meshName = ""): boolean {
  return matchesVisualIdentifier(meshId) || matchesVisualIdentifier(meshName);
}

export function isCollisionMeshId(meshId: string, meshName = ""): boolean {
  return matchesCollisionIdentifier(meshId) || matchesCollisionIdentifier(meshName);
}

function getMeshMaterials(mesh: Mesh): Material[] {
  if (!mesh?.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function setCollisionMeshStyle(mesh: Mesh, enabled: boolean, showVisualMeshes: boolean): void {
  const stateKey = "usdViewerCollisionMeshState";
  if (!(mesh.userData as any)[stateKey]) {
    (mesh.userData as any)[stateKey] = { renderOrder: mesh.renderOrder };
  }

  const materials = getMeshMaterials(mesh);
  for (const material of materials as any[]) {
    if (!material) continue;
    if (!material.userData?.usdViewerCollisionStyle) {
      material.userData = material.userData || {};
      material.userData.usdViewerCollisionStyle = {
        colorHex: material.color?.getHex?.(),
        emissiveHex: material.emissive?.getHex?.(),
        emissiveIntensity: typeof material.emissiveIntensity === "number" ? material.emissiveIntensity : 1,
        wireframe: !!material.wireframe,
        opacity: typeof material.opacity === "number" ? material.opacity : 1,
        transparent: !!material.transparent,
        depthWrite: material.depthWrite !== false,
        depthTest: material.depthTest !== false,
      };
    }

    const original = material.userData.usdViewerCollisionStyle;
    if (enabled) {
      material.color?.setHex?.(0xb34dff);
      if (material.emissive?.setHex) {
        material.emissive.setHex(0x4b0082);
        material.emissiveIntensity = 0.7;
      }
      material.wireframe = false;
      material.transparent = true;
      material.opacity = showVisualMeshes ? 0.65 : 0.9;
      material.depthWrite = false;
      material.depthTest = false;
      material.needsUpdate = true;
      continue;
    }

    if (original.colorHex !== undefined) material.color?.setHex?.(original.colorHex);
    if (original.emissiveHex !== undefined) material.emissive?.setHex?.(original.emissiveHex);
    material.emissiveIntensity = original.emissiveIntensity;
    material.wireframe = !!original.wireframe;
    material.opacity = original.opacity;
    material.transparent = !!original.transparent;
    material.depthWrite = original.depthWrite;
    material.depthTest = original.depthTest;
    material.needsUpdate = true;
  }

  mesh.renderOrder = enabled ? 1200 : (mesh.userData as any)[stateKey].renderOrder;
}

export function applyMeshVisibilityFilters(
  renderInterface: RenderInterfaceLike,
  showVisualMeshes: boolean,
  showCollisionMeshes: boolean
): void {
  if (!renderInterface?.meshes) return;

  for (const [meshId, hydraMesh] of Object.entries(renderInterface.meshes)) {
    const mesh = hydraMesh?._mesh;
    if (!mesh) continue;
    const meshName = mesh.name || "";

    if (isCollisionMeshId(meshId, meshName)) {
      const wasVisible = mesh.visible === true;
      mesh.visible = showCollisionMeshes;
      if (showCollisionMeshes && !wasVisible) {
        try {
          hydraMesh?.ensureProtoReadyForVisibility?.();
        } catch {
          // Keep visibility toggles resilient even if a single proto mesh fails.
        }
      }
      setCollisionMeshStyle(mesh, showCollisionMeshes, showVisualMeshes);
      continue;
    }
    if (isVisualMeshId(meshId, meshName)) {
      mesh.visible = showVisualMeshes;
      continue;
    }
    mesh.visible = true;
  }
}
