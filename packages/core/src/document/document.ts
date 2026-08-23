import { type Vec3 } from '../math/vec3.js';
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

/** Nodes in draw order, skipping any hidden on its own or by its layer. */
export function visibleNodes(doc: SketchDocument): SceneNode[] {
  const hidden = new Set(
    doc.layers.filter((layer) => !layer.visible).map((layer) => layer.id),
  );
  const result: SceneNode[] = [];
  for (const id of doc.order) {
    const node = doc.nodes.get(id);
    if (node && !node.hidden && !hidden.has(node.layerId)) result.push(node);
  }
  return result;
}

/**
 * True when a node can be selected and edited.
 *
 * Both the node and its layer have a say: locking a layer protects everything
 * on it, and locking one node protects that node wherever it lives.
 */
export function isNodeEditable(doc: SketchDocument, node: SceneNode): boolean {
  if (node.hidden || node.locked) return false;
  return isLayerEditable(doc, node.layerId);
}

/**
 * The axis-aligned bounds of some nodes, in world space.
 *
 * Taken from the document rather than from rendered meshes so that transforms
 * and numeric placement work the same with or without a viewport, and can be
 * tested without one.
 */
export function nodesBounds(
  doc: SketchDocument,
  ids: readonly NodeId[],
): { min: Vec3; max: Vec3 } | null {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let found = false;

  const include = (p: Vec3): void => {
    found = true;
    if (p.x < min.x) min.x = p.x;
    if (p.y < min.y) min.y = p.y;
    if (p.z < min.z) min.z = p.z;
    if (p.x > max.x) max.x = p.x;
    if (p.y > max.y) max.y = p.y;
    if (p.z > max.z) max.z = p.z;
  };

  for (const id of ids) {
    const node = doc.nodes.get(id);
    if (!node) continue;

    if (node.type === 'stroke') {
      for (const sample of node.samples) include(sample.position);
    } else if (node.type === 'baked') {
      const { positions } = node;
      for (let i = 0; i + 2 < positions.length; i += 3) {
        include({ x: positions[i]!, y: positions[i + 1]!, z: positions[i + 2]! });
      }
    } else if (node.type === 'annotation') {
      include(node.from);
      include(node.to);
    } else {
      include(node.transform.position);
    }
  }

  return found ? { min, max } : null;
}

/** The middle of those bounds — the natural pivot for a transform. */
export function nodesCentre(doc: SketchDocument, ids: readonly NodeId[]): Vec3 | null {
  const bounds = nodesBounds(doc, ids);
  if (!bounds) return null;
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

/** Every node sharing a group with the ones given, plus the ones given. */
export function expandGroups(doc: SketchDocument, ids: NodeId[]): NodeId[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const group = doc.nodes.get(id)?.groupId;
    if (group) groups.add(group);
  }
  if (groups.size === 0) return [...ids];

  const wanted = new Set(ids);
  for (const id of doc.order) {
    const node = doc.nodes.get(id);
    if (node?.groupId && groups.has(node.groupId)) wanted.add(id);
  }
  // Group members come back in draw order so the result is stable.
  return doc.order.filter((id) => wanted.has(id));
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
