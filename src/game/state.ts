import type { GameState, GameUI } from "./types";

export function setGameOverUI(ui: GameUI) {
  ui.overlay.classList.remove("hidden");
  ui.overlayTitle.textContent = "TE ATRAPÓ";
  ui.overlayText.textContent = "No lo pierdas de vista.";
}

export function hideOverlay(ui: GameUI) {
  ui.overlay.classList.add("hidden");
}

export function setState(next: GameState) {
  return next;
}
