import * as THREE from "three";

export class Player {
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private move = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    private camera: THREE.PerspectiveCamera,
    public position: THREE.Vector3,
  ) {}

  update(dt: number, axes: { forward: number; strafe: number }, speed: number) {
    if (axes.forward === 0 && axes.strafe === 0) return;

    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();

    this.right.crossVectors(this.forward, this.up).normalize();

    this.move.set(0, 0, 0);
    this.move.addScaledVector(this.forward, axes.forward);
    this.move.addScaledVector(this.right, axes.strafe);
    this.move.normalize();

    this.position.addScaledVector(this.move, speed * dt);
  }
}
