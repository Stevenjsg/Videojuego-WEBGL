export class Time {
  private last = performance.now();

  update() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    return Math.min(dt, 0.033); // clamp para estabilidad
  }
}
