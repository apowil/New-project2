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
