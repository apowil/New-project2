/**
 * Local project storage.
 *
 * IndexedDB rather than the Origin Private File System: OPFS's advantage is
 * synchronous access handles for very large files, which a sketch does not
 * need yet, while IndexedDB works in every context this app runs in —
 * including a sandboxed iframe and an Android WebView. The interface below is
 * the seam to swap it later without touching callers.
 *
 * Metadata and sketch bytes live in separate stores so listing projects for
 * the browser does not have to pull megabytes of stroke data off disk.
 */

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  strokeCount: number;
  /** PNG data URL, or null before the first save produced one. */
  thumbnail: string | null;
}

export interface ProjectStore {
  list(): Promise<ProjectMeta[]>;
  read(id: string): Promise<ArrayBuffer | null>;
  write(meta: ProjectMeta, data: ArrayBuffer): Promise<void>;
  remove(id: string): Promise<void>;
  readonly kind: 'indexeddb' | 'memory';
}

const DB_NAME = 'wisp';
const DB_VERSION = 1;
const META_STORE = 'projects';
const DATA_STORE = 'sketches';

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DATA_STORE)) {
        db.createObjectStore(DATA_STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the sketch database'));
    req.onblocked = () => reject(new Error('The sketch database is blocked by another tab'));
  });
}

class IndexedDbProjectStore implements ProjectStore {
  readonly kind = 'indexeddb' as const;
  private db: IDBDatabase | null = null;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  private get database(): IDBDatabase {
    if (!this.db) throw new Error('Sketch database is closed');
    return this.db;
  }

  async list(): Promise<ProjectMeta[]> {
    const tx = this.database.transaction(META_STORE, 'readonly');
    const all = await request(tx.objectStore(META_STORE).getAll() as IDBRequest<ProjectMeta[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async read(id: string): Promise<ArrayBuffer | null> {
    const tx = this.database.transaction(DATA_STORE, 'readonly');
    const data = await request(tx.objectStore(DATA_STORE).get(id) as IDBRequest<ArrayBuffer>);
    return data ?? null;
  }

  async write(meta: ProjectMeta, data: ArrayBuffer): Promise<void> {
    // Both stores in one transaction: metadata must never claim a save that
    // the sketch bytes did not complete.
    const tx = this.database.transaction([META_STORE, DATA_STORE], 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.objectStore(DATA_STORE).put(data, meta.id);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Saving failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving was aborted'));
    });
  }

  async remove(id: string): Promise<void> {
    const tx = this.database.transaction([META_STORE, DATA_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(DATA_STORE).delete(id);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Delete failed'));
    });
  }
}

/**
 * Used when IndexedDB is unavailable — a locked-down WebView, private
 * browsing, storage disabled. The app stays fully usable for the session; it
 * just cannot outlive the tab, and the UI says so.
 */
class MemoryProjectStore implements ProjectStore {
  readonly kind = 'memory' as const;
  private meta = new Map<string, ProjectMeta>();
  private data = new Map<string, ArrayBuffer>();

  async list(): Promise<ProjectMeta[]> {
    return [...this.meta.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async read(id: string): Promise<ArrayBuffer | null> {
    return this.data.get(id) ?? null;
  }

  async write(meta: ProjectMeta, data: ArrayBuffer): Promise<void> {
    this.meta.set(meta.id, meta);
    this.data.set(meta.id, data);
  }

  async remove(id: string): Promise<void> {
    this.meta.delete(id);
    this.data.delete(id);
  }
}

let storePromise: Promise<ProjectStore> | null = null;

/** Resolves the best store this environment supports. Cached after the first call. */
export function getProjectStore(): Promise<ProjectStore> {
  storePromise ??= (async () => {
    if (typeof indexedDB === 'undefined') return new MemoryProjectStore();
    try {
      return new IndexedDbProjectStore(await openDatabase());
    } catch {
      return new MemoryProjectStore();
    }
  })();
  return storePromise;
}

/** Test seam — drops the cached store so a fresh one is opened. */
export function resetProjectStoreForTests(): void {
  storePromise = null;
}
