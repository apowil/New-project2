/**
 * Minimal 3D vector maths.
 *
 * Every function that produces a vector takes an optional `out` parameter so
 * hot paths (stroke resampling, frame propagation) can run without allocating.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export const copy = (out: Vec3, a: Vec3): Vec3 => set(out, a.x, a.y, a.z);

export const add = (a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 =>
  set(out, a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 =>
  set(out, a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (a: Vec3, s: number, out: Vec3 = vec3()): Vec3 =>
  set(out, a.x * s, a.y * s, a.z * s);

/** out = a + b * s — the fused form used throughout the geometry builders. */
export const addScaled = (a: Vec3, b: Vec3, s: number, out: Vec3 = vec3()): Vec3 =>
  set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3, out: Vec3 = vec3()): Vec3 =>
  set(
    out,
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Normalises in place into `out`. A zero-length vector is left as (0,0,0). */
export function normalize(a: Vec3, out: Vec3 = vec3()): Vec3 {
  const len = length(a);
  if (len < 1e-12) return set(out, 0, 0, 0);
  return set(out, a.x / len, a.y / len, a.z / len);
}

export const lerp = (a: Vec3, b: Vec3, t: number, out: Vec3 = vec3()): Vec3 =>
  set(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/**
 * Rotates `a` around the unit axis `axis` by `angle` radians (Rodrigues).
 * Used by the parallel-transport frame walker.
 */
export function rotateAround(a: Vec3, axis: Vec3, angle: number, out: Vec3 = vec3()): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, a);
  return set(
    out,
    a.x * c + (axis.y * a.z - axis.z * a.y) * s + axis.x * d * (1 - c),
    a.y * c + (axis.z * a.x - axis.x * a.z) * s + axis.y * d * (1 - c),
    a.z * c + (axis.x * a.y - axis.y * a.x) * s + axis.z * d * (1 - c),
  );
}

/** Any unit vector perpendicular to `a`, chosen to stay numerically stable. */
export function anyPerpendicular(a: Vec3, out: Vec3 = vec3()): Vec3 {
  // Cross with whichever cardinal axis is least aligned with `a`.
  const ax = Math.abs(a.x);
  const ay = Math.abs(a.y);
  const az = Math.abs(a.z);
  const axis = ax < ay ? (ax < az ? UNIT_X : UNIT_Z) : ay < az ? UNIT_Y : UNIT_Z;
  return normalize(cross(a, axis, out), out);
}

export const UNIT_X: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 });
export const UNIT_Y: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });
export const UNIT_Z: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });
export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
