import * as THREE from "three";

export type DebuggerOptions = {
  debugEl?: HTMLDivElement | null;
  enabled?: boolean;
};

export class Debugger {
  private enabled = false;
  private debugEl: HTMLDivElement | null;

  // FPS
  private lastT = performance.now();
  private frames = 0;
  private fps = 0;

  // Helpers
  private colliderHelpers: THREE.Box3Helper[] = [];

  constructor(opts?: DebuggerOptions) {
    this.debugEl = opts?.debugEl ?? null;
    this.enabled = opts?.enabled ?? false;

    window.addEventListener("keydown", (e) => {
      if (e.code === "F3") this.toggle();
    });

    this.applyVisibility();
  }

  toggle(force?: boolean) {
    this.enabled = force ?? !this.enabled;
    this.applyVisibility();
  }

  setColliders(scene: THREE.Scene, colliders: THREE.Box3[], color = 0xff0000) {
    // limpia
    for (const h of this.colliderHelpers) scene.remove(h);
    this.colliderHelpers = [];

    if (!this.enabled) return;

    for (const b of colliders) {
      const h = new THREE.Box3Helper(b, color);
      scene.add(h);
      this.colliderHelpers.push(h);
    }
  }

  update(playerPos: THREE.Vector3, camera: THREE.Camera) {
    if (!this.enabled || !this.debugEl) return;

    // FPS calc
    this.frames++;
    const now = performance.now();
    if (now - this.lastT >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastT));
      this.frames = 0;
      this.lastT = now;
    }

    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);

    this.debugEl.textContent =
      `FPS: ${this.fps}\n` +
      `Player:\n` +
      `  x: ${playerPos.x.toFixed(2)}\n` +
      `  y: ${playerPos.y.toFixed(2)}\n` +
      `  z: ${playerPos.z.toFixed(2)}\n` +
      `Forward:\n` +
      `  x: ${fwd.x.toFixed(2)}\n` +
      `  y: ${fwd.y.toFixed(2)}\n` +
      `  z: ${fwd.z.toFixed(2)}\n`;
  }

  private applyVisibility() {
    if (!this.debugEl) return;
    this.debugEl.classList.toggle("hidden", !this.enabled);
  }
}
