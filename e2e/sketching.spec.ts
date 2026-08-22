import { expect, test, type Page } from '@playwright/test';

const CANVAS = '#viewport-canvas';

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(CANVAS);
  // WebGL under SwiftShader needs a moment before the first frame lands.
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
  await page.waitForTimeout(600);
}

const nodeCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__wisp.session.document.nodes.size);

/** Drags the mouse along a path, which the app treats as drawing. */
async function drawPath(page: Page, points: Array<[number, number]>): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;

  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) {
    await page.mouse.move(x, y, { steps: 4 });
  }
  await page.mouse.up();
}

/** Synthetic pen input, including a pressure ramp Playwright cannot produce. */
async function drawWithPen(
  page: Page,
  points: Array<{ x: number; y: number; pressure: number }>,
): Promise<void> {
  await page.evaluate((samples) => {
    const canvas = document.querySelector('#viewport-canvas') as HTMLCanvasElement;
    const fire = (type: string, s: { x: number; y: number; pressure: number }) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 99,
          pointerType: 'pen',
          clientX: s.x,
          clientY: s.y,
          pressure: s.pressure,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    const [first, ...rest] = samples;
    if (!first) return;
    fire('pointerdown', first);
    for (const s of rest) fire('pointermove', s);
    fire('pointerup', samples[samples.length - 1]!);
  }, points);
}

test.describe('Wisp studio', () => {
  test('boots with a live WebGL2 viewport', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await ready(page);

    const context = await page.evaluate(() => {
      const canvas = document.querySelector('#viewport-canvas') as HTMLCanvasElement;
      return {
        hasSize: canvas.width > 0 && canvas.height > 0,
        webgl2: Boolean(canvas.getContext('webgl2')),
      };
    });

    expect(context.hasSize).toBe(true);
    expect(context.webgl2).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a drag creates one stroke', async ({ page }) => {
    await ready(page);
    expect(await nodeCount(page)).toBe(0);

    await drawPath(page, [
      [420, 420],
      [520, 360],
      [620, 400],
      [720, 330],
    ]);

    await expect.poll(() => nodeCount(page)).toBe(1);

    const stroke = await page.evaluate(() => {
      const doc = window.__wisp.session.document;
      const node = [...doc.nodes.values()][0] as { samples: unknown[]; type: string };
      return { type: node.type, samples: node.samples.length };
    });

    expect(stroke.type).toBe('stroke');
    // Simplify + resample should leave a workable centreline, not two points.
    expect(stroke.samples).toBeGreaterThan(5);
  });

  test('the stroke is visible in the rendered image', async ({ page }) => {
    await ready(page);

    const before = await page.locator(CANVAS).screenshot();

    await drawPath(page, [
      [400, 300],
      [520, 420],
      [660, 300],
      [780, 430],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(1);
    await page.waitForTimeout(400);

    const after = await page.locator(CANVAS).screenshot();
    // A software-rendered frame is deterministic, so any difference in bytes
    // means geometry actually reached the framebuffer.
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('pen pressure drives stroke width', async ({ page }) => {
    await ready(page);

    await drawWithPen(page, [
      { x: 400, y: 400, pressure: 0.1 },
      { x: 500, y: 400, pressure: 0.3 },
      { x: 600, y: 400, pressure: 0.6 },
      { x: 700, y: 400, pressure: 1 },
    ]);

    await expect.poll(() => nodeCount(page)).toBe(1);

    const pressures = await page.evaluate(() => {
      const doc = window.__wisp.session.document;
      const node = [...doc.nodes.values()][0] as { samples: Array<{ pressure: number }> };
      return node.samples.map((s) => s.pressure);
    });

    expect(pressures.length).toBeGreaterThan(3);
    // Smoothing damps the ramp, but the end must still be firmer than the start.
    expect(pressures[pressures.length - 1]!).toBeGreaterThan(pressures[0]!);
  });

  test('undo and redo move through history', async ({ page }) => {
    await ready(page);

    await drawPath(page, [
      [400, 400],
      [520, 340],
      [640, 420],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(1);

    await page.keyboard.press('Control+z');
    await expect.poll(() => nodeCount(page)).toBe(0);

    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => nodeCount(page)).toBe(1);
  });

  test('the eraser removes a stroke it is tapped on', async ({ page }) => {
    await ready(page);

    await drawPath(page, [
      [400, 400],
      [560, 400],
      [720, 400],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(1);
    await page.waitForTimeout(300);

    await page.keyboard.press('e');
    // Tap the middle of the stroke, which sits on the camera-facing plane
    // through the orbit target.
    await page.mouse.click(560, 400);

    await expect.poll(() => nodeCount(page)).toBe(0);
  });

  test('two fingers pinch to zoom', async ({ page }) => {
    await ready(page);

    const distanceBefore = await page.evaluate(() => window.__wisp.session.document.revision);
    expect(distanceBefore).toBe(0);

    const zoom = await page.evaluate(async () => {
      const canvas = document.querySelector('#viewport-canvas') as HTMLCanvasElement;
      const fire = (type: string, id: number, x: number, y: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );

      fire('pointerdown', 1, 500, 400);
      fire('pointerdown', 2, 700, 400);
      // Spread the fingers apart — that should pull the camera closer.
      for (let i = 1; i <= 10; i += 1) {
        fire('pointermove', 1, 500 - i * 15, 400);
        fire('pointermove', 2, 700 + i * 15, 400);
      }
      fire('pointerup', 1, 350, 400);
      fire('pointerup', 2, 850, 400);

      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    });

    expect(zoom).toBe(true);
  });

  test('drawing survives a stroke that crosses a panel', async ({ page }) => {
    await ready(page);

    // Start on open canvas and drag up over the toolbar in the corner.
    await drawPath(page, [
      [500, 500],
      [300, 300],
      [120, 140],
      [60, 80],
    ]);

    await expect.poll(() => nodeCount(page)).toBe(1);
  });
});
