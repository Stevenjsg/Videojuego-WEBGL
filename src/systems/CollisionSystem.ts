import * as THREE from "three";

type Collider = { name: string; box: THREE.Box3 };

export type CollisionConfig = {
  playerRadius?: number;
  playerHeight?: number;
  useSlide?: boolean;
  // filtros (tuneables)
  ignoreFloors?: boolean;
  maxVolume?: number;
  giantFlatY?: number;
  giantFlatXZ?: number;
};

export class CollisionSystem {
  private playerRadius: number;
  private playerHeight: number;
  private useSlide: boolean;

  private ignoreFloors: boolean;
  private maxVolume: number;
  private giantFlatY: number;
  private giantFlatXZ: number;

  private colliders: Collider[] = [];

  // temporales (no basura por frame)
  private tmpClosest = new THREE.Vector3();
  private tmpCenter = new THREE.Vector3();
  private tmpMove = new THREE.Vector3();
  private tmpTryX = new THREE.Vector3();
  private tmpTryZ = new THREE.Vector3();

  constructor(cfg?: CollisionConfig) {
    this.playerRadius = cfg?.playerRadius ?? 0.35;
    this.playerHeight = cfg?.playerHeight ?? 1.8;
    this.useSlide = cfg?.useSlide ?? true;

    this.ignoreFloors = cfg?.ignoreFloors ?? true;
    this.maxVolume = cfg?.maxVolume ?? 800;
    this.giantFlatY = cfg?.giantFlatY ?? 0.25;
    this.giantFlatXZ = cfg?.giantFlatXZ ?? 15;
  }

  clear() {
    this.colliders = [];
  }

  setColliders(boxes: THREE.Box3[], namePrefix = "manual") {
    this.colliders = boxes
      .filter((b) => !b.isEmpty())
      .map((b, i) => ({ name: `${namePrefix}_${i}`, box: b }));
  }

  removeColliders(boxes: THREE.Box3[]) {
    const toRemove = new Set(boxes);
    this.colliders = this.colliders.filter((c) => !toRemove.has(c.box));
  }

  buildFromObjects(objects: THREE.Object3D[]) {
    this.colliders = [];
    for (const obj of objects) {
      // SOLO usamos los objetos que dibujamos en Blender para la física
      if (obj.name.toLowerCase().startsWith("col_")) {
        const c = this.objectToCollider(obj);
        if (c) {
          this.colliders.push(c);
          obj.visible = false; // ¡Los hacemos invisibles aquí mismo!
          console.log(
            `[COLLISION] Collider "${c.name}" cargado con box:`,
            c.box,
          );
        }
      }
    }
    console.log(
      `[COLLISION] Cargados ${this.colliders.length} colliders desde Blender.`,
    );
  }

  private getFloorHeight(playerPos: THREE.Vector3): number {
    let highestY = 0; // Altura base del nivel (0)
    const feetY = playerPos.y - this.playerHeight;
    const stepOffset = 0.5; // La altura máxima de un escalón que puedes subir de golpe

    const r = this.playerRadius * 0.5; // Radio reducido para no "enganchar" bordes lejanos

    for (const c of this.colliders) {
      const box = c.box;
      // Si el jugador está sobre esta caja (X y Z)
      if (
        playerPos.x + r >= box.min.x &&
        playerPos.x - r <= box.max.x &&
        playerPos.z + r >= box.min.z &&
        playerPos.z - r <= box.max.z
      ) {
        // Y la caja está por debajo de nuestros pies + el stepOffset
        if (box.max.y > highestY && box.max.y <= feetY + stepOffset) {
          highestY = box.max.y;
        }
      }
    }
    return highestY;
  }

  resolvePlayer(playerPos: THREE.Vector3, prevPos: THREE.Vector3) {
    const before = this.tmpTryX.copy(playerPos);

    // 1. Detectar la altura del suelo/escalera actual
    const currentFloorY = this.getFloorHeight(prevPos);

    // 2. Fijar la altura del jugador basada en el suelo (¡Adiós al Y estático!)
    playerPos.y = currentFloorY + this.playerHeight;
    const feetY = currentFloorY; // Dónde están los pies

    if (!this.useSlide) {
      if (this.intersectsAny(playerPos, feetY)) playerPos.copy(prevPos);
      return;
    }

    this.tmpMove.copy(playerPos).sub(prevPos);
    this.tmpMove.y = 0; // Ignoramos el movimiento en Y para el deslizamiento

    // Limitar velocidad máxima de la física (Mantiene el CCD estable)
    const maxStep = 0.35;
    const len = this.tmpMove.length();
    if (len > maxStep) {
      this.tmpMove.multiplyScalar(maxStep / len);
      playerPos.x = prevPos.x + this.tmpMove.x;
      playerPos.z = prevPos.z + this.tmpMove.z;
    }

    // Slide X
    this.tmpTryX.set(prevPos.x + this.tmpMove.x, playerPos.y, prevPos.z);
    if (this.intersectsAny(this.tmpTryX, feetY)) this.tmpTryX.x = prevPos.x;

    // Slide Z
    this.tmpTryZ.set(this.tmpTryX.x, playerPos.y, prevPos.z + this.tmpMove.z);
    if (this.intersectsAny(this.tmpTryZ, feetY)) this.tmpTryZ.z = prevPos.z;

    playerPos.copy(this.tmpTryZ);
  }

  // ---------------- private ----------------

  private objectToCollider(obj: THREE.Object3D): Collider | null {
    obj.updateWorldMatrix(true, false);
    const name = (obj.name || "").toLowerCase();

    // Mesh: boundingBox mundial (rápido)
    if ((obj as any).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (!bb) return null;

      const worldBB = bb.clone().applyMatrix4(mesh.matrixWorld);
      if (worldBB.isEmpty()) return null;

      return { name, box: worldBB };
    }

    // Group/Object3D: AABB global
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return null;

    return { name, box };
  }

  private intersectsAny(playerPos: THREE.Vector3, feetY: number) {
    // Esfera central a media altura
    this.tmpCenter.set(
      playerPos.x,
      playerPos.y - this.playerHeight * 0.5,
      playerPos.z,
    );
    const r2 = this.playerRadius * this.playerRadius;
    const stepOffset = 0.5;

    for (const c of this.colliders) {
      const box = c.box;

      // ¡MAGIA! Ignorar cajas que actúan como suelo o escalón bajito
      if (box.max.y <= feetY + stepOffset) continue;

      this.tmpClosest.set(
        THREE.MathUtils.clamp(this.tmpCenter.x, box.min.x, box.max.x),
        THREE.MathUtils.clamp(this.tmpCenter.y, box.min.y, box.max.y),
        THREE.MathUtils.clamp(this.tmpCenter.z, box.min.z, box.max.z),
      );

      const dx = this.tmpCenter.x - this.tmpClosest.x;
      const dy = this.tmpCenter.y - this.tmpClosest.y;
      const dz = this.tmpCenter.z - this.tmpClosest.z;

      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }

  private isFloorLike(c: Collider) {
    const n = c.name;
    return n.includes("floor") || n.includes("ground") || n.includes("terrain");
  }

  private isBadCollider(c: Collider) {
    const n = c.name;
    if (
      n.includes("collision") ||
      n.includes("collider") ||
      n.includes("proxy") ||
      n.includes("occlud")
    ) {
      return true;
    }

    const s = this.getSize(c.box);
    const volume = s.x * s.y * s.z;

    if (volume > this.maxVolume) return true;

    // placas gigantes tipo "shell"
    if (
      s.y < this.giantFlatY &&
      (s.x > this.giantFlatXZ || s.z > this.giantFlatXZ)
    )
      return true;

    return false;
  }

  private getSize(box: THREE.Box3) {
    // evita new Vector3
    return {
      x: box.max.x - box.min.x,
      y: box.max.y - box.min.y,
      z: box.max.z - box.min.z,
    };
  }

  resolveSphere(pos: THREE.Vector3, prevPos: THREE.Vector3, radius: number) {
    this.tmpMove.copy(pos).sub(prevPos);

    // clamp para evitar penetración grande en un frame
    const maxStep = 0.25; // ajusta 0.2-0.35
    const len = this.tmpMove.length();
    if (len > maxStep) {
      this.tmpMove.multiplyScalar(maxStep / len);
      pos.copy(prevPos).add(this.tmpMove);
    }

    // Altura de los pies de la esfera (para ignorar suelos)
    const feetY = pos.y - radius;

    if (!this.intersectsSphere(pos, radius, feetY)) return;

    this.tmpTryX.set(prevPos.x + this.tmpMove.x, pos.y, prevPos.z);
    if (this.intersectsSphere(this.tmpTryX, radius, feetY))
      this.tmpTryX.x = prevPos.x;

    this.tmpTryZ.set(this.tmpTryX.x, pos.y, prevPos.z + this.tmpMove.z);
    if (this.intersectsSphere(this.tmpTryZ, radius, feetY))
      this.tmpTryZ.z = prevPos.z;

    pos.copy(this.tmpTryZ);

    if (this.intersectsSphere(pos, radius, feetY)) pos.copy(prevPos);
  }

  private intersectsSphere(
    pos: THREE.Vector3,
    radius: number,
    feetY: number = -Infinity,
  ) {
    const r2 = radius * radius;
    this.tmpCenter.copy(pos);
    const stepOffset = 0.5;

    for (const c of this.colliders) {
      if (this.ignoreFloors && this.isFloorLike(c)) continue;
      if (this.isBadCollider(c)) continue;

      const box = c.box;

      // Ignorar colliders que actúan como suelo bajo los pies de la esfera
      if (box.max.y <= feetY + stepOffset) continue;

      this.tmpClosest.set(
        THREE.MathUtils.clamp(this.tmpCenter.x, box.min.x, box.max.x),
        THREE.MathUtils.clamp(this.tmpCenter.y, box.min.y, box.max.y),
        THREE.MathUtils.clamp(this.tmpCenter.z, box.min.z, box.max.z),
      );

      const dx = this.tmpCenter.x - this.tmpClosest.x;
      const dy = this.tmpCenter.y - this.tmpClosest.y;
      const dz = this.tmpCenter.z - this.tmpClosest.z;

      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }
}
