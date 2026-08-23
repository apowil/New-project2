import { formatLength } from '@wisp/core';

import { useStore } from '../state/store.js';
import { type PlaneMode } from '../viewport/sketchPlane.js';

const MODES: Array<{ id: PlaneMode; label: string; hint: string }> = [
  { id: 'camera', label: 'Facing', hint: 'A plane facing you — draw what you see' },
  { id: 'ground', label: 'Ground', hint: 'The horizontal floor plane' },
  { id: 'front', label: 'Front', hint: 'The vertical XY plane' },
  { id: 'side', label: 'Side', hint: 'The vertical YZ plane' },
  { id: 'surface', label: 'Surface', hint: 'Tap geometry with the plane tool to anchor here' },
];

export function PlanePanel() {
  const plane = useStore((state) => state.plane);
  const setPlaneMode = useStore((state) => state.setPlaneMode);
  const setPlaneOffset = useStore((state) => state.setPlaneOffset);
  const showIndicator = useStore((state) => state.showPlaneIndicator);
  const unit = useStore((state) => state.unit);
  const setShowIndicator = useStore((state) => state.setShowPlaneIndicator);

  return (
    <div className="panel pointer-events-auto flex w-56 flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted">Sketch plane</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={showIndicator}
            onChange={(event) => setShowIndicator(event.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Show
        </label>
      </div>

      <div className="grid grid-cols-3 gap-1">
        {MODES.map(({ id, label, hint }) => (
          <button
            key={id}
            type="button"
            title={hint}
            onClick={() => setPlaneMode(id)}
            className="chip"
            data-active={plane.mode === id}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between text-[11px] uppercase tracking-wide text-muted">
          <span>Depth</span>
          <span className="tabular-nums text-secondary">{formatLength(plane.offset, unit)}</span>
        </span>
        <input
          type="range"
          min={-4}
          max={4}
          step={0.02}
          value={plane.offset}
          onChange={(event) => setPlaneOffset(Number(event.target.value))}
        />
      </label>

      <button
        type="button"
        onClick={() => setPlaneOffset(0)}
        className="rounded-lg py-1.5 text-xs text-muted transition-colors hover:bg-line/60 hover:text-secondary"
      >
        Reset depth
      </button>

      <MirrorRow />
    </div>
  );
}

/** Axis colours follow the usual convention: X red, Y green, Z blue. */
const MIRROR_AXES = [
  { axis: 'x' as const, label: 'X', color: '#e5556f' },
  { axis: 'y' as const, label: 'Y', color: '#5aa832' },
  { axis: 'z' as const, label: 'Z', color: '#3b7fe0' },
];

function MirrorRow() {
  const mirror = useStore((state) => state.mirror);
  const toggleMirror = useStore((state) => state.toggleMirror);
  const active = MIRROR_AXES.filter(({ axis }) => mirror[axis]).length;

  return (
    <div className="flex flex-col gap-1.5 border-t border-line/70 pt-3">
      <span className="flex items-baseline justify-between text-[11px] uppercase tracking-wide text-muted">
        <span>Symmetry</span>
        {active > 0 && (
          <span className="normal-case tracking-normal text-secondary">
            {2 ** active} copies
          </span>
        )}
      </span>

      <div className="grid grid-cols-3 gap-1">
        {MIRROR_AXES.map(({ axis, label, color }) => (
          <button
            key={axis}
            type="button"
            onClick={() => toggleMirror(axis)}
            aria-pressed={mirror[axis]}
            title={`Mirror across the ${label} axis`}
            className="chip w-full font-medium"
            style={
              mirror[axis]
                ? { background: `color-mix(in srgb, ${color} 18%, transparent)`, color }
                : undefined
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
