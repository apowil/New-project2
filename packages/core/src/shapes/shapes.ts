/**
 * Parametric shapes.
 *
 * A shape is generated as a *centreline* — the same sample list a freehand
 * stroke produces — so everything downstream already works: the same sweep,
 * the same booleans, the same move, save and export. Nothing here needs a new
 * renderer.
 *
 * The parameters are kept on the node alongside the samples, which is what
 * makes a rectangle still editable as "80 by 50" after it has been drawn
 * rather than being an anonymous bag of points.
 */

import { fromLocal, type Plane } from '../math/plane.js';
import { catmullRom } from '../stroke/resample.js';
import { type StrokeSample } from '../stroke/resample.js';
import { vec3, type Vec3 } from '../math/vec3.js';

export type ShapeKind = 'line' | 'polyline' | 'rectangle' | 'circle' | 'polygon' | 'spline';

/** Points are in the sketch plane's own 2D coordinates, in metres. */
export interface ShapeParams {
  kind: ShapeKind;
  /** Anchor in plane coordinates: a corner for a rectangle, the centre for a circle. */
  u: number;
  v: number;
  /** Rectangle only. */
  width?: number;
  height?: number;
  /** Circle and polygon. */
  radius?: number;
  /** Polygon only. */
  sides?: number;
  /** Rotation about the anchor, radians. */
  rotation?: number;
  /** Line, polyline and spline: the points, in plane coordinates. */
  points?: Array<{ u: number; v: number }>;
  /** Whether the outline joins back to its start. */
  closed?: boolean;
}

/** Segments used to approximate a full circle. Enough to look smooth at any size. */
const CIRCLE_SEGMENTS = 96;

/** Samples per span when smoothing a spline. */
const SPLINE_SEGMENTS = 16;

const sample = (position: Vec3, pressure = 1): StrokeSample => ({ position, pressure });

/**
 * Turns shape parameters into a centreline on `plane`.
 *
 * Returns an empty list for a degenerate shape — a zero-width rectangle, a
 * one-point line — so callers can treat "nothing to draw" as a normal outcome.
 */
export function buildShapeSamples(params: ShapeParams, plane: Plane): StrokeSample[] {
  const rotation = params.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  /** Plane-local point, rotated about the anchor, lifted into world space. */
  const at = (du: number, dv: number): Vec3 =>
    fromLocal(plane, params.u + du * cos - dv * sin, params.v + du * sin + dv * cos);

  switch (params.kind) {
    case 'line':
    case 'polyline':
    case 'spline': {
      const points = params.points ?? [];
      if (points.length < 2) return [];

      const local = points.map((point) => ({ u: point.u - params.u, v: point.v - params.v }));
      if (params.closed && local.length > 2) local.push(local[0]!);

      if (params.kind === 'spline') return splineSamples(local, at);
      return local.map((point) => sample(at(point.u, point.v)));
    }

    case 'rectangle': {
      const width = params.width ?? 0;
      const height = params.height ?? 0;
      if (Math.abs(width) < 1e-9 || Math.abs(height) < 1e-9) return [];

      // Closed: the last point repeats the first so the sweep joins up.
      return [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
        [0, 0],
      ].map(([u, v]) => sample(at(u!, v!)));
    }

    case 'circle': {
      const radius = params.radius ?? 0;
      if (radius < 1e-9) return [];

      return Array.from({ length: CIRCLE_SEGMENTS + 1 }, (_, i) => {
        const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        return sample(at(Math.cos(angle) * radius, Math.sin(angle) * radius));
      });
    }

    case 'polygon': {
      const radius = params.radius ?? 0;
      const sides = Math.max(3, Math.floor(params.sides ?? 3));
      if (radius < 1e-9) return [];

      return Array.from({ length: sides + 1 }, (_, i) => {
        // Start at the top, which is what a regular polygon is expected to do.
        const angle = (i / sides) * Math.PI * 2 + Math.PI / 2;
        return sample(at(Math.cos(angle) * radius, Math.sin(angle) * radius));
      });
    }
  }
}

/** Catmull-Rom through the given points, so a spline passes through each one. */
function splineSamples(
  local: Array<{ u: number; v: number }>,
  at: (u: number, v: number) => Vec3,
): StrokeSample[] {
  const points = local.map((point) => vec3(point.u, point.v, 0));

  // Reflect past the ends rather than duplicating, so the curve keeps its
  // direction at the first and last point instead of going slack.
  const control = (i: number): Vec3 => {
    if (i >= 0 && i < points.length) return points[i]!;
    const anchor = points[i < 0 ? 0 : points.length - 1]!;
    const mirror = points[i < 0 ? 1 : points.length - 2] ?? anchor;
    return vec3(2 * anchor.x - mirror.x, 2 * anchor.y - mirror.y, 0);
  };

  const samples: StrokeSample[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = control(i - 1);
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = control(i + 2);

    for (let step = 0; step < SPLINE_SEGMENTS; step += 1) {
      const point = catmullRom(p0, p1, p2, p3, step / SPLINE_SEGMENTS);
      samples.push(sample(at(point.x, point.y)));
    }
  }

  const last = points[points.length - 1]!;
  samples.push(sample(at(last.x, last.y)));
  return samples;
}

/** The measurements to show for a shape, already in metres. */
export function shapeDimensions(params: ShapeParams): Array<{ label: string; value: number }> {
  switch (params.kind) {
    case 'rectangle':
      return [
        { label: 'Width', value: Math.abs(params.width ?? 0) },
        { label: 'Height', value: Math.abs(params.height ?? 0) },
      ];
    case 'circle':
      return [
        { label: 'Radius', value: params.radius ?? 0 },
        { label: 'Diameter', value: (params.radius ?? 0) * 2 },
      ];
    case 'polygon':
      return [{ label: 'Radius', value: params.radius ?? 0 }];
    case 'line': {
      const points = params.points ?? [];
      const a = points[0];
      const b = points[points.length - 1];
      if (!a || !b) return [];
      return [{ label: 'Length', value: Math.hypot(b.u - a.u, b.v - a.v) }];
    }
    case 'polyline':
    case 'spline': {
      const points = params.points ?? [];
      let total = 0;
      for (let i = 1; i < points.length; i += 1) {
        total += Math.hypot(points[i]!.u - points[i - 1]!.u, points[i]!.v - points[i - 1]!.v);
      }
      return [{ label: 'Length', value: total }];
    }
  }
}

/** Applies an edited dimension, returning new parameters. */
export function withDimension(
  params: ShapeParams,
  label: string,
  metres: number,
): ShapeParams {
  const value = Math.max(metres, 1e-6);

  switch (label) {
    case 'Width':
      // Keep the sign, so a rectangle dragged leftwards stays where it is.
      return { ...params, width: Math.sign(params.width ?? 1) * value };
    case 'Height':
      return { ...params, height: Math.sign(params.height ?? 1) * value };
    case 'Radius':
      return { ...params, radius: value };
    case 'Diameter':
      return { ...params, radius: value / 2 };
    case 'Length': {
      const points = params.points ?? [];
      const a = points[0];
      const b = points[points.length - 1];
      if (!a || !b) return params;

      const current = Math.hypot(b.u - a.u, b.v - a.v);
      if (current < 1e-9) return params;

      // Scale the whole run about its first point, so a polyline keeps shape.
      const factor = value / current;
      return {
        ...params,
        points: points.map((point) => ({
          u: a.u + (point.u - a.u) * factor,
          v: a.v + (point.v - a.v) * factor,
        })),
      };
    }
    default:
      return params;
  }
}
