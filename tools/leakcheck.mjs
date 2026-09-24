// node tools/leakcheck.mjs [cycles=2] [--query players=2]   (--query: extra URL params, e.g. 2P split screen)
// Loads every track in turn in ONE page session (loadTrack → startRace → race 8 s → endRace),
// `cycles` times round, and prints renderer.info.memory (geometries/textures), shader programs
// and the JS heap after each switch. Geometries/textures must come back to the same numbers
// each cycle (bounded), not grow. Page closed in finally.
import { chromium } from 'playwright-core';
const argv = process.argv.slice(2), qi = argv.indexOf('--query');
const EXTRA = qi >= 0 ? '&' + argv[qi + 1] : '';
const cycles = +(argv.find((a, i) => /^\d+$/.test(a) && argv[i - 1] !== '--query') || 2);
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
try {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE + 'index.html?skip=1&track=beach&ai=1' + EXTRA, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__OTR?.ready, null, { timeout: 60000 });
  const snap = async label => {
    const r = await page.evaluate(async () => {
      const O = window.__OTR; O.render();
      if (window.gc) window.gc();
      const m = O.renderer.info.memory;
      return { geo: m.geometries, tex: m.textures, progs: O.renderer.info.programs?.length, heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6), sceneKids: O.scene.children.length };
    });
    console.log(label.padEnd(18), JSON.stringify(r));
    return r;
  };
  await snap('boot beach');
  const ids = ['ice', 'volcano', 'castle', 'star', 'beach'];
  for (let c = 0; c < cycles; c++) for (const id of ids) {
    await page.evaluate(async id => {
      const O = window.__OTR; O.endRace(); await O.loadTrack(id); await O.startRace(); O.advance(8);
    }, id);
    await page.waitForTimeout(400);
    await snap(`c${c} ${id}`);
  }
} finally {
  if (errs.length) console.log('errors:\n ' + errs.slice(0, 10).join('\n '));
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
