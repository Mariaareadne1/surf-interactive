/**
 * Poses are flat records of numbers (radians, metres, 0..1 amounts), which
 * makes blending any two behaviours a per-key lerp. Each kind has its own
 * keys; behaviours are pure functions of time that return one.
 */

/** A surfer and its board, posed together. Angles in radians, offsets in board lengths. */
export const SURF_KEYS = [
  // the body on the board
  'pelvisX', 'pelvisY', 'spine', 'twist', 'roll', 'headPitch', 'headYaw',
  'armL', 'armR', 'spreadL', 'spreadR', 'legL', 'legR', 'splayL', 'splayR',
  // the whole rider: sinking into the water, tumbling, squash
  'sink', 'tumble', 'tumbleRoll', 'squash',
  // the board itself
  'boardPitch', 'boardRoll', 'boardDip',
] as const;

export type SurfKey = (typeof SURF_KEYS)[number];
export type Pose<K extends string> = Record<K, number>;

export function emptyPose<K extends string>(keys: readonly K[]): Pose<K> {
  const p = {} as Pose<K>;
  for (const k of keys) p[k] = 0;
  return p;
}

export function blendPose<K extends string>(keys: readonly K[], a: Pose<K>, b: Pose<K>, t: number): Pose<K> {
  const out = {} as Pose<K>;
  for (const k of keys) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function isFinitePose<K extends string>(keys: readonly K[], p: Pose<K>): boolean {
  return keys.every((k) => Number.isFinite(p[k]));
}

/** What a controller hands its view each frame. */
export interface Frame<K extends string> {
  x: number;
  y: number;
  z: number;
  heading: number;
  pose: Pose<K>;
  /** Continuous phase for cyclic motion that must never be blended (a fish's tail beat). */
  phase: number;
}

// --- small shared helpers for pure, time-based behaviours ----------------------

export const TAU = Math.PI * 2;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 before a, eases to 1 at b. */
export const ramp = (t: number, a: number, b: number) => smooth(clamp01((t - a) / (b - a)));
/** Rises a..b, holds, falls c..d. */
export const window4 = (t: number, a: number, b: number, c: number, d: number) => ramp(t, a, b) * (1 - ramp(t, c, d));

export const hashf = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Short events (blinks, look-arounds) at irregular but deterministic times. */
export function pulse(t: number, seed: number, period: number, width: number, lane: number): number {
  const i = Math.floor(t / period);
  let v = 0;
  for (const k of [i - 1, i, i + 1]) {
    const at = (k + 0.15 + hashf(k + seed * 7.1 + lane) * 0.7) * period;
    if (hashf(k * 3.3 + seed + lane * 9.9) < 0.75) v = Math.max(v, Math.exp(-(((t - at) / width) ** 2)));
  }
  return v;
}

/** Damped oscillation from an impulse at t = 0 (a bob, a wobble). */
export const ring = (t: number, freq: number, decay: number) => (t < 0 ? 0 : Math.sin(t * freq) * Math.exp(-t * decay));
