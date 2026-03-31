import * as THREE from "three";
import { Enemy } from "@entities/Enemy";
import { CollisionSystem } from "@systems/CollisionSystem";
import type { EnemyBehaviorState } from "@entities/EnemyState";

export type EnemySystemConfig = {
  speed: number;
  catchDistance: number;
  graceSeconds?: number;
};

export type EnemyAdvancedInput = {
  dt: number;
  camera: THREE.Camera;
  playerPos: THREE.Vector3;

  /** Si está apagada el enemy siempre se mueve sin restricciones */
  flashlightOn: boolean;

  objectivesCollected: number;
  objectivesTotal: number;

  /**
   * Meshes del nivel usados para el raycast de línea de visión.
   * Si el rayo choca antes de llegar al enemy → obstáculo → enemy se mueve.
   */
  occluderMeshes?: THREE.Object3D[];
};

export class EnemySystem {
  private speed: number;
  private catchDistance: number;
  private grace: number;

  public behaviorState: EnemyBehaviorState = "IDLE";

  /** Estado de visibilidad del último frame — útil para el panel de debug. */
  public lastInFrustum = false;
  public lastHasLOS = false;
  public lastFrozen = false;

  // Frustum
  private frustum = new THREE.Frustum();
  private projMatrix = new THREE.Matrix4();
  private enemySphere = new THREE.Sphere();

  // LOS raycast
  private raycaster = new THREE.Raycaster();
  private _camPos = new THREE.Vector3();
  private _toEnemy = new THREE.Vector3();

  // Movement
  private tmpDir = new THREE.Vector3();
  private enemyPrev = new THREE.Vector3();

  constructor(
    private enemy: Enemy,
    private collision: CollisionSystem,
    cfg: EnemySystemConfig,
  ) {
    this.speed = cfg.speed;
    this.catchDistance = cfg.catchDistance;
    this.grace = cfg.graceSeconds ?? 0;
  }

  /** Compat con llamadas antiguas (sin flashlight ni occluders) */
  update(dt: number, camera: THREE.Camera, playerPos: THREE.Vector3) {
    return this.updateAdvanced({
      dt,
      camera,
      playerPos,
      flashlightOn: true,
      objectivesCollected: 0,
      objectivesTotal: 0,
    });
  }

  updateAdvanced(input: EnemyAdvancedInput): boolean {
    const { dt, camera, playerPos } = input;

    this.enemy.updateAnimation(dt);

    if (this.grace > 0) {
      this.grace -= dt;
      this.enemy.setAnimState("idle");
      return false;
    }

    const d = this.enemy.position.distanceTo(playerPos);

    if (d > this.enemy.detectionRange) {
      this.behaviorState = "IDLE";
      this.enemy.setAnimState("idle");
      return false;
    }

    // ── Visibilidad ──────────────────────────────────────────────────────────
    // El enemy sólo se congela si:
    //   1. La linterna está ENCENDIDA
    //   2. El enemy está dentro del frustum de la cámara
    //   3. No hay ningún obstáculo entre la cámara y el enemy (LOS)
    const inFrustum = this.isInFrustum(camera);
    const los = inFrustum
      ? this.hasLineOfSight(camera, input.occluderMeshes ?? [])
      : false;
    const freeze = input.flashlightOn && inFrustum && los;

    this.lastInFrustum = inFrustum;
    this.lastHasLOS = los;
    this.lastFrozen = freeze;

    this.enemyPrev.copy(this.enemy.position);

    if (!freeze) {
      // Velocidad dinámica: lejos → rápido, cerca → lento
      const near = 2.0;
      const far = 10.0;
      const t = THREE.MathUtils.clamp((d - near) / (far - near), 0, 1);
      let finalSpeed = THREE.MathUtils.lerp(0.35, this.speed, t);

      // Presión por objetivos recogidos
      const ratio =
        input.objectivesTotal > 0
          ? input.objectivesCollected / input.objectivesTotal
          : 0;
      finalSpeed *= 1 + 0.5 * ratio;

      this.tmpDir.copy(playerPos).sub(this.enemy.position);
      this.tmpDir.y = 0;

      if (this.tmpDir.lengthSq() > 0.0001) {
        this.tmpDir.normalize();
        this.enemy.position.addScaledVector(this.tmpDir, finalSpeed * dt);
        this.enemy.root.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);
        this.enemy.setAnimState("walk");
        this.behaviorState = "CHASE";
      } else {
        this.enemy.setAnimState("idle");
        this.behaviorState = "IDLE";
      }
    } else {
      this.enemy.setAnimState("idle");
      this.behaviorState = "IDLE";
    }

    this.collision.resolveSphere(
      this.enemy.position,
      this.enemyPrev,
      this.enemy.radius,
    );

    const caught = this.enemy.position.distanceTo(playerPos) < this.catchDistance;
    if (caught) this.behaviorState = "ATTACK";
    return caught;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Comprueba si el enemy está dentro del frustum de la cámara.
   * Usa la esfera del enemy (radio + margen) para ser generoso en los bordes.
   */
  private isInFrustum(camera: THREE.Camera): boolean {
    camera.updateWorldMatrix(true, false);
    this.projMatrix.multiplyMatrices(
      (camera as THREE.PerspectiveCamera).projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projMatrix);
    this.enemySphere.set(this.enemy.position, this.enemy.radius + 0.4);
    return this.frustum.intersectsSphere(this.enemySphere);
  }

  /**
   * Dispara un rayo desde la cámara al enemy.
   * Si algo intercepta ANTES de llegar al enemy → LOS bloqueado → false.
   * Si no hay occluders → asume visión directa → true.
   */
  private hasLineOfSight(
    camera: THREE.Camera,
    occluders: THREE.Object3D[],
  ): boolean {
    if (occluders.length === 0) return true;

    camera.getWorldPosition(this._camPos);
    this._toEnemy.copy(this.enemy.position).sub(this._camPos);
    const dist = this._toEnemy.length();
    if (dist < 0.1) return true;

    // Normalizar in-place sin crear nuevo vector
    this._toEnemy.multiplyScalar(1 / dist);

    this.raycaster.set(this._camPos, this._toEnemy);
    // Parar un poco antes del enemy para no impactar su propio mesh
    this.raycaster.far = dist - 0.35;

    const hits = this.raycaster.intersectObjects(occluders, false);
    return hits.length === 0;
  }
}
