// Screenshot racers.html through the GPU headless Chrome (Arc B60 on Unraid).
//   node tools/shot-racers.mjs '<query>' out.png [W H]
//   SHOTS='[{"q":"grid=poses&id=orion","out":"shots/r-orion.png","w":1600,"h":1000}]' node tools/shot-racers.mjs
// `still=1` is forced: the page simulates the pose at a fixed 60 Hz and sets window.__ready (the
// GPU browser is vsync-locked, so real-time rAF timing is meaningless there). The page is ALWAYS
// closed in `finally` — a leaked tab holds VRAM on the shared GPU.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE || 'http://192.168.15.78:8960';
const CDP = process.env.CDP || 'http://192.168.15.100:9333';
const shots = process.env.SHOTS ? JSON.parse(process.env.SHOTS)
  : [{ q: process.argv[2] || '', out: process.argv[3] || 'shots/racers.png', w: +(process.argv[4] || 1600), h: +(process.argv[5] || 900) }];

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200)); });
page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errs.push(`${r.status()} ${r.url()}`); });
try {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  for (const s of shots) {
    await page.setViewportSize({ width: s.w || 1600, height: s.h || 900 });
    const q = s.q.includes('still=') ? s.q : (s.q ? s.q + '&' : '') + 'still=1';
    await page.goto(`${BASE}/racers.html?${q}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch(() => errs.push('timeout ' + q));
    await page.waitForTimeout(s.wait ?? 150);
    await fs.mkdir(path.dirname(s.out), { recursive: true });
    await fs.writeFile(s.out, await page.screenshot());
    const stats = await page.evaluate(() => window.__stats).catch(() => null);
    console.log('shot', s.out, stats ? JSON.stringify(stats) : '');
  }
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
if (errs.length) console.log('page errors:', JSON.stringify(errs.slice(0, 12), null, 1));
