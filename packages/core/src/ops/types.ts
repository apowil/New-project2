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

/**
 * One solid going into a boolean.
 *
 * A stroke travels as its centreline rather than as triangles, which is the
 * difference between a few kilobytes and a few megabytes on the wire — and the
 * receiving end can rebuild the exact same tube from it, because sweeping is
 * deterministic. Only geometry with no centreline left has to be sent whole.
 */
export type SolidInput =
  | {
      kind: 'stroke';
      samples: StrokeSample[];
      options: Partial<StrokeGeometryOptions>;
    }
  | {
      kind: 'mesh';
      positions: Float32Array;
      normals: Float32Array;
      indices: Uint32Array;
    };

export type BooleanOperation = 'union' | 'subtract' | 'intersect' | 'join';

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
  /** Cut, fuse or intersect solids. The expensive one. */
  evaluateBoolean: {
    op: BooleanOperation;
    solids: SolidInput[];
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
  /**
   * Failure is a value here, not an exception.
   *
   * A boolean fails for reasons the person drawing can act on — shapes that do
   * not overlap, a stroke crossing its own body — and those reasons have to
   * survive the trip back from a worker or another machine intact. An
   * exception thrown across that boundary arrives as a bare string with no
   * type, so the reason is carried deliberately instead.
   */
  evaluateBoolean:
    | {
        ok: true;
        positions: Float32Array;
        normals: Float32Array;
        indices: Uint32Array;
      }
    | { ok: false; reason: string };
}

export type OpName = keyof OpRequestMap;

export interface OpRunner {
  /** Human-readable, shown in the UI: "On device" / "PC — DESKTOP-4F2". */
  readonly description: string;
  run<K extends OpName>(name: K, request: OpRequestMap[K]): Promise<OpResponseMap[K]>;
  dispose?(): void;
}

/**
 * Implementations, keyed by name.
 *
 * Partial on purpose. Booleans need a CSG library, and `@wisp/core` carries no
 * runtime dependencies by design — so the app registers that handler at
 * startup instead. The desktop host registers the same one. Anything not
 * registered fails loudly rather than silently doing nothing.
 */
export type OpHandlers = {
  [K in OpName]?: (request: OpRequestMap[K]) => OpResponseMap[K];
};
