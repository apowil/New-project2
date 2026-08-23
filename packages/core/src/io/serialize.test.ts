import { describe, expect, it } from 'vitest';
import { deserializeDocument, serializeDocument } from './serialize.js';
import { WISP_FORMAT_VERSION, WISP_MAGIC, WispFormatError } from './format.js';
import { addNode, createDocument, createLayer } from '../document/document.js';
import { DEFAULT_STROKE_STYLE, type StrokeNode } from '../document/types.js';
import { vec3 } from '../math/vec3.js';

function stroke(id: string, layerId: string, count = 12): StrokeNode {
  return {
    id,
    type: 'stroke',
    layerId,
    samples: Array.from({ length: count }, (_, i) => ({
      position: vec3(i * 0.1, Math.sin(i) * 0.5, -i * 0.03),
      pressure: (i % 10) / 10,
    })),
    style: { ...DEFAULT_STROKE_STYLE, color: '#7dd3c0', width: 0.08 },
    planeNormal: vec3(0, 0, 1),
    createdAt: 1_700_000_000_000,
  };
}

function populated() {
  const doc = createDocument('Test sketch');
  const second = createLayer('Layer 2');
  doc.layers.push(second);
  addNode(doc, stroke('a', doc.activeLayerId, 40));
  addNode(doc, stroke('b', second.id, 7));
  addNode(doc, stroke('c', doc.activeLayerId, 120));
  return doc;
}

describe('serializeDocument', () => {
  it('writes a recognisable header', () => {
    const buffer = serializeDocument(populated());
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(WISP_MAGIC);
    expect(view.getUint32(4, true)).toBe(WISP_FORMAT_VERSION);
  });

  it('round-trips structure', () => {
    const original = populated();
    const restored = deserializeDocument(serializeDocument(original));

    expect(restored.name).toBe(original.name);
    expect(restored.id).toBe(original.id);
    expect(restored.order).toEqual(original.order);
    expect(restored.nodes.size).toBe(original.nodes.size);
    expect(restored.layers.map((l) => l.id)).toEqual(original.layers.map((l) => l.id));
    expect(restored.activeLayerId).toBe(original.activeLayerId);
  });

  it('round-trips sample positions exactly', () => {
    const original = populated();
    const restored = deserializeDocument(serializeDocument(original));

    for (const id of original.order) {
      const before = original.nodes.get(id) as StrokeNode;
      const after = restored.nodes.get(id) as StrokeNode;
      expect(after.samples).toHaveLength(before.samples.length);

      for (let i = 0; i < before.samples.length; i += 1) {
        const a = before.samples[i]!;
        const b = after.samples[i]!;
        // Float32 storage, so compare at single precision rather than exactly.
        expect(b.position.x).toBeCloseTo(a.position.x, 5);
        expect(b.position.y).toBeCloseTo(a.position.y, 5);
        expect(b.position.z).toBeCloseTo(a.position.z, 5);
        expect(b.pressure).toBeCloseTo(a.pressure, 5);
      }
    }
  });

  it('round-trips style and plane normal', () => {
    const restored = deserializeDocument(serializeDocument(populated()));
    const node = restored.nodes.get('a') as StrokeNode;

    expect(node.style.color).toBe('#7dd3c0');
    expect(node.style.width).toBeCloseTo(0.08, 6);
    expect(node.planeNormal.z).toBeCloseTo(1, 6);
  });

  it('round-trips layer flags', () => {
    const doc = populated();
    doc.layers[1]!.visible = false;
    doc.layers[1]!.locked = true;
    doc.layers[1]!.opacity = 0.4;

    const restored = deserializeDocument(serializeDocument(doc));
    const layer = restored.layers[1]!;

    expect(layer.visible).toBe(false);
    expect(layer.locked).toBe(true);
    expect(layer.opacity).toBeCloseTo(0.4, 6);
  });

  it('handles an empty document', () => {
    const restored = deserializeDocument(serializeDocument(createDocument('Empty')));
    expect(restored.nodes.size).toBe(0);
    expect(restored.order).toEqual([]);
    expect(restored.layers).toHaveLength(1);
  });

  it('preserves non-ASCII names', () => {
    const doc = createDocument('スケッチ · draft ✎');
    const restored = deserializeDocument(serializeDocument(doc));
    expect(restored.name).toBe('スケッチ · draft ✎');
  });

  it('keeps the binary section aligned whatever the manifest length', () => {
    // Names of different lengths shift the manifest across every alignment
    // case; a misaligned Float32Array view would throw.
    for (let i = 0; i < 8; i += 1) {
      const doc = createDocument('x'.repeat(i));
      addNode(doc, stroke('a', doc.activeLayerId, 5));
      expect(() => deserializeDocument(serializeDocument(doc))).not.toThrow();
    }
  });

  it('survives a large sketch', () => {
    const doc = createDocument('Big');
    for (let i = 0; i < 200; i += 1) {
      addNode(doc, stroke(`s${i}`, doc.activeLayerId, 150));
    }
    const buffer = serializeDocument(doc);
    const restored = deserializeDocument(buffer);

    expect(restored.nodes.size).toBe(200);
    // 200 strokes x 150 samples x 16 bytes = 480 KB of samples, and the
    // manifest should be a small fraction on top rather than dominating.
    expect(buffer.byteLength).toBeGreaterThan(480_000);
    expect(buffer.byteLength).toBeLessThan(560_000);
  });
});

describe('deserializeDocument rejects bad input', () => {
  it('rejects a short buffer', () => {
    expect(() => deserializeDocument(new ArrayBuffer(4))).toThrow(WispFormatError);
  });

  it('rejects a wrong magic number', () => {
    const buffer = new ArrayBuffer(32);
    new DataView(buffer).setUint32(0, 0xdeadbeef, true);
    expect(() => deserializeDocument(buffer)).toThrow(/Not a Wisp sketch/);
  });

  it('rejects a newer format version', () => {
    const buffer = serializeDocument(populated());
    new DataView(buffer).setUint32(4, WISP_FORMAT_VERSION + 5, true);
    expect(() => deserializeDocument(buffer)).toThrow(/newer version/);
  });

  it('rejects a truncated file', () => {
    const buffer = serializeDocument(populated());
    expect(() => deserializeDocument(buffer.slice(0, 20))).toThrow(WispFormatError);
  });

  it('round-trips per-node names, hiding, locking and grouping', () => {
    const doc = populated();
    const a = doc.nodes.get('a')!;
    const b = doc.nodes.get('b')!;
    Object.assign(a, { label: 'Handle', hidden: true, locked: true, groupId: 'grp_1' });
    Object.assign(b, { groupId: 'grp_1' });

    const restored = deserializeDocument(serializeDocument(doc));
    const back = restored.nodes.get('a')!;

    expect(back.label).toBe('Handle');
    expect(back.hidden).toBe(true);
    expect(back.locked).toBe(true);
    expect(back.groupId).toBe('grp_1');
    expect(restored.nodes.get('b')!.groupId).toBe('grp_1');
  });

  it('leaves the optional fields out entirely when they are unset', () => {
    const buffer = serializeDocument(populated());
    const view = new DataView(buffer);
    const length = view.getUint32(8, true);
    const manifest = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 12, length)),
    ) as { nodes: Array<Record<string, unknown>> };

    // Layers legitimately carry `locked`; it is the per-node copies that would
    // be dead weight, thousands of nodes times four keys.
    for (const node of manifest.nodes) {
      expect(Object.keys(node)).not.toContain('label');
      expect(Object.keys(node)).not.toContain('hidden');
      expect(Object.keys(node)).not.toContain('locked');
      expect(Object.keys(node)).not.toContain('groupId');
    }
  });

  it('round-trips a dimension annotation', () => {
    const doc = populated();
    addNode(doc, {
      id: 'dim',
      type: 'annotation',
      kind: 'dimension',
      layerId: doc.activeLayerId,
      from: vec3(0, 0, 0),
      to: vec3(1.5, 0, 0),
      offset: 0.2,
      offsetDirection: vec3(0, 1, 0),
      textSize: 0.09,
      style: { ...DEFAULT_STROKE_STYLE },
      createdAt: 1_700_000_000_000,
    });

    const restored = deserializeDocument(serializeDocument(doc));
    const back = restored.nodes.get('dim');

    expect(back?.type).toBe('annotation');
    if (back?.type !== 'annotation') throw new Error('expected an annotation');
    expect(back.to.x).toBeCloseTo(1.5, 6);
    expect(back.offset).toBeCloseTo(0.2, 6);
    expect(back.textSize).toBeCloseTo(0.09, 6);
  });

  it('drops a dimension that spans no distance', () => {
    const doc = populated();
    addNode(doc, {
      id: 'dim',
      type: 'annotation',
      kind: 'dimension',
      layerId: doc.activeLayerId,
      from: vec3(1, 1, 1),
      to: vec3(1, 1, 1),
      offset: 0,
      offsetDirection: vec3(0, 1, 0),
      textSize: 0.09,
      style: { ...DEFAULT_STROKE_STYLE },
      createdAt: 0,
    });

    const restored = deserializeDocument(serializeDocument(doc));
    expect(restored.nodes.has('dim')).toBe(false);
  });

  it('drops nodes whose layer is missing rather than misplacing them', () => {
    const doc = populated();
    // Remove the second layer but leave stroke "b" pointing at it.
    doc.layers = doc.layers.filter((layer) => layer.id === doc.activeLayerId);

    const restored = deserializeDocument(serializeDocument(doc));
    expect(restored.nodes.has('b')).toBe(false);
    expect(restored.nodes.has('a')).toBe(true);
    expect(restored.order).not.toContain('b');
  });
});
