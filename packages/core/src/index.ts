export * as vec3 from './math/vec3.js';
export type { Vec3 } from './math/vec3.js';

export * from './math/plane.js';

export { OneEuroFilter, PointerFilter, type OneEuroOptions } from './stroke/filter.js';
export {
  type StrokeSample,
  simplify,
  resampleUniform,
  smoothPositions,
  catmullRom,
  arcLength,
} from './stroke/resample.js';
export {
  type StrokeGeometry,
  type StrokeGeometryOptions,
  DEFAULT_STROKE_OPTIONS,
  buildStrokeGeometry,
  computeBounds,
} from './stroke/geometry.js';

export * from './document/types.js';
export * from './document/document.js';
export { createId } from './document/ids.js';

export { History, type Command, type HistoryState } from './history/history.js';
export * from './history/commands.js';

export * from './ops/types.js';
export { handlers, InlineOpRunner } from './ops/handlers.js';
