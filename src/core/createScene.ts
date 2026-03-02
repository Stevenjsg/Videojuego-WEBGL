import * as THREE from "three";

export function createScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 2.5, 12);
  scene.background = new THREE.Color(0x0b0b0b);

  // Muy bajo o nada si usas HDRI
  const ambient = new THREE.AmbientLight(0xffffff, 0.3);
  ambient.intensity = 0.1;
  scene.add(ambient);

  return scene;
}
