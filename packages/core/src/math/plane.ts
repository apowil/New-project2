/**
 * The sketch plane: the surface a 2D pointer position gets projected onto to
 * become a 3D point. Everything you draw lands on one of these.
 */

import {
  type Vec3,
  add,
  addScaled,
  anyPerpendicular,
  cross,
  dot,
  normalize,
  scale,
  sub,
  vec3,
} from './vec3.js';

export interface Plane {
  origin: Vec3;
  normal: Vec3;
  /** In-plane basis vectors. `u` x `v` == `normal`. */
  u: Vec3;
  v: Vec3;
}

/**
 * Builds a plane from an origin and normal. `hint` biases the choice of the
 * `u` axis so the plane's local axes stay stable as the camera moves — pass
 * the camera's right vector to keep a camera-facing plane from spinning.
 */
export function makePlane(origin: Vec3, normal: Vec3, hint?: Vec3): Plane {
  const n = normalize(normal);
  let u = vec3();

  if (hint) {
    // Gram-Schmidt: project the hint onto the plane, keep it if it survives.
    const projected = addScaled(hint, n, -dot(hint, n));
    if (Math.hypot(projected.x, projected.y, projected.z) > 1e-6) {
      normalize(projected, u);
    } else {
      anyPerpendicular(n, u);
    }
  } else {
    anyPerpendicular(n, u);
  }

  const v = normalize(cross(n, u));
  // Re-derive u so the basis is exactly orthonormal even after rounding.
  u = normalize(cross(v, n));

  return { origin: { ...origin }, normal: n, u, v };
}

/** Signed distance from `point` to the plane, along the normal. */
export const signedDistance = (plane: Plane, point: Vec3): number =>
  dot(sub(point, plane.origin), plane.normal);

/** Drops `point` onto the plane along the normal. */
export const projectPoint = (plane: Plane, point: Vec3, out: Vec3 = vec3()): Vec3 =>
  addScaled(point, plane.normal, -signedDistance(plane, point), out);

/** Local 2D coordinates of a point already on (or near) the plane. */
export function toLocal(plane: Plane, point: Vec3): { u: number; v: number } {
  const d = sub(point, plane.origin);
  return { u: dot(d, plane.u), v: dot(d, plane.v) };
}

/** The inverse of {@link toLocal}. */
export const fromLocal = (plane: Plane, u: number, v: number, out: Vec3 = vec3()): Vec3 =>
  add(plane.origin, add(scale(plane.u, u), scale(plane.v, v)), out);

/**
 * Where a ray meets the plane, or `null` if it runs parallel or points away.
 * This is the workhorse behind every pointer-to-3D conversion.
 */
export function raycastPlane(
  plane: Plane,
  rayOrigin: Vec3,
  rayDirection: Vec3,
  out: Vec3 = vec3(),
): Vec3 | null {
  const denom = dot(plane.normal, rayDirection);
  if (Math.abs(denom) < 1e-8) return null; // parallel to the plane

  const t = dot(sub(plane.origin, rayOrigin), plane.normal) / denom;
  if (t < 0) return null; // plane is behind the ray

  return addScaled(rayOrigin, rayDirection, t, out);
}

/** Shifts a plane along its own normal, keeping its orientation. */
export const offsetPlane = (plane: Plane, distance: number): Plane => ({
  ...plane,
  origin: addScaled(plane.origin, plane.normal, distance),
});
