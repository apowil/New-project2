import { describe, expect, it } from 'vitest';
import { History } from './history.js';
import {
  AddNodesCommand,
  DuplicateLayerCommand,
  MergeLayersCommand,
  MoveNodesToLayerCommand,
  ReplaceNodesCommand,
} from './commands.js';
import { createDocument, createLayer } from '../document/document.js';
import { cloneNodes } from '../document/clone.js';
import { DEFAULT_STROKE_STYLE, type SceneNode, type StrokeNode } from '../document/types.js';
import { vec3 } from '../math/vec3.js';

const stroke = (id: string, layerId: string): StrokeNode => ({
  id,
  type: 'stroke',
  layerId,
  samples: [
    { position: vec3(0, 0, 0), pressure: 1 },
    { position: vec3(1, 0, 0), pressure: 1 },
  ],
  style: { ...DEFAULT_STROKE_STYLE },
  planeNormal: vec3(0, 1, 0),
  createdAt: 0,
});

function twoLayers() {
  const doc = createDocument();
  const lower = doc.layers[0]!;
  const upper = createLayer('Layer 2');
  doc.layers.push(upper);
  const history = new History(doc);

  history.run(
    new AddNodesCommand([
      stroke('a', lower.id),
      stroke('b', upper.id),
      stroke('c', upper.id),
    ]),
  );

  return { doc, history, lower, upper };
}

describe('MergeLayersCommand', () => {
  it('moves contents into the target and removes the source layer', () => {
    const { doc, history, lower, upper } = twoLayers();

    history.run(new MergeLayersCommand([upper.id], lower.id));

    expect(doc.layers.map((layer) => layer.id)).toEqual([lower.id]);
    expect([...doc.nodes.values()].every((node) => node.layerId === lower.id)).toBe(true);
    // Merging is organisational: it must not re-stack the drawing.
    expect(doc.order).toEqual(['a', 'b', 'c']);
  });

  it('restores both the layer and the original assignments on undo', () => {
    const { doc, history, lower, upper } = twoLayers();

    history.run(new MergeLayersCommand([upper.id], lower.id));
    history.undo();

    expect(doc.layers.map((layer) => layer.id)).toEqual([lower.id, upper.id]);
    expect(doc.nodes.get('a')!.layerId).toBe(lower.id);
    expect(doc.nodes.get('b')!.layerId).toBe(upper.id);
    expect(doc.nodes.get('c')!.layerId).toBe(upper.id);
  });

  it('moves the active layer when the active one is merged away', () => {
    const { doc, history, lower, upper } = twoLayers();
    doc.activeLayerId = upper.id;

    history.run(new MergeLayersCommand([upper.id], lower.id));
    expect(doc.activeLayerId).toBe(lower.id);

    history.undo();
    expect(doc.activeLayerId).toBe(upper.id);
  });

  it('ignores a merge into itself', () => {
    const { doc, history, upper } = twoLayers();
    history.run(new MergeLayersCommand([upper.id], upper.id));
    expect(doc.layers).toHaveLength(2);
  });
});

describe('DuplicateLayerCommand', () => {
  it('adds a layer with independent copies of the contents', () => {
    const { doc, history, upper } = twoLayers();

    const copy = createLayer('Layer 2 copy');
    const originals = doc.order
      .map((id) => doc.nodes.get(id))
      .filter((node): node is SceneNode => node?.layerId === upper.id);
    const clones = cloneNodes(originals, copy.id);

    history.run(new DuplicateLayerCommand(copy, clones, 2));

    expect(doc.layers).toHaveLength(3);
    expect(doc.nodes.size).toBe(5);

    // New ids, and the sample arrays must not be shared with the originals.
    const clone = doc.nodes.get(clones[0]!.id) as StrokeNode;
    const source = doc.nodes.get('b') as StrokeNode;
    expect(clone.id).not.toBe('b');
    expect(clone.samples).not.toBe(source.samples);

    clone.samples[0]!.position.x = 99;
    expect(source.samples[0]!.position.x).toBe(0);
  });

  it('removes the layer and its copies on undo', () => {
    const { doc, history, upper } = twoLayers();
    const copy = createLayer('Layer 2 copy');
    const clones = cloneNodes(
      doc.order.map((id) => doc.nodes.get(id)!).filter((node) => node.layerId === upper.id),
      copy.id,
    );

    history.run(new DuplicateLayerCommand(copy, clones, 2));
    history.undo();

    expect(doc.layers).toHaveLength(2);
    expect(doc.nodes.size).toBe(3);
  });
});

describe('MoveNodesToLayerCommand', () => {
  it('reassigns nodes and puts them back on undo', () => {
    const { doc, history, lower, upper } = twoLayers();

    history.run(new MoveNodesToLayerCommand(['b', 'c'], lower.id));
    expect(doc.nodes.get('b')!.layerId).toBe(lower.id);
    expect(doc.nodes.get('c')!.layerId).toBe(lower.id);

    history.undo();
    expect(doc.nodes.get('b')!.layerId).toBe(upper.id);
    expect(doc.nodes.get('c')!.layerId).toBe(upper.id);
  });
});

describe('ReplaceNodesCommand', () => {
  it('swaps inputs for a result at the frontmost input position', () => {
    const { doc, history, lower } = twoLayers();
    const result = stroke('result', lower.id);

    history.run(new ReplaceNodesCommand(['a', 'c'], [result], 'Merge'));

    expect(doc.nodes.has('a')).toBe(false);
    expect(doc.nodes.has('c')).toBe(false);
    // 'a' was first, so the result takes its slot rather than jumping to top.
    expect(doc.order).toEqual(['result', 'b']);
  });

  it('restores the inputs in their original order on undo', () => {
    const { doc, history, lower } = twoLayers();
    history.run(new ReplaceNodesCommand(['a', 'c'], [stroke('result', lower.id)], 'Merge'));
    history.undo();

    expect(doc.order).toEqual(['a', 'b', 'c']);
    expect(doc.nodes.has('result')).toBe(false);
  });

  it('redoes cleanly', () => {
    const { doc, history, lower } = twoLayers();
    history.run(new ReplaceNodesCommand(['a', 'c'], [stroke('result', lower.id)], 'Merge'));
    history.undo();
    history.redo();

    expect(doc.order).toEqual(['result', 'b']);
  });
});
