// node tools/shot-rev.mjs [scenario ...] [--out shots/rev]
//
// QA screenshots + checks for the engine feedback (2026-11-09): the start-line rev gauge (the slide meter fills
// white→orange while you rev; over-rev = dark shaking meter, black smoke, backfires), the slide's white
// exhaust that grows with the charge, the overheat's black smoke + backfire, and the pad-↓ look-back view
// with a Taco Bomb rolled backward. GPU headless Chrome (CDP on Unraid), dev server on the hub, the page is
// ALWAYS closed in `finally`. The sim is scripted (__OTR.hold + __OTR.script); __OTR.setPaused(true) freezes
// the particles for the shot.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'shots/rev');
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
const pick = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--out'));

const H = `
window.P = () => __OTR.player;
window.steps = (n, c = {}) => __OTR.script(n, () => ({ steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false, ...c }), { draw: true });
/** step (rendering) until race.t >= t with control c; returns the player's kart events */
window.until = (t, c = {}) => { const ev = []; let g = 0; while (__OTR.race.t < t - 1e-6 && g++ < 2000) ev.push(...steps(1, c)); return ev; };
window.meter = () => { const m = document.querySelector('#hMeter'), i = document.querySelector('#hCharge'); return { s: m?.dataset.s, fill: +((i?.style.transform || '').match(/scaleX\\(([-0-9.e]+)\\)/)?.[1] ?? 0) }; };
window.drive = n => { __OTR.race.autoPlayer = true; const e = __OTR.script(n, () => ({}), { draw: true }); __OTR.race.autoPlayer = false; return e; };
`;

const SCEN = {
  // Easy (window −0.5 s): press 0.45 s before GO, look 0.35 s later — gauge ~70 %, white exhaust growing
  'rev-mid': { diff: 'easy', run: () => {
    until(-0.45); const ev = until(-0.1, { throttle: 1 });
    const k = P(); __OTR.setPaused(true);
    return { rev: +k.rev.toFixed(2), overRev: k.overRev, meter: meter(), backfires: ev.filter(e => e === 'backfire').length };
  }, check: r => r.rev > 0.55 && r.rev < 0.85 && !r.overRev && r.meter.s === 'rev' && r.meter.fill > 0.55 && !r.backfires },
  // Medium: mashed 1.6 s early → over-revs 0.35 s later: backfire, dark shaking meter, black smoke; stalls at GO
  'rev-over': { diff: 'medium', run: () => {
    until(-1.6); const ev = until(-0.7, { throttle: 1 });
    const k = P(); const at = { rev: +k.rev.toFixed(2), overRev: k.overRev, meter: meter(), backfires: ev.filter(e => e === 'backfire').length };
    __OTR.setPaused(true); return at;
  }, check: r => r.overRev && r.meter.s === 'over' && r.backfires >= 2 },
  // the first backfire from the side (camera pinned before the steps so the particles face it)
  'backfire-side': { diff: 'medium', run: () => {
    const k = P(), fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    __OTR.chase.pin([k.pos.x + fz * 4.2 - fx * 1.2, k.pos.y + 1.3, k.pos.z - fx * 4.2 - fz * 1.2, k.pos.x - fx * 1.0, k.pos.y + 0.6, k.pos.z - fz * 1.0]);
    until(-1.6); let ev = [], g = 0;
    while (!ev.includes('backfire') && g++ < 200) ev.push(...steps(1, { throttle: 1 }));
    steps(2, { throttle: 1 });
    __OTR.setPaused(true); return { backfire: ev.includes('backfire'), overRev: P().overRev };
  }, check: r => r.backfire && r.overRev },
  'rev-stall': { diff: 'medium', run: () => {
    until(-1.6); const ev = until(0.3, { throttle: 1 });
    const k = P(); __OTR.setPaused(true);
    return { stallT: +k.stallT.toFixed(2), misfireT: +k.misfireT.toFixed(2), sb: !!k._sb, backfires: ev.filter(e => e === 'backfire').length, meter: meter() };
  }, check: r => r.stallT > 0 && r.misfireT > 0 && !r.sb && r.meter.s !== 'over' },
  // a good start: pressed in the window → start boost at GO, no misfire
  'rev-boost': { diff: 'medium', run: () => {
    until(-0.2); const ev = until(0.05, { throttle: 1 });
    const k = P(); __OTR.setPaused(true);
    return { sb: !!k._sb, boostT: +k.boostT.toFixed(2), backfires: ev.filter(e => e === 'backfire').length, misfireT: k.misfireT };
  }, check: r => r.sb && r.boostT > 0 && !r.backfires && !r.misfireT },
  // slide charging: white exhaust that grows with the meter
  'slide-white': { diff: 'medium', run: () => {
    until(0.01, { throttle: 1 }); drive(330);
    steps(1, { throttle: 1, steer: 1, hopA: true }); let g = 0;
    while (!(P().drift && P().charge > 0.62) && g++ < 120) steps(1, { throttle: 1, steer: 0.6, hopA: true });
    const k = P(); __OTR.setPaused(true);
    return { drift: k.drift, charge: +k.charge.toFixed(2), meter: meter() };
  }, check: r => r.drift !== 0 && r.charge > 0.6 },
  // ...held past full without the turbo press: overheat → backfire + black smoke
  'slide-overheat': { diff: 'medium', run: () => {
    until(0.01, { throttle: 1 }); drive(330);
    steps(1, { throttle: 1, steer: 1, hopA: true }); let g = 0, ev = [];
    while (!P().overheat && g++ < 160) ev.push(...steps(1, { throttle: 1, steer: 0.6, hopA: true }));
    steps(3, { throttle: 1, steer: 0.6, hopA: true });
    const k = P(); __OTR.setPaused(true);
    return { overheat: k.overheat, events: ev.filter(e => /overheat|fizzle|turbo/.test(e)), meter: meter() };
  }, check: r => r.overheat && r.meter.s === 'hot' },
  // pad ↓: the look-back view, a Taco Bomb rolled out of it backward
  'lookback-bomb': { diff: 'medium', run: () => {
    until(0.01, { throttle: 1 }); drive(420);
    __OTR.items.give(P(), 'taco_bomb'); steps(2, { throttle: 1 });
    steps(1, { throttle: 1, item: true, lookBack: true }); steps(16, { throttle: 1, lookBack: true });
    const k = P(), b = __OTR.items.projs.find(q => q.kind === 'taco_bomb' && q.owner === k);
    __OTR.hold(true); __OTR.override({ steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false, lookBack: true }); __OTR.render();
    const c = __OTR.camera.position;
    return { back: __OTR.chase.back, camAhead: +((c.x - k.pos.x) * Math.sin(k.yaw) + (c.z - k.pos.z) * Math.cos(k.yaw)).toFixed(1), bomb: b ? { v: b.v, dir: +Math.cos(b.yaw - k.yaw).toFixed(2) } : null };
  }, check: r => r.back && r.camAhead > 1 && r.bomb && r.bomb.v < 0 && r.bomb.dir < -0.9 },
};

const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
await fs.mkdir(OUT, { recursive: true });
let fails = 0;
for (const [name, sc] of Object.entries(SCEN)) {
  if (pick.length && !pick.includes(name)) continue;
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${BASE}index.html?track=beach&skip=1&seed=3&diff=${sc.diff}&q=high`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__OTR?.ready && window.__OTR.race && window.__OTR.state === 'countdown' && window.__OTR.race.t < -1.8, null, { timeout: 60000 });
    await page.evaluate(() => window.__OTR.hold(true));
    await page.evaluate(H);
    const r = await page.evaluate(`(${sc.run.toString()})()`);
    await page.waitForTimeout(250);
    const file = path.join(OUT, name + '.jpg');
    await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
    const good = sc.check(r) && !errs.length;
    if (!good) fails++;
    console.log(`${good ? 'PASS' : 'FAIL'} ${name.padEnd(15)} ${JSON.stringify(r)}${errs.length ? ' ERR ' + errs.slice(0, 2).join(' | ') : ''} → ${file}`);
  } catch (e) { fails++; console.log(`FAIL ${name} threw ${e.message}`); }
  finally { await page.close().catch(() => {}); }
}
await browser.close().catch(() => {});
console.log(fails ? `REV SHOTS: ${fails} FAIL` : 'REV SHOTS: PASS');
process.exit(fails ? 1 : 0);
