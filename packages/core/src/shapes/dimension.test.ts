import { describe, expect, it } from 'vitest';

import { DEFAULT_STROKE_STYLE, type AnnotationNode } from '../document/types.js';
import { distance, dot, sub, vec3, type Vec3 } from '../math/vec3.js';
import { buildDimension } from './dimension.js';

function dimension(patch: Partial<AnnotationNode> = {}): AnnotationNode {
  return {
    id: 'dim',
    type: 'annotation',
    kind: 'dimension',
    layerId: 'layer',
    from: vec3(0, 0, 0),
    to: vec3(2, 0, 0),
    offset: 0.5,
    offsetDirection: vec3(0, 1, 0),
    textSize: 0.1,
    style: { ...DEFAULT_STROKE_STYLE },
    createdAt: 0,
    ...patch,
  };
}

const allPoints = (parts: { lines: Vec3[][]; text: Vec3[][] }): Vec3[] => [
  ...parts.lines.flat(),
  ...parts.text.flat(),
];

describe('buildDimension', () => {
  it('measures the distance between its two points', () => {
    expect(buildDimension(dimension(), 'm').length).toBeCloseTo(2, 10);
    expect(
      buildDimension(dimension({ to: vec3(3, 4, 0) }), 'm').length,
    ).toBeCloseTo(5, 10);
  });

  it('draws witness lines, a dimension line and two arrow heads', () => {
    const parts = buildDimension(dimension(), 'm');
    // Two witness lines, one dimension line, two strokes per arrow head.
    expect(parts.lines.length).toBe(7);
    expect(parts.text.length).toBeGreaterThan(0);
  });

  it('puts the dimension line at the requested offset', () => {
    const parts = buildDimension(dimension({ offset: 0.5 }), 'm');
    const line = parts.lines[2]!;

    // The third entry is the dimension line itself, offset in +Y.
    expect(line[0]!.y).toBeCloseTo(0.5, 10);
    expect(line[1]!.y).toBeCloseTo(0.5, 10);
    expect(line[0]!.x).toBeCloseTo(0, 10);
    expect(line[1]!.x).toBeCloseTo(2, 10);
  });

  it('squares the offset up against the measured line', () => {
    // An offset direction given at a careless angle should still produce
    // witness lines perpendicular to what is being measured.
    const parts = buildDimension(
      dimension({ offsetDirection: vec3(0.4, 1, 0) }),
      'm',
    );
    const line = parts.lines[2]!;

    const along = sub(dimension().to, dimension().from);
    const across = sub(line[0]!, dimension().from);
    expect(dot(along, across)).toBeCloseTo(0, 6);
  });

  it('survives an offset direction parallel to the line', () => {
    // Degenerate input: there is no unique perpendicular, but collapsing the
    // dimension onto its own axis would be worse than picking one.
    const parts = buildDimension(dimension({ offsetDirection: vec3(1, 0, 0) }), 'm');
    const line = parts.lines[2]!;

    expect(distance(line[0]!, line[1]!)).toBeCloseTo(2, 6);
    const across = sub(line[0]!, vec3(0, 0, 0));
    expect(dot(vec3(1, 0, 0), across)).toBeCloseTo(0, 6);
  });

  it('draws nothing for a dimension spanning no distance', () => {
    const parts = buildDimension(dimension({ to: vec3(0, 0, 0) }), 'm');
    expect(parts.lines).toEqual([]);
    expect(parts.text).toEqual([]);
    expect(parts.length).toBe(0);
  });

  it('redraws the number when the unit changes', () => {
    // The whole reason the node stores points rather than baked glyphs.
    const inMetres = buildDimension(dimension(), 'm');
    const inMillimetres = buildDimension(dimension(), 'mm');

    // "2 m" against "2000 mm" — different text, so different geometry.
    expect(inMillimetres.text.length).not.toBe(inMetres.text.length);
    expect(inMetres.length).toBeCloseTo(inMillimetres.length, 10);
  });

  it('keeps everything in the plane of the measurement', () => {
    // Measured along X, offset along Y: nothing should stray into Z.
    for (const point of allPoints(buildDimension(dimension(), 'cm'))) {
      expect(point.z).toBeCloseTo(0, 9);
    }
  });

  it('works for a dimension measured in an arbitrary direction', () => {
    const parts = buildDimension(
      dimension({ from: vec3(1, 2, 3), to: vec3(4, 6, 3), offsetDirection: vec3(0, 0, 1) }),
      'm',
    );
    expect(parts.length).toBeCloseTo(5, 10);
    expect(parts.lines.length).toBe(7);
    expect(parts.text.length).toBeGreaterThan(0);
  });
});
