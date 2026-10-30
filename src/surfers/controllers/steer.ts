import { wrapAngle } from './base';

/**
 * Smooth steering shared by every creature that roams. A "region" says how
 * comfortably inside its allowed area a point is (metres; negative = outside).
 * Avoidance grows continuously as a creature nears the edge of its region —
 * it never switches on and off from one frame to the next — and movement
 * slides along the edge instead of being snapped back inside.
 */

export type Region = (x: number, z: number) => number;

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Direction (unit x, z) in which the region gets roomier. */
export function roomierDirection(region: Region, x: number, z: number): [number, number] {
  const e = 0.08;
  const gx = region(x + e, z) - region(x - e, z);
  const gz = region(x, z + e) - region(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

/**
 * Turn rate (rad/s) that steers away from the edge of the region ahead.
 * When the open way lies behind (the edge dead ahead, or a corner), any turn
 * will do — so it commits to `prefer` (±1: the way the creature already wants
 * to turn) rather than re-deciding each frame and dithering left-right.
 */
export function avoidRate(region: Region, x: number, z: number, heading: number, look: number, maxRate: number, prefer: number): number {
  const ax = x + Math.cos(heading) * look;
  const az = z - Math.sin(heading) * look;
  const danger = smoothstep(0.7, -0.15, region(ax, az));
  if (danger <= 0) return 0;
  const [gx, gz] = roomierDirection(region, ax, az);
  const err = wrapAngle(Math.atan2(-gz, gx) - heading);
  const turn = Math.abs(err) > 1.6 ? prefer * maxRate : Math.max(-maxRate, Math.min(maxRate, err * 3));
  return turn * danger;
}

/**
 * Move `distance` along the heading, staying in the region: straight on if
 * that stays inside, otherwise along the edge, otherwise not at all. Never
 * teleports.
 */
export function slide(region: Region, x: number, z: number, heading: number, distance: number, margin = 0): [number, number] {
  const fx = Math.cos(heading);
  const fz = -Math.sin(heading);
  const nx = x + fx * distance;
  const nz = z + fz * distance;
  if (region(nx, nz) >= margin || region(nx, nz) >= region(x, z)) return [nx, nz];
  const [gx, gz] = roomierDirection(region, x, z);
  // the edge's tangent, pointing the way we were going
  let tx = -gz;
  let tz = gx;
  if (tx * fx + tz * fz < 0) {
    tx = -tx;
    tz = -tz;
  }
  const along = Math.max(0, tx * fx + tz * fz) * distance;
  const sx = x + tx * along;
  const sz = z + tz * along;
  return region(sx, sz) >= Math.min(margin, region(x, z)) ? [sx, sz] : [x, z];
}

/** Ease back inside the region when something (a drag, an undo, a landing) left us outside it. */
export function recover(region: Region, x: number, z: number, dt: number, margin: number): [number, number] {
  const r = region(x, z);
  if (r >= margin) return [x, z];
  const [gx, gz] = roomierDirection(region, x, z);
  const step = Math.min(margin - r, 1.5 * dt);
  return [x + gx * step, z + gz * step];
}
