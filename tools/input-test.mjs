// node tools/input-test.mjs
// QA agent: in-race input checks in the real browser (GPU headless Chrome).
//  pad  — a fake standard-mapping pad (what the Steam Deck presents: an Xbox 360 layout) through
//         navigator.getGamepads: RT accelerates, stick steers (left = +steer), RB hop → slide,
//         LB in the red = turbo, B/Y fires the item, START pauses, A resumes from the pause menu.
//  keys — ↑ accelerates, Space+← slides, Shift turbos, arrows/Space/PageDown never scroll the page,
//         Ctrl+key is never preventDefault-ed (Ctrl+W must still close the tab), keys released while
//         paused don't stay held.
// The page is ALWAYS closed in finally.
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  PASS ' : '  FAIL ') + msg); if (!c) fails++; };

async function run(name, fn, init) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    if (init) await page.addInitScript(init);
    await page.goto(BASE + 'index.html?track=beach&skip=1&seed=3&diff=medium', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__OTR?.ready && window.__OTR.state === 'race', null, { timeout: 60000 });
    console.log(name);
    await fn(page);
    ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
  } catch (e) { ok(false, name + ' threw: ' + e.message); }
  finally { await page.close().catch(() => {}); }
}
const P = page => page.evaluate(() => { const k = window.__OTR.player; return { speed: k.speed, drift: k.drift, steer: k.ctrl?.steer ?? k.steer, turbos: k.turbos, boostT: k.boostT, item: k.item, paused: window.__OTR.G.paused, screen: window.__OTR.menu?.screen ?? null }; });

await run('pad (Steam Deck / Xbox 360 standard mapping)', async page => {
  const set = (i, v) => page.evaluate(([i, v]) => { window.__pad.buttons[i] = v; }, [i, v]);
  const axis = (i, v) => page.evaluate(([i, v]) => { window.__pad.axes[i] = v; }, [i, v]);
  await set(7, 1);
  let p; for (let i = 0; i < 40; i++) { await page.waitForTimeout(100); p = await P(page); if (p.speed > 8) break; }   // polled: a shared GPU box can slow the sim
  ok(p.speed > 8, `RT accelerates (speed ${p.speed.toFixed(1)})`);
  await axis(0, -1); await page.waitForTimeout(150);
  p = await P(page); ok(p.steer > 0.9, `stick left = steer left (+${p.steer})`);
  // RB slide, then LB the first frame the meter is red (pressed from inside the page so a busy box can't miss
  // the window). Live driving: a slide can end on a wall, so retry up to 3 times.
  let why = '';
  for (let tr = 0; tr < 3; tr++) {
    await axis(0, -0.45); await set(5, 1); await page.waitForTimeout(450);   // a gentle slide: full lock at 27 m/s ends in the wall
    if (tr === 0) { p = await P(page); ok(p.drift !== 0, `RB hop with stick held = power slide (drift ${p.drift})`); }
    why = await page.evaluate(() => new Promise(res => { let n = 0, fr = 0; const f = () => { const k = window.__OTR.player; fr++; if (k.inRed || n) { window.__pad.buttons[4] = ++n <= 4 ? 1 : 0; if (n > 4) return res('pressed after ' + fr + ' frames'); } else if (!k.drift) return res(`slide ended (charge ${k.charge.toFixed(2)})`); requestAnimationFrame(f); }; f(); }));
    console.log('   LB try', tr + 1, why);
    if (why.startsWith('pressed')) break;
    await set(5, 0); await axis(0, 0); await page.waitForTimeout(600);
  }
  await page.waitForTimeout(150);
  p = await P(page); ok(p.turbos >= 1 || p.boostT > 0, `LB in the red = turbo (turbos ${p.turbos}, boost ${p.boostT.toFixed(2)})`);
  await set(5, 0); await axis(0, 0);
  await page.evaluate(() => { window.__OTR.items?.give?.(window.__OTR.player, 'turbo'); });
  await page.waitForTimeout(100);
  const had = (await P(page)).item;
  await set(1, 1); await page.waitForTimeout(120); await set(1, 0); await page.waitForTimeout(200);
  p = await P(page); ok(had && !p.item, `B uses the item (${had} → ${p.item})`);
  await set(9, 1); await page.waitForTimeout(150); await set(9, 0); await page.waitForTimeout(300);
  p = await P(page); ok(p.paused && p.screen === 'pause', `START pauses (screen ${p.screen})`);
  await set(7, 0);
  await set(0, 1); await page.waitForTimeout(150); await set(0, 0); await page.waitForTimeout(400);
  p = await P(page); ok(!p.paused && !p.screen, `A on "keep racing" resumes (paused ${p.paused})`);
}, () => {
  window.__pad = { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] };
  navigator.getGamepads = () => [{ id: 'Microsoft X-Box 360 pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    buttons: window.__pad.buttons.map(v => ({ pressed: !!v, value: v, touched: !!v })), axes: window.__pad.axes }];
});

await run('keyboard', async page => {
  await page.evaluate(() => { document.body.style.minHeight = '3000px'; });   // make the page scrollable on purpose
  await page.keyboard.down('ArrowUp');
  let p; for (let i = 0; i < 40; i++) { await page.waitForTimeout(100); p = await P(page); if (p.speed > 8) break; } ok(p.speed > 8, `↑ accelerates (speed ${p.speed.toFixed(1)})`);
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('Space'); await page.waitForTimeout(700);
  p = await P(page); ok(p.drift !== 0, `Space + ← = slide (drift ${p.drift})`);
  for (let i = 0; i < 40; i++) { const r = await page.evaluate(() => window.__OTR.player.inRed); if (r) break; await page.waitForTimeout(40); }
  await page.keyboard.press('ShiftLeft'); await page.waitForTimeout(150);
  p = await P(page); ok(p.turbos >= 1 || p.boostT > 0, `Shift in the red = turbo (turbos ${p.turbos})`);
  await page.keyboard.up('Space'); await page.keyboard.up('ArrowLeft');
  for (const k of ['Space', 'ArrowDown', 'ArrowUp', 'PageDown', 'End']) await page.keyboard.press(k);
  const sy = await page.evaluate(() => [scrollY, document.scrollingElement.scrollTop, document.documentElement.scrollHeight > innerHeight]);
  ok(sy[0] === 0 && sy[1] === 0, `arrows/Space/PageDown/End don't scroll (scrollY ${sy[0]}, page scrollable: ${sy[2]})`);
  const ctrlPrevented = await page.evaluate(() => ['KeyW', 'KeyR', 'KeyT', 'ArrowUp', 'Space'].map(code => { const e = new KeyboardEvent('keydown', { code, key: code, ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }));
  ok(!ctrlPrevented.some(Boolean), `Ctrl+W/R/T/↑/Space never preventDefault-ed (${ctrlPrevented})`);
  // pause with ↑ held, release it in the menu, resume: must coast, not keep driving
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.keyboard.up('ArrowUp'); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  p = await page.evaluate(() => ({ thr: window.__OTR.player.ctrl?.throttle, paused: window.__OTR.G.paused }));
  ok(!p.paused && p.thr === 0, `↑ released during pause isn't stuck after resume (throttle ${p.thr})`);
  // window blur (alt-tab / Steam overlay) releases held keys
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(100);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(150);
  p = await page.evaluate(() => ({ steer: window.__OTR.player.ctrl?.steer }));
  ok(p.steer === 0, `blur releases held keys (steer ${p.steer})`);
  await page.keyboard.up('ArrowLeft');
});

await browser.close().catch(() => {});
console.log(fails ? `INPUT TEST: ${fails} FAIL` : 'INPUT TEST: PASS');
process.exit(fails ? 1 : 0);
