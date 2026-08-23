import { useCallback, useEffect, useRef, useState } from 'react';

import { useStore } from '../state/store.js';
import { DropperIcon } from './Icons.js';

/**
 * Hue strip plus a saturation/value square, built from CSS gradients rather
 * than a canvas — no image data to read back, and it stays crisp at any
 * density. The square is driven by pointer events so it works with a finger,
 * a pen, or a mouse without three separate code paths.
 */

export interface Hsv {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];

  const to255 = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

export function hexToHsv(hex: string): Hsv {
  const parsed = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!parsed) return { h: 0, s: 0, v: 1 };

  const value = parseInt(parsed[1]!, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export const isValidHex = (hex: string): boolean => /^#?[0-9a-f]{6}$/i.test(hex.trim());

const normaliseHex = (hex: string): string => {
  const trimmed = hex.trim();
  return (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toLowerCase();
};

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  recent: string[];
}

export function ColorPicker({ value, onChange, recent }: ColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(value);
  const squareRef = useRef<HTMLDivElement>(null);

  // Follow external changes (a swatch click) without fighting local dragging.
  useEffect(() => {
    if (normaliseHex(value) === normaliseHex(hsvToHex(hsv))) return;
    setHsv(hexToHsv(value));
    setHexDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hsv is the guard
  }, [value]);

  const commit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = hsvToHex(next);
      setHexDraft(hex);
      onChange(hex);
    },
    [onChange],
  );

  const handleSquare = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const element = squareRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const s = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
      const v = 1 - Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
      commit({ ...hsv, s, v });
    },
    [commit, hsv],
  );

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div className="flex w-60 flex-col gap-3">
      <div
        ref={squareRef}
        role="application"
        aria-label="Saturation and brightness"
        className="relative h-32 w-full cursor-crosshair rounded-lg"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
          touchAction: 'none',
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          handleSquare(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons > 0) handleSquare(event);
        }}
      >
        <span
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            background: hsvToHex(hsv),
          }}
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className="sr-only">Hue</span>
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={Math.round(hsv.h)}
          onChange={(event) => commit({ ...hsv, h: Number(event.target.value) })}
          aria-label="Hue"
          style={{
            background:
              'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          }}
        />
      </label>

      <div className="flex items-center gap-2">
        <span
          className="h-8 w-8 shrink-0 rounded-lg border border-line"
          style={{ background: value }}
        />
        <Eyedropper />
        <input
          value={hexDraft}
          onChange={(event) => {
            const next = event.target.value;
            setHexDraft(next);
            if (isValidHex(next)) {
              const hex = normaliseHex(next);
              setHsv(hexToHsv(hex));
              onChange(hex);
            }
          }}
          onBlur={() => setHexDraft(value)}
          spellCheck={false}
          aria-label="Hex colour"
          className="w-full rounded-lg bg-sunken px-2 py-1.5 font-mono text-xs text-primary outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
      </div>

      {recent.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="section-label">Recent</span>

          <div className="flex flex-wrap gap-1.5">
            {recent.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onChange(color)}
                title={color}
                aria-label={`Use ${color}`}
                className="h-6 w-6 rounded-md border border-line transition-transform hover:scale-110"
                style={{ background: color }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Sample a colour from something already drawn.
 *
 * Arming a mode rather than being a tool of its own: it is one tap, and having
 * to switch back to the pen afterwards would cost more than it saves. The next
 * tap on the canvas takes that object's colour; a tap on nothing cancels.
 */
function Eyedropper() {
  const armed = useStore((state) => state.eyedropper);
  const setEyedropper = useStore((state) => state.setEyedropper);
  const setTool = useStore((state) => state.setTool);

  return (
    <button
      type="button"
      onClick={() => {
        // Picking needs the select tool's hit testing, so arm both together.
        if (!armed) setTool('select');
        setEyedropper(!armed);
      }}
      aria-label="Pick a colour from the sketch"
      aria-pressed={armed}
      title={armed ? 'Tap an object to take its colour' : 'Pick a colour from the sketch'}
      className="h-8 w-8 shrink-0 rounded-lg border border-line text-muted transition-colors hover:text-primary"
      style={
        armed
          ? {
              background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)',
              color: 'var(--color-accent)',
            }
          : undefined
      }
    >
      <span className="flex items-center justify-center">
        <DropperIcon />
      </span>
    </button>
  );
}
