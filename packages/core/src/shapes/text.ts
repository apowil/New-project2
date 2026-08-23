/**
 * Laying text out as polylines on a sketch plane.
 *
 * The result is a list of centrelines, which the caller sweeps with the
 * current brush — so text is drawn in the same material as everything else and
 * takes part in booleans, moves and exports without special handling.
 */

import { fromLocal, type Plane } from '../math/plane.js';
import { type Vec3 } from '../math/vec3.js';
import { ADVANCE, LINE_HEIGHT, glyphFor } from './font.js';

export interface TextParams {
  text: string;
  /** Cap height in metres. */
  size: number;
  /** Anchor in plane coordinates. */
  u: number;
  v: number;
  align?: 'left' | 'centre' | 'right';
}

/** Width of one line in em, before scaling. */
const lineWidthEm = (line: string): number =>
  line.length === 0 ? 0 : (line.length - 1) * ADVANCE + 0.55;

/**
 * Returns one polyline per pen-down run, in world space.
 *
 * An empty result means there was nothing to draw — an empty string, or only
 * whitespace — which callers should treat as a no-op rather than an error.
 */
export function buildTextPolylines(params: TextParams, plane: Plane): Vec3[][] {
  const size = Math.max(params.size, 1e-6);
  const lines = params.text.split('\n');
  const align = params.align ?? 'left';

  const widest = Math.max(...lines.map(lineWidthEm), 0);
  const polylines: Vec3[][] = [];

  lines.forEach((line, lineIndex) => {
    const width = lineWidthEm(line);
    const indent =
      align === 'centre' ? (widest - width) / 2 : align === 'right' ? widest - width : 0;

    // Lines run downward from the anchor, which is the top-left of the block.
    const baseline = -lineIndex * LINE_HEIGHT;

    [...line].forEach((character, columnIndex) => {
      const originU = indent + columnIndex * ADVANCE;

      for (const polyline of glyphFor(character)) {
        polylines.push(
          polyline.map(([x, y]) =>
            fromLocal(
              plane,
              params.u + (originU + (x ?? 0)) * size,
              params.v + (baseline + (y ?? 0)) * size,
            ),
          ),
        );
      }
    });
  });

  return polylines;
}

/** Size of the text block in metres, for framing and dimension readouts. */
export function measureText(params: TextParams): { width: number; height: number } {
  const lines = params.text.split('\n');
  const widest = Math.max(...lines.map(lineWidthEm), 0);
  return {
    width: widest * params.size,
    // Cap height for the first line, plus a full line height for each after.
    height: (1 + (lines.length - 1) * LINE_HEIGHT) * params.size,
  };
}
