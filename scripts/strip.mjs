// Filmstrip of one surfer action in the app camera, stepping the simulation by hand.
// node scripts/strip.mjs <prefix> <surferId> <action|bigset|none> [frames] [every] [crop] [query]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [prefix = 'strip', id = 'mia', action = 'catch', frames = '8', every = '30', crop = '420', query = 'showcase'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5404/?${query}`);
await page.waitForFunction(() => window.__surf && !window.__surf.store.get().loading, null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.evaluate(({ id, action }) => {
  const p = window.__surf;
  p.store.set({ uiHidden: true });
  p.engine.stop();
  for (let i = 0; i < 70; i++) p.engine.tick(1 / 60);
  if (action === 'bigset') p.app.bigSet();
  else if (action === 'wave') p.engine.waves.spawn(p.engine.elapsed);
  else if (action !== 'none') p.app.act(action, id);
  if (action === 'catch') p.engine.waves.spawn(p.engine.elapsed);
}, { id, action });
const files = [];
const size = Number(crop);
for (let f = 0; f < Number(frames); f++) {
  const pos = await page.evaluate(({ id, n }) => {
    const p = window.__surf;
    for (let i = 0; i < n; i++) p.engine.tick(1 / 60);
    const c = p.engine.surf.get(id)?.controller;
    if (!c) return null;
    const v = p.engine.surf.get(id).view.rider.position.clone().project(p.engine.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, state: c.state };
  }, { id, n: f === 0 ? 1 : Number(every) });
  const file = `artifacts/${prefix}-${f}.png`;
  const c = pos ?? { x: 720, y: 450 };
  const h = Math.round(size * 0.7);
  await page.screenshot({ path: file, clip: size >= 1440 ? undefined : { x: Math.max(0, Math.min(1440 - size, c.x - size / 2)), y: Math.max(0, Math.min(900 - h, c.y - h / 2)), width: size, height: h } });
  files.push(file);
  process.stdout.write(`${pos?.state ?? '-'} `);
}
await browser.close();
const w = Math.min(size, 1440);
const h = size >= 1440 ? 900 : Math.round(size * 0.7);
execFileSync(ffmpeg, ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}]`).join('')}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % 4) * w}_${Math.floor(i / 4) * h}`).join('|')}`, `artifacts/${prefix}.png`]);
console.log(`\nartifacts/${prefix}.png`);
