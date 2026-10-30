import { describe, expect, test } from 'vitest';
import { across, along, crestAt, sampleWave, WAVE_DIR, WaveField, wavePower, type Wave } from '../../src/scene/waves';
import { bounds } from '../../src/scene/sea';

const wave = (over: Partial<Wave> = {}): Wave => ({ origin: -20, speed: 2, start: 0, life: 25, u0: 0, halfLen: 10, seed: 1, big: 0, ...over });

describe('breaking waves', () => {
  test('travel left (and a little toward the viewer) at their speed', () => {
    expect(WAVE_DIR[0]).toBeLessThan(-0.9);
    const w = wave();
    expect(crestAt(w, 3, 5) - crestAt(w, 3, 4)).toBeCloseTo(2, 6);
  });

  test('the crest is continuous across the wave', () => {
    const w = wave();
    for (let u = -15; u < 15; u += 0.05) expect(Math.abs(crestAt(w, u + 0.05, 3) - crestAt(w, u, 3))).toBeLessThan(0.08);
  });

  test('fade in, live, and spend themselves', () => {
    const w = wave();
    expect(wavePower(w, -1)).toBe(0);
    expect(wavePower(w, 0)).toBe(0);
    expect(wavePower(w, 10)).toBeCloseTo(1, 6);
    expect(wavePower(w, 25.1)).toBe(0);
    expect(wavePower(wave({ big: 1 }), 10)).toBeGreaterThan(1);
  });

  test('a point is ahead of the crest (face side) before it passes, in white water just after', () => {
    const w = wave();
    const x = 0, z = 0;
    const before = sampleWave(w, x, z, 5);
    expect(before.e).toBeGreaterThan(0);
    // when the crest has just passed the point, it is behind it, in the foam
    let t = 5;
    while (sampleWave(w, x, z, t).e > -0.5) t += 0.05;
    const after = sampleWave(w, x, z, t);
    expect(after.e).toBeLessThan(0);
    expect(after.e).toBeGreaterThan(-after.foamWidth);
  });

  test('only the middle of an ordinary wave breaks; a big set spans everything', () => {
    const w = wave({ halfLen: 6 });
    const far = sampleWave(w, -along(0, 30) * 0, 30, 10);
    expect(far.power).toBe(0);
    const big = wave({ big: 1 });
    expect(sampleWave(big, 0, 30, 10).power).toBeGreaterThan(0.9);
    void across;
  });
});

describe('the wave schedule', () => {
  test('ordinary waves every 8–15 s, a big set within 90 s, nothing new while calm', () => {
    const f = new WaveField(null, 3);
    let t = 0;
    let spawned = 0;
    let big = 0;
    const seen = new Set<Wave>();
    for (; t < 95; t += 1 / 30) {
      f.update(t, 1 / 30);
      for (const w of f.waves) if (!seen.has(w)) {
        seen.add(w);
        spawned++;
        if (w.big) big++;
      }
    }
    expect(spawned).toBeGreaterThanOrEqual(6);
    expect(big).toBeGreaterThanOrEqual(1);
    const calm = new WaveField(null, 3);
    calm.calm = true;
    for (t = 0; t < 40; t += 1 / 30) calm.update(t, 1 / 30);
    expect(calm.waves).toHaveLength(0);
  });

  test('a called big set arrives after its warning and sweeps across the visible sea', () => {
    const f = new WaveField(null, 4);
    f.calm = true;
    f.callBigSet(0, 2);
    f.update(1, 1);
    expect(f.waves).toHaveLength(0);
    f.update(2.1, 1.1);
    expect(f.waves.some((w) => w.big)).toBe(true);
    // over its life it puts every corner of the view in white water at some point
    for (const [x, z] of [[bounds.minX + 1, bounds.minZ + 1], [bounds.maxX - 1, bounds.maxZ - 1]]) {
      let wet = false;
      for (let t = 2.1; t < 30 && !wet; t += 0.1) wet = !!f.foamAt(x, z, t);
      expect(wet).toBe(true);
    }
  });
});
