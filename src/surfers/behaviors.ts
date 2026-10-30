import { noise2 } from '../scene/noise';
import { emptyPose, pulse, ramp, ring, SURF_KEYS, window4, type Pose, type SurfKey } from './pose';

/**
 * Surfer poses: pure functions of time-in-state (and, for strokes, an
 * integrated phase handed in by the controller, so a change of pace never
 * makes the arms jump). Root motion lives in the controller.
 */

export type SurfState = 'wait' | 'paddle' | 'catch' | 'dive' | 'ride' | 'wipeout' | 'swim' | 'climb';

const wob = (t: number, seed: number, lane: number) => noise2(t, seed * 12.7 + lane * 27.3);

/** One arm's paddling angle: reach forward, pull down and back through the water, recover. */
const strokeArm = (phase: number) => -1.3 + 1.45 * Math.cos(phase);

/** Sitting astride the board, legs down in the water, glancing toward the waves. */
export function sitPose(t: number, seed: number): Pose<SurfKey> {
  const p = emptyPose(SURF_KEYS);
  p.pelvisX = -0.06;
  p.pelvisY = 0.055;
  p.spine = 1.38 + 0.05 * wob(t * 0.3, seed, 1);
  p.roll = 0.05 * Math.sin(t * 1.3 + seed);
  p.headPitch = -0.12;
  // a glance over the shoulder toward the incoming waves now and then
  const look = wob(t * 0.12, seed, 2);
  p.headYaw = 0.35 * look + 0.6 * pulse(t, seed, 6.5, 0.9, 3) * Math.max(-1, Math.min(1, look * 6));
  p.armL = -2.7 + 0.08 * Math.sin(t * 0.9 + seed);
  p.armR = -2.7 + 0.08 * Math.sin(t * 0.8 + seed + 1);
  p.spreadL = p.spreadR = 0.42;
  // legs swirl slowly under the water, treading
  p.legL = 1.3 + 0.16 * Math.sin(t * 1.6 + seed);
  p.legR = 1.3 + 0.16 * Math.sin(t * 1.6 + seed + 2.2);
  p.splayL = p.splayR = 0.55;
  p.boardPitch = 0.07 + 0.015 * Math.sin(t * 1.1 + seed);
  p.boardDip = 0.015;
  return p;
}

/** Lying on the board, head up, arms working alternately; `stroke` is the integrated phase. */
export function pronePose(t: number, seed: number, stroke: number, effort = 0.6): Pose<SurfKey> {
  const p = emptyPose(SURF_KEYS);
  p.pelvisX = -0.15;
  p.pelvisY = 0.072;
  p.spine = 0.05;
  p.headPitch = 0.32 + 0.08 * Math.sin(stroke * 2);
  p.headYaw = 0.1 * wob(t * 0.3, seed, 4);
  const reach = 0.7 + 0.3 * effort;
  p.armL = strokeArm(stroke) * reach;
  p.armR = strokeArm(stroke + Math.PI) * reach;
  p.spreadL = p.spreadR = 0.4;
  p.roll = 0.07 * Math.sin(stroke) * effort;
  p.legL = -0.04 + 0.05 * Math.sin(stroke * 2 + 1);
  p.legR = -0.04 + 0.05 * Math.sin(stroke * 2 + 2.6);
  p.splayL = p.splayR = 0.07;
  p.boardPitch = -0.02;
  return p;
}

export const DIVE = { duration: 1.5 } as const;

/** A duck-dive: shove the nose down, sink under the white water, pop up behind it. */
export function divePose(t: number, seed: number, stroke: number): Pose<SurfKey> {
  const p = pronePose(t, seed, stroke, 0.3);
  const under = window4(t, 0.0, 0.3, 0.95, 1.35);
  p.boardDip = 0.3 * under;
  p.boardPitch = -0.45 * window4(t, 0.0, 0.18, 0.18, 0.45) + 0.25 * window4(t, 0.9, 1.1, 1.1, 1.4);
  p.sink = 0.3 * under;
  p.armL = p.armR = -0.6 * under + p.armL * (1 - under);
  p.headPitch *= 1 - under;
  return p;
}

/** Up and riding: sideways stance, arms out, leaning into gentle carves; `carve` is −1..1. */
export function standPose(t: number, seed: number, carve: number, side: number): Pose<SurfKey> {
  const p = emptyPose(SURF_KEYS);
  // a pop-up: crouched low first, then rising into the stance
  const up = ramp(t, 0.05, 0.45);
  p.pelvisX = -0.04;
  p.pelvisY = 0.12 + 0.17 * up - 0.03 * Math.abs(carve);
  p.spine = 0.3 + 0.95 * up;
  p.twist = side * 1.45 * up;
  p.roll = -side * 0.22 * carve * up;
  p.headPitch = -0.1;
  p.headYaw = -side * 1.2 * up;
  p.armL = -0.35 - 0.4 * (1 - up) + 0.15 * Math.sin(t * 2.1 + seed);
  p.armR = -0.35 - 0.4 * (1 - up) + 0.15 * Math.sin(t * 1.9 + seed + 1);
  p.spreadL = p.spreadR = 1.25 * up + 0.4;
  p.legL = 1.0 + 0.55 * up;
  p.legR = 1.0 + 0.55 * up;
  p.splayL = p.splayR = 0.32;
  p.squash = 0.12 * ring(t - 0.05, 18, 9);
  p.boardRoll = 0.18 * carve;
  p.boardPitch = 0.04;
  return p;
}

export const WIPEOUT = { duration: 2.2 } as const;

/** Swept off: rider and board part company; the rider tumbles in the white water and comes up. */
export function tumblePose(t: number, seed: number): Pose<SurfKey> {
  const p = emptyPose(SURF_KEYS);
  const spin = 1 - ramp(t, 0.9, WIPEOUT.duration);
  const dir = seed % 2 ? 1 : -1;
  // whole turns only, so the rider always comes up the right way round
  p.tumble = dir * Math.PI * 2 * ramp(t, 0.0, 1.5);
  p.tumbleRoll = -dir * Math.PI * 2 * ramp(t, 0.15, 1.9);
  p.sink = 0.14 + 0.08 * Math.sin(t * 6) * spin;
  p.spine = 0.6 + 0.6 * Math.sin(t * 7 + seed) * spin;
  p.armL = -1 + 1.6 * Math.sin(t * 11 + seed) * spin;
  p.armR = -1 + 1.6 * Math.sin(t * 10 + seed + 1) * spin;
  p.spreadL = p.spreadR = 1.1;
  p.legL = 0.6 + 0.8 * Math.sin(t * 8 + seed) * spin;
  p.legR = 0.6 + 0.8 * Math.sin(t * 9 + seed + 2) * spin;
  p.splayL = p.splayR = 0.7;
  p.squash = 0.1 * Math.sin(t * 13) * spin;
  // the board flips over and skids off on its own
  p.boardRoll = Math.PI * ramp(t, 0.05, 0.5) + 0.2 * Math.sin(t * 7) * spin;
  p.boardPitch = 0.3 * Math.sin(t * 5) * spin;
  return p;
}

/** Swimming back to the board: low in the water, freestyle arms, flutter kick. */
export function swimPose(t: number, seed: number, stroke: number): Pose<SurfKey> {
  const p = emptyPose(SURF_KEYS);
  p.sink = 0.12;
  p.pelvisY = -0.02;
  p.spine = 0.12;
  p.headPitch = 0.45;
  p.headYaw = 0.25 * Math.sin(stroke);
  p.armL = strokeArm(stroke);
  p.armR = strokeArm(stroke + Math.PI);
  p.spreadL = p.spreadR = 0.3;
  p.roll = 0.18 * Math.sin(stroke);
  p.legL = 0.12 * Math.sin(t * 9 + seed);
  p.legR = 0.12 * Math.sin(t * 9 + seed + Math.PI);
  p.splayL = p.splayR = 0.1;
  p.boardRoll = Math.PI; // still upside down until it's righted
  return p;
}

export const CLIMB = { duration: 0.9 } as const;

/** Rights the board and hauls back on: from the water onto the board, prone. */
export function climbPose(t: number, seed: number, stroke: number): Pose<SurfKey> {
  const p = pronePose(t, seed, stroke, 0.1);
  const on = ramp(t, 0.2, CLIMB.duration);
  p.sink = 0.12 * (1 - on);
  p.boardRoll = Math.PI * (1 - ramp(t, 0, 0.35));
  p.boardRoll += 0.15 * Math.sin(t * 10) * (1 - on);
  p.armL = p.armR = -0.3 - 0.6 * (1 - on);
  p.squash = 0.06 * ring(t - CLIMB.duration * 0.8, 14, 8);
  return p;
}

export function surfPose(state: SurfState, t: number, seed: number, stroke: number, effort: number, carve: number, side: number): Pose<SurfKey> {
  switch (state) {
    case 'paddle':
    case 'catch':
      return pronePose(t, seed, stroke, state === 'catch' ? 1 : effort);
    case 'dive':
      return divePose(t, seed, stroke);
    case 'ride':
      return standPose(t, seed, carve, side);
    case 'wipeout':
      return tumblePose(t, seed);
    case 'swim':
      return swimPose(t, seed, stroke);
    case 'climb':
      return climbPose(t, seed, stroke);
    default:
      return sitPose(t, seed);
  }
}
