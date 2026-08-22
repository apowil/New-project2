import { useEffect } from 'react';

import { useStore } from '../state/store.js';

/** Transient confirmations and failures — exported, imported, could not open. */
export function StatusToast() {
  const message = useStore((state) => state.statusMessage);
  const setStatusMessage = useStore((state) => state.setStatusMessage);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setStatusMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message, setStatusMessage]);

  if (!message) return null;

  return (
    <div
      className="panel pointer-events-auto absolute left-1/2 top-4 z-30 -translate-x-1/2 px-4 py-2 text-sm text-primary"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
