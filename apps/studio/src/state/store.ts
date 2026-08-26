import { create } from 'zustand';
import {
  AddLayerCommand,
  AddNodesCommand,
  DeleteNodesCommand,
  DuplicateLayerCommand,
  GroupNodesCommand,
  MergeLayersCommand,
  MoveNodesToLayerCommand,
  ReorderLayerCommand,
  ReplaceNodesCommand,
  SetNodeFlagsCommand,
  SetStyleCommand,
  TransformNodesCommand,
  UngroupNodesCommand,
  cloneNodes,
  createId,
  expandGroups,
  isSolid,
  History,
  InlineOpRunner,
  RenameDocumentCommand,
  SetLayerPropertyCommand,
  createDocument,
  createLayer,
  isNodeEditable,
  mirror as mirrorAbout,
  nodesCentre,
  TranslateNodesCommand,
  rotation,
  scaling,
  serializeDocument,
  deserializeDocument,
  NO_MIRROR,
  DEFAULT_SCENE_SCALE,
  sceneScaleSpec,
  type Affine,
  type Command,
  type NodeFlags,
  type SceneNode,
  type Layer,
  type MirrorAxes,
  type OpRunner,
  type SketchDocument,
  type ShapeKind,
  type StrokeStyle,
  type SceneScale,
  type Unit,
  type Vec3,
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
import { WorkerOpRunner } from '../ops/workerRunner.js';
import { DesktopOpRunner, isDesktop } from '../ops/desktopRunner.js';
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
import { readFingerChoiceMade, rememberFingerChoice } from './touchPreference.js';

export type ToolId = 'draw' | 'erase' | 'plane' | 'select' | 'shape' | 'text' | 'dimension';

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
 * Narrows a set of ids to the ones that can actually be selected.
 *
 * Filtering here rather than at each call site means a locked or hidden node
 * cannot be reached by tapping it, by dragging a box over it, or by selecting
 * its layer's contents — one rule, no gaps.
 */
const selectable = (ids: readonly string[]): string[] =>
  ids.filter((id) => {
    const node = session.document.nodes.get(id);
    return node !== undefined && isNodeEditable(session.document, node);
  });

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
  setUnit: (unit: Unit) => void;
  /** World metres per screen pixel, so the UI can show a true-size brush. */
  worldPerPixel: () => number;
  setScale: (scale: SceneScale) => void;
  frameForScale: (scale: SceneScale) => void;
  /** Turns the camera to look squarely at a plane, so drawing is undistorted. */
  facePlane: (normal: Vec3, pointOnPlane?: Vec3) => void;
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
  /** The size of thing being drawn: sets camera, grid and default stroke. */
  sceneScale: SceneScale;

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
  /** Set while the next tap should sample a colour rather than select. */
  eyedropper: boolean;
  /**
   * Set once when a finger moved the camera on a device with no stylus.
   *
   * Without this the app is simply broken for anyone without a pen: every
   * attempt to draw rotates the view, and the setting that fixes it is behind
   * a gear icon nobody has a reason to open.
   */
  offerFingerDrawing: boolean;
  /**
   * A label while a heavy operation is running, or null.
   *
   * Shown rather than hidden: the work now happens off the main thread, so the
   * app stays responsive — and a responsive app with no sign of progress just
   * looks like it ignored you.
   */
  busy: string | null;
  /** Filter text for the sketch library. */
  librarySearch: string;
  librarySort: 'recent' | 'name';

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
  setSceneScale: (scale: SceneScale) => void;
  applyDocumentScale: () => void;
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
  applyBoolean: (op: BooleanOp) => Promise<void>;
  duplicateSelection: () => void;

  restyleSelection: (patch: Partial<StrokeStyle>) => void;
  transformSelection: (build: (pivot: Vec3) => Affine, label: string) => void;
  rotateSelection: (axis: 'x' | 'y' | 'z', radians: number) => void;
  scaleSelection: (factor: number) => void;
  mirrorSelection: (axis: 'x' | 'y' | 'z') => void;
  placeSelection: (axis: 'x' | 'y' | 'z', metres: number) => void;

  groupSelection: () => void;
  ungroupSelection: () => void;
  setNodeFlags: (ids: string[], patch: NodeFlags, label?: string) => void;
  renameNode: (id: string, name: string) => void;
  toggleNodeHidden: (id: string) => void;
  toggleNodeLocked: (id: string) => void;

  pickColorAt: (id: string) => void;
  setEyedropper: (active: boolean) => void;
  noticeTouchWithoutPen: () => void;
  dismissFingerOffer: (enableDrawing: boolean) => void;

  mergeLayerDown: (layerId: string) => void;
  duplicateLayer: (layerId: string) => void;
  reorderLayer: (layerId: string, direction: -1 | 1) => void;

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
  setLibrarySearch: (text: string) => void;
  setLibrarySort: (sort: 'recent' | 'name') => void;
  exportSketch: () => void;
  exportSelection: () => void;
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
  sceneScale: DEFAULT_SCENE_SCALE,
  shapeKind: 'rectangle',
  polygonSides: 6,
  shapeReadout: null,
  textSize: 0.15,
  textPrompt: null,
  recentColors: [],
  reference: null,
  eyedropper: false,
  offerFingerDrawing: false,
  busy: null,
  librarySearch: '',
  librarySort: 'recent',
  selection: [],
  clipboard: [],
  marquee: null,
  selectionAnchor: null,

  setTool: (tool) => set({ tool, eyedropper: false }),

  /**
   * Changes the style.
   *
   * With something selected this restyles it, which is what every other canvas
   * app does and what makes the style controls useful after the fact rather
   * than only before. The current style follows along either way, so the next
   * stroke matches what was just set.
   */
  setStyle: (patch) => {
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
    });
    get().restyleSelection(patch);
  },

  applyBrush: (id) => {
    const shape = findBrush(id).shape;
    set((state) => ({ style: { ...state.style, ...shape } }));
    get().restyleSelection(shape);
  },

  /**
   * Applies a style patch to whatever is selected.
   *
   * Locked nodes are skipped rather than silently changed — a lock that only
   * stops some kinds of edit is not a lock.
   */
  restyleSelection: (patch) => {
    const doc = session.document;
    const ids = get().selection.filter((id) => {
      const node = doc.nodes.get(id);
      return node !== undefined && isNodeEditable(doc, node);
    });
    if (ids.length === 0) return;

    get().run(new SetStyleCommand(ids, patch));
  },

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

  /**
   * Switches the working scale.
   *
   * Moves the camera and re-sizes the grid, and offers the scale's default
   * stroke — but only when the current one is plainly wrong for it, so a width
   * chosen deliberately is never overwritten.
   */
  /** Re-reads the scale from the open document and applies it to the view. */
  applyDocumentScale: () => {
    const scale = session.document.scale ?? DEFAULT_SCENE_SCALE;
    set({ sceneScale: scale });
    getViewActions()?.setScale(scale);
  },

  setSceneScale: (scale) => {
    const spec = sceneScaleSpec(scale);
    session.document.scale = scale;

    const current = get().style.width;
    const wildlyOff = current > spec.defaultWidth * 20 || current < spec.defaultWidth / 20;

    set((state) => ({
      sceneScale: scale,
      style: wildlyOff ? { ...state.style, width: spec.defaultWidth } : state.style,
      plane: { ...state.plane, offset: 0 },
    }));

    const actions = getViewActions();
    actions?.setScale(scale);
    actions?.frameForScale(scale);
    get().syncFromSession();
  },

  setUnit: (unit) => {
    writeUnit(unit);
    set({ unit });
    // Dimensions carry points, not text, so their labels have to be rebuilt at
    // the new unit — no geometry moved, so nothing else would notice.
    getViewActions()?.setUnit(unit);
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
    // Heavy work never runs on the main thread. Inside the desktop app that
    // means a pool of real processes; in a browser — including a tablet
    // connected to a desktop host — a Web Worker.
    session.ops = isDesktop()
      ? // Falls back to a worker in this page if a compute process dies.
        new DesktopOpRunner(new WorkerOpRunner())
      : new WorkerOpRunner();

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
    get().applyDocumentScale();
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
    // Saving is debounced, so a sketch renamed a moment ago has not reached
    // storage yet. Flushing first means the library shows what is actually on
    // the device rather than the state of things a second and a half ago.
    if (projectsOpen) void autoSaver.flush().then(() => get().refreshProjects());
  },

  setLibrarySearch: (librarySearch) => set({ librarySearch }),
  setLibrarySort: (librarySort) => set({ librarySort }),

  exportSketch: () => {
    downloadDocument(session.document);
    set({ statusMessage: `Exported ${session.document.name}` });
  },

  /**
   * Writes only the selected nodes to a file.
   *
   * Built as a throwaway document rather than by filtering the manifest, so
   * the file that comes out is an ordinary sketch that opens like any other —
   * and its layers are only the ones the selection actually used, rather than
   * a dozen empty ones carried over for no reason.
   */
  exportSelection: () => {
    const doc = session.document;
    const { selection } = get();
    if (selection.length === 0) return;

    const nodes = selection
      .map((id) => doc.nodes.get(id))
      .filter((node): node is SceneNode => node !== undefined);
    if (nodes.length === 0) return;

    const used = new Set(nodes.map((node) => node.layerId));
    const extract: SketchDocument = {
      ...doc,
      id: createId('doc'),
      name: `${doc.name} (selection)`,
      layers: doc.layers.filter((layer) => used.has(layer.id)),
      nodes: new Map(nodes.map((node) => [node.id, node])),
      order: doc.order.filter((id) => selection.includes(id)),
    };
    extract.activeLayerId = extract.layers[0]?.id ?? doc.activeLayerId;

    downloadDocument(extract);
    set({ statusMessage: `Exported ${nodes.length} item${nodes.length === 1 ? '' : 's'}` });
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

  // Groups expand here too, not only on tap: dragging a box over part of a
  // group and getting a partial group would make the two ways of selecting
  // disagree about what a group is.
  setSelection: (ids) => set({ selection: selectable(expandGroups(session.document, ids)) }),

  setMarquee: (marquee) => set({ marquee }),

  setSelectionAnchor: (selectionAnchor) => set({ selectionAnchor }),

  toggleSelected: (id, additive) =>
    set((state) => {
      // Tapping one member of a group selects all of it: that is what makes a
      // group a group rather than a label.
      const ids = selectable(expandGroups(session.document, [id]));
      if (ids.length === 0) return {};

      if (!additive) {
        // Tapping the only selected item again clears, which is how every
        // other canvas app behaves.
        const alreadyExactly =
          state.selection.length === ids.length &&
          ids.every((member) => state.selection.includes(member));
        return { selection: alreadyExactly ? [] : ids };
      }

      return state.selection.includes(id)
        ? { selection: state.selection.filter((existing) => !ids.includes(existing)) }
        : { selection: [...state.selection, ...ids.filter((m) => !state.selection.includes(m))] };
    }),

  clearSelection: () => set({ selection: [] }),

  selectLayer: (layerId) =>
    set({
      selection: selectable(
        session.document.order.filter(
          (id) => session.document.nodes.get(id)?.layerId === layerId,
        ),
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

  /**
   * Booleans run through the operation runner, which means off the main
   * thread — so the canvas keeps drawing while a heavy one is evaluated
   * instead of the whole app appearing to hang.
   */
  applyBoolean: async (op) => {
    const state = get();
    if (state.busy) return;

    const nodes = state.selection
      .map((id) => session.document.nodes.get(id))
      .filter((node): node is SceneNode => node !== undefined && isSolid(node));

    if (nodes.length < 2) {
      set({ statusMessage: 'Select at least two strokes first.' });
      return;
    }

    set({ busy: `${BOOLEAN_LABELS[op]}…` });
    try {
      const result = await evaluateBoolean(
        session.ops,
        nodes,
        op,
        state.activeLayerId,
        nodes[0]!.style,
      );

      // The document can have moved on while the worker was busy: anything
      // that went into this operation may have been undone or deleted. Redoing
      // it against a document that no longer contains the inputs would graft
      // in geometry from nowhere.
      const stillPresent = nodes.every((node) => session.document.nodes.has(node.id));
      if (!stillPresent) {
        set({ statusMessage: 'Those shapes changed while that was working.' });
        return;
      }

      get().run(
        new ReplaceNodesCommand(
          nodes.map((node) => node.id),
          [result],
          BOOLEAN_LABELS[op],
        ),
      );
      set({ selection: [result.id], statusMessage: `${BOOLEAN_LABELS[op]} complete` });
    } catch (error) {
      set({ statusMessage: describeError(error, 'That operation could not be completed.') });
    } finally {
      set({ busy: null });
    }
  },

  duplicateSelection: () => {
    const nodes = get()
      .selection.map((id) => session.document.nodes.get(id))
      .filter((node): node is SceneNode => node !== undefined);
    if (nodes.length === 0) return;

    // Straight into the document rather than via the clipboard, so duplicating
    // does not throw away whatever was copied earlier.
    const copies = cloneNodes(nodes);
    get().run(new AddNodesCommand(copies, `Duplicate ${copies.length}`));
    set({
      selection: copies.map((node) => node.id),
      statusMessage: `Duplicated ${copies.length} item${copies.length === 1 ? '' : 's'}`,
    });
  },

  /**
   * Transforms the selection about its own centre.
   *
   * The pivot comes from the document rather than the camera, so a rotation
   * means the same thing however the view happens to be pointing.
   */
  transformSelection: (build, label) => {
    const doc = session.document;
    const ids = get().selection.filter((id) => {
      const node = doc.nodes.get(id);
      return node !== undefined && isNodeEditable(doc, node);
    });
    if (ids.length === 0) return;

    const pivot = nodesCentre(doc, ids);
    if (!pivot) return;

    get().run(new TransformNodesCommand(ids, build(pivot), label));
  },

  rotateSelection: (axis, radians) => {
    const direction: Vec3 =
      axis === 'x' ? { x: 1, y: 0, z: 0 } : axis === 'y' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    get().transformSelection((pivot) => rotation(direction, radians, pivot), 'Rotate');
  },

  scaleSelection: (factor) => {
    // A zero or negative factor collapses the geometry into a plane or turns
    // it inside out; neither is what a scale control is for.
    if (!Number.isFinite(factor) || factor <= 0) return;
    get().transformSelection((pivot) => scaling(factor, pivot), 'Scale');
  },

  mirrorSelection: (axis) => {
    const normal: Vec3 =
      axis === 'x' ? { x: 1, y: 0, z: 0 } : axis === 'y' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    get().transformSelection((pivot) => mirrorAbout(normal, pivot), 'Mirror');
  },

  /** Moves the selection so its centre sits at an exact coordinate. */
  placeSelection: (axis, metres) => {
    const doc = session.document;
    const ids = get().selection.filter((id) => {
      const node = doc.nodes.get(id);
      return node !== undefined && isNodeEditable(doc, node);
    });
    if (ids.length === 0) return;

    const centre = nodesCentre(doc, ids);
    if (!centre) return;

    const delta: Vec3 = { x: 0, y: 0, z: 0 };
    delta[axis] = metres - centre[axis];
    get().run(new TranslateNodesCommand(ids, delta));
  },

  groupSelection: () => {
    const { selection } = get();
    if (selection.length < 2) {
      set({ statusMessage: 'Select two or more items to group.' });
      return;
    }
    get().run(new GroupNodesCommand([...selection], createId('group')));
    set({ statusMessage: `Grouped ${selection.length} items` });
  },

  ungroupSelection: () => {
    const { selection } = get();
    if (selection.length === 0) return;
    get().run(new UngroupNodesCommand([...selection]));
    set({ statusMessage: 'Ungrouped' });
  },

  setNodeFlags: (ids, patch, label) => {
    if (ids.length === 0) return;
    get().run(new SetNodeFlagsCommand([...ids], patch, label));
  },

  renameNode: (id, name) => {
    const trimmed = name.trim();
    const node = session.document.nodes.get(id);
    if (!node || !trimmed || trimmed === node.label) return;
    get().setNodeFlags([id], { label: trimmed }, 'Rename object');
  },

  toggleNodeHidden: (id) => {
    const node = session.document.nodes.get(id);
    if (!node) return;
    get().setNodeFlags([id], { hidden: !node.hidden }, 'Hide object');
    // Something hidden cannot stay selected, or the toolbar hangs over nothing.
    if (!node.hidden) {
      set((state) => ({ selection: state.selection.filter((existing) => existing !== id) }));
    }
  },

  toggleNodeLocked: (id) => {
    const node = session.document.nodes.get(id);
    if (!node) return;
    get().setNodeFlags([id], { locked: !node.locked }, 'Lock object');
  },

  setEyedropper: (eyedropper) => set({ eyedropper }),

  /** Raised by the gesture layer; only ever offered once per session. */
  noticeTouchWithoutPen: () => {
    const state = get();
    if (state.offerFingerDrawing || state.touchIntent === 'draw') return;
    if (readFingerChoiceMade()) return;
    set({ offerFingerDrawing: true });
  },

  dismissFingerOffer: (enableDrawing) => {
    rememberFingerChoice();
    set({ offerFingerDrawing: false });
    if (enableDrawing) {
      set({ touchIntent: 'draw', statusMessage: 'Your finger draws now. Two fingers move the view.' });
    }
  },

  /** Takes the colour of an existing node and makes it the current colour. */
  pickColorAt: (id) => {
    const node = session.document.nodes.get(id);
    set({ eyedropper: false });
    if (!node) return;

    // Deliberately not through setStyle: that would restyle whatever is
    // selected, so sampling a colour would repaint the selection with it.
    // Picking a colour should load the brush, not change the drawing.
    const color = node.style.color;
    set((state) => ({
      style: { ...state.style, color },
      recentColors: [
        color.toLowerCase(),
        ...state.recentColors.filter((existing) => existing !== color.toLowerCase()),
      ].slice(0, MAX_RECENT_COLORS),
      statusMessage: `Picked ${color}`,
    }));
  },

  reorderLayer: (layerId, direction) => {
    const doc = session.document;
    const index = doc.layers.findIndex((layer) => layer.id === layerId);
    const to = index + direction;
    if (index < 0 || to < 0 || to >= doc.layers.length) return;
    get().run(new ReorderLayerCommand(layerId, to));
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
