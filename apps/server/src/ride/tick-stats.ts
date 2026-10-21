/** Statistiques glissantes de durée de tick (ms) : moyenne, médiane, p99, max. */
export class TickStats {
  private readonly buf: Float64Array;
  private i = 0;
  private n = 0;
  total = 0;

  constructor(size = 600) {
    this.buf = new Float64Array(size);
  }

  add(ms: number): void {
    this.buf[this.i] = ms;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
    this.total++;
  }

  summary(): { count: number; avgMs: number; p50Ms: number; p99Ms: number; maxMs: number } {
    if (this.n === 0) return { count: 0, avgMs: 0, p50Ms: 0, p99Ms: 0, maxMs: 0 };
    const v = Array.from(this.buf.subarray(0, this.n)).sort((a, b) => a - b);
    const q = (p: number): number => v[Math.min(v.length - 1, Math.floor(p * v.length))]!;
    const r = (x: number): number => Math.round(x * 1000) / 1000;
    return { count: this.total, avgMs: r(v.reduce((s, x) => s + x, 0) / v.length), p50Ms: r(q(0.5)), p99Ms: r(q(0.99)), maxMs: r(v.at(-1)!) };
  }
}
