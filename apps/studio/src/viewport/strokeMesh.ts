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
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(style.color),
    roughness: style.roughness,
    metalness: style.metalness,
    transparent: style.opacity < 1,
    opacity: style.opacity,
    // Strokes are closed tubes, but a half-finished preview is not — showing
    // both sides keeps the live stroke from looking hollow.
    side: THREE.FrontSide,
  });
  applyDepthMode(material, style);
  return material;
}

/**
 * Translucent strokes must not write depth.
 *
 * With depth writing on, the first marker stroke drawn punches a hole in every
 * translucent stroke behind it — you see the background through the overlap
 * instead of the colour building up. Turning it off makes overlaps layer the
 * way a wet marker actually does.
 */
function applyDepthMode(material: THREE.MeshStandardMaterial, style: StrokeStyle): void {
  const translucent = style.opacity < 1;
  material.depthWrite = !translucent;
}

export function applyStyle(material: THREE.MeshStandardMaterial, style: StrokeStyle): void {
  material.color.set(style.color);
  material.roughness = style.roughness;
  material.metalness = style.metalness;
  material.opacity = style.opacity;
  material.transparent = style.opacity < 1;
  applyDepthMode(material, style);
  material.needsUpdate = true;
}
