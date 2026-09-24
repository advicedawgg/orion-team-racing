// node tools/net-jitter.mjs [skewMs] [burst] [lagMs jitterMs loss] — how smoothly the SERVER reconstructs a remote
// human (cm per 60 Hz step): in-process Lobby + a real NetRace client driven by an AI brain, its reports delayed /
// jittered / dropped, its clock skewed, its frames bursty (0 or 2 steps). A server bot is printed for comparison.
// e.g. node tools/net-jitter.mjs 10 burst 100 30 0.05
import { readFileSync } from 'node:fs';
import { Lobby } from '../server/lobby.js';
import { memoryPair } from '../server/transport.js';
import { LOBBIES, MSG, rosterFromSource } from '../src/protocol.js';
import { NetRace } from '../src/netgame.js';
import { buildTrack } from '../src/track.js';
import { trackById } from '../src/tracks/index.js';
import { createRace } from '../src/race.js';
import { createItems } from '../src/items.js';
import { createBrain, drive } from '../src/ai.js';
import { DT } from '../src/physics.js';
const roster = rosterFromSource(readFileSync(new URL('../src/racers.js', import.meta.url), 'utf8'));
const SKEW = +(process.argv[2] || 0), BURST = process.argv[3] === 'burst', LAG = +(process.argv[4] || 0), JIT = +(process.argv[5] || 0), LOSS = +(process.argv[6] || 0);
const q = [];
let now = 1e6; const clock = () => now;
const L = new Lobby(LOBBIES[1], { roster, now: clock, manual: true, laps: 1, timing: { WAIT_S: 1, LOAD_S: 1 } });
const { server, client: c } = memoryPair('A');
L.join('A', server); L.pick('A', 'orion');
let nr = null, race = null, brain = null;
const srv = [], cli = [];
for (let i = 0; i < 60 * 30; i++) {
  now += 1000 / 60;
  L.pump(now);
  for (const m of c.msgs.splice(0)) if (m.t === MSG.START) {
    const tr = buildTrack(trackById(m.track));
    race = createRace({ track: tr, entrants: m.grid.map(id => ({ racerId: id, stats: roster.find(r => r.id === id).stats })), players: [{ index: m.you }], difficulty: m.diff, laps: 1, seed: m.seed });
    createItems(race, { seed: 1 });
    nr = new NetRace({ start: m, clock: { serverNow: () => now + SKEW }, now: clock }).attach(race); brain = createBrain(race.karts[m.you], tr, 'medium', 3);
  }
  c.raws.length = 0;
  if (nr) {
    const tgt = nr.targetT();
    // BURST: the client's frames run 0 or 2 steps now and then (a hitchy device)
    const extra = BURST && i % 7 === 0 ? -DT : BURST && i % 7 === 1 ? DT : 0;
    while (race.t < tgt + extra - DT / 2) { nr.preStep(); race.step(drive(brain, race)); nr.postStep(); if (race.stepN % 2 === 0 && Math.random() >= LOSS) q.push({ at: now + LAG + (Math.random() * 2 - 1) * JIT, b: nr.statePacket() }); }
    for (let j = q.length - 1; j >= 0; j--) if (q[j].at <= now) { L.onState('A', q[j].b); q.splice(j, 1); }
    if (L.race?.phase === 'race' && L.race.t > 5 && L.race.t < 25) { const k = L.race.karts[nr.slot]; srv.push([k.pos.x, k.pos.z]); const b = L.race.karts[0]; cli.push([b.pos.x, b.pos.z]); }
  }
}
const jit = p => { const r = []; for (let j = 1; j < p.length - 1; j++) r.push(Math.hypot(p[j][0] - (p[j - 1][0] + p[j + 1][0]) / 2, p[j][1] - (p[j - 1][1] + p[j + 1][1]) / 2) * 100); r.sort((a, b) => a - b); return { p50: r[r.length >> 1].toFixed(2), p95: r[Math.floor(r.length * .95)].toFixed(2), max: r[r.length - 1].toFixed(1) }; };
console.log(`skew ${SKEW} ms ${BURST ? 'bursty client' : ''} reports ${LAG}±${JIT} ms loss ${LOSS}: server copy of the human (cm/step)`, jit(srv), ' | a server bot', jit(cli));
