import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  buildStrokeGeometry,
  visibleNodes,
  type BakedMeshNode,
  type SketchDocument,
  type StrokeGeometry,
  type StrokeNode,
  type StrokeStyle,
  type Vec3,
} from '@wisp/core';

import { SCENE_THEMES, type ResolvedTheme, type SceneTheme } from '../state/theme.js';
import { OrbitCamera } from './camera.js';
import { PlaneIndicator } from './sketchPlane.js';
import { applyStyle, makeStrokeMaterial, toBufferGeometry } from './strokeMesh.js';

/** The parts of a style that change the swept surface rather than its shading. */
export const geometryOptions = (style: StrokeStyle) => ({
  width: style.width,
  sides: style.sides,
  flatness: style.flatness,
  taper: style.taper,
  pressureCurve: style.pressureCurve,
  minPressureScale: style.minPressureScale,
});

interface StrokeEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** Identity of the data the current geometry was built from. */
  samplesRef: unknown;
  styleRef: unknown;
  layerOpacity: number;
  selected?: boolean;
}

export interface SurfaceHit {
  nodeId: string;
  point: Vec3;
  normal: Vec3;
}

/**
 * Owns the WebGL side of the app: scene, lights, the meshes mirroring the
 * document, and the render loop.
 *
 * Rendering is on demand. A sketching app is static most of the time — the
 * scene only changes while a stroke is growing or the camera is settling — and
 * a tablet running a continuous 60 fps loop for a still image burns battery
 * for nothing.
 */
export class Viewport {
  readonly camera: OrbitCamera;
  readonly scene = new THREE.Scene();
  readonly planeIndicator = new PlaneIndicator();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly strokeGroup = new THREE.Group();
  private readonly entries = new Map<string, StrokeEntry>();
  private readonly raycaster = new THREE.Raycaster();

  private readonly previewMeshes: THREE.Mesh[] = [];
  private previewMaterial: THREE.MeshStandardMaterial | null = null;
  private grid: THREE.GridHelper | null = null;
  private theme: ResolvedTheme = 'dark';

  private frameHandle = 0;
  private dirty = true;
  private running = false;
  private lastRevision = -1;
  private resizeObserver: ResizeObserver | null = null;

  /** Set by the app so the render loop can advance an in-progress stroke. */
  onBeforeRender: (() => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // Needed so a screenshot / export can read the framebuffer back.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color(SCENE_THEMES.dark.background);
    this.scene.fog = new THREE.Fog(SCENE_THEMES.dark.fog, 24, 110);

    this.setupEnvironment();
    this.setupGround();

    this.scene.add(this.strokeGroup);
    this.scene.add(this.planeIndicator.object);

    this.camera = new OrbitCamera(this.aspect);
    this.camera.setView(Math.PI * 0.25, Math.PI * 0.36, 6, new THREE.Vector3(0, 0.6, 0));

    this.observeResize();
    this.resize();
  }

  private get aspect(): number {
    const { clientWidth, clientHeight } = this.canvas;
    return clientHeight > 0 ? clientWidth / clientHeight : 1;
  }

  private setupEnvironment(): void {
    // RoomEnvironment gives PBR materials something to reflect without
    // shipping an HDR file — it keeps the bundle small and works offline.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = environment.texture;
    this.scene.environmentIntensity = SCENE_THEMES[this.theme].environmentIntensity;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 8, 5);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x9ec7ff, 0.7);
    rim.position.set(-6, 3, -4);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a1a1e, 0.5));
  }

  private setupGround(): void {
    this.rebuildGrid(SCENE_THEMES[this.theme]);
  }

  private rebuildGrid(palette: SceneTheme): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }

    // GridHelper bakes its colours into vertex data, so a theme change means
    // building a new one rather than tweaking a material.
    const grid = new THREE.GridHelper(40, 40, palette.gridMajor, palette.gridMinor);
    const material = grid.material as THREE.Material;
    material.transparent = true;
    material.opacity = palette.gridOpacity;
    material.depthWrite = false;
    grid.position.y = 0;

    this.grid = grid;
    this.scene.add(grid);
  }

  /** Repaints the scene for a light or dark surround. */
  setTheme(theme: ResolvedTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;

    const palette = SCENE_THEMES[theme];
    (this.scene.background as THREE.Color).set(palette.background);
    (this.scene.fog as THREE.Fog).color.set(palette.fog);
    this.scene.environmentIntensity = palette.environmentIntensity;
    this.rebuildGrid(palette);
    this.requestRender();
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height, false);
    this.camera.setAspect(this.aspect);
    this.requestRender();
  }

  requestRender(): void {
    this.dirty = true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (): void => {
      if (!this.running) return;
      this.frameHandle = requestAnimationFrame(loop);

      this.onBeforeRender?.();
      const cameraMoving = this.camera.update();
      if (this.dirty || cameraMoving) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera.camera);
      }
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  /**
   * Brings the scene in line with the document. Cheap when nothing changed:
   * a revision check short-circuits, and unchanged strokes keep their meshes.
   */
  syncDocument(doc: SketchDocument, force = false): void {
    if (!force && doc.revision === this.lastRevision) return;
    this.lastRevision = doc.revision;

    const layerOpacity = new Map(doc.layers.map((layer) => [layer.id, layer.opacity]));
    const seen = new Set<string>();

    for (const node of visibleNodes(doc)) {
      if (node.type === 'stroke') {
        seen.add(node.id);
        this.syncStroke(node, layerOpacity.get(node.layerId) ?? 1);
      } else if (node.type === 'baked') {
        seen.add(node.id);
        this.syncBaked(node, layerOpacity.get(node.layerId) ?? 1);
      }
      // 'mesh' primitives arrive in stage 2.
    }

    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.strokeGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      this.entries.delete(id);
    }

    this.requestRender();
  }

  /**
   * Baked geometry has no centreline to re-sweep, so its buffers are uploaded
   * as-is and only re-uploaded if the arrays themselves are replaced.
   */
  private syncBaked(node: BakedMeshNode, layerOpacity: number): void {
    const existing = this.entries.get(node.id);

    if (!existing) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(node.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(node.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(node.indices, 1));
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();

      const material = makeStrokeMaterial(node.style);
      material.opacity = node.style.opacity * layerOpacity;
      material.transparent = material.opacity < 1;
      // A cut surface shows its inside where it was opened.
      material.side = THREE.DoubleSide;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.nodeId = node.id;
      this.strokeGroup.add(mesh);

      this.entries.set(node.id, {
        mesh,
        material,
        samplesRef: node.positions,
        styleRef: node.style,
        layerOpacity,
      });
      return;
    }

    if (existing.styleRef !== node.style || existing.layerOpacity !== layerOpacity) {
      applyStyle(existing.material, node.style);
      existing.material.opacity = node.style.opacity * layerOpacity;
      existing.material.transparent = existing.material.opacity < 1;
      existing.material.side = THREE.DoubleSide;
      existing.styleRef = node.style;
      existing.layerOpacity = layerOpacity;
    }
  }

  /**
   * Highlights the current selection.
   *
   * An emissive tint rather than an outline pass: it costs nothing extra to
   * render, survives being viewed from any angle, and reads clearly on both
   * light and dark grounds.
   */
  setSelection(ids: ReadonlySet<string>): void {
    let changed = false;

    for (const [id, entry] of this.entries) {
      const selected = ids.has(id);
      if (entry.selected === selected) continue;

      entry.selected = selected;
      entry.material.emissive.set(selected ? 0x2f7d6d : 0x000000);
      entry.material.emissiveIntensity = selected ? 1 : 0;
      entry.material.needsUpdate = true;
      changed = true;
    }

    if (changed) this.requestRender();
  }

  /** Nodes whose centre projects inside a screen-space rectangle. */
  nodesInRect(x0: number, y0: number, x1: number, y1: number): string[] {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);

    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const centre = new THREE.Vector3();
    const found: string[] = [];

    for (const [id, entry] of this.entries) {
      const sphere = entry.mesh.geometry.boundingSphere;
      if (!sphere) continue;

      centre.copy(sphere.center).project(this.camera.camera);
      // Behind the camera projects to a mirrored position; exclude it.
      if (centre.z > 1) continue;

      const screenX = ((centre.x + 1) / 2) * width;
      const screenY = ((1 - centre.y) / 2) * height;
      if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
        found.push(id);
      }
    }

    return found;
  }

  private syncStroke(node: StrokeNode, layerOpacity: number): void {
    const existing = this.entries.get(node.id);

    if (!existing) {
      const geometry = buildStrokeGeometry(node.samples, {
        ...geometryOptions(node.style),
        initialNormal: node.planeNormal,
      });
      if (!geometry) return;

      const material = makeStrokeMaterial(node.style);
      material.opacity = node.style.opacity * layerOpacity;
      material.transparent = material.opacity < 1;

      const mesh = new THREE.Mesh(toBufferGeometry(geometry), material);
      mesh.userData.nodeId = node.id;
      this.strokeGroup.add(mesh);

      this.entries.set(node.id, {
        mesh,
        material,
        samplesRef: node.samples,
        styleRef: node.style,
        layerOpacity,
      });
      return;
    }

    // Geometry depends on the samples and on the width-ish parts of the style.
    if (existing.samplesRef !== node.samples || existing.styleRef !== node.style) {
      const geometry = buildStrokeGeometry(node.samples, {
        ...geometryOptions(node.style),
        initialNormal: node.planeNormal,
      });
      if (geometry) {
        existing.mesh.geometry.dispose();
        existing.mesh.geometry = toBufferGeometry(geometry);
      }
      existing.samplesRef = node.samples;
    }

    if (existing.styleRef !== node.style || existing.layerOpacity !== layerOpacity) {
      applyStyle(existing.material, node.style);
      existing.material.opacity = node.style.opacity * layerOpacity;
      existing.material.transparent = existing.material.opacity < 1;
      existing.styleRef = node.style;
      existing.layerOpacity = layerOpacity;
    }
  }

  /**
   * Shows the stroke currently under the pen, before it is committed.
   *
   * Takes a list because symmetry draws several copies at once; the meshes are
   * pooled and reused across frames rather than rebuilt, since this runs on
   * every frame of every stroke.
   */
  setPreview(geometries: StrokeGeometry[] | null, style: StrokeStyle): void {
    const wanted = geometries ?? [];

    if (wanted.length === 0) {
      if (this.previewMeshes.length > 0) {
        this.clearPreview();
        this.requestRender();
      }
      return;
    }

    if (!this.previewMaterial) {
      this.previewMaterial = makeStrokeMaterial(style);
    } else {
      applyStyle(this.previewMaterial, style);
    }

    for (let i = 0; i < wanted.length; i += 1) {
      const buffer = toBufferGeometry(wanted[i]!);
      const existing = this.previewMeshes[i];

      if (existing) {
        existing.geometry.dispose();
        existing.geometry = buffer;
      } else {
        const mesh = new THREE.Mesh(buffer, this.previewMaterial);
        this.previewMeshes.push(mesh);
        this.scene.add(mesh);
      }
    }

    // Drop any copies left over from a higher symmetry count.
    while (this.previewMeshes.length > wanted.length) {
      const mesh = this.previewMeshes.pop()!;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }

    this.requestRender();
  }

  private clearPreview(): void {
    for (const mesh of this.previewMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.previewMeshes.length = 0;
    this.previewMaterial?.dispose();
    this.previewMaterial = null;
  }

  /** Screen point (CSS pixels) to normalised device coordinates. */
  toNdc(x: number, y: number): { x: number; y: number } {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    return { x: (x / width) * 2 - 1, y: -((y / height) * 2 - 1) };
  }

  /** First stroke under the given screen point, with its world-space normal. */
  pickSurface(x: number, y: number): SurfaceHit | null {
    const ndc = this.toNdc(x, y);
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera.camera);

    const hits = this.raycaster.intersectObjects(this.strokeGroup.children, false);
    const hit = hits[0];
    if (!hit || !hit.face) return null;

    const normal = hit.face.normal
      .clone()
      .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize();

    return {
      nodeId: String(hit.object.userData.nodeId ?? ''),
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
    };
  }

  /**
   * Where a screen point meets the ground plane, or null when it is above the
   * horizon. Used as the fallback pivot when a press lands on empty space.
   */
  groundPointAt(x: number, y: number): Vec3 | null {
    const ndc = this.toNdc(x, y);
    const ray = this.camera.ray(ndc.x, ndc.y);
    if (Math.abs(ray.direction.y) < 1e-6) return null;

    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0) return null;

    return {
      x: ray.origin.x + ray.direction.x * t,
      y: 0,
      z: ray.origin.z + ray.direction.z * t,
    };
  }

  /** Bounding box of the given nodes, or null when none are present. */
  boundsOf(ids: readonly string[]): THREE.Box3 | null {
    const box = new THREE.Box3();
    let found = false;

    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      box.expandByObject(entry.mesh);
      found = true;
    }

    return found ? box : null;
  }

  /**
   * Where to hang a toolbar over a set of nodes: horizontally centred on them,
   * vertically at their topmost point on screen.
   *
   * All eight corners of the bounding box are projected rather than just the
   * centre — a box's screen extent depends on the viewing angle, and anchoring
   * to the centre puts the bar on top of whatever it is describing.
   */
  screenCentreOf(ids: readonly string[]): { x: number; y: number } | null {
    const box = this.boundsOf(ids);
    if (!box || box.isEmpty()) return null;

    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const corner = new THREE.Vector3();

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;

    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      corner.project(this.camera.camera);
      // Behind the camera projects to a mirrored point, which would drag the
      // anchor to the wrong side of the screen.
      if (corner.z > 1) return null;

      const screenX = ((corner.x + 1) / 2) * width;
      const screenY = ((1 - corner.y) / 2) * height;
      minX = Math.min(minX, screenX);
      maxX = Math.max(maxX, screenX);
      minY = Math.min(minY, screenY);
    }

    return { x: (minX + maxX) / 2, y: minY };
  }

  /** Bounding box of everything drawn, for "frame all". */
  contentBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const entry of this.entries.values()) {
      box.expandByObject(entry.mesh);
    }
    return box;
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }

  get renderInfo(): { triangles: number; drawCalls: number } {
    return {
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
    };
  }

  /** PNG data URL of the current frame, at full render resolution. */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera.camera);
    return this.canvas.toDataURL('image/png');
  }

  /**
   * Small JPEG data URL for the project browser. JPEG rather than PNG because
   * these are stored per project and the background is opaque anyway — PNG
   * thumbnails run about eight times larger for no visible gain.
   */
  thumbnail(maxWidth = 360): string | null {
    const { width, height } = this.canvas;
    if (width === 0 || height === 0) return null;

    // The plane indicator is a drawing aid, not part of the artwork.
    const indicatorWasVisible = this.planeIndicator.object.visible;
    this.planeIndicator.setVisible(false);
    this.renderer.render(this.scene, this.camera.camera);
    this.planeIndicator.setVisible(indicatorWasVisible);
    this.requestRender();

    const scale = Math.min(1, maxWidth / width);
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(width * scale));
    target.height = Math.max(1, Math.round(height * scale));

    const context = target.getContext('2d');
    if (!context) return null;

    context.drawImage(this.canvas, 0, 0, target.width, target.height);
    try {
      return target.toDataURL('image/jpeg', 0.72);
    } catch {
      // A tainted canvas cannot be read back; a missing thumbnail is fine.
      return null;
    }
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.clearPreview();

    for (const entry of this.entries.values()) {
      entry.mesh.geometry.dispose();
      entry.material.dispose();
    }
    this.entries.clear();

    this.planeIndicator.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
