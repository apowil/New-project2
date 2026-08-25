import { registerOpHandler } from '@wisp/core';

import { evaluateBooleanOp } from './boolean.js';

export { evaluateBooleanOp } from './boolean.js';

/**
 * Installs every operation this package implements.
 *
 * Called once wherever operations are executed — the tab's worker, the desktop
 * host's compute processes — so all of them run the same code. That sameness
 * is the point: a boolean evaluated on a PC has to produce the geometry the
 * tablet would have produced, or a sketch changes shape depending on where it
 * was computed.
 */
export function registerHeavyOps(): void {
  registerOpHandler('evaluateBoolean', evaluateBooleanOp);
}
