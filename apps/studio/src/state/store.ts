import { create } from 'zustand';
import {
  AddLayerCommand,
  DEFAULT_STROKE_STYLE,
  History,
  InlineOpRunner,
  RenameDocumentCommand,
  SetLayerPropertyCommand,
  createDocument,
  createLayer,
  deserializeDocument,
  type Command,
  type Layer,
  type OpRunner,
  type SketchDocument,
  type StrokeStyle,
} from '@wisp/core';

import { DEFAULT_PLANE_STATE, type PlaneMode, type PlaneState } from '../viewport/sketchPlane.js';
import { type TouchIntent } from '../viewport/gestures.js';
import { AutoSaver, readLastOpened, rememberLastOpened, type SaveState } from '../storage/autosave.js';
import { getProjectStore, type ProjectMeta } from '../storage/projectStore.js';
import { downloadDocument, pickDocumentFile, readDocumentFile } from '../storage/files.js';

export type ToolId = 'draw' | 'erase' | 'plane';

/**
 * The document and its history live outside React.
 *
 * A sketch is a large mutable graph that changes on every pointer move, and
 * pushing that through React's reconciler would put the renderer's work on the
 * critical path of drawing. React only mirrors the small slice the UI shows;
 * the viewport reads the document directly.
 */
class SketchSession {
  document: SketchDocument = createDocument();
  history = new History(this.document);
  ops: OpRunner = new InlineOpRunner();

  /** Swaps in a different document, discarding the old history with it. */
  load(document: SketchDocument): void {
    this.document = document;
    this.history = new History(document);
  }

  reset(): void {
    this.load(createDocument());
  }
}

export const session = new SketchSession();

/** Set by the viewport once it exists, so saves can capture a thumbnail. */
let thumbnailProvider: (() => string | null) | null = null;
export const setThumbnailProvider = (provider: (() => string | null) | null): void => {
  thumbnailProvider = provider;
};

interface AppState {
  tool: ToolId;
  style: StrokeStyle;
  plane: PlaneState;
  touchIntent: TouchIntent;
  showPlaneIndicator: boolean;

  /** Mirrors `session.document.revision` so React knows when to re-read. */
  revision: number;
  /** Bumped when the document is *replaced*, which needs a forced resync. */
  documentEpoch: number;
  layers: Layer[];
  activeLayerId: string;
  documentName: string;

  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;

  saveState: SaveState;
  lastSavedAt: number | null;
  storageIsPersistent: boolean;
  projects: ProjectMeta[];
  projectsOpen: boolean;
  statusMessage: string | null;

  setTool: (tool: ToolId) => void;
  setStyle: (patch: Partial<StrokeStyle>) => void;
  setPlaneMode: (mode: PlaneMode) => void;
  setPlaneOffset: (offset: number) => void;
  setPlaneAnchor: (anchor: PlaneState['anchor'], normal: PlaneState['anchorNormal']) => void;
  setTouchIntent: (intent: TouchIntent) => void;
  setShowPlaneIndicator: (show: boolean) => void;
  setStatusMessage: (message: string | null) => void;

  run: (command: Command) => void;
  undo: () => void;
  redo: () => void;
  syncFromSession: () => void;

  addLayer: () => void;
  setActiveLayer: (id: string) => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;

  boot: () => Promise<void>;
  newSketch: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  renameSketch: (name: string) => void;
  refreshProjects: () => Promise<void>;
  setProjectsOpen: (open: boolean) => void;
  exportSketch: () => void;
  importSketch: () => Promise<void>;
  saveNow: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  tool: 'draw',
  style: { ...DEFAULT_STROKE_STYLE },
  plane: { ...DEFAULT_PLANE_STATE },
  touchIntent: 'camera',
  showPlaneIndicator: true,

  revision: session.document.revision,
  documentEpoch: 0,
  layers: [...session.document.layers],
  activeLayerId: session.document.activeLayerId,
  documentName: session.document.name,

  canUndo: false,
  canRedo: false,
  undoLabel: null,

  saveState: 'idle',
  lastSavedAt: null,
  storageIsPersistent: true,
  projects: [],
  projectsOpen: false,
  statusMessage: null,

  setTool: (tool) => set({ tool }),
  setStyle: (patch) => set((state) => ({ style: { ...state.style, ...patch } })),

  setPlaneMode: (mode) => set((state) => ({ plane: { ...state.plane, mode, offset: 0 } })),
  setPlaneOffset: (offset) => set((state) => ({ plane: { ...state.plane, offset } })),
  setPlaneAnchor: (anchor, anchorNormal) =>
    set((state) => ({
      plane: { ...state.plane, mode: 'surface', anchor, anchorNormal, offset: 0 },
    })),

  setTouchIntent: (touchIntent) => set({ touchIntent }),
  setShowPlaneIndicator: (showPlaneIndicator) => set({ showPlaneIndicator }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),

  run: (command) => {
    session.history.run(command);
    get().syncFromSession();
  },

  undo: () => {
    session.history.undo();
    get().syncFromSession();
  },

  redo: () => {
    session.history.redo();
    get().syncFromSession();
  },

  /** Single funnel from the mutable document into React state. */
  syncFromSession: () => {
    const doc = session.document;
    const history = session.history.state;
    set({
      revision: doc.revision,
      layers: [...doc.layers],
      activeLayerId: doc.activeLayerId,
      documentName: doc.name,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.undoLabel,
    });
    autoSaver.schedule();
  },

  addLayer: () => {
    const layer = createLayer(`Layer ${session.document.layers.length + 1}`);
    get().run(new AddLayerCommand(layer));
  },

  setActiveLayer: (id) => {
    session.document.activeLayerId = id;
    set({ activeLayerId: id });
  },

  toggleLayerVisible: (id) => {
    const layer = session.document.layers.find((l) => l.id === id);
    if (!layer) return;
    get().run(new SetLayerPropertyCommand(id, 'visible', !layer.visible, 'Toggle layer'));
  },

  toggleLayerLocked: (id) => {
    const layer = session.document.layers.find((l) => l.id === id);
    if (!layer) return;
    get().run(new SetLayerPropertyCommand(id, 'locked', !layer.locked, 'Lock layer'));
  },

  /** Reopens the last sketch, if there is one. Runs once on startup. */
  boot: async () => {
    const store = await getProjectStore();
    set({ storageIsPersistent: store.kind !== 'memory' });

    const lastId = readLastOpened();
    if (lastId) {
      try {
        const data = await store.read(lastId);
        if (data) {
          session.load(deserializeDocument(data));
          autoSaver.markClean(session.document.revision);
        }
      } catch (error) {
        console.error('Could not reopen the last sketch', error);
        set({ statusMessage: 'The last sketch could not be reopened.' });
      }
    }

    set((state) => ({ documentEpoch: state.documentEpoch + 1 }));
    get().syncFromSession();
    autoSaver.markClean(session.document.revision);
    await get().refreshProjects();
  },

  newSketch: async () => {
    // Commit whatever is on screen before it is replaced.
    await autoSaver.flush();
    session.reset();
    autoSaver.markClean(session.document.revision);
    rememberLastOpened(session.document.id);

    set((state) => ({
      plane: { ...DEFAULT_PLANE_STATE },
      documentEpoch: state.documentEpoch + 1,
      // Starting a sketch means you want to draw, so get the browser out of
      // the way rather than leaving it covering the canvas.
      projectsOpen: false,
      saveState: 'idle',
      lastSavedAt: null,
    }));
    get().syncFromSession();
    autoSaver.markClean(session.document.revision);
    await get().refreshProjects();
  },

  openProject: async (id) => {
    await autoSaver.flush();
    try {
      const store = await getProjectStore();
      const data = await store.read(id);
      if (!data) {
        set({ statusMessage: 'That sketch is no longer on this device.' });
        return;
      }

      session.load(deserializeDocument(data));
      autoSaver.markClean(session.document.revision);
      rememberLastOpened(id);

      set((state) => ({
        plane: { ...DEFAULT_PLANE_STATE },
        documentEpoch: state.documentEpoch + 1,
        projectsOpen: false,
        saveState: 'saved',
      }));
      get().syncFromSession();
      autoSaver.markClean(session.document.revision);
    } catch (error) {
      console.error('Could not open sketch', error);
      set({ statusMessage: describeError(error, 'That sketch could not be opened.') });
    }
  },

  deleteProject: async (id) => {
    const store = await getProjectStore();
    await store.remove(id);

    // Deleting the sketch you are looking at leaves you on a fresh one.
    if (id === session.document.id) {
      rememberLastOpened(null);
      await get().newSketch();
    }
    await get().refreshProjects();
  },

  renameSketch: (name) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === session.document.name) return;
    get().run(new RenameDocumentCommand(trimmed));
  },

  refreshProjects: async () => {
    const store = await getProjectStore();
    set({ projects: await store.list() });
  },

  setProjectsOpen: (projectsOpen) => {
    set({ projectsOpen });
    if (projectsOpen) void get().refreshProjects();
  },

  exportSketch: () => {
    downloadDocument(session.document);
    set({ statusMessage: `Exported ${session.document.name}` });
  },

  importSketch: async () => {
    const file = await pickDocumentFile();
    if (!file) return;

    try {
      const imported = await readDocumentFile(file);
      await autoSaver.flush();

      session.load(imported);
      rememberLastOpened(imported.id);

      set((state) => ({
        documentEpoch: state.documentEpoch + 1,
        projectsOpen: false,
        statusMessage: `Imported ${imported.name}`,
      }));
      get().syncFromSession();
      // Imported sketches are new to this device, so save a copy right away.
      await autoSaver.flush();
      await get().refreshProjects();
    } catch (error) {
      console.error('Import failed', error);
      set({ statusMessage: describeError(error, 'That file is not a Wisp sketch.') });
    }
  },

  saveNow: async () => {
    await autoSaver.flush();
    await get().refreshProjects();
  },
}));

export const autoSaver = new AutoSaver({
  getDocument: () => session.document,
  getThumbnail: () => thumbnailProvider?.() ?? null,
  onStateChange: (saveState, savedAt) =>
    useStore.setState((state) => ({
      saveState,
      lastSavedAt: savedAt ?? state.lastSavedAt,
    })),
});

const describeError = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;
