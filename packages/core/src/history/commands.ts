import { addNode, removeNode, touch } from '../document/document.js';
import {
  type Layer,
  type LayerId,
  type NodeId,
  type SceneNode,
  type SketchDocument,
  type StrokeStyle,
} from '../document/types.js';
import { type Command } from './history.js';

export class AddNodeCommand implements Command {
  readonly label: string;
  private index: number | undefined;

  constructor(private readonly node: SceneNode, label = 'Draw stroke') {
    this.label = label;
  }

  apply(doc: SketchDocument): void {
    addNode(doc, this.node, this.index);
  }

  revert(doc: SketchDocument): void {
    // Remember where it sat so redo restores draw order exactly.
    this.index = removeNode(doc, this.node.id);
  }
}

/**
 * Adds several nodes as one history step — a mirrored stroke is one action to
 * the person drawing it, so one undo has to take all of its copies with it.
 */
export class AddNodesCommand implements Command {
  readonly label: string;
  private indices: Array<number | undefined> = [];

  constructor(private readonly nodes: SceneNode[], label = 'Draw stroke') {
    this.label = label;
  }

  apply(doc: SketchDocument): void {
    this.nodes.forEach((node, i) => addNode(doc, node, this.indices[i]));
  }

  revert(doc: SketchDocument): void {
    // Reverse order so each recorded index is still valid on redo.
    this.indices = [];
    for (let i = this.nodes.length - 1; i >= 0; i -= 1) {
      this.indices[i] = removeNode(doc, this.nodes[i]!.id);
    }
  }
}

export class DeleteNodesCommand implements Command {
  readonly label: string;
  private removed: Array<{ node: SceneNode; index: number }> = [];

  constructor(private readonly ids: NodeId[], label?: string) {
    this.label = label ?? (ids.length === 1 ? 'Delete' : `Delete ${ids.length} items`);
  }

  apply(doc: SketchDocument): void {
    this.removed = [];
    for (const id of this.ids) {
      const node = doc.nodes.get(id);
      if (!node) continue;
      const index = removeNode(doc, id);
      this.removed.push({ node, index });
    }
  }

  revert(doc: SketchDocument): void {
    // Each recorded index was relative to the array as it stood *at the time
    // of that removal*, so the removals have to be undone last-in-first-out.
    // Reinserting in ascending index order instead would misplace every node
    // after the first.
    for (let i = this.removed.length - 1; i >= 0; i -= 1) {
      const { node, index } = this.removed[i]!;
      addNode(doc, node, index < 0 ? undefined : index);
    }
  }
}

export class AddLayerCommand implements Command {
  readonly label = 'Add layer';
  private previousActive: LayerId | null = null;

  constructor(private readonly layer: Layer) {}

  apply(doc: SketchDocument): void {
    this.previousActive = doc.activeLayerId;
    doc.layers.push(this.layer);
    doc.activeLayerId = this.layer.id;
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    doc.layers = doc.layers.filter((layer) => layer.id !== this.layer.id);
    if (this.previousActive) doc.activeLayerId = this.previousActive;
    touch(doc);
  }
}

export class DeleteLayerCommand implements Command {
  readonly label = 'Delete layer';
  private index = -1;
  private layer: Layer | undefined;
  private orphaned: Array<{ node: SceneNode; index: number }> = [];
  private previousActive: LayerId | null = null;

  constructor(private readonly layerId: LayerId) {}

  apply(doc: SketchDocument): void {
    this.index = doc.layers.findIndex((layer) => layer.id === this.layerId);
    if (this.index < 0) return;

    this.layer = doc.layers[this.index];
    this.previousActive = doc.activeLayerId;
    this.orphaned = [];

    // Deleting a layer deletes its contents; both are restored together.
    for (const id of [...doc.order]) {
      const node = doc.nodes.get(id);
      if (node?.layerId !== this.layerId) continue;
      const nodeIndex = removeNode(doc, id);
      this.orphaned.push({ node, index: nodeIndex });
    }

    doc.layers.splice(this.index, 1);
    if (doc.activeLayerId === this.layerId) {
      doc.activeLayerId = doc.layers[0]?.id ?? '';
    }
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    if (!this.layer || this.index < 0) return;
    doc.layers.splice(this.index, 0, this.layer);

    // Last-in-first-out, for the same reason as DeleteNodesCommand.
    for (let i = this.orphaned.length - 1; i >= 0; i -= 1) {
      const { node, index } = this.orphaned[i]!;
      addNode(doc, node, index < 0 ? undefined : index);
    }

    if (this.previousActive) doc.activeLayerId = this.previousActive;
    touch(doc);
  }
}

export class SetLayerPropertyCommand<K extends keyof Layer> implements Command {
  readonly label: string;
  private previous: Layer[K] | undefined;

  constructor(
    private readonly layerId: LayerId,
    private readonly key: K,
    private readonly value: Layer[K],
    label?: string,
  ) {
    this.label = label ?? `Change layer ${String(key)}`;
  }

  apply(doc: SketchDocument): void {
    const layer = doc.layers.find((l) => l.id === this.layerId);
    if (!layer) return;
    this.previous = layer[this.key];
    layer[this.key] = this.value;
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    const layer = doc.layers.find((l) => l.id === this.layerId);
    if (!layer || this.previous === undefined) return;
    layer[this.key] = this.previous;
    touch(doc);
  }
}

export class SetStyleCommand implements Command {
  readonly label = 'Change style';
  private previous = new Map<NodeId, StrokeStyle>();

  constructor(
    private readonly ids: NodeId[],
    private readonly patch: Partial<StrokeStyle>,
  ) {}

  apply(doc: SketchDocument): void {
    this.previous.clear();
    for (const id of this.ids) {
      const node = doc.nodes.get(id);
      if (!node) continue;
      this.previous.set(id, { ...node.style });
      node.style = { ...node.style, ...this.patch };
    }
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    for (const [id, style] of this.previous) {
      const node = doc.nodes.get(id);
      if (node) node.style = style;
    }
    touch(doc);
  }
}

export class RenameDocumentCommand implements Command {
  readonly label = 'Rename sketch';
  private previous = '';

  constructor(private readonly name: string) {}

  apply(doc: SketchDocument): void {
    this.previous = doc.name;
    doc.name = this.name;
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    doc.name = this.previous;
    touch(doc);
  }
}

/**
 * Swaps a set of nodes for a different set, as one step.
 *
 * This is what a boolean operation is from the document's point of view: the
 * inputs stop existing and a result takes their place. Doing it as one command
 * means a single undo puts the originals back rather than leaving the sketch
 * in a half-cut state.
 */
export class ReplaceNodesCommand implements Command {
  readonly label: string;
  private removed: Array<{ node: SceneNode; index: number }> = [];

  constructor(
    private readonly removeIds: NodeId[],
    private readonly additions: SceneNode[],
    label = 'Replace',
  ) {
    this.label = label;
  }

  apply(doc: SketchDocument): void {
    this.removed = [];
    // Insert the result where the frontmost input was, so draw order is
    // preserved rather than the result jumping to the top.
    let insertAt = doc.order.length;

    for (const id of this.removeIds) {
      const node = doc.nodes.get(id);
      if (!node) continue;
      const index = removeNode(doc, id);
      if (index >= 0) insertAt = Math.min(insertAt, index);
      this.removed.push({ node, index });
    }

    this.additions.forEach((node, offset) => addNode(doc, node, insertAt + offset));
  }

  revert(doc: SketchDocument): void {
    for (const node of this.additions) removeNode(doc, node.id);

    // Last-in-first-out, so each recorded index is valid as it is used.
    for (let i = this.removed.length - 1; i >= 0; i -= 1) {
      const { node, index } = this.removed[i]!;
      addNode(doc, node, index < 0 ? undefined : index);
    }
  }
}

/** Moves nodes between layers without disturbing draw order. */
export class MoveNodesToLayerCommand implements Command {
  readonly label: string;
  private previous = new Map<NodeId, LayerId>();

  constructor(
    private readonly ids: NodeId[],
    private readonly layerId: LayerId,
    label = 'Move to layer',
  ) {
    this.label = label;
  }

  apply(doc: SketchDocument): void {
    this.previous.clear();
    for (const id of this.ids) {
      const node = doc.nodes.get(id);
      if (!node) continue;
      this.previous.set(id, node.layerId);
      node.layerId = this.layerId;
    }
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    for (const [id, layerId] of this.previous) {
      const node = doc.nodes.get(id);
      if (node) node.layerId = layerId;
    }
    touch(doc);
  }
}

/**
 * Folds one layer's contents into another and removes the empty layer.
 *
 * The nodes keep their identity and draw order; only their layer changes. That
 * matters because merging is meant to be an organisational act, not one that
 * re-stacks the drawing.
 */
export class MergeLayersCommand implements Command {
  readonly label = 'Merge layers';
  private moved: Array<{ id: NodeId; from: LayerId }> = [];
  private removedLayers: Array<{ layer: Layer; index: number }> = [];
  private previousActive: LayerId | null = null;

  constructor(
    private readonly sourceIds: LayerId[],
    private readonly targetId: LayerId,
  ) {}

  apply(doc: SketchDocument): void {
    this.moved = [];
    this.removedLayers = [];
    this.previousActive = doc.activeLayerId;

    const sources = new Set(this.sourceIds.filter((id) => id !== this.targetId));
    if (sources.size === 0) return;

    for (const id of doc.order) {
      const node = doc.nodes.get(id);
      if (!node || !sources.has(node.layerId)) continue;
      this.moved.push({ id: node.id, from: node.layerId });
      node.layerId = this.targetId;
    }

    for (const layerId of sources) {
      const index = doc.layers.findIndex((layer) => layer.id === layerId);
      if (index < 0) continue;
      this.removedLayers.push({ layer: doc.layers[index]!, index });
    }

    doc.layers = doc.layers.filter((layer) => !sources.has(layer.id));
    if (sources.has(doc.activeLayerId)) doc.activeLayerId = this.targetId;
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    // Ascending index, so each layer lands back in its original slot.
    const ordered = [...this.removedLayers].sort((a, b) => a.index - b.index);
    for (const { layer, index } of ordered) {
      doc.layers.splice(Math.min(index, doc.layers.length), 0, layer);
    }

    for (const { id, from } of this.moved) {
      const node = doc.nodes.get(id);
      if (node) node.layerId = from;
    }

    if (this.previousActive) doc.activeLayerId = this.previousActive;
    touch(doc);
  }
}

/** Adds a layer together with copies of another layer's contents. */
export class DuplicateLayerCommand implements Command {
  readonly label = 'Duplicate layer';
  private previousActive: LayerId | null = null;

  constructor(
    private readonly layer: Layer,
    private readonly nodes: SceneNode[],
    private readonly index: number,
  ) {}

  apply(doc: SketchDocument): void {
    this.previousActive = doc.activeLayerId;
    doc.layers.splice(Math.min(Math.max(this.index, 0), doc.layers.length), 0, this.layer);
    for (const node of this.nodes) addNode(doc, node);
    doc.activeLayerId = this.layer.id;
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    for (const node of this.nodes) removeNode(doc, node.id);
    doc.layers = doc.layers.filter((layer) => layer.id !== this.layer.id);
    if (this.previousActive) doc.activeLayerId = this.previousActive;
    touch(doc);
  }
}
