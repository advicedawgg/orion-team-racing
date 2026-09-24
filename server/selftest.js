// node server/selftest.js — the online gate, in-process (no sockets, fake clock, ~10 s):
// lobby lifecycle (idle → waiting → starting → racing → results → next track → idle), bots fill the grid,
// racer-taken and lobby-full rules, the wire codecs round-trip, an item hit on a REPORTED human reaches
// that human as an event, a human's USE fires their item on the server, whole races with real in-process
// NetRace clients (the browser's own online core, src/netgame.js) driving their karts with the real
// physics, leave-mid-race → bot takeover, and the last human leaving resets the lobby to idle.
// Prints PASS/FAIL per check and a final line; exit 1 on any FAIL.
import { readFileSync } from 'node:fs';
import { Lobby } from './lobby.js';
import { memoryPair } from './transport.js';
import { LOBBIES, MSG, NET, rosterFromSource, decodeSnapshot, encodeState, decodeState, encodeSnapshot, kevEncode, kevDecode, KEV } from '../src/protocol.js';
import { NetRace } from '../src/netgame.js';
import { buildTrack } from '../src/track.js';
import { trackById } from '../src/tracks/index.js';
import { createRace } from '../src/race.js';
import { createItems } from '../src/items.js';
import { createBrain, drive } from '../src/ai.js';
import { createKart, DT } from '../src/physics.js';

const roster = rosterFromSource(readFileSync(new URL('../src/racers.js', import.meta.url), 'utf8'));
let fails = 0;
const ok = (name, pass, info = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!pass) fails++; };
const f2 = v => (+v).toFixed(2);

/* ============================================================== codecs */
{
  const k = createKart({ racerId: 'orion' });
  Object.assign(k, { yaw: 2.345, speed: 27.31, vy: -3.2, air: true, hop: true, drift: -1, driftAngle: 0.61, charge: 0.83, boostT: 1.7, boostTier: 3, turbos: 2,
    steer: -0.8, throttle: 1, airT: 0.44, landT: 1.2, hitT: 0.9, hitDur: 1.2, hitKind: 'flip', spinT: 0, respawnT: 0, respawnAt: null, s: 812.5, lat: -3.21,
    stars: 7, item: 'rocket', itemCount: 3, roulT: 0.4, lockedBy: 1, lockDist: 42.3, lap: 2, lapsDone: 1, place: 3, shieldT: 4.2, invincT: 0, slowT: 1.1, tnt: { t: 2.2, hops: 3, need: 5 } });
  k.pos = { x: 123.456, y: 7.89, z: -432.1 }; k.ground = 7.1; k.nrm = { x: 0.1, y: 0.99, z: -0.05 }; k.index = 0; k.si = 800;
  const b = encodeState({ seq: 7, raceSeq: 3, rt: 12.5, kart: k, hops: 9, evs: [{ seq: 4, c: 1, b: 200 }] });
  const s = decodeState(b);
  ok('state packet round-trips', s.seq === 7 && s.raceSeq === 3 && Math.abs(s.x - 123.456) < 1e-3 && Math.abs(s.yaw - 2.345) < 2e-4 && Math.abs(s.speed - 27.31) < 0.01 && s.drift === -1 && s.air && s.hitKind === 'flip' && s.hops === 9 && s.evs.length === 1 && Math.abs(s.lat + 3.21) < 0.01,
    `${b.byteLength} bytes`);
  const W0 = { boxes: [{ alive: true }, { alive: false }, { alive: true }], stars: Array.from({ length: 11 }, (_, i) => ({ alive: i % 3 === 0 })), projs: [], hazards: [], spills: [] };
  const sb = encodeSnapshot({ seq: 1, raceSeq: 3, t: 20.25, phase: 'race', karts: Array.from({ length: 8 }, (_, i) => ({ ...k, index: i })), humanSet: new Set([6]), evs: [], W: W0 });
  const d = decodeSnapshot(sb);
  ok('snapshot round-trips (8 karts, items bits)', d.karts.length === 8 && d.karts[6].human && !d.karts[0].human && d.karts[3].item === 'rocket' && d.karts[3].itemCount === 3 && d.karts[3].tnt?.hops === 3
    && d.boxes[1] === false && d.boxes[2] === true && d.stars[3] === true && d.stars[4] === false && Math.abs(d.t - 20.25) < 1e-4, `${sb.byteLength} bytes for 8 karts`);
  ok('kart event codes round-trip', KEV.every(n => { const c = kevEncode(n, n === 'hit' ? 'spin' : n === 'respawn' ? 'splash' : 0.5); const r = kevDecode(c[0], c[1]); return r[0] === n; }));
}

/* ============================================================== in-process world */
let now = 1_000_000;
const clock = () => now;
const logs = [];
const mkLobby = (id = 'medium', laps = 1) => new Lobby(LOBBIES.find(l => l.id === id), { roster, now: clock, log: s => logs.push(s), manual: true, laps, timing: { WAIT_S: 6, LOAD_S: 1, RESULTS_S: 2 } });
const tracks = new Map();
const trackOf = id => { if (!tracks.has(id)) tracks.set(id, buildTrack(trackById(id))); return tracks.get(id); };
const stats = id => roster.find(r => r.id === id).stats;

/** An in-process client: a memory connection + (when a race starts) the real client online core. */
function client(L, cid) {
  const { server, client: c } = memoryPair(cid);
  const me = { cid, c, L, net: null, race: null, brain: null, starts: 0, evs: [], hits: 0, useSent: 0, lobby: null, errs: [] };
  me.join = () => L.join(cid, server);
  me.pump = () => {
    for (const m of c.msgs.splice(0)) {
      if (m.t === MSG.LOBBY) me.lobby = m.lobby;
      if (m.t === MSG.ERR) me.errs.push(m.code);
      if (m.t === MSG.START) {
        me.starts++;
        const tr = trackOf(m.track);
        const race = createRace({ track: tr, entrants: m.grid.map(id => ({ racerId: id, stats: stats(id) })), players: [{ index: m.you >= 0 ? m.you : 0, easyBoost: false, assist: false }], difficulty: m.diff, laps: m.laps, seed: m.seed });
        createItems(race, { seed: m.seed + 11 });
        me.net = new NetRace({ start: m, clock: { serverNow: clock }, now: clock, onUse: ({ back }) => { me.useSent++; L.onUse(cid, { raceSeq: m.raceSeq, back }); } }).attach(race);
        me.race = race; me.brain = m.you >= 0 ? createBrain(race.karts[m.you], tr, 'medium', 99) : null;
      }
      if (m.t === MSG.EV) { me.net?.onEvents(m); me.evs.push(...m.list); for (const e of m.list) if (e.type === 'item' && e.e === 'hit' && e.kart === me.net?.slot) me.hits++; }
    }
    for (const b of c.raws.splice(0)) me.net?.onSnapshot(b, now);
  };
  me.step = () => {
    const n = me.net; if (!n) return;
    const race = me.race;
    n.preStep();
    race.step(n.me ? drive(me.brain, race) : undefined);
    n.postStep();
    if (n.me && race.stepN % 2 === 0) L.onState(cid, n.statePacket());
  };
  me.leave = () => L.leave(cid);
  return me;
}
/** advance the fake clock by `secs`, pumping the lobby and every client each 1/60 s */
function run(L, clients, secs, until = null) {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) {
    now += 1000 / 60;
    L.pump(now);
    for (const c of clients) { c.pump(); if (c.net && L.race && c.net.raceSeq === L.raceSeq) { const tgt = c.net.targetT(); while (c.race.t < tgt - DT / 2) c.step(); } }
    if (until && until()) return true;
  }
  return false;
}

/* ============================================================== lifecycle */
{
  const L = mkLobby('medium');
  ok('lobby starts idle, no timer', L.phase === 'idle' && !L.timer && L.info().count === 0);
  const A = client(L, 'A'), B = client(L, 'B'), C = client(L, 'C'), D = client(L, 'D'), E = client(L, 'E');
  ok('first human wakes it (waiting, no countdown until a racer is picked)', A.join() === 'ok' && L.phase === 'waiting' && !L.phaseEnd);
  ok('pick orion → countdown starts', L.pick('A', 'orion') === 'ok' && L.phaseEnd > now);
  B.join();
  ok('racer taken by another human is refused', L.pick('B', 'orion') === 'taken' && L.pick('B', 'kingdad') === 'ok');
  C.join(); D.join();
  ok('5th human is refused (lobby full)', E.join() === 'full' && L.members.size === 4);
  L.pick('C', 'mum');
  const before = L.phaseEnd; L.pick('D', 'jelly');
  ok('4 racers in → wait shortened', L.phaseEnd < before && L.phaseEnd - now <= NET.WAIT_FULL_S * 1000 + 1, `${f2((L.phaseEnd - now) / 1000)} s left`);
  for (const c of [A, B, C, D]) c.pump();
  ok('lobby state reaches members, taken racers listed', A.lobby?.members?.filter(m => m.racer).map(m => m.racer).sort().join() === 'jelly,kingdad,mum,orion');
  D.leave(); C.leave();
  run(L, [A, B], 8, () => L.phase === 'starting');
  ok('waiting → starting after the timer', L.phase === 'starting' && !!L.race);
  const race = L.race;
  const ids = race.karts.map(k => k.racerId);
  ok('grid: 8 unique racers, humans at slots 6/7, 6 bots fill the rest', new Set(ids).size === 8 && ids[6] === 'orion' && ids[7] === 'kingdad' && race.karts.filter(k => k.remote).length === 2 && race.karts.filter(k => !k.isPlayer).length === 6, ids.join(','));
  A.pump(); B.pump();
  ok('START reaches each racer with their slot', A.starts === 1 && A.net?.slot === 6 && B.net?.slot === 7);
  run(L, [A, B], 12, () => L.race?.phase === 'race' && L.race.t > 5);
  ok('countdown → racing on the server clock', L.phase === 'racing' && race.t > 4, `server t ${f2(race.t)}, A t ${f2(A.race.t)}`);
  ok('clients run on the synced clock (race.t within a step of the server)', Math.abs(A.race.t - race.t) < 0.05 && Math.abs(B.race.t - race.t) < 0.05);
  const kA = race.karts[6], cA = A.race.karts[6];
  ok('server copy of a human follows its report', Math.hypot(kA.pos.x - cA.pos.x, kA.pos.z - cA.pos.z) < 2.5 && kA.speed > 5, `Δ ${f2(Math.hypot(kA.pos.x - cA.pos.x, kA.pos.z - cA.pos.z))} m, ${f2(kA.speed)} m/s`);
  const bot = race.karts[0], seen = A.race.karts[0];
  ok('client sees bots via interpolation (≤ ~0.15 s behind)', Math.hypot(bot.pos.x - seen.pos.x, bot.pos.z - seen.pos.z) < bot.speed * 0.16 + 1.5, `Δ ${f2(Math.hypot(bot.pos.x - seen.pos.x, bot.pos.z - seen.pos.z))} m at ${f2(bot.speed)} m/s`);

  // ---- an item hit on a REPORTED human: drop a puddle right under A's server copy
  const hitsBefore = A.hits, W = L.W;
  kA.stars = 4;
  for (let tries = 0; tries < 6 && A.hits === hitsBefore; tries++) {   // (not while it's mid-hop / respawning / already spinning)
    kA.shieldT = 0; kA.invincT = 0; kA.shieldArmed = false;
    if (!kA.air && kA.respawnT <= 0 && kA.hitT <= 0 && kA.spinT <= 0) W.hazards.push({ id: 60000 + tries, kind: 'puddle', owner: bot, alive: true, x: kA.pos.x, y: kA.pos.y, z: kA.pos.z, r: 3, t: 5, life: 35, arm: 0, s: kA.s, lat: kA.lat, drop: 0, super: false });
    run(L, [A, B], 0.4);
  }
  ok('item hit on a reported human → a hit event to that human', A.hits > hitsBefore && A.evs.some(e => e.type === 'item' && e.e === 'hit' && e.kart === 6 && e.kind === 'spin'));
  ok('…their own kart spun locally, the server took the star', A.net.stats.hitsOnMe > 0 && kA.stars === 3, `server stars ${kA.stars}, spills ${W.spills.length}`);
  // ---- USE: give A a rocket (server-side), A's device presses the button → the server fires it
  run(L, [A, B], 2.5);
  kA.item = null; kA.itemCount = 0; kA.roulT = 0;
  const projs0 = W.stats.rocketsFired, sent0 = A.useSent;
  { const n0 = race.events.length; W.give(kA, 'rocket'); L.collect(race.events.splice(n0)); }   // (as if it came out of the roulette in a step)
  let pressed = false, fired = false;
  // A's device drives with the AI brain, whose item brain presses USE when it sees a target — that press
  // goes to the server as an intent; nothing fires locally
  for (let i = 0; i < 80 && !fired; i++) { run(L, [A, B], 0.1); pressed ||= A.race.karts[6].item === 'rocket'; fired = W.stats.rocketsFired > projs0; if (i === 40 && !fired) { A.race.karts[6].ctrl = { item: true }; A.net._iPrev = false; A.net.postStep(); } }
  ok('a human\'s item: mirrored to their HUD, USE fires it on the server', fired && A.useSent > sent0 && A.evs.some(e => e.e === 'got' && e.kart === 6 && e.item === 'rocket'), `mirror ${pressed}, sent ${A.useSent - sent0}, fired ${fired}`);

  // ---- leave mid-race → a bot takes the kart
  const kB = race.karts[7];
  B.leave();
  ok('a human leaving mid-race hands the kart to a bot', !kB.remote && !kB.isPlayer && race.humans.length === 1 && L.phase === 'racing');
  const done = run(L, [A], 160, () => L.phase === 'results');
  ok('the 1-lap race finishes → results', done && race.phase === 'done' && race.karts.every(k => k.finished), `race.t ${f2(race.t)}, A place ${race.karts[6].finishPlace}`);
  run(L, [A], 0.5);
  ok('client gets the finish + results (race_done, every kart placed)', A.race.phase === 'done' && A.race.karts.every(k => k.finishPlace > 0) && A.race.karts[6].finishPlace === race.karts[6].finishPlace);
  const firstTrack = race.track.id;
  run(L, [A], 4, () => L.race && L.race !== race);
  ok('next race on the next track in the rotation', L.race && L.race !== race && L.race.track.id !== firstTrack && A.starts === 2, `${firstTrack} → ${L.race?.track.id}`);

  // ---- a spectator: joins mid-race, gets the race, watches, is in the next one
  const S = client(L, 'S');
  run(L, [A], 6, () => L.race.phase === 'race' && L.race.t > 2);
  S.join(); S.pump();
  ok('mid-race joiner gets the race as a spectator', S.net?.spectating && S.starts === 1 && S.race.t > 1);
  L.pick('S', 'zapdrone');
  run(L, [A, S], 3);
  ok('spectator view follows the race (snapshots, interpolated karts move)', S.net.stats.snaps > 20 && S.race.karts[0].pos.x !== 0 && S.net.follow(3).index === 3);
  const r2 = L.race;
  run(L, [A, S], 160, () => L.race !== r2 && L.race?.phase === 'countdown');
  ok('…and races in the next one', L.race !== r2 && L.race.karts.some(k => k.remote && k.racerId === 'zapdrone'));

  // ---- the last human leaving resets the lobby
  A.leave();
  ok('one human left: still going', L.phase !== 'idle');
  S.leave();
  ok('last human leaves → idle (race dropped, timer stopped)', L.phase === 'idle' && !L.race && !L.timer && L.members.size === 0 && L.stats.resets === 1);
  const before2 = L.stats.steps; for (let i = 0; i < 60; i++) { now += 16; L.pump(now); }
  ok('idle lobby does nothing (no steps)', L.stats.steps === before2);
  const avg = L.stats.lastTickMs.reduce((a, b) => a + b, 0) / Math.max(1, L.stats.lastTickMs.length);
  ok('server step cost', avg < 2, `${avg.toFixed(3)} ms per 60 Hz step (8 karts, items, snapshot encode incl.)`);
}

/* ============================================================== a lobby on its own timer */
{
  const L = new Lobby(LOBBIES[0], { roster, log: () => {}, timing: { WAIT_S: 1 } });
  const { server } = memoryPair('T');
  L.join('T', server);
  ok('real timer starts on the first join', !!L.timer);
  L.leave('T');
  ok('…and stops on the last leave', !L.timer && L.phase === 'idle');
}

console.log(fails ? `\nFAIL — ${fails} failing check(s)` : '\nSELFTEST: PASS');
process.exit(fails ? 1 : 0);
