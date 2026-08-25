import {
  AddNodesCommand,
  buildShapeSamples,
  buildStrokeGeometry,
  createId,
  geometryOptions,
  isLayerEditable,
  makePlane,
  mirrorCombinations,
  mirrorSamples,
  mirrorVec3,
  raycastPlane,
  shapeDimensions,
  toLocal,
  type Plane,
  type ShapeKind,
  type ShapeParams,
  type StrokeNode,
  type Vec3,
} from '@wisp/core';

import { type StrokeInput } from '../viewport/gestures.js';
import { resolvePlane } from '../viewport/sketchPlane.js';
import { type Viewport } from '../viewport/viewport.js';
import { session, useStore } from '../state/store.js';

/**
 * Drawing exact shapes.
 *
 * Two interaction shapes, because these tools genuinely differ:
 *
 *  - **Dragged** (line, rectangle, circle, polygon) — press, drag, release.
 *    One gesture, one shape.
 *  - **Multi-point** (polyline, spline) — tap to add each point, and finish
 *    with a double-tap or by pressing Enter. Continuous by nature, so they
 *    cannot end when the pointer lifts.
 *
 * Everything is generated as a centreline and committed as an ordinary stroke,
 * so it sweeps, moves, combines and exports like anything else. The shape
 * parameters ride along on the node, which is what keeps it editable as
 * numbers afterwards.
 */

export const DRAGGED_KINDS: ShapeKind[] = ['line', 'rectangle', 'circle', 'polygon'];
export const MULTI_POINT_KINDS: ShapeKind[] = ['polyline', 'spline'];

export const isMultiPoint = (kind: ShapeKind): boolean => MULTI_POINT_KINDS.includes(kind);

interface DragState {
  plane: Plane;
  startU: number;
  startV: number;
}

interface ChainState {
  plane: Plane;
  points: Array<{ u: number; v: number }>;
  /** Where the pointer is now, previewed as the next segment. */
  cursor: { u: number; v: number } | null;
}

export class ShapeTool {
  private drag: DragState | null = null;
  private chain: ChainState | null = null;

  constructor(private readonly viewport: Viewport) {}

  get isActive(): boolean {
    return this.drag !== null || this.chain !== null;
  }

  /** True while a multi-point shape is waiting for more taps. */
  get isChaining(): boolean {
    return this.chain !== null;
  }

  private planePoint(plane: Plane, input: StrokeInput): { u: number; v: number } | null {
    const ndc = this.viewport.toNdc(input.x, input.y);
    const ray = this.viewport.camera.ray(ndc.x, ndc.y);
    const hit = raycastPlane(
      plane,
      { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
    );
    return hit ? toLocal(plane, hit) : null;
  }

  begin(input: StrokeInput): void {
    const state = useStore.getState();
    if (!isLayerEditable(session.document, state.activeLayerId)) return;

    const kind = state.shapeKind;

    if (isMultiPoint(kind)) {
      const plane = this.chain?.plane ?? resolvePlane(state.plane, this.viewport.camera);
      const point = this.planePoint(plane, input);
      if (!point) return;

      if (!this.chain) {
        this.chain = { plane, points: [point], cursor: point };
      } else {
        this.chain.points.push(point);
      }
      this.refreshPreview();
      return;
    }

    const plane = resolvePlane(state.plane, this.viewport.camera);
    const point = this.planePoint(plane, input);
    if (!point) return;

    this.drag = { plane, startU: point.u, startV: point.v };
  }

  extend(inputs: StrokeInput[]): void {
    const last = inputs[inputs.length - 1];
    if (!last) return;

    if (this.chain) {
      const point = this.planePoint(this.chain.plane, last);
      if (point) this.chain.cursor = point;
      this.refreshPreview();
      return;
    }

    if (!this.drag) return;
    this.refreshPreview(last);
  }

  /** Pointer moved without a button held — previews the next chain segment. */
  hover(input: StrokeInput): void {
    if (!this.chain) return;
    const point = this.planePoint(this.chain.plane, input);
    if (!point) return;
    this.chain.cursor = point;
    this.refreshPreview();
  }

  end(input: StrokeInput): void {
    if (this.chain) return; // chains finish explicitly, not on pointer up

    const drag = this.drag;
    this.drag = null;
    if (!drag) return;

    const params = this.paramsForDrag(drag, input);
    this.viewport.setPreview(null, useStore.getState().style);
    if (params) this.commit(params, drag.plane);
  }

  /** Ends a polyline or spline, committing what has been placed. */
  finishChain(closed = false): void {
    const chain = this.chain;
    this.chain = null;
    this.viewport.setPreview(null, useStore.getState().style);
    if (!chain || chain.points.length < 2) return;

    const first = chain.points[0]!;
    this.commit(
      {
        kind: useStore.getState().shapeKind,
        u: first.u,
        v: first.v,
        points: chain.points,
        closed,
      },
      chain.plane,
    );
  }

  cancel(): void {
    this.drag = null;
    this.chain = null;
    this.viewport.setPreview(null, useStore.getState().style);
  }

  private paramsForDrag(drag: DragState, input: StrokeInput): ShapeParams | null {
    const point = this.planePoint(drag.plane, input);
    if (!point) return null;

    const kind = useStore.getState().shapeKind;
    let du = point.u - drag.startU;
    let dv = point.v - drag.startV;

    // Shift constrains: a square rather than a rectangle, and a line snapped
    // to the nearest 45°. Without it an "exact" shape tool still needs a
    // steady hand for the commonest cases.
    if (input.shiftKey) {
      if (kind === 'rectangle') {
        const side = Math.max(Math.abs(du), Math.abs(dv));
        du = Math.sign(du || 1) * side;
        dv = Math.sign(dv || 1) * side;
      } else if (kind === 'line') {
        const step = Math.PI / 4;
        const angle = Math.round(Math.atan2(dv, du) / step) * step;
        const reach = Math.hypot(du, dv);
        du = Math.cos(angle) * reach;
        dv = Math.sin(angle) * reach;
      }
    }

    switch (kind) {
      case 'rectangle':
        // Alt grows the rectangle from its centre, which is how you place one
        // concentric with something already drawn.
        return input.altKey
          ? {
              kind,
              u: drag.startU - du,
              v: drag.startV - dv,
              width: du * 2,
              height: dv * 2,
            }
          : { kind, u: drag.startU, v: drag.startV, width: du, height: dv };
      case 'circle':
        // Dragged from the centre outwards, which is how a compass works.
        return { kind, u: drag.startU, v: drag.startV, radius: Math.hypot(du, dv) };
      case 'polygon':
        return {
          kind,
          u: drag.startU,
          v: drag.startV,
          radius: Math.hypot(du, dv),
          sides: useStore.getState().polygonSides,
          // Turn the polygon to follow the drag, so it can be oriented freely.
          rotation: Math.atan2(dv, du) - Math.PI / 2,
        };
      default:
        return {
          kind: 'line',
          u: drag.startU,
          v: drag.startV,
          points: [
            { u: drag.startU, v: drag.startV },
            // From the deltas, not the raw point, so the 45° snap above holds.
            { u: drag.startU + du, v: drag.startV + dv },
          ],
        };
    }
  }

  /** Rebuilds the live outline, and publishes its dimensions for the readout. */
  private refreshPreview(input?: StrokeInput): void {
    const store = useStore.getState();
    const style = store.style;

    let params: ShapeParams | null = null;
    let plane: Plane | null = null;

    if (this.chain) {
      const points = [...this.chain.points];
      if (this.chain.cursor) points.push(this.chain.cursor);
      const first = points[0];
      if (first && points.length >= 2) {
        params = { kind: store.shapeKind, u: first.u, v: first.v, points };
        plane = this.chain.plane;
      }
    } else if (this.drag && input) {
      params = this.paramsForDrag(this.drag, input);
      plane = this.drag.plane;
    }

    if (!params || !plane) {
      this.viewport.setPreview(null, style);
      store.setShapeReadout(null);
      return;
    }

    const samples = buildShapeSamples(params, plane);
    const geometry =
      samples.length >= 2
        ? buildStrokeGeometry(samples, {
            ...geometryOptions(style),
            // Fewer sides while the shape is still moving under the pointer.
            sides: Math.max(4, Math.floor(style.sides / 2)),
            initialNormal: plane.normal,
          })
        : null;

    this.viewport.setPreview(geometry ? [geometry] : null, style);
    store.setShapeReadout(shapeDimensions(params));
  }

  private commit(params: ShapeParams, plane: Plane): void {
    const store = useStore.getState();
    const samples = buildShapeSamples(params, plane);
    if (samples.length < 2) return;

    store.setShapeReadout(null);

    const createdAt = Date.now();
    const serialisablePlane = {
      origin: { ...plane.origin },
      normal: { ...plane.normal },
      u: { ...plane.u },
      v: { ...plane.v },
    };

    const makeNode = (nodeSamples: typeof samples, normal: Vec3): StrokeNode => ({
      id: createId('shape'),
      type: 'stroke',
      layerId: store.activeLayerId,
      samples: nodeSamples,
      style: { ...store.style },
      planeNormal: normal,
      createdAt,
      shape: { params, plane: serialisablePlane },
    });

    const nodes: StrokeNode[] = [makeNode(samples, plane.normal)];
    const mirrors = mirrorCombinations(store.mirror);
    for (const flip of mirrors) {
      // Mirrored copies lose the parametric description: the reflected
      // parameters would need a reflected plane too, and a shape you cannot
      // edit is better than one whose numbers lie.
      nodes.push({
        ...makeNode(mirrorSamples(samples, flip), mirrorVec3(plane.normal, flip)),
        shape: undefined,
      });
    }

    store.run(new AddNodesCommand(nodes, `Draw ${params.kind}`));
  }
}

/** Rebuilds a shape node after its dimensions were edited. */
export function rebuildShape(node: StrokeNode, params: ShapeParams): StrokeNode | null {
  if (!node.shape) return null;

  const plane = makePlane(node.shape.plane.origin, node.shape.plane.normal, node.shape.plane.u);
  const samples = buildShapeSamples(params, plane);
  if (samples.length < 2) return null;

  return { ...node, samples, shape: { ...node.shape, params } };
}
