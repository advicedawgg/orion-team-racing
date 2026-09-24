// node tools/balance.js [--n 24] [--tracks beach,star] [--diff easy,medium,hard] [--noitems] [--kid] [--wobbly]
//                       [--workers 3] [--seed0 1] [--json out.json]
//
// BALANCE TABLE (gameplay balance agent). Runs N seeded headless 8-AI races per track per difficulty
// through the REAL race/physics/ai/items modules, with the real roster (stats parsed from racers.js,
// which imports THREE and can't be loaded in node) on a SHUFFLED grid every race (so a stat isn't
// credited with the pole), all AI on the same difficulty. Prints per difficulty:
//   - win share + mean place per racer (overall and per track),
//   - race spread: finish gap 1st→8th and 1st→4th (s), mean and p90,
//   - star economy: share of race time the current LEADER is Super (10 stars), mean stars of the winner.
// --kid    also races the gate's kid bot (never slides, sloppy line) in grid slot 6 with the real
//          assists of its difficulty, N races per track, and prints its place distribution.
// --wobbly the "wobbly kid" (random-ish steering noise, Easy assists): finishes? falls/respawns?
// Targets (DESIGN.md "Balance"): each racer's win share 8–18 % (none > 20 %) on Medium, every track.
// Races run in worker threads (default 3 — the hub has 4 cores and other agents).

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

/* ============================================================================ worker */
async function workerMain() {
  const { TRACKS } = await import('../src/tracks/index.js');
  const { buildTrack } = await import('../src/track.js');
  const { createRace, simulate } = await import('../src/race.js');
  const { createItems } = await import('../src/items.js');
  const { createBrain, drive, DIFFICULTY, rng, kidBrain, wobblyBrain } = await import('../src/ai.js');
  const { T } = await import('../src/physics.js');
  const built = {};
  const trackOf = id => built[id] || (built[id] = buildTrack(TRACKS.find(t => t.id === id)));
  const R = workerData.roster;
  // --set PATH=VALUE tuning overrides (experiments): T.* (physics), IT.* / AI_ITEM.* (items), DIFFICULTY.* (ai)
  const { IT, AI_ITEM } = await import('../src/items.js');
  const roots = { T, IT, AI_ITEM, DIFFICULTY };
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
    const r = rng(Math.floor((job.seed - 1) / 8) * 9973 + tIdx * 131 + 5);
    const shuf = R.slice();
    for (let i = shuf.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [shuf[i], shuf[j]] = [shuf[j], shuf[i]]; }
    const order = shuf.map((_, i) => shuf[(i + job.seed) % shuf.length]);
    const kidMode = job.mode === 'kid' || job.mode === 'wobbly';
    const race = createRace({ track: tr, entrants: order, playerIndex: kidMode ? 6 : -1, difficulty: job.diff, seed: job.seed });
    if (!job.noItems) createItems(race, { seed: job.seed });
    let kid = null;
    if (kidMode) {
      kid = job.mode === 'kid'
        ? (kidBrain ? kidBrain(race.player, tr, job.seed + 99) : Object.assign(createBrain(race.player, tr, 'easy', job.seed + 99), { cfg: { ...DIFFICULTY.easy, slide: 0, turbo: 0, line: 0.4, wobble: 4 } }))
        : wobblyBrain(race.player, tr, job.seed + 99);
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
    simulate(race, { maxT, playerCtrl: kid ? rc => drive(kid, rc) : null, onStep });
    const res = race.results();
    const times = res.map(x => x.time);
    out.push({
      track: job.track, diff: job.diff, mode: job.mode, seed: job.seed,
      places: res.map(x => x.racerId),
      spread8: times[times.length - 1] - times[0], spread4: times[3] - times[0],
      dnf: res.filter(x => x.estimated).length,
      superLead: raceSteps ? superLead / raceSteps : 0,
      winnerStars: res[0].kart.stars,
      superByPlace: res.map(x => superT[x.kart.index] / Math.max(1, raceSteps)),
      kidPlace: kid ? race.player.finishPlace : null, kidFalls: falls, kidDnf: kid ? !!race.player.estimated : null,
      kidRacer: kid ? race.player.racerId : null,
      turbos: race.stats.reduce((a, s) => a + s.turbos, 0) / 8,
      walls: race.stats.reduce((a, s) => a + s.walls, 0) / 8,
      respawns: race.stats.reduce((a, s) => a + s.respawns, 0),
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
  if (args.includes('--only-kid')) modes.splice(0, modes.length, 'kid');
  const R = roster();
  if (args.includes('--flat')) for (const r of R) r.stats = { speed: 3, accel: 3, turn: 3 };   // control: no stat differences
  const sets = [];
  args.forEach((a, i) => { if (a === '--set') { const [p, v] = args[i + 1].split('='); sets.push([p, v]); } });
  const jobs = [];
  for (const mode of modes) for (const diff of diffs) for (const track of tracks) {
    if (mode === 'wobbly' && diff !== 'easy') continue;
    for (let i = 0; i < N; i++) jobs.push({ track, diff, mode, seed: seed0 + i, noItems });
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
    console.log('  racer        sat  ' + tracks.map(t => t.padEnd(12)).join('') + 'ALL');
    for (const id of ids) {
      let line = `  ${id.padEnd(10)} ${statStr(id)}  `;
      for (const t of [...tracks, null]) {
        const sub = rs.filter(x => !t || x.track === t);
        const wins = sub.filter(x => x.places[0] === id).length / sub.length;
        const mp = mean(sub.map(x => x.places.indexOf(id) + 1));
        line += `${pct(wins)} ${f1(mp)}`.padEnd(12);
        if (t && wins > worst.share) worst = { share: wins, id, track: t, diff };
      }
      console.log(line);
    }
    let l2 = '  gap 1→8 s  (mean/p90) ', l3 = '  gap 1→4 s  (mean)     ', l4 = '  leader Super (time%)   ', l5 = '  winner stars at finish', l6 = '  turbos, walls /kart', l7 = '  Super time% 1st/4th/8th';
    for (const t of [...tracks, null]) {
      const sub = rs.filter(x => !t || x.track === t);
      l2 += `${f1(mean(sub.map(x => x.spread8)))}/${f1(p90(sub.map(x => x.spread8)))}`.padEnd(12);
      l3 += f1(mean(sub.map(x => x.spread4))).padEnd(12);
      l4 += pct(mean(sub.map(x => x.superLead))).padEnd(12);
      l5 += f1(mean(sub.map(x => x.winnerStars))).padEnd(12);
      l6 += `${f1(mean(sub.map(x => x.turbos)))}/${f1(mean(sub.map(x => x.walls)))}`.padEnd(12);
      l7 += [0, 3, 7].map(p => (mean(sub.map(x => x.superByPlace[p])) * 100).toFixed(0)).join('/').padEnd(12);
    }
    console.log(`  ${'-'.repeat(12 + 12 * (tracks.length + 1))}\n` + [l2, l3, l4, l7, l5, l6].map(l => l.replace(/^  (.{22}) ?/, (m, a) => '  ' + a.padEnd(23))).join('\n'));
    const dnf = rs.reduce((a, x) => a + x.dnf, 0);
    if (dnf) console.log(`  DNF (estimated) karts: ${dnf}`);
  }
  for (const mode of ['kid', 'wobbly']) for (const diff of diffs) {
    const rs = results.filter(x => x.diff === diff && x.mode === mode);
    if (!rs.length) continue;
    console.log(`\n== ${mode === 'kid' ? 'KID BOT (no slides, sloppy line)' : 'WOBBLY KID (steering noise)'} on ${diff.toUpperCase()} — slot 6, real ${diff} assists`);
    for (const t of tracks) {
      const sub = rs.filter(x => x.track === t);
      const pl = sub.map(x => x.kidPlace);
      const hist = [1, 2, 3, 4, 5, 6, 7, 8].map(p => pl.filter(v => v === p).length).join(' ');
      console.log(`  ${t.padEnd(8)} win ${pct(pl.filter(p => p === 1).length / pl.length)}  podium ${pct(pl.filter(p => p <= 3).length / pl.length)}  mean ${f1(mean(pl))}  [1..8: ${hist}]  falls/race ${f1(mean(sub.map(x => x.kidFalls)))}  DNF ${sub.filter(x => x.kidDnf).length}`);
    }
  }
  if (worst.id) console.log(`\nmax single-track win share: ${worst.id} ${pct(worst.share)} on ${worst.track} (${worst.diff})`);
  const js = argv('json', null);
  if (js) writeFileSync(js, JSON.stringify(results));
}

if (isMainThread) main(); else workerMain();
