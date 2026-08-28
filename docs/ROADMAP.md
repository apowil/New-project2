# Roadmap

The build is staged so each stage ends with something you can actually pick up
and use on the tablet, rather than a half-app that only makes sense when the
last piece lands.

Stages 1, 2, 3 and 5 are done, along with the interface work in between.
Stages 4, 6 and 7 are planned, not built.

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

## Stage 2 — Selecting, combining and organising ✅

- **Selection** — tap a stroke, shift-tap to add, drag a box for several.
  Selected geometry is tinted emissively rather than outlined: no extra render
  pass, and it reads on both light and dark grounds.
- **Move** — dragging a selected item moves the whole selection along a plane
  facing the camera. The drag is live but lands in history as one entry.
- **Boolean operations** — Merge, Subtract and Intersect via three-bvh-csg,
  plus Combine, which concatenates without cutting and so works on shapes a
  true boolean cannot evaluate.
- **Clipboard** — copy, cut and paste, including pasting into a different
  layer. Nodes are cloned on copy *and* on paste, so no two nodes ever share a
  buffer and pasting twice gives two independent copies.
- **Layers** — merge down, duplicate with contents, move a selection between
  layers, select a layer's contents.
- **Contextual toolbar** — the actions for a selection appear over the
  selection rather than in a corner panel.

### What a boolean can and cannot do

A stroke is a swept tube with caps, so on its own it is a closed manifold
solid and CSG handles it. What CSG cannot handle is a solid that intersects
*itself* — a stroke that loops back across its own body has no well-defined
inside. That is a property of the shape, not something the code can fix, so
the failure is reported and Combine is offered as the way through.

The result is a **baked mesh**: once two tubes are cut against each other the
surface no longer corresponds to any centreline, so it cannot be re-swept at a
different width afterwards. The file format carries baked geometry alongside
stroke samples, and its version went to 2.

## Stage 2.2 — Units, shapes, text and image export ✅

- **Units** — mm, cm, m, inches or feet, chosen once and applied to every
  measurement. One scene unit stays one metre internally: switching units
  changes what is *shown*, never the geometry, so a sketch drawn in mm and
  reopened in inches is still the same size. Typed fields accept an explicit
  suffix, so "5mm" means five millimetres even when the app is set to metres.
- **Shape tools** — line, rectangle, circle and polygon are dragged; polyline
  and spline are tapped point by point and finished with Enter. Each is
  generated as a centreline and committed as an ordinary stroke, so it sweeps,
  moves, combines and exports like anything else.
- **Dimensions** — measurements appear live while a shape is being dragged,
  and a finished shape keeps its parameters, so it can be resized later by
  typing an exact width, height, radius or length.
- **Text** — a single-stroke technical face, drawn with the current brush and
  merged into one object. Three.js ships no font data, so extruded outline
  text would have meant bundling a typeface; stroke glyphs suit a sketch app
  better anyway and inherit every existing tool. Capitals only, as CAD
  annotation faces usually are — lowercase input is drawn in capitals.
- **Image export** — PNG and JPEG from the framebuffer at twice screen size,
  and SVG re-rendered through Three's SVGRenderer as genuine vector polygons
  rather than a traced bitmap.

## Stage 2.3 — Editing what is already there ✅

From an audit of the app against what it was missing. The theme is that
almost everything could be *made* and almost nothing could be *changed*.

- **Restyle** — `SetStyleCommand` had been written, tested and never called,
  so nothing could change a stroke after it was drawn. Style edits now apply
  to the selection, merging into one undo step while a slider moves.
- **Transforms** — rotate, scale, mirror and place a selection about its own
  centre. All four are one affine type sharing one path through the document,
  which is what keeps the awkward parts consistent: normals need the inverse
  transpose under a non-uniform scale, and a mirror has to reverse triangle
  winding or the surface turns inside out. Undo stores the inverse rather than
  a copy of the geometry.
- **Exact steps rather than a gizmo.** A handle is quicker for a rough nudge,
  but the reason to open the transform menu is usually that ninety degrees or
  half size is wanted *exactly*. A joystick widget is still worth adding
  alongside it.
- **Object outliner** — layers expand to show their contents; each object can
  be named, hidden and locked on its own. Layers can be reordered, though that
  orders the panel rather than the picture: in 3D the depth buffer decides
  what is in front.
- **Groups** — a reversible "keep these together", offered next to the
  booleans because it answers the same question without baking.
- **Dimensions** — measure between two points and leave the measurement
  behind. Stored as the two points, so the number follows the unit setting
  instead of being frozen at whatever was current when it was drawn.
- **Shape constraints** — shift for a square or 45°, alt from the centre.
- **Eyedropper**, **duplicate in place**, **export the selection only**,
  **library search and sort**, and a **lowercase alphabet** with real
  ascenders and descenders rather than small capitals.

## Stage 2.5 — Liquify ✅

The one thing the app could not do: change the shape of something already
drawn. A falloff brush now pushes, pulls, twists and relaxes the *centrelines*
of strokes, and the tubes are re-swept from them live.

- **Four modes.** *Push* drags what it covers along with the pen. *Pull* draws
  it in toward the brush. *Twist* pins itself where you pressed and turns what
  is under it as you drag sideways. *Smooth* relaxes a wobble out. Push and
  twist are spent by movement; pull and smooth are rates, and keep working for
  as long as the brush is held — which is why the warp runs on the frame tick
  rather than on pointer events.
- **Centrelines, not triangles.** Warping the mesh would smear the surface and
  leave a stroke that could never be re-swept at another width. Moving the
  samples means the sweep rebuilds properly — caps, taper, parallel-transport
  frames and all.
- **A spherical brush, measured in metres.** A sketch is a 3D object, so a
  brush that took "everything under the cursor" regardless of depth would grab
  the far side of a form as readily as the near side. The ring in the scene
  shows both the radius and, at half of it, where the falloff is half strength.
- **Smoothstep falloff**, because a linear ramp leaves a visible crease at the
  rim of the brush: the rate of displacement jumps from something to nothing
  there, and warped and untouched geometry no longer meet flush.
- **Spacing repaired afterwards.** Pushing part of a stroke sideways stretches
  its rings until the sweep looks faceted; tightening one piles samples on top
  of each other. Both are fixed when the pen lifts — locally, so every sample
  the brush never reached stays exactly where it was. Doing it every frame
  instead would shift the ground under the next frame's falloff and the stroke
  would creep.
- **Coarse centrelines are densified on contact.** A rectangle from the shape
  tool is five points, so a brush parked in the middle of an edge had nothing
  to grab and did nothing at all while looking like it should. Whether the
  brush is over a stroke is now asked of the *line*, not of its samples, and
  the first time the brush arrives the stroke gains enough points to be worth
  moving.
- One undo entry for the whole gesture, holding the centrelines from before —
  a warp is not invertible the way an affine transform is, so there is no
  inverse to store instead.
- A selection narrows what the brush may touch; with nothing selected it takes
  whatever it covers, because having to select first would be a step in the way
  of every quick adjustment.

### Why this one does not go through the compute link

Stage 5 named liquify as work to dispatch to the PC. Having built both, that
was the wrong call, and it is worth saying why rather than quietly leaving the
seam unused.

The falloff itself is a linear scan over samples — cheap even on a dense
sketch, and guarded by a segment-distance test so strokes nowhere near the
brush cost almost nothing. What is actually expensive is re-sweeping
the warped tubes, every frame, and that has to happen on whatever machine is
about to draw them. Sending a warp round trip over Wi-Fi would add tens of
milliseconds between the pen and the ink for work measured in fractions of a
millisecond, which is the one trade a sketching app cannot make.

Booleans remain the right thing to offload: they are seconds of work, not
microseconds, and their result is wanted once rather than sixty times a second.

## Stage 5 — The compute link ✅

The desktop app runs Wisp natively, serves it to tablets on the same network,
and does their heavy work for them.

- **Electron**, not Tauri as originally planned: the compute host wants real
  Node processes to run `@wisp/core` in, and Electron already ships one.
- **Serving and offloading are separate things**, and easy to conflate. A page
  served from the desktop still runs entirely on the tablet's own processor.
  Only sending a job across and getting a mesh back makes anything faster.
- Pairing is a six-digit code, shown on the desktop as a QR so a tablet can
  scan the address and the code together. Remembered afterwards, so a device
  reconnects without asking again.
- Operations travel over a WebSocket against an allowlist, and are run in a
  pool of worker processes rather than on the host's UI thread.
- **Only jobs worth the trip are sent.** A round trip over Wi-Fi costs tens of
  milliseconds, so a stroke — a few kilobytes each way, microseconds of work —
  is always done locally, and booleans are the one thing dispatched.
- Falls back to a Web Worker in the page when nothing is paired, when the link
  drops mid-session, or when a compute process dies.
- The desktop app checks for updates and downloads them, then **stops and
  waits**: installing means quitting, and an app that closes a window with an
  hour of unsaved sketching in it to save somebody thirty seconds has done
  something unforgivable.

**Why it is built this way.** Rendering and pen input stay on the tablet.
Rendering on the PC and streaming video would put 30–60 ms of Wi-Fi latency
between the pen tip and the ink, which is the one thing a sketching app cannot
afford. Offloading *operations* keeps drawing local and immediate while the
expensive work happens on hardware that can do it quickly.

---

## Still to build

### Stage 2 continued — objects

- Primitives: box, sphere, cylinder, cone, ring — **as drawing surfaces**, not
  just objects. Feather's approach is to draw *onto* a primitive, which pairs
  with the surface-anchored sketch plane already built.
- A **joystick-style** transform widget in the scene, to sit alongside the
  exact steps that exist now — far easier to hit with a finger for a rough
  adjustment.
- Snapping to vertices, edges, midpoints, faces and the ground
- Partial eraser — split a stroke instead of deleting the whole thing

### Stage 4 — Import and export

- Export: glTF/GLB, OBJ, STL, PNG/JPEG snapshots
- **Turntable capture** — record an orbit as an animated GIF or video, which
  is how 3D sketches actually get shared
- Reference images: a floating, movable reference window, plus images placed
  on a plane to trace over
- A Blender import path, matching Feather's add-on

### Stage 5 continued — the compute link

- Discovery over mDNS, so a tablet finds the desktop without being shown an
  address to type or a code to scan
- More operations worth dispatching: subdivision, remesh, export encoding

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
- Performance: instanced stroke rendering, LOD for dense sketches. Measured on
  a software renderer: a stroke costs about 3,500 triangles, so 512 strokes is
  1.8 million and takes 7.4 ms a frame to draw. It scales linearly and is not
  urgent, but it is the next thing that will bite.
- Bundle splitting so first paint does not wait on all of Three.js

---

## On drawing staying responsive

The preview of a stroke in progress is rebuilt from scratch on every frame,
and it has to be: every ring's radius depends on the stroke's *total* length,
because the taper is a fraction of it. Adding a sample at the tip changes the
first ring. There is no correct way to append to the previous frame's mesh.

So a frame costs what the stroke has cost so far, and drawing a whole stroke
costs its length squared. Measured, in milliseconds of sweeping: a stroke
growing to 200 samples spends 5, to 400 spends 21, to 800 spends 89, to 1600
spends 378 — four times the work for twice the stroke. Driving the real app at
the sample density a digitiser actually produces, one sweep went from 0.3 ms to
1.8 ms and was still climbing at 1,548 samples; with eight symmetry copies that
is 14 ms a frame on a desktop CPU, and several times that on a tablet, sitting
directly between the pen moving and the ink appearing.

The preview now sweeps at most a fixed number of rings, shared between the
symmetry copies. Samples are collected about a screen pixel apart, so a long
stroke was carrying far more rings than the screen could show; thinning them
costs nothing visible and makes a frame cost the same whether the stroke is a
centimetre or ten metres long. On the same measurement the sweep went flat at
0.6 ms and the preview's triangle count stopped growing.

The thinning is display-only. What lands in the document is the full stroke —
there is an end-to-end test for exactly that, because a performance trick that
quietly lowered the resolution of somebody's drawing would be a bad bargain.

The same pass turned up a second fault, and a more visible one. Smoothing a
finished stroke is a round trip to a worker, measured at 200–250 ms on every
stroke, not just the first. The preview was being torn down at the *start* of
that window and the committed stroke only appeared at the end — so the ink
somebody had just drawn was missing from the screen in between. Watched frame
by frame, the pixel count in the stroke's own area went to zero. The preview
now stays up until the committed stroke has taken its place.

## Known gaps right now

- Transforms are exact steps from a menu; there is no drag handle in the scene
- Reshaping drops a shape's editable dimensions, for the same reason scaling
  does: a rectangle pushed out of true is no longer "80 by 50", and numbers
  that lie are worse than no numbers
- The reshape brush works on strokes only. A baked mesh — the result of a
  boolean — has no centreline left to push around, so the brush passes
  straight through it
- *Pull* held over a short stroke will draw the whole thing into a point, the
  way any pucker brush does. A stroke with no length has no surface, so it
  disappears from view rather than showing a stale one; it is still in the
  document and one undo brings it back
- A reshaped stroke that a symmetry axis had mirrored does not carry the warp
  across to its copies; symmetry applies as a stroke is drawn, not afterwards
- Scaling a stroke drops its editable dimensions, because the stored numbers
  would no longer describe it. Rotation and movement keep them.
- No 3D model export yet — PNG, JPEG and SVG work, but glTF, OBJ and STL do
  not (stage 4)
- SVG export is flat-shaded polygons, one per triangle: true vector, but large
  for a dense sketch and without the lighting of the WebGL view
- Shapes mirrored by symmetry lose their editable dimensions, since reflected
  parameters would need a reflected plane to stay honest
- The stroke font covers ASCII letters, digits and a little punctuation;
  accented characters fall back to the unaccented capital
- Reshaping re-sweeps every warped tube on the main thread, once per frame.
  That is the right place for it — see stage 2.5 — but it does mean a brush
  set wide enough to cover a very dense sketch will drop frames while it is
  held.
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
