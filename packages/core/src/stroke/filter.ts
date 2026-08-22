/**
 * Pointer smoothing.
 *
 * Raw pen samples are noisy: a stylus jitters by a pixel or two even when held
 * still, and that jitter turns into visible lumps once a stroke becomes a lit
 * 3D mesh. A plain low-pass filter would fix the jitter but add lag you can
 * feel while drawing fast.
 *
 * The 1€ filter (Casiez, Roussel & Vogel, CHI 2012) solves both: it lowers the
 * cutoff frequency when the pointer is slow (killing jitter while you linger)
 * and raises it when the pointer is fast (killing lag while you sweep).
 */

/** A single-pole low-pass filter — the building block of the 1€ filter. */
class LowPass {
  private value: number | null = null;

  filter(x: number, alpha: number): number {
    this.value = this.value === null ? x : alpha * x + (1 - alpha) * this.value;
    return this.value;
  }

  get last(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

const smoothingFactor = (dt: number, cutoff: number): number => {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
};

export interface OneEuroOptions {
  /** Cutoff (Hz) at zero speed. Lower = steadier hand, more lag. */
  minCutoff?: number;
  /** How aggressively the cutoff opens up with speed. Higher = less lag. */
  beta?: number;
  /** Cutoff (Hz) for the speed estimate itself. */
  derivativeCutoff?: number;
}

export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;

  private readonly xFilter = new LowPass();
  private readonly dxFilter = new LowPass();
  private lastTime: number | null = null;

  constructor(options: OneEuroOptions = {}) {
    this.minCutoff = options.minCutoff ?? 1.2;
    this.beta = options.beta ?? 0.02;
    this.dCutoff = options.derivativeCutoff ?? 1.0;
  }

  filter(x: number, timestamp: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      return this.xFilter.filter(x, 1);
    }

    // Clamp dt: a stalled frame or a duplicated timestamp must not blow up
    // the derivative and slam the cutoff wide open.
    const dt = Math.min(Math.max((timestamp - this.lastTime) / 1000, 1 / 500), 1 / 15);
    this.lastTime = timestamp;

    const previous = this.xFilter.last ?? x;
    const speed = (x - previous) / dt;
    const smoothedSpeed = this.dxFilter.filter(speed, smoothingFactor(dt, this.dCutoff));

    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedSpeed);
    return this.xFilter.filter(x, smoothingFactor(dt, cutoff));
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

/** Convenience wrapper: independent 1€ filters for a screen-space position. */
export class PointerFilter {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;
  private readonly fPressure: OneEuroFilter;

  constructor(options: OneEuroOptions = {}) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
    // Pressure is noisier than position but far less latency-sensitive, so it
    // gets a steadier filter of its own.
    this.fPressure = new OneEuroFilter({ minCutoff: 0.8, beta: 0.005 });
  }

  filter(
    x: number,
    y: number,
    pressure: number,
    timestamp: number,
  ): { x: number; y: number; pressure: number } {
    return {
      x: this.fx.filter(x, timestamp),
      y: this.fy.filter(y, timestamp),
      pressure: this.fPressure.filter(pressure, timestamp),
    };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fPressure.reset();
  }
}
