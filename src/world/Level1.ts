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
  pos?: { x: number; y: number; z: number };
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
  const collisionBoxes: THREE.Box3[] = [];
  const url = opts.url ?? "";
  const debug = opts.debug ?? false;
  const addToScene = opts.addToScene ?? true;

  const root = await loadGLB(url);

  if (opts.pos) root.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
  if (addToScene) scene.add(root);

  // 🚨 LA LÍNEA MÁGICA: Fuerza la actualización de las coordenadas 3D reales
  root.updateMatrixWorld(true);

  const { root: tweakedRoot, colliders: tweakedColliders } = setupLevelMeshes(
    root,
    collisionBoxes,
  );

  return {
    root: tweakedRoot,
    colliders: tweakedColliders,
    namedColliders: [],
    spawn: new THREE.Vector3(...LEVEL1_SPAWN),
  };
}

export function loadLevel1FromRoot(
  scene: THREE.Scene,
  root: THREE.Object3D,
  opts?: { debug?: boolean },
) {
  // Render tweaks (sombras baratas)
  root.traverse((child) => {
    if (!(child as any).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  });

  scene.add(root);

  const colliders = LEVEL1_COLLIDERS.map(centerSizeToBox);
  const namedColliders = LEVEL1_COLLIDERS.map((c) => ({
    name: c.name,
    box: centerSizeToBox(c),
  }));
  if (opts?.debug) addColliderHelpers(scene, namedColliders);

  return {
    root,
    colliders,
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

function setupLevelMeshes(root: THREE.Object3D, collisionBoxes: THREE.Box3[]) {
  root.traverse((node: any) => {
    if (node.isMesh && node.name.toLowerCase().startsWith("col_")) {
      // 1. Nos aseguramos de que la malla base tenga su caja calculada
      node.geometry.computeBoundingBox();

      // 2. Extraemos el AABB global (ahora sí, en las coordenadas correctas)
      const box = new THREE.Box3().setFromObject(node);
      collisionBoxes.push(box);

      // 3. Ocultamos la caja física
      node.visible = false;
    } else if (node.isMesh) {
      node.castShadow = true; // Proyecta sombra si la linterna le da
      node.receiveShadow = true; // Permite que se dibujen sombras sobre él
    }
  });
  return {
    root,
    colliders: collisionBoxes,
  };
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
