// node tools/twoplayer-test.mjs [--shots shots/mp]
// Multiplayer agent: 2P split screen in the real browser (GPU headless Chrome), end to end.
//  pads     — two fake standard pads (navigator.getGamepads override, index 0 + 1): title → menu →
//             2 PLAYERS → P2 joins with A on pad 2 (the press must not also click the focused button)
//             → QUICK RACE → P1 picks, P2 picks (P1's racer is taken) → track → a split-screen race.
//             In the race each pad drives ONLY its own kart (throttle, steer, slide, item), each HUD
//             shows its own kart (place, item slot, stars), per-player AUTO-GO (P1 on, P2 off),
//             Start on pad 2 pauses, then the race is finished and the results show BOTH players.
//  keyboard — no pads, ?players=2: one keyboard split in halves (WASD/Space/LShift/E vs arrows/
//             RShift or '/'/'.'/Enter). Each half drives only its own kart; Ctrl is never taken.
//  join-kb  — no pads, through the menus: Enter on the join screen splits the keyboard (P1 left,
//             P2 right) without pressing the focused button.
//  cup      — a whole 2P Orion Cup through the menus (races fast-forwarded): standings mark P1 + P2,
//             the podium names both.
// The page is ALWAYS closed in finally. Prints TWO PLAYER TEST: PASS / n FAIL.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : 'shots/mp';
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
await fs.mkdir(SHOTS, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  PASS ' : '  FAIL ') + msg); if (!c) fails++; };

async function run(name, url, fn, init) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { try { localStorage.removeItem('otrSave'); } catch { /* */ } });
    if (init) await page.addInitScript(init);
    await page.goto(BASE + 'index.html' + url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__OTR?.ready, null, { timeout: 60000 });
    console.log(name);
    await fn(page);
    ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
  } catch (e) { ok(false, name + ' threw: ' + e.message.split('\n')[0]); }
  finally { await page.close().catch(() => {}); }
}
const sleep = (page, ms) => page.waitForTimeout(ms);
async function until(page, fn, arg, ms = 15000) {
  const t0 = Date.now();
  for (;;) { const v = await page.evaluate(fn, arg); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(page, 100); }
}
const screen = page => page.evaluate(() => window.__OTR.menu?.screen ?? null);
const K = page => page.evaluate(() => window.__OTR.humans.map(k => ({ speed: +k.speed.toFixed(1), steer: +(k.ctrl?.steer ?? 0).toFixed(2), thr: k.ctrl?.throttle ?? 0,
  drift: k.drift, turbos: k.turbos, boostT: +k.boostT.toFixed(2), item: k.item, place: k.place, stars: k.stars, racer: k.racerId, pn: k.pn, fin: k.finished })));

/* ------------------------------------------------------------------ two pads, through the menus */
const PADS = () => {
  window.__pads = [0, 1].map(() => ({ buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] }));
  navigator.getGamepads = () => window.__pads.map((p, i) => ({ id: `Xbox 360 pad ${i + 1} (STANDARD GAMEPAD)`, index: i, connected: true, mapping: 'standard', timestamp: performance.now(),
    buttons: p.buttons.map(v => ({ pressed: !!v, value: v, touched: !!v })), axes: p.axes.slice() }));
};
await run('pads: two gamepads through the menus into a split-screen race', '?seed=4', async page => {
  const btn = (p, i, v) => page.evaluate(([p, i, v]) => { window.__pads[p].buttons[i] = v; }, [p, i, v]);
  const axis = (p, i, v) => page.evaluate(([p, i, v]) => { window.__pads[p].axes[i] = v; }, [p, i, v]);
  const tap = async (p, i, ms = 140) => { await btn(p, i, 1); await sleep(page, ms); await btn(p, i, 0); await sleep(page, 220); };
  await until(page, () => window.__OTR.menu?.screen === 'title');
  await tap(0, 0); await until(page, () => window.__OTR.menu.screen === 'menu');
  for (let i = 0; i < 3; i++) await tap(0, 13);     // d-pad down ×3: QUICK RACE → ORION CUP → TIME TRIAL → 2 PLAYERS
  const f = await page.evaluate(() => document.querySelector('#ui .focus')?.dataset.act);
  ok(f === 'two', `main menu has 2 PLAYERS under TIME TRIAL (old positions kept) (focus ${f})`);
  await tap(0, 0);
  ok(await until(page, () => window.__OTR.menu.screen === 'join'), 'A opens the join screen');
  let M = await page.evaluate(() => ({ devs: window.__OTR.menu.M.devs, locked: document.querySelector('[data-act="quick"]').classList.contains('locked') }));
  ok(M.devs[0] === 'pad:0' && !M.devs[1] && M.locked, `P1 = the pad that opened it (${M.devs}), QUICK RACE locked until P2 joins`);
  await page.screenshot({ path: `${SHOTS}/join-waiting.png` });
  await tap(1, 0);                                   // A on pad 2 = P2 joins
  M = await page.evaluate(() => ({ devs: window.__OTR.menu.M.devs, screen: window.__OTR.menu.screen, locked: document.querySelector('[data-act="quick"]').classList.contains('locked') }));
  ok(M.devs[1] === 'pad:1' && M.screen === 'join' && !M.locked, `A on pad 2 joins P2 (${M.devs}) and does NOT press the focused button (screen ${M.screen})`);
  await page.screenshot({ path: `${SHOTS}/join-both.png` });
  await tap(1, 0);                                   // P2's A again: now it's a normal menu press (QUICK RACE)
  ok(await until(page, () => window.__OTR.menu.screen === 'select'), 'QUICK RACE → racer select');
  const h1 = await page.evaluate(() => document.querySelector('.scr-select h2').textContent);
  ok(/P1/.test(h1), `P1 picks first ("${h1}")`);
  await tap(0, 0);                                   // P1 takes the focused racer (Orion)
  ok(await until(page, () => document.querySelector('.scr-select.sel-p2')), 'then P2 picks');
  const taken = await page.evaluate(() => document.querySelector('.rtile.taken')?.dataset.id);
  ok(taken === 'orion', `P1's racer is taken on P2's grid (${taken})`);
  await page.screenshot({ path: `${SHOTS}/select-p2.png` });
  await tap(1, 0);                                   // P2 takes the focused racer (King Dad)
  ok(await until(page, () => window.__OTR.menu.screen === 'tracks'), '→ track select');
  await tap(0, 0);                                   // first track (Bubbly Beach)
  ok(await until(page, () => window.__OTR.state === 'countdown' || window.__OTR.state === 'race', null, 60000), 'race starts');
  const st = await page.evaluate(() => ({ mp: window.__OTR.G.mp, humans: window.__OTR.humans.map(k => k.racerId + ':' + k.pn), devs: window.__OTR.In.players.map(p => p.device),
    split: document.body.classList.contains('split2'), hud2: !document.getElementById('hud2').hidden, auto: window.__OTR.In.players.map(p => p.autoAccel) }));
  ok(st.mp && st.humans.join() === 'orion:0,kingdad:1' && st.split && st.hud2, `split screen: ${JSON.stringify(st)}`);
  ok(st.devs.join() === 'pad:0,pad:1', `devices pad:0 → P1, pad:1 → P2 (${st.devs})`);
  ok(st.auto[0] === true && st.auto[1] === false, `per-player AUTO-GO from the join screen: P1 on, P2 off (${st.auto})`);
  await page.screenshot({ path: `${SHOTS}/pads-grid.png` });
  const voices = await until(page, () => { const S = window.__OTR.audio._debug; const v = (S?.playerVoices || []).filter(x => x.kart).map(x => x.kart.id); return v.length === 2 ? v : null; }, null, 5000);
  ok(voices && voices.length === 2, `each player has their own engine voice (karts ${voices})`);
  await until(page, () => window.__OTR.state === 'race', null, 20000);
  // P2 hasn't touched anything: P1 (auto-go) drives, P2 sits
  let k; for (let i = 0; i < 30; i++) { await sleep(page, 100); k = await K(page); if (k[0].speed > 8) break; }
  ok(k[0].speed > 8 && Math.abs(k[1].speed) < 1, `P1 AUTO-GO drives, P2 (no input, auto off) stays put (${k[0].speed} / ${k[1].speed})`);
  await btn(1, 7, 1);                                // P2: RT
  for (let i = 0; i < 30; i++) { await sleep(page, 100); k = await K(page); if (k[1].speed > 8) break; }
  ok(k[1].speed > 8, `pad 2 RT accelerates P2 (${k[1].speed})`);
  await axis(1, 0, -1); await sleep(page, 200);
  k = await K(page); ok(k[1].steer > 0.9 && Math.abs(k[0].steer) < 0.6, `pad 2 stick steers P2 only (P2 ${k[1].steer}, P1 ${k[0].steer})`);
  await axis(1, 0, -0.45); await btn(1, 5, 1); await sleep(page, 500);
  k = await K(page); ok(k[1].drift !== 0 && k[0].drift === 0, `pad 2 RB = P2 power slide, P1 not sliding (P2 ${k[1].drift}, P1 ${k[0].drift})`);
  await btn(1, 5, 0); await axis(1, 0, 0);
  // items: P1 a rocket, P2 a turbo — B on pad 2 fires only P2's; each HUD shows its own slot
  await page.evaluate(() => { const [a, b] = window.__OTR.humans, W = window.__OTR.items; a.item = null; b.item = null; W.give(a, 'rocket'); W.give(b, 'turbo'); a.stars = 3; b.stars = 7; });
  await sleep(page, 250);
  const hudItems = () => page.evaluate(() => ['#hud', '#hud2'].map(s => document.querySelector(s + ' .ih-icon')?.dataset.id || null));
  const hudStars = () => page.evaluate(() => ['#hud', '#hud2'].map(s => +document.querySelector(s + ' #hStars').textContent));
  let hi = await hudItems(), hs = await hudStars();
  ok(hi[0] === 'rocket' && hi[1] === 'turbo', `each HUD shows its own item slot (${hi})`);
  ok(hs[0] === 3 && hs[1] === 7, `each HUD shows its own stars (${hs})`);
  await page.screenshot({ path: `${SHOTS}/pads-items.png` });
  await tap(1, 1);                                   // B on pad 2
  k = await K(page); ok(k[1].item === null && k[0].item === 'rocket', `B on pad 2 uses P2's item only (P1 ${k[0].item}, P2 ${k[1].item})`);
  const places = await page.evaluate(() => ['#hud', '#hud2'].map(s => +document.querySelector(s + ' #hPlace b').textContent));
  k = await K(page); ok(places[0] === k[0].place && places[1] === k[1].place, `each HUD's place is its own kart's (${places} vs ${k.map(x => x.place)})`);
  await tap(1, 9);                                   // Start on pad 2 pauses
  ok(await until(page, () => window.__OTR.menu.screen === 'pause' && window.__OTR.G.paused, null, 3000), 'Start on pad 2 pauses (shared pause)');
  await tap(0, 0);
  ok(await until(page, () => !window.__OTR.G.paused && !window.__OTR.menu.screen, null, 3000), 'A resumes');
  await btn(1, 7, 0);
  // finish: the AI drives both karts home
  await page.evaluate(() => { const o = window.__OTR; o.race.autoPlayer = true; o.advance(400); });
  ok(await until(page, () => window.__OTR.menu.screen === 'results', null, 15000), 'results after both players finish');
  await sleep(page, 700);
  const res = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#resList li.me')].map(li => li.querySelector('.pbadge')?.textContent + ':' + li.querySelector('.nm').textContent.trim()),
    duo: [...document.querySelectorAll('.rduo .rone')].map(r => r.querySelector('.pbadge').textContent + ':' + r.querySelector('.rbadge b').textContent), title: document.querySelector('.rhead h2')?.textContent }));
  ok(res.rows.length === 2 && res.rows.some(r => r.startsWith('P1')) && res.rows.some(r => r.startsWith('P2')), `results list marks both players (${res.rows.join(' | ')})`);
  ok(res.duo.length === 2, `results header shows both players' places (${res.duo}) — "${res.title}"`);
  await page.screenshot({ path: `${SHOTS}/pads-results.png` });
}, PADS);

/* ------------------------------------------------------------------ one keyboard, split */
await run('keyboard: one keyboard split between two players', '?players=2&skip=1&track=beach&seed=3&diff=medium&racer=orion&racer2=kingdad', async page => {
  await until(page, () => window.__OTR.state === 'race', null, 20000);
  const devs = await page.evaluate(() => window.__OTR.In.players.map(p => p.device));
  ok(devs.join() === 'kbL,kbR', `no pads → P1 = left half, P2 = right half (${devs})`);
  await page.keyboard.down('KeyW');
  let k; for (let i = 0; i < 30; i++) { await sleep(page, 100); k = await K(page); if (k[0].speed > 8) break; }
  ok(k[0].speed > 8 && Math.abs(k[1].speed) < 1, `W drives P1 only (${k[0].speed} / ${k[1].speed})`);
  await page.keyboard.down('ArrowUp');
  for (let i = 0; i < 30; i++) { await sleep(page, 100); k = await K(page); if (k[1].speed > 8) break; }
  ok(k[1].speed > 8, `↑ drives P2 (${k[1].speed})`);
  await page.keyboard.down('KeyA'); await sleep(page, 150);
  k = await K(page); ok(k[0].steer > 0.9 && k[1].steer === 0, `A steers P1 only (${k[0].steer} / ${k[1].steer})`);
  await page.keyboard.down('Space'); await sleep(page, 600);
  k = await K(page); ok(k[0].drift !== 0 && k[1].drift === 0, `Space + A = P1 slide only (${k[0].drift} / ${k[1].drift})`);
  await page.keyboard.up('Space'); await page.keyboard.up('KeyA');
  // P2 slide + turbo, live: a slide can end on a wall, so retry (the '.' press is made from inside the
  // page the first frame the meter is red, so a busy box can't miss the window — like input-test.mjs)
  let slid = false, why = '';
  for (let tr = 0; tr < 3 && !why.startsWith('pressed'); tr++) {
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('ShiftRight'); await sleep(page, 450);
    k = await K(page); if (k[1].drift !== 0 && k[0].drift === 0) slid = true;
    why = await page.evaluate(() => new Promise(res => { let n = 0, fr = 0; const f = () => { const k = window.__OTR.humans[1]; fr++;
      if (k.inRed || n) { window.dispatchEvent(new KeyboardEvent(++n <= 3 ? 'keydown' : 'keyup', { code: 'Period', key: '.', bubbles: true, cancelable: true })); if (n > 3) return res('pressed after ' + fr + ' frames'); }
      else if (!k.drift || fr > 200) return res(`slide ended (charge ${k.charge.toFixed(2)})`); requestAnimationFrame(f); }; f(); }));
    console.log('   P2 turbo try', tr + 1, why);
    await sleep(page, 120);
    k = await K(page);
    await page.keyboard.up('ShiftRight'); await page.keyboard.up('ArrowRight'); await sleep(page, 500);
  }
  ok(slid, 'Right Shift + → = P2 slide only');
  ok((k[1].turbos >= 1 || k[1].boostT > 0) && k[0].turbos === 0, `'.' in the red = P2 turbo only (P2 turbos ${k[1].turbos} boost ${k[1].boostT}, P1 ${k[0].turbos}; ${why})`);
  let hop = false;
  for (let tr = 0; tr < 3 && !hop; tr++) {
    await page.keyboard.down('ArrowLeft'); await page.keyboard.down('Slash');
    for (let i = 0; i < 8 && !hop; i++) { await sleep(page, 90); hop = (await K(page))[1].drift !== 0; }
    await page.keyboard.up('Slash'); await page.keyboard.up('ArrowLeft'); await sleep(page, 400);
  }
  ok(hop, `'/' is P2's hop too (a slide)`);
  await page.evaluate(() => { const [a, b] = window.__OTR.humans, W = window.__OTR.items; a.item = null; b.item = null; W.give(a, 'turbo'); W.give(b, 'turbo'); });
  await sleep(page, 150);
  await page.keyboard.press('Enter'); await sleep(page, 200);
  k = await K(page); ok(k[1].item === null && k[0].item === 'turbo', `Enter = P2's item only (P1 ${k[0].item}, P2 ${k[1].item})`);
  await page.keyboard.press('KeyE'); await sleep(page, 200);
  k = await K(page); ok(k[0].item === null, `E = P1's item (P1 ${k[0].item})`);
  await page.keyboard.down('ShiftLeft'); await sleep(page, 80);
  const sl = await page.evaluate(() => window.__OTR.In.players.map(p => p.controls.hopB));
  await page.keyboard.up('ShiftLeft');
  ok(sl[0] === true && sl[1] === false, `Left Shift is P1's turbo only (${sl})`);
  const ctrlPrevented = await page.evaluate(() => ['KeyW', 'ArrowUp', 'Enter', 'Slash', 'Period'].map(code => { const e = new KeyboardEvent('keydown', { code, key: code, ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }));
  ok(!ctrlPrevented.some(Boolean), `Ctrl+W/↑/Enter/'/'/'.' never preventDefault-ed (${ctrlPrevented})`);
  await page.keyboard.up('KeyW'); await page.keyboard.up('ArrowUp');
  await page.screenshot({ path: `${SHOTS}/keyboard-race.png` });
  // the HUDs: P badges + the one shared minimap
  const hud = await page.evaluate(() => ({ pn: ['#hud', '#hud2'].map(s => getComputedStyle(document.querySelector(s + ' .hx-pn')).display + ':' + document.querySelector(s + ' .hx-pn').textContent),
    maps: ['#hud', '#hud2'].map(s => getComputedStyle(document.querySelector(s + ' .hx-map')).display) }));
  ok(hud.pn.join() === 'block:P1,block:P2' && hud.maps.join() === 'block,none', `P1/P2 badges, one shared minimap (${JSON.stringify(hud)})`);
  // back to 1P from the menus: everything split-screen is undone
  await page.evaluate(() => { const m = window.__OTR.menu; m.M.players = 1; m.launch('ice'); });
  await until(page, () => window.__OTR.state === 'countdown' && window.__OTR.race?.track.id === 'ice', null, 60000);
  await sleep(page, 400);
  const one = await page.evaluate(() => { const O = window.__OTR; return { humans: O.humans.length, mp: O.G.mp, split: document.body.classList.contains('split2'), splitBar: !document.getElementById('split').hidden,
    hud2: !document.getElementById('hud2').hidden, aspect: +O.camera.aspect.toFixed(2), fovMul: O.chase.fovMul, dev: O.In.players[0].device, scissor: O.renderer.getScissorTest() }; });
  ok(one.humans === 1 && !one.mp && !one.split && !one.splitBar && !one.hud2 && one.aspect === 1.6 && one.fovMul === 1 && one.dev === null && !one.scissor, `a 1P race after a 2P one is plain 1P again (${JSON.stringify(one)})`);
});

/* ------------------------------------------------------------------ join with one keyboard */
await run('join-kb: Enter on the join screen splits the keyboard', '?screen=menu', async page => {
  await until(page, () => window.__OTR.menu?.screen === 'menu');
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await sleep(page, 150); }
  await page.keyboard.press('Space'); await sleep(page, 300);
  ok(await screen(page) === 'join', 'Space on 2 PLAYERS opens the join screen');
  let M = await page.evaluate(() => window.__OTR.menu.M.devs);
  ok(M[0] === 'kb' && !M[1], `P1 = the keyboard (${M})`);
  await page.keyboard.press('Enter'); await sleep(page, 300);
  M = await page.evaluate(() => ({ devs: window.__OTR.menu.M.devs, screen: window.__OTR.menu.screen }));
  ok(M.devs.join() === 'kbL,kbR' && M.screen === 'join', `Enter = P2 joins on the right half, P1 moves to the left half (${M.devs}), no click-through (${M.screen})`);
  await page.screenshot({ path: `${SHOTS}/join-keyboard.png` });
  // P2's AUTO-GO toggles on its own (tap the row), then back to QUICK RACE with the mouse and Space
  await page.click('[data-key="j1auto"] .val');
  const a = await page.evaluate(() => window.__OTR.menu.M.mp.auto);
  ok(a[1] === true && a[0] === true, `P2's AUTO-GO toggles on its own (${a})`);
  await page.hover('[data-act="quick"]'); await sleep(page, 100);
  await page.keyboard.press('Space'); await sleep(page, 400);
  ok(await screen(page) === 'select', 'Space (P1) on QUICK RACE → racer select');
});

/* ------------------------------------------------------------------ a whole 2P Orion Cup (keyboard, fast-forwarded) */
await run('cup: a 2P Orion Cup → standings with P1/P2 → podium', '?screen=menu', async page => {
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(page, 180); } };
  await until(page, () => window.__OTR.menu?.screen === 'menu');
  await key('ArrowDown', 3); await key('Space');
  await key('Enter');                                      // P2 joins (right half)
  await key('ArrowRight'); await key('Space');            // ORION CUP ▶
  ok(await until(page, () => window.__OTR.menu.screen === 'select'), 'join → ORION CUP → select');
  await key('Space'); await until(page, () => document.querySelector('.scr-select.sel-p2'));
  await sleep(page, 300); await key('Space');
  ok(await until(page, () => window.__OTR.menu.screen === 'standings'), 'both picked → cup standings');
  const n = await page.evaluate(() => window.__OTR.menu.M.cup.tracks.length);
  for (let r = 0; r < n; r++) {
    await key('Space');                                    // START / NEXT RACE
    await until(page, () => window.__OTR.state === 'countdown' || window.__OTR.state === 'race', null, 60000);
    const mp = await page.evaluate(() => window.__OTR.G.mp && window.__OTR.humans.length === 2);
    if (!mp) { ok(false, `race ${r + 1} is split screen`); return; }
    await page.evaluate(() => { const o = window.__OTR; o.race.autoPlayer = true; o.advance(400); });
    await until(page, () => window.__OTR.menu.screen === 'results', null, 15000);
    await sleep(page, 400); await key('Space');           // CONTINUE
    await until(page, () => window.__OTR.menu.screen === 'standings', null, 15000);
    await sleep(page, 1600);
    if (r === 1) {
      const st = await page.evaluate(() => [...document.querySelectorAll('#standList li.me')].map(li => li.querySelector('.pbadge')?.textContent));
      ok(st.length === 2 && st.includes('P1') && st.includes('P2'), `standings mark both players (${st})`);
      await page.screenshot({ path: `${SHOTS}/cup-standings-live.png` });
    }
  }
  await key('Space');                                      // TO THE PODIUM!
  ok(await until(page, () => window.__OTR.menu.screen === 'podium', null, 10000), 'podium after 4 races');
  await sleep(page, 2500);
  const pod = await page.evaluate(() => ({ h: document.querySelector('.podtop h2').textContent, p: document.querySelector('.podtop p').textContent, humans: window.__OTR.menu.M.cup.humans }));
  ok(pod.humans.length === 2 && /P1/.test(pod.p) && /P2/.test(pod.p), `podium names both players: "${pod.h}" — ${pod.p}`);
  await page.screenshot({ path: `${SHOTS}/cup-podium-live.png` });
});

await browser.close().catch(() => {});
console.log(fails ? `TWO PLAYER TEST: ${fails} FAIL` : 'TWO PLAYER TEST: PASS');
process.exit(fails ? 1 : 0);
