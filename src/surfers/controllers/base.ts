import { blendPose, type Pose } from '../pose';

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** The heading that faces from (x, z) toward (tx, tz); forward is (cos h, -sin h). */
export const headingTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tz - z), tx - x);

/**
 * The machinery every creature shares: a state with its own clock, a base
 * state it returns to, and a cross-fade from the pose actually shown (so a
 * flurry of clicks can never leave a fin, wing or leg stranded).
 */
export abstract class Controller<K extends string, S extends string> {
  state: S;
  stateTime = 0;
  x: number;
  z: number;
  heading: number;
  anchorX: number;
  anchorZ: number;
  /** World metres per local unit (the view's root scale). */
  scale = 1;
  /** Held by a drag: root motion pauses, the pose keeps living. */
  held = false;
  /** Fired when a one-shot leaves the creature somewhere new. */
  onMoved: ((x: number, z: number) => void) | null = null;
  protected lastPose: Pose<K> | null = null;
  private fromPose: Pose<K> | null = null;
  private blendTime = 0;
  private blendDuration = 0.4;
  protected time = 0;
  /** Angular velocity (rad/s), eased so a creature's turns never snap or flicker. */
  protected angVel = 0;

  constructor(protected readonly keys: readonly K[], readonly seed: number, x: number, z: number, heading: number, protected base: S) {
    this.state = base;
    this.x = this.anchorX = x;
    this.z = this.anchorZ = z;
    this.heading = heading;
  }

  protected enter(state: S, blend = 0.4): void {
    this.fromPose = this.lastPose;
    this.blendTime = 0;
    this.blendDuration = blend;
    this.state = state;
    this.stateTime = 0;
  }

  /** Back to the base state, anchored wherever the creature now is. */
  protected settle(blend = 0.35): void {
    this.anchorX = this.x;
    this.anchorZ = this.z;
    this.enter(this.base, blend);
  }

  /** Teleport (drag, undo): moves the anchor too, and keeps the current animation. */
  placeAt(x: number, z: number): void {
    this.x = this.anchorX = x;
    this.z = this.anchorZ = z;
  }

  protected advance(dt: number): void {
    this.stateTime += dt;
    this.blendTime += dt;
    this.time += dt;
  }

  /** Cross-fade the behaviour's pose with whatever was showing when the state changed. */
  protected shown(pose: Pose<K>): Pose<K> {
    let out = pose;
    if (this.fromPose && this.blendTime < this.blendDuration) {
      const w = this.blendTime / this.blendDuration;
      out = blendPose(this.keys, this.fromPose, pose, w * w * (3 - 2 * w));
    }
    this.lastPose = out;
    return out;
  }

  /** Turn toward a heading at a limited rate (rad/s). Returns the turn actually made this frame. */
  protected steerToward(desired: number, rate: number, dt: number): number {
    const diff = wrapAngle(desired - this.heading);
    const turn = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    this.heading = wrapAngle(this.heading + turn);
    return turn;
  }

  /** Turn at a rate that eases toward `rate` (rad/s) over about `ease` seconds. */
  protected turnAt(rate: number, dt: number, ease = 0.22): void {
    this.angVel += (rate - this.angVel) * Math.min(1, dt / ease);
    this.heading = wrapAngle(this.heading + this.angVel * dt);
  }

  /** The turn rate that would bring the heading round to `desired`: proportional, capped. */
  protected rateToward(desired: number, maxRate: number, gain = 2.5): number {
    return Math.max(-maxRate, Math.min(maxRate, wrapAngle(desired - this.heading) * gain));
  }

  /**
   * Which way to turn when either way would do: the way it already wants to
   * go, else the way it is already turning, else its own habit. Stable from
   * frame to frame, so it never dithers.
   */
  protected prefer(wanted: number): number {
    if (Math.abs(wanted) > 0.15) return Math.sign(wanted);
    if (Math.abs(this.angVel) > 0.1) return Math.sign(this.angVel);
    return this.seed % 2 ? 1 : -1;
  }


}
