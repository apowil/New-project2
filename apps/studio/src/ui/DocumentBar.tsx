import { useEffect, useRef, useState } from 'react';

import { useStore } from '../state/store.js';

/** "3 minutes ago" — precise enough for a save indicator, no dependency. */
function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function DocumentBar() {
  const name = useStore((state) => state.documentName);
  const saveState = useStore((state) => state.saveState);
  const lastSavedAt = useStore((state) => state.lastSavedAt);
  const persistent = useStore((state) => state.storageIsPersistent);
  const renameSketch = useStore((state) => state.renameSketch);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the relative timestamp fresh without re-rendering the whole app.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    renameSketch(draft);
  };

  const status = !persistent
    ? 'Not saved — storage unavailable'
    : saveState === 'saving'
      ? 'Saving…'
      : saveState === 'error'
        ? 'Could not save'
        : lastSavedAt
          ? `Saved ${relativeTime(lastSavedAt)}`
          : 'Not saved yet';

  return (
    <div className="panel pointer-events-auto flex flex-col gap-0.5 px-3 py-2">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="w-48 rounded bg-ink-800 px-1 text-sm text-ink-50 outline-none ring-1 ring-[var(--color-accent)]"
          aria-label="Sketch name"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="max-w-48 truncate text-left text-sm text-ink-50 hover:text-[var(--color-accent)]"
          title="Rename this sketch"
        >
          {name}
        </button>
      )}

      <span
        className="text-[11px] text-ink-400"
        style={
          saveState === 'error' || !persistent ? { color: '#f7768e' } : undefined
        }
      >
        {status}
      </span>
    </div>
  );
}
