import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LEVEL1_COLLIDERS, LEVEL1_SPAWN } from "./levelData";

export type Level1Result = {
  root: THREE.Object3D;
  colliders: THREE.Box3[];
  spawn: THREE.Vector3;
};

export async function loadLevel1(
  scene: THREE.Scene,
  opts?: { url?: string; debug?: boolean },
): Promise<Level1Result> {
  const url = opts?.url ?? "/models/apartment/ModernApartment.glb";
  const debug = opts?.debug ?? false;

  const loader = new GLTFLoader();
  const root = await new Promise<THREE.Object3D>((resolve, reject) => {
    loader.load(url, (g) => resolve(g.scene), undefined, reject);
  });

  // Render tweaks (sombras baratas)
  root.traverse((child) => {
    if (!(child as any).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  });

  scene.add(root);

  const colliders = LEVEL1_COLLIDERS.map(centerSizeToBox);

  if (debug) addColliderHelpers(scene, colliders);

  return {
    root,
    colliders,
    spawn: new THREE.Vector3(...LEVEL1_SPAWN),
  };
}

function centerSizeToBox(def: {
  center: [number, number, number];
  size: [number, number, number];
}) {
  const [cx, cy, cz] = def.center;
  const [sx, sy, sz] = def.size;
  const min = new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2);
  const max = new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2);
  return new THREE.Box3(min, max);
}

function addColliderHelpers(scene: THREE.Scene, boxes: THREE.Box3[]) {
  for (const b of boxes) {
    scene.add(new THREE.Box3Helper(b, 0xff0000));
  }
}
