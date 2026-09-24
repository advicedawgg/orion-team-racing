// node tools/realflow.mjs [--throttle 4] [--out shots/flow]
//
// QA agent: the whole game in ONE page session, driven like a kid would (real key events):
// title → menu → Quick Race (drive live with the keyboard, pause/unpause, check no stuck keys)
// → results → NEXT TRACK → quit to menu → ORION CUP (all 4 tracks, each raced live for a few
// seconds, then fast-forwarded) → standings → podium → Star Road unlock → menu.
// After every race: renderer.info.memory, programs, engines running, voices, HUD state, paused
// flag, and the WORST render() CPU ms in the first 5 s of the race (shader-compile hitches; use
// --throttle N for a CDP CPU slowdown as a Steam Deck stand-in). Fails on page errors, console
// errors, failed requests and HTTP ≥ 400. The page is ALWAYS closed in finally.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'shots/flow'), THROTTLE = +opt('throttle', 0);
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
const errs = [], warns = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 300)));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error') errs.push('console: ' + t.slice(0, 300));
  else if (m.type() === 'warning' && !/KHR_parallel_shader_compile|AudioContext was not allowed/.test(t)) warns.push(t.slice(0, 200));
});
page.on('requestfailed', r => { if (/ERR_ABORTED/.test(r.failure()?.errorText || '')) return; /* page moved on mid-download (HD GLBs load in menus) */ if (!r.url().startsWith('blob:')) errs.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });
page.on('response', r => { if (r.status() >= 400) errs.push(`http ${r.status()}: ${r.url()}`); });
let bytes = 0, reqs = 0;
page.on('response', async r => { try { const b = await r.body(); bytes += b.length; reqs++; } catch { /* redirects / blobs */ } });

const sleep = ms => page.waitForTimeout(ms);
const log = (...a) => console.log(...a);
const screen = () => page.evaluate(() => window.__OTR.menu?.screen ?? null);
const state = () => page.evaluate(() => window.__OTR.state);
async function key(k, n = 1, gap = 180) { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(gap); } }
async function expectScreen(name, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await screen() === name) return; await sleep(100); }
  throw new Error(`expected screen ${name}, got ${await screen()} (state ${await state()})`);
}
async function expectState(name, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await state() === name) return; await sleep(120); }
  throw new Error(`expected state ${name}, got ${await state()}`);
}
const HOOK = () => {
  const O = window.__OTR, r = O.renderer, orig = r.render.bind(r);
  window.__rf = [];
  r.render = (s, c) => { const t0 = performance.now(); orig(s, c); if (O.race && O.race.t < 5) window.__rf.push({ t: O.race.t, ms: performance.now() - t0 }); };
};
/** Drive a race live for `secs` with real keys (hold ↑, a hop-slide), check pause, then fast-forward to the end. */
async function raceLive(tag, secs = 6) {
  await expectState('countdown', 60000);
  const tStart = Date.now();
  await page.evaluate(() => { window.__rf.length = 0; });
  await expectState('race', 15000);
  await page.keyboard.down('ArrowUp');
  await sleep(secs * 500);
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('Space'); await sleep(250); await page.keyboard.up('ArrowLeft'); await sleep(500);
  await page.keyboard.press('ShiftLeft'); await sleep(300);
  await page.keyboard.up('Space');
  await sleep(secs * 500);
  await page.screenshot({ path: `${OUT}/${tag}-live.jpg`, type: 'jpeg', quality: 80 });
  // pause while holding ↑, release ↑ in the pause menu, unpause: the kart must not keep driving on a stuck key
  await key('Escape'); await expectScreen('pause');
  await page.keyboard.up('ArrowUp');
  await sleep(300);
  await key('Escape'); await sleep(400);
  const after = await page.evaluate(() => { const O = window.__OTR; return { paused: O.G.paused, screen: O.menu.screen, thr: O.race?.player?.ctrl?.throttle ?? null }; });
  const hitch = await page.evaluate(() => { const mx = a => a.length ? +Math.max(...a.map(f => f.ms)).toFixed(1) : null; return { countdown: mx(window.__rf.filter(f => f.t > -3.6 && f.t < 0)), first5: mx(window.__rf.filter(f => f.t >= 0)), worstAt: window.__rf.reduce((b, f) => f.ms > b.ms ? f : b, { ms: 0 }).t?.toFixed(2) }; });
  const p = await page.evaluate(() => { const P = window.__OTR.player; return { speed: +P.speed.toFixed(1), s: Math.round(P.s), lap: P.lap, turbos: P.turbos }; });
  log(`  ${tag}: live ${(Date.now() - tStart) / 1000}s, player ${JSON.stringify(p)}, after unpause ${JSON.stringify(after)}, worst render() ms ${JSON.stringify(hitch)}`);
  if (after.paused || after.screen) throw new Error('unpause failed ' + JSON.stringify(after));
  const autoAccel = await page.evaluate(() => window.__OTR.G.autoAccel);
  if (!autoAccel && after.thr > 0) log('  !! throttle still on after releasing ↑ in pause (stuck key?)');
  await page.evaluate(() => { const o = window.__OTR; o.race.autoPlayer = true; o.advance(400); });
}
async function snapMem(tag) {
  const m = await page.evaluate(() => {
    const O = window.__OTR, i = O.renderer.info, S = O.audio._debug;
    const hud = document.getElementById('hud');
    return { geo: i.memory.geometries, tex: i.memory.textures, progs: i.programs?.length, engines: S?.karts?.size ?? '?', loops: (S?.voices || []).filter(v => v.loop && !v.done).length,
      heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6), sceneKids: O.scene.children.length, track: O.track?.id, hudShown: hud && getComputedStyle(hud).display !== 'none' };
  });
  log(`  mem ${tag}: ${JSON.stringify(m)}`);
  return m;
}

let code = 0;
try {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (THROTTLE) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  await page.goto(BASE + 'index.html', { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.removeItem('otrSave'); for (const k of Object.keys(localStorage)) if (k.startsWith('otrGhost')) localStorage.removeItem(k); } catch { } });
  const t0 = Date.now(); bytes = 0; reqs = 0;
  await page.goto(BASE + 'index.html?seed=4', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__OTR?.ready, null, { timeout: 90000 });
  log(`boot to title: ${(Date.now() - t0) / 1000}s, ${reqs} requests, ${(bytes / 1e6).toFixed(1)} MB`);
  await page.evaluate(HOOK);
  await expectScreen('title');
  await key('Enter'); await expectScreen('menu');
  await key('Enter'); await expectScreen('select'); await key('Enter'); await expectScreen('tracks');
  const t1 = Date.now();
  await key('Enter');
  await expectState('countdown', 60000);
  log(`title → first race countdown: ${(Date.now() - t0) / 1000}s since load (${(Date.now() - t1) / 1000}s from track pick), ${reqs} requests, ${(bytes / 1e6).toFixed(1)} MB`);
  await snapMem('race1 start');
  await raceLive('quick-' + await page.evaluate(() => window.__OTR.track.id));
  await expectScreen('results', 20000); await sleep(500); await page.screenshot({ path: `${OUT}/quick-results.jpg`, type: 'jpeg' });
  await snapMem('race1 results');
  await key('Enter');    // NEXT TRACK
  await raceLive('next-' + await page.evaluate(() => window.__OTR.track.id));
  await expectScreen('results', 20000);
  await snapMem('race2 results');
  await key('ArrowRight'); await key('Enter');   // MENU
  await sleep(600);
  log('  after MENU from results:', await screen(), await state(), 'race', await page.evaluate(() => !!window.__OTR.race));
  if (await screen() !== 'menu') { await key('Escape'); await sleep(400); }
  await expectScreen('menu');
  await snapMem('menu');
  // ORION CUP
  await key('ArrowDown'); await key('Enter');
  await expectScreen('select'); await key('Enter');
  await expectScreen('standings');
  const n = await page.evaluate(() => window.__OTR.menu.M.cup.tracks.length);
  log('cup:', await page.evaluate(() => window.__OTR.menu.M.cup.tracks.join(',')));
  for (let i = 0; i < n; i++) {
    await key('Enter');
    await raceLive(`cup${i + 1}-` + await page.evaluate(() => window.__OTR.track.id), 3);
    await expectScreen('results', 20000); await sleep(400);
    await snapMem(`cup${i + 1} results`);
    await key('Enter'); await expectScreen('standings'); await sleep(1200);
    await page.screenshot({ path: `${OUT}/cup${i + 1}-standings.jpg`, type: 'jpeg' });
  }
  await key('Enter'); await expectScreen('podium'); await sleep(2500);
  await page.screenshot({ path: `${OUT}/cup-podium.png` });
  await snapMem('podium');
  const won = await page.evaluate(() => { const c = window.__OTR.menu.M.cup; const o = Object.keys(c.points).sort((a, b) => c.points[b] - c.points[a]); return o[0] === c.racer; });
  log('player won cup:', won);
  await key('Enter');
  if (won) { await expectScreen('unlock'); await sleep(1500); await page.screenshot({ path: `${OUT}/cup-unlock.jpg`, type: 'jpeg' }); await key('Enter'); }
  await expectScreen('menu');
  await snapMem('back at menu');
  // Star Road via Quick Race (unlocked now)
  await page.evaluate(() => window.__OTR.menu.M.mode = 'quick'); await page.evaluate(() => document.querySelector('[data-act=quick],[data-key=quick]')?.click()); await expectScreen('select'); await key('Enter'); await expectScreen('tracks');
  await page.evaluate(() => window.__OTR.menu.launch('star'));
  await raceLive('star', 3);
  await expectScreen('results', 20000);
  await snapMem('star results');
  log(`total ${reqs} requests, ${(bytes / 1e6).toFixed(1)} MB`);
} catch (e) {
  console.error('FLOW FAILED:', e.message); code = 1;
  await page.screenshot({ path: `${OUT}/fail.png` }).catch(() => {});
} finally {
  if (warns.length) log('warnings:\n  ' + [...new Set(warns)].slice(0, 15).join('\n  '));
  if (errs.length) { log('ERRORS:\n  ' + [...new Set(errs)].slice(0, 20).join('\n  ')); code = 1; }
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
log(code ? 'REALFLOW: FAIL' : 'REALFLOW: PASS');
process.exit(code);
