import * as THREE from 'three';
import type { BoardKind } from './look';

/**
 * A board and a small person, in the board's own frame: x toward the nose,
 * y up, z to the right; a short board is one unit long. Everything is a few
 * rounded primitives — seen from this high above, the reference's surfers
 * are simple shapes too — with an `aAO` attribute for the shared paint.
 */

export interface SurferGeometries {
  board: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  hairLong: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
}

export const BOARD_LENGTH: Record<BoardKind, number> = { short: 1, long: 1.32 };

function withAO(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(1), 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** The board's outline from above: a pointed nose (short) or a round one (long), a squarish tail. */
function planform(kind: BoardKind): THREE.Shape {
  const L = BOARD_LENGTH[kind];
  const W = kind === 'short' ? 0.13 : 0.15;
  const pts: THREE.Vector2[] = [];
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // tail (0) to nose (1)
    const x = -L / 2 + t * L;
    // a lens: widest just ahead of the middle, a narrower squared-off tail, a pointed (short) or round (long) nose
    const a = Math.PI * (0.13 + 0.85 * t);
    const w = W * Math.pow(Math.max(0, Math.sin(a)), kind === 'short' ? 0.62 : 0.3);
    pts.push(new THREE.Vector2(x, Math.max(w, 0.004)));
  }
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, -pts[0].y);
  for (const p of pts) shape.lineTo(p.x, -p.y);
  for (const p of [...pts].reverse()) shape.lineTo(p.x, p.y);
  shape.closePath();
  return shape;
}

export function boardGeometry(kind: BoardKind): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(planform(kind), { depth: 0.022, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 6 });
  // lie flat: the shape's y becomes the board's width (z), the extrusion its thickness (y)
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.03, 0);
  geo.computeVertexNormals();
  return withAO(geo);
}

/** The person's parts; the torso runs along +x from the pelvis, limbs along their own +x. */
export function bodyGeometries(): Omit<SurferGeometries, 'board'> {
  const torso = new THREE.CapsuleGeometry(0.062, 0.16, 6, 12);
  torso.rotateZ(-Math.PI / 2);
  torso.scale(1, 0.72, 1.18);
  torso.translate(0.14, 0, 0);
  const head = new THREE.SphereGeometry(0.052, 16, 12);
  const hair = new THREE.SphereGeometry(0.056, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  // a cap over the crown and the back of the head
  hair.rotateZ(Math.PI / 2 + 0.35);
  hair.translate(-0.006, 0.004, 0);
  const hairLong = new THREE.CapsuleGeometry(0.04, 0.1, 4, 8);
  hairLong.rotateZ(-Math.PI / 2);
  hairLong.scale(1, 0.45, 1.25);
  hairLong.translate(-0.08, 0.01, 0);
  const arm = new THREE.CapsuleGeometry(0.023, 0.17, 4, 8);
  arm.rotateZ(-Math.PI / 2);
  arm.translate(0.1, 0, 0);
  const leg = new THREE.CapsuleGeometry(0.031, 0.24, 4, 8);
  leg.rotateZ(-Math.PI / 2);
  leg.translate(0.14, 0, 0);
  return { torso: withAO(torso), head: withAO(head), hair: withAO(hair), hairLong: withAO(hairLong), arm: withAO(arm), leg: withAO(leg) };
}
