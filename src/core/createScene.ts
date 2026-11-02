import * as THREE from "three";

export type SceneLighting = {
  skyColor: THREE.ColorRepresentation;
  groundColor: THREE.ColorRepresentation;
  ambientIntensity: number;
  fogColor: THREE.ColorRepresentation;
  fogNear: number;
  /** Distancia a la que la niebla es totalmente opaca. */
  fogFar: number;
};

export function createScene(lighting: SceneLighting) {
  const scene = new THREE.Scene();

  // Niebla lineal: opaca justo en `fogFar` (= far de la cámara), así el
  // recorte del plano lejano y la carga de chunks lejanos no se notan.
  scene.fog = new THREE.Fog(
    lighting.fogColor,
    lighting.fogNear,
    lighting.fogFar,
  );
  scene.background = new THREE.Color(lighting.fogColor);

  // Ambiente hemisférico: da volumen (techo/suelo distintos) sin anular la
  // linterna como fuente principal.
  const ambient = new THREE.HemisphereLight(
    lighting.skyColor,
    lighting.groundColor,
    lighting.ambientIntensity,
  );
  scene.add(ambient);

  // Luz puntual muy tenue en el techo — da una referencia espacial sin revelar nada
  const ceiling = new THREE.PointLight(0x1a000a, 0.25, 14, 2.2);
  ceiling.position.set(0, 3.5, 0);
  scene.add(ceiling);

  return scene;
}
