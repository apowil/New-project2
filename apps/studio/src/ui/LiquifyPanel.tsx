import { formatLength, type LiquifyMode } from '@wisp/core';

import { liquifyRadiusRange, useStore } from '../state/store.js';

const MODES: Array<{ id: LiquifyMode; label: string; hint: string }> = [
  { id: 'push', label: 'Push', hint: 'Drag the strokes under the brush along with it' },
  { id: 'pull', label: 'Pull', hint: 'Draw them in toward the brush — hold to keep tightening' },
  { id: 'twist', label: 'Twist', hint: 'Press, then drag sideways to turn what is under the brush' },
  { id: 'smooth', label: 'Smooth', hint: 'Relax a wobble out — hold to keep going' },
];

export function LiquifyPanel() {
  const liquify = useStore((state) => state.liquify);
  const setLiquify = useStore((state) => state.setLiquify);
  const unit = useStore((state) => state.unit);
  const sceneScale = useStore((state) => state.sceneScale);
  const selectionCount = useStore((state) => state.selection.length);
  const { min, max } = liquifyRadiusRange(sceneScale);

  return (
    <div className="panel pointer-events-auto flex w-56 flex-col gap-3 p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted">Reshape</span>

      <div className="grid grid-cols-2 gap-1">
        {MODES.map(({ id, label, hint }) => (
          <button
            key={id}
            type="button"
            title={hint}
            onClick={() => setLiquify({ mode: id })}
            className="chip"
            data-active={liquify.mode === id}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between text-[11px] uppercase tracking-wide text-muted">
          <span>Brush</span>
          <span className="tabular-nums text-secondary">{formatLength(liquify.radius, unit)}</span>
        </span>
        <input
          type="range"
          aria-label="Brush size"
          min={min}
          max={max}
          step={(max - min) / 200}
          value={liquify.radius}
          onChange={(event) => setLiquify({ radius: Number(event.target.value) })}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between text-[11px] uppercase tracking-wide text-muted">
          <span>Strength</span>
          <span className="tabular-nums text-secondary">{Math.round(liquify.strength * 100)}%</span>
        </span>
        <input
          type="range"
          aria-label="Brush strength"
          min={0.02}
          max={1}
          step={0.02}
          value={liquify.strength}
          onChange={(event) => setLiquify({ strength: Number(event.target.value) })}
        />
      </label>

      {/* Which strokes are in play is the one thing about this tool that is
          not obvious from looking at it, so it says so rather than leaving
          somebody to discover it by warping the wrong thing. */}
      <p className="border-t border-line/70 pt-2 text-[11px] leading-relaxed text-muted">
        {selectionCount > 0
          ? `Reshaping ${selectionCount === 1 ? 'the selected stroke' : `${selectionCount} selected strokes`}.`
          : 'Reshaping whatever the brush covers. Select first to narrow it.'}
      </p>
    </div>
  );
}
