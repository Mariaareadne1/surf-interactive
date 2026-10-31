// Scripted ~24 s demo, recorded by the app's own compositing recorder (pen line included):
// draw a surfer -> it blooms in and treads water -> two more -> one paddles out and duck-dives ->
// one catches a wave and rides -> one is swept off and climbs back on -> the big set sweeps
// everyone -> they all paddle back out.
// node scripts/demo.mjs [width] [height]  ->  artifacts/surf-demo.(mp4|webm)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const [W = '1600', H = '900'] = process.argv.slice(2);
const w = Number(W), h = Number(H);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5404/?empty');
await page.evaluate(() => localStorage.clear());
await page.waitForFunction(() => window.__surf && !window.__surf.store.get().loading, null, { timeout: 90000 });
const sleep = (ms) => page.waitForTimeout(ms);
const screen = (x, z) => page.evaluate(([x, z]) => {
  const p = window.__surf, v = p.engine.camera.position.clone().set(x, 0, z).project(p.engine.camera);
  return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
}, [x, z]);
const k = h / 900;
async function stroke(x, z, dx, ms = 700) {
  const [sx, sy] = await screen(x, z);
  const pts = Array.from({ length: 28 }, (_, i) => [sx - (dx * k) / 2 + (dx * k * i) / 27, sy + Math.sin(i * 0.35) * 5 * k]);
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    await page.mouse.move(...p);
    await sleep(ms / pts.length);
  }
  await page.mouse.up();
  return page.evaluate(() => window.__surf.store.doc.surfers.at(-1).id);
}

await page.evaluate(() => {
  const p = window.__surf;
  p.store.set({ uiHidden: true, calm: true });
  p.engine.adaptive = false;
  window.__demoDone = new Promise((r) => (window.__finishDemo = r));
  window.__demo = import('/src/capture/recorder.ts').then(({ recordCanvas }) =>
    recordCanvas(p.engine.canvas, { seconds: 40, ink: document.querySelector('svg.ink'), until: window.__demoDone }),
  );
});
await sleep(700);
const a = await stroke(0, 1.5, 150);       // a surfer blooms in and treads water
await sleep(1500);
const b = await stroke(6, -3, 150, 500);    // two more
const c = await stroke(3, 5, -150, 500);
await sleep(300);
await page.evaluate(([a, b]) => {
  const p = window.__surf;
  const w = p.engine.waves.spawn(p.engine.elapsed - 5);  // a wave rolling in from the right
  w.halfLen = 99;                             // breaking all the way along, so everyone meets it
  p.app.act('catch', b);                      // this one goes for it
  p.app.act('paddle', a);                     // this one paddles out and ducks under
}, [a, b]);
// the third gets swept off just as the white water reaches them
await page.waitForFunction((c) => {
  const p = window.__surf, f = p.engine.surf.frameOf(c), s = p.engine.waves.sample(f.x, f.z, p.engine.elapsed);
  return s && s.e < 0.6;
}, c, { timeout: 20000 });
await page.evaluate((c) => window.__surf.app.act('wipeout', c), c);
await sleep(1200);
await page.evaluate(() => window.__surf.app.bigSet()); // the big set
// it sweeps through everyone; then they paddle back out
await sleep(9500);
await page.evaluate((ids) => ids.forEach((id) => window.__surf.app.act('paddle', id)), [a, b, c]);
await sleep(3200);
await page.evaluate(() => window.__finishDemo());
const out = await page.evaluate(async () => {
  const rec = await window.__demo;
  const buf = new Uint8Array(await rec.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), ext: rec.extension, ms: rec.durationMs, type: rec.type };
});
const file = `artifacts/surf-demo.${out.ext}`;
writeFileSync(file, Buffer.from(out.b64, 'base64'));
const states = await page.evaluate(() => window.__surf.engine.surf.ids().map((id) => window.__surf.engine.surf.get(id).controller.state));
console.log(file, out.type, `${(out.ms / 1000).toFixed(1)} s`, states.join(' '));
await browser.close();
