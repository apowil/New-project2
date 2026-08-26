import { expect, test, type Page } from '@playwright/test';

/**
 * Staying current.
 *
 * The parts worth testing are not the download — that belongs to the service
 * worker and to electron-updater, and neither is ours to reimplement — but the
 * decision around it: an update is offered, never taken; saying "later" is
 * respected; and a newer version than the one waved away asks again.
 */

interface UpdateState {
  status: string;
  version: string | null;
  progress: number;
  message: string | null;
  supported: boolean;
  channel: 'desktop' | 'web';
}

const READY: UpdateState = {
  status: 'ready',
  version: '1.4.0',
  progress: 1,
  message: null,
  supported: true,
  channel: 'web',
};

/** Puts the app in a state the real sources would produce. */
async function pretend(page: Page, update: Partial<UpdateState>): Promise<void> {
  await page.evaluate((patch) => {
    const store = window.__wisp.store;
    const state = store.getState() as unknown as { update: UpdateState };
    store.setState({ update: { ...state.update, ...patch } } as never);
  }, update);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#viewport-canvas');
  await page.waitForFunction(() => typeof window.__wisp !== 'undefined');

  // The service worker installs a second or two after the page does and
  // reports what it found. Anything this test pretends before then would be
  // overwritten by the real answer, so wait for it to have spoken.
  await page.waitForFunction(() => {
    const state = window.__wisp.store.getState() as unknown as {
      update: { status: string; supported: boolean };
    };
    return state.update.supported && state.update.status !== 'idle';
  });
});

test.describe('updates', () => {
  test('says nothing while there is nothing to say', async ({ page }) => {
    await expect(page.getByRole('status', { name: 'Update available' })).toBeHidden();
  });

  test('settings reports that the app keeps itself current', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const panel = page.getByRole('dialog', { name: 'Settings' });
    // Settings scrolls; this sits at the bottom of it.
    await panel.getByRole('button', { name: 'Check' }).scrollIntoViewIfNeeded();

    // A page served over http registers a service worker, so updating is
    // something this copy can actually do — and it says what it found.
    await expect(panel.getByText('Version', { exact: true })).toBeVisible();
    await expect(panel.getByText('This is the newest version.')).toBeVisible();
  });

  test('offers an update rather than taking it', async ({ page }) => {
    await pretend(page, READY);

    const banner = page.getByRole('status', { name: 'Update available' });
    await expect(banner).toBeVisible();
    await expect(banner.getByText('Wisp 1.4.0 is ready')).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Reload' })).toBeVisible();

    // The page is still the page: nothing reloaded on its own.
    expect(await page.evaluate(() => typeof window.__wisp)).toBe('object');
  });

  test('says restart, not reload, inside the desktop app', async ({ page }) => {
    await pretend(page, { ...READY, channel: 'desktop', version: '2.0.1' });

    const banner = page.getByRole('status', { name: 'Update available' });
    await expect(banner.getByRole('button', { name: 'Restart' })).toBeVisible();
    await expect(banner.getByText('Your sketch is saved first.')).toBeVisible();
  });

  test('later means later', async ({ page }) => {
    await pretend(page, READY);

    const banner = page.getByRole('status', { name: 'Update available' });
    await banner.getByRole('button', { name: 'Later' }).click();
    await expect(banner).toBeHidden();

    // The same version does not come back to ask again.
    await pretend(page, READY);
    await expect(banner).toBeHidden();
  });

  test('a newer version asks again', async ({ page }) => {
    await pretend(page, READY);
    await page.getByRole('button', { name: 'Later' }).click();

    // Dismissal is remembered against the version declined, not against
    // updates in general, so a later one has not been said no to.
    await pretend(page, { ...READY, version: '1.5.0' });

    await expect(page.getByRole('status', { name: 'Update available' })).toBeVisible();
    await expect(page.getByText('Wisp 1.5.0 is ready')).toBeVisible();
  });

  test('progress is reported where somebody went looking for it', async ({ page }) => {
    await pretend(page, {
      status: 'downloading',
      progress: 0.42,
      version: '1.4.0',
      channel: 'desktop',
      supported: true,
    });

    // Not over the canvas — a download nobody asked about is not news.
    await expect(page.getByRole('status', { name: 'Update available' })).toBeHidden();

    await page.getByRole('button', { name: 'Settings' }).click();
    const panel = page.getByRole('dialog', { name: 'Settings' });
    await panel.getByText('Downloading — 42%.').scrollIntoViewIfNeeded();
    await expect(panel.getByText('Downloading — 42%.')).toBeVisible();
  });
});
