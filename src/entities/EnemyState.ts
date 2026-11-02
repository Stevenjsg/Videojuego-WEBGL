/** High-level behavior states for any enemy in the game. */
export type EnemyBehaviorState =
  | "IDLE"
  | "PATROL"
  | "CHASE"
  | "SEARCH"
  | "ATTACK";
