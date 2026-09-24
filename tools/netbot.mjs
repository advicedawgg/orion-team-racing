// node tools/netbot.mjs [--server http://127.0.0.1:8955] [--lobby medium] [--racer <id>|auto [--force]] [--net auto|rtc|ws]
//                       [--races N] [--secs S] [--leave-after S] [--skill easy|medium|hard] [--name X] [--json]
//
// A headless online player over the REAL transport (geckos.io WebRTC via node-datachannel's polyfill,
// or the WebSocket fallback): hello → join a lobby → pick a free racer → race. It runs the browser's own
// online core (src/netgame.js) with the real physics, and an AI brain (ai.js, --skill) drives its kart
// like a human would — its item brain presses USE, which goes to the server as an intent. Prints
// latency, snapshot rate/gaps, laps, finishes, hits, items; --json prints one JSON line at the end.
import { readFileSync } from 'node:fs';
import { connectNet, Net } from '../src/net.js';
import { NetRace } from '../src/netgame.js';
import { MSG, rosterFromSource, BIN, binType } from '../src/protocol.js';
import { buildTrack } from '../src/track.js';
import { trackById } from '../src/tracks/index.js';
import { createRace } from '../src/race.js';
import { createItems } from '../src/items.js';
import { createBrain, drive } from '../src/ai.js';
import { DT } from '../src/physics.js';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SERVER = arg('server', 'http://127.0.0.1:8955'), LOBBY = arg('lobby', 'medium'), WANT = arg('racer', 'auto');
const PREFER = arg('net', 'auto'), RACES = +arg('races', 1), SECS = +arg('secs', 600), LEAVE_AFTER = arg('leave-after') ? +arg('leave-after') : null;
const SKILL = arg('skill', 'medium'), NAME = arg('name', 'netbot'), JSON_OUT = args.includes('--json');
const FORCE = args.includes('--force');     // ask for --racer even when it's listed as taken (tests the server's rule)
let forced = false;
const say = (...a) => { if (!JSON_OUT || args.includes('--verbose')) console.log(`[${NAME}]`, ...a); };

const roster = rosterFromSource(readFileSync(new URL('../src/racers.js', import.meta.url), 'utf8'));
const tracks = new Map();
const trackOf = id => { if (!tracks.has(id)) tracks.set(id, buildTrack(trackById(id))); return tracks.get(id); };

// WebRTC in node: node-datachannel's W3C polyfill (a dependency of @geckos.io/server)
let geckosImport = null;
if (PREFER !== 'ws') {
  try {
    const poly = await import('../server/node_modules/node-datachannel/dist/esm/polyfill/index.mjs');
    Object.assign(globalThis, { RTCPeerConnection: poly.RTCPeerConnection, RTCSessionDescription: poly.RTCSessionDescription, RTCIceCandidate: poly.RTCIceCandidate });
    geckosImport = () => import('../vendor/geckos.client.js');
  } catch (e) { say('no WebRTC polyfill, WebSocket only:', e.message); }
}

const out = { name: NAME, lobby: LOBBY, racer: null, transport: null, rttMs: [], races: [], errors: [], spectated: 0, snapHz: [], snapP95: [], starved: 0, extrapFrac: [] };
const net = await connectNet(SERVER, { prefer: geckosImport ? PREFER : 'ws', geckosImport, onStatus: s => say(s) }).catch(e => { console.error(`[${NAME}] cannot connect: ${e.message}`); process.exit(2); });
out.transport = net.kind;
say('connected via', net.kind, net.lastErr ? `(rtc failed: ${net.lastErr.message})` : '');
let lobby = null, cur = null, joined = false, done = false, myRacer = null, picking = false, myCid = null;
const t0 = Date.now();

net.on(MSG.WELCOME, m => { myCid = m.id; say('welcome', m.id); net.send({ t: MSG.JOIN, lobby: LOBBY }); });
net.on(MSG.ERR, m => {
  out.errors.push(m.code); say('ERR', m.code);
  if (m.code === 'taken') { myRacer = null; picking = false; pick(); }
  if (m.code === 'full' || m.code === 'version' || m.code === 'nolobby') finish(3);
});
net.on(MSG.LOBBY, m => { if (lobby && m.seq < lobby._seq) return; lobby = m.lobby; lobby._seq = m.seq; joined = true; pick(); });
function pick() {
  if (!lobby || picking) return;
  const mine = lobby.members.find(x => x.cid === myCid);
  if (mine?.racer) { myRacer = mine.racer; out.racer = myRacer; return; }
  const taken = new Set(lobby.members.map(x => x.racer).filter(Boolean));
  const id = WANT !== 'auto' && (!taken.has(WANT) || FORCE && !forced) ? WANT : roster.map(r => r.id).find(r => !taken.has(r));
  if (id === WANT) forced = true;
  if (!id) return;
  myRacer = id; out.racer = id; picking = true;
  net.send({ t: MSG.PICK, racer: id });
  setTimeout(() => { picking = false; }, 400);
}
net.on(MSG.START, m => {
  const tr = trackOf(m.track);
  const stats = id => roster.find(r => r.id === id).stats;
  const race = createRace({ track: tr, entrants: m.grid.map(id => ({ racerId: id, stats: stats(id) })), players: [{ index: m.you >= 0 ? m.you : 0, easyBoost: false, assist: false }], difficulty: m.diff, laps: m.laps, seed: m.seed });
  createItems(race, { seed: m.seed + 11 });
  const nr = new NetRace({ start: m, clock: net, onUse: ({ back }) => { rec.uses++; net.send({ t: MSG.USE, raceSeq: m.raceSeq, back }); } }).attach(race);
  const brain = m.you >= 0 ? createBrain(race.karts[m.you], tr, SKILL, 7 + (m.seed % 1000)) : null;
  const rec = { track: m.track, slot: m.you, spectator: m.you < 0, uses: 0, laps: 0, place: null, time: null, hitsOnMe: 0, humans: m.humans.length };
  if (m.you < 0) out.spectated++;
  cur = { m, race, nr, brain, rec };
  say(m.you >= 0 ? `race ${m.raceSeq} on ${m.track}: I'm ${m.grid[m.you]} in slot ${m.you}` : `spectating race ${m.raceSeq} on ${m.track}`, `(${m.humans.length} humans, GO in ${((m.goAt - net.serverNow()) / 1000).toFixed(1)} s)`);
});
net.on(MSG.EV, m => { if (cur) cur.nr.onEvents(m); });
net.onRaw(buf => { if (cur && binType(buf) === BIN.SNAP) cur.nr.onSnapshot(buf); });
net.onClose(() => { say('connection closed'); finish(4); });
net.hello();

// the 60 Hz client loop: step my race on the synced clock
const loop = setInterval(() => {
  if (!cur) return;
  const { race, nr, brain, rec } = cur;
  const target = nr.targetT();
  if (Math.abs(target - race.t) > 0.5) race.t = target;
  let n = 0;
  while (race.t + DT / 2 <= target && n < 10) {
    nr.preStep();
    race.step(brain ? drive(brain, race) : undefined);
    nr.postStep();
    if (nr.me && race.stepN % 2 === 0) net.sendRaw(nr.statePacket());
    for (const e of race.events) {
      if (e.kart !== nr.me) continue;
      if (e.type === 'lap') rec.laps = e.lap - 1;
      if (e.type === 'finish') { rec.place = e.place; rec.time = e.time; rec.laps = race.laps; say(`FINISHED ${e.place}${['st', 'nd', 'rd'][e.place - 1] || 'th'} in ${e.time.toFixed(2)} s`); }
    }
    if (race.events.some(e => e.type === 'race_done')) raceDone();
    n++;
  }
}, 4);
function raceDone() {
  const { nr, rec, race } = cur;
  const si = nr.snapInfo();
  rec.hitsOnMe = nr.stats.hitsOnMe; rec.snaps = si; rec.extrapFrac = +(nr.stats.extrap / Math.max(1, nr.stats.steps)).toFixed(3); rec.starved = nr.stats.starved; rec.eventsLate = nr.stats.eventsLate;
  if (nr.me) { rec.place = nr.me.finishPlace; rec.time = nr.me.finishTime; rec.estimated = !!nr.me.estimated; }
  rec.order = race.order.map(k => k.racerId + (k.netHuman ? '*' : ''));
  out.races.push(rec); out.snapHz.push(+si.hz.toFixed(1)); out.snapP95.push(si.p95); out.extrapFrac.push(rec.extrapFrac);
  say(`race done: ${rec.spectator ? 'spectated' : `place ${rec.place}`}, snapshots ${si.hz.toFixed(1)} Hz (gap p50 ${si.p50?.toFixed(0)} / p95 ${si.p95?.toFixed(0)} / max ${si.max?.toFixed(0)} ms), extrapolating ${(rec.extrapFrac * 100).toFixed(1)} % of steps, hits on me ${rec.hitsOnMe}, items used ${rec.uses}, rtt ${net.rtt.toFixed(0)} ms`);
  cur = { ...cur, finished: true };
  if (out.races.filter(r => !r.spectator).length >= RACES) setTimeout(() => finish(0), 300);
}
setInterval(() => out.rttMs.push(+net.rtt.toFixed(1)), 2000);
if (LEAVE_AFTER != null) setTimeout(() => { say('leaving the lobby'); net.send({ t: MSG.LEAVE }); setTimeout(() => finish(0), 500); }, LEAVE_AFTER * 1000);
setTimeout(() => { say('time up'); finish(0); }, SECS * 1000);
function finish(code) {
  if (done) return; done = true;
  clearInterval(loop);
  const rtts = out.rttMs.filter(x => x > 0);
  out.rtt = rtts.length ? { mean: +(rtts.reduce((a, b) => a + b, 0) / rtts.length).toFixed(1), max: Math.max(...rtts) } : null;
  out.secs = +((Date.now() - t0) / 1000).toFixed(1); out.code = code;
  if (JSON_OUT) console.log(JSON.stringify(out));
  else say('summary', JSON.stringify({ transport: out.transport, racer: out.racer, rtt: out.rtt, races: out.races.map(r => ({ track: r.track, place: r.place, spectator: r.spectator, hz: r.snaps?.hz?.toFixed(1) })) }));
  try { net.close(); } catch { /* */ }
  setTimeout(() => process.exit(code), 100);
}
