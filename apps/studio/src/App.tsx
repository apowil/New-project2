import { useCallback, useEffect, useRef } from 'react';

import { autoSaver, session, setThumbnailProvider, setViewActions, useStore } from './state/store.js';
import { InputRouter } from './viewport/gestures.js';
import { resolvePlane } from './viewport/sketchPlane.js';
import { Viewport } from './viewport/viewport.js';
import { ToolController } from './tools/toolController.js';
import { ActionBar } from './ui/ActionBar.js';
import { DocumentBar } from './ui/DocumentBar.js';
import { LayersPanel } from './ui/LayersPanel.js';
import { PlanePanel } from './ui/PlanePanel.js';
import { ProjectsPanel } from './ui/ProjectsPanel.js';
import { ReferenceOverlay } from './ui/ReferenceOverlay.js';
import { HintBar } from './ui/HintBar.js';
import { Marquee, SelectionContextBar } from './ui/SelectionContextBar.js';
import { ShapePanel } from './ui/ShapePanel.js';
import { TextPrompt } from './ui/TextPrompt.js';
import { StatusToast } from './ui/StatusToast.js';
import { StyleBar } from './ui/StyleBar.js';
import { Toolbar } from './ui/Toolbar.js';
import { watchSystemTheme } from './state/theme.js';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const routerRef = useRef<InputRouter | null>(null);
  const controllerRef = useRef<ToolController | null>(null);

  const revision = useStore((state) => state.revision);
  const documentEpoch = useStore((state) => state.documentEpoch);
  const plane = useStore((state) => state.plane);
  const tool = useStore((state) => state.tool);
  const showPlaneIndicator = useStore((state) => state.showPlaneIndicator);
  const touchIntent = useStore((state) => state.touchIntent);
  const resolvedTheme = useStore((state) => state.resolvedTheme);
  const selection = useStore((state) => state.selection);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const viewport = new Viewport(canvas);
    const controller = new ToolController(viewport);
    const router = new InputRouter(canvas, viewport.camera, controller, {
      touchIntent: useStore.getState().touchIntent,
    });

    let lastAnchor: { x: number; y: number } | null = null;

    viewport.onBeforeRender = () => {
      controller.tick();

      // The toolbar tracks the selection, so its anchor is recomputed each
      // frame — but only pushed into React when it actually moved, or every
      // frame would re-render the tree.
      const selected = useStore.getState().selection;
      const anchor = selected.length > 0 ? viewport.screenCentreOf(selected) : null;
      const moved =
        (anchor === null) !== (lastAnchor === null) ||
        (anchor !== null &&
          lastAnchor !== null &&
          (Math.abs(anchor.x - lastAnchor.x) > 1 || Math.abs(anchor.y - lastAnchor.y) > 1));

      if (moved) {
        lastAnchor = anchor;
        useStore.getState().setSelectionAnchor(anchor);
      }

      // The camera-facing plane depends on the camera, so it is resolved per
      // frame rather than cached in the store.
      const state = useStore.getState();
      viewport.planeIndicator.update(resolvePlane(state.plane, viewport.camera));
      viewport.planeIndicator.setVisible(
        state.showPlaneIndicator && state.tool !== 'erase' && !controller.draw.isDrawing,
      );
    };

    setThumbnailProvider(() => viewport.thumbnail());
    setViewActions({
      preset: (theta, phi) => {
        viewport.camera.orbitTo(theta, phi);
        viewport.requestRender();
      },
      nudge: (deltaTheta, deltaPhi) => {
        viewport.camera.orbit(deltaTheta, deltaPhi);
        viewport.requestRender();
      },
      zoom: (factor) => {
        viewport.camera.dolly(factor);
        viewport.requestRender();
      },
      frameAll: () => {
        const bounds = viewport.contentBounds();
        if (bounds.isEmpty()) return;
        viewport.camera.frame(bounds);
        viewport.requestRender();
      },
      renderImage: (format, scale) => viewport.renderImage(format, scale),
      renderSvg: () => viewport.renderSvg(),
    });
    const detachAutoSave = autoSaver.attach();

    viewport.syncDocument(session.document, true);
    viewport.start();

    viewportRef.current = viewport;
    routerRef.current = router;
    controllerRef.current = controller;

    // Reopen whatever was last being drawn.
    void useStore.getState().boot();

    return () => {
      detachAutoSave();
      setThumbnailProvider(null);
      setViewActions(null);
      router.dispose();
      viewport.dispose();
      viewportRef.current = null;
      routerRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewportRef.current?.setTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    viewportRef.current?.setSelection(new Set(selection));
  }, [selection]);

  // A newly synced scene has fresh materials, so the highlight has to be
  // re-applied after the document changes as well as after the selection does.
  useEffect(() => {
    viewportRef.current?.setSelection(new Set(useStore.getState().selection));
  }, [revision, documentEpoch]);

  useEffect(() =>
    watchSystemTheme(() => {
      // Only meaningful while the preference is "system"; the store re-checks.
      if (useStore.getState().themePreference === 'system') {
        useStore.getState().syncResolvedTheme();
      }
    }),
  []);

  // Push document changes into the scene.
  useEffect(() => {
    viewportRef.current?.syncDocument(session.document);
  }, [revision]);

  // A replaced document reuses low revision numbers, so the scene has to be
  // rebuilt rather than diffed against the previous document's revision.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.syncDocument(session.document, true);

    const bounds = viewport.contentBounds();
    if (!bounds.isEmpty()) viewport.camera.frame(bounds);
    viewport.requestRender();
  }, [documentEpoch]);

  // Panels changed something the viewport draws; ask for a frame.
  useEffect(() => {
    viewportRef.current?.requestRender();
  }, [plane, tool, showPlaneIndicator]);

  useEffect(() => {
    if (routerRef.current) routerRef.current.touchIntent = touchIntent;
  }, [touchIntent]);

  const frameAll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.contentBounds();
    if (bounds.isEmpty()) return;
    viewport.camera.frame(bounds);
    viewport.requestRender();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal keys from a field the user is typing in.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const store = useStore.getState();
      const meta = event.ctrlKey || event.metaKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redo();
        return;
      }

      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void store.saveNow();
        return;
      }

      if (meta && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        store.setProjectsOpen(true);
        return;
      }

      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        store.selectLayer(store.activeLayerId);
        return;
      }

      if (meta && event.key.toLowerCase() === 'c') {
        store.copySelection();
        return;
      }

      if (meta && event.key.toLowerCase() === 'x') {
        store.cutSelection();
        return;
      }

      if (meta && event.key.toLowerCase() === 'v') {
        store.paste();
        return;
      }

      if (meta) return; // leave every other browser shortcut alone

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (store.selection.length > 0) {
          event.preventDefault();
          store.deleteSelection();
        }
        return;
      }

      if (event.key === 'Enter' && controllerRef.current?.isChainingShape) {
        event.preventDefault();
        controllerRef.current.finishShape(false);
        return;
      }

      if (event.key === 'Escape') {
        // A half-drawn polyline is what Escape should abandon first.
        if (controllerRef.current?.isChainingShape) {
          controllerRef.current.finishShape(false);
          return;
        }
        store.clearSelection();
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'd':
          store.setTool('draw');
          break;
        case 'e':
          store.setTool('erase');
          break;
        case 's':
          store.setTool('select');
          break;
        case 'r':
          store.setTool('shape');
          break;
        case 't':
          store.setTool('text');
          break;
        case 'p':
          store.setTool('plane');
          break;
        case 'f':
          frameAll();
          break;
        case '[':
          store.setStyle({ width: Math.max(0.008, store.style.width * 0.85) });
          break;
        case ']':
          store.setStyle({ width: Math.min(0.4, store.style.width * 1.18) });
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [frameAll]);

  return (
    <div className="relative h-full w-full">
      <canvas id="viewport-canvas" ref={canvasRef} />

      {/* One overlay, pointer-events off, so a stroke that strays over the UI
          keeps drawing. Individual panels opt back in. */}
      <div className="pointer-events-none absolute inset-0 select-none">
        <header className="absolute left-4 top-4 flex items-start gap-3">
          <Toolbar />
          <DocumentBar />
        </header>

        <div className="absolute right-4 top-4 flex flex-col items-end gap-3">
          {/* The settings dropdown hangs below this bar and overlaps the
              panels underneath, which are later siblings. Without a raised
              stacking context they paint over it and eat its clicks. */}
          <div className="relative z-40">
            <ActionBar />
          </div>
          <LayersPanel />
        </div>

        {/* Panels follow the tool: what is on screen is what the current tool
            can actually do, rather than everything at once. */}
        {(tool === 'draw' || tool === 'plane' || tool === 'shape') && (
          <div className="absolute bottom-4 left-4 flex flex-col gap-3">
            {tool === 'shape' && (
              <ShapePanel onFinish={(closed) => controllerRef.current?.finishShape(closed)} />
            )}
            <PlanePanel />
          </div>
        )}

        {(tool === 'draw' || tool === 'shape' || tool === 'text') && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <StyleBar />
          </div>
        )}

        <SelectionContextBar />
        <HintBar />

        <Marquee />
        <TextPrompt
          onPlace={(x, y, text, size) =>
            controllerRef.current?.placeText(x, y, text, size) ?? false
          }
        />
        <ReferenceOverlay />
        <StatusToast />
        <ProjectsPanel />
      </div>
    </div>
  );
}
