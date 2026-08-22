import { describe, expect, it } from 'vitest';
import { fromLocal, makePlane, projectPoint, raycastPlane, signedDistance, toLocal } from './plane.js';
import { UNIT_X, UNIT_Y, cross, distance, dot, length, vec3 } from './vec3.js';

describe('makePlane', () => {
  it('builds an orthonormal basis', () => {
    const plane = makePlane(vec3(1, 2, 3), vec3(0.3, 1, -0.2));

    expect(length(plane.normal)).toBeCloseTo(1, 6);
    expect(length(plane.u)).toBeCloseTo(1, 6);
    expect(length(plane.v)).toBeCloseTo(1, 6);
    expect(dot(plane.u, plane.v)).toBeCloseTo(0, 6);
    expect(dot(plane.u, plane.normal)).toBeCloseTo(0, 6);
    expect(dot(plane.v, plane.normal)).toBeCloseTo(0, 6);

    // Right-handed: u x v == normal.
    const uv = cross(plane.u, plane.v);
    expect(distance(uv, plane.normal)).toBeCloseTo(0, 6);
  });

  it('honours the hint axis when it is usable', () => {
    const plane = makePlane(vec3(), UNIT_Y, UNIT_X);
    expect(distance(plane.u, UNIT_X)).toBeCloseTo(0, 6);
  });

  it('falls back gracefully when the hint is parallel to the normal', () => {
    const plane = makePlane(vec3(), UNIT_Y, UNIT_Y);
    expect(length(plane.u)).toBeCloseTo(1, 6);
    expect(dot(plane.u, plane.normal)).toBeCloseTo(0, 6);
  });
});

describe('projection', () => {
  it('round-trips through local coordinates', () => {
    const plane = makePlane(vec3(1, 2, 3), vec3(0.2, 0.9, 0.3));
    const point = fromLocal(plane, 1.25, -0.5);
    const local = toLocal(plane, point);

    expect(local.u).toBeCloseTo(1.25, 6);
    expect(local.v).toBeCloseTo(-0.5, 6);
  });

  it('drops a point onto the plane along the normal', () => {
    const plane = makePlane(vec3(), UNIT_Y);
    const projected = projectPoint(plane, vec3(2, 5, -3));

    expect(projected.y).toBeCloseTo(0, 6);
    expect(projected.x).toBeCloseTo(2, 6);
    expect(projected.z).toBeCloseTo(-3, 6);
    expect(signedDistance(plane, projected)).toBeCloseTo(0, 6);
  });
});

describe('raycastPlane', () => {
  it('finds the intersection in front of the ray', () => {
    const plane = makePlane(vec3(), UNIT_Y);
    const hit = raycastPlane(plane, vec3(0, 5, 0), vec3(0, -1, 0));

    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(0, 6);
  });

  it('returns null when the ray is parallel', () => {
    const plane = makePlane(vec3(), UNIT_Y);
    expect(raycastPlane(plane, vec3(0, 5, 0), UNIT_X)).toBeNull();
  });

  it('returns null when the plane is behind the ray', () => {
    const plane = makePlane(vec3(), UNIT_Y);
    expect(raycastPlane(plane, vec3(0, 5, 0), vec3(0, 1, 0))).toBeNull();
  });
});
