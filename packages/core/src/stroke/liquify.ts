/**
 * Reshaping a centreline that has already been drawn.
 *
 * Everything else in the app makes geometry or moves it whole. This is the one
 * place that changes the *shape* of something already on the page: a falloff
 * brush drags, tightens, twists or relaxes the samples inside it and leaves
 * everything outside untouched.
 *
 * It works on centrelines rather than on triangles, which is why it belongs
 * here in the core. A stroke's samples are its real description — warp those
 * and the sweep rebuilds into a genuinely different tube, correctly lit, with
 * caps and taper intact. Warping the mesh instead would smear the surface and
 * leave a stroke that could never be re-swept at another width again.
 *
 * The brush is spherical and measured in metres, not in pixels. A sketch is a
 * 3D object: a brush that reached "everything under the cursor" regardless of
 * depth would grab the far side of the form as readily as the near side, which
 * is never what somebody leaning over a tablet means.
 */

import {
  type Vec3,
  distance,
  distanceSq,
  lerp,
  rotateAround,
  sub,
  add,
  addScaled,
} from '../math/vec3.js';
import { catmullRom, type StrokeSample } from './resample.js';

/**
 * What the brush does to what it covers.
 *
 * Two of these are spent by movement and two are rates. `push` and `twist`
 * consume a gesture — samples travel with the brush, or turn by as much as the
 * pen was dragged. `pull` and `smooth` keep working for as long as the brush is
 * held over the same place, the way a sculpting tool does, which is why the
 * caller drives them from the frame clock rather than from pointer events.
 */
export type LiquifyMode = 'push' | 'pull' | 'twist' | 'smooth';

interface BrushBase {
  /** Centre in world space. */
  centre: Vec3;
  /** Radius in metres. Nothing beyond it moves at all. */
  radius: number;
  /**
   * How much of this step's displacement to apply, 0..1.
   *
   * Already scaled for elapsed time by the caller. The core deliberately does
   * not know about frames: it applies exactly what it is handed, which is what
   * makes the result reproducible in a test.
   */
  strength: number;
}

export type LiquifyBrush =
  | (BrushBase & { mode: 'push'; delta: Vec3 })
  | (BrushBase & { mode: 'pull' })
  | (BrushBase & { mode: 'twist'; axis: Vec3; angle: number })
  | (BrushBase & { mode: 'smooth' });

/**
 * Weight for a sample `d` metres from the centre of a brush of `radius`.
 *
 * Smoothstep rather than a linear ramp: a linear falloff leaves a visible
 * crease at the rim of the brush, because the *rate* of displacement jumps
 * from something to nothing there. Smoothstep has zero slope at both ends, so
 * warped and untouched geometry meet without a corner.
 */
export function falloff(d: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = 1 - Math.min(Math.max(d / radius, 0), 1);
  return t * t * (3 - 2 * t);
}

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

/**
 * Applies one step of the brush to a stroke's samples.
 *
 * Returns a new array, or `null` when nothing was within reach — which lets a
 * caller skip rebuilding meshes for the strokes the brush never touched, the
 * difference between a smooth drag and a stutter on a busy sketch.
 */
export function liquifySamples(
  samples: readonly StrokeSample[],
  brush: LiquifyBrush,
): StrokeSample[] | null {
  if (samples.length === 0 || brush.radius <= 0 || brush.strength <= 0) return null;

  // Cheap rejection first, before anything is allocated. A liquify gesture
  // runs this over every candidate stroke on every frame, and on a busy sketch
  // almost all of them are nowhere near the brush.
  const radiusSq = brush.radius * brush.radius;
  let reached = false;
  for (const sample of samples) {
    if (distanceSq(sample.position, brush.centre) < radiusSq) {
      reached = true;
      break;
    }
  }
  if (!reached) return null;

  const strength = clamp01(brush.strength);

  return samples.map((sample, i) => {
    const w = falloff(distance(sample.position, brush.centre), brush.radius) * strength;
    return {
      position: w > 0 ? displace(samples, i, w, brush) : { ...sample.position },
      pressure: sample.pressure,
    };
  });
}

function displace(
  samples: readonly StrokeSample[],
  i: number,
  w: number,
  brush: LiquifyBrush,
): Vec3 {
  const here = samples[i]!.position;

  switch (brush.mode) {
    case 'push':
      return addScaled(here, brush.delta, w);

    case 'pull':
      // Toward the brush centre by a fraction of the distance still to go, so
      // the weakest edge of the brush creeps and the middle closes quickly.
      return lerp(here, brush.centre, w);

    case 'twist': {
      // Turn about an axis through the centre. Points on the axis have nothing
      // to rotate and stay put on their own; no special case is needed.
      const local = sub(here, brush.centre);
      return add(brush.centre, rotateAround(local, brush.axis, brush.angle * w));
    }

    case 'smooth': {
      // Toward the midpoint of the two neighbours. The ends of a stroke have
      // only one neighbour each and are left alone, so relaxing a wobble never
      // shortens the stroke away from where it was drawn.
      const prev = samples[i - 1];
      const next = samples[i + 1];
      if (!prev || !next) return { ...here };
      return lerp(here, lerp(prev.position, next.position, 0.5), w);
    }
  }
}

/**
 * Squared distance from a point to a line segment, clamped to its ends.
 *
 * Distinct from the one the simplifier uses, which measures to the infinite
 * line: that is safe there because RDP always keeps the endpoints, and wrong
 * here, where a brush beyond the end of a stroke would otherwise be judged to
 * be sitting right on it.
 */
function pointSegmentDistanceSq(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + aby * aby + abz * abz;
  if (lengthSq < 1e-18) return distanceSq(p, a);

  const t = Math.min(
    Math.max(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lengthSq, 0),
    1,
  );
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  const dz = p.z - (a.z + abz * t);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Is any part of this centreline inside the brush?
 *
 * Measured against the *line*, not against the samples on it. A rectangle from
 * the shape tool is five points, so a brush parked in the middle of one of its
 * edges is nowhere near a sample while being unmistakably on the shape. Asking
 * about samples would answer "no" to something plainly under the pen.
 */
export function polylineWithin(
  samples: readonly StrokeSample[],
  point: Vec3,
  radius: number,
): boolean {
  if (samples.length === 0 || radius <= 0) return false;
  const radiusSq = radius * radius;

  if (samples.length === 1) return distanceSq(samples[0]!.position, point) < radiusSq;

  for (let i = 1; i < samples.length; i += 1) {
    const d = pointSegmentDistanceSq(point, samples[i - 1]!.position, samples[i]!.position);
    if (d < radiusSq) return true;
  }
  return false;
}

/**
 * Subdivides every segment longer than `maxGap`, and removes none.
 *
 * A warp can only move the samples it is given, so a centreline with nothing
 * along the stretch being brushed has nothing to move. Freehand strokes are
 * dense enough for this never to come up; a rectangle from the shape tool is
 * five points, and pushing the middle of one of its edges would otherwise do
 * exactly nothing while looking like it should.
 *
 * New samples are spaced by equal steps along the Catmull-Rom curve through
 * the originals, which is measured against the *chord*. Where the curve bulges
 * — rounding a sharp corner — the true gap comes out somewhat over `maxGap`,
 * exactly as it does in the uniform resampler. That is fine for the purpose:
 * this exists to give a brush something to grab, not to guarantee a spacing.
 *
 * Returns the input array itself — the same object — when it is already fine
 * enough, so a caller can tell by identity whether anything was added and skip
 * a rebuild. Nothing here mutates what it is given either way.
 */
export function densify(samples: StrokeSample[], maxGap: number): StrokeSample[] {
  if (samples.length < 2 || maxGap <= 0) return samples;

  let needed = false;
  for (let i = 1; i < samples.length; i += 1) {
    if (distance(samples[i - 1]!.position, samples[i]!.position) > maxGap) {
      needed = true;
      break;
    }
  }
  if (!needed) return samples;

  const at = (i: number): StrokeSample => samples[Math.min(Math.max(i, 0), samples.length - 1)]!;
  const control = (i: number, anchor: number, mirror: number): Vec3 => {
    if (i >= 0 && i < samples.length) return samples[i]!.position;
    const a = at(anchor).position;
    const b = at(mirror).position;
    return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
  };

  const result: StrokeSample[] = [copySample(at(0))];

  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = at(i);
    const b = at(i + 1);
    const span = distance(a.position, b.position);

    if (span > maxGap) {
      const pieces = Math.ceil(span / maxGap);
      const p0 = control(i - 1, i, i + 1);
      const p3 = control(i + 2, i + 1, i);
      for (let step = 1; step < pieces; step += 1) {
        const t = step / pieces;
        result.push({
          position: catmullRom(p0, a.position, b.position, p3, t),
          pressure: a.pressure + (b.pressure - a.pressure) * t,
        });
      }
    }

    result.push(copySample(b));
  }

  return result;
}

/** How far apart the samples of a stroke typically sit. */
export function medianSpacing(samples: readonly StrokeSample[]): number {
  if (samples.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    gaps.push(distance(samples[i - 1]!.position, samples[i]!.position));
  }
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] ?? 0;
}

/** A segment longer than this many times the target gets subdivided. */
const STRETCH_LIMIT = 1.6;
/** A sample closer than this fraction of the target to its neighbour is dropped. */
const CROWD_LIMIT = 0.3;

/**
 * Puts the sample spacing back in order after a warp.
 *
 * Warping moves samples without adding or removing any, so pushing part of a
 * stroke sideways stretches its rings until the sweep looks faceted, and
 * tightening one piles samples on top of each other. This splits what got
 * stretched and drops what crowded — locally, leaving every sample the brush
 * never reached exactly where it was.
 *
 * That locality is the point. Re-running the whole stroke through the uniform
 * resampler would have been one line, but it also re-interpolates the parts
 * nobody touched, so a stroke would drift a little further from what was drawn
 * on every single edit.
 */
export function relaxSpacing(
  samples: readonly StrokeSample[],
  target: number,
): StrokeSample[] {
  if (samples.length < 2 || target <= 0) return samples.map(copySample);

  const at = (i: number): StrokeSample => samples[Math.min(Math.max(i, 0), samples.length - 1)]!;

  /**
   * Control point for a segment's Catmull-Rom neighbourhood, reflecting past
   * the ends rather than duplicating them — the same rule the resampler uses,
   * and for the same reason: a duplicated control point slackens the tangent
   * and flattens the curve exactly where a warp is most likely to have been
   * aimed.
   */
  const control = (i: number, anchor: number, mirror: number): Vec3 => {
    if (i >= 0 && i < samples.length) return samples[i]!.position;
    const a = at(anchor).position;
    const b = at(mirror).position;
    return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
  };

  const result: StrokeSample[] = [copySample(at(0))];

  for (let i = 0; i < samples.length - 1; i += 1) {
    const b = at(i + 1);
    const last = result[result.length - 1]!;
    // Measured against what was actually emitted, not against the input's own
    // neighbour: once a crowded run has been dropped, the input's idea of the
    // previous sample is a point that is no longer in the stroke.
    const span = distance(last.position, b.position);
    const isEnd = i + 1 === samples.length - 1;

    if (span < target * CROWD_LIMIT) {
      if (!isEnd) continue;
      // An endpoint always survives, so that a warp can never shorten a
      // stroke — but it takes the place of whatever it landed on rather than
      // sitting on top of it and leaving a zero-length segment behind.
      if (result.length > 1) {
        result[result.length - 1] = copySample(b);
        continue;
      }
    }

    if (span > target * STRETCH_LIMIT) {
      const pieces = Math.ceil(span / target);
      const p0 = control(i - 1, i, i + 1);
      const p3 = control(i + 2, i + 1, i);
      for (let step = 1; step < pieces; step += 1) {
        const t = step / pieces;
        result.push({
          position: catmullRom(p0, last.position, b.position, p3, t),
          pressure: last.pressure + (b.pressure - last.pressure) * t,
        });
      }
    }

    result.push(copySample(b));
  }

  return result;
}

const copySample = (sample: StrokeSample): StrokeSample => ({
  position: { ...sample.position },
  pressure: sample.pressure,
});
