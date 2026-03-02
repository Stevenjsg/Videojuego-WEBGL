import * as THREE from "three";

export function createCamera(mount: HTMLElement) {
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
  cam.position.set(0, 0, 0);
  return cam;
}
