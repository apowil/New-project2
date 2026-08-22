import { useEffect, useRef, useState } from 'react';

import { getViewActions } from '../state/store.js';
import { FrameIcon } from './Icons.js';

/**
 * Preset views, an orbit pad and zoom, behind a single button.
 *
 * These are useful but rarely needed twice in a row, so they no longer hold a
 * permanent panel on a screen that has to leave room for drawing.
 */

const HALF = Math.PI / 2;

export const VIEW_PRESETS = [
  { id: 'front', label: 'Front', theta: 0, phi: HALF },
  { id: 'back', label: 'Back', theta: Math.PI, phi: HALF },
  { id: 'left', label: 'Left', theta: -HALF, phi: HALF },
  { id: 'right', label: 'Right', theta: HALF, phi: HALF },
  { id: 'top', label: 'Top', theta: 0, phi: 0.02 },
  { id: 'iso', label: 'Iso', theta: Math.PI * 0.25, phi: Math.PI * 0.36 },
];

/** One nudge step. 15 degrees is fine enough to aim, coarse enough to feel. */
const NUDGE = (Math.PI / 180) * 15;

export function ViewMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const actions = getViewActions();

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="tool-button"
        onClick={() => setOpen((value) => !value)}
        data-active={open}
        aria-expanded={open}
        aria-label="View"
        title="View"
      >
        <FrameIcon />
      </button>

      {open && (
        <div
          className="panel absolute right-0 top-full z-50 mt-2 flex w-44 flex-col gap-2.5 p-2.5"
          role="dialog"
          aria-label="View"
        >
          <div className="grid grid-cols-3 gap-1">
            {VIEW_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="chip"
                onClick={() => actions?.preset(preset.theta, preset.phi)}
                title={`${preset.label} view`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 grid-rows-3 gap-1 self-center">
            <span />
            <PadButton label="Orbit up" onClick={() => actions?.nudge(0, -NUDGE)} rotate={0} />
            <span />
            <PadButton label="Orbit left" onClick={() => actions?.nudge(NUDGE, 0)} rotate={270} />
            <button
              type="button"
              className="chip flex items-center justify-center"
              onClick={() => actions?.frameAll()}
              aria-label="Frame everything"
              title="Frame everything (F)"
            >
              <FrameIcon className="h-4 w-4" />
            </button>
            <PadButton label="Orbit right" onClick={() => actions?.nudge(-NUDGE, 0)} rotate={90} />
            <span />
            <PadButton label="Orbit down" onClick={() => actions?.nudge(0, NUDGE)} rotate={180} />
            <span />
          </div>

          <div className="grid grid-cols-2 gap-1">
            <button type="button" className="chip" onClick={() => actions?.zoom(1 / 1.3)} aria-label="Zoom in">
              Closer
            </button>
            <button type="button" className="chip" onClick={() => actions?.zoom(1.3)} aria-label="Zoom out">
              Further
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PadButton({
  label,
  onClick,
  rotate,
}: {
  label: string;
  onClick: () => void;
  rotate: number;
}) {
  return (
    <button
      type="button"
      className="chip flex items-center justify-center"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: `rotate(${rotate}deg)` }}
        aria-hidden="true"
      >
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  );
}
