import * as THREE from 'three';
import { PLAY, setBounds } from './sea';

/**
 * Looking almost straight down on the sea, like the reference, with just
 * enough perspective that a surfer paddling to the far side shrinks a
 * little. The distance is solved so the play area covers the whole screen
 * (there are no edges to see: the sea runs on past it), and the visible
 * stretch of sea becomes the bounds surfers keep to.
 */

const PITCH = THREE.MathUtils.degToRad(-77);
const FOV = 34;

export function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 400);
  camera.rotation.set(PITCH, 0, 0, 'YXZ');
  return camera;
}

const CORNERS = [
  new THREE.Vector3(-PLAY.halfX, 0, -PLAY.halfZ),
  new THREE.Vector3(PLAY.halfX, 0, -PLAY.halfZ),
  new THREE.Vector3(-PLAY.halfX, 0, PLAY.halfZ),
  new THREE.Vector3(PLAY.halfX, 0, PLAY.halfZ),
];
const tmp = new THREE.Vector3();

function place(camera: THREE.PerspectiveCamera, distance: number): void {
  const euler = new THREE.Euler(PITCH, 0, 0, 'YXZ');
  const back = new THREE.Vector3(0, 0, 1).applyEuler(euler);
  camera.position.copy(back).multiplyScalar(distance);
  camera.rotation.copy(euler);
  camera.updateMatrixWorld(true);
}

/** Smallest |NDC| the play area's corners reach, per axis (≥ 1 means it covers the screen that way). */
function cover(camera: THREE.PerspectiveCamera): { x: number; y: number } {
  let x = Infinity, y = Infinity;
  for (const c of CORNERS) {
    tmp.copy(c).project(camera);
    x = Math.min(x, Math.abs(tmp.x));
    y = Math.min(y, Math.abs(tmp.y));
  }
  return { x, y };
}

/** Where a screen point (NDC) meets the still water. */
function ground(camera: THREE.PerspectiveCamera, nx: number, ny: number): THREE.Vector3 {
  const v = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
  const t = -camera.position.y / v.y;
  return camera.position.clone().addScaledVector(v, t);
}

export function frameCamera(camera: THREE.PerspectiveCamera, width: number, height: number): void {
  camera.aspect = width / Math.max(1, height);
  camera.fov = FOV;
  camera.updateProjectionMatrix();
  // the farthest camera at which the play area still covers the whole screen
  let lo = 4;
  let hi = 200;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    place(camera, mid);
    const c = cover(camera);
    if (c.x >= 1 && c.y >= 1) lo = mid;
    else hi = mid;
  }
  place(camera, lo);
  // what the screen actually shows becomes where surfers may go (the near edge is wider than the far)
  const tl = ground(camera, -1, 1);
  const tr = ground(camera, 1, 1);
  const bl = ground(camera, -1, -1);
  const br = ground(camera, 1, -1);
  setBounds(Math.max(tl.x, bl.x), Math.min(tr.x, br.x), Math.max(tl.z, tr.z), Math.min(bl.z, br.z));
}

/** Kept for API parity with MEADOW and POND: the sea never turns. */
export function cameraYaw(): number {
  return 0;
}
