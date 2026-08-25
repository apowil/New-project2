import { cpus } from 'node:os';
import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';

import { type OpName, type OpRequestMap, type OpResponseMap } from '@wisp/core';

import { type ComputeReply, type ComputeRequest } from './computeWorker.js';

/**
 * A pool of processes that do the expensive work.
 *
 * Not the main process: that one owns the window and the server, and a boolean
 * running there would freeze the desktop app exactly the way it used to freeze
 * the tablet — while also stalling every connected device.
 *
 * Sized to leave a core free. The host is somebody's laptop, and saturating it
 * so a tablet's boolean finishes fractionally sooner is a poor trade for the
 * person actually sitting at it.
 */

const MAX_WORKERS = Math.max(1, Math.min(4, (cpus().length || 2) - 1));

interface Job {
  message: ComputeRequest;
  resolve: (value: never) => void;
  reject: (error: Error) => void;
}

interface Slot {
  process: UtilityProcess;
  busy: Job | null;
}

export class ComputePool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private readonly inFlight = new Map<number, Job>();
  private nextId = 1;
  private disposed = false;

  constructor(private readonly workerPath: string) {}

  /** How many jobs are running or waiting — shown in the host panel. */
  get load(): { running: number; queued: number; workers: number } {
    return {
      running: this.inFlight.size,
      queued: this.queue.length,
      workers: this.slots.length,
    };
  }

  private spawn(): Slot | null {
    if (this.disposed || this.slots.length >= MAX_WORKERS) return null;

    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: 'wisp-compute',
      stdio: 'inherit',
    });

    const slot: Slot = { process: child, busy: null };

    child.on('message', (reply: ComputeReply) => {
      const job = this.inFlight.get(reply.id);
      if (!job) return;
      this.inFlight.delete(reply.id);
      slot.busy = null;

      if (reply.ok) job.resolve(reply.result as never);
      else job.reject(new Error(reply.error));

      this.pump();
    });

    // A crashed worker must not leave its caller waiting for ever, and must
    // not take the pool down with it: drop the slot and let the next job
    // spawn a fresh one.
    child.on('exit', () => {
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots.splice(index, 1);

      const job = slot.busy;
      if (job) {
        this.inFlight.delete(job.message.id);
        job.reject(new Error('The compute process stopped unexpectedly.'));
      }
      this.pump();
    });

    this.slots.push(slot);
    return slot;
  }

  /** Hands queued jobs to whatever capacity exists, growing the pool if useful. */
  private pump(): void {
    while (this.queue.length > 0) {
      const slot = this.slots.find((candidate) => candidate.busy === null) ?? this.spawn();
      if (!slot) return;

      const job = this.queue.shift();
      if (!job) return;

      slot.busy = job;
      this.inFlight.set(job.message.id, job);
      slot.process.postMessage(job.message);
    }
  }

  run<K extends OpName>(name: K, request: OpRequestMap[K]): Promise<OpResponseMap[K]> {
    if (this.disposed) return Promise.reject(new Error('The compute pool is shut down.'));

    return new Promise<OpResponseMap[K]>((resolve, reject) => {
      this.queue.push({
        message: { id: this.nextId++, name, request },
        resolve: resolve as (value: never) => void,
        reject,
      });
      this.pump();
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const job of [...this.queue, ...this.inFlight.values()]) {
      job.reject(new Error('The compute pool is shutting down.'));
    }
    this.queue.length = 0;
    this.inFlight.clear();

    for (const slot of this.slots) slot.process.kill();
    this.slots.length = 0;
  }
}

/** Where the compiled compute worker sits, relative to the main process. */
export const computeWorkerPath = (dirname: string): string =>
  join(dirname, 'computeWorker.cjs');
