import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { type OpName, type OpRequestMap } from '@wisp/core';

import { ComputePool, computeWorkerPath } from './computePool.js';
import { Host } from './host.js';
import { startStaticHost, type StaticHost } from './server.js';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, Updates } from './updates.js';

/**
 * The desktop app.
 *
 * It is the same studio the tablet runs, in a window, with two things the web
 * version cannot have: real processes to do the heavy work, and the ability to
 * serve itself to other devices on the network.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** The studio build, copied in next to the compiled main process at package time. */
const STUDIO_ROOT = join(here, '..', 'studio');

let window: BrowserWindow | null = null;
let localServer: StaticHost | null = null;
let pool: ComputePool | null = null;
let host: Host | null = null;
let updates: Updates | null = null;
let updateTimer: NodeJS.Timeout | null = null;

async function createWindow(): Promise<void> {
  pool = new ComputePool(computeWorkerPath(here));

  // The host serves the same studio build to other devices and runs their
  // heavy jobs on this machine's pool. It stays off until switched on.
  host = new Host(STUDIO_ROOT, pool, () => {
    window?.webContents.send('wisp:host-changed', host?.state ?? null);
  });

  updates = new Updates(app.isPackaged, (state) => {
    window?.webContents.send('wisp:update-changed', state);
  });

  // Port 0 asks the operating system for a free one, so a second copy of the
  // app — or anything else already on our preferred port — does not stop it
  // starting.
  localServer = await startStaticHost({ root: STUDIO_ROOT, port: 0, host: '127.0.0.1' });

  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#111214',
    // The canvas is the app; a stark white flash before it paints is jarring.
    show: false,
    title: 'Wisp',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once('ready-to-show', () => window?.show());

  // External links belong in the browser, not in a window with no address bar
  // and no way back.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  await window.loadURL(`http://127.0.0.1:${localServer.port}/`);

  // Not at once: the first twenty seconds belong to opening a sketch, not to a
  // network round trip nobody asked for.
  setTimeout(() => void updates?.check(), FIRST_CHECK_DELAY_MS);
  updateTimer = setInterval(() => void updates?.check(), CHECK_INTERVAL_MS);
}

/**
 * The renderer's route to the compute pool.
 *
 * Requests arrive as plain structured-clone data, which is exactly what an
 * operation is, so nothing has to be reshaped on the way through.
 */
ipcMain.handle(
  'wisp:run-op',
  async (_event, name: OpName, request: OpRequestMap[OpName]) => {
    if (!pool) throw new Error('The compute pool is not running.');
    return pool.run(name, request as never);
  },
);

ipcMain.handle('wisp:host-state', () => host?.state ?? null);

ipcMain.handle('wisp:host-start', async () => {
  if (!host) throw new Error('The host is not available.');
  return host.start();
});

ipcMain.handle('wisp:host-stop', async () => {
  if (!host) throw new Error('The host is not available.');
  return host.stop();
});

ipcMain.handle('wisp:update-state', () => ({
  ...(updates?.current ?? null),
  installed: app.getVersion(),
}));

ipcMain.handle('wisp:update-check', async () => updates?.check() ?? null);

/**
 * Quits and relaunches into the new version.
 *
 * The renderer asks for this only after saving, because the window is about to
 * close whether or not anything was written.
 */
ipcMain.handle('wisp:update-install', () => {
  updates?.install();
});

ipcMain.handle('wisp:host-info', () => ({
  port: localServer?.port ?? 0,
  addresses: localServer?.addresses ?? [],
  load: pool?.load ?? { running: 0, queued: 0, workers: 0 },
}));

app.whenReady().then(
  () => {
    void createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  },
  (error: unknown) => {
    console.error('Wisp could not start', error);
    app.quit();
  },
);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (updateTimer) clearInterval(updateTimer);
  pool?.dispose();
  void host?.stop();
  void localServer?.close();
});
