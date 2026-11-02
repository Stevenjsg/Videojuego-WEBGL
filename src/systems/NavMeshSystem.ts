import * as THREE from "three";
import { init, NavMeshQuery, type NavMesh } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Navmesh (Recast/Detour en WebAssembly) generada a partir de las mismas
 * cajas que usa CollisionSystem, para que caminos y colisiones coincidan.
 *
 * Igual que CollisionSystem, se asume suelo implícito en y = 0 donde no hay
 * ninguna caja.
 */

export type NavAgentConfig = {
  /** Margen a las paredes (m). Debe ser >= que el radio de colisión del
   * agente; si es menor, el camino pasa más pegado de lo que la colisión
   * permite y el agente se atasca en las esquinas. */
  radius: number;
  /** Altura libre mínima (m). */
  height: number;
  /** Escalón máximo que puede subir (m). */
  maxClimb: number;
  /** Resolución horizontal (m). Con 0.1 los huecos de 1 m quedan cerrados
   * para un radio de 0.45; 0.05 los mantiene abiertos. */
  cellSize?: number;
  /** Resolución vertical del voxelizado (m). */
  cellHeight?: number;
};

/** Distancia de búsqueda del polígono más cercano al inicio/fin del camino. */
const QUERY_HALF_EXTENTS = { x: 2, y: 3, z: 2 };

let wasmReady: Promise<void> | null = null;

export class NavMeshSystem {
  private constructor(
    private navMesh: NavMesh,
    private query: NavMeshQuery,
  ) {}

  /** Devuelve null si la generación falla (el enemy irá en línea recta). */
  static async fromColliders(
    boxes: THREE.Box3[],
    agent: NavAgentConfig,
  ): Promise<NavMeshSystem | null> {
    wasmReady ??= init();
    await wasmReady;

    const { positions, indices } = buildGeometry(boxes);
    const cs = agent.cellSize ?? 0.05;
    const ch = agent.cellHeight ?? 0.05;

    const result = generateSoloNavMesh(positions, indices, {
      cs,
      ch,
      walkableSlopeAngle: 45,
      // Recast trabaja en voxels, no en metros.
      walkableHeight: Math.ceil(agent.height / ch),
      walkableClimb: Math.floor(agent.maxClimb / ch),
      walkableRadius: Math.ceil(agent.radius / cs),
      maxEdgeLen: Math.round(12 / cs),
    });

    if (!result.success) {
      console.warn("[NavMesh] No se pudo generar:", result.error);
      return null;
    }
    return new NavMeshSystem(result.navMesh, new NavMeshQuery(result.navMesh));
  }

  /**
   * Camino (esquinas) de `start` a `end`, escrito en `out`. Si `end` no es
   * alcanzable devuelve el camino hasta el punto alcanzable más cercano.
   */
  findPath(
    start: THREE.Vector3,
    end: THREE.Vector3,
    out: THREE.Vector3[],
  ): boolean {
    const { success, path } = this.query.computePath(start, end, {
      halfExtents: QUERY_HALF_EXTENTS,
    });
    if (!success || path.length === 0) return false;

    // Reutilizar los Vector3 ya existentes en `out`.
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (out[i]) out[i].set(p.x, p.y, p.z);
      else out.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    out.length = path.length;
    return true;
  }

  dispose() {
    this.query.destroy();
    this.navMesh.destroy();
  }
}

/** Triángulos de entrada: un plano de suelo en y = 0 + cada caja sólida. */
function buildGeometry(boxes: THREE.Box3[]) {
  const solid = boxes.filter((b) => !b.isEmpty());
  const bounds = new THREE.Box3();
  for (const b of solid) bounds.union(b);
  bounds.expandByScalar(2);

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);

  const ground = new THREE.PlaneGeometry(size.x, size.z)
    .rotateX(-Math.PI / 2) // normal hacia +Y → caminable
    .translate(center.x, 0, center.z);

  const parts: THREE.BufferGeometry[] = [ground];
  for (const b of solid) {
    b.getSize(size);
    b.getCenter(center);
    parts.push(
      new THREE.BoxGeometry(size.x, size.y, size.z).translate(
        center.x,
        center.y,
        center.z,
      ),
    );
  }

  // Solo importan las posiciones; normales/UVs distintas impiden el merge.
  for (const g of parts) {
    g.deleteAttribute("normal");
    g.deleteAttribute("uv");
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());

  const positions = merged.getAttribute("position").array as Float32Array;
  const indices = Uint32Array.from(merged.getIndex()!.array);
  merged.dispose();
  return { positions, indices };
}
