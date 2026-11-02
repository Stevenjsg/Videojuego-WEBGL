import * as THREE from "three";

export type DoorConfig = {
  model: THREE.Group | THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  requiresKey: string | null;
};

// Nombres posibles del empty-pivote según la exportación de Blender
const PIVOT_NAMES = ["Pivot_Door001", "pivot_door001", "Pivot_Door.001", "pivot_door.001", "Pivot_Door", "pivot_door"];
const COL_NAMES   = ["Colision_Puerta", "colision_puerta", "col_puerta", "Col_Puerta"];

function findByNames(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const name of names) {
    const found = root.getObjectByName(name);
    if (found) return found;
  }
  return null;
}

export class InteractiveDoor {
  public root: THREE.Object3D;
  public pivot: THREE.Object3D | null = null;
  public collider: THREE.Box3 | null = null;

  public isOpen = false;
  private currentAngle = 0;
  private targetAngle = 0;
  private baseAngle = 0;

  /** Caja de colisión en estado cerrado (world-space AABB) para restaurar al cerrar */
  private closedBox: THREE.Box3 | null = null;
  /** Si estamos cerrando y esperando que la animación termine */
  private pendingCollisionRestore = false;

  public requiresKey: string | null;

  constructor(cfg: DoorConfig) {
    this.requiresKey = cfg.requiresKey;
    this.root = cfg.model;

    this.root.position.copy(cfg.position);
    this.root.quaternion.copy(cfg.quaternion);
    this.root.scale.copy(cfg.scale);
    this.root.updateMatrixWorld(true);

    this.root.traverse((obj) => { obj.matrixAutoUpdate = true; });

    // Buscar el pivote por múltiples nombres posibles
    this.pivot = findByNames(this.root, PIVOT_NAMES);

    if (!this.pivot) {
      console.warn(
        "[InteractiveDoor] No se encontró el pivote. Nombres buscados:",
        PIVOT_NAMES,
      );
    } else {
      this.baseAngle = this.pivot.rotation.y;
      this.currentAngle = this.baseAngle;
      this.targetAngle = this.baseAngle;
    }

    // Buscar la malla de colisión y guardar su AABB en estado cerrado
    const colMesh = findByNames(this.root, COL_NAMES) as THREE.Mesh | null;
    if (colMesh) {
      colMesh.visible = false;
      colMesh.geometry.computeBoundingBox();
      const box = new THREE.Box3().setFromObject(colMesh);
      this.collider  = box;
      this.closedBox = box.clone(); // guardamos la caja cerrada para restaurar
    }
  }

  toggle() {
    this.isOpen = !this.isOpen;

    // 90° en sentido antihorario respecto a la rotación base
    this.targetAngle = this.isOpen
      ? this.baseAngle + Math.PI / 2
      : this.baseAngle;

    if (this.isOpen) {
      // Abrir: desactivar colisión inmediatamente
      this.collider?.makeEmpty();
      this.pendingCollisionRestore = false;
    } else {
      // Cerrar: la colisión se restaura en update() cuando la animación termina
      this.pendingCollisionRestore = true;
    }
  }

  update(dt: number) {
    if (!this.pivot) return;

    // Interpolación suave de ángulo
    this.currentAngle = THREE.MathUtils.lerp(
      this.currentAngle,
      this.targetAngle,
      Math.min(1, dt * 6),
    );
    this.pivot.rotation.y = this.currentAngle;

    // Restaurar colisión cuando el cierre haya terminado
    if (this.pendingCollisionRestore && this.collider && this.closedBox) {
      if (Math.abs(this.currentAngle - this.targetAngle) < 0.01) {
        this.currentAngle = this.targetAngle; // fijar exacto
        this.pivot.rotation.y = this.targetAngle;
        this.collider.copy(this.closedBox);
        this.pendingCollisionRestore = false;
      }
    }
  }
}
