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

const selectionSize = (page: Page): Promise<number> =>
  page.evaluate(() => window.__wisp.store.getState().selection.length);

async function drag(
  page: Page,
  points: Array<[number, number]>,
  modifiers: string[] = [],
): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
  await page.waitForTimeout(320);
}

/** Draws one freehand stroke and leaves it selected. */
async function drawAndSelect(page: Page): Promise<void> {
  await drag(page, [
    [420, 320],
    [620, 420],
  ]);
  await expect.poll(() => nodeCount(page)).toBe(1);

  await page.keyboard.press('s');
  await page.mouse.click(520, 370);
  await expect.poll(() => selectionSize(page)).toBe(1);
}

const soleNode = (page: Page) =>
  page.evaluate(() => {
    const node = [...window.__wisp.session.document.nodes.values()][0] as Record<string, unknown>;
    return {
      color: (node.style as { color: string }).color,
      width: (node.style as { width: number }).width,
      label: node.label as string | undefined,
      hidden: node.hidden as boolean | undefined,
      locked: node.locked as boolean | undefined,
      groupId: node.groupId as string | undefined,
      type: node.type as string,
    };
  });

test.describe('restyling', () => {
  test('changing a colour restyles what is selected', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    const before = (await soleNode(page)).color;
    await page.evaluate(() => window.__wisp.store.getState().setStyle({ color: '#ff0055' }));
    await page.waitForTimeout(250);

    const after = (await soleNode(page)).color;
    expect(after).not.toBe(before);
    expect(after.toLowerCase()).toBe('#ff0055');
  });

  test('a run of style changes collapses into one undo step', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);
    const before = (await soleNode(page)).width;

    // Stands in for dragging the width slider.
    await page.evaluate(() => {
      const { setStyle } = window.__wisp.store.getState();
      for (let i = 1; i <= 8; i += 1) setStyle({ width: 0.02 * i });
    });
    await page.waitForTimeout(250);
    expect((await soleNode(page)).width).not.toBeCloseTo(before, 6);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);

    // One undo, all the way back — not eight.
    expect((await soleNode(page)).width).toBeCloseTo(before, 6);
    expect(await nodeCount(page)).toBe(1);
  });

  test('a locked object is left alone', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);
    const before = (await soleNode(page)).color;

    await page.evaluate(() => {
      const state = window.__wisp.store.getState();
      const id = state.selection[0]!;
      state.toggleNodeLocked(id);
      state.setSelection([id]);
      state.restyleSelection({ color: '#00ff00' });
    });
    await page.waitForTimeout(250);

    expect((await soleNode(page)).color).toBe(before);
  });
});

test.describe('transforms', () => {
  const bounds = (page: Page) =>
    page.evaluate(() => {
      const doc = window.__wisp.session.document;
      return window.__wisp.core.nodesBounds(doc, [...doc.nodes.keys()]);
    });

  test('scaling a selection makes it bigger', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    const before = await bounds(page);
    await page.evaluate(() => window.__wisp.store.getState().scaleSelection(2));
    await page.waitForTimeout(250);
    const after = await bounds(page);

    const span = (b: NonNullable<typeof before>) => b.max.x - b.min.x;
    expect(span(after!)).toBeCloseTo(span(before!) * 2, 3);
  });

  test('rotating leaves the centre where it was', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    const centre = () =>
      page.evaluate(() => {
        const doc = window.__wisp.session.document;
        return window.__wisp.core.nodesCentre(doc, [...doc.nodes.keys()]);
      });

    const before = await centre();
    await page.evaluate(() => window.__wisp.store.getState().rotateSelection('y', Math.PI / 2));
    await page.waitForTimeout(250);
    const after = await centre();

    expect(after!.x).toBeCloseTo(before!.x, 6);
    expect(after!.z).toBeCloseTo(before!.z, 6);
  });

  test('placing moves the selection to an exact coordinate', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    await page.evaluate(() => window.__wisp.store.getState().placeSelection('y', 1.25));
    await page.waitForTimeout(250);

    const centre = await page.evaluate(() => {
      const doc = window.__wisp.session.document;
      return window.__wisp.core.nodesCentre(doc, [...doc.nodes.keys()]);
    });
    expect(centre!.y).toBeCloseTo(1.25, 6);
  });

  test('a transform undoes in one step', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);
    const before = await bounds(page);

    await page.evaluate(() => window.__wisp.store.getState().scaleSelection(3));
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);

    const after = await bounds(page);
    expect(after!.max.x).toBeCloseTo(before!.max.x, 5);
  });
});

test.describe('objects', () => {
  test('an object can be named, hidden and locked from the outliner', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    // The layers panel is always on screen; expand the layer to see inside it.
    await page.getByRole('button', { name: /^Expand / }).first().click();

    // Rename by double-clicking the row.
    await page.getByRole('button', { name: 'Stroke', exact: true }).dblclick();
    const field = page.getByLabel('Object name');
    await field.fill('Handle');
    await field.press('Enter');
    await expect.poll(async () => (await soleNode(page)).label).toBe('Handle');

    await page.getByLabel('Hide Handle').click();
    await expect.poll(async () => (await soleNode(page)).hidden).toBe(true);

    await page.getByLabel('Show Handle').click();
    await page.getByLabel('Lock Handle').click();
    await expect.poll(async () => (await soleNode(page)).locked).toBe(true);
  });

  test('a hidden object cannot be selected', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    await page.evaluate(() => {
      const state = window.__wisp.store.getState();
      state.toggleNodeHidden(state.selection[0] ?? [...window.__wisp.session.document.nodes.keys()][0]!);
    });
    await page.waitForTimeout(250);

    await page.evaluate(() => {
      const doc = window.__wisp.session.document;
      window.__wisp.store.getState().setSelection([...doc.nodes.keys()]);
    });
    expect(await selectionSize(page)).toBe(0);
  });

  test('grouping makes two strokes select together', async ({ page }) => {
    await ready(page);
    await drag(page, [
      [360, 300],
      [460, 380],
    ]);
    await drag(page, [
      [600, 300],
      [700, 380],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(2);

    await page.evaluate(() => {
      const state = window.__wisp.store.getState();
      state.setSelection([...window.__wisp.session.document.nodes.keys()]);
      state.groupSelection();
    });
    await page.waitForTimeout(250);

    // Tapping one member brings the whole group with it.
    await page.evaluate(() => {
      const state = window.__wisp.store.getState();
      state.clearSelection();
      state.toggleSelected([...window.__wisp.session.document.nodes.keys()][0]!, false);
    });
    expect(await selectionSize(page)).toBe(2);
  });

  test('duplicating a group makes a separate group', async ({ page }) => {
    await ready(page);
    await drag(page, [
      [360, 300],
      [460, 380],
    ]);
    await drag(page, [
      [600, 300],
      [700, 380],
    ]);
    await expect.poll(() => nodeCount(page)).toBe(2);

    await page.evaluate(() => {
      const state = window.__wisp.store.getState();
      state.setSelection([...window.__wisp.session.document.nodes.keys()]);
      state.groupSelection();
    });
    await page.waitForTimeout(250);

    await page.evaluate(() => window.__wisp.store.getState().duplicateSelection());
    await expect.poll(() => nodeCount(page)).toBe(4);

    const groups = await page.evaluate(() =>
      [...window.__wisp.session.document.nodes.values()].map((node) => node.groupId),
    );
    const distinct = new Set(groups);

    // Two groups of two — not one group of four, which is what carrying the
    // original group id across would give.
    expect(distinct.size).toBe(2);
    expect(await selectionSize(page)).toBe(2);
  });

  test('cancelling a rename keeps the old name', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    await page.getByRole('button', { name: /^Expand / }).first().click();
    await page.getByRole('button', { name: 'Stroke', exact: true }).dblclick();

    const field = page.getByLabel('Object name');
    await field.fill('Never applied');
    await field.press('Escape');
    await page.waitForTimeout(400);

    // Escape unmounts the input, and the blur that follows must not commit
    // the very edit that was just abandoned.
    expect((await soleNode(page)).label).toBeUndefined();
  });

  test('the eyedropper keeps the selection it sampled from', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    await page.evaluate(() => window.__wisp.store.getState().setStyle({ color: '#123456' }));
    await page.waitForTimeout(250);

    await page.evaluate(() => {
      const state = window.__wisp.store.getState();
      state.pickColorAt(state.selection[0]!);
    });
    await page.waitForTimeout(250);

    // Sampling loads the brush; it must not repaint or deselect what it read.
    expect(await selectionSize(page)).toBe(1);
    expect((await soleNode(page)).color.toLowerCase()).toBe('#123456');
    expect(
      await page.evaluate(() => window.__wisp.store.getState().style.color.toLowerCase()),
    ).toBe('#123456');
  });

  test('duplicating leaves the clipboard alone', async ({ page }) => {
    await ready(page);
    await drawAndSelect(page);

    await page.evaluate(() => window.__wisp.store.getState().copySelection());
    await page.evaluate(() => window.__wisp.store.getState().duplicateSelection());
    await expect.poll(() => nodeCount(page)).toBe(2);

    expect(
      await page.evaluate(() => window.__wisp.store.getState().clipboard.length),
    ).toBe(1);
  });
});

test.describe('shape constraints', () => {
  test('shift makes a rectangle square', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');

    await drag(
      page,
      [
        [340, 260],
        [640, 380],
      ],
      ['Shift'],
    );
    await expect.poll(() => nodeCount(page)).toBe(1);

    const shape = await page.evaluate(() => {
      const node = [...window.__wisp.session.document.nodes.values()][0] as {
        shape?: { params: { width: number; height: number } };
      };
      return node.shape?.params;
    });

    expect(Math.abs(shape!.width)).toBeCloseTo(Math.abs(shape!.height), 6);
  });

  test('shift snaps a line to 45 degrees', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('r');
    // "Line" alone also matches Polyline and Spline.
    await page.getByRole('button', { name: 'Line', exact: true }).click();

    // Dragged at roughly 20°, which should snap to 0°.
    await drag(
      page,
      [
        [360, 400],
        [660, 460],
      ],
      ['Shift'],
    );
    await expect.poll(() => nodeCount(page)).toBe(1);

    const ends = await page.evaluate(() => {
      const node = [...window.__wisp.session.document.nodes.values()][0] as {
        shape?: { params: { points: Array<{ u: number; v: number }> } };
      };
      return node.shape?.params.points;
    });

    const [a, b] = ends!;
    const angle = (Math.atan2(b!.v - a!.v, b!.u - a!.u) * 180) / Math.PI;
    // Whatever multiple of 45 it landed on, it must be exactly on one.
    expect(Math.abs(angle % 45)).toBeLessThan(0.001);
  });
});

test.describe('dimensions', () => {
  test('three taps leave a dimension in the sketch', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('m');

    await page.mouse.click(400, 400);
    await page.mouse.click(700, 400);
    await page.mouse.click(550, 300);
    await expect.poll(() => nodeCount(page)).toBe(1);

    const node = await soleNode(page);
    expect(node.type).toBe('annotation');
  });

  test('the label follows the unit setting', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('m');
    await page.mouse.click(400, 400);
    await page.mouse.click(700, 400);
    await page.mouse.click(550, 300);
    await expect.poll(() => nodeCount(page)).toBe(1);

    // The node stores points, so the text is generated — and changes with the
    // unit while the geometry stays put.
    const label = (unit: string) =>
      page.evaluate((chosen) => {
        const node = [...window.__wisp.session.document.nodes.values()][0] as never;
        const parts = window.__wisp.core.buildDimension(node, chosen as never);
        return { text: parts.text.length, length: parts.length };
      }, unit);

    const metres = await label('m');
    const millimetres = await label('mm');

    expect(metres.length).toBeCloseTo(millimetres.length, 9);
    expect(metres.text).not.toBe(millimetres.text);
  });

  test('a dimension survives a save and reload', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('m');
    await page.mouse.click(400, 400);
    await page.mouse.click(700, 400);
    await page.mouse.click(550, 300);
    await expect.poll(() => nodeCount(page)).toBe(1);

    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await page.waitForFunction(() => typeof window.__wisp !== 'undefined');

    await expect.poll(() => nodeCount(page)).toBe(1);
    expect((await soleNode(page)).type).toBe('annotation');
  });

  test('Escape abandons a half-placed dimension', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('m');
    await page.mouse.click(400, 400);
    await page.mouse.click(700, 400);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await nodeCount(page)).toBe(0);
  });
});

test.describe('library', () => {
  test('search narrows the list', async ({ page }) => {
    await ready(page);
    await drag(page, [
      [420, 320],
      [620, 420],
    ]);
    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });

    await page.getByTitle('Rename this sketch').click();
    const name = page.getByLabel('Sketch name');
    await name.fill('Bracket study');
    await name.press('Enter');

    await page.getByRole('button', { name: 'Sketches' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sketches' });

    // The library reads storage when it opens, so wait for the renamed sketch
    // to appear there rather than for a toast — the "Saved" one from the
    // stroke is still on screen and would race the rename.
    await expect(dialog.getByText('Bracket study')).toBeVisible({ timeout: 20_000 });

    await dialog.getByLabel('Search sketches').fill('bracket');
    await expect(dialog.locator('li')).toHaveCount(1);

    await dialog.getByLabel('Search sketches').fill('nothing matches this');
    await expect(dialog.locator('li')).toHaveCount(0);
    await expect(dialog.getByText(/No sketch matches/)).toBeVisible();
  });
});
