import { DEFAULT_STROKE_STYLE, type StrokeStyle } from '@wisp/core';

/**
 * Brush presets.
 *
 * A brush is a named set of everything except colour and size — cross-section,
 * taper, how hard pressure bites, surface finish, and translucency. Colour and
 * size stay yours: switching from a pen to a marker should not silently change
 * what colour you are drawing in or how big the mark is.
 *
 * Opacity is part of a brush rather than a separate control because it is what
 * *makes* a water marker a water marker; a fully opaque one is just a pen.
 */
export interface Brush {
  id: string;
  name: string;
  description: string;
  shape: Omit<StrokeStyle, 'color' | 'width'>;
}

export const BRUSHES: Brush[] = [
  {
    id: 'round-brush',
    name: 'Round brush',
    description: 'Full round body, strong pressure response and a soft taper',
    shape: {
      flatness: 1,
      sides: 12,
      taper: 0.18,
      pressureCurve: 1.5,
      minPressureScale: 0.28,
      opacity: 1,
      roughness: 0.62,
      metalness: 0,
    },
  },
  {
    id: 'flat-brush',
    name: 'Flat brush',
    description: 'Chisel edge — width depends on the direction you pull it',
    shape: {
      flatness: 0.12,
      sides: 8,
      taper: 0.2,
      pressureCurve: 1.6,
      minPressureScale: 0.25,
      opacity: 1,
      roughness: 0.66,
      metalness: 0,
    },
  },
  {
    id: 'pen',
    name: 'Pen',
    description: 'Near-constant width, crisp and slightly glossy',
    shape: {
      flatness: 0.75,
      sides: 8,
      taper: 0.05,
      pressureCurve: 1,
      minPressureScale: 0.82,
      opacity: 1,
      roughness: 0.34,
      metalness: 0,
    },
  },
  {
    id: 'pencil',
    name: 'Pencil',
    description: 'Matte and dry, with the grainy width change of graphite',
    shape: {
      flatness: 0.5,
      sides: 6,
      taper: 0.12,
      pressureCurve: 2,
      minPressureScale: 0.3,
      opacity: 0.92,
      roughness: 0.97,
      metalness: 0,
    },
  },
  {
    id: 'water-round',
    name: 'Water marker round',
    description: 'Translucent and round — overlaps build up colour',
    shape: {
      flatness: 0.9,
      sides: 10,
      taper: 0.1,
      pressureCurve: 1.1,
      minPressureScale: 0.6,
      opacity: 0.42,
      roughness: 0.88,
      metalness: 0,
    },
  },
  {
    id: 'water-flat',
    name: 'Water marker flat',
    description: 'Translucent chisel — broad washes with a hard edge',
    shape: {
      flatness: 0.16,
      sides: 8,
      taper: 0.06,
      pressureCurve: 1.1,
      minPressureScale: 0.7,
      opacity: 0.42,
      roughness: 0.9,
      metalness: 0,
    },
  },
];

export const DEFAULT_BRUSH_ID = 'pen';

export const findBrush = (id: string): Brush =>
  BRUSHES.find((brush) => brush.id === id) ?? BRUSHES[0]!;

/**
 * Which preset a style corresponds to, or null once it has been hand-tweaked.
 * Lets the UI show the brush name until you move a slider, then show none.
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

/** Starting style for a fresh sketch, on a stroke colour the theme supplies. */
export const styleForBrush = (id: string, color: string): StrokeStyle => ({
  ...DEFAULT_STROKE_STYLE,
  ...findBrush(id).shape,
  color,
});
