import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Input } from "../core/Input";

export class ControlsSystem {
  private controls: PointerLockControls;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private mount: HTMLElement,
    private input: Input,
  ) {
    this.controls = new PointerLockControls(this.camera, this.mount);

    // Click para capturar ratón
    this.mount.addEventListener("click", () => {
      if (!this.controls.isLocked) this.controls.lock();
    });
  }

  // Añádelo a la escena desde Game.ts
  get object() {
    return this.controls.object;
  }

  get isLocked() {
    return this.controls.isLocked;
  }

  lock() {
    this.controls.lock();
  }

  unlock() {
    this.controls.unlock();
  }

  // Devuelve ejes WASD (W +1, S -1, D +1, A -1)
  getAxes() {
    const forward =
      Number(this.input.isDown("KeyW")) - Number(this.input.isDown("KeyS"));
    const strafe =
      Number(this.input.isDown("KeyD")) - Number(this.input.isDown("KeyA"));
    return { forward, strafe };
  }

  // Opcional: si quieres sprint
  getSpeedMultiplier() {
    return this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight")
      ? 1.6
      : 1.0;
  }
}
