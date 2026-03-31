import type { GameUI } from "../game/Game";

/** Gestiona únicamente los elementos HUD estáticos (contadores, hints). */
export class UISystem {
  constructor(private ui: GameUI) {}

  // Reservado para futuros updates de HUD (batería, estado, etc.)
  // El panel de debug (F3) lo gestiona Debugger.
}
