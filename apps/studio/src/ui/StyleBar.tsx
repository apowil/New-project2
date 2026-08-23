import { useState } from 'react';

import { formatLength } from '@wisp/core';

import { useStore } from '../state/store.js';
import { BRUSHES, matchBrush } from '../tools/brushes.js';
import { ColorPicker } from './ColorPicker.js';
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

  const [openPanel, setOpenPanel] = useState<'color' | 'brush' | null>(null);
  const activeBrush = matchBrush(style);
  const brushName = activeBrush
    ? (BRUSHES.find((brush) => brush.id === activeBrush)?.name ?? 'Custom')
    : 'Custom';

  const toggle = (panel: 'color' | 'brush') =>
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

      <Slider
        label="Size"
        value={style.width}
        min={0.008}
        max={0.4}
        step={0.002}
        format={(v) => formatLength(v, unit)}
        onChange={(width) => setStyle({ width })}
      />
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="flex w-32 flex-col gap-1.5">
      <span className="section-label flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-secondary">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
