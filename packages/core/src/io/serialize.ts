import {
  DEFAULT_STROKE_STYLE,
  type Layer,
  type MeshNode,
  type SceneNode,
  type SketchDocument,
  type StrokeNode,
  type StrokeStyle,
} from '../document/types.js';
import { type StrokeSample } from '../stroke/resample.js';
import { vec3, type Vec3 } from '../math/vec3.js';
import {
  SAMPLE_STRIDE,
  WISP_FORMAT_VERSION,
  WISP_MAGIC,
  WispFormatError,
  align4,
  type ManifestNode,
  type StrokeManifestNode,
  type WispManifest,
} from './format.js';

const HEADER_BYTES = 12;

/** Encodes a document into a `.wisp` buffer. */
export function serializeDocument(doc: SketchDocument): ArrayBuffer {
  const strokes: StrokeNode[] = [];
  const nodes: ManifestNode[] = [];

  // First pass: lay out the binary section and build the manifest.
  let binaryBytes = 0;
  for (const id of doc.order) {
    const node = doc.nodes.get(id);
    if (!node) continue;

    if (node.type === 'stroke') {
      nodes.push({
        id: node.id,
        type: 'stroke',
        layerId: node.layerId,
        createdAt: node.createdAt,
        style: { ...node.style },
        planeNormal: { ...node.planeNormal },
        samples: { byteOffset: binaryBytes, count: node.samples.length },
      });
      strokes.push(node);
      binaryBytes += node.samples.length * SAMPLE_STRIDE;
    } else {
      nodes.push({
        id: node.id,
        type: 'mesh',
        layerId: node.layerId,
        createdAt: node.createdAt,
        style: { ...node.style },
        primitive: node.primitive,
        transform: {
          position: { ...node.transform.position },
          rotation: { ...node.transform.rotation },
          scale: { ...node.transform.scale },
        },
      });
    }
  }

  const manifest: WispManifest = {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map((layer) => ({ ...layer })),
    // Only ids that survived the lookup above, so the order can never dangle.
    order: nodes.map((node) => node.id),
    nodes,
  };

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestPadded = align4(manifestBytes.length);
  const total = HEADER_BYTES + manifestPadded + binaryBytes;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  view.setUint32(0, WISP_MAGIC, true);
  view.setUint32(4, WISP_FORMAT_VERSION, true);
  view.setUint32(8, manifestBytes.length, true);
  new Uint8Array(buffer, HEADER_BYTES, manifestBytes.length).set(manifestBytes);

  // Second pass: write the samples where the manifest says they are.
  const binaryStart = HEADER_BYTES + manifestPadded;
  const floats = new Float32Array(buffer, binaryStart, binaryBytes / 4);

  let f = 0;
  for (const stroke of strokes) {
    for (const sample of stroke.samples) {
      floats[f++] = sample.position.x;
      floats[f++] = sample.position.y;
      floats[f++] = sample.position.z;
      floats[f++] = sample.pressure;
    }
  }

  return buffer;
}

/**
 * Decodes a `.wisp` buffer. Throws {@link WispFormatError} with a readable
 * reason for anything malformed — this is fed by user-chosen files, so a
 * corrupt one has to fail cleanly rather than produce a half-built document.
 */
export function deserializeDocument(buffer: ArrayBuffer): SketchDocument {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new WispFormatError('File is too short to be a Wisp sketch.');
  }

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== WISP_MAGIC) {
    throw new WispFormatError('Not a Wisp sketch file.');
  }

  const version = view.getUint32(4, true);
  if (version > WISP_FORMAT_VERSION) {
    throw new WispFormatError(
      `This sketch was saved by a newer version of Wisp (format ${version}).`,
    );
  }

  const manifestLength = view.getUint32(8, true);
  const manifestPadded = align4(manifestLength);
  if (HEADER_BYTES + manifestPadded > buffer.byteLength) {
    throw new WispFormatError('Sketch file is truncated.');
  }

  let manifest: WispManifest;
  try {
    const bytes = new Uint8Array(buffer, HEADER_BYTES, manifestLength);
    manifest = JSON.parse(new TextDecoder().decode(bytes)) as WispManifest;
  } catch {
    throw new WispFormatError('Sketch file has an unreadable manifest.');
  }

  const binaryStart = HEADER_BYTES + manifestPadded;
  const binaryBytes = buffer.byteLength - binaryStart;

  const layers = readLayers(manifest.layers);
  const nodes = new Map<string, SceneNode>();
  const order: string[] = [];
  const layerIds = new Set(layers.map((layer) => layer.id));

  for (const entry of manifest.nodes ?? []) {
    // Drop nodes pointing at a layer that is not in the file rather than
    // resurrecting them invisibly on some other layer.
    if (!layerIds.has(entry.layerId)) continue;

    const node =
      entry.type === 'stroke'
        ? readStroke(entry, buffer, binaryStart, binaryBytes)
        : readMesh(entry);

    if (!node) continue;
    nodes.set(node.id, node);
    order.push(node.id);
  }

  const activeLayerId = layerIds.has(manifest.activeLayerId)
    ? manifest.activeLayerId
    : (layers[0]?.id ?? '');

  return {
    id: String(manifest.id ?? ''),
    name: String(manifest.name ?? 'Untitled sketch'),
    revision: 0,
    layers,
    activeLayerId,
    nodes,
    order,
    createdAt: Number(manifest.createdAt) || Date.now(),
    updatedAt: Number(manifest.updatedAt) || Date.now(),
  };
}

function readLayers(raw: Array<Record<string, unknown>> | undefined): Layer[] {
  const layers: Layer[] = [];
  for (const entry of raw ?? []) {
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (!id) continue;
    layers.push({
      id,
      name: typeof entry.name === 'string' ? entry.name : 'Layer',
      visible: entry.visible !== false,
      locked: entry.locked === true,
      opacity: clamp01(Number(entry.opacity ?? 1)),
    });
  }
  // A document with no layers cannot be drawn on; give it one back.
  if (layers.length === 0) {
    layers.push({ id: 'layer_recovered', name: 'Layer 1', visible: true, locked: false, opacity: 1 });
  }
  return layers;
}

function readStroke(
  entry: StrokeManifestNode,
  buffer: ArrayBuffer,
  binaryStart: number,
  binaryBytes: number,
): StrokeNode | null {
  const range = entry.samples;
  if (!range || range.count <= 0) return null;

  const byteLength = range.count * SAMPLE_STRIDE;
  if (range.byteOffset < 0 || range.byteOffset + byteLength > binaryBytes) {
    throw new WispFormatError(`Stroke "${entry.id}" points outside the file.`);
  }

  const floats = new Float32Array(buffer, binaryStart + range.byteOffset, range.count * 4);
  const samples: StrokeSample[] = new Array(range.count);

  for (let i = 0; i < range.count; i += 1) {
    const f = i * 4;
    samples[i] = {
      position: vec3(floats[f]!, floats[f + 1]!, floats[f + 2]!),
      pressure: floats[f + 3]!,
    };
  }

  return {
    id: entry.id,
    type: 'stroke',
    layerId: entry.layerId,
    samples,
    style: readStyle(entry.style),
    planeNormal: readVec3(entry.planeNormal, vec3(0, 1, 0)),
    createdAt: Number(entry.createdAt) || Date.now(),
  };
}

function readMesh(entry: ManifestNode): MeshNode | null {
  if (entry.type !== 'mesh') return null;
  const transform = entry.transform ?? {};
  return {
    id: entry.id,
    type: 'mesh',
    layerId: entry.layerId,
    primitive: (entry.primitive as MeshNode['primitive']) ?? 'box',
    transform: {
      position: readVec3(transform.position, vec3()),
      rotation: readVec3(transform.rotation, vec3()),
      scale: readVec3(transform.scale, vec3(1, 1, 1)),
    },
    style: readStyle(entry.style),
    createdAt: Number(entry.createdAt) || Date.now(),
  };
}

/** Fills in anything a file from an older version did not carry. */
function readStyle(raw: unknown): StrokeStyle {
  const source = (raw ?? {}) as Partial<StrokeStyle>;
  return {
    color: typeof source.color === 'string' ? source.color : DEFAULT_STROKE_STYLE.color,
    width: positive(source.width, DEFAULT_STROKE_STYLE.width),
    flatness: positive(source.flatness, DEFAULT_STROKE_STYLE.flatness),
    sides: Math.max(3, Math.floor(Number(source.sides) || DEFAULT_STROKE_STYLE.sides)),
    opacity: clamp01(Number(source.opacity ?? DEFAULT_STROKE_STYLE.opacity)),
    roughness: clamp01(Number(source.roughness ?? DEFAULT_STROKE_STYLE.roughness)),
    metalness: clamp01(Number(source.metalness ?? DEFAULT_STROKE_STYLE.metalness)),
  };
}

function readVec3(raw: unknown, fallback: Vec3): Vec3 {
  const source = raw as Partial<Vec3> | undefined;
  if (!source) return fallback;
  const x = Number(source.x);
  const y = Number(source.y);
  const z = Number(source.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return fallback;
  return vec3(x, y, z);
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;

const positive = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
