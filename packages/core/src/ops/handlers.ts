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

/**
 * Adds an implementation this package cannot provide itself.
 *
 * Called once at startup on each side that runs operations — the tab, the
 * worker, the desktop host — with the *same* function, so a boolean evaluated
 * on a PC produces the geometry the tablet would have produced. Divergence
 * here would mean a sketch that changes shape depending on where it was
 * computed, which is the kind of bug that is very hard to see and very hard to
 * live with.
 */
export function registerOpHandler<K extends OpName>(
  name: K,
  handler: (request: OpRequestMap[K]) => OpResponseMap[K],
): void {
  // The map is keyed by a union, so TypeScript cannot see that this handler
  // matches this key; the signature above is what actually enforces it.
  handlers[name] = handler as OpHandlers[K];
}

/** Runs operations on the calling thread. The always-available fallback. */
export class InlineOpRunner implements OpRunner {
  readonly description = 'On device';

  async run<K extends OpName>(name: K, request: OpRequestMap[K]): Promise<OpResponseMap[K]> {
    return runOp(name, request);
  }
}

/** Dispatches to a registered handler, or says plainly that there is none. */
export function runOp<K extends OpName>(name: K, request: OpRequestMap[K]): OpResponseMap[K] {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`No handler registered for the "${name}" operation.`);
  }
  return handler(request as never) as OpResponseMap[K];
}
