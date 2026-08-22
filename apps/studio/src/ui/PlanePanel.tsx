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
  const setShowIndicator = useStore((state) => state.setShowPlaneIndicator);

  return (
    <div className="panel pointer-events-auto flex w-56 flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-ink-400">Sketch plane</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-400">
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
            className="rounded-lg px-2 py-1.5 text-xs transition-colors"
            style={
              plane.mode === id
                ? { background: 'rgba(125,211,192,0.15)', color: 'var(--color-accent)' }
                : { color: 'var(--color-ink-200)' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between text-[11px] uppercase tracking-wide text-ink-400">
          <span>Depth</span>
          <span className="tabular-nums text-ink-200">{plane.offset.toFixed(2)} m</span>
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
        className="rounded-lg py-1.5 text-xs text-ink-400 transition-colors hover:bg-ink-700/60 hover:text-ink-200"
      >
        Reset depth
      </button>
    </div>
  );
}
