import { useEffect, useRef, useState } from 'react';

import { shapeDimensions } from '@wisp/core';

import { session, useStore } from '../state/store.js';
import { BOOLEAN_LABELS, type BooleanOp } from '../tools/booleans.js';
import { CopyIcon, ScissorsIcon, StackIcon, TrashIcon } from './Icons.js';
import { LengthField } from './LengthField.js';

/**
 * Actions follow the selection instead of living in a corner.
 *
 * Reaching a fixed panel means looking away from what you selected and
 * crossing the screen with a pen — on a tablet that is most of the width. The
 * bar appears just above whatever is selected, which is where your attention
 * already is.
 */

const OPS: Array<{ op: BooleanOp; hint: string }> = [
  { op: 'union', hint: 'Fuse into one solid, removing the buried surfaces' },
  { op: 'subtract', hint: 'Cut the later shapes out of the first' },
  { op: 'intersect', hint: 'Keep only the volume they share' },
  { op: 'join', hint: 'Group without cutting — works on any shapes' },
];

export function SelectionContextBar() {
  const selection = useStore((state) => state.selection);
  const anchor = useStore((state) => state.selectionAnchor);
  const layers = useStore((state) => state.layers);
  const clipboardSize = useStore((state) => state.clipboard.length);

  const applyBoolean = useStore((state) => state.applyBoolean);
  const copySelection = useStore((state) => state.copySelection);
  const cutSelection = useStore((state) => state.cutSelection);
  const paste = useStore((state) => state.paste);
  const deleteSelection = useStore((state) => state.deleteSelection);
  const moveSelectionToLayer = useStore((state) => state.moveSelectionToLayer);

  const unit = useStore((state) => state.unit);
  const editShapeDimension = useStore((state) => state.editShapeDimension);

  const [menu, setMenu] = useState<'combine' | 'layer' | 'size' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [menu]);

  // A menu left open over a stale position is worse than one that closes.
  useEffect(() => setMenu(null), [selection]);

  if (selection.length === 0 || !anchor) return null;

  const count = selection.length;
  const enoughForBoolean = count >= 2;

  // A shape drawn with a shape tool kept its parameters, so it can still be
  // resized by typing. One at a time: editing several at once would need a
  // shared meaning for "width" that these shapes do not have.
  const soleNode = count === 1 ? session.document.nodes.get(selection[0]!) : undefined;
  const shape =
    soleNode && soleNode.type === 'stroke' && soleNode.shape ? soleNode.shape.params : null;
  const dimensions = shape ? shapeDimensions(shape) : [];

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto absolute z-30 -translate-x-1/2 -translate-y-full"
      // Kept clear of the very top edge so the bar never sits half off-screen.
      style={{ left: anchor.x, top: Math.max(anchor.y - 18, 96) }}
    >
      <div className="panel flex items-center gap-0.5 p-1">
        <span className="px-2 text-[11px] tabular-nums text-muted">{count}</span>

        <div className="mx-0.5 h-6 w-px bg-line" />

        <BarButton label="Copy" onClick={copySelection} title="Copy (Ctrl+C)">
          <CopyIcon />
        </BarButton>

        <BarButton label="Cut" onClick={cutSelection} title="Cut (Ctrl+X)">
          <ScissorsIcon />
        </BarButton>

        <BarButton
          label="Paste"
          onClick={paste}
          disabled={clipboardSize === 0}
          title={clipboardSize === 0 ? 'Nothing copied yet' : `Paste ${clipboardSize} (Ctrl+V)`}
        >
          <span className="text-xs">Paste</span>
        </BarButton>

        <div className="mx-0.5 h-6 w-px bg-line" />

        <BarButton
          label="Combine"
          onClick={() => setMenu((open) => (open === 'combine' ? null : 'combine'))}
          disabled={!enoughForBoolean}
          active={menu === 'combine'}
          title={enoughForBoolean ? 'Boolean operations' : 'Select two or more items first'}
        >
          <span className="text-xs">Combine</span>
        </BarButton>

        {dimensions.length > 0 && (
          <BarButton
            label="Size"
            onClick={() => setMenu((open) => (open === 'size' ? null : 'size'))}
            active={menu === 'size'}
            title="Type exact dimensions"
          >
            <span className="text-xs">Size</span>
          </BarButton>
        )}

        <BarButton
          label="Layer"
          onClick={() => setMenu((open) => (open === 'layer' ? null : 'layer'))}
          active={menu === 'layer'}
          title="Move to another layer"
        >
          <StackIcon />
        </BarButton>

        <div className="mx-0.5 h-6 w-px bg-line" />

        <BarButton label="Delete" onClick={deleteSelection} title="Delete (Del)" danger>
          <TrashIcon className="h-4 w-4" />
        </BarButton>
      </div>

      {menu === 'combine' && (
        <div className="panel mt-1.5 flex w-52 flex-col gap-0.5 p-1.5">
          {OPS.map(({ op, hint }) => (
            <button
              key={op}
              type="button"
              className="chip text-left"
              onClick={() => {
                applyBoolean(op);
                setMenu(null);
              }}
              title={hint}
            >
              {BOOLEAN_LABELS[op]}
            </button>
          ))}
        </div>
      )}

      {menu === 'size' && shape && (
        <div className="panel mt-1.5 flex w-56 flex-col gap-2 p-2.5">
          <span className="section-label">{shape.kind}</span>
          {dimensions.map(({ label, value }) => (
            <LengthField
              key={label}
              label={label}
              value={value}
              unit={unit}
              min={1e-5}
              onCommit={(metres) => editShapeDimension(selection[0]!, label, metres)}
            />
          ))}
        </div>
      )}

      {menu === 'layer' && (
        <div className="panel mt-1.5 flex w-44 flex-col gap-0.5 p-1.5">
          {layers.map((layer) => (
            <button
              key={layer.id}
              type="button"
              className="chip truncate text-left"
              onClick={() => {
                moveSelectionToLayer(layer.id);
                setMenu(null);
              }}
            >
              {layer.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface BarButtonProps {
  label: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}

function BarButton({
  label,
  title,
  onClick,
  children,
  disabled,
  active,
  danger,
}: BarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      data-active={active}
      className="flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-secondary transition-colors hover:bg-line/70 disabled:pointer-events-none disabled:opacity-30"
      style={
        active
          ? { background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', color: 'var(--color-accent)' }
          : danger
            ? { color: 'var(--color-danger)' }
            : undefined
      }
    >
      {children}
    </button>
  );
}

/** The rubber-band rectangle drawn while dragging a box selection. */
export function Marquee() {
  const marquee = useStore((state) => state.marquee);
  if (!marquee) return null;

  const left = Math.min(marquee.x0, marquee.x1);
  const top = Math.min(marquee.y0, marquee.y1);

  return (
    <div
      className="pointer-events-none absolute rounded-sm border border-dashed"
      style={{
        left,
        top,
        width: Math.abs(marquee.x1 - marquee.x0),
        height: Math.abs(marquee.y1 - marquee.y0),
        borderColor: 'var(--color-accent)',
        background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
      }}
      aria-hidden="true"
    />
  );
}
