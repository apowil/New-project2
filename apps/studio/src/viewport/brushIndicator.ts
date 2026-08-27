import * as THREE from 'three';
import { type Vec3 } from '@wisp/core';

/**
 * The ring that shows where the liquify brush will bite.
 *
 * Two circles rather than one: the outer is the radius past which nothing
 * moves at all, and the inner sits at the half-strength point of the falloff.
 * A single ring says where the edge is but not how soft it is, and softness is
 * the whole reason the brush does not tear geometry.
 *
 * It faces the camera, because the brush is a sphere and a sphere's outline
 * from any angle is a circle in the view plane. Drawing it on the sketch plane
 * instead would show an ellipse that shrank to a line edge-on, implying a
 * directionality the brush does not have.
 */
export class BrushIndicator {
  readonly object = new THREE.Group();

  private readonly rings: THREE.LineLoop[];
  private readonly geometry: THREE.BufferGeometry;
  private readonly materials: THREE.LineBasicMaterial[];

  constructor(segments = 72) {
    const positions: number[] = [];
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(angle), Math.sin(angle), 0);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    this.materials = [0.75, 0.3].map(
      (opacity) =>
        new THREE.LineBasicMaterial({
          color: 0x7dd3c0,
          transparent: true,
          opacity,
          // The brush reaches through geometry, so its ring has to be visible
          // through geometry too — otherwise the far half disappears exactly
          // when you need to know it is being grabbed.
          depthTest: false,
          depthWrite: false,
        }),
    );

    this.rings = this.materials.map((material) => new THREE.LineLoop(this.geometry, material));
    // The half-strength ring. Solving smoothstep for 0.5 gives exactly half
    // the radius, which is a pleasing accident and not a fudged constant.
    this.rings[1]!.scale.setScalar(0.5);

    this.object.add(...this.rings);
    this.object.renderOrder = 10;
    this.object.visible = false;
  }

  /** Points the ring at the camera and puts it where the brush is. */
  update(centre: Vec3, radius: number, camera: THREE.Camera): void {
    this.object.position.set(centre.x, centre.y, centre.z);
    this.object.quaternion.copy(camera.quaternion);
    this.rings[0]!.scale.setScalar(radius);
    this.rings[1]!.scale.setScalar(radius * 0.5);
    this.object.visible = true;
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
