# Roadmap

The build is staged so each stage ends with something you can actually pick up
and use on the tablet, rather than a half-app that only makes sense when the
last piece lands.

Stage 1 is done. Everything below it is planned, not built.

---

## Stage 1 — Sketching core ✅

The thing that has to be right before anything else matters: strokes that feel
good to draw and read as real 3D.

- Pen input with pressure, tilt capture, and **coalesced event** sampling, so
  the full digitiser rate is used rather than one sample per frame
- 1€ filtering on position and pressure — kills stylus jitter without adding
  the lag a plain low-pass would
- Simplify (RDP) → uniform resample (Catmull-Rom) → smoothing pipeline
- Stroke meshes swept with **parallel-transport frames**, so the cross-section
  never twists where a curve's curvature flips
- Elliptical cross-section (`flatness`) — round tube through to flat ribbon
- Sketch planes: camera-facing, ground, front, side, and surface-anchored
  (tap existing geometry to replant the plane on it)
- Gesture model: pen draws, one finger orbits, two fingers pan **and** pinch
  zoom, with palm rejection while the pen is near the glass
- Undo/redo on a bounded command stack
- Layers: add, show/hide, lock, per-layer opacity
- Eraser (whole stroke)
- Render on demand — the GPU idles when the sketch is still
- Installable PWA, works offline

## Stage 2 — Objects and editing

Sketching alone is not enough to build with.

- Primitives: box, sphere, cylinder, cone, plane
- Select (tap, box-select, multi-select) with an outline highlight
- Move / rotate / scale gizmo, snapping to vertices, edges, midpoints, faces
  and the ground
- Group / ungroup, duplicate, mirror
- Partial eraser — split a stroke instead of deleting the whole thing
- Stroke re-styling after the fact (colour, width, flatness)

## Stage 3 — Persistence

Local-only, as specified. Nothing leaves the device.

- Scene serialisation to a compact binary-plus-JSON format
- Storage in the **Origin Private File System**, with IndexedDB as fallback
- Autosave with crash recovery
- Project browser: thumbnails, rename, duplicate, delete
- Explicit `.wisp` file export/import so a sketch can be moved by hand

## Stage 4 — Import and export

- Export: glTF/GLB, OBJ, STL, plus PNG snapshots at render resolution
- Import: reference images placed on a plane, and GLB for tracing over
- Camera bookmarks and turntable video capture

## Stage 5 — The compute link (the PC feature)

The desktop app doubles as a compute host for the tablet.

- Windows desktop app (Tauri — small binary, no bundled Chromium) that runs
  Wisp natively **and** serves it over the LAN
- Tablet opens the PC's URL, or pairs with it from the installed app; the PC
  shows a QR code and a six-digit code
- Heavy operations — booleans, subdivision, remesh, surface reconstruction,
  export encoding — are dispatched to the PC over a WebSocket and stream mesh
  buffers back
- Automatic fallback: no PC, or PC drops mid-session, and the same operation
  runs in a Web Worker on the tablet. The tablet never becomes unusable
  because the link went away
- Discovery over mDNS, with a manual IP entry as the escape hatch

**Why it is built this way.** Rendering and pen input stay on the tablet. The
alternative — rendering on the PC and streaming video — would put 30–60 ms of
Wi-Fi latency between the pen tip and the ink, which is exactly the thing a
sketching app cannot afford. Offloading *operations* instead keeps drawing
local and immediate while the expensive work happens on hardware that can
actually do it quickly.

The seam already exists: every heavy call in stage 1 goes through the
`OpRunner` interface in `@wisp/core`, which today has one implementation that
runs inline. Stage 5 adds two more and changes no call sites.

## Stage 6 — Android packaging

- Android shell (WebView with the app bundled as assets — no network needed)
- S Pen tuning: hover preview, barrel-button erase, low-latency canvas path
- File association for `.wisp`, share-sheet export
- Play Store packaging, adaptive icon, splash

## Stage 7 — Polish

- Onboarding for the gesture model
- Symmetry and mirror-draw modes
- Stroke stabiliser strength control
- Performance: instanced stroke rendering, LOD for dense sketches
- Bundle splitting so first paint does not wait on all of Three.js

---

## Known gaps in stage 1

Honest list of what is not there yet, beyond the staged work above:

- Strokes cannot be edited after they are committed — only deleted
- No selection at all yet, so the eraser is the only way to remove anything
- Nothing is saved; reloading the page loses the sketch (stage 3)
- The plane indicator is a fixed size rather than scaling with zoom
- No pen tilt response in the brush yet, though tilt is already captured
