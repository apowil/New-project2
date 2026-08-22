import { type OrbitCamera } from './camera.js';

/**
 * Gesture routing.
 *
 * The rule that makes a pen tablet feel right is that input *type* decides
 * intent, not a modal tool:
 *
 *   pen              draw, always
 *   one finger       orbit
 *   two fingers      pan + pinch zoom together
 *   mouse left       draw
 *   mouse middle     pan
 *   mouse right      orbit
 *   wheel            zoom
 *
 * Because the pen is a different pointer type from touch, drawing and camera
 * control never contend for the same gesture — which is why pinch-to-zoom can
 * exist here without fighting orbit.
 */

export interface StrokeInput {
  /** CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  /** 0..1. Devices without a sensor report a constant. */
  pressure: number;
  tiltX: number;
  tiltY: number;
  timestamp: number;
  pointerType: string;
}

export interface GestureHandlers {
  onStrokeStart(input: StrokeInput): void;
  /** Receives every coalesced sample, oldest first — do not drop these. */
  onStrokeMove(inputs: StrokeInput[]): void;
  onStrokeEnd(input: StrokeInput): void;
  onStrokeCancel(): void;
  onHover(input: StrokeInput | null): void;
  onCameraChange(): void;
}

export type TouchIntent = 'camera' | 'draw';

export interface InputRouterOptions {
  /**
   * What a single finger does. 'camera' (the default) suits a pen tablet;
   * 'draw' is for devices with no stylus.
   */
  touchIntent?: TouchIntent;
  orbitSpeed?: number;
  zoomSpeed?: number;
}

interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

/** How long after the pen leaves that touch stays ignored, in ms. */
const PALM_GUARD_MS = 600;

export class InputRouter {
  private touches: TouchPoint[] = [];
  private strokePointerId: number | null = null;

  private cameraMode: 'none' | 'orbit' | 'pan' = 'none';
  private cameraPointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;

  private pinchDistance = 0;
  private pinchCentre = { x: 0, y: 0 };

  private penLastSeen = 0;
  private disposed = false;

  touchIntent: TouchIntent;
  orbitSpeed: number;
  zoomSpeed: number;

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: OrbitCamera,
    private readonly handlers: GestureHandlers,
    options: InputRouterOptions = {},
  ) {
    this.touchIntent = options.touchIntent ?? 'camera';
    this.orbitSpeed = options.orbitSpeed ?? 0.0062;
    this.zoomSpeed = options.zoomSpeed ?? 0.0015;

    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('pointerleave', this.onPointerLeave);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    this.disposed = true;
    const el = this.element;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
  }

  /** True while a pen is touching or has just left — used to reject the palm. */
  private get penGuardActive(): boolean {
    return performance.now() - this.penLastSeen < PALM_GUARD_MS;
  }

  private toInput(event: PointerEvent): StrokeInput {
    const rect = this.element.getBoundingClientRect();
    // A mouse reports pressure 0.5 while held; a pen that has not yet reported
    // a real reading also sends 0. Both need a sane floor or the stroke starts
    // at zero width.
    const rawPressure = event.pressure;
    const pressure =
      event.pointerType === 'pen'
        ? rawPressure > 0
          ? rawPressure
          : 0.35
        : 0.5;

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pressure,
      tiltX: event.tiltX ?? 0,
      tiltY: event.tiltY ?? 0,
      timestamp: event.timeStamp,
      pointerType: event.pointerType,
    };
  }

  private startStroke(event: PointerEvent): void {
    this.strokePointerId = event.pointerId;
    this.capture(event.pointerId);
    this.handlers.onStrokeStart(this.toInput(event));
  }

  /**
   * Pointer capture keeps a stroke alive when the pen crosses over a panel or
   * leaves the canvas. It throws for a pointer the element does not own —
   * which happens with synthetic events and with a pointer that was already
   * released — and that must never take the stroke down with it.
   */
  private capture(pointerId: number): void {
    try {
      this.element.setPointerCapture(pointerId);
    } catch {
      /* not capturable; the stroke still works, it just ends at the edge */
    }
  }

  private release(pointerId: number): void {
    try {
      if (this.element.hasPointerCapture(pointerId)) {
        this.element.releasePointerCapture(pointerId);
      }
    } catch {
      /* already gone */
    }
  }

  private cancelStroke(): void {
    if (this.strokePointerId === null) return;
    this.strokePointerId = null;
    this.handlers.onStrokeCancel();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.disposed) return;

    if (event.pointerType === 'pen') {
      this.penLastSeen = performance.now();
      // A pen landing mid-gesture wins: drop any camera drag and any touch
      // that sneaked in.
      this.touches = [];
      this.cameraMode = 'none';
      this.startStroke(event);
      return;
    }

    if (event.pointerType === 'touch') {
      if (this.penGuardActive) return; // palm rejection

      this.touches.push({ id: event.pointerId, x: event.clientX, y: event.clientY });

      if (this.touches.length === 1) {
        if (this.touchIntent === 'draw') {
          this.startStroke(event);
        } else {
          this.cameraMode = 'orbit';
          this.cameraPointerId = event.pointerId;
          this.lastX = event.clientX;
          this.lastY = event.clientY;
        }
        return;
      }

      // A second finger always means "camera", even if the first was drawing.
      this.cancelStroke();
      this.cameraMode = 'pan';
      this.cameraPointerId = null;
      this.beginPinch();
      return;
    }

    // Mouse.
    if (event.button === 0) {
      this.startStroke(event);
    } else if (event.button === 1) {
      this.cameraMode = 'pan';
      this.cameraPointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.capture(event.pointerId);
      event.preventDefault();
    } else if (event.button === 2) {
      this.cameraMode = 'orbit';
      this.cameraPointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.capture(event.pointerId);
    }
  };

  private beginPinch(): void {
    const [a, b] = this.touches;
    if (!a || !b) return;
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchCentre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.disposed) return;

    if (event.pointerType === 'pen') this.penLastSeen = performance.now();

    if (this.strokePointerId === event.pointerId) {
      // Coalesced events carry the samples the browser batched between frames.
      // On a 240 Hz digitiser at 60 fps that is three of every four samples —
      // dropping them is the single biggest cause of faceted-looking strokes.
      const events =
        typeof event.getCoalescedEvents === 'function'
          ? event.getCoalescedEvents()
          : [event];
      const inputs = (events.length > 0 ? events : [event]).map((e) => this.toInput(e));
      this.handlers.onStrokeMove(inputs);
      return;
    }

    if (event.pointerType === 'touch') {
      const touch = this.touches.find((t) => t.id === event.pointerId);
      if (!touch) return;
      touch.x = event.clientX;
      touch.y = event.clientY;

      if (this.touches.length >= 2 && this.cameraMode === 'pan') {
        this.updatePinch();
      } else if (this.cameraMode === 'orbit' && this.cameraPointerId === event.pointerId) {
        this.applyOrbit(event.clientX, event.clientY);
      }
      return;
    }

    if (this.cameraPointerId === event.pointerId && this.cameraMode !== 'none') {
      if (this.cameraMode === 'orbit') {
        this.applyOrbit(event.clientX, event.clientY);
      } else {
        this.applyPan(event.clientX, event.clientY);
      }
      return;
    }

    if (event.pointerType === 'pen' && this.strokePointerId === null) {
      // Hover: the S Pen reports position before it touches the screen, which
      // is what drives the aiming preview.
      this.handlers.onHover(this.toInput(event));
    }
  };

  private applyOrbit(x: number, y: number): void {
    this.camera.orbit((x - this.lastX) * this.orbitSpeed, (y - this.lastY) * this.orbitSpeed);
    this.lastX = x;
    this.lastY = y;
    this.handlers.onCameraChange();
  }

  private applyPan(x: number, y: number): void {
    this.camera.pan(x - this.lastX, y - this.lastY, this.element.clientHeight);
    this.lastX = x;
    this.lastY = y;
    this.handlers.onCameraChange();
  }

  private updatePinch(): void {
    const [a, b] = this.touches;
    if (!a || !b) return;

    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    if (this.pinchDistance > 0 && distance > 0) {
      this.camera.dolly(this.pinchDistance / distance);
    }
    this.camera.pan(
      centre.x - this.pinchCentre.x,
      centre.y - this.pinchCentre.y,
      this.element.clientHeight,
    );

    this.pinchDistance = distance;
    this.pinchCentre = centre;
    this.handlers.onCameraChange();
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.disposed) return;

    if (event.pointerType === 'pen') this.penLastSeen = performance.now();

    if (this.strokePointerId === event.pointerId) {
      this.strokePointerId = null;
      this.release(event.pointerId);
      this.handlers.onStrokeEnd(this.toInput(event));
      return;
    }

    if (event.pointerType === 'touch') {
      this.touches = this.touches.filter((t) => t.id !== event.pointerId);

      if (this.touches.length === 1) {
        // Dropping from two fingers to one hands control back to orbit rather
        // than leaving a dead gesture.
        const remaining = this.touches[0]!;
        this.cameraMode = 'orbit';
        this.cameraPointerId = remaining.id;
        this.lastX = remaining.x;
        this.lastY = remaining.y;
      } else if (this.touches.length === 0) {
        this.cameraMode = 'none';
        this.cameraPointerId = null;
      } else {
        this.beginPinch();
      }
      return;
    }

    if (this.cameraPointerId === event.pointerId) {
      this.cameraMode = 'none';
      this.cameraPointerId = null;
      this.release(event.pointerId);
    }
  };

  private onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'pen' && this.strokePointerId === null) {
      this.handlers.onHover(null);
    }
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // deltaMode 1 is lines, 2 is pages; normalise both to something pixel-ish.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    this.camera.dolly(Math.exp(event.deltaY * scale * this.zoomSpeed));
    this.handlers.onCameraChange();
  };

  private onContextMenu = (event: Event): void => {
    // Right-drag orbits, so the browser menu must not appear.
    event.preventDefault();
  };
}
