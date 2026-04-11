import * as THREE from "three";
import { Enemy } from "@entities/Enemy";
import { EnemySystem } from "@systems/EnemySystem";
import { CollisionSystem } from "@systems/CollisionSystem";

/** High-level behavior states for any enemy in the game. */
export type EnemyBehaviorState = "IDLE" | "CHASE" | "SEARCH" | "ATTACK";

export type EnemySpawnOptions = {
  /** World position where the enemy is placed. */
  position: THREE.Vector3;
  /** Radius at which the enemy notices the player and starts chasing. */
  detectionRange: number;
  /** Maximum movement speed while chasing. */
  speed: number;
  /** Distance at which the enemy triggers an attack. Defaults to 1.0. */
  attackRange?: number;
  /** Starting health of the enemy. Defaults to 100. */
  health?: number;
  /** GLB model URL. Defaults to the Azure Automaton. */
  url?: string;
  /** Uniform scale applied to the model. Defaults to 1. */
  scale?: number;
};

/**
 * Factory that creates an Enemy entity + its EnemySystem in one call.
 *
 * Example:
 *   const { enemy, system } = spawnEnemy(scene, collision, {
 *     position: new THREE.Vector3(x, y, z),
 *     detectionRange: 6,
 *     speed: 2,
 *   });
 *
 * Call system.update(dt, camera, playerPos) each frame.
 * When system.behaviorState === "ATTACK" the enemy has reached the player.
 */
export function spawnEnemy(
  scene: THREE.Scene,
  collision: CollisionSystem,
  options: EnemySpawnOptions,
): { enemy: Enemy; system: EnemySystem } {
  const enemy = new Enemy(scene, {
    url: options.url ?? "/models/enemy/azure_automaton.glb",
    scale: options.scale ?? 1,
  });

  enemy.position.set(options.position.x, options.position.y, options.position.z);
  enemy.detectionRange = options.detectionRange;
  if (options.health !== undefined) enemy.health = options.health;

  const system = new EnemySystem(enemy, collision, {
    speed: options.speed,
    catchDistance: options.attackRange ?? 1.0,
  });

  return { enemy, system };
}
