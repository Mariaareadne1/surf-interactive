import { Controller, headingTo, wrapAngle } from './controllers/base';
import { avoidRate, recover, slide } from './controllers/steer';
import { CLIMB, DIVE, surfPose, WIPEOUT, type SurfState } from './behaviors';
import { SURF_KEYS, type SurfKey } from './pose';
import { across, along, crestAt, WAVE_DIR, waveEnvelope, wavePower, type Wave, type WaveSample } from '../scene/waves';
import { bounds, seaRegion, swell, WATER_Y } from '../scene/sea';
import { seededRandom } from '../scene/noise';
import type { BoardFrame, SurferFrame } from './SurferView';

/** What a surfer can perceive and do to the sea around them (provided by the manager). */
export interface SeaSense {
  readonly time: number;
  sample(x: number, z: number): WaveSample | null;
  /** The wave whose white water is at (x, z) right now, if any. */
  foamAt(x: number, z: number): Wave | null;
  ripple(x: number, z: number, strength: number): void;
  splash(x: number, z: number, strength: number): void;
}

/** Facing the incoming waves (out to sea), and facing the way they travel (toward the beach). */
export const OUT_HEADING = Math.atan2(WAVE_DIR[1], -WAVE_DIR[0]);
export const IN_HEADING = wrapAngle(OUT_HEADING + Math.PI);

const region = (x: number, z: number) => seaRegion(x, z, 1.0);

/**
 * A surfer's life: sitting on the board treading water and glancing at the
 * waves; paddling about and out to sea, duck-diving under white water;
 * turning to catch a wave, popping up and riding along its face just ahead
 * of the foam; getting swept off — tumbling, board flipping away — then
 * swimming back, climbing on and carrying on. A big set sweeps everyone.
 */
export class SurferController extends Controller<SurfKey, SurfState> {
  /** The board, which can come away from its rider. */
  board: BoardFrame;
  attached = true;
  /** "Catch the next wave": paddle for the next one that comes, no matter what. */
  intentCatch = false;
  private stroke = 0;
  private speed = 0;
  private carve = 0;
  private side = 1;
  private rideWave: Wave | null = null;
  private rideTarget = 0.5;
  private rideFall = -1;
  private target: { x: number; z: number } | null = null;
  private think: number;
  private readonly rand: () => number;
  private wipe = { vx: 0, vz: 0, bvx: 0, bvz: 0, spin: 0 };
  private climbFrom = { x: 0, z: 0, heading: 0 };
  private markTimer = 0;
  private markSide = 1;
  /** A wave it just dived under or rode out of: that one has had its chance. */
  private escaped: Wave | null = null;

  constructor(seed: number, x: number, z: number, heading: number) {
    super(SURF_KEYS, seed, x, z, heading, 'wait');
    this.board = { x, y: WATER_Y, z, heading };
    this.rand = seededRandom(seed * 31 + 5);
    this.think = 2 + this.rand() * 4;
  }

  get busy(): boolean {
    return this.state === 'ride' || this.state === 'wipeout' || this.state === 'swim' || this.state === 'climb';
  }

  get riding(): boolean {
    return this.state === 'ride';
  }

  get inTheWater(): boolean {
    return !this.attached;
  }

  /** Teleport (drag, undo): the board comes too, and any tumble is over. */
  placeAt(x: number, z: number): void {
    super.placeAt(x, z);
    this.board = { ...this.board, x, z, heading: this.heading };
    if (!this.attached || this.state === 'ride') {
      this.attached = true;
      this.enter('wait', 0.3);
    }
  }

  /** A small push (from a neighbour making room); the board comes along if it's under them. */
  nudge(dx: number, dz: number): void {
    if (seaRegion(this.x + dx, this.z + dz, 1.0) < seaRegion(this.x, this.z, 1.0) && seaRegion(this.x, this.z, 1.0) < 0.2) return;
    this.x += dx;
    this.z += dz;
    if (this.attached) this.board = { ...this.board, x: this.x, z: this.z };
  }

  // --- what you can ask of a surfer -------------------------------------------------

  paddleOut(): void {
    if (this.busy) return;
    // further out to sea: toward the side the waves come from
    const x = Math.min(bounds.maxX - 2, this.x + 4 + this.rand() * 3);
    const z = Math.max(bounds.minZ + 1.5, Math.min(bounds.maxZ - 1.5, this.z + (this.rand() - 0.5) * 3));
    this.target = { x, z };
    this.intentCatch = false;
    this.enter('paddle', 0.4);
  }

  wait(): void {
    this.intentCatch = false;
    if (!this.busy) this.enter('wait', 0.5);
  }

  catchNext(): void {
    this.intentCatch = true;
    if (!this.busy) this.enter('catch', 0.4);
  }

  wipeOut(): void {
    if (this.state === 'wipeout' || this.state === 'swim' || this.state === 'climb') return;
    this.startWipeout(null, 0.6);
  }

  private startWipeout(wave: Wave | null, strength: number): void {
    const push = wave ? wave.speed : 0.8;
    const lat = (this.rand() - 0.5) * 1.2;
    this.wipe = {
      vx: WAVE_DIR[0] * push * 0.75 * strength,
      vz: WAVE_DIR[1] * push * 0.75 * strength,
      bvx: WAVE_DIR[0] * push * 1.05 * strength - WAVE_DIR[1] * lat,
      bvz: WAVE_DIR[1] * push * 1.05 * strength + WAVE_DIR[0] * lat,
      spin: (this.rand() - 0.5) * 4,
    };
    this.attached = false;
    this.escaped = wave;
    this.rideWave = null;
    this.speed = 0;
    this.enter('wipeout', 0.12);
  }

  private lookForWave(s: WaveSample | null): void {
    if (!s || s.power < 0.45 || s.e < 0 || s.e > 7) return;
    if (this.intentCatch || this.rand() < 0.5) this.enter('catch', 0.35);
  }

  private wanderTarget(): void {
    // somewhere else to sit; mostly out the back, toward where the waves come from
    const W = bounds.maxX - bounds.minX;
    const out = this.rand() < 0.6;
    const x = out ? bounds.minX + W * (0.55 + this.rand() * 0.35) : bounds.minX + W * (0.15 + this.rand() * 0.5);
    const z = bounds.minZ + 1.5 + this.rand() * (bounds.maxZ - bounds.minZ - 3);
    this.target = { x, z };
    this.enter('paddle', 0.45);
  }

  // --- moving -------------------------------------------------------------------------

  private avoid(wanted: number): number {
    return avoidRate(region, this.x, this.z, this.heading, 0.8 * this.scale + this.speed, 2.2, this.prefer(wanted));
  }

  private move(distance: number): void {
    [this.x, this.z] = slide(region, this.x, this.z, this.heading, distance);
  }

  private paddleToward(tx: number, tz: number, maxSpeed: number, dt: number): number {
    const d = Math.hypot(tx - this.x, tz - this.z);
    const toward = headingTo(this.x, this.z, tx, tz);
    const facing = Math.cos(wrapAngle(toward - this.heading));
    const want = maxSpeed * Math.min(1, d / (0.8 * this.scale)) * Math.max(0.2, (facing + 1) / 2) ** 1.5;
    this.speed += (want - this.speed) * Math.min(1, dt * 1.5);
    const rate = this.rateToward(toward, 1.4);
    this.turnAt(rate + this.avoid(rate), dt);
    this.move(this.speed * dt);
    return d;
  }

  private marks(dt: number, sense: SeaSense, every: number, strength: number): void {
    this.markTimer += dt;
    if (this.markTimer < every) return;
    this.markTimer = 0;
    this.markSide = -this.markSide;
    // rings shed off alternate rails, a little behind: the wake's soft V
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const back = 0.32 * this.scale;
    const off = 0.08 * this.scale * this.markSide;
    sense.ripple(this.x - c * back + s * off, this.z + s * back + c * off, strength);
  }

  // --- the frame -------------------------------------------------------------------------

  update(dt: number, sense: SeaSense): SurferFrame {
    this.advance(dt);
    const t = sense.time;
    const s = sense.sample(this.x, this.z);
    if (!this.held) {
      if (this.state !== 'ride') [this.x, this.z] = recover(region, this.x, this.z, dt, 0);
      this.step(dt, sense, s, t);
    }
    if (this.attached) this.board = { x: this.x, y: 0, z: this.z, heading: this.heading };
    // ride the swell; lift a little on a wave's face
    const lift = s && s.e > 0 && s.e < s.faceWidth * 1.4 ? 0.1 * s.power * (1 - s.e / (s.faceWidth * 1.4)) : 0;
    const y = WATER_Y + swell(this.x, this.z, t) + lift;
    this.board = { ...this.board, y: WATER_Y + swell(this.board.x, this.board.z, t) + (this.attached ? lift : 0) };
    const effort = Math.min(1, this.speed / (0.9 * this.scale));
    this.stroke += (this.state === 'swim' ? 4.2 : this.state === 'wait' || this.state === 'ride' || this.state === 'wipeout' ? 0 : 3.2 + 3.5 * effort) * dt;
    const pose = surfPose(this.state, this.stateTime, this.seed, this.stroke, effort, this.carve, this.side);
    return { x: this.x, y, z: this.z, heading: this.heading, pose: this.shown(pose), board: this.board };
  }

  private step(dt: number, sense: SeaSense, s: WaveSample | null, t: number): void {
    const hit = this.state !== 'dive' && this.state !== 'ride' ? sense.foamAt(this.x, this.z) : null;
    const foam = this.attached && !!hit && hit !== this.escaped;
    switch (this.state) {
      case 'wait': {
        // face out to sea, drift a little with the swell
        this.speed *= 1 - Math.min(1, dt * 1.2);
        this.turnAt(this.rateToward(OUT_HEADING, 0.35) * 0.6, dt, 0.6);
        this.move((0.06 + this.speed) * dt * 0.5);
        if (foam) {
          this.startWipeout(s?.wave ?? null, 1);
          sense.splash(this.x, this.z, 0.8);
          break;
        }
        this.think -= dt;
        if (this.intentCatch) this.lookForWave(s);
        if (this.think <= 0) {
          this.think = 3 + this.rand() * 5;
          if (s && s.e > 0 && s.e < 7 && s.power > 0.45) this.lookForWave(s);
          else if (this.rand() < 0.4) this.wanderTarget();
        }
        break;
      }
      case 'paddle': {
        const to = this.target;
        if (foam) {
          this.startWipeout(s?.wave ?? null, 1);
          sense.splash(this.x, this.z, 0.8);
          break;
        }
        // white water coming: shove the nose under it
        if (s && s.e > 0 && s.e < 1.4 && s.power > 0.35 && !s.wave.big) {
          this.escaped = s.wave;
          this.enter('dive', 0.15);
          sense.ripple(this.x, this.z, 0.7);
          break;
        }
        if (!to || this.paddleToward(to.x, to.z, 0.95 * this.scale * 0.5, dt) < 0.4 * this.scale || this.stateTime > 14) {
          this.target = null;
          this.settle(0.5);
        }
        this.marks(dt, sense, 0.42, 0.3);
        break;
      }
      case 'dive':
        this.speed *= 1 - Math.min(1, dt * 0.8);
        this.move(this.speed * dt * 0.5);
        if (this.stateTime > 1.0 && this.stateTime - dt <= 1.0) sense.ripple(this.x, this.z, 0.5);
        if (this.stateTime >= DIVE.duration) this.enter(this.target ? 'paddle' : 'wait', 0.3);
        break;
      case 'catch': {
        // turn toward the beach and paddle hard as the face comes
        const rate = this.rateToward(IN_HEADING, 1.6);
        this.turnAt(rate + this.avoid(rate), dt);
        const near = s && s.e > 0 && s.e < 4;
        const want = (near ? 1.3 : 0.25) * this.scale * 0.5;
        this.speed += (want - this.speed) * Math.min(1, dt * 1.8);
        this.move(this.speed * dt);
        this.marks(dt, sense, 0.3, 0.35);
        if (s && s.power > 0.4 && s.e > -0.2 && s.e < s.faceWidth + 0.4 && Math.abs(wrapAngle(this.heading - IN_HEADING)) < 0.9) {
          this.startRide(s, sense);
          break;
        }
        if (foam) {
          this.startWipeout(s?.wave ?? null, 1);
          sense.splash(this.x, this.z, 0.8);
          break;
        }
        if (this.stateTime > (this.intentCatch ? 30 : 12)) {
          this.intentCatch = false;
          this.settle(0.5);
        }
        break;
      }
      case 'ride':
        this.rideStep(dt, sense, t);
        break;
      case 'wipeout': {
        const k = Math.exp(-this.stateTime * 1.1);
        [this.x, this.z] = slide(region, this.x, this.z, Math.atan2(-this.wipe.vz, this.wipe.vx), Math.hypot(this.wipe.vx, this.wipe.vz) * k * dt);
        const bh = Math.atan2(-this.wipe.bvz, this.wipe.bvx);
        const [bx, bz] = slide(region, this.board.x, this.board.z, bh, Math.hypot(this.wipe.bvx, this.wipe.bvz) * k * dt);
        this.board = { ...this.board, x: bx, z: bz, heading: this.board.heading + this.wipe.spin * k * dt };
        if (this.stateTime < 1.2 && Math.floor(this.stateTime * 6) !== Math.floor((this.stateTime - dt) * 6)) sense.ripple(this.x, this.z, 0.4);
        if (this.stateTime >= WIPEOUT.duration) this.enter('swim', 0.4);
        break;
      }
      case 'swim': {
        if (hit && hit !== this.escaped && this.stateTime > 0.5) {
          this.startWipeout(s?.wave ?? null, 0.8);
          break;
        }
        const d = this.paddleToward(this.board.x, this.board.z, 0.55 * this.scale * 0.5, dt);
        this.marks(dt, sense, 0.5, 0.2);
        if (d < 0.32 * this.scale) {
          this.climbFrom = { x: this.x, z: this.z, heading: this.heading };
          this.enter('climb', 0.3);
        }
        break;
      }
      case 'climb': {
        // haul back aboard: slide onto the board, turning to line up with it
        const k = Math.min(1, this.stateTime / CLIMB.duration);
        const e = k * k * (3 - 2 * k);
        this.x = this.climbFrom.x + (this.board.x - this.climbFrom.x) * e;
        this.z = this.climbFrom.z + (this.board.z - this.climbFrom.z) * e;
        this.heading = wrapAngle(this.climbFrom.heading + wrapAngle(this.board.heading - this.climbFrom.heading) * e);
        if (this.stateTime >= CLIMB.duration) {
          this.attached = true;
          this.heading = this.board.heading;
          this.think = 1 + this.rand() * 2;
          this.enter('wait', 0.5);
        }
        break;
      }
    }
  }

  private startRide(s: WaveSample, sense: SeaSense): void {
    const w = s.wave;
    const u = across(this.x, this.z);
    // ride along the shoulder, away from the peak
    this.side = Math.abs(u - w.u0) < 0.6 ? (this.rand() < 0.5 ? 1 : -1) : Math.sign(u - w.u0);
    this.rideWave = w;
    this.rideTarget = 0.45;
    this.intentCatch = false;
    // now and then a ride ends in a comic nose-dive
    this.rideFall = this.rand() < 0.18 ? 2 + this.rand() * 3 : -1;
    this.speed = w.speed;
    this.enter('ride', 0.25);
    sense.splash(this.x, this.z, 0.35);
  }

  private rideStep(dt: number, sense: SeaSense, t: number): void {
    const w = this.rideWave;
    if (!w) {
      this.settle(0.5);
      return;
    }
    const u = across(this.x, this.z);
    const a = along(this.x, this.z);
    const power = wavePower(w, t) * waveEnvelope(w, u);
    // gentle S-turns: up the face and down again, just ahead of the foam
    this.carve = Math.sin(this.stateTime * 1.4 + this.seed);
    const targetE = this.rideTarget + 0.28 * this.carve;
    const crest = crestAt(w, u, t);
    const va = w.speed + Math.max(-1.2, Math.min(1.2, (crest + targetE - a) * 2.4));
    const vu = this.side * (1.6 + 0.4 * this.carve) * Math.min(1, this.stateTime / 0.6 + 0.3);
    // world velocity from along/across components
    const vx = va * WAVE_DIR[0] + vu * -WAVE_DIR[1];
    const vz = va * WAVE_DIR[1] + vu * WAVE_DIR[0];
    const want = Math.atan2(-vz, vx);
    this.turnAt(this.rateToward(want, 3.2, 4), dt, 0.12);
    const v = Math.hypot(vx, vz);
    const nx = this.x + vx * dt;
    const nz = this.z + vz * dt;
    this.x = nx;
    this.z = nz;
    this.speed = v;
    this.marks(dt, sense, 0.11, 0.45);
    const fell = this.rideFall > 0 && this.stateTime > this.rideFall;
    if (fell) {
      sense.splash(this.x, this.z, 0.9);
      this.startWipeout(w, 0.8);
      return;
    }
    // kick out when the wave spends itself, the shoulder runs out, or the edge of the sea comes up
    if (power < 0.3 || Math.abs(u - w.u0) > w.halfLen - 0.5 || region(this.x, this.z) < 0.4 || this.stateTime > 10) {
      this.escaped = w;
      this.rideWave = null;
      this.speed = 0.4;
      sense.ripple(this.x, this.z, 0.6);
      this.settle(0.6);
    }
  }
}
