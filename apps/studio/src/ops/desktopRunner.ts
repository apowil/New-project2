import { type OpName, type OpRequestMap, type OpResponseMap, type OpRunner } from '@wisp/core';

/**
 * Runs operations in the desktop app's process pool.
 *
 * The studio does not know it is inside Electron beyond this one check, which
 * is deliberate: everything else about the app has to keep working in an
 * ordinary browser tab, because that is what a connected tablet is.
 *
 * Real processes beat a Web Worker here for one reason worth the extra piece:
 * several can run at once. A window doing its own boolean while two tablets
 * wait on theirs is the case this exists for.
 */

interface DesktopBridge {
  runOp: (name: string, request: unknown) => Promise<unknown>;
  hostInfo: () => Promise<{
    port: number;
    addresses: string[];
    load: { running: number; queued: number; workers: number };
  }>;
}

const bridge = (): DesktopBridge | null =>
  (globalThis as { wispDesktop?: DesktopBridge }).wispDesktop ?? null;

/** True when running inside the desktop app rather than a browser. */
export const isDesktop = (): boolean => bridge() !== null;

export class DesktopOpRunner implements OpRunner {
  readonly description = 'On this PC';

  /**
   * Where work goes when a compute process dies.
   *
   * A pool worker can crash — it is a separate process running a geometry
   * library over whatever shape somebody just drew. When it does, the answer
   * is to compute the thing somewhere else, not to drop the request: losing a
   * stroke because a background process fell over is not a trade anyone would
   * accept.
   */
  constructor(private readonly fallback: OpRunner) {}

  async run<K extends OpName>(name: K, request: OpRequestMap[K]): Promise<OpResponseMap[K]> {
    const desktop = bridge();
    if (!desktop) return this.fallback.run(name, request);

    try {
      return (await desktop.runOp(name, request)) as OpResponseMap[K];
    } catch (error) {
      console.warn(`The compute pool could not run "${name}"; retrying here.`, error);
      return this.fallback.run(name, request);
    }
  }

  dispose(): void {
    this.fallback.dispose?.();
  }
}

/** Port and addresses the desktop app is serving on, for the host panel. */
export async function hostInfo(): ReturnType<DesktopBridge['hostInfo']> {
  const desktop = bridge();
  if (!desktop) throw new Error('The desktop bridge is unavailable.');
  return desktop.hostInfo();
}
