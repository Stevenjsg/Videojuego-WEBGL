import * as THREE from "three";
import { createRenderer } from "@core/createRenderer";
import { createScene } from "@core/createScene";
import { createCamera } from "@core/createCamera";
import { Time } from "@core/Time";
import { Input } from "@core/Input";
import { Player } from "@entities/Player";
import { Enemy } from "@entities/Enemy";
import { setupLevelMeshes } from "@world/Level1";
import { loadZone1 } from "@world/Zone1";
import type { LevelSpawns } from "@world/Zone1";
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
import { LEVEL1_SPAWN } from "@world/levelData";
import { InteractiveDoor } from "@entities/InteractiveDoor";
import { ZoneManager } from "@systems/ZoneManager";
import { downloadWithProgress } from "@core/download";
import { loadGLBFromBlob } from "@core/gltfFromBlob";

import type { PickupType } from "@entities/Pickup";
import type { GameUI, GameState } from "./types";

/** Maps Zone1 item type names to PickupType + model URL. */
const ZONE1_ITEM_MAP: Record<string, { pickup: PickupType; url: string }> = {
  flashlight: { pickup: "flashlight", url: "/models/assets/flashlight.glb" },
  Pila: { pickup: "battery", url: "/models/assets/battery.glb" },
  "Llave 1": { pickup: "key", url: "/models/assets/battery.glb" }, // TODO: key model
  "Llave 2": { pickup: "key", url: "/models/assets/battery.glb" }, // TODO: key model
  Fusible: { pickup: "objective", url: "/models/assets/battery.glb" }, // TODO: fusible model
};
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

  private flashlight!: Flashlight;
  private inventory!: InventorySystem;
  private pickups: Pickup[] = [];
  private doors: InteractiveDoor[] = [];
  private interact!: InteractSystem;
  private zoneManager!: ZoneManager;

  /** Meshes del nivel usados para el raycast de línea de visión del enemy */
  private levelMeshes: THREE.Object3D[] = [];

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
      scene: this.scene,
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

    this.initControls();
    this.initPostFX();

    // ── 0) Inicializar Zone Manager ──
    this.zoneManager = new ZoneManager(
      this.scene,
      this.collision,
      (ratio) => setProgress(ratio),
      (msg) => setStage(msg)
    );

    // ── 1) Registrar Zonas Dinámicas (Apartment) ──
    const lp = GAME.LEVEL1.POS;
    this.zoneManager.addZone({
      id: "ModernApartment",
      url: GAME.LEVEL1.URL,
      position: new THREE.Vector3(lp.x, lp.y, lp.z),
      // Caja muy generosa alrededor del apartamento (Z > 10)
      triggerBox: new THREE.Box3(
        new THREE.Vector3(-50, -10, 10),
        new THREE.Vector3(50, 20, 100)
      ),
      onLoad: (root) => {
        // Añadir a meshes del nivel para el enemigo (Opcional)
        root.traverse((child) => {
          if ((child as any).isMesh) this.levelMeshes.push(child);
        });
      }
    });

    // ── 2) Zone 1 (Core base spawn level) ──
    setStage("Cargando zona 1…");
    setTitle("Cargando zona 1…");
    const zone1 = await loadZone1(this.scene, GAME.LEVEL1_ZONE1.URL);
    const zp = GAME.LEVEL1_ZONE1.POS;
    zone1.map.position.set(zp.x, zp.y, zp.z);
    zone1.map.updateMatrixWorld(true);
    const zone1Colliders = setupLevelMeshes(zone1.map);

    // ── 2.5) Puertas ──
    setStage("Cargando puertas…");
    setTitle("Cargando puertas…");
    const doorBlob = await downloadWithProgress(
      `/models/assets/puerta_interactiva.glb?v=${Date.now()}`,
      (p) => {
        if (p.ratio != null) setProgress(p.ratio);
      },
    );
    const doorRoot = await loadGLBFromBlob(doorBlob, setStage);
    const doorColliders: THREE.Box3[] = [];

    for (const doorSpawn of zone1.spawns.doors) {
      const doorModel = doorRoot.clone();

      const doorSpawnWorldPos = new THREE.Vector3();
      const doorSpawnWorldQuat = new THREE.Quaternion();
      const doorSpawnWorldScale = new THREE.Vector3();
      doorSpawn.node.getWorldPosition(doorSpawnWorldPos);
      doorSpawn.node.getWorldQuaternion(doorSpawnWorldQuat);
      doorSpawn.node.getWorldScale(doorSpawnWorldScale);

      const interactiveDoor = new InteractiveDoor({
        model: doorModel,
        position: doorSpawnWorldPos,
        quaternion: doorSpawnWorldQuat,
        scale: doorSpawnWorldScale,
        requiresKey: doorSpawn.requiresKey,
      });

      this.scene.add(interactiveDoor.root);
      this.doors.push(interactiveDoor);

      if (interactiveDoor.collider) {
        doorColliders.push(interactiveDoor.collider);
      }
      doorColliders.push(...setupLevelMeshes(interactiveDoor.root));
    }

    // ── 3) HDRI ──
    setStage("Cargando iluminación…");
    setTitle("Cargando iluminación…");
    await this.initEnvironment();

    // ── 4) Entities, collisions, UI ──
    this.initEntities(zone1.spawns);
    
    // Inicializamos colisiones base (solo las de zone1 y doors). El ZoneManager inyectará el Apartment automáticamente.
    const baseColliders = zone1Colliders.concat(doorColliders);
    this.initCollisions(baseColliders);

    // Registrar callback dinámico para recompilarlas si una zona entra/sale
    this.zoneManager.onCollisionsChanged = () => {
      this.initCollisions(baseColliders.concat(this.zoneManager.getAllDynamicColliders()));
    };

    // Player spawn: zone1 empty or hardcoded fallback
    const playerSpawn = zone1.spawns.player
      ? new THREE.Vector3().setFromMatrixPosition(
          zone1.spawns.player.matrixWorld,
        )
      : new THREE.Vector3(...LEVEL1_SPAWN);
    this.initSpawn(playerSpawn);
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
      grainIntensity: 0.4,
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

  private initEntities(spawns?: LevelSpawns) {
    this.player = new Player(this.camera, this.controls.object.position);

    this.enemy = new Enemy(this.scene, {
      url: GAME.ENEMY.URL,
      scale: GAME.ENEMY.SCALE,
    });

    // Enemy spawn: zone1 empty or hardcoded fallback
    if (spawns?.enemy) {
      this.enemy.position.setFromMatrixPosition(spawns.enemy.matrixWorld);
    } else {
      this.enemy.position.set(
        GAME.ENEMY.SPAWN.x,
        GAME.ENEMY.SPAWN.y,
        GAME.ENEMY.SPAWN.z,
      );
    }

    this.enemySystem = new EnemySystem(this.enemy, this.collision, {
      speed: GAME.ENEMY.SPEED,
      catchDistance: GAME.ENEMY.CATCH_DISTANCE,
    });
    const dir = new THREE.Vector3(5, 0, -2).sub(this.enemy.position);
    dir.y = 0;
    dir.normalize();
    this.enemy.root.rotation.y = Math.atan2(dir.x, dir.z);

    // Linterna
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

    // Pickups: apartment hardcoded eliminated (baterias del spawn point)
    this.pickups = [];

    // Pickups: zone1 spawns (Spawn_Item_ empties from GLB)
    if (spawns) {
      for (const item of spawns.items) {
        const wp = new THREE.Vector3().setFromMatrixPosition(
          item.node.matrixWorld,
        );
        const type = ZONE1_ITEM_MAP[item.type];
        if (!type) continue;

        this.pickups.push(
          new Pickup({
            type: type.pickup,
            url: type.url,
            position: wp,
            scale: 0.15,
            batteryAmount: type.pickup === "battery" ? 0.25 : undefined,
            keyName: type.pickup === "key" ? item.type : undefined,
          }),
        );
      }
    }

    for (const p of this.pickups) this.scene.add(p.root);

    // Interacciones
    this.interact = new InteractSystem(this.camera, this.pickups, this.doors);
  }

  private initCollisions(colliders: THREE.Box3[]) {
    this.collision.setColliders(colliders);
    this.debugger.setColliders(this.scene, colliders);
  }

  private initSpawn(spawn: THREE.Vector3) {
    this.player.position.copy(spawn);
    this.controls.object.rotation.y = Math.PI / 2;
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
    
    // Streaming chunking update
    this.zoneManager.update(this.player.position);

    // --- gameplay input ---
    // Toggle linterna
    if (this.input.justPressed("KeyF")) {
      this.flashlight.toggle();
    }

    // Prompt de interacción: mostrar si miramos a una puerta o pickup cercano
    const nearDoor   = this.interact.tryInteractDoor(3.5);
    const nearPickup = this.interact.tryPickup(2.0);
    const showPrompt = nearDoor !== null || nearPickup !== null;
    if (this.ui.interactPrompt) {
      this.ui.interactPrompt.classList.toggle("hidden", !showPrompt);
    }

    // Interactuar
    if (this.input.justPressed("KeyE")) {
      const picked = this.interact.tryPickup(2.0);
      if (picked) {
        switch (picked.type) {
          case "flashlight":
            this.inventory.pickupFlashlight();
            break;
          case "battery":
            this.inventory.pickupBattery(picked.batteryAmount);
            break;
          case "key":
            this.inventory.pickupKey(picked.cfg.keyName ?? "");
            break;
          case "objective":
            this.inventory.pickupObjective();
            break;
        }
        this.interact.removePickup(picked, this.scene);
      } else {
        const door = this.interact.tryInteractDoor(3.5);
        if (door) {
          if (!door.requiresKey || this.inventory.hasKey(door.requiresKey)) {
            door.toggle();
          } else {
            console.log("Puerta bloqueada. Requiere:", door.requiresKey);
          }
        }
      }
    }

    // Actualizar puertas
    for (const door of this.doors) {
      door.update(dt);
    }

    this.flashlight.update(dt);

    // Enemy: congela sólo si linterna encendida + frustum + LOS libre
    const caught = this.enemySystem.updateAdvanced({
      dt,
      camera: this.camera,
      playerPos: this.player.position,
      flashlightOn: this.flashlight.isOn,
      objectivesCollected: this.inventory.objectives,
      objectivesTotal: this.inventory.objectivesTotal,
      occluderMeshes: this.levelMeshes,
    });

    if (caught) this.setGameOver();

    this.debugger.update(this.player.position, this.camera, {
      flashlightOn: this.flashlight.isOn,
      flashlightBattery: this.flashlight.battery,
      enemyPos: this.enemy.position,
      enemyState: this.enemySystem.behaviorState,
      enemyFrozen: this.enemySystem.lastFrozen,
      enemyInFrustum: this.enemySystem.lastInFrustum,
      enemyHasLOS: this.enemySystem.lastHasLOS,
    });

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
