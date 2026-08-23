import {
  AddNodesCommand,
  buildDimension,
  createId,
  isLayerEditable,
  raycastPlane,
  toLocal,
  fromLocal,
  type AnnotationNode,
  type Plane,
  type Unit,
  type Vec3,
} from '@wisp/core';

import { type StrokeInput } from '../viewport/gestures.js';
import { resolvePlane } from '../viewport/sketchPlane.js';
import { sweepPolylines } from '../viewport/sweep.js';
import { type Viewport } from '../viewport/viewport.js';
import { session, useStore } from '../state/store.js';

/**
 * Measuring something and leaving the measurement behind.
 *
 * Three taps: the two points being measured, then where the dimension line
 * should sit. The third is not a formality — a dimension crossing the thing it
 * describes is unreadable, and only the person drawing knows which side is
 * clear.
 *
 * What lands in the document is the two points and an offset. The number is
 * generated at render time, so it follows the unit setting rather than being
 * frozen at whatever was current when it was drawn.
 */
export class DimensionTool {
  private from: Vec3 | null = null;
  private to: Vec3 | null = null;
  private plane: Plane | null = null;

  constructor(private readonly viewport: Viewport) {}

  get isActive(): boolean {
    return this.from !== null;
  }

  /** What to tell the user to do next. */
  get hint(): string {
    if (!this.from) return 'Tap the first point to measure from';
    if (!this.to) return 'Tap the second point';
    return 'Tap where the dimension line should sit';
  }

  private pointAt(input: StrokeInput, plane: Plane): Vec3 | null {
    // Snap to a surface when there is one under the pointer: measuring to a
    // point in mid-air that only looks like it is on the sketch is the classic
    // way to get a confidently wrong number.
    const hit = this.viewport.pickSurface(input.x, input.y);
    if (hit) return hit.point;

    const ndc = this.viewport.toNdc(input.x, input.y);
    const ray = this.viewport.camera.ray(ndc.x, ndc.y);
    return raycastPlane(
      plane,
      { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
    );
  }

  tap(input: StrokeInput): void {
    const store = useStore.getState();
    if (!isLayerEditable(session.document, store.activeLayerId)) return;

    const plane = this.plane ?? resolvePlane(store.plane, this.viewport.camera);
    const point = this.pointAt(input, plane);
    if (!point) return;

    if (!this.from) {
      this.plane = plane;
      this.from = point;
      store.setStatusMessage(this.hint);
      return;
    }

    if (!this.to) {
      this.to = point;
      store.setStatusMessage(this.hint);
      this.preview(point);
      return;
    }

    this.commit(point);
  }

  /** Redraws the pending dimension as the pointer moves. */
  hover(input: StrokeInput): void {
    if (!this.from || !this.plane) return;
    const point = this.pointAt(input, this.plane);
    if (point) this.preview(point);
  }

  cancel(): void {
    this.from = null;
    this.to = null;
    this.plane = null;
    this.viewport.setPreview(null, useStore.getState().style);
    useStore.getState().setShapeReadout(null);
  }

  private preview(cursor: Vec3): void {
    if (!this.from || !this.plane) return;

    const store = useStore.getState();
    const to = this.to ?? cursor;
    const { offset, direction } = this.offsetFor(this.from, to, this.to ? cursor : null);

    const node = this.node(this.from, to, offset, direction, store.activeLayerId);
    const geometry = sweepPolylines(
      dimensionPolylines(node, store.unit),
      { ...store.style, width: node.textSize * 0.09, sides: 5 },
    );

    this.viewport.setPreview(geometry ? [geometry] : null, store.style);
    store.setShapeReadout([{ label: 'Length', value: length(this.from, to) }]);
  }

  /**
   * How far off the measured line the dimension sits, from where the pointer
   * is now — signed, so it can be placed on either side.
   */
  private offsetFor(
    from: Vec3,
    to: Vec3,
    cursor: Vec3 | null,
  ): { offset: number; direction: Vec3 } {
    const plane = this.plane!;
    const direction = plane.v;
    if (!cursor) return { offset: 0, direction };

    // Measured in the sketch plane, so the offset means the same thing however
    // the camera happens to be pointing.
    const a = toLocal(plane, from);
    const b = toLocal(plane, to);
    const c = toLocal(plane, cursor);

    const du = b.u - a.u;
    const dv = b.v - a.v;
    const span = Math.hypot(du, dv);
    if (span < 1e-9) return { offset: 0, direction };

    // Perpendicular distance from the cursor to the measured line.
    const offset = ((c.u - a.u) * -dv + (c.v - a.v) * du) / span;

    // The same perpendicular, expressed in world space.
    const origin = fromLocal(plane, a.u, a.v);
    const stepped = fromLocal(plane, a.u - dv / span, a.v + du / span);
    const perpendicular: Vec3 = {
      x: stepped.x - origin.x,
      y: stepped.y - origin.y,
      z: stepped.z - origin.z,
    };

    return { offset, direction: perpendicular };
  }

  private node(
    from: Vec3,
    to: Vec3,
    offset: number,
    direction: Vec3,
    layerId: string,
  ): AnnotationNode {
    const store = useStore.getState();
    return {
      id: createId('dim'),
      type: 'annotation',
      kind: 'dimension',
      layerId,
      from: { ...from },
      to: { ...to },
      offset,
      offsetDirection: { ...direction },
      textSize: store.textSize,
      style: { ...store.style },
      createdAt: Date.now(),
    };
  }

  private commit(cursor: Vec3): void {
    const store = useStore.getState();
    const from = this.from;
    const to = this.to;
    if (!from || !to) return;

    const { offset, direction } = this.offsetFor(from, to, cursor);
    const node = this.node(from, to, offset, direction, store.activeLayerId);

    this.cancel();

    // Nothing to measure between two points in the same place.
    if (length(from, to) < 1e-6) {
      store.setStatusMessage('Those two points are in the same place.');
      return;
    }

    store.run(new AddNodesCommand([node], 'Add dimension'));
    store.setSelection([node.id]);
    store.setStatusMessage(null);
  }
}

const length = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** Everything a dimension draws — rules and number alike — as one list. */
function dimensionPolylines(node: AnnotationNode, unit: Unit): Vec3[][] {
  const parts = buildDimension(node, unit);
  return [...parts.lines, ...parts.text];
}
