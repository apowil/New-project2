import { type OpName, type OpRequestMap, type OpResponseMap, type OpRunner } from '@wisp/core';

/**
 * Sends heavy work to a paired desktop over the local network.
 *
 * This is the half that actually makes a tablet faster. Loading the app from
 * the desktop changes nothing about where it runs — the page still executes on
 * the tablet. Only sending the job across, and getting a mesh back, moves the
 * work.
 *
 * Whether that is a win depends on the job. A stroke travels as a centreline,
 * a few kilobytes, and comes back as one too; a boolean returns a baked mesh
 * that can be megabytes. Over Wi-Fi the round trip costs tens of milliseconds,
 * so small jobs are better done here and only large ones are worth sending.
 */

/** Below this, the round trip costs more than the work. */
const WORTH_SENDING = new Set<OpName>(['evaluateBoolean']);

interface Pending {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
}

export type LinkStatus = 'connecting' | 'pairing' | 'linked' | 'failed' | 'closed';

export class LinkOpRunner implements OpRunner {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private status: LinkStatus = 'connecting';

  get description(): string {
    return this.status === 'linked' ? 'On the paired PC' : this.local.description;
  }

  get linkStatus(): LinkStatus {
    return this.status;
  }

  constructor(
    private readonly url: string,
    private readonly code: string,
    private readonly deviceName: string,
    /** Where work goes when the link is down, or when sending is not worth it. */
    private readonly local: OpRunner,
    private readonly onStatus: (status: LinkStatus) => void,
  ) {
    this.connect();
  }

  private set(status: LinkStatus): void {
    this.status = status;
    this.onStatus(status);
  }

  private connect(): void {
    try {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.onopen = () => {
        this.set('pairing');
        socket.send(JSON.stringify({ type: 'pair', code: this.code, name: this.deviceName }));
      };

      socket.onmessage = (event) => this.receive(String(event.data));

      socket.onclose = () => {
        this.failAll('The link to the PC closed.');
        // 'failed' is a dead end the user must act on; a close after a good
        // pairing is just the PC going away, which is recoverable.
        if (this.status !== 'failed') this.set('closed');
      };

      socket.onerror = () => {
        this.failAll('The link to the PC could not be opened.');
        this.set('failed');
      };
    } catch {
      this.set('failed');
    }
  }

  private receive(raw: string): void {
    let message: {
      type?: string;
      ok?: boolean;
      id?: number;
      result?: unknown;
      error?: string;
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }

    if (message.type === 'paired') {
      if (message.ok) this.set('linked');
      else {
        this.set('failed');
        this.failAll('That pairing code was not accepted.');
      }
      return;
    }

    if (typeof message.id !== 'number') return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);

    if (message.ok) entry.resolve(decode(message.result) as never);
    else entry.reject(new Error(message.error ?? 'The PC could not run that.'));
  }

  private failAll(reason: string): void {
    for (const [, entry] of this.pending) entry.reject(new Error(reason));
    this.pending.clear();
  }

  async run<K extends OpName>(name: K, request: OpRequestMap[K]): Promise<OpResponseMap[K]> {
    const socket = this.socket;
    const usable = this.status === 'linked' && socket?.readyState === WebSocket.OPEN;

    // Small and frequent work stays here: a stroke has to feel immediate, and
    // a network hop in the middle of drawing would be felt directly.
    if (!usable || !WORTH_SENDING.has(name)) return this.local.run(name, request);

    const id = this.nextId++;
    try {
      return await new Promise<OpResponseMap[K]>((resolve, reject) => {
        this.pending.set(id, { resolve: resolve as (value: never) => void, reject });
        socket!.send(JSON.stringify({ type: 'op', id, name, request }));
      });
    } catch (error) {
      // A link that fails mid-job must not cost the work: do it here instead.
      console.warn(`The PC could not run "${name}"; doing it on this device.`, error);
      return this.local.run(name, request);
    }
  }

  dispose(): void {
    this.failAll('The link was closed.');
    this.socket?.close();
    this.socket = null;
    this.local.dispose?.();
  }
}

/** Rebuilds the typed arrays the host flattened for the wire. */
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const tagged = value as { __typed?: string; values?: number[] };
    if (typeof tagged.__typed === 'string' && Array.isArray(tagged.values)) {
      switch (tagged.__typed) {
        case 'Float32Array':
          return Float32Array.from(tagged.values);
        case 'Uint32Array':
          return Uint32Array.from(tagged.values);
        case 'Uint16Array':
          return Uint16Array.from(tagged.values);
        default:
          return tagged.values;
      }
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, decode(item)]),
    );
  }
  return value;
}
