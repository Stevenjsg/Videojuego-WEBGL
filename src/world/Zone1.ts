import * as THREE from "three";
import { ChunkedLevel, type ChunkedLevelOptions } from "./ChunkedLevel";
import { FluorescentLamp } from "@entities/FluorescentLamp";

// Definimos interfaces para mantener el TypeScript estricto y ordenado
export type LightType = "hall" | "fluorescent" | "unknown";

/**
 * Luces prácticas del mapa (lámparas reales de la escena). Con caída física
 * (decay 2) la intensidad en candelas tiene que ser alta para llegar al
 * suelo: las del hall están a ~5 m de altura.
 */
const PRACTICAL_LIGHTS: Record<
  LightType,
  { color: number; intensity: number; distance: number }
> = {
  // Lámpara de araña del hall: charco de luz cálido, rincones a oscuras.
  hall: { color: 0xffc98a, intensity: 16, distance: 11 },
  // Fluorescente del ascensor (solo si no se encuentra el tubo: ver
  // FluorescentLamp, que es lo normal).
  fluorescent: { color: 0xd6e4ff, intensity: 6, distance: 8 },
  unknown: { color: 0xffaa55, intensity: 8, distance: 10 },
};

export interface LevelSpawns {
  player: THREE.Object3D | null;
  enemy: THREE.Object3D | null;
  doors: Array<{ node: THREE.Object3D; requiresKey: string | null }>;
  items: Array<{ type: string; node: THREE.Object3D }>;
  lights: Array<{
    node: THREE.Object3D;
    lightType: LightType;
    /** Solo fluorescentes con tubo en el mapa: luz con parpadeo sincronizado. */
    lamp?: FluorescentLamp;
  }>;
  fuseBox: THREE.Object3D | null;
}

export interface LevelData {
  /** Raíz del nivel: el core y los chunks visuales cuelgan de aquí. */
  map: THREE.Group;
  spawns: LevelSpawns;
  /** Streamer de chunks: llamar a `level.stream()` para cargar lo visual. */
  level: ChunkedLevel;
}

/**
 * Carga el core de la Zona 1 (colliders + spawns) y crea las luces.
 * La geometría visual se carga después con `level.stream()`.
 */
export async function loadZone1(
  scene: THREE.Scene,
  manifestUrl: string,
  opts: Omit<ChunkedLevelOptions, "manifestUrl"> & {
    position?: THREE.Vector3Like;
  } = {},
): Promise<LevelData> {
  const level = new ChunkedLevel({ ...opts, manifestUrl });
  if (opts.position) level.root.position.copy(opts.position);
  level.root.name = "Zona1";
  scene.add(level.root);

  let core: THREE.Object3D;
  try {
    core = await level.loadCore();
  } catch (error) {
    console.error("Error cargando la Zona 1:", error);
    level.dispose();
    throw error;
  }

  const spawns: LevelSpawns = {
    player: null,
    enemy: null,
    doors: [],
    items: [],
    lights: [],
    fuseBox: null,
  };

  // 2. Recorremos todo el nivel
  core.traverse((node: THREE.Object3D) => {
    // --- A. OPTIMIZACIÓN DE MALLAS ESTÁTICAS ---
    if ((node as THREE.Mesh).isMesh) {
      node.castShadow = false;
      node.receiveShadow = true;
    }

    // --- B. LECTURA DE SPAWNS (EMPTIES) ---
    // Fuse_Box: mesh estático con el que el player interactúa
    if (node.name.toLowerCase().includes("fuse_box") && !spawns.fuseBox) {
      spawns.fuseBox = node;
    }
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

      if (nameLower.includes("hall")) lightType = "hall";
      else if (
        nameLower.includes("florescente") ||
        nameLower.includes("fluorescente")
      ) {
        lightType = "fluorescent";
      }

      // Los fluorescentes se resuelven al final, cuando conocemos los tubos.
      if (lightType === "fluorescent") {
        spawns.lights.push({ node, lightType });
        return;
      }

      const cfg = PRACTICAL_LIGHTS[lightType];
      const light = new THREE.PointLight(
        cfg.color,
        cfg.intensity,
        cfg.distance,
        2, // caída física: es lo que hace que se vean "reales"
      );
      light.position.copy(node.position);
      light.castShadow = false;
      scene.add(light);
      node.userData.lightReference = light;

      spawns.lights.push({ node, lightType });
    }
  });

  attachFluorescentLamps(scene, core, spawns);

  return { map: level.root, spawns, level };
}

/**
 * Cada Spawn_Luz_florescente usa el tubo (Tube-Lamp…Glass) más cercano para
 * colocar una luz rectangular que sale de él. Sin tubo → luz puntual.
 */
function attachFluorescentLamps(
  scene: THREE.Scene,
  core: THREE.Object3D,
  spawns: LevelSpawns,
) {
  const tubes: THREE.Mesh[] = [];
  core.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && /tube-lamp.*glass/i.test(o.name)) {
      tubes.push(o as THREE.Mesh);
    }
  });

  const spawnPos = new THREE.Vector3();
  const tubePos = new THREE.Vector3();
  for (const entry of spawns.lights) {
    if (entry.lightType !== "fluorescent") continue;
    entry.node.getWorldPosition(spawnPos);

    let nearest: THREE.Mesh | null = null;
    let best = 4; // metros: más lejos no es "su" tubo
    for (const tube of tubes) {
      const d = tube.getWorldPosition(tubePos).distanceTo(spawnPos);
      if (d < best) {
        best = d;
        nearest = tube;
      }
    }

    if (nearest) {
      entry.lamp = new FluorescentLamp(scene, nearest);
      entry.node.userData.lightReference = entry.lamp.light;
      continue;
    }

    const cfg = PRACTICAL_LIGHTS.fluorescent;
    const light = new THREE.PointLight(cfg.color, cfg.intensity, cfg.distance, 2);
    light.position.copy(entry.node.position);
    scene.add(light);
    entry.node.userData.lightReference = light;
  }
}
