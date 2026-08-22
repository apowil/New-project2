/**
 * Light and dark.
 *
 * "System" is resolved to a concrete value in JS and stamped onto <html> as
 * data-theme, rather than left to a CSS media query. One code path means the
 * 3D scene — which cannot read a media query — always agrees with the panels.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'wisp.theme';

/** Colours the WebGL scene needs, which Tailwind tokens cannot reach. */
export interface SceneTheme {
  background: number;
  fog: number;
  gridMajor: number;
  gridMinor: number;
  gridOpacity: number;
  /** Sensible stroke colour for a fresh sketch on this ground. */
  defaultStroke: string;
  environmentIntensity: number;
}

export const SCENE_THEMES: Record<ResolvedTheme, SceneTheme> = {
  dark: {
    background: 0x111214,
    fog: 0x111214,
    gridMajor: 0x3a3e46,
    gridMinor: 0x24272c,
    gridOpacity: 0.45,
    defaultStroke: '#d8d2c8',
    environmentIntensity: 0.55,
  },
  light: {
    background: 0xeef0f3,
    fog: 0xeef0f3,
    gridMajor: 0xb4bac3,
    gridMinor: 0xd3d8de,
    gridOpacity: 0.7,
    // A pale stroke would be invisible on a light ground, so a fresh sketch
    // starts dark instead.
    defaultStroke: '#31363f',
    environmentIntensity: 0.9,
  },
};

/**
 * Reads the stored preference and applies it immediately.
 *
 * Called before React mounts. Doing this inside the app's async startup meant
 * the first frames painted in whichever theme happened to be the default,
 * producing a visible flash before the real one landed.
 */
export function initTheme(): { preference: ThemePreference; resolved: ResolvedTheme } {
  const preference = readThemePreference();
  const resolved = resolveTheme(preference);
  applyTheme(resolved);
  return { preference, resolved };
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* storage disabled */
  }
  return 'system';
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* storage disabled; the choice just will not persist */
  }
}

const systemQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  return systemQuery()?.matches ? 'light' : 'dark';
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  // Keeps the Android address bar and the PWA status bar in step.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'light' ? '#eef0f3' : '#111214');
  }
}

/**
 * Calls back when the OS switches appearance. Only meaningful while the
 * preference is "system"; callers re-check that themselves.
 */
export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  const query = systemQuery();
  if (!query) return () => {};

  const listener = (event: MediaQueryListEvent) => onChange(event.matches ? 'light' : 'dark');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
