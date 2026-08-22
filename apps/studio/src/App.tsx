import { useCallback, useEffect, useRef } from 'react';

import { autoSaver, session, setThumbnailProvider, useStore } from './state/store.js';
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
import { StatusToast } from './ui/StatusToast.js';
import { StyleBar } from './ui/StyleBar.js';
import { Toolbar } from './ui/Toolbar.js';
import { ViewPanel, type ViewPreset } from './ui/ViewPanel.js';
import { watchSystemTheme } from './state/theme.js';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const routerRef = useRef<InputRouter | null>(null);

  const revision = useStore((state) => state.revision);
  const documentEpoch = useStore((state) => state.documentEpoch);
  const plane = useStore((state) => state.plane);
  const tool = useStore((state) => state.tool);
  const showPlaneIndicator = useStore((state) => state.showPlaneIndicator);
  const touchIntent = useStore((state) => state.touchIntent);
  const resolvedTheme = useStore((state) => state.resolvedTheme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const viewport = new Viewport(canvas);
    const controller = new ToolController(viewport);
    const router = new InputRouter(canvas, viewport.camera, controller, {
      touchIntent: useStore.getState().touchIntent,
    });

    viewport.onBeforeRender = () => {
      controller.tick();

      // The camera-facing plane depends on the camera, so it is resolved per
      // frame rather than cached in the store.
      const state = useStore.getState();
      viewport.planeIndicator.update(resolvePlane(state.plane, viewport.camera));
      viewport.planeIndicator.setVisible(
        state.showPlaneIndicator && state.tool !== 'erase' && !controller.draw.isDrawing,
      );
    };

    setThumbnailProvider(() => viewport.thumbnail());
    const detachAutoSave = autoSaver.attach();

    viewport.syncDocument(session.document, true);
    viewport.start();

    viewportRef.current = viewport;
    routerRef.current = router;

    // Reopen whatever was last being drawn.
    void useStore.getState().boot();

    return () => {
      detachAutoSave();
      setThumbnailProvider(null);
      router.dispose();
      viewport.dispose();
      viewportRef.current = null;
      routerRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewportRef.current?.setTheme(resolvedTheme);
  }, [resolvedTheme]);

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

  const applyPreset = useCallback((preset: ViewPreset) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.camera.orbitTo(preset.theta, preset.phi);
    viewport.requestRender();
  }, []);

  const nudgeView = useCallback((deltaTheta: number, deltaPhi: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.camera.orbit(deltaTheta, deltaPhi);
    viewport.requestRender();
  }, []);

  const zoomView = useCallback((factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.camera.dolly(factor);
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

      if (meta) return; // leave every other browser shortcut alone

      switch (event.key.toLowerCase()) {
        case 'd':
          store.setTool('draw');
          break;
        case 'e':
          store.setTool('erase');
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
          <ViewPanel
            onPreset={applyPreset}
            onNudge={nudgeView}
            onZoom={zoomView}
            onFrameAll={frameAll}
          />
          <LayersPanel />
        </div>

        <div className="absolute bottom-4 left-4">
          <PlanePanel />
        </div>

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <StyleBar />
        </div>

        <p className="absolute bottom-4 right-4 max-w-56 text-right text-[11px] leading-relaxed text-muted">
          Pen draws · one finger orbits · two fingers pan &amp; zoom
        </p>

        <ReferenceOverlay />
        <StatusToast />
        <ProjectsPanel />
      </div>
    </div>
  );
}
