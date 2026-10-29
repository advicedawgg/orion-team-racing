// node tools/shot-letters.mjs [trackId,…] [--size 1280x800] [--grab]
//
// The O-T-R letters in chase view (DESIGN.md "Modes and UI" → O-T-R letters): for every track (default: all) a
// race with `letters=1` (and `branch=<id>` when a letter is on the shortcut), the autopilot drives up to each
// letter in turn; one shot ~18 m before it (shots/ctr/<track>-<C|T|R>.jpg). --grab then steers into it and
// shoots just after the pick-up (…-<C|T|R>-got.jpg: the sparkle + the lit HUD slot). The page is closed in finally.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { TRACKS } from '../src/tracks/index.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ids = (args.find(a => !a.startsWith('--') && !/^\d+x\d+$/.test(a)) || TRACKS.map(t => t.id).join(',')).split(',');
const [W, H] = opt('size', '1280x800').split('x').map(Number);
const GRAB = args.includes('--grab');
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
await fs.mkdir('shots/ctr', { recursive: true });

const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
let fails = 0;
for (const id of ids) {
  const def = TRACKS.find(t => t.id === id);
  const br = def?.letters?.find(l => l.route)?.route;
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200)));
  try {
    await page.setViewportSize({ width: W, height: H });
    await page.goto(`${BASE}index.html?track=${id}&skip=1&letters=1&diff=easy${br ? '&branch=' + br : ''}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__OTR?.ready && __OTR.letters, null, { timeout: 60000 });
    for (let i = 0; i < 3; i++) {
      const r = await page.evaluate(async ({ i }) => {
        const O = __OTR, L = O.letters, e = L.list[i];
        O.race.autoPlayer = true; O.hold(true);     // only script() moves the sim: the shot is what we stepped to
        const d = () => { const k = O.player; return Math.hypot(k.pos.x - e.x, k.pos.z - e.z); };
        const ahead = () => { const k = O.player; return (e.x - k.pos.x) * Math.sin(k.yaw) + (e.z - k.pos.z) * Math.cos(k.yaw) > 0; };
        let n = 0;
        while (!(d() < 19 && ahead()) && n++ < 2500 && !O.player.finished) O.script(4, () => null);
        return { d: d(), n };
      }, { i });
      await page.waitForTimeout(250);
      const ch = 'CTR'[i];
      await page.screenshot({ path: `shots/ctr/${id}-${ch}.jpg`, type: 'jpeg', quality: 82 });
      let g = null;
      if (GRAB) {
        g = await page.evaluate(async ({ i }) => {
          const O = __OTR, L = O.letters, e = L.list[i];
          O.race.autoPlayer = false;
          let m = 0;
          const steer = k => { const a = Math.atan2(e.x - k.pos.x, e.z - k.pos.z) - k.yaw; const err = Math.atan2(Math.sin(a), Math.cos(a)); return { steer: Math.max(-1, Math.min(1, err * 2.6)), throttle: 1, brake: 0, hopA: false, hopB: false }; };
          while (!L.got[i] && m++ < 150) O.script(1, steer, { draw: true });
          O.script(8, () => ({ steer: 0, throttle: 1, brake: 0, hopA: false, hopB: false }), { draw: true });
          O.race.autoPlayer = true;
          return { got: L.got[i], steps: m };
        }, { i });
        await page.waitForTimeout(120);
        await page.screenshot({ path: `shots/ctr/${id}-${ch}-got.jpg`, type: 'jpeg', quality: 82 });
      }
      console.log(`${id} ${ch}: ${r.d.toFixed(1)} m before it after ${r.n * 4} steps${g ? `; grab: ${g.got ? 'GOT' : 'MISSED'} in ${g.steps} steps` : ''}`);
      if (g && !g.got) fails++;
    }
    const info = await page.evaluate(() => { __OTR.render(); return __OTR.info(); });
    console.log(`${id}: draw calls ${info.calls}, letters got ${JSON.stringify(await page.evaluate(() => __OTR.letters.got))}`);
  } catch (e) { console.error(id, 'failed:', e.message); fails++; }
  finally { if (errs.length) console.log(errs.join('\n')); await page.close().catch(() => {}); }
}
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
