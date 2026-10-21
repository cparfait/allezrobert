/** Lissage optionnel de la puissance : moyenne glissante sur une fenêtre de temps (défaut 3 s). */
export class PowerSmoother {
  readonly windowMs: number;
  private samples: Array<{ t: number; v: number }> = [];

  constructor(windowMs = 3000) {
    this.windowMs = windowMs;
  }

  push(t: number, value: number): number {
    this.samples.push({ t, v: value });
    const from = t - this.windowMs;
    while (this.samples.length > 1 && (this.samples[0]?.t ?? t) <= from) this.samples.shift();
    let sum = 0;
    for (const s of this.samples) sum += s.v;
    return sum / this.samples.length;
  }

  reset(): void {
    this.samples = [];
  }
}
