import * as THREE from "three";

export function createScene() {
  const scene = new THREE.Scene();

  // Niebla exponencial densa — muy poca visibilidad, tinte rojo-oscuro
  scene.fog = new THREE.FogExp2(0x0d0005, 0.09);
  scene.background = new THREE.Color(0x000000);

  // Luz ambiente casi nula con tinte sangriento — la linterna es la única fuente real
  const ambient = new THREE.AmbientLight(0x050510, 0.5);
  scene.add(ambient);

  // Luz puntual muy tenue en el techo — da una referencia espacial sin revelar nada
  const ceiling = new THREE.PointLight(0x1a000a, 0.25, 14, 2.2);
  ceiling.position.set(0, 3.5, 0);
  scene.add(ceiling);

  return scene;
}
