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
    }
  };

  onStrokeMove = (inputs: StrokeInput[]): void => {
    const { tool } = useStore.getState();
    if (tool === 'draw') {
      this.draw.extend(inputs);
    } else if (tool === 'erase') {
      // Dragging the eraser keeps deleting whatever it passes over.
      const last = inputs[inputs.length - 1];
      if (last) this.eraseAt(last);
    }
  };

  onStrokeEnd = (): void => {
    if (useStore.getState().tool === 'draw') void this.draw.end();
  };

  onStrokeCancel = (): void => {
    this.draw.cancel();
  };

  onHover = (): void => {
    // Reserved for the S Pen aiming preview.
  };

  onCameraChange = (): void => {
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
