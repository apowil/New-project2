import {
  buildStrokeGeometry,
  geometryOptions,
  type StrokeGeometry,
  type StrokeSample,
  type StrokeStyle,
  type Vec3,
} from '@wisp/core';


/**
 * Sweeping a set of polylines into one mesh.
 *
 * Text and dimensions are both made of many short runs — eighty glyph strokes,
 * or a handful of witness lines and arrows — and both want to be a single
 * object rather than a crowd of them. Concatenating the swept buffers is what
 * makes that possible without a second rendering path.
 */

/**
 * A full {@link StrokeGeometry}, so a merged result can be previewed and
 * uploaded through exactly the same paths as a single swept stroke.
 */
export type MergedGeometry = StrokeGeometry;

/** Concatenates several swept runs into one set of buffers. */
export function mergeRuns(
  runs: Array<ReturnType<typeof buildStrokeGeometry>>,
): MergedGeometry | null {
  const built = runs.filter((run): run is NonNullable<typeof run> => run !== null);
  if (built.length === 0) return null;

  const vertexCount = built.reduce((total, run) => total + run.positions.length / 3, 0);
  const indexCount = built.reduce((total, run) => total + run.indices.length, 0);

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const run of built) {
    positions.set(run.positions, vertexOffset * 3);
    normals.set(run.normals, vertexOffset * 3);
    uvs.set(run.uvs, vertexOffset * 2);
    // Each run indexes from zero, so shift by the vertices already written.
    for (let i = 0; i < run.indices.length; i += 1) {
      indices[indexOffset + i] = run.indices[i]! + vertexOffset;
    }
    vertexOffset += run.positions.length / 3;
    indexOffset += run.indices.length;
  }

  return { positions, normals, uvs, indices };
}

/**
 * Sweeps polylines at an even width.
 *
 * No taper and no pressure response: these runs are lettering and rule lines,
 * where a stroke that thins towards its ends reads as a mistake rather than as
 * expression.
 */
export function sweepPolylines(
  polylines: Vec3[][],
  style: StrokeStyle,
  initialNormal?: Vec3,
): MergedGeometry | null {
  if (polylines.length === 0) return null;

  const options = {
    ...geometryOptions(style),
    ...(initialNormal ? { initialNormal } : {}),
    taper: 0,
    minPressureScale: 1,
  };

  return mergeRuns(
    polylines.map((polyline) => {
      const samples: StrokeSample[] = polyline.map((position) => ({ position, pressure: 1 }));
      return buildStrokeGeometry(samples, options);
    }),
  );
}
