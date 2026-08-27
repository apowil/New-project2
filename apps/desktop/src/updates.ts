import updater from 'electron-updater';

/**
 * `electron-updater` is CommonJS, and it is deliberately left out of the
 * bundle — it reads `app-update.yml` from the installed app's resources and
 * expects to find itself in `node_modules`. The main process is ESM, though,
 * so a named import of it is a static ESM import of a CommonJS module, which
 * Node's loader cannot resolve: the main process threw on load and no window
 * was ever created. The default import is the `module.exports` object.
 */
const { autoUpdater } = updater;

/**
 * Keeping the desktop app current.
 *
 * The shape of this is deliberate: check automatically, download
 * automatically, and then *stop* and wait to be told. Installing means quitting
 * and relaunching, and an app that decides on its own to close a window with an
 * hour of unsaved sketching in it has done something unforgivable to save
 * somebody thirty seconds.
 *
 * Everything is reported as one state object rather than a stream of events,
 * because the only consumer is a banner that shows the latest thing that
 * happened. A state is easier to render and impossible to receive out of order.
 */

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'current'
  | 'failed';

export interface UpdateState {
  status: UpdateStatus;
  /** The version on offer, once one is known. */
  version: string | null;
  /** 0..1 while downloading. */
  progress: number;
  /** Set when the check or the download failed, in words a user can read. */
  message: string | null;
  /** False in a development checkout, where there is nothing to update. */
  supported: boolean;
}

export class Updates {
  private state: UpdateState;

  /**
   * @param packaged Whether this is an installed build. A checkout run through
   *   `electron .` has no update metadata, and electron-updater's own error
   *   for that reads like a fault rather than an expected condition.
   */
  constructor(
    private readonly packaged: boolean,
    private readonly onChange: (state: UpdateState) => void,
  ) {
    this.state = {
      status: 'idle',
      version: null,
      progress: 0,
      message: null,
      supported: packaged,
    };

    if (!packaged) return;

    // Downloading is fine unasked — it costs bandwidth and nothing else.
    // Installing is not, so it never happens on its own.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-available', (info) =>
      this.set({ status: 'available', version: info.version, progress: 0 }),
    );
    autoUpdater.on('update-not-available', () => this.set({ status: 'current' }));
    autoUpdater.on('download-progress', (progress) =>
      this.set({ status: 'downloading', progress: progress.percent / 100 }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ status: 'ready', version: info.version, progress: 1 }),
    );
    autoUpdater.on('error', (error) =>
      this.set({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  get current(): UpdateState {
    return this.state;
  }

  private set(patch: Partial<UpdateState>): void {
    // A message only belongs to the failure that produced it.
    this.state = { ...this.state, message: null, ...patch };
    this.onChange(this.state);
  }

  async check(): Promise<UpdateState> {
    if (!this.packaged) return this.state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // The check throws as well as emitting 'error'; swallowing it here keeps
      // an offline machine from logging an unhandled rejection every hour.
      this.set({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return this.state;
  }

  /** Quits and relaunches into the new version. Only ever called on request. */
  install(): void {
    if (this.state.status !== 'ready') return;
    autoUpdater.quitAndInstall();
  }
}

/**
 * How often to look.
 *
 * Once at startup, then every six hours: often enough that a fix reaches
 * somebody the day it ships, rare enough to be invisible.
 */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 20_000;
