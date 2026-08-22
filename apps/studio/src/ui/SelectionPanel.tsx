import { session, useStore } from '../state/store.js';
import { BOOLEAN_LABELS, type BooleanOp } from '../tools/booleans.js';
import { CopyIcon, TrashIcon } from './Icons.js';

/**
 * Appears only when something is selected. Boolean operations need at least
 * two items, so those stay disabled until there are, with the reason in the
 * tooltip rather than a silent no-op.
 */

const OPS: Array<{ op: BooleanOp; hint: string }> = [
  { op: 'union', hint: 'Fuse the shapes into one solid, removing the buried surfaces' },
  { op: 'subtract', hint: 'Cut every later shape out of the first one' },
  { op: 'intersect', hint: 'Keep only the volume all the shapes share' },
  { op: 'join', hint: 'Group them into one object without cutting anything' },
];

export function SelectionPanel() {
  const selection = useStore((state) => state.selection);
  const layers = useStore((state) => state.layers);
  const activeLayerId = useStore((state) => state.activeLayerId);
  const clipboardSize = useStore((state) => state.clipboard.length);

  const applyBoolean = useStore((state) => state.applyBoolean);
  const copySelection = useStore((state) => state.copySelection);
  const cutSelection = useStore((state) => state.cutSelection);
  const paste = useStore((state) => state.paste);
  const deleteSelection = useStore((state) => state.deleteSelection);
  const clearSelection = useStore((state) => state.clearSelection);
  const moveSelectionToLayer = useStore((state) => state.moveSelectionToLayer);

  if (selection.length === 0) return null;

  const count = selection.length;
  const enoughForBoolean = count >= 2;
  const currentLayer =
    session.document.nodes.get(selection[0]!)?.layerId ?? activeLayerId;

  return (
    <div className="panel pointer-events-auto flex w-60 flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="section-label">
          {count} selected
        </span>
        <button
          type="button"
          onClick={clearSelection}
          className="text-[11px] text-muted transition-colors hover:text-primary"
        >
          Deselect
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="section-label">Combine</span>
        <div className="grid grid-cols-2 gap-1">
          {OPS.map(({ op, hint }) => (
            <button
              key={op}
              type="button"
              className="chip"
              disabled={!enoughForBoolean}
              onClick={() => applyBoolean(op)}
              title={enoughForBoolean ? hint : 'Select two or more items first'}
              style={enoughForBoolean ? undefined : { opacity: 0.35 }}
            >
              {BOOLEAN_LABELS[op]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span className="section-label">Clipboard</span>
        <div className="grid grid-cols-3 gap-1">
          <button type="button" className="chip" onClick={copySelection} title="Copy (Ctrl+C)">
            Copy
          </button>
          <button type="button" className="chip" onClick={cutSelection} title="Cut (Ctrl+X)">
            Cut
          </button>
          <button
            type="button"
            className="chip"
            onClick={paste}
            disabled={clipboardSize === 0}
            title={
              clipboardSize === 0
                ? 'Nothing copied yet'
                : `Paste ${clipboardSize} into the active layer (Ctrl+V)`
            }
            style={clipboardSize === 0 ? { opacity: 0.35 } : undefined}
          >
            Paste
          </button>
        </div>
      </div>

      <label className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span className="section-label">Move to layer</span>
        <select
          value={currentLayer}
          onChange={(event) => moveSelectionToLayer(event.target.value)}
          className="rounded-lg bg-sunken px-2 py-1.5 text-xs text-primary outline-none"
          aria-label="Move selection to layer"
        >
          {layers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-1 border-t border-line pt-3">
        <button
          type="button"
          className="chip flex items-center justify-center gap-1.5"
          onClick={() => {
            copySelection();
            paste();
          }}
          title="Duplicate into the active layer"
        >
          <CopyIcon />
          Duplicate
        </button>
        <button
          type="button"
          className="chip flex items-center justify-center gap-1.5"
          onClick={deleteSelection}
          title="Delete (Del)"
        >
          <TrashIcon className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}

/** The rubber-band rectangle drawn while dragging a box selection. */
export function Marquee() {
  const marquee = useStore((state) => state.marquee);
  if (!marquee) return null;

  const left = Math.min(marquee.x0, marquee.x1);
  const top = Math.min(marquee.y0, marquee.y1);
  const width = Math.abs(marquee.x1 - marquee.x0);
  const height = Math.abs(marquee.y1 - marquee.y0);

  return (
    <div
      className="pointer-events-none absolute rounded-sm border border-dashed"
      style={{
        left,
        top,
        width,
        height,
        borderColor: 'var(--color-accent)',
        background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
      }}
      aria-hidden="true"
    />
  );
}
