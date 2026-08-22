import { create } from 'zustand';
import {
  AddLayerCommand,
  DEFAULT_STROKE_STYLE,
  History,
  InlineOpRunner,
  SetLayerPropertyCommand,
  createDocument,
  createLayer,
  type Command,
  type Layer,
  type OpRunner,
  type SketchDocument,
  type StrokeStyle,
} from '@wisp/core';

import { DEFAULT_PLANE_STATE, type PlaneMode, type PlaneState } from '../viewport/sketchPlane.js';
import { type TouchIntent } from '../viewport/gestures.js';

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

  reset(): void {
    this.document = createDocument();
    this.history = new History(this.document);
  }
}

export const session = new SketchSession();

interface AppState {
  tool: ToolId;
  style: StrokeStyle;
  plane: PlaneState;
  touchIntent: TouchIntent;
  showPlaneIndicator: boolean;

  /** Mirrors `session.document.revision` so React knows when to re-read. */
  revision: number;
  layers: Layer[];
  activeLayerId: string;
  documentName: string;

  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;

  setTool: (tool: ToolId) => void;
  setStyle: (patch: Partial<StrokeStyle>) => void;
  setPlaneMode: (mode: PlaneMode) => void;
  setPlaneOffset: (offset: number) => void;
  setPlaneAnchor: (anchor: PlaneState['anchor'], normal: PlaneState['anchorNormal']) => void;
  setTouchIntent: (intent: TouchIntent) => void;
  setShowPlaneIndicator: (show: boolean) => void;

  run: (command: Command) => void;
  undo: () => void;
  redo: () => void;
  syncFromSession: () => void;

  addLayer: () => void;
  setActiveLayer: (id: string) => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  newSketch: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  tool: 'draw',
  style: { ...DEFAULT_STROKE_STYLE },
  plane: { ...DEFAULT_PLANE_STATE },
  touchIntent: 'camera',
  showPlaneIndicator: true,

  revision: session.document.revision,
  layers: [...session.document.layers],
  activeLayerId: session.document.activeLayerId,
  documentName: session.document.name,

  canUndo: false,
  canRedo: false,
  undoLabel: null,

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

  newSketch: () => {
    session.reset();
    set({ plane: { ...DEFAULT_PLANE_STATE } });
    get().syncFromSession();
  },
}));
