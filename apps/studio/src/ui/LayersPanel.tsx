import { useStore } from '../state/store.js';
import { EyeIcon, EyeOffIcon, LockIcon, PlusIcon, UnlockIcon } from './Icons.js';

export function LayersPanel() {
  const layers = useStore((state) => state.layers);
  const activeLayerId = useStore((state) => state.activeLayerId);
  const setActiveLayer = useStore((state) => state.setActiveLayer);
  const toggleVisible = useStore((state) => state.toggleLayerVisible);
  const toggleLocked = useStore((state) => state.toggleLayerLocked);
  const addLayer = useStore((state) => state.addLayer);

  return (
    <div className="panel pointer-events-auto flex w-56 flex-col gap-1 p-2">
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

      {layers.map((layer) => {
        const active = layer.id === activeLayerId;
        return (
          <div
            key={layer.id}
            className="flex items-center gap-1 rounded-lg px-1 py-1 transition-colors"
            style={
              active
                ? { background: 'color-mix(in srgb, var(--color-accent) 13%, transparent)' }
                : undefined
            }
          >
            <button
              type="button"
              onClick={() => setActiveLayer(layer.id)}
              className="min-w-0 flex-1 truncate px-1 text-left text-sm"
              style={{ color: active ? 'var(--color-accent)' : 'var(--color-secondary)' }}
              title={`Draw on ${layer.name}`}
            >
              {layer.name}
            </button>

            <button
              type="button"
              onClick={() => toggleVisible(layer.id)}
              className="rounded p-1 text-muted transition-colors hover:bg-line/60 hover:text-primary"
              title={layer.visible ? 'Hide layer' : 'Show layer'}
              aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
            >
              {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
            </button>

            <button
              type="button"
              onClick={() => toggleLocked(layer.id)}
              className="rounded p-1 text-muted transition-colors hover:bg-line/60 hover:text-primary"
              title={layer.locked ? 'Unlock layer' : 'Lock layer'}
              aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
            >
              {layer.locked ? <LockIcon /> : <UnlockIcon />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
