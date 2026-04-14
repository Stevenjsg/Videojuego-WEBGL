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

  // Freeze break timer + flag de "slow walk" tras romper el freeze
  private freezeTimer = 0;
  private slowAfterBreak = false;

  // Post-hit stun: el enemy se queda quieto N segundos tras golpear
  private stunTimer = 0;

  /** Congela al enemy durante `seconds` segundos (tras un golpe, etc.) */
  stun(seconds: number) {
    this.stunTimer = seconds;
  }

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

    // Distancia horizontal (ignora la diferencia de Y intrínseca entre cabeza
    // del player y pies del enemy)
    const dxP = this.enemy.position.x - playerPos.x;
    const dzP = this.enemy.position.z - playerPos.z;
    const d = Math.hypot(dxP, dzP);

    // Diferencia vertical: si el player está en otro piso, ni chase ni catch.
    // Player a y≈1.8 (cabeza), enemy a y≈0.2 (pies) → ~1.6m de base.
    // Un piso típico tiene 2.5m+, así que 2.5 separa bien mismo piso vs otro.
    const dyP = Math.abs(this.enemy.position.y - playerPos.y);
    const sameFloor = dyP < 2.5;

    // Post-hit stun: el enemy se queda quieto
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.enemy.setAnimState("idle");
      this.behaviorState = "IDLE";
      return false;
    }

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
    // Freeze SOLO con la luz de la linterna encendida apuntando al enemy
    const wantsFreeze = input.flashlightOn && inFrustum && los;

    this.lastInFrustum = inFrustum;
    this.lastHasLOS = los;

    // Freeze con break: tras `freezeBreakTime` segundos el enemy rompe el
    // freeze y queda en modo "slow walk" hasta que lo vuelvas a congelar.
    let freeze: boolean;
    if (wantsFreeze) {
      if (this.freezeTimer === 0) {
        // Inicio de un nuevo ciclo de freeze → reset del slow-walk
        this.slowAfterBreak = false;
      }
      this.freezeTimer += dt;
      freeze = this.freezeTimer < this.freezeBreakTime;
      if (!freeze) this.slowAfterBreak = true;
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
    } else if (d <= activeRange && sameFloor) {
      // Player dentro del rango y mismo piso → CHASE
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

    // Ajustar Y al suelo — permite subir escaleras / rampas
    const floorY = this.collision.getFloorAt(
      this.enemy.position.x,
      this.enemy.position.z,
      this.enemy.position.y,
      this.enemy.radius,
    );
    this.enemy.position.y = floorY;

    const cdx = this.enemy.position.x - playerPos.x;
    const cdz = this.enemy.position.z - playerPos.z;
    const caught =
      sameFloor && Math.hypot(cdx, cdz) < this.catchDistance;
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
    let finalSpeed: number;
    if (this.slowAfterBreak) {
      // Tras romper el freeze: walk lento fijo, sin bonuses por objetivos
      finalSpeed = 1.5 * speedMult;
    } else {
      finalSpeed = this.speed * speedMult;
      // Presión por objetivos recogidos
      const ratio =
        input.objectivesTotal > 0
          ? input.objectivesCollected / input.objectivesTotal
          : 0;
      finalSpeed *= 1 + 0.5 * ratio;
    }

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
   * Usa una esfera grande centrada en el torso para ser MUY generoso —
   * así detecta "mirada" aunque el player esté mirando la cabeza o los pies.
   */
  private _torsoPos = new THREE.Vector3();
  private isInFrustum(camera: THREE.Camera): boolean {
    // Actualizar matrices de la cámara — IMPORTANTE: matrixWorldInverse
    // sólo se recalcula dentro del render loop, así que lo forzamos aquí.
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    this.projMatrix.multiplyMatrices(
      (camera as THREE.PerspectiveCamera).projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projMatrix);
    this._torsoPos.copy(this.enemy.position).add(new THREE.Vector3(0, 0.9, 0));
    this.enemySphere.set(this._torsoPos, this.enemy.radius + 1.2);
    return this.frustum.intersectsSphere(this.enemySphere);
  }

  /**
   * Dispara un rayo desde la cámara al torso del enemy.
   * Si algo intercepta ANTES de llegar → LOS bloqueado → false.
   * Si no hay occluders → asume visión directa → true.
   *
   * Apuntamos al torso (no a los pies) para que el rayo vaya casi horizontal
   * y no choque con el suelo o mobiliario cercano al pie del enemy.
   */
  private hasLineOfSight(
    camera: THREE.Camera,
    occluders: THREE.Object3D[],
  ): boolean {
    if (occluders.length === 0) return true;

    camera.getWorldPosition(this._camPos);
    // Torso del enemy: position (pies) + ~0.9m
    this._torsoPos.copy(this.enemy.position).add(new THREE.Vector3(0, 0.9, 0));
    this._toEnemy.copy(this._torsoPos).sub(this._camPos);
    const dist = this._toEnemy.length();
    if (dist < 0.1) return true;

    this._toEnemy.multiplyScalar(1 / dist);

    this.raycaster.set(this._camPos, this._toEnemy);
    // Parar antes de llegar al enemy para no impactar su propio mesh.
    // Usamos radius*2 + margen para cubrir todo el cuerpo del enemy.
    this.raycaster.far = Math.max(0.01, dist - (this.enemy.radius * 2 + 0.2));

    const hits = this.raycaster.intersectObjects(occluders, false);
    return hits.length === 0;
  }
}
