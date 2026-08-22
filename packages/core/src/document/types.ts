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
}

export const DEFAULT_STROKE_STYLE: StrokeStyle = {
  color: '#d8d2c8',
  width: 0.06,
  flatness: 0.45,
  sides: 8,
  opacity: 1,
  roughness: 0.65,
  metalness: 0,
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

export type SceneNode = StrokeNode | MeshNode;

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
