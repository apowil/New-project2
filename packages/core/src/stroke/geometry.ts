/**
 * Sweeping a centreline into a lit 3D surface.
 *
 * Two details matter more than anything else for how a stroke reads:
 *
 * 1. **Frames.** Three.js's TubeGeometry uses Frenet frames, which spin
 *    violently wherever a curve's curvature flips — you see it as a twist in
 *    the middle of an otherwise smooth stroke. We use parallel transport
 *    instead: each ring's frame is the previous ring's frame rotated by the
 *    minimum amount needed to stay perpendicular to the new tangent, so the
 *    cross-section never spins about its own axis.
 *
 * 2. **Cross-section.** A stroke is an ellipse, not a circle. `flatness`
 *    squashes it along the frame's normal, so a value near 0.15 gives the
 *    chisel-like ribbon a real brush leaves while still lighting as a volume.
 */

import {
  type Vec3,
  add,
  addScaled,
  copy,
  cross,
  dot,
  normalize,
  rotateAround,
  scale,
  sub,
  vec3,
  anyPerpendicular,
  length,
} from '../math/vec3.js';
import { type StrokeSample } from './resample.js';

export interface StrokeGeometryOptions {
  /** Stroke width in scene units at full pressure. */
  width: number;
  /** Cross-section resolution. 4 reads as a ribbon, 8-12 as a tube. */
  sides: number;
  /** Ellipse squash along the frame normal. 1 = round, 0.1 = flat ribbon. */
  flatness: number;
  /** Width at zero pressure, as a fraction of `width`. */
  minPressureScale: number;
  /** Exponent applied to pressure. >1 makes light strokes thinner. */
  pressureCurve: number;
  /** Fraction of the stroke length tapered at each end. */
  taper: number;
  /** Orients the flat axis of the cross-section — normally the sketch plane's normal. */
  initialNormal?: Vec3;
}

export const DEFAULT_STROKE_OPTIONS: StrokeGeometryOptions = {
  width: 0.06,
  sides: 8,
  flatness: 0.45,
  minPressureScale: 0.35,
  pressureCurve: 1.4,
  taper: 0.12,
};

export interface StrokeGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Walks the centreline computing a rotation-minimising frame at each sample.
 * Returns tangents plus the transported normal/binormal pair.
 */
function buildFrames(
  samples: readonly StrokeSample[],
  initialNormal?: Vec3,
): { tangents: Vec3[]; normals: Vec3[]; binormals: Vec3[] } {
  const count = samples.length;
  const tangents: Vec3[] = new Array(count);

  for (let i = 0; i < count; i += 1) {
    const prev = samples[Math.max(i - 1, 0)]!.position;
    const next = samples[Math.min(i + 1, count - 1)]!.position;
    const t = sub(next, prev);
    // A degenerate centre difference (duplicate samples) falls back to the
    // previous tangent rather than producing a zero vector.
    tangents[i] = length(t) > 1e-9 ? normalize(t) : copy(vec3(), tangents[i - 1] ?? { x: 0, y: 0, z: 1 });
  }

  const normals: Vec3[] = new Array(count);
  const binormals: Vec3[] = new Array(count);

  // Seed the frame. Using the sketch plane's normal keeps a ribbon's flat face
  // parallel to the surface you drew on.
  let normal = vec3();
  if (initialNormal) {
    const projected = addScaled(initialNormal, tangents[0]!, -dot(initialNormal, tangents[0]!));
    if (length(projected) > 1e-6) {
      normalize(projected, normal);
    } else {
      anyPerpendicular(tangents[0]!, normal);
    }
  } else {
    anyPerpendicular(tangents[0]!, normal);
  }

  normals[0] = normal;
  binormals[0] = normalize(cross(tangents[0]!, normal));

  for (let i = 1; i < count; i += 1) {
    const prevTangent = tangents[i - 1]!;
    const tangent = tangents[i]!;

    let transported = copy(vec3(), normals[i - 1]!);

    // Rotate the previous normal by the same rotation that took the previous
    // tangent to this one. If the tangents are near-parallel there is nothing
    // to do, which is the common case on a smooth stroke.
    const axis = cross(prevTangent, tangent);
    const axisLength = length(axis);
    if (axisLength > 1e-8) {
      const angle = Math.acos(Math.min(Math.max(dot(prevTangent, tangent), -1), 1));
      if (angle > 1e-8) {
        transported = rotateAround(transported, scale(axis, 1 / axisLength), angle);
      }
    }

    // Re-orthogonalise against drift accumulated over thousands of rings.
    const corrected = addScaled(transported, tangent, -dot(transported, tangent));
    normals[i] = length(corrected) > 1e-9 ? normalize(corrected) : anyPerpendicular(tangent);
    binormals[i] = normalize(cross(tangent, normals[i]!));
  }

  return { tangents, normals, binormals };
}

/**
 * Builds the swept surface. Returns `null` for input too short to sweep —
 * callers should treat that as "nothing to draw" rather than an error.
 */
export function buildStrokeGeometry(
  samples: readonly StrokeSample[],
  options: Partial<StrokeGeometryOptions> = {},
): StrokeGeometry | null {
  const opts: StrokeGeometryOptions = { ...DEFAULT_STROKE_OPTIONS, ...options };
  const count = samples.length;
  if (count < 2) return null;

  const sides = Math.max(3, Math.floor(opts.sides));
  const { tangents, normals, binormals } = buildFrames(samples, opts.initialNormal);

  // Arc length per sample, for taper falloff and the U texture coordinate.
  const cumulative = new Float64Array(count);
  for (let i = 1; i < count; i += 1) {
    const a = samples[i - 1]!.position;
    const b = samples[i]!.position;
    cumulative[i] = cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const total = cumulative[count - 1]!;
  if (total < 1e-9) return null;

  const taperLength = Math.max(total * opts.taper, 1e-6);

  // Two extra vertices close the ends.
  const ringVertexCount = count * sides;
  const vertexCount = ringVertexCount + 2;

  const positions = new Float32Array(vertexCount * 3);
  const normalsOut = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const halfWidth = opts.width * 0.5;
  const radial = vec3();
  const point = vec3();

  for (let i = 0; i < count; i += 1) {
    const sample = samples[i]!;
    const centre = sample.position;
    const n = normals[i]!;
    const b = binormals[i]!;

    const pressure = Math.min(Math.max(sample.pressure, 0), 1);
    const pressureScale =
      opts.minPressureScale +
      (1 - opts.minPressureScale) * Math.pow(pressure, opts.pressureCurve);

    const s = cumulative[i]!;
    const taperScale =
      smoothstep(0, taperLength, s) * smoothstep(0, taperLength, total - s);

    // Keep a sliver of width at the very ends so the cap fan has area and the
    // stroke does not vanish into a zero-area triangle.
    const radius = halfWidth * pressureScale * (0.08 + 0.92 * taperScale);
    const radiusAlongNormal = radius * opts.flatness;
    const u = s / total;

    for (let j = 0; j < sides; j += 1) {
      const theta = (j / sides) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Ellipse in the frame's (binormal, normal) plane.
      radial.x = b.x * cosT * radius + n.x * sinT * radiusAlongNormal;
      radial.y = b.y * cosT * radius + n.y * sinT * radiusAlongNormal;
      radial.z = b.z * cosT * radius + n.z * sinT * radiusAlongNormal;

      add(centre, radial, point);

      const vi = (i * sides + j) * 3;
      positions[vi] = point.x;
      positions[vi + 1] = point.y;
      positions[vi + 2] = point.z;

      // The surface normal of an ellipse is not the radial direction: it is
      // the radial direction with each axis divided by that axis' radius.
      const nx = b.x * cosT * opts.flatness + n.x * sinT;
      const ny = b.y * cosT * opts.flatness + n.y * sinT;
      const nz = b.z * cosT * opts.flatness + n.z * sinT;
      const nl = Math.hypot(nx, ny, nz) || 1;

      normalsOut[vi] = nx / nl;
      normalsOut[vi + 1] = ny / nl;
      normalsOut[vi + 2] = nz / nl;

      const ti = (i * sides + j) * 2;
      uvs[ti] = u;
      uvs[ti + 1] = j / sides;
    }
  }

  // End cap centres.
  const startIndex = ringVertexCount;
  const endIndex = ringVertexCount + 1;
  writeVertex(positions, normalsOut, uvs, startIndex, samples[0]!.position, scale(tangents[0]!, -1), 0, 0.5);
  writeVertex(
    positions,
    normalsOut,
    uvs,
    endIndex,
    samples[count - 1]!.position,
    tangents[count - 1]!,
    1,
    0.5,
  );

  const quadCount = (count - 1) * sides;
  const indices = new Uint32Array(quadCount * 6 + sides * 6);
  let w = 0;

  for (let i = 0; i < count - 1; i += 1) {
    for (let j = 0; j < sides; j += 1) {
      const jNext = (j + 1) % sides;
      const a = i * sides + j;
      const bIdx = i * sides + jNext;
      const c = (i + 1) * sides + jNext;
      const d = (i + 1) * sides + j;

      indices[w++] = a;
      indices[w++] = bIdx;
      indices[w++] = c;

      indices[w++] = a;
      indices[w++] = c;
      indices[w++] = d;
    }
  }

  for (let j = 0; j < sides; j += 1) {
    const jNext = (j + 1) % sides;
    // Start cap winds the opposite way so it faces outward.
    indices[w++] = startIndex;
    indices[w++] = jNext;
    indices[w++] = j;

    const base = (count - 1) * sides;
    indices[w++] = endIndex;
    indices[w++] = base + j;
    indices[w++] = base + jNext;
  }

  return { positions, normals: normalsOut, uvs, indices };
}

function writeVertex(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  index: number,
  position: Vec3,
  normal: Vec3,
  u: number,
  v: number,
): void {
  const vi = index * 3;
  positions[vi] = position.x;
  positions[vi + 1] = position.y;
  positions[vi + 2] = position.z;

  const n = normalize(normal);
  normals[vi] = n.x;
  normals[vi + 1] = n.y;
  normals[vi + 2] = n.z;

  const ti = index * 2;
  uvs[ti] = u;
  uvs[ti + 1] = v;
}

/** Axis-aligned bounds of a finished stroke, for culling and framing. */
export function computeBounds(samples: readonly StrokeSample[], padding = 0): {
  min: Vec3;
  max: Vec3;
} {
  const min = vec3(Infinity, Infinity, Infinity);
  const max = vec3(-Infinity, -Infinity, -Infinity);

  for (const sample of samples) {
    const p = sample.position;
    if (p.x < min.x) min.x = p.x;
    if (p.y < min.y) min.y = p.y;
    if (p.z < min.z) min.z = p.z;
    if (p.x > max.x) max.x = p.x;
    if (p.y > max.y) max.y = p.y;
    if (p.z > max.z) max.z = p.z;
  }

  if (padding !== 0) {
    sub(min, vec3(padding, padding, padding), min);
    add(max, vec3(padding, padding, padding), max);
  }

  return { min, max };
}
