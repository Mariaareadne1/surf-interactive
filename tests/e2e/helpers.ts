import type { Page } from '@playwright/test';

export async function openSea(page: Page, query = 'empty'): Promise<void> {
  await page.goto(query ? `/?${query}` : '/');
  await page.waitForFunction(() => window.__surf && !window.__surf.store.get().loading, null, { timeout: 90_000 });
}

/** A quick stroke from (x0, y0) to (x1, y1), wobbling a little like a hand. */
export function stroke(x0: number, y0: number, x1: number, y1: number, n = 30): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1) + Math.sin(i * 1.3) * 2, y: y0 + ((y1 - y0) * i) / (n - 1) + Math.cos(i * 0.9) * 2 }));
}

export async function draw(page: Page, pts: { x: number; y: number }[]): Promise<void> {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
}

export async function surfers(page: Page) {
  return page.evaluate(() => window.__surf!.store.doc.surfers.map((s) => ({ ...s })));
}

export async function toScreen(page: Page, x: number, z: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, z]) => {
    const p = window.__surf!;
    const v = p.engine.camera.position.clone().set(x, 0, z).project(p.engine.camera);
    const r = p.engine.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, z]);
}

/** Step the simulation by hand, reporting each surfer's states seen along the way. */
export async function run(page: Page, seconds: number) {
  return page.evaluate((seconds) => {
    const p = window.__surf!;
    p.engine.stop();
    const seen: Record<string, string[]> = {};
    for (let t = 0; t < seconds; t += 1 / 60) {
      p.engine.tick(1 / 60);
      for (const id of p.engine.surf.ids()) {
        const st = p.engine.surf.get(id)!.controller.state;
        const list = (seen[id] ??= []);
        if (list[list.length - 1] !== st) list.push(st);
      }
    }
    p.engine.start();
    return seen;
  }, seconds);
}

export async function screenBox(page: Page, id: string) {
  return page.evaluate((i) => {
    const p = window.__surf!;
    const b = p.engine.surf.get(i)!.view.bounds();
    const cam = p.engine.camera;
    const rect = p.engine.canvas.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity;
    for (let k = 0; k < 8; k++) {
      const v = b.min.clone();
      if (k & 1) v.x = b.max.x;
      if (k & 2) v.y = b.max.y;
      if (k & 4) v.z = b.max.z;
      v.project(cam);
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
    }
    return { w: maxX - minX };
  }, id);
}

export async function captureStats(page: Page) {
  return page.evaluate(async () => {
    const blob = await window.__surf!.engine.capturePNG(1);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0, mint = 0, light = 0, white = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      n++;
      if (r > 222 && g > 225 && b > 220) white++;
      else if (g > 190 && b > 180 && r < 200 && r > 150) light++;
      else if (g > 150 && b > 140 && r < 160) mint++;
    }
    return { mint: mint / n, light: light / n, white: white / n, type: blob.type };
  });
}
