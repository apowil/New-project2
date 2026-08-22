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

const selectionCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__wisp.store.getState().selection.length);

async function drag(page: Page, points: Array<[number, number]>): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(320);
}

/** Two fat crossing strokes, so booleans have real overlap to work with. */
async function drawCrossingPair(page: Page): Promise<void> {
  await page.evaluate(() => window.__wisp.store.getState().setStyle({ width: 0.25 }));
  await drag(page, [
    [420, 300],
    [640, 400],
    [860, 300],
  ]);
  await drag(page, [
    [640, 200],
    [640, 400],
    [640, 560],
  ]);
  await expect.poll(() => nodeCount(page)).toBe(2);
}

/** Axis-aligned size of the baked result, used to tell operations apart. */
const bakedExtent = (page: Page) =>
  page.evaluate(() => {
    const node = [...window.__wisp.session.document.nodes.values()].find(
      (candidate) => candidate.type === 'baked',
    ) as { positions: Float32Array } | undefined;
    if (!node) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < node.positions.length; i += 3) {
      minX = Math.min(minX, node.positions[i]!);
      maxX = Math.max(maxX, node.positions[i]!);
      minY = Math.min(minY, node.positions[i + 1]!);
      maxY = Math.max(maxY, node.positions[i + 1]!);
    }
    return { width: maxX - minX, height: maxY - minY };
  });

/** Enclosed volume of the baked result, via the divergence theorem. */
const bakedVolume = (page: Page) =>
  page.evaluate(() => {
    const node = [...window.__wisp.session.document.nodes.values()].find(
      (candidate) => candidate.type === 'baked',
    ) as { positions: Float32Array; indices: Uint32Array } | undefined;
    if (!node) return 0;

    const { positions, indices } = node;
    let volume = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]! * 3;
      const b = indices[i + 1]! * 3;
      const c = indices[i + 2]! * 3;
      const ax = positions[a]!, ay = positions[a + 1]!, az = positions[a + 2]!;
      const bx = positions[b]!, by = positions[b + 1]!, bz = positions[b + 2]!;
      const cx = positions[c]!, cy = positions[c + 1]!, cz = positions[c + 2]!;
      volume +=
        (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    return volume;
  });

const runOp = async (page: Page, op: string): Promise<void> => {
  await page.evaluate(() =>
    window.__wisp.store
      .getState()
      .setSelection([...window.__wisp.session.document.nodes.keys()]),
  );
  await page.evaluate((chosen) => window.__wisp.store.getState().applyBoolean(chosen), op);
  await page.waitForTimeout(2500);
};

test.describe('selection', () => {
  test('tapping a stroke selects it, tapping again clears', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.keyboard.press('s');
    await page.mouse.click(640, 500);
    await expect.poll(() => selectionCount(page)).toBe(1);

    await page.mouse.click(640, 500);
    await expect.poll(() => selectionCount(page)).toBe(0);
  });

  test('dragging a box selects everything inside it', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.keyboard.press('s');
    await drag(page, [
      [200, 120],
      [1100, 680],
    ]);

    await expect.poll(() => selectionCount(page)).toBe(2);
  });

  test('Escape clears the selection', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.keyboard.press('s');
    await drag(page, [
      [200, 120],
      [1100, 680],
    ]);
    await expect.poll(() => selectionCount(page)).toBe(2);

    await page.keyboard.press('Escape');
    await expect.poll(() => selectionCount(page)).toBe(0);
  });

  test('the selection panel only appears with a selection', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);
    await expect(page.getByText('2 selected')).toBeHidden();

    await page.keyboard.press('s');
    await drag(page, [
      [200, 120],
      [1100, 680],
    ]);
    await expect(page.getByText('2 selected')).toBeVisible();
  });
});

test.describe('boolean operations', () => {
  test('merge replaces the inputs with a single solid', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await runOp(page, 'union');

    await expect.poll(() => nodeCount(page)).toBe(1);
    const types = await page.evaluate(() =>
      [...window.__wisp.session.document.nodes.values()].map((node) => node.type),
    );
    expect(types).toEqual(['baked']);
  });

  test('merge fuses the overlap that combine double-counts', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await runOp(page, 'join');
    const joined = await bakedVolume(page);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
    await expect.poll(() => nodeCount(page)).toBe(2);

    await runOp(page, 'union');
    const merged = await bakedVolume(page);

    // Triangle count is not the measure here: a real union retriangulates
    // along the intersection curve and can end up with *more* triangles than
    // a plain concatenation. Volume is what actually distinguishes them —
    // combine stacks two solids and counts the overlap twice, while merge
    // fuses them and counts it once.
    expect(joined).toBeGreaterThan(0);
    expect(merged).toBeGreaterThan(0);
    expect(merged).toBeLessThan(joined);
  });

  test('intersect keeps only the shared volume', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await runOp(page, 'union');
    const unionSize = await bakedExtent(page);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);

    await runOp(page, 'intersect');
    const intersectSize = await bakedExtent(page);

    expect(unionSize).not.toBeNull();
    expect(intersectSize).not.toBeNull();
    // The crossing region is far smaller than the union of both strokes.
    expect(intersectSize!.width).toBeLessThan(unionSize!.width * 0.5);
  });

  test('a boolean is one undo step', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await runOp(page, 'subtract');
    await expect.poll(() => nodeCount(page)).toBe(1);

    await page.keyboard.press('Control+z');
    await expect.poll(() => nodeCount(page)).toBe(2);

    const types = await page.evaluate(() =>
      [...window.__wisp.session.document.nodes.values()].map((node) => node.type),
    );
    expect(types).toEqual(['stroke', 'stroke']);
  });

  test('a boolean result survives a save and reload', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);
    await runOp(page, 'union');

    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
    await page.waitForTimeout(800);

    await expect.poll(() => nodeCount(page)).toBe(1);
    const restored = await page.evaluate(() => {
      const node = [...window.__wisp.session.document.nodes.values()][0] as {
        type: string;
        indices: Uint32Array;
      };
      return { type: node.type, indexCount: node.indices.length };
    });

    expect(restored.type).toBe('baked');
    expect(restored.indexCount).toBeGreaterThan(0);
  });

  test('booleans need two items', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.keyboard.press('s');
    await page.mouse.click(640, 500);
    await expect.poll(() => selectionCount(page)).toBe(1);

    await expect(page.getByRole('button', { name: 'Merge', exact: true })).toBeDisabled();
  });
});

test.describe('copy and paste between layers', () => {
  test('copies selected strokes into another layer', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.keyboard.press('s');
    await drag(page, [
      [200, 120],
      [1100, 680],
    ]);
    await expect.poll(() => selectionCount(page)).toBe(2);

    await page.keyboard.press('Control+c');
    await page.getByLabel('Add layer').click();
    await page.keyboard.press('Control+v');

    await expect.poll(() => nodeCount(page)).toBe(4);

    // The pasted pair belongs to the new layer, and the originals did not move.
    const perLayer = await page.evaluate(() => {
      const doc = window.__wisp.session.document;
      const counts: Record<string, number> = {};
      for (const node of doc.nodes.values()) {
        counts[node.layerId] = (counts[node.layerId] ?? 0) + 1;
      }
      return Object.values(counts).sort();
    });
    expect(perLayer).toEqual([2, 2]);
  });

  test('pasting twice makes two independent copies', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.keyboard.press('s');
    await drag(page, [
      [200, 120],
      [1100, 680],
    ]);

    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Control+v');

    await expect.poll(() => nodeCount(page)).toBe(6);

    const ids = await page.evaluate(() => [...window.__wisp.session.document.nodes.keys()]);
    expect(new Set(ids).size).toBe(6);
  });

  test('cut removes the originals', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.keyboard.press('s');
    await drag(page, [
      [200, 120],
      [1100, 680],
    ]);

    await page.keyboard.press('Control+x');
    await expect.poll(() => nodeCount(page)).toBe(0);

    await page.keyboard.press('Control+v');
    await expect.poll(() => nodeCount(page)).toBe(2);
  });
});

test.describe('layers', () => {
  test('a layer can be duplicated with its contents', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.getByLabel('Duplicate Layer 1').click();

    await expect.poll(() => nodeCount(page)).toBe(4);
    const layerNames = await page.evaluate(() =>
      window.__wisp.session.document.layers.map((layer) => layer.name),
    );
    expect(layerNames).toEqual(['Layer 1', 'Layer 1 copy']);
  });

  test('merging down keeps the strokes and drops the layer', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);

    await page.getByLabel('Add layer').click();
    await drag(page, [
      [300, 500],
      [500, 560],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(3);

    await page.getByLabel('Merge Layer 2 down').click();

    // Same three strokes, one layer.
    await expect.poll(() => nodeCount(page)).toBe(3);
    const layers = await page.evaluate(() => window.__wisp.session.document.layers.length);
    expect(layers).toBe(1);
  });

  test('the bottom layer cannot merge down', async ({ page }) => {
    await ready(page);
    await expect(page.getByLabel('Merge Layer 1 down')).toBeDisabled();
  });

  test('merging down is undoable', async ({ page }) => {
    await ready(page);
    await drawCrossingPair(page);
    await page.getByLabel('Add layer').click();

    await page.getByLabel('Merge Layer 2 down').click();
    expect(await page.evaluate(() => window.__wisp.session.document.layers.length)).toBe(1);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__wisp.session.document.layers.length)).toBe(2);
  });
});
