import { expect, test, type Page } from '@playwright/test';

const CANVAS = '#viewport-canvas';

async function ready(page: Page): Promise<void> {
  await page.waitForSelector(CANVAS);
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
  await page.waitForTimeout(600);
}

const nodeCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__wisp.session.document.nodes.size);

async function drawStroke(page: Page, offset = 0): Promise<void> {
  await page.mouse.move(420 + offset, 420);
  await page.mouse.down();
  for (const [x, y] of [
    [520, 360],
    [620, 420],
    [720, 350],
  ]) {
    await page.mouse.move(x + offset, y, { steps: 4 });
  }
  await page.mouse.up();
}

/** Waits for the autosave debounce to fire and the write to land. */
async function waitForSave(page: Page): Promise<void> {
  await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });
}

test.describe('persistence', () => {
  test('a sketch survives a reload', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(1);
    await waitForSave(page);

    await page.reload();
    await ready(page);

    // The stroke is back, and it is the same document rather than a new one.
    await expect.poll(() => nodeCount(page)).toBe(1);
  });

  test('the sketch name is kept across a reload', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(1);

    await page.getByTitle('Rename this sketch').click();
    const input = page.getByLabel('Sketch name');
    await input.fill('Chair study');
    await input.press('Enter');
    await waitForSave(page);

    await page.reload();
    await ready(page);

    await expect(page.getByTitle('Rename this sketch')).toHaveText('Chair study');
  });

  test('saved sketches are listed with a preview', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(1);
    await waitForSave(page);

    await page.getByRole('button', { name: 'Sketches' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sketches' });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('1 stroke')).toBeVisible();
    // The thumbnail is rendered from the canvas, so it must be a real image.
    const thumb = dialog.locator('img').first();
    await expect(thumb).toBeVisible();
    expect(await thumb.getAttribute('src')).toMatch(/^data:image\/jpeg/);
  });

  test('a new sketch keeps the previous one on disk', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(1);
    await waitForSave(page);
    const firstId = await page.evaluate(() => window.__wisp.session.document.id);

    await page.getByRole('button', { name: 'Sketches' }).click();
    await page.getByRole('button', { name: 'New sketch' }).click();

    // Fresh canvas, different document.
    await expect.poll(() => nodeCount(page)).toBe(0);
    const secondId = await page.evaluate(() => window.__wisp.session.document.id);
    expect(secondId).not.toBe(firstId);

    // Draw on the new one so it also gets saved, then check both are listed.
    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(1);
    await waitForSave(page);

    await page.getByRole('button', { name: 'Sketches' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sketches' });
    await expect(dialog.locator('li')).toHaveCount(2);
  });

  test('reopening an earlier sketch restores its strokes', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await drawStroke(page);
    await drawStroke(page, 60);
    await expect.poll(() => nodeCount(page)).toBe(2);

    await page.getByTitle('Rename this sketch').click();
    const input = page.getByLabel('Sketch name');
    await input.fill('Two strokes');
    await input.press('Enter');
    await waitForSave(page);

    await page.getByRole('button', { name: 'Sketches' }).click();
    await page.getByRole('button', { name: 'New sketch' }).click();
    await expect.poll(() => nodeCount(page)).toBe(0);

    await page.getByRole('button', { name: 'Sketches' }).click();
    await page.getByTitle('Open Two strokes').click();

    await expect.poll(() => nodeCount(page)).toBe(2);
    await expect(page.getByTitle('Rename this sketch')).toHaveText('Two strokes');
  });

  test('deleting the open sketch leaves a blank canvas', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(1);
    await waitForSave(page);

    page.on('dialog', (dialog) => void dialog.accept());

    await page.getByRole('button', { name: 'Sketches' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sketches' });
    await dialog.locator('button[aria-label^="Delete "]').first().click();

    await expect.poll(() => nodeCount(page)).toBe(0);
    await expect(dialog.locator('li')).toHaveCount(0);
  });

  test('a sketch round-trips through an exported file', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await drawStroke(page);
    await drawStroke(page, 90);
    await expect.poll(() => nodeCount(page)).toBe(2);

    await page.getByTitle('Rename this sketch').click();
    const input = page.getByLabel('Sketch name');
    await input.fill('Exported study');
    await input.press('Enter');
    await waitForSave(page);

    await page.getByRole('button', { name: 'Sketches' }).click();
    // The sketch is *named* "Exported study", so a substring match on "Export"
    // also hits the rename button and the project card. Scope to the dialog
    // header and match exactly.
    const dialog = page.getByRole('dialog', { name: 'Sketches' });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Exported study.wisp');
    const filePath = await download.path();

    // Start from an empty sketch, then import the file back.
    await dialog.getByRole('button', { name: 'New sketch' }).click();
    await expect.poll(() => nodeCount(page)).toBe(0);

    await page.getByRole('button', { name: 'Sketches' }).click();
    const chooserPromise = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath!);

    await expect.poll(() => nodeCount(page)).toBe(2);
    await expect(page.getByTitle('Rename this sketch')).toHaveText('Exported study');
  });

  test('a corrupt file is rejected without breaking the app', async ({ page }) => {
    await page.goto('/');
    await ready(page);

    await page.getByRole('button', { name: 'Sketches' }).click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'not-a-sketch.wisp',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('this is definitely not a wisp file'),
    });

    await expect(page.getByRole('status')).toContainText(/not a Wisp sketch/i);

    // Still usable afterwards.
    await page.keyboard.press('Escape');
    await drawStroke(page);
    await expect.poll(() => nodeCount(page)).toBe(1);
  });
});
