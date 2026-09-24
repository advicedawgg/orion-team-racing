// lobby.js — one permanent public lobby: up to 4 humans + bots on an 8-kart grid, running the PURE game
// modules headlessly (the same track.js / physics.js / race.js / ai.js / items.js the browser and the
// gate run). DESIGN.md "Online" is the contract; this is the server half.
//
// Lifecycle:  idle ──first human joins──▶ waiting ──first racer picks: WAIT_S timer (3 s when 4 are in)──▶
//   starting (START sent LOAD_S early; countdown 3.6 s on the synced clock) ──GO──▶ racing ──race done──▶
//   results (RESULTS_S, the race keeps running behind the overlay) ──▶ starting (next track in ROTATION) …
//   The last human leaving from ANY phase resets it: race dropped, state cleared, timer stopped → idle
//   (no simulation, no CPU).
//
// Authority: each racing human's kart is `remote` — its device simulates it and reports it (STATE, 30 Hz);
// the server extrapolates it to "now" and runs everything else: bots, items (boxes, roulette RNG,
// projectiles, hazards, hits), laps/checkpoints, positions, the finish, results. A hit on a human is an
// item 'hit' event its device applies to its own kart. Human item use is an intent (USE) the server
// executes. A human leaving mid-race hands their kart to a bot (it keeps racing, loses its P badge).
import { buildTrack } from '../src/track.js';
import { trackById } from '../src/tracks/index.js';
import { createRace, COUNTDOWN } from '../src/race.js';
import { createItems } from '../src/items.js';
import { createBrain, rng } from '../src/ai.js';
import { DT, applyHit } from '../src/physics.js';
import { NET, ROTATION, MSG, encodeSnapshot, decodeState, kevEncode, encodeEvent, RELAY_RACE_EVENTS } from '../src/protocol.js';

const tracks = new Map();
const trackOf = id => { if (!tracks.has(id)) tracks.set(id, buildTrack(trackById(id))); return tracks.get(id); };
const canAct = k => !k.finished && k.respawnT <= 0 && k.hitT <= 0 && k.spinT <= 0 && !k.frozen;
const NOC = Object.freeze({ steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false, item: false });
const MAX_SPEED = 45, TELEPORT_M = 60;
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
/** move `o` (x, z, and yaw if it has one) along an arc: speed v, yaw rate w, for dt seconds (dt may be < 0) */
function arc(o, src, v, w, dt, out = o) {
  let x = src.x ?? o.x, z = src.z ?? o.z, yaw = src.yaw;
  const n = Math.max(1, Math.ceil(Math.abs(dt) * 120)), h = dt / n;
  for (let i = 0; i < n; i++) { yaw += w * h * 0.5; x += Math.sin(yaw) * v * h; z += Math.cos(yaw) * v * h; yaw += w * h * 0.5; }
  out.x = x; out.z = z; if ('yaw' in out) out.yaw = wrapA(yaw);
  return out;
}

export class Lobby {
  /**
   * def: LOBBIES entry. opts: { roster: [{id, stats}], now () → ms, log, manual (no timer: the
   * selftest calls pump() with its own clock), timing overrides { WAIT_S, WAIT_FULL_S, LOAD_S, RESULTS_S }, laps }
   */
  constructor(def, { roster, now = () => Date.now(), log = () => {}, manual = false, timing = {}, laps } = {}) {
    Object.assign(this, { def, id: def.id, diff: def.diff, name: def.name, roster, now, log, manual, laps });
    this.T = { ...NET, ...timing };
    this.members = new Map();       // cid → member
    this.joinN = 0; this.seq = 0; this.raceSeq = 0; this.rot = 0;
    this.phase = 'idle'; this.phaseEnd = 0;
    this.race = null; this.W = null; this.startMsg = null; this.timer = null;
    this.stats = { steps: 0, stepMs: 0, snaps: 0, snapBytes: 0, races: 0, resets: 0, lastTickMs: [] };
  }

  /* ------------------------------------------------------------------ public info */
  get humans() { return [...this.members.values()]; }
  info() {
    const race = this.race, lead = race?.order?.[0];
    return {
      id: this.id, name: this.name, diff: this.diff, phase: this.phase, max: this.T.MAX_HUMANS,
      humans: this.humans.map(m => m.racer), count: this.members.size, full: this.members.size >= this.T.MAX_HUMANS,
      track: race?.track?.id || null, lap: lead ? Math.min(lead.lap, race.laps) : 0, laps: race?.laps || 0,
      left: this.phaseEnd ? Math.max(0, Math.ceil((this.phaseEnd - this.now()) / 1000)) : null,
    };
  }
  state() {
    return {
      ...this.info(), phaseEnd: this.phaseEnd || null, now: this.now(), raceSeq: this.raceSeq,
      next: ROTATION[this.rot % ROTATION.length],
      members: this.humans.map(m => ({ cid: m.cid, racer: m.racer, racing: m.slot >= 0, order: m.order })),
    };
  }
  broadcastState() { const msg = { t: MSG.LOBBY, seq: ++this.seq, lobby: this.state() }; for (const m of this.members.values()) m.conn.send(msg, true); }

  /* ------------------------------------------------------------------ membership */
  join(cid, conn) {
    if (this.members.has(cid)) return 'ok';
    if (this.members.size >= this.T.MAX_HUMANS) return 'full';
    const m = { cid, conn, racer: null, order: ++this.joinN, slot: -1, rep: null, repNew: false, repRaceT: 0, hopsSeen: null, evSeen: null, teleports: 0, useSeq: 0 };
    this.members.set(cid, m);
    if (this.phase === 'idle') { this.phase = 'waiting'; this.phaseEnd = 0; this.startTimer(); this.log(`[${this.id}] wakes up`); }
    this.log(`[${this.id}] + ${cid} (${this.members.size} humans)`);
    this.broadcastState();
    if (this.startMsg && this.race) conn.send({ ...this.startMsg, you: -1, st: this.now() }, true);   // spectate the race in progress
    return 'ok';
  }
  pick(cid, racer) {
    const m = this.members.get(cid);
    if (!m) return 'nolobby';
    if (!this.roster.some(r => r.id === racer)) return 'taken';
    if (m.racer === racer) return 'ok';
    if (m.slot >= 0) return 'ok';                       // racing: keep your racer until the race is over
    for (const o of this.members.values()) if (o !== m && o.racer === racer) return 'taken';
    m.racer = racer;
    if (this.phase === 'waiting' && !this.phaseEnd) this.phaseEnd = this.now() + this.T.WAIT_S * 1000;
    this.maybeShorten();
    this.broadcastState();
    return 'ok';
  }
  maybeShorten() {
    if (this.phase !== 'waiting' || !this.phaseEnd) return;
    const all = this.humans;
    if (all.length >= this.T.MAX_HUMANS && all.every(m => m.racer)) this.phaseEnd = Math.min(this.phaseEnd, this.now() + this.T.WAIT_FULL_S * 1000);
  }
  leave(cid, why = 'left') {
    const m = this.members.get(cid);
    if (!m) return;
    this.members.delete(cid);
    this.log(`[${this.id}] - ${cid} ${why} (${this.members.size} humans)`);
    if (m.slot >= 0 && this.race) this.handToBot(this.race.karts[m.slot]);
    m.slot = -1;
    if (!this.members.size) { this.reset(); return; }
    if (this.phase === 'waiting' && !this.humans.some(o => o.racer)) this.phaseEnd = 0;   // nobody ready any more
    this.broadcastState();
  }
  /** The last human left: back to idle. Nothing simulates, nothing ticks. */
  reset() {
    this.stopTimer();
    this.race = null; this.W = null; this.startMsg = null;
    this.phase = 'idle'; this.phaseEnd = 0; this.rot = 0; this.joinN = 0;
    this.stats.resets++;
    this.log(`[${this.id}] empty → reset to idle`);
  }
  /** A human's kart becomes a bot's: same kart, same place in the race, the lobby's difficulty. */
  handToBot(k) {
    const race = this.race;
    if (!k || !race) return;
    k.remote = false; k.isPlayer = false; k.pn = -1; k.assist = false; k.easyBoost = false; k.netHuman = false;
    k.pace = race.cfg.pace; k.ctrl = NOC;
    race.brains[k.index] = createBrain(k, race.track, this.diff, race.seedN || 1);
    race.humans = race.humans.filter(h => h !== k);
    race.humansDone = race.humans.filter(h => h.finished).length;
    race.player = race.humans[0] || null; race.playerIndex = race.player ? race.player.index : -1;
    if (!race.humans.length) { if (race.phase !== 'done') race.playerDoneT = -1e9; }      // no human left in it: call it
    else if (race.humansDone >= race.humans.length && race.playerDoneT == null) race.playerDoneT = race.t;
  }

  /* ------------------------------------------------------------------ timer */
  startTimer() {
    if (this.manual || this.timer) return;
    this.lastPump = this.now();
    this.timer = setInterval(() => { try { this.pump(); } catch (e) { console.error(`[${this.id}] pump`, e); this.reset(); } }, 5);
  }
  stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  pump(now = this.now()) {
    if (this.phase === 'idle') return;
    // members that went silent (a dead WebRTC path can take a while to report closed)
    if (!this._staleT || now - this._staleT > 1000) {
      this._staleT = now;
      for (const m of [...this.members.values()]) if (m.conn.lastRx && now - m.conn.lastRx > this.T.STALE_S * 1000) { try { m.conn.close(); } catch { /* */ } this.leave(m.cid, 'timed out'); }
      if (this.phase === 'idle') return;
    }
    if (this.phase === 'waiting') {
      if (this.phaseEnd && now >= this.phaseEnd) this.startRace(now);
      return;
    }
    if (this.race) {
      const t0 = performance.now();
      const target = Math.floor((now - this.raceStartMs) / (DT * 1000));
      let n = 0;
      while (this.race && this.race.stepN < target && n < 12) { this.stepOnce(); n++; }
      if (this.race && this.race.stepN < target - 60) { this.log(`[${this.id}] behind by ${target - this.race.stepN} steps — skipping ahead`); this.raceStartMs = now - this.race.stepN * DT * 1000; }
      if (n) { const ms = performance.now() - t0; this.stats.stepMs += ms; this.stats.lastTickMs.push(ms / n); if (this.stats.lastTickMs.length > 600) this.stats.lastTickMs.splice(0, 300); }
    }
    if (this.phase === 'starting' && this.race && this.race.phase !== 'countdown') { this.phase = 'racing'; this.broadcastState(); }
    if (this.phase === 'results' && now >= this.phaseEnd) {
      if (this.humans.some(m => m.racer)) this.startRace(now);
      else { this.race = null; this.W = null; this.startMsg = null; this.phase = 'waiting'; this.phaseEnd = 0; this.broadcastState(); }
    }
  }

  /* ------------------------------------------------------------------ a race */
  startRace(now = this.now()) {
    const racers = this.humans.filter(m => m.racer).sort((a, b) => a.order - b.order).slice(0, this.T.MAX_HUMANS);
    if (!racers.length) { this.phase = 'waiting'; this.phaseEnd = 0; this.broadcastState(); return; }
    for (const m of this.members.values()) { m.slot = -1; m.rep = null; m.repNew = false; m.hopsSeen = null; m.evSeen = null; m.teleports = 0; }
    const trackId = ROTATION[this.rot % ROTATION.length]; this.rot++;
    const track = trackOf(trackId);
    const seed = 1 + Math.floor(Math.random() * 1e6);
    const r = rng(seed);
    // grid: humans in NET.HUMAN_SLOTS (join order), bots take the other racers, shuffled
    const n = this.T.KARTS, ids = new Array(n).fill(null);
    racers.forEach((m, j) => { m.slot = this.T.HUMAN_SLOTS[j]; ids[m.slot] = m.racer; });
    const botIds = this.roster.map(x => x.id).filter(id => !racers.some(m => m.racer === id));
    for (let i = botIds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [botIds[i], botIds[j]] = [botIds[j], botIds[i]]; }
    for (let i = 0; i < n; i++) if (!ids[i]) ids[i] = botIds.shift();
    const stats = id => this.roster.find(x => x.id === id).stats;
    const race = createRace({ track, entrants: ids.map(id => ({ racerId: id, stats: stats(id) })), players: racers.map(m => ({ index: m.slot, easyBoost: false, assist: false })),
      difficulty: this.diff, seed, laps: this.laps });
    race.seedN = seed;
    const W = createItems(race, { seed: seed + 11 });
    for (const m of racers) { const k = race.karts[m.slot]; k.remote = true; k.netHuman = true; k.ctrl = NOC; k._evSeq = 0; }
    race.starHit = (v, by) => { if (v.remote) W.hitKart(v, 'spin', by, 'superstar'); else applyHit(v, 'spin'); };
    for (const k of race.karts) { k._relay = []; k._relaySeq = 0; }
    this.race = race; this.W = W; this.raceSeq = (this.raceSeq + 1) & 0xffff; this.pending = [];
    this.raceStartMs = now + this.T.LOAD_S * 1000;             // race.t = -COUNTDOWN here
    this.goAt = this.raceStartMs + COUNTDOWN * 1000;
    this.phase = 'starting'; this.phaseEnd = this.goAt;
    this.stats.races++;
    this.startMsg = { t: MSG.START, raceSeq: this.raceSeq, lobby: this.id, track: trackId, seed, diff: this.diff, laps: race.laps, grid: ids,
      humans: racers.map(m => ({ slot: m.slot, cid: m.cid, racer: m.racer })), goAt: this.goAt };
    for (const m of this.members.values()) m.conn.send({ ...this.startMsg, you: m.slot, st: this.now() }, true);
    this.broadcastState();
    this.log(`[${this.id}] race ${this.raceSeq} on ${trackId}: ${racers.map(m => m.racer + '@' + m.slot).join(' ')} + ${n - racers.length} bots`);
  }

  /** a human's own-kart report (binary STATE) */
  onState(cid, buf) {
    const m = this.members.get(cid);
    if (!m || m.slot < 0 || !this.race) return;
    let st; try { st = decodeState(buf); } catch { return; }
    if (!st || st.badVersion != null || st.raceSeq !== this.raceSeq) return;
    if (m.rep && ((st.seq - m.rep.seq) & 0xffff) > 0x8000) return;       // older than what we have (reordered)
    m.rep = st; m.repNew = true;
  }
  /** a human pressed USE: the server fires their item (the roulette result was the server's too) */
  onUse(cid, { raceSeq, back } = {}) {
    const m = this.members.get(cid), race = this.race;
    if (!m || m.slot < 0 || !race || raceSeq !== this.raceSeq || race.phase !== 'race') return;
    const k = race.karts[m.slot];
    if (!canAct(k)) return;
    const n0 = race.events.length;
    this.W.use(k, !!back);
    this.collect(race.events.splice(n0));
  }

  /** Before each server step: every racing human's server copy ← their latest report, brought forward to
   *  the time this step simulates (race.t + DT) along an ARC (yaw rate from their last two reports), then
   *  eased in (25 % of the error per step) instead of snapped; between reports it dead-reckons on the same
   *  arc. Measured with tools/net-jitter.mjs (reports 100 ± 30 ms late, 5 % lost, a client running 0/2
   *  steps per frame): straight-line extrapolation + snapping jittered 3.0 cm p95 / 31 cm max per step;
   *  arc + 40 % easing 1.0–1.6 / 9–90 cm; arc + 25 % 0.9 / 6–9 cm. */
  applyReports() {
    const race = this.race, tr = race.track, T = race.t + DT;
    for (const m of this.members.values()) {
      if (m.slot < 0) continue;
      const k = race.karts[m.slot];
      if (!k.remote) continue;
      k.ev.length = 0;
      // server-authoritative timers stepKart would have run
      k.shieldT = Math.max(0, k.shieldT - DT); k.invincT = Math.max(0, k.invincT - DT); k.slowT = Math.max(0, k.slowT - DT);
      const st = m.rep;
      const live = !k.frozen && k.respawnT <= 0 && race.phase !== 'countdown';
      if (st && live && !m.repNew && race.t - (m.repAt ?? -9) < 0.5) {                  // dead reckoning (no fresh report; ≤ 0.5 s — a hidden tab stops sending, the kart waits)
        const o = arc(k.pos, { x: k.pos.x, z: k.pos.z, yaw: k.yaw }, k.speed, k._w || 0, DT, { x: 0, z: 0, yaw: 0 });
        k.pos.x = o.x; k.pos.z = o.z; k.yaw = o.yaw;
        if (k.air) { k.vy -= 30 * DT; k.pos.y += k.vy * DT; }
      }
      if (st && m.repNew) {
        m.repNew = false; m.repAt = race.t;
        const p = m.prevRep, dtr = p ? st.rt - p.rt : 0;
        const w = p && dtr > 0.005 && dtr < 0.3 ? Math.max(-4, Math.min(4, wrapA(st.yaw - p.yaw) / dtr)) : 0;
        m.prevRep = { rt: st.rt, yaw: st.yaw };
        const lag = Math.max(-0.15, Math.min(0.25, T - st.rt));
        const speed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, st.speed));
        const moving = !st.frozen && st.respawnT <= 0 && race.phase !== 'countdown';
        const tgt = { x: st.x, y: st.y, z: st.z, yaw: st.yaw };
        if (moving) { arc(tgt, { x: st.x, z: st.z, yaw: st.yaw }, speed, w, lag, tgt); if (st.air) tgt.y += st.vy * lag - 15 * lag * lag; }
        const jump = Math.hypot(tgt.x - k.pos.x, tgt.z - k.pos.z);
        if (jump < TELEPORT_M + Math.abs(speed) * 0.5 || st.respawnT > 0 || k.respawnT > 0 || race.t < 1 || ++m.teleports > 30) {
          m.teleports = 0;
          const snap = !m.eased || jump > 4 || !moving || st.respawnT > 0 || k.respawnT > 0 || k.hitT > 0;
          const f = snap ? 1 : 0.25;
          k.pos.x += (tgt.x - k.pos.x) * f; k.pos.y += (tgt.y - k.pos.y) * (snap || st.air ? 1 : f); k.pos.z += (tgt.z - k.pos.z) * f;
          k.yaw = snap ? tgt.yaw : k.yaw + wrapA(tgt.yaw - k.yaw) * 0.5;
          m.eased = true;
        }
        k._w = w;
        k.speed = speed; k.vy = st.vy; k.air = st.air; k.hop = st.hop; k.airT = st.airT; k.landT = st.landT;
        k.drift = st.drift; k.driftAngle = st.driftAngle; k.charge = st.charge; k.turbos = st.turbos; k.boostT = st.boostT; k.boostTier = st.boostTier;
        k.overheat = st.overheat; k.inRed = st.inRed; k.steer = st.steer; k.throttle = st.throttle;
        k.hitT = st.hitT; k.hitDur = st.hitDur; k.hitKind = st.hitKind; k.spinT = st.spinT;
        k.respawnT = st.respawnT; k.respawnAt = st.respawnAt; k.onRoad = st.onRoad;
        k.nrm.x = st.nx; k.nrm.z = st.nz; k.nrm.y = Math.sqrt(Math.max(0, 1 - st.nx * st.nx - st.nz * st.nz));
        if (st.si < tr.n) k.si = st.si;
        // hops since the last report drive TNT shaking (items.js counts 'hop' in k.ev)
        if (m.hopsSeen == null) m.hopsSeen = st.hops;
        const dh = (st.hops - m.hopsSeen) & 0xffff; m.hopsSeen = st.hops;
        if (dh > 0 && dh < 20) for (let i = 0; i < dh; i++) k.ev.push('hop');
        // their cosmetic kart events, relayed to everyone else
        for (const e of st.evs) {
          if (m.evSeen != null && ((e.seq - m.evSeen) & 0xffff) >= 0x8000 || e.seq === m.evSeen) continue;
          m.evSeen = e.seq; k._relay.push({ seq: ++k._relaySeq & 0xffff, c: e.c, b: e.b, t: race.t });
        }
      }
      k.vel.x = Math.sin(k.yaw) * k.speed; k.vel.z = Math.cos(k.yaw) * k.speed; k.vel.y = k.air ? k.vy : 0;
      const pr = tr.project(k.pos, k.si, k._pr || (k._pr = {}));
      k.si = pr.i; k.s = pr.s; k.lat = pr.lat; k.ground = pr.y; k.surface = pr.surface;
      if (isFinite(pr.y) && (k.pos.y < pr.y || !k.air && live)) k.pos.y = Math.max(k.pos.y, pr.y);
    }
  }

  collect(events) {
    const race = this.race;
    for (const e of events) {
      if (e.type === 'item') this.pending.push(encodeEvent(e, race.t));
      else if (RELAY_RACE_EVENTS.has(e.type)) {
        const o = encodeEvent(e, race.t);
        if (e.type === 'finish') { o.time = e.kart.finishTime; o.laps = e.kart.lapTimes; }
        if (e.type === 'lap') o.lt = e.kart.lastLapT;
        if (e.type === 'race_done') o.results = race.results().map(r => ({ i: r.kart.index, place: r.place, time: r.time, est: r.estimated }));
        this.pending.push(o);
      } else if (e.type === 'kart' && e.kart && !e.kart.remote) {
        const c = kevEncode(e.e, e.v);
        if (c) e.kart._relay.push({ seq: ++e.kart._relaySeq & 0xffff, c: c[0], b: c[1], t: race.t });
      }
    }
  }

  stepOnce() {
    const race = this.race;
    this.applyReports();
    race.step([]);
    this.stats.steps++;
    this.collect(race.events);
    if (race.phase === 'race' && race.t > race.laps * 100 + this.T.RACE_CAP_PAD && race.playerDoneT !== -1e9) { this.log(`[${this.id}] race cap hit — calling it`); race.playerDoneT = -1e9; }
    if (race.phase === 'done' && (this.phase === 'racing' || this.phase === 'starting')) {
      this.phase = 'results'; this.phaseEnd = this.now() + this.T.RESULTS_S * 1000;   // karts keep driving behind the results
      this.broadcastState();
    }
    if (race.stepN % this.T.SNAP_EVERY === 0) this.flush();
  }

  flush() {
    const race = this.race;
    const humanSet = new Set(race.karts.filter(k => k.netHuman).map(k => k.index));
    const evs = race.karts.map(k => { const r = k._relay; while (r.length && r[0].t < race.t - 0.2) r.shift(); return r; });
    const buf = encodeSnapshot({ seq: (this.snapSeq = ((this.snapSeq || 0) + 1) & 0xffff), raceSeq: this.raceSeq, t: race.t, phase: race.phase, karts: race.karts, humanSet, evs, W: this.W });
    this.stats.snaps++; this.stats.snapBytes += buf.byteLength;
    for (const m of this.members.values()) m.conn.sendRaw(buf);
    if (this.pending.length) {
      const msg = { t: MSG.EV, raceSeq: this.raceSeq, list: this.pending };
      this.pending = [];
      for (const m of this.members.values()) m.conn.send(msg, true);
    }
  }
}
