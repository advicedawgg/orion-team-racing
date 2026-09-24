// netgame.js — PURE (no THREE, no DOM): the client half of an online race. The browser (online.js via
// main.js hooks) and the headless test client (tools/netbot.mjs) both drive exactly this.
//
// The client builds a NORMAL race with createRace (+ createItems) for the grid the server sent, then
// attach(race) turns it into a network race:
//   • my kart (START.you) is simulated locally by race.step with the exact single-player physics —
//     zero input lag, never corrected; every other kart is `remote` and race.netClient = true (race.js
//     then skips their physics and all laps / positions / the finish — the server's are mirrored in);
//   • preStep() before every race.step: remote karts (bots + other humans) are set from SNAPSHOT
//     INTERPOLATION (~100 ms behind the latency-shifted snapshot stream, extrapolated ≤ 250 ms when
//     snapshots stop), the items world is a mirror (items.js W.mirror: boxes/stars/projectiles/hazards/
//     spills come from the snapshot), my kart's server-owned fields (stars, item, roulette, shield, TNT,
//     lap, place …) are copied from the newest snapshot, and queued server events are released — events
//     about other karts when the interpolated view reaches them, events about me at once;
//   • an injector system (first in race.systems) pushes those events into race.events inside the step,
//     so main.js / hud.js / itemviews.js react exactly as in single player, and applies the ones that
//     change MY kart locally: a hit (applyHit), a Turbo Rocket (addBoost), finishing, laps;
//   • postStep() records my kart's hops + cosmetic events and edge-detects the item button (→ onUse);
//     statePacket() is my kart for the server (30 Hz, unreliable).
// A spectator (START.you = -1) gets a race where EVERY kart is remote and race.player is the kart being
// watched (follow(i) switches it).
import { DT, applyHit, addBoost } from './physics.js';
import { IT } from './items.js';
import { NET, decodeSnapshot, decodeEvent, encodeState, kevEncode, kevDecode } from './protocol.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAng = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const canAct = k => !k.finished && k.respawnT <= 0 && k.hitT <= 0 && k.spinT <= 0 && !k.frozen;
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class NetRace {
  /** start: the START message; clock: { serverNow() → server ms }; onUse({ back }) called on an item press */
  constructor({ start, clock, onUse = null, now = perfNow }) {
    this.start = start; this.clock = clock; this.onUse = onUse; this.now = now;
    this.raceSeq = start.raceSeq; this.slot = start.you ?? -1; this.spectating = this.slot < 0;
    this.humanSlots = new Set((start.humans || []).map(h => h.slot));
    this.snaps = []; this.newest = null; this.meSnapSeq = -1;
    this.evQ = []; this.ready = [];
    this.recvOff = null; this.offWin = [];
    this.prevRT = -Infinity; this.renderT = 0;
    this.projMap = new Map(); this.hazMap = new Map(); this.spillMap = new Map();
    this.kevSeen = new Map();
    this.hops = 0; this.myEvs = []; this.evSeq = 0; this.stateSeq = 0; this._iPrev = false;
    this.stats = { snaps: 0, snapGaps: [], lastSnapAt: 0, extrap: 0, starved: 0, steps: 0, events: 0, eventsLate: 0, hitsOnMe: 0, sent: 0, lateSnaps: 0 };
  }

  /* ------------------------------------------------------------------ setup */
  attach(race) {
    this.race = race;
    race.netClient = true;
    const W = race.items; if (W) W.mirror = true;
    this.me = this.slot >= 0 ? race.karts[this.slot] : null;
    for (const k of race.karts) { k.remote = k !== this.me; k.netHuman = this.humanSlots.has(k.index); }
    if (this.spectating) this.follow(race.player ? race.player.index : 0);
    race.t = this.targetT();
    if (race.t > 0.05) { race.phase = 'race'; for (const k of race.karts) { k.frozen = false; k._sb = true; } }   // joined mid-race: no GO
    race.systems.unshift(r => this.inject(r));
    return this;
  }
  /** race time the server is at now (the countdown / GO / start boost run on this) */
  targetT() { return (this.clock.serverNow() - this.start.goAt) / 1000; }
  /** spectator: watch kart i (race.player/humans point at it; it's never "me" for banners/sounds) */
  follow(i) {
    const race = this.race; if (!race || !this.spectating) return null;
    const n = race.karts.length; i = ((i % n) + n) % n;
    const k = race.karts[i];
    race.player = k; race.playerIndex = i; race.humans = [k];
    for (const o of race.karts) { o.isPlayer = false; o.pn = o === k ? 0 : -1; }
    this.followIdx = i;
    return k;
  }

  /* ------------------------------------------------------------------ incoming */
  onSnapshot(buf, localMs = this.now()) {
    let s; try { s = decodeSnapshot(buf); } catch { return; }
    if (!s || s.badVersion != null || s.raceSeq !== this.raceSeq) return;
    const st = this.stats;
    if (st.lastSnapAt) st.snapGaps.push(localMs - st.lastSnapAt); if (st.snapGaps.length > 200) st.snapGaps.splice(0, 100);
    st.lastSnapAt = localMs; st.snaps++;
    // the stream clock: fastest (recv − server t) over the last ~2 s
    const sample = localMs / 1000 - s.t;
    this.offWin.push(sample); if (this.offWin.length > 60) this.offWin.shift();
    const target = Math.min(...this.offWin);
    // slew the render clock: 1 ms per snapshot (the view runs ≤ 2 % fast/slow — invisible); 4 ms steps
    // showed up as ~9 cm hitches on every remote kart. Faster only when far off or starving.
    const starving = this.newest && localMs / 1000 - (this.recvOff ?? 0) - NET.INTERP > this.newest.t + 0.03;
    const cap = this.recvOff == null ? Infinity : Math.abs(target - this.recvOff) > 0.06 || starving ? 0.01 : 0.001;
    if (this.recvOff == null) this.recvOff = target;
    else this.recvOff += Math.max(-cap, Math.min(cap, target - this.recvOff));
    if (this.newest && s.t < this.newest.t) st.lateSnaps++;
    // insert in time order, drop duplicates
    const arr = this.snaps;
    if (arr.some(x => x.seq === s.seq)) return;
    let i = arr.length; while (i > 0 && arr[i - 1].t > s.t) i--;
    arr.splice(i, 0, s);
    if (arr.length > 40) arr.splice(0, arr.length - 40);
    if (!this.newest || s.t >= this.newest.t) this.newest = s;
  }
  onEvents(msg) {
    if (msg.raceSeq !== this.raceSeq) return;
    for (const o of msg.list) { o._at = this.now(); this.evQ.push(o); }
  }

  /* ------------------------------------------------------------------ per step */
  mine(o) { return this.slot >= 0 && (o.kart === this.slot || o.by === this.slot || o.target === this.slot); }
  preStep() {
    const race = this.race; if (!race) return;
    const nowMs = this.now();
    // Render time for remote karts. The snapshot stream says how far behind "now" the view must sit
    // (recvOff + INTERP); the view itself advances with MY SIM CLOCK — exactly DT per step — so a frame
    // that runs 0 or 2 steps (main.js's vsync accumulator does) moves remote karts exactly like mine.
    // Wall-clock render time made those frames hitch every remote kart by ~35 cm (tools/net-interp.mjs).
    let rT = -Infinity;
    if (this.recvOff != null) {
      const simT = race.t + DT, d = simT - (nowMs / 1000 - this.recvOff - NET.INTERP);
      if (this.delay == null || Math.abs(d - this.delay) > 0.25) this.delay = d;
      else this.delay += Math.max(-0.0005, Math.min(0.0005, d - this.delay));
      rT = simT - this.delay;
    }
    this.renderT = rT; this.stats.steps++;
    const S = this.snaps;
    if (S.length) {
      // the pair around the render time
      let a = S[0], b = S[0], al = 0;
      if (rT <= S[0].t) { a = b = S[0]; }
      else if (rT >= S[S.length - 1].t) { a = b = S[S.length - 1]; this.stats.extrap++; }
      else for (let i = 0; i < S.length - 1; i++) if (S[i].t <= rT && rT < S[i + 1].t) { a = S[i]; b = S[i + 1]; al = (rT - a.t) / Math.max(1e-6, b.t - a.t); break; }
      const ext = a === b && rT > a.t ? Math.min(NET.EXTRAP_MAX, rT - a.t) : 0;
      if (a === b && rT - a.t > NET.EXTRAP_MAX) this.stats.starved++;
      for (const k of race.karts) if (k !== this.me) this.setKart(k, a.karts[k.index], b.karts[k.index], al, ext, b.t - a.t);
      this.mirrorItems(a, b, al);
      // cosmetic kart events from snapshots the view has now passed
      for (const s of S) if (s.t > this.prevRT && s.t <= rT) for (const ks of s.karts) {
        const k = race.karts[ks.i]; if (!k || k === this.me) continue;
        for (const e of ks.evs) {
          const last = this.kevSeen.get(k.index);
          if (last != null && (((e.seq - last) & 0xffff) === 0 || ((e.seq - last) & 0xffff) >= 0x8000)) continue;
          this.kevSeen.set(k.index, e.seq);
          const d = kevDecode(e.c, e.b); if (d) k.ev.push(d[1] === undefined ? d[0] : d);
        }
      }
      if (rT > this.prevRT) this.prevRT = rT;
      // my kart: the server's fields, from the newest snapshot, once per snapshot
      if (this.me && this.newest && this.newest.seq !== this.meSnapSeq) { this.meSnapSeq = this.newest.seq; this.mirrorMe(this.newest.karts[this.slot]); }
      // positions (server's): keep race.order sorted by place
      race.order.sort((x, y) => (x.place || 9) - (y.place || 9));
    }
    if (this.me) {   // local countdowns between snapshots so the HUD's roulette / TNT digits move smoothly
      const m = this.me;
      if (m.roulT > 0) m.roulT = Math.max(0, m.roulT - DT);
      if (m.tnt) m.tnt.t = Math.max(0, m.tnt.t - DT);
    }
    if (race.items) race.items.t += DT;
    // release events: mine at once, the rest when the interpolated view reaches them (or after 1 s)
    for (let i = 0; i < this.evQ.length; i++) {
      const o = this.evQ[i];
      if (this.mine(o) || o.type === 'race_done' || o.type === 'lap' || o.type === 'finish' || o.t <= rT || nowMs - o._at > 1000) {
        if (nowMs - o._at > 1000 && !(o.t <= rT)) this.stats.eventsLate++;
        this.ready.push(decodeEvent(o, race.karts)); this.evQ.splice(i--, 1);
      }
    }
  }
  /** remote kart k ← interpolation of snapshot entries a → b at al (+ ext s of extrapolation). x/z use a
   *  cubic Hermite through both snapshots' velocities (speed along yaw): linear interpolation left a kink
   *  every 50 ms on curves (tools/online-test.mjs measures the drawn-position jitter). */
  setKart(k, a, b, al, ext, span = 0.05) {
    if (!a || !b) return;
    k.ev.length = 0;
    const d = al < 0.5 ? a : b;
    const far = Math.hypot(b.x - a.x, b.z - a.z) > 25;           // a respawn/teleport: don't streak across the map
    const t = far ? (al < 0.5 ? 0 : 1) : al;
    if (!far && a !== b && span > 0 && span < 0.3 && a.respawnT <= 0 && b.respawnT <= 0) {
      const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      const vax = Math.sin(a.yaw) * a.speed * span, vaz = Math.cos(a.yaw) * a.speed * span, vbx = Math.sin(b.yaw) * b.speed * span, vbz = Math.cos(b.yaw) * b.speed * span;
      k.pos.x = h00 * a.x + h10 * vax + h01 * b.x + h11 * vbx; k.pos.z = h00 * a.z + h10 * vaz + h01 * b.z + h11 * vbz;
    } else { k.pos.x = lerp(a.x, b.x, t); k.pos.z = lerp(a.z, b.z, t); }
    k.pos.y = lerp(a.y, b.y, t);
    k.yaw = lerpAng(a.yaw, b.yaw, t); k.speed = lerp(a.speed, b.speed, t); k.vy = lerp(a.vy, b.vy, t);
    if (ext > 0 && !d.frozen && d.respawnT <= 0) { k.pos.x += Math.sin(k.yaw) * k.speed * ext; k.pos.z += Math.cos(k.yaw) * k.speed * ext; if (d.air) k.pos.y += k.vy * ext - 15 * ext * ext; }
    k.vel.x = Math.sin(k.yaw) * k.speed; k.vel.z = Math.cos(k.yaw) * k.speed; k.vel.y = d.air ? k.vy : 0; k.push.x = k.push.z = 0;
    k.driftAngle = lerp(a.driftAngle, b.driftAngle, t); k.charge = lerp(a.charge, b.charge, t); k.boostT = lerp(a.boostT, b.boostT, t);
    k.steer = lerp(a.steer, b.steer, t); k.throttle = lerp(a.throttle, b.throttle, t);
    k.airT = lerp(a.airT, b.airT, t); k.landT = lerp(a.landT, b.landT, t);
    k.hitT = b.hitT > a.hitT ? d.hitT : lerp(a.hitT, b.hitT, t); k.spinT = b.spinT > a.spinT ? d.spinT : lerp(a.spinT, b.spinT, t);
    k.hitDur = d.hitDur; k.hitKind = d.hitKind;
    k.respawnT = b.respawnT > a.respawnT ? d.respawnT : lerp(a.respawnT, b.respawnT, t); k.respawnAt = d.respawnAt;
    k.slowT = lerp(a.slowT, b.slowT, t); k.shieldT = lerp(a.shieldT, b.shieldT, t); k.invincT = lerp(a.invincT, b.invincT, t);
    k.air = d.air; k.hop = d.hop; k.onRoad = d.onRoad; k.frozen = d.frozen; k.overheat = d.overheat; k.inRed = d.inRed; k.drift = d.drift;
    k.boostTier = d.boostTier; k.turbos = d.turbos; k.shieldArmed = d.shieldArmed;
    const nx = lerp(a.nx, b.nx, t), nz = lerp(a.nz, b.nz, t);
    k.nrm.x = nx; k.nrm.z = nz; k.nrm.y = Math.sqrt(Math.max(0.1, 1 - nx * nx - nz * nz));
    k.ground = d.dg == null ? -Infinity : k.pos.y - lerp(a.dg ?? d.dg, b.dg ?? d.dg, t);
    k.s = lerp(a.s, b.s, Math.abs(b.s - a.s) > 100 ? (t < 0.5 ? 0 : 1) : t); k.lat = lerp(a.lat, b.lat, t);
    const tr = this.race.track; k.si = tr.idx(k.s);
    this.auth(k, d);
  }
  /** server-owned fields of a kart (items, stars, laps, place …) */
  auth(k, d) {
    k.stars = d.stars; k.item = d.item; k.itemCount = d.itemCount; k.roulT = d.roulT; k.roulDur = d.roulDur;
    k.lockedBy = d.lockedBy; k.lockDist = d.lockDist; k.tnt = d.tnt ? { ...d.tnt } : null;
    k.bomb = d.bombAlive ? (k.bomb?.alive ? k.bomb : { alive: true }) : null;
    k.lap = d.lap || 1; k.lapsDone = d.lapsDone; k.place = d.place || k.place;
    if (d.finished && !k.finished) { k.finished = true; k.estimated = d.estimated; }
  }
  mirrorMe(d) {
    if (!d) return;
    const k = this.me;
    this.auth(k, d);
    k.shieldT = d.shieldT; k.shieldArmed = d.shieldArmed; k.invincT = d.invincT; k.slowT = d.slowT;
  }
  mirrorItems(a, b, al) {
    const W = this.race.items; if (!W) return;
    const d = al < 0.5 ? a : b, K = this.race.karts;
    for (let i = 0; i < W.boxes.length; i++) { const bx = W.boxes[i], alive = !!d.boxes[i]; if (alive && !bx.alive) bx.bornT = W.t; if (!alive && bx.alive) bx.respawnT = IT.BOX_RESPAWN; bx.alive = alive; }
    for (let i = 0; i < W.stars.length; i++) { const st = W.stars[i], alive = !!d.stars[i]; if (alive && !st.alive) st.bornT = W.t; st.alive = alive; }
    const sync = (map, la, lb, mk, set) => {
      const bi = new Map(lb.map(o => [o.id, o])), out = [];
      for (const oa of la) {
        const ob = bi.get(oa.id);
        if (!ob && al >= 0.5 && a !== b) continue;            // gone by b: drop it half way
        let o = map.get(oa.id); const fresh = !o;
        if (fresh) { o = mk(oa); map.set(oa.id, o); }
        set(o, oa, ob || oa, ob ? al : 0, fresh);
        out.push(o);
      }
      const live = new Set(out.map(o => o.id));
      for (const id of map.keys()) if (!live.has(id)) map.delete(id);
      return out;
    };
    W.projs = sync(this.projMap, a.projs, b.projs, o => ({ id: o.id, kind: o.kind, alive: true, px: o.x, py: o.y, pz: o.z, x: o.x, y: o.y, z: o.z }), (p, oa, ob, t, fresh) => {
      if (!fresh) { p.px = p.x; p.py = p.y; p.pz = p.z; }
      p.x = lerp(oa.x, ob.x, t); p.y = lerp(oa.y, ob.y, t); p.z = lerp(oa.z, ob.z, t); p.yaw = lerpAng(oa.yaw, ob.yaw, t);
      if (fresh) { p.px = p.x; p.py = p.y; p.pz = p.z; }
      p.t = lerp(oa.t, ob.t, t); p.super = oa.super; p.kind = oa.kind; p.alive = true;
      p.s = lerp(oa.s, ob.s, Math.abs(ob.s - oa.s) > 100 ? 0 : t); p.lat = lerp(oa.lat, ob.lat, t); p.v = oa.back ? -1 : 1;
      p.owner = K[oa.owner] || null; p.target = K[oa.target] || null; p.blast = oa.blast; p.r = oa.blast;
    });
    W.hazards = sync(this.hazMap, a.hazards, b.hazards, o => ({ id: o.id, kind: o.kind, alive: true }), (h, oa, ob, t) => {
      h.x = oa.x; h.y = oa.y; h.z = oa.z; h.r = oa.r; h.t = lerp(oa.t, ob.t, t); h.drop = lerp(oa.drop, ob.drop, t);
      h.kind = oa.kind; h.super = oa.super; h.owner = K[oa.owner] || null; h.s = oa.s; h.lat = oa.lat; h.alive = true;
    });
    W.spills = sync(this.spillMap, a.spills, b.spills, o => ({ id: o.id, life: IT.SPILL.life, si: -1 }), (sp, oa, ob, t) => {
      sp.x = lerp(oa.x, ob.x, t); sp.y = lerp(oa.y, ob.y, t); sp.z = lerp(oa.z, ob.z, t); sp.rest = ob.rest; sp.t = lerp(oa.t, ob.t, t);
      sp.lat = oa.lat; sp.from = K[oa.from] || null;
    });
  }

  /** the first system of every race.step: server events into race.events (+ what they do to MY kart) */
  inject(race) {
    if (!this.ready.length) return;
    const me = this.me;
    for (const e of this.ready.splice(0)) {
      this.stats.events++;
      const k = e.kart;
      if (e.type === 'item') {
        if (k && k === me) {
          switch (e.e) {
            case 'hit':
              if (e.kind === 'wobble') { applyHit(me, 'wobble'); me.slowT = Math.max(me.slowT, e.item === 'remote' ? IT.REMOTE.t : 3); }
              else { me.shieldT = 0; me.invincT = 0; applyHit(me, e.kind || 'spin'); }
              this.stats.hitsOnMe++;
              break;
            case 'use': if (e.item === 'turbo') addBoost(me, e.super ? IT.TURBO.tSuper : IT.TURBO.t, 3, e.super ? IT.TURBO.kickSuper : IT.TURBO.kick); break;
            case 'super_star': me.invincT = e.t || IT.STAR.t; break;
            case 'shield_up': me.shieldT = e.super ? IT.SHIELD.tSuper : IT.SHIELD.t; me.shieldArmed = true; break;
            case 'shield_fire': me.shieldT = 0; me.shieldArmed = false; break;
            case 'got': me.item = e.item; me.itemCount = e.count; me.roulT = 0; break;
            case 'box': if (e.roulette) { me.roulT = me.roulDur = IT.ROULETTE; } break;
            case 'roulette': me.roulT = me.roulDur = IT.ROULETTE; break;
            case 'tnt_off': me.tnt = null; break;
            case 'tnt_on': me.tnt = { t: IT.TNT.fuse, hops: 0, need: IT.TNT.hops }; break;
          }
        }
        if (e.e === 'remote' && k === me) { /* everyone else wobbles: their 'hit' events carry it */ }
        race.events.push(e);
      } else if (e.type === 'lap') {
        if (k) { k.lap = e.lap; k.lapsDone = e.lap - 1; if (k === me && e.lt) { me.lapTimes.push(e.lt); me.lastLapT = e.lt; } }
        race.events.push(e);
      } else if (e.type === 'final_lap') race.events.push(e);
      else if (e.type === 'finish') {
        if (k && !k._netFinished) {
          k._netFinished = true; k.finished = true; k.finishPlace = e.place; k.finishTime = e.time; if (Array.isArray(e.laps)) k.lapTimes = e.laps.slice();
          k.lapsDone = race.laps; race.finishCount = Math.max(race.finishCount, e.place);
          if (k.isPlayer) { race.humansDone++; if (race.humansDone >= race.humans.length) race.playerDoneT = race.t; }
          race.events.push(e);
        }
      } else if (e.type === 'race_done') {
        for (const r of e.results || []) { const q = race.karts[r.i]; if (!q) continue; q.finished = true; q.finishPlace = r.place; q.place = r.place; q.finishTime = r.time; q.estimated = !!r.est; }
        race.order = race.karts.slice().sort((x, y) => x.finishPlace - y.finishPlace);
        if (race.phase !== 'done') { race.phase = 'done'; race.doneT = race.t; race.events.push({ type: 'race_done' }); }
      }
    }
  }

  /** after each race.step: my hops + cosmetic events for the server, the item button's press edge */
  postStep() {
    const race = this.race, me = this.me; if (!race || !me) return;
    for (const e of race.events) {
      if (e.type !== 'kart' || e.kart !== me) continue;
      if (e.e === 'hop') this.hops = (this.hops + 1) & 0xffff;
      const c = kevEncode(e.e, e.v);
      if (c) this.myEvs.push({ seq: (this.evSeq = (this.evSeq + 1) & 0xffff), c: c[0], b: c[1], t: race.t });
    }
    while (this.myEvs.length && this.myEvs[0].t < race.t - 0.2) this.myEvs.shift();
    const c = me.ctrl || {}, held = !!c.item;
    if (held && !this._iPrev && race.phase === 'race' && canAct(me) && (me.item || me.shieldArmed || me.bomb) && me.roulT <= 0) this.onUse?.({ back: !!(c.itemBack ?? (c.brake > 0.3)) });
    this._iPrev = held;
  }
  /** my kart for the server (binary). Call every other step (30 Hz). */
  statePacket() {
    this.stats.sent++;
    return encodeState({ seq: (this.stateSeq = (this.stateSeq + 1) & 0xffff), raceSeq: this.raceSeq, rt: this.race.t, kart: this.me, hops: this.hops, evs: this.myEvs });
  }
  /** clock discipline: returns the accumulator to use (main.js G.acc). Big errors jump, small ones slew. */
  correctClock(acc) {
    const race = this.race; if (!race) return acc;
    const err = this.targetT() - (race.t + acc);
    if (Math.abs(err) > 0.25) { race.t = this.targetT(); return 0; }
    return acc + Math.max(-0.002, Math.min(0.002, err * 0.1));
  }
  /** snapshot stats for tests/HUD: rate (Hz) and gap percentiles (ms) over the last ~200 */
  snapInfo() {
    const g = this.stats.snapGaps.slice().sort((a, b) => a - b);
    const p = q => g.length ? g[Math.min(g.length - 1, Math.floor(q * g.length))] : null;
    const mean = g.length ? g.reduce((a, b) => a + b, 0) / g.length : null;
    return { n: this.stats.snaps, hz: mean ? 1000 / mean : 0, p50: p(0.5), p95: p(0.95), max: g.length ? g[g.length - 1] : null, buffered: this.newest ? +(this.newest.t - this.renderT).toFixed(3) : null };
  }
}
