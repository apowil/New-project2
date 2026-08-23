import { formatLength, type ShapeKind } from '@wisp/core';

import { useStore } from '../state/store.js';
import { isMultiPoint } from '../tools/shapeTool.js';

const KINDS: Array<{ id: ShapeKind; label: string; hint: string }> = [
  { id: 'line', label: 'Line', hint: 'Drag from one end to the other' },
  { id: 'rectangle', label: 'Rect', hint: 'Drag from one corner to the opposite one' },
  { id: 'circle', label: 'Circle', hint: 'Drag outwards from the centre' },
  { id: 'polygon', label: 'Polygon', hint: 'Drag outwards from the centre; the drag sets the angle' },
  { id: 'polyline', label: 'Polyline', hint: 'Tap each corner; Enter or double-tap to finish' },
  { id: 'spline', label: 'Spline', hint: 'Tap each point for a smooth curve through them' },
];

/**
 * The shape tool's settings and its live measurements.
 *
 * The readout is here rather than following the cursor because a value that
 * moves under a pen is hard to read while the same hand is drawing.
 */
export function ShapePanel({ onFinish }: { onFinish: (closed: boolean) => void }) {
  const kind = useStore((state) => state.shapeKind);
  const setKind = useStore((state) => state.setShapeKind);
  const sides = useStore((state) => state.polygonSides);
  const setSides = useStore((state) => state.setPolygonSides);
  const readout = useStore((state) => state.shapeReadout);
  const unit = useStore((state) => state.unit);

  const chaining = isMultiPoint(kind);

  return (
    <div className="panel pointer-events-auto flex w-56 flex-col gap-3 p-3">
      <span className="section-label">Shape</span>

      <div className="grid grid-cols-3 gap-1">
        {KINDS.map(({ id, label, hint }) => (
          <button
            key={id}
            type="button"
            className="chip"
            data-active={kind === id}
            onClick={() => setKind(id)}
            title={hint}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === 'polygon' && (
        <label className="flex flex-col gap-1.5">
          <span className="section-label flex justify-between">
            <span>Sides</span>
            <span className="tabular-nums text-secondary">{sides}</span>
          </span>
          <input
            type="range"
            min={3}
            max={16}
            step={1}
            value={sides}
            onChange={(event) => setSides(Number(event.target.value))}
            aria-label="Polygon sides"
          />
        </label>
      )}

      {readout && readout.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          {readout.map(({ label, value }) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-muted">{label}</span>
              <span className="tabular-nums text-primary">{formatLength(value, unit)}</span>
            </div>
          ))}
        </div>
      )}

      {chaining && (
        <div className="grid grid-cols-2 gap-1 border-t border-line pt-3">
          <button type="button" className="chip" onClick={() => onFinish(false)}>
            Finish
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => onFinish(true)}
            title="Join the last point back to the first"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
