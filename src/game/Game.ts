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

/** Maps Zone1 item type names to PickupType + model URL + optional scale. */
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
  private audioListener: THREE.AudioListener | null = null;
  private pendingAudios: THREE.PositionalAudio[] = [];
  private audioResumed = false;

  // Preloaded audio buffers
  private doorOpenBuffer: AudioBuffer | null = null;
  private footstepsAudio: THREE.Audio | null = null;
  private footstepsPlaying = false;

  // Ambient + breathing audio
  private ambienceAudio: THREE.Audio | null = null;
  private breathingAudio: THREE.Audio | null = null;
  private breathingPlaying = false;

  // Hit / HP system
  private playerHP: number = GAME.PLAYER.HP;
  private hitGraceTimer: number = 0;
  private playerSpeedPenalty: number = 0; // 0.0 – 1.0 (fraction of speed lost)

  // Overlay DOM para el flash rojo en cada hit
  private hitFlashEl: HTMLDivElement | null = null;

  // Puzzle del fusible: necesario para abrir la puerta especial
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

    // Crear overlay de flash rojo
    this.hitFlashEl = document.createElement("div");
    this.hitFlashEl.className = "hit-flash";
    this.mount.appendChild(this.hitFlashEl);
  }

  private triggerHitFlash() {
    if (!this.hitFlashEl) return;
    this.hitFlashEl.classList.remove("active");
    void this.hitFlashEl.offsetWidth; // forzar reflow para reiniciar la animación
    this.hitFlashEl.classList.add("active");
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
      (msg) => setStage(msg),
    );

    // ── 1) Registrar Zonas Dinámicas (Apartment) ──
    const lp = GAME.LEVEL1.POS;
    this.zoneManager.addZone({
      id: "ModernApartment",
      url: GAME.LEVEL1.URL,
      position: new THREE.Vector3(lp.x, lp.y, lp.z),
      // Unreachable trigger — Zone2 only loads via forceLoadZone when
      // the special door is opened on the transition floor.
      triggerBox: new THREE.Box3(
        new THREE.Vector3(9999, 9999, 9999),
        new THREE.Vector3(9999, 9999, 9999),
      ),
      onLoad: (root) => {
        root.traverse((child) => {
          if ((child as any).isMesh) this.levelMeshes.push(child);
        });
      },
    });

    // ── 2) Zone 1 (Core base spawn level) ──
    setStage("Cargando zona 1…");
    setTitle("Cargando zona 1…");
    const zone1 = await loadZone1(this.scene, GAME.LEVEL1_ZONE1.URL);
    const zp = GAME.LEVEL1_ZONE1.POS;
    zone1.map.position.set(zp.x, zp.y, zp.z);
    zone1.map.updateMatrixWorld(true);
    const zone1Colliders = setupLevelMeshes(zone1.map);
    this.zone1Data = { map: zone1.map, colliders: zone1Colliders };

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

      // Track the special door for zone transition
      if (doorSpawn.requiresKey === "Llave Especial") {
        this.specialDoor = interactiveDoor;
      }
    }

    // ── 3) HDRI ──
    setStage("Cargando iluminación…");
    setTitle("Cargando iluminación…");
    await this.initEnvironment();

    // Fuse_Box: guardar referencia y posición mundial para interacción
    if (zone1.spawns.fuseBox) {
      this.fuseBox = zone1.spawns.fuseBox;
      this.fuseBox.getWorldPosition(this.fuseBoxPos);
    }

    // ── 4) Entities, collisions, UI ──
    this.initEntities(zone1.spawns);

    // Inicializamos colisiones base (solo las de zone1 y doors). El ZoneManager inyectará el Apartment automáticamente.
    const baseColliders = zone1Colliders.concat(doorColliders);
    this.initCollisions(baseColliders);

    // Registrar callback dinámico para recompilarlas si una zona entra/sale
    this.zoneManager.onCollisionsChanged = () => {
      this.initCollisions(
        baseColliders.concat(this.zoneManager.getAllDynamicColliders()),
      );
    };

    // ── 4.5) Audio setup ──
    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);
    const audioLoader = new THREE.AudioLoader();

    // Preload door open SFX
    audioLoader.load("/music/sfx/fx_openDoor.mp3", (buffer) => {
      this.doorOpenBuffer = buffer;
    });

    // Preload footsteps (global audio, not positional)
    this.footstepsAudio = new THREE.Audio(this.audioListener);
    audioLoader.load("/music/sfx/fx_indoor-footsteps.mp3", (buffer) => {
      this.footstepsAudio!.setBuffer(buffer);
      this.footstepsAudio!.setLoop(true);
      this.footstepsAudio!.setVolume(0.35);
    });

    // Ambient night wildlife (global, subtle loop)
    this.ambienceAudio = new THREE.Audio(this.audioListener);
    audioLoader.load(
      "/music/ambience/ambience-night-wildlife-a.mp3",
      (buffer) => {
        this.ambienceAudio!.setBuffer(buffer);
        this.ambienceAudio!.setLoop(true);
        this.ambienceAudio!.setVolume(0.08);
        // Si el resume ya pasó, reproducir ahora
        if (this.audioResumed && !this.ambienceAudio!.isPlaying) {
          this.ambienceAudio!.play();
        }
      },
    );

    // Heavy breathing SFX (preload only — triggered on 2nd hit)
    this.breathingAudio = new THREE.Audio(this.audioListener);
    audioLoader.load("/music/sfx/fx_heavy-breathing.mp3", (buffer) => {
      this.breathingAudio!.setBuffer(buffer);
      this.breathingAudio!.setLoop(true);
      this.breathingAudio!.setVolume(0.5);
    });

    // Fluorescent lights — manual loop with 2s pause between plays
    // We preload the buffer once and share it across all fluorescent audio sources.
    audioLoader.load("/music/sfx/sfx_fluorescent-light.wav", (buffer) => {
      for (const lightInfo of zone1.spawns.lights) {
        if (lightInfo.lightType !== "fluorescent") continue;

        const positionalAudio = new THREE.PositionalAudio(this.audioListener!);
        positionalAudio.setBuffer(buffer);
        positionalAudio.setRefDistance(2);
        positionalAudio.setMaxDistance(3);
        positionalAudio.setLoop(false);
        positionalAudio.setVolume(0.05);

        const wp = new THREE.Vector3();
        lightInfo.node.getWorldPosition(wp);
        positionalAudio.position.copy(wp);
        this.scene.add(positionalAudio);
        this.pendingAudios.push(positionalAudio);

        // Manual loop: replay after 2s gap using the native source.onended
        const playWithGap = () => {
          if (!positionalAudio.buffer) return;
          positionalAudio.play();
          // Three.js creates a new source node each play(), so hook onended after play
          if (positionalAudio.source) {
            positionalAudio.source.onended = () => {
              positionalAudio.isPlaying = false;
              setTimeout(playWithGap, 2000);
            };
          }
        };
        // Store the replay function so resumeOnce can use it
        (positionalAudio as any)._playWithGap = playWithGap;
      }
    });

    // Resume all audio on first user gesture (Chrome autoplay policy)
    const resumeOnce = () => {
      if (this.audioResumed) return;
      this.audioResumed = true;
      const ctx = this.audioListener!.context;
      if (ctx.state === "suspended") ctx.resume();
      for (const audio of this.pendingAudios) {
        if (audio.buffer && !audio.isPlaying) {
          // Use the manual-loop function if available (fluorescent lights)
          const playFn = (audio as any)._playWithGap;
          if (playFn) {
            playFn();
          } else {
            audio.play();
          }
        }
      }
      // Start ambient audio on first gesture
      if (this.ambienceAudio?.buffer && !this.ambienceAudio.isPlaying) {
        this.ambienceAudio.play();
      }
      document.removeEventListener("click", resumeOnce);
      document.removeEventListener("keydown", resumeOnce);
    };
    document.addEventListener("click", resumeOnce);
    document.addEventListener("keydown", resumeOnce);

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
      freezeBreakTime: GAME.ENEMY.FREEZE_BREAK_TIME,
      searchDuration: GAME.ENEMY.SEARCH_DURATION,
      detectionRange: GAME.ENEMY.DETECTION_RANGE,
      detectionRangeRunning: GAME.ENEMY.DETECTION_RANGE_RUNNING,
    });
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
    const nearDoor = this.interact.tryInteractDoor(3.5);
    const nearPickup = this.interact.tryPickup(2.0);
    const nearFuseBox = this.isNearFuseBox(2.5);
    const showPrompt =
      nearDoor !== null || nearPickup !== null || nearFuseBox;
    if (this.ui.interactPrompt) {
      this.ui.interactPrompt.classList.toggle("hidden", !showPrompt);
    }
    // Update interact text based on what we're looking at
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
            if (picked.cfg.keyName === "Fuse") this.hasFuse = true;
            break;
        }
        this.interact.removePickup(picked, this.scene);
      } else if (this.isNearFuseBox(2.5)) {
        // Interacción con el cuadro de fusibles
        if (this.puzzleSolved) {
          // Ya resuelto, no hacer nada
        } else if (!this.hasFuse) {
          this.showMessage("Hace falta un fusible");
        } else {
          this.puzzleSolved = true;
          this.hasFuse = false;
          this.showMessage("Puerta abierta");
        }
      } else {
        const door = this.interact.tryInteractDoor(3.5);
        if (door) {
          const isSpecial = door === this.specialDoor;
          const hasKey =
            !door.requiresKey || this.inventory.hasKey(door.requiresKey);
          if (hasKey && (!isSpecial || this.puzzleSolved)) {
            door.toggle();
            this.playDoorSound(door);
            // Check if this is the special door for zone transition
            this.checkZoneTransition(door);
          } else if (isSpecial && hasKey && !this.puzzleSolved) {
            this.showMessage("La puerta no tiene energía");
          } else {
            this.showLockedMessage(door.requiresKey!);
          }
        }
      }
    }

    // Actualizar puertas
    for (const door of this.doors) {
      door.update(dt);
    }

    this.flashlight.update(dt);

    // Audio: footsteps
    this.updateFootsteps();

    // Battery UI update
    this.updateBatteryUI();

    // Hit grace cooldown
    if (this.hitGraceTimer > 0) this.hitGraceTimer -= dt;

    // Enemy: congela sólo si linterna encendida + frustum + LOS libre
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

    const enemyDist = this.enemy.position.distanceTo(this.player.position);
    if (enemyDist < 2) {
      console.log(
        `[ENEMY] dist=${enemyDist.toFixed(3)} caught=${caught} grace=${this.hitGraceTimer.toFixed(2)} state=${this.enemySystem.behaviorState}`,
      );
    }

    if (caught && this.hitGraceTimer <= 0) {
      this.playerHP--;
      this.hitGraceTimer = GAME.ENEMY.HIT_GRACE_SECONDS;
      // El enemy se queda quieto 2s para dar oportunidad de huir
      this.enemySystem.stun(2);
      // Efecto visual rojo
      this.triggerHitFlash();
      console.log(
        `[HIT] HP: ${this.playerHP}/${GAME.PLAYER.HP} | speedPenalty: ${this.playerSpeedPenalty} → ${this.playerHP === 2 ? 0.1 : this.playerHP === 1 ? 0.15 : "DEAD"}`,
      );
      if (this.playerHP <= 0) {
        // 3er golpe → Game Over
        this.setGameOver();
      } else if (this.playerHP === 1) {
        // 2do golpe: -5% extra velocidad (total -15%) + respiración pesada
        this.playerSpeedPenalty = 0.15;
        if (this.breathingAudio?.buffer && !this.breathingPlaying) {
          this.breathingAudio.play();
          this.breathingPlaying = true;
        }
      } else if (this.playerHP === 2) {
        // 1er golpe: -10% velocidad
        this.playerSpeedPenalty = 0.1;
      }
    }

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
  // -------------------- audio helpers --------------------

  private playDoorSound(door: InteractiveDoor) {
    if (!this.doorOpenBuffer || !this.audioListener) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(this.doorOpenBuffer);
    sound.setRefDistance(3);
    sound.setMaxDistance(12);
    sound.setVolume(0.05);
    sound.setLoop(false);
    // Position at the door
    const wp = new THREE.Vector3();
    door.root.getWorldPosition(wp);
    sound.position.copy(wp);
    this.scene.add(sound);
    sound.play();
    // Clean up after playback
    sound.onEnded = () => {
      this.scene.remove(sound);
    };
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

  // -------------------- battery UI --------------------

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

  // -------------------- locked door message --------------------

  private lockedMsgTimer = 0;

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

  // -------------------- zone transition --------------------

  /** Track the special door instance for zone2 transition */
  private specialDoor: InteractiveDoor | null = null;
  private zone1Data: { map: THREE.Group; colliders: THREE.Box3[] } | null =
    null;
  private zone2Loaded = false;

  private checkZoneTransition(door: InteractiveDoor) {
    if (door !== this.specialDoor) return;
    if (!door.isOpen) return; // only trigger on opening

    // Check if player is standing on SM_Safe_Floor_4x4.093
    const onFloor = this.isPlayerOnTransitionFloor();
    if (!onFloor) return;

    this.triggerZone2Transition(door);
  }

  private isPlayerOnTransitionFloor(): boolean {
    // Raycast down from player to check floor name
    const ray = new THREE.Raycaster();
    const origin = this.player.position.clone();
    origin.y += 0.1;
    ray.set(origin, new THREE.Vector3(0, -1, 0));
    ray.far = 3.0;

    const hits = ray.intersectObjects(this.scene.children, true);
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

    // Close special door permanently so player can't go back
    door.toggle(); // close it
    door.requiresKey = "__locked_permanent__"; // prevent reopening

    // Load zone 2 via ZoneManager (force-load immediately)
    this.zoneManager.forceLoadZone("ModernApartment");

    // Unload zone1 to free memory
    if (this.zone1Data) {
      this.scene.remove(this.zone1Data.map);
      this.zone1Data.map.traverse((obj: any) => {
        if (obj.isMesh) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m: any) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        }
      });
      // Remove zone1 colliders
      this.collision.removeColliders(this.zone1Data.colliders);
      this.zone1Data = null;
    }
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

  private setGameOver() {
    if (this.state === "GAME_OVER") return;
    this.state = "GAME_OVER";
    this.controls.unlock();
    if (this.breathingAudio?.isPlaying) this.breathingAudio.stop();
    if (this.ambienceAudio?.isPlaying) this.ambienceAudio.stop();
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
