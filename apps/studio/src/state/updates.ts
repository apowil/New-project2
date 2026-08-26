import { registerSW } from 'virtual:pwa-register';

import { desktopBridge } from '../ops/desktopRunner.js';
import { IDLE, type UpdateState, type UpdateStatus } from './updateState.js';

/**
 * Noticing that a newer Wisp exists, wherever this copy came from.
 *
 * The same studio runs in three places and each has its own idea of what an
 * update is: the desktop app downloads an installer and relaunches, a tablet's
 * installed web app swaps a service worker, and a plain browser tab just needs
 * a reload. The differences are real, but the decision the person makes is
 * identical in all three — *now, or later* — so they are collapsed into one
 * state here and one banner above.
 *
 * Nothing installs itself. Downloading in the background is polite; closing
 * somebody's window to finish the job is not.
 */

export {
  describeUpdate,
  IDLE,
  shouldOffer,
  versionKey,
  type UpdateState,
  type UpdateStatus,
} from './updateState.js';

export interface UpdateSource {
  /** Applies the update. On both channels this ends the current session. */
  apply: () => void;
  /** Looks again, on request. */
  check: () => void;
  dispose: () => void;
}

interface DesktopUpdate {
  status: UpdateStatus;
  version: string | null;
  progress: number;
  message: string | null;
  supported: boolean;
  installed?: string;
}

interface DesktopUpdateBridge {
  updateState: () => Promise<DesktopUpdate>;
  checkForUpdate: () => Promise<DesktopUpdate | null>;
  installUpdate: () => Promise<void>;
  onUpdateChanged: (listener: (state: DesktopUpdate) => void) => () => void;
}

/**
 * Starts watching, and reports every change to `onState`.
 *
 * Returns null when neither source exists — a dev server with no service
 * worker, or a test — so callers can tell "up to date" from "cannot know".
 */
export function watchForUpdates(onState: (state: UpdateState) => void): UpdateSource | null {
  const desktop = desktopBridge() as unknown as DesktopUpdateBridge | null;
  if (desktop && typeof desktop.updateState === 'function') {
    return watchDesktop(desktop, onState);
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    return watchServiceWorker(onState);
  }

  return null;
}

function watchDesktop(
  desktop: DesktopUpdateBridge,
  onState: (state: UpdateState) => void,
): UpdateSource {
  const publish = (state: DesktopUpdate): void => {
    onState({
      status: state.status,
      version: state.version,
      progress: state.progress,
      message: state.message,
      supported: state.supported,
      channel: 'desktop',
    });
  };

  void desktop.updateState().then(publish);
  const off = desktop.onUpdateChanged(publish);

  return {
    apply: () => void desktop.installUpdate(),
    check: () => void desktop.checkForUpdate(),
    dispose: off,
  };
}

/**
 * The tablet's route.
 *
 * A service worker downloads the new build itself and then waits, which means
 * by the time anything is reported the update is already on the device. That
 * is why there is no 'downloading' here: the interesting moment is 'ready', and
 * applying it costs a reload rather than a network trip.
 */
function watchServiceWorker(onState: (state: UpdateState) => void): UpdateSource {
  let update: ((reload?: boolean) => Promise<void>) | null = null;

  const base: UpdateState = { ...IDLE, supported: true, channel: 'web' };
  let latest: UpdateStatus = 'idle';
  const publish = (state: UpdateState): void => {
    latest = state.status;
    onState(state);
  };

  // Said once up front, because a worker that finds nothing says nothing, and
  // "no news" has to be distinguishable from "cannot update at all".
  publish(base);

  update = registerSW({
    immediate: true,
    onNeedRefresh: () => publish({ ...base, status: 'ready' }),
    onOfflineReady: () => publish({ ...base, status: 'current' }),
    onRegisteredSW: (_url, registration) => {
      // A tablet can sit on one page for days; without this it would only ever
      // find a new version by being closed and reopened.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
    onRegisterError: (error: unknown) =>
      publish({
        ...base,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      }),
  });

  return {
    apply: () => void update?.(true),
    check: () => {
      publish({ ...base, status: 'checking' });
      void navigator.serviceWorker.getRegistration().then(async (registration) => {
        await registration?.update();
        // `onNeedRefresh` fires during that await when there is something to
        // find, and it must not then be overwritten by this reassurance.
        if (latest === 'checking') publish({ ...base, status: 'current' });
      });
    },
    dispose: () => {
      update = null;
    },
  };
}
