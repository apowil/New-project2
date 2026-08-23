/**
 * Affine transforms — a 3×3 linear part with a translation.
 *
 * Every way of moving geometry in this app (translate, rotate, scale, mirror)
 * is one of these, so they all share a single code path through the document.
 * The alternative — a bespoke traversal per operation — is where winding bugs
 * breed, because only some of them flip orientation and it is easy to forget
 * which.
 *
 * The linear part is stored row-major: `m[row * 3 + col]`.
 */

import { cross, normalize, vec3, type Vec3 } from './vec3.js';

export interface Affine {
  /** Row-major 3×3 linear part. */
  m: readonly number[];
  /** Translation applied after the linear part. */
  t: Vec3;
}

export const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: vec3() };

/** Maps a point: `M·p + t`. */
export function applyAffine(a: Affine, p: Vec3): Vec3 {
  const { m } = a;
  return {
    x: m[0]! * p.x + m[1]! * p.y + m[2]! * p.z + a.t.x,
    y: m[3]! * p.x + m[4]! * p.y + m[5]! * p.z + a.t.y,
    z: m[6]! * p.x + m[7]! * p.y + m[8]! * p.z + a.t.z,
  };
}

/** Maps a direction — the linear part only, so translation is ignored. */
export function applyLinear(a: Affine, v: Vec3): Vec3 {
  const { m } = a;
  return {
    x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
    y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
    z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
  };
}

export function determinant(a: Affine): number {
  const { m } = a;
  return (
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  );
}

/**
 * True when the transform turns geometry inside out.
 *
 * A mesh transformed by one of these needs its triangle winding reversed, or
 * every face ends up pointing the wrong way and the surface renders dark and
 * hollow. Mirrors do this; rotations and positive scales do not.
 */
export const flipsOrientation = (a: Affine): boolean => determinant(a) < 0;

export const translation = (delta: Vec3): Affine => ({ ...IDENTITY, t: { ...delta } });

/**
 * Wraps a linear map so it acts about `pivot` rather than the world origin.
 *
 * Rotating a sketch that sits ten metres from the origin about the origin
 * flings it across the scene; about its own centre it turns on the spot, which
 * is invariably what was meant.
 */
function about(m: readonly number[], pivot: Vec3): Affine {
  const moved = applyLinear({ m, t: vec3() }, pivot);
  return { m, t: { x: pivot.x - moved.x, y: pivot.y - moved.y, z: pivot.z - moved.z } };
}

/** Right-handed rotation of `angle` radians about `axis`, through `pivot`. */
export function rotation(axis: Vec3, angle: number, pivot: Vec3 = vec3()): Affine {
  const n = normalize(axis);
  // Degenerate axis: nothing sensible to rotate about, so do nothing.
  if (n.x === 0 && n.y === 0 && n.z === 0) return IDENTITY;

  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  const { x, y, z } = n;

  // Rodrigues, written out.
  const m = [
    c + x * x * k,
    x * y * k - z * s,
    x * z * k + y * s,
    y * x * k + z * s,
    c + y * y * k,
    y * z * k - x * s,
    z * x * k - y * s,
    z * y * k + x * s,
    c + z * z * k,
  ];
  return about(m, pivot);
}

/** Scales about `pivot`, either uniformly or per axis. */
export function scaling(factor: number | Vec3, pivot: Vec3 = vec3()): Affine {
  const f = typeof factor === 'number' ? { x: factor, y: factor, z: factor } : factor;
  return about([f.x, 0, 0, 0, f.y, 0, 0, 0, f.z], pivot);
}

/** Reflects through the plane with the given normal, passing through `pivot`. */
export function mirror(normal: Vec3, pivot: Vec3 = vec3()): Affine {
  const n = normalize(normal);
  if (n.x === 0 && n.y === 0 && n.z === 0) return IDENTITY;

  // I - 2nnᵀ
  const m = [
    1 - 2 * n.x * n.x,
    -2 * n.x * n.y,
    -2 * n.x * n.z,
    -2 * n.y * n.x,
    1 - 2 * n.y * n.y,
    -2 * n.y * n.z,
    -2 * n.z * n.x,
    -2 * n.z * n.y,
    1 - 2 * n.z * n.z,
  ];
  return about(m, pivot);
}

/** `b` after `a` — the transform equivalent to applying a, then b. */
export function compose(a: Affine, b: Affine): Affine {
  const m: number[] = new Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += b.m[row * 3 + k]! * a.m[k * 3 + col]!;
      m[row * 3 + col] = sum;
    }
  }
  return { m, t: applyAffine(b, a.t) };
}

/**
 * Maps a surface normal.
 *
 * Normals do not transform like directions once a non-uniform scale is
 * involved — squashing a sphere flat tilts its surface one way and its normals
 * the other. The inverse transpose is the map that gets it right; for the
 * rotations and uniform scales this app mostly uses it reduces to the linear
 * part anyway, so this costs nothing in the common case.
 */
export function normalMatrix(a: Affine): Affine {
  const { m } = a;
  const det = determinant(a);
  // Singular linear part — a scale to zero on some axis. There is no correct
  // answer, so leave normals alone rather than produce infinities.
  if (Math.abs(det) < 1e-12) return IDENTITY;

  const r0 = vec3(m[0]!, m[1]!, m[2]!);
  const r1 = vec3(m[3]!, m[4]!, m[5]!);
  const r2 = vec3(m[6]!, m[7]!, m[8]!);

  // Rows of the inverse transpose are the cofactor rows over the determinant.
  const c0 = cross(r1, r2);
  const c1 = cross(r2, r0);
  const c2 = cross(r0, r1);
  const inv = 1 / det;

  return {
    m: [
      c0.x * inv,
      c0.y * inv,
      c0.z * inv,
      c1.x * inv,
      c1.y * inv,
      c1.z * inv,
      c2.x * inv,
      c2.y * inv,
      c2.z * inv,
    ],
    t: vec3(),
  };
}

/**
 * The transform that undoes this one, or null if it cannot be undone.
 *
 * Used to revert a transform command rather than snapshotting geometry, which
 * for a dense selection would mean holding a second copy of every buffer for
 * as long as it sits in the undo stack. A singular transform — a scale that
 * collapses an axis to nothing — genuinely has no inverse, and says so.
 */
export function invert(a: Affine): Affine | null {
  const det = determinant(a);
  if (Math.abs(det) < 1e-12) return null;

  // The inverse of the linear part is the transpose of the inverse transpose.
  const n = normalMatrix(a).m;
  const m = [n[0]!, n[3]!, n[6]!, n[1]!, n[4]!, n[7]!, n[2]!, n[5]!, n[8]!];
  const moved = applyLinear({ m, t: vec3() }, a.t);
  return { m, t: { x: -moved.x, y: -moved.y, z: -moved.z } };
}

/** How much the transform scales lengths, averaged over the three axes. */
export function averageScale(a: Affine): number {
  const { m } = a;
  const sx = Math.hypot(m[0]!, m[3]!, m[6]!);
  const sy = Math.hypot(m[1]!, m[4]!, m[7]!);
  const sz = Math.hypot(m[2]!, m[5]!, m[8]!);
  return (sx + sy + sz) / 3;
}

/** True when the transform leaves every point where it was. */
export function isIdentity(a: Affine): boolean {
  const { m } = a;
  for (let i = 0; i < 9; i += 1) {
    if (Math.abs(m[i]! - IDENTITY.m[i]!) > 1e-9) return false;
  }
  return Math.abs(a.t.x) < 1e-9 && Math.abs(a.t.y) < 1e-9 && Math.abs(a.t.z) < 1e-9;
}
