// node tools/net-interp.mjs [lagMs jitterMs loss] [burst] — how smoothly a CLIENT draws remote karts (cm per step):
// a real server race → snapshots → delayed / jittered / lost / frame-quantized → NetRace.preStep; burst = 0/2-step frames.
import { readFileSync } from 'node:fs';
import { rosterFromSource, encodeSnapshot } from '../src/protocol.js';
import { NetRace } from '../src/netgame.js';
import { buildTrack } from '../src/track.js';
import { trackById } from '../src/tracks/index.js';
import { createRace } from '../src/race.js';
import { createItems } from '../src/items.js';
import { DT } from '../src/physics.js';
const roster = rosterFromSource(readFileSync(new URL('../src/racers.js', import.meta.url), 'utf8'));
const [LAG, JIT, LOSS] = [+(process.argv[2] || 2), +(process.argv[3] || 1), +(process.argv[4] || 0)]; const BURST = process.argv[5] === 'burst';
const tr = buildTrack(trackById('beach'));
const ents = roster.map(r => ({ racerId: r.id, stats: r.stats }));
const srv = createRace({ track: tr, entrants: ents, difficulty: 'medium', seed: 5 }); const SW = createItems(srv, { seed: 3 });
const cli = createRace({ track: tr, entrants: ents, players: [{ index: 7 }], difficulty: 'medium', seed: 5 }); createItems(cli, { seed: 3 });
const start = { raceSeq: 1, you: 7, humans: [], goAt: 0 };
let clientNow = 0;   // ms, client perf clock; server race time t ↔ server ms = t*1000 (goAt 0)
const nr = new NetRace({ start, clock: { serverNow: () => clientNow }, now: () => clientNow }).attach(cli);
cli.karts[7].remote = true; // don't sim my kart here
const inflight = [];
let seq = 0; const rec = [], rec2 = [];
for (let f = 0; f < 60 * 40; f++) {
  // server: one step per 1/60 s of real time
  srv.step([]); if (srv.stepN % 3 === 0) { const buf = encodeSnapshot({ seq: ++seq, raceSeq: 1, t: srv.t, phase: srv.phase, karts: srv.karts, W: SW });
    if (Math.random() >= LOSS) inflight.push({ at: srv.t * 1000 + LAG + (Math.random() * 2 - 1) * JIT, buf }); }
  // client frame at the same wall time; arrival quantized to frame boundaries
  clientNow = srv.t * 1000 + 3.2;
  for (let i = inflight.length - 1; i >= 0; i--) if (inflight[i].at <= clientNow) { nr.onSnapshot(inflight[i].buf, clientNow); inflight.splice(i, 1); }
  // client sim steps: normally one per frame; BURST: every 7th frame runs 0 steps, the next runs 2 (vsync accumulator)
  const n = BURST ? (f % 7 === 0 ? 0 : f % 7 === 1 ? 2 : 1) : 1;
  for (let i = 0; i < n; i++) { cli.t += DT; nr.preStep(); rec2.push([cli.karts[0].pos.x, cli.karts[0].pos.z]); }

  if (false && srv.t > 8 && srv.t < 38) rec.push([cli.karts[0].pos.x, cli.karts[0].pos.z]);
}
const R = rec2.slice(60 * 8, 60 * 38); const rec_ = R; const r = []; for (let j = 1; j < rec_.length - 1; j++) r.push(Math.hypot(rec_[j][0] - (rec_[j - 1][0] + rec_[j + 1][0]) / 2, rec_[j][1] - (rec_[j - 1][1] + rec_[j + 1][1]) / 2) * 100);
r.sort((a, b) => a - b);
console.log(`${BURST ? 'BURSTY ' : ''}lag ${LAG}±${JIT} loss ${LOSS}: drawn jitter cm/frame p50 ${r[r.length >> 1].toFixed(2)} p95 ${r[Math.floor(r.length * .95)].toFixed(2)} max ${r[r.length - 1].toFixed(1)}  extrap ${(nr.stats.extrap / nr.stats.steps * 100).toFixed(1)}% starved ${nr.stats.starved}  recvOff ${(nr.recvOff*1000).toFixed(0)} ms`);
