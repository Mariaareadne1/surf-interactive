import { describe, expect, test } from 'vitest';
import { addSurfer, defaultDoc, emptyDoc, MAX_SURFERS, parseDoc, removeSurfer, showcaseDoc, updateSurfer, type SurferRecord } from '../../src/state/document';
import { amend, canRedo, canUndo, commit, createHistory, redo, undo } from '../../src/state/history';
import { seaRegion } from '../../src/scene/sea';
import { readStroke } from '../../src/app/SurfApp';

const s = (id: string, x = 0, z = 0): SurferRecord => ({ id, x, z, heading: 0, seed: 1, size: 1, board: 'short' });

describe('the sea document', () => {
  test('edits return new documents', () => {
    const a = emptyDoc();
    const b = addSurfer(a, s('a'));
    const c = updateSurfer(b, 'a', { x: 2 });
    expect(a.surfers).toHaveLength(0);
    expect(b.surfers[0].x).toBe(0);
    expect(c.surfers[0].x).toBe(2);
    expect(removeSurfer(c, 'a').surfers).toHaveLength(0);
  });

  test('the default and showcase line-ups are valid and inside the sea', () => {
    for (const doc of [defaultDoc(), showcaseDoc()]) {
      expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
      for (const r of doc.surfers) expect(seaRegion(r.x, r.z, 1.0), r.id).toBeGreaterThanOrEqual(0);
    }
  });

  test('untrusted files: wrong shape or version refused; bad entries dropped, values clamped', () => {
    expect(parseDoc(null)).toBeNull();
    expect(parseDoc({ version: 2, surfers: [] })).toBeNull();
    expect(parseDoc({ version: 1, creatures: [] })).toBeNull();
    const doc = parseDoc({
      version: 1,
      surfers: [
        { id: 'ok', x: 0, z: 0, heading: 10, seed: 5, size: 9, board: 'long' },
        { id: 'nan', x: NaN, z: 0, heading: 0, seed: 1 },
        { id: 'far', x: 900, z: -900, heading: 0, seed: 1, board: 'surfski' },
        { id: '<b>', x: 1, z: 1, heading: 0, seed: 2 },
        'nonsense',
      ],
    })!;
    expect(doc.surfers).toHaveLength(3);
    expect(doc.surfers[0]).toMatchObject({ size: 1.15, board: 'long' });
    expect(Math.abs(doc.surfers[0].heading)).toBeLessThanOrEqual(Math.PI);
    expect(seaRegion(doc.surfers[1].x, doc.surfers[1].z, 1.0)).toBeGreaterThanOrEqual(-1e-9);
    expect(doc.surfers[1].board).toBe('short');
    expect(doc.surfers[2].id).not.toBe('<b>');
  });

  test('caps the line-up and renames duplicate ids', () => {
    expect(parseDoc({ version: 1, surfers: Array.from({ length: 60 }, (_, i) => s(`s${i}`)) })!.surfers).toHaveLength(MAX_SURFERS);
    const doc = parseDoc({ version: 1, surfers: [s('x'), s('x')] })!;
    expect(new Set(doc.surfers.map((r) => r.id)).size).toBe(2);
  });

  test('undo/redo: one step per commit, amend adds none, a new commit clears redo', () => {
    let h = createHistory(emptyDoc());
    h = commit(h, addSurfer(h.present, s('a')));
    h = amend(h, updateSurfer(h.present, 'a', { x: 3 }));
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present.surfers[0].x).toBe(3);
    h = undo(h);
    h = commit(h, addSurfer(h.present, s('b')));
    expect(canRedo(h)).toBe(false);
    expect(canUndo(h)).toBe(true);
  });
});

describe('reading a stroke', () => {
  const line = (x0: number, y0: number, x1: number, y1: number) => Array.from({ length: 30 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 29 + Math.sin(i) * 2, y: y0 + ((y1 - y0) * i) / 29 + Math.cos(i) * 2 }));

  test('a surfer faces the way the stroke was drawn', () => {
    expect(readStroke(line(100, 300, 300, 300)).dir.x).toBeGreaterThan(0.9);
    expect(readStroke(line(300, 300, 100, 300)).dir.x).toBeLessThan(-0.9);
    expect(readStroke(line(200, 400, 200, 200)).dir.y).toBeLessThan(-0.9);
  });

  test('a loop faces the way the pen was going as it closed', () => {
    const loop = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return { x: 300 + Math.cos(a) * 80, y: 300 + Math.sin(a) * 25 };
    });
    const r = readStroke(loop);
    expect(Math.abs(r.dir.x)).toBeGreaterThan(0.9);
    expect(r.half).toBeGreaterThan(60);
  });
});
