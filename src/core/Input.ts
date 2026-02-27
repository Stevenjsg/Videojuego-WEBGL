export class Input {
  private keys = new Set<string>();

  constructor() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
  }

  private onDown = (e: KeyboardEvent) => this.keys.add(e.code);
  private onUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  isDown(code: string) {
    return this.keys.has(code);
  }

  dispose() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
  }
}
