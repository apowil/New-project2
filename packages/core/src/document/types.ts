import { type Vec3 } from '../math/vec3.js';
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

export interface StrokeNode {
  id: NodeId;
  type: 'stroke';
  layerId: LayerId;
  samples: StrokeSample[];
  style: StrokeStyle;
  /** The sketch plane normal the stroke was drawn against; orients its ribbon. */
  planeNormal: Vec3;
  createdAt: number;
}

/**
 * Placeholder for stage 2 (primitives, imported meshes). Declared now so the
 * document, history and serialisation layers are already polymorphic.
 */
export interface MeshNode {
  id: NodeId;
  type: 'mesh';
  layerId: LayerId;
  primitive: 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane';
  transform: {
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
  };
  style: StrokeStyle;
  createdAt: number;
}

/**
 * Geometry with no procedural description left — the result of a boolean
 * operation, where the surface no longer corresponds to any centreline.
 *
 * A stroke can be re-swept at a different width because its centreline is
 * kept; once two strokes are cut against each other there is no centreline to
 * re-sweep, so the triangles themselves become the source of truth.
 */
export interface BakedMeshNode {
  id: NodeId;
  type: 'baked';
  layerId: LayerId;
  /** Shown in the UI, e.g. "Subtract of 2". */
  label: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  style: StrokeStyle;
  createdAt: number;
}

export type SceneNode = StrokeNode | MeshNode | BakedMeshNode;

/** True for nodes that can take part in a boolean operation. */
export const isSolid = (node: SceneNode): node is StrokeNode | BakedMeshNode =>
  node.type === 'stroke' || node.type === 'baked';

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
