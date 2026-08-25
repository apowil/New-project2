import { runOp, type OpName, type OpRequestMap } from '@wisp/core';
import { registerHeavyOps } from '@wisp/ops';

/**
 * One compute process.
 *
 * Booleans are pure CPU work with no GPU involved, so this is an ordinary Node
 * process rather than a hidden window. Several run at once: with one shared
 * process, three tablets asking for a boolean at the same moment would queue
 * behind each other, and the third would wait for all three.
 *
 * The handlers registered here are the same ones the tablet's own worker
 * registers, which is what makes offloading safe — the answer does not depend
 * on which machine produced it.
 */

registerHeavyOps();

export interface ComputeRequest {
  id: number;
  name: OpName;
  request: OpRequestMap[OpName];
}

export type ComputeReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

process.parentPort?.on('message', (event: { data: ComputeRequest }) => {
  const { id, name, request } = event.data;
  try {
    const result = runOp(name, request as never);
    const reply: ComputeReply = { id, ok: true, result };
    process.parentPort?.postMessage(reply);
  } catch (error) {
    const reply: ComputeReply = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    process.parentPort?.postMessage(reply);
  }
});
