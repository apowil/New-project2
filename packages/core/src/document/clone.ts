/**
 * Copying nodes.
 *
 * Every copy gets a fresh id and its own buffers. Sharing a Float32Array
 * between two nodes would look right until one of them was edited, at which
 * point both would change — the kind of bug that only shows up after the user
 * has done real work.
 */

import { createId } from './ids.js';
import { type LayerId, type SceneNode } from './types.js';

export function cloneNode(node: SceneNode, layerId: LayerId = node.layerId): SceneNode {
  const id = createId(node.type);

  switch (node.type) {
    case 'stroke':
      return {
        ...node,
        id,
        layerId,
        samples: node.samples.map((sample) => ({
          position: { ...sample.position },
          pressure: sample.pressure,
        })),
        style: { ...node.style },
        planeNormal: { ...node.planeNormal },
      };

    case 'baked':
      return {
        ...node,
        id,
        layerId,
        positions: node.positions.slice(),
        normals: node.normals.slice(),
        indices: node.indices.slice(),
        style: { ...node.style },
      };

    case 'mesh':
      return {
        ...node,
        id,
        layerId,
        transform: {
          position: { ...node.transform.position },
          rotation: { ...node.transform.rotation },
          scale: { ...node.transform.scale },
        },
        style: { ...node.style },
      };

    case 'annotation':
      return {
        ...node,
        id,
        layerId,
        from: { ...node.from },
        to: { ...node.to },
        offsetDirection: { ...node.offsetDirection },
        style: { ...node.style },
      };
  }
}

export const cloneNodes = (nodes: readonly SceneNode[], layerId?: LayerId): SceneNode[] =>
  nodes.map((node) => cloneNode(node, layerId ?? node.layerId));
