import { expect, test } from '@playwright/test';
import { captureStats, draw, openSea, run, screenBox, stroke, surfers, toScreen } from './helpers';

test.describe('surf', () => {
  test('renders painted water with its light net, and white water when a wave breaks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openSea(page, 'showcase');
    await page.evaluate(() => {
      const p = window.__surf!;
      // breaking all the way along, well inside the view
      p.engine.waves.spawn(p.engine.elapsed - 6).halfLen = 99;
    });
    // the wave reaches the shader on the next frame
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const s = await captureStats(page);
    expect(s.type).toBe('image/png');
    expect(s.mint).toBeGreaterThan(0.3);
    expect(s.light).toBeGreaterThan(0.03);
    expect(s.white).toBeGreaterThan(0.02);
    expect(errors).toEqual([]);
  });

  test('a stroke adds a surfer facing the way it was drawn; scribbles are refused', async ({ page }) => {
    await openSea(page);
    await draw(page, stroke(560, 420, 700, 420));
    await draw(page, stroke(900, 600, 760, 600));
    const list = await surfers(page);
    expect(list).toHaveLength(2);
    expect(Math.cos(list[0].heading)).toBeGreaterThan(0.8);
    expect(Math.cos(list[1].heading)).toBeLessThan(-0.8);
    await draw(page, stroke(300, 300, 306, 302, 6));
    await expect(page.locator('.toast')).toContainText('longer');
    expect(await surfers(page)).toHaveLength(2);
  });

  test('the board picker forces a long or short board; Auto follows the drawing', async ({ page }) => {
    await openSea(page);
    await page.getByRole('radio', { name: 'Long' }).click();
    await draw(page, stroke(500, 400, 560, 400));
    await page.getByRole('radio', { name: 'Auto' }).click();
    await draw(page, stroke(700, 600, 760, 600));
    const [a, b] = await surfers(page);
    expect(a.board).toBe('long');
    expect(b.board).toBe('short');
  });

  test('actions: paddle out, catch the next wave and ride it, wipe out and recover', async ({ page }) => {
    await openSea(page, 'showcase');
    await page.evaluate(() => window.__surf!.store.set({ calm: true }));
    await page.evaluate(() => window.__surf!.store.set({ selectedId: 'leo' }));
    await page.locator('.creature-bar [data-action="paddle"]').click({ force: true });
    expect((await run(page, 0.5)).leo).toContain('paddle');
    await page.evaluate(() => {
      const p = window.__surf!;
      p.app.act('catch', 'mia');
      p.engine.waves.spawn(p.engine.elapsed);
    });
    expect((await run(page, 30)).mia).toContain('ride');
    await page.evaluate(() => window.__surf!.app.act('wipeout', 'kai'));
    const seen = (await run(page, 12)).kai;
    expect(seen).toEqual(expect.arrayContaining(['wipeout', 'swim', 'climb']));
    expect(await page.evaluate(() => window.__surf!.engine.surf.get('kai')!.controller.attached)).toBe(true);
  });

  test('a wipeout sends the board one way and the surfer another', async ({ page }) => {
    await openSea(page, 'showcase');
    await page.evaluate(() => window.__surf!.app.act('wipeout', 'sam'));
    await run(page, 1.2);
    const gap = await page.evaluate(() => {
      const f = window.__surf!.engine.surf.frameOf('sam')!;
      return Math.hypot(f.board.x - f.x, f.board.z - f.z);
    });
    expect(gap).toBeGreaterThan(0.4);
  });

  test('the big set sweeps everyone off, and they all get back on', async ({ page }) => {
    await openSea(page, 'showcase');
    await page.evaluate(() => window.__surf!.store.set({ calm: true }));
    await page.getByRole('button', { name: 'Big set' }).click();
    await expect(page.locator('.toast')).toContainText('big set');
    const seen = await run(page, 40);
    for (const [id, states] of Object.entries(seen)) expect(states, id).toContain('wipeout');
    const allBack = await page.evaluate(() => window.__surf!.engine.surf.ids().every((id) => window.__surf!.engine.surf.get(id)!.controller.attached));
    expect(allBack).toBe(true);
  });

  test('calm stops new waves', async ({ page }) => {
    await openSea(page, 'showcase');
    await page.getByRole('button', { name: 'Calm' }).click();
    await page.evaluate(() => {
      window.__surf!.engine.waves.waves = [];
    });
    await run(page, 30);
    expect(await page.evaluate(() => window.__surf!.engine.waves.waves.length)).toBe(0);
  });

  test('dragging a surfer to the far side makes them smaller', async ({ page }) => {
    await openSea(page, 'showcase');
    await page.getByRole('button', { name: 'Move' }).click();
    await page.evaluate(() => {
      const p = window.__surf!;
      p.store.set({ calm: true });
      p.engine.stop();
      p.engine.surf.dragTo('mia', 0, 6);
      p.engine.tick(1 / 60);
    });
    const near = await screenBox(page, 'mia');
    const from = await toScreen(page, 0, 6);
    const to = await toScreen(page, 0, -6);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.evaluate(() => window.__surf!.engine.tick(1 / 60));
    const rec = (await surfers(page)).find((s) => s.id === 'mia')!;
    expect(rec.z).toBeLessThan(-4);
    expect((await screenBox(page, 'mia')).w).toBeLessThan(near.w * 0.97);
    await expect(page.locator('.select-label')).toContainText('m away');
  });

  test('undo, redo, clear and reload persistence', async ({ page }) => {
    await openSea(page);
    await draw(page, stroke(500, 400, 620, 400));
    await draw(page, stroke(800, 600, 920, 600));
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await surfers(page)).toHaveLength(1);
    await page.getByRole('button', { name: 'Redo' }).click();
    expect(await surfers(page)).toHaveLength(2);
    await page.waitForTimeout(400);
    await page.goto('/');
    await page.waitForFunction(() => window.__surf && !window.__surf.store.get().loading);
    expect(await surfers(page)).toHaveLength(2);
    await page.getByRole('button', { name: 'Sea menu' }).click();
    await page.getByRole('button', { name: 'Clear the sea' }).click();
    expect(await surfers(page)).toHaveLength(0);
    await page.keyboard.press('Meta+z');
    expect(await surfers(page)).toHaveLength(2);
  });

  test('saving an image downloads a real PNG', async ({ page }) => {
    await openSea(page, 'showcase');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save image' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^surf-.*\.png$/);
    const stream = await download.createReadStream();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk as Uint8Array);
    expect(String.fromCharCode(...chunks[0].subarray(1, 4))).toBe('PNG');
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBeGreaterThan(200_000);
  });

  test('keyboard: tab selects, number keys act, delete removes, escape deselects, H hides', async ({ page }) => {
    await openSea(page, 'showcase');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => window.__surf!.store.get().selectedId)).toBeTruthy();
    await page.evaluate(() => window.__surf!.store.set({ selectedId: 'rio' }));
    await page.keyboard.press('4');
    expect((await run(page, 0.3)).rio).toContain('wipeout');
    await page.keyboard.press('Delete');
    expect((await surfers(page)).some((s) => s.id === 'rio')).toBe(false);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__surf!.store.get().selectedId)).toBeNull();
    await page.keyboard.press('b');
    await expect(page.locator('.toast')).toContainText('big set');
    await page.keyboard.press('h');
    await expect(page.locator('.stage')).toHaveClass(/ui-hidden/);
  });

  test('stress: 15 surfers through two big sets and a flurry of actions', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openSea(page, 'showcase');
    await page.evaluate(() => {
      const p = window.__surf!;
      for (const id of ['kai', 'mia', 'leo', 'ana', 'sam', 'rio', 'kai', 'mia', 'leo']) p.app.duplicate(id);
    });
    expect(await surfers(page)).toHaveLength(15);
    const ok = await page.evaluate(() => {
      const p = window.__surf!;
      const acts = ['paddle', 'wait', 'catch', 'wipeout'];
      p.engine.stop();
      for (let i = 0; i < 60 * 70; i++) {
        if (i % 37 === 0) for (const s of p.store.doc.surfers) p.app.act(acts[(i + s.seed) % 4], s.id);
        if (i === 60 || i === 60 * 35) p.app.bigSet();
        p.engine.tick(1 / 60);
      }
      p.engine.start();
      return p.engine.surf.ids().every((id) => {
        const f = p.engine.surf.frameOf(id)!;
        return [f.x, f.y, f.z, f.heading, f.board.x, f.board.z, ...Object.values(f.pose)].every(Number.isFinite);
      });
    });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('mobile portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('layout fits and a touch stroke adds a surfer', async ({ page }) => {
    await openSea(page);
    for (const sel of ['.toolbar', '.picker']) {
      const bar = await page.locator(sel).boundingBox();
      expect(bar!.x).toBeGreaterThanOrEqual(0);
      expect(bar!.x + bar!.width).toBeLessThanOrEqual(390);
    }
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const fire = (type: string, x: number, y: number) =>
        canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, button: 0, buttons: 1 }));
      fire('pointerdown', 140, 420);
      for (let i = 1; i <= 30; i++) fire('pointermove', 140 + i * 4, 420 + Math.sin(i) * 2);
      fire('pointerup', 260, 420);
    });
    expect(await surfers(page)).toHaveLength(1);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('surfers are still painted in, faster', async ({ page }) => {
    await openSea(page);
    await draw(page, stroke(560, 420, 700, 420));
    const [s] = await surfers(page);
    await page.waitForFunction((id) => window.__surf!.engine.surf.isFormed(id), s.id, { timeout: 10_000 });
  });
});
