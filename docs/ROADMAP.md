# Roadmap

The build is staged so each stage ends with something you can actually pick up
and use on the tablet, rather than a half-app that only makes sense when the
last piece lands.

Stages 1 and 3 are done. Everything else is planned, not built.

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
- Gesture model: pen draws, one finger orbits, two fingers pan **and** pinch
  zoom, with palm rejection while the pen is near the glass
- Undo/redo on a bounded command stack
- Layers: add, show/hide, lock, per-layer opacity
- Eraser (whole stroke)
- Render on demand — the GPU idles when the sketch is still
- Installable PWA, works offline

## Stage 3 — Persistence ✅

Done ahead of stage 2, because losing work on a reload undermined everything
else regardless of how good the strokes were.

- `.wisp` container: header, JSON manifest, raw little-endian Float32 samples
- IndexedDB project store, with an in-memory fallback so a locked-down WebView
  stays usable and says so
- Autosave debounced after drawing stops, flushed on page hide
- Project browser with rendered thumbnails; rename, open, delete
- Export and import `.wisp` files

## Stage 1.5 — From the Feather feature review ✅ (partial)

Added after reviewing what Feather actually ships:

- **Symmetry** — mirror new strokes across the X, Y and Z world planes, any
  combination, up to eight copies. Reflection happens on the centreline and
  the mesh is rebuilt, because reflecting a mesh flips its winding and turns
  it inside out. All copies are one undo step.
- **Pinned orbit point** — press and hold with a finger (or middle-click) to
  re-centre the camera on what you pressed. Without it the camera always
  pivots around where it started, which makes inspecting a detail off to one
  side a fight.

## Stage 1.6 — Interface and workflow ✅

- **Light and dark themes.** Semantic colour tokens rather than an inverted
  scale, so a panel reads as a panel in both. The 3D scene repaints too —
  background, fog and grid — and the default stroke colour follows the theme
  so a fresh sketch is never invisible, while a colour you picked yourself is
  left alone.
- **Brush presets** — Ink, Round, Ribbon, Marker, Liner, Chrome. A brush is a
  set of *shape* parameters (cross-section, taper, pressure response);
  switching brush deliberately does not change your colour or size.
- **Colour picker** — hue strip and saturation/value square built from CSS
  gradients, hex entry, and a recent-colours list.
- **Reference images** — float an image over the canvas, drag, resize, set its
  opacity. "Trace" mode makes it ignore the pointer so strokes pass straight
  through it.
- **View controls** — named preset views, an orbit pad, and zoom buttons, so
  the camera can be moved without a spare hand for gestures.
- **Project management** — rename and duplicate from the library, alongside
  open, delete, import and export.

---

## Still to build

### Stage 2 — Objects and editing

- Primitives: box, sphere, cylinder, cone, ring — **as drawing surfaces**, not
  just objects. Feather's approach is to draw *onto* a primitive, which pairs
  with the surface-anchored sketch plane already built.
- Select (tap, box-select, multi-select) with an outline highlight
- Transform widget. Feather uses a **joystick-style** multi-directional widget
  rather than three thin axis arrows — far easier to hit with a finger, and
  worth copying over a conventional gizmo.
- Snapping to vertices, edges, midpoints, faces and the ground
- Group, duplicate, mirror existing geometry (as opposed to mirroring as you
  draw, which stage 1.5 covers)
- Partial eraser — split a stroke instead of deleting the whole thing

### Stage 2.5 — Liquify

Feather's headline editing tool, and the biggest single gap. Select strokes
and push, pull, twist and smooth their centrelines with a falloff brush,
rebuilding the mesh live. Distinctive enough to be worth doing properly rather
than late — it is the difference between "draw and delete" and actually
sculpting a sketch.

### Stage 4 — Import and export

- Export: glTF/GLB, OBJ, STL, PNG/JPEG snapshots
- **Turntable capture** — record an orbit as an animated GIF or video, which
  is how 3D sketches actually get shared
- Reference images: a floating, movable reference window, plus images placed
  on a plane to trace over
- A Blender import path, matching Feather's add-on

### Stage 5 — The compute link (the PC feature)

The desktop app doubles as a compute host for the tablet.

- Windows desktop app (Tauri) that runs Wisp natively **and** serves it over
  the LAN; pair by QR code or six-digit code
- Heavy operations — liquify falloff over dense strokes, booleans,
  subdivision, remesh, export encoding — dispatched to the PC over a
  WebSocket, mesh buffers streamed back
- Automatic fallback to a Web Worker when no PC is paired, or when the link
  drops mid-session
- Discovery over mDNS, manual IP entry as the escape hatch

**Why it is built this way.** Rendering and pen input stay on the tablet.
Rendering on the PC and streaming video would put 30–60 ms of Wi-Fi latency
between the pen tip and the ink, which is the one thing a sketching app cannot
afford. Offloading *operations* keeps drawing local and immediate while the
expensive work happens on hardware that can do it quickly.

The seam already exists: heavy calls go through the `OpRunner` interface in
`@wisp/core`, which today has one implementation that runs inline.

### Stage 6 — Android packaging

- Android shell (WebView, app bundled as assets, no network needed)
- S Pen tuning: hover preview, barrel-button erase, low-latency canvas
- **AR view** via WebXR — Chrome on Android supports it, so this works without
  the ARKit dependency Feather has
- File association for `.wisp`, share-sheet export
- Play Store packaging, adaptive icon, splash

### Stage 7 — Look and polish

- **Orthographic projection toggle.** Preset views exist, but they are still
  perspective. A true front elevation needs orthographic, which means teaching
  the camera a second projection — including `ray()`, which drawing depends
  on, so it wants doing carefully rather than in a batch.
- **Lighting controls and background colour** — Feather ships both, and they
  matter more than expected: a sketch reads completely differently under
  different light, and it is how presentation renders get made
- **Brush textures and patterns** beyond the swept-tube shapes now available
- Onboarding for the gesture model
- Stroke stabiliser strength control
- Performance: instanced stroke rendering, LOD for dense sketches
- Bundle splitting so first paint does not wait on all of Three.js

---

## Known gaps right now

- Strokes cannot be edited after they are committed — only deleted
- No selection, so the eraser is the only way to remove anything
- No export beyond `.wisp` — no glTF, OBJ or image output yet
- Symmetry reflects across the **world** planes, so it reads most naturally
  when the sketch plane is aligned with the mirror axis (drawing on Front with
  X mirror, say). A symmetry origin you can move is a stage 2 item.
- The plane indicator is a fixed size rather than scaling with zoom
- Pen tilt is captured but does not affect the brush yet

## On the feature research

Feather's own tutorial video could not be reviewed directly — this environment
blocks YouTube, and video is not something that can be read here regardless.
The feature list above was assembled from Feather's published documentation and
press coverage, so it reflects what the app *ships*, not what the video
demonstrates. Anything shown only as a workflow in the video will have been
missed, and is worth a second pass.
