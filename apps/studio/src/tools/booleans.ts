import {
  createId,
  geometryOptions,
  type BakedMeshNode,
  type BooleanOperation,
  type OpRunner,
  type SceneNode,
  type SolidInput,
  type StrokeStyle,
} from '@wisp/core';

/**
 * Booleans, from the app's point of view.
 *
 * The evaluation itself lives in `ops/booleanOp.ts` and runs wherever the
 * operation runner sends it — a worker today, a paired desktop later. What is
 * left here is the part that only makes sense next to a document: turning
 * selected nodes into operation inputs, and turning the answer back into a
 * node.
 */

export type BooleanOp = BooleanOperation;

export const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  union: 'Merge',
  subtract: 'Subtract',
  intersect: 'Intersect',
  join: 'Combine',
};

export class BooleanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BooleanError';
  }
}

/**
 * Describes a node for the evaluator.
 *
 * Strokes go as centrelines — a few kilobytes that rebuild into the same tube
 * at the other end — and only geometry with no centreline left is sent as
 * triangles. Over a LAN link that distinction is most of the transfer cost.
 */
function toSolid(node: SceneNode): SolidInput | null {
  if (node.type === 'baked') {
    return {
      kind: 'mesh',
      positions: node.positions,
      normals: node.normals,
      indices: node.indices,
    };
  }

  if (node.type !== 'stroke') return null;

  return {
    kind: 'stroke',
    samples: node.samples,
    options: { ...geometryOptions(node.style), initialNormal: node.planeNormal },
  };
}

/**
 * Runs `op` over `nodes`, returning a baked node.
 *
 * Throws {@link BooleanError} with a reason the person drawing can act on.
 */
export async function evaluateBoolean(
  ops: OpRunner,
  nodes: SceneNode[],
  op: BooleanOp,
  layerId: string,
  style: StrokeStyle,
): Promise<BakedMeshNode> {
  if (nodes.length < 2) {
    throw new BooleanError('Select at least two strokes first.');
  }

  const solids = nodes
    .map(toSolid)
    .filter((solid): solid is SolidInput => solid !== null);

  const result = await ops.run('evaluateBoolean', { op, solids });
  if (!result.ok) throw new BooleanError(result.reason);

  return {
    id: createId('baked'),
    type: 'baked',
    layerId,
    label: `${BOOLEAN_LABELS[op]} of ${nodes.length}`,
    positions: result.positions,
    normals: result.normals,
    indices: result.indices,
    style: { ...style },
    createdAt: Date.now(),
  };
}
