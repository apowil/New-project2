import * as THREE from 'three';

/**
 * Orbit camera with critically-damped motion.
 *
 * Written by hand rather than using OrbitControls because the controls need to
 * cooperate with pen input: OrbitControls grabs pointer events on the element
 * it is attached to, which makes "pen draws, one finger orbits, two fingers
 * pan and pinch" impossible to express. Here the gesture layer decides intent
 * and calls these methods; the camera itself never listens to the DOM.
 */

const EPSILON = 1e-4;
const PHI_LIMIT = 0.02;

export interface Ray {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

export class OrbitCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** Where the camera looks. Panning moves this. */
  private readonly target = new THREE.Vector3(0, 0.6, 0);
  private readonly targetGoal = new THREE.Vector3(0, 0.6, 0);

  private radius = 6;
  private theta = Math.PI * 0.25;
  private phi = Math.PI * 0.36;

  private radiusGoal = 6;
  private thetaGoal = Math.PI * 0.25;
  private phiGoal = Math.PI * 0.36;

  minRadius = 0.35;
  maxRadius = 250;
  /** 0 = no smoothing, 1 = never arrives. 0.75 feels right on a tablet. */
  damping = 0.75;

  constructor(aspect = 1) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 2000);
    this.applyImmediate();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Radians of rotation, already scaled by the gesture layer. */
  orbit(deltaTheta: number, deltaPhi: number): void {
    this.thetaGoal -= deltaTheta;
    this.phiGoal = clamp(this.phiGoal - deltaPhi, PHI_LIMIT, Math.PI - PHI_LIMIT);
  }

  /**
   * Slides the target across the view plane. Deltas are in pixels; the
   * conversion keeps a dragged point under the finger regardless of distance.
   */
  pan(deltaX: number, deltaY: number, viewportHeight: number): void {
    const halfFov = (this.camera.fov * Math.PI) / 360;
    const worldPerPixel = (2 * Math.tan(halfFov) * this.radiusGoal) / viewportHeight;

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());

    this.targetGoal.addScaledVector(right, -deltaX * worldPerPixel);
    this.targetGoal.addScaledVector(up, deltaY * worldPerPixel);
  }

  /** `factor` > 1 moves away, < 1 moves closer. */
  dolly(factor: number): void {
    this.radiusGoal = clamp(this.radiusGoal * factor, this.minRadius, this.maxRadius);
  }

  /** Advances the damping. Returns true while the camera is still settling. */
  update(): boolean {
    // Frame-rate independent damping: the per-frame lerp is derived from a
    // half-life so a 120 Hz tablet and a 60 Hz desktop settle at the same rate.
    const t = 1 - Math.pow(1 - this.damping, 1 / 3);

    const moved =
      Math.abs(this.radiusGoal - this.radius) > EPSILON ||
      Math.abs(this.thetaGoal - this.theta) > EPSILON ||
      Math.abs(this.phiGoal - this.phi) > EPSILON ||
      this.targetGoal.distanceToSquared(this.target) > EPSILON * EPSILON;

    if (!moved) {
      // Snap once so the camera does not creep by sub-epsilon amounts forever.
      this.radius = this.radiusGoal;
      this.theta = this.thetaGoal;
      this.phi = this.phiGoal;
      this.target.copy(this.targetGoal);
      this.applyImmediate();
      return false;
    }

    this.radius += (this.radiusGoal - this.radius) * t;
    this.theta += (this.thetaGoal - this.theta) * t;
    this.phi += (this.phiGoal - this.phi) * t;
    this.target.lerp(this.targetGoal, t);
    this.applyImmediate();
    return true;
  }

  private applyImmediate(): void {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Jumps to a view without damping — used on load and on "frame all". */
  setView(theta: number, phi: number, radius: number, target?: THREE.Vector3): void {
    this.thetaGoal = this.theta = theta;
    this.phiGoal = this.phi = clamp(phi, PHI_LIMIT, Math.PI - PHI_LIMIT);
    this.radiusGoal = this.radius = clamp(radius, this.minRadius, this.maxRadius);
    if (target) {
      this.target.copy(target);
      this.targetGoal.copy(target);
    }
    this.applyImmediate();
  }

  /** Pulls back far enough to see `box`, keeping the current orientation. */
  frame(box: THREE.Box3, padding = 1.35): void {
    if (box.isEmpty()) return;

    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 0.2);

    const halfFov = (this.camera.fov * Math.PI) / 360;
    // Account for the narrower of the two axes so nothing is cropped.
    const fitHeight = extent / (2 * Math.tan(halfFov));
    const fitWidth = fitHeight / Math.min(this.camera.aspect, 1);

    this.targetGoal.copy(centre);
    this.radiusGoal = clamp(
      Math.max(fitHeight, fitWidth) * padding,
      this.minRadius,
      this.maxRadius,
    );
  }

  get distance(): number {
    return this.radius;
  }

  get lookTarget(): THREE.Vector3 {
    return this.target.clone();
  }

  /** Forward direction, pointing from the camera into the scene. */
  get forward(): THREE.Vector3 {
    return this.target.clone().sub(this.camera.position).normalize();
  }

  get right(): THREE.Vector3 {
    const right = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, new THREE.Vector3(), new THREE.Vector3());
    return right;
  }

  /** Ray through a point in normalised device coordinates (-1..1). */
  ray(ndcX: number, ndcY: number): Ray {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3(ndcX, ndcY, 0.5)
      .unproject(this.camera)
      .sub(origin)
      .normalize();
    return { origin, direction };
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
