import "./styles.css";
import { Game } from "./game/Game";

const mount = document.getElementById("game");
if (!mount) throw new Error("No existe #game en el HTML");

const ui = {
  items: document.getElementById("items") as HTMLSpanElement,
  itemsTotal: document.getElementById("itemsTotal") as HTMLSpanElement,
  overlay: document.getElementById("overlay") as HTMLDivElement,
  overlayTitle: document.getElementById("overlay-title") as HTMLDivElement,
  overlayText: document.getElementById("overlay-text") as HTMLDivElement,
  overlayBtn: document.getElementById("overlay-btn") as HTMLButtonElement,
  fade: document.getElementById("fade") as HTMLDivElement,
  interactPrompt: document.getElementById("interact-prompt") ?? undefined,
  interactText: document.getElementById("interact-text") ?? undefined,
  batteryContainer: document.getElementById("battery-container") ?? undefined,
  batteryBarFill: document.getElementById("battery-bar-fill") ?? undefined,
  batteryText: document.getElementById("battery-text") ?? undefined,
  lockedMessage: document.getElementById("locked-message") ?? undefined,
  startScreen: document.getElementById("start-screen") ?? undefined,
};

const game = new Game(mount, ui);
game.start();

// Acceso desde la consola del navegador solo en desarrollo (pnpm dev).
if (import.meta.env.DEV) (window as any).game = game;
