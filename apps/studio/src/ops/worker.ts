/// <reference lib="webworker" />

import { registerOpHandler, runOp, type OpName, type OpRequestMap } from '@wisp/core';

import { evaluateBooleanOp } from './booleanOp.js';

/**
 * The worker that heavy operations actually run in.
 *
 * Its whole job is to keep the main thread free. A boolean over a dense
 * selection takes long enough to freeze a tablet solid, and a frozen canvas
 * during an operation reads as a crash even when it is working perfectly.
 *
 * The handlers here are the same functions the main thread would have called,
 * registered the same way, so nothing about the result depends on which side
 * ran it.
 */

registerOpHandler('evaluateBoolean', evaluateBooleanOp);

export interface WorkerRequest {
  id: number;
  name: OpName;
  request: OpRequestMap[OpName];
}

export type WorkerReply =
  | { id: number; ok: true; result: unknown; transfer?: ArrayBufferLike[] }
  | { id: number; ok: false; error: string };

/** Buffers that can move to the caller instead of being copied. */
function transferablesOf(result: unknown): ArrayBufferLike[] {
  if (!result || typeof result !== 'object') return [];
  const transfer: ArrayBufferLike[] = [];
  for (const value of Object.values(result)) {
    if (ArrayBuffer.isView(value)) transfer.push(value.buffer);
  }
  return transfer;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, name, request } = event.data;
  try {
    const result = runOp(name, request as never);
    const reply: WorkerReply = { id, ok: true, result };
    // Transferring hands the memory over rather than cloning it, which for a
    // multi-megabyte mesh is the difference between instant and a stutter of
    // its own — precisely what this worker exists to avoid.
    (self as unknown as Worker).postMessage(reply, transferablesOf(result));
  } catch (error) {
    const reply: WorkerReply = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(reply);
  }
};
