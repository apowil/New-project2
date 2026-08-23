import {
  AddNodesCommand,
  buildTextPolylines,
  createId,
  isLayerEditable,
  measureText,
  type BakedMeshNode,
  type Plane,
  type TextParams,
} from '@wisp/core';

import { type Viewport } from '../viewport/viewport.js';
import { sweepPolylines } from '../viewport/sweep.js';
import { session, useStore } from '../state/store.js';

/**
 * Placing text.
 *
 * Every glyph run is swept with the current brush and the results are
 * concatenated into a single baked mesh, so a text block is one object to
 * select, move, combine and delete — rather than eighty separate strokes that
 * have to be rubber-banded every time.
 */

/** Builds the geometry for a text block without committing it. */
export function buildTextGeometry(params: TextParams, plane: Plane, style = useStore.getState().style) {
  return sweepPolylines(buildTextPolylines(params, plane), style, plane.normal);
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
