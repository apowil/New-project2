import { expect, test, type Page } from '@playwright/test';

const CANVAS = '#viewport-canvas';

test.setTimeout(180_000);

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(CANVAS);
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
  await page.waitForTimeout(600);
}

/**
 * Draws one continuous stroke that keeps going, with interpolated moves.
 *
 * `steps` matters: without it Playwright jumps about thirty pixels per event
 * and the stroke never reaches the sample density a real digitiser produces,
 * which is exactly the density the preview budget exists for.
 */
async function drawLongStroke(page: Page, laps: number): Promise<void> {
  await page.mouse.move(200, 200);
  await page.mouse.down();
  for (let lap = 0; lap < laps; lap += 1) {
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      const x = lap % 2 === 0 ? 200 + t * 880 : 1080 - t * 880;
      await page.mouse.move(x, 220 + lap * 70 + Math.sin(t * Math.PI * 2) * 45, { steps: 20 });
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
}

const soleStroke = (page: Page) =>
  page.evaluate(() => {
    const node = [...window.__wisp.session.document.nodes.values()].find(
      (candidate) => candidate.type === 'stroke',
    ) as { samples: Array<{ position: { x: number; y: number; z: number } }> } | undefined;
    if (!node) return null;
    let length = 0;
    for (let i = 1; i < node.samples.length; i += 1) {
      const a = node.samples[i - 1]!.position;
      const b = node.samples[i]!.position;
      length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return { count: node.samples.length, length };
  });

test.describe('the live preview on a long stroke', () => {
  test('thins only what is shown — the committed stroke keeps every sample', async ({ page }) => {
    await ready(page);
    await drawLongStroke(page, 4);

    const stroke = await soleStroke(page);
    expect(stroke).not.toBeNull();

    // The preview is capped at a few hundred rings. What lands in the document
    // must be the full-resolution stroke, not the thinned view of it — the
    // thinning is a display trick and must never reach what gets saved.
    expect(stroke!.count).toBeGreaterThan(900);
  });

  test('a long stroke is still one continuous stroke, not a shortened one', async ({ page }) => {
    await ready(page);
    await drawLongStroke(page, 4);

    const stroke = await soleStroke(page);
    // Four laps across most of the canvas: the committed centreline has to
    // span a real distance rather than having been cut short by thinning.
    expect(stroke!.length).toBeGreaterThan(5);

    // And exactly one stroke — a long drag is not several.
    const nodes = await page.evaluate(() => window.__wisp.session.document.nodes.size);
    expect(nodes).toBe(1);
  });

  test('drawing stays responsive to the end of a long stroke', async ({ page }) => {
    await ready(page);

    // The stroke has to keep tracking the pen as it grows. Measured as: the
    // ink reaches the far end of the last lap, which it cannot do if the
    // preview has fallen behind far enough to drop input.
    await drawLongStroke(page, 5);

    const spread = await page.evaluate(() => {
      const node = [...window.__wisp.session.document.nodes.values()][0] as {
        samples: Array<{ position: { x: number; y: number; z: number } }>;
      };
      const ys = node.samples.map((s) => s.position.y);
      return Math.max(...ys) - Math.min(...ys);
    });

    // Five laps stepping down the canvas: the last lap has to be in there.
    expect(spread).toBeGreaterThan(1.5);
  });
  test('the stroke stays on screen while it is being committed', async ({ page }) => {
    await ready(page);

    await page.mouse.move(300, 300);
    await page.mouse.down();
    for (let i = 1; i <= 14; i += 1) {
      await page.mouse.move(300 + i * 45, 300 + Math.sin(i / 2) * 120, { steps: 12 });
    }

    // Smoothing a stroke is a round trip to a worker, and it takes a couple of
    // hundred milliseconds. The preview used to be torn down at the start of
    // that window, so the ink somebody had just drawn was missing from the
    // screen until the committed stroke arrived — a visible blink on every
    // single stroke.
    //
    // Watched by reading the canvas back, because a screenshot through the
    // harness takes longer than the window being measured. Polled on a timer
    // rather than on animation frames, and over a narrow strip rather than the
    // whole canvas: a heavy readback samples two or three times in the window
    // and can step straight over the gap it is looking for.
    await page.evaluate(() => {
      const w = window as unknown as {
        __watch?: { min: number; max: number; samples: number; done: boolean };
      };
      const canvas = document.querySelector('#viewport-canvas') as HTMLCanvasElement;
      const scratch = document.createElement('canvas');
      scratch.width = 32;
      scratch.height = 32;
      const ctx = scratch.getContext('2d', { willReadFrequently: true })!;

      // A tall, narrow strip the stroke has to cross, well away from any panel.
      const ratio = canvas.width / canvas.clientWidth;
      const region = [560 * ratio, 200 * ratio, 120 * ratio, 260 * ratio] as const;

      const inkNow = (): number => {
        ctx.drawImage(canvas, ...region, 0, 0, scratch.width, scratch.height);
        const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
        // A corner pixel the stroke never reaches stands in for the background.
        const [br, bg, bb] = [data[0]!, data[1]!, data[2]!];
        let ink = 0;
        for (let i = 0; i < data.length; i += 4) {
          const delta =
            Math.abs(data[i]! - br) + Math.abs(data[i + 1]! - bg) + Math.abs(data[i + 2]! - bb);
          if (delta > 24) ink += 1;
        }
        return ink;
      };

      const state = { min: Number.POSITIVE_INFINITY, max: 0, samples: 0, done: false };
      w.__watch = state;

      const look = (): void => {
        const ink = inkNow();
        state.samples += 1;
        if (ink < state.min) state.min = ink;
        if (ink > state.max) state.max = ink;
        if (window.__wisp.session.document.nodes.size > 0) {
          state.done = true;
          return;
        }
        setTimeout(look, 0);
      };
      look();
    });

    await page.mouse.up();
    await page.waitForFunction(
      () => (window as unknown as { __watch: { done: boolean } }).__watch.done,
      null,
      { timeout: 20_000 },
    );

    const watch = await page.evaluate(
      () => (window as unknown as { __watch: { min: number; max: number; samples: number } }).__watch,
    );
    console.log(`      ink during commit: least ${watch.min}, most ${watch.max}, ${watch.samples} samples`);

    // Enough samples for the answer to mean something.
    expect(watch.samples).toBeGreaterThan(4);
    // There has to be ink there to have measured anything at all.
    expect(watch.max).toBeGreaterThan(5);
    // And it must never have gone away. Before the fix this read zero.
    expect(watch.min).toBeGreaterThan(0);
  });

  test('a stroke started before the last one commits keeps its own preview', async ({ page }) => {
    await ready(page);

    // The commit is asynchronous, so a second stroke can begin while the first
    // is still in flight. When the first one finishes it must not pull down
    // the preview that now belongs to the second.
    await page.mouse.move(300, 250);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(300 + i * 60, 250, { steps: 10 });
    await page.mouse.up();

    // No wait: straight into the next stroke, inside the commit window.
    await page.mouse.move(300, 500);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(300 + i * 60, 500, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size), {
      timeout: 20_000,
    }).toBe(2);

    // Both are real strokes, neither truncated by the other's commit.
    const counts = await page.evaluate(() =>
      [...window.__wisp.session.document.nodes.values()].map(
        (n) => (n as { samples: unknown[] }).samples.length,
      ),
    );
    expect(Math.min(...counts)).toBeGreaterThan(50);
  });
});
