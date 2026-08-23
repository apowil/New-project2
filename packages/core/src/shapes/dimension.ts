/**
 * Drawing a dimension.
 *
 * The node stores only the two points, an offset and a text height; the
 * witness lines, arrows and the number itself are generated here, every time.
 * That is deliberate: it means the number follows the current unit, so a
 * dimension drawn in metres reads in millimetres the moment the unit changes,
 * instead of sitting there insisting on a value nobody asked for any more.
 */

import { type AnnotationNode } from '../document/types.js';
import { makePlane } from '../math/plane.js';
import {
  add,
  addScaled,
  cross,
  distance,
  normalize,
  scale,
  sub,
  vec3,
  type Vec3,
} from '../math/vec3.js';
import { formatLength, type Unit } from '../units.js';
import { buildTextPolylines, measureText } from './text.js';

/** Arrow head length, as a fraction of the text height. */
const ARROW = 0.9;
/** How far the witness lines overshoot the dimension line, in text heights. */
const OVERSHOOT = 0.35;
/** Gap between the measured point and the start of its witness line. */
const GAP = 0.3;

export interface DimensionParts {
  /** Witness lines, dimension line and arrow heads. */
  lines: Vec3[][];
  /** The number, as glyph polylines. */
  text: Vec3[][];
  /** Distance being measured, in metres. */
  length: number;
}

/**
 * Builds every polyline that makes up a dimension, in world space.
 *
 * Returned in two groups because callers usually want them swept at different
 * weights — a dimension whose number is as heavy as its arrows is hard to
 * read.
 */
export function buildDimension(node: AnnotationNode, unit: Unit): DimensionParts {
  const length = distance(node.from, node.to);
  const size = Math.max(node.textSize, 1e-6);

  // Along the measured line. A zero-length dimension has no direction to lay
  // anything out along, so nothing is drawn rather than dividing by zero.
  const along = sub(node.to, node.from);
  if (length < 1e-9) return { lines: [], text: [], length: 0 };
  const u = scale(along, 1 / length);

  // The offset direction is squared up against the measured line, so the
  // witness lines meet the dimension line at a right angle however the
  // caller happened to supply it.
  const roughOut = normalize(node.offsetDirection);
  const normal = cross(u, roughOut);
  const out =
    Math.hypot(normal.x, normal.y, normal.z) < 1e-6
      ? // Offset parallel to the line: pick any perpendicular rather than
        // collapsing the whole dimension onto its own axis.
        normalize(cross(u, Math.abs(u.y) > 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0)))
      : normalize(cross(normalize(normal), u));

  const start = addScaled(node.from, out, node.offset);
  const end = addScaled(node.to, out, node.offset);

  const lines: Vec3[][] = [
    // Witness lines, standing off the measured points so they do not touch.
    [addScaled(node.from, out, Math.sign(node.offset || 1) * GAP * size),
     addScaled(start, out, Math.sign(node.offset || 1) * OVERSHOOT * size)],
    [addScaled(node.to, out, Math.sign(node.offset || 1) * GAP * size),
     addScaled(end, out, Math.sign(node.offset || 1) * OVERSHOOT * size)],
    [start, end],
    ...arrowHead(start, u, out, size),
    ...arrowHead(end, scale(u, -1), out, size),
  ];

  const label = formatLength(length, unit);
  const plane = makePlane(start, cross(u, out), u);
  const measured = measureText({ text: label, size, u: 0, v: 0 });

  // Centred along the line and sitting just above it, which is where a
  // dimension's number is expected to be.
  const text = buildTextPolylines(
    {
      text: label,
      size,
      u: (length - measured.width) / 2,
      v: 0.4 * size,
    },
    plane,
  );

  return { lines, text, length };
}

/** Two short strokes forming an open arrow at `tip`, pointing along `dir`. */
function arrowHead(tip: Vec3, dir: Vec3, out: Vec3, size: number): Vec3[][] {
  const back = scale(dir, ARROW * size);
  const side = scale(out, ARROW * size * 0.32);
  return [
    [tip, add(add(tip, back), side)],
    [tip, sub(add(tip, back), side)],
  ];
}
