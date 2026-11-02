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
  interactText?: HTMLElement;

  // Battery UI
  batteryContainer?: HTMLElement;
  batteryBarFill?: HTMLElement;
  batteryText?: HTMLElement;

  // Locked door message
  lockedMessage?: HTMLElement;

  // Pantalla "Iniciar partida" (pulsa para empezar)
  startScreen?: HTMLElement;
};

export type GameState = "LOADING" | "READY" | "PLAYING" | "GAME_OVER";

export type Axes = { forward: number; strafe: number };

export type LevelLoadResult = {
  colliders: THREE.Box3[];
  spawn: THREE.Vector3;
};
