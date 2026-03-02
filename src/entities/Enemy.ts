import { loadingManager } from "@/core/assets";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type EnemyAnimState = "idle" | "walk";

export type EnemyConfig = {
  url: string;
  scale?: number;
};

export class Enemy {
  public root = new THREE.Group();
  public radius = 0.45;

  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<EnemyAnimState, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private state: EnemyAnimState = "idle";

  private loaded = false;

  constructor(
    private scene: THREE.Scene,
    cfg: EnemyConfig,
  ) {
    this.scene.add(this.root);
    this.load(cfg.url, cfg.scale ?? 1);
  }

  get position() {
    return this.root.position;
  }

  get isLoaded() {
    return this.loaded;
  }

  updateAnimation(dt: number) {
    if (this.mixer) this.mixer.update(dt);
  }

  setAnimState(next: EnemyAnimState) {
    if (!this.mixer) return;
    if (this.state === next) return;

    const nextAction = this.actions.get(next);
    const prevAction = this.current;
    if (!nextAction) return;

    if (prevAction && prevAction !== nextAction) prevAction.fadeOut(0.15);

    nextAction
      .reset()
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .fadeIn(0.15)
      .play();

    this.current = nextAction;
    this.state = next;
  }

  private load(url: string, scale: number) {
    const loader = new GLTFLoader(loadingManager);

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

        const clips = gltf.animations ?? [];

        if (clips.length > 0) {
          // IMPORTANT: mixer sobre gltf.scene (rig dentro)
          this.mixer = new THREE.AnimationMixer(gltf.scene);

          const idleClip = clips.find((c) => c.name === "Idle") ?? clips[0];
          const walkClip =
            clips.find((c) => c.name === "Running") ??
            clips.find((c) => c.name === "Walking") ??
            null;

          const idle = this.mixer.clipAction(idleClip);
          idle.reset().enabled = true;
          idle.setEffectiveWeight(1);
          idle.play();
          this.actions.set("idle", idle);

          if (walkClip) {
            const walk = this.mixer.clipAction(walkClip);
            walk.reset().enabled = true;
            walk.setEffectiveWeight(0);
            walk.play();
            this.actions.set("walk", walk);
          }

          this.current = idle;
          this.state = "idle";
          this.mixer.update(0);
        }

        this.loaded = true;
      },
      undefined,
      (err) => console.error("Enemy load error:", err),
    );
  }
}
