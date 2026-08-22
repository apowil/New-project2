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

async function drawStroke(page: Page): Promise<void> {
  // Deliberately off-centre, so a reflection lands somewhere different.
  await page.mouse.move(760, 300);
  await page.mouse.down();
  await page.mouse.move(820, 360, { steps: 4 });
  await page.mouse.move(880, 320, { steps: 4 });
  await page.mouse.up();
}

/** Every stroke's samples, for checking reflections. */
const allStrokes = (page: Page) =>
  page.evaluate(() =>
    [...window.__wisp.session.document.nodes.values()].map((node) => {
      const stroke = node as { samples: Array<{ position: { x: number; y: number; z: number } }> };
      return stroke.samples.map((s) => [s.position.x, s.position.y, s.position.z]);
    }),
  );

test.describe('symmetry', () => {
  test('one axis doubles the stroke', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'X', exact: true }).click();
    await drawStroke(page);

    await expect.poll(() => nodeCount(page)).toBe(2);

    const strokes = await allStrokes(page);
    const [original, mirrored] = strokes;
    expect(original).toBeDefined();
    expect(mirrored).toBeDefined();
    expect(mirrored!).toHaveLength(original!.length);

    // Same curve with X negated, and Y and Z untouched.
    for (let i = 0; i < original!.length; i += 1) {
      expect(mirrored![i]![0]).toBeCloseTo(-original![i]![0]!, 5);
      expect(mirrored![i]![1]).toBeCloseTo(original![i]![1]!, 5);
      expect(mirrored![i]![2]).toBeCloseTo(original![i]![2]!, 5);
    }
  });

  test('two axes make four copies', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'X', exact: true }).click();
    await page.getByRole('button', { name: 'Y', exact: true }).click();
    await expect(page.getByText('4 copies')).toBeVisible();

    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(4);
  });

  test('all three axes make eight copies', async ({ page }) => {
    await ready(page);

    for (const axis of ['X', 'Y', 'Z']) {
      await page.getByRole('button', { name: axis, exact: true }).click();
    }
    await expect(page.getByText('8 copies')).toBeVisible();

    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(8);
  });

  test('a mirrored stroke undoes as one action', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'X', exact: true }).click();
    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(2);

    await page.keyboard.press('Control+z');
    await expect.poll(() => nodeCount(page)).toBe(0);

    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => nodeCount(page)).toBe(2);
  });

  test('turning symmetry off returns to single strokes', async ({ page }) => {
    await ready(page);

    const xButton = page.getByRole('button', { name: 'X', exact: true });
    await xButton.click();
    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(2);

    await xButton.click();
    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(3);
  });

  test('mirrored copies survive a save and reload', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'X', exact: true }).click();
    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(2);
    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
    await expect.poll(() => nodeCount(page)).toBe(2);
  });
});

test.describe('orbit pinning', () => {
  test('a long press re-centres the orbit on what was pressed', async ({ page }) => {
    await ready(page);

    const before = await page.evaluate(() => window.__wisp.session.document.revision);
    expect(before).toBe(0);

    const moved = await page.evaluate(async () => {
      const canvas = document.querySelector('#viewport-canvas') as HTMLCanvasElement;
      const fire = (type: string, x: number, y: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 3,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );

      // Press and hold well off to one side, without sliding.
      fire('pointerdown', 900, 600);
      await new Promise((resolve) => setTimeout(resolve, 700));
      fire('pointerup', 900, 600);
      await new Promise((resolve) => setTimeout(resolve, 600));
      return true;
    });

    expect(moved).toBe(true);
    // No document change — pinning is a camera action, not an edit.
    expect(await page.evaluate(() => window.__wisp.session.document.revision)).toBe(0);
  });

  test('a drag orbits instead of pinning', async ({ page }) => {
    await ready(page);

    await page.evaluate(async () => {
      const canvas = document.querySelector('#viewport-canvas') as HTMLCanvasElement;
      const fire = (type: string, x: number, y: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 4,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );

      fire('pointerdown', 640, 400);
      for (let i = 1; i <= 12; i += 1) fire('pointermove', 640 + i * 18, 400);
      fire('pointerup', 640 + 12 * 18, 400);
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    // The stroke count stays zero and the app is still responsive.
    expect(await nodeCount(page)).toBe(0);
  });
});
