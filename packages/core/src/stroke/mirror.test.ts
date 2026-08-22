import { describe, expect, it } from 'vitest';
import { hasMirror, mirrorCombinations, mirrorSamples, mirrorVec3, NO_MIRROR } from './mirror.js';
import { vec3 } from '../math/vec3.js';

describe('mirrorCombinations', () => {
  it('produces nothing when no axis is active', () => {
    expect(mirrorCombinations(NO_MIRROR)).toEqual([]);
  });

  it('produces one reflection for one axis', () => {
    expect(mirrorCombinations({ x: true, y: false, z: false })).toEqual([
      { x: true, y: false, z: false },
    ]);
  });

  it('produces three reflections for two axes', () => {
    const result = mirrorCombinations({ x: true, y: true, z: false });
    expect(result).toHaveLength(3);
    // Across X, across Y, and across both — the facing-mirrors case.
    expect(result).toContainEqual({ x: true, y: false, z: false });
    expect(result).toContainEqual({ x: false, y: true, z: false });
    expect(result).toContainEqual({ x: true, y: true, z: false });
  });

  it('produces seven reflections for three axes', () => {
    expect(mirrorCombinations({ x: true, y: true, z: true })).toHaveLength(7);
  });

  it('never includes the identity', () => {
    for (const axes of [
      { x: true, y: false, z: false },
      { x: true, y: true, z: false },
      { x: true, y: true, z: true },
    ]) {
      for (const flip of mirrorCombinations(axes)) {
        expect(flip.x || flip.y || flip.z).toBe(true);
      }
    }
  });

  it('yields unique reflections', () => {
    const result = mirrorCombinations({ x: true, y: true, z: true });
    const keys = new Set(result.map((f) => `${f.x}${f.y}${f.z}`));
    expect(keys.size).toBe(result.length);
  });
});

describe('mirrorVec3', () => {
  it('negates only the named axes', () => {
    const v = vec3(1, 2, 3);
    expect(mirrorVec3(v, { x: true, y: false, z: false })).toEqual(vec3(-1, 2, 3));
    expect(mirrorVec3(v, { x: false, y: true, z: true })).toEqual(vec3(1, -2, -3));
    expect(mirrorVec3(v, NO_MIRROR)).toEqual(vec3(1, 2, 3));
  });

  it('is its own inverse', () => {
    const flip = { x: true, y: false, z: true };
    const v = vec3(0.5, -1.5, 2);
    expect(mirrorVec3(mirrorVec3(v, flip), flip)).toEqual(v);
  });
});

describe('mirrorSamples', () => {
  const samples = [
    { position: vec3(1, 0, 0), pressure: 0.2 },
    { position: vec3(2, 1, -1), pressure: 0.9 },
  ];

  it('reflects positions and keeps pressure', () => {
    const mirrored = mirrorSamples(samples, { x: true, y: false, z: false });
    expect(mirrored[0]!.position).toEqual(vec3(-1, 0, 0));
    expect(mirrored[1]!.position).toEqual(vec3(-2, 1, -1));
    expect(mirrored.map((s) => s.pressure)).toEqual([0.2, 0.9]);
  });

  it('keeps sample order, so the stroke still runs the same way', () => {
    const mirrored = mirrorSamples(samples, { x: true, y: false, z: false });
    expect(mirrored).toHaveLength(samples.length);
    expect(mirrored[0]!.pressure).toBe(samples[0]!.pressure);
  });

  it('does not mutate the input', () => {
    mirrorSamples(samples, { x: true, y: true, z: true });
    expect(samples[0]!.position).toEqual(vec3(1, 0, 0));
  });
});

describe('hasMirror', () => {
  it('reports whether any axis is active', () => {
    expect(hasMirror(NO_MIRROR)).toBe(false);
    expect(hasMirror({ x: false, y: true, z: false })).toBe(true);
  });
});
