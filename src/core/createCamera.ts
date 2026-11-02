import * as THREE from "three";

/** `far` limita la distancia de dibujo (ver GAME.VIEW_DISTANCE). */
export function createCamera(_mount: HTMLElement, far = 200) {
  const cam = new THREE.PerspectiveCamera(90, 1, 0.1, far);
  cam.position.set(0, 0, 0);
  return cam;
}
