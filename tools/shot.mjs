// node tools/shot.mjs '<query>' <out.png> [--eval '<js run in page after ready>'] [--wait ms] [--size 1280x800] [--info]
//
// Screenshot the game through the GPU headless Chrome on Unraid (real WebGL on an Arc B60).
// The page is ALWAYS closed in `finally` — a leaked WebGL tab holds GPU VRAM.
// It is vsync-locked: rAF timing measures nothing; use __OTR.advance() to move the sim.
//   node tools/shot.mjs 'track=beach&racer=orion&skip=1' shots/start.png --info
//   node tools/shot.mjs 'track=beach&skip=1&t=20' shots/t20.png
//   node tools/shot.mjs 'skip=1' shots/x.png --eval '__OTR.advance(5)'
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes('--' + k);
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--info'].includes(args[i - 1])));
const query = (pos[0] || 'skip=1').replace(/^\?/, '');
const out = pos[1] || 'shots/shot.png';
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
const [W, H] = (opt('size', '1280x800')).split('x').map(Number);
const evalJs = opt('eval', null);
const wait = +opt('wait', 600);

const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
let code = 0;
try {
  await page.setViewportSize({ width: W, height: H });
  await page.goto(BASE + 'index.html?' + query, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__OTR?.ready, null, { timeout: 60000 });
  if (evalJs) {
    const r = await page.evaluate(async js => { const v = await (0, eval)(js); try { return JSON.stringify(v); } catch { return String(v); } }, evalJs);
    if (r !== undefined && r !== 'undefined') console.log('eval:', r);
  }
  await page.waitForTimeout(wait);
  if (flag('info')) {
    const info = await page.evaluate(() => { __OTR.render(); return { ...__OTR.info(), gl: (() => { const g = __OTR.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })(), state: __OTR.state }; });
    console.log('info:', JSON.stringify(info));
  }
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, await page.screenshot({ animations: 'allow' }));
  console.log('wrote', out);
} catch (e) {
  console.error('shot failed:', e.message); code = 1;
} finally {
  if (errs.length) console.log(errs.slice(0, 15).join('\n'));
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
process.exit(code);
