import { Vector3 } from 'three';
import {
  DeleteNodesCommand,
  TranslateNodesCommand,
  makePlane,
  raycastPlane,
  toLocal,
  translateNodes,
  type Plane,
  type Vec3,
} from '@wisp/core';

import { type GestureHandlers, type StrokeInput } from '../viewport/gestures.js';
import { type Viewport } from '../viewport/viewport.js';
import { session, useStore } from '../state/store.js';
import { DrawTool } from './drawTool.js';
import { LiquifyTool } from './liquifyTool.js';
import { DimensionTool } from './dimensionTool.js';
import { ShapeTool } from './shapeTool.js';
import { TextTool } from './textTool.js';
import { resolvePlane } from '../viewport/sketchPlane.js';

/**
 * Routes gestures to whichever tool is active. Tools stay dumb — this is the
 * only place that knows which one is in charge.
 */
export class ToolController implements GestureHandlers {
  readonly draw: DrawTool;
  readonly shape: ShapeTool;
  readonly text: TextTool;
  readonly dimension: DimensionTool;
  readonly liquify: LiquifyTool;

  constructor(private readonly viewport: Viewport) {
    this.draw = new DrawTool(viewport);
    this.shape = new ShapeTool(viewport);
    this.text = new TextTool(viewport);
    this.dimension = new DimensionTool(viewport);
    this.liquify = new LiquifyTool(viewport);
  }

  private marqueeStart: { x: number; y: number; additive: boolean } | null = null;

  /**
   * A drag that begins on an already-selected item moves it instead of
   * starting a new box selection — the same rule every canvas app uses, and
   * the reason selection has to come before move rather than being a mode.
   */
  private moveState: {
    plane: Plane;
    last: Vec3;
    total: Vec3;
    ids: string[];
    /** The item under the pointer, so a tap that never moves still toggles. */
    pressedId: string;
  } | null = null;

  onStrokeStart = (input: StrokeInput): void => {
    const { tool } = useStore.getState();

    switch (tool) {
      case 'draw':
        this.draw.begin(input);
        break;
      case 'erase':
        this.eraseAt(input);
        break;
      case 'plane':
        this.replantPlaneAt(input);
        break;
      case 'shape':
        this.shape.begin(input);
        break;
      case 'liquify':
        this.liquify.begin(input);
        break;
      case 'dimension':
        // Taps, not a drag: a dimension is three separate decisions.
        this.dimension.tap(input);
        break;
      case 'text':
        // The prompt takes over from here; the tool only marks the spot.
        useStore.getState().setTextPrompt({ x: input.x, y: input.y });
        break;
      case 'select': {
        const store = useStore.getState();
        const hit = this.viewport.pickSurface(input.x, input.y);

        // The eyedropper borrows the select tool's picking rather than being a
        // tool of its own: it is one tap, and having to switch back afterwards
        // would cost more than it saves.
        if (store.eyedropper) {
          if (hit?.nodeId) store.pickColorAt(hit.nodeId);
          else store.setEyedropper(false);
          return;
        }

        if (hit?.nodeId && store.selection.includes(hit.nodeId) && !input.shiftKey) {
          this.beginMove(input, store.selection, hit.nodeId);
          return;
        }

        this.marqueeStart = { x: input.x, y: input.y, additive: input.shiftKey };
        break;
      }
    }
  };

  onStrokeMove = (inputs: StrokeInput[]): void => {
    const { tool } = useStore.getState();
    const last = inputs[inputs.length - 1];

    if (tool === 'draw') {
      this.draw.extend(inputs);
    } else if (tool === 'liquify') {
      this.liquify.extend(inputs);
    } else if (tool === 'shape') {
      this.shape.extend(inputs);
    } else if (tool === 'erase') {
      // Dragging the eraser keeps deleting whatever it passes over.
      if (last) this.eraseAt(last);
    } else if (tool === 'select' && this.moveState && last) {
      this.continueMove(last);
    } else if (tool === 'select' && this.marqueeStart && last) {
      // Only show the rubber band once the drag is clearly not a tap.
      const dragged =
        Math.abs(last.x - this.marqueeStart.x) + Math.abs(last.y - this.marqueeStart.y) > 6;
      useStore.getState().setMarquee(
        dragged
          ? { x0: this.marqueeStart.x, y0: this.marqueeStart.y, x1: last.x, y1: last.y }
          : null,
      );
    }
  };

  onStrokeEnd = (input: StrokeInput): void => {
    const store = useStore.getState();

    if (store.tool === 'draw') {
      void this.draw.end();
      return;
    }

    if (store.tool === 'shape') {
      this.shape.end(input);
      return;
    }

    if (store.tool === 'liquify') {
      this.liquify.end();
      return;
    }

    if (store.tool === 'select' && this.moveState) {
      this.endMove();
      return;
    }

    if (store.tool === 'select' && this.marqueeStart) {
      const start = this.marqueeStart;
      this.marqueeStart = null;
      store.setMarquee(null);

      const travelled = Math.abs(input.x - start.x) + Math.abs(input.y - start.y);
      const additive = start.additive || input.shiftKey;

      if (travelled > 6) {
        const ids = this.viewport.nodesInRect(start.x, start.y, input.x, input.y);
        store.setSelection(
          additive ? [...new Set([...store.selection, ...ids])] : ids,
        );
        return;
      }

      const hit = this.viewport.pickSurface(input.x, input.y);
      if (hit?.nodeId) store.toggleSelected(hit.nodeId, additive);
      else if (!additive) store.clearSelection();
    }
  };

  onTouchOrbitedWithoutPen = (): void => {
    useStore.getState().noticeTouchWithoutPen();
  };

  onStrokeCancel = (): void => {
    this.draw.cancel();
    this.shape.cancel();
    this.dimension.cancel();
    this.liquify.cancel();
    this.marqueeStart = null;
    if (this.moveState) this.endMove();
    useStore.getState().setMarquee(null);
  };

  /** Moves along a plane facing the camera, through the selection's centre. */
  private beginMove(input: StrokeInput, ids: string[], pressedId: string): void {
    const centre = this.selectionCentre(ids);
    if (!centre) return;

    const forward = this.viewport.camera.forward;
    const plane = makePlane(
      centre,
      { x: -forward.x, y: -forward.y, z: -forward.z },
      this.viewport.camera.right,
    );

    const point = this.pointOnPlane(plane, input.x, input.y);
    if (!point) return;

    this.moveState = {
      plane,
      last: point,
      total: { x: 0, y: 0, z: 0 },
      ids: [...ids],
      pressedId,
    };
  }

  private continueMove(input: StrokeInput): void {
    const state = this.moveState;
    if (!state) return;

    const point = this.pointOnPlane(state.plane, input.x, input.y);
    if (!point) return;

    const delta = {
      x: point.x - state.last.x,
      y: point.y - state.last.y,
      z: point.z - state.last.z,
    };

    // Applied straight to the document so the drag is live; history gets a
    // single entry for the whole gesture when the pointer lifts.
    translateNodes(session.document, state.ids, delta);
    state.last = point;
    state.total = {
      x: state.total.x + delta.x,
      y: state.total.y + delta.y,
      z: state.total.z + delta.z,
    };

    useStore.getState().syncFromSession();
  }

  private endMove(): void {
    const state = this.moveState;
    this.moveState = null;
    if (!state) return;

    const { total, ids, pressedId } = state;

    // A press that never travelled is a tap, not a move: it should still
    // toggle the item, which is how tapping a selected stroke deselects it.
    if (Math.abs(total.x) + Math.abs(total.y) + Math.abs(total.z) < 1e-6) {
      useStore.getState().toggleSelected(pressedId, false);
      return;
    }

    // Rewind the live movement, then replay it as one undoable command so the
    // history holds the whole drag rather than nothing or hundreds of steps.
    translateNodes(session.document, ids, { x: -total.x, y: -total.y, z: -total.z });
    useStore.getState().run(new TranslateNodesCommand(ids, total));
  }

  private pointOnPlane(plane: Plane, x: number, y: number): Vec3 | null {
    const ndc = this.viewport.toNdc(x, y);
    const ray = this.viewport.camera.ray(ndc.x, ndc.y);
    return raycastPlane(
      plane,
      { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
    );
  }

  private selectionCentre(ids: string[]): Vec3 | null {
    const box = this.viewport.boundsOf(ids);
    if (!box || box.isEmpty()) return null;
    const centre = box.getCenter(new Vector3());
    return { x: centre.x, y: centre.y, z: centre.z };
  }

  onHover = (input: StrokeInput | null): void => {
    // A chained polyline previews its next segment as the pen hovers.
    const hovering = useStore.getState().tool;
    if (input && hovering === 'shape') this.shape.hover(input);
    if (input && hovering === 'dimension') this.dimension.hover(input);
    // The brush ring follows the pen, and has to let go when it leaves.
    if (hovering === 'liquify') this.liquify.hover(input);
  };

  onCameraChange = (): void => {
    this.viewport.requestRender();
  };

  /**
   * Re-centres the orbit on whatever was pressed. Falls back to the ground
   * plane when nothing was hit, so pressing empty space still does something
   * predictable rather than nothing.
   */
  onPinOrbit = (x: number, y: number): void => {
    const hit = this.viewport.pickSurface(x, y);
    const point = hit ? hit.point : this.viewport.groundPointAt(x, y);
    if (!point) return;

    this.viewport.camera.pinTarget(new Vector3(point.x, point.y, point.z));
    this.viewport.requestRender();
  };

  /** Called every frame before rendering. */
  tick = (): void => {
    this.draw.tick();
    // Two of the liquify modes work for as long as the brush is held, so they
    // are driven by the frame rather than by pointer events.
    this.liquify.tick();
  };

  /** Places text at the point the text tool marked. */
  placeText(screenX: number, screenY: number, text: string, size: number): boolean {
    const store = useStore.getState();
    const plane = resolvePlane(store.plane, this.viewport.camera);

    const ndc = this.viewport.toNdc(screenX, screenY);
    const ray = this.viewport.camera.ray(ndc.x, ndc.y);
    const hit = raycastPlane(
      plane,
      { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
    );
    if (!hit) return false;

    const anchor = toLocal(plane, hit);
    return this.text.place({ text, size, u: anchor.u, v: anchor.v }, plane);
  }

  /** Finishes a polyline or spline that is waiting for more points. */
  finishShape(closed = false): void {
    this.shape.finishChain(closed);
  }

  get isChainingShape(): boolean {
    return this.shape.isChaining;
  }

  private eraseAt(input: StrokeInput): void {
    const hit = this.viewport.pickSurface(input.x, input.y);
    if (!hit?.nodeId) return;
    useStore.getState().run(new DeleteNodesCommand([hit.nodeId], 'Erase stroke'));
  }

  private replantPlaneAt(input: StrokeInput): void {
    const hit = this.viewport.pickSurface(input.x, input.y);
    const store = useStore.getState();

    if (hit) {
      store.setPlaneAnchor(hit.point, hit.normal);
    } else {
      // Tapping empty space drops the plane back onto the ground, which is a
      // predictable way out of an awkward surface plane.
      store.setPlaneMode('ground');
    }
    // Replanting is a one-shot action; hand the pen straight back to drawing.
    store.setTool('draw');
    this.viewport.requestRender();
  }
}
