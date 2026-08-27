import { expect, test, type Page } from '@playwright/test';

const CANVAS = '#viewport-canvas';

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(CANVAS);
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
  await page.waitForTimeout(600);
}

async function drag(page: Page, points: Array<[number, number]>): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(320);
}

/**
 * Holds the pen still on one spot for a while.
 *
 * Two of the four modes work as rates rather than displacements, so the thing
 * to test about them is precisely that nothing needs to move.
 */
async function press(page: Page, x: number, y: number, ms: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  // A stationary pointer generates no events, so the wobble is what keeps the
  // browser sending frames — it is a millimetre, far under the brush radius.
  for (let i = 0; i < ms / 50; i += 1) {
    await page.mouse.move(x + (i % 2), y);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(320);
}

const soleStroke = (page: Page) =>
  page.evaluate(() => {
    const node = [...window.__wisp.session.document.nodes.values()].find(
      (candidate) => candidate.type === 'stroke',
    ) as
      | {
          id: string;
          samples: Array<{ position: { x: number; y: number; z: number } }>;
          shape?: unknown;
        }
      | undefined;
    if (!node) return null;
    return {
      id: node.id,
      hasShape: node.shape !== undefined,
      count: node.samples.length,
      positions: node.samples.map((s) => ({ ...s.position })),
    };
  });

/** How far the two versions of a stroke differ at their furthest apart. */
function drift(
  before: Array<{ x: number; y: number; z: number }>,
  after: Array<{ x: number; y: number; z: number }>,
): number {
  let worst = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    const a = before[i]!;
    const b = after[i]!;
    worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return worst;
}

/** A long horizontal stroke across the middle of the canvas. */
async function drawBaseline(page: Page): Promise<void> {
  await drag(page, [
    [320, 400],
    [640, 400],
    [960, 400],
  ]);
  await expect.poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size)).toBe(1);
}

async function useLiquify(
  page: Page,
  settings: { mode?: string; radius?: number; strength?: number } = {},
): Promise<void> {
  await page.getByRole('button', { name: 'Reshape', exact: true }).click();
  await page.evaluate((patch) => {
    window.__wisp.store.getState().setLiquify(patch as never);
  }, settings);
}

test.describe('reshaping a stroke that is already drawn', () => {
  test('pushing bends the stroke where the brush passed and nowhere else', async ({ page }) => {
    await ready(page);
    await drawBaseline(page);

    const before = await soleStroke(page);
    expect(before).not.toBeNull();

    await useLiquify(page, { mode: 'push', radius: 0.6, strength: 1 });
    // Straight down through the middle of the line.
    await drag(page, [
      [640, 400],
      [640, 300],
    ]);

    const after = await soleStroke(page);
    expect(after).not.toBeNull();

    // The middle moved.
    expect(drift(before!.positions, after!.positions)).toBeGreaterThan(0.05);

    // The ends did not: the falloff has to stop somewhere, and the far end of
    // a stroke three metres long is well outside a 0.6 m brush.
    const firstBefore = before!.positions[0]!;
    const firstAfter = after!.positions[0]!;
    expect(Math.hypot(firstAfter.x - firstBefore.x, firstAfter.y - firstBefore.y)).toBeLessThan(
      0.001,
    );
  });

  test('the reshape is one undo step, not one per frame', async ({ page }) => {
    await ready(page);
    await drawBaseline(page);

    const before = await soleStroke(page);
    await useLiquify(page, { mode: 'push', radius: 0.6, strength: 1 });
    await drag(page, [
      [640, 400],
      [700, 330],
      [760, 300],
    ]);

    const warped = await soleStroke(page);
    expect(drift(before!.positions, warped!.positions)).toBeGreaterThan(0.05);

    // A single undo has to put the whole gesture back, however many frames it
    // took to draw — the drag is applied live but recorded once.
    await page.evaluate(() => window.__wisp.store.getState().undo());
    await page.waitForTimeout(200);

    const undone = await soleStroke(page);
    expect(drift(before!.positions, undone!.positions)).toBeLessThan(0.001);

    await page.evaluate(() => window.__wisp.store.getState().redo());
    await page.waitForTimeout(200);
    const redone = await soleStroke(page);
    expect(drift(before!.positions, redone!.positions)).toBeGreaterThan(0.05);
  });

  test('smoothing works by being held, without the pen moving', async ({ page }) => {
    await ready(page);

    // A deliberately ragged stroke, so there is a wobble to take out.
    await drag(page, [
      [400, 400],
      [460, 360],
      [520, 440],
      [580, 360],
      [640, 440],
      [700, 360],
      [760, 400],
    ]);
    await expect
      .poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size))
      .toBe(1);

    const roughness = () =>
      page.evaluate(() => {
        const node = [...window.__wisp.session.document.nodes.values()][0] as {
          samples: Array<{ position: { x: number; y: number; z: number } }>;
        };
        // Total turning: the sum of how far each sample sits off the straight
        // line between its neighbours. Smoothing has to bring this down.
        let total = 0;
        for (let i = 1; i < node.samples.length - 1; i += 1) {
          const a = node.samples[i - 1]!.position;
          const b = node.samples[i]!.position;
          const c = node.samples[i + 1]!.position;
          total += Math.hypot(
            b.x - (a.x + c.x) / 2,
            b.y - (a.y + c.y) / 2,
            b.z - (a.z + c.z) / 2,
          );
        }
        return total;
      });

    const before = await roughness();

    await useLiquify(page, { mode: 'smooth', radius: 1.2, strength: 1 });
    await press(page, 580, 400, 1200);

    expect(await roughness()).toBeLessThan(before * 0.8);
  });

  test('a shape stops claiming exact dimensions once it has been warped', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await drag(page, [
      [420, 260],
      [860, 540],
    ]);
    await expect.poll(async () => (await soleStroke(page))?.hasShape).toBe(true);

    await useLiquify(page, { mode: 'push', radius: 0.8, strength: 1 });
    await drag(page, [
      [640, 260],
      [640, 180],
    ]);

    // The rectangle is no longer a rectangle, so the numbers that described it
    // are gone rather than left behind describing something else.
    expect((await soleStroke(page))?.hasShape).toBe(false);
  });

  test('a tap that reshapes nothing leaves no undo entry behind', async ({ page }) => {
    await ready(page);
    await drawBaseline(page);

    const depth = () =>
      page.evaluate(() => window.__wisp.store.getState().canUndo);
    expect(await depth()).toBe(true);

    await page.evaluate(() => window.__wisp.store.getState().undo());
    await page.waitForTimeout(200);
    expect(await depth()).toBe(false);

    await page.evaluate(() => window.__wisp.store.getState().redo());
    await page.waitForTimeout(200);

    await useLiquify(page, { mode: 'push', radius: 0.4, strength: 1 });
    // Far above the stroke, so the brush covers nothing.
    await page.mouse.move(640, 120);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Still one entry — the stroke — and undoing it clears the history.
    await page.evaluate(() => window.__wisp.store.getState().undo());
    await page.waitForTimeout(200);
    expect(await depth()).toBe(false);
  });

  test('a selection narrows what the brush is allowed to touch', async ({ page }) => {
    await ready(page);

    await drag(page, [
      [320, 340],
      [960, 340],
    ]);
    await drag(page, [
      [320, 460],
      [960, 460],
    ]);
    await expect
      .poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size))
      .toBe(2);

    const strokes = () =>
      page.evaluate(() =>
        [...window.__wisp.session.document.nodes.values()].map((node) => ({
          id: node.id,
          positions: (node as { samples: Array<{ position: { x: number; y: number; z: number } }> })
            .samples.map((s) => ({ ...s.position })),
        })),
      );

    const before = await strokes();

    // Select the upper stroke only, then warp with a brush wide enough to
    // reach both. Without the selection rule the lower one would move too.
    await page.evaluate((id) => window.__wisp.store.getState().setSelection([id]), before[0]!.id);
    await useLiquify(page, { mode: 'push', radius: 2.5, strength: 1 });
    await drag(page, [
      [640, 340],
      [640, 250],
    ]);

    const after = await strokes();
    expect(drift(before[0]!.positions, after[0]!.positions)).toBeGreaterThan(0.05);
    expect(drift(before[1]!.positions, after[1]!.positions)).toBeLessThan(0.001);
  });

  test('a pull tightens the stroke toward the brush without shortening it', async ({ page }) => {
    await ready(page);
    await drawBaseline(page);

    const before = await soleStroke(page);

    await useLiquify(page, { mode: 'pull', radius: 0.8, strength: 1 });
    await press(page, 640, 340, 1000);

    const after = await soleStroke(page);
    expect(drift(before!.positions, after!.positions)).toBeGreaterThan(0.02);

    // Both ends stay put: a warp must never quietly trim a stroke back from
    // where it was drawn, however hard the middle is pulled.
    const ends = (positions: Array<{ x: number; y: number; z: number }>) => [
      positions[0]!,
      positions[positions.length - 1]!,
    ];
    const [firstBefore, lastBefore] = ends(before!.positions);
    const [firstAfter, lastAfter] = ends(after!.positions);
    expect(Math.hypot(firstAfter!.x - firstBefore!.x, firstAfter!.y - firstBefore!.y)).toBeLessThan(
      0.001,
    );
    expect(Math.hypot(lastAfter!.x - lastBefore!.x, lastAfter!.y - lastBefore!.y)).toBeLessThan(
      0.001,
    );
  });

  test('the warped stroke is actually re-swept into the rendered frame', async ({ page }) => {
    await ready(page);
    await drawBaseline(page);
    await page.waitForTimeout(400);

    const before = await page.locator(CANVAS).screenshot();

    await useLiquify(page, { mode: 'push', radius: 0.8, strength: 1 });
    await drag(page, [
      [640, 400],
      [640, 260],
    ]);
    await page.waitForTimeout(400);

    // Reshaping a centreline is only worth anything if the mesh follows it.
    // A software-rendered frame is deterministic, so different bytes mean the
    // tube was genuinely rebuilt rather than the samples changing in private.
    const after = await page.locator(CANVAS).screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});
