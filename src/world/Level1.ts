import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LEVEL1_COLLIDERS, LEVEL1_SPAWN } from "./levelData";
import { loadingManager } from "@/core/assets";

export type NamedBoxCollider = {
  name: string;
  box: THREE.Box3;
};

export type Level1Options = {
  url?: string;
  debug?: boolean;
  addToScene?: boolean; // por si un día quieres cargar sin añadir
};

export type Level1Result = {
  root: THREE.Object3D;
  colliders: THREE.Box3[]; // compat con tu CollisionSystem actual
  namedColliders: NamedBoxCollider[]; // mejor para futuro (filtros por nombre)
  spawn: THREE.Vector3;
};
//"/models/apartment/ModernApartment.glb"

export async function loadLevel1(
  scene: THREE.Scene,
  opts: Level1Options = {},
): Promise<Level1Result> {
  const url = opts.url ?? "";
  const debug = opts.debug ?? false;
  const addToScene = opts.addToScene ?? true;

  const root = await loadGLB(url);

  applyRenderTweaks(root);

  if (addToScene) scene.add(root);

  const namedColliders = LEVEL1_COLLIDERS.map((c) => ({
    name: c.name,
    box: centerSizeToBox(c),
  }));

  const colliders = namedColliders.map((c) => c.box);
  if (debug) addColliderHelpers(scene, namedColliders);

  return {
    root,
    colliders,
    namedColliders,
    spawn: new THREE.Vector3(...LEVEL1_SPAWN),
  };
}

// -------------------- helpers --------------------

async function loadGLB(url: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader(loadingManager);
  return await new Promise<THREE.Object3D>((resolve, reject) => {
    loader.load(url, (g) => resolve(g.scene), undefined, reject);
  });
}

function applyRenderTweaks(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child as any).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = false; // barato
    mesh.receiveShadow = true; // que reciba la linterna/sombras
  });
}

function centerSizeToBox(def: {
  center: [number, number, number];
  size: [number, number, number];
}) {
  const [cx, cy, cz] = def.center;
  const [sx, sy, sz] = def.size;

  const halfX = sx / 2;
  const halfY = sy / 2;
  const halfZ = sz / 2;

  return new THREE.Box3(
    new THREE.Vector3(cx - halfX, cy - halfY, cz - halfZ),
    new THREE.Vector3(cx + halfX, cy + halfY, cz + halfZ),
  );
}

function addColliderHelpers(scene: THREE.Scene, colliders: NamedBoxCollider[]) {
  for (const c of colliders) {
    const helper = new THREE.Box3Helper(c.box, 0xff0000);
    helper.name = `DBG_${c.name}`;
    scene.add(helper);
  }
}
