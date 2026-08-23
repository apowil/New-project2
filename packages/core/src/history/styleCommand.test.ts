import { describe, expect, it, vi } from 'vitest';

import { addNode, createDocument } from '../document/document.js';
import { DEFAULT_STROKE_STYLE, type SketchDocument, type StrokeNode } from '../document/types.js';
import { vec3 } from '../math/vec3.js';
import { History } from './history.js';
import { SetStyleCommand } from './commands.js';

function seeded(): { doc: SketchDocument; node: StrokeNode } {
  const doc = createDocument();
  const node: StrokeNode = {
    id: 'stroke_1',
    type: 'stroke',
    layerId: doc.activeLayerId,
    samples: [
      { position: vec3(0, 0, 0), pressure: 1 },
      { position: vec3(1, 0, 0), pressure: 1 },
    ],
    style: { ...DEFAULT_STROKE_STYLE, color: '#111111', width: 0.05 },
    planeNormal: vec3(0, 1, 0),
    createdAt: 0,
  };
  addNode(doc, node);
  return { doc, node };
}

describe('SetStyleCommand', () => {
  it('applies a patch and leaves the rest of the style alone', () => {
    const { doc, node } = seeded();
    new SetStyleCommand([node.id], { color: '#ff0000' }).apply(doc);

    expect(node.style.color).toBe('#ff0000');
    expect(node.style.width).toBeCloseTo(0.05, 10);
  });

  it('reverts to the style from before', () => {
    const { doc, node } = seeded();
    const history = new History(doc);

    history.run(new SetStyleCommand([node.id], { color: '#ff0000' }));
    history.undo();

    expect(node.style.color).toBe('#111111');
  });

  it('collapses a run of changes into one undo step', () => {
    const { doc, node } = seeded();
    const history = new History(doc);

    // Stands in for dragging a slider: many changes, one gesture.
    for (let i = 1; i <= 6; i += 1) {
      history.run(new SetStyleCommand([node.id], { width: 0.01 * i }));
    }
    expect(node.style.width).toBeCloseTo(0.06, 10);
    expect(history.state.depth).toBe(1);

    history.undo();
    expect(node.style.width).toBeCloseTo(0.05, 10);
  });

  it('keeps a later change separate once the gesture is over', () => {
    vi.useFakeTimers();
    try {
      const { doc, node } = seeded();
      const history = new History(doc);

      history.run(new SetStyleCommand([node.id], { width: 0.2 }));
      // Long enough after that this is plainly a second decision.
      vi.advanceTimersByTime(5_000);
      history.run(new SetStyleCommand([node.id], { width: 0.3 }));

      expect(history.state.depth).toBe(2);
      history.undo();
      expect(node.style.width).toBeCloseTo(0.2, 10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not merge across different selections', () => {
    const { doc, node } = seeded();
    const history = new History(doc);

    history.run(new SetStyleCommand([node.id], { width: 0.2 }));
    history.run(new SetStyleCommand([node.id, 'other'], { width: 0.3 }));

    expect(history.state.depth).toBe(2);
  });

  it('redo replays every property a merged gesture touched', () => {
    const { doc, node } = seeded();
    const history = new History(doc);

    // Two different properties inside one merge window.
    history.run(new SetStyleCommand([node.id], { color: '#00ff00' }));
    history.run(new SetStyleCommand([node.id], { width: 0.4 }));
    expect(history.state.depth).toBe(1);

    history.undo();
    expect(node.style.color).toBe('#111111');
    expect(node.style.width).toBeCloseTo(0.05, 10);

    history.redo();
    // The colour must come back too — merging kept only the newer patch once,
    // which silently dropped it.
    expect(node.style.color).toBe('#00ff00');
    expect(node.style.width).toBeCloseTo(0.4, 10);
  });

  it('ignores ids that are not in the document', () => {
    const { doc, node } = seeded();
    expect(() =>
      new SetStyleCommand([node.id, 'missing'], { color: '#abcdef' }).apply(doc),
    ).not.toThrow();
    expect(node.style.color).toBe('#abcdef');
  });
});
