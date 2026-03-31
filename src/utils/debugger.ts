import * as THREE from "three";

export type DebuggerOptions = {
  debugEl?: HTMLDivElement | null;
  enabled?: boolean;
  scene: THREE.Scene;
};

export type DebugExtras = {
  flashlightOn?: boolean;
  flashlightBattery?: number;
  enemyPos?: THREE.Vector3;
  enemyState?: string;
  enemyFrozen?: boolean;
  enemyInFrustum?: boolean;
  enemyHasLOS?: boolean;
};

export class Debugger {
  private enabled = false;
  private debugEl: HTMLDivElement | null;
  private scene: THREE.Scene;

  // Sub-features
  private godLightOn = false;
  private collidersOn = false;

  // God light
  private readonly godLight = new THREE.AmbientLight(0xffffff, 5.0);
  private savedFog: THREE.FogBase | null = null;
  private savedBackground: THREE.Scene["background"] = null;

  // FPS
  private lastT = performance.now();
  private frames = 0;
  private fps = 0;
  private frameMs = 0;
  private prevFrameT = performance.now();

  // Colliders
  private storedColliders: THREE.Box3[] = [];
  private helpers: THREE.Box3Helper[] = [];

  constructor(opts: DebuggerOptions) {
    this.debugEl = opts.debugEl ?? null;
    this.enabled = opts.enabled ?? false;
    this.scene = opts.scene;

    window.addEventListener("keydown", (e) => {
      if (e.code === "F3") { e.preventDefault(); this.toggle(); }
      if (e.code === "F4") { e.preventDefault(); if (this.enabled) this.toggleGodLight(); }
      if (e.code === "F5") { e.preventDefault(); if (this.enabled) this.toggleColliders(); }
    });

    this.applyVisibility();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  toggle(force?: boolean) {
    this.enabled = force ?? !this.enabled;
    // Apagar sub-features al cerrar el panel
    if (!this.enabled) {
      if (this.godLightOn) this.toggleGodLight();
      if (this.collidersOn) this.toggleColliders();
    }
    this.applyVisibility();
  }

  /** Guarda los colliders — se muestran/ocultan dinámicamente con F5. */
  setColliders(_scene: THREE.Scene, colliders: THREE.Box3[]) {
    this.storedColliders = colliders;
  }

  update(playerPos: THREE.Vector3, camera: THREE.Camera, extras?: DebugExtras) {
    this.countFrame();
    if (!this.enabled || !this.debugEl) return;

    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);

    const ep = extras?.enemyPos;
    const dist = ep ? playerPos.distanceTo(ep) : null;
    const bat = extras?.flashlightBattery;

    const on    = (v?: boolean) => v ? `<span class="dbg-on">SÍ</span>` : `<span class="dbg-off">NO</span>`;
    const onOff = (v?: boolean, yes = "ON", no = "OFF") =>
      v ? `<span class="dbg-on">${yes}</span>` : `<span class="dbg-off">${no}</span>`;

    const stateTag = (s?: string) => {
      if (!s) return "–";
      if (s === "CHASE")  return `<span class="dbg-warn">${s}</span>`;
      if (s === "ATTACK") return `<span class="dbg-danger">${s}</span>`;
      return `<span class="dbg-dim">${s}</span>`;
    };

    const enemyBlock = ep
      ? `  pos   ${v3(ep)}\n` +
        `  dist  <b>${dist!.toFixed(2)} m</b>   estado: ${stateTag(extras?.enemyState)}\n` +
        `  frustum: ${on(extras?.enemyInFrustum)}   LOS: ${on(extras?.enemyHasLOS)}\n` +
        `  linterna: ${onOff(extras?.flashlightOn)}` +
        (bat != null ? ` <span class="dbg-dim">(${Math.round(bat * 100)}%)</span>` : "") +
        `   congelado: ${on(extras?.enemyFrozen)}\n`
      : `  <span class="dbg-dim">sin datos</span>\n`;

    this.debugEl.innerHTML =
      `<span class="dbg-header">── TERROR THREE DEBUG ──────────────</span>\n` +
      `FPS: <b>${this.fps}</b>   Δt: <b>${this.frameMs.toFixed(1)} ms</b>\n` +
      `\n` +
      `<span class="dbg-section">CONTROLES</span>\n` +
      `  <span class="dbg-key">F4</span> Iluminación: ${onOff(this.godLightOn, "ACTIVA", "APAGADA")}\n` +
      `  <span class="dbg-key">F5</span> Colliders:   ${onOff(this.collidersOn, "VISIBLES", "OCULTOS")}\n` +
      `\n` +
      `<span class="dbg-section">JUGADOR</span>\n` +
      `  pos   ${v3(playerPos)}\n` +
      `  dir   ${v3(fwd)}\n` +
      `\n` +
      `<span class="dbg-section">ENEMY</span>\n` +
      enemyBlock;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private countFrame() {
    const now = performance.now();
    this.frameMs = now - this.prevFrameT;
    this.prevFrameT = now;

    this.frames++;
    if (now - this.lastT >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastT));
      this.frames = 0;
      this.lastT = now;
    }
  }

  private toggleGodLight() {
    this.godLightOn = !this.godLightOn;
    if (this.godLightOn) {
      this.savedFog = this.scene.fog;
      this.savedBackground = this.scene.background;
      this.scene.fog = null;
      this.scene.background = new THREE.Color(0x909090);
      this.scene.add(this.godLight);
    } else {
      this.scene.fog = this.savedFog;
      this.scene.background = this.savedBackground;
      this.scene.remove(this.godLight);
    }
  }

  private toggleColliders() {
    this.collidersOn = !this.collidersOn;
    this.rebuildHelpers();
  }

  private rebuildHelpers() {
    for (const h of this.helpers) this.scene.remove(h);
    this.helpers = [];
    if (!this.collidersOn) return;
    for (const b of this.storedColliders) {
      const h = new THREE.Box3Helper(b, 0x00ff88);
      this.scene.add(h);
      this.helpers.push(h);
    }
  }

  private applyVisibility() {
    if (!this.debugEl) return;
    this.debugEl.classList.toggle("hidden", !this.enabled);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  const s = n.toFixed(2);
  return n >= 0 ? ` ${s}` : s;
}

function v3(v: THREE.Vector3) {
  return `<span class="dbg-dim">${fmt(v.x)}</span> / <span class="dbg-dim">${fmt(v.y)}</span> / <span class="dbg-dim">${fmt(v.z)}</span>`;
}
