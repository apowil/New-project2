# Wisp

A 3D sketching studio for Android tablets — draw strokes in space with a pen,
orbit around them, build up form. Everything is stored on the device.

Think [feather.art](https://www.feather.art/), but for Android, and with an
extra trick: pair the tablet with the Windows app and the heavy operations run
on the PC while the pen stays immediate and local.

**Sketching core, persistence and symmetry are built.** See
[docs/ROADMAP.md](docs/ROADMAP.md) for what is done and what is next.

## Try it

```bash
npm install
npm run dev
```

Vite prints a `Network:` URL — the dev server already binds every interface,
so no extra flag is needed. Open that URL on the tablet over the same Wi-Fi
and use Chrome's *Add to Home screen* to install it as an app. No account, no
internet, no deployment step.

On Windows, two things that bite on a first run: PowerShell blocks npm's `.ps1`
wrapper by default (run the commands from `cmd.exe` instead), and Windows
Firewall prompts the first time Node opens a port — allow it on *private*
networks or the tablet cannot reach the server.

```bash
npm run build      # production bundle
npm test           # core unit tests
npm run e2e        # browser tests, real WebGL
npm run typecheck
```

## Using it

| Input        | Action           |
| ------------ | ---------------- |
| Pen          | Draw             |
| One finger   | Orbit            |
| Two fingers  | Pan and zoom     |
| Mouse left   | Draw             |
| Mouse right  | Orbit            |
| Wheel        | Zoom             |

Press and hold with a finger — or middle-click — to re-centre the orbit on
whatever is under it.

Keys: `D` draw · `S` select · `R` shapes · `T` text · `E` erase · `P` place
sketch plane · `F` frame
everything · `[` `]` brush size · `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo ·
`Ctrl+C` / `Ctrl+X` / `Ctrl+V` copy, cut, paste · `Ctrl+A` select the layer ·
`Del` delete · `Esc` deselect · `Ctrl+S` save · `Ctrl+O` sketches.

With the **select** tool, tap a stroke to pick it, drag a box to catch
several, and drag something already selected to move it. The actions for a
selection appear in a small bar just above it.

**Sketch planes** are the thing to understand. Strokes land on a plane in
space. By default that plane faces you, so drawing feels like paper — then you
orbit, and draw again on a new plane, and the form builds up in depth. The
*Surface* mode lets you tap something you already drew and plant the plane on
it, so you can draw directly onto existing geometry.

## What is here

- Pressure-sensitive strokes swept into real lit 3D meshes, not flat decals
- Full digitiser sample rate via coalesced pointer events, 1€-filtered
- Undo/redo, layers, eraser
- Camera-facing / ground / front / side / surface sketch planes
- Symmetry across X, Y and Z — any combination, up to eight copies at once
- Select, move, copy, cut and paste — including pasting into another layer
- Boolean operations: merge, subtract, intersect, and a non-cutting combine
- Layers: merge down, duplicate with contents, move a selection between them
- Six brushes: round brush, flat brush, pen, pencil, and water markers
- Shape tools: line, rectangle, circle, polygon, polyline and spline, with
  live measurements and exact sizes you can type afterwards
- Text in a single-stroke technical face, drawn with the current brush
- Units in mm, cm, m, inches or feet — display only, never the geometry
- Export to PNG, JPEG and SVG, as well as the reopenable `.wisp` file
- Full colour picker with recent colours, plus quick swatches
- Light and dark themes, following the system by default
- Reference images you can float over the canvas and trace straight through
- Preset views, an orbit pad and zoom controls, for moving without gestures
- Autosave, a project library with thumbnails, rename, duplicate, and
  `.wisp` import/export
- Installable, offline-capable PWA
- Renders on demand, so a still sketch costs no battery

## What is not here yet

No selection or transform tools, so strokes cannot be edited after they are
drawn — only erased (stage 2). No liquify (stage 2.5). No glTF/OBJ/image
export (stage 4). The PC compute link is designed for but not built (stage 5).
The Android APK shell is stage 6.

## Layout

```
packages/core     dependency-free sketching core — geometry, document, history
apps/studio       the app: React panels, Three.js viewport
e2e               Playwright tests against real WebGL
docs              architecture and roadmap
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains why the core has no
dependencies, why React is kept out of the drawing path, and how the PC
offload is meant to slot in.
