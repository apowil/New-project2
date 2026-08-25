import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The desktop app, driven for real.
 *
 * Launching Electron rather than testing its pieces in isolation is the point:
 * the things most likely to break here — the server starting before the window
 * loads, the preload bridge reaching the compute pool, a utility process
 * finding its bundled geometry library — only fail when it all runs together.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop');

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [root, '--no-sandbox', '--enable-unsafe-swiftshader'],
  });
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('desktop app', () => {
  test('opens a window with the studio in it', async () => {
    const page = await app.firstWindow();
    await page.waitForSelector('#viewport-canvas');
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');

    // Served over http, not file:// — which is what keeps the desktop window
    // and a connected tablet on the same code path.
    expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  });

  test('uses the process pool rather than a web worker', async () => {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');

    const description = await page.evaluate(
      () => (window.__wisp.session as unknown as { ops: { description: string } }).ops.description,
    );
    expect(description).toBe('On this PC');
  });

  test('runs a boolean through the compute pool', async () => {
    const page = await app.firstWindow();
    await page.waitForSelector('#viewport-canvas');
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
    await page.waitForTimeout(500);

    // Two crossing strokes, then merge them.
    for (const [x0, y0, x1, y1] of [
      [400, 300, 700, 400],
      [500, 250, 560, 460],
    ]) {
      await page.mouse.move(x0!, y0!);
      await page.mouse.down();
      await page.mouse.move(x1!, y1!, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    await expect.poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size)).toBe(2);

    await page.evaluate(() => {
      const state = window.__wisp.store.getState();
      state.setSelection([...window.__wisp.session.document.nodes.keys()]);
    });
    await page.evaluate(() => window.__wisp.store.getState().applyBoolean('union'));

    // One baked solid, computed in a separate operating-system process.
    await expect
      .poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size), {
        timeout: 30_000,
      })
      .toBe(1);

    const type = await page.evaluate(
      () => [...window.__wisp.session.document.nodes.values()][0]!.type,
    );
    expect(type).toBe('baked');
  });

  test('reports where it is serving from', async () => {
    const page = await app.firstWindow();
    const info = await page.evaluate(() =>
      (
        window as unknown as {
          wispDesktop: { hostInfo: () => Promise<{ port: number; addresses: string[] }> };
        }
      ).wispDesktop.hostInfo(),
    );

    expect(info.port).toBeGreaterThan(0);
    // Bound to loopback until host mode is switched on, so nothing is exposed
    // to the network just by opening the app.
    expect(info.addresses).toEqual([]);
  });
});
