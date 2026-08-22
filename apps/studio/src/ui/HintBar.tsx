import { useEffect, useState } from 'react';

import { useStore } from '../state/store.js';

const DISMISSED_KEY = 'wisp.hintsSeen';

/**
 * A short prompt for the current tool, dismissed for good once read.
 *
 * The gesture rules used to sit permanently in the corner, which is the wrong
 * trade: they matter for the first minute and are clutter forever after. This
 * says only what the active tool needs, and goes away when you close it.
 */
const HINTS: Record<string, string> = {
  draw: 'Pen draws · one finger orbits · two fingers pan and zoom',
  select: 'Tap to select · drag a box for several · drag a selected item to move it',
  erase: 'Tap or drag across a stroke to remove it',
  plane: 'Tap any surface to plant the sketch plane on it',
};

export function HintBar() {
  const tool = useStore((state) => state.tool);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === '1');
    } catch {
      // Storage blocked: show the hints, since nothing can remember them.
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;
  const hint = HINTS[tool];
  if (!hint) return null;

  return (
    <div className="panel pointer-events-auto absolute bottom-4 right-4 flex max-w-72 items-start gap-2 px-3 py-2">
      <p className="text-[11px] leading-relaxed text-muted">{hint}</p>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(DISMISSED_KEY, '1');
          } catch {
            /* it will simply come back next time */
          }
        }}
        className="shrink-0 text-[11px] text-muted transition-colors hover:text-primary"
        aria-label="Dismiss hints"
      >
        Got it
      </button>
    </div>
  );
}
