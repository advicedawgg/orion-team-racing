// node tools/check.js [trackId] [--seed N] [--diff easy|medium|hard] [--quiet]
//
// THE GATE. Imports the REAL track.js / physics.js / ai.js / race.js — nothing here models the
// game separately. For every registered track:
//   1. geometry: closed + sane length, widths, no self-overlap (except tagged bridges), smooth
//      heights, pads / item rows / star rows on the road, checkpoints ordered, grid on the road,
//      every jump clearable at the speed you can reach there.
//   2. a headless 8-AI race per difficulty through the real sim: everyone finishes 3 laps inside
//      a time limit, nobody is stuck > 3 s, lap times are sane, the AI actually power-slides and
//      fires turbos.
// Prints PASS/FAIL per check and a final PASS/FAIL line; exit code 1 on any FAIL.

import { TRACKS } from '../src/tracks/index.js';
import { buildTrack } from '../src/track.js';
import { T, DT } from '../src/physics.js';
import { createRace, simulate } from '../src/race.js';
import { createBrain, drive, DIFFICULTY } from '../src/ai.js';
import { createItems } from '../src/items.js';
import { runItemChecks } from './check-items.js';

const args = process.argv.slice(2);
const only = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const argv = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
const SEED = +argv('seed', 1);
const DIFFS = argv('diff', 'easy,medium,hard').split(',');
const QUIET = args.includes('--quiet');
const ITEMS = !args.includes('--noitems');       // items agent: races run WITH items unless --noitems

// A spread of stats (1..5, sum 9) so the gate covers the fastest and slowest karts.
const ENTRANTS = [
  { racerId: 'a', stats: { speed: 5, accel: 2, turn: 2 } }, { racerId: 'b', stats: { speed: 1, accel: 4, turn: 4 } },
  { racerId: 'c', stats: { speed: 3, accel: 3, turn: 3 } }, { racerId: 'd', stats: { speed: 2, accel: 5, turn: 2 } },
  { racerId: 'e', stats: { speed: 2, accel: 2, turn: 5 } }, { racerId: 'f', stats: { speed: 4, accel: 3, turn: 2 } },
  { racerId: 'g', stats: { speed: 3, accel: 4, turn: 2 } }, { racerId: 'h', stats: { speed: 4, accel: 1, turn: 4 } },
];

let fails = 0, warns = 0;
const ok = (name, pass, info = '') => { if (!pass || !QUIET) console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!pass) fails++; };
const warn = (name, info) => { console.log(`  WARN  ${name}  — ${info}`); warns++; };
const f1 = v => v.toFixed(1);

for (const def of TRACKS) {
  if (only && def.id !== only) continue;
  console.log(`\n== ${def.id} (${def.name})`);
  let tr;
  try { tr = buildTrack(def); } catch (e) { ok('builds', false, e.message); continue; }
  const L = tr.length, n = tr.n;

  // ------------------------------------------------------------ geometry
  ok('lap length 600–2000 m', L > 600 && L < 2000, `${f1(L)} m`);
  {
    const j = Math.hypot(tr.X[0] - tr.X[n - 1], tr.Z[0] - tr.Z[n - 1]);
    ok('closed loop (sample spacing continuous)', j < tr.ds * 2.5, `seam gap ${j.toFixed(2)} m`);
  }
  {
    let minW = Infinity, maxW = 0; for (let k = 0; k < n; k++) { minW = Math.min(minW, tr.HW[k] * 2); maxW = Math.max(maxW, tr.HW[k] * 2); }
    ok('road width 9–30 m', minW >= 9 && maxW <= 30, `${f1(minW)}–${f1(maxW)} m`);
  }
  {
    // self-overlap: two stretches far apart along s whose road+offroad corridors touch at the same height
    let worst = null;
    for (let a = 0; a < n; a += 2) for (let b = a + 2; b < n; b += 2) {
      const along = Math.min(b - a, n - (b - a)) * tr.ds;
      if (along < 60) continue;
      const dx = tr.X[a] - tr.X[b], dz = tr.Z[a] - tr.Z[b];
      const need = tr.HW[a] + tr.HW[b] + 2;
      const d = Math.hypot(dx, dz);
      if (d < need) {
        const dy = Math.abs(tr.Y[a] - tr.Y[b]);
        const bridged = (tr.FLAG[a] & 2) && (tr.FLAG[b] & 2) && dy >= 5;
        if (!bridged && (!worst || d < worst.d)) worst = { d, a: a * tr.ds, b: b * tr.ds, dy };
      }
    }
    ok('no self-overlap (except tagged bridges ≥5 m apart)', !worst, worst ? `s=${f1(worst.a)} vs s=${f1(worst.b)} only ${f1(worst.d)} m apart, dy ${f1(worst.dy)}` : '');
  }
  {
    // corridors (incl. offroad) of distant stretches: a boundary must not be crossable into another stretch
    let bad = null;
    for (let a = 0; a < n; a += 3) for (let b = a + 3; b < n; b += 3) {
      const along = Math.min(b - a, n - (b - a)) * tr.ds;
      if (along < 80) continue;
      const d = Math.hypot(tr.X[a] - tr.X[b], tr.Z[a] - tr.Z[b]);
      const ca = tr.HW[a] + Math.max(tr.OFFL[a], tr.OFFR[a]), cb = tr.HW[b] + Math.max(tr.OFFL[b], tr.OFFR[b]);
      if (d < ca + cb - 1 && Math.abs(tr.Y[a] - tr.Y[b]) < 5 && !((tr.FLAG[a] & 2) && (tr.FLAG[b] & 2))) { if (!bad || d < bad.d) bad = { d, a: a * tr.ds, b: b * tr.ds }; }
    }
    if (bad) warn('offroad corridors overlap', `s=${f1(bad.a)} and s=${f1(bad.b)} are ${f1(bad.d)} m apart — a kart may shortcut through the sand (check the boundary)`);
  }
  {
    let maxSlope = 0, at = 0; for (let k = 0; k < n; k++) if (!(tr.FLAG[k] & 1) && Math.abs(tr.TY[k]) > maxSlope) { maxSlope = Math.abs(tr.TY[k]); at = k; }
    ok('slopes ≤ 35%', maxSlope <= 0.35, `max ${(maxSlope * 100).toFixed(0)}% at s=${f1(at * tr.ds)}`);
    let maxK = 0, atK = 0; for (let k = 0; k < n; k++) if (Math.abs(tr.CURV[k]) > maxK) { maxK = Math.abs(tr.CURV[k]); atK = k; }
    ok('tightest radius ≥ 10 m and ≥ half-width + 3', 1 / maxK >= 10 && 1 / maxK >= tr.HW[atK] + 3, `r=${f1(1 / maxK)} m at s=${f1(atK * tr.ds)}`);
    // tunnels: the chase camera sits ~6 m behind the kart — a tight bend would put it through the tunnel wall
    let tK = 0, tAt = -1; for (let k = 0; k < n; k++) if ((tr.FLAG[k] & 8) && Math.abs(tr.CURV[k]) > tK) { tK = Math.abs(tr.CURV[k]); tAt = k; }
    if (tAt >= 0) ok('tunnels curve gently (r ≥ 60 m, camera stays inside)', 1 / tK >= 60, `r=${f1(1 / tK)} m at s=${f1(tAt * tr.ds)}`);
  }
  {
    const cps = tr.checkpoints;
    const ordered = cps.every((c, i) => c > 0 && c < L && (i === 0 || c > cps[i - 1]));
    ok('checkpoints ordered, inside (0, L)', ordered && cps.length >= 3, `${cps.length} at ${cps.map(c => c | 0).join(',')}`);
    const gapHit = cps.some(c => tr.FLAG[tr.idx(c)] & 1);
    ok('no checkpoint inside a gap', !gapHit);
  }
  {
    const onRoad = (s, lat, pad = 0) => { const k = tr.idx(s); return Math.abs(lat) + pad <= tr.HW[k] && !(tr.FLAG[k] & 1); };
    const padBad = tr.pads.filter(p => !onRoad(p.s, p.lat, p.w / 2) || !onRoad(p.s + p.len, p.lat, p.w / 2));
    ok('turbo pads on the road', !padBad.length, `${tr.pads.length} pads${padBad.length ? ', bad at s=' + padBad.map(p => p.s | 0) : ''}`);
    const itemBad = tr.itemRows.filter(r => r.slots.some(sl => !onRoad(r.s, sl.lat, 0.6)));
    ok('item box rows on the road', !itemBad.length, `${tr.itemRows.length} rows`);
    const starBad = tr.starRows.filter(r => r.points.some(p => !onRoad(p.s, p.lat, 0.3)));
    ok('star rows on the road', !starBad.length, `${tr.starRows.reduce((a, r) => a + r.points.length, 0)} stars in ${tr.starRows.length} rows`);
    const gridBad = tr.grid.filter(g => !onRoad(g.s, g.lat, 0.8));
    ok('8 grid slots on the road', tr.grid.length === 8 && !gridBad.length);
  }
  {
    // every gap must be preceded by a jump lip, and the jump must clear it at a speed you can reach
    for (const g of tr.gaps) {
      const j = tr.jumps.find(j => { const d = tr.dS(j.s, g.s0); return d >= -1 && d <= 6; });
      ok(`gap at s=${f1(g.s0)} has a jump lip right before it`, !!j);
      if (!j) continue;
      // ballistic: launch at vy from the lip height, land when below the far-side road
      const clear = v => {
        let x = 0, y = tr.Y[tr.idx(j.s)], vy = j.vy;
        for (let t = 0; t < 4; t += DT) {
          x += v * DT; vy -= T.GRAV * DT; y += vy * DT;
          const s = j.s + x, k = tr.idx(s);
          const inGap = tr.FLAG[k] & 1;
          if (!inGap && x > 2 && y <= tr.Y[k]) return { ok: true, air: t, x };
          if (inGap && y < (tr.water ? tr.water.y : tr.gapFloor)) return { ok: false, air: t, x };
        }
        return { ok: false };
      };
      const minV = [8, 10, 12, 14, 16, 18, 20, 22].find(v => clear(v).ok);
      const at22 = clear(T.BASE_MAX);
      ok(`jump at s=${f1(j.s)} clears the ${f1(g.len)} m gap`, minV != null && minV <= 14, `needs ≥ ${minV} m/s; at ${T.BASE_MAX} m/s: ${f1(at22.air || 0)} s air, lands +${f1(at22.x || 0)} m`);
    }
  }

  // ------------------------------------------------------------ headless 8-AI races
  for (const diff of DIFFS) {
    const race = createRace({ track: tr, entrants: ENTRANTS, playerIndex: -1, difficulty: diff, seed: SEED });
    const W = ITEMS ? createItems(race, { seed: SEED }) : null;
    const t0 = Date.now();
    const limit = 60 + (L / 12) * race.laps;          // generous: an average of 12 m/s
    simulate(race, { maxT: limit });
    const ms = Date.now() - t0;
    const res = race.results();
    const finished = res.filter(r => r.finished && !r.estimated).length;
    const maxStuck = Math.max(...race.stats.map(s => s.maxStuck));
    const allLaps = race.karts.flatMap(k => k.lapTimes.slice(1));   // lap 1 includes the standing start
    const minLap = Math.min(...allLaps), maxLap = Math.max(...allLaps);
    const turbos = race.stats.reduce((a, s) => a + s.turbos, 0);
    const respawns = race.stats.reduce((a, s) => a + s.respawns, 0);
    console.log(`  -- ${diff}: ${f1(race.t)} s sim in ${ms} ms`);
    if (!QUIET) for (const r of res) {
      const st = race.stats[r.kart.index];
      console.log(`     ${r.place}. ${r.racerId} ${r.kart.stats.speed}${r.kart.stats.accel}${r.kart.stats.turn}  ${r.finished && !r.estimated ? f1(r.time) + ' s' : 'DNF'}  laps ${r.lapTimes.map(f1).join(' / ')}  stuck ${f1(st.maxStuck)} s  walls ${st.walls}  turbos ${st.turbos} fizz ${st.fizzles} oh ${st.overheats}  pads ${st.pads}  jumps ${st.jumps}  respawns ${st.respawns}`);
    }
    if (W) {
      const S = W.stats, sum = o => Object.values(o).reduce((a, b) => a + b, 0), fmt = o => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ');
      console.log(`     items: boxes ${S.boxes}, used ${sum(S.used)} (${fmt(S.used)}), hits ${sum(S.hits)} (${fmt(S.hits)}), blocked ${S.blocked}, stars ${S.stars}, spilled ${S.spilled}, TNT on/shaken/boom ${S.tntOn}/${S.tntShaken}/${S.tntBoom}, rockets ${S.rocketHits}/${S.rocketsFired}`);
      ok(`${diff}: items get picked up, used and land hits`, S.boxes > 15 && sum(S.used) > 10 && sum(S.hits) > 5, `${S.boxes} boxes, ${sum(S.used)} used, ${sum(S.hits)} hits`);
    }
    ok(`${diff}: all 8 finish ${race.laps} laps in < ${limit | 0} s`, finished === 8, `${finished}/8`);
    ok(`${diff}: nobody stuck > 3 s`, maxStuck <= 3, `max ${f1(maxStuck)} s`);
    // a lap flat out on base speed — with items on, the leader holds 10 stars (Super: +STAR_BONUS top
    // speed) from lap 2, which alone made legit fast tracks (Star Road) trip the 0.8 floor (tracks agent)
    const expect = L / (T.BASE_MAX * (ITEMS ? 1 + T.STAR_BONUS : 1));
    ok(`${diff}: lap times sane (${f1(expect * 0.8)}–${f1(expect * 1.9)} s)`, minLap > expect * 0.8 && maxLap < expect * 1.9, `${f1(minLap)}–${f1(maxLap)} s`);
    ok(`${diff}: AI power-slides and fires turbos`, turbos > (diff === 'easy' ? 8 : 30), `${turbos} turbos`);
    ok(`${diff}: respawns rare (< 1 per kart per race)`, respawns < 8, `${respawns}`);
    const walls = race.stats.reduce((a, s) => a + s.walls, 0);
    if (walls / 8 > 6 * race.laps) warn(`${diff}: lots of wall contact`, `${f1(walls / 8)} per kart`);
    // a spread that says "a race", not a procession or a scatter
    const times = res.filter(r => r.finished).map(r => r.time);
    if (times.length > 1) ok(`${diff}: field finishes within 35 s of the winner`, times[times.length - 1] - times[0] < 35, `spread ${f1(times[times.length - 1] - times[0])} s`);
  }

  // ------------------------------------------------------------ kid bot: is Easy beatable, is Hard a challenge?
  // A "kid" = full-pace kart that never power-slides, takes a sloppy line and wobbles. On Easy it
  // should reach the podium; on Hard it should NOT win (the AI isn't brain-dead).
  const kidRace = diff => {
    const race = createRace({ track: tr, entrants: ENTRANTS, playerIndex: 6, difficulty: diff, seed: SEED });
    const kid = createBrain(race.player, tr, 'easy', SEED + 99);
    kid.cfg = { ...DIFFICULTY.easy, slide: 0, turbo: 0, line: 0.4, wobble: 4 };
    let hitsOnKid = 0;
    if (ITEMS) createItems(race, { seed: SEED });
    simulate(race, { maxT: 600, playerCtrl: r => drive(kid, r), onStep: r => { for (const e of r.events) if (e.type === 'item' && e.e === 'hit' && e.kart === r.player && e.by && e.by !== r.player) hitsOnKid++; } });
    return { p: race.player.finishPlace ?? race.player.place, hitsOnKid };
  };
  if (DIFFS.includes('easy')) { const { p, hitsOnKid } = kidRace('easy'); ok('easy: a no-slide kid bot reaches the podium (Easy is beatable)', p <= 3, `kid finished ${p}${ITEMS ? `, AI item hits on the kid: ${hitsOnKid}` : ''}`); }
  if (DIFFS.includes('hard')) { const { p, hitsOnKid } = kidRace('hard'); ok('hard: the same kid bot does not win (Hard is a challenge)', p > 1, `kid finished ${p}${ITEMS ? `, AI item hits on the kid: ${hitsOnKid}` : ''}`); }
  if (ITEMS) runItemChecks(tr, ok);
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failing check(s), ${warns} warning(s)`);
if (fails) process.exitCode = 1;
