import * as THREE from 'three';
import { makePlane, type Plane, type Vec3 } from '@wisp/core';
import { type OrbitCamera } from './camera.js';

/**
 * Which surface strokes land on.
 *
 * `camera` — a plane facing the viewer through the orbit target. This is the
 * default because it makes a fresh sketch behave like paper: you draw what you
 * see. Orbiting and drawing again builds depth.
 *
 * `surface` — replanted by tapping existing geometry, so you can draw *on*
 * what you have already made.
 */
export type PlaneMode = 'camera' | 'ground' | 'front' | 'side' | 'surface';

export interface PlaneState {
  mode: PlaneMode;
  /** Slides the plane along its own normal, in scene units. */
  offset: number;
  /** Set when mode is 'surface'. */
  anchor: Vec3 | null;
  anchorNormal: Vec3 | null;
}

export const DEFAULT_PLANE_STATE: PlaneState = {
  mode: 'camera',
  offset: 0,
  anchor: null,
  anchorNormal: null,
};

/**
 * The fixed planes' normals, for pointing the camera at one.
 *
 * `camera` and `surface` are absent deliberately: the first already faces you
 * by definition, and the second has no normal until something has been tapped.
 */
export const PLANE_NORMALS: Partial<Record<PlaneMode, { x: number; y: number; z: number }>> = {
  ground: { x: 0, y: 1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  side: { x: 1, y: 0, z: 0 },
};

export function resolvePlane(state: PlaneState, camera: OrbitCamera): Plane {
  const target = camera.lookTarget;

  switch (state.mode) {
    case 'ground':
      return offsetAlongNormal(
        makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }),
        state.offset,
      );

    case 'front':
      return offsetAlongNormal(
        makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }),
        state.offset,
      );

    case 'side':
      return offsetAlongNormal(
        makePlane({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
        state.offset,
      );

    case 'surface': {
      if (state.anchor && state.anchorNormal) {
        return offsetAlongNormal(
          makePlane(state.anchor, state.anchorNormal, camera.right),
          state.offset,
        );
      }
      // Nothing picked yet — behave like camera mode rather than failing.
      return cameraPlane(camera, target, state.offset);
    }

    case 'camera':
    default:
      return cameraPlane(camera, target, state.offset);
  }
}

function cameraPlane(camera: OrbitCamera, target: THREE.Vector3, offset: number): Plane {
  const forward = camera.forward;
  // The plane faces the camera, so its normal is the reverse of the view
  // direction. The camera's right vector is the hint, which keeps the plane's
  // local axes from rolling as you orbit.
  const plane = makePlane(
    { x: target.x, y: target.y, z: target.z },
    { x: -forward.x, y: -forward.y, z: -forward.z },
    camera.right,
  );
  return offsetAlongNormal(plane, offset);
}

const offsetAlongNormal = (plane: Plane, offset: number): Plane =>
  offset === 0
    ? plane
    : {
        ...plane,
        origin: {
          x: plane.origin.x + plane.normal.x * offset,
          y: plane.origin.y + plane.normal.y * offset,
          z: plane.origin.z + plane.normal.z * offset,
        },
      };

/**
 * The faint grid that shows where you are about to draw. Built once in local
 * XY and re-oriented by writing the plane's basis straight into its matrix.
 */
export class PlaneIndicator {
  readonly object = new THREE.Group();

  private readonly grid: THREE.LineSegments;
  private readonly disc: THREE.Mesh;
  private readonly matrix = new THREE.Matrix4();

  constructor(radius = 3.2, divisions = 12) {
    const positions: number[] = [];
    const step = (radius * 2) / divisions;

    for (let i = 0; i <= divisions; i += 1) {
      const t = -radius + i * step;
      // Clip each line to the disc so the grid fades into a circle, not a square.
      const half = Math.sqrt(Math.max(radius * radius - t * t, 0));
      if (half <= 0) continue;
      positions.push(t, -half, 0, t, half, 0);
      positions.push(-half, t, 0, half, t, 0);
    }

    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    this.grid = new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({
        color: 0x7dd3c0,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );

    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3c0,
        transparent: true,
        opacity: 0.035,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    this.object.add(this.disc, this.grid);
    this.object.renderOrder = -1;
  }

  update(plane: Plane): void {
    // Columns are the plane's own basis, so no quaternion maths is needed.
    this.matrix.makeBasis(
      new THREE.Vector3(plane.u.x, plane.u.y, plane.u.z),
      new THREE.Vector3(plane.v.x, plane.v.y, plane.v.z),
      new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z),
    );
    this.matrix.setPosition(plane.origin.x, plane.origin.y, plane.origin.z);

    this.object.matrix.copy(this.matrix);
    this.object.matrixAutoUpdate = false;
    this.object.updateMatrixWorld(true);
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  dispose(): void {
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.disc.geometry.dispose();
    (this.disc.material as THREE.Material).dispose();
  }
}
