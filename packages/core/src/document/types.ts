import { type Vec3 } from '../math/vec3.js';
import { type ShapeParams } from '../shapes/shapes.js';
import { type StrokeSample } from '../stroke/resample.js';

export type NodeId = string;
export type LayerId = string;

/** Appearance of a stroke. Kept separate from geometry so it can be restyled. */
export interface StrokeStyle {
  /** Hex string, e.g. "#e8e4dc". */
  color: string;
  width: number;
  /** Cross-section squash: 1 = round tube, ~0.2 = flat ribbon. */
  flatness: number;
  sides: number;
  opacity: number;
  roughness: number;
  metalness: number;
  /** Fraction of the stroke length tapered at each end. */
  taper: number;
  /** Exponent on pressure. Above 1 makes light strokes noticeably thinner. */
  pressureCurve: number;
  /** Width at zero pressure, as a fraction of `width`. */
  minPressureScale: number;
}

export const DEFAULT_STROKE_STYLE: StrokeStyle = {
  color: '#d8d2c8',
  width: 0.06,
  flatness: 0.45,
  sides: 8,
  opacity: 1,
  roughness: 0.65,
  metalness: 0,
  taper: 0.12,
  pressureCurve: 1.4,
  minPressureScale: 0.35,
};

/**
 * What every node carries, whatever its geometry.
 *
 * Visibility and locking exist here as well as on the layer because the two
 * answer different questions: a layer is a place to put things, while these
 * are properties of the thing itself. A node is drawn only when both it and
 * its layer are visible, and editable only when neither is locked.
 */
export interface NodeBase {
  id: NodeId;
  layerId: LayerId;
  createdAt: number;
  /** Shown in the outliner. Absent means "describe me from my kind". */
  label?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Shared by every member of a group. Absent means the node is loose. */
  groupId?: string;
}

export interface StrokeNode extends NodeBase {
  type: 'stroke';
  samples: StrokeSample[];
  style: StrokeStyle;
  /** The sketch plane normal the stroke was drawn against; orients its ribbon. */
  planeNormal: Vec3;
  /**
   * Set when the stroke came from a shape tool rather than freehand.
   *
   * Keeping the parameters — and the plane they were laid out on — is what
   * lets a rectangle still be edited as "80 by 50" after the fact. A freehand
   * stroke has no such description and leaves this undefined.
   */
  shape?: {
    params: ShapeParams;
    plane: { origin: Vec3; normal: Vec3; u: Vec3; v: Vec3 };
  };
}

/**
 * Placeholder for stage 2 (primitives, imported meshes). Declared now so the
 * document, history and serialisation layers are already polymorphic.
 */
export interface MeshNode extends NodeBase {
  type: 'mesh';
  primitive: 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane';
  transform: {
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
  };
  style: StrokeStyle;
}

/**
 * Geometry with no procedural description left — the result of a boolean
 * operation, where the surface no longer corresponds to any centreline.
 *
 * A stroke can be re-swept at a different width because its centreline is
 * kept; once two strokes are cut against each other there is no centreline to
 * re-sweep, so the triangles themselves become the source of truth.
 */
export interface BakedMeshNode extends NodeBase {
  type: 'baked';
  /** Always present here — there is no centreline to describe it otherwise. */
  label: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  style: StrokeStyle;
}

/**
 * A measurement left in the scene.
 *
 * Stored as the two points it spans rather than as baked geometry, so the
 * number redraws itself when the unit changes — a dimension that still reads
 * "0.4 m" after switching to millimetres would be worse than no dimension.
 */
export interface AnnotationNode extends NodeBase {
  type: 'annotation';
  kind: 'dimension';
  from: Vec3;
  to: Vec3;
  /** How far off the measured line the dimension line sits, in metres. */
  offset: number;
  /** Which way that offset runs; keeps the witness lines in one plane. */
  offsetDirection: Vec3;
  /** Height of the number, in metres. */
  textSize: number;
  style: StrokeStyle;
}

export type SceneNode = StrokeNode | MeshNode | BakedMeshNode | AnnotationNode;

/** True for nodes that can take part in a boolean operation. */
export const isSolid = (node: SceneNode): node is StrokeNode | BakedMeshNode =>
  node.type === 'stroke' || node.type === 'baked';

/** What to call a node in the interface when it has no name of its own. */
export function nodeLabel(node: SceneNode): string {
  if (node.label) return node.label;
  switch (node.type) {
    case 'stroke':
      return node.shape ? capitalise(node.shape.params.kind) : 'Stroke';
    case 'mesh':
      return capitalise(node.primitive);
    case 'annotation':
      return 'Dimension';
    default:
      return 'Mesh';
  }
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export interface Layer {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface SketchDocument {
  id: string;
  name: string;
  /** Bumped on every mutation so views can diff cheaply against a snapshot. */
  revision: number;
  layers: Layer[];
  activeLayerId: LayerId;
  nodes: Map<NodeId, SceneNode>;
  /** Draw order, back to front. */
  order: NodeId[];
  createdAt: number;
  updatedAt: number;
}
