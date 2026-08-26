import { useEffect, useState } from 'react';

import {
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  formatLength,
  sliderFromWidth,
  widthFromSlider,
} from '@wisp/core';

import { getViewActions, useStore } from '../state/store.js';
import { BRUSHES, matchBrush } from '../tools/brushes.js';
import { ColorPicker } from './ColorPicker.js';
import { LengthField } from './LengthField.js';
import { Popover } from './Popover.js';

/**
 * Swatches are stroke colours, so these must stay literal hex values — they
 * end up in THREE.Color and in the saved file, neither of which can resolve a
 * CSS custom property.
 */
const SWATCHES = [
  '#d8d2c8',
  '#31363f',
  '#7dd3c0',
  '#7aa2f7',
  '#c68cf0',
  '#f7768e',
  '#e0af68',
];

export function StyleBar() {
  const style = useStore((state) => state.style);
  const setStyle = useStore((state) => state.setStyle);
  const applyBrush = useStore((state) => state.applyBrush);
  const recentColors = useStore((state) => state.recentColors);
  const unit = useStore((state) => state.unit);

  const [openPanel, setOpenPanel] = useState<'color' | 'brush' | 'size' | null>(null);
  const activeBrush = matchBrush(style);
  const brushName = activeBrush
    ? (BRUSHES.find((brush) => brush.id === activeBrush)?.name ?? 'Custom')
    : 'Custom';

  const toggle = (panel: 'color' | 'brush' | 'size') =>
    setOpenPanel((current) => (current === panel ? null : panel));

  return (
    <div className="panel pointer-events-auto flex items-center gap-3 px-3 py-2.5">
      <div className="relative">
        <button
          type="button"
          onClick={() => toggle('color')}
          aria-expanded={openPanel === 'color'}
          aria-label="Colour"
          title="Colour"
          className="flex h-10 items-center gap-2 rounded-xl px-2 transition-colors hover:bg-line/60"
        >
          <span
            className="h-6 w-6 rounded-full border border-line"
            style={{ background: style.color }}
          />
          <span className="font-mono text-[11px] uppercase text-muted">{style.color}</span>
        </button>

        <Popover
          open={openPanel === 'color'}
          onClose={() => setOpenPanel(null)}
          align="left"
          label="Colour"
        >
          <ColorPicker
            value={style.color}
            onChange={(color) => setStyle({ color })}
            recent={recentColors}
          />
        </Popover>
      </div>

      <div className="flex items-center gap-1">
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => setStyle({ color })}
            aria-label={`Colour ${color}`}
            title={color}
            className="h-6 w-6 rounded-full border transition-transform hover:scale-110"
            style={{
              backgroundColor: color,
              borderColor:
                style.color.toLowerCase() === color.toLowerCase()
                  ? 'var(--color-accent)'
                  : 'var(--color-line)',
            }}
          />
        ))}
      </div>

      <div className="h-8 w-px bg-line" />

      <div className="relative">
        <button
          type="button"
          onClick={() => toggle('brush')}
          aria-expanded={openPanel === 'brush'}
          aria-label="Brush"
          title="Brush"
          className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-secondary transition-colors hover:bg-line/60"
        >
          {brushName}
        </button>

        <Popover
          open={openPanel === 'brush'}
          onClose={() => setOpenPanel(null)}
          align="center"
          label="Brush"
        >
          <div className="flex w-56 flex-col gap-1">
            {BRUSHES.map((brush) => (
              <button
                key={brush.id}
                type="button"
                onClick={() => {
                  applyBrush(brush.id);
                  setOpenPanel(null);
                }}
                data-active={activeBrush === brush.id}
                className="chip flex flex-col items-start gap-0.5 px-2.5 py-2 text-left"
              >
                <span className="text-sm">{brush.name}</span>
                <span className="text-[11px] leading-snug text-muted">{brush.description}</span>
              </button>
            ))}
          </div>
        </Popover>
      </div>

      <div className="relative z-40">
        <button
          type="button"
          onClick={() => toggle('size')}
          aria-label="Stroke size"
          title="Stroke size"
          className="flex w-32 flex-col items-start gap-1.5"
        >
          <span className="section-label flex w-full justify-between">
            <span>Size</span>
            <span className="tabular-nums text-secondary">{formatLength(style.width, unit)}</span>
          </span>
          <StrokePreview width={style.width} color={style.color} />
        </button>

        <Popover
          open={openPanel === 'size'}
          onClose={() => setOpenPanel(null)}
          align="right"
          label="Stroke size"
        >
          <SizePanel />
        </Popover>
      </div>
    </div>
  );
}

/**
 * The brush drawn at the thickness it will actually appear.
 *
 * A width in metres is the honest way to store a stroke and a useless way to
 * choose one: the same 6 mm is a hairline across a room and a broad band up
 * close. This shows the real on-screen thickness at the current zoom, and says
 * so plainly when that falls below a single pixel — which is the answer to
 * "why can I not see what I just drew".
 */
function StrokePreview({ width, color }: { width: number; color: string }) {
  const pixels = useScreenPixels(width);
  const drawn = Math.min(Math.max(pixels, 1), 26);

  return (
    <span className="flex h-7 w-full items-center gap-2 rounded-md bg-sunken px-2">
      <span
        className="block flex-1 rounded-full"
        style={{ height: `${drawn}px`, background: color, opacity: pixels < 1 ? 0.55 : 1 }}
      />
      {pixels < 1 && (
        <span className="shrink-0 text-[10px] leading-none text-muted">thin</span>
      )}
    </span>
  );
}

/** How many screen pixels wide a stroke of this world width is right now. */
function useScreenPixels(width: number): number {
  const [pixels, setPixels] = useState(0);

  // Re-measured on a timer rather than on camera events: the camera eases to
  // its goal over several frames, and a subscription would either fire far too
  // often or land before the ease finishes.
  useEffect(() => {
    const measure = () => {
      const perPixel = getViewActions()?.worldPerPixel();
      if (perPixel && perPixel > 0) setPixels(width / perPixel);
    };
    measure();
    const id = setInterval(measure, 400);
    return () => clearInterval(id);
  }, [width]);

  return pixels;
}

const TIPS: Array<{ mm: number; name: string }> = [
  { mm: 0.2, name: 'Technical pen' },
  { mm: 0.5, name: 'Fineliner' },
  { mm: 1, name: 'Pen' },
  { mm: 3, name: 'Marker' },
  { mm: 10, name: 'Broad' },
  { mm: 60, name: 'Block' },
];

/**
 * Choosing a size across four orders of magnitude.
 *
 * Three ways in, because they suit different intents: named tips for "give me
 * something like a fineliner", a typed field for a size that has to be exact,
 * and a slider for hunting by eye.
 */
function SizePanel() {
  const style = useStore((state) => state.style);
  const setStyle = useStore((state) => state.setStyle);
  const unit = useStore((state) => state.unit);

  return (
    <div className="flex w-60 flex-col gap-3 p-3">
      <span className="section-label">Stroke size</span>

      <div className="grid grid-cols-3 gap-1">
        {TIPS.map(({ mm, name }) => {
          const width = mm / 1000;
          return (
            <button
              key={mm}
              type="button"
              className="chip flex-col items-start py-1"
              data-active={Math.abs(style.width - width) < width * 0.02}
              onClick={() => setStyle({ width })}
              title={`${name} — ${mm} mm`}
            >
              <span className="tabular-nums">{mm} mm</span>
              <span className="block text-[10px] leading-tight text-muted">{name}</span>
            </button>
          );
        })}
      </div>

      <LengthField
        label="Exact"
        value={style.width}
        unit={unit}
        min={MIN_STROKE_WIDTH}
        max={MAX_STROKE_WIDTH}
        onCommit={(width) => setStyle({ width })}
      />

      <label className="flex flex-col gap-1.5">
        <span className="section-label flex justify-between">
          <span>Slide</span>
          <span className="tabular-nums text-secondary">{formatLength(style.width, unit)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={sliderFromWidth(style.width)}
          aria-label="Stroke size"
          onChange={(event) => setStyle({ width: widthFromSlider(Number(event.target.value)) })}
        />
      </label>

      <p className="text-[11px] leading-snug text-muted">
        {formatLength(MIN_STROKE_WIDTH, unit)} to {formatLength(MAX_STROKE_WIDTH, unit)}. The
        slider moves by ratio, so fine sizes stay as controllable as broad ones.
      </p>
    </div>
  );
}
