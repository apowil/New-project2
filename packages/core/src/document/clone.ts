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

/**
 * Copies a batch of nodes, giving any groups among them fresh identities.
 *
 * Without the remap the copies would carry the *original* group id and so join
 * the group they were copied from: duplicating a group of three would leave one
 * group of six, and tapping any member would select all of them. Members
 * copied together stay grouped together; they simply become their own group.
 */
export function cloneNodes(nodes: readonly SceneNode[], layerId?: LayerId): SceneNode[] {
  const groups = new Map<string, string>();

  return nodes.map((node) => {
    const copy = cloneNode(node, layerId ?? node.layerId);
    if (copy.groupId !== undefined) {
      let replacement = groups.get(copy.groupId);
      if (replacement === undefined) {
        replacement = createId('group');
        groups.set(copy.groupId, replacement);
      }
      copy.groupId = replacement;
    }
    return copy;
  });
}
