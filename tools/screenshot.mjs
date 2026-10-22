// Renders views with headless Chromium (software GL).
// Usage:
//   node tools/screenshot.mjs                    -> shots/shot.png (mountain view)
//   node tools/screenshot.mjs shots/plan.json    -> each {name, js, seconds, w, h}
// The page runs in manual mode: time advances exactly via VF.advance(), then one frame renders.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';

const arg = process.argv[2];
const shots = arg && arg.endsWith('.json') ? JSON.parse(readFileSync(arg, 'utf8')) : [{ name: 'shot', seconds: 0.1 }];
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const first = shots[0];
const page = await browser.newPage({ viewport: { width: first.w || 1280, height: first.h || 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('LOG')) && errors.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('file://' + resolve('dist/index.html') + '?capture');
await page.waitForFunction(() => window.VF, null, { timeout: 240000 });
await page.evaluate(() => VF.manual(true));
for (const s of shots) {
  if (s.w) await page.setViewportSize({ width: s.w, height: s.h });
  if (s.js) {
    const r = await page.evaluate(s.js);
    if (r !== undefined) console.log(s.name, '->', JSON.stringify(r));
  }
  await page.evaluate((sec) => VF.advance(sec), s.seconds ?? 0.5);
  if (s.after) {
    const r = await page.evaluate(s.after);
    if (r !== undefined) console.log(s.name, 'after ->', JSON.stringify(r));
  }
  if (s.shot !== false) await page.screenshot({ path: `shots/${s.name}.png`, timeout: 240000 });
  console.log('saved', s.name);
}
if (errors.length) console.log(errors.slice(0, 30).join('\n'));
await browser.close();
