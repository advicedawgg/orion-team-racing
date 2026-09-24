// protocol.js — PURE (no THREE, no DOM, no node APIs): everything the online client and the game
// server agree on. Imported by both sides (src/netgame.js, src/online.js, server/*.js, tools/netbot.mjs)
// so the two can't drift. Bump PROTOCOL_VERSION on any wire change: a client with another version is
// refused with a friendly "please refresh" (err code 'version').
//
// Wire: one reliable/unreliable JSON channel ({ t: <type>, ... }) + raw binary frames for the two hot
// paths — the server's SNAPSHOT (20 Hz, unreliable) and the client's own kart STATE (30 Hz,
// unreliable). Over geckos.io the JSON goes through channel.emit('m', …) (reliable = resent `runs`
// times, deduped by geckos), binary through channel.raw; over the WebSocket fallback JSON = text
// frames, binary = binary frames (everything reliable + ordered there).
//
// See DESIGN.md "Online" for the model: each human simulates their OWN kart locally with the exact
// single-player physics and reports it; the server runs everything else (bots, items, laps, results).

export const PROTOCOL_VERSION = 1;

/** Production game server (HTTP/WS through the Cloudflare tunnel; WebRTC UDP straight to the box). */
export const PROD_SERVER = 'https://orion3-net.advicedawg.com';
export const DEFAULT_PORTS = { http: 8955, udp: 8956 };

export const NET = {
  TICK_HZ: 60,
  SNAP_EVERY: 3,          // server steps per snapshot → 20 Hz
  STATE_HZ: 30,           // client → server own-kart reports
  INTERP: 0.1,            // s of snapshot-interpolation buffer behind the (latency-shifted) stream clock
  EXTRAP_MAX: 0.25,       // s a remote kart may be extrapolated when snapshots stop coming
  MAX_HUMANS: 4,          // per lobby; bots fill the rest of the 8-kart grid
  KARTS: 8,
  WAIT_S: 12,             // waiting-for-racers window once the first racer has picked
  WAIT_FULL_S: 3,         // …shortened to this when all 4 humans are in and picked
  LOAD_S: 4,              // 'start' is announced this long before the countdown begins (load + warm-up)
  RESULTS_S: 10,          // results on screen before the next race is announced
  STALE_S: 12,            // no packets from a member for this long = gone
  RACE_CAP_PAD: 75,       // hard cap = laps × 100 s + this (an AFK human can't hold a lobby forever)
  HUMAN_SLOTS: [6, 7, 4, 5, 2, 3, 0, 1],   // grid slots humans take in join order (mid-pack, like 1P's slot 6)
  PING_MS: 1000,
};

/** The permanent public lobbies. Difficulty drives the bots (ai.js DIFFICULTY) and the item mercy. */
export const LOBBIES = [
  { id: 'easy', diff: 'easy', name: 'EASY' },
  { id: 'medium', diff: 'medium', name: 'MEDIUM' },
  { id: 'hard', diff: 'hard', name: 'HARD' },
];
/** Track rotation between races (Star Road is in: online racing is its own reward). */
export const ROTATION = ['beach', 'ice', 'volcano', 'castle', 'star'];

/** JSON message types. c→s: client to server, s→c: server to client. */
export const MSG = {
  HELLO: 'hello',         // c→s { v }                        → WELCOME or ERR 'version'
  WELCOME: 'welcome',     // s→c { v, id, t (server ms), lobbies }
  LOBBIES: 'lobbies',     // s→c { list } (1 Hz while not in a lobby; c→s = ask now)
  JOIN: 'join',           // c→s { lobby }                    → LOBBY or ERR 'full' / 'nolobby'
  PICK: 'pick',           // c→s { racer }                    → LOBBY (your racer set) or ERR 'taken'
  LEAVE: 'leave',         // c→s {}
  LOBBY: 'lobby',         // s→c { seq, lobby: lobbyState }   (on every change; seq orders them)
  START: 'start',         // s→c { raceSeq, track, seed, diff, laps, grid, humans, goAt (server ms), you (slot | -1 = spectate), st }
  EV: 'ev',               // s→c { raceSeq, list: [encoded events] } (batched per snapshot, reliable)
  USE: 'use',             // c→s { raceSeq, back }            (use/fire the held item; server decides)
  PING: 'ping',           // c→s { ct }
  PONG: 'pong',           // s→c { ct, st }
  ERR: 'err',             // s→c { code, msg }
};
export const ERR_TEXT = {
  version: 'A new version of the game is out — please refresh the page!',
  full: 'That lobby is full (4 racers). Try another one!',
  taken: 'Someone just picked that racer — choose another!',
  nolobby: 'That lobby has gone. Pick another one!',
  busy: 'The online track is busy right now — try again soon!',
};

/** Racer roster (ids + stats) from src/racers.js source text (it imports THREE, so node can't import it).
 *  Same parser as tools/balance.js. Browser code uses racers.js RACERS directly. */
export function rosterFromSource(src) {
  const out = [];
  for (const m of src.matchAll(/id:\s*'(\w+)'.*?stats:\s*\{\s*speed:\s*(\d)\s*,\s*accel:\s*(\d)\s*,\s*turn:\s*(\d)\s*\}/g))
    out.push({ id: m[1], stats: { speed: +m[2], accel: +m[3], turn: +m[4] } });
  if (out.length !== 8) throw new Error(`racers.js roster parse found ${out.length} racers`);
  return out;
}

/* =========================================================================== codes */
export const ITEM_CODES = [null, 'taco_bomb', 'rocket', 'tnt', 'icecream', 'shield', 'turbo', 'superstar', 'remote', 'warp', 'nitro'];
export const PROJ_KINDS = ['taco_bomb', 'rocket', 'shield_shot', 'warp'];
export const HAZ_KINDS = ['tnt', 'nitro', 'puddle'];
export const HIT_KINDS = [null, 'flip', 'spin', 'wobble'];
/** kart events relayed to other clients (sounds/fx only — nothing gameplay depends on them remotely) */
export const KEV = ['hop', 'land', 'drift_start', 'turbo1', 'turbo2', 'turbo3', 'fizzle', 'overheat', 'pad', 'hang1', 'hang2',
  'wall', 'bump', 'respawn', 'respawned', 'hit', 'shield_pop', 'start_boost'];
const KEV_I = Object.fromEntries(KEV.map((n, i) => [n, i]));
const itemCode = id => { const i = ITEM_CODES.indexOf(id ?? null); return i < 0 ? 0 : i; };

/** kart event (name, value) → [code, u8]; null if not relayed */
export function kevEncode(name, v) {
  const c = KEV_I[name];
  if (c == null) return null;
  let b = 0;
  if (name === 'land' || name === 'wall' || name === 'bump') b = Math.round(Math.max(0, Math.min(1, +v || 0)) * 255);
  else if (name === 'respawn') b = v === 'splash' ? 1 : 0;
  else if (name === 'hit') b = Math.max(0, HIT_KINDS.indexOf(v));
  return [c, b];
}
export function kevDecode(c, b) {
  const name = KEV[c];
  if (!name) return null;
  let v;
  if (name === 'land' || name === 'wall' || name === 'bump') v = b / 255;
  else if (name === 'respawn') v = b ? 'splash' : 'fall';
  else if (name === 'hit') v = HIT_KINDS[b] || 'spin';
  return [name, v];
}

/* =========================================================================== binary writer/reader */
class W {
  constructor(n = 2048) { this.b = new ArrayBuffer(n); this.v = new DataView(this.b); this.o = 0; }
  need(n) { if (this.o + n <= this.b.byteLength) return; const nb = new ArrayBuffer(Math.max(this.b.byteLength * 2, this.o + n)); new Uint8Array(nb).set(new Uint8Array(this.b)); this.b = nb; this.v = new DataView(nb); }
  u8(x) { this.need(1); this.v.setUint8(this.o, Math.max(0, Math.min(255, Math.round(x) || 0))); this.o += 1; }
  i8(x) { this.need(1); this.v.setInt8(this.o, Math.max(-127, Math.min(127, Math.round(x) || 0))); this.o += 1; }
  u16(x) { this.need(2); this.v.setUint16(this.o, Math.max(0, Math.min(65535, Math.round(x) || 0)), true); this.o += 2; }
  i16(x) { this.need(2); this.v.setInt16(this.o, Math.max(-32767, Math.min(32767, Math.round(x) || 0)), true); this.o += 2; }
  f32(x) { this.need(4); this.v.setFloat32(this.o, isFinite(x) ? x : 0, true); this.o += 4; }
  done() { return this.b.slice(0, this.o); }
}
class R {
  constructor(buf) { this.v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf instanceof ArrayBuffer ? 0 : buf.byteOffset, buf.byteLength); this.o = 0; }
  u8() { return this.v.getUint8(this.o++); }
  i8() { return this.v.getInt8(this.o++); }
  u16() { const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
  i16() { const x = this.v.getInt16(this.o, true); this.o += 2; return x; }
  f32() { const x = this.v.getFloat32(this.o, true); this.o += 4; return x; }
  get left() { return this.v.byteLength - this.o; }
}
/** node Buffer / ArrayBufferView / ArrayBuffer → ArrayBuffer-backed view the reader accepts */
export const asBytes = b => b instanceof ArrayBuffer ? b : ArrayBuffer.isView(b) ? b : new Uint8Array(b);

export const BIN = { SNAP: 1, STATE: 2 };
const INF16 = 65535;

/* =========================================================================== kart block */
// The physics part (both directions) + the server-authoritative part (snapshot only). Scales are
// chosen so every field survives a round trip well inside what anyone can see (checked by
// server/selftest.js).
function wKartPhys(w, k) {
  const drift = k.drift > 0 ? 1 : k.drift < 0 ? 2 : 0;
  w.u16((k.air ? 1 : 0) | (k.hop ? 2 : 0) | (k.onRoad ? 4 : 0) | (k.frozen ? 8 : 0) | (k.overheat ? 16 : 0) | (k.inRed ? 32 : 0) | (drift << 6));
  w.f32(k.pos.x); w.f32(k.pos.y); w.f32(k.pos.z);
  w.i16(k.yaw * 10000); w.i16(k.speed * 100); w.i16(k.vy * 100);
  w.u8(k.driftAngle * 200); w.u8(k.charge * 255); w.u8(Math.min(3.18, k.boostT) * 80);
  w.u8((k.boostTier & 3) | ((k.turbos & 3) << 2) | (Math.max(0, HIT_KINDS.indexOf(k.hitKind)) << 4));
  w.i8(k.steer * 127); w.u8(k.throttle * 255);
  w.u8(Math.min(5.1, k.airT) * 50); w.u8(Math.min(5.1, k.landT) * 50);
  w.u8(Math.min(1.27, k.hitT) * 200); w.u8(Math.min(1.27, k.hitDur) * 200); w.u8(Math.min(1.27, k.spinT) * 200);
  w.u8(Math.min(1.27, k.respawnT) * 200); w.u16(k.respawnAt == null ? INF16 : k.respawnAt * 2);
  w.i8((k.nrm?.x || 0) * 127); w.i8((k.nrm?.z || 0) * 127);
  w.i16(isFinite(k.ground) ? (k.pos.y - k.ground) * 100 : 32767);
  w.u16((k.s || 0) * 2); w.i16((k.lat || 0) * 100);
}
function rKartPhys(r, o) {
  const f = r.u16();
  o.air = !!(f & 1); o.hop = !!(f & 2); o.onRoad = !!(f & 4); o.frozen = !!(f & 8); o.overheat = !!(f & 16); o.inRed = !!(f & 32);
  const d = (f >> 6) & 3; o.drift = d === 1 ? 1 : d === 2 ? -1 : 0;
  o.x = r.f32(); o.y = r.f32(); o.z = r.f32();
  o.yaw = r.i16() / 10000; o.speed = r.i16() / 100; o.vy = r.i16() / 100;
  o.driftAngle = r.u8() / 200; o.charge = r.u8() / 255; o.boostT = r.u8() / 80;
  const bt = r.u8(); o.boostTier = bt & 3; o.turbos = (bt >> 2) & 3; o.hitKind = HIT_KINDS[(bt >> 4) & 3];
  o.steer = r.i8() / 127; o.throttle = r.u8() / 255;
  o.airT = r.u8() / 50; o.landT = r.u8() / 50;
  o.hitT = r.u8() / 200; o.hitDur = r.u8() / 200 || 1; o.spinT = r.u8() / 200;
  o.respawnT = r.u8() / 200; const ra = r.u16(); o.respawnAt = ra === INF16 ? null : ra / 2;
  o.nx = r.i8() / 127; o.nz = r.i8() / 127;
  const dg = r.i16(); o.dg = dg === 32767 ? null : dg / 100;
  o.s = r.u16() / 2; o.lat = r.i16() / 100;
  return o;
}
function wKartAuth(w, k, human) {
  const tn = k.tnt;
  w.u8((k.finished ? 1 : 0) | (k.shieldArmed ? 2 : 0) | (tn ? 4 : 0) | (human ? 8 : 0) | (k.bomb && k.bomb.alive ? 16 : 0) | (k.estimated ? 32 : 0));
  w.u8(Math.min(5.1, k.slowT) * 50); w.u8(Math.min(15.9, k.shieldT) * 16); w.u8(Math.min(15.9, k.invincT) * 16);
  w.u8(k.stars); w.u8(itemCode(k.item)); w.u8(k.itemCount); w.u8(Math.min(2.55, k.roulT || 0) * 100); w.u8(Math.min(2.55, k.roulDur || 1.5) * 100);
  w.u8(k.lockedBy || 0); w.u16(isFinite(k.lockDist) ? Math.min(6553, k.lockDist) * 10 : INF16);
  w.u8(k.lap); w.u8(k.lapsDone); w.u8(k.place);
  if (tn) { w.u8(Math.max(0, tn.t) * 50); w.u8(tn.hops); w.u8(tn.need); }
}
function rKartAuth(r, o) {
  const f = r.u8();
  o.finished = !!(f & 1); o.shieldArmed = !!(f & 2); o.human = !!(f & 8); o.bombAlive = !!(f & 16); o.estimated = !!(f & 32);
  o.slowT = r.u8() / 50; o.shieldT = r.u8() / 16; o.invincT = r.u8() / 16;
  o.stars = r.u8(); o.item = ITEM_CODES[r.u8()] ?? null; o.itemCount = r.u8(); o.roulT = r.u8() / 100; o.roulDur = r.u8() / 100 || 1.5;
  o.lockedBy = r.u8(); const ld = r.u16(); o.lockDist = ld === INF16 ? Infinity : ld / 10;
  o.lap = r.u8(); o.lapsDone = r.u8(); o.place = r.u8();
  o.tnt = f & 4 ? { t: r.u8() / 50, hops: r.u8(), need: r.u8() } : null;
  return o;
}
function wEvs(w, evs) {
  const n = Math.min(12, evs?.length || 0);
  w.u8(n);
  for (let i = evs.length - n; i < evs.length; i++) { const e = evs[i]; w.u16(e.seq & 0xffff); w.u8(e.c); w.u8(e.b); }
}
function rEvs(r) {
  const n = r.u8(), out = [];
  for (let i = 0; i < n; i++) out.push({ seq: r.u16(), c: r.u8(), b: r.u8() });
  return out;
}

/* =========================================================================== snapshot (s→c) */
/**
 * encodeSnapshot({ seq, raceSeq, t, phase, karts, humanSet, evs, W })
 *  karts: race.karts; humanSet: Set of kart indexes that are humans; evs: per kart index, recent relayed
 *  kart events [{seq, c, b}]; W: the items world (boxes/stars alive bits, projs, hazards, spills).
 */
export function encodeSnapshot({ seq, raceSeq, t, phase, karts, humanSet, evs, W: Wd }) {
  const w = new W(1600);
  w.u8(BIN.SNAP); w.u8(PROTOCOL_VERSION); w.u16(seq); w.u16(raceSeq); w.f32(t);
  w.u8(phase === 'countdown' ? 0 : phase === 'race' ? 1 : 2);
  w.u8(karts.length);
  for (const k of karts) { wKartPhys(w, k); wKartAuth(w, k, humanSet?.has(k.index)); wEvs(w, evs?.[k.index] || []); }
  const projs = Wd ? Wd.projs.filter(p => p.alive) : [];
  w.u8(Math.min(40, projs.length));
  for (const p of projs.slice(0, 40)) {
    w.u16(p.id); w.u8(PROJ_KINDS.indexOf(p.kind) | (p.super ? 16 : 0) | (p.v < 0 ? 32 : 0)); w.u8(p.owner?.index ?? 255);
    w.f32(p.x); w.f32(p.y); w.f32(p.z); w.i16(p.yaw * 10000); w.u16(p.s * 2); w.i16(p.lat * 100);
    w.u8(Math.min(12.7, p.t) * 20); w.u8(Math.min(12.7, p.blast || p.r || 0) * 20); w.u8(p.target ? p.target.index : 255);
  }
  const haz = Wd ? Wd.hazards.filter(h => h.alive) : [];
  w.u8(Math.min(40, haz.length));
  for (const h of haz.slice(0, 40)) {
    w.u16(h.id); w.u8(HAZ_KINDS.indexOf(h.kind) | (h.super ? 16 : 0)); w.u8(h.owner?.index ?? 255);
    w.f32(h.x); w.f32(h.y); w.f32(h.z); w.u8(h.r * 20); w.u8(Math.min(255, h.t * 4)); w.u8(Math.min(5, h.drop) * 50);
    w.u16(h.s * 2); w.i16(h.lat * 100);
  }
  const sp = Wd ? Wd.spills : [];
  w.u8(Math.min(48, sp.length));
  for (const s of sp.slice(0, 48)) {
    w.u16(s.id); w.f32(s.x); w.f32(s.y); w.f32(s.z); w.u8((s.rest ? 1 : 0)); w.u8(Math.min(12.7, s.t) * 20); w.u8(s.from?.index ?? 255);
    w.i16((s.lat || 0) * 100);
  }
  const bits = (arr) => { const n = Math.ceil(arr.length / 8); w.u8(n); for (let i = 0; i < n; i++) { let b = 0; for (let j = 0; j < 8; j++) if (arr[i * 8 + j]?.alive) b |= 1 << j; w.u8(b); } };
  bits(Wd ? Wd.boxes : []); bits(Wd ? Wd.stars : []);
  return w.done();
}
export function decodeSnapshot(buf) {
  const r = new R(buf);
  if (r.u8() !== BIN.SNAP) return null;
  const ver = r.u8();
  if (ver !== (PROTOCOL_VERSION & 255)) return { badVersion: ver };
  const s = { seq: r.u16(), raceSeq: r.u16(), t: r.f32(), phase: ['countdown', 'race', 'done'][r.u8()] || 'race', karts: [], projs: [], hazards: [], spills: [], boxes: [], stars: [] };
  const n = r.u8();
  for (let i = 0; i < n; i++) { const o = rKartPhys(r, { i }); rKartAuth(r, o); o.evs = rEvs(r); s.karts.push(o); }
  const np = r.u8();
  for (let i = 0; i < np; i++) {
    const id = r.u16(), kb = r.u8(), owner = r.u8();
    s.projs.push({ id, kind: PROJ_KINDS[kb & 15], super: !!(kb & 16), back: !!(kb & 32), owner, x: r.f32(), y: r.f32(), z: r.f32(), yaw: r.i16() / 10000, s: r.u16() / 2, lat: r.i16() / 100, t: r.u8() / 20, blast: r.u8() / 20, target: r.u8() });
  }
  const nh = r.u8();
  for (let i = 0; i < nh; i++) {
    const id = r.u16(), kb = r.u8(), owner = r.u8();
    s.hazards.push({ id, kind: HAZ_KINDS[kb & 15], super: !!(kb & 16), owner, x: r.f32(), y: r.f32(), z: r.f32(), r: r.u8() / 20, t: r.u8() / 4, drop: r.u8() / 50, s: r.u16() / 2, lat: r.i16() / 100 });
  }
  const ns = r.u8();
  for (let i = 0; i < ns; i++) s.spills.push({ id: r.u16(), x: r.f32(), y: r.f32(), z: r.f32(), rest: !!(r.u8() & 1), t: r.u8() / 20, from: r.u8(), lat: r.i16() / 100 });
  const bits = () => { const n = r.u8(), out = []; for (let i = 0; i < n; i++) { const b = r.u8(); for (let j = 0; j < 8; j++) out.push(!!(b & (1 << j))); } return out; };
  s.boxes = bits(); s.stars = bits();
  return s;
}

/* =========================================================================== own-kart state (c→s) */
/** encodeState({ seq, raceSeq, rt (client race.t), kart, hops (running count), evs }) */
export function encodeState({ seq, raceSeq, rt, kart, hops, evs }) {
  const w = new W(160);
  w.u8(BIN.STATE); w.u8(PROTOCOL_VERSION); w.u16(seq); w.u16(raceSeq); w.f32(rt);
  wKartPhys(w, kart); w.u16(kart.si >= 0 ? kart.si : 0); w.u16(hops & 0xffff);
  wEvs(w, evs || []);
  return w.done();
}
export function decodeState(buf) {
  const r = new R(buf);
  if (r.u8() !== BIN.STATE) return null;
  const ver = r.u8();
  if (ver !== (PROTOCOL_VERSION & 255)) return { badVersion: ver };
  const o = { seq: r.u16(), raceSeq: r.u16(), rt: r.f32() };
  rKartPhys(r, o); o.si = r.u16(); o.hops = r.u16(); o.evs = rEvs(r);
  return o;
}
/** first byte of a binary frame (BIN.*) or 0 */
export const binType = buf => { try { return new R(buf).u8(); } catch { return 0; } };

/* =========================================================================== events (reliable JSON) */
// Race/item events carry kart REFERENCES in the sim (`kart`, `by`, `target`, `from`); on the wire they
// are kart indexes. Positions are rounded to cm.
const REF_KEYS = ['kart', 'by', 'target', 'from'];
const rd = v => Math.round(v * 100) / 100;
export function encodeEvent(e, t) {
  const o = { type: e.type, t: Math.round(t * 1000) / 1000 };
  for (const [key, v] of Object.entries(e)) {
    if (key === 'type') continue;
    if (REF_KEYS.includes(key)) { o[key] = v && typeof v === 'object' ? v.index : v ?? null; continue; }
    if (key === 'pos' && v) { o.pos = [rd(v.x), rd(v.y), rd(v.z)]; continue; }
    if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') o[key] = typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  }
  return o;
}
export function decodeEvent(o, karts) {
  const e = { ...o };
  for (const key of REF_KEYS) if (key in e) e[key] = e[key] == null ? null : karts[e[key]] || null;
  if (Array.isArray(o.pos)) e.pos = { x: o.pos[0], y: o.pos[1], z: o.pos[2] };
  return e;
}
/** Which race events the server forwards (item events always; kart events go in snapshots). */
export const RELAY_RACE_EVENTS = new Set(['lap', 'final_lap', 'finish', 'race_done']);
