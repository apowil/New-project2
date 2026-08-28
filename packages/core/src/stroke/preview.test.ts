import { describe, expect, it } from 'vitest';
import { PREVIEW_RING_BUDGET, previewSamples } from './preview.js';
import { buildStrokeGeometry, DEFAULT_STROKE_OPTIONS } from './geometry.js';
import { type StrokeSample } from './resample.js';
import { distance } from '../math/vec3.js';

/** A wandering stroke of `count` samples, roughly evenly spaced. */
const wander = (count: number): StrokeSample[] =>
  Array.from({ length: count }, (_, i) => {
    const t = i / count;
    return {
      position: { x: t * 6, y: Math.sin(t * 20) * 0.6, z: Math.cos(t * 9) * 0.3 },
      pressure: 0.5 + Math.sin(t * 30) * 0.4,
    };
  });

describe('previewSamples', () => {
  it('hands back the very same array when a stroke is already short enough', () => {
    const samples = wander(100);
    // Identity, not equality: an ordinary stroke must pay nothing for this.
    expect(previewSamples(samples, 512)).toBe(samples);
    expect(previewSamples(samples, 100)).toBe(samples);
  });

  it('never exceeds the budget, however long the stroke', () => {
    for (const count of [600, 1000, 4000, 20_000]) {
      expect(previewSamples(wander(count), 512).length).toBeLessThanOrEqual(512);
    }
  });

  it('keeps the newest samples untouched, because that is where the pen is', () => {
    const samples = wander(4000);
    const preview = previewSamples(samples, 512);

    // The last stretch is sample-for-sample identical to the real stroke.
    const tip = Math.floor(512 * 0.25);
    for (let i = 1; i <= tip; i += 1) {
      expect(preview[preview.length - i]).toBe(samples[samples.length - i]);
    }
  });

  it('always keeps the first sample, which the start taper is measured from', () => {
    const samples = wander(4000);
    expect(previewSamples(samples, 512)[0]).toBe(samples[0]);
  });

  it('holds the shape it is thinning', () => {
    const samples = wander(4000);
    const preview = previewSamples(samples, 512);

    const length = (list: readonly StrokeSample[]): number => {
      let total = 0;
      for (let i = 1; i < list.length; i += 1) {
        total += distance(list[i - 1]!.position, list[i]!.position);
      }
      return total;
    };

    // Dropping samples cuts corners very slightly; the stroke must not visibly
    // shrink or wander off the path it was drawn along.
    const ratio = length(preview) / length(samples);
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThanOrEqual(1.0001);
  });

  it('still sweeps into a valid surface', () => {
    const preview = previewSamples(wander(4000), 512);
    const geometry = buildStrokeGeometry(preview, { ...DEFAULT_STROKE_OPTIONS, sides: 4 });
    expect(geometry).not.toBeNull();
    expect([...geometry!.positions].every(Number.isFinite)).toBe(true);
  });

  it('makes the cost of a frame independent of how long the stroke is', () => {
    const options = { ...DEFAULT_STROKE_OPTIONS, sides: 4 };
    const sweep = (count: number): number => {
      const preview = previewSamples(wander(count));
      for (let i = 0; i < 5; i += 1) buildStrokeGeometry(preview, options);
      const started = performance.now();
      for (let i = 0; i < 30; i += 1) buildStrokeGeometry(preview, options);
      return (performance.now() - started) / 30;
    };

    const short = sweep(400);
    const long = sweep(8000);

    // Twenty times the stroke, and the frame costs about the same. Without the
    // budget this ratio was the same twenty.
    expect(long).toBeLessThan(short * 3);
  });

  it('has a default budget, for a caller with only one copy to draw', () => {
    expect(previewSamples(wander(10_000)).length).toBeLessThanOrEqual(PREVIEW_RING_BUDGET);
  });

  it('keeps the total flat when the budget is split between symmetry copies', () => {
    // Eight copies of a long stroke must cost about what one uncapped copy of
    // a budget-sized stroke costs, not eight times as much.
    const samples = wander(6000);
    const copies = 8;
    const each = previewSamples(samples, Math.floor(PREVIEW_RING_BUDGET / copies));
    expect(each.length * copies).toBeLessThanOrEqual(PREVIEW_RING_BUDGET + copies);
  });
});
