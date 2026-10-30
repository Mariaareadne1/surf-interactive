import { describe, expect, test } from 'vitest';
import { analyzeStroke, decimate, smooth, strokeLength, type Pt } from '../../src/interaction/stroke';

function loop(cx: number, cy: number, rx: number, ry: number, headBump = 0, n = 60): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const head = Math.exp(-((t - 5.6) ** 2) / 0.12) * headBump;
    pts.push({ x: cx + Math.cos(t) * rx + head * rx * 0.45, y: cy + Math.sin(t) * ry - head * ry * 0.65 });
  }
  return pts;
}

describe('stroke analysis', () => {
  test('a closed loop is valid and closed', () => {
    const a = analyzeStroke(loop(400, 300, 60, 35));
    expect(a.valid).toBe(true);
    expect(a.closed).toBe(true);
  });

  test('the foot sits near the bottom of the drawing', () => {
    const a = analyzeStroke(loop(400, 300, 60, 35));
    expect(a.foot.y).toBeGreaterThan(300 + 35 * 0.7);
    expect(a.foot.y).toBeLessThanOrEqual(335);
    expect(Math.abs(a.foot.x - 400)).toBeLessThan(10);
  });

  test('a head bump on the right faces right; mirrored faces left', () => {
    const right = loop(400, 300, 60, 35, 1);
    expect(analyzeStroke(right).facing).toBe(1);
    const left = right.map((p) => ({ x: 800 - p.x, y: p.y }));
    expect(analyzeStroke(left).facing).toBe(-1);
  });

  test('an open stroke faces the way it was drawn', () => {
    const pts: Pt[] = Array.from({ length: 30 }, (_, i) => ({ x: 500 - i * 5, y: 300 + Math.sin(i / 3) * 12 }));
    expect(analyzeStroke(pts).facing).toBe(-1);
  });

  test('tiny or short gestures are rejected with a reason', () => {
    expect(analyzeStroke([{ x: 0, y: 0 }, { x: 10, y: 4 }]).reason).toBe('short');
    expect(analyzeStroke(loop(100, 100, 8, 6)).valid).toBe(false);
  });

  test('a rapid scribble is still a valid sheep', () => {
    const pts: Pt[] = Array.from({ length: 80 }, (_, i) => ({ x: 300 + Math.sin(i * 1.7) * 40 + i, y: 300 + Math.cos(i * 2.3) * 25 }));
    expect(analyzeStroke(pts).valid).toBe(true);
  });

  test('decimate keeps endpoints and enforces spacing', () => {
    const pts: Pt[] = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    const d = decimate(pts, 10);
    expect(d[0]).toEqual(pts[0]);
    expect(d[d.length - 1]).toEqual(pts[99]);
    expect(d.length).toBeLessThan(15);
  });

  test('smoothing keeps endpoints and does not grow the path', () => {
    const pts: Pt[] = Array.from({ length: 50 }, (_, i) => ({ x: i * 4, y: (i % 2) * 6 }));
    const s = smooth(pts, 2);
    expect(s[0]).toEqual(pts[0]);
    expect(s[49]).toEqual(pts[49]);
    expect(strokeLength(s)).toBeLessThan(strokeLength(pts));
  });
});
