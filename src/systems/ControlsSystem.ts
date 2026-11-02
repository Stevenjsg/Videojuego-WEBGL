import * as THREE from "three";
import { Input } from "@core/Input";
import { clamp } from "@utils/math";

type ControlsConfig = {
  sensitivity?: number; // 0.0015 - 0.003
  maxMouseDelta?: number; // clamp por evento (pixeles)
  ignoreMouseEvents?: number; // cuantos eventos ignorar tras lock
  canLock?: () => boolean; // UI decide si se puede lockear
};

export class ControlsSystem {
  private yawObject = new THREE.Object3D();
  private pitchObject = new THREE.Object3D();

  private sensitivity: number;
  private maxMouseDelta: number;
  private ignoreMouseEvents: number;
  private ignoreLeft = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private mount: HTMLElement,
    private input: Input,
    private cfg: ControlsConfig = {},
  ) {
    this.sensitivity = cfg.sensitivity ?? 0.002;
    this.maxMouseDelta = cfg.maxMouseDelta ?? 60;
    this.ignoreMouseEvents = cfg.ignoreMouseEvents ?? 2;

    // jerarquía: yaw -> pitch -> camera
    this.pitchObject.add(this.camera);
    this.yawObject.add(this.pitchObject);

    // click para lock
    this.mount.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (this.isLocked) return;
      if (cfg.canLock && !cfg.canLock()) return;
      this.lock();
    });

    // mousemove (solo cuando locked)
    window.addEventListener("mousemove", this.onMouseMove, { passive: true });

    // pointer lock change
    document.addEventListener("pointerlockchange", () => {
      if (this.isLocked) {
        this.ignoreLeft = this.ignoreMouseEvents;
      }
    });

    window.addEventListener("blur", () => {
      if (this.isLocked) this.unlock();
    });
  }

  // objeto que se añade a la escena (equivalente a controls.object)
  get object() {
    return this.yawObject;
  }

  get isLocked() {
    return document.pointerLockElement === this.mount;
  }

  lock() {
    // En Chrome devuelve una promesa que falla si se pierde el foco a tiempo.
    const result = this.mount.requestPointerLock() as unknown;
    if (result instanceof Promise) result.catch(() => {});
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  update() {
    // nada por ahora, pero lo dejo por simetría
  }

  /** Ejes WASD */
  getAxes() {
    if (!this.isLocked) return { forward: 0, strafe: 0 };

    const forward =
      Number(this.input.isDown("KeyW")) - Number(this.input.isDown("KeyS"));
    const strafe =
      Number(this.input.isDown("KeyD")) - Number(this.input.isDown("KeyA"));

    return { forward, strafe };
  }

  getSpeedMultiplier() {
    return this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight")
      ? 1.6
      : 1.0;
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isLocked) return;

    // Ignorar los primeros eventos tras lock (donde suelen venir picos)
    if (this.ignoreLeft > 0) {
      this.ignoreLeft--;
      return;
    }

    // Clamp deltas (aquí matamos el salto de 90/180)
    const dx = clamp(e.movementX, -this.maxMouseDelta, this.maxMouseDelta);
    const dy = clamp(e.movementY, -this.maxMouseDelta, this.maxMouseDelta);

    this.yawObject.rotation.y -= dx * this.sensitivity;
    this.pitchObject.rotation.x -= dy * this.sensitivity;

    // clamp pitch para que no haga flips
    const PI_2 = Math.PI / 2;
    this.pitchObject.rotation.x = clamp(
      this.pitchObject.rotation.x,
      -PI_2 + 0.01,
      PI_2 - 0.01,
    );
  };
}
