import { formatLength, sceneScaleSpec } from '@wisp/core';

import { getViewActions, useStore } from '../state/store.js';
import { PLANE_NORMALS, type PlaneMode } from '../viewport/sketchPlane.js';

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
  const sceneScale = useStore((state) => state.sceneScale);
  const range = sceneScaleSpec(sceneScale).planeRange;

  // Turning the camera to face the plane is what makes a drag mean what it
  // looks like: viewed obliquely, a square gesture lands as a squashed
  // parallelogram and the same movement covers a different distance.
  const faceIt = (mode = plane.mode, offset = plane.offset) => {
    const normal = PLANE_NORMALS[mode];
    if (!normal) return;
    getViewActions()?.facePlane(normal, {
      x: normal.x * offset,
      y: normal.y * offset,
      z: normal.z * offset,
    });
  };

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
            onClick={() => {
              setPlaneMode(id);
              // Fixed planes can be faced straight away; 'facing' already is,
              // and 'surface' has no normal until something is tapped.
              // The offset resets to zero when the mode changes, so face the
              // plane at its new position rather than the old one.
              faceIt(id, 0);
            }}
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
          min={-range}
          max={range}
          step={range / 200}
          value={plane.offset}
          onChange={(event) => setPlaneOffset(Number(event.target.value))}
        />
      </label>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => setPlaneOffset(0)}
          className="rounded-lg py-1.5 text-xs text-muted transition-colors hover:bg-line/60 hover:text-secondary"
        >
          Reset depth
        </button>
        <button
          type="button"
          onClick={() => faceIt()}
          disabled={!PLANE_NORMALS[plane.mode]}
          title="Turn the camera to look straight at this plane"
          className="rounded-lg py-1.5 text-xs text-muted transition-colors hover:bg-line/60 hover:text-secondary disabled:opacity-30"
        >
          Face it
        </button>
      </div>

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
