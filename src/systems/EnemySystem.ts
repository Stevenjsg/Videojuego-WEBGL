import * as THREE from "three";
import { Enemy } from "@entities/Enemy";
import { CollisionSystem } from "@systems/CollisionSystem";

export type EnemySystemConfig = {
  speed: number;
  catchDistance: number;
  watchDotThreshold: number;

  // nuevo (opcional)
  requireFlashlightToFreeze?: boolean;
  graceSeconds?: number;
};

export type EnemyAdvancedInput = {
  dt: number;
  camera: THREE.Camera;
  playerPos: THREE.Vector3;

  flashlightOn: boolean; // si está apagada, se mueve aunque lo mires
  objectivesCollected: number; // presión
  objectivesTotal: number;

  // opcional para la próxima iteración:
  occluders?: THREE.Box3[]; // para LoS / paredes
};

export class EnemySystem {
  private speed: number;
  private catchDistance: number;
  private watchDot: number;

  private requireFlashlightToFreeze: boolean;
  private grace: number;

  private tmpForward = new THREE.Vector3();
  private tmpToEnemy = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private enemyPrev = new THREE.Vector3();

  constructor(
    private enemy: Enemy,
    private collision: CollisionSystem,
    cfg: EnemySystemConfig,
  ) {
    this.speed = cfg.speed;
    this.catchDistance = cfg.catchDistance;
    this.watchDot = cfg.watchDotThreshold;

    this.requireFlashlightToFreeze = cfg.requireFlashlightToFreeze ?? true;
    this.grace = cfg.graceSeconds ?? 0; // si quieres 1s, pon 1 aquí
  }

  // --- compat: tu llamada actual ---
  update(dt: number, camera: THREE.Camera, playerPos: THREE.Vector3) {
    // por defecto asumimos que la linterna está ON y sin presión de objetivos
    return this.updateAdvanced({
      dt,
      camera,
      playerPos,
      flashlightOn: true,
      objectivesCollected: 0,
      objectivesTotal: 0,
    });
  }

  // --- nuevo: versión robusta ---
  updateAdvanced(input: EnemyAdvancedInput) {
    const { dt, camera, playerPos } = input;

    this.enemy.updateAnimation(dt);

    if (this.grace > 0) {
      this.grace -= dt;
      this.enemy.setAnimState("idle");
      return false;
    }

    // Freeze rule:
    // si requireFlashlightToFreeze y linterna apagada => nunca freeze
    const watched = this.isBeingWatched(camera);
    const freeze = this.requireFlashlightToFreeze
      ? watched && input.flashlightOn
      : watched;

    this.enemyPrev.copy(this.enemy.position);

    if (!freeze) {
      // velocidad dinámica: lejos más rápido, cerca más lento
      const d = this.enemy.position.distanceTo(playerPos);
      const near = 2.0;
      const far = 10.0;
      const t = THREE.MathUtils.clamp((d - near) / (far - near), 0, 1);

      const slowNear = 0.35;
      const fastFar = this.speed;

      let finalSpeed = THREE.MathUtils.lerp(slowNear, fastFar, t);

      // presión por objetivos (cuantos más, más rápido)
      const ratio =
        input.objectivesTotal > 0
          ? input.objectivesCollected / input.objectivesTotal
          : 0;
      const pressure = 1 + 0.5 * ratio; // ajusta a gusto
      finalSpeed *= pressure;

      // movimiento
      this.tmpDir.copy(playerPos).sub(this.enemy.position);
      this.tmpDir.y = 0;

      if (this.tmpDir.lengthSq() > 0.0001) {
        this.tmpDir.normalize();
        this.enemy.position.addScaledVector(this.tmpDir, finalSpeed * dt);

        this.enemy.root.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);
        this.enemy.setAnimState("walk");
      } else {
        this.enemy.setAnimState("idle");
      }
    } else {
      this.enemy.setAnimState("idle");
    }

    this.collision.resolveSphere(
      this.enemy.position,
      this.enemyPrev,
      this.enemy.radius,
    );

    return this.enemy.position.distanceTo(playerPos) < this.catchDistance;
  }

  private isBeingWatched(camera: THREE.Camera) {
    camera.getWorldDirection(this.tmpForward).normalize();
    this.tmpToEnemy
      .copy(this.enemy.position)
      .sub((camera as any).position)
      .normalize();
    return this.tmpForward.dot(this.tmpToEnemy) > this.watchDot;
  }
}
