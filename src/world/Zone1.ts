import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Definimos interfaces para mantener el TypeScript estricto y ordenado
export interface LevelSpawns {
  player: THREE.Object3D | null;
  enemy: THREE.Object3D | null;
  doors: Array<{ node: THREE.Object3D; requiresKey: string | null }>;
  items: Array<{ type: string; node: THREE.Object3D }>;
  lights: Array<THREE.Object3D>;
}

export interface LevelData {
  map: THREE.Group;
  spawns: LevelSpawns;
}

export async function loadZone1(
  scene: THREE.Scene,
  url: string = "/public/models/Zona1/Zona1.glb",
): Promise<LevelData> {
  // 1. Configuración del Loader (¡Súper simple ahora!)
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const map = gltf.scene;

        const spawns: LevelSpawns = {
          player: null,
          enemy: null,
          doors: [],
          items: [],
          lights: [],
        };

        // 2. Recorremos todo el nivel
        map.traverse((node: THREE.Object3D) => {
          // --- A. OPTIMIZACIÓN DE MALLAS ESTÁTICAS ---
          if ((node as THREE.Mesh).isMesh) {
            node.castShadow = false;
            node.receiveShadow = true;
          }

          // --- B. LECTURA DE SPAWNS (EMPTIES) ---
          if (node.name.includes("Spawn_Player")) {
            spawns.player = node;
            node.visible = false;
          } else if (node.name.includes("Spawn_Enemy_Idle")) {
            spawns.enemy = node;
            node.visible = false;
          } else if (node.name.includes("Spawn_Puerta_")) {
            const requiresKey = node.name.includes("Llave_1")
              ? "Llave 1"
              : node.name.includes("Llave_Especial")
                ? "Llave Especial"
                : null;

            spawns.doors.push({ node, requiresKey });
            node.visible = false;
          } else if (node.name.includes("Spawn_Item_")) {
            let itemType = "Desconocido";
            if (node.name.includes("Pila")) itemType = "Pila";
            if (node.name.includes("Llave_1")) itemType = "Llave 1";
            if (node.name.includes("Llave_2")) itemType = "Llave 2";
            if (node.name.includes("Objeto_Requerido")) itemType = "Fusible";

            spawns.items.push({ type: itemType, node });
            node.visible = false;
          } else if (node.name.includes("Spawn_Luz_")) {
            spawns.lights.push(node);

            const light = new THREE.PointLight(0xffaa55, 1, 8);
            light.position.copy(node.position);
            light.castShadow = false;

            scene.add(light);
            node.userData.lightReference = light;
          }
        });

        // 3. Añadimos el nivel base a la escena
        scene.add(map);

        // 4. Resolvemos la promesa
        resolve({ map, spawns });
      },
      undefined,
      (error) => {
        console.error("Error cargando la Zona 1:", error);
        reject(error);
      },
    );
  });
}
