const KEY = 'wisp.touch-choice-made';

/**
 * Whether the finger-drawing question has already been answered.
 *
 * Remembered so somebody who deliberately keeps one-finger orbit is not asked
 * again every session — the offer exists to rescue people who cannot draw at
 * all, not to nag people who are happy.
 */
export function readFingerChoiceMade(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Storage blocked: better to ask again than to never ask.
    return false;
  }
}

export function rememberFingerChoice(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* nothing to do; the offer simply reappears next time */
  }
}
