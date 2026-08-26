import { useEffect, useRef, useState } from 'react';

import { useStore } from '../state/store.js';

/**
 * Pairing a tablet with the PC that served it.
 *
 * Shown only when the app was loaded from a desktop host and is not linked
 * yet. It is worth asking rather than pairing silently: sending work to
 * somebody else's machine should be a decision, and on a shared network the
 * machine that served the page is not necessarily one you trust.
 */
export function LinkPrompt() {
  const offer = useStore((state) => state.linkOffer);
  const status = useStore((state) => state.linkStatus);
  const connect = useStore((state) => state.connectToHost);
  const dismiss = useStore((state) => state.dismissLinkOffer);

  const [code, setCode] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (offer) setTimeout(() => input.current?.focus(), 60);
  }, [offer]);

  if (!offer) return null;

  const failed = status === 'failed';

  return (
    <div
      className="panel pointer-events-auto absolute bottom-28 left-1/2 z-40 flex w-80 -translate-x-1/2 flex-col gap-2 p-3"
      role="dialog"
      aria-label="Use the PC for heavy work"
    >
      <span className="text-sm text-primary">Use the PC for heavy work?</span>
      <p className="text-[11px] leading-snug text-muted">
        This sketch came from a computer on your network. Pair with it and slow
        operations run there instead of on this tablet. Drawing stays here
        either way.
      </p>

      <label className="flex flex-col gap-1 pt-1">
        <span className="section-label">Pairing code</span>
        <input
          ref={input}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && code.length === 6) connect(code);
          }}
          inputMode="numeric"
          placeholder="000000"
          aria-label="Pairing code"
          className="rounded-lg bg-sunken px-2 py-1.5 text-center font-mono text-lg tracking-widest text-primary outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
      </label>

      {failed && (
        <span className="text-[11px]" style={{ color: 'var(--color-danger)' }}>
          That code was not accepted. Check the number on the computer.
        </span>
      )}

      <div className="grid grid-cols-2 gap-1 pt-1">
        <button type="button" className="chip" onClick={dismiss}>
          Not now
        </button>
        <button
          type="button"
          className="chip"
          data-active
          disabled={code.length !== 6 || status === 'connecting'}
          onClick={() => connect(code)}
        >
          {status === 'connecting' ? 'Pairing…' : 'Pair'}
        </button>
      </div>
    </div>
  );
}
