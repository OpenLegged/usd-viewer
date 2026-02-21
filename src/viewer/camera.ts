import { Box3, Vector3, PerspectiveCamera, Object3D } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function fitCameraToSelection(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  selection: Object3D[],
  fitOffset = 1.5,
  params?: URLSearchParams
): boolean {
  const size = new Vector3();
  const center = new Vector3();
  const box = new Box3();
  box.makeEmpty();

  for (const object of selection) {
    object?.updateWorldMatrix?.(true, true);
    box.expandByObject(object);
  }

  box.getSize(size);
  box.getCenter(center);
  if (
    Number.isNaN(size.x) ||
    Number.isNaN(size.y) ||
    Number.isNaN(size.z) ||
    Number.isNaN(center.x) ||
    Number.isNaN(center.y) ||
    Number.isNaN(center.z)
  ) {
    return false;
  }

  const maxSize = Math.max(size.x, size.y, size.z);
  const fitHeightDistance = maxSize / (2 * Math.atan((Math.PI * camera.fov) / 360));
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance);
  if (distance <= 0 || !Number.isFinite(distance)) return false;

  if (params) {
    camera.position.z = Number(params.get("cameraZ")) || 7;
    camera.position.y = Number(params.get("cameraY")) || 7;
    camera.position.x = Number(params.get("cameraX")) || 0;
  }

  const direction = controls.target.clone().sub(camera.position).normalize().multiplyScalar(distance);
  controls.maxDistance = distance * 10;
  controls.target.copy(center);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  camera.position.copy(controls.target).sub(direction);
  controls.update();
  return true;
}

export function scheduleCameraRefit(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  selection: Object3D[],
  params: URLSearchParams,
  maxAttempts = 8,
  delayMs = 250
): void {
  let attempts = 0;
  const tryFit = () => {
    attempts++;
    const didFit = fitCameraToSelection(camera, controls, selection, 1.5, params);
    if (!didFit && attempts < maxAttempts) {
      setTimeout(tryFit, delayMs);
    }
  };
  setTimeout(tryFit, delayMs);
}
