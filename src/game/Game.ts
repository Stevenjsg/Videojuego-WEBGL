import * as THREE from "three";
import { createRenderer } from "@core/createRenderer";
import { createScene } from "@core/createScene";
import { createCamera } from "@core/createCamera";
import { Time } from "@core/Time";
import { Input } from "@core/Input";
import { Player } from "@entities/Player";
import { Enemy } from "@entities/Enemy";
import { loadLevel1, loadLevel1FromRoot } from "@world/Level1";
import { loadEXREnvironment } from "@world/sky";
import { CollisionSystem } from "@systems/CollisionSystem";
import { ControlsSystem } from "@systems/ControlsSystem";
import { UISystem } from "@systems/UISystem";
import { EnemySystem } from "@systems/EnemySystem";
import { Debugger } from "@/utils/debugger";
import { PostFXSystem } from "@systems/PostFXSystem";
import { Flashlight } from "@entities/Flashlight";
import { Pickup } from "@entities/Pickup";
import { InteractSystem } from "@systems/InteractSystem";
import { InventorySystem } from "@systems/InventorySystem";
import { PICKUPS } from "@world/levelData";
import { downloadWithProgress } from "@core/download";
import { loadGLBFromBlob } from "@core/gltfFromBlob";

import type { GameUI, GameState } from "./types";
import { GAME } from "./constants";
import { hideOverlay, setGameOverUI } from "./state";
import { bindLoadingUI } from "@/core/assets";

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private postFX!: PostFXSystem;

  private time = new Time();
  private input = new Input();

  private controls!: ControlsSystem;
  private player!: Player;

  private enemy!: Enemy;
  private enemySystem!: EnemySystem;

  private uiSystem: UISystem;
  private debugger: Debugger;

  private collision = new CollisionSystem({
    playerRadius: GAME.PLAYER.RADIUS,
    playerHeight: GAME.PLAYER.HEIGHT,
    useSlide: true,
  });

  private hdriRT: THREE.WebGLRenderTarget | null = null;

  private prevPos = new THREE.Vector3();
  private raf = 0;
  private state: GameState = "LOADING";

  // debug jumps
  private debugInitialized = false;
  private lastPos = new THREE.Vector3();
  private lastYaw = 0;

  private flashlight!: Flashlight;
  private inventory!: InventorySystem;
  private pickups: Pickup[] = [];
  private interact!: InteractSystem;

  constructor(
    private mount: HTMLElement,
    private ui: GameUI,
  ) {
    this.renderer = this.createAndConfigureRenderer();
    this.scene = createScene();
    this.camera = createCamera(this.mount);

    this.uiSystem = new UISystem(this.ui);
    this.debugger = new Debugger({
      debugEl:
        this.ui.debug ??
        (document.getElementById("debug") as HTMLDivElement | null),
      enabled: false,
    });

    this.bindUI();
    this.bindResize();
  }

  async start() {
    bindLoadingUI();
    await this.initWorld();
    this.state = "PLAYING";
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();

    this.hdriRT?.dispose();
    this.hdriRT = null;

    this.renderer.dispose();
  }

  // -------------------- setup --------------------

  private createAndConfigureRenderer() {
    const r = createRenderer(this.mount);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.6;
    r.setPixelRatio(Math.min(window.devicePixelRatio, GAME.PIXEL_RATIO_CAP));
    return r;
  }

  private bindUI() {
    this.ui.overlayBtn.addEventListener("click", () => location.reload());
  }

  private bindResize() {
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  private async initWorld() {
    const loadingEl = document.getElementById("loading");
    const fill = document.getElementById(
      "loading-bar-fill",
    ) as HTMLDivElement | null;
    const text = document.getElementById(
      "loading-text",
    ) as HTMLDivElement | null;
    const title = document.querySelector(
      ".loading-title",
    ) as HTMLDivElement | null;

    const showLoading = () => loadingEl?.classList.remove("hidden");
    const hideLoading = () => loadingEl?.classList.add("hidden");

    const setTitle = (s: string) => {
      if (title) title.textContent = s;
    };
    const setStage = (s: string) => {
      if (text) text.textContent = s;
    };
    const setProgress = (p01: number) => {
      if (!fill || !text) return;
      const p = Math.round(p01 * 100);
      fill.style.width = `${p}%`;
      text.textContent = `${p}%`;
    };

    loadingEl?.classList.remove("hidden");
    setStage("Preparando…");
    setTitle("Preparando…");
    setProgress(0);

    // Controles y postFX pueden crearse ya (no descargan)
    this.initControls();
    this.initPostFX();

    // 1) DESCARGA + PARSEO NIVEL
    setStage("Descargando nivel…");
    setTitle("Descargando nivel…");

    const levelBlob = await downloadWithProgress(GAME.LEVEL1.URL, (p) => {
      if (p.ratio != null) setProgress(p.ratio * 0.6); // 60% del total
    });

    setStage("Procesando nivel…");
    setTitle("Procesando nivel…");
    const levelRoot = await loadGLBFromBlob(levelBlob, setStage);

    // En vez de loadLevel1() (que recarga), usa fromRoot:
    const { colliders, spawn } = loadLevel1FromRoot(this.scene, levelRoot, {
      debug: GAME.LEVEL1.DEBUG,
    });

    // 2) HDRI (sin barra exacta, pero con “fase”)
    setStage("Cargando iluminación…");
    setTitle("Cargando iluminación…");
    this.hdriRT = await loadEXREnvironment(
      this.renderer,
      this.scene,
      GAME.HDRI.URL,
      {
        setBackground: false,
        intensity: GAME.HDRI.INTENSITY,
      },
    );

    // 3) Entidades + colisiones + UI
    this.initEntities();
    this.initCollisions(colliders);
    this.initSpawn(spawn);
    this.initUI();

    setProgress(1);
    setTitle("Listo");
    setStage("Listo");
    setTimeout(() => loadingEl?.classList.add("hidden"), 200);
  }

  private initControls() {
    this.controls = new ControlsSystem(this.camera, this.mount, this.input, {
      canLock: () => this.ui.overlay.classList.contains("hidden"),
      sensitivity: 0.002,
      maxMouseDelta: 60,
      ignoreMouseEvents: 2,
    });

    // MUY IMPORTANTE: player root a la escena (no metas enemigo aquí)
    this.scene.add(this.controls.object);
  }

  private initPostFX() {
    this.postFX = new PostFXSystem(this.renderer, this.scene, this.camera, {
      grainIntensity: 0.8,
      grayscale: false,
    });
  }

  private async initEnvironment() {
    this.hdriRT = await loadEXREnvironment(
      this.renderer,
      this.scene,
      GAME.HDRI.URL,
      {
        setBackground: false,
        intensity: GAME.HDRI.INTENSITY,
      },
    );
  }

  private initEntities() {
    this.player = new Player(this.camera, this.controls.object.position);

    this.enemy = new Enemy(this.scene, {
      url: GAME.ENEMY.URL,
      scale: GAME.ENEMY.SCALE,
    });

    this.enemy.position.set(
      GAME.ENEMY.SPAWN.x,
      GAME.ENEMY.SPAWN.y,
      GAME.ENEMY.SPAWN.z,
    );

    this.enemySystem = new EnemySystem(this.enemy, this.collision, {
      speed: GAME.ENEMY.SPEED,
      catchDistance: GAME.ENEMY.CATCH_DISTANCE,
      watchDotThreshold: GAME.ENEMY.WATCH_DOT,
    });
    const windowPoint = new THREE.Vector3(5, 0, -2); // ajusta
    const dir = windowPoint.clone().sub(this.enemy.position);
    dir.y = 0;
    dir.normalize();
    this.enemy.root.rotation.y = Math.atan2(dir.x, dir.z);

    // Linterna (equipo en cámara)
    this.flashlight = new Flashlight(this.camera, {
      url: "/models/assets/flashlight.glb",
      angle: 0.35,
      penumbra: 0.15,
      intensity: 6,
      decay: 1.2,
      distance: 12,
      batteryDrainPerSec: 0.01,
      modelScale: 0.15,
      muzzlePos: new THREE.Vector3(0.02, -0.03, -0.22),
      targetDistance: 6.0,
    });
    this.inventory = new InventorySystem(this.flashlight);

    // Pickups en el mundo
    this.pickups = PICKUPS.map(
      (p) =>
        new Pickup({
          type: p.type as any,
          url:
            p.type === "flashlight"
              ? "/models/assets/flashlight.glb"
              : "/models/assets/battery.glb",
          position: new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
          scale: p.scale ?? 1,
          batteryAmount: (p as any).amount ?? 0.25,
        }),
    );

    for (const p of this.pickups) this.scene.add(p.root);

    // Interacciones
    this.interact = new InteractSystem(this.camera, this.pickups);
  }

  private async initLevel() {
    return await loadLevel1(this.scene, {
      url: GAME.LEVEL1.URL,
      debug: GAME.LEVEL1.DEBUG,
    });
  }

  private initCollisions(colliders: THREE.Box3[]) {
    this.collision.setColliders(colliders);
    this.debugger.setColliders(this.scene, colliders);
  }

  private initSpawn(spawn: THREE.Vector3) {
    this.player.position.copy(spawn);
    this.controls.object.rotation.y = Math.PI / 2;

    // init jump debugger
    this.lastPos.copy(this.player.position);
    this.lastYaw = this.controls.object.rotation.y;
    this.debugInitialized = true;
  }

  private initUI() {
    this.ui.itemsTotal.textContent = String(GAME.UI.ITEMS_TOTAL);
    this.ui.items.textContent = "0";
    hideOverlay(this.ui);
  }

  // -------------------- loop --------------------

  private loop = () => {
    const dt = this.time.update();

    if (this.state === "PLAYING") {
      this.update(dt);
    }

    this.postFX.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.controls.update();
    this.updatePlayer(dt);

    // --- gameplay input ---
    // Toggle linterna
    if (this.input.justPressed("KeyF")) {
      this.flashlight.toggle();
    }

    // Interactuar
    if (this.input.justPressed("KeyE")) {
      const picked = this.interact.tryPickup(2.0);
      if (picked) {
        if (picked.type === "flashlight") this.inventory.pickupFlashlight();
        else this.inventory.pickupBattery(picked.batteryAmount);

        this.interact.removePickup(picked, this.scene);
      }
    }

    this.flashlight.update(dt);

    // enemy: pásale flashlightOn para tu regla
    const caught = this.enemySystem.update(
      dt,
      this.camera,
      this.player.position,
    );

    if (caught) this.setGameOver();

    this.uiSystem.update(this.player.position, this.camera);
    this.debugger.update(this.player.position, this.camera);

    this.input.endFrame(); // si existe en tu Input
  }
  private updatePlayer(dt: number) {
    const axes = this.controls.getAxes();
    const speed = GAME.PLAYER.BASE_SPEED * this.controls.getSpeedMultiplier();

    const steps = GAME.PLAYER.SUBSTEPS;
    const stepDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      this.prevPos.copy(this.player.position);
      this.player.update(stepDt, axes, speed);
      this.collision.resolvePlayer(this.player.position, this.prevPos);
    }
  }

  private setGameOver() {
    if (this.state === "GAME_OVER") return;
    this.state = "GAME_OVER";
    this.controls.unlock();
    setGameOverUI(this.ui);
  }

  // -------------------- debug --------------------

  private debugJumps() {
    const pos = this.player.position;
    const d = pos.distanceTo(this.lastPos);

    const yaw = this.controls.object.rotation.y;
    const dyaw = Math.abs(
      THREE.MathUtils.euclideanModulo(
        yaw - this.lastYaw + Math.PI,
        Math.PI * 2,
      ) - Math.PI,
    );

    if (d > 0.6) {
      console.warn(
        "[JUMP POS]",
        d.toFixed(3),
        "pos",
        pos.toArray(),
        "prev",
        this.lastPos.toArray(),
      );
    }
    if (dyaw > 1.5) {
      console.warn(
        "[JUMP YAW]",
        ((dyaw * 180) / Math.PI).toFixed(1),
        "deg",
        "yaw",
        yaw.toFixed(3),
      );
    }

    this.lastPos.copy(pos);
    this.lastYaw = yaw;
  }

  // -------------------- resize --------------------

  private onResize = () => {
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.postFX?.setSize(w, h);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, GAME.PIXEL_RATIO_CAP),
    );
  };
}
