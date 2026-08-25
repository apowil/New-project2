import {
  InlineOpRunner,
  type OpName,
  type OpRequestMap,
  type OpResponseMap,
  type OpRunner,
} from '@wisp/core';

import { type WorkerReply, type WorkerRequest } from './worker.js';

/**
 * Runs operations in a Web Worker.
 *
 * The point is responsiveness rather than raw speed: the work takes about as
 * long either way, but the canvas keeps drawing, the spinner keeps spinning,
 * and the app does not look like it has died. On a tablet that difference is
 * most of what "smoother" means.
 *
 * If a worker cannot be created — an old WebView, a locked-down browser — this
 * falls back to running inline. Slower and janky, but working; refusing to do
 * booleans at all would be worse.
 */
export class WorkerOpRunner implements OpRunner {
  readonly description = 'On device';

  private worker: Worker | null = null;
  private unavailable = false;
  private readonly pending = new Map<
    number,
    { resolve: (value: never) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  private readonly fallback = new InlineOpRunner();

  /**
   * Started on first use, not at boot.
   *
   * The worker pulls in a CSG library of its own — a few hundred kilobytes
   * that a sketch which never runs a boolean should not pay for, least of all
   * during startup on a tablet. Deferring moves that cost to the first
   * operation, where there is already a spinner and an expectation of waiting.
   */
  private ensureWorker(): Worker | null {
    if (this.worker || this.unavailable) return this.worker;

    try {
      const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorkerReply>) => this.settle(event.data);
      worker.onerror = (event) => this.failAll(event.message || 'The worker stopped.');
      this.worker = worker;
      return worker;
    } catch (error) {
      console.warn('Workers are unavailable; heavy operations will run inline.', error);
      this.unavailable = true;
      return null;
    }
  }

  private settle(reply: WorkerReply): void {
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    this.pending.delete(reply.id);

    if (reply.ok) entry.resolve(reply.result as never);
    else entry.reject(new Error(reply.error));
  }

  /** A dead worker must not leave callers waiting on a promise for ever. */
  private failAll(message: string): void {
    for (const [, entry] of this.pending) entry.reject(new Error(message));
    this.pending.clear();
  }

  async run<K extends OpName>(name: K, request: OpRequestMap[K]): Promise<OpResponseMap[K]> {
    const worker = this.ensureWorker();
    if (!worker) return this.fallback.run(name, request);

    const id = this.nextId++;
    const message: WorkerRequest = { id, name, request };

    return new Promise<OpResponseMap[K]>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: never) => void,
        reject,
      });
      // Deliberately *not* transferring the request buffers: the document
      // still owns them, and handing them over would leave the original
      // geometry detached and empty on this side.
      worker.postMessage(message);
    });
  }

  dispose(): void {
    this.failAll('The worker was shut down.');
    this.worker?.terminate();
    this.worker = null;
  }
}
