import { FrameIcon } from './Icons.js';

/**
 * Preset views and an orbit pad.
 *
 * Gestures are the fast way to move the camera, but they need a free hand.
 * These give you named angles and precise nudges without putting the pen
 * down — and they are the only way to orbit at all if you have the app set to
 * draw with a finger.
 */

const HALF = Math.PI / 2;

export interface ViewPreset {
  id: string;
  label: string;
  theta: number;
  phi: number;
}

export const VIEW_PRESETS: ViewPreset[] = [
  { id: 'front', label: 'Front', theta: 0, phi: HALF },
  { id: 'back', label: 'Back', theta: Math.PI, phi: HALF },
  { id: 'left', label: 'Left', theta: -HALF, phi: HALF },
  { id: 'right', label: 'Right', theta: HALF, phi: HALF },
  { id: 'top', label: 'Top', theta: 0, phi: 0.02 },
  { id: 'iso', label: 'Iso', theta: Math.PI * 0.25, phi: Math.PI * 0.36 },
];

/** One nudge step, in radians. 15° is fine enough to aim, coarse enough to feel. */
export const NUDGE = (Math.PI / 180) * 15;

interface ViewPanelProps {
  onPreset: (preset: ViewPreset) => void;
  onNudge: (deltaTheta: number, deltaPhi: number) => void;
  onZoom: (factor: number) => void;
  onFrameAll: () => void;
}

export function ViewPanel({ onPreset, onNudge, onZoom, onFrameAll }: ViewPanelProps) {
  return (
    <div className="panel pointer-events-auto flex w-44 flex-col gap-2.5 p-2.5">
      <span className="section-label px-0.5">View</span>

      <div className="grid grid-cols-3 gap-1">
        {VIEW_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="chip"
            onClick={() => onPreset(preset)}
            title={`${preset.label} view`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Orbit pad: a plus layout reads as directional without needing labels. */}
      <div className="grid grid-cols-3 grid-rows-3 gap-1 self-center">
        <span />
        <button
          type="button"
          className="chip flex items-center justify-center"
          onClick={() => onNudge(0, -NUDGE)}
          aria-label="Orbit up"
          title="Orbit up"
        >
          <Chevron direction="up" />
        </button>
        <span />

        <button
          type="button"
          className="chip flex items-center justify-center"
          onClick={() => onNudge(NUDGE, 0)}
          aria-label="Orbit left"
          title="Orbit left"
        >
          <Chevron direction="left" />
        </button>
        <button
          type="button"
          className="chip flex items-center justify-center"
          onClick={onFrameAll}
          aria-label="Frame everything"
          title="Frame everything (F)"
        >
          <FrameIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="chip flex items-center justify-center"
          onClick={() => onNudge(-NUDGE, 0)}
          aria-label="Orbit right"
          title="Orbit right"
        >
          <Chevron direction="right" />
        </button>

        <span />
        <button
          type="button"
          className="chip flex items-center justify-center"
          onClick={() => onNudge(0, NUDGE)}
          aria-label="Orbit down"
          title="Orbit down"
        >
          <Chevron direction="down" />
        </button>
        <span />
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          className="chip"
          onClick={() => onZoom(1 / 1.3)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          Closer
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => onZoom(1.3)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          Further
        </button>
      </div>
    </div>
  );
}

function Chevron({ direction }: { direction: 'up' | 'down' | 'left' | 'right' }) {
  const rotation = { up: 0, right: 90, down: 180, left: 270 }[direction];
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}
