import { describe, expect, it } from 'vitest';
import { buildShapeSamples, shapeDimensions, withDimension, type ShapeParams } from './shapes.js';
import { buildTextPolylines, measureText } from './text.js';
import { glyphFor, hasGlyph } from './font.js';
import { makePlane, toLocal } from '../math/plane.js';
import { distance, vec3 } from '../math/vec3.js';

/** The ground plane, so plane coordinates map to world X and Z. */
const ground = makePlane(vec3(0, 0, 0), vec3(0, 1, 0), vec3(1, 0, 0));

const local = (position: { x: number; y: number; z: number }) => toLocal(ground, position);

describe('rectangle', () => {
  const params: ShapeParams = { kind: 'rectangle', u: 0, v: 0, width: 0.8, height: 0.5 };

  it('closes back on its start', () => {
    const samples = buildShapeSamples(params, ground);
    expect(samples).toHaveLength(5);
    expect(distance(samples[0]!.position, samples[4]!.position)).toBeCloseTo(0, 9);
  });

  it('has the requested dimensions', () => {
    const samples = buildShapeSamples(params, ground);
    const corners = samples.map((sample) => local(sample.position));

    const width = Math.max(...corners.map((c) => c.u)) - Math.min(...corners.map((c) => c.u));
    const height = Math.max(...corners.map((c) => c.v)) - Math.min(...corners.map((c) => c.v));

    expect(width).toBeCloseTo(0.8, 9);
    expect(height).toBeCloseTo(0.5, 9);
  });

  it('rotates about its anchor', () => {
    const rotated = buildShapeSamples({ ...params, rotation: Math.PI / 2 }, ground);
    const corners = rotated.map((sample) => local(sample.position));

    // A quarter turn swaps the extents.
    const width = Math.max(...corners.map((c) => c.u)) - Math.min(...corners.map((c) => c.u));
    expect(width).toBeCloseTo(0.5, 6);
  });

  it('produces nothing when it has no area', () => {
    expect(buildShapeSamples({ ...params, width: 0 }, ground)).toEqual([]);
  });
});

describe('circle', () => {
  it('keeps every point at the radius', () => {
    const samples = buildShapeSamples({ kind: 'circle', u: 0.2, v: -0.1, radius: 0.35 }, ground);
    expect(samples.length).toBeGreaterThan(32);

    for (const sample of samples) {
      const { u, v } = local(sample.position);
      expect(Math.hypot(u - 0.2, v + 0.1)).toBeCloseTo(0.35, 6);
    }
  });

  it('closes', () => {
    const samples = buildShapeSamples({ kind: 'circle', u: 0, v: 0, radius: 0.3 }, ground);
    expect(distance(samples[0]!.position, samples[samples.length - 1]!.position)).toBeCloseTo(0, 6);
  });
});

describe('polygon', () => {
  it('has one point per side plus the closing point', () => {
    const samples = buildShapeSamples(
      { kind: 'polygon', u: 0, v: 0, radius: 0.4, sides: 6 },
      ground,
    );
    expect(samples).toHaveLength(7);
    expect(distance(samples[0]!.position, samples[6]!.position)).toBeCloseTo(0, 6);
  });

  it('refuses fewer than three sides by clamping', () => {
    const samples = buildShapeSamples(
      { kind: 'polygon', u: 0, v: 0, radius: 0.4, sides: 1 },
      ground,
    );
    expect(samples).toHaveLength(4);
  });

  it('spaces its corners evenly', () => {
    const samples = buildShapeSamples(
      { kind: 'polygon', u: 0, v: 0, radius: 0.4, sides: 5 },
      ground,
    );
    const edge = distance(samples[0]!.position, samples[1]!.position);
    for (let i = 1; i < 5; i += 1) {
      expect(distance(samples[i]!.position, samples[i + 1]!.position)).toBeCloseTo(edge, 6);
    }
  });
});

describe('line and polyline', () => {
  it('runs through its points', () => {
    const samples = buildShapeSamples(
      {
        kind: 'polyline',
        u: 0,
        v: 0,
        points: [
          { u: 0, v: 0 },
          { u: 0.5, v: 0 },
          { u: 0.5, v: 0.4 },
        ],
      },
      ground,
    );

    expect(samples).toHaveLength(3);
    expect(local(samples[2]!.position).v).toBeCloseTo(0.4, 9);
  });

  it('closes when asked', () => {
    const samples = buildShapeSamples(
      {
        kind: 'polyline',
        u: 0,
        v: 0,
        closed: true,
        points: [
          { u: 0, v: 0 },
          { u: 0.5, v: 0 },
          { u: 0.5, v: 0.4 },
        ],
      },
      ground,
    );
    expect(samples).toHaveLength(4);
    expect(distance(samples[0]!.position, samples[3]!.position)).toBeCloseTo(0, 9);
  });

  it('needs two points', () => {
    expect(buildShapeSamples({ kind: 'line', u: 0, v: 0, points: [{ u: 0, v: 0 }] }, ground)).toEqual(
      [],
    );
  });
});

describe('spline', () => {
  const points = [
    { u: 0, v: 0 },
    { u: 0.3, v: 0.4 },
    { u: 0.7, v: -0.2 },
    { u: 1, v: 0.1 },
  ];

  it('passes through every control point', () => {
    const samples = buildShapeSamples({ kind: 'spline', u: 0, v: 0, points }, ground);

    for (const point of points) {
      const nearest = Math.min(
        ...samples.map((sample) => {
          const l = local(sample.position);
          return Math.hypot(l.u - point.u, l.v - point.v);
        }),
      );
      expect(nearest).toBeLessThan(1e-6);
    }
  });

  it('is smoother than the polyline through the same points', () => {
    const spline = buildShapeSamples({ kind: 'spline', u: 0, v: 0, points }, ground);
    const polyline = buildShapeSamples({ kind: 'polyline', u: 0, v: 0, points }, ground);

    expect(spline.length).toBeGreaterThan(polyline.length * 4);
  });
});

describe('dimensions', () => {
  it('reports width and height for a rectangle', () => {
    const dims = shapeDimensions({ kind: 'rectangle', u: 0, v: 0, width: 0.8, height: 0.5 });
    expect(dims).toEqual([
      { label: 'Width', value: 0.8 },
      { label: 'Height', value: 0.5 },
    ]);
  });

  it('reports radius and diameter for a circle', () => {
    const dims = shapeDimensions({ kind: 'circle', u: 0, v: 0, radius: 0.25 });
    expect(dims[1]).toEqual({ label: 'Diameter', value: 0.5 });
  });

  it('measures a line end to end', () => {
    const dims = shapeDimensions({
      kind: 'line',
      u: 0,
      v: 0,
      points: [
        { u: 0, v: 0 },
        { u: 0.3, v: 0.4 },
      ],
    });
    expect(dims[0]!.value).toBeCloseTo(0.5, 9);
  });
});

describe('editing a dimension', () => {
  it('sets an exact rectangle width without moving it', () => {
    const params: ShapeParams = { kind: 'rectangle', u: 1, v: 2, width: 0.8, height: 0.5 };
    const edited = withDimension(params, 'Width', 0.25);

    expect(edited.width).toBeCloseTo(0.25, 9);
    expect(edited.height).toBeCloseTo(0.5, 9);
    expect(edited.u).toBe(1);
  });

  it('keeps the direction of a rectangle dragged backwards', () => {
    const params: ShapeParams = { kind: 'rectangle', u: 0, v: 0, width: -0.8, height: 0.5 };
    expect(withDimension(params, 'Width', 0.25).width).toBeCloseTo(-0.25, 9);
  });

  it('sets a diameter by halving it', () => {
    const edited = withDimension({ kind: 'circle', u: 0, v: 0, radius: 0.1 }, 'Diameter', 0.5);
    expect(edited.radius).toBeCloseTo(0.25, 9);
  });

  it('scales a line about its first point', () => {
    const params: ShapeParams = {
      kind: 'line',
      u: 0,
      v: 0,
      points: [
        { u: 1, v: 1 },
        { u: 1.3, v: 1.4 },
      ],
    };
    const edited = withDimension(params, 'Length', 1);

    expect(edited.points![0]).toEqual({ u: 1, v: 1 });
    const end = edited.points![1]!;
    expect(Math.hypot(end.u - 1, end.v - 1)).toBeCloseTo(1, 9);
  });
});

describe('text', () => {
  it('lays out one polyline run per pen stroke', () => {
    const polylines = buildTextPolylines({ text: 'AB', size: 0.1, u: 0, v: 0 }, ground);
    // A is two runs, B is two runs.
    expect(polylines).toHaveLength(4);
  });

  it('scales with the requested cap height', () => {
    const small = buildTextPolylines({ text: 'I', size: 0.1, u: 0, v: 0 }, ground);
    const large = buildTextPolylines({ text: 'I', size: 0.2, u: 0, v: 0 }, ground);

    const height = (runs: typeof small) => {
      const vs = runs.flat().map((point) => local(point).v);
      return Math.max(...vs) - Math.min(...vs);
    };

    expect(height(small)).toBeCloseTo(0.1, 6);
    expect(height(large)).toBeCloseTo(0.2, 6);
  });

  it('draws lowercase as capitals rather than dropping it', () => {
    expect(buildTextPolylines({ text: 'a', size: 0.1, u: 0, v: 0 }, ground)).toHaveLength(
      glyphFor('A').length,
    );
  });

  it('puts later lines below the first', () => {
    const polylines = buildTextPolylines({ text: 'I\nI', size: 0.1, u: 0, v: 0 }, ground);
    const vs = polylines.flat().map((point) => local(point).v);
    expect(Math.min(...vs)).toBeLessThan(0);
  });

  it('produces nothing for empty text', () => {
    expect(buildTextPolylines({ text: '', size: 0.1, u: 0, v: 0 }, ground)).toEqual([]);
    expect(buildTextPolylines({ text: ' ', size: 0.1, u: 0, v: 0 }, ground)).toEqual([]);
  });

  it('substitutes a box for a character it does not have', () => {
    expect(hasGlyph('€')).toBe(false);
    expect(buildTextPolylines({ text: '€', size: 0.1, u: 0, v: 0 }, ground)).toHaveLength(1);
  });

  it('measures the block', () => {
    const single = measureText({ text: 'AB', size: 0.1, u: 0, v: 0 });
    expect(single.height).toBeCloseTo(0.1, 9);

    const double = measureText({ text: 'AB\nCD', size: 0.1, u: 0, v: 0 });
    expect(double.height).toBeGreaterThan(single.height);
    expect(double.width).toBeCloseTo(single.width, 9);
  });
});
