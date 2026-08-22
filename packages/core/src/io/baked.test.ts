import { describe, expect, it } from 'vitest';
import { deserializeDocument, serializeDocument } from './serialize.js';
import { addNode, createDocument, createLayer } from '../document/document.js';
import { DEFAULT_STROKE_STYLE, type BakedMeshNode, type StrokeNode } from '../document/types.js';
import { vec3 } from '../math/vec3.js';

function baked(id: string, layerId: string, triangles = 4): BakedMeshNode {
  const vertexCount = triangles * 3;
  return {
    id,
    type: 'baked',
    layerId,
    label: `Merge of 2`,
    positions: Float32Array.from({ length: vertexCount * 3 }, (_, i) => i * 0.125),
    normals: Float32Array.from({ length: vertexCount * 3 }, (_, i) => (i % 3 === 1 ? 1 : 0)),
    indices: Uint32Array.from({ length: vertexCount }, (_, i) => i),
    style: { ...DEFAULT_STROKE_STYLE, color: '#123456' },
    createdAt: 1_700_000_000_000,
  };
}

function stroke(id: string, layerId: string): StrokeNode {
  return {
    id,
    type: 'stroke',
    layerId,
    samples: Array.from({ length: 9 }, (_, i) => ({
      position: vec3(i * 0.2, Math.cos(i) * 0.4, i * -0.1),
      pressure: 0.6,
    })),
    style: { ...DEFAULT_STROKE_STYLE },
    planeNormal: vec3(0, 1, 0),
    createdAt: 1,
  };
}

describe('baked meshes in the file format', () => {
  it('round-trips geometry exactly', () => {
    const doc = createDocument('Baked');
    const node = baked('b1', doc.activeLayerId, 6);
    addNode(doc, node);

    const restored = deserializeDocument(serializeDocument(doc));
    const back = restored.nodes.get('b1') as BakedMeshNode;

    expect(back.type).toBe('baked');
    expect(back.label).toBe('Merge of 2');
    expect(Array.from(back.indices)).toEqual(Array.from(node.indices));
    expect(back.positions.length).toBe(node.positions.length);

    for (let i = 0; i < node.positions.length; i += 1) {
      expect(back.positions[i]).toBeCloseTo(node.positions[i]!, 5);
      expect(back.normals[i]).toBeCloseTo(node.normals[i]!, 5);
    }
  });

  it('keeps strokes and baked meshes side by side', () => {
    const doc = createDocument('Mixed');
    const second = createLayer('Layer 2');
    doc.layers.push(second);

    addNode(doc, stroke('s1', doc.activeLayerId));
    addNode(doc, baked('b1', second.id, 5));
    addNode(doc, stroke('s2', second.id));

    const restored = deserializeDocument(serializeDocument(doc));

    expect(restored.order).toEqual(['s1', 'b1', 's2']);
    expect(restored.nodes.get('s1')?.type).toBe('stroke');
    expect(restored.nodes.get('b1')?.type).toBe('baked');
    expect(restored.nodes.get('s2')?.type).toBe('stroke');

    // The stroke after the baked mesh must still read its own samples, which
    // only works if both share the binary section without overlapping.
    const s2 = restored.nodes.get('s2') as StrokeNode;
    expect(s2.samples).toHaveLength(9);
    expect(s2.samples[3]!.position.x).toBeCloseTo(0.6, 5);
  });

  it('does not alias the file buffer', () => {
    const doc = createDocument('Alias');
    addNode(doc, baked('b1', doc.activeLayerId, 3));

    const buffer = serializeDocument(doc);
    const restored = deserializeDocument(buffer);
    const back = restored.nodes.get('b1') as BakedMeshNode;
    const original = back.positions[0]!;

    // Scribbling over the source buffer must not change the loaded document.
    new Uint8Array(buffer).fill(0xff, 12);
    expect(back.positions[0]).toBe(original);
  });

  it('rejects geometry pointing outside the file', () => {
    const doc = createDocument('Corrupt');
    addNode(doc, baked('b1', doc.activeLayerId, 3));

    const buffer = serializeDocument(doc);
    const view = new DataView(buffer);
    const manifestLength = view.getUint32(8, true);
    const manifest = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 12, manifestLength)),
    );

    manifest.nodes[0].geometry.indicesOffset = 10_000_000;
    const tampered = new TextEncoder().encode(JSON.stringify(manifest));

    // Rebuild a buffer with the tampered manifest at the same length.
    const rebuilt = new ArrayBuffer(buffer.byteLength + tampered.length);
    const out = new DataView(rebuilt);
    out.setUint32(0, view.getUint32(0, true), true);
    out.setUint32(4, view.getUint32(4, true), true);
    out.setUint32(8, tampered.length, true);
    new Uint8Array(rebuilt, 12, tampered.length).set(tampered);

    expect(() => deserializeDocument(rebuilt)).toThrow(/outside the file/);
  });
});
