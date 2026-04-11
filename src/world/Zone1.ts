import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Definimos interfaces para mantener el TypeScript estricto y ordenado
export type LightType = "hall" | "fluorescent" | "unknown";

export interface LevelSpawns {
  player: THREE.Object3D | null;
  enemy: THREE.Object3D | null;
  doors: Array<{ node: THREE.Object3D; requiresKey: string | null }>;
  items: Array<{ type: string; node: THREE.Object3D }>;
  lights: Array<{ node: THREE.Object3D; lightType: LightType }>;
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
            node.visible = false;
            const requiresKey = node.name.includes("Llave_1")
              ? "Llave 1"
              : node.name.includes("Llave_2")
                ? "Llave 2"
                : node.name.includes("Llave_Especial")
                  ? "Llave Especial"
                  : null;

            spawns.doors.push({ node, requiresKey });
            node.visible = false;
          } else if (node.name.includes("Spawn_Item_")) {
            let itemType = "Desconocido";
            if (node.name.includes("flashlight")) itemType = "flashlight";
            if (node.name.includes("Pila")) itemType = "Pila";
            if (node.name.includes("Llave_1")) itemType = "Llave 1";
            if (node.name.includes("Llave_2")) itemType = "Llave 2";
            if (node.name.includes("Llave_Especial"))
              itemType = "Llave Especial";
            if (node.name.includes("Fuse")) itemType = "Fuse";

            spawns.items.push({ type: itemType, node });
            node.visible = false;
          } else if (node.name.includes("Spawn_Luz_")) {
            const nameLower = node.name.toLowerCase();
            let lightType: LightType = "unknown";

            if (nameLower.includes("hall")) {
              lightType = "hall";
              // Hall: warm strong light
              const light = new THREE.PointLight(0xffcc77, 5.0, 16);
              light.position.copy(node.position);
              light.castShadow = false;
              scene.add(light);
              node.userData.lightReference = light;
            } else if (
              nameLower.includes("florescente") ||
              nameLower.includes("fluorescente")
            ) {
              lightType = "fluorescent";
              // Fluorescent: dim cold light (+25%)
              const light = new THREE.PointLight(0xccddff, 0.75, 7);
              light.position.copy(node.position);
              light.castShadow = false;
              scene.add(light);
              node.userData.lightReference = light;
            } else {
              // Default fallback
              const light = new THREE.PointLight(0xffaa55, 1, 8);
              light.position.copy(node.position);
              light.castShadow = false;
              scene.add(light);
              node.userData.lightReference = light;
            }

            spawns.lights.push({ node, lightType });
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
