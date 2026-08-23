import { describe, expect, it } from 'vitest';

import {
  IDENTITY,
  applyAffine,
  applyLinear,
  averageScale,
  compose,
  determinant,
  flipsOrientation,
  invert,
  isIdentity,
  mirror,
  normalMatrix,
  rotation,
  scaling,
  translation,
} from './affine.js';
import { length, vec3, type Vec3 } from './vec3.js';

const near = (a: Vec3, b: Vec3, precision = 10): void => {
  expect(a.x).toBeCloseTo(b.x, precision);
  expect(a.y).toBeCloseTo(b.y, precision);
  expect(a.z).toBeCloseTo(b.z, precision);
};

describe('affine', () => {
  it('translation moves points and leaves directions alone', () => {
    const t = translation(vec3(1, 2, 3));
    near(applyAffine(t, vec3(1, 1, 1)), vec3(2, 3, 4));
    // A direction has no position, so a translation must not touch it.
    near(applyLinear(t, vec3(1, 0, 0)), vec3(1, 0, 0));
  });

  it('rotates a quarter turn about the origin', () => {
    const r = rotation(vec3(0, 0, 1), Math.PI / 2);
    near(applyAffine(r, vec3(1, 0, 0)), vec3(0, 1, 0));
    near(applyAffine(r, vec3(0, 1, 0)), vec3(-1, 0, 0));
  });

  it('rotates about a pivot rather than the origin', () => {
    const pivot = vec3(10, 0, 0);
    const r = rotation(vec3(0, 0, 1), Math.PI, pivot);
    // The pivot is the one point a rotation leaves alone.
    near(applyAffine(r, pivot), pivot);
    near(applyAffine(r, vec3(11, 0, 0)), vec3(9, 0, 0));
  });

  it('scales about a pivot', () => {
    const s = scaling(2, vec3(1, 1, 1));
    near(applyAffine(s, vec3(1, 1, 1)), vec3(1, 1, 1));
    near(applyAffine(s, vec3(2, 1, 1)), vec3(3, 1, 1));
  });

  it('mirrors through a plane', () => {
    const m = mirror(vec3(1, 0, 0));
    near(applyAffine(m, vec3(3, 1, 1)), vec3(-3, 1, 1));
    // Points on the plane do not move.
    near(applyAffine(m, vec3(0, 5, 5)), vec3(0, 5, 5));
  });

  it('knows which transforms turn geometry inside out', () => {
    expect(flipsOrientation(mirror(vec3(0, 1, 0)))).toBe(true);
    expect(flipsOrientation(rotation(vec3(0, 1, 0), 1.1))).toBe(false);
    expect(flipsOrientation(scaling(3))).toBe(false);
    expect(flipsOrientation(translation(vec3(9, 9, 9)))).toBe(false);
    // Two mirrors are a rotation, and put the winding back.
    expect(flipsOrientation(compose(mirror(vec3(1, 0, 0)), mirror(vec3(0, 1, 0))))).toBe(false);
  });

  it('a rotation preserves lengths and volume', () => {
    const r = rotation(vec3(1, 2, 3), 0.7);
    expect(determinant(r)).toBeCloseTo(1, 10);
    expect(length(applyLinear(r, vec3(0, 0, 2)))).toBeCloseTo(2, 10);
  });

  it('composes in application order', () => {
    const move = translation(vec3(1, 0, 0));
    const turn = rotation(vec3(0, 0, 1), Math.PI / 2);

    // Move, then turn: (1,0,0) -> (2,0,0) -> (0,2,0).
    near(applyAffine(compose(move, turn), vec3(1, 0, 0)), vec3(0, 2, 0));
    // Turn, then move: (1,0,0) -> (0,1,0) -> (1,1,0).
    near(applyAffine(compose(turn, move), vec3(1, 0, 0)), vec3(1, 1, 0));
  });

  it('inverts back to where it started', () => {
    for (const t of [
      translation(vec3(3, -2, 7)),
      rotation(vec3(1, 1, 0), 1.3, vec3(2, 0, 1)),
      scaling(vec3(2, 0.5, 3), vec3(1, 1, 1)),
      mirror(vec3(0, 0, 1), vec3(0, 0, 4)),
      compose(rotation(vec3(0, 1, 0), 0.4), translation(vec3(1, 2, 3))),
    ]) {
      const back = invert(t);
      expect(back).not.toBeNull();
      const p = vec3(1.5, -3, 2.25);
      near(applyAffine(back!, applyAffine(t, p)), p, 8);
    }
  });

  it('refuses to invert a transform that collapses an axis', () => {
    expect(invert(scaling(vec3(1, 0, 1)))).toBeNull();
  });

  it('normals stay perpendicular to a squashed surface', () => {
    // Squash x by a half. A surface running along (1,1,0) has normal (-1,1,0);
    // after squashing, the surface direction becomes (0.5,1,0) and the normal
    // must tilt the other way to stay perpendicular to it.
    const s = scaling(vec3(0.5, 1, 1));
    const surface = applyLinear(s, vec3(1, 1, 0));
    const normal = applyLinear(normalMatrix(s), vec3(-1, 1, 0));

    const dot = surface.x * normal.x + surface.y * normal.y + surface.z * normal.z;
    expect(dot).toBeCloseTo(0, 10);
  });

  it('reports how much lengths change', () => {
    expect(averageScale(scaling(3))).toBeCloseTo(3, 10);
    expect(averageScale(rotation(vec3(0, 1, 0), 0.9))).toBeCloseTo(1, 10);
    expect(averageScale(translation(vec3(5, 5, 5)))).toBeCloseTo(1, 10);
  });

  it('recognises transforms that do nothing', () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity(rotation(vec3(0, 1, 0), 0))).toBe(true);
    expect(isIdentity(translation(vec3(0, 0, 1e-12)))).toBe(true);
    expect(isIdentity(translation(vec3(0, 0, 0.001)))).toBe(false);
  });

  it('a degenerate axis is a no-op rather than a crash', () => {
    expect(isIdentity(rotation(vec3(0, 0, 0), 1))).toBe(true);
    expect(isIdentity(mirror(vec3(0, 0, 0)))).toBe(true);
  });
});
