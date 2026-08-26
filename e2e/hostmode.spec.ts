import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

/**
 * Host mode, exercised over the wire a tablet would use.
 *
 * The interesting parts of this feature are not in the UI. They are the rules
 * about who is allowed to spend this machine's processor, and those rules only
 * mean anything if they hold against a raw socket rather than against the
 * app's own client. So the tests here open a WebSocket by hand and behave like
 * a device that has not read the protocol.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop');

interface HostState {
  running: boolean;
  port: number;
  addresses: string[];
  pairingCode: string | null;
  devices: Array<{ id: string; name: string; jobs: number }>;
}

interface DesktopBridge {
  hostState: () => Promise<HostState | null>;
  startHost: () => Promise<HostState>;
  stopHost: () => Promise<HostState>;
}

const bridge = (page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) => ({
  state: () =>
    page.evaluate(() => (window as unknown as { wispDesktop: DesktopBridge }).wispDesktop.hostState()),
  start: () =>
    page.evaluate(() => (window as unknown as { wispDesktop: DesktopBridge }).wispDesktop.startHost()),
  stop: () =>
    page.evaluate(() => (window as unknown as { wispDesktop: DesktopBridge }).wispDesktop.stopHost()),
});

/** A device on the network, spoken to directly. */
class FakeTablet {
  private readonly socket: WebSocket;
  private readonly waiting = new Map<string | number, (message: Record<string, unknown>) => void>();
  private readonly seen: Array<Record<string, unknown>> = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      this.seen.push(message);
      const key = (message.id as number | undefined) ?? (message.type as string);
      this.waiting.get(key)?.(message);
      this.waiting.delete(key);
    });
  }

  static connect(port: number): Promise<FakeTablet> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/link`);
      socket.once('open', () => resolve(new FakeTablet(socket)));
      socket.once('error', reject);
    });
  }

  private expect(key: string | number): Promise<Record<string, unknown>> {
    const already = this.seen.find(
      (message) => ((message.id as number | undefined) ?? (message.type as string)) === key,
    );
    if (already) return Promise.resolve(already);
    return new Promise((resolve) => this.waiting.set(key, resolve));
  }

  async pair(code: string, name = 'Test tablet'): Promise<boolean> {
    this.socket.send(JSON.stringify({ type: 'pair', code, name }));
    const reply = await this.expect('paired');
    return reply.ok === true;
  }

  async op(id: number, name: string, request: unknown): Promise<Record<string, unknown>> {
    this.socket.send(JSON.stringify({ type: 'op', id, name, request }));
    return this.expect(id);
  }

  close(): void {
    this.socket.close();
  }
}

const STROKE = {
  samples: [
    { position: { x: 0, y: 0, z: 0 }, pressure: 0.5 },
    { position: { x: 0.1, y: 0, z: 0 }, pressure: 0.5 },
    { position: { x: 0.2, y: 0.05, z: 0 }, pressure: 0.5 },
  ],
  simplifyTolerance: 0.001,
  spacing: 0.005,
  smoothing: 0.5,
};

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({ args: [root, '--no-sandbox', '--enable-unsafe-swiftshader'] });
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('host mode', () => {
  test('is off until it is switched on', async () => {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');

    const state = await bridge(page).state();
    expect(state?.running).toBe(false);
    // Nothing is reachable from the network merely because the app is open.
    expect(state?.addresses).toEqual([]);
    expect(state?.pairingCode).toBeNull();
  });

  test('the settings panel offers it, and turning it on shows a code', async () => {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Settings' }).click();

    const panel = page.getByRole('dialog', { name: 'Settings' });
    await expect(panel.getByText('Share with tablets')).toBeVisible();

    const toggle = panel.getByRole('button', { name: 'Off' });
    await toggle.click();
    await expect(panel.getByRole('button', { name: 'On' })).toBeVisible();

    const state = await bridge(page).state();
    expect(state?.running).toBe(true);
    expect(state?.port).toBeGreaterThan(0);
    expect(state?.pairingCode).toMatch(/^\d{6}$/);

    await page.keyboard.press('Escape');
  });

  test('serves the studio to anything that asks', async () => {
    const page = await app.firstWindow();
    const state = await bridge(page).state();

    const response = await fetch(`http://127.0.0.1:${state!.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Wisp');
  });

  test('refuses to work for a device that has not paired', async () => {
    const page = await app.firstWindow();
    const state = await bridge(page).state();

    const tablet = await FakeTablet.connect(state!.port);
    const reply = await tablet.op(1, 'processStroke', STROKE);

    expect(reply.ok).toBe(false);
    expect(String(reply.error)).toContain('not paired');
    tablet.close();
  });

  test('refuses the wrong pairing code', async () => {
    const page = await app.firstWindow();
    const state = await bridge(page).state();

    const wrong = String((Number(state!.pairingCode) + 1) % 1_000_000).padStart(6, '0');
    const tablet = await FakeTablet.connect(state!.port);

    expect(await tablet.pair(wrong)).toBe(false);
    const reply = await tablet.op(1, 'processStroke', STROKE);
    expect(reply.ok).toBe(false);
    tablet.close();
  });

  test('runs work for a paired device, and lists it', async () => {
    const page = await app.firstWindow();
    const state = await bridge(page).state();

    const tablet = await FakeTablet.connect(state!.port);
    expect(await tablet.pair(state!.pairingCode!, 'Studio tablet')).toBe(true);

    const reply = await tablet.op(7, 'processStroke', STROKE);
    expect(reply.ok).toBe(true);

    const result = reply.result as { samples: unknown[] };
    expect(Array.isArray(result.samples)).toBe(true);
    expect(result.samples.length).toBeGreaterThan(0);

    // The panel names it, so somebody can see who is spending their machine.
    await expect
      .poll(async () => (await bridge(page).state())?.devices.map((device) => device.name))
      .toEqual(['Studio tablet']);

    tablet.close();
    await expect.poll(async () => (await bridge(page).state())?.devices.length).toBe(0);
  });

  test('refuses operations that are not on the list', async () => {
    const page = await app.firstWindow();
    const state = await bridge(page).state();

    const tablet = await FakeTablet.connect(state!.port);
    expect(await tablet.pair(state!.pairingCode!)).toBe(true);

    const reply = await tablet.op(1, 'readFile', { path: '/etc/passwd' });
    expect(reply.ok).toBe(false);
    expect(String(reply.error)).toContain('Unknown operation');
    tablet.close();
  });

  test('will not serve a path outside the studio build', async () => {
    const page = await app.firstWindow();
    const state = await bridge(page).state();

    // Percent-encoded so the traversal survives the client and arrives intact.
    const response = await fetch(`http://127.0.0.1:${state!.port}/%2e%2e%2f%2e%2e%2fpackage.json`);
    const body = await response.text();

    // Either refused outright or answered with the app's own page — what must
    // never happen is a file from the machine coming back.
    expect([200, 403]).toContain(response.status);
    expect(body).not.toContain('"workspaces"');
  });

  test('switching it off closes the door', async () => {
    const page = await app.firstWindow();
    const port = (await bridge(page).state())!.port;

    const after = await bridge(page).stop();
    expect(after.running).toBe(false);
    expect(after.pairingCode).toBeNull();

    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
