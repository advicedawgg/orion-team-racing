// node tools/ctr-test.mjs [trackId]   — O-T-R letters end to end in the real browser (GPU headless Chrome).
//
// A 1-lap `letters=1` race (default Bubbly Beach, through its shortcut): the autopilot drives and steers into each
// letter as it comes up; the 6 OTHER tracks are pre-marked done in the save, so finishing with all three must:
// mark this track (otrSave.letters), unlock the paints (otrSave.unlocked.paint), show the results O-T-R badge with
// WHAT'S THIS?! focused → (Enter) the GOLD KARTS UNLOCKED! screen → (Enter) the racer screen with 3 paint swatches.
// Screenshots: shots/ctr/e2e-*.png. The browser profile's save is restored in `finally`; the page is always closed.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { TRACKS } from '../src/tracks/index.js';

const id = process.argv[2] || 'beach';
const def = TRACKS.find(t => t.id === id);
const br = def.letters.find(l => l.route)?.route;
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
await fs.mkdir('shots/ctr', { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
let fails = 0, saved = null;
const ok = (name, pass, info = '') => { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!pass) fails++; };
const shot = n => page.screenshot({ path: `shots/ctr/e2e-${n}.png` });
try {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}index.html?track=${id}&skip=1&letters=1&laps=1&diff=easy${br ? '&branch=' + br : ''}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__OTR?.ready && __OTR.letters && __OTR.menu, null, { timeout: 60000 });
  saved = await page.evaluate(() => localStorage.getItem('otrSave'));
  await page.evaluate(ids => {
    const S = __OTR.menu.save, d = S.get();
    d.letters = Object.fromEntries(ids.map(i => [i, true])); d.unlocked.paint = false; S.save();
  }, TRACKS.map(t => t.id).filter(t => t !== id));
  const r = await page.evaluate(() => {
    const O = __OTR, L = O.letters;
    O.hold(true);
    const aim = k => {
      for (const e of L.list) {
        if (L.got[e.i]) continue;
        const dx = e.x - k.pos.x, dz = e.z - k.pos.z, d = Math.hypot(dx, dz);
        if (d > 26 || dx * Math.sin(k.yaw) + dz * Math.cos(k.yaw) < 0 || Math.abs(e.y - k.pos.y) > 3) continue;
        const a = Math.atan2(dx, dz) - k.yaw, err = Math.atan2(Math.sin(a), Math.cos(a));
        return { steer: Math.max(-1, Math.min(1, err * 2.6)), throttle: 1, brake: 0, hopA: false, hopB: false };
      }
      return null;
    };
    let n = 0;
    while (!O.player.finished && n++ < 12000) O.script(1, k => { const c = aim(k); O.race.autoPlayer = !c; return c; });
    O.race.autoPlayer = true; O.hold(false);
    return { got: L.got.slice(), finished: O.player.finished, t: O.race.t };
  });
  ok('the scripted lap collects C, T and R and finishes', r.got.every(Boolean) && r.finished, JSON.stringify(r));
  await page.waitForFunction(() => __OTR.menu.screen === 'results', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(id => { const d = __OTR.menu.save.get(); return { mark: !!d.letters[id], paint: !!d.unlocked.paint, badge: !!document.querySelector('.rctr .ctrrow'), isNew: !!document.querySelector('.rctr em'), focus: document.querySelector('#ui .focus')?.dataset.key, slots: document.querySelector('#hCtr')?.dataset.m }; }, id);
  ok('save: this track marked, paints unlocked', st.mark && st.paint, JSON.stringify(st));
  ok('results: O-T-R badge + NEW!, WHAT\'S THIS?! focused', st.badge && st.isNew && st.focus === 'unl');
  await shot('results');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => __OTR.menu.screen === 'unlock', null, { timeout: 10000 });
  await page.waitForTimeout(2000);
  ok('unlock screen shows the paints', await page.evaluate(() => !!document.querySelector('.unl-paint .pnt-gold') && !!document.querySelector('#unlStage canvas')));
  await shot('unlock');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => __OTR.menu.screen === 'select', null, { timeout: 10000 });
  await page.waitForTimeout(1200);
  const sel = await page.evaluate(() => ({ n: document.querySelectorAll('.scr-select .pnt').length, focus: document.querySelector('#ui .focus')?.dataset.key }));
  ok('racer screen: 3 paint swatches, a racer tile focused (A still picks the racer)', sel.n === 3 && sel.focus && !sel.focus.startsWith('paint'), JSON.stringify(sel));
  await shot('select');
  ok('no page errors', !errs.length, errs.slice(0, 5).join(' | '));
} catch (e) { ok('ran', false, e.message); await shot('FAIL').catch(() => {}); }
finally {
  await page.evaluate(s => { try { if (s == null) localStorage.removeItem('otrSave'); else localStorage.setItem('otrSave', s); } catch { /* */ } }, saved).catch(() => {});
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
console.log(fails ? `CTR TEST: FAIL (${fails})` : 'CTR TEST: PASS');
process.exit(fails ? 1 : 0);
