import { describe, expect, it } from 'vitest';
import { History } from './history.js';
import { AddNodeCommand, DeleteNodesCommand } from './commands.js';
import { createDocument } from '../document/document.js';
import { DEFAULT_STROKE_STYLE, type StrokeNode } from '../document/types.js';
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

describe('History', () => {
  it('applies, undoes and redoes a command', () => {
    const doc = createDocument();
    const history = new History(doc);
    const node = stroke('a', doc.activeLayerId);

    history.run(new AddNodeCommand(node));
    expect(doc.nodes.size).toBe(1);
    expect(history.state.canUndo).toBe(true);

    history.undo();
    expect(doc.nodes.size).toBe(0);
    expect(history.state.canRedo).toBe(true);

    history.redo();
    expect(doc.nodes.size).toBe(1);
    expect(doc.order).toEqual(['a']);
  });

  it('reports nothing to undo on a fresh document', () => {
    const history = new History(createDocument());
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
    expect(history.state.canUndo).toBe(false);
  });

  it('drops the redo branch once a new command runs', () => {
    const doc = createDocument();
    const history = new History(doc);

    history.run(new AddNodeCommand(stroke('a', doc.activeLayerId)));
    history.undo();
    expect(history.state.canRedo).toBe(true);

    history.run(new AddNodeCommand(stroke('b', doc.activeLayerId)));
    expect(history.state.canRedo).toBe(false);
    expect(doc.order).toEqual(['b']);
  });

  it('restores draw order when an undo reinserts a node', () => {
    const doc = createDocument();
    const history = new History(doc);

    history.run(new AddNodeCommand(stroke('a', doc.activeLayerId)));
    history.run(new AddNodeCommand(stroke('b', doc.activeLayerId)));
    history.run(new AddNodeCommand(stroke('c', doc.activeLayerId)));
    expect(doc.order).toEqual(['a', 'b', 'c']);

    history.run(new DeleteNodesCommand(['b']));
    expect(doc.order).toEqual(['a', 'c']);

    history.undo();
    expect(doc.order).toEqual(['a', 'b', 'c']);
  });

  it('restores several deleted nodes in their original order', () => {
    const doc = createDocument();
    const history = new History(doc);

    for (const id of ['a', 'b', 'c', 'd']) {
      history.run(new AddNodeCommand(stroke(id, doc.activeLayerId)));
    }

    history.run(new DeleteNodesCommand(['b', 'd']));
    expect(doc.order).toEqual(['a', 'c']);

    history.undo();
    expect(doc.order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('bounds the undo stack', () => {
    const doc = createDocument();
    const history = new History(doc, 5);

    for (let i = 0; i < 20; i += 1) {
      history.run(new AddNodeCommand(stroke(`n${i}`, doc.activeLayerId)));
    }

    expect(history.state.depth).toBe(5);
  });

  it('bumps the document revision on every mutation', () => {
    const doc = createDocument();
    const history = new History(doc);
    const before = doc.revision;

    history.run(new AddNodeCommand(stroke('a', doc.activeLayerId)));
    expect(doc.revision).toBeGreaterThan(before);

    const afterAdd = doc.revision;
    history.undo();
    expect(doc.revision).toBeGreaterThan(afterAdd);
  });

  it('notifies subscribers', () => {
    const doc = createDocument();
    const history = new History(doc);
    const seen: boolean[] = [];

    const unsubscribe = history.subscribe((state) => seen.push(state.canUndo));
    history.run(new AddNodeCommand(stroke('a', doc.activeLayerId)));
    unsubscribe();
    history.undo();

    // Initial call plus the run; nothing after unsubscribing.
    expect(seen).toEqual([false, true]);
  });
});
