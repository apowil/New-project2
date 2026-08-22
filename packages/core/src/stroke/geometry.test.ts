import { describe, expect, it } from 'vitest';
import { buildStrokeGeometry } from './geometry.js';
import { type StrokeSample } from './resample.js';
import { vec3 } from '../math/vec3.js';

const line = (count: number): StrokeSample[] =>
  Array.from({ length: count }, (_, i) => ({
    position: vec3(i * 0.1, 0, 0),
    pressure: 0.5,
  }));

/**
 * A helix whose curvature direction flips — the exact shape that makes Frenet
 * frames spin. Used to prove the parallel-transport frames stay stable.
 */
const wave = (count: number): StrokeSample[] =>
  Array.from({ length: count }, (_, i) => {
    const t = (i / (count - 1)) * Math.PI * 4;
    return {
      position: vec3(t * 0.1, Math.sin(t) * 0.3, Math.cos(t * 1.7) * 0.2),
      pressure: 0.5 + 0.4 * Math.sin(t),
    };
  });

describe('buildStrokeGeometry', () => {
  it('returns null for degenerate input', () => {
    expect(buildStrokeGeometry([])).toBeNull();
    expect(buildStrokeGeometry([{ position: vec3(), pressure: 1 }])).toBeNull();
    // Two coincident samples have no length to sweep along.
    expect(
      buildStrokeGeometry([
        { position: vec3(1, 1, 1), pressure: 1 },
        { position: vec3(1, 1, 1), pressure: 1 },
      ]),
    ).toBeNull();
  });

  it('produces the expected vertex and index counts', () => {
    const sides = 8;
    const samples = line(10);
    const geometry = buildStrokeGeometry(samples, { sides })!;

    expect(geometry).not.toBeNull();
    // One ring per sample, plus the two cap centres.
    expect(geometry.positions.length / 3).toBe(samples.length * sides + 2);
    expect(geometry.normals.length).toBe(geometry.positions.length);
    expect(geometry.uvs.length / 2).toBe(geometry.positions.length / 3);
    // Quads between rings, plus a triangle fan at each cap.
    expect(geometry.indices.length).toBe((samples.length - 1) * sides * 6 + sides * 6);
  });

  it('emits only finite numbers', () => {
    const geometry = buildStrokeGeometry(wave(120))!;
    expect(geometry.positions.every(Number.isFinite)).toBe(true);
    expect(geometry.normals.every(Number.isFinite)).toBe(true);
    expect(geometry.uvs.every(Number.isFinite)).toBe(true);
  });

  it('keeps every index inside the vertex range', () => {
    const geometry = buildStrokeGeometry(wave(60), { sides: 6 })!;
    const vertexCount = geometry.positions.length / 3;
    for (const index of geometry.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(vertexCount);
    }
  });

  it('emits unit-length normals', () => {
    const geometry = buildStrokeGeometry(wave(60))!;
    for (let i = 0; i < geometry.normals.length; i += 3) {
      const length = Math.hypot(
        geometry.normals[i]!,
        geometry.normals[i + 1]!,
        geometry.normals[i + 2]!,
      );
      expect(length).toBeCloseTo(1, 4);
    }
  });

  it('does not twist the cross-section on a curve that flips curvature', () => {
    // With Frenet frames, corresponding vertices on neighbouring rings jump
    // right across the tube when curvature flips. Parallel transport keeps the
    // step comparable to the ring spacing.
    const sides = 8;
    const samples = wave(200);
    const geometry = buildStrokeGeometry(samples, { sides, width: 0.05 })!;

    let maxStep = 0;
    for (let ring = 0; ring < samples.length - 1; ring += 1) {
      const a = (ring * sides) * 3;
      const b = ((ring + 1) * sides) * 3;
      const step = Math.hypot(
        geometry.positions[a]! - geometry.positions[b]!,
        geometry.positions[a + 1]! - geometry.positions[b + 1]!,
        geometry.positions[a + 2]! - geometry.positions[b + 2]!,
      );
      maxStep = Math.max(maxStep, step);
    }

    // Ring spacing here is ~0.05; a twist shows up as a step of roughly the
    // tube diameter or more on top of that.
    expect(maxStep).toBeLessThan(0.12);
  });

  it('tapers the ends thinner than the middle', () => {
    const sides = 8;
    const samples = line(40);
    const geometry = buildStrokeGeometry(samples, { sides, taper: 0.3 })!;

    const ringRadius = (ring: number): number => {
      const centre = samples[ring]!.position;
      const i = ring * sides * 3;
      return Math.hypot(
        geometry.positions[i]! - centre.x,
        geometry.positions[i + 1]! - centre.y,
        geometry.positions[i + 2]! - centre.z,
      );
    };

    expect(ringRadius(0)).toBeLessThan(ringRadius(20));
    expect(ringRadius(samples.length - 1)).toBeLessThan(ringRadius(20));
  });

  it('scales width with pressure', () => {
    const sides = 8;
    const soft = buildStrokeGeometry(
      line(20).map((s) => ({ ...s, pressure: 0.1 })),
      { sides, taper: 0 },
    )!;
    const hard = buildStrokeGeometry(
      line(20).map((s) => ({ ...s, pressure: 1 })),
      { sides, taper: 0 },
    )!;

    const radiusAt = (g: typeof soft, ring: number): number => {
      const centre = line(20)[ring]!.position;
      const i = ring * sides * 3;
      return Math.hypot(
        g.positions[i]! - centre.x,
        g.positions[i + 1]! - centre.y,
        g.positions[i + 2]! - centre.z,
      );
    };

    expect(radiusAt(hard, 10)).toBeGreaterThan(radiusAt(soft, 10));
  });
});
