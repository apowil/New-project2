import { useEffect, useRef, useState } from 'react';

import { UNITS } from '@wisp/core';

import { useStore } from '../state/store.js';
import { type ThemePreference } from '../state/theme.js';
import { MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from './Icons.js';

const THEMES: Array<{ id: ThemePreference; label: string; Icon: typeof SunIcon }> = [
  { id: 'light', label: 'Light', Icon: SunIcon },
  { id: 'dark', label: 'Dark', Icon: MoonIcon },
  { id: 'system', label: 'System', Icon: MonitorIcon },
];

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const themePreference = useStore((state) => state.themePreference);
  const setThemePreference = useStore((state) => state.setThemePreference);
  const touchIntent = useStore((state) => state.touchIntent);
  const setTouchIntent = useStore((state) => state.setTouchIntent);
  const showPlaneIndicator = useStore((state) => state.showPlaneIndicator);
  const setShowPlaneIndicator = useStore((state) => state.setShowPlaneIndicator);
  const unit = useStore((state) => state.unit);
  const setUnit = useStore((state) => state.setUnit);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="tool-button"
        onClick={() => setOpen((value) => !value)}
        data-active={open}
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
      >
        <SettingsIcon />
      </button>

      {open && (
        <div
          className="panel absolute right-0 top-full z-50 mt-2 flex w-56 flex-col gap-3 p-3"
          role="dialog"
          aria-label="Settings"
        >
            <div className="flex flex-col gap-1.5">
              <span className="section-label">Appearance</span>
              <div className="grid grid-cols-3 gap-1">
                {THEMES.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className="chip flex flex-col items-center gap-1 py-2"
                    data-active={themePreference === id}
                    onClick={() => setThemePreference(id)}
                    aria-pressed={themePreference === id}
                  >
                    <Icon />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <span className="section-label">Units</span>
              <div className="grid grid-cols-5 gap-1">
                {UNITS.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className="chip px-1"
                    data-active={unit === candidate}
                    onClick={() => setUnit(candidate)}
                    aria-pressed={unit === candidate}
                    title={`Show measurements in ${candidate}`}
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <span className="section-label">One finger</span>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  className="chip"
                  data-active={touchIntent === 'camera'}
                  onClick={() => setTouchIntent('camera')}
                  title="A finger orbits the view — use the pen to draw"
                >
                  Orbits
                </button>
                <button
                  type="button"
                  className="chip"
                  data-active={touchIntent === 'draw'}
                  onClick={() => setTouchIntent('draw')}
                  title="A finger draws — for tablets without a stylus"
                >
                  Draws
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between border-t border-line pt-3 text-xs text-secondary">
              Show sketch plane
              <input
                type="checkbox"
                checked={showPlaneIndicator}
                onChange={(event) => setShowPlaneIndicator(event.target.checked)}
                className="accent-[var(--color-accent)]"
              />
          </label>
        </div>
      )}
    </div>
  );
}
