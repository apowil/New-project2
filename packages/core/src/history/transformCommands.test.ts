import { describe, expect, it } from 'vitest';

import { addNode, createDocument } from '../document/document.js';
import {
  DEFAULT_STROKE_STYLE,
  type BakedMeshNode,
  type SketchDocument,
  type StrokeNode,
} from '../document/types.js';
import { buildStrokeGeometry } from '../stroke/geometry.js';
import { mirror, rotation, scaling, translation } from '../math/affine.js';
import { vec3 } from '../math/vec3.js';
import { History } from './history.js';
import { TransformNodesCommand, transformNodes } from './commands.js';

/**
 * Six times the enclosed volume, by the divergence theorem.
 *
 * The sign is what matters here: positive means the triangles wind
 * counter-clockwise seen from outside, so the surface faces outwards. A
 * reflection that forgets to reverse winding turns this negative, and the mesh
 * renders inside out.
 */
function signedVolume(node: BakedMeshNode): number {
  let total = 0;
  const { positions, indices } = node;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const ax = positions[a]!;
    const ay = positions[a + 1]!;
    const az = positions[a + 2]!;
    const bx = positions[b]!;
    const by = positions[b + 1]!;
    const bz = positions[b + 2]!;
    const cx = positions[c]!;
    const cy = positions[c + 1]!;
    const cz = positions[c + 2]!;
    total +=
      ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return total / 6;
}

/** A closed tube, baked, standing in for any boolean result. */
function bakedTube(doc: SketchDocument): BakedMeshNode {
  const samples = Array.from({ length: 12 }, (_, i) => ({
    position: vec3(i * 0.1, 0, 0),
    pressure: 1,
  }));
  const geometry = buildStrokeGeometry(samples, { sides: 8 })!;

  const node: BakedMeshNode = {
    id: 'baked_1',
    type: 'baked',
    layerId: doc.activeLayerId,
    label: 'Tube',
    positions: geometry.positions,
    normals: geometry.normals,
    indices: geometry.indices,
    style: { ...DEFAULT_STROKE_STYLE },
    createdAt: 0,
  };
  addNode(doc, node);
  return node;
}

function strokeNode(doc: SketchDocument): StrokeNode {
  const node: StrokeNode = {
    id: 'stroke_1',
    type: 'stroke',
    layerId: doc.activeLayerId,
    samples: [
      { position: vec3(0, 0, 0), pressure: 1 },
      { position: vec3(1, 0, 0), pressure: 1 },
    ],
    style: { ...DEFAULT_STROKE_STYLE },
    planeNormal: vec3(0, 1, 0),
    createdAt: 0,
    shape: {
      params: { kind: 'line', u: 0, v: 0, points: [] },
      plane: { origin: vec3(), normal: vec3(0, 1, 0), u: vec3(1, 0, 0), v: vec3(0, 0, 1) },
    },
  };
  addNode(doc, node);
  return node;
}

describe('transformNodes', () => {
  it('moves a stroke by its centreline', () => {
    const doc = createDocument();
    const node = strokeNode(doc);

    transformNodes(doc, [node.id], translation(vec3(0, 2, 0)));

    expect(node.samples[0]!.position.y).toBeCloseTo(2, 10);
    expect(node.samples[1]!.position.y).toBeCloseTo(2, 10);
    // Pressure is not a position and must survive untouched.
    expect(node.samples[0]!.pressure).toBe(1);
  });

  it('a rotation leaves a stroke editable but a scale does not', () => {
    const doc = createDocument();
    const node = strokeNode(doc);

    transformNodes(doc, [node.id], rotation(vec3(0, 0, 1), 0.5));
    // Turning a rectangle does not change what "80 by 50" means.
    expect(node.shape).toBeDefined();

    transformNodes(doc, [node.id], scaling(2));
    // Scaling does: the stored numbers would no longer be its size.
    expect(node.shape).toBeUndefined();
  });

  it('scaling a stroke scales its width too', () => {
    const doc = createDocument();
    const node = strokeNode(doc);
    const before = node.style.width;

    transformNodes(doc, [node.id], scaling(3));

    expect(node.style.width).toBeCloseTo(before * 3, 10);
  });

  it('keeps a baked mesh the right way out when mirrored', () => {
    const doc = createDocument();
    const node = bakedTube(doc);
    const before = signedVolume(node);
    expect(before).toBeGreaterThan(0);

    transformNodes(doc, [node.id], mirror(vec3(1, 0, 0)));

    // Reflection alone would negate this; reversing the winding restores it.
    expect(signedVolume(node)).toBeGreaterThan(0);
    expect(signedVolume(node)).toBeCloseTo(before, 6);
  });

  it('scales the volume of a baked mesh by the cube of the factor', () => {
    const doc = createDocument();
    const node = bakedTube(doc);
    const before = signedVolume(node);

    transformNodes(doc, [node.id], scaling(2));

    expect(signedVolume(node)).toBeCloseTo(before * 8, 6);
  });

  it('replaces buffers rather than mutating them', () => {
    const doc = createDocument();
    const node = bakedTube(doc);
    const positions = node.positions;

    transformNodes(doc, [node.id], translation(vec3(1, 0, 0)));

    // The viewport re-uploads by comparing identity, so this has to change.
    expect(node.positions).not.toBe(positions);
  });

  it('leaves normals unit length after a non-uniform scale', () => {
    const doc = createDocument();
    const node = bakedTube(doc);

    transformNodes(doc, [node.id], scaling(vec3(3, 0.5, 2)));

    for (let i = 0; i < node.normals.length; i += 3) {
      const l = Math.hypot(node.normals[i]!, node.normals[i + 1]!, node.normals[i + 2]!);
      expect(l).toBeCloseTo(1, 6);
    }
  });

  it('does nothing at all for an identity transform', () => {
    const doc = createDocument();
    const node = bakedTube(doc);
    const positions = node.positions;

    transformNodes(doc, [node.id], translation(vec3(0, 0, 0)));

    expect(node.positions).toBe(positions);
  });
});

describe('TransformNodesCommand', () => {
  it('undo puts the geometry back', () => {
    const doc = createDocument();
    const node = strokeNode(doc);
    const history = new History(doc);

    history.run(new TransformNodesCommand([node.id], rotation(vec3(0, 1, 0), 0.9, vec3(2, 0, 0))));
    history.undo();

    expect(node.samples[1]!.position.x).toBeCloseTo(1, 8);
    expect(node.samples[1]!.position.y).toBeCloseTo(0, 8);
    expect(node.samples[1]!.position.z).toBeCloseTo(0, 8);
  });

  it('undoing a mirror restores the winding', () => {
    const doc = createDocument();
    const node = bakedTube(doc);
    const indices = [...node.indices];
    const history = new History(doc);

    history.run(new TransformNodesCommand([node.id], mirror(vec3(0, 1, 0))));
    expect([...node.indices]).not.toEqual(indices);

    history.undo();
    expect([...node.indices]).toEqual(indices);
  });

  it('undoing a scale restores the stroke width', () => {
    const doc = createDocument();
    const node = strokeNode(doc);
    const before = node.style.width;
    const history = new History(doc);

    history.run(new TransformNodesCommand([node.id], scaling(4)));
    history.undo();

    expect(node.style.width).toBeCloseTo(before, 10);
  });
});
