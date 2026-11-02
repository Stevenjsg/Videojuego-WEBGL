import * as THREE from "three";

type Collider = { name: string; box: THREE.Box3 };

export type CollisionConfig = {
  playerRadius?: number;
  playerHeight?: number;
  useSlide?: boolean;
};

export class CollisionSystem {
  private playerRadius: number;
  private playerHeight: number;
  private useSlide: boolean;

  private colliders: Collider[] = [];

  // Temporales reutilizables (cero allocations por frame)
  private tmpClosest = new THREE.Vector3();
  private tmpCenter = new THREE.Vector3();
  private tmpMove = new THREE.Vector3();
  private tmpTryX = new THREE.Vector3();
  private tmpTryZ = new THREE.Vector3();

  constructor(cfg?: CollisionConfig) {
    this.playerRadius = cfg?.playerRadius ?? 0.35;
    this.playerHeight = cfg?.playerHeight ?? 1.8;
    this.useSlide = cfg?.useSlide ?? true;
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

  /**
   * Devuelve la altura de suelo bajo el punto (x, z) considerando los pies
   * en `feetY`. Útil para el enemy (o cualquier esfera) para poder subir
   * escaleras sin atravesar colliders.
   */
  getFloorAt(x: number, z: number, feetY: number, radius: number): number {
    let highestY = 0;
    const stepOffset = 1.1;
    const r = radius * 0.5;

    for (const c of this.colliders) {
      const box = c.box;
      if (
        x + r >= box.min.x &&
        x - r <= box.max.x &&
        z + r >= box.min.z &&
        z - r <= box.max.z
      ) {
        if (box.max.y > highestY && box.max.y <= feetY + stepOffset) {
          highestY = box.max.y;
        }
      }
    }
    return highestY;
  }

  // ── Player ────────────────────────────────────────────────────────────────

  resolvePlayer(playerPos: THREE.Vector3, prevPos: THREE.Vector3) {
    // 1. Detectar la altura del suelo/escalera actual
    const currentFloorY = this.getFloorHeight(prevPos);

    // 2. Fijar la altura del jugador basada en el suelo
    playerPos.y = currentFloorY + this.playerHeight;
    const feetY = currentFloorY;

    if (!this.useSlide) {
      if (this.intersectsAny(playerPos, feetY)) playerPos.copy(prevPos);
      return;
    }

    this.tmpMove.copy(playerPos).sub(prevPos);
    this.tmpMove.y = 0;

    // CCD: limita el paso máximo por frame
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

  // ── Sphere (enemy / NPCs) ─────────────────────────────────────────────────

  resolveSphere(pos: THREE.Vector3, prevPos: THREE.Vector3, radius: number) {
    this.tmpMove.copy(pos).sub(prevPos);

    // CCD: limita el paso máximo por frame
    const maxStep = 0.25;
    const len = this.tmpMove.length();
    if (len > maxStep) {
      this.tmpMove.multiplyScalar(maxStep / len);
      pos.copy(prevPos).add(this.tmpMove);
    }

    const feetY = pos.y - radius;

    if (!this.intersectsSphere(pos, radius, feetY)) return;

    // Slide X
    this.tmpTryX.set(prevPos.x + this.tmpMove.x, pos.y, prevPos.z);
    if (this.intersectsSphere(this.tmpTryX, radius, feetY))
      this.tmpTryX.x = prevPos.x;

    // Slide Z
    this.tmpTryZ.set(this.tmpTryX.x, pos.y, prevPos.z + this.tmpMove.z);
    if (this.intersectsSphere(this.tmpTryZ, radius, feetY))
      this.tmpTryZ.z = prevPos.z;

    pos.copy(this.tmpTryZ);

    if (this.intersectsSphere(pos, radius, feetY)) pos.copy(prevPos);
  }

  // ── Helpers internos ──────────────────────────────────────────────────────

  private getFloorHeight(playerPos: THREE.Vector3): number {
    const feetY = playerPos.y - this.playerHeight;
    return this.getFloorAt(playerPos.x, playerPos.z, feetY, this.playerRadius);
  }

  private intersectsAny(playerPos: THREE.Vector3, feetY: number) {
    // Esfera central a media altura del player
    this.tmpCenter.set(
      playerPos.x,
      playerPos.y - this.playerHeight * 0.5,
      playerPos.z,
    );
    const r2 = this.playerRadius * this.playerRadius;
    const stepOffset = 0.5;

    for (const c of this.colliders) {
      const box = c.box;

      // Ignorar colliders bajo los pies (suelos / escalones bajitos)
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

  private intersectsSphere(
    pos: THREE.Vector3,
    radius: number,
    feetY: number = -Infinity,
  ) {
    const r2 = radius * radius;
    this.tmpCenter.copy(pos);
    const stepOffset = 1.1;

    for (const c of this.colliders) {
      const box = c.box;

      // Ignorar colliders bajo los pies de la esfera (suelos / escalones)
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
