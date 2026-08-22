import { useRef } from 'react';

import { useStore } from '../state/store.js';
import { CloseIcon, EyeIcon, EyeOffIcon } from './Icons.js';

/**
 * A floating reference image you can trace over.
 *
 * With "draw through" on, the image ignores the pointer entirely, so a stroke
 * started on the canvas runs straight across it — which is the whole point of
 * a tracing reference. The title bar keeps pointer events either way, so it
 * can still be moved.
 */
export function ReferenceOverlay() {
  const reference = useStore((state) => state.reference);
  const update = useStore((state) => state.updateReference);
  const clear = useStore((state) => state.clearReference);

  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const resize = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  if (!reference) return null;

  const onDragStart = (event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - reference.x,
      offsetY: event.clientY - reference.y,
    };
  };

  const onDragMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    update({
      x: Math.round(event.clientX - state.offsetX),
      y: Math.round(event.clientY - state.offsetY),
    });
  };

  const onDragEnd = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
    if (resize.current?.pointerId === event.pointerId) resize.current = null;
  };

  const onResizeStart = (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: reference.width,
    };
  };

  const onResizeMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = resize.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    update({ width: Math.max(120, Math.round(state.startWidth + (event.clientX - state.startX))) });
  };

  return (
    <div
      className="pointer-events-none absolute z-10"
      style={{ left: reference.x, top: reference.y, width: reference.width }}
    >
      <div className="panel pointer-events-auto flex items-center gap-1 rounded-b-none px-2 py-1">
        <span
          className="flex-1 cursor-move truncate text-[11px] text-muted"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          title="Drag to move"
        >
          {reference.name}
        </span>

        <label className="flex items-center gap-1 text-[11px] text-muted" title="Opacity">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={reference.opacity}
            onChange={(event) => update({ opacity: Number(event.target.value) })}
            aria-label="Reference opacity"
            className="w-16"
          />
        </label>

        <button
          type="button"
          onClick={() => update({ drawThrough: !reference.drawThrough })}
          data-active={reference.drawThrough}
          className="chip px-1.5 py-1"
          title={
            reference.drawThrough
              ? 'Strokes pass through the image'
              : 'The image blocks the pointer'
          }
          aria-pressed={reference.drawThrough}
        >
          Trace
        </button>

        <button
          type="button"
          onClick={() => update({ visible: !reference.visible })}
          className="rounded p-1 text-muted transition-colors hover:text-primary"
          aria-label={reference.visible ? 'Hide reference' : 'Show reference'}
          title={reference.visible ? 'Hide' : 'Show'}
        >
          {reference.visible ? <EyeIcon /> : <EyeOffIcon />}
        </button>

        <button
          type="button"
          onClick={clear}
          className="rounded p-1 text-muted transition-colors hover:text-danger"
          aria-label="Remove reference"
          title="Remove"
        >
          <CloseIcon />
        </button>
      </div>

      {reference.visible && (
        <div
          className="relative overflow-hidden rounded-b-2xl border border-t-0 border-line"
          style={{ pointerEvents: reference.drawThrough ? 'none' : 'auto' }}
        >
          <img
            src={reference.src}
            alt={`Reference: ${reference.name}`}
            className="block w-full select-none"
            style={{ opacity: reference.opacity }}
            draggable={false}
          />

          <span
            className="pointer-events-auto absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
            style={{
              background:
                'linear-gradient(135deg, transparent 50%, var(--color-line-strong) 50%)',
            }}
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            role="slider"
            aria-label="Resize reference"
            aria-valuenow={reference.width}
            aria-valuemin={120}
            aria-valuemax={2000}
            tabIndex={0}
          />
        </div>
      )}
    </div>
  );
}
