/**
 * The `.wisp` container.
 *
 * A sketch is mostly stroke samples — four floats each, thousands per drawing.
 * Encoding those as JSON numbers costs roughly six times the bytes and loses
 * exactness on the round trip, so the format splits in two:
 *
 *   header │ JSON manifest │ binary sample data
 *
 * The manifest carries structure (layers, styles, draw order) and points into
 * the binary section by byte offset. The binary section is raw little-endian
 * Float32, which is what the geometry builder wants anyway.
 *
 *   bytes 0..3    magic "WISP"
 *   bytes 4..7    format version, u32
 *   bytes 8..11   manifest length in bytes, u32
 *   bytes 12..    manifest UTF-8, zero-padded to a 4-byte boundary
 *   then          sample data, 4 floats per sample: x, y, z, pressure
 *
 * Everything is little-endian regardless of host, so a file written on the
 * tablet reads identically on the PC.
 */

export const WISP_MAGIC = 0x50534957; // "WISP" read as u32 little-endian
/**
 * 2 added baked meshes. Version 1 files still load — the reader only rejects
 * versions it is too old to understand.
 */
export const WISP_FORMAT_VERSION = 2;

/** Bytes per stroke sample: x, y, z, pressure. */
export const SAMPLE_STRIDE = 16;

export class WispFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WispFormatError';
  }
}

export interface SampleRange {
  /** Byte offset into the binary section. Always 4-byte aligned. */
  byteOffset: number;
  count: number;
}

export interface StrokeManifestNode {
  id: string;
  type: 'stroke';
  layerId: string;
  createdAt: number;
  style: Record<string, unknown>;
  planeNormal: { x: number; y: number; z: number };
  /** Present only for shapes drawn with a shape tool. */
  shape?: unknown;
  samples: SampleRange;
}

/** Byte offsets into the binary section for one baked mesh. */
export interface BakedRange {
  vertexCount: number;
  positionsOffset: number;
  normalsOffset: number;
  indexCount: number;
  indicesOffset: number;
}

export interface BakedManifestNode {
  id: string;
  type: 'baked';
  layerId: string;
  createdAt: number;
  label: string;
  style: Record<string, unknown>;
  geometry: BakedRange;
}

export interface MeshManifestNode {
  id: string;
  type: 'mesh';
  layerId: string;
  createdAt: number;
  style: Record<string, unknown>;
  primitive: string;
  transform: Record<string, unknown>;
}

export type ManifestNode = StrokeManifestNode | MeshManifestNode | BakedManifestNode;

export interface WispManifest {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  activeLayerId: string;
  layers: Array<Record<string, unknown>>;
  order: string[];
  nodes: ManifestNode[];
}

/** Rounds up to the next 4-byte boundary so Float32Array views stay aligned. */
export const align4 = (value: number): number => (value + 3) & ~3;
