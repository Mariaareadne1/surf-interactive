import { bounds } from './sea';
import { seededRandom } from './noise';
import type { WorldUniforms } from './world';

/**
 * Breaking waves: each is a long, irregular band rolling across the sea from
 * the right toward the left. Its crest is a line across the direction of
 * travel, wobbling and pushed forward into a peak where the wave peels.
 * Behind the crest is white water; just ahead of it, the face, in shadow.
 *
 * Everything is a pure function of the wave's parameters, position and time,
 * with an exact GLSL twin, so surfers and paint always agree on where the
 * foam and the face are.
 */

/** Direction waves travel (x, z): left, and a little toward the viewer. */
export const WAVE_DIR: [number, number] = (() => {
  const x = -1;
  const z = 0.22;
  const l = Math.hypot(x, z);
  return [x / l, z / l];
})();
/** Across the crest. */
export const WAVE_ACROSS: [number, number] = [-WAVE_DIR[1], WAVE_DIR[0]];

export const MAX_WAVES = 6;

export interface Wave {
  /** Along-travel coordinate of the crest when the wave starts (m). */
  origin: number;
  speed: number;
  start: number;
  life: number;
  /** Across-crest centre and half-length of the wave (m); the peak sits at u0. */
  u0: number;
  halfLen: number;
  seed: number;
  /** 1 for the big set: wider, whiter, the whole width of the sea. */
  big: number;
}

export interface WaveSample {
  /** Signed distance (m) from the crest along travel: > 0 ahead (the face, then flat water), < 0 behind (white water). */
  e: number;
  /** 0..1: how much of this wave is here (across-crest envelope × life). */
  power: number;
  foamWidth: number;
  faceWidth: number;
  wave: Wave;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const along = (x: number, z: number) => x * WAVE_DIR[0] + z * WAVE_DIR[1];
export const across = (x: number, z: number) => x * WAVE_ACROSS[0] + z * WAVE_ACROSS[1];

/** How strong the wave is at time t (fades in, then spends itself). */
export function wavePower(w: Wave, t: number): number {
  const age = t - w.start;
  if (age < 0 || age > w.life) return 0;
  return smooth(0, 1.5, age) * (1 - smooth(w.life - 4, w.life, age)) * (1 + 0.35 * w.big);
}

/** Where the crest is (along-travel) at across-coordinate u and time t. */
export function crestAt(w: Wave, u: number, t: number): number {
  const s = w.origin + w.speed * (t - w.start);
  const wob = 0.7 * Math.sin(u * 0.21 + w.seed) + 0.35 * Math.sin(u * 0.53 + w.seed * 2.3);
  const peak = (1.8 + 1.2 * w.big) * Math.exp(-((u - w.u0) ** 2) / (2 * (2.2 + 4 * w.big) ** 2));
  return s + wob + peak;
}

export function waveEnvelope(w: Wave, u: number): number {
  if (w.big > 0.5) return 1;
  return smooth(w.halfLen, w.halfLen - 3.5, Math.abs(u - w.u0));
}

export function sampleWave(w: Wave, x: number, z: number, t: number): WaveSample {
  const u = across(x, z);
  const e = along(x, z) - crestAt(w, u, t);
  const power = waveEnvelope(w, u) * wavePower(w, t);
  const foamWidth = (4.2 + 3.5 * w.big + 1.2 * Math.sin(u * 0.37 + w.seed)) * Math.min(1, power + 0.2);
  const faceWidth = 1.25 + 1.0 * w.big;
  return { e, power, foamWidth, faceWidth, wave: w };
}

/** The GLSL twin of the wave functions (uniforms: uWaveA = origin, speed, start, life; uWaveB = u0, halfLen, seed, big). */
export const WAVES_GLSL = /* glsl */ `
const vec2 WAVE_DIR = vec2(${WAVE_DIR[0].toFixed(6)}, ${WAVE_DIR[1].toFixed(6)});
const vec2 WAVE_ACROSS = vec2(${WAVE_ACROSS[0].toFixed(6)}, ${WAVE_ACROSS[1].toFixed(6)});
float wsmooth(float a, float b, float v) { float t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float wavePower(vec4 A, vec4 B, float t) {
  float age = t - A.z;
  if (age < 0.0 || age > A.w) return 0.0;
  return wsmooth(0.0, 1.5, age) * (1.0 - wsmooth(A.w - 4.0, A.w, age)) * (1.0 + 0.35 * B.w);
}
float crestAt(vec4 A, vec4 B, float u, float t) {
  float s = A.x + A.y * (t - A.z);
  float wob = 0.7 * sin(u * 0.21 + B.z) + 0.35 * sin(u * 0.53 + B.z * 2.3);
  float sig = 2.2 + 4.0 * B.w;
  float peak = (1.8 + 1.2 * B.w) * exp(-(u - B.x) * (u - B.x) / (2.0 * sig * sig));
  return s + wob + peak;
}
float waveEnvelope(vec4 B, float u) {
  if (B.w > 0.5) return 1.0;
  return wsmooth(B.y, B.y - 3.5, abs(u - B.x));
}
`;

export interface WaveFieldOptions {
  calm?: boolean;
}

/**
 * The schedule: an ordinary wave every 8–15 s, a big set every 60–90 s (or
 * on demand), nothing new while calm. Keeps at most MAX_WAVES alive and
 * writes them into the shared uniforms each frame.
 */
export class WaveField {
  waves: Wave[] = [];
  calm = false;
  private nextWave = 2.5;
  private nextBig: number;
  /** Seconds of warning before a big set arrives (the sea darkens and draws back). */
  bigWarning = 0;
  private pendingBig = -1;
  private readonly rand: () => number;
  /** Fired when a big set is announced (for a hint) and when it begins. */
  onBigSet: ((phase: 'warning' | 'arriving') => void) | null = null;

  constructor(private readonly world: WorldUniforms | null, seed = 7) {
    this.rand = seededRandom(seed);
    this.nextBig = 60 + this.rand() * 30;
  }

  /** The along-travel range the waves cross: from beyond the right of the view to beyond the left. */
  private span(): { from: number; to: number; uMin: number; uMax: number } {
    const xs = [bounds.minX - 4, bounds.maxX + 4];
    const zs = [bounds.minZ - 4, bounds.maxZ + 4];
    let from = Infinity, to = -Infinity, uMin = Infinity, uMax = -Infinity;
    for (const x of xs) for (const z of zs) {
      const a = along(x, z);
      const u = across(x, z);
      from = Math.min(from, a);
      to = Math.max(to, a);
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
    }
    // start just off-screen: the wave fades in as it forms, so there is no long wait before it appears
    return { from: from + 0.5, to: to + 4, uMin, uMax };
  }

  spawn(t: number, big = false): Wave {
    const s = this.span();
    const speed = big ? 2.6 : 1.7 + this.rand() * 0.5;
    const wave: Wave = {
      origin: s.from,
      speed,
      start: t,
      life: (s.to - s.from) / speed,
      u0: big ? (s.uMin + s.uMax) / 2 : s.uMin + (0.2 + this.rand() * 0.6) * (s.uMax - s.uMin),
      halfLen: big ? 99 : 7 + this.rand() * 6,
      seed: this.rand() * 6.28,
      big: big ? 1 : 0,
    };
    this.waves = [...this.waves.filter((w) => t - w.start < w.life), wave].slice(-MAX_WAVES);
    return wave;
  }

  /** Call a big set now (with a short warning). */
  callBigSet(t: number, warning = 2.5): void {
    if (this.pendingBig > t) return;
    this.pendingBig = t + warning;
    this.bigWarning = warning;
    this.onBigSet?.('warning');
  }

  update(t: number, dt: number): void {
    this.waves = this.waves.filter((w) => t - w.start < w.life);
    if (this.pendingBig > 0) {
      this.bigWarning = Math.max(0, this.pendingBig - t);
      if (t >= this.pendingBig) {
        this.pendingBig = -1;
        this.spawn(t, true);
        this.onBigSet?.('arriving');
      }
    }
    if (!this.calm) {
      this.nextWave -= dt;
      this.nextBig -= dt;
      if (this.nextWave <= 0) {
        this.spawn(t);
        this.nextWave = 8 + this.rand() * 7;
      }
      if (this.nextBig <= 0) {
        this.callBigSet(t, 3);
        this.nextBig = 60 + this.rand() * 30;
      }
    }
    this.write(t);
  }

  /** The wave that matters most at (x, z): the one whose crest is nearest, weighted by its power. */
  sample(x: number, z: number, t: number): WaveSample | null {
    let best: WaveSample | null = null;
    let score = -Infinity;
    for (const w of this.waves) {
      const s = sampleWave(w, x, z, t);
      if (s.power <= 0.02) continue;
      const sc = s.power - Math.abs(s.e) * 0.05 - (s.e < -s.foamWidth * 2 ? 2 : 0);
      if (sc > score) {
        score = sc;
        best = s;
      }
    }
    return best;
  }

  /** The next wave coming toward (x, z): crest still ahead of the point, nearest first, breaking here or not. */
  approaching(x: number, z: number, t: number): { wave: Wave; e: number; u: number } | null {
    let best: { wave: Wave; e: number; u: number } | null = null;
    for (const w of this.waves) {
      if (wavePower(w, t) < 0.3) continue;
      const u = across(x, z);
      const e = along(x, z) - crestAt(w, u, t);
      if (e > 0 && (!best || e < best.e)) best = { wave: w, e, u };
    }
    return best;
  }

  /** The wave whose breaking white water is at (x, z) right now, if any (the biggest if several). */
  foamAt(x: number, z: number, t: number): Wave | null {
    let hit: Wave | null = null;
    for (const w of this.waves) {
      const s = sampleWave(w, x, z, t);
      if (s.power > 0.25 && s.e < 0.15 && s.e > -s.foamWidth && (!hit || w.big > hit.big)) hit = w;
    }
    return hit;
  }

  private write(t: number): void {
    if (!this.world) return;
    const A = this.world.uWaveA.value;
    const B = this.world.uWaveB.value;
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waves[i];
      if (w) {
        A[i].set(w.origin, w.speed, w.start, w.life);
        B[i].set(w.u0, w.halfLen, w.seed, w.big);
      } else {
        A[i].set(0, 0, -1000, 0);
        B[i].set(0, 0, 0, 0);
      }
    }
    this.world.uBigWarning.value = Math.min(1, this.bigWarning > 0 ? 1 - this.bigWarning / 3 : 0);
    void t;
  }
}
