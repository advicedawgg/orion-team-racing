// node tools/shot-items.mjs [scenario ...] [--out shots/items] [--list]
//
// Screenshots of every item state through the GPU headless Chrome (like tools/shot.mjs: CDP on
// Unraid, dev server on the hub, page ALWAYS closed in `finally`). Each scenario loads a fresh race,
// freezes the live loop (__OTR.hold) and scripts the sim with __OTR.script, using the item world at
// __OTR.items. In-page helpers: ff(s), steps(n, ctrl) (fixed controls), drive(n) (AI drives the
// player), give(id), use(back), press(back) (through the real input path), camP(back, up, look, side).
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'shots/items');
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';
const pick = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--out'));

// helpers injected into the page
const H = `
window.ff = s => __OTR.advance(s);
window.P = () => __OTR.player;
window.W = () => __OTR.items;
window.steps = (n, c = {}) => __OTR.script(n, () => ({ steer: 0, throttle: 1, brake: 0, hopA: false, hopB: false, ...c }), { draw: true });
window.give = (id, k) => W().give(k || P(), id);
/** press the item button through the real control path (main.js playerCtrl → items.js edge detect) */
window.press = (back = false) => { steps(1, { item: true, brake: back ? 1 : 0 }); steps(1, {}); };
window.use = press;          // events must happen inside a sim step or the views never see them
/** teleport the player gap m behind the race leader (on lat), same speed: a target ahead for rockets */
window.lineUp = (gap = 30, lat = 0, who) => { const L = who || __OTR.race.order.find(o => o !== P()); put(P(), L.s - gap, lat, L.speed); P().lapsDone = L.lapsDone; P().nextCp = L.nextCp; __OTR.chase.snap(P()); steps(1); return L; };
/** let the AI drive the player for n frames (rendering each) */
window.drive = n => { __OTR.race.autoPlayer = true; const e = __OTR.script(n, () => ({}), { draw: true }); __OTR.race.autoPlayer = false; return e; };
/** kart directly ahead of the player in the race order */
window.aheadK = () => __OTR.race.order.find(o => o.place === P().place - 1);
window.behindK = () => __OTR.race.order.find(o => o.place === P().place + 1);
/** pin the camera at a point behind/above the player looking forward (m back, up, look ahead) */
window.camP = (back = 7, up = 3, look = 8, side = 0) => { const k = P(), fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
  __OTR.chase.pin([k.pos.x - fx * back + fz * side, k.pos.y + up, k.pos.z - fz * back - fx * side, k.pos.x + fx * look, k.pos.y + 1, k.pos.z + fz * look]); __OTR.render(); };
/** pin the camera on the road <back> m before an item object (hazard/projectile), looking at it */
window.camObj = (o, back = 8, up = 2.4, side = 0) => { const tr = __OTR.track, pr = tr.project(o, -1, {}), p = tr.pointAt(pr.s - back, pr.lat + side);
  __OTR.chase.pin([p.x, p.y + up, p.z, o.x, o.y + 0.6, o.z]); __OTR.render(); };
/** run fn(race) once INSIDE the next sim step (like a real hit), so its events reach the views */
window.inStep = fn => { let done = false; __OTR.race.addSystem(r => { if (!done) { done = true; fn(r); } }); };
window.unpin = () => { __OTR.chase.pinned = null; };
window.put = (k, s, lat = 0, speed = 0) => { const tr = __OTR.track, p = tr.pointAt(s, lat); k.pos.x = p.x; k.pos.y = p.y; k.pos.z = p.z; k.yaw = p.yaw; k.s = tr.wrapS(s); k.lat = lat; k.si = tr.idx(s); k.speed = speed; };
`;

const S = {
  // ? boxes on the road + a star row, overview from behind the start line
  boxes: { q: 'track=beach&racer=orion&skip=1&hud=0', js: `ff(0.5); __OTR.hold(true); const b = W().boxes, r = b[Math.floor(b.length/2)], f = __OTR.track.frameAt(W().boxes[0].s - 14);
    __OTR.chase.pin([f.x, f.y + 3.2, f.z, W().boxes[0].x, W().boxes[0].y + 1, W().boxes[0].z]); steps(1); 'ok'` },
  stars: { q: 'track=beach&racer=orion&skip=1&hud=0', js: `ff(0.5); __OTR.hold(true); const tr = __OTR.track, row = tr.starRows[1], st = row.points[0], mid = row.points[Math.floor(row.points.length / 2)];
    const p = tr.pointAt(st.s - 9, st.lat - 5); __OTR.chase.pin([p.x, p.y + 3.2, p.z, mid.x, mid.y + 0.9, mid.z]); steps(1); 'ok'` },
  // the player breaks a box → roulette spinning in the HUD
  roulette: { q: 'track=beach&racer=orion&skip=1&t=1', js: `__OTR.hold(true); const b = W().boxes[1]; const k = P(); k.pos.x = b.x; k.pos.z = b.z; steps(1); steps(40); JSON.stringify({ roulT: P().roulT })` },
  press: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); give('rocket'); press(); const r = W().projs.find(p => p.kind === 'rocket'); drive(8); JSON.stringify({ fired: !!r, item: P().item })` },
  got: { q: 'track=beach&racer=orion&skip=1&stars=10&t=1', js: `__OTR.hold(true); give('rocket'); steps(20); JSON.stringify({ item: P().item, n: P().itemCount })` },
  // taco bomb rolling down the road ahead
  bomb: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); give('taco_bomb'); use(); drive(16); camP(6, 2.6, 10); 'ok'` },
  bomb_side: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5&hud=0', js: `__OTR.hold(true); give('taco_bomb'); use(); drive(10); __OTR.hold(true); const b = W().projs.find(p => p.kind === 'taco_bomb'); const f = __OTR.track.frameAt(b.s);
    __OTR.chase.pin([b.x + f.lx * 3.2 + f.tx * 1.2, b.y + 0.9, b.z + f.lz * 3.2 + f.tz * 1.2, b.x, b.y, b.z]); __OTR.render(); 'ok'` },
  explode: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); give('taco_bomb'); use(); drive(22); use(); drive(6); camP(6, 2.8, 10); 'ok'` },
  // a rocket homing onto the racer ahead (reticle over the target)
  rocket: { q: 'track=beach&racer=orion&skip=1&slot=7&t=7', js: `__OTR.hold(true); lineUp(60, -3); give('rocket'); use(); drive(12); camP(5.5, 2.4, 12); const r = W().projs.find(p => p.kind === 'rocket'); JSON.stringify({ target: r?.target?.racerId, lock: r?.target?.lockedBy })` },
  rocket_hit: { q: 'track=beach&racer=orion&skip=1&slot=7&t=7', js: `__OTR.hold(true); lineUp(40, -3); give('rocket'); use(); let hit = 0; for (let i = 0; i < 300 && !hit; i++) { drive(1); if (__OTR.race.events.some(e => e.type === 'item' && e.e === 'explode')) hit = i; } drive(4); unpin(); JSON.stringify({ hitAfter: hit })` },
  // lock-on warning on the player's HUD: the kart behind fires at us
  lockon: { q: 'track=beach&racer=orion&skip=1&slot=0&diff=hard&t=9', js: `__OTR.hold(true); const b = behindK(); W().give(b, 'rocket'); W().use(b); drive(20); JSON.stringify({ lockedBy: P().lockedBy, from: b.racerId })` },
  // TNT: dropped crate on the road behind, then on the player's head with the countdown
  tnt_drop: { q: 'track=beach&racer=orion&skip=1&slot=7&hud=0&t=5', js: `__OTR.hold(true); give('tnt'); use(); drive(40); camObj(W().hazards[0], 7, 2.2, 1.5); 'ok'` },
  tnt_head: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); const a = lineUp(25, 0); W().give(a, 'tnt'); W().use(a); const h = W().hazards[0]; const k = P(); drive(2); k.pos.x = h.x; k.pos.z = h.z; drive(1); drive(50); camP(4.5, 1.6, 2, 2.2); JSON.stringify({ tnt: !!P().tnt, t: P().tnt?.t })` },
  nitro: { q: 'track=beach&racer=orion&skip=1&slot=7&hud=0&t=5', js: `__OTR.hold(true); P().stars = 10; give('tnt'); use(); drive(14); camObj(W().hazards[0], 7, 2.2, 1.5); 'ok'` },
  // ice cream splat on the road
  icecream: { q: 'track=beach&racer=orion&skip=1&slot=7&hud=0&t=5', js: `__OTR.hold(true); lineUp(-70, 0); give('icecream'); use(); drive(30); camObj(W().hazards[0], 8, 2.6, 1); 'ok'` },
  spinout: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); const a = lineUp(25, 0); W().give(a, 'icecream'); W().use(a); const h = W().hazards[0]; drive(2); P().pos.x = h.x; P().pos.z = h.z; drive(1); drive(12); 'ok'` },
  // bubble shield up, then fired
  shield: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); give('shield'); use(); drive(30); camP(4.8, 1.8, 2, 1.8); 'ok'` },
  shield_fire: { q: 'track=beach&racer=orion&skip=1&slot=7&hud=0&t=5', js: `__OTR.hold(true); give('shield'); use(); drive(20); use(); drive(10); camP(6, 2.4, 10); 'ok'` },
  turbo: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); give('turbo'); use(); drive(12); 'ok'` },
  // super star: Sootie's spirit orbits you
  superstar: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); give('superstar'); use(); drive(40); camP(4.2, 1.9, 2, 2.5); 'ok'` },
  superstar_chase: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); give('superstar'); use(); drive(52); 'ok'` },
  // TV remote: everyone else wobbles, banner
  remote: { q: 'track=beach&racer=orion&skip=1&slot=7&t=5', js: `__OTR.hold(true); give('remote'); use(); drive(20); 'ok'` },
  // warp star flying up the course
  warp: { q: 'track=beach&racer=orion&skip=1&slot=7&hud=0&t=5', js: `__OTR.hold(true); lineUp(90, 0); give('warp'); use(); drive(24); const w = W().projs.find(p => p.kind === 'warp'); const tr = __OTR.track, f = tr.frameAt(w.s - 12);
    __OTR.chase.pin([f.x + f.lx * 3, f.y + 3, f.z + f.lz * 3, w.x, w.y, w.z]); steps(1); JSON.stringify({ target: w.target?.racerId })` },
  // spilled stars after a hit
  spill: { q: 'track=beach&racer=orion&skip=1&slot=7&stars=8&hud=0&t=5', js: `__OTR.hold(true); const s0 = P().stars; let r; inStep(() => { r = W().hitKart(P(), 'flip', null, 'rocket'); }); drive(1); const n1 = W().spills.length; drive(30); camP(7, 3.5, 4); JSON.stringify({ s0, hit: r, n1, spills: W().spills.length, stars: P().stars })` },
  // performance: all boxes + stars on the beach, start line, and a wide overview
  perf_start: { q: 'track=beach&racer=orion&skip=1', js: `__OTR.render(); JSON.stringify({ ...__OTR.info(), items: __OTR.itemViews.info() })`, info: true },
  perf_off: { q: 'track=beach&racer=orion&skip=1&items=0', js: `__OTR.render(); JSON.stringify(__OTR.info())`, info: true },
  perf_race: { q: 'track=beach&racer=orion&skip=1&t=25', js: `__OTR.render(); JSON.stringify({ ...__OTR.info(), items: __OTR.itemViews.info() })`, info: true },
};

const names = pick.length ? pick : Object.keys(S);
if (args.includes('--list')) { console.log(Object.keys(S).join('\n')); process.exit(0); }
const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
await fs.mkdir(OUT, { recursive: true });
let code = 0;
for (const name of names) {
  const sc = S[name]; if (!sc) { console.log('unknown scenario', name); continue; }
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + 'index.html?' + sc.q, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__OTR?.ready && window.__OTR?.race, null, { timeout: 60000 });
    await page.evaluate(H);
    const r = await page.evaluate(js => { try { return String((0, eval)(js)); } catch (e) { return 'ERR ' + e.message + ' ' + e.stack?.split('\n')[1]; } }, sc.js);
    await page.waitForTimeout(350);
    const out = path.join(OUT, name + '.png');
    await fs.writeFile(out, await page.screenshot({ animations: 'allow' }));
    console.log(`${name}: ${r}  -> ${out}`);
  } catch (e) { console.error(name, 'failed:', e.message); code = 1; }
  finally {
    if (errs.length) console.log('  ' + errs.slice(0, 6).join('\n  '));
    await page.close().catch(() => {});
  }
}
await browser.close().catch(() => {});
process.exit(code);
