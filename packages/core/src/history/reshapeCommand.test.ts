import { describe, expect, it } from 'vitest';

import { addNode, createDocument } from '../document/document.js';
import {
  DEFAULT_STROKE_STYLE,
  type SketchDocument,
  type StrokeNode,
} from '../document/types.js';
import { vec3 } from '../math/vec3.js';
import { type StrokeSample } from '../stroke/resample.js';
import { History } from './history.js';
import { ReshapeStrokesCommand } from './commands.js';

const straight: StrokeSample[] = [
  { position: vec3(0, 0, 0), pressure: 1 },
  { position: vec3(0.5, 0, 0), pressure: 1 },
  { position: vec3(1, 0, 0), pressure: 1 },
];

const bent: StrokeSample[] = [
  { position: vec3(0, 0, 0), pressure: 1 },
  { position: vec3(0.5, 0.3, 0), pressure: 1 },
  { position: vec3(1, 0, 0), pressure: 1 },
];

function seeded(shape?: StrokeNode['shape']): { doc: SketchDocument; node: StrokeNode } {
  const doc = createDocument();
  const node: StrokeNode = {
    id: 'stroke_1',
    type: 'stroke',
    layerId: doc.activeLayerId,
    samples: straight.map((s) => ({ position: { ...s.position }, pressure: s.pressure })),
    style: { ...DEFAULT_STROKE_STYLE },
    planeNormal: vec3(0, 0, 1),
    createdAt: 0,
    shape,
  };
  addNode(doc, node);
  return { doc, node };
}

const edit = (node: StrokeNode) => ({
  id: node.id,
  before: node.samples,
  after: bent,
  shape: node.shape,
});

describe('ReshapeStrokesCommand', () => {
  it('swaps the centreline for the reshaped one', () => {
    const { doc, node } = seeded();
    new ReshapeStrokesCommand([edit(node)]).apply(doc);
    expect(node.samples[1]!.position.y).toBeCloseTo(0.3, 10);
  });

  it('puts the original centreline back on undo', () => {
    const { doc, node } = seeded();
    const history = new History(doc);

    history.run(new ReshapeStrokesCommand([edit(node)]));
    history.undo();

    expect(doc.nodes.get(node.id)).toBe(node);
    expect(node.samples[1]!.position.y).toBeCloseTo(0, 10);
  });

  it('redoes the reshape after an undo', () => {
    const { doc, node } = seeded();
    const history = new History(doc);

    history.run(new ReshapeStrokesCommand([edit(node)]));
    history.undo();
    history.redo();

    expect(node.samples[1]!.position.y).toBeCloseTo(0.3, 10);
  });

  it('drops shape parameters, because a warped rectangle is no longer 80 by 50', () => {
    const shape: StrokeNode['shape'] = {
      params: { kind: 'rectangle', width: 0.8, height: 0.5 },
      plane: {
        origin: vec3(0, 0, 0),
        normal: vec3(0, 0, 1),
        u: vec3(1, 0, 0),
        v: vec3(0, 1, 0),
      },
    };
    const { doc, node } = seeded(shape);

    new ReshapeStrokesCommand([edit(node)]).apply(doc);
    expect(node.shape).toBeUndefined();
  });

  it('restores the shape parameters when the reshape is undone', () => {
    const shape: StrokeNode['shape'] = {
      params: { kind: 'circle', radius: 0.4 },
      plane: {
        origin: vec3(0, 0, 0),
        normal: vec3(0, 0, 1),
        u: vec3(1, 0, 0),
        v: vec3(0, 1, 0),
      },
    };
    const { doc, node } = seeded(shape);
    const history = new History(doc);

    history.run(new ReshapeStrokesCommand([edit(node)]));
    history.undo();

    expect(node.shape?.params).toEqual({ kind: 'circle', radius: 0.4 });
  });

  it('bumps the revision so the viewport knows to re-sweep', () => {
    const { doc, node } = seeded();
    const before = doc.revision;
    new ReshapeStrokesCommand([edit(node)]).apply(doc);
    expect(doc.revision).toBeGreaterThan(before);
  });

  it('names itself by how many strokes it touched', () => {
    const { node } = seeded();
    expect(new ReshapeStrokesCommand([edit(node)]).label).toBe('Reshape');
    expect(new ReshapeStrokesCommand([edit(node), edit(node)]).label).toBe('Reshape 2 strokes');
  });

  it('ignores an id that has since been deleted rather than throwing', () => {
    const { doc, node } = seeded();
    const command = new ReshapeStrokesCommand([
      edit(node),
      { id: 'gone', before: straight, after: bent, shape: undefined },
    ]);
    expect(() => command.apply(doc)).not.toThrow();
    expect(node.samples[1]!.position.y).toBeCloseTo(0.3, 10);
  });
});
