import * as THREE from 'three';
import type { StrokeGeometry, StrokeStyle } from '@wisp/core';

export function toBufferGeometry(source: StrokeGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(source.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(source.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export function makeStrokeMaterial(style: StrokeStyle): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(style.color),
    roughness: style.roughness,
    metalness: style.metalness,
    transparent: style.opacity < 1,
    opacity: style.opacity,
    // Strokes are closed tubes, but a half-finished preview is not — showing
    // both sides keeps the live stroke from looking hollow.
    side: THREE.FrontSide,
  });
}

export function applyStyle(material: THREE.MeshStandardMaterial, style: StrokeStyle): void {
  material.color.set(style.color);
  material.roughness = style.roughness;
  material.metalness = style.metalness;
  material.opacity = style.opacity;
  material.transparent = style.opacity < 1;
  material.needsUpdate = true;
}
