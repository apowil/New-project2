/**
 * The size of thing you are drawing.
 *
 * One scene unit is always one metre — that never changes. What changes is
 * where the camera starts, how big the grid is, how far the sketch plane
 * slides, and how broad a default stroke is. A 0.2 mm line and a six-metre
 * wall are both legitimate; no single set of defaults serves them both.
 *
 * The number that forces this: at a six-metre viewing distance one screen
 * pixel spans about seven millimetres, so a 0.2 mm stroke is three hundredths
 * of a pixel — perfectly real, and completely invisible. Product work has to
 * start closer or it cannot be seen at all.
 */

export type SceneScale = 'product' | 'interior' | 'architectural';

export interface SceneScaleSpec {
  label: string;
  description: string;
  /** Where the camera sits on a fresh sketch, in metres. */
  cameraDistance: number;
  /** Closest and furthest the camera may get, in metres. */
  minDistance: number;
  maxDistance: number;
  /** Grid extent and division count. */
  gridSize: number;
  gridDivisions: number;
  /** How far the sketch plane can slide either way, in metres. */
  planeRange: number;
  /** A sensible stroke to start with, in metres. */
  defaultWidth: number;
}

export const SCENE_SCALES: Record<SceneScale, SceneScaleSpec> = {
  product: {
    label: 'Product',
    description: 'A handheld object. Millimetre detail.',
    cameraDistance: 0.3,
    minDistance: 0.02,
    maxDistance: 12,
    gridSize: 0.5,
    gridDivisions: 50,
    planeRange: 0.25,
    defaultWidth: 0.0005,
  },
  interior: {
    label: 'Interior',
    description: 'A room or a piece of furniture.',
    cameraDistance: 6,
    minDistance: 0.35,
    maxDistance: 250,
    gridSize: 40,
    gridDivisions: 40,
    planeRange: 4,
    defaultWidth: 0.02,
  },
  architectural: {
    label: 'Building',
    description: 'A whole structure or a site.',
    cameraDistance: 40,
    minDistance: 2,
    maxDistance: 1200,
    gridSize: 200,
    gridDivisions: 40,
    planeRange: 25,
    defaultWidth: 0.08,
  },
};

export const DEFAULT_SCENE_SCALE: SceneScale = 'interior';

export const sceneScaleSpec = (scale: SceneScale): SceneScaleSpec =>
  SCENE_SCALES[scale] ?? SCENE_SCALES[DEFAULT_SCENE_SCALE];

/**
 * How many screen pixels wide a stroke of `width` appears.
 *
 * Used to tell somebody plainly that the line they have chosen is finer than
 * their screen can draw, which is otherwise indistinguishable from the app
 * being broken.
 */
export const strokePixels = (width: number, worldPerPixel: number): number =>
  worldPerPixel > 0 ? width / worldPerPixel : 0;
