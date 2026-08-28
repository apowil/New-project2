import { addNode, removeNode, touch } from '../document/document.js';
import {
  type Layer,
  type LayerId,
  type NodeId,
  type SceneNode,
  type SketchDocument,
  type StrokeNode,
  type StrokeStyle,
} from '../document/types.js';
import {
  applyAffine,
  applyLinear,
  averageScale,
  flipsOrientation,
  invert,
  isIdentity,
  normalMatrix,
  translation,
  type Affine,
} from '../math/affine.js';
import { normalize, type Vec3 } from '../math/vec3.js';
import { type StrokeSample } from '../stroke/resample.js';
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

/** How long after one style change another counts as the same gesture. */
const STYLE_MERGE_WINDOW_MS = 700;

export class SetStyleCommand implements Command {
  readonly label = 'Change style';
  private previous = new Map<NodeId, StrokeStyle>();
  private readonly at = Date.now();

  constructor(
    private readonly ids: NodeId[],
    private patch: Partial<StrokeStyle>,
  ) {}

  /**
   * Absorbs the previous style change when it is part of the same gesture.
   *
   * Dragging a width slider fires a change per frame; without this, undo would
   * walk back through sixty of them. The time window is what separates "still
   * dragging" from "changed my mind a minute later", which should stay two
   * separate undo steps.
   */
  mergeWith(previous: Command): boolean {
    if (!(previous instanceof SetStyleCommand)) return false;
    if (this.at - previous.at > STYLE_MERGE_WINDOW_MS) return false;
    if (previous.ids.length !== this.ids.length) return false;
    if (!previous.ids.every((id, i) => this.ids[i] === id)) return false;

    // Undo has to land on the style from before the whole drag, not mid-drag.
    this.previous = previous.previous;

    // Both patches, not just the newer one. Two different properties changed
    // inside the window — a colour and then a width — would otherwise leave
    // redo reapplying only the width, silently dropping the colour.
    this.patch = { ...previous.patch, ...this.patch };
    return true;
  }

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

/** The per-node fields the outliner edits. */
export type NodeFlags = Pick<SceneNode, 'label' | 'hidden' | 'locked'>;

export class SetNodeFlagsCommand implements Command {
  readonly label: string;
  private previous = new Map<NodeId, NodeFlags>();

  constructor(
    private readonly ids: NodeId[],
    private readonly patch: NodeFlags,
    label = 'Change object',
  ) {
    this.label = label;
  }

  apply(doc: SketchDocument): void {
    this.previous.clear();
    for (const id of this.ids) {
      const node = doc.nodes.get(id);
      if (!node) continue;
      this.previous.set(id, { label: node.label, hidden: node.hidden, locked: node.locked });
      // A baked mesh's label is required, so never let a patch clear it.
      if (this.patch.label !== undefined || node.type !== 'baked') {
        Object.assign(node, this.patch);
      } else {
        Object.assign(node, { ...this.patch, label: node.label });
      }
    }
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    for (const [id, flags] of this.previous) {
      const node = doc.nodes.get(id);
      if (node) Object.assign(node, flags);
    }
    touch(doc);
  }
}

/**
 * Ties nodes together so selecting one selects all of them.
 *
 * Unlike a boolean, this changes no geometry: the parts stay separate and can
 * be taken apart again. It is the non-destructive half of "keep these
 * together", which booleans cannot offer because they bake.
 */
export class GroupNodesCommand implements Command {
  readonly label = 'Group';
  private previous = new Map<NodeId, string | undefined>();

  constructor(
    private readonly ids: NodeId[],
    private readonly groupId: string,
  ) {}

  apply(doc: SketchDocument): void {
    this.previous.clear();
    for (const id of this.ids) {
      const node = doc.nodes.get(id);
      if (!node) continue;
      this.previous.set(id, node.groupId);
      node.groupId = this.groupId;
    }
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    for (const [id, groupId] of this.previous) {
      const node = doc.nodes.get(id);
      if (!node) continue;
      if (groupId === undefined) delete node.groupId;
      else node.groupId = groupId;
    }
    touch(doc);
  }
}

export class UngroupNodesCommand implements Command {
  readonly label = 'Ungroup';
  private previous = new Map<NodeId, string | undefined>();

  constructor(private readonly ids: NodeId[]) {}

  apply(doc: SketchDocument): void {
    this.previous.clear();
    for (const id of this.ids) {
      const node = doc.nodes.get(id);
      if (!node?.groupId) continue;
      this.previous.set(id, node.groupId);
      delete node.groupId;
    }
    touch(doc);
  }

  revert(doc: SketchDocument): void {
    for (const [id, groupId] of this.previous) {
      const node = doc.nodes.get(id);
      if (node && groupId !== undefined) node.groupId = groupId;
    }
    touch(doc);
  }
}

/**
 * Moves a layer up or down the list.
 *
 * This is organisation, not occlusion: in 3D the depth buffer decides what is
 * in front, so unlike a 2D paint program the order here does not change what
 * you see. It changes where a layer sits in the panel, which is what matters
 * when a sketch has fifteen of them.
 */
export class ReorderLayerCommand implements Command {
  readonly label = 'Reorder layers';
  private from = -1;

  constructor(
    private readonly layerId: LayerId,
    private readonly to: number,
  ) {}

  apply(doc: SketchDocument): void {
    this.from = doc.layers.findIndex((layer) => layer.id === this.layerId);
    move(doc, this.from, this.to);
  }

  revert(doc: SketchDocument): void {
    move(doc, this.to, this.from);
  }
}

function move(doc: SketchDocument, from: number, to: number): void {
  if (from < 0 || to < 0 || from >= doc.layers.length || to >= doc.layers.length) return;
  const [layer] = doc.layers.splice(from, 1);
  if (!layer) return;
  doc.layers.splice(to, 0, layer);
  touch(doc);
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

/**
 * Moves nodes through an affine transform.
 *
 * Translation, rotation, scaling and mirroring all arrive here, which is what
 * keeps them consistent: there is one place that knows a stroke transforms by
 * its centreline, a baked mesh by its vertices *and* its normals, and that a
 * mirror has to reverse triangle winding or the surface ends up inside out.
 *
 * The buffers are replaced rather than mutated in place: the viewport decides
 * whether to re-upload geometry by comparing array identity, so editing the
 * existing array would move the data without anything noticing.
 */
export function transformNodes(
  doc: SketchDocument,
  ids: readonly NodeId[],
  transform: Affine,
): void {
  if (isIdentity(transform)) return;

  const normals = normalMatrix(transform);
  const flip = flipsOrientation(transform);
  const lengthScale = averageScale(transform);

  for (const id of ids) {
    const node = doc.nodes.get(id);
    if (!node) continue;

    if (node.type === 'stroke') {
      node.samples = node.samples.map((sample) => ({
        position: applyAffine(transform, sample.position),
        pressure: sample.pressure,
      }));
      node.planeNormal = normalize(applyLinear(normals, node.planeNormal));
      // A scaled stroke should get thicker, not stay a hairline on a bigger
      // shape. Its parametric description no longer matches the new size, so
      // it stops being editable as numbers — better than numbers that lie.
      if (Math.abs(lengthScale - 1) > 1e-9) {
        node.style = { ...node.style, width: node.style.width * lengthScale };
        node.shape = undefined;
      }
    } else if (node.type === 'baked') {
      const positions = node.positions.slice();
      for (let i = 0; i < positions.length; i += 3) {
        const p = applyAffine(transform, {
          x: positions[i]!,
          y: positions[i + 1]!,
          z: positions[i + 2]!,
        });
        positions[i] = p.x;
        positions[i + 1] = p.y;
        positions[i + 2] = p.z;
      }

      const normalBuffer = node.normals.slice();
      for (let i = 0; i < normalBuffer.length; i += 3) {
        const n = normalize(
          applyLinear(normals, {
            x: normalBuffer[i]!,
            y: normalBuffer[i + 1]!,
            z: normalBuffer[i + 2]!,
          }),
        );
        normalBuffer[i] = n.x;
        normalBuffer[i + 1] = n.y;
        normalBuffer[i + 2] = n.z;
      }

      node.positions = positions;
      node.normals = normalBuffer;

      if (flip) {
        // Swap two corners of every triangle to put the winding back.
        const indices = node.indices.slice();
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const swap = indices[i + 1]!;
          indices[i + 1] = indices[i + 2]!;
          indices[i + 2] = swap;
        }
        node.indices = indices;
      }
    } else if (node.type === 'annotation') {
      node.from = applyAffine(transform, node.from);
      node.to = applyAffine(transform, node.to);
      node.offsetDirection = normalize(applyLinear(normals, node.offsetDirection));
      node.offset *= lengthScale;
      node.textSize *= lengthScale;
    } else {
      node.transform = {
        ...node.transform,
        position: applyAffine(transform, node.transform.position),
      };
    }
  }
  touch(doc);
}

/** Shifts nodes in space. */
export const translateNodes = (
  doc: SketchDocument,
  ids: readonly NodeId[],
  delta: Vec3,
): void => transformNodes(doc, ids, translation(delta));

/**
 * A transform applied to a selection, undone by its inverse.
 *
 * Storing the inverse rather than a copy of the geometry keeps a large
 * selection cheap to sit in the undo stack.
 */
export class TransformNodesCommand implements Command {
  private readonly inverse: Affine | null;

  constructor(
    private readonly ids: NodeId[],
    private readonly transform: Affine,
    readonly label = 'Transform',
  ) {
    this.inverse = invert(transform);
  }

  apply(doc: SketchDocument): void {
    transformNodes(doc, this.ids, this.transform);
  }

  revert(doc: SketchDocument): void {
    // Null only for a transform that collapses an axis, which the callers
    // refuse to build; doing nothing beats corrupting the geometry.
    if (this.inverse) transformNodes(doc, this.ids, this.inverse);
  }
}

export class TranslateNodesCommand extends TransformNodesCommand {
  constructor(ids: NodeId[], delta: Vec3) {
    super(ids, translation(delta), 'Move');
  }
}

/**
 * A stroke's centreline replaced with a reshaped one — the undo entry for a
 * liquify gesture.
 *
 * The whole sample array is kept on both sides rather than a list of
 * per-sample deltas. A warp is not invertible in the way an affine transform
 * is: the brush that pushed a stroke sideways cannot be run backwards to
 * recover it, because relaxing the spacing afterwards adds and removes samples
 * as well as moving them. Holding both versions is a few kilobytes per stroke,
 * and it is exact.
 *
 * Shape parameters are dropped for the same reason scaling drops them: a
 * rectangle whose sides have been pushed out of true is no longer "80 by 50",
 * and numbers that lie are worse than no numbers.
 */
export class ReshapeStrokesCommand implements Command {
  readonly label: string;

  constructor(
    private readonly edits: Array<{
      id: NodeId;
      before: StrokeSample[];
      after: StrokeSample[];
      /** The shape description the stroke had before, restored on undo. */
      shape: StrokeNode['shape'];
    }>,
    label?: string,
  ) {
    this.label = label ?? (edits.length === 1 ? 'Reshape' : `Reshape ${edits.length} strokes`);
  }

  apply(doc: SketchDocument): void {
    this.write(doc, (edit) => ({ samples: edit.after, shape: undefined }));
  }

  revert(doc: SketchDocument): void {
    this.write(doc, (edit) => ({ samples: edit.before, shape: edit.shape }));
  }

  private write(
    doc: SketchDocument,
    pick: (edit: {
      before: StrokeSample[];
      after: StrokeSample[];
      shape: StrokeNode['shape'];
    }) => { samples: StrokeSample[]; shape: StrokeNode['shape'] },
  ): void {
    for (const edit of this.edits) {
      const node = doc.nodes.get(edit.id);
      if (node?.type !== 'stroke') continue;
      const next = pick(edit);
      node.samples = next.samples;
      node.shape = next.shape;
    }
    touch(doc);
  }
}
