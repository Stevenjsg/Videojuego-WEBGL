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
import { ChunkedLevel } from "@world/ChunkedLevel";
import type { LevelSpawns } from "@world/Zone1";
import { loadEXREnvironment } from "@world/sky";
import { CollisionSystem } from "@systems/CollisionSystem";
import { ControlsSystem } from "@systems/ControlsSystem";
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
import { GAME } from "./constants";
import { hideOverlay, setGameOverUI } from "./state";
import { bindLoadingUI } from "@/core/assets";

/** Mapeo de items de Zone1 a configuración de pickup. */
const ZONE1_ITEM_MAP: Record<
  string,
  { pickup: PickupType; url: string; scale?: number }
> = {
  flashlight: { pickup: "flashlight", url: "/models/assets/flashlight.glb" },
  Pila: { pickup: "battery", url: "/models/assets/battery.glb" },
  "Llave 1": { pickup: "key", url: "/models/assets/old_key.glb", scale: 0.1 },
  "Llave 2": { pickup: "key", url: "/models/assets/old_key.glb", scale: 0.1 },
  "Llave Especial": {
    pickup: "key",
    url: "/models/assets/old_key.glb",
    scale: 0.1,
  },
  Fusible: { pickup: "objective", url: "/models/assets/fuse.glb", scale: 0.2 },
  Fuse: { pickup: "objective", url: "/models/assets/fuse.glb", scale: 1 },
};

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

  private debugger: Debugger;

  private collision = new CollisionSystem({
    playerRadius: GAME.PLAYER.RADIUS,
    playerHeight: GAME.PLAYER.HEIGHT,
    useSlide: true,
  });

  private hdriRT: THREE.WebGLRenderTarget | null = null;
  private audioListener: THREE.AudioListener | null = null;
  private pendingAudios: THREE.PositionalAudio[] = [];
  private audioResumed = false;

  // Audio buffers preloaded
  private doorOpenBuffer: AudioBuffer | null = null;
  private footstepsAudio: THREE.Audio | null = null;
  private footstepsPlaying = false;

  private ambienceAudio: THREE.Audio | null = null;
  private breathingAudio: THREE.Audio | null = null;
  private breathingPlaying = false;

  // Hit / HP system
  private playerHP: number = GAME.PLAYER.HP;
  private hitGraceTimer = 0;
  private playerSpeedPenalty = 0; // 0..1

  // Overlay DOM para el flash rojo en cada hit
  private hitFlashEl: HTMLDivElement | null = null;

  // Puzzle del fusible
  private fuseBox: THREE.Object3D | null = null;
  private fuseBoxPos = new THREE.Vector3();
  private hasFuse = false;
  private puzzleSolved = false;

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

  // Zone transition
  private specialDoor: InteractiveDoor | null = null;
  private zone1Data: {
    map: THREE.Group;
    colliders: THREE.Box3[];
    level: ChunkedLevel;
  } | null = null;
  private zone2Loaded = false;

  // Locked door message
  private lockedMsgTimer = 0;

  constructor(
    private mount: HTMLElement,
    private ui: GameUI,
  ) {
    this.renderer = this.createAndConfigureRenderer();
    this.scene = createScene();
    this.camera = createCamera(this.mount);

    this.debugger = new Debugger({
      debugEl:
        this.ui.debug ??
        (document.getElementById("debug") as HTMLDivElement | null),
      enabled: false,
      scene: this.scene,
    });

    this.bindUI();
    this.bindResize();

    // Crear overlay de flash rojo
    this.hitFlashEl = document.createElement("div");
    this.hitFlashEl.className = "hit-flash";
    this.mount.appendChild(this.hitFlashEl);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

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

  // ── Setup ────────────────────────────────────────────────────────────────

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
    const ld = this.queryLoadingDom();
    ld.show();
    ld.setStage("Preparando…");
    ld.setTitle("Preparando…");
    ld.setProgress(0);

    this.initControls();
    this.initPostFX();
    this.zoneManager = this.createZoneManager(ld);

    this.registerApartmentZone();

    // ── Zone 1 (mapa base) ──
    ld.setStage("Cargando zona 1…");
    ld.setTitle("Cargando zona 1…");
    // Solo el core (colliders + spawns); lo visual llega por chunks.
    const zone1 = await loadZone1(this.scene, GAME.LEVEL1_ZONE1.URL, {
      renderer: this.renderer,
      position: GAME.LEVEL1_ZONE1.POS,
      onChunk: (chunk) => {
        setupLevelMeshes(chunk);
        this.collectLOSMeshesFrom(chunk);
      },
    });
    const zone1Colliders = setupLevelMeshes(zone1.map);
    this.zone1Data = {
      map: zone1.map,
      colliders: zone1Colliders,
      level: zone1.level,
    };

    // BUGFIX: las meshes de LOS deben venir de la zona ACTIVA, no de un
    // apartamento que tarda en cargar. Recolectamos las visibles de zone1.
    this.collectLOSMeshesFrom(zone1.map);

    // ── Chunks cercanos al spawn + puertas (en paralelo) ──
    // El resto de chunks sigue cargando en segundo plano durante el juego.
    const spawn = this.computePlayerSpawn(zone1.spawns);
    const [doorRoot] = await Promise.all([
      downloadWithProgress(
        `/models/assets/puerta_interactiva.glb?v=${Date.now()}`,
      ).then((blob) => loadGLBFromBlob(blob)),
      zone1.level.stream({
        focus: () => this.player?.position ?? spawn,
        gateRadius: GAME.LEVEL1_ZONE1.GATE_RADIUS,
        onProgress: (p) => ld.setProgress(p),
      }),
    ]);
    const doorColliders = this.spawnDoors(doorRoot, zone1.spawns.doors);

    // Cuando Zona1 termine, precargar el apartamento en la caché HTTP para
    // que la transición sea casi instantánea.
    zone1.level.complete.then(() => ChunkedLevel.prefetch(GAME.LEVEL1.URL));

    // ── HDRI ──
    ld.setStage("Cargando iluminación…");
    ld.setTitle("Cargando iluminación…");
    await this.initEnvironment();

    // Fuse_Box: guardar referencia y posición
    if (zone1.spawns.fuseBox) {
      this.fuseBox = zone1.spawns.fuseBox;
      this.fuseBox.getWorldPosition(this.fuseBoxPos);
    }

    // ── Entidades + colisiones ──
    this.initEntities(zone1.spawns);

    const baseColliders = zone1Colliders.concat(doorColliders);
    this.initCollisions(baseColliders);
    this.zoneManager.onCollisionsChanged = () => {
      this.initCollisions(
        baseColliders.concat(this.zoneManager.getAllDynamicColliders()),
      );
    };

    // ── Audio ──
    this.initAudio(zone1.spawns);

    // ── Spawn + UI ──
    this.initSpawn(spawn);
    this.initUI();

    ld.setProgress(1);
    ld.setTitle("Listo");
    ld.setStage("Listo");
    setTimeout(() => ld.hide(), 200);
  }

  private queryLoadingDom() {
    const root = document.getElementById("loading");
    const fill = document.getElementById(
      "loading-bar-fill",
    ) as HTMLDivElement | null;
    const text = document.getElementById(
      "loading-text",
    ) as HTMLDivElement | null;
    const title = document.querySelector(
      ".loading-title",
    ) as HTMLDivElement | null;

    return {
      show: () => root?.classList.remove("hidden"),
      hide: () => root?.classList.add("hidden"),
      setTitle: (s: string) => {
        if (title) title.textContent = s;
      },
      setStage: (s: string) => {
        if (text) text.textContent = s;
      },
      setProgress: (p01: number) => {
        if (!fill || !text) return;
        const p = Math.round(p01 * 100);
        fill.style.width = `${p}%`;
        text.textContent = `${p}%`;
      },
    };
  }

  private createZoneManager(ld: ReturnType<Game["queryLoadingDom"]>) {
    return new ZoneManager(
      this.scene,
      this.collision,
      (ratio) => ld.setProgress(ratio),
      (msg) => ld.setStage(msg),
      this.renderer,
    );
  }

  private registerApartmentZone() {
    const lp = GAME.LEVEL1.POS;
    this.zoneManager.addZone({
      id: "ModernApartment",
      url: GAME.LEVEL1.URL,
      position: new THREE.Vector3(lp.x, lp.y, lp.z),
      // Trigger inalcanzable: la zona solo se fuerza al abrir la puerta
      // especial sobre el suelo de transición.
      triggerBox: new THREE.Box3(
        new THREE.Vector3(9999, 9999, 9999),
        new THREE.Vector3(9999, 9999, 9999),
      ),
      gateRadius: GAME.LEVEL1.GATE_RADIUS,
      // Por cada chunk (core incluido) a medida que llega.
      onChunk: (chunk) => this.collectLOSMeshesFrom(chunk),
    });
  }

  /** Añade al pool de meshes de LOS las geometrías visibles del root. */
  private collectLOSMeshesFrom(root: THREE.Object3D) {
    root.traverse((child) => {
      if ((child as any).isMesh && child.visible) this.levelMeshes.push(child);
    });
  }

  private spawnDoors(
    doorRoot: THREE.Object3D,
    doorSpawns: LevelSpawns["doors"],
  ): THREE.Box3[] {
    const doorColliders: THREE.Box3[] = [];
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3();

    for (const spawn of doorSpawns) {
      const model = doorRoot.clone();
      spawn.node.getWorldPosition(wp);
      spawn.node.getWorldQuaternion(wq);
      spawn.node.getWorldScale(ws);

      const door = new InteractiveDoor({
        model,
        position: wp.clone(),
        quaternion: wq.clone(),
        scale: ws.clone(),
        requiresKey: spawn.requiresKey,
      });

      this.scene.add(door.root);
      this.doors.push(door);
      if (door.collider) doorColliders.push(door.collider);
      doorColliders.push(...setupLevelMeshes(door.root));

      if (spawn.requiresKey === "Llave Especial") this.specialDoor = door;
    }
    return doorColliders;
  }

  private initControls() {
    this.controls = new ControlsSystem(this.camera, this.mount, this.input, {
      canLock: () => this.ui.overlay.classList.contains("hidden"),
      sensitivity: 0.002,
      maxMouseDelta: 60,
      ignoreMouseEvents: 2,
    });

    // Player root a la escena (no el enemigo)
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
      freezeBreakTime: GAME.ENEMY.FREEZE_BREAK_TIME,
      searchDuration: GAME.ENEMY.SEARCH_DURATION,
      detectionRange: GAME.ENEMY.DETECTION_RANGE,
      detectionRangeRunning: GAME.ENEMY.DETECTION_RANGE_RUNNING,
      // BUGFIX: comunicar el radio del player al enemigo para resolver
      // correctamente la colisión cápsula-cápsula.
      playerRadius: GAME.PLAYER.RADIUS,
    });

    // Orientación inicial del enemy hacia un punto de referencia
    const dir = new THREE.Vector3(5, 0, -2).sub(this.enemy.position);
    dir.y = 0;
    dir.normalize();
    this.enemy.root.rotation.y = Math.atan2(dir.x, dir.z);

    // Linterna
    this.flashlight = new Flashlight(this.camera, {
      url: "/models/assets/flashlight.glb",
      angle: 0.45,
      penumbra: 0.6,
      intensity: 6,
      decay: 1.2,
      distance: 14,
      batteryDrainPerSec: 0.01,
      modelScale: 0.15,
      muzzlePos: new THREE.Vector3(0.02, -0.03, -0.22),
      targetDistance: 6.0,
    });
    this.inventory = new InventorySystem(this.flashlight);

    this.pickups = [];

    // Pickups: zone1 spawns (Spawn_Item_)
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
            scale: type.scale ?? 0.15,
            batteryAmount: type.pickup === "battery" ? 0.25 : undefined,
            keyName:
              type.pickup === "key"
                ? item.type
                : item.type === "Fuse"
                  ? "Fuse"
                  : undefined,
          }),
        );
      }
    }

    for (const p of this.pickups) this.scene.add(p.root);

    this.interact = new InteractSystem(this.camera, this.pickups, this.doors);
  }

  private initCollisions(colliders: THREE.Box3[]) {
    this.collision.setColliders(colliders);
    this.debugger.setColliders(this.scene, colliders);
  }

  private computePlayerSpawn(spawns: LevelSpawns): THREE.Vector3 {
    if (spawns.player) {
      return new THREE.Vector3().setFromMatrixPosition(
        spawns.player.matrixWorld,
      );
    }
    return new THREE.Vector3(...LEVEL1_SPAWN);
  }

  private initSpawn(spawn: THREE.Vector3) {
    this.player.position.copy(spawn);
    this.controls.object.rotation.y = Math.PI / 2 + Math.PI;
  }

  private initUI() {
    this.ui.itemsTotal.textContent = String(GAME.UI.ITEMS_TOTAL);
    this.ui.items.textContent = "0";
    hideOverlay(this.ui);
  }

  // ── Audio ────────────────────────────────────────────────────────────────

  private initAudio(spawns: LevelSpawns) {
    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);
    const audioLoader = new THREE.AudioLoader();

    audioLoader.load("/music/sfx/fx_openDoor.mp3", (buffer) => {
      this.doorOpenBuffer = buffer;
    });

    this.footstepsAudio = new THREE.Audio(this.audioListener);
    audioLoader.load("/music/sfx/fx_indoor-footsteps.mp3", (buffer) => {
      this.footstepsAudio!.setBuffer(buffer);
      this.footstepsAudio!.setLoop(true);
      this.footstepsAudio!.setVolume(0.35);
    });

    this.ambienceAudio = new THREE.Audio(this.audioListener);
    audioLoader.load(
      "/music/ambience/ambience-night-wildlife-a.mp3",
      (buffer) => {
        this.ambienceAudio!.setBuffer(buffer);
        this.ambienceAudio!.setLoop(true);
        this.ambienceAudio!.setVolume(0.08);
        if (this.audioResumed && !this.ambienceAudio!.isPlaying) {
          this.ambienceAudio!.play();
        }
      },
    );

    this.breathingAudio = new THREE.Audio(this.audioListener);
    audioLoader.load("/music/sfx/fx_heavy-breathing.mp3", (buffer) => {
      this.breathingAudio!.setBuffer(buffer);
      this.breathingAudio!.setLoop(true);
      this.breathingAudio!.setVolume(0.5);
    });

    audioLoader.load("/music/sfx/sfx_fluorescent-light.wav", (buffer) => {
      this.spawnFluorescentLights(spawns, buffer);
    });

    this.bindAudioResume();
  }

  private spawnFluorescentLights(spawns: LevelSpawns, buffer: AudioBuffer) {
    const wp = new THREE.Vector3();
    for (const lightInfo of spawns.lights) {
      if (lightInfo.lightType !== "fluorescent") continue;

      const positionalAudio = new THREE.PositionalAudio(this.audioListener!);
      positionalAudio.setBuffer(buffer);
      positionalAudio.setRefDistance(2);
      positionalAudio.setMaxDistance(3);
      positionalAudio.setLoop(false);
      positionalAudio.setVolume(0.05);

      lightInfo.node.getWorldPosition(wp);
      positionalAudio.position.copy(wp);
      this.scene.add(positionalAudio);
      this.pendingAudios.push(positionalAudio);

      // Loop manual con pausa de 2s
      const playWithGap = () => {
        if (!positionalAudio.buffer) return;
        positionalAudio.play();
        if (positionalAudio.source) {
          positionalAudio.source.onended = () => {
            positionalAudio.isPlaying = false;
            setTimeout(playWithGap, 2000);
          };
        }
      };
      (positionalAudio as any)._playWithGap = playWithGap;
    }
  }

  private bindAudioResume() {
    const resumeOnce = () => {
      if (this.audioResumed) return;
      this.audioResumed = true;
      const ctx = this.audioListener!.context;
      if (ctx.state === "suspended") ctx.resume();
      for (const audio of this.pendingAudios) {
        if (audio.buffer && !audio.isPlaying) {
          const playFn = (audio as any)._playWithGap;
          if (playFn) playFn();
          else audio.play();
        }
      }
      if (this.ambienceAudio?.buffer && !this.ambienceAudio.isPlaying) {
        this.ambienceAudio.play();
      }
      document.removeEventListener("click", resumeOnce);
      document.removeEventListener("keydown", resumeOnce);
    };
    document.addEventListener("click", resumeOnce);
    document.addEventListener("keydown", resumeOnce);
  }

  private playDoorSound(door: InteractiveDoor) {
    if (!this.doorOpenBuffer || !this.audioListener) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(this.doorOpenBuffer);
    sound.setRefDistance(3);
    sound.setMaxDistance(12);
    sound.setVolume(0.05);
    sound.setLoop(false);

    const wp = new THREE.Vector3();
    door.root.getWorldPosition(wp);
    sound.position.copy(wp);
    this.scene.add(sound);
    sound.play();
    sound.onEnded = () => this.scene.remove(sound);
  }

  private updateFootsteps() {
    if (!this.footstepsAudio || !this.footstepsAudio.buffer) return;

    const axes = this.controls.getAxes();
    const isWalking =
      this.controls.isLocked && (axes.forward !== 0 || axes.strafe !== 0);

    if (isWalking && !this.footstepsPlaying) {
      this.footstepsPlaying = true;
      if (!this.footstepsAudio.isPlaying) this.footstepsAudio.play();
    } else if (!isWalking && this.footstepsPlaying) {
      this.footstepsPlaying = false;
      if (this.footstepsAudio.isPlaying) this.footstepsAudio.stop();
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

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

    // Toggle linterna
    if (this.input.justPressed("KeyF")) {
      this.flashlight.toggle();
    }

    this.updateInteractPrompt();

    if (this.input.justPressed("KeyE")) {
      this.handleInteract();
    }

    for (const door of this.doors) door.update(dt);

    this.flashlight.update(dt);
    this.updateFootsteps();
    this.updateBatteryUI();

    // Hit grace cooldown
    if (this.hitGraceTimer > 0) this.hitGraceTimer -= dt;

    const caught = this.enemySystem.updateAdvanced({
      dt,
      camera: this.camera,
      playerPos: this.player.position,
      flashlightOn: this.flashlight.isOn,
      playerRunning: this.controls.getSpeedMultiplier() > 1,
      objectivesCollected: this.inventory.objectives,
      objectivesTotal: this.inventory.objectivesTotal,
      occluderMeshes: this.levelMeshes,
    });

    if (caught && this.hitGraceTimer <= 0) this.applyEnemyHit();

    this.debugger.update(this.player.position, this.camera, {
      flashlightOn: this.flashlight.isOn,
      flashlightBattery: this.flashlight.battery,
      enemyPos: this.enemy.position,
      enemyState: this.enemySystem.behaviorState,
      enemyFrozen: this.enemySystem.lastFrozen,
      enemyInFrustum: this.enemySystem.lastInFrustum,
      enemyHasLOS: this.enemySystem.lastHasLOS,
    });

    this.input.endFrame();
  }

  private updatePlayer(dt: number) {
    const axes = this.controls.getAxes();
    const speed =
      GAME.PLAYER.BASE_SPEED *
      this.controls.getSpeedMultiplier() *
      (1 - this.playerSpeedPenalty);

    const steps = GAME.PLAYER.SUBSTEPS;
    const stepDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      this.prevPos.copy(this.player.position);
      this.player.update(stepDt, axes, speed);
      this.collision.resolvePlayer(this.player.position, this.prevPos);
    }
  }

  // ── Interacciones ────────────────────────────────────────────────────────

  private updateInteractPrompt() {
    const nearDoor = this.interact.tryInteractDoor(3.5);
    const nearPickup = this.interact.tryPickup(2.0);
    const nearFuseBox = this.isNearFuseBox(2.5);
    const showPrompt = nearDoor !== null || nearPickup !== null || nearFuseBox;

    this.ui.interactPrompt?.classList.toggle("hidden", !showPrompt);

    if (this.ui.interactText) {
      if (nearPickup) {
        this.ui.interactText.textContent = "Recoger";
      } else if (nearFuseBox) {
        this.ui.interactText.textContent = this.puzzleSolved
          ? "Energía OK"
          : "Usar fusible";
      } else if (nearDoor) {
        this.ui.interactText.textContent = nearDoor.isOpen ? "Cerrar" : "Abrir";
      }
    }
  }

  private handleInteract() {
    const picked = this.interact.tryPickup(2.0);
    if (picked) {
      this.consumePickup(picked);
      return;
    }
    if (this.isNearFuseBox(2.5)) {
      this.handleFuseBoxInteraction();
      return;
    }
    const door = this.interact.tryInteractDoor(3.5);
    if (door) this.handleDoorInteraction(door);
  }

  private consumePickup(picked: Pickup) {
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
        if (picked.cfg.keyName === "Fuse") this.hasFuse = true;
        break;
    }
    this.interact.removePickup(picked, this.scene);
  }

  private handleFuseBoxInteraction() {
    if (this.puzzleSolved) return;
    if (!this.hasFuse) {
      this.showMessage("Hace falta un fusible");
      return;
    }
    this.puzzleSolved = true;
    this.hasFuse = false;
    this.showMessage("Puerta abierta");
  }

  private handleDoorInteraction(door: InteractiveDoor) {
    const isSpecial = door === this.specialDoor;
    const hasKey = !door.requiresKey || this.inventory.hasKey(door.requiresKey);

    if (hasKey && (!isSpecial || this.puzzleSolved)) {
      door.toggle();
      this.playDoorSound(door);
      this.checkZoneTransition(door);
      return;
    }
    if (isSpecial && hasKey && !this.puzzleSolved) {
      this.showMessage("La puerta no tiene energía");
      return;
    }
    this.showLockedMessage(door.requiresKey!);
  }

  // ── Hit handling ─────────────────────────────────────────────────────────

  private triggerHitFlash() {
    if (!this.hitFlashEl) return;
    this.hitFlashEl.classList.remove("active");
    void this.hitFlashEl.offsetWidth; // forzar reflow para reiniciar la animación
    this.hitFlashEl.classList.add("active");
  }

  private applyEnemyHit() {
    this.playerHP--;
    this.hitGraceTimer = GAME.ENEMY.HIT_GRACE_SECONDS;
    this.enemySystem.stun(2);
    this.triggerHitFlash();

    if (this.playerHP <= 0) {
      this.setGameOver();
      return;
    }
    if (this.playerHP === 1) {
      this.playerSpeedPenalty = 0.15;
      if (this.breathingAudio?.buffer && !this.breathingPlaying) {
        this.breathingAudio.play();
        this.breathingPlaying = true;
      }
    } else if (this.playerHP === 2) {
      this.playerSpeedPenalty = 0.1;
    }
  }

  // ── Battery UI ───────────────────────────────────────────────────────────

  private updateBatteryUI() {
    const hasFL = this.flashlight.hasFlashlight;
    if (this.ui.batteryContainer) {
      this.ui.batteryContainer.classList.toggle("hidden", !hasFL);
    }
    if (!hasFL) return;

    const pct = Math.round(this.flashlight.battery * 100);
    if (this.ui.batteryBarFill) {
      this.ui.batteryBarFill.style.width = `${pct}%`;
      this.ui.batteryBarFill.classList.toggle("low", pct <= 30 && pct > 10);
      this.ui.batteryBarFill.classList.toggle("critical", pct <= 10);
    }
    if (this.ui.batteryText) {
      this.ui.batteryText.textContent = `${pct}%`;
    }
  }

  // ── Mensajes UI ──────────────────────────────────────────────────────────

  private showLockedMessage(keyName: string) {
    this.showMessage(`Hace falta ${keyName}`);
  }

  private showMessage(text: string) {
    if (!this.ui.lockedMessage) return;
    this.ui.lockedMessage.textContent = text;
    this.ui.lockedMessage.classList.remove("hidden");
    clearTimeout(this.lockedMsgTimer);
    this.lockedMsgTimer = window.setTimeout(() => {
      this.ui.lockedMessage?.classList.add("hidden");
    }, 2500);
  }

  /** ¿El player está lo bastante cerca del fuse_box para interactuar? */
  private isNearFuseBox(maxDist: number): boolean {
    if (!this.fuseBox) return false;
    const dx = this.player.position.x - this.fuseBoxPos.x;
    const dz = this.player.position.z - this.fuseBoxPos.z;
    return Math.hypot(dx, dz) < maxDist;
  }

  // ── Zone transition ──────────────────────────────────────────────────────

  private checkZoneTransition(door: InteractiveDoor) {
    if (door !== this.specialDoor) return;
    if (!door.isOpen) return; // solo al abrir
    if (!this.isPlayerOnTransitionFloor()) return;
    this.triggerZone2Transition(door);
  }

  private isPlayerOnTransitionFloor(): boolean {
    const ray = new THREE.Raycaster();
    const origin = this.player.position.clone();
    origin.y += 0.1;
    ray.set(origin, new THREE.Vector3(0, -1, 0));
    ray.far = 3.0;

    // BUGFIX rendimiento: limitar el raycast a las meshes ya recolectadas
    // para LOS en vez de recorrer toda la escena.
    const hits = ray.intersectObjects(this.levelMeshes, false);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.name.includes("SM_Safe_Floor_4x4.093")) return true;
        obj = obj.parent;
      }
    }
    return false;
  }

  private async triggerZone2Transition(door: InteractiveDoor) {
    if (this.zone2Loaded) return;
    this.zone2Loaded = true;

    // Cerrar y bloquear permanentemente
    door.toggle();
    door.requiresKey = "__locked_permanent__";

    this.zoneManager.forceLoadZone("ModernApartment");

    if (this.zone1Data) {
      // Quita el mapa, cancela chunks pendientes y libera GPU (texturas incl.)
      this.zone1Data.level.dispose();
      this.collision.removeColliders(this.zone1Data.colliders);
      this.zone1Data = null;

      // Vaciar las meshes de LOS de zone1 — el ZoneManager las repoblará
      // cuando termine de cargar la zona del apartamento.
      this.levelMeshes.length = 0;
    }
  }

  private setGameOver() {
    if (this.state === "GAME_OVER") return;
    this.state = "GAME_OVER";
    this.controls.unlock();
    if (this.breathingAudio?.isPlaying) this.breathingAudio.stop();
    if (this.ambienceAudio?.isPlaying) this.ambienceAudio.stop();
    setGameOverUI(this.ui);
  }

  // ── Resize ───────────────────────────────────────────────────────────────

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
