import * as THREE from "three";
import type { GameUI } from "../game/Game";

export class UISystem {
  private debugEl: HTMLDivElement | null;
  private enabled = false;

  // para FPS simple
  private lastT = performance.now();
  private frames = 0;
  private fps = 0;

  constructor(private ui: GameUI) {
    this.debugEl = document.getElementById("debug") as HTMLDivElement | null;

    window.addEventListener("keydown", (e) => {
      if (e.code === "F3") this.toggleDebug(); // F3 estilo “minecraft”
    });
  }

  toggleDebug(force?: boolean) {
    this.enabled = force ?? !this.enabled;
    if (!this.debugEl) return;
    this.debugEl.classList.toggle("hidden", !this.enabled);
  }

  update(playerPos: THREE.Vector3, camera: THREE.Camera) {
    if (!this.enabled || !this.debugEl) return;

    // FPS
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
      `Camera forward:\n` +
      `  x: ${fwd.x.toFixed(2)}\n` +
      `  y: ${fwd.y.toFixed(2)}\n` +
      `  z: ${fwd.z.toFixed(2)}\n`;
  }
}
