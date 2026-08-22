import {
  AddNodeCommand,
  DEFAULT_STROKE_STYLE,
  PointerFilter,
  buildStrokeGeometry,
  createId,
  isLayerEditable,
  raycastPlane,
  type Plane,
  type StrokeNode,
  type StrokeSample,
  type StrokeStyle,
  type Vec3,
} from '@wisp/core';

import { type StrokeInput } from '../viewport/gestures.js';
import { resolvePlane } from '../viewport/sketchPlane.js';
import { type Viewport } from '../viewport/viewport.js';
import { session, useStore } from '../state/store.js';

/**
 * Turns pointer input into a stroke.
 *
 * The live preview is rebuilt at most once per frame from the raw samples;
 * the expensive simplify/resample/smooth pass runs once, when the pen lifts.
 * That split is what keeps drawing responsive on a tablet — and it is also the
 * seam where the PC compute link will slot in, since the final pass already
 * goes through the op runner rather than being called inline.
 */
export class DrawTool {
  private readonly filter = new PointerFilter({ minCutoff: 1.4, beta: 0.035 });
  private samples: StrokeSample[] = [];
  private plane: Plane | null = null;
  private previewDirty = false;
  private active = false;

  constructor(private readonly viewport: Viewport) {}

  get isDrawing(): boolean {
    return this.active;
  }

  /**
   * Minimum gap between stored samples, in scene units. Scaled by camera
   * distance so it stays roughly constant on screen — zoomed out, a pixel of
   * pointer movement covers far more world space.
   */
  private get minSpacing(): number {
    return Math.max(this.viewport.camera.distance * 0.0016, 0.0008);
  }

  private get style(): StrokeStyle {
    return useStore.getState().style;
  }

  begin(input: StrokeInput): void {
    const state = useStore.getState();
    if (!isLayerEditable(session.document, state.activeLayerId)) return;

    this.active = true;
    this.samples = [];
    this.filter.reset();
    this.plane = resolvePlane(state.plane, this.viewport.camera);

    this.addSample(input);
  }

  extend(inputs: StrokeInput[]): void {
    if (!this.active) return;
    for (const input of inputs) this.addSample(input);
  }

  private addSample(input: StrokeInput): void {
    if (!this.plane) return;

    const smoothed = this.filter.filter(input.x, input.y, input.pressure, input.timestamp);
    const ndc = this.viewport.toNdc(smoothed.x, smoothed.y);
    const ray = this.viewport.camera.ray(ndc.x, ndc.y);

    const point = raycastPlane(
      this.plane,
      { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z },
    );
    // A ray can miss when the plane is edge-on to the camera; skipping the
    // sample is right — the stroke simply pauses rather than snapping to a
    // wild intersection far off screen.
    if (!point) return;

    const previous = this.samples[this.samples.length - 1];
    if (previous) {
      const spacing = this.minSpacing;
      const dx = point.x - previous.position.x;
      const dy = point.y - previous.position.y;
      const dz = point.z - previous.position.z;
      if (dx * dx + dy * dy + dz * dz < spacing * spacing) {
        // Too close to matter as a new point, but the pressure reading is
        // still fresh — fold it into the sample that is already there.
        previous.pressure = previous.pressure * 0.7 + smoothed.pressure * 0.3;
        return;
      }
    }

    this.samples.push({
      position: point,
      pressure: Math.min(Math.max(smoothed.pressure, 0), 1),
    });
    this.previewDirty = true;
  }

  /** Called once per frame from the render loop. */
  tick(): void {
    if (!this.previewDirty || !this.active) return;
    this.previewDirty = false;

    const style = this.style;
    const geometry = buildStrokeGeometry(this.samples, {
      width: style.width,
      // Fewer sides while drawing: the preview is rebuilt every frame and the
      // difference is invisible at stroke thickness.
      sides: Math.max(4, Math.floor(style.sides / 2)),
      flatness: style.flatness,
      initialNormal: this.plane?.normal,
    });

    this.viewport.setPreview(geometry, style);
  }

  async end(): Promise<void> {
    if (!this.active) return;
    this.active = false;

    const style = { ...this.style };
    const plane = this.plane;
    const raw = this.samples;
    this.samples = [];
    this.plane = null;
    this.viewport.setPreview(null, style);

    if (!plane) return;

    const samples = raw.length >= 2 ? raw : dotStroke(raw, plane, style);
    if (!samples) return;

    const { samples: processed } = await session.ops.run('processStroke', {
      samples,
      simplifyTolerance: this.minSpacing * 0.4,
      spacing: this.minSpacing * 1.1,
      smoothing: 0.35,
    });

    if (processed.length < 2) return;

    const store = useStore.getState();
    const node: StrokeNode = {
      id: createId('stroke'),
      type: 'stroke',
      layerId: store.activeLayerId,
      samples: processed,
      style: { ...DEFAULT_STROKE_STYLE, ...style },
      planeNormal: plane.normal,
      createdAt: Date.now(),
    };

    store.run(new AddNodeCommand(node));
  }

  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.samples = [];
    this.plane = null;
    this.previewDirty = false;
    this.viewport.setPreview(null, this.style);
  }
}

/**
 * A tap should leave a mark. One sample has no direction to sweep along, so a
 * short segment along the plane's own axis is synthesised — the taper then
 * rounds it into a dot.
 */
function dotStroke(raw: StrokeSample[], plane: Plane, style: StrokeStyle): StrokeSample[] | null {
  const first = raw[0];
  if (!first) return null;

  const half = Math.max(style.width * 0.3, 1e-4);
  const offset: Vec3 = plane.u;

  return [
    {
      position: {
        x: first.position.x - offset.x * half,
        y: first.position.y - offset.y * half,
        z: first.position.z - offset.z * half,
      },
      pressure: first.pressure,
    },
    {
      position: {
        x: first.position.x + offset.x * half,
        y: first.position.y + offset.y * half,
        z: first.position.z + offset.z * half,
      },
      pressure: first.pressure,
    },
  ];
}
