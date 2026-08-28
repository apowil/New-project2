import { describe, expect, it } from 'vitest';
import {
  densify,
  falloff,
  liquifySamples,
  medianSpacing,
  polylineWithin,
  relaxSpacing,
  type LiquifyBrush,
} from './liquify.js';
import { type StrokeSample } from './resample.js';
import { distance } from '../math/vec3.js';
import { buildStrokeGeometry } from './geometry.js';

/** A straight run along X, one sample every 0.1 m. */
const line = (count = 21): StrokeSample[] =>
  Array.from({ length: count }, (_, i) => ({
    position: { x: i * 0.1, y: 0, z: 0 },
    pressure: 0.5,
  }));

const spacings = (samples: StrokeSample[]): number[] =>
  samples.slice(1).map((s, i) => distance(samples[i]!.position, s.position));

describe('falloff', () => {
  it('is full at the centre and nothing at the rim', () => {
    expect(falloff(0, 1)).toBe(1);
    expect(falloff(1, 1)).toBe(0);
    expect(falloff(2, 1)).toBe(0);
  });

  it('has no slope at either end, so warped and untouched geometry meet flush', () => {
    // A linear ramp would leave a crease at the rim; smoothstep does not.
    const nearRim = falloff(0.99, 1) - falloff(1, 1);
    const midway = falloff(0.5, 1) - falloff(0.51, 1);
    expect(nearRim).toBeLessThan(midway);

    const nearCentre = falloff(0, 1) - falloff(0.01, 1);
    expect(nearCentre).toBeLessThan(midway);
  });
});

describe('liquifySamples', () => {
  it('reports nothing when the brush reaches nothing', () => {
    const brush: LiquifyBrush = {
      mode: 'push',
      centre: { x: 0, y: 5, z: 0 },
      radius: 0.2,
      strength: 1,
      delta: { x: 0, y: 1, z: 0 },
    };
    expect(liquifySamples(line(), brush)).toBeNull();
  });

  it('pushes the middle of a stroke and leaves the ends exactly where they were', () => {
    const before = line();
    const brush: LiquifyBrush = {
      mode: 'push',
      centre: { x: 1, y: 0, z: 0 },
      radius: 0.35,
      strength: 1,
      delta: { x: 0, y: 0.2, z: 0 },
    };

    const after = liquifySamples(before, brush)!;
    expect(after).not.toBeNull();

    // The sample under the centre takes the whole delta.
    expect(after[10]!.position.y).toBeCloseTo(0.2, 6);
    // Everything outside the radius is untouched, to the bit.
    expect(after[0]!.position).toEqual(before[0]!.position);
    expect(after[20]!.position).toEqual(before[20]!.position);
  });

  it('falls off monotonically from the centre outwards', () => {
    const brush: LiquifyBrush = {
      mode: 'push',
      centre: { x: 1, y: 0, z: 0 },
      radius: 0.5,
      strength: 1,
      delta: { x: 0, y: 1, z: 0 },
    };
    const after = liquifySamples(line(), brush)!;
    for (let i = 10; i < 15; i += 1) {
      expect(after[i]!.position.y).toBeGreaterThanOrEqual(after[i + 1]!.position.y);
    }
  });

  it('keeps pressure out of it — a reshape is not a restyle', () => {
    const before = line();
    const after = liquifySamples(before, {
      mode: 'push',
      centre: { x: 1, y: 0, z: 0 },
      radius: 0.5,
      strength: 1,
      delta: { x: 0, y: 0.3, z: 0 },
    })!;
    expect(after.map((s) => s.pressure)).toEqual(before.map((s) => s.pressure));
  });

  it('pulls samples toward the brush centre without overshooting it', () => {
    const before = line();
    const centre = { x: 1, y: 0.5, z: 0 };
    const after = liquifySamples(before, { mode: 'pull', centre, radius: 1, strength: 1 })!;

    // Strength 1 at the exact centre of the falloff lands on the centre; it
    // must never travel past it, or a pinch would turn inside out.
    for (let i = 0; i < before.length; i += 1) {
      const was = distance(before[i]!.position, centre);
      const now = distance(after[i]!.position, centre);
      expect(now).toBeLessThanOrEqual(was + 1e-9);
    }
  });

  it('twists about the axis, leaving the axis itself alone', () => {
    const before = line();
    const after = liquifySamples(before, {
      mode: 'twist',
      centre: { x: 1, y: 0, z: 0 },
      radius: 0.6,
      strength: 1,
      axis: { x: 0, y: 1, z: 0 },
      angle: Math.PI / 2,
    })!;

    // The sample sitting on the axis has no radius to swing through.
    expect(distance(after[10]!.position, before[10]!.position)).toBeLessThan(1e-9);
    // One 0.1 m away turns a quarter circle about it, into Z.
    expect(after[11]!.position.z).not.toBeCloseTo(0, 3);
  });

  it('smooths a spike down, and keeps doing so the longer it is held', () => {
    const spike = (): StrokeSample[] => {
      const samples = line();
      samples[10]!.position.y = 0.4;
      return samples;
    };

    const hold = (passes: number): StrokeSample[] => {
      let samples = spike();
      for (let pass = 0; pass < passes; pass += 1) {
        samples = liquifySamples(samples, {
          mode: 'smooth',
          centre: { x: 1, y: 0, z: 0 },
          radius: 0.5,
          strength: 0.5,
        })!;
      }
      return samples;
    };

    // Relaxing spreads a spike into its neighbours rather than deleting it, so
    // the peak comes down steadily instead of vanishing in one pass. What
    // matters is that holding the brush keeps making it flatter.
    const brief = hold(4);
    const longer = hold(12);
    expect(brief[10]!.position.y).toBeLessThan(0.4);
    expect(longer[10]!.position.y).toBeLessThan(brief[10]!.position.y);
    expect(hold(60)[10]!.position.y).toBeLessThan(0.05);

    // The ends of a stroke have no pair of neighbours to average, so they are
    // pinned — smoothing can never pull a stroke in from where it was drawn.
    expect(longer[0]!.position).toEqual(spike()[0]!.position);
    expect(longer[20]!.position).toEqual(spike()[20]!.position);
  });
});

describe('relaxSpacing', () => {
  it('leaves an already even stroke alone', () => {
    const before = line();
    const after = relaxSpacing(before, 0.1);
    expect(after).toHaveLength(before.length);
    expect(after[5]!.position.x).toBeCloseTo(before[5]!.position.x, 9);
  });

  it('subdivides a segment a warp stretched', () => {
    const before = line(3);
    before[1]!.position = { x: 0.1, y: 1, z: 0 };

    const after = relaxSpacing(before, 0.1);
    expect(after.length).toBeGreaterThan(before.length);
    // No gap is left far above the target.
    expect(Math.max(...spacings(after))).toBeLessThan(0.1 * 1.6);
  });

  it('collapses a pile of samples a pinch left on top of each other', () => {
    const before = line();
    for (let i = 8; i <= 12; i += 1) before[i]!.position = { x: 1, y: 0, z: 0 };

    const after = relaxSpacing(before, 0.1);

    // Five coincident samples become one. The total count can still rise,
    // because pinching also stretched the two segments either side of the
    // pile, and those get subdivided in the same pass.
    const atPile = after.filter((s) => Math.abs(s.position.x - 1) < 1e-9);
    expect(atPile).toHaveLength(1);
    // Nothing coincident survives to make a degenerate sweep frame.
    expect(Math.min(...spacings(after))).toBeGreaterThan(0);
  });

  it('leaves no zero-length segment even when the endpoint is the crowded one', () => {
    const before = line();
    for (let i = 17; i < 21; i += 1) before[i]!.position = { x: 2, y: 0, z: 0 };

    const after = relaxSpacing(before, 0.1);
    expect(Math.min(...spacings(after))).toBeGreaterThan(0);
  });

  it('always keeps both endpoints, so a stroke never shrinks', () => {
    const before = line();
    for (let i = 17; i < 21; i += 1) before[i]!.position = { x: 2, y: 0, z: 0 };

    const after = relaxSpacing(before, 0.1);
    expect(after[0]!.position).toEqual(before[0]!.position);
    expect(after[after.length - 1]!.position).toEqual(before[before.length - 1]!.position);
  });

  it('refuses to do anything without a target spacing', () => {
    const before = line();
    expect(relaxSpacing(before, 0)).toHaveLength(before.length);
  });
});

describe('medianSpacing', () => {
  it('is the typical gap, not the average — one huge jump does not move it', () => {
    const samples = line();
    samples[20]!.position = { x: 40, y: 0, z: 0 };
    expect(medianSpacing(samples)).toBeCloseTo(0.1, 6);
  });

  it('is zero for a stroke with nothing to measure', () => {
    expect(medianSpacing([])).toBe(0);
    expect(medianSpacing(line(1))).toBe(0);
  });
});

describe('polylineWithin', () => {
  it('finds a brush sitting between two distant samples', () => {
    // The case that matters: a rectangle from the shape tool is four corners,
    // so a brush on the middle of an edge is nowhere near a sample.
    const edge: StrokeSample[] = [
      { position: { x: -2, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 2, y: 0, z: 0 }, pressure: 1 },
    ];
    expect(polylineWithin(edge, { x: 0, y: 0.1, z: 0 }, 0.5)).toBe(true);
  });

  it('does not reach past the end of a stroke', () => {
    const edge: StrokeSample[] = [
      { position: { x: 0, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 1, y: 0, z: 0 }, pressure: 1 },
    ];
    // Half a metre beyond the end, measured along the line it lies on. A
    // distance to the infinite line would call this a hit; it is not one.
    expect(polylineWithin(edge, { x: 1.5, y: 0, z: 0 }, 0.4)).toBe(false);
    expect(polylineWithin(edge, { x: 1.2, y: 0, z: 0 }, 0.4)).toBe(true);
  });

  it('handles a single-sample stroke and an empty one', () => {
    const dot: StrokeSample[] = [{ position: { x: 0, y: 0, z: 0 }, pressure: 1 }];
    expect(polylineWithin(dot, { x: 0.1, y: 0, z: 0 }, 0.5)).toBe(true);
    expect(polylineWithin(dot, { x: 5, y: 0, z: 0 }, 0.5)).toBe(false);
    expect(polylineWithin([], { x: 0, y: 0, z: 0 }, 1)).toBe(false);
  });
});

describe('densify', () => {
  it('returns the very same array when nothing needs splitting', () => {
    const before = line();
    // Identity, not equality: callers use it to skip a mesh rebuild.
    expect(densify(before, 0.2)).toBe(before);
  });

  it('breaks a long straight run down to the gap asked for', () => {
    const straight: StrokeSample[] = [
      { position: { x: 0, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 2, y: 0, z: 0 }, pressure: 1 },
    ];
    // No curvature, so the chord spacing is the true spacing and the target
    // is met exactly.
    expect(Math.max(...spacings([...densify(straight, 0.25)]))).toBeLessThanOrEqual(0.25 + 1e-9);
  });

  it('rounds a corner a little wide, the way the uniform resampler does', () => {
    const corner: StrokeSample[] = [
      { position: { x: 0, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 2, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 2, y: 1, z: 0 }, pressure: 1 },
    ];
    const gaps = spacings([...densify(corner, 0.25)]);
    // Spacing is measured against the chord, so the curve bulging through a
    // right angle overshoots — by a fraction, not by an order.
    expect(Math.max(...gaps)).toBeGreaterThan(0.25);
    expect(Math.max(...gaps)).toBeLessThan(0.25 * 1.5);
  });

  it('never removes a sample, however tightly packed', () => {
    const crowded: StrokeSample[] = [
      { position: { x: 0, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 0.001, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 0.002, y: 0, z: 0 }, pressure: 1 },
    ];
    expect(densify(crowded, 0.5)).toHaveLength(3);
  });

  it('keeps the endpoints exactly, so densifying does not move a stroke', () => {
    const corners: StrokeSample[] = [
      { position: { x: 0, y: 0, z: 0 }, pressure: 0.2 },
      { position: { x: 3, y: 0, z: 0 }, pressure: 0.8 },
    ];
    const after = densify(corners, 0.4);
    expect(after[0]!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(after[after.length - 1]!.position).toEqual({ x: 3, y: 0, z: 0 });
    // Pressure is carried across the new samples rather than left at zero.
    expect(after[1]!.pressure).toBeGreaterThan(0.2);
    expect(after[1]!.pressure).toBeLessThan(0.8);
  });

  it('leaves a stroke it cannot subdivide alone', () => {
    const dot: StrokeSample[] = [{ position: { x: 0, y: 0, z: 0 }, pressure: 1 }];
    expect(densify(dot, 0.1)).toBe(dot);
    expect(densify(line(), 0)).toHaveLength(21);
  });

  it('gives a brush something to grab where before there was nothing', () => {
    // The whole point, end to end: a four-corner rectangle edge, a brush on
    // the middle of it, and a push that has to actually move something.
    const edge: StrokeSample[] = [
      { position: { x: -2, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 2, y: 0, z: 0 }, pressure: 1 },
    ];
    const brush = {
      mode: 'push',
      centre: { x: 0, y: 0, z: 0 },
      radius: 0.5,
      strength: 1,
      delta: { x: 0, y: 0.3, z: 0 },
    } as const;

    expect(liquifySamples(edge, brush)).toBeNull();
    expect(liquifySamples([...densify(edge, 0.175)], brush)).not.toBeNull();
  });
});

describe('a stroke pulled in on itself', () => {
  it('never collapses below the two samples a sweep needs', () => {
    // Pucker taken to its conclusion: the whole stroke sits inside the brush
    // and every sample converges on the centre. Photoshop's does the same, and
    // undo is one keystroke away — but it must not leave geometry that cannot
    // be built.
    let samples: StrokeSample[] = line(9).map((s) => ({
      position: { x: s.position.x * 0.02, y: 0, z: 0 },
      pressure: s.pressure,
    }));

    for (let pass = 0; pass < 40; pass += 1) {
      samples =
        liquifySamples(samples, {
          mode: 'pull',
          centre: { x: 0.008, y: 0, z: 0 },
          radius: 1,
          strength: 0.5,
        }) ?? samples;
    }

    // Repairing the spacing must not leave fewer samples than a sweep needs,
    // whatever it is handed.
    const repaired = relaxSpacing(samples, 0.02);
    expect(repaired.length).toBeGreaterThanOrEqual(2);

    // With no length left there is no surface, and the sweep says so rather
    // than emitting degenerate triangles. The viewport hides such a stroke;
    // the node stays in the document, so undo brings it back.
    expect(buildStrokeGeometry(repaired, { width: 0.01 })).toBeNull();
  });

  it('still sweeps once it has any length at all', () => {
    const nearly: StrokeSample[] = [
      { position: { x: 0, y: 0, z: 0 }, pressure: 1 },
      { position: { x: 1e-4, y: 0, z: 0 }, pressure: 1 },
    ];
    const geometry = buildStrokeGeometry(nearly, { width: 0.01 });
    expect(geometry).not.toBeNull();
    expect([...geometry!.positions].every(Number.isFinite)).toBe(true);
    expect([...geometry!.normals].every(Number.isFinite)).toBe(true);
  });
});
