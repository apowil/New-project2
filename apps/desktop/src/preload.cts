/**
 * The only thing the page can reach in the main process.
 *
 * Deliberately two functions rather than a general bridge. The renderer runs
 * the same code that runs on a tablet in an ordinary browser, so anything
 * wider here would be a capability the web version cannot have and would grow
 * dependencies on — and a page that can only ask for an operation cannot be
 * talked into much if it is ever compromised.
 *
 * CommonJS on purpose: a preload script is loaded before the page and outside
 * the module graph, and `require` is what that context reliably provides.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('wispDesktop', {
  runOp: (name: string, request: unknown): Promise<unknown> =>
    ipcRenderer.invoke('wisp:run-op', name, request),
  hostInfo: (): Promise<{
    port: number;
    addresses: string[];
    load: { running: number; queued: number; workers: number };
  }> => ipcRenderer.invoke('wisp:host-info'),

  hostState: (): Promise<unknown> => ipcRenderer.invoke('wisp:host-state'),
  startHost: (): Promise<unknown> => ipcRenderer.invoke('wisp:host-start'),
  stopHost: (): Promise<unknown> => ipcRenderer.invoke('wisp:host-stop'),

  /** Pushed whenever a device connects, pairs, or finishes a job. */
  onHostChanged: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_event: unknown, state: unknown): void => listener(state);
    ipcRenderer.on('wisp:host-changed', handler);
    return () => ipcRenderer.off('wisp:host-changed', handler);
  },

  updateState: (): Promise<unknown> => ipcRenderer.invoke('wisp:update-state'),
  checkForUpdate: (): Promise<unknown> => ipcRenderer.invoke('wisp:update-check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('wisp:update-install'),

  onUpdateChanged: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_event: unknown, state: unknown): void => listener(state);
    ipcRenderer.on('wisp:update-changed', handler);
    return () => ipcRenderer.off('wisp:update-changed', handler);
  },
});
