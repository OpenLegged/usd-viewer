import type { MeshPhysicalMaterial } from 'three';

let defaultMaterial: MeshPhysicalMaterial | undefined = undefined;

export function getDefaultMaterial(): MeshPhysicalMaterial | undefined {
  return defaultMaterial;
}

export function setDefaultMaterial(material: MeshPhysicalMaterial | undefined): void {
  defaultMaterial = material;
}
