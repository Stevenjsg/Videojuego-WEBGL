import * as THREE from "three";
import { Pickup } from "@entities/Pickup";

export class InteractSystem {
  private raycaster = new THREE.Raycaster();
  private forward = new THREE.Vector3();
  private tmpCamPos = new THREE.Vector3();

  constructor(
    private camera: THREE.Camera,
    private pickups: Pickup[],
  ) {}

  /** Intenta recoger el pickup mirando al frente (raycast). */
  tryPickup(maxDistance = 2.0): Pickup | null {
    this.camera.getWorldDirection(this.forward);
    this.raycaster.set(this.getCameraWorldPos(), this.forward);
    this.raycaster.far = maxDistance;

    const objects = this.pickups.map((p) => p.root);
    const hits = this.raycaster.intersectObjects(objects, true);

    if (hits.length === 0) return null;

    const hitRoot = this.findPickupRoot(hits[0].object);
    if (!hitRoot) return null;

    return this.pickups.find((p) => p.root === hitRoot) ?? null;
  }

  /** Compatibilidad: si antes llamabas update() */
  update(): Pickup | null {
    return this.tryPickup(2.0);
  }

  removePickup(p: Pickup, scene: THREE.Scene) {
    scene.remove(p.root);
    const idx = this.pickups.indexOf(p);
    if (idx >= 0) this.pickups.splice(idx, 1);
  }

  private getCameraWorldPos() {
    this.camera.getWorldPosition(this.tmpCamPos);
    return this.tmpCamPos;
  }

  private findPickupRoot(obj: THREE.Object3D): THREE.Object3D | null {
    let cur: THREE.Object3D | null = obj;
    for (let i = 0; i < 10 && cur; i++) {
      if (this.pickups.some((p) => p.root === cur)) return cur;
      cur = cur.parent;
    }
    return null;
  }
}
