import * as THREE from "three";
import { createRenderer } from "@core/createRenderer";
import { createScene } from "@core/createScene";
import { createCamera } from "@core/createCamera";
import { Time } from "@core/Time";
import { Input } from "@core/Input";
import { Player } from "@entities/Player";
import { Enemy } from "@entities/Enemy";
import { loadLevel1 } from "@world/Level1";
import { CollisionSystem } from "@systems/CollisionSystem";
import { ControlsSystem } from "@systems/ControlsSystem";
import { UISystem } from "@systems/UISystem";

export type GameUI = {
  items: HTMLSpanElement;
  itemsTotal: HTMLSpanElement;
  overlay: HTMLDivElement;
  overlayTitle: HTMLDivElement;
  overlayText: HTMLDivElement;
  overlayBtn: HTMLButtonElement;
  fade: HTMLDivElement;
};

type GameState = "LOADING" | "PLAYING" | "GAME_OVER";

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private time = new Time();
  private input = new Input();

  private controls!: ControlsSystem;
  private player!: Player;
  private enemy!: Enemy;

  private uiSystem: UISystem;

  private collision = new CollisionSystem({
    playerRadius: 0.3, // un pelín más cómodo en interiores
    playerHeight: 1.7,
    useSlide: true,
  });

  private prevPos = new THREE.Vector3();
  private enemyPrev = new THREE.Vector3();
  private tmpBefore = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private tmpPrev = new THREE.Vector3();

  private raf = 0;
  private state: GameState = "LOADING";

  constructor(
    private mount: HTMLElement,
    private ui: GameUI,
  ) {
    this.renderer = createRenderer(this.mount);
    this.scene = createScene();
    this.camera = createCamera(this.mount);

    this.uiSystem = new UISystem(this.ui);
    this.uiSystem.toggleDebug(true);

    this.bindUI();
    this.bindResize();
  }

  async start() {
    await this.initWorld();
    this.state = "PLAYING";
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();
    this.renderer.dispose();
  }

  // -------------------- init --------------------

  private bindUI() {
    this.ui.overlayBtn.addEventListener("click", () => location.reload());
  }

  private bindResize() {
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  private async initWorld() {
    this.initControlsAndEntities();
    await this.initLevelAndColliders();
    this.initUI();
  }

  private initControlsAndEntities() {
    this.controls = new ControlsSystem(this.camera, this.mount, this.input);
    this.scene.add(this.controls.object);

    this.player = new Player(this.camera, this.controls.object.position);

    this.enemy = new Enemy(this.scene, {
      url: "/models/enemy/azure_automaton.glb",
      scale: 0.6,
      speed: 1.5,
      catchDistance: 1,
      watchDotThreshold: 0.1,
    });

    this.enemy.position.set(0, 0, -6);
  }

  private async initLevelAndColliders() {
    const { colliders, spawn } = await loadLevel1(this.scene, {
      url: "/models/apartment/ModernApartment.glb",
      debug: true,
    });

    this.collision.setColliders(colliders);

    const safeSpawn = this.findSafeSpawn(spawn);
    this.player.position.copy(safeSpawn);
  }

  private initUI() {
    this.ui.itemsTotal.textContent = "5";
    this.ui.items.textContent = "0";
    this.ui.overlay.classList.add("hidden");
  }

  // -------------------- loop --------------------

  private loop = () => {
    const dt = this.time.update();

    if (this.state === "PLAYING") {
      this.updatePlayer(dt);
      this.updateEnemy(dt);
      this.uiSystem.update(this.player.position, this.camera);
    }

    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  private updatePlayer(dt: number) {
    const axes = this.controls.getAxes();
    const speed = 4.0 * this.controls.getSpeedMultiplier();

    // substeps para evitar “TP” en paredes
    const steps = 3;
    const stepDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      this.prevPos.copy(this.player.position);
      this.player.update(stepDt, axes, speed);
      this.collision.resolvePlayer(this.player.position, this.prevPos);
    }
  }

  private updateEnemy(dt: number) {
    this.enemyPrev.copy(this.enemy.position);

    const caught = this.enemy.update(dt, this.camera, this.player.position);

    this.collision.resolveSphere(
      this.enemy.position,
      this.enemyPrev,
      this.enemy.radius,
    );

    if (caught && this.state !== "GAME_OVER") {
      this.setGameOver();
    }
  }

  private setGameOver() {
    this.state = "GAME_OVER";
    this.ui.overlay.classList.remove("hidden");
    this.ui.overlayTitle.textContent = "TE ATRAPÓ";
    this.ui.overlayText.textContent = "No lo pierdas de vista.";
    // Opcional: liberar mouse
    this.controls.unlock?.();
  }

  // -------------------- spawn utils --------------------

  private findSafeSpawn(initial: THREE.Vector3) {
    // Reutiliza temporales (sin clones)
    this.tmpP.copy(initial);
    this.tmpPrev.copy(initial);

    const steps = [0, 0.5, 1, 1.5, 2, 3, 4];
    const angles = 16;

    for (const r of steps) {
      for (let i = 0; i < angles; i++) {
        const a = (i / angles) * Math.PI * 2;

        this.tmpP.set(
          initial.x + Math.cos(a) * r,
          initial.y,
          initial.z + Math.sin(a) * r,
        );

        this.tmpPrev.copy(this.tmpP);

        // resolver y comprobar si “rebota”
        this.tmpBefore.copy(this.tmpP);
        this.collision.resolvePlayer(this.tmpP, this.tmpPrev);

        const movedBack = this.tmpP.distanceToSquared(this.tmpBefore) > 1e-8;
        if (!movedBack) return this.tmpP.clone(); // devolvemos una copia estable
      }
    }

    return new THREE.Vector3(0, 1.7, 10);
  }

  // -------------------- resize --------------------

  private onResize = () => {
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  };
}
