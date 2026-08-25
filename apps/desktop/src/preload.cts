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
});
