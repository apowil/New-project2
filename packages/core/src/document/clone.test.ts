import { describe, expect, it } from 'vitest';

import { DEFAULT_STROKE_STYLE, type SceneNode, type StrokeNode } from './types.js';
import { vec3 } from '../math/vec3.js';
import { cloneNode, cloneNodes } from './clone.js';

function stroke(id: string, patch: Partial<StrokeNode> = {}): StrokeNode {
  return {
    id,
    type: 'stroke',
    layerId: 'layer_1',
    samples: [
      { position: vec3(0, 0, 0), pressure: 1 },
      { position: vec3(1, 0, 0), pressure: 1 },
    ],
    style: { ...DEFAULT_STROKE_STYLE },
    planeNormal: vec3(0, 1, 0),
    createdAt: 0,
    ...patch,
  };
}

const groupOf = (node: SceneNode): string | undefined => node.groupId;

describe('cloneNodes', () => {
  it('gives every copy a fresh id', () => {
    const copies = cloneNodes([stroke('a'), stroke('b')]);
    expect(copies[0]!.id).not.toBe('a');
    expect(copies[1]!.id).not.toBe('b');
    expect(copies[0]!.id).not.toBe(copies[1]!.id);
  });

  it('copies buffers rather than sharing them', () => {
    const original = stroke('a');
    const [copy] = cloneNodes([original]);

    expect(copy!.type).toBe('stroke');
    if (copy!.type !== 'stroke') throw new Error('expected a stroke');
    expect(copy!.samples).not.toBe(original.samples);
    expect(copy!.samples[0]!.position).not.toBe(original.samples[0]!.position);
    expect(copy!.style).not.toBe(original.style);
  });

  it('keeps copied group members together but out of the original group', () => {
    const originals = [
      stroke('a', { groupId: 'grp_1' }),
      stroke('b', { groupId: 'grp_1' }),
    ];

    const copies = cloneNodes(originals);

    // Still one group between them...
    expect(groupOf(copies[0]!)).toBeDefined();
    expect(groupOf(copies[0]!)).toBe(groupOf(copies[1]!));
    // ...but not the group they came from, or duplicating a group of three
    // would leave a single group of six.
    expect(groupOf(copies[0]!)).not.toBe('grp_1');
  });

  it('keeps two separate groups separate', () => {
    const copies = cloneNodes([
      stroke('a', { groupId: 'grp_1' }),
      stroke('b', { groupId: 'grp_1' }),
      stroke('c', { groupId: 'grp_2' }),
    ]);

    expect(groupOf(copies[0]!)).toBe(groupOf(copies[1]!));
    expect(groupOf(copies[2]!)).not.toBe(groupOf(copies[0]!));
    expect(groupOf(copies[2]!)).not.toBe('grp_2');
  });

  it('leaves ungrouped nodes ungrouped', () => {
    const copies = cloneNodes([stroke('a'), stroke('b')]);
    expect(groupOf(copies[0]!)).toBeUndefined();
    expect(groupOf(copies[1]!)).toBeUndefined();
  });

  it('does not disturb the originals', () => {
    const originals = [stroke('a', { groupId: 'grp_1' })];
    cloneNodes(originals);
    expect(originals[0]!.groupId).toBe('grp_1');
  });

  it('moves copies to a given layer', () => {
    const copies = cloneNodes([stroke('a'), stroke('b')], 'layer_2');
    expect(copies.every((node) => node.layerId === 'layer_2')).toBe(true);
  });

  it('carries the name and the hidden and locked flags', () => {
    const [copy] = cloneNodes([
      stroke('a', { label: 'Handle', hidden: true, locked: true }),
    ]);
    expect(copy!.label).toBe('Handle');
    expect(copy!.hidden).toBe(true);
    expect(copy!.locked).toBe(true);
  });

  it('cloneNode on its own is a plain copy, group and all', () => {
    // The batch API is where regrouping belongs; the single-node primitive
    // stays predictable for callers that want an exact copy.
    const copy = cloneNode(stroke('a', { groupId: 'grp_1' }));
    expect(copy.groupId).toBe('grp_1');
    expect(copy.id).not.toBe('a');
  });
});
