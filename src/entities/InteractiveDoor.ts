import * as THREE from "three";

export type DoorConfig = {
  model: THREE.Group | THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  requiresKey: string | null;
};

export class InteractiveDoor {
  public root: THREE.Object3D;
  public pivot: THREE.Object3D | null = null;
  public collider: THREE.Box3 | null = null;

  public isOpen = false;
  private currentAngle = 0;
  private targetAngle = 0;
  private baseAngle = 0;

  public requiresKey: string | null;

  constructor(cfg: DoorConfig) {
    this.requiresKey = cfg.requiresKey;
    this.root = cfg.model;

    this.root.position.copy(cfg.position);
    this.root.quaternion.copy(cfg.quaternion);
    this.root.scale.copy(cfg.scale);

    // Update matrix so we can compute world transforms right now
    this.root.updateMatrixWorld(true);

    // Buscamos el cubo de colisión y el pivote
    const colMesh = this.root.getObjectByName("Colision_Puerta") as THREE.Mesh;
    this.pivot = this.root.getObjectByName("Pivot_Door.001") || null;
    
    if (colMesh) {
      colMesh.visible = false;
      colMesh.geometry.computeBoundingBox();
      this.collider = new THREE.Box3().setFromObject(colMesh);
    }
    
    // Almacenamos su ángulo inicial para que al abrir gire desde su verdadera rotación
    this.root.traverse((obj) => {
      obj.matrixAutoUpdate = true;
    });

    if (this.pivot) {
      this.baseAngle = this.pivot.rotation.y;
      this.currentAngle = this.baseAngle;
      this.targetAngle = this.baseAngle;
    }
  }

  toggle() {
    console.log("¡Puerta accionada!");
    this.isOpen = !this.isOpen;
    this.targetAngle = this.isOpen ? this.baseAngle + Math.PI / 2 : this.baseAngle; // 90 grados respecto a la base

    // Desactivar la colisión de la puerta si la hemos abierto
    if (this.collider) {
      if (this.isOpen) {
        this.collider.makeEmpty();
      } else {
        // Restaurar caja de colisión (calculada con ángulo 0)
        this.pivot?.rotation.set(0, this.baseAngle, 0);
        this.pivot?.updateMatrix();
        this.root.updateMatrixWorld(true);
        const colMesh = this.root.getObjectByName(
          "Colision_Puerta",
        ) as THREE.Mesh;
        if (colMesh) {
          this.collider.setFromObject(colMesh);
        }
      }
    }
  }

  update(dt: number) {
    if (!this.pivot) return;

    // Smooth rotation
    this.currentAngle = THREE.MathUtils.lerp(
      this.currentAngle,
      this.targetAngle,
      dt * 5.0,
    );
    this.pivot.rotation.y = this.currentAngle;
    this.pivot.updateMatrix(); // Garantizar que se computen cambios
  }
}
