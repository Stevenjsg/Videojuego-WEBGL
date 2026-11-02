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
import type { FluorescentLamp } from "@entities/FluorescentLamp";
import { ZoneManager } from "@systems/ZoneManager";
import { NavMeshSystem } from "@systems/NavMeshSystem";
import { installVertexSnapping } from "@systems/PS1Effect";
import { MusicDirector } from "@systems/MusicDirector";
import { PauseMenu, type GameSettings } from "@systems/PauseMenu";
import { downloadWithProgress } from "@core/download";
import { loadGLBFromBlob } from "@core/gltfFromBlob";

import type { PickupType } from "@entities/Pickup";
import type { GameUI, GameState } from "./types";
import { GAME } from "./constants";
import { hideOverlay, setGameOverUI } from "./state";
import { whenAssetsLoaded } from "@/core/assets";

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
  /** Fragmentos de música por zona según la tensión (ver MusicDirector). */
  private music: MusicDirector | null = null;
  /** Límites del apartamento (zona2), cuando está cargado. */
  private apartmentBounds: THREE.Box3 | null = null;

  // Menú de pausa (ESC) y opciones
  private pauseMenu!: PauseMenu;
  private pausedAt = 0;
  /** Render a 240 px (opción del menú; requiere GAME.PS1.ENABLED). */
  private retroResolution: boolean = GAME.PS1.ENABLED;

  private flashlightClick: THREE.Audio | null = null;

  // Lluvia por proximidad en cada ventana (se detectan al cargar los chunks)
  private rainBuffer: AudioBuffer | null = null;
  private rainSpots: { pos: THREE.Vector3; audio: THREE.PositionalAudio | null }[] =
    [];
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
  private fluorescentLamps: FluorescentLamp[] = [];

  // Esconderse bajo las mesas (COL_Mesa*)
  private hideSpots: THREE.Box3[] = [];
  private hiding: {
    spot: THREE.Box3;
    returnPos: THREE.Vector3;
    /** El enemy te vio meterte: te encontrará igualmente. */
    spotted: boolean;
  } | null = null;

  /** Miedo 0..1 según la cercanía del enemy: degrada la imagen (PS1). */
  private fear = 0;

  /** Suelo de la sala segura: al pisarlo se conecta con el apartamento. */
  private safeFloor: THREE.Box3 | null = null;
  private interact!: InteractSystem;
  private zoneManager!: ZoneManager;
  private navMesh: NavMeshSystem | null = null;

  /** Meshes del nivel usados para el raycast de línea de visión del enemy */
  private levelMeshes: THREE.Object3D[] = [];

  // Zone transition
  private specialDoor: InteractiveDoor | null = null;
  private zone2Loaded = false;

  // Locked door message
  private lockedMsgTimer = 0;

  constructor(
    private mount: HTMLElement,
    private ui: GameUI,
  ) {
    this.pauseMenu = new PauseMenu(
      { sensitivity: 1, volume: 1, retroResolution: GAME.PS1.ENABLED },
      {
        onResume: () => this.resume(),
        onRestart: () => location.reload(),
        onChange: (s) => this.applySettings(s),
      },
    );
    this.retroResolution =
      GAME.PS1.ENABLED && this.pauseMenu.settings.retroResolution;

    this.renderer = this.createAndConfigureRenderer();
    const light = GAME.LIGHTING;
    this.scene = createScene({
      skyColor: light.SKY_COLOR,
      groundColor: light.GROUND_COLOR,
      ambientIntensity: light.AMBIENT_INTENSITY,
      fogColor: light.FOG_COLOR,
      fogNear: light.FOG_NEAR,
      fogFar: GAME.VIEW_DISTANCE,
    });
    // Un poco más que la niebla para que nada se recorte antes de ser opaco.
    this.camera = createCamera(this.mount, GAME.VIEW_DISTANCE + 1);

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
    await this.initWorld();
    // El mundo ya se renderiza detrás de la pantalla de inicio, pero sin
    // update(): ni el jugador ni el enemy se mueven hasta pulsar.
    this.state = "READY";
    this.loop();
    await this.waitForStartScreen();
    this.state = "PLAYING";
    this.applySettings(this.pauseMenu.settings);
    this.bindPause();
  }

  // ── Pausa y opciones ─────────────────────────────────────────────────────

  private bindPause() {
    // Con el ratón capturado, ESC lo suelta el navegador: eso abre la pausa
    // (y también cambiar de ventana, que también suelta la captura).
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement !== null;
      if (!locked && this.state === "PLAYING") this.pause();
      // Solo se reanuda al recuperar la captura: sin ella no podrías moverte
      // mientras el enemy sí.
      else if (locked && this.state === "PAUSED") this.unpause();
    });
    // Sin captura, ESC llega como tecla normal.
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Escape") return;
      // El mismo ESC que soltó la captura no debe cerrar el menú al instante.
      if (performance.now() - this.pausedAt < 300) return;
      if (this.state === "PLAYING") this.pause();
      else if (this.state === "PAUSED") this.resume();
    });
  }

  private pause() {
    this.state = "PAUSED";
    this.pausedAt = performance.now();
    this.pauseMenu.show();
    this.audioListener?.context.suspend();
  }

  /** Pide la captura del ratón; la partida sigue en `unpause()` al lograrla. */
  private resume() {
    if (this.state !== "PAUSED") return;
    // Chrome la rechaza ~1 s tras ESC: el menú sigue abierto y basta reintentar.
    this.controls.lock();
  }

  private unpause() {
    this.pauseMenu.hide();
    this.state = "PLAYING";
    this.audioListener?.context.resume();
  }

  private applySettings(s: GameSettings) {
    this.controls?.setSensitivity(GAME.MOUSE_SENSITIVITY * s.sensitivity);
    this.audioListener?.setMasterVolume(s.volume);

    const retro = GAME.PS1.ENABLED && s.retroResolution;
    if (retro !== this.retroResolution) {
      this.retroResolution = retro;
      this.renderer.domElement.style.imageRendering = retro ? "pixelated" : "";
      this.onResize();
    }
  }

  private waitForStartScreen() {
    const screen = this.ui.startScreen;
    if (!screen) return Promise.resolve();
    screen.classList.remove("hidden");
    return new Promise<void>((resolve) => {
      screen.addEventListener(
        "click",
        () => {
          screen.classList.add("hidden");
          // El click es el gesto de usuario que permite capturar el ratón.
          this.controls.lock();
          resolve();
        },
        { once: true },
      );
    });
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
    r.toneMappingExposure = GAME.LIGHTING.EXPOSURE;
    if (GAME.PS1.ENABLED) {
      // Antes de compilar ningún material.
      installVertexSnapping(GAME.PS1.SNAP_GRID);
    }
    // Escalar el canvas de baja resolución sin suavizar.
    if (this.retroResolution) r.domElement.style.imageRendering = "pixelated";
    r.setPixelRatio(this.getPixelRatio());
    return r;
  }

  /** En modo PS1, el ratio que deja el render a GAME.PS1.HEIGHT px de alto. */
  private getPixelRatio() {
    if (this.retroResolution) {
      return GAME.PS1.HEIGHT / Math.max(1, this.mount.clientHeight);
    }
    return Math.min(window.devicePixelRatio, GAME.PIXEL_RATIO_CAP);
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

    /** Cada etapa ocupa un tramo [from, to] de la barra. */
    const stage = (title: string, from: number, to: number) => {
      ld.setTitle(title);
      ld.setProgress(from);
      return (p: number) => ld.setProgress(from + (to - from) * p);
    };

    this.initControls();
    this.initPostFX();
    this.zoneManager = this.createZoneManager(ld);

    this.registerApartmentZone();

    // ── 1. Mapa: core (colliders + spawns), chunks visibles y puertas ──
    let progress = stage("Cargando mapa…", 0, 0.55);
    const zone1 = await loadZone1(this.scene, GAME.LEVEL1_ZONE1.URL, {
      renderer: this.renderer,
      position: GAME.LEVEL1_ZONE1.POS,
      onChunk: (chunk) => {
        setupLevelMeshes(chunk);
        this.collectLOSMeshesFrom(chunk);
        this.collectRainWindows(chunk);
      },
    });
    progress(0.1);
    const zone1Colliders = setupLevelMeshes(zone1.map);

    // BUGFIX: las meshes de LOS deben venir de la zona ACTIVA, no de un
    // apartamento que tarda en cargar. Recolectamos las visibles de zone1.
    this.collectLOSMeshesFrom(zone1.map);
    this.collectHideSpots(zone1.map);
    // GLTFLoader quita los puntos de los nombres: "…4x4.093" → "…4x4093".
    this.safeFloor = findBox(zone1.map, /SM_Safe_Floor_4x4\.?093/);

    // Todo lo que está dentro de la distancia de visión se carga antes de
    // empezar, así no se ve aparecer el mapa. El resto llega en segundo plano.
    const spawn = this.computePlayerSpawn(zone1.spawns);
    const [doorRoot] = await Promise.all([
      downloadWithProgress(
        `/models/assets/puerta_interactiva.glb?v=${Date.now()}`,
      ).then((blob) => loadGLBFromBlob(blob)),
      zone1.level.stream({
        focus: () => this.player?.position ?? spawn,
        gateRadius: GAME.VIEW_DISTANCE,
        onProgress: (p) => progress(0.1 + 0.9 * p),
      }),
    ]);
    const doorColliders = this.spawnDoors(doorRoot, zone1.spawns.doors);

    // Cuando Zona1 termine, precargar el apartamento en la caché HTTP para
    // que la transición sea casi instantánea.
    zone1.level.complete.then(() => ChunkedLevel.prefetch(GAME.LEVEL1.URL));

    // ── 2. HDRI ──
    stage("Cargando iluminación…", 0.55, 0.65);
    await this.initEnvironment();

    // Fuse_Box: guardar referencia y posición
    if (zone1.spawns.fuseBox) {
      this.fuseBox = zone1.spawns.fuseBox;
      this.fuseBox.getWorldPosition(this.fuseBoxPos);
    }

    // Arranca la descarga de enemy, linterna y pickups (loadingManager).
    this.initEntities(zone1.spawns);

    // ── 3. Navmesh (síncrona en WASM: dejar pintar el texto antes) ──
    stage("Generando navegación…", 0.65, 0.7);
    await nextFrame();
    await nextFrame();
    // Desde los mismos colliders que la física (sin puertas: son dinámicas).
    this.navMesh = await this.createNavMesh(zone1Colliders);
    this.enemySystem.setNavMesh(this.navMesh);

    // ── 4. Modelos de personajes y objetos ──
    progress = stage("Cargando personajes y objetos…", 0.7, 1);
    await whenAssetsLoaded(progress);

    const baseColliders = zone1Colliders.concat(doorColliders);
    this.initCollisions(baseColliders);
    this.zoneManager.onCollisionsChanged = () => {
      this.initCollisions(
        baseColliders.concat(this.zoneManager.getAllDynamicColliders()),
      );
    };

    this.initAudio(zone1.spawns);
    this.initSpawn(spawn);
    this.initUI();

    ld.setProgress(1);
    ld.setTitle("Listo");
    await new Promise((r) => setTimeout(r, 200));
    ld.hide();
  }

  private async createNavMesh(colliders: THREE.Box3[]) {
    const t0 = performance.now();
    try {
      const nav = await NavMeshSystem.fromColliders(colliders, {
        radius: GAME.ENEMY.NAV.RADIUS,
        height: GAME.ENEMY.NAV.HEIGHT,
        maxClimb: GAME.ENEMY.NAV.MAX_CLIMB,
      });
      console.log(
        `[NavMesh] ${nav ? "lista" : "no disponible"} en ${Math.round(performance.now() - t0)} ms`,
      );
      return nav;
    } catch (err) {
      console.error("[NavMesh] Error, el enemy irá en línea recta:", err);
      return null;
    }
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
      rotationY: GAME.LEVEL1.ROT_Y,
      // Trigger inalcanzable: la zona solo se fuerza al abrir la puerta
      // especial sobre el suelo de transición.
      triggerBox: new THREE.Box3(
        new THREE.Vector3(9999, 9999, 9999),
        new THREE.Vector3(9999, 9999, 9999),
      ),
      gateRadius: GAME.LEVEL1.GATE_RADIUS,
      // Por cada chunk (core incluido) a medida que llega.
      onChunk: (chunk) => {
        this.collectLOSMeshesFrom(chunk);
        this.collectRainWindows(chunk);
      },
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
      canLock: () =>
        this.state === "PLAYING" &&
        this.ui.overlay.classList.contains("hidden"),
      sensitivity: GAME.MOUSE_SENSITIVITY,
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
      ps1ColorBits: GAME.PS1.ENABLED ? GAME.PS1.COLOR_BITS : undefined,
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
      penumbra: 0.5,
      intensity: 50,
      decay: 1.5,
      distance: GAME.VIEW_DISTANCE,
      spillIntensity: 0.12,
      spillAngle: 1.0,
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

    this.music = new MusicDirector(this.audioListener, {
      manifestUrl: "/music/manifest.json",
      volume: 0.3,
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

    audioLoader.load("/music/sfx/fx_rain-on-windows-interior-a.mp3", (buffer) => {
      this.rainBuffer = buffer;
    });

    this.flashlightClick = new THREE.Audio(this.audioListener);
    audioLoader.load("/music/sfx/fx_flashlight-click.mp3", (buffer) => {
      this.flashlightClick!.setBuffer(buffer);
      this.flashlightClick!.setVolume(0.5);
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

      // El zumbido sale del propio tubo si lo hay.
      const lamp = lightInfo.lamp;
      if (lamp) wp.copy(lamp.center);
      else lightInfo.node.getWorldPosition(wp);
      positionalAudio.position.copy(wp);
      this.scene.add(positionalAudio);
      this.pendingAudios.push(positionalAudio);

      if (lamp) {
        lamp.setSound(buffer, this.audioListener!.context);
        this.fluorescentLamps.push(lamp);
      }

      // Loop manual con pausa de 2s; el parpadeo sigue a cada reproducción.
      const playWithGap = () => {
        if (!positionalAudio.buffer) return;
        positionalAudio.play();
        lamp?.soundStarted();
        if (positionalAudio.source) {
          positionalAudio.source.onended = () => {
            positionalAudio.isPlaying = false;
            lamp?.soundEnded();
            setTimeout(playWithGap, 2000);
          };
        }
      };
      (positionalAudio as any)._playWithGap = playWithGap;
    }
  }

  /**
   * Busca ventanas en un chunk recién cargado:
   * - Zona1: paredes "SM_Wall_Window" → una fuente en el centro de cada una.
   * - Apartamento: un único "Windows_Glass" con todos los cristales → se
   *   agrupan sus vértices en celdas para sacar una fuente por ventana.
   */
  private collectRainWindows(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;

      if (/SM_Wall_Window/i.test(mesh.name)) {
        this.addRainSpot(new THREE.Box3().setFromObject(mesh).getCenter(v));
        return;
      }
      if (!/Windows_Glass/i.test(mesh.name)) return;

      const pos = mesh.geometry.getAttribute("position");
      const cells = new Map<string, { sum: THREE.Vector3; n: number }>();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const key = `${Math.floor(v.x / 2.5)},${Math.floor(v.y / 3)},${Math.floor(v.z / 2.5)}`;
        const cell = cells.get(key) ?? { sum: new THREE.Vector3(), n: 0 };
        cell.sum.add(v);
        cell.n++;
        cells.set(key, cell);
      }
      for (const { sum, n } of cells.values()) {
        this.addRainSpot(sum.divideScalar(n));
      }
    });
  }

  private addRainSpot(p: THREE.Vector3) {
    // Varias piezas de la misma ventana → una sola fuente.
    if (this.rainSpots.some((s) => s.pos.distanceTo(p) < 1.5)) return;
    this.rainSpots.push({ pos: p.clone(), audio: null });
  }

  /** Solo suenan las ventanas cercanas (se encienden/apagan por distancia). */
  private updateRain() {
    if (!this.rainBuffer || !this.audioListener) return;
    if (this.audioListener.context.state !== "running") return;

    const { RANGE, VOLUME } = GAME.RAIN;
    const ear = this.player.position;
    for (const spot of this.rainSpots) {
      const d = spot.pos.distanceTo(ear);
      if (d < RANGE + 0.5 && !spot.audio?.isPlaying) {
        if (!spot.audio) {
          const rain = new THREE.PositionalAudio(this.audioListener);
          rain.setBuffer(this.rainBuffer);
          rain.setLoop(true);
          rain.setVolume(VOLUME);
          // Lineal: silencio total a partir de RANGE.
          rain.setDistanceModel("linear");
          rain.setRefDistance(0.8);
          rain.setMaxDistance(RANGE);
          rain.position.copy(spot.pos);
          this.scene.add(rain);
          spot.audio = rain;
        }
        // Desfase para que dos ventanas cercanas no suenen idénticas.
        spot.audio.offset = Math.random() * this.rainBuffer.duration;
        spot.audio.play();
      } else if (d > RANGE + 1.5 && spot.audio?.isPlaying) {
        spot.audio.stop();
      }
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
      !this.hiding &&
      this.controls.isLocked &&
      (axes.forward !== 0 || axes.strafe !== 0);

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
    this.checkSafeRoomEntered();

    // Streaming chunking update
    this.zoneManager.update(this.player.position);

    // Toggle linterna
    if (this.input.justPressed("KeyF")) {
      const wasOn = this.flashlight.isOn;
      this.flashlight.toggle();
      if (this.flashlight.isOn !== wasOn && this.flashlightClick?.buffer) {
        if (this.flashlightClick.isPlaying) this.flashlightClick.stop();
        this.flashlightClick.play();
      }
    }

    for (const lamp of this.fluorescentLamps) lamp.update();

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
      flashlightLight: this.flashlight.light,
      playerRunning: this.controls.getSpeedMultiplier() > 1,
      playerHidden: this.hiding !== null && !this.hiding.spotted,
      objectivesCollected: this.inventory.objectives,
      objectivesTotal: this.inventory.objectivesTotal,
      occluderMeshes: this.levelMeshes,
    });

    if (caught && this.hitGraceTimer <= 0) this.applyEnemyHit();
    this.updateFear(dt);
    this.music?.setZone(this.currentMusicZone());
    this.music?.update(dt, this.fear);
    this.updateRain();

    this.debugger.update(this.player.position, this.camera, {
      flashlightOn: this.flashlight.isOn,
      flashlightBattery: this.flashlight.battery,
      enemyPos: this.enemy.position,
      enemyState: this.enemySystem.behaviorState,
      enemyFrozen: this.enemySystem.lastFrozen,
      enemyInBeam: this.enemySystem.lastInBeam,
      enemyHasLOS: this.enemySystem.lastHasLOS,
    });

    this.input.endFrame();
  }

  private updatePlayer(dt: number) {
    if (this.hiding) return; // bajo la mesa no se mueve
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
    const hideSpot = this.hiding ? null : this.findHideSpot();
    const showPrompt =
      this.hiding !== null ||
      nearDoor !== null ||
      nearPickup !== null ||
      nearFuseBox ||
      hideSpot !== null;

    this.ui.interactPrompt?.classList.toggle("hidden", !showPrompt);

    if (this.ui.interactText) {
      if (this.hiding) {
        this.ui.interactText.textContent = "Salir";
      } else if (nearPickup) {
        this.ui.interactText.textContent = "Recoger";
      } else if (nearFuseBox) {
        this.ui.interactText.textContent = this.puzzleSolved
          ? "Energía OK"
          : "Usar fusible";
      } else if (nearDoor) {
        this.ui.interactText.textContent = nearDoor.isOpen ? "Cerrar" : "Abrir";
      } else if (hideSpot) {
        this.ui.interactText.textContent = "Esconderse";
      }
    }
  }

  private handleInteract() {
    if (this.hiding) {
      this.stopHiding();
      return;
    }
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
    if (door) {
      this.handleDoorInteraction(door);
      return;
    }
    const spot = this.findHideSpot();
    if (spot) this.startHiding(spot);
  }

  // ── Esconderse ───────────────────────────────────────────────────────────

  /** Mesas con hueco debajo (~1 m de alto; los escritorios bajos no valen). */
  private collectHideSpots(root: THREE.Object3D) {
    root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh || !/^col_mesa/i.test(o.name)) return;
      const box = new THREE.Box3().setFromObject(o);
      if (box.max.y - box.min.y >= 0.9) this.hideSpots.push(box);
    });
  }

  /** Mesa junto a la que está el jugador (mismo piso, a < 0.9 m). */
  private findHideSpot(): THREE.Box3 | null {
    const p = this.player.position;
    const feetY = p.y - GAME.PLAYER.HEIGHT;
    for (const spot of this.hideSpots) {
      if (Math.abs(feetY - spot.min.y) > 0.4) continue;
      const dx = Math.max(spot.min.x - p.x, 0, p.x - spot.max.x);
      const dz = Math.max(spot.min.z - p.z, 0, p.z - spot.max.z);
      if (dx * dx + dz * dz < 0.9 * 0.9) return spot;
    }
    return null;
  }

  private startHiding(spot: THREE.Box3) {
    const dx = this.enemy.position.x - this.player.position.x;
    const dz = this.enemy.position.z - this.player.position.z;
    const state = this.enemySystem.behaviorState;
    const hunting = state === "CHASE" || state === "ATTACK";

    this.hiding = {
      spot,
      returnPos: this.player.position.clone(),
      spotted: hunting && Math.hypot(dx, dz) < 6,
    };
    // Agachado bajo el tablero, en el centro de la mesa.
    const center = spot.getCenter(new THREE.Vector3());
    this.player.position.set(center.x, spot.min.y + 0.5, center.z);
  }

  private stopHiding() {
    if (!this.hiding) return;
    this.player.position.copy(this.hiding.returnPos);
    this.prevPos.copy(this.hiding.returnPos);
    this.hiding = null;
  }

  /** Cada pista solo suena en su zona: dentro del apartamento, zona2. */
  private currentMusicZone() {
    if (this.zone2Loaded && !this.apartmentBounds) {
      this.apartmentBounds = this.zoneManager.getZoneBounds("ModernApartment");
    }
    const b = this.apartmentBounds;
    const p = this.player.position;
    const inApartment =
      b !== null &&
      p.x >= b.min.x && p.x <= b.max.x &&
      p.z >= b.min.z && p.z <= b.max.z &&
      p.y - GAME.PLAYER.HEIGHT < b.max.y;
    return inApartment ? "zona2" : "zona1";
  }

  // ── Miedo ────────────────────────────────────────────────────────────────

  private updateFear(dt: number) {
    const dx = this.enemy.position.x - this.player.position.x;
    const dz = this.enemy.position.z - this.player.position.z;
    const dy =
      this.enemy.position.y - (this.player.position.y - GAME.PLAYER.HEIGHT);
    // Otra planta cuenta como más lejos.
    const dist = Math.hypot(dx, dz, dy * 2);

    const proximity = 1 - THREE.MathUtils.smoothstep(dist, 2.5, 14);
    const state = this.enemySystem.behaviorState;
    const hunting = state === "CHASE" || state === "ATTACK";
    const target = proximity * (hunting ? 1 : 0.45);

    // Sube rápido y baja despacio.
    const rate = target > this.fear ? 3 : 0.6;
    this.fear += (target - this.fear) * (1 - Math.exp(-rate * dt));
    this.postFX.setFear(this.fear, performance.now() / 1000);
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

  /**
   * Al pisar la sala segura (tras la puerta especial) la puerta se cierra y
   * se bloquea a la espalda del jugador, y se carga el apartamento, que está
   * justo detrás de la puerta de salida de esa sala.
   */
  private checkSafeRoomEntered() {
    const floor = this.safeFloor;
    if (this.zone2Loaded || !floor) return;
    const p = this.player.position;
    const feetY = p.y - GAME.PLAYER.HEIGHT;
    // Solo la planta baja: encima está el 2º piso (y = 4.8).
    if (feetY > floor.max.y + 1.5) return;
    if (p.x < floor.min.x || p.x > floor.max.x) return;
    if (p.z < floor.min.z || p.z > floor.max.z) return;
    this.triggerZone2Transition();
  }

  private triggerZone2Transition() {
    this.zone2Loaded = true;

    const door = this.specialDoor;
    if (door) {
      if (door.isOpen) {
        door.toggle();
        this.playDoorSound(door);
      }
      door.requiresKey = "__locked_permanent__";
    }

    // Zona1 NO se descarga: la sala segura y su puerta de salida son parte de
    // ella, y el apartamento está pegado al otro lado. Pesa poco (~5 MB) y la
    // niebla y la puerta bloqueada ocultan el resto.
    this.zoneManager.forceLoadZone("ModernApartment");
  }

  private setGameOver() {
    if (this.state === "GAME_OVER") return;
    this.state = "GAME_OVER";
    this.controls.unlock();
    if (this.breathingAudio?.isPlaying) this.breathingAudio.stop();
    if (this.ambienceAudio?.isPlaying) this.ambienceAudio.stop();
    this.music?.stop();
    setGameOverUI(this.ui);
  }

  // ── Resize ───────────────────────────────────────────────────────────────

  private onResize = () => {
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const ratio = this.getPixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.postFX?.setPixelRatio(ratio);
    this.postFX?.setSize(w, h);
  };
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** Caja en mundo del primer objeto cuyo nombre encaja con `name`. */
function findBox(root: THREE.Object3D, name: RegExp): THREE.Box3 | null {
  let box: THREE.Box3 | null = null;
  root.traverse((o) => {
    if (!box && name.test(o.name)) {
      box = new THREE.Box3().setFromObject(o);
    }
  });
  return box;
}
