import { describe, expect, test } from 'vitest';
import { SurferController, IN_HEADING, OUT_HEADING, type SeaSense } from '../../src/surfers/SurferController';
import { CLIMB, surfPose, tumblePose, WIPEOUT, type SurfState } from '../../src/surfers/behaviors';
import { isFinitePose, SURF_KEYS, type SurfKey } from '../../src/surfers/pose';
import { WaveField } from '../../src/scene/waves';
import { seaRegion } from '../../src/scene/sea';
import { wrapAngle } from '../../src/surfers/controllers/base';
import { seededRandom } from '../../src/scene/noise';
import type { SurferFrame } from '../../src/surfers/SurferView';

/** A sea with a wave field and a clock, as the manager provides. */
function sea(field = new WaveField(null, 9)) {
  const clock = { t: 0 };
  const sense: SeaSense = {
    get time() {
      return clock.t;
    },
    sample: (x, z) => field.sample(x, z, clock.t),
    foamAt: (x, z) => field.foamAt(x, z, clock.t),
    approaching: (x, z) => field.approaching(x, z, clock.t),
    ripple: () => {},
    splash: () => {},
  };
  const step = (c: SurferController, seconds: number, each?: (f: SurferFrame) => void) => {
    let f = c.update(0, sense);
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      clock.t += 1 / 60;
      field.update(clock.t, 1 / 60);
      f = c.update(1 / 60, sense);
      each?.(f);
    }
    return f;
  };
  return { field, sense, clock, step };
}

const surfer = (x = 0, z = 0, seed = 5) => {
  const c = new SurferController(seed, x, z, OUT_HEADING);
  c.scale = 2.1;
  return c;
};

describe('poses', () => {
  test('every state stays finite over long runs', () => {
    for (const s of ['wait', 'paddle', 'catch', 'dive', 'ride', 'wipeout', 'swim', 'climb'] as SurfState[]) {
      for (let t = 0; t < 200; t += 0.37) expect(isFinitePose(SURF_KEYS, surfPose(s, t, 7, t * 4, 0.6, Math.sin(t), 1)), `${s} ${t}`).toBe(true);
    }
  });

  test('a tumble always ends the right way up', () => {
    const end = tumblePose(WIPEOUT.duration, 3);
    const upright = (a: number) => Math.abs(wrapAngle(a));
    expect(upright(end.tumble)).toBeLessThan(1e-6);
    expect(upright(end.tumbleRoll)).toBeLessThan(1e-6);
  });

  test('climbing back on rights the board', () => {
    expect(Math.abs(wrapAngle(surfPose('climb', CLIMB.duration, 1, 0, 0, 0, 1).boardRoll))).toBeLessThan(0.2);
  });
});

describe('surfers and waves', () => {
  test('a surfer asked to catch the next wave rides it, then kicks out and sits up', () => {
    const { field, step } = sea();
    field.calm = true;
    const c = surfer(-2, 1);
    c.catchNext();
    field.spawn(0);
    const states = new Set<string>();
    step(c, 30, () => states.add(c.state));
    expect(states.has('ride')).toBe(true);
    expect(['wait', 'paddle', 'swim', 'climb', 'wipeout']).toContain(c.state);
  });

  test('a rider stays just ahead of the white water while riding', () => {
    const { field, sense, step } = sea();
    field.calm = true;
    const c = surfer(-2, 1);
    c.catchNext();
    field.spawn(0);
    let rode = 0;
    step(c, 30, (f) => {
      if (c.state !== 'ride' || c.stateTime < 0.6) return;
      const s = sense.sample(f.x, f.z);
      if (!s) return;
      rode++;
      expect(s.e).toBeGreaterThan(-0.6);
      expect(s.e).toBeLessThan(s.faceWidth + 1.5);
    });
    expect(rode).toBeGreaterThan(30);
  });

  test('a surfer caught by white water is swept off, swims back and climbs on', () => {
    const { field, step } = sea();
    field.calm = true;
    const c = surfer(0, 0);
    // a big set can't be dived under
    field.callBigSet(0, 0.01);
    const states: string[] = [];
    step(c, 40, () => {
      if (states[states.length - 1] !== c.state) states.push(c.state);
    });
    expect(states).toContain('wipeout');
    expect(states.indexOf('swim')).toBeGreaterThan(states.indexOf('wipeout'));
    expect(states).toContain('climb');
    expect(c.attached).toBe(true);
  });

  test('a surfer paddling out duck-dives under white water and keeps going', () => {
    const { field, step } = sea();
    field.calm = true;
    const c = surfer(-6, 0);
    // the wave is already most of the way across when they set off
    field.spawn(-8.5);
    c.paddleOut();
    const states = new Set<string>();
    step(c, 25, () => states.add(c.state));
    expect(states.has('dive')).toBe(true);
    expect(states.has('wipeout')).toBe(false);
  });

  test('the big set sweeps everyone off, and everyone is back on their board after', () => {
    const { field, step, clock, sense } = sea();
    field.calm = true;
    const crew = [surfer(-8, -4, 1), surfer(-2, 3, 2), surfer(5, -2, 3), surfer(8, 4, 4)];
    crew[1].paddleOut();
    field.callBigSet(0, 1);
    const swept = new Set<number>();
    for (let i = 0; i < 60 * 45; i++) {
      clock.t += 1 / 60;
      field.update(clock.t, 1 / 60);
      crew.forEach((c, k) => {
        c.update(1 / 60, sense);
        if (c.state === 'wipeout') swept.add(k);
      });
    }
    expect(swept.size).toBe(crew.length);
    for (const c of crew) expect(c.attached).toBe(true);
    void step;
  });

  test('turning to catch faces the beach; waiting faces out to sea', () => {
    const { field, step } = sea();
    field.calm = true;
    const c = surfer(0, 0);
    c.catchNext();
    step(c, 3);
    expect(Math.abs(wrapAngle(c.heading - IN_HEADING))).toBeLessThan(0.3);
    c.wait();
    step(c, 7);
    if (c.state === 'wait') expect(Math.abs(wrapAngle(c.heading - OUT_HEADING))).toBeLessThan(0.4);
  });
});

describe('under rapid, random input', () => {
  test('a surfer stays finite and in the sea whatever happens', () => {
    const { field, step } = sea();
    const rand = seededRandom(11);
    const c = surfer(0, 0);
    let i = 0;
    step(c, 300, (f) => {
      i++;
      const r = rand();
      if (r < 0.004) c.paddleOut();
      else if (r < 0.008) c.catchNext();
      else if (r < 0.01) c.wipeOut();
      else if (r < 0.012) c.wait();
      if (i % 1500 === 0) field.callBigSet(field.waves.length, 0.5);
      expect([f.x, f.y, f.z, f.heading, f.board.x, f.board.z].every(Number.isFinite)).toBe(true);
      expect(isFinitePose(SURF_KEYS, f.pose)).toBe(true);
      expect(seaRegion(f.x, f.z, 1.0)).toBeGreaterThan(-0.6);
    });
  });
});

describe('smooth motion', () => {
  /** Frame-to-frame heading flicker, pose jumps and position jumps. */
  function measure(c: SurferController, step: ReturnType<typeof sea>['step'], seconds: number, keys: SurfKey[]) {
    let prev: SurferFrame | null = null;
    let prevDh = 0;
    let prevV = 0;
    let flips = 0;
    let jump = 0;
    const pose: Record<string, number> = {};
    step(c, seconds, (f) => {
      if (prev && c.state !== 'climb' && c.state !== 'wipeout') {
        const dh = wrapAngle(f.heading - prev.heading);
        if (Math.abs(dh) > 0.003 && Math.abs(prevDh) > 0.003 && Math.sign(dh) !== Math.sign(prevDh)) flips++;
        prevDh = dh;
        const v = Math.hypot(f.x - prev.x, f.z - prev.z);
        jump = Math.max(jump, Math.abs(v - prevV));
        prevV = v;
        for (const k of keys) pose[k] = Math.max(pose[k] ?? 0, Math.abs(f.pose[k] - prev.pose[k]));
      }
      prev = f;
    });
    return { flips, jump, pose };
  }

  test('waiting, paddling and riding through minutes of waves: no flicker, no snaps, no jumps', () => {
    for (const [x, z, seed] of [[0, 0, 5], [-8, 3, 6], [7, -4, 7]]) {
      const { step } = sea(new WaveField(null, seed));
      const c = surfer(x, z, seed);
      const m = measure(c, step, 240, ['spine', 'headYaw', 'armL', 'legL', 'roll']);
      expect(m.flips, `${x},${z}`).toBeLessThan(6);
      expect(m.jump).toBeLessThan(0.08);
      expect(m.pose.headYaw).toBeLessThan(0.12);
      expect(m.pose.roll).toBeLessThan(0.12);
    }
  });
});
