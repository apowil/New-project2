import { useEffect, useState } from 'react';
import { formatLength, parseLength, type Unit } from '@wisp/core';

interface LengthFieldProps {
  label: string;
  /** Always metres. Units are display only. */
  value: number;
  unit: Unit;
  onCommit: (metres: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

/**
 * A measurement you can read *and* type into.
 *
 * The draft is kept as text while editing so a half-typed "1." is not parsed
 * as 1 and snapped back under the cursor. It commits on blur or Enter, and
 * reverts on Escape.
 */
export function LengthField({
  label,
  value,
  unit,
  onCommit,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  disabled,
}: LengthFieldProps) {
  const [draft, setDraft] = useState(() => formatLength(value, unit, false));
  const [editing, setEditing] = useState(false);

  // Follow external changes — a drag, a unit switch — unless mid-edit.
  useEffect(() => {
    if (!editing) setDraft(formatLength(value, unit, false));
  }, [value, unit, editing]);

  const commit = () => {
    setEditing(false);
    const metres = parseLength(draft, unit);
    if (metres === null) {
      setDraft(formatLength(value, unit, false));
      return;
    }
    onCommit(Math.min(Math.max(metres, min), max));
  };

  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input
          value={draft}
          disabled={disabled}
          onFocus={() => setEditing(true)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(formatLength(value, unit, false));
              setEditing(false);
              event.currentTarget.blur();
            }
          }}
          inputMode="decimal"
          aria-label={label}
          className="w-20 rounded-lg bg-sunken px-2 py-1 text-right tabular-nums text-primary outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-40"
        />
        <span className="w-6 text-muted">{unit}</span>
      </span>
    </label>
  );
}
