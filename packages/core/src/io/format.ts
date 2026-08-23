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
 * 2 added baked meshes; 3 added per-node names, hiding, locking, grouping and
 * dimension annotations. Older files still load — the reader only rejects
 * versions it is too old to understand, and every field added since is
 * optional, so a version 1 file simply arrives with none of them set.
 */
export const WISP_FORMAT_VERSION = 3;

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

/** The per-node fields that are independent of geometry. */
export interface CommonManifestFields {
  id: string;
  layerId: string;
  createdAt: number;
  label?: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
}

export interface StrokeManifestNode extends CommonManifestFields {
  type: 'stroke';
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

export interface BakedManifestNode extends CommonManifestFields {
  type: 'baked';
  label: string;
  style: Record<string, unknown>;
  geometry: BakedRange;
}

export interface MeshManifestNode extends CommonManifestFields {
  type: 'mesh';
  style: Record<string, unknown>;
  primitive: string;
  transform: Record<string, unknown>;
}

/** Wholly described by the manifest — it has no binary section of its own. */
export interface AnnotationManifestNode extends CommonManifestFields {
  type: 'annotation';
  kind: string;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  offset: number;
  offsetDirection: { x: number; y: number; z: number };
  textSize: number;
  style: Record<string, unknown>;
}

export type ManifestNode =
  | StrokeManifestNode
  | MeshManifestNode
  | BakedManifestNode
  | AnnotationManifestNode;

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
