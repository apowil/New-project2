import { describe, expect, it } from 'vitest';
import { arcLength, resampleUniform, simplify, smoothPositions, type StrokeSample } from './resample.js';
import { distance, vec3 } from '../math/vec3.js';

const sample = (x: number, y = 0, z = 0, pressure = 0.5): StrokeSample => ({
  position: vec3(x, y, z),
  pressure,
});

describe('simplify', () => {
  it('collapses collinear points to the endpoints', () => {
    const straight = Array.from({ length: 50 }, (_, i) => sample(i * 0.1));
    expect(simplify(straight, 0.001)).toHaveLength(2);
  });

  it('keeps points that carry shape', () => {
    const corner = [sample(0), sample(1), sample(1, 1), sample(2, 1)];
    expect(simplify(corner, 0.01)).toHaveLength(4);
  });

  it('always keeps both endpoints', () => {
    const noisy = Array.from({ length: 30 }, (_, i) => sample(i * 0.1, Math.random() * 0.001));
    const result = simplify(noisy, 0.05);
    expect(result[0]).toBe(noisy[0]);
    expect(result[result.length - 1]).toBe(noisy[noisy.length - 1]);
  });

  it('passes through input shorter than three samples', () => {
    expect(simplify([sample(0)], 0.1)).toHaveLength(1);
    expect(simplify([sample(0), sample(1)], 0.1)).toHaveLength(2);
  });

  it('handles a long stroke without overflowing the stack', () => {
    const long = Array.from({ length: 60_000 }, (_, i) => sample(i * 0.001, Math.sin(i * 0.01)));
    expect(() => simplify(long, 0.0005)).not.toThrow();
  });
});

describe('resampleUniform', () => {
  it('spaces samples evenly along the curve', () => {
    const input = [sample(0), sample(1), sample(2), sample(3)];
    const output = resampleUniform(input, 0.25);

    for (let i = 1; i < output.length - 1; i += 1) {
      expect(distance(output[i - 1]!.position, output[i]!.position)).toBeCloseTo(0.25, 3);
    }
  });

  it('starts and ends where the stroke did', () => {
    const input = [sample(0), sample(1), sample(2.3)];
    const output = resampleUniform(input, 0.3);

    expect(distance(output[0]!.position, input[0]!.position)).toBeCloseTo(0, 6);
    expect(
      distance(output[output.length - 1]!.position, input[input.length - 1]!.position),
    ).toBeLessThan(0.3);
  });

  it('interpolates pressure along the stroke', () => {
    const input = [sample(0, 0, 0, 0), sample(1, 0, 0, 1)];
    const output = resampleUniform(input, 0.25);
    expect(output[0]!.pressure).toBeCloseTo(0, 5);
    expect(output[output.length - 1]!.pressure).toBeGreaterThan(0.7);
  });

  it('returns the input unchanged for degenerate spacing', () => {
    const input = [sample(0), sample(1)];
    expect(resampleUniform(input, 0)).toHaveLength(2);
  });
});

describe('smoothPositions', () => {
  it('pins the endpoints', () => {
    const input = [sample(0), sample(1, 1), sample(2, -1), sample(3)];
    const output = smoothPositions(input, 0.5, 3);

    expect(distance(output[0]!.position, input[0]!.position)).toBeCloseTo(0, 9);
    expect(
      distance(output[output.length - 1]!.position, input[input.length - 1]!.position),
    ).toBeCloseTo(0, 9);
  });

  it('shortens a jagged path', () => {
    const jagged = Array.from({ length: 40 }, (_, i) => sample(i * 0.1, i % 2 === 0 ? 0.05 : -0.05));
    const smoothed = smoothPositions(jagged, 0.6, 4);
    expect(arcLength(smoothed)).toBeLessThan(arcLength(jagged));
  });

  it('is a no-op at zero strength', () => {
    const input = [sample(0), sample(1, 1), sample(2)];
    expect(smoothPositions(input, 0)).toEqual(input);
  });
});
