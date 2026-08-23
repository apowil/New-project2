import { useEffect, useRef, useState } from 'react';

import { nodeLabel, nodesOnLayer, type SceneNode } from '@wisp/core';

import { session, useStore } from '../state/store.js';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MergeDownIcon,
  PlusIcon,
  UnlockIcon,
} from './Icons.js';

/**
 * Layers, and what is on them.
 *
 * The panel used to be a flat list of layers with five buttons on every row,
 * which left no room for the objects themselves — and without those, finding
 * one particular stroke in a busy sketch meant hunting for it with the
 * pointer. Expanding a layer now shows its contents, and the per-layer actions
 * that are used once in a while moved into a menu, so the common row is quiet.
 */

/** Rows past this are not drawn: a dense layer would otherwise stall the panel. */
const MAX_ROWS = 200;

export function LayersPanel() {
  const layers = useStore((state) => state.layers);
  const activeLayerId = useStore((state) => state.activeLayerId);
  const setActiveLayer = useStore((state) => state.setActiveLayer);
  const toggleVisible = useStore((state) => state.toggleLayerVisible);
  const toggleLocked = useStore((state) => state.toggleLayerLocked);
  const addLayer = useStore((state) => state.addLayer);
  const selectLayer = useStore((state) => state.selectLayer);

  // Read straight from the mutable document, re-rendering when it changes.
  const revision = useStore((state) => state.revision);
  void revision;

  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="panel pointer-events-auto flex max-h-[60vh] w-72 flex-col gap-1 overflow-y-auto p-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[11px] uppercase tracking-wide text-muted">Layers</span>
        <button
          type="button"
          onClick={addLayer}
          className="rounded-lg p-1 text-muted transition-colors hover:bg-line/60 hover:text-primary"
          title="Add layer"
          aria-label="Add layer"
        >
          <PlusIcon />
        </button>
      </div>

      {layers.map((layer, index) => {
        const active = layer.id === activeLayerId;
        const open = expanded === layer.id;
        const contents = open ? nodesOnLayer(session.document, layer.id) : [];

        return (
          <div key={layer.id} className="flex flex-col">
            <div
              className="flex items-center gap-1 rounded-lg px-1 py-1 transition-colors"
              style={
                active
                  ? { background: 'color-mix(in srgb, var(--color-accent) 13%, transparent)' }
                  : undefined
              }
            >
              <button
                type="button"
                onClick={() => setExpanded(open ? null : layer.id)}
                className="rounded p-0.5 text-muted transition-colors hover:text-primary"
                aria-label={open ? `Collapse ${layer.name}` : `Expand ${layer.name}`}
                aria-expanded={open}
              >
                {open ? <ChevronDownIcon /> : <ChevronUpIcon className="rotate-90" />}
              </button>

              <button
                type="button"
                onClick={() => setActiveLayer(layer.id)}
                onDoubleClick={() => selectLayer(layer.id)}
                className="min-w-0 flex-1 truncate px-1 text-left text-sm"
                style={{ color: active ? 'var(--color-accent)' : 'var(--color-secondary)' }}
                title={`Draw on ${layer.name} — double-click to select its contents`}
              >
                {layer.name}
              </button>

              <IconButton
                onClick={() => toggleVisible(layer.id)}
                label={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
              </IconButton>

              <IconButton
                onClick={() => toggleLocked(layer.id)}
                label={layer.locked ? 'Unlock layer' : 'Lock layer'}
              >
                {layer.locked ? <LockIcon /> : <UnlockIcon />}
              </IconButton>

              <LayerMenu layer={layer} index={index} count={layers.length} />
            </div>

            {open && <Contents nodes={contents} />}
          </div>
        );
      })}
    </div>
  );
}

/** The objects on one layer. */
function Contents({ nodes }: { nodes: SceneNode[] }) {
  const selection = useStore((state) => state.selection);
  const setSelection = useStore((state) => state.setSelection);
  const toggleNodeHidden = useStore((state) => state.toggleNodeHidden);
  const toggleNodeLocked = useStore((state) => state.toggleNodeLocked);
  const renameNode = useStore((state) => state.renameNode);

  const [renaming, setRenaming] = useState<string | null>(null);

  if (nodes.length === 0) {
    return <p className="px-7 py-1 text-[11px] text-muted">Nothing on this layer yet.</p>;
  }

  // Newest first: the thing you just drew is the thing you are looking for.
  const shown = [...nodes].reverse().slice(0, MAX_ROWS);

  return (
    <div className="flex flex-col">
      {shown.map((node) => {
        const selected = selection.includes(node.id);
        return (
          <div
            key={node.id}
            className="ml-6 flex items-center gap-1 rounded-lg px-1 py-0.5"
            style={
              selected
                ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }
                : undefined
            }
          >
            {renaming === node.id ? (
              <RenameField
                initial={nodeLabel(node)}
                onDone={(name) => {
                  if (name) renameNode(node.id, name);
                  setRenaming(null);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSelection([node.id])}
                onDoubleClick={() => setRenaming(node.id)}
                className="min-w-0 flex-1 truncate px-1 text-left text-xs"
                style={{
                  color: selected ? 'var(--color-accent)' : 'var(--color-muted)',
                  opacity: node.hidden ? 0.45 : 1,
                }}
                title={`${nodeLabel(node)} — double-click to rename`}
              >
                {nodeLabel(node)}
                {node.groupId && <span className="ml-1 text-[10px] opacity-60">grouped</span>}
              </button>
            )}

            <IconButton
              onClick={() => toggleNodeHidden(node.id)}
              label={node.hidden ? `Show ${nodeLabel(node)}` : `Hide ${nodeLabel(node)}`}
              small
            >
              {node.hidden ? <EyeOffIcon /> : <EyeIcon />}
            </IconButton>

            <IconButton
              onClick={() => toggleNodeLocked(node.id)}
              label={node.locked ? `Unlock ${nodeLabel(node)}` : `Lock ${nodeLabel(node)}`}
              small
            >
              {node.locked ? <LockIcon /> : <UnlockIcon />}
            </IconButton>
          </div>
        );
      })}

      {nodes.length > shown.length && (
        <p className="ml-7 py-1 text-[11px] text-muted">
          and {nodes.length - shown.length} more
        </p>
      )}
    </div>
  );
}

function RenameField({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  /**
   * Removing a focused input fires one last blur, which would call `onDone` a
   * second time — and after Escape that second call carries the typed value,
   * committing the rename the user just cancelled.
   */
  const finished = useRef(false);

  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(name);
  };

  useEffect(() => ref.current?.select(), []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value);
        if (event.key === 'Escape') finish(null);
      }}
      aria-label="Object name"
      className="min-w-0 flex-1 rounded bg-sunken px-1 text-xs text-primary outline-none"
    />
  );
}

/** The per-layer actions that are not needed on every row. */
function LayerMenu({
  layer,
  index,
  count,
}: {
  layer: { id: string; name: string };
  index: number;
  count: number;
}) {
  const duplicateLayer = useStore((state) => state.duplicateLayer);
  const mergeLayerDown = useStore((state) => state.mergeLayerDown);
  const reorderLayer = useStore((state) => state.reorderLayer);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`More actions for ${layer.name}`}
        aria-expanded={open}
        className="rounded p-1 text-muted transition-colors hover:bg-line/60 hover:text-primary"
      >
        <span className="block px-0.5 text-sm leading-none">···</span>
      </button>

      {open && (
        <div
          className="panel absolute right-0 top-full z-50 mt-1 flex w-44 flex-col gap-0.5 p-1.5"
          role="dialog"
          aria-label="Layer actions"
        >
          <button
            type="button"
            className="chip text-left"
            onClick={() => choose(() => duplicateLayer(layer.id))}
          >
            <span className="flex items-center gap-2">
              <CopyIcon />
              Duplicate
            </span>
          </button>

          <button
            type="button"
            className="chip text-left"
            disabled={index === 0}
            onClick={() => choose(() => mergeLayerDown(layer.id))}
          >
            <span className="flex items-center gap-2">
              <MergeDownIcon />
              Merge down
            </span>
          </button>

          <div className="my-0.5 h-px bg-line" />

          <button
            type="button"
            className="chip text-left"
            disabled={index === 0}
            onClick={() => choose(() => reorderLayer(layer.id, -1))}
          >
            <span className="flex items-center gap-2">
              <ChevronUpIcon />
              Move up
            </span>
          </button>

          <button
            type="button"
            className="chip text-left"
            disabled={index >= count - 1}
            onClick={() => choose(() => reorderLayer(layer.id, 1))}
          >
            <span className="flex items-center gap-2">
              <ChevronDownIcon />
              Move down
            </span>
          </button>

          {/* Worth saying once: in 3D the depth buffer decides what is in
              front, so this orders the list, not the picture. */}
          <p className="px-1 pt-1 text-[10px] leading-snug text-muted">
            Order groups the panel. Depth decides what is in front.
          </p>
        </div>
      )}
    </div>
  );
}

function IconButton({
  onClick,
  label,
  children,
  small,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded text-muted transition-colors hover:bg-line/60 hover:text-primary ${
        small ? 'p-0.5' : 'p-1'
      }`}
    >
      {children}
    </button>
  );
}
