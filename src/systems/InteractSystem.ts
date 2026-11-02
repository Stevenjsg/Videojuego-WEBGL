import * as THREE from "three";
import { Pickup } from "@entities/Pickup";
import { InteractiveDoor } from "@entities/InteractiveDoor";

export class InteractSystem {
  private raycaster = new THREE.Raycaster();
  private forward = new THREE.Vector3();
  private tmpCamPos = new THREE.Vector3();

  constructor(
    private camera: THREE.Camera,
    private pickups: Pickup[],
    private doors: InteractiveDoor[] = [],
  ) {}

  /** Devuelve el pickup al que apunta la cámara (o null). */
  tryPickup(maxDistance = 2.0): Pickup | null {
    this.prepareRay(maxDistance);
    const objects = this.pickups.map((p) => p.root);
    const hits = this.raycaster.intersectObjects(objects, true);
    if (hits.length === 0) return null;

    const hitRoot = this.findAncestor(hits[0].object, (o) =>
      this.pickups.some((p) => p.root === o),
    );
    return hitRoot ? this.pickups.find((p) => p.root === hitRoot) ?? null : null;
  }

  /** Devuelve la puerta a la que apunta la cámara (o null). */
  tryInteractDoor(maxDistance = 2.5): InteractiveDoor | null {
    this.prepareRay(maxDistance);
    const objects = this.doors.map((d) => d.root);
    const hits = this.raycaster.intersectObjects(objects, true);
    if (hits.length === 0) return null;

    const hitRoot = this.findAncestor(hits[0].object, (o) =>
      this.doors.some((d) => d.root === o),
    );
    return hitRoot ? this.doors.find((d) => d.root === hitRoot) ?? null : null;
  }

  removePickup(p: Pickup, scene: THREE.Scene) {
    scene.remove(p.root);
    const idx = this.pickups.indexOf(p);
    if (idx >= 0) this.pickups.splice(idx, 1);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private prepareRay(maxDistance: number) {
    this.camera.getWorldDirection(this.forward);
    this.camera.getWorldPosition(this.tmpCamPos);
    this.raycaster.set(this.tmpCamPos, this.forward);
    this.raycaster.far = maxDistance;
  }

  private findAncestor(
    obj: THREE.Object3D,
    predicate: (o: THREE.Object3D) => boolean,
  ): THREE.Object3D | null {
    let cur: THREE.Object3D | null = obj;
    for (let i = 0; i < 16 && cur; i++) {
      if (predicate(cur)) return cur;
      cur = cur.parent;
    }
    return null;
  }
}
