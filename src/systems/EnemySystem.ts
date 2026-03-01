import * as THREE from "three";
import { Enemy } from "@entities/Enemy";
import { CollisionSystem } from "@systems/CollisionSystem";

export type EnemySystemConfig = {
  speed: number;
  catchDistance: number;
  watchDotThreshold: number;
};

export class EnemySystem {
  private speed: number;
  private catchDistance: number;
  private watchDot: number;
  private grace = 1.0; // 1 segundo de gracia después de ser visto para que el enemigo deje de perseguirte (evita que se quede pegado a la cámara)
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
  }

  update(dt: number, camera: THREE.Camera, playerPos: THREE.Vector3) {
    this.enemy.updateAnimation(dt);

    if (this.grace > 0) {
      this.grace -= dt;
      this.enemy.setAnimState("idle");
      return false;
    }
    // si aún no cargó el modelo, igual dejamos el root movible
    const watched = this.isBeingWatched(camera);

    this.enemyPrev.copy(this.enemy.position);

    if (!watched) {
      this.tmpDir.copy(playerPos).sub(this.enemy.position);
      this.tmpDir.y = 0;

      if (this.tmpDir.lengthSq() > 0.0001) {
        this.tmpDir.normalize();

        const before = this.enemy.position.clone();
        this.enemy.position.addScaledVector(this.tmpDir, this.speed * dt);

        // SOLO rota si realmente se movió (evita giros por frames raros)
        if (this.enemy.position.distanceToSquared(before) > 1e-8) {
          this.enemy.root.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);
        }

        this.enemy.setAnimState("walk");
      } else {
        this.enemy.setAnimState("idle");
      }
    } else {
      this.enemy.setAnimState("idle");
    }

    // Colisión contra paredes/props (si tienes resolveSphere)
    this.collision.resolveSphere(
      this.enemy.position,
      this.enemyPrev,
      this.enemy.radius,
    );

    // “te atrapó”
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
