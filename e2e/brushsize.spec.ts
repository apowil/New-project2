import { expect, test, type Page } from '@playwright/test';

const CANVAS = '#viewport-canvas';

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(CANVAS);
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
  await page.waitForTimeout(600);
}

const drag = async (page: Page): Promise<void> => {
  await page.mouse.move(460, 340);
  await page.mouse.down();
  await page.mouse.move(760, 440, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(350);
};

test.describe('stroke size', () => {
  test('a 0.2 mm tip can be chosen and drawn with', async ({ page }) => {
    await ready(page);

    await page.getByLabel('Stroke size').first().click();
    await page.getByRole('button', { name: /0\.2 mm/ }).click();
    await page.keyboard.press('Escape');

    const width = await page.evaluate(() => window.__wisp.store.getState().style.width);
    expect(width * 1000).toBeCloseTo(0.2, 6);

    await drag(page);
    await expect.poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size)).toBe(1);

    // The geometry has to survive a radius four thousand times smaller than
    // the scene it sits in — no NaNs, no collapse to nothing.
    const mesh = await page.evaluate(() => {
      const node = [...window.__wisp.session.document.nodes.values()][0] as {
        samples: Array<{ position: { x: number; y: number; z: number } }>;
        style: { width: number };
      };
      const finite = node.samples.every(
        (s) =>
          Number.isFinite(s.position.x) &&
          Number.isFinite(s.position.y) &&
          Number.isFinite(s.position.z),
      );
      return { finite, points: node.samples.length, width: node.style.width };
    });

    expect(mesh.finite).toBe(true);
    expect(mesh.points).toBeGreaterThan(2);
    expect(mesh.width * 1000).toBeCloseTo(0.2, 6);
  });

  test('an exact size can be typed', async ({ page }) => {
    await ready(page);
    await page.getByLabel('Stroke size').first().click();

    const field = page.getByLabel('Exact');
    await field.fill('0.35mm');
    await field.press('Enter');
    await page.waitForTimeout(300);

    const width = await page.evaluate(() => window.__wisp.store.getState().style.width);
    expect(width * 1000).toBeCloseTo(0.35, 4);
  });

  test('the slider reaches both ends of a four-order range', async ({ page }) => {
    await ready(page);
    await page.getByLabel('Stroke size').first().click();

    const slider = page.getByRole('slider', { name: 'Stroke size' });
    await slider.fill('0');
    await page.waitForTimeout(200);
    const finest = await page.evaluate(() => window.__wisp.store.getState().style.width);

    await slider.fill('1');
    await page.waitForTimeout(200);
    const broadest = await page.evaluate(() => window.__wisp.store.getState().style.width);

    expect(finest * 1000).toBeCloseTo(0.1, 4);
    expect(broadest * 1000).toBeCloseTo(500, 2);
  });

  test('a size survives a save and reload', async ({ page }) => {
    await ready(page);
    await page.getByLabel('Stroke size').first().click();
    await page.getByRole('button', { name: /0\.2 mm/ }).click();
    await page.keyboard.press('Escape');
    await drag(page);

    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
    await expect.poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size)).toBe(1);

    const stored = await page.evaluate(
      () =>
        ([...window.__wisp.session.document.nodes.values()][0] as { style: { width: number } })
          .style.width,
    );
    // A width this fine must round-trip through the file intact.
    expect(stored * 1000).toBeCloseTo(0.2, 5);
  });
});
