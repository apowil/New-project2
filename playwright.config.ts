import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * No GPU anywhere these tests run, so Chromium is pointed at SwiftShader —
 * WebGL2 then renders in software, slowly but deterministically enough to
 * assert on.
 *
 * Locally a pre-installed Chromium may sit outside Playwright's own cache; on
 * CI, `playwright install` provides it and this resolves to undefined so
 * Playwright picks its own.
 */
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath =
  process.env.CHROMIUM_PATH || (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-lcd-text',
      ],
    },
  },

  projects: [
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],

  webServer: {
    command: 'npm run preview --workspace @wisp/studio -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
