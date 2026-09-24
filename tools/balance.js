// node tools/balance.js [--n 24] [--tracks beach,star] [--diff easy,medium,hard] [--noitems]
//                       [--kid] [--wobbly] [--only-kid] [--regress] [--flat] [--set PATH=JSON …]
//                       [--workers 3] [--seed0 1] [--json out.json]
//
// BALANCE TABLE (gameplay balance agent). Runs N seeded headless 8-AI races per track per difficulty
// through the REAL race/physics/ai/items modules, with the real roster (stats parsed from racers.js,
// which imports THREE and can't be loaded in node), all AI on the same difficulty. The grid is a seeded
// shuffle per block of 8 races rotated one slot per race, so with N a multiple of 8 every racer starts
// from every slot equally often. Prints per difficulty:
//   - win share + mean place per racer (per track and ALL),
//   - race spread: finish gap 1st→8th (mean/p90) and 1st→4th (s),
//   - star economy: share of race time the current LEADER is Super (10 stars), Super time of the karts
//     finishing 1st/4th/8th, stars of the winner, and boxes/stars/item hits per kart,
//   - turbos and wall hits per kart (AI sanity).
// --kid      also races tools/kidbots.js kidBot (never slides, sloppy line) in grid slot 6 with the real
//            assists of each difficulty: place histogram, win margin / loss gap, AI within 5 s of it.
// --wobbly   the wobbly kid (late, noisy, yanking, hop-mashing) on Easy: same table + falls per race.
// --only-kid skip the AI-only field races.
// --regress  every kart gets random stats 1..5 → least-squares race time per stat point (parity = equal).
// --flat     every racer 3/3/3 (control: what the grid + items alone do).
// --set      tuning experiment, e.g. --set T.STAR_BONUS=0.03 --set 'DIFFICULTY.easy.band=[0.9,1.1]'
//            (roots: T physics, IT/AI_ITEM items, DIFFICULTY/ASSIST ai).
// Target (DESIGN.md "Balance"): each racer's win share ~8–18 % on Medium. N=48 per track still has ±5 %
// binomial noise per cell (±2 % on ALL): judge the ALL column and mean place, re-run noisy cells.
// Races run in worker threads (default 3 — the hub has 4 cores and other agents). ~0.4 s per race per core.

import { isMainThread, Worker, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);

/** Roster stats straight from src/racers.js (one line per racer: id … stats: {…}). */
function roster() {
  const src = readFileSync(new URL('src/racers.js', ROOT), 'utf8');
  const out = [];
  for (const m of src.matchAll(/id:\s*'(\w+)'.*?stats:\s*\{\s*speed:\s*(\d)\s*,\s*accel:\s*(\d)\s*,\s*turn:\s*(\d)\s*\}/g))
    out.push({ racerId: m[1], stats: { speed: +m[2], accel: +m[3], turn: +m[4] } });
  if (out.length !== 8) throw new Error(`racers.js roster parse found ${out.length} racers`);
  return out;
}

/** Integer hash (splitmix32-ish): nearby seeds → unrelated xorshift streams. */
const mix = x => { x = (x + 0x9e3779b9) | 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };

/* ============================================================================ worker */
async function workerMain() {
  const { TRACKS } = await import('../src/tracks/index.js');
  const { buildTrack } = await import('../src/track.js');
  const { createRace, simulate } = await import('../src/race.js');
  const { createItems } = await import('../src/items.js');
  const { DIFFICULTY, ASSIST, rng } = await import('../src/ai.js');
  const { kidBot, wobblyKid } = await import('./kidbots.js');
  const { T } = await import('../src/physics.js');
  const built = {};
  const trackOf = id => built[id] || (built[id] = buildTrack(TRACKS.find(t => t.id === id)));
  const R = workerData.roster;
  // --set PATH=VALUE tuning overrides (experiments): T.* (physics), IT.* / AI_ITEM.* (items), DIFFICULTY.* (ai)
  const { IT, AI_ITEM } = await import('../src/items.js');
  const roots = { T, IT, AI_ITEM, DIFFICULTY, ASSIST };
  for (const [path, val] of workerData.sets) {
    const keys = path.split('.'); let o = roots[keys.shift()];
    while (keys.length > 1) o = o[keys.shift()];
    o[keys[0]] = JSON.parse(val);
  }
  const out = [];
  for (const job of workerData.jobs) {
    const tr = trackOf(job.track);
    // grid: a seeded shuffle per block of 8 races (and per track), rotated one slot per race, so every
    // racer starts from every grid slot equally often when N is a multiple of 8
    const tIdx = TRACKS.findIndex(t => t.id === job.track);
    const r = rng(mix(Math.floor((job.seed - 1) / 8) * 9973 + tIdx * 131 + 5));
    const shuf = R.slice();
    for (let i = shuf.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [shuf[i], shuf[j]] = [shuf[j], shuf[i]]; }
    let order = shuf.map((_, i) => shuf[(i + job.seed) % shuf.length]);
    // --regress: every kart gets independent random stats 1..5 → fit race time per stat point
    if (job.randStats) order = order.map(e => ({ racerId: e.racerId, stats: { speed: 1 + Math.floor(r() * 5), accel: 1 + Math.floor(r() * 5), turn: 1 + Math.floor(r() * 5) } }));
    const kidMode = job.mode === 'kid' || job.mode === 'wobbly';
    const race = createRace({ track: tr, entrants: order, playerIndex: kidMode ? 6 : -1, difficulty: job.diff, seed: job.seed });
    const W = job.noItems ? null : createItems(race, { seed: job.seed });
    let kid = null;
    if (kidMode) {
      kid = (job.mode === 'kid' ? kidBot : wobblyKid)(race.player, tr, job.seed + 99);
    }
    let superLead = 0, raceSteps = 0, falls = 0;
    const superT = new Array(race.karts.length).fill(0);
    const onStep = rc => {
      if (rc.phase !== 'race') return;
      raceSteps++;
      const lead = rc.order[0];
      if (lead && lead.stars >= T.STARS_SUPER) superLead++;
      for (const k of rc.karts) if (k.stars >= T.STARS_SUPER && !k.finished) superT[k.index]++;
      if (kid) for (const e of rc.events) if (e.type === 'kart' && e.kart === rc.player && e.e === 'respawn') falls++;
    };
    const maxT = 60 + (tr.length / 10) * race.laps;
    simulate(race, { maxT, playerCtrl: kid ? rc => kid.drive(rc) : null, onStep });
    const res = race.results();
    const times = res.map(x => x.time);
    out.push({
      track: job.track, diff: job.diff, mode: job.mode, seed: job.seed,
      places: res.map(x => x.racerId),
      rows: (m => res.map(x => [x.time - m, x.kart.stats.speed, x.kart.stats.accel, x.kart.stats.turn]))(times.reduce((a, b) => a + b, 0) / times.length),   // demeaned per race
      spread8: times[times.length - 1] - times[0], spread4: times[3] - times[0],
      dnf: res.filter(x => x.estimated).length,
      superLead: raceSteps ? superLead / raceSteps : 0,
      winnerStars: res[0].kart.stars,
      superByPlace: res.map(x => superT[x.kart.index] / Math.max(1, raceSteps)),
      kidPlace: kid ? race.player.finishPlace : null,
      kidGap: kid ? (race.player.finishPlace === 1 ? times[1] - times[0] : race.player.finishTime - times[0]) : null,   // win margin, or behind the winner
      kidNear: kid ? res.filter(x => x.kart !== race.player && Math.abs(x.time - race.player.finishTime) < 5).length : null, kidFalls: falls, kidDnf: kid ? !!race.player.estimated : null,
      kidRacer: kid ? race.player.racerId : null,
      turbos: race.stats.reduce((a, s) => a + s.turbos, 0) / 8,
      walls: race.stats.reduce((a, s) => a + s.walls, 0) / 8,
      respawns: race.stats.reduce((a, s) => a + s.respawns, 0),
      boxes: W ? W.stats.boxes / 8 : 0, stars: W ? W.stats.stars / 8 : 0, hits: W ? Object.values(W.stats.hits).reduce((a, b) => a + b, 0) / 8 : 0,
    });
  }
  parentPort.postMessage(out);
}

/* ============================================================================ main */
async function main() {
  const args = process.argv.slice(2);
  const argv = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
  const N = +argv('n', 24), seed0 = +argv('seed0', 1), WORKERS = +argv('workers', 3);
  const { TRACKS } = await import('../src/tracks/index.js');
  const tracks = argv('tracks', TRACKS.map(t => t.id).join(',')).split(',');
  const diffs = argv('diff', 'easy,medium,hard').split(',');
  const noItems = args.includes('--noitems');
  const modes = ['field'];
  if (args.includes('--kid')) modes.push('kid');
  if (args.includes('--wobbly')) modes.push('wobbly');
  if (args.includes('--only-kid')) { modes.shift(); if (!modes.length) modes.push('kid'); }   // skip the AI-only field races
  const R = roster();
  const randStats = args.includes('--regress');
  if (args.includes('--flat')) for (const r of R) r.stats = { speed: 3, accel: 3, turn: 3 };   // control: no stat differences
  const sets = [];
  args.forEach((a, i) => { if (a === '--set') { const [p, v] = args[i + 1].split('='); sets.push([p, v]); } });
  const jobs = [];
  for (const mode of modes) for (const diff of diffs) for (const track of tracks) {
    if (mode === 'wobbly' && diff !== 'easy') continue;
    for (let i = 0; i < N; i++) jobs.push({ track, diff, mode, seed: seed0 + i, noItems, randStats });
  }
  const t0 = Date.now();
  const chunks = Array.from({ length: WORKERS }, () => []);
  jobs.forEach((j, i) => chunks[i % WORKERS].push(j));
  const results = (await Promise.all(chunks.filter(c => c.length).map(c => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: c, roster: R, sets } });
    w.once('message', res); w.once('error', rej);
  })))).flat();
  const secs = (Date.now() - t0) / 1000;

  const pct = v => (v * 100).toFixed(0).padStart(3) + '%';
  const f1 = v => v.toFixed(1);
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const p90 = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };
  const ids = R.map(r => r.racerId);
  const statStr = id => { const s = R.find(r => r.racerId === id).stats; return `${s.speed}${s.accel}${s.turn}`; };
  let worst = { share: 0 };
  console.log(`balance: ${jobs.length} races (${N}/track/diff, items ${noItems ? 'OFF' : 'on'}) in ${f1(secs)} s${sets.length ? '  set ' + sets.map(s => s.join('=')).join(' ') : ''}${args.includes('--flat') ? '  FLAT stats' : ''}`);
  for (const diff of diffs) {
    const rs = results.filter(x => x.diff === diff && x.mode === 'field');
    if (!rs.length) continue;
    console.log(`\n== ${diff.toUpperCase()}  (win share % / mean place, shuffled grid)`);
    console.log('  racer        sat  ' + tracks.map(t => t.padEnd(14)).join('') + 'ALL');
    for (const id of ids) {
      let line = `  ${id.padEnd(10)} ${statStr(id)}  `;
      for (const t of [...tracks, null]) {
        const sub = rs.filter(x => !t || x.track === t);
        const wins = sub.filter(x => x.places[0] === id).length / sub.length;
        const mp = mean(sub.map(x => x.places.indexOf(id) + 1));
        line += `${pct(wins)} ${f1(mp)}`.padEnd(14);
        if (t && wins > worst.share) worst = { share: wins, id, track: t, diff };
      }
      console.log(line);
    }
    let l2 = '  gap 1→8 s  (mean/p90) ', l3 = '  gap 1→4 s  (mean)     ', l4 = '  leader Super (time%)   ', l5 = '  winner stars at finish', l6 = '  turbos, walls /kart', l7 = '  Super time% 1st/4th/8th', l8 = '  boxes/stars/hits /kart';
    for (const t of [...tracks, null]) {
      const sub = rs.filter(x => !t || x.track === t);
      l2 += `${f1(mean(sub.map(x => x.spread8)))}/${f1(p90(sub.map(x => x.spread8)))}`.padEnd(14);
      l3 += f1(mean(sub.map(x => x.spread4))).padEnd(14);
      l4 += pct(mean(sub.map(x => x.superLead))).padEnd(14);
      l5 += f1(mean(sub.map(x => x.winnerStars))).padEnd(14);
      l6 += `${f1(mean(sub.map(x => x.turbos)))}/${f1(mean(sub.map(x => x.walls)))}`.padEnd(14);
      l8 += `${f1(mean(sub.map(x => x.boxes)))}/${f1(mean(sub.map(x => x.stars)))}/${f1(mean(sub.map(x => x.hits)))}`.padEnd(14);
      l7 += [0, 3, 7].map(p => (mean(sub.map(x => x.superByPlace[p])) * 100).toFixed(0)).join('/').padEnd(14);
    }
    console.log(`  ${'-'.repeat(12 + 14 * (tracks.length + 1))}\n` + [l2, l3, l4, l7, l5, l6, l8].map(l => l.replace(/^  (.{22}) ?/, (m, a) => '  ' + a.padEnd(23))).join('\n'));
    const dnf = rs.reduce((a, x) => a + x.dnf, 0);
    if (dnf) console.log(`  DNF (estimated) karts: ${dnf}`);
  }
  if (randStats) {
    // least squares: time = c + bs·speed + ba·accel + bt·turn (per diff, per track). Parity = bs ≈ ba ≈ bt.
    const fit = rows => {
      const X = rows.map(r => [1, r[1], r[2], r[3]]), y = rows.map(r => r[0]);
      const A = [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => X.reduce((a, x) => a + x[i] * x[j], 0)));
      const b = [0, 1, 2, 3].map(i => X.reduce((a, x, n) => a + x[i] * y[n], 0));
      for (let i = 0; i < 4; i++) { for (let k = i + 1; k < 4; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; } }
      const x = [0, 0, 0, 0]; for (let i = 3; i >= 0; i--) { let v = b[i]; for (let j = i + 1; j < 4; j++) v -= A[i][j] * x[j]; x[i] = v / A[i][i]; }
      return x;
    };
    console.log('\n== REGRESSION: race time change per stat point (s; negative = faster). Parity = equal columns.');
    for (const diff of diffs) for (const t of [...tracks, null]) {
      const rows = results.filter(x => x.diff === diff && x.mode === 'field' && (!t || x.track === t)).flatMap(x => x.rows);
      if (!rows.length) continue;
      const [, bs, ba, bt] = fit(rows);
      console.log(`  ${diff.padEnd(7)} ${(t || 'ALL').padEnd(8)} speed ${bs.toFixed(2).padStart(6)}  accel ${ba.toFixed(2).padStart(6)}  turn ${bt.toFixed(2).padStart(6)}   (n=${rows.length})`);
    }
  }
  for (const mode of ['kid', 'wobbly']) for (const diff of diffs) {
    const rs = results.filter(x => x.diff === diff && x.mode === mode);
    if (!rs.length) continue;
    console.log(`\n== ${mode === 'kid' ? 'KID BOT (no slides, sloppy line)' : 'WOBBLY KID (steering noise)'} on ${diff.toUpperCase()} — slot 6, real ${diff} assists`);
    for (const t of tracks) {
      const sub = rs.filter(x => x.track === t);
      const pl = sub.map(x => x.kidPlace);
      const hist = [1, 2, 3, 4, 5, 6, 7, 8].map(p => pl.filter(v => v === p).length).join(' ');
      const wins = sub.filter(x => x.kidPlace === 1), loss = sub.filter(x => x.kidPlace > 1);
      console.log(`  ${t.padEnd(8)} win ${pct(wins.length / pl.length)}  podium ${pct(pl.filter(p => p <= 3).length / pl.length)}  mean ${f1(mean(pl))}  [1..8: ${hist}]  win by ${wins.length ? f1(mean(wins.map(x => x.kidGap))) : '-'} s, lose by ${loss.length ? f1(mean(loss.map(x => x.kidGap))) : '-'} s  AI within 5 s ${f1(mean(sub.map(x => x.kidNear)))}  gap1→8 ${f1(mean(sub.map(x => x.spread8)))}  falls/race ${f1(mean(sub.map(x => x.kidFalls)))}  DNF ${sub.filter(x => x.kidDnf).length}`);
    }
  }
  if (worst.id) console.log(`\nmax single-track win share: ${worst.id} ${pct(worst.share)} on ${worst.track} (${worst.diff})`);
  const js = argv('json', null);
  if (js) writeFileSync(js, JSON.stringify(results));
}

if (isMainThread) main(); else workerMain();
