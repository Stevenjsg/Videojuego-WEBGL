import * as THREE from "three";
import { Enemy } from "@entities/Enemy";
import { CollisionSystem } from "@systems/CollisionSystem";
import type { EnemyBehaviorState } from "@entities/EnemyState";

export type EnemySystemConfig = {
  speed: number;
  catchDistance: number;
  graceSeconds?: number;
  /** Segundos máximos de freeze antes de romperlo */
  freezeBreakTime?: number;
  /** Segundos que busca en la última posición conocida */
  searchDuration?: number;
  /** Rango de detección base */
  detectionRange?: number;
  /** Rango de detección cuando el player corre */
  detectionRangeRunning?: number;
};

export type EnemyAdvancedInput = {
  dt: number;
  camera: THREE.Camera;
  playerPos: THREE.Vector3;

  /** Si está apagada el enemy siempre se mueve sin restricciones */
  flashlightOn: boolean;

  /** Si el player está corriendo (Shift) */
  playerRunning: boolean;

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

  // Config
  private freezeBreakTime: number;
  private searchDuration: number;
  private detectionRange: number;
  private detectionRangeRunning: number;

  // Freeze break timer
  private freezeTimer = 0;

  // Last known position + search state
  private lastKnownPos = new THREE.Vector3();
  private hasLastKnownPos = false;
  private searchTimer = 0;

  // Frustum
  private frustum = new THREE.Frustum();
  private projMatrix = new THREE.Matrix4();
  private enemySphere = new THREE.Sphere();

  // LOS raycast (throttled: runs every 3rd frame)
  private raycaster = new THREE.Raycaster();
  private _camPos = new THREE.Vector3();
  private _toEnemy = new THREE.Vector3();
  private losFrame = 0;
  private cachedLOS = false;

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
    this.freezeBreakTime = cfg.freezeBreakTime ?? 1.5;
    this.searchDuration = cfg.searchDuration ?? 4;
    this.detectionRange = cfg.detectionRange ?? 8;
    this.detectionRangeRunning = cfg.detectionRangeRunning ?? 14;
  }

  /** Compat con llamadas antiguas (sin flashlight ni occluders) */
  update(dt: number, camera: THREE.Camera, playerPos: THREE.Vector3) {
    return this.updateAdvanced({
      dt,
      camera,
      playerPos,
      flashlightOn: true,
      playerRunning: false,
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

    // Rango de detección dinámico: más lejos si el player corre
    const activeRange = input.playerRunning
      ? this.detectionRangeRunning
      : this.detectionRange;

    // ── Visibilidad ──────────────────────────────────────────────────────────
    const inFrustum = this.isInFrustum(camera);
    let los: boolean;
    if (inFrustum) {
      if (this.losFrame++ % 3 === 0) {
        this.cachedLOS = this.hasLineOfSight(
          camera,
          input.occluderMeshes ?? [],
        );
      }
      los = this.cachedLOS;
    } else {
      los = false;
    }
    const wantsFreeze = input.flashlightOn && inFrustum && los;

    this.lastInFrustum = inFrustum;
    this.lastHasLOS = los;

    // ── Freeze con break después de freezeBreakTime ──────────────────────────
    let freeze: boolean;
    if (wantsFreeze) {
      this.freezeTimer += dt;
      freeze = this.freezeTimer < this.freezeBreakTime;
    } else {
      this.freezeTimer = 0;
      freeze = false;
    }
    this.lastFrozen = freeze;

    this.enemyPrev.copy(this.enemy.position);

    // ── Decidir target y estado ──────────────────────────────────────────────
    if (freeze) {
      // Congelado por la linterna (aún no rompió el freeze)
      this.enemy.setAnimState("idle");
      this.behaviorState = "IDLE";
    } else if (d <= activeRange) {
      // Player dentro del rango → CHASE, guardar última posición conocida
      this.lastKnownPos.copy(playerPos);
      this.hasLastKnownPos = true;
      this.searchTimer = this.searchDuration;
      this.moveToward(playerPos, d, dt, input);
      this.behaviorState = "CHASE";
    } else if (this.hasLastKnownPos && this.searchTimer > 0) {
      // Player fuera de rango pero tenemos última posición → SEARCH
      const dSearch = this.enemy.position.distanceTo(this.lastKnownPos);
      if (dSearch > 0.8) {
        // Ir hacia la última posición conocida (velocidad reducida)
        this.moveToward(this.lastKnownPos, dSearch, dt, input, 0.6);
        this.behaviorState = "SEARCH";
      } else {
        // Llegó a la posición, esperar mientras busca
        this.enemy.setAnimState("idle");
        this.behaviorState = "SEARCH";
      }
      this.searchTimer -= dt;
      if (this.searchTimer <= 0) {
        this.hasLastKnownPos = false;
      }
    } else {
      // Nada que hacer
      this.behaviorState = "IDLE";
      this.enemy.setAnimState("idle");
    }

    this.collision.resolveSphere(
      this.enemy.position,
      this.enemyPrev,
      this.enemy.radius,
    );

    const caught =
      this.enemy.position.distanceTo(playerPos) < this.catchDistance;
    if (caught) this.behaviorState = "ATTACK";
    return caught;
  }

  // ── Movement helper ────────────────────────────────────────────────────────

  private moveToward(
    target: THREE.Vector3,
    _dist: number,
    dt: number,
    input: EnemyAdvancedInput,
    speedMult: number = 1,
  ) {
    let finalSpeed = this.speed * speedMult;

    // Presión por objetivos recogidos
    const ratio =
      input.objectivesTotal > 0
        ? input.objectivesCollected / input.objectivesTotal
        : 0;
    finalSpeed *= 1 + 0.5 * ratio;

    this.tmpDir.copy(target).sub(this.enemy.position);
    this.tmpDir.y = 0;

    if (this.tmpDir.lengthSq() > 0.0001) {
      this.tmpDir.normalize();
      this.enemy.position.addScaledVector(this.tmpDir, finalSpeed * dt);
      this.enemy.root.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);
      this.enemy.setAnimState("walk");
    } else {
      this.enemy.setAnimState("idle");
    }
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
