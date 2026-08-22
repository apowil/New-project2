import { createId } from './ids.js';
import {
  type Layer,
  type LayerId,
  type NodeId,
  type SceneNode,
  type SketchDocument,
} from './types.js';

export function createLayer(name: string): Layer {
  return {
    id: createId('layer'),
    name,
    visible: true,
    locked: false,
    opacity: 1,
  };
}

export function createDocument(name = 'Untitled sketch'): SketchDocument {
  const layer = createLayer('Layer 1');
  const now = Date.now();

  return {
    id: createId('doc'),
    name,
    revision: 0,
    layers: [layer],
    activeLayerId: layer.id,
    nodes: new Map(),
    order: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Every mutation funnels through here so `revision` can never drift. */
export function touch(doc: SketchDocument): void {
  doc.revision += 1;
  doc.updatedAt = Date.now();
}

export function addNode(doc: SketchDocument, node: SceneNode, index?: number): void {
  doc.nodes.set(node.id, node);
  if (index === undefined || index >= doc.order.length) {
    doc.order.push(node.id);
  } else {
    doc.order.splice(Math.max(index, 0), 0, node.id);
  }
  touch(doc);
}

/** Returns the removed node's draw-order index, so undo can put it back. */
export function removeNode(doc: SketchDocument, id: NodeId): number {
  const index = doc.order.indexOf(id);
  if (index >= 0) doc.order.splice(index, 1);
  doc.nodes.delete(id);
  touch(doc);
  return index;
}

export const getNode = (doc: SketchDocument, id: NodeId): SceneNode | undefined =>
  doc.nodes.get(id);

export function getLayer(doc: SketchDocument, id: LayerId): Layer | undefined {
  return doc.layers.find((layer) => layer.id === id);
}

/** Nodes in draw order, skipping any whose layer is hidden. */
export function visibleNodes(doc: SketchDocument): SceneNode[] {
  const hidden = new Set(
    doc.layers.filter((layer) => !layer.visible).map((layer) => layer.id),
  );
  const result: SceneNode[] = [];
  for (const id of doc.order) {
    const node = doc.nodes.get(id);
    if (node && !hidden.has(node.layerId)) result.push(node);
  }
  return result;
}

export const nodesOnLayer = (doc: SketchDocument, layerId: LayerId): SceneNode[] =>
  doc.order
    .map((id) => doc.nodes.get(id))
    .filter((node): node is SceneNode => node !== undefined && node.layerId === layerId);

/** True when the layer cannot accept new geometry. */
export function isLayerEditable(doc: SketchDocument, layerId: LayerId): boolean {
  const layer = getLayer(doc, layerId);
  return layer !== undefined && layer.visible && !layer.locked;
}
