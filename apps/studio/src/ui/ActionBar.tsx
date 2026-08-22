import { useStore } from '../state/store.js';
import { FolderIcon, FrameIcon, RedoIcon, UndoIcon } from './Icons.js';

interface ActionBarProps {
  onFrameAll: () => void;
}

export function ActionBar({ onFrameAll }: ActionBarProps) {
  const canUndo = useStore((state) => state.canUndo);
  const canRedo = useStore((state) => state.canRedo);
  const undoLabel = useStore((state) => state.undoLabel);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const setProjectsOpen = useStore((state) => state.setProjectsOpen);

  return (
    <div className="panel pointer-events-auto flex items-center gap-1 p-1.5">
      <button
        type="button"
        className="tool-button"
        onClick={undo}
        disabled={!canUndo}
        title={undoLabel ? `Undo ${undoLabel.toLowerCase()} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
        aria-label="Undo"
      >
        <UndoIcon />
      </button>

      <button
        type="button"
        className="tool-button"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        <RedoIcon />
      </button>

      <div className="mx-1 h-6 w-px bg-ink-700" />

      <button
        type="button"
        className="tool-button"
        onClick={onFrameAll}
        title="Frame everything (F)"
        aria-label="Frame everything"
      >
        <FrameIcon />
      </button>

      <button
        type="button"
        className="tool-button"
        onClick={() => setProjectsOpen(true)}
        title="Sketches (Ctrl+O)"
        aria-label="Sketches"
      >
        <FolderIcon />
      </button>
    </div>
  );
}
