import { DEFAULT_STROKE_STYLE, type StrokeStyle } from '@wisp/core';

/**
 * Brush presets.
 *
 * A brush is a named set of *shape* parameters — cross-section, taper, how
 * hard pressure bites. Colour and size are deliberately not part of a preset:
 * switching brush mid-sketch should not silently change what colour you are
 * drawing in.
 */
export interface Brush {
  id: string;
  name: string;
  description: string;
  shape: Omit<StrokeStyle, 'color' | 'width' | 'opacity'>;
}

const base = {
  roughness: DEFAULT_STROKE_STYLE.roughness,
  metalness: DEFAULT_STROKE_STYLE.metalness,
};

export const BRUSHES: Brush[] = [
  {
    id: 'ink',
    name: 'Ink',
    description: 'Flat, chisel-like, with a strong taper — the default sketching brush',
    shape: {
      ...base,
      flatness: 0.45,
      sides: 8,
      taper: 0.14,
      pressureCurve: 1.4,
      minPressureScale: 0.35,
    },
  },
  {
    id: 'round',
    name: 'Round',
    description: 'A full round tube — reads as wire or armature',
    shape: {
      ...base,
      flatness: 1,
      sides: 12,
      taper: 0.06,
      pressureCurve: 1.2,
      minPressureScale: 0.5,
      roughness: 0.5,
    },
  },
  {
    id: 'ribbon',
    name: 'Ribbon',
    description: 'Nearly flat, like a brush loaded with paint',
    shape: {
      ...base,
      flatness: 0.14,
      sides: 8,
      taper: 0.2,
      pressureCurve: 1.6,
      minPressureScale: 0.25,
    },
  },
  {
    id: 'marker',
    name: 'Marker',
    description: 'Even width, blunt ends — good for blocking in',
    shape: {
      ...base,
      flatness: 0.35,
      sides: 6,
      taper: 0.02,
      pressureCurve: 1,
      minPressureScale: 0.85,
      roughness: 0.8,
    },
  },
  {
    id: 'liner',
    name: 'Liner',
    description: 'Fine, sharply tapered — for detail and hatching',
    shape: {
      ...base,
      flatness: 0.6,
      sides: 6,
      taper: 0.35,
      pressureCurve: 2.1,
      minPressureScale: 0.15,
    },
  },
  {
    id: 'chrome',
    name: 'Chrome',
    description: 'Polished metal, catches the light',
    shape: {
      flatness: 0.8,
      sides: 12,
      taper: 0.08,
      pressureCurve: 1.2,
      minPressureScale: 0.5,
      roughness: 0.12,
      metalness: 0.95,
    },
  },
];

export const DEFAULT_BRUSH_ID = 'ink';

export const findBrush = (id: string): Brush =>
  BRUSHES.find((brush) => brush.id === id) ?? BRUSHES[0]!;

/**
 * Which preset a style corresponds to, or null once it has been hand-tweaked.
 * Lets the UI show "Ink" as selected until you move a slider, then show none.
 */
export function matchBrush(style: StrokeStyle): string | null {
  for (const brush of BRUSHES) {
    const keys = Object.keys(brush.shape) as Array<keyof Brush['shape']>;
    if (keys.every((key) => Math.abs(style[key] - brush.shape[key]) < 1e-6)) {
      return brush.id;
    }
  }
  return null;
}
