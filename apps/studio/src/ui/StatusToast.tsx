import { useEffect } from 'react';

import { useStore } from '../state/store.js';

/** Transient confirmations and failures — exported, imported, could not open. */
export function StatusToast() {
  const message = useStore((state) => state.statusMessage);
  const setStatusMessage = useStore((state) => state.setStatusMessage);
  const busy = useStore((state) => state.busy);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setStatusMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message, setStatusMessage]);

  // Work in progress outranks a stale confirmation from a moment ago.
  const shown = busy ?? message;
  if (!shown) return null;

  return (
    <div
      className="panel pointer-events-auto absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-2 px-4 py-2 text-sm text-primary"
      role="status"
      aria-live="polite"
    >
      {busy && (
        <span
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line"
          style={{ borderTopColor: 'var(--color-accent)' }}
          aria-hidden="true"
        />
      )}
      {shown}
    </div>
  );
}
