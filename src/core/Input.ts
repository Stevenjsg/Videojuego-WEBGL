export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
  }

  private onDown = (e: KeyboardEvent) => {
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  isDown(code: string) {
    return this.keys.has(code);
  }

  /** True el primer frame que la tecla pasa de up→down. */
  justPressed(code: string) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
  }

  dispose() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
  }
}
