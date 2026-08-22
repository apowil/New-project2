/**
 * Heavy operations, and where they run.
 *
 * Anything expensive enough to stutter a tablet is expressed as an *operation*
 * rather than an inline function call. An operation is a plain serialisable
 * request/response pair, which means the same code can execute:
 *
 *   - inline on the main thread (tiny inputs),
 *   - in a Web Worker on the tablet (the default),
 *   - or on a paired PC over the compute link (stage 5).
 *
 * The call sites never learn which happened. That indirection is the whole
 * reason the PC-offload feature is cheap to add later instead of a rewrite.
 */

import { type StrokeGeometryOptions } from '../stroke/geometry.js';
import { type StrokeSample } from '../stroke/resample.js';

export interface OpRequestMap {
  /** Sweep a centreline into a mesh. */
  buildStroke: {
    samples: StrokeSample[];
    options: Partial<StrokeGeometryOptions>;
  };
  /** Simplify + resample + smooth a raw pointer trail. */
  processStroke: {
    samples: StrokeSample[];
    simplifyTolerance: number;
    spacing: number;
    smoothing: number;
  };
}

export interface OpResponseMap {
  buildStroke: {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
  } | null;
  processStroke: {
    samples: StrokeSample[];
  };
}

export type OpName = keyof OpRequestMap;

export interface OpRunner {
  /** Human-readable, shown in the UI: "On device" / "PC — DESKTOP-4F2". */
  readonly description: string;
  run<K extends OpName>(name: K, request: OpRequestMap[K]): Promise<OpResponseMap[K]>;
  dispose?(): void;
}

export type OpHandlers = {
  [K in OpName]: (request: OpRequestMap[K]) => OpResponseMap[K];
};
