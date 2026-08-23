export * from './units.js';

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
  type MirrorAxes,
  NO_MIRROR,
  hasMirror,
  mirrorCombinations,
  mirrorSamples,
  mirrorVec3,
} from './stroke/mirror.js';
export {
  type StrokeGeometry,
  type StrokeGeometryOptions,
  DEFAULT_STROKE_OPTIONS,
  buildStrokeGeometry,
  computeBounds,
} from './stroke/geometry.js';

export * from './shapes/shapes.js';
export { buildTextPolylines, measureText, type TextParams } from './shapes/text.js';
export { ADVANCE, LINE_HEIGHT, glyphFor, hasGlyph, type Glyph } from './shapes/font.js';

export * from './document/types.js';
export * from './document/document.js';
export { createId } from './document/ids.js';
export { cloneNode, cloneNodes } from './document/clone.js';

export { History, type Command, type HistoryState } from './history/history.js';
export * from './history/commands.js';

export * from './ops/types.js';
export { handlers, InlineOpRunner } from './ops/handlers.js';

export { serializeDocument, deserializeDocument } from './io/serialize.js';
export {
  WispFormatError,
  WISP_FORMAT_VERSION,
  WISP_MAGIC,
  type WispManifest,
} from './io/format.js';
