// Branch (shortcut) checks for the gate — tools/check.js runs these on every track with `branches`
// (today only the test fixture, tools/fixtures/branches.js). Everything goes through the REAL track.js /
// physics.js / ai.js / race.js / items.js. See DESIGN.md "Branches (shortcuts)" for the rules.
//   geometry: open spline, ends on the main road on `side` near from/to, widths, slopes, radius, no
//     overlap with the main road / other branches outside the junctions (bridges ≥ 8 m apart), surfaces
//     meet at the junctions, the span doesn't cross the start line, pads/items/stars on the branch road,
//     gaps have lips, needsBoost gaps clear at the boost cap (normal ones at ≤ 14 m/s);
//   time: a solo hard kart's lap is SHORTER taking it (and by how much);
//   races: an 8-AI race forced through it counts every lap, nobody stuck; a two-kart drive-through test
//     (route state, monotonic progress, checkpoints, positions, the lap); rescues on / off a branch.
import { T, DT, createKart, placeKart, stepKart, beginRespawn } from '../src/physics.js';
import { createRace, simulate } from '../src/race.js';
import { createItems } from '../src/items.js';

const f1 = v => v.toFixed(1);
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** ballistic jump over a gap on route R (main or branch): launch at vy from the lip, land below the far road */
export function clearsGap(tr, R, j, v) {
  let x = 0, y = R.Y[R.idx(j.s)], vy = j.vy;
  for (let t = 0; t < 4; t += DT) {
    x += v * DT; vy -= T.GRAV * DT; y += vy * DT;
    const s = j.s + x, k = R.idx(s);
    if (R.closed === false && s > R.length) return { ok: false, air: t, x };
    const inGap = R.FLAG[k] & 1;
    if (!inGap && x > 2 && y <= R.Y[k]) return { ok: true, air: t, x };
    if (inGap && y < (tr.water ? tr.water.y : tr.gapFloor)) return { ok: false, air: t, x };
  }
  return { ok: false };
}

export function runBranchGeometry(tr, ok, warn) {
  const L = tr.length;
  for (const br of tr.branches) {
    const tag = `branch ${br.id}`;
    ok(`${tag}: builds, junction zones at both ends`, !br.junctionError, br.junctionError || `${f1(br.length)} m, entry zone ${f1(br.zoneIn)} m, exit zone ${f1(br.zoneOut)} m`);
    const ends = Math.hypot(br.X[0] - br.X[br.n - 1], br.Z[0] - br.Z[br.n - 1]);
    ok(`${tag}: open spline, 40–600 m`, br.closed === false && br.length >= 40 && br.length <= 600 && ends > 30, `${f1(br.length)} m, ends ${f1(ends)} m apart`);
    for (const [end, j, atv, sd] of [['leaves', 0, br.from, br.side], ['rejoins', br.n - 1, br.to, br.sideTo]]) {
      const q = tr.projectOn(0, { x: br.X[j], y: br.Y[j], z: br.Z[j] }, br.KM[j], {});
      const dAt = atv != null ? Math.abs(tr.dS(tr.sOf(atv), q.s)) : 0;
      const sideOk = !sd || (sd === 'L' ? q.lat > -0.5 : q.lat < 0.5);
      const dh = Math.abs(wrapA(br.HEAD[j] - tr.HEAD[q.i])) * 180 / Math.PI;
      ok(`${tag}: ${end} the main road on its ${sd || '?'} side at ${atv}, heading within 35°`, Math.abs(q.lat) <= q.hw + 1 && sideOk && dAt < 15 && dh < 35,
        `main lat ${f1(q.lat)} (half-width ${f1(q.hw)}), ${f1(dAt)} m from at ${atv}, ${f1(dh)}° off main's heading`);
    }
    {
      let minW = Infinity, maxW = 0, maxSlope = 0, maxK = 0, atK = 0;
      for (let k = 0; k < br.n; k++) {
        minW = Math.min(minW, br.HW[k] * 2); maxW = Math.max(maxW, br.HW[k] * 2);
        if (!(br.FLAG[k] & 1)) maxSlope = Math.max(maxSlope, Math.abs(br.TY[k]));
        if (Math.abs(br.CURV[k]) > maxK) { maxK = Math.abs(br.CURV[k]); atK = k; }
      }
      ok(`${tag}: road width 8–30 m`, minW >= 8 && maxW <= 30, `${f1(minW)}–${f1(maxW)} m`);
      ok(`${tag}: slopes ≤ 35%`, maxSlope <= 0.35, `max ${(maxSlope * 100).toFixed(0)}%`);
      ok(`${tag}: tightest radius ≥ 10 m and ≥ half-width + 3`, 1 / maxK >= 10 && 1 / maxK >= br.HW[atK] + 3, `r=${f1(1 / maxK)} m at u=${f1(atK * br.ds)}`);
    }
    {
      // outside the junction zones the branch must not touch the main road (or another branch) — except
      // tagged bridges with ≥ 8 m between the decks
      const clash = (A, a, B, b) => {
        const d = Math.hypot(A.X[a] - B.X[b], A.Z[a] - B.Z[b]);
        if (d >= A.HW[a] + B.HW[b] + 2) return null;
        const dy = Math.abs(A.Y[a] - B.Y[b]);
        return (A.FLAG[a] & 2) && (B.FLAG[b] & 2) && dy >= 8 ? null : { d, dy };
      };
      let bad = null, corr = null;
      for (let a = br.jIn + 1; a < br.jOut; a += 2) for (let b = 0; b < tr.n; b += 2) {
        const c = clash(br, a, tr, b); if (c && (!bad || c.d < bad.d)) bad = { ...c, u: a * br.ds, s: b * tr.ds };
        const d = Math.hypot(br.X[a] - tr.X[b], br.Z[a] - tr.Z[b]);
        if (d < br.HW[a] + Math.max(br.OFFL[a], br.OFFR[a]) + tr.HW[b] + Math.max(tr.OFFL[b], tr.OFFR[b]) - 1 && Math.abs(br.Y[a] - tr.Y[b]) < 5) corr = { d, u: a * br.ds, s: b * tr.ds };
      }
      ok(`${tag}: no overlap with the main road outside the junctions (bridges ≥ 8 m apart)`, !bad, bad ? `u=${f1(bad.u)} vs main s=${f1(bad.s)}: ${f1(bad.d)} m apart, dy ${f1(bad.dy)}` : '');
      if (corr) warn(`${tag}: its offroad corridor touches the main road's outside the junctions`, `u=${f1(corr.u)} vs s=${f1(corr.s)}, ${f1(corr.d)} m`);
      for (const o of tr.branches) if (o.index > br.index) {
        let bb = null;
        for (let a = 0; a < br.n; a += 2) for (let b = 0; b < o.n; b += 2) { const c = clash(br, a, o, b); if (c && (!bb || c.d < bb.d)) bb = { ...c, u: a * br.ds, v: b * o.ds }; }
        ok(`${tag}: no overlap with branch ${o.id}`, !bb, bb ? `u=${f1(bb.u)} vs ${f1(bb.v)}: ${f1(bb.d)} m` : '');
      }
    }
    {
      // the two surfaces meet: where the branch road lies over the main road, heights agree
      const q = {}; let dyMax = 0, n = 0;
      for (let j = 0; j < br.n; j++) {
        if (!br.JR[j]) continue;
        for (let i = -4; i <= 4; i++) {
          const p = br.pointAt(j * br.ds, br.HW[j] * i / 4); tr.projectOn(0, p, br.JH[j], q);
          if (Math.abs(q.lat) <= q.hw) { dyMax = Math.max(dyMax, Math.abs(p.y - q.y)); n++; }
        }
      }
      ok(`${tag}: surfaces meet at the junctions (Δy ≤ 0.25 m where the roads overlap)`, dyMax <= 0.25, `max Δy ${dyMax.toFixed(3)} m over ${n} points`);
      const seen = new Set(); let gap = 0;
      for (let k = 0; k < tr.n; k++) if (tr.JR[k] === br.route) seen.add(k);
      // every main-road sample that opens its wall onto the branch is within the switch window
      for (let k = 0; k < tr.n; k++) if ((tr.OPENL[k] || tr.OPENR[k]) && tr.JR[k] === br.route && !seen.has(k)) gap++;
      ok(`${tag}: main wall opens onto it at both junctions`, [...seen].some(k => tr.OPENL[k] || tr.OPENR[k]) && gap === 0,
        `${[...seen].filter(k => tr.OPENL[k] || tr.OPENR[k]).length} main samples open, ${seen.size} in the switch window`);
    }
    {
      ok(`${tag}: skips a stretch of the main road that doesn't contain the start line`, br.span > 0 && br.span < L / 2 && !br.crossesStart,
        `main s ${f1(br.sEntry)} → ${f1(br.sExit)} (${f1(br.span)} m)`);
      ok(`${tag}: shorter than the main road it skips`, br.length < br.span, `${f1(br.length)} m vs ${f1(br.span)} m`);
      const inside = tr.checkpoints.filter(c => tr.dS(br.sEntry, c) > 0 && tr.dS(c, br.sExit) > 0);
      ok(`${tag}: checkpoints in its span are credited (u → s is monotonic)`, [...br.MS].every((m, i) => i === 0 || m > br.MS[i - 1]),
        inside.length ? `${inside.length} checkpoint(s) at s=${inside.map(c => c | 0).join(',')} passed via the mapping` : 'no checkpoint inside');
    }
    {
      const onRoad = (s, lat, pad = 0) => { const k = br.idx(s); return Math.abs(lat) + pad <= br.HW[k] && !(br.FLAG[k] & 1); };
      ok(`${tag}: pads, item rows and stars on the branch road`, br.pads.every(p => onRoad(p.s, p.lat, p.w / 2) && onRoad(p.s + p.len, p.lat, p.w / 2))
        && br.itemRows.every(r => r.slots.every(sl => onRoad(r.s, sl.lat, 0.6))) && br.starRows.every(r => r.points.every(p => onRoad(p.s, p.lat, 0.3))),
        `${br.pads.length} pads, ${br.itemRows.length} item rows, ${br.starRows.reduce((a, r) => a + r.points.length, 0)} stars`);
      for (const g of br.gaps) {
        const j = br.jumps.find(j => { const d = g.s0 - j.s; return d >= -1 && d <= 6; });
        ok(`${tag}: gap at u=${f1(g.s0)} has a jump lip right before it`, !!j);
        if (!j) continue;
        const minV = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30].find(v => clearsGap(tr, br, j, v).ok);
        const atBase = clearsGap(tr, br, j, T.BASE_MAX), atCap = clearsGap(tr, br, j, T.BOOST_MAX);
        if (g.needsBoost) {
          ok(`${tag}: needsBoost gap (${f1(g.len)} m) clears at the boost cap ${T.BOOST_MAX} m/s`, atCap.ok, `needs ≥ ${minV} m/s; at ${T.BOOST_MAX} m/s ${f1(atCap.air || 0)} s air, lands +${f1(atCap.x || 0)} m`);
          if (atBase.ok) warn(`${tag}: needsBoost gap also clears at base speed`, `needs only ${minV} m/s — the boost isn't needed`);
          ok(`${tag}: needsBoost gap has a pad within 25 m before the lip`, br.pads.some(p => j.s - (p.s + p.len) >= -1 && j.s - (p.s + p.len) <= 25));
        } else ok(`${tag}: jump at u=${f1(j.s)} clears the ${f1(g.len)} m gap`, minV != null && minV <= 14, `needs ≥ ${minV} m/s`);
      }
    }
  }
}

/** a solo kart's laps, forced to take (`id`) or skip ('-') the branches */
function soloLaps(tr, force, diff = 'hard', seed = 1) {
  const race = createRace({ track: tr, entrants: [{ racerId: 'solo', stats: { speed: 3, accel: 3, turn: 3 } }], playerIndex: -1, difficulty: diff, seed, laps: 3 });
  race.forceBranch = force;
  simulate(race, { maxT: 400 });
  const k = race.karts[0];
  return { laps: k.lapTimes, shortcuts: race.stats[0].shortcuts, respawns: race.stats[0].respawns };
}

export function runBranchRaces(tr, ok, warn, { ENTRANTS, SEED, ITEMS, QUIET }) {
  for (const br of tr.branches) {
    const tag = `branch ${br.id}`;
    // ---- time: is it a real shortcut? (solo kart, no items, laps 2–3; seeds 1–3, hard + medium)
    for (const diff of ['hard', 'medium']) {
      const take = [], skip = [];
      for (const sd of [1, 2, 3]) { const a = soloLaps(tr, br.id, diff, sd), b = soloLaps(tr, '-', diff, sd); take.push(...a.laps.slice(1)); skip.push(...b.laps.slice(1)); }
      const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
      const saved = mean(skip) - mean(take);
      ok(`${tag}: ${diff} solo lap is shorter through it`, take.length === 6 && skip.length === 6 && saved > 0.3,
        `${f1(mean(take))} s vs ${f1(mean(skip))} s round the main road: saves ${saved.toFixed(2)} s (target 1.5–3.5 s)`);
      if (saved > 4) warn(`${tag}: ${diff} saves a lot`, `${saved.toFixed(2)} s a lap — check the balance / rubber band`);
    }
    // ---- an 8-AI race where everyone takes it every lap: laps count, nobody stuck at the junctions
    for (const diff of ['medium']) {
      const race = createRace({ track: tr, entrants: ENTRANTS, playerIndex: -1, difficulty: diff, seed: SEED });
      race.forceBranch = br.id;
      const W = ITEMS ? createItems(race, { seed: SEED }) : null;
      let backstep = 0;
      const prog = race.karts.map(() => -Infinity);
      const routes = race.karts.map(() => new Set());
      simulate(race, { maxT: 60 + (tr.length / 12) * race.laps, onStep: r => { for (const k of r.karts) { routes[k.index].add(k.route); if (k.respawnT > 0) prog[k.index] = -Infinity; else if (r.phase === 'race' && !k.finished) { if (k.progress < prog[k.index] - 3) backstep++; prog[k.index] = k.progress; } } } });
      const res = race.results(), fin = res.filter(r => r.finished && !r.estimated).length;
      const sc = race.stats.map(s => s.shortcuts), maxStuck = Math.max(...race.stats.map(s => s.maxStuck)), resp = race.stats.reduce((a, s) => a + s.respawns, 0);
      const lapsOK = race.karts.every(k => k.lapTimes.length === race.laps);
      if (!QUIET) console.log(`     ${tag} forced (${diff}): shortcuts per kart ${sc.join(' ')}, respawns ${resp}, ${W ? `item boxes ${W.stats.boxes}` : 'no items'}`);
      ok(`${tag}: ${diff} race, everyone forced through it: all 8 finish, every lap counted`, fin === 8 && lapsOK, `${fin}/8 finished, laps ${race.karts.map(k => k.lapTimes.length).join('')}`);
      ok(`${tag}: …everyone took it (≥ 2 of 3 laps each) and came back onto the main road`, sc.every(n => n >= race.laps - 1) && routes.every(s => s.has(0) && s.has(br.route)), `${sc.reduce((a, b) => a + b, 0)} / ${8 * race.laps}`);
      ok(`${tag}: …nobody stuck > 3 s at the junctions`, maxStuck <= 3, `max ${f1(maxStuck)} s`);
      ok(`${tag}: …progress never jumps backwards (except rescues)`, backstep === 0, `${backstep} backward steps`);
    }
    // ---- 8-AI races where nobody may take it: a brain that said no must not drift onto it at the mouth
    //      (a slide past the main road's edge, a bump) and then commit to the shortcut
    {
      let sc = 0, fin = 0;
      for (const sd of [1, 2, 3]) {
        const race = createRace({ track: tr, entrants: ENTRANTS, playerIndex: -1, difficulty: 'medium', seed: sd });
        race.forceBranch = '-';
        if (ITEMS) createItems(race, { seed: sd });
        simulate(race, { maxT: 60 + (tr.length / 12) * race.laps });
        sc += race.stats.reduce((a, s) => a + s.shortcuts, 0); fin += race.results().filter(r => r.finished && !r.estimated).length;
      }
      ok(`${tag}: medium races (seeds 1–3), every brain told never to take it: nobody does, all finish`, sc === 0 && fin === 24, `${sc} shortcut(s), ${fin}/24 finished`);
    }
    // ---- the drive-through test: two identical karts from the same spot, one through the branch, one round
    {
      const race = createRace({ track: tr, entrants: [{ racerId: 'A', stats: { speed: 3, accel: 3, turn: 3 } }, { racerId: 'B', stats: { speed: 3, accel: 3, turn: 3 } }], playerIndex: -1, difficulty: 'hard', seed: 3 });
      race.phase = 'race'; race.t = 0;
      const [A, B] = race.karts;
      race.brains[0].forceBranch = br.id; race.brains[1].forceBranch = '-';
      const s0 = br.sEntry - 80, cps = tr.checkpoints;
      const nextAfter = s => { let i = cps.findIndex(c => c > tr.wrapS(s)); return i < 0 ? cps.length : i; };
      for (const [k, lat] of [[A, 2.5], [B, -2.5]]) {
        const p = tr.pointAt(s0, lat);
        k.pos.x = p.x; k.pos.y = p.y; k.pos.z = p.z; k.yaw = p.yaw; k.speed = 18; k.s = tr.wrapS(s0); k.si = tr.idx(s0); k.lat = lat; k.route = 0; k.rs = k.s;
        k.frozen = false; k.lastGoodS = k.s; k.nextCp = nextAfter(s0); k._prevS = k.s; k.lapsDone = 0;
      }
      const seq = [], jumps = [0, 0];
      let lastP = [null, null], tA = null, tB = null, cpA = A.nextCp, placeAt = null;
      // 40 s, or longer when the line is far from the entry (Star Road: 1086 m from s0 to the line)
      for (let i = 0; i < 60 * Math.max(40, (tr.length - tr.dS(0, s0) + 80) / 14); i++) {
        race.step();
        if (seq[seq.length - 1] !== A.route) seq.push(A.route);
        for (const [n, k] of [[0, A], [1, B]]) { if (lastP[n] != null && (k.progress - lastP[n] > 3 || k.progress - lastP[n] < -0.5) && k.respawnT <= 0) jumps[n]++; lastP[n] = k.progress; }
        const past = k => tr.dS(br.sExit + 25, k.s) > 0 && tr.dS(br.sExit + 25, k.s) < 200;
        if (tA == null && past(A)) tA = race.t; if (tB == null && past(B)) tB = race.t;
        if (tA != null && tB != null && placeAt == null) placeAt = { a: A.place, b: B.place, pa: A.progress, pb: B.progress };
        if (tA != null && tB != null && A.lapsDone >= 1 && B.lapsDone >= 1) break;
      }
      ok(`${tag}: drive-through: route main → branch → main`, seq.join('') === `0${br.route}0`, `route sequence ${seq.join('→')}`);
      ok(`${tag}: drive-through: progress continuous through both junctions (no jumps)`, jumps[0] === 0 && jumps[1] === 0, `jumps A ${jumps[0]}, B ${jumps[1]}`);
      ok(`${tag}: drive-through: the branch kart is ahead after the exit (place + progress)`, placeAt && placeAt.a < placeAt.b && placeAt.pa > placeAt.pb && tA < tB,
        placeAt ? `A ${f1(tA)} s / place ${placeAt.a}, B ${f1(tB)} s / place ${placeAt.b}: ${f1(tB - tA)} s and ${f1(placeAt.pa - placeAt.pb)} m ahead` : 'never got there');
      ok(`${tag}: drive-through: checkpoints in the span credited, the lap counts at the line`, A.lapsDone >= 1 && B.lapsDone >= 1 && cpA < cps.length,
        `A laps ${A.lapsDone} (checkpoints from #${cpA}), B laps ${B.lapsDone}`);
    }
    // ---- the main road's shoulder past both mouths (forwards, then backwards): brushing a mouth is not a
    //      shortcut (no 'shortcut' event → no SHORTCUT! callout / minimap discovery), and nobody gets stuck
    {
      const q = {}, lat = (br.side === 'R' ? -1 : 1) * (tr.HW[tr.idx(br.sEntry + 20)] + 1.5);
      // …but never off the drivable shoulder where it's narrower, and on the road's edge beside a fall (Star Road:
      // 1.3–1.5 m of cloud, then space — this test's simple steering would drive off it)
      const latAt = s => {
        const k = tr.idx(s), R = br.side === 'R', off = R ? tr.OFFR[k] : tr.OFFL[k], fall = (R ? tr.props[k].wallR : tr.props[k].wallL) === 'fall';
        return Math.sign(lat) * Math.min(Math.abs(lat), fall ? tr.HW[k] - 0.5 : tr.HW[k] + off - 0.8);
      };
      let sc = 0, stuck = 0, maxStuck = 0, resp = 0;
      for (const back of [false, true]) {
        const k = createKart({ racerId: 'sh' }); placeKart(k, tr.grid[0], tr); k.frozen = false;
        const s0 = back ? br.sExit + 30 : br.sEntry - 30, s1 = back ? br.sEntry - 30 : br.sExit + 30, p = tr.pointAt(s0, latAt(s0));
        k.pos.x = p.x; k.pos.y = p.y + 0.05; k.pos.z = p.z; k.yaw = p.yaw; k.speed = back ? -8 : 16;   // backwards = REVERSING (facing forward), as the steering below assumes
        k.s = tr.wrapS(s0); k.si = tr.idx(s0); k.lat = latAt(s0); k.lastGoodS = k.s;
        for (let i = 0; i < 60 * 40; i++) {
          tr.projectOn(0, k.pos, -1, q);
          if (back ? tr.dS(s1, q.s) < 0 : tr.dS(s1, q.s) > 0) break;
          const tp = tr.pointAt(q.s + (back ? -9 : 9), latAt(q.s + (back ? -9 : 9))), want = Math.atan2(tp.x - k.pos.x, tp.z - k.pos.z);
          const st = Math.max(-1, Math.min(1, wrapA(want - k.yaw - (back ? Math.PI : 0)) * 2.5)) * (back ? -1 : 1);
          k.ev.length = 0; stepKart(k, { steer: st, throttle: back ? 0 : 1, brake: back ? 1 : 0, hopA: false, hopB: false }, tr);
          for (const e of k.ev) { const n = Array.isArray(e) ? e[0] : e; if (n === 'shortcut') sc++; if (n === 'respawn') resp++; }
          if (Math.abs(k.speed) < 2 && k.respawnT <= 0) { stuck += DT; maxStuck = Math.max(maxStuck, stuck); } else stuck = 0;
        }
      }
      ok(`${tag}: driving the main road's shoulder past both mouths (both ways) is not a shortcut`, sc === 0 && maxStuck < 1 && resp === 0, `lat ${f1(lat)}: ${sc} shortcut event(s), max stuck ${f1(maxStuck)} s, respawns ${resp}`);
    }
    // ---- rescues: in the needsBoost pool → the main road before the entry; a fall on the branch → back on the branch
    {
      const g = br.gaps.find(g => g.needsBoost);
      if (g) {
        const k = createKart({ racerId: 'r' }); placeKart(k, tr.grid[0], tr); k.frozen = false;
        const u = g.s0 + g.len / 2, p = br.pointAt(u, 0);
        k.pos.x = p.x; k.pos.y = br.Y[br.idx(g.s0 - 2)] + 0.2; k.pos.z = p.z; k.yaw = p.yaw; k.speed = 4; k.air = true; k.vy = 0;
        k.si = br.off + br.idx(u); k.route = br.route; k.rs = u; k.lastGoodS = tr.csOf(br.route, g.s0 - 50);
        let tFall = null, tBack = null;
        for (let i = 0; i < 600 && tBack == null; i++) {
          k.ev.length = 0; stepKart(k, { steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false }, tr);
          if (tFall == null && k.respawnT > 0) tFall = i * DT;
          if (tFall != null && k.respawnT <= 0) tBack = i * DT;
        }
        const d = tr.dS(k.s, br.sEntry);
        ok(`${tag}: falling into the needsBoost pool → back on the main road just before the entry, within 1.5 s`, tBack != null && k.route === 0 && d > 0 && d < 60 && tBack - tFall <= 1.5,
          tBack != null ? `route ${k.route}, ${f1(d)} m before the entry, rescue ${(tBack - tFall).toFixed(2)} s` : 'never rescued');
      }
      const k = createKart({ racerId: 'r2' }); placeKart(k, tr.grid[0], tr); k.frozen = false;
      const g2 = br.gaps[br.gaps.length - 1], u = g2 ? Math.min(g2.s0 + g2.len + 15, br.length * 0.7) : br.length * 0.5, p = br.pointAt(u, 0);
      k.pos.x = p.x; k.pos.y = p.y; k.pos.z = p.z; k.yaw = p.yaw; k.si = br.off + br.idx(u); k.route = br.route; k.rs = u; k.s = br.mainS(u);
      k.lastGoodS = tr.csOf(br.route, u);
      beginRespawn(k, 'fall', tr);
      for (let i = 0; i < 120 && k.respawnT > 0; i++) stepKart(k, { steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false }, tr);
      ok(`${tag}: a rescue on the branch drops you back on the branch`, k.route === br.route && k.rs < u && u - k.rs < 12, `route ${k.route}, u ${f1(k.rs)} (fell at ${f1(u)})`);
    }
  }
}
