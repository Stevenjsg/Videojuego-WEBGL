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
};

const game = new Game(mount, ui);
game.start();
