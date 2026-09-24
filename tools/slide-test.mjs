// node tools/slide-test.mjs [outdir]
// Drives the PLAYER through a real power slide in the real game (GPU headless Chrome), pressing
// the other shoulder in the red window 3 times, and screenshots each stage so you can SEE the
// exhaust flame colour change: charging (blue-white) → red window (orange) → stage-3 turbo (purple).
// Also: a jump (hang-time turbo) and a deliberate fizzle + overheat. Prints the event log.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const OUT = process.argv[2] || 'shots/slide';
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 300)));
let code = 0;
try {
  await fs.mkdir(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(BASE + 'index.html?track=beach&racer=orion&skip=1&diff=medium&slot=0', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__OTR?.ready && __OTR.state === 'countdown');
  // in-page helper: steer like a decent human — follow the road, and in a slide pick the
  // counter-steer that holds the line (the same maths the AI uses)
  await page.evaluate(() => {
    window.__steer = (k) => {
      const O = __OTR, tr = O.track, f = tr.frameAt(k.s + 6 + k.speed * 0.5), lat = tr.AIL[f.k] * 0.8;
      const p = tr.pointAt(k.s + 6 + k.speed * 0.5, lat);
      let e = Math.atan2(p.x - k.pos.x, p.z - k.pos.z) - k.yaw; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      if (!k.drift) return Math.max(-1, Math.min(1, e * 2.5));
      const need = e * 2.4 + k.speed * tr.CURV[tr.idx(k.s + 4)] * 1.05;
      const into = Math.max(-1, Math.min(1, (need * k.drift - O.T.DRIFT_BASE) / O.T.DRIFT_STEER));
      return into * k.drift;
    };
  });
  const shot = async name => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); };
  // countdown, then get up to speed on the start straight (it's ~70 m long, then a gentle left)
  const log = await page.evaluate(() => {
    const O = __OTR; O.hold(true);
    const out = {};
    const drive = window.__steer;
    out.pre = O.script(Math.round(3.7 / O.DT), () => ({ steer: 0, throttle: 1, brake: 0, hopA: false, hopB: false }));
    // let the AI drive us to the run-up of the Lighthouse Hairpin (a real corner to slide through)
    O.race.autoPlayer = true;
    for (let i = 0; i < 4000 && !(O.player.s > 372 && O.player.s < 420); i++) O.script(1, () => ({}));
    O.race.autoPlayer = false;
    out.accel = O.script(20, k => ({ steer: drive(k), throttle: 1, brake: 0, hopA: false, hopB: false }));
    out.v0 = O.player.speed;
    return out;
  });
  console.log('start events', log.pre.join(','), '| accel', log.accel.join(','), '| speed', log.v0.toFixed(1));
  // hop + slide left, render as we go
  const step = (n, fnSrc) => page.evaluate(([n, src]) => { const fn = (0, eval)(src); return __OTR.script(n, fn, { draw: true }); }, [n, fnSrc]);
  let ev = await step(24, `(k) => ({ steer: 0.5, throttle: 1, brake: 0, hopA: true, hopB: false })`);
  console.log('hop→', ev.join(','));
  ev = await step(14, `(k) => ({ steer: __steer(k), throttle: 1, brake: 0, hopA: true, hopB: false })`);
  console.log('charging', ev.join(','), await page.evaluate(() => JSON.stringify({ drift: __OTR.player.drift, charge: __OTR.player.charge.toFixed(2) })));
  await shot('1-charging-blue');
  // stop when in the red: step until inRed
  ev = await page.evaluate(() => { const evs = []; for (let i = 0; i < 60 && !__OTR.player.inRed; i++) evs.push(...__OTR.script(1, k => ({ steer: __steer(k), throttle: 1, brake: 0, hopA: true, hopB: false }), { draw: true })); evs.push(...__OTR.script(4, k => ({ steer: __steer(k), throttle: 1, brake: 0, hopA: true, hopB: false }), { draw: true })); return evs; });
  console.log('to red', ev.join(','), await page.evaluate(() => JSON.stringify({ inRed: __OTR.player.inRed, charge: __OTR.player.charge.toFixed(2) })));
  await shot('2-red-window-orange');
  // fire 3 turbos, each on the first red frame
  const turbos = await page.evaluate(() => {
    const evs = []; let hold = 0;
    for (let i = 0; i < 240 && __OTR.player.turbos < 3; i++) {
      const k = __OTR.player; let b = false;
      if (hold > 0) { hold--; b = true; } else if (k.inRed) { hold = 3; b = true; }
      evs.push(...__OTR.script(1, k => ({ steer: __steer(k), throttle: 1, brake: 0, hopA: true, hopB: b }), { draw: true }));
    }
    evs.push(...__OTR.script(5, k => ({ steer: __steer(k), throttle: 1, brake: 0, hopA: true, hopB: false }), { draw: true }));
    return { evs, tier: __OTR.player.boostTier, boostT: __OTR.player.boostT, speed: __OTR.player.speed };
  });
  console.log('turbos', turbos.evs.join(','), 'tier', turbos.tier, 'boostT', turbos.boostT.toFixed(2), 'speed', turbos.speed.toFixed(1));
  await shot('3-stage3-purple');
  // release, let it run 1 s
  await step(40, `(k) => ({ steer: __steer(k), throttle: 1, brake: 0, hopA: false, hopB: false })`);
  await shot('4-after-slide');
  const info = await page.evaluate(() => __OTR.info());
  console.log('render info', JSON.stringify(info));
} catch (e) { console.error('slide-test failed:', e.message); code = 1; }
finally {
  if (errs.length) console.log(errs.join('\n'));
  await page.close().catch(() => {}); await browser.close().catch(() => {});
}
process.exit(code);
