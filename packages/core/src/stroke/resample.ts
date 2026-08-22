/**
 * Turning a raw pointer trail into a clean centreline.
 *
 * The pipeline is: simplify (throw away samples that carry no shape), then
 * resample at a uniform arc-length spacing (so the mesh builder sees evenly
 * spaced rings regardless of how fast the stroke was drawn).
 */

import { type Vec3, addScaled, distance, lerp, sub, cross, length, vec3, set } from '../math/vec3.js';

export interface StrokeSample {
  position: Vec3;
  /** Normalised 0..1. Devices without a pressure sensor report a constant. */
  pressure: number;
}

/**
 * Ramer-Douglas-Peucker in 3D. Drops samples that sit within `tolerance` of
 * the chord they span, which typically removes 70-90% of raw pen samples
 * without changing the visible curve.
 */
export function simplify(samples: readonly StrokeSample[], tolerance: number): StrokeSample[] {
  if (samples.length <= 2) return samples.slice();

  const keep = new Uint8Array(samples.length);
  keep[0] = 1;
  keep[samples.length - 1] = 1;

  // Explicit stack rather than recursion: a long stroke can be tens of
  // thousands of samples deep and blow the call stack.
  const stack: Array<[number, number]> = [[0, samples.length - 1]];
  const toleranceSq = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let furthest = -1;
    let furthestDistSq = -1;

    const a = samples[first]!.position;
    const b = samples[last]!.position;

    for (let i = first + 1; i < last; i += 1) {
      const d = pointSegmentDistanceSq(samples[i]!.position, a, b);
      if (d > furthestDistSq) {
        furthestDistSq = d;
        furthest = i;
      }
    }

    if (furthestDistSq > toleranceSq && furthest > 0) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }

  const result: StrokeSample[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (keep[i]) result.push(samples[i]!);
  }
  return result;
}

function pointSegmentDistanceSq(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const abLen = length(ab);
  if (abLen < 1e-9) {
    const d = distance(p, a);
    return d * d;
  }
  // Perpendicular distance via the cross product, which avoids clamping the
  // projection: RDP always measures against the infinite line here because the
  // endpoints are guaranteed to be kept.
  const ap = sub(p, a);
  const area = length(cross(ab, ap));
  const d = area / abLen;
  return d * d;
}

/** Centripetal Catmull-Rom — no cusps or self-intersections on tight corners. */
export function catmullRom(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  t: number,
  out: Vec3 = vec3(),
): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;

  const a = -0.5 * t3 + t2 - 0.5 * t;
  const b = 1.5 * t3 - 2.5 * t2 + 1;
  const c = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const d = 0.5 * t3 - 0.5 * t2;

  return set(
    out,
    p0.x * a + p1.x * b + p2.x * c + p3.x * d,
    p0.y * a + p1.y * b + p2.y * c + p3.y * d,
    p0.z * a + p1.z * b + p2.z * c + p3.z * d,
  );
}

/**
 * Walks the polyline at fixed `spacing` intervals, interpolating position with
 * Catmull-Rom and pressure linearly. The final sample is always included so a
 * stroke ends exactly where the pen lifted.
 *
 * Spacing is measured along the *chords*, so on a strongly curved stroke the
 * true arc distance between output samples runs a little over `spacing`. That
 * is fine for the mesh builder, which only needs rings that are evenly spaced
 * enough to avoid stretched quads — it is not an arc-length parameterisation.
 */
export function resampleUniform(
  samples: readonly StrokeSample[],
  spacing: number,
): StrokeSample[] {
  if (samples.length < 2 || spacing <= 0) return samples.slice();

  const at = (i: number): StrokeSample =>
    samples[Math.min(Math.max(i, 0), samples.length - 1)]!;

  /**
   * Control point for the segment's Catmull-Rom neighbourhood. Beyond the ends
   * of the stroke we reflect the neighbour (`2*a - b`) rather than clamping to
   * a duplicate. Clamping makes the tangent at the first and last sample go
   * slack, which both flattens the ends and — because the curve then no longer
   * matches the chord — breaks the even spacing this function promises.
   */
  const control = (i: number, anchor: number, mirror: number): Vec3 => {
    if (i >= 0 && i < samples.length) return samples[i]!.position;
    const a = at(anchor).position;
    const b = at(mirror).position;
    return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
  };

  const result: StrokeSample[] = [
    { position: { ...at(0).position }, pressure: at(0).pressure },
  ];

  let carry = 0; // distance from the last emitted sample to the current segment start

  for (let i = 0; i < samples.length - 1; i += 1) {
    const p1 = at(i);
    const p2 = at(i + 1);
    const segmentLength = distance(p1.position, p2.position);
    if (segmentLength < 1e-9) continue;

    const p0 = control(i - 1, i, i + 1);
    const p3 = control(i + 2, i + 1, i);

    let travelled = spacing - carry;
    while (travelled <= segmentLength) {
      const t = travelled / segmentLength;
      result.push({
        position: catmullRom(p0, p1.position, p2.position, p3, t),
        pressure: p1.pressure + (p2.pressure - p1.pressure) * t,
      });
      travelled += spacing;
    }
    carry = segmentLength - (travelled - spacing);
  }

  const last = at(samples.length - 1);
  const tail = result[result.length - 1]!;
  // Only append the true endpoint if resampling did not already land on it.
  if (distance(tail.position, last.position) > spacing * 0.25) {
    result.push({ position: { ...last.position }, pressure: last.pressure });
  }

  return result;
}

/**
 * Moving average over positions, applied after resampling. `strength` is
 * 0..1; endpoints are pinned so a stroke never shrinks away from where it was
 * drawn.
 */
export function smoothPositions(
  samples: readonly StrokeSample[],
  strength: number,
  iterations = 1,
): StrokeSample[] {
  if (samples.length < 3 || strength <= 0) return samples.slice();

  let current: StrokeSample[] = samples.map((s) => ({
    position: { ...s.position },
    pressure: s.pressure,
  }));

  for (let pass = 0; pass < iterations; pass += 1) {
    const next: StrokeSample[] = [current[0]!];
    for (let i = 1; i < current.length - 1; i += 1) {
      const prev = current[i - 1]!.position;
      const here = current[i]!.position;
      const after = current[i + 1]!.position;

      const midpoint = lerp(prev, after, 0.5);
      next.push({
        position: lerp(here, midpoint, strength),
        pressure: current[i]!.pressure,
      });
    }
    next.push(current[current.length - 1]!);
    current = next;
  }

  return current;
}

/** Total arc length of a polyline — used for UV mapping along the stroke. */
export function arcLength(samples: readonly StrokeSample[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    total += distance(samples[i - 1]!.position, samples[i]!.position);
  }
  return total;
}

/** Extends the ends of a stroke slightly, used for tapered caps. */
export const extendEndpoint = (from: Vec3, towards: Vec3, amount: number): Vec3 =>
  addScaled(from, sub(from, towards), amount);
