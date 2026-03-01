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
    this.playerHeight = cfg?.playerHeight ?? 1.7;
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

  buildFromObjects(objects: THREE.Object3D[]) {
    this.colliders = [];
    for (const obj of objects) {
      const c = this.objectToCollider(obj);
      if (c) this.colliders.push(c);
    }
  }

  resolvePlayer(playerPos: THREE.Vector3, prevPos: THREE.Vector3) {
    // MVP: sin físicas, fijamos altura
    const before = this.tmpTryX.copy(playerPos); // reutiliza un vec temp si quieres
    playerPos.y = this.playerHeight;

    if (!this.useSlide) {
      if (this.intersectsAny(playerPos)) playerPos.copy(prevPos);
      return;
    }

    this.tmpMove.copy(playerPos).sub(prevPos);

    // clamp para evitar penetración grande en un frame
    const maxStep = 0.25; // ajusta 0.2-0.35
    const len = this.tmpMove.length();
    if (len > maxStep) {
      this.tmpMove.multiplyScalar(maxStep / len);
      playerPos.copy(prevPos).add(this.tmpMove);
    }

    // si el movimiento completo no colisiona, ok
    if (!this.intersectsAny(playerPos)) return;

    // slide X
    this.tmpTryX.set(prevPos.x + this.tmpMove.x, playerPos.y, prevPos.z);
    if (this.intersectsAny(this.tmpTryX)) this.tmpTryX.x = prevPos.x;

    // slide Z
    this.tmpTryZ.set(this.tmpTryX.x, playerPos.y, prevPos.z + this.tmpMove.z);
    if (this.intersectsAny(this.tmpTryZ)) this.tmpTryZ.z = prevPos.z;

    playerPos.copy(this.tmpTryZ);

    const jump = playerPos.distanceTo(before);
    if (jump > 0.5) {
      console.log("[COLLISION] big correction:", jump.toFixed(3), {
        prev: prevPos.toArray(),
        before: before.toArray(),
        after: playerPos.toArray(),
      });
    }

    // fallback duro
    if (this.intersectsAny(playerPos)) playerPos.copy(prevPos);
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

  private intersectsAny(playerPos: THREE.Vector3) {
    // centro de esfera a media altura del jugador
    this.tmpCenter.set(
      playerPos.x,
      playerPos.y - this.playerHeight * 0.5,
      playerPos.z,
    );

    const r2 = this.playerRadius * this.playerRadius;

    for (const c of this.colliders) {
      if (this.ignoreFloors && this.isFloorLike(c)) continue;
      if (this.isBadCollider(c)) continue;

      const box = c.box;

      // closest point en AABB
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

    // placas gigantes tipo “shell”
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

    if (!this.intersectsSphere(pos, radius)) return;

    this.tmpTryX.set(prevPos.x + this.tmpMove.x, pos.y, prevPos.z);
    if (this.intersectsSphere(this.tmpTryX, radius)) this.tmpTryX.x = prevPos.x;

    this.tmpTryZ.set(this.tmpTryX.x, pos.y, prevPos.z + this.tmpMove.z);
    if (this.intersectsSphere(this.tmpTryZ, radius)) this.tmpTryZ.z = prevPos.z;

    pos.copy(this.tmpTryZ);

    if (this.intersectsSphere(pos, radius)) pos.copy(prevPos);
  }

  private intersectsSphere(pos: THREE.Vector3, radius: number) {
    const r2 = radius * radius;
    this.tmpCenter.copy(pos);

    for (const c of this.colliders) {
      if (this.ignoreFloors && this.isFloorLike(c)) continue;
      if (this.isBadCollider(c)) continue;

      const box = c.box;

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
