import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type EnemyAnimState = "idle" | "walk";

export type EnemyConfig = {
  url: string;
  scale?: number;
  speed?: number;
  catchDistance?: number;
  watchDotThreshold?: number;
};

export class Enemy {
  public root = new THREE.Group();
  public radius = 0.45;

  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<EnemyAnimState, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private state: EnemyAnimState = "idle";

  private speed: number;
  private catchDistance: number;
  private watchDot: number;

  private tmpForward = new THREE.Vector3();
  private tmpToEnemy = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    cfg: EnemyConfig,
  ) {
    this.speed = cfg.speed ?? 1.6;
    this.catchDistance = cfg.catchDistance ?? 1.1;
    this.watchDot = cfg.watchDotThreshold ?? 0.75;

    this.root.position.set(0, 0, -6);
    this.scene.add(this.root);

    this.load(cfg.url, cfg.scale ?? 1);
  }

  get position() {
    return this.root.position;
  }

  update(dt: number, camera: THREE.Camera, playerPos: THREE.Vector3) {
    if (this.mixer) this.mixer.update(dt);

    const watched = this.isBeingWatched(camera);

    if (!watched) {
      // mover hacia jugador
      this.tmpDir.copy(playerPos).sub(this.position);
      this.tmpDir.y = 0;

      if (this.tmpDir.lengthSq() > 0.0001) {
        this.tmpDir.normalize();
        this.position.addScaledVector(this.tmpDir, this.speed * dt);

        // rotación Y
        this.root.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);

        this.setAnimState("walk");
      } else {
        this.setAnimState("idle");
      }
    } else {
      // congelado por la mirada
      this.setAnimState("idle");
    }

    return this.position.distanceTo(playerPos) < this.catchDistance;
  }

  private load(url: string, scale: number) {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(scale);

        model.traverse((child) => {
          if (!(child as any).isMesh) return;
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        });

        // centrar en base
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        model.position.sub(center);
        model.position.y += size.y / 2;

        this.root.add(model);

        // Animations
        const clips = gltf.animations ?? [];
        console.log(
          "Enemy anims:",
          clips.map((c) => c.name),
        );

        if (clips.length > 0) {
          // Mixer sobre el root que contiene el rig
          this.mixer = new THREE.AnimationMixer(gltf.scene);

          const idleClip = clips.find((c) => c.name === "Idle");
          const walkClip = clips.find((c) => c.name === "Walking");
          const runClip = clips.find((c) => c.name === "Running");

          if (!idleClip) {
            console.warn("No Idle clip. Using first clip:", clips[0].name);
          }

          const idleAction = this.mixer.clipAction(idleClip ?? clips[0]);
          idleAction.reset();
          idleAction.enabled = true;
          idleAction.setEffectiveWeight(1);
          idleAction.play();
          this.actions.set("idle", idleAction);

          // Para moverse: usa Running si existe, si no Walking
          const moveClip = runClip ?? walkClip;
          if (moveClip) {
            const moveAction = this.mixer.clipAction(moveClip);
            moveAction.reset();
            moveAction.enabled = true;
            moveAction.setEffectiveWeight(0);
            moveAction.play();
            this.actions.set("walk", moveAction);
          }

          this.current = idleAction;
          this.state = "idle";

          // Forzar un update inmediato para aplicar pose ya
          this.mixer.update(0);
        }
      },
      undefined,
      (err) => console.error("Enemy load error:", err),
    );
  }

  private setAnimState(next: EnemyAnimState) {
    if (!this.mixer) return;
    if (this.state === next) return;

    const nextAction = this.actions.get(next);
    const prevAction = this.current;

    if (!nextAction) return;

    // Evita que dos acciones “peleen” raro
    if (prevAction && prevAction !== nextAction) {
      prevAction.fadeOut(0.15);
    }

    nextAction
      .reset()
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .fadeIn(0.15)
      .play();

    this.current = nextAction;
    this.state = next;
  }

  private isBeingWatched(camera: THREE.Camera) {
    camera.getWorldDirection(this.tmpForward).normalize();
    this.tmpToEnemy
      .copy(this.position)
      .sub((camera as any).position)
      .normalize();
    return this.tmpForward.dot(this.tmpToEnemy) > this.watchDot;
  }
}
