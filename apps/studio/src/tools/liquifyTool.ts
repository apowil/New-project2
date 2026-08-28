import { Vector3 } from 'three';
import {
  ReshapeStrokesCommand,
  densify,
  isNodeEditable,
  liquifySamples,
  makePlane,
  medianSpacing,
  polylineWithin,
  raycastPlane,
  relaxSpacing,
  touch,
  type LiquifyBrush,
  type LiquifyMode,
  type Plane,
  type StrokeNode,
  type StrokeSample,
  type Vec3,
} from '@wisp/core';

import { type StrokeInput } from '../viewport/gestures.js';
import { type Viewport } from '../viewport/viewport.js';
import { session, useStore } from '../state/store.js';

/**
 * Reshaping strokes that are already drawn.
 *
 * The gesture follows the same shape as moving a selection: the warp is
 * applied straight to the document so the drag is live, and the whole gesture
 * lands in the history as one entry when the pen lifts. What differs is that a
 * warp cannot be undone by running it backwards, so the command carries the
 * centrelines from before rather than an inverse.
 *
 * Two of the four modes are *rates* rather than displacements — holding the
 * brush still over a wobble keeps relaxing it — so the work happens on the
 * frame tick rather than on pointer events. Pointer moves only say where the
 * brush is now.
 */

/** How fast `pull` and `smooth` work when held, in units of "per second". */
const HOLD_RATE = 6;

/** Radians of twist for a horizontal drag of one brush radius. */
const TWIST_GAIN = 2.4;

/** Below this, a drag is treated as a tap that meant to hold still. */
const MIN_MEANINGFUL_MOVE = 1e-5;

/**
 * The coarsest a centreline may be, as a fraction of the brush radius, before
 * the brush is over it.
 *
 * Roughly three samples across the brush. Fewer and a push would show as a
 * corner rather than a curve; many more and a shape tool's rectangle would
 * gain thousands of points the moment it was touched.
 */
const WORKING_GAP = 0.35;

interface Warping {
  /** The plane the brush slides along — facing the camera, as moving does. */
  plane: Plane;
  /** Where the brush is now, in world space. */
  centre: Vec3;
  /**
   * Where the pen is now, which is not always where the brush is: twist pins
   * the brush at the press and lets the pen wander off to say how far to turn.
   * Tracked separately so the per-frame delta stays a delta either way.
   */
  pointer: Vec3;
  /** Movement since the last frame, which `push` and `twist` consume. */
  pending: Vec3;
  mode: LiquifyMode;
  radius: number;
  strength: number;
  /** The camera's right vector at the press, so a twist keeps one direction. */
  right: Vec3;
  lastTick: number;
  /** Every stroke this gesture may touch, decided once when the pen lands. */
  candidates: StrokeNode[];
  /**
   * What each stroke the brush has reached looked like beforehand, and how
   * finely it was sampled. Filled in on first contact rather than when the pen
   * lands: measuring every candidate up front would walk the whole sketch to
   * warp one stroke.
   */
  before: Map<
    string,
    { samples: StrokeSample[]; shape: StrokeNode['shape']; spacing: number }
  >;
  /** Which strokes were actually warped, as opposed to merely reached. */
  touched: Set<string>;
}

export class LiquifyTool {
  private state: Warping | null = null;

  constructor(private readonly viewport: Viewport) {}

  /** Where the pen last was, in screen pixels, while nothing is being warped. */
  private hovered: { x: number; y: number } | null = null;

  /**
   * Where to draw the brush ring, or null when there is nothing to show.
   *
   * Resolved here rather than when the pen moves, because finding the depth
   * means a raycast and pointer moves arrive coalesced — several per frame.
   * The render loop asks once a frame, which is exactly the rate a ring that
   * faces the camera has to be recomputed at anyway.
   */
  currentBrush(): { centre: Vec3; radius: number } | null {
    const state = this.state;
    if (state) return { centre: state.centre, radius: state.radius };

    const at = this.hovered;
    if (!at) return null;

    const candidates = this.candidateStrokes();
    if (candidates.length === 0) return null;

    const centre = this.brushCentreAt(at.x, at.y, candidates);
    return centre ? { centre, radius: useStore.getState().liquify.radius } : null;
  }

  begin(input: StrokeInput): void {
    const store = useStore.getState();
    const candidates = this.candidateStrokes();
    if (candidates.length === 0) {
      store.setStatusMessage('Nothing here to reshape — draw a stroke first.');
      return;
    }

    const centre = this.brushCentreAt(input.x, input.y, candidates);
    if (!centre) return;

    const forward = this.viewport.camera.forward;
    const right = this.viewport.camera.right;

    this.state = {
      plane: makePlane(centre, { x: -forward.x, y: -forward.y, z: -forward.z }, right),
      centre,
      pointer: { ...centre },
      pending: { x: 0, y: 0, z: 0 },
      mode: store.liquify.mode,
      radius: store.liquify.radius,
      strength: store.liquify.strength,
      right: { x: right.x, y: right.y, z: right.z },
      lastTick: performance.now(),
      candidates,
      before: new Map(),
      touched: new Set(),
    };
  }

  extend(inputs: StrokeInput[]): void {
    const state = this.state;
    const last = inputs[inputs.length - 1];
    if (!state || !last) return;

    const point = this.pointOnPlane(state.plane, last.x, last.y);
    if (!point) return;

    state.pending = {
      x: state.pending.x + (point.x - state.pointer.x),
      y: state.pending.y + (point.y - state.pointer.y),
      z: state.pending.z + (point.z - state.pointer.z),
    };
    state.pointer = point;

    // Twist turns about where the pen landed, so the brush stays put and the
    // drag only says how far to turn. Sliding the brush as well would mean the
    // part being twisted moved out from under the gesture that was twisting it.
    if (state.mode !== 'twist') state.centre = point;
  }

  /** Called once per frame while the pen is down. */
  tick(): void {
    const state = this.state;
    if (!state) return;

    const now = performance.now();
    const dt = Math.min((now - state.lastTick) / 1000, 0.1);
    state.lastTick = now;

    // Whatever the pen covered since the last frame is spent now, whether or
    // not this mode has a use for it, so a still pen never banks a lurch.
    const moved = state.pending;
    state.pending = { x: 0, y: 0, z: 0 };

    const brush = this.brushFor(state, dt, moved);
    if (!brush) return;

    let changed = false;
    for (const node of state.candidates) {
      // Against the line rather than its samples, so a shape tool's rectangle
      // counts as being under the brush along its edges and not only at its
      // corners.
      if (!polylineWithin(node.samples, brush.centre, brush.radius)) continue;

      // First contact: remember what this stroke was, and measure it, before
      // anything has had a chance to change it.
      if (!state.before.has(node.id)) {
        state.before.set(node.id, {
          samples: node.samples,
          shape: node.shape,
          spacing: medianSpacing(node.samples),
        });
      }

      // Give a coarse centreline something to grab. Doing it for every
      // candidate up front would re-sweep the whole sketch the instant the pen
      // landed, to warp one stroke.
      const dense = densify(node.samples, brush.radius * WORKING_GAP);
      if (dense !== node.samples) node.samples = dense;

      const warped = liquifySamples(node.samples, brush);
      if (!warped) continue;

      node.samples = warped;
      node.shape = undefined;
      state.touched.add(node.id);
      changed = true;
    }

    if (!changed) return;

    // Straight to the document: the drag has to be live, and the history entry
    // is written once at the end rather than on every frame.
    touch(session.document);
    useStore.getState().syncFromSession();
  }

  private brushFor(state: Warping, dt: number, moved: Vec3): LiquifyBrush | null {
    const { centre, radius } = state;

    switch (state.mode) {
      case 'push': {
        const travelled = Math.abs(moved.x) + Math.abs(moved.y) + Math.abs(moved.z);
        if (travelled < MIN_MEANINGFUL_MOVE) return null;
        return { mode: 'push', centre, radius, strength: state.strength, delta: moved };
      }

      case 'twist': {
        // Only the sideways part of the drag turns the brush, so a wobble up
        // and down while twisting does not fight the gesture.
        const along =
          moved.x * state.right.x + moved.y * state.right.y + moved.z * state.right.z;
        const angle = (along / radius) * TWIST_GAIN;
        if (Math.abs(angle) < 1e-6) return null;
        return {
          mode: 'twist',
          centre,
          radius,
          strength: state.strength,
          axis: { ...this.viewport.camera.forward },
          angle,
        };
      }

      case 'pull':
        return {
          mode: 'pull',
          centre,
          radius,
          strength: Math.min(state.strength * dt * HOLD_RATE, 1),
        };

      case 'smooth':
        return {
          mode: 'smooth',
          centre,
          radius,
          strength: Math.min(state.strength * dt * HOLD_RATE, 1),
        };
    }
  }

  end(): void {
    const state = this.state;
    this.state = null;
    if (!state) return;

    const edits: Array<{
      id: string;
      before: StrokeSample[];
      after: StrokeSample[];
      shape: StrokeNode['shape'];
    }> = [];

    for (const [id, original] of state.before) {
      const node = session.document.nodes.get(id);
      if (node?.type !== 'stroke' || original.samples === node.samples) continue;

      if (!state.touched.has(id)) {
        // Reached and densified, but never actually warped. Put the original
        // array back so the viewport does not re-sweep a stroke that did not
        // change.
        node.samples = original.samples;
        node.shape = original.shape;
        continue;
      }

      // Repairing the spacing is left to the end of the gesture rather than
      // done every frame: adding and removing samples mid-drag would shift the
      // ground under the next frame's falloff, and a stroke would creep.
      //
      // The target is the finer of what the stroke had and what the brush
      // needed, so a warped rectangle keeps the resolution that made the warp
      // possible instead of being coarsened straight back out of it.
      node.samples = relaxSpacing(
        node.samples,
        Math.min(original.spacing || Infinity, state.radius * WORKING_GAP),
      );
      edits.push({
        id,
        before: original.samples,
        after: node.samples,
        shape: original.shape,
      });
    }

    if (edits.length === 0) {
      touch(session.document);
      useStore.getState().syncFromSession();
      return;
    }

    // Rewind to what was there before, then replay the whole gesture as one
    // undoable step — the same trick moving a selection uses.
    for (const edit of edits) {
      const node = session.document.nodes.get(edit.id);
      if (node?.type === 'stroke') {
        node.samples = edit.before;
        node.shape = edit.shape;
      }
    }

    useStore.getState().run(new ReshapeStrokesCommand(edits, labelFor(state.mode, edits.length)));
  }

  cancel(): void {
    const state = this.state;
    this.state = null;
    if (!state) return;

    for (const [id, original] of state.before) {
      const node = session.document.nodes.get(id);
      if (node?.type !== 'stroke') continue;
      node.samples = original.samples;
      node.shape = original.shape;
    }
    touch(session.document);
    useStore.getState().syncFromSession();
  }

  /** Tracks the pen so the brush ring shows where a warp would land. */
  hover(input: StrokeInput | null): void {
    if (!input) {
      if (this.hovered) {
        this.hovered = null;
        this.viewport.requestRender();
      }
      return;
    }

    this.hovered = { x: input.x, y: input.y };
    this.viewport.requestRender();
  }

  /**
   * What the brush is allowed to touch.
   *
   * A selection narrows it, which is how you reshape one stroke inside a
   * tangle without disturbing its neighbours. With nothing selected the brush
   * takes whatever it covers, because being made to select first would be a
   * step in the way of every quick adjustment.
   */
  private candidateStrokes(): StrokeNode[] {
    const doc = session.document;
    const { selection } = useStore.getState();
    const ids = selection.length > 0 ? selection : doc.order;

    const strokes: StrokeNode[] = [];
    for (const id of ids) {
      const node = doc.nodes.get(id);
      if (node?.type === 'stroke' && isNodeEditable(doc, node)) strokes.push(node);
    }
    return strokes;
  }

  /**
   * Where in space the brush sits for a screen point.
   *
   * Whatever is under the pen decides the depth, so pressing on a stroke grabs
   * that stroke rather than something behind it. Failing that, the brush sits
   * at the depth of the strokes it could affect — a brush parked at the
   * camera would reach nothing at all.
   */
  private brushCentreAt(x: number, y: number, candidates: StrokeNode[]): Vec3 | null {
    const hit = this.viewport.pickSurface(x, y);
    if (hit?.nodeId && candidates.some((node) => node.id === hit.nodeId)) return hit.point;

    const anchor = this.candidateCentre(candidates);
    if (!anchor) return null;

    const forward = this.viewport.camera.forward;
    const plane = makePlane(
      anchor,
      { x: -forward.x, y: -forward.y, z: -forward.z },
      this.viewport.camera.right,
    );
    return this.pointOnPlane(plane, x, y);
  }

  /**
   * The middle of the strokes the brush may touch, for the fallback depth.
   *
   * Taken from the rendered meshes' bounding boxes rather than by averaging
   * samples: this runs on every hover, and a sketch with a hundred thousand
   * samples would make the pen feel sticky if it walked all of them.
   */
  private candidateCentre(candidates: StrokeNode[]): Vec3 | null {
    const box = this.viewport.boundsOf(candidates.map((node) => node.id));
    if (!box || box.isEmpty()) return null;
    const centre = box.getCenter(new Vector3());
    return { x: centre.x, y: centre.y, z: centre.z };
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
}

/** What the undo entry is called. */
const MODE_LABELS: Record<LiquifyMode, string> = {
  push: 'Push',
  pull: 'Pull',
  twist: 'Twist',
  smooth: 'Smooth',
};

const labelFor = (mode: LiquifyMode, count: number): string =>
  count === 1 ? MODE_LABELS[mode] : `${MODE_LABELS[mode]} ${count} strokes`;

