import { expect, test, type Page } from '@playwright/test';

const CANVAS = '#viewport-canvas';

/** A 2x2 red PNG — enough to prove the reference pipeline works. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64',
);

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(CANVAS);
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');
  await page.waitForTimeout(600);
}

const styleOf = (page: Page) => page.evaluate(() => window.__wisp.store.getState().style);

async function drawStroke(page: Page): Promise<void> {
  await page.mouse.move(500, 420);
  await page.mouse.down();
  await page.mouse.move(600, 360, { steps: 4 });
  await page.mouse.move(700, 420, { steps: 4 });
  await page.mouse.up();
}

test.describe('theme', () => {
  test('switches the page and the scene between themes', async ({ page }) => {
    await ready(page);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(600);
    const darkPixels = await page.locator(CANVAS).screenshot();

    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(600);
    const lightPixels = await page.locator(CANVAS).screenshot();

    // The 3D scene has to repaint too, not just the panels.
    expect(Buffer.compare(darkPixels, lightPixels)).not.toBe(0);
  });

  test('remembers the choice across a reload', async ({ page }) => {
    await ready(page);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('moves the default stroke colour to stay visible', async ({ page }) => {
    await ready(page);

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.waitForTimeout(300);
    // Pale default, which reads on a dark ground.
    expect((await styleOf(page)).color.toLowerCase()).toBe('#d8d2c8');

    await page.getByRole('button', { name: 'Light' }).click();
    await page.waitForTimeout(300);
    // The pale default would vanish on a light ground, so it moves.
    expect((await styleOf(page)).color.toLowerCase()).toBe('#31363f');
  });

  test('leaves a colour the user picked alone', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'Colour #7dd3c0' }).click();
    expect((await styleOf(page)).color.toLowerCase()).toBe('#7dd3c0');

    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.getByRole('button', { name: 'Light' }).click();
    await page.waitForTimeout(300);

    expect((await styleOf(page)).color.toLowerCase()).toBe('#7dd3c0');
  });
});

test.describe('brushes', () => {
  test('a preset changes the stroke shape', async ({ page }) => {
    await ready(page);
    // Pen is the default: nearly round and near-constant width.
    expect((await styleOf(page)).flatness).toBeCloseTo(0.75, 3);

    await page.getByRole('button', { name: 'Brush' }).click();
    await page.getByRole('button', { name: 'Flat brush' }).click();

    const style = await styleOf(page);
    expect(style.flatness).toBeCloseTo(0.12, 3);
    expect(style.sides).toBe(8);
  });

  test('a water marker is translucent', async ({ page }) => {
    await ready(page);
    expect((await styleOf(page)).opacity).toBeCloseTo(1, 3);

    await page.getByRole('button', { name: 'Brush' }).click();
    await page.getByRole('button', { name: 'Water marker round' }).click();

    // Translucency is what makes a marker a marker, so it rides with the brush.
    expect((await styleOf(page)).opacity).toBeLessThan(0.6);
  });

  test('the active brush name is shown', async ({ page }) => {
    await ready(page);
    await expect(page.getByRole('button', { name: 'Brush' })).toHaveText('Pen');

    await page.getByRole('button', { name: 'Brush' }).click();
    await page.getByRole('button', { name: 'Pencil' }).click();

    await expect(page.getByRole('button', { name: 'Brush' })).toHaveText('Pencil');
  });

  test('a brush does not change the colour', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'Colour #c68cf0' }).click();
    await page.getByRole('button', { name: 'Brush' }).click();
    await page.getByRole('button', { name: 'Water marker flat' }).click();

    expect((await styleOf(page)).color.toLowerCase()).toBe('#c68cf0');
  });

  test('the brush reaches the saved stroke', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'Brush' }).click();
    await page.getByRole('button', { name: 'Round brush' }).click();
    await drawStroke(page);

    await expect
      .poll(() => page.evaluate(() => window.__wisp.session.document.nodes.size))
      .toBe(1);

    const stored = await page.evaluate(() => {
      const node = [...window.__wisp.session.document.nodes.values()][0] as {
        style: { minPressureScale: number; taper: number };
      };
      return node.style;
    });

    expect(stored.minPressureScale).toBeCloseTo(0.28, 3);
    expect(stored.taper).toBeCloseTo(0.18, 3);
  });
});

test.describe('colour picker', () => {
  test('a typed hex becomes the stroke colour', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'Colour', exact: true }).click();
    const hex = page.getByLabel('Hex colour');
    await hex.fill('#ff8800');

    expect((await styleOf(page)).color.toLowerCase()).toBe('#ff8800');
  });

  test('an invalid hex is ignored rather than applied', async ({ page }) => {
    await ready(page);
    const before = (await styleOf(page)).color;

    await page.getByRole('button', { name: 'Colour', exact: true }).click();
    await page.getByLabel('Hex colour').fill('nonsense');

    expect((await styleOf(page)).color).toBe(before);
  });

  test('used colours collect in Recent', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'Colour #7aa2f7' }).click();
    await page.getByRole('button', { name: 'Colour #e0af68' }).click();

    await page.getByRole('button', { name: 'Colour', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Colour' });

    await expect(picker.getByText('Recent')).toBeVisible();
    // Most recent first.
    await expect(picker.getByLabel('Use #e0af68')).toBeVisible();
    await expect(picker.getByLabel('Use #7aa2f7')).toBeVisible();
  });

  test('the picker closes on Escape', async ({ page }) => {
    await ready(page);

    await page.getByRole('button', { name: 'Colour', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Colour' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Colour' })).toBeHidden();
  });
});

test.describe('reference image', () => {
  test('an imported image appears and can be traced through', async ({ page }) => {
    await ready(page);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByLabel('Reference image').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'ref.png', mimeType: 'image/png', buffer: TINY_PNG });

    const image = page.getByAltText('Reference: ref.png');
    await expect(image).toBeVisible();

    // Trace mode is on by default, so a stroke started over the image still
    // reaches the canvas.
    await expect(page.getByRole('button', { name: 'Trace' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the reference can be hidden and removed', async ({ page }) => {
    await ready(page);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByLabel('Reference image').click();
    (await chooserPromise).setFiles({
      name: 'ref.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    await expect(page.getByAltText('Reference: ref.png')).toBeVisible();

    await page.getByLabel('Hide reference').click();
    await expect(page.getByAltText('Reference: ref.png')).toBeHidden();

    await page.getByLabel('Remove reference').click();
    await expect(page.getByRole('button', { name: 'Trace' })).toBeHidden();
  });

  test('a non-image file is refused', async ({ page }) => {
    await ready(page);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByLabel('Reference image').click();
    (await chooserPromise).setFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });

    await expect(page.getByRole('status')).toContainText(/not an image/i);
  });
});

test.describe('view controls', () => {
  test('a preset swings the camera to a named angle', async ({ page }) => {
    await ready(page);
    await drawStroke(page);
    await page.waitForTimeout(500);

    const before = await page.locator(CANVAS).screenshot();
    await page.getByLabel('View').click();
    await page.getByRole('button', { name: 'Top', exact: true }).click();
    await page.waitForTimeout(1200);
    const after = await page.locator(CANVAS).screenshot();

    // Looking straight down is a different image from the default iso view.
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('the orbit pad changes the rendered image', async ({ page }) => {
    await ready(page);
    await drawStroke(page);
    await page.waitForTimeout(500);

    const before = await page.locator(CANVAS).screenshot();
    await page.getByLabel('View').click();
    await page.getByLabel('Orbit right').click();
    await page.waitForTimeout(900);
    const after = await page.locator(CANVAS).screenshot();

    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('zoom buttons change the view', async ({ page }) => {
    await ready(page);
    await drawStroke(page);
    await page.waitForTimeout(500);

    const before = await page.locator(CANVAS).screenshot();
    await page.getByLabel('View').click();
    await page.getByLabel('Zoom in').click();
    await page.waitForTimeout(900);
    const after = await page.locator(CANVAS).screenshot();

    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});

test.describe('project management', () => {
  test('a sketch can be duplicated', async ({ page }) => {
    await ready(page);

    await drawStroke(page);
    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Sketches' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sketches' });
    await expect(dialog.locator('li')).toHaveCount(1);

    await dialog.locator('button[aria-label^="Duplicate "]').first().click();
    await expect(dialog.locator('li')).toHaveCount(2);
    await expect(dialog.getByText(/copy/)).toBeVisible();
  });

  test('a sketch can be renamed from the library', async ({ page }) => {
    await ready(page);

    await drawStroke(page);
    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 15_000 });

    page.on('dialog', (dialog) => void dialog.accept('Renamed study'));

    await page.getByRole('button', { name: 'Sketches' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sketches' });
    await dialog.locator('button[aria-label^="Rename "]').first().click();

    await expect(dialog.getByText('Renamed study')).toBeVisible();
  });
});
