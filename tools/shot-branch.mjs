// node tools/shot-branch.mjs ['<query>'] [branchId] [--out shots/branch] [--size 1280x800]
//
// Screenshots of a branch (shortcut) for LOOKING at its junctions: a top-down overview, both junctions
// from above, and the chase camera of the autopilot driving through it (before the opening, on the
// branch, the lip, the exit, back on the main road) — one page, the sim fast-forwarded between frames.
// Default query: the gate's fixture ('track=beach&fixture=1'). The page is ALWAYS closed in `finally`.
//   node tools/shot-branch.mjs                                    # fixture, its first branch
//   node tools/shot-branch.mjs 'track=ice' icecave --out shots/ice-branch
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const query = (pos[0] || 'track=beach&fixture=1').replace(/^\?/, '');
const want = pos[1] || null;
const out = opt('out', 'shots/branch');
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
const [W, H] = opt('size', '1280x800').split('x').map(Number);

const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
let code = 0;
try {
  await fs.mkdir(out, { recursive: true });
  await page.setViewportSize({ width: W, height: H });
  const id0 = want ? `&branch=${want}` : '';
  await page.goto(`${BASE}index.html?${query}&skip=1&ai=1&q=high${id0}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__OTR?.ready, null, { timeout: 60000 });
  const info = await page.evaluate(want => {
    const O = __OTR, tr = O.track, br = want ? tr.branchById(want) : tr.branches[0];
    if (!br) return null;
    O.race.forceBranch = br.id;
    return { id: br.id, len: br.length, sEntry: br.sEntry, sExit: br.sExit, lip: br.jumps[0]?.s ?? null,
      a: [br.X[0], br.Y[0], br.Z[0]], b: [br.X[br.n - 1], br.Y[br.n - 1], br.Z[br.n - 1]], m: [br.X[br.n >> 1], br.Y[br.n >> 1], br.Z[br.n >> 1]],
      span: Math.hypot(br.X[0] - br.X[br.n - 1], br.Z[0] - br.Z[br.n - 1]) };
  }, want);
  if (!info) throw new Error('no branch on this track (fixture=1 needs track=beach)');
  console.log('branch', JSON.stringify(info));
  const shot = async name => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, name + '.png') }); console.log('wrote', path.join(out, name + '.png')); };
  // ---- from above (fog pushed out, HUD hidden)
  await page.evaluate(() => { __OTR.hold(true); __OTR.scene.fog.near = 4000; __OTR.scene.fog.far = 5000; document.getElementById('hud').hidden = true; });   // hold: the live loop stops, script() steps it
  const pin = async arr => { await page.evaluate(a => { __OTR.chase.pin(a); __OTR.render(); }, arr); };
  const [mx, my, mz] = info.m, H0 = Math.max(90, info.span * 0.9);
  await pin([mx, my + H0, mz + H0 * 0.35, mx, my, mz]); await shot('1-overview');
  for (const [nm, p, q] of [['2-entry-above', info.a, info.m], ['3-exit-above', info.b, info.m]]) {
    const dx = p[0] - q[0], dz = p[2] - q[2], d = Math.hypot(dx, dz) || 1;
    await pin([p[0] + dx / d * 30, p[1] + 26, p[2] + dz / d * 30, p[0] - dx / d * 8, p[1], p[2] - dz / d * 8]); await shot(nm);
  }
  // ---- the chase camera, autopilot through the branch
  await page.evaluate(() => { __OTR.hold(true); __OTR.chase.pin(null); __OTR.scene.fog.near = 140; __OTR.scene.fog.far = 520; document.getElementById('hud').hidden = false; });
  // fast-forward in 6-step chunks (no rendering) until cond(k, tr) holds, then settle the chase camera over 20 drawn steps
  const driveTo = async (cond, maxS = 90) => page.evaluate(([c, m]) => {
    const O = __OTR, f = new Function('k', 'tr', 'return ' + c);
    let hit = null;
    for (let i = 0; i < m * 10 && O.race.phase !== 'done' && !hit; i++) O.script(6, k => { if (!hit && f(k, O.track)) hit = true; return null; });
    const k = O.player; O.chase.snap(k); O.script(8, () => null, { draw: true });
    return { s: +k.s.toFixed(1), route: k.route, rs: +k.rs.toFixed(1), t: +O.race.t.toFixed(2), air: k.air, timeout: !hit };
  }, [cond, maxS]);
  const B = `tr.branchById('${info.id}')`;
  for (const [nm, cond] of [
    ['4-chase-approach', `k.route === 0 && tr.dS(k.s, ${B}.sEntry) < 30 && tr.dS(k.s, ${B}.sEntry) > 0`],
    ['5-chase-opening', `k.route === ${B}.route && k.rs > 12`],
    ['6-chase-onbranch', `k.route === ${B}.route && k.rs > ${B}.length * 0.3`],
    ...(info.lip != null ? [['7-chase-lip', `k.route === ${B}.route && k.rs > ${info.lip - 16}`], ['8-chase-air', `k.route === ${B}.route && k.air && k.rs > ${info.lip + 1}`]] : []),
    ['9-chase-exit', `k.route === ${B}.route && k.rs > ${B}.length - 22`],
    ['10-chase-rejoined', `k.route === 0 && tr.dS(${B}.sExit, k.s) > 12 && tr.dS(${B}.sExit, k.s) < 100`],
  ]) {
    const r = await driveTo(cond);
    console.log(nm, JSON.stringify(r));
    await shot(nm);
  }
  const calls = await page.evaluate(() => { __OTR.render(); return __OTR.info(); });
  console.log('info:', JSON.stringify(calls));
} catch (e) {
  console.error('shot-branch failed:', e.message); code = 1;
} finally {
  if (errs.length) console.log(errs.slice(0, 15).join('\n'));
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
process.exit(code);
