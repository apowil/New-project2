import { useStore } from '../state/store.js';

const SWATCHES = [
  '#d8d2c8',
  '#f4f4f5',
  '#7dd3c0',
  '#7aa2f7',
  '#c68cf0',
  '#f7768e',
  '#e0af68',
  '#3d4149',
];

export function StyleBar() {
  const style = useStore((state) => state.style);
  const setStyle = useStore((state) => state.setStyle);

  return (
    <div className="panel pointer-events-auto flex items-center gap-4 px-4 py-3">
      <div className="flex items-center gap-1.5">
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => setStyle({ color })}
            aria-label={`Colour ${color}`}
            title={color}
            className="h-7 w-7 rounded-full border transition-transform hover:scale-110"
            style={{
              backgroundColor: color,
              borderColor:
                style.color.toLowerCase() === color.toLowerCase()
                  ? 'var(--color-accent)'
                  : 'rgba(255,255,255,0.14)',
              boxShadow:
                style.color.toLowerCase() === color.toLowerCase()
                  ? '0 0 0 2px rgba(125,211,192,0.35)'
                  : undefined,
            }}
          />
        ))}

        <label
          className="ml-1 h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-white/15"
          title="Custom colour"
        >
          <input
            type="color"
            value={style.color}
            onChange={(event) => setStyle({ color: event.target.value })}
            className="h-10 w-10 -translate-x-1 -translate-y-1 cursor-pointer border-0 bg-transparent p-0"
            aria-label="Custom colour"
          />
        </label>
      </div>

      <div className="h-8 w-px bg-ink-700" />

      <Slider
        label="Size"
        value={style.width}
        min={0.008}
        max={0.4}
        step={0.002}
        format={(v) => `${(v * 100).toFixed(1)} cm`}
        onChange={(width) => setStyle({ width })}
      />

      <Slider
        label="Flat"
        value={style.flatness}
        min={0.08}
        max={1}
        step={0.02}
        format={(v) => (v > 0.9 ? 'round' : v < 0.2 ? 'ribbon' : v.toFixed(2))}
        onChange={(flatness) => setStyle({ flatness })}
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
      <span className="flex justify-between text-[11px] uppercase tracking-wide text-ink-400">
        <span>{label}</span>
        <span className="tabular-nums text-ink-200">{format(value)}</span>
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
