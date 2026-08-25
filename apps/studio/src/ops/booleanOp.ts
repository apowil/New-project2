import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import {
  buildStrokeGeometry,
  type OpRequestMap,
  type OpResponseMap,
  type SolidInput,
} from '@wisp/core';

/**
 * Boolean operations on sketch geometry.
 *
 * A pure function of its request: no DOM, no viewport, no store. That is what
 * lets the identical code run on the main thread, inside a Web Worker, or on a
 * paired desktop — and running the *same* code in all three is what guarantees
 * a sketch does not change shape depending on where it was computed.
 *
 * What works and what does not, because this is the part with real limits:
 *
 * A stroke is a swept tube with caps, so on its own it is a closed manifold
 * solid and CSG handles it. What CSG cannot handle is a solid that intersects
 * *itself* — a stroke that loops back and crosses its own body. There is no
 * well-defined inside for such a shape, and the evaluator will either produce
 * garbage or fall over. That is a property of the input, not a bug to fix
 * here, so the failure is reported rather than hidden.
 *
 * The result is a baked mesh: the centreline is gone, so it can no longer be
 * re-swept at a different width. That is inherent — after cutting one tube
 * with another the surface no longer corresponds to any single curve.
 */

const CSG_OPERATION = {
  union: ADDITION,
  subtract: SUBTRACTION,
  intersect: INTERSECTION,
} as const;

/** Rebuilds one input into plain triangles. */
function toGeometry(solid: SolidInput): THREE.BufferGeometry | null {
  if (solid.kind === 'mesh') {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(solid.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(solid.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(solid.indices, 1));
    return geometry;
  }

  // A centreline arrives instead of triangles; sweeping is deterministic, so
  // this reproduces exactly what the sender would have drawn.
  const built = buildStrokeGeometry(solid.samples, solid.options);
  if (!built) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));
  return geometry;
}

interface Buffers {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Concatenates geometry without cutting anything.
 *
 * Always succeeds, including on self-intersecting input, which makes it the
 * fallback when a true boolean cannot be evaluated. Interior surfaces remain,
 * so it is a grouping operation rather than a solid one.
 */
function joinGeometries(geometries: THREE.BufferGeometry[]): Buffers {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.getAttribute('position').count;
    indexCount += geometry.getIndex()?.count ?? 0;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    if (!index) continue;

    positions.set(position.array as Float32Array, vertexOffset * 3);
    normals.set(normal.array as Float32Array, vertexOffset * 3);

    // Indices are per-geometry, so they shift by however many vertices came
    // before this one.
    for (let i = 0; i < index.count; i += 1) {
      indices[indexOffset + i] = index.getX(i) + vertexOffset;
    }

    vertexOffset += position.count;
    indexOffset += index.count;
  }

  return { positions, normals, indices };
}

function extract(geometry: THREE.BufferGeometry): Buffers {
  const position = geometry.getAttribute('position');
  const normalAttribute = geometry.getAttribute('normal');

  // The evaluator over-allocates its attribute buffers and reports the real
  // length through `count`. Copying `array` wholesale would drag the unused
  // tail along as vertices at the origin — invisible in the render because
  // nothing indexes them, but they inflate the bounding box, bloat the saved
  // file, and quietly corrupt any later boolean that uses this as an input.
  const used = position.count * position.itemSize;
  const positions = (position.array as Float32Array).slice(0, used);
  const normals = normalAttribute
    ? (normalAttribute.array as Float32Array).slice(
        0,
        normalAttribute.count * normalAttribute.itemSize,
      )
    : new Float32Array(positions.length);

  const index = geometry.getIndex();
  const indices = index
    ? Uint32Array.from({ length: index.count }, (_, i) => index.getX(i))
    : // The evaluator can return non-indexed geometry; build the trivial index.
      Uint32Array.from({ length: position.count }, (_, i) => i);

  return { positions, normals, indices };
}

/** The registered implementation of the `evaluateBoolean` operation. */
export function evaluateBooleanOp(
  request: OpRequestMap['evaluateBoolean'],
): OpResponseMap['evaluateBoolean'] {
  const { op, solids } = request;

  if (solids.length < 2) {
    return { ok: false, reason: 'Select at least two strokes first.' };
  }

  const geometries: THREE.BufferGeometry[] = [];
  for (const solid of solids) {
    const geometry = toGeometry(solid);
    if (geometry) geometries.push(geometry);
  }

  if (geometries.length < 2) {
    return { ok: false, reason: 'Those items have no geometry to combine.' };
  }

  try {
    if (op === 'join') {
      return { ok: true, ...joinGeometries(geometries) };
    }

    const evaluator = new Evaluator();
    evaluator.useGroups = false;
    // The default set includes 'uv', and the evaluator reads it off both
    // inputs unconditionally. Stroke geometry carries UVs but baked results
    // do not, so narrowing to what every input actually has keeps mixed
    // stroke/baked operations working.
    evaluator.attributes = ['position', 'normal'];

    let accumulated = new Brush(geometries[0]!);
    accumulated.updateMatrixWorld();

    for (let i = 1; i < geometries.length; i += 1) {
      const next = new Brush(geometries[i]!);
      next.updateMatrixWorld();
      accumulated = evaluator.evaluate(accumulated, next, CSG_OPERATION[op]);
      accumulated.updateMatrixWorld();
    }

    const geometry = accumulated.geometry;
    if (!geometry || geometry.getAttribute('position').count === 0) {
      return {
        ok: false,
        reason:
          op === 'intersect'
            ? 'Those shapes do not overlap, so there is nothing in common.'
            : 'The operation removed everything.',
      };
    }

    geometry.computeVertexNormals();
    return { ok: true, ...extract(geometry) };
  } catch (error) {
    // Keep the real reason wherever this is running: the message below names
    // the most likely cause but must not claim to know it.
    console.error('Boolean evaluation failed', error);
    return {
      ok: false,
      reason:
        'Those shapes could not be combined. A stroke that crosses its own body ' +
        'has no well-defined inside, which is the usual cause — Combine works ' +
        'on any shapes.',
    };
  } finally {
    for (const geometry of geometries) geometry.dispose();
  }
}
