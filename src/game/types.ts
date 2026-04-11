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

  // Prompt de interacción (E - Abrir / Cerrar)
  interactPrompt?: HTMLElement;
};

export type GameState = "LOADING" | "PLAYING" | "GAME_OVER";

export type Axes = { forward: number; strafe: number };

export type LevelLoadResult = {
  colliders: THREE.Box3[];
  spawn: THREE.Vector3;
};
