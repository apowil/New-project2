import { serializeDocument, type SketchDocument } from '@wisp/core';

import { getProjectStore, type ProjectMeta } from './projectStore.js';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Remembers which sketch to reopen. Small enough for localStorage. */
const LAST_OPENED_KEY = 'wisp.lastOpened';

export function rememberLastOpened(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_OPENED_KEY, id);
    else localStorage.removeItem(LAST_OPENED_KEY);
  } catch {
    /* storage disabled; the sketch simply will not reopen automatically */
  }
}

export function readLastOpened(): string | null {
  try {
    return localStorage.getItem(LAST_OPENED_KEY);
  } catch {
    return null;
  }
}

interface AutoSaverOptions {
  /** Supplies the current document at save time, never a stale reference. */
  getDocument: () => SketchDocument;
  getThumbnail: () => string | null;
  onStateChange: (state: SaveState, savedAt: number | null) => void;
  /** Idle time before a save fires, in ms. */
  debounceMs?: number;
}

/**
 * Saves after drawing stops.
 *
 * Debounced rather than saving per stroke: serialising a large sketch on every
 * pen lift would stutter the moment the drawing gets big. The debounce is
 * short, and any pending save is flushed when the page is hidden — on Android
 * a backgrounded tab can be killed without further warning, which is exactly
 * when unsaved work would be lost.
 */
export class AutoSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private inFlight: Promise<void> | null = null;
  private lastSavedRevision = -1;
  private readonly debounceMs: number;

  constructor(private readonly options: AutoSaverOptions) {
    this.debounceMs = options.debounceMs ?? 1200;
  }

  /** Starts listening for page-hide events. Returns a disposer. */
  attach(): () => void {
    const onHide = () => {
      if (this.pending) void this.flush();
    };

    // pagehide is the reliable one on mobile Safari and Android Chrome;
    // visibilitychange covers app switching without a navigation.
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });

    return () => {
      window.removeEventListener('pagehide', onHide);
      if (this.timer) clearTimeout(this.timer);
    };
  }

  /** Call whenever the document changed. */
  schedule(): void {
    const doc = this.options.getDocument();
    if (doc.revision === this.lastSavedRevision) return;

    // An untouched empty sketch is not worth a slot in the project list.
    if (doc.nodes.size === 0 && doc.revision === 0) return;

    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** Writes immediately. Safe to call at any time; overlapping calls queue. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;

    // Serialise behind any save already running so two writes cannot
    // interleave on the same record.
    this.inFlight = (this.inFlight ?? Promise.resolve()).then(() => this.write());
    await this.inFlight;
  }

  private async write(): Promise<void> {
    const doc = this.options.getDocument();
    this.pending = false;
    this.options.onStateChange('saving', null);

    try {
      const store = await getProjectStore();
      const data = serializeDocument(doc);

      const meta: ProjectMeta = {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: Date.now(),
        strokeCount: doc.nodes.size,
        thumbnail: this.options.getThumbnail(),
      };

      await store.write(meta, data);
      this.lastSavedRevision = doc.revision;
      rememberLastOpened(doc.id);
      this.options.onStateChange('saved', meta.updatedAt);
    } catch (error) {
      // Leave `pending` false but the revision unmarked, so the next edit
      // retries rather than the app silently never saving again.
      console.error('Autosave failed', error);
      this.options.onStateChange('error', null);
    }
  }

  /** After opening or creating a document, so it is not re-saved immediately. */
  markClean(revision: number): void {
    this.lastSavedRevision = revision;
    this.pending = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
