/**
 * What is known about a newer Wisp, and what to do about it.
 *
 * Separated from the machinery that finds out, because the finding out is
 * three different things — an installer download, a service worker, a reload —
 * while the judgement is one thing and the same everywhere: is this worth
 * interrupting somebody for, and what do we call it.
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
  /** The version being offered, when the source knows it. */
  version: string | null;
  /** 0..1 while a download is running. */
  progress: number;
  message: string | null;
  /** False where updating is not a thing that can happen — a dev server, say. */
  supported: boolean;
  /** Changes the wording: one restarts the app, the other reloads the page. */
  channel: 'desktop' | 'web';
}

export const IDLE: UpdateState = {
  status: 'idle',
  version: null,
  progress: 0,
  message: null,
  supported: false,
  channel: 'web',
};

/**
 * Whether to interrupt somebody with this.
 *
 * Only a downloaded update is worth a banner — everything before it is
 * progress towards something that has not happened yet — and only if this
 * particular version has not already been waved away. Remembering the version
 * rather than a flag is what lets a later one ask again without nagging about
 * the one already declined.
 */
export function shouldOffer(update: UpdateState, dismissed: string | null): boolean {
  if (update.status !== 'ready') return false;
  return dismissed !== versionKey(update);
}

/** What "later" records, including for a source that does not name versions. */
export const versionKey = (update: UpdateState): string => update.version ?? 'unknown';

/** The state in words, for the settings panel. */
export function describeUpdate(update: UpdateState): string {
  switch (update.status) {
    case 'checking':
      return 'Looking for a newer version…';
    case 'available':
      return `Wisp ${update.version ?? 'a new version'} found. Downloading it now.`;
    case 'downloading':
      return `Downloading — ${Math.round(update.progress * 100)}%.`;
    case 'ready':
      return `Wisp ${update.version ?? 'a new version'} is downloaded and waiting.`;
    case 'current':
      return 'This is the newest version.';
    case 'failed':
      return update.message
        ? `Could not check: ${update.message}`
        : 'Could not check for a newer version.';
    default:
      return 'Wisp checks for a newer version in the background.';
  }
}
