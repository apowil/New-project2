import { useEffect, useRef, useState } from 'react';

import { useStore } from '../state/store.js';
import { LengthField } from './LengthField.js';

/**
 * Typing the text before it is placed.
 *
 * A tablet has no way to type "into" a 3D scene, so the tool marks a point and
 * this appears at it. Enter places the text; Shift+Enter starts a new line,
 * because multi-line labels are common and losing them to a stray Enter is
 * worse than needing a modifier.
 */
export function TextPrompt({
  onPlace,
}: {
  onPlace: (x: number, y: number, text: string, size: number) => boolean;
}) {
  const prompt = useStore((state) => state.textPrompt);
  const setPrompt = useStore((state) => state.setTextPrompt);
  const size = useStore((state) => state.textSize);
  const setTextSize = useStore((state) => state.setTextSize);
  const unit = useStore((state) => state.unit);
  const setStatusMessage = useStore((state) => state.setStatusMessage);

  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prompt) {
      setValue('');
      // The sheet animates in; focusing too early silently does nothing.
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [prompt]);

  if (!prompt) return null;

  const place = () => {
    const text = value.trim();
    if (!text) {
      setPrompt(null);
      return;
    }

    if (!onPlace(prompt.x, prompt.y, value, size)) {
      setStatusMessage('Text could not be placed there — try a less edge-on view.');
    }
    setPrompt(null);
  };

  return (
    <div
      className="panel pointer-events-auto absolute z-40 flex w-64 flex-col gap-2 p-3"
      style={{
        left: Math.min(Math.max(prompt.x - 128, 12), window.innerWidth - 268),
        top: Math.min(prompt.y + 12, window.innerHeight - 220),
      }}
      role="dialog"
      aria-label="Add text"
    >
      <span className="section-label">Text</span>

      <textarea
        ref={inputRef}
        value={value}
        rows={2}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            place();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setPrompt(null);
          }
        }}
        placeholder="Type, then press Enter"
        aria-label="Text to add"
        className="resize-none rounded-lg bg-sunken px-2 py-1.5 text-sm text-primary outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      />

      <LengthField label="Height" value={size} unit={unit} onCommit={setTextSize} min={1e-4} />

      <div className="grid grid-cols-2 gap-1">
        <button type="button" className="chip" onClick={() => setPrompt(null)}>
          Cancel
        </button>
        <button
          type="button"
          className="chip"
          data-active
          onClick={place}
          disabled={value.trim().length === 0}
          style={value.trim().length === 0 ? { opacity: 0.4 } : undefined}
        >
          Place
        </button>
      </div>

      <p className="text-[11px] leading-snug text-muted">
        Single-stroke technical face. Shift+Enter for a new line.
      </p>
    </div>
  );
}
