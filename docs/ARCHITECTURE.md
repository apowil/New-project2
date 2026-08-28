# Architecture

## The decision everything else follows from

Wisp has to ship as an Android app, as a Windows app, and — the unusual
requirement — as something the tablet can load *from* the Windows machine so
the PC does the heavy lifting.

That last one rules out a native Android renderer. If the tablet is going to
run the app served from a PC, the app has to be web technology. So there is
one core, written once in TypeScript, delivered three ways:

```
                    ┌──────────────────────┐
                    │   @wisp/core (TS)    │  no runtime dependencies
                    │  document · history  │  runs anywhere JS runs
                    │  geometry · ops      │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    │   @wisp/studio       │  React UI + Three.js viewport
                    └──────────┬───────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
   PWA / Android          Windows desktop        Tablet ⇄ PC
   WebView shell          (Electron)             compute link
```

## Why the core has zero dependencies

`packages/core` imports nothing. Not Three.js, not a maths library. Every
vector helper is hand-written in `src/math/`.

That is deliberate. The same module has to run in three places: the browser's
main thread, a Web Worker on the tablet, and a Node process on the PC that
never touches a DOM. A dependency-free core makes "ship this function to the
PC and run it there" a serialisation problem rather than a porting problem.

Three.js lives entirely in the studio app, where it belongs, and only ever
consumes plain `Float32Array`s the core produced.

## Rendering is on demand

A sketching app is a still image most of the time. The render loop only draws
a frame when something changed — a stroke grew, the camera is still settling,
a panel changed a value. `Viewport.requestRender()` sets a dirty flag; the
camera's damping reports whether it is still in motion.

On a tablet this is the difference between an app you can draw with for an
afternoon and one that empties the battery in ninety minutes.

## React is not in the drawing path

The document is a mutable graph that changes on every pointer move. Pushing
that through React's reconciler would put UI work on the critical path between
the pen moving and ink appearing.

So the document and its history live in a plain object (`session` in
`state/store.ts`), the viewport reads it directly, and React is used only for
the panels — which re-render off a small mirrored slice of state and a
`revision` counter.

## Editing a stroke means editing its centreline

A stroke is stored as the samples along its middle, not as the triangles it is
swept into. Everything that changes a stroke after the fact goes through those
samples and lets the sweep rebuild: the liquify brush pushes them around, a
restyle re-sweeps them at a new width, a transform maps them through an affine.

Warping the mesh instead would be easier and wrong. It smears the surface,
breaks the parallel-transport frames the next section is about, and leaves
geometry that can never be re-swept at another width — which is precisely the
state a boolean result is in, and the reason the file format has to carry
baked meshes as a separate kind of node.

The one thing this costs: a warp moves samples without adding or removing any,
so pushing part of a stroke sideways stretches its rings and tightening one
piles them up. Both are repaired when the gesture ends, locally, so samples the
brush never reached stay exactly where they were.

## The preview is not the stroke

While a stroke is being drawn, what is on screen is a preview: swept with half
the cross-section sides, and thinned to a fixed number of rings. It is rebuilt
whole on every frame, because every ring depends on the stroke's total length —
the taper is a fraction of it — so there is nothing to append to.

That rebuild is why the thinning exists. Uncapped, a frame costs what the
stroke has cost so far, and drawing one costs its length squared; capped, a
frame costs the same however long the stroke gets. Samples arrive about a
screen pixel apart, so the rings being dropped were never visible anyway.

The full-resolution surface is built once, when the pen lifts, from the
complete sample set. Nothing thinned is ever committed.

The preview also has to outlive the pen. Smoothing the finished stroke is a
round trip to a worker taking a couple of hundred milliseconds, so tearing the
preview down when the pointer lifts leaves the ink missing from the screen
until the committed stroke arrives. It stays up until the real mesh is in the
scene, and a generation counter stops a commit that finishes late from pulling
down a preview that now belongs to the next stroke.

## Two things that decide how a stroke looks

**Parallel-transport frames.** Sweeping a cross-section along a curve needs a
reference frame at each step. Three's `TubeGeometry` uses Frenet frames, which
spin violently wherever curvature flips — visible as a twist in the middle of
a smooth stroke. `stroke/geometry.ts` instead rotates each frame by the minimum
amount that keeps it perpendicular to the new tangent, so the cross-section
never rolls about its own axis. There is a regression test for exactly this.

**Coalesced pointer events.** A 240 Hz digitiser delivers roughly four samples
per 60 Hz frame, but a naive `pointermove` handler sees one. Reading
`event.getCoalescedEvents()` recovers the rest. Dropping them is the single
biggest cause of strokes that look faceted rather than smooth.

## The gesture model

Input *type* decides intent, so nothing has to be modal:

| Input         | Action              |
| ------------- | ------------------- |
| Pen           | Draw                |
| One finger    | Orbit               |
| Two fingers   | Pan **and** zoom    |
| Mouse left    | Draw                |
| Mouse middle  | Pan                 |
| Mouse right   | Orbit               |
| Wheel         | Zoom                |

Because the pen is a distinct `pointerType` from touch, drawing and camera
control never contend for the same gesture — which is why pinch-to-zoom can
exist here without fighting orbit. Touch is ignored entirely while the pen is
on or near the glass, which is the palm rejection.

The camera controller is hand-written rather than `OrbitControls`, because
`OrbitControls` claims pointer events on its element and makes this split
impossible to express.

## Operations, and where they run

Anything expensive is an *operation*: a serialisable request/response pair
declared in `core/src/ops/types.ts`, rather than a direct function call.

```ts
await session.ops.run('processStroke', { samples, spacing, ... });
```

There are four runners now, and no call site knows which one it has: an inline
one, a Web Worker one (the default in a browser), a pool of real processes
inside the desktop app, and a link runner that speaks to a paired PC over a
WebSocket. Adding the PC-offload feature changed no call sites at all, which
was the entire point of the indirection.

**What is not an operation, and why.** Reshaping a stroke — the liquify brush
— warps centrelines inline on the main thread, deliberately. Sending a warp to
another machine would put tens of milliseconds of Wi-Fi between the pen and the
ink to save work measured in fractions of a millisecond, and the expensive part
of a warp is re-sweeping the tubes, which has to happen on the machine that is
about to draw them. Only jobs that cost seconds and are wanted once — booleans
— are worth the trip.

## Layout

```
packages/core/          no dependencies, unit-tested, portable
  math/                 vec3, sketch planes, ray/plane intersection
  stroke/               1€ filter, simplify/resample, liquify, preview
                        thinning, mesh sweeping
  document/             document, layers, nodes, ids
  history/              command stack and the concrete commands
  ops/                  operation contracts + the inline runner

apps/studio/            the app
  viewport/             Three.js scene, camera, gestures, plane and brush aids
  tools/                draw, shape, text, dimension, liquify, tool routing
  ops/                  the worker, desktop-pool and PC-link runners
  state/                session (mutable) + zustand store (UI mirror)
  ui/                   React panels

e2e/                    Playwright tests driving real pointer events
```

## Testing

- **Unit** (`vitest`) — the core's geometry and history logic, including a
  test that asserts strokes do not twist on curvature flips.
- **End-to-end** (`playwright`) — a real Chromium with WebGL2 on SwiftShader,
  driven with genuine pointer events. It asserts that a drag produces a
  stroke, that pixels actually change in the framebuffer, that pressure
  reaches the geometry, and that undo/redo and the eraser work.

The e2e suite runs headless with no GPU, which means CI can catch a broken
render, not just a broken build.
