import { useStore, type ToolId } from '../state/store.js';
import { EraserIcon, PenIcon, PlaneIcon } from './Icons.js';

const TOOLS: Array<{ id: ToolId; label: string; hint: string; Icon: typeof PenIcon }> = [
  { id: 'draw', label: 'Draw', hint: 'D', Icon: PenIcon },
  { id: 'erase', label: 'Erase', hint: 'E', Icon: EraserIcon },
  { id: 'plane', label: 'Place sketch plane', hint: 'P', Icon: PlaneIcon },
];

export function Toolbar() {
  const tool = useStore((state) => state.tool);
  const setTool = useStore((state) => state.setTool);

  return (
    <div className="panel pointer-events-auto flex flex-col gap-1 p-1.5">
      {TOOLS.map(({ id, label, hint, Icon }) => (
        <button
          key={id}
          type="button"
          className="tool-button"
          data-active={tool === id}
          onClick={() => setTool(id)}
          title={`${label} (${hint})`}
          aria-label={label}
          aria-pressed={tool === id}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
