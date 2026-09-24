// node tools/ui-test.mjs <scenario> [--size 1280x800] [--out shots/ui] [--touch]
//
// UI agent's browser driver (GPU headless Chrome on Unraid, like tools/shot.mjs). Real key events,
// screenshots at every step, fails on page errors / console errors / failed requests.
//   screens  — every ?screen= at this size (title menu select tracks settings controls standings podium unlock results pause)
//   flow     — keyboard: title → menu → select → track → race (fast-forwarded) → results → next track → pause → quit
//   cup      — keyboard: a whole Orion Cup, fast-forwarded → standings each race → podium → Star Road unlock
//   hud      — mid-race HUD shots (items, rank list, turbo pop, wrong way, countdown, final lap)
//   tt       — Time Trial twice: second run has a ghost
// The page is ALWAYS closed in `finally` (a leaked WebGL tab holds GPU VRAM).
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const scenario = args[0] || 'screens';
const [W, H] = opt('size', '1280x800').split('x').map(Number);
const OUT = opt('out', 'shots/ui');
const TOUCH = args.includes('--touch');
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
const tag = `${W}x${H}${TOUCH ? '-touch' : ''}`;

const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
page.on('requestfailed', r => { if (!r.url().startsWith('blob:')) errs.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });
page.on('response', r => { if (r.status() >= 400) errs.push(`http ${r.status()}: ${r.url()}`); });
await fs.mkdir(OUT, { recursive: true });
await page.setViewportSize({ width: W, height: H });

const sleep = ms => page.waitForTimeout(ms);
async function open(q) {
  await page.goto(BASE + 'index.html?' + q + (TOUCH ? '&touch=1' : ''), { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__OTR?.ready, null, { timeout: 90000 });
}
async function shot(name) { const f = `${OUT}/${name}-${tag}.png`; await page.screenshot({ path: f, animations: 'allow' }); console.log('shot', f); }
const screen = () => page.evaluate(() => window.__OTR.menu?.screen ?? null);
const state = () => page.evaluate(() => window.__OTR.state);
async function key(k, n = 1, gap = 160) { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(gap); } }
async function expectScreen(name, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await screen() === name) return; await sleep(100); }
  throw new Error(`expected screen ${name}, got ${await screen()} (state ${await state()})`);
}
async function expectState(name, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await state() === name) return; await sleep(150); }
  throw new Error(`expected state ${name}, got ${await state()}`);
}
/** fast-forward the running race to the end with the AI driving the player */
async function finishRace() {
  await expectState('countdown', 60000).catch(() => {});
  await page.evaluate(() => { const o = window.__OTR; o.race.autoPlayer = true; o.advance(3.6 + 400); });
}
const log = (...a) => console.log('·', ...a);

let code = 0;
try {
  if (scenario === 'screens') {
    for (const s of (opt('only', '') || 'title,menu,select,tracks,settings,controls,standings,podium,unlock,results,pause').split(',')) {
      await open('screen=' + s + (s === 'tracks' ? '' : ''));
      await sleep(s === 'podium' || s === 'unlock' ? 1600 : 900);
      await shot('scr-' + s);
    }
  } else if (scenario === 'flow') {
    await open('');
    await expectScreen('title'); await shot('flow1-title');
    await key('Enter'); await expectScreen('menu'); await shot('flow2-menu');
    await key('Enter'); await expectScreen('select');
    await key('ArrowRight', 2); await sleep(500); await shot('flow3-select');
    const racer = await page.evaluate(() => window.__OTR.menu.M.racer); log('racer', racer);
    await key('Enter'); await expectScreen('tracks'); await sleep(300); await shot('flow4-tracks');
    await key('ArrowRight'); await key('ArrowLeft');
    await key('Enter');
    await expectState('countdown', 60000); await sleep(1500); await shot('flow5-countdown');
    await page.evaluate(() => window.__OTR.advance(3.6 + 25)); await sleep(500); await shot('flow6-race');
    await key('Escape'); await expectScreen('pause'); await shot('flow7-pause');
    await key('Escape'); await sleep(300);
    if (await screen() !== null) throw new Error('pause did not close: ' + await screen());
    await finishRace();
    await expectScreen('results', 15000); await sleep(800); await shot('flow8-results');
    const rs = await page.evaluate(() => ({ rows: document.querySelectorAll('#resList li').length, place: window.__OTR.player.finishPlace, track: window.__OTR.track.id }));
    log('results', JSON.stringify(rs));
    await key('Enter');       // NEXT TRACK is focused
    await expectState('countdown', 60000);
    log('next track', await page.evaluate(() => window.__OTR.track.id));
    await sleep(800); await shot('flow9-next');
    await key('Escape'); await expectScreen('pause');
    await key('ArrowDown', 3); await key('Enter');            // QUIT TO MENU
    await expectScreen('menu'); await shot('flow10-menu-again');
    log('state after quit', await state(), 'race', await page.evaluate(() => !!window.__OTR.race));
  } else if (scenario === 'cup') {
    await page.goto(BASE + 'index.html', { waitUntil: 'load' });
    await page.evaluate(() => { try { localStorage.removeItem('otrSave'); } catch { } });
    await open('seed=4');
    await key('Enter'); await expectScreen('menu');
    await key('ArrowDown'); await key('Enter');                 // ORION CUP
    await expectScreen('select'); await key('Enter');
    await expectScreen('standings'); await sleep(600); await shot('cup0-intro');
    const n = await page.evaluate(() => window.__OTR.menu.M.cup.tracks.length);
    log('cup tracks', n, await page.evaluate(() => window.__OTR.menu.M.cup.tracks.join(',')));
    for (let i = 0; i < n; i++) {
      await key('Enter');
      await finishRace();
      await expectScreen('results', 20000); await sleep(600); await shot(`cup${i + 1}-results`);
      await key('Enter');
      await expectScreen('standings'); await sleep(1800); await shot(`cup${i + 1}-standings`);
      log('standings', await page.evaluate(() => JSON.stringify(window.__OTR.menu.M.cup.points)));
    }
    await key('Enter'); await expectScreen('podium'); await sleep(2000); await shot('cup-podium');
    const won = await page.evaluate(() => { const c = window.__OTR.menu.M.cup; const o = Object.keys(c.points).sort((a, b) => c.points[b] - c.points[a]); return o[0] === c.racer; });
    log('player won cup:', won);
    await key('Enter');
    if (won) { await expectScreen('unlock'); await sleep(1500); await shot('cup-unlock'); await key('Enter'); }
    await expectScreen('menu');
    const sv = await page.evaluate(() => localStorage.getItem('otrSave')); log('save', sv);
    await key('Enter'); await expectScreen('select'); await key('Enter'); await expectScreen('tracks'); await sleep(400); await shot('cup-tracks-after');
  } else if (scenario === 'hud') {
    await open('track=' + opt('track', 'beach') + '&skip=1&seed=3');
    await expectState('countdown');
    await page.evaluate(() => window.__OTR.hud.count(2)); await sleep(350); await shot('hud-count');
    await page.evaluate(() => { const o = window.__OTR; o.race.autoPlayer = true; o.advance(3.6 + 30); o.race.autoPlayer = false; o.hold(true); });
    await sleep(400); await shot('hud-mid');
    // scripted slide: release, hop + hold with steer, press the other shoulder in the red (2 turbos)
    const r = await page.evaluate(() => {
      const o = window.__OTR; let hold = 0;
      const ev = o.script(110, (k, i) => {
        const c = { steer: 0.6, throttle: 1, brake: 0, hopA: i >= 3, hopB: false };
        if (hold > 0) { hold--; c.hopB = true; } else if (k.drift && k.inRed && k.turbos < 2) { hold = 3; c.hopB = true; }
        return c;
      }, { draw: true });
      return ev.filter(e => /drift|turbo|fizzle|overheat/.test(e));
    });
    log('slide events', r.join(','));
    await sleep(120); await shot('hud-turbo');
    await page.evaluate(() => { const o = window.__OTR; o.hud.event('KING DAD PRESSED PAUSE!', { cls: 'bad', ms: 5000, icon: 'assets/ui/item_remote.png' }); o.player.lockedBy = 1; o.hud.banner('FINAL LAP!', 5000, 'final'); });
    await sleep(500); await shot('hud-events');
    await page.evaluate(() => { const o = window.__OTR; o.player.lockedBy = 0; o.hud.event(''); o.hud.banner(''); const P = o.player; P.yaw += Math.PI; o.script(70, () => ({ steer: 0, throttle: 1, brake: 0, hopA: false, hopB: false }), { draw: true }); });
    await sleep(300); await shot('hud-wrongway');
  } else if (scenario === 'pad') {
    // a fake standard-mapping gamepad: __pad.buttons[i] = 0|1, __pad.axes
    await page.addInitScript(() => {
      window.__pad = { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] };
      navigator.getGamepads = () => [{ id: 'fake pad', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
        buttons: window.__pad.buttons.map(v => ({ pressed: !!v, value: v, touched: !!v })), axes: window.__pad.axes }];
    });
    const btn = async (i, name) => { await page.evaluate(i => { window.__pad.buttons[i] = 1; }, i); await sleep(250); await page.evaluate(i => { window.__pad.buttons[i] = 0; }, i); await sleep(250); if (name) log(name, '→', await screen()); };
    const A = 0, B = 1, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
    await open('');
    await expectScreen('title'); await sleep(800);
    await btn(START, 'START'); await expectScreen('menu');
    await btn(DOWN); await btn(DOWN);
    log('focus after 2×down', await page.evaluate(() => document.querySelector('.focus')?.dataset.key));
    await btn(UP); await btn(UP);
    await btn(A, 'A on quick'); await expectScreen('select');
    await btn(RIGHT); await btn(RIGHT); await btn(DOWN);
    log('racer after →→↓', await page.evaluate(() => window.__OTR.menu.M.racer));
    await btn(B, 'B'); await expectScreen('menu');
    await btn(A); await expectScreen('select'); await btn(A); await expectScreen('tracks', 3000);
    // stick right (axis) to move a card
    await page.evaluate(() => { window.__pad.axes[0] = 0.9; }); await sleep(250); await page.evaluate(() => { window.__pad.axes[0] = 0; }); await sleep(250);
    log('track focus after stick →', await page.evaluate(() => document.querySelector('.focus')?.dataset.id));
    await btn(B); await expectScreen('select'); await btn(A); await expectScreen('tracks', 3000);
    await btn(A, 'A on track');
    await expectState('countdown', 60000); await sleep(600);
    await btn(START, 'START in race'); await expectScreen('pause');
    const foc = () => page.evaluate(() => document.querySelector('#ui .focus')?.dataset.key);
    log('pause focus', await foc()); await btn(DOWN); log('focus', await foc()); await btn(DOWN); log('focus', await foc());
    await btn(A, 'A on settings'); await expectScreen('settings');
    await btn(RIGHT); log('volume after →', await page.evaluate(() => JSON.parse(localStorage.getItem('otrSave')).settings.master));
    await btn(LEFT);
    await btn(B, 'B from settings'); await expectScreen('pause');
    await btn(START, 'START to resume'); log('paused?', await page.evaluate(() => window.__OTR.G.paused), 'screen', await screen());
    await shot('pad-resumed');
  } else if (scenario === 'tap') {
    const tap = async (sel, name) => { const el = await page.waitForSelector(sel, { timeout: 8000 }); await el.click(); await sleep(350); if (name) log(name, '→', await screen()); };
    await open('');
    await expectScreen('title'); await sleep(500);
    await page.mouse.click(W / 2, H / 2); await sleep(400); log('tap title →', await screen());
    await expectScreen('menu');
    await tap('[data-act="diff"][data-v="medium"]', 'tap MEDIUM');
    log('difficulty', await page.evaluate(() => window.__OTR.menu.M.diff));
    await tap('[data-act="quick"]', 'tap QUICK RACE'); await expectScreen('select');
    await tap('.rtile[data-id="mum"]', 'tap Mum'); await expectScreen('tracks', 4000);
    await shot('tap-tracks');
    await tap('.tcard[data-id="ice"]', 'tap Ice');
    await expectState('countdown', 60000); await sleep(800);
    log('race', await page.evaluate(() => JSON.stringify({ racer: window.__OTR.player.racerId, track: window.__OTR.track.id, diff: window.__OTR.race.difficulty, auto: window.__OTR.G.autoAccel })));
    await page.evaluate(() => window.__OTR.advance(3.6 + 8)); await sleep(300);
    await shot('tap-race');
    await page.dispatchEvent('[data-btn="pause"]', 'pointerdown', { pointerId: 7, pointerType: 'touch' }).catch(e => log('pause btn', e.message));
    await sleep(400); log('tap ❚❚ →', await screen());
    await tap('[data-act="quit"]', 'tap QUIT'); await expectScreen('menu');
    await tap('[data-act="diff"][data-v="easy"]');
  } else if (scenario === 'tt') {
    await page.goto(BASE + 'index.html', { waitUntil: 'load' });
    await page.evaluate(() => { try { localStorage.removeItem('otrSave'); localStorage.removeItem('otrGhost:beach'); } catch { } });
    for (let run = 1; run <= 2; run++) {
      await open('seed=2');
      await key('Enter'); await expectScreen('menu');
      await key('ArrowDown', 2); await key('Enter');           // TIME TRIAL
      await expectScreen('select'); await key('Enter');
      await expectScreen('tracks'); await sleep(300); await shot(`tt${run}-tracks`);
      await key('Enter');
      await expectState('countdown', 60000);
      const info = await page.evaluate(() => ({ karts: window.__OTR.race.karts.length, ghost: !!window.__OTR.menu.M.ghost }));
      log('run', run, JSON.stringify(info));
      if (run === 2) {   // no start boost this time, so the ghost (run 1, same AI line) is a few metres ahead
        await page.evaluate(() => { const o = window.__OTR; o.advance(3.7); o.race.autoPlayer = true; o.advance(9); o.race.autoPlayer = false; o.hold(true); });
        await sleep(400); await shot('tt2-ghost');
        log('ghost vs player', await page.evaluate(() => { const o = window.__OTR, g = o.menu.M.ghost.root, P = o.player; return JSON.stringify({ visible: g.visible, dist: Math.hypot(g.position.x - P.pos.x, g.position.z - P.pos.z).toFixed(1) }); }));
        await page.evaluate(() => window.__OTR.hold(false));
      }
      await finishRace();
      await expectScreen('results', 20000); await sleep(600); await shot(`tt${run}-results`);
      log('best', await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('otrSave')).best)), 'ghost bytes', await page.evaluate(() => (localStorage.getItem('otrGhost:beach') || '').length));
    }
  }
} catch (e) {
  console.error('FAIL:', e.message); code = 1;
  await shot('FAIL-' + scenario).catch(() => {});
} finally {
  const bad = errs.filter(e => !/favicon/.test(e));
  if (bad.length) { console.log('ERRORS:\n' + [...new Set(bad)].slice(0, 30).join('\n')); code = code || 2; }
  else console.log('no page/console/network errors');
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
process.exit(code);
