import { randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

import { type OpName, type OpRequestMap } from '@wisp/core';

import { type ComputePool } from './computePool.js';
import { lanAddresses, startStaticHost, type StaticHost } from './server.js';

/**
 * Serving the studio to other devices, and doing their heavy work.
 *
 * Two things happen here that are easy to conflate. Serving the app means a
 * tablet can *load* it without installing anything; offloading means the
 * tablet sends the expensive jobs here and gets meshes back. Only the second
 * makes anything faster — a page served from this machine still runs entirely
 * on the tablet's own processor unless it asks.
 */

/** Only these operations may be run by a connected device. */
const ALLOWED: ReadonlySet<string> = new Set<OpName>([
  'buildStroke',
  'processStroke',
  'evaluateBoolean',
]);

export interface HostState {
  running: boolean;
  port: number;
  addresses: string[];
  /** Six digits, shown on the host and typed once per device. */
  pairingCode: string | null;
  devices: Array<{ id: string; name: string; jobs: number }>;
}

interface Device {
  id: string;
  name: string;
  socket: WebSocket;
  paired: boolean;
  jobs: number;
}

/**
 * A short numeric code, entered once per device.
 *
 * The server has to listen on every interface to be reachable at all, so on a
 * shared network anyone could otherwise open somebody's sketches and send work
 * to their laptop. Six digits is not cryptography; it is the difference
 * between "deliberate" and "wandered in".
 */
const makeCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

export class Host {
  private http: StaticHost | null = null;
  private sockets: WebSocketServer | null = null;
  private readonly devices = new Map<string, Device>();
  private code: string | null = null;
  private nextDevice = 1;

  constructor(
    private readonly studioRoot: string,
    private readonly pool: ComputePool,
    private readonly onChange: () => void,
  ) {}

  get state(): HostState {
    return {
      running: this.http !== null,
      port: this.http?.port ?? 0,
      addresses: this.http ? lanAddresses() : [],
      pairingCode: this.code,
      devices: [...this.devices.values()]
        .filter((device) => device.paired)
        .map(({ id, name, jobs }) => ({ id, name, jobs })),
    };
  }

  async start(port = 7823): Promise<HostState> {
    if (this.http) return this.state;

    this.code = makeCode();
    this.http = await startStaticHost({ root: this.studioRoot, port, host: '0.0.0.0' });

    this.sockets = new WebSocketServer({ server: this.http.server, path: '/link' });
    this.sockets.on('connection', (socket) => this.accept(socket));

    this.onChange();
    return this.state;
  }

  async stop(): Promise<HostState> {
    for (const device of this.devices.values()) device.socket.close();
    this.devices.clear();

    this.sockets?.close();
    this.sockets = null;

    await this.http?.close();
    this.http = null;
    this.code = null;

    this.onChange();
    return this.state;
  }

  private accept(socket: WebSocket): void {
    const device: Device = {
      id: `device_${this.nextDevice++}`,
      name: 'Tablet',
      socket,
      paired: false,
      jobs: 0,
    };
    this.devices.set(device.id, device);

    socket.on('message', (raw) => void this.handle(device, raw.toString()));
    socket.on('close', () => {
      this.devices.delete(device.id);
      this.onChange();
    });
    // A socket error that reaches the process would take the whole app down.
    socket.on('error', () => socket.close());

    socket.send(JSON.stringify({ type: 'hello', needsPairing: true }));
  }

  private async handle(device: Device, raw: string): Promise<void> {
    let message: { type?: string; id?: number; name?: string; code?: string; request?: unknown };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }

    if (message.type === 'pair') {
      const ok = message.code === this.code;
      device.paired = ok;
      if (typeof message.name === 'string' && message.name.trim()) {
        device.name = message.name.trim().slice(0, 40);
      }
      device.socket.send(JSON.stringify({ type: 'paired', ok }));
      this.onChange();
      return;
    }

    if (message.type !== 'op' || typeof message.id !== 'number') return;

    // Unpaired devices can load the app but cannot spend this machine's CPU.
    if (!device.paired) {
      device.socket.send(
        JSON.stringify({ id: message.id, ok: false, error: 'This device is not paired.' }),
      );
      return;
    }

    const name = message.name;
    if (typeof name !== 'string' || !ALLOWED.has(name)) {
      device.socket.send(
        JSON.stringify({ id: message.id, ok: false, error: `Unknown operation "${name}".` }),
      );
      return;
    }

    device.jobs += 1;
    this.onChange();

    try {
      const result = await this.pool.run(
        name as OpName,
        message.request as OpRequestMap[OpName],
      );
      device.socket.send(JSON.stringify({ id: message.id, ok: true, result: encode(result) }));
    } catch (error) {
      device.socket.send(
        JSON.stringify({
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      device.jobs -= 1;
      this.onChange();
    }
  }
}

/**
 * Prepares a result for the wire.
 *
 * Typed arrays do not survive `JSON.stringify` — they come out as objects
 * keyed by index, which is both enormous and wrong. Each one becomes a plain
 * array tagged with its kind so the other end can rebuild it.
 */
function encode(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    return {
      __typed: value.constructor.name,
      values: Array.from(value as unknown as ArrayLike<number>),
    };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encode(item)]),
    );
  }
  return value;
}
