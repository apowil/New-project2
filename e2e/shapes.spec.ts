import { expect, test, type Page } from '@playwright/test';

const CANVAS = '#viewport-canvas';

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(CANVAS);
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
  await page.waitForTimeout(600);
}

const nodeCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__wisp.session.document.nodes.size);

async function drag(page: Page, points: Array<[number, number]>): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(320);
}

/** The shape parameters stored on the one and only node. */
const soleShape = (page: Page) =>
  page.evaluate(() => {
    const node = [...window.__wisp.session.document.nodes.values()][0] as {
      shape?: { params: Record<string, unknown> };
    };
    return node?.shape?.params ?? null;
  });

test.describe('units', () => {
  test('switching unit changes every readout', async ({ page }) => {
    await ready(page);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'cm', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('6 cm')).toBeVisible();

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'mm', exact: true }).click();
    await page.keyboard.press('Escape');

    // The same 6 cm brush, now in millimetres.
    await expect(page.getByText('60 mm')).toBeVisible();
  });

  test('the unit choice survives a reload', async ({ page }) => {
    await ready(page);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'in', exact: true }).click();
    await page.keyboard.press('Escape');

    await page.reload();
    await ready(page);
    expect(await page.evaluate(() => window.__wisp.store.getState().unit)).toBe('in');
  });

  test('geometry is untouched by a unit change', async ({ page }) => {
    await ready(page);
    await drag(page, [
      [420, 300],
      [620, 400],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(1);

    const widthBefore = await page.evaluate(() => window.__wisp.store.getState().style.width);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'ft', exact: true }).click();
    await page.keyboard.press('Escape');

    // Units are presentation only; the stored metres must not move.
    expect(await page.evaluate(() => window.__wisp.store.getState().style.width)).toBe(
      widthBefore,
    );
  });
});

test.describe('shape tools', () => {
  test('a dragged rectangle keeps its parameters', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');

    await drag(page, [
      [320, 260],
      [600, 440],
    ]);

    await expect.poll(() => nodeCount(page)).toBe(1);
    const shape = await soleShape(page);
    expect(shape?.kind).toBe('rectangle');
    expect(Math.abs(Number(shape?.width))).toBeGreaterThan(0);
    expect(Math.abs(Number(shape?.height))).toBeGreaterThan(0);
  });

  test('a circle is round', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');
    await page.getByRole('button', { name: 'Circle' }).click();

    await drag(page, [
      [640, 400],
      [780, 400],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(1);

    const spread = await page.evaluate(() => {
      const node = [...window.__wisp.session.document.nodes.values()][0] as {
        samples: Array<{ position: { x: number; y: number; z: number } }>;
      };
      // The outline closes by repeating its first point. Averaging that
      // duplicate in would pull the estimated centre off by about one part in
      // ninety-seven, which is enough to fake a 2% radius spread.
      const points = node.samples.slice(0, -1).map((s) => s.position);
      const centre = points.reduce(
        (a, p) => ({
          x: a.x + p.x / points.length,
          y: a.y + p.y / points.length,
          z: a.z + p.z / points.length,
        }),
        { x: 0, y: 0, z: 0 },
      );
      const radii = points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z));
      return { min: Math.min(...radii), max: Math.max(...radii) };
    });

    // Every point the same distance from the centre, within rounding.
    expect(spread.max - spread.min).toBeLessThan(spread.max * 0.02);
  });

  test('a polygon uses the chosen number of sides', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');
    await page.getByRole('button', { name: 'Polygon' }).click();

    await page.getByLabel('Polygon sides').fill('5');
    await drag(page, [
      [640, 400],
      [760, 340],
    ]);

    await expect.poll(() => nodeCount(page)).toBe(1);
    const shape = await soleShape(page);
    expect(shape?.sides).toBe(5);

    // Five corners plus the repeat that closes it.
    const samples = await page.evaluate(
      () =>
        ([...window.__wisp.session.document.nodes.values()][0] as { samples: unknown[] }).samples
          .length,
    );
    expect(samples).toBe(6);
  });

  test('a polyline takes several taps and finishes on Enter', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');
    await page.getByRole('button', { name: 'Polyline' }).click();

    await page.mouse.click(360, 560);
    await page.mouse.click(520, 640);
    await page.mouse.click(680, 560);
    // Still open — nothing committed yet.
    expect(await nodeCount(page)).toBe(0);

    await page.keyboard.press('Enter');
    await expect.poll(() => nodeCount(page)).toBe(1);

    const shape = await soleShape(page);
    expect(shape?.kind).toBe('polyline');
    expect((shape?.points as unknown[]).length).toBe(3);
  });

  test('a spline curves through more points than it was given', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');
    await page.getByRole('button', { name: 'Spline' }).click();

    await page.mouse.click(360, 500);
    await page.mouse.click(520, 380);
    await page.mouse.click(680, 520);
    await page.keyboard.press('Enter');

    await expect.poll(() => nodeCount(page)).toBe(1);
    const samples = await page.evaluate(
      () =>
        ([...window.__wisp.session.document.nodes.values()][0] as { samples: unknown[] }).samples
          .length,
    );
    expect(samples).toBeGreaterThan(20);
  });

  test('a live measurement appears while dragging', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');

    await page.mouse.move(360, 300);
    await page.mouse.down();
    await page.mouse.move(600, 460, { steps: 8 });

    await expect(page.getByText('Width')).toBeVisible();
    await expect(page.getByText('Height')).toBeVisible();

    await page.mouse.up();
  });

  test('a shape can be resized by typing an exact size', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');
    await drag(page, [
      [320, 260],
      [600, 440],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(1);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'cm', exact: true }).click();
    await page.keyboard.press('Escape');

    await page.keyboard.press('s');
    await page.mouse.click(320, 260);
    await expect.poll(() => page.evaluate(() => window.__wisp.store.getState().selection.length)).toBe(1);

    await page.getByRole('button', { name: 'Size' }).click();
    const widthField = page.getByLabel('Width');
    await widthField.fill('40');
    await widthField.press('Enter');
    await page.waitForTimeout(400);

    const shape = await soleShape(page);
    // 40 cm, stored as metres.
    expect(Math.abs(Number(shape?.width))).toBeCloseTo(0.4, 3);
  });
});

test.describe('text', () => {
  test('places text as a single object', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('t');
    await page.mouse.click(560, 420);

    await page.getByLabel('Text to add').fill('HELLO');
    await page.getByRole('button', { name: 'Place', exact: true }).click();

    await expect.poll(() => nodeCount(page)).toBe(1);
    const node = await page.evaluate(() => {
      const n = [...window.__wisp.session.document.nodes.values()][0] as {
        type: string;
        label?: string;
        indices: Uint32Array;
      };
      return { type: n.type, label: n.label, triangles: n.indices.length / 3 };
    });

    expect(node.type).toBe('baked');
    expect(node.label).toContain('HELLO');
    expect(node.triangles).toBeGreaterThan(100);
  });

  test('empty text places nothing', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('t');
    await page.mouse.click(560, 420);

    await page.getByLabel('Text to add').fill('   ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    expect(await nodeCount(page)).toBe(0);
  });

  test('Escape abandons the prompt', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('t');
    await page.mouse.click(560, 420);
    await expect(page.getByLabel('Text to add')).toBeVisible();

    await page.getByLabel('Text to add').press('Escape');
    await expect(page.getByLabel('Text to add')).toBeHidden();
    expect(await nodeCount(page)).toBe(0);
  });

  test('text survives a save and reload', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('t');
    await page.mouse.click(560, 420);
    await page.getByLabel('Text to add').fill('SAVED');
    await page.getByRole('button', { name: 'Place', exact: true }).click();

    await expect.poll(() => nodeCount(page)).toBe(1);
    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
    await expect.poll(() => nodeCount(page)).toBe(1);
  });
});

test.describe('image export', () => {
  for (const format of ['png', 'jpg', 'svg'] as const) {
    test(`exports ${format}`, async ({ page }) => {
      await ready(page);
      await drag(page, [
        [420, 320],
        [620, 420],
      ]);
      await expect.poll(() => nodeCount(page)).toBe(1);

      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((chosen) => window.__wisp.store.getState().exportImage(chosen), format);
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toBe(`Untitled sketch.${format}`);
    });
  }

  test('the SVG is real vector output, not a wrapped bitmap', async ({ page }) => {
    await ready(page);
    await drag(page, [
      [420, 320],
      [620, 420],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(1);

    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => window.__wisp.store.getState().exportImage('svg'));
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');

    expect(text).toContain('<svg');
    // Real geometry, rather than a PNG smuggled inside an <image> tag.
    expect(text).toMatch(/<path|<polygon/);
    expect(text).not.toContain('data:image/png');
  });
});
