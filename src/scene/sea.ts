/**
 * The sea is open water with no edges: the camera frames a play area of
 * about 28 × 19 m and the painted surface runs well past it in every
 * direction. World units are metres, y up, the still surface is y = 0, the
 * camera sits above, tilted a little toward +z.
 *
 * Surfers keep to the visible part of the sea (`bounds`), which the engine
 * updates whenever the view is resized.
 */

export const PLAY = { halfX: 14, halfZ: 9.5 };
export const WATER_Y = 0;

/** The visible sea, shrunk by a margin, as an axis-aligned box. Updated on resize. */
export const bounds = { minX: -PLAY.halfX, maxX: PLAY.halfX, minZ: -PLAY.halfZ, maxZ: PLAY.halfZ };

export function setBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
  bounds.minX = minX;
  bounds.maxX = maxX;
  bounds.minZ = minZ;
  bounds.maxZ = maxZ;
}

/** Signed distance (m) inside the visible sea, minus a margin; negative outside. */
export function seaRegion(x: number, z: number, margin = 1.2): number {
  return Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z) - margin;
}

export function clampToSea(x: number, z: number, margin = 1.2): [number, number] {
  return [
    Math.max(bounds.minX + margin, Math.min(bounds.maxX - margin, x)),
    Math.max(bounds.minZ + margin, Math.min(bounds.maxZ - margin, z)),
  ];
}

/** The gentle rolling swell (m): a few long, slow travelling waves. GLSL twin in water.ts. */
export function swell(x: number, z: number, t: number): number {
  return (
    0.05 * Math.sin(x * 0.31 + z * 0.08 + t * 0.9) +
    0.035 * Math.sin(x * 0.17 - z * 0.23 + t * 0.62 + 1.3) +
    0.02 * Math.sin(x * 0.53 + z * 0.41 + t * 1.3 + 2.1)
  );
}
