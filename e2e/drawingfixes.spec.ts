import { expect, test, type Page } from '@playwright/test';

const CANVAS = '#viewport-canvas';

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(CANVAS);
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
  await page.waitForTimeout(700);
}

const drag = async (page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(320);
};

/** World length of the one stroke in the document. */
const soleLength = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const node = [...window.__wisp.session.document.nodes.values()][0] as {
      samples: Array<{ position: { x: number; y: number; z: number } }>;
    };
    let total = 0;
    for (let i = 1; i < node.samples.length; i += 1) {
      const a = node.samples[i - 1]!.position;
      const b = node.samples[i]!.position;
      total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return total;
  });

test.describe('facing the sketch plane', () => {
  test('picking a fixed plane turns the camera to look at it', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: 'Front', exact: true }).click();
    // The camera eases rather than jumping.
    await page.waitForTimeout(1400);

    // The camera angle itself is not exposed, so assert the thing that
    // matters instead: a square drag on a plane viewed square-on lands square.
    await drag(page, 500, 300, 700, 500);
    const shape = await page.evaluate(() => {
      const node = [...window.__wisp.session.document.nodes.values()][0] as {
        samples: Array<{ position: { x: number; y: number; z: number } }>;
      };
      const xs = node.samples.map((s) => s.position.x);
      const ys = node.samples.map((s) => s.position.y);
      return {
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    });

    // 200 x 200 pixels of drag, so the world result must be square too. Before
    // the camera faced the plane this came out roughly three to one.
    expect(shape.height).toBeGreaterThan(shape.width * 0.85);
    expect(shape.height).toBeLessThan(shape.width * 1.15);
  });

  test('the same drag means the same size on every fixed plane', async ({ page }) => {
    const lengths: number[] = [];

    for (const plane of ['Front', 'Side', 'Ground']) {
      await ready(page);
      await page.getByRole('button', { name: plane, exact: true }).click();
      await page.waitForTimeout(1400);
      await drag(page, 520, 380, 720, 380);
      lengths.push(await soleLength(page));
    }

    // Within a couple of percent of each other, rather than the 44% spread
    // this had before the camera turned to face the plane.
    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    expect(max / min).toBeLessThan(1.03);
  });

  test('Face it is offered for fixed planes and not for a camera plane', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: 'Facing', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Face it' })).toBeDisabled();

    await page.getByRole('button', { name: 'Ground', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Face it' })).toBeEnabled();
  });
});

test.describe('working scale', () => {
  test('product scale brings the camera close enough to see fine work', async ({ page }) => {
    await ready(page);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Product' }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);

    // A 200px drag should now cover centimetres rather than metres.
    await drag(page, 520, 380, 720, 380);
    const metres = await soleLength(page);
    expect(metres).toBeLessThan(0.2);
    expect(metres).toBeGreaterThan(0.005);
  });

  test('the scale is remembered in the file', async ({ page }) => {
    await ready(page);
    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Product' }).click();
    await page.keyboard.press('Escape');

    await drag(page, 520, 380, 720, 380);
    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
    await page.waitForTimeout(900);

    expect(await page.evaluate(() => window.__wisp.store.getState().sceneScale)).toBe('product');
  });

  test('switching scale offers a stroke that suits it', async ({ page }) => {
    await ready(page);
    const before = await page.evaluate(() => window.__wisp.store.getState().style.width);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Product' }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => window.__wisp.store.getState().style.width);
    // The interior default is far too broad for millimetre work, so it moves.
    expect(after).toBeLessThan(before);
  });
});

test.describe('plane controls', () => {
  test('are available for the tools that place on the plane', async ({ page }) => {
    await ready(page);

    for (const key of ['t', 'm']) {
      await page.keyboard.press('Escape');
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
      await expect(page.getByRole('button', { name: 'Facing', exact: true })).toBeVisible();
    }
  });
});
