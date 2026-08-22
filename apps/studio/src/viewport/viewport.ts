import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  buildStrokeGeometry,
  visibleNodes,
  type SketchDocument,
  type StrokeGeometry,
  type StrokeNode,
  type StrokeStyle,
  type Vec3,
} from '@wisp/core';

import { OrbitCamera } from './camera.js';
import { PlaneIndicator } from './sketchPlane.js';
import { applyStyle, makeStrokeMaterial, toBufferGeometry } from './strokeMesh.js';

interface StrokeEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** Identity of the data the current geometry was built from. */
  samplesRef: unknown;
  styleRef: unknown;
  layerOpacity: number;
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

  private previewMesh: THREE.Mesh | null = null;
  private previewMaterial: THREE.MeshStandardMaterial | null = null;

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

    this.scene.background = new THREE.Color(0x111214);
    this.scene.fog = new THREE.Fog(0x111214, 24, 110);

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
    this.scene.environmentIntensity = 0.55;
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
    const grid = new THREE.GridHelper(40, 40, 0x3a3e46, 0x24272c);
    const material = grid.material as THREE.Material;
    material.transparent = true;
    material.opacity = 0.45;
    material.depthWrite = false;
    grid.position.y = 0;
    this.scene.add(grid);
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
      if (node.type !== 'stroke') continue; // primitives arrive in stage 2
      seen.add(node.id);
      this.syncStroke(node, layerOpacity.get(node.layerId) ?? 1);
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

  private syncStroke(node: StrokeNode, layerOpacity: number): void {
    const existing = this.entries.get(node.id);

    if (!existing) {
      const geometry = buildStrokeGeometry(node.samples, {
        width: node.style.width,
        sides: node.style.sides,
        flatness: node.style.flatness,
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
        width: node.style.width,
        sides: node.style.sides,
        flatness: node.style.flatness,
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

  /** Shows the stroke currently under the pen, before it is committed. */
  setPreview(geometry: StrokeGeometry | null, style: StrokeStyle): void {
    if (!geometry) {
      if (this.previewMesh) {
        this.scene.remove(this.previewMesh);
        this.previewMesh.geometry.dispose();
        this.previewMaterial?.dispose();
        this.previewMesh = null;
        this.previewMaterial = null;
        this.requestRender();
      }
      return;
    }

    const buffer = toBufferGeometry(geometry);

    if (!this.previewMesh || !this.previewMaterial) {
      this.previewMaterial = makeStrokeMaterial(style);
      this.previewMesh = new THREE.Mesh(buffer, this.previewMaterial);
      this.scene.add(this.previewMesh);
    } else {
      this.previewMesh.geometry.dispose();
      this.previewMesh.geometry = buffer;
      applyStyle(this.previewMaterial, style);
    }

    this.requestRender();
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
    this.setPreview(null, {} as StrokeStyle);

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
