import {
  AddNodesCommand,
  buildStrokeGeometry,
  buildTextPolylines,
  createId,
  isLayerEditable,
  measureText,
  type BakedMeshNode,
  type Plane,
  type StrokeSample,
  type TextParams,
} from '@wisp/core';

import { geometryOptions, type Viewport } from '../viewport/viewport.js';
import { session, useStore } from '../state/store.js';

/**
 * Placing text.
 *
 * Every glyph run is swept with the current brush and the results are
 * concatenated into a single baked mesh, so a text block is one object to
 * select, move, combine and delete — rather than eighty separate strokes that
 * have to be rubber-banded every time.
 */

/** Concatenates several swept runs into one set of buffers. */
function mergeRuns(
  runs: Array<ReturnType<typeof buildStrokeGeometry>>,
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } | null {
  const built = runs.filter((run): run is NonNullable<typeof run> => run !== null);
  if (built.length === 0) return null;

  const vertexCount = built.reduce((total, run) => total + run.positions.length / 3, 0);
  const indexCount = built.reduce((total, run) => total + run.indices.length, 0);

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const run of built) {
    positions.set(run.positions, vertexOffset * 3);
    normals.set(run.normals, vertexOffset * 3);
    // Each run indexes from zero, so shift by the vertices already written.
    for (let i = 0; i < run.indices.length; i += 1) {
      indices[indexOffset + i] = run.indices[i]! + vertexOffset;
    }
    vertexOffset += run.positions.length / 3;
    indexOffset += run.indices.length;
  }

  return { positions, normals, indices };
}

/** Builds the geometry for a text block without committing it. */
export function buildTextGeometry(params: TextParams, plane: Plane, style = useStore.getState().style) {
  const polylines = buildTextPolylines(params, plane);
  if (polylines.length === 0) return null;

  const options = { ...geometryOptions(style), initialNormal: plane.normal };
  return mergeRuns(
    polylines.map((polyline) => {
      // A glyph run is already a clean polyline: constant pressure, no taper,
      // so the stroke width stays even the way lettering should.
      const samples: StrokeSample[] = polyline.map((position) => ({ position, pressure: 1 }));
      return buildStrokeGeometry(samples, { ...options, taper: 0, minPressureScale: 1 });
    }),
  );
}

export class TextTool {
  constructor(private readonly viewport: Viewport) {}

  /** Adds a text block anchored at a plane point. */
  place(params: TextParams, plane: Plane): boolean {
    const store = useStore.getState();
    if (!isLayerEditable(session.document, store.activeLayerId)) return false;

    const geometry = buildTextGeometry(params, plane, store.style);
    if (!geometry) return false;

    const node: BakedMeshNode = {
      id: createId('text'),
      type: 'baked',
      layerId: store.activeLayerId,
      label: `Text "${params.text.split('\n')[0]?.slice(0, 24) ?? ''}"`,
      positions: geometry.positions,
      normals: geometry.normals,
      indices: geometry.indices,
      style: { ...store.style },
      createdAt: Date.now(),
    };

    store.run(new AddNodesCommand([node], 'Add text'));
    store.setSelection([node.id]);
    this.viewport.requestRender();
    return true;
  }

  /** Size of the block, for the dimension readout. */
  measure(params: TextParams) {
    return measureText(params);
  }
}
