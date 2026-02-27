import * as THREE from "three";
import { createRenderer } from "../core/createRenderer";
import { createScene } from "../core/createScene";
import { createCamera } from "../core/createCamera";
import { Time } from "../core/Time";
import { Input } from "../core/Input";
import { Player } from "../entities/Player";
import { Enemy } from "../entities/Enemy";
import { loadLevel1 } from "../world/Level1";
import { CollisionSystem } from "../systems/CollisionSystem";
import { ControlsSystem } from "../systems/ControlsSystem";
import { UISystem } from "../systems/UISystem";

export type GameUI = {
  items: HTMLSpanElement;
  itemsTotal: HTMLSpanElement;
  overlay: HTMLDivElement;
  overlayTitle: HTMLDivElement;
  overlayText: HTMLDivElement;
  overlayBtn: HTMLButtonElement;
  fade: HTMLDivElement;
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private time = new Time();
  private input: Input;
  private controls!: ControlsSystem;
  private player!: Player;
  private enemy!: Enemy;
  private uiSystem: UISystem;

  private raf = 0;

  private collision = new CollisionSystem({
    playerRadius: 0.35,
    playerHeight: 1.7,
    useSlide: true,
  });

  // Reutiliza el vector: cero basura por frame
  private prevPos = new THREE.Vector3();
  private enemyPrev = new THREE.Vector3();

  constructor(
    private mount: HTMLElement,
    private ui: GameUI,
  ) {
    this.renderer = createRenderer(this.mount);
    this.scene = createScene();
    this.camera = createCamera(this.mount);

    this.input = new Input();

    // UI: listeners una sola vezthis.uiSystem = new UISystem(this.ui);
    this.ui = ui;
    this.uiSystem = new UISystem(this.ui);
    this.uiSystem.toggleDebug(true); // si quieres que salga por defecto
    this.ui.overlayBtn.addEventListener("click", () => location.reload());

    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  // Start ya no es sync: inicializa y luego arranca loop
  async start() {
    await this.initWorld();
    this.loop();
  }

  private async initWorld() {
    this.controls = new ControlsSystem(this.camera, this.mount, this.input);
    this.scene.add(this.controls.object);

    // Crea player/enemy primero
    this.player = new Player(this.camera, this.controls.object.position);
    this.enemy = new Enemy(this.scene, {
      url: "/models/enemy/azure_automaton.glb",
      scale: 0.6, // ajusta si sale enorme/pequeño
      speed: 1.5,
      catchDistance: 1,
      watchDotThreshold: 0.1, //
    });
    this.enemy.position.set(0, 0, -6);

    const { colliders, spawn } = await loadLevel1(this.scene, {
      url: "/models/apartment/ModernApartment.glb",
      debug: true, // al principio
    });

    // Coloca jugador en spawn
    this.player.position.copy(spawn);

    // Construye colliders
    this.collision.setColliders(colliders);

    //end debug
    const safe = this.findSafeSpawn(spawn);
    this.player.position.copy(safe);
    // UI inicial
    this.ui.itemsTotal.textContent = "5";
    this.ui.items.textContent = "0";
  }

  private findSafeSpawn(initial: THREE.Vector3) {
    const p = initial.clone();
    const prev = p.clone();

    // Si estás dentro de algo, probamos “anillos” alrededor
    const steps = [0, 0.5, 1, 1.5, 2, 3, 4];
    const angles = 16;

    for (const r of steps) {
      for (let i = 0; i < angles; i++) {
        const a = (i / angles) * Math.PI * 2;

        p.set(
          initial.x + Math.cos(a) * r,
          initial.y,
          initial.z + Math.sin(a) * r,
        );

        prev.copy(p);

        // Truco: intentamos resolver colisión “contra sí mismo”.
        // Si estaba dentro, resolvePlayer lo empuja atrás (prev), así que detectamos si colisiona:
        const before = p.clone();
        this.collision.resolvePlayer(p, prev);

        const movedBack = p.distanceTo(before) > 0.0001;
        if (!movedBack) return p; // posición segura
      }
    }

    // fallback: si todo falla, lo ponemos en un sitio lejos
    return new THREE.Vector3(0, 1.7, 10);
  }

  private loop = () => {
    const dt = this.time.update();

    // Guardar posición previa
    const axes = this.controls.getAxes();
    const speed = 4.0 * this.controls.getSpeedMultiplier();
    const steps = 3; // 2 o 3 ya se nota mucho
    const stepDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      this.prevPos.copy(this.player.position);
      this.player.update(stepDt, axes, speed);
      this.collision.resolvePlayer(this.player.position, this.prevPos);
    }

    // Enemigo
    this.enemyPrev.copy(this.enemy.position);

    const caught = this.enemy.update(dt, this.camera, this.player.position);

    // evita atravesar paredes (si usas colliders manuales)
    this.collision.resolveSphere(
      this.enemy.position,
      this.enemyPrev,
      this.enemy.radius,
    );

    if (caught) {
      // game over UI
      this.ui.overlay.classList.remove("hidden");
      this.ui.overlayTitle.textContent = "TE ATRAPÓ";
      this.ui.overlayText.textContent = "No lo pierdas de vista.";
    }

    if (caught) {
      // Game Over UI
    }
    this.uiSystem.update(this.player.position, this.camera);
    // Render
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  private onResize = () => {
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();
    this.renderer.dispose();
  }
}
