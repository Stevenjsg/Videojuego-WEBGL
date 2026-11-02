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
  /** Radio de la cápsula del player para resolver el contacto físico */
  playerRadius?: number;
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

const SAME_FLOOR_DY = 2.5;
const TORSO_OFFSET_Y = 0.9;

export class EnemySystem {
  private speed: number;
  private catchDistance: number;
  private grace: number;
  private playerRadius: number;

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

  // Freeze break timer + flag de "slow walk" tras romper el freeze
  private freezeTimer = 0;
  private slowAfterBreak = false;

  // Post-hit stun: el enemy se queda quieto N segundos tras golpear
  private stunTimer = 0;

  // Last known position + search state
  private lastKnownPos = new THREE.Vector3();
  private hasLastKnownPos = false;
  private searchTimer = 0;

  // Frustum
  private frustum = new THREE.Frustum();
  private projMatrix = new THREE.Matrix4();
  private enemySphere = new THREE.Sphere();

  // LOS raycast (throttled: cada 3 frames)
  private raycaster = new THREE.Raycaster();
  private _camPos = new THREE.Vector3();
  private _toEnemy = new THREE.Vector3();
  private _torsoPos = new THREE.Vector3();
  private losFrame = 0;
  private cachedLOS = false;

  // Movimiento
  private tmpDir = new THREE.Vector3();
  private enemyPrev = new THREE.Vector3();

  // Empuje al hacer contacto con el player (evita que lo atraviese)
  private pushDir = new THREE.Vector3();

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
    this.playerRadius = cfg.playerRadius ?? 0.3;
  }

  /** Congela al enemy durante `seconds` segundos (tras un golpe, etc.) */
  stun(seconds: number) {
    this.stunTimer = seconds;
  }

  // ── Loop principal ───────────────────────────────────────────────────────

  updateAdvanced(input: EnemyAdvancedInput): boolean {
    const { dt, camera, playerPos } = input;

    this.enemy.updateAnimation(dt);

    // Grace inicial (tras spawn)
    if (this.grace > 0) {
      this.grace -= dt;
      this.enemy.setAnimState("idle");
      return false;
    }

    // Stun post-hit
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.enemy.setAnimState("idle");
      this.behaviorState = "IDLE";
      return false;
    }

    // Distancia horizontal y check de "mismo piso"
    const dxP = this.enemy.position.x - playerPos.x;
    const dzP = this.enemy.position.z - playerPos.z;
    const horizDist = Math.hypot(dxP, dzP);
    const sameFloor =
      Math.abs(this.enemy.position.y - playerPos.y) < SAME_FLOOR_DY;

    // Visibilidad y freeze por linterna
    const inFrustum = this.isInFrustum(camera);
    const los = inFrustum ? this.evaluateLOS(camera, input.occluderMeshes) : false;
    this.lastInFrustum = inFrustum;
    this.lastHasLOS = los;

    const freeze = this.updateFreeze(input.flashlightOn && inFrustum && los, dt);
    this.lastFrozen = freeze;

    // Decidir movimiento
    this.enemyPrev.copy(this.enemy.position);
    const activeRange = input.playerRunning
      ? this.detectionRangeRunning
      : this.detectionRange;

    if (freeze) {
      this.enemy.setAnimState("idle");
      this.behaviorState = "IDLE";
    } else if (horizDist <= activeRange && sameFloor) {
      this.lastKnownPos.copy(playerPos);
      this.hasLastKnownPos = true;
      this.searchTimer = this.searchDuration;
      this.moveToward(playerPos, dt, input);
      this.behaviorState = "CHASE";
    } else if (this.hasLastKnownPos && this.searchTimer > 0) {
      this.tickSearch(dt, input);
    } else {
      this.behaviorState = "IDLE";
      this.enemy.setAnimState("idle");
    }

    // Resolver colisión contra geometría del nivel
    this.collision.resolveSphere(
      this.enemy.position,
      this.enemyPrev,
      this.enemy.radius,
    );

    // Ajustar Y al suelo (permite subir escaleras / rampas)
    this.enemy.position.y = this.collision.getFloorAt(
      this.enemy.position.x,
      this.enemy.position.z,
      this.enemy.position.y,
      this.enemy.radius,
    );

    // ── Colisión enemy ↔ player ─────────────────────────────────────────────
    // Empuja al enemy fuera de la cápsula del player y, si llega a tocarlo
    // dentro del rango de captura, devuelve true → caught.
    return this.resolveContactWithPlayer(playerPos, sameFloor);
  }

  // ── Movimiento ───────────────────────────────────────────────────────────

  private moveToward(
    target: THREE.Vector3,
    dt: number,
    input: EnemyAdvancedInput,
    speedMult: number = 1,
  ) {
    let finalSpeed: number;
    if (this.slowAfterBreak) {
      // Tras romper el freeze: walk lento fijo, sin bonus por objetivos
      finalSpeed = 1.5 * speedMult;
    } else {
      finalSpeed = this.speed * speedMult;
      const ratio =
        input.objectivesTotal > 0
          ? input.objectivesCollected / input.objectivesTotal
          : 0;
      finalSpeed *= 1 + 0.5 * ratio;
    }

    this.tmpDir.copy(target).sub(this.enemy.position);
    this.tmpDir.y = 0;

    if (this.tmpDir.lengthSq() <= 1e-4) {
      this.enemy.setAnimState("idle");
      return;
    }

    this.tmpDir.normalize();
    this.enemy.position.addScaledVector(this.tmpDir, finalSpeed * dt);
    this.enemy.root.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);
    this.enemy.setAnimState("walk");
  }

  private tickSearch(dt: number, input: EnemyAdvancedInput) {
    const dSearch = this.enemy.position.distanceTo(this.lastKnownPos);
    if (dSearch > 0.8) {
      this.moveToward(this.lastKnownPos, dt, input, 0.6);
    } else {
      this.enemy.setAnimState("idle");
    }
    this.behaviorState = "SEARCH";
    this.searchTimer -= dt;
    if (this.searchTimer <= 0) this.hasLastKnownPos = false;
  }

  // ── Freeze por linterna ──────────────────────────────────────────────────

  private updateFreeze(wantsFreeze: boolean, dt: number): boolean {
    if (!wantsFreeze) {
      this.freezeTimer = 0;
      return false;
    }
    if (this.freezeTimer === 0) this.slowAfterBreak = false;
    this.freezeTimer += dt;
    const stillFrozen = this.freezeTimer < this.freezeBreakTime;
    if (!stillFrozen) this.slowAfterBreak = true;
    return stillFrozen;
  }

  // ── Visibilidad ──────────────────────────────────────────────────────────

  private isInFrustum(camera: THREE.Camera): boolean {
    // Asegura que las matrices de la cámara están al día. Pasamos `false`
    // porque la cámara no tiene jerarquía relevante por encima.
    camera.updateMatrixWorld(false);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    this.projMatrix.multiplyMatrices(
      (camera as THREE.PerspectiveCamera).projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projMatrix);

    this._torsoPos
      .copy(this.enemy.position)
      .add(_TORSO_OFFSET);
    this.enemySphere.set(this._torsoPos, this.enemy.radius + 1.2);
    return this.frustum.intersectsSphere(this.enemySphere);
  }

  /** Throttled (1/3 frames) line-of-sight evaluation. */
  private evaluateLOS(
    camera: THREE.Camera,
    occluders: THREE.Object3D[] | undefined,
  ): boolean {
    if (this.losFrame++ % 3 === 0) {
      this.cachedLOS = this.hasLineOfSight(camera, occluders ?? []);
    }
    return this.cachedLOS;
  }

  private hasLineOfSight(
    camera: THREE.Camera,
    occluders: THREE.Object3D[],
  ): boolean {
    if (occluders.length === 0) return true;

    camera.getWorldPosition(this._camPos);
    this._torsoPos.copy(this.enemy.position).add(_TORSO_OFFSET);
    this._toEnemy.copy(this._torsoPos).sub(this._camPos);
    const dist = this._toEnemy.length();
    if (dist < 0.1) return true;

    this._toEnemy.multiplyScalar(1 / dist);

    this.raycaster.set(this._camPos, this._toEnemy);
    // Parar antes de tocar el cuerpo del enemy
    this.raycaster.far = Math.max(0.01, dist - (this.enemy.radius * 2 + 0.2));

    return this.raycaster.intersectObjects(occluders, false).length === 0;
  }

  // ── Contacto enemy ↔ player ──────────────────────────────────────────────

  /**
   * Empuja al enemy fuera de la cápsula del player para que NUNCA lo atraviese.
   * Devuelve true si el contacto cae dentro del rango de captura → hit.
   */
  private resolveContactWithPlayer(
    playerPos: THREE.Vector3,
    sameFloor: boolean,
  ): boolean {
    if (!sameFloor) return false;

    const dx = this.enemy.position.x - playerPos.x;
    const dz = this.enemy.position.z - playerPos.z;
    const distSq = dx * dx + dz * dz;

    // Suma de radios efectiva para colisión "blanda"
    const contactRadius = this.enemy.radius + this.playerRadius;
    const contactRadiusSq = contactRadius * contactRadius;

    if (distSq < contactRadiusSq) {
      const dist = Math.sqrt(Math.max(distSq, 1e-6));

      // Empujar al enemy al borde de la cápsula del player
      this.pushDir.set(dx, 0, dz);
      if (dist > 1e-4) this.pushDir.multiplyScalar(1 / dist);
      else this.pushDir.set(1, 0, 0); // fallback determinista si están exactamente alineados

      this.enemy.position.x = playerPos.x + this.pushDir.x * contactRadius;
      this.enemy.position.z = playerPos.z + this.pushDir.z * contactRadius;

      // Orientar hacia el player para feedback visual
      this.enemy.root.rotation.y = Math.atan2(-this.pushDir.x, -this.pushDir.z);

      this.behaviorState = "ATTACK";
      return true;
    }

    // Si no hay contacto físico pero está dentro del catch tradicional → catch
    if (distSq < this.catchDistance * this.catchDistance) {
      this.behaviorState = "ATTACK";
      return true;
    }
    return false;
  }
}

// Vector reutilizado fuera del ciclo de vida de la clase para que sea
// realmente compartido por todas las instancias (suele haber 1).
const _TORSO_OFFSET = new THREE.Vector3(0, TORSO_OFFSET_Y, 0);
