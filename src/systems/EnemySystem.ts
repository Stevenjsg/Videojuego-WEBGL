import * as THREE from "three";
import { Enemy } from "@entities/Enemy";
import { CollisionSystem } from "@systems/CollisionSystem";
import type { NavMeshSystem } from "@systems/NavMeshSystem";
import type { EnemyBehaviorState } from "@entities/EnemyState";

export type EnemySystemConfig = {
  speed: number;
  catchDistance: number;
  graceSeconds?: number;
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

  /** Foco de la linterna: el enemy se congela si está dentro de su cono. */
  flashlightLight: THREE.SpotLight;

  /** Si el player está corriendo (Shift) */
  playerRunning: boolean;

  /** Escondido sin que el enemy le haya visto: ni lo detecta ni lo atrapa. */
  playerHidden?: boolean;

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

/** Recalcular el camino cada N segundos o si el objetivo se mueve > N m. */
const REPATH_INTERVAL = 0.3;
const REPATH_DISTANCE = 0.75;
/** Distancia (XZ) a la que un waypoint se da por alcanzado. */
const WAYPOINT_RADIUS = 0.25;

/**
 * Radio de colisión con el mundo respecto a `enemy.radius`. Menor que el
 * margen de la navmesh (= enemy.radius) para que, siguiendo el camino, el
 * redondeo de celdas no lo deje rozando una pared y atascado.
 */
const WORLD_COLLISION_SCALE = 0.75;

/** Patrulla: radio de búsqueda de destinos, velocidad y esperas. */
const PATROL_RADIUS = 12;
const PATROL_SPEED_MULT = 0.45;
const PATROL_WAIT_MIN = 2;
const PATROL_WAIT_MAX = 5;
/** Si no llega en este tiempo (puerta cerrada…), elige otro destino. */
const PATROL_GIVE_UP = 15;

export class EnemySystem {
  private speed: number;
  private catchDistance: number;
  private grace: number;
  private playerRadius: number;

  public behaviorState: EnemyBehaviorState = "IDLE";

  /** Estado de visibilidad del último frame — útil para el panel de debug. */
  public lastInBeam = false;
  public lastHasLOS = false;
  public lastFrozen = false;

  // Config
  private searchDuration: number;
  private detectionRange: number;
  private detectionRangeRunning: number;

  // Post-hit stun: el enemy se queda quieto N segundos tras golpear
  private stunTimer = 0;

  // Last known position + search state
  private lastKnownPos = new THREE.Vector3();
  private hasLastKnownPos = false;
  private searchTimer = 0;

  // Cono de la linterna
  private _lightPos = new THREE.Vector3();
  private _lightDir = new THREE.Vector3();

  // LOS raycast (throttled: cada 3 frames)
  private raycaster = new THREE.Raycaster();
  private _camPos = new THREE.Vector3();
  private _toEnemy = new THREE.Vector3();
  private _torsoPos = new THREE.Vector3();
  private losFrame = 0;
  private cachedLOS = false;

  // Navegación (null → línea recta hacia el objetivo)
  private nav: NavMeshSystem | null = null;
  private path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private hasPath = false;
  private pathTarget = new THREE.Vector3();
  private repathTimer = 0;

  // Patrulla (solo con navmesh)
  private patrolTarget = new THREE.Vector3();
  private hasPatrolTarget = false;
  private patrolWait = 0;
  private patrolTime = 0;

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
    this.searchDuration = cfg.searchDuration ?? 4;
    this.detectionRange = cfg.detectionRange ?? 8;
    this.detectionRangeRunning = cfg.detectionRangeRunning ?? 14;
    this.playerRadius = cfg.playerRadius ?? 0.3;
  }

  /** Navmesh de la zona activa; null para moverse en línea recta. */
  setNavMesh(nav: NavMeshSystem | null) {
    this.nav = nav;
    this.hasPath = false;
    this.repathTimer = 0;
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

    // Freeze: congelado mientras esté dentro del haz de la linterna y sin
    // obstáculos entre medias. No hay tiempo límite.
    const inBeam =
      input.flashlightOn && this.isInBeam(input.flashlightLight);
    const los = inBeam ? this.evaluateLOS(camera, input.occluderMeshes) : false;
    this.lastInBeam = inBeam;
    this.lastHasLOS = los;

    const freeze = inBeam && los;
    this.lastFrozen = freeze;

    // Decidir movimiento
    this.enemyPrev.copy(this.enemy.position);
    const activeRange = input.playerRunning
      ? this.detectionRangeRunning
      : this.detectionRange;

    if (freeze) {
      this.enemy.setAnimState("idle");
      this.behaviorState = "IDLE";
    } else if (!input.playerHidden && horizDist <= activeRange && sameFloor) {
      this.lastKnownPos.copy(playerPos);
      this.hasLastKnownPos = true;
      this.searchTimer = this.searchDuration;
      this.moveToward(playerPos, dt, input);
      this.behaviorState = "CHASE";
    } else if (this.hasLastKnownPos && this.searchTimer > 0) {
      this.tickSearch(dt, input);
    } else {
      this.tickPatrol(dt, input);
    }

    // Resolver colisión contra geometría del nivel
    this.collision.resolveSphere(
      this.enemy.position,
      this.enemyPrev,
      this.enemy.radius * WORLD_COLLISION_SCALE,
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
    if (input.playerHidden) return false;
    return this.resolveContactWithPlayer(playerPos, sameFloor);
  }

  // ── Movimiento ───────────────────────────────────────────────────────────

  private moveToward(
    target: THREE.Vector3,
    dt: number,
    input: EnemyAdvancedInput,
    speedMult: number = 1,
  ) {
    let finalSpeed = this.speed * speedMult;
    const ratio =
      input.objectivesTotal > 0
        ? input.objectivesCollected / input.objectivesTotal
        : 0;
    finalSpeed *= 1 + 0.5 * ratio;

    this.tmpDir.copy(this.nextWaypoint(target, dt)).sub(this.enemy.position);
    this.tmpDir.y = 0;

    if (this.tmpDir.lengthSq() <= 1e-4) {
      this.enemy.setAnimState("idle");
      return;
    }

    this.tmpDir.normalize();
    this.enemy.position.addScaledVector(this.tmpDir, finalSpeed * dt);
    this.enemy.root.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);
    this.enemy.setMoveSpeed(finalSpeed);
  }

  /** Siguiente punto hacia el que caminar siguiendo la navmesh. */
  private nextWaypoint(target: THREE.Vector3, dt: number): THREE.Vector3 {
    if (!this.nav) return target;

    this.repathTimer -= dt;
    if (
      this.repathTimer <= 0 ||
      this.pathTarget.distanceToSquared(target) >
        REPATH_DISTANCE * REPATH_DISTANCE
    ) {
      this.repathTimer = REPATH_INTERVAL;
      this.pathTarget.copy(target);
      this.hasPath = this.nav.findPath(this.enemy.position, target, this.path);
      this.pathIndex = 1; // path[0] es la posición actual
    }
    if (!this.hasPath || this.path.length < 2) return target;

    const last = this.path.length - 1;
    while (this.pathIndex < last) {
      const wp = this.path[this.pathIndex];
      const dx = wp.x - this.enemy.position.x;
      const dz = wp.z - this.enemy.position.z;
      if (dx * dx + dz * dz > WAYPOINT_RADIUS * WAYPOINT_RADIUS) break;
      this.pathIndex++;
    }
    return this.path[Math.min(this.pathIndex, last)];
  }

  /** Sin rastro del jugador: pasea entre puntos aleatorios de la navmesh. */
  private tickPatrol(dt: number, input: EnemyAdvancedInput) {
    if (!this.nav || this.patrolWait > 0) {
      this.patrolWait = Math.max(0, this.patrolWait - dt);
      this.behaviorState = "IDLE";
      this.enemy.setAnimState("idle");
      return;
    }

    if (!this.hasPatrolTarget) {
      this.hasPatrolTarget = this.nav.randomPoint(
        this.enemy.position,
        PATROL_RADIUS,
        this.patrolTarget,
      );
      this.patrolTime = 0;
      if (!this.hasPatrolTarget) {
        this.patrolWait = 1;
        return;
      }
    }

    this.patrolTime += dt;
    const dx = this.patrolTarget.x - this.enemy.position.x;
    const dz = this.patrolTarget.z - this.enemy.position.z;
    if (dx * dx + dz * dz < 0.5 * 0.5 || this.patrolTime > PATROL_GIVE_UP) {
      this.hasPatrolTarget = false;
      this.patrolWait =
        PATROL_WAIT_MIN + Math.random() * (PATROL_WAIT_MAX - PATROL_WAIT_MIN);
      this.behaviorState = "IDLE";
      this.enemy.setAnimState("idle");
      return;
    }

    this.moveToward(this.patrolTarget, dt, input, PATROL_SPEED_MULT);
    this.behaviorState = "PATROL";
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

  // ── Visibilidad ──────────────────────────────────────────────────────────

  /** ¿Está el torso del enemy dentro del cono y alcance de la linterna? */
  private isInBeam(light: THREE.SpotLight): boolean {
    light.getWorldPosition(this._lightPos);
    light.target.getWorldPosition(this._lightDir);
    this._lightDir.sub(this._lightPos).normalize();

    this._torsoPos.copy(this.enemy.position).add(_TORSO_OFFSET);
    this._toEnemy.copy(this._torsoPos).sub(this._lightPos);
    const dist = this._toEnemy.length();
    if (dist < 0.1) return true;
    if (light.distance > 0 && dist > light.distance + this.enemy.radius) {
      return false;
    }

    // El cono se "engorda" con el radio del enemy: basta con rozarlo.
    const angularRadius = Math.atan(this.enemy.radius / dist);
    return this._toEnemy.angleTo(this._lightDir) <= light.angle + angularRadius;
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
