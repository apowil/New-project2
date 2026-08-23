import { create } from 'zustand';
import {
  AddLayerCommand,
  AddNodesCommand,
  DeleteNodesCommand,
  DuplicateLayerCommand,
  MergeLayersCommand,
  MoveNodesToLayerCommand,
  ReplaceNodesCommand,
  cloneNodes,
  createId,
  isSolid,
  History,
  InlineOpRunner,
  RenameDocumentCommand,
  SetLayerPropertyCommand,
  createDocument,
  createLayer,
  serializeDocument,
  deserializeDocument,
  NO_MIRROR,
  type Command,
  type SceneNode,
  type Layer,
  type MirrorAxes,
  type OpRunner,
  type SketchDocument,
  type ShapeKind,
  type StrokeStyle,
  type Unit,
  withDimension,
} from '@wisp/core';

import { DEFAULT_PLANE_STATE, type PlaneMode, type PlaneState } from '../viewport/sketchPlane.js';
import { type TouchIntent } from '../viewport/gestures.js';
import { AutoSaver, readLastOpened, rememberLastOpened, type SaveState } from '../storage/autosave.js';
import { getProjectStore, type ProjectMeta } from '../storage/projectStore.js';
import { downloadDocument, pickDocumentFile, readDocumentFile } from '../storage/files.js';
import {
  IMAGE_FORMAT_LABELS,
  downloadExport,
  type ImageFormat,
} from '../storage/exportImage.js';
import { pickImageFile, readImageAsDataUrl } from '../storage/images.js';
import { DEFAULT_BRUSH_ID, findBrush, styleForBrush } from '../tools/brushes.js';
import { BOOLEAN_LABELS, evaluateBoolean, type BooleanOp } from '../tools/booleans.js';
import { rebuildShape } from '../tools/shapeTool.js';
import {
  SCENE_THEMES,
  applyTheme,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme.js';
import { readUnit, writeUnit } from './unitPreference.js';

export type ToolId = 'draw' | 'erase' | 'plane' | 'select' | 'shape' | 'text';

/**
 * A tracing image floating over the canvas.
 *
 * Deliberately a view aid rather than a document node: it is not saved into
 * the sketch, does not print, and can be dragged over the drawing while
 * strokes pass straight through it.
 */
export interface ReferenceImage {
  src: string;
  name: string;
  /** Top-left position in CSS pixels. */
  x: number;
  y: number;
  width: number;
  opacity: number;
  visible: boolean;
  /** When true the image ignores the pointer, so you can draw through it. */
  drawThrough: boolean;
}

const MAX_RECENT_COLORS = 12;

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

/**
 * Camera actions, registered by the app once the viewport exists.
 *
 * The view controls moved into a menu in the top bar, several levels away from
 * where the viewport is created. Registering the handlers here beats threading
 * four callbacks through every component in between.
 */
export interface ViewActions {
  preset: (theta: number, phi: number) => void;
  nudge: (deltaTheta: number, deltaPhi: number) => void;
  zoom: (factor: number) => void;
  frameAll: () => void;
  renderImage: (format: 'png' | 'jpg', scale: number) => string;
  renderSvg: () => Promise<string>;
}

let viewActions: ViewActions | null = null;
export const setViewActions = (actions: ViewActions | null): void => {
  viewActions = actions;
};
export const getViewActions = (): ViewActions | null => viewActions;

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
  /** Reflect each new stroke through these world-origin planes. */
  mirror: MirrorAxes;

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

  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  /** Display unit for every measurement. Presentation only — never geometry. */
  unit: Unit;

  shapeKind: ShapeKind;
  polygonSides: number;
  /** Live measurements of the shape under the pointer, in metres. */
  shapeReadout: Array<{ label: string; value: number }> | null;
  /** Cap height for new text, in metres. */
  textSize: number;
  /** Set while the text tool waits for something to be typed. */
  textPrompt: { x: number; y: number } | null;
  recentColors: string[];
  reference: ReferenceImage | null;

  /** Ids of selected nodes. An array, so React sees a new identity on change. */
  selection: string[];
  /** Detached copies, so editing the originals afterwards cannot affect a paste. */
  clipboard: SceneNode[];
  /** Live rubber-band rectangle in CSS pixels, or null when not dragging. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Screen position the selection toolbar follows. */
  selectionAnchor: { x: number; y: number } | null;

  setTool: (tool: ToolId) => void;
  setStyle: (patch: Partial<StrokeStyle>) => void;
  setPlaneMode: (mode: PlaneMode) => void;
  setPlaneOffset: (offset: number) => void;
  setPlaneAnchor: (anchor: PlaneState['anchor'], normal: PlaneState['anchorNormal']) => void;
  setTouchIntent: (intent: TouchIntent) => void;
  setShowPlaneIndicator: (show: boolean) => void;
  setStatusMessage: (message: string | null) => void;
  toggleMirror: (axis: keyof MirrorAxes) => void;
  applyBrush: (id: string) => void;

  setThemePreference: (preference: ThemePreference) => void;
  syncResolvedTheme: () => void;
  setUnit: (unit: Unit) => void;
  exportImage: (format: ImageFormat, scale?: number) => Promise<void>;

  setShapeKind: (kind: ShapeKind) => void;
  setPolygonSides: (sides: number) => void;
  setShapeReadout: (readout: Array<{ label: string; value: number }> | null) => void;
  setTextSize: (metres: number) => void;
  setTextPrompt: (at: { x: number; y: number } | null) => void;
  editShapeDimension: (nodeId: string, label: string, metres: number) => void;

  importReference: () => Promise<void>;
  updateReference: (patch: Partial<ReferenceImage>) => void;
  clearReference: () => void;

  renameProject: (id: string, name: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;

  setSelection: (ids: string[]) => void;
  setMarquee: (rect: { x0: number; y0: number; x1: number; y1: number } | null) => void;
  setSelectionAnchor: (point: { x: number; y: number } | null) => void;
  toggleSelected: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  selectLayer: (layerId: string) => void;
  deleteSelection: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  paste: () => void;
  moveSelectionToLayer: (layerId: string) => void;
  applyBoolean: (op: BooleanOp) => void;

  mergeLayerDown: (layerId: string) => void;
  duplicateLayer: (layerId: string) => void;

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
  // Start on a real preset, so the brush control does not open on "Custom",
  // and on a stroke colour that is visible against the resolved theme.
  style: styleForBrush(
    DEFAULT_BRUSH_ID,
    SCENE_THEMES[resolveTheme(readThemePreference())].defaultStroke,
  ),
  plane: { ...DEFAULT_PLANE_STATE },
  touchIntent: 'camera',
  showPlaneIndicator: true,
  mirror: { ...NO_MIRROR },

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

  themePreference: readThemePreference(),
  resolvedTheme: resolveTheme(readThemePreference()),
  unit: readUnit(),
  shapeKind: 'rectangle',
  polygonSides: 6,
  shapeReadout: null,
  textSize: 0.15,
  textPrompt: null,
  recentColors: [],
  reference: null,
  selection: [],
  clipboard: [],
  marquee: null,
  selectionAnchor: null,

  setTool: (tool) => set({ tool }),
  setStyle: (patch) =>
    set((state) => {
      const style = { ...state.style, ...patch };
      if (!patch.color || patch.color === state.style.color) return { style };

      // Most recent first, no duplicates, bounded.
      const color = patch.color.toLowerCase();
      const recentColors = [
        color,
        ...state.recentColors.filter((existing) => existing !== color),
      ].slice(0, MAX_RECENT_COLORS);
      return { style, recentColors };
    }),

  applyBrush: (id) =>
    set((state) => ({ style: { ...state.style, ...findBrush(id).shape } })),

  setPlaneMode: (mode) => set((state) => ({ plane: { ...state.plane, mode, offset: 0 } })),
  setPlaneOffset: (offset) => set((state) => ({ plane: { ...state.plane, offset } })),
  setPlaneAnchor: (anchor, anchorNormal) =>
    set((state) => ({
      plane: { ...state.plane, mode: 'surface', anchor, anchorNormal, offset: 0 },
    })),

  setTouchIntent: (touchIntent) => set({ touchIntent }),
  setShowPlaneIndicator: (showPlaneIndicator) => set({ showPlaneIndicator }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),

  toggleMirror: (axis) =>
    set((state) => ({ mirror: { ...state.mirror, [axis]: !state.mirror[axis] } })),

  setShapeKind: (shapeKind) => set({ shapeKind }),
  setPolygonSides: (polygonSides) => set({ polygonSides: Math.max(3, Math.round(polygonSides)) }),
  setShapeReadout: (shapeReadout) => set({ shapeReadout }),
  setTextSize: (textSize) => set({ textSize: Math.max(textSize, 1e-4) }),
  setTextPrompt: (textPrompt) => set({ textPrompt }),

  /**
   * Applies a typed dimension to a shape that was drawn earlier.
   *
   * Only possible because the shape kept its parameters and the plane it was
   * laid out on; a freehand stroke has neither and is left alone.
   */
  editShapeDimension: (nodeId, label, metres) => {
    const node = session.document.nodes.get(nodeId);
    if (!node || node.type !== 'stroke' || !node.shape) return;

    const rebuilt = rebuildShape(node, withDimension(node.shape.params, label, metres));
    if (!rebuilt) return;

    get().run(new ReplaceNodesCommand([nodeId], [rebuilt], `Set ${label.toLowerCase()}`));
    set({ selection: [rebuilt.id] });
  },

  setUnit: (unit) => {
    writeUnit(unit);
    set({ unit });
  },

  exportImage: async (format, scale = 2) => {
    const actions = getViewActions();
    if (!actions) return;

    try {
      const payload =
        format === 'svg'
          ? await actions.renderSvg()
          : actions.renderImage(format === 'jpg' ? 'jpg' : 'png', scale);

      downloadExport(session.document.name, format, payload);
      set({ statusMessage: `Exported ${IMAGE_FORMAT_LABELS[format]}` });
    } catch (error) {
      console.error('Image export failed', error);
      set({ statusMessage: describeError(error, 'That export could not be made.') });
    }
  },

  setThemePreference: (preference) => {
    writeThemePreference(preference);
    set({ themePreference: preference });
    get().syncResolvedTheme();
  },

  /** Resolves "system" against the OS and applies the result everywhere. */
  syncResolvedTheme: () => {
    const state = get();
    const resolved = resolveTheme(state.themePreference);
    if (resolved === state.resolvedTheme) {
      applyTheme(resolved);
      return;
    }

    applyTheme(resolved);

    // A pale default stroke is invisible on a light ground and vice versa, so
    // the default follows the theme — but only while it is still the default.
    // A colour the user actually picked is left alone.
    const previousDefault = SCENE_THEMES[state.resolvedTheme].defaultStroke;
    const nextDefault = SCENE_THEMES[resolved].defaultStroke;
    const style =
      state.style.color.toLowerCase() === previousDefault.toLowerCase()
        ? { ...state.style, color: nextDefault }
        : state.style;

    set({ resolvedTheme: resolved, style });
  },

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
    set({ themePreference: readThemePreference() });
    get().syncResolvedTheme();

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
      selection: [],
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
        selection: [],
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

  importReference: async () => {
    const file = await pickImageFile();
    if (!file) return;

    try {
      const src = await readImageAsDataUrl(file);
      set({
        reference: {
          src,
          name: file.name,
          x: 80,
          y: 100,
          width: 360,
          opacity: 0.6,
          visible: true,
          drawThrough: true,
        },
        statusMessage: `Reference: ${file.name}`,
      });
    } catch (error) {
      console.error('Could not read the image', error);
      set({ statusMessage: describeError(error, 'That image could not be read.') });
    }
  },

  updateReference: (patch) =>
    set((state) => (state.reference ? { reference: { ...state.reference, ...patch } } : {})),

  clearReference: () => set({ reference: null }),

  renameProject: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Renaming the open sketch goes through history so it can be undone.
    if (id === session.document.id) {
      get().renameSketch(trimmed);
      await get().saveNow();
      return;
    }

    const store = await getProjectStore();
    const data = await store.read(id);
    const meta = (await store.list()).find((project) => project.id === id);
    if (!data || !meta) return;

    const doc = deserializeDocument(data);
    doc.name = trimmed;
    await store.write({ ...meta, name: trimmed, updatedAt: Date.now() }, serializeDocument(doc));
    await get().refreshProjects();
  },

  duplicateProject: async (id) => {
    const store = await getProjectStore();
    const data = await store.read(id);
    const meta = (await store.list()).find((project) => project.id === id);
    if (!data || !meta) return;

    const doc = deserializeDocument(data);
    // A copy needs its own identity, or it would overwrite the original on
    // the next autosave.
    doc.id = createId('doc');
    doc.name = `${doc.name} copy`;
    const now = Date.now();

    await store.write(
      {
        id: doc.id,
        name: doc.name,
        createdAt: now,
        updatedAt: now,
        strokeCount: doc.nodes.size,
        thumbnail: meta.thumbnail,
      },
      serializeDocument(doc),
    );
    await get().refreshProjects();
    set({ statusMessage: `Duplicated ${meta.name}` });
  },

  setSelection: (ids) => set({ selection: ids }),

  setMarquee: (marquee) => set({ marquee }),

  setSelectionAnchor: (selectionAnchor) => set({ selectionAnchor }),

  toggleSelected: (id, additive) =>
    set((state) => {
      if (!additive) {
        // Tapping the only selected item again clears, which is how every
        // other canvas app behaves.
        return { selection: state.selection.length === 1 && state.selection[0] === id ? [] : [id] };
      }
      return state.selection.includes(id)
        ? { selection: state.selection.filter((existing) => existing !== id) }
        : { selection: [...state.selection, id] };
    }),

  clearSelection: () => set({ selection: [] }),

  selectLayer: (layerId) =>
    set({
      selection: session.document.order.filter(
        (id) => session.document.nodes.get(id)?.layerId === layerId,
      ),
    }),

  deleteSelection: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    get().run(new DeleteNodesCommand([...selection], `Delete ${selection.length}`));
    set({ selection: [] });
  },

  copySelection: () => {
    const nodes = get()
      .selection.map((id) => session.document.nodes.get(id))
      .filter((node): node is SceneNode => node !== undefined);
    if (nodes.length === 0) return;

    // Cloned at copy time so later edits to the originals cannot leak in.
    set({
      clipboard: cloneNodes(nodes),
      statusMessage: `Copied ${nodes.length} item${nodes.length === 1 ? '' : 's'}`,
    });
  },

  cutSelection: () => {
    get().copySelection();
    get().deleteSelection();
  },

  paste: () => {
    const { clipboard, activeLayerId } = get();
    if (clipboard.length === 0) return;

    // Cloned again on paste, so pasting twice gives two independent copies.
    const nodes = cloneNodes(clipboard, activeLayerId);
    get().run(new AddNodesCommand(nodes, `Paste ${nodes.length}`));
    set({
      selection: nodes.map((node) => node.id),
      statusMessage: `Pasted into ${session.document.layers.find((l) => l.id === activeLayerId)?.name ?? 'layer'}`,
    });
  },

  moveSelectionToLayer: (layerId) => {
    const { selection } = get();
    if (selection.length === 0) return;
    get().run(new MoveNodesToLayerCommand([...selection], layerId));
  },

  applyBoolean: (op) => {
    const state = get();
    const nodes = state.selection
      .map((id) => session.document.nodes.get(id))
      .filter((node): node is SceneNode => node !== undefined && isSolid(node));

    if (nodes.length < 2) {
      set({ statusMessage: 'Select at least two strokes first.' });
      return;
    }

    try {
      const result = evaluateBoolean(nodes, op, state.activeLayerId, nodes[0]!.style);
      state.run(
        new ReplaceNodesCommand(
          nodes.map((node) => node.id),
          [result],
          BOOLEAN_LABELS[op],
        ),
      );
      set({ selection: [result.id], statusMessage: `${BOOLEAN_LABELS[op]} complete` });
    } catch (error) {
      set({ statusMessage: describeError(error, 'That operation could not be completed.') });
    }
  },

  mergeLayerDown: (layerId) => {
    const doc = session.document;
    const index = doc.layers.findIndex((layer) => layer.id === layerId);
    // "Down" means the layer before it in the list, which is drawn earlier.
    const target = doc.layers[index - 1];
    if (index <= 0 || !target) {
      set({ statusMessage: 'There is no layer below this one.' });
      return;
    }
    get().run(new MergeLayersCommand([layerId], target.id));
  },

  duplicateLayer: (layerId) => {
    const doc = session.document;
    const index = doc.layers.findIndex((layer) => layer.id === layerId);
    const source = doc.layers[index];
    if (!source) return;

    const copy = { ...createLayer(`${source.name} copy`), visible: source.visible, opacity: source.opacity };
    const nodes = cloneNodes(
      doc.order
        .map((id) => doc.nodes.get(id))
        .filter((node): node is SceneNode => node?.layerId === layerId),
      copy.id,
    );

    get().run(new DuplicateLayerCommand(copy, nodes, index + 1));
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
