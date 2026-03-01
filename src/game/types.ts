import * as THREE from "three";

export type GameUI = {
  items: HTMLSpanElement;
  itemsTotal: HTMLSpanElement;
  overlay: HTMLDivElement;
  overlayTitle: HTMLDivElement;
  overlayText: HTMLDivElement;
  overlayBtn: HTMLButtonElement;
  fade: HTMLDivElement;

  // Debug panel (opcional)
  debug?: HTMLDivElement;
};

export type GameState = "LOADING" | "PLAYING" | "GAME_OVER";

export type Axes = { forward: number; strafe: number };

export type LevelLoadResult = {
  colliders: THREE.Box3[];
  spawn: THREE.Vector3;
};
