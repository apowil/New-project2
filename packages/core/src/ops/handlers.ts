/**
 * The actual implementations behind {@link OpRunner}. Pure functions of their
 * request — no DOM, no globals — which is what lets them run unchanged inside
 * a Web Worker or on the desktop host.
 */

import { buildStrokeGeometry } from '../stroke/geometry.js';
import { resampleUniform, simplify, smoothPositions } from '../stroke/resample.js';
import { type OpHandlers, type OpName, type OpRequestMap, type OpResponseMap, type OpRunner } from './types.js';

export const handlers: OpHandlers = {
  buildStroke: ({ samples, options }) => buildStrokeGeometry(samples, options),

  processStroke: ({ samples, simplifyTolerance, spacing, smoothing }) => {
    const simplified = simplify(samples, simplifyTolerance);
    const resampled = resampleUniform(simplified, spacing);
    return { samples: smoothPositions(resampled, smoothing, 2) };
  },
};

/** Runs operations on the calling thread. The always-available fallback. */
export class InlineOpRunner implements OpRunner {
  readonly description = 'On device';

  async run<K extends OpName>(name: K, request: OpRequestMap[K]): Promise<OpResponseMap[K]> {
    return handlers[name](request as never) as OpResponseMap[K];
  }
}
