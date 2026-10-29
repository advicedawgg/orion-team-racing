// tools/check-letters.js — the O-T-R letters part of THE GATE (run by tools/check.js for every shipped track).
//
// For each track's `letters` (src/letters.js, DESIGN.md "Track data format" → letters):
//   - exactly three (C, T, R), every one resolves (its branch exists), at least one on the hidden shortcut;
//   - each sits ON a drivable road surface (|lat| ≤ half-width − 1.2 m), not within 8 m of a gap, ≥ 4 m from a
//     `fall` edge, and its token clears any deck above it (stacked roads ≥ 8 m apart);
//   - a scripted solo run collects all three in ONE race: the medium AI drives (forced through the letter's
//     branch), and steers for the next letter's lateral spot over its last ~30 m — through the real kid assist
//     (Easy), and again on Hard without it. No respawn allowed on the way (never in a fall).
//   - info: how far each sits off the AI racing line, and what seeking them costs on that lap.
import { buildTrack } from '../src/track.js';
import { createRace } from '../src/race.js';
import { createBrain, drive } from '../src/ai.js';
import { resolveLetters, attachLetters, LETTER, LETTER_CHARS } from '../src/letters.js';

const f1 = v => v.toFixed(1);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const ONE = [{ racerId: 'c', stats: { speed: 3, accel: 3, turn: 3 } }];

/** one solo run: the AI drives, optionally seeking the letters. → { got, t (s per letter), lapT, respawns, walls } */
export function letterRun(tr, { seek = true, assist = true, diff = 'easy', seed = 1, brainDiff = 'medium', maxT = 260 } = {}) {
  const list = resolveLetters(tr);
  const brId = list.find(e => e.route)?.routeId || '-';
  const race = createRace({ track: tr, entrants: ONE, playerIndex: 0, difficulty: diff, seed, easyBoost: assist, assist, laps: 2 });
  const P = race.player;
  const L = attachLetters(race);
  const brain = createBrain(P, tr, brainDiff, seed);
  brain.forceBranch = brId;
  const plan = brId !== '-' ? tr.branchById(brId).index : -1;
  const tGot = [null, null, null];
  let respawns = 0, walls = 0;
  const ctrl = r => {
    const c = drive(brain, r);
    if (!seek || r.phase !== 'race') return c;
    const route = P.route | 0, rs = route ? P.rs : P.s, v = Math.max(8, P.speed);
    // the next uncollected letter on the path ahead (within 40 m)
    let tgt = null, td = Infinity;
    for (const e of L.list) {
      if (L.got[e.i]) continue;
      let d;
      if (e.route === route) d = route ? e.rs - rs : tr.dS(rs, e.rs);
      else if (!route && e.route) { const br = tr.routes[e.route]; d = tr.dS(rs, br.sEntry) + e.rs; }
      else continue;
      if (d > -1 && d < 40 && d < td) { td = d; tgt = e; }
    }
    if (!tgt) return c;
    let px, pz;
    const la = 6 + v * 0.5;
    if (td < la) { px = tgt.x; pz = tgt.z; }      // close: straight at it
    else {                                         // on the way: the aim point, shifted to the letter's lat
      const q = tr.pathAt(route, rs, la, plan);
      const hw = q.rt.HW[q.rt.idx(q.s)], p = q.rt.pointAt(q.s, clamp(tgt.lat, -(hw - 1), hw - 1));
      px = p.x; pz = p.z;
    }
    const err = wrapA(Math.atan2(px - P.pos.x, pz - P.pos.z) - P.yaw);
    brain.sliding = false;
    return { ...c, hopA: false, hopB: false, steer: clamp(err * 2.6, -1, 1), throttle: Math.abs(err) > 0.9 && v > 12 ? 0.3 : 1, brake: 0 };
  };
  while (race.t < maxT && !P.finished) {
    race.step(ctrl(race));
    for (const e of race.events) {
      if (e.type === 'letter') tGot[e.i] = race.t;
      if (e.type === 'kart' && e.kart === P) { if (e.e === 'respawn') respawns++; else if (e.e === 'wall') walls++; }
    }
    if (L.all && P.lapsDone >= 1) break;
  }
  return { got: L.got.slice(), all: L.all, t: tGot, lapT: P.lapTimes[0] ?? null, respawns, walls };
}

export function runLetterChecks(tr, ok, warn, { SEED = 1, QUIET = false } = {}) {
  const defs = tr.def.letters;
  ok('O-T-R: three letters in the data', Array.isArray(defs) && defs.length === 3, defs ? `${defs.length}` : 'none');
  if (!Array.isArray(defs) || defs.length !== 3) return;
  const list = resolveLetters(tr);
  ok('O-T-R: every letter resolves (its route exists)', list.length === 3, list.map(e => e.routeId ? `${e.ch}@${e.routeId}` : e.ch).join(' '));
  if (list.length !== 3) return;
  ok('O-T-R: at least one on the hidden shortcut', !tr.branches.length || list.some(e => e.route), list.filter(e => e.route).map(e => e.ch).join(''));
  for (const e of list) {
    const rt = e.route ? tr.routes[e.route] : tr, k = rt.idx(e.rs), hw = rt.HW[k];
    const pr = rt.props[k];
    const wallSide = e.lat >= 0 ? pr.wallL : pr.wallR, off = e.lat >= 0 ? rt.OFFL[k] : rt.OFFR[k];
    let gapNear = false;
    for (let d = -8; d <= 8; d += 0.5) { const kk = rt.idx(e.rs + d); if (rt.FLAG[kk] & 1) gapNear = true; }
    const fallM = wallSide === 'fall' ? hw + off - Math.abs(e.lat) : Infinity;
    // anything else directly above the token (another deck): it must clear the token by ≥ 2 m
    let over = Infinity;
    for (const R of tr.routes) for (let j = 0; j < R.n; j += 2) {
      if (R === rt && Math.abs(j - k) < 30) continue;
      const dd = Math.hypot(R.X[j] - e.x, R.Z[j] - e.z);
      if (dd < R.HW[j] + 1 && R.Y[j] > e.y + 0.5) over = Math.min(over, R.Y[j] - e.y);
    }
    const ail = rt.AIL[k];
    ok(`O-T-R: ${e.ch} on the road, not near a gap or a fall edge`, Math.abs(e.lat) <= hw - 1.2 && !gapNear && fallM >= 4 && over >= LETTER.Y + LETTER.H / 2 + 2,
      `${e.routeId || 'main'} s=${f1(e.rs)} lat ${f1(e.lat)} of ±${f1(hw)}${gapNear ? ', GAP within 8 m' : ''}${isFinite(fallM) ? `, ${f1(fallM)} m from a fall edge` : ''}${isFinite(over) ? `, deck ${f1(over)} m above` : ''}; ${f1(Math.abs(e.lat - ail))} m off the AI line`);
    // an item box row or a star right on the token would hide it
    for (const row of e.route ? rt.itemRows : tr.itemRows) if (row.slots.some(sl => Math.hypot(sl.x - e.x, sl.z - e.z) < 3 && Math.abs(sl.y - e.y) < 3)) warn(`O-T-R: ${e.ch} sits on an item box`, `row s=${f1(row.s)}`);
  }
  // one lap WITH the shortcut can collect all three: no main-road letter in the stretch a branch skips
  for (const e of list) if (!e.route) for (const br of tr.branches) {
    const inSkip = tr.dS(br.sEntry, e.s) > -br.zoneIn && tr.dS(e.s, br.sExit) > -br.zoneOut;
    ok(`O-T-R: ${e.ch} isn't in the stretch ${br.id} skips`, !inSkip, `s=${f1(e.s)}, ${br.id} skips ${f1(br.sEntry)}–${f1(br.sExit)}`);
  }
  // spread: no two letters within 40 m of each other
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const A = list[a], B = list[b], d = Math.hypot(A.x - B.x, A.z - B.z) + Math.abs(A.y - B.y);
    if (d < 40) warn('O-T-R: letters close together', `${A.ch}–${B.ch} ${f1(d)} m`);
  }
  // scripted runs: Easy + kid assist, and Hard without it
  const plain = letterRun(tr, { seek: false, seed: SEED, assist: false, diff: 'hard', brainDiff: 'hard' });
  for (const [name, o] of [['easy + kid assist', { assist: true, diff: 'easy', brainDiff: 'medium' }], ['hard', { assist: false, diff: 'hard', brainDiff: 'hard' }]]) {
    const r = letterRun(tr, { seek: true, seed: SEED, ...o });
    ok(`O-T-R: a scripted ${name} run collects all three in one race, no rescue`, r.all && r.respawns === 0,
      `${LETTER_CHARS.map((c, i) => `${c} ${r.t[i] != null ? f1(r.t[i]) + ' s' : 'MISSED'}`).join(', ')}; respawns ${r.respawns}, walls ${r.walls}${name === 'hard' && r.lapT && plain.lapT ? `; lap 1 ${f1(r.lapT)} s vs ${f1(plain.lapT)} s not seeking (same branch)` : ''}`);
    if (r.walls > 4) warn(`O-T-R: the ${name} run bangs walls`, `${r.walls}`);
  }
}

// standalone: node tools/check-letters.js [trackId]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { TRACKS } = await import('../src/tracks/index.js');
  const only = process.argv[2];
  let fails = 0, warns = 0;
  for (const def of TRACKS) {
    if (only && def.id !== only) continue;
    console.log(`\n== ${def.id}`);
    runLetterChecks(buildTrack(def), (n, p, i = '') => { console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); if (!p) fails++; }, (n, i) => { console.log(`  WARN  ${n}  — ${i}`); warns++; });
  }
  console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failing, ${warns} warnings`);
  if (fails) process.exitCode = 1;
}
