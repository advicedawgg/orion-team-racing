// node tools/shot-2p.mjs [tracks…] [--out shots/mp]
// Multiplayer agent: 2P split-screen screenshots at 1280×800 through the GPU headless Chrome, per
// track: <track>-grid.png (countdown on the start grid), <track>-items.png (mid-race, AI driving both
// players, both holding rockets that refill), <track>-results.png (the results overlay). Prints the
// frame's draw calls. The page is ALWAYS closed in finally.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'shots/mp';
const tracks = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
let code = 0;
for (const id of tracks.length ? tracks : ['beach', 'volcano', 'castle']) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}index.html?track=${id}&skip=1&ai=1&players=2&racer=orion&racer2=kingdad&seed=5&give=rocket&refill=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__OTR?.ready);
    await page.waitForFunction(() => window.__OTR.state === 'countdown' && window.__OTR.race.t > -2.2);
    const info = () => page.evaluate(() => { window.__OTR.render(); return window.__OTR.info().calls; });
    const g = await info();
    await page.screenshot({ path: `${OUT}/${id}-grid.png` });
    await page.evaluate(() => { window.__OTR.advance(22); });
    await page.waitForTimeout(2500);                 // live: rockets fly, AI uses items, particles
    const m = await info();
    await page.screenshot({ path: `${OUT}/${id}-items.png` });
    await page.evaluate(() => { const o = window.__OTR; o.advance(400); });
    await page.waitForFunction(() => window.__OTR.menu?.screen === 'results', null, { timeout: 15000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${id}-results.png` });
    console.log(id, 'draw calls grid', g, 'mid', m, errs.length ? 'ERRORS ' + errs.slice(0, 3).join(' | ') : '');
    if (errs.length) code = 1;
  } catch (e) { console.error(id, 'FAILED', e.message); code = 1; }
  finally { await page.close().catch(() => {}); }
}
await browser.close().catch(() => {});
process.exit(code);
