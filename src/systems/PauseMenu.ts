/**
 * Menú de pausa (ESC): continuar, reiniciar y opciones.
 *
 * Con el ratón capturado el navegador se queda la tecla ESC y suelta la
 * captura sin avisar, así que Game abre este menú al perder la captura
 * durante la partida. Las opciones se guardan en localStorage.
 */

export type GameSettings = {
  /** Multiplicador de la sensibilidad base del ratón. */
  sensitivity: number;
  /** Volumen general 0..1. */
  volume: number;
  /** Render a 240 px de alto (look PS1). */
  retroResolution: boolean;
  /** Balanceo de cámara al caminar (head bob). */
  headBob: boolean;
};

const STORAGE_KEY = "terror-three.settings";

export class PauseMenu {
  readonly settings: GameSettings;
  private open = false;

  private root: HTMLElement;
  private sensitivity: HTMLInputElement;
  private volume: HTMLInputElement;
  private retro: HTMLInputElement;
  private headBob: HTMLInputElement;

  constructor(
    defaults: GameSettings,
    private handlers: {
      onResume: () => void;
      onRestart: () => void;
      onChange: (settings: GameSettings) => void;
    },
  ) {
    this.settings = { ...defaults, ...loadSettings() };

    this.root = byId("pause-menu");
    this.sensitivity = byId<HTMLInputElement>("opt-sensitivity");
    this.volume = byId<HTMLInputElement>("opt-volume");
    this.retro = byId<HTMLInputElement>("opt-retro");
    this.headBob = byId<HTMLInputElement>("opt-headbob");

    this.sensitivity.value = String(this.settings.sensitivity);
    this.volume.value = String(this.settings.volume);
    this.retro.checked = this.settings.retroResolution;
    this.headBob.checked = this.settings.headBob;

    const changed = () => {
      this.settings.sensitivity = Number(this.sensitivity.value);
      this.settings.volume = Number(this.volume.value);
      this.settings.retroResolution = this.retro.checked;
      this.settings.headBob = this.headBob.checked;
      saveSettings(this.settings);
      this.handlers.onChange(this.settings);
    };
    this.sensitivity.addEventListener("input", changed);
    this.volume.addEventListener("input", changed);
    this.retro.addEventListener("change", changed);
    this.headBob.addEventListener("change", changed);

    byId("pause-resume").addEventListener("click", () => this.handlers.onResume());
    byId("pause-restart").addEventListener("click", () => this.handlers.onRestart());
  }

  get isOpen() {
    return this.open;
  }

  show() {
    this.open = true;
    this.root.classList.remove("hidden");
  }

  hide() {
    this.open = false;
    this.root.classList.add("hidden");
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en el HTML`);
  return el as T;
}

function loadSettings(): Partial<GameSettings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSettings(settings: GameSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento (modo privado…): las opciones duran la sesión.
  }
}
