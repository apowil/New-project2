import { Vector3 } from 'three';
import { DeleteNodesCommand } from '@wisp/core';

import { type GestureHandlers, type StrokeInput } from '../viewport/gestures.js';
import { type Viewport } from '../viewport/viewport.js';
import { useStore } from '../state/store.js';
import { DrawTool } from './drawTool.js';

/**
 * Routes gestures to whichever tool is active. Tools stay dumb — this is the
 * only place that knows which one is in charge.
 */
export class ToolController implements GestureHandlers {
  readonly draw: DrawTool;

  constructor(private readonly viewport: Viewport) {
    this.draw = new DrawTool(viewport);
  }

  private marqueeStart: { x: number; y: number; additive: boolean } | null = null;

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
      case 'select':
        this.marqueeStart = { x: input.x, y: input.y, additive: input.shiftKey };
        break;
    }
  };

  onStrokeMove = (inputs: StrokeInput[]): void => {
    const { tool } = useStore.getState();
    const last = inputs[inputs.length - 1];

    if (tool === 'draw') {
      this.draw.extend(inputs);
    } else if (tool === 'erase') {
      // Dragging the eraser keeps deleting whatever it passes over.
      if (last) this.eraseAt(last);
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

  onStrokeCancel = (): void => {
    this.draw.cancel();
    this.marqueeStart = null;
    useStore.getState().setMarquee(null);
  };

  onHover = (): void => {
    // Reserved for the S Pen aiming preview.
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
  };

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
