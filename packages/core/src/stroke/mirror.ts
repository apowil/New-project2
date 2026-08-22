/**
 * Symmetry.
 *
 * Mirroring happens on the *centreline*, not the finished mesh. Reflecting a
 * mesh would flip its triangle winding and turn it inside out; reflecting the
 * samples and rebuilding lets the sweep produce correctly-facing geometry for
 * whatever curve it is handed.
 */

import { type Vec3 } from '../math/vec3.js';
import { type StrokeSample } from './resample.js';

export interface MirrorAxes {
  x: boolean;
  y: boolean;
  z: boolean;
}

export const NO_MIRROR: MirrorAxes = { x: false, y: false, z: false };

export const hasMirror = (axes: MirrorAxes): boolean => axes.x || axes.y || axes.z;

/**
 * Every reflection implied by the active axes, excluding the identity.
 *
 * Two axes give three reflections (across each, and across both), three give
 * seven — the same behaviour as mirroring in a corner of two facing mirrors.
 */
export function mirrorCombinations(axes: MirrorAxes): MirrorAxes[] {
  const result: MirrorAxes[] = [];
  for (const x of axes.x ? [false, true] : [false]) {
    for (const y of axes.y ? [false, true] : [false]) {
      for (const z of axes.z ? [false, true] : [false]) {
        if (!x && !y && !z) continue; // the original stroke
        result.push({ x, y, z });
      }
    }
  }
  return result;
}

/** Reflects a point through the world-origin planes named by `flip`. */
export const mirrorVec3 = (v: Vec3, flip: MirrorAxes): Vec3 => ({
  x: flip.x ? -v.x : v.x,
  y: flip.y ? -v.y : v.y,
  z: flip.z ? -v.z : v.z,
});

export const mirrorSamples = (
  samples: readonly StrokeSample[],
  flip: MirrorAxes,
): StrokeSample[] =>
  samples.map((sample) => ({
    position: mirrorVec3(sample.position, flip),
    pressure: sample.pressure,
  }));
