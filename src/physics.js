// physics.js — PURE kart dynamics (no THREE, no DOM). `node src/physics.js` runs the self-test.
//
// Model: an arcade kart. `yaw` is the direction of TRAVEL; `speed` is signed speed along it.
// A power slide rotates travel at the slide rate and swings the BODY out by `driftAngle`
// (render adds drift*driftAngle to yaw) — so the physics stays simple and the look is CTR.
// External shoves (walls, bumps) go into `push`, a decaying sideways velocity.
//
// Every step appends events to kart.ev (strings or [name, value]); race.js collects them
// for audio/fx. See DESIGN.md "Kart state".

import { SURFACES } from './track.js';

export const DT = 1 / 60;

/** All tuning in one table. Tests and the gate read these; don't duplicate them. */
export const T = {
  GRAV: 30,
  BASE_MAX: 22, BOOST_MAX: 30, REV_MAX: 8,
  ACC: 18, BOOST_ACC: 45, BRAKE: 30, REV_ACC: 12, COAST: 5, OVER_DECEL: 9, AIR_DRAG: 0.3,
  TURN: 2.25, TURN_FULL_V: 7, HIGH_V_TURN_LOSS: 0.2, AIR_TURN: 0.45, STEER_RATE: 7,
  HOP_V: 5.2,
  SLIDE_GRACE: 0.2,       // s after landing a hop in which you may still start the slide by steering
  DRIFT_MIN_V: 8, DRIFT_END_V: 5,
  DRIFT_BASE: 1.1, DRIFT_STEER: 1.0,    // yaw rate in a slide: base ± steer (into slide = tighter)
  DRIFT_SPEED: 0.97, DRIFT_ANGLE: 0.52,  // top speed factor; body swing (rad, ~30°)
  CHARGE_T: 0.9, RED: 0.25, RED_EASY: 0.45,
  TURBO: [null, { t: 0.6, tier: 1, kick: 2.5 }, { t: 0.8, tier: 2, kick: 3.5 }, { t: 1.1, tier: 3, kick: 5 }],
  PAD: { t: 1.0, tier: 2, kick: 5 },
  HANG1: { air: 0.5, t: 0.45, tier: 1, kick: 2.5 }, HANG2: { air: 1.0, t: 0.8, tier: 2, kick: 3.5 },
  START: { t: 1.3, tier: 2, kick: 6 },
  BOOST_CAP_T: 3.0, BOOST_BASE: 0.14, BOOST_PER_S: 0.1,
  STAR_BONUS: 0.08, STARS_SUPER: 10, STARS_MAX: 10,
  // Racer stats (1..5, 3 = neutral) → small deltas per point away from 3, tuned with tools/balance.js so a
  // point of any stat is worth about the same race time (DESIGN.md "Balance").
  STAT: 0.03,             // turn RATE per point (feel: how sharp the kart steers/slides; doesn't win races)
  STAT_SPEED: 0.03,       // speed: top speed (and boost cap) per point
  STAT_ACC: 0.03,         // accel ("ZOOM"): acceleration per point — off the line, out of hits/spins/walls/offroad
  STAT_KICK: 0,           // accel: turbo/pad kick size per point
  STAT_DRIFT: 0,          // turn: slide top-speed factor per point (high turn = keeps more speed sliding)
  STAT_GRIP: 0,           // turn: corner-scrub reduction per point (high turn = carries more speed round corners)
  CORNER: { a0: 12, a1: 32, loss: 0 },   // steering scrub: top × (1 − loss·ramp(aLat: a0→a1 m/s²)), not in a slide
  KART_R: 0.8, WALL_E: 0.25, WALL_MIN_KEEP: 0.4,
  SNAP: 0.4, RESPAWN_T: 1.2, RESPAWN_DROP: 2.5,
  HIT: { flip: { t: 1.2, keep: 0.15, stars: 3 }, spin: { t: 1.0, keep: 0.45, stars: 1 }, wobble: { t: 3.0 } },
  STALL_T: 0.8,
};

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const approach = (v, target, rate) => v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * A fresh kart. `stats` = racer stats {speed, accel, turn} (1..5, 3 = neutral).
 * opts: { easyBoost, pace (AI top-speed factor, 1 = full) }
 */
export function createKart({ racerId = 'orion', stats = { speed: 3, accel: 3, turn: 3 }, isPlayer = false, easyBoost = false, pace = 1, index = 0 } = {}) {
  return {
    index, racerId, isPlayer, stats: { speed: 3, accel: 3, turn: 3, ...stats }, easyBoost, pace,
    mass: 1 + ((stats.speed ?? 3) - 3) * 0.12,
    // motion
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, push: { x: 0, z: 0 },
    yaw: 0, speed: 0, vy: 0, steer: 0, throttle: 0,
    air: false, airT: 0, landT: 9, hop: false, hopBtn: null, slideGraceT: 0,
    nrm: { x: 0, y: 1, z: 0 }, onRoad: true, surface: 'road', ground: 0,
    // slide
    cornerF: 1, drift: 0, driftBtn: null, driftAngle: 0, charge: 0, turbos: 0, overheat: false, fizzleT: 0, inRed: false,
    // boost
    boostT: 0, boostTier: 0, boostMaxT: 0,
    // items / hits (items agent drives these through applyHit/addBoost)
    stars: 0, item: null, itemCount: 0, shieldT: 0, invincT: 0,
    hitT: 0, hitDur: 1, hitKind: null, spinT: 0, slowT: 0, stallT: 0,
    // track / race
    s: 0, si: -1, lat: 0, lap: 1, lapsDone: 0, nextCp: 0, place: 1, progress: 0,
    finished: false, finishTime: 0, lastLapT: 0, lapTimes: [], frozen: true,
    respawnT: 0, respawnAt: null, lastGoodS: 0, wallT: 0, bumpT: 0, padCool: new Map(), stuckT: 0,
    _a: false, _b: false, ev: [],
  };
}

/** Stat multiplier: 1 + per·(stat − 3). */
const statK = (v, per = T.STAT) => 1 + (clamp(v, 1, 5) - 3) * per;

/** Base (un-boosted) top speed for this kart on tarmac. */
export function baseTop(k) {
  return T.BASE_MAX * statK(k.stats.speed, T.STAT_SPEED) * (k.stars >= T.STARS_SUPER ? 1 + T.STAR_BONUS : 1) * k.pace;
}
/** Current top speed: base, raised by the boost reserve, reduced by surface/slide/wobble. */
export function topSpeed(k) {
  const base = baseTop(k);
  let v = base;
  if (k.boostT > 0) {
    const cap = T.BOOST_MAX * statK(k.stats.speed, T.STAT_SPEED) * k.pace;
    v = Math.min(cap, base * (1 + T.BOOST_BASE + T.BOOST_PER_S * Math.min(k.boostT, 2.2)));
  }
  let surf = SURFACES[k.surface] ?? 0.65;
  if (k.surface === 'gap' || k.surface === 'void') surf = 1;
  if (k.boostT > 0) surf = Math.sqrt(surf);        // a turbo powers through sand, partly
  v *= surf;
  if (k.drift) v *= Math.min(1, T.DRIFT_SPEED * statK(k.stats.turn, T.STAT_DRIFT));
  else if (k.cornerF < 1) v *= k.cornerF;           // hard steering at speed scrubs a little (turn stat: less)
  if (k.slowT > 0) v *= 0.62;
  if (k.invincT > 0) v = Math.max(v, base * 1.18);  // super star: top speed
  return v;
}

/** Add to the boost reserve. tier 1..3 (3 = purple flames). Items/pads/turbos all come through here. */
export function addBoost(k, secs, tier = 1, kick = 3) {
  const was = k.boostT;
  k.boostT = Math.min(T.BOOST_CAP_T, k.boostT + secs);
  k.boostTier = was > 0 ? Math.max(tier, k.boostTier === 3 && was > 0.3 ? 3 : tier) : tier;
  if (tier >= k.boostTier) k.boostTier = tier;
  k.boostMaxT = Math.max(k.boostT, k.boostMaxT);
  const cap = topSpeed(k);
  kick *= statK(k.stats.accel, T.STAT_KICK);
  if (k.speed < cap) k.speed = Math.min(cap, Math.max(k.speed, baseTop(k) * (k.drift ? T.DRIFT_SPEED : 1)) + kick);
}

/** Items call this. kind: 'flip' (bomb/rocket/TNT), 'spin' (puddle, star bump), 'wobble' (remote).
 *  Returns true if it landed (false if shielded/invincible). */
export function applyHit(k, kind) {
  if (k.invincT > 0 || k.respawnT > 0 || k.finished && !k.isPlayer && false) return false;
  if (k.shieldT > 0) { k.shieldT = 0; ev(k, 'shield_pop'); return false; }
  const h = T.HIT[kind] || T.HIT.spin;
  endDrift(k);
  if (kind === 'wobble') { k.slowT = h.t; ev(k, ['hit', kind]); return true; }
  k.hitKind = kind; k.hitT = h.t; k.hitDur = h.t;
  if (kind === 'flip') { k.vy = Math.max(k.vy, 7.5); k.air = true; k.hop = false; }
  else k.spinT = h.t;
  k.speed *= h.keep; k.boostT = 0; k.boostTier = 0;
  const lost = Math.min(k.stars, h.stars);
  k.stars -= lost;
  ev(k, ['hit', kind]); if (lost) ev(k, ['stars_lost', lost]);
  return true;
}

const ev = (k, e) => { k.ev.push(e); };

function endDrift(k) {
  if (k.drift) ev(k, 'drift_end');
  k.drift = 0; k.driftBtn = null; k.charge = 0; k.turbos = 0; k.overheat = false; k.inRed = false;
}
function startDrift(k, dir, btn) {
  k.drift = dir; k.driftBtn = btn; k.charge = 0; k.turbos = 0; k.overheat = false; k.inRed = false;
  ev(k, 'drift_start');
}

/** The red window lower bound for this kart. */
export const redStart = k => 1 - (k.easyBoost ? T.RED_EASY : T.RED);

/**
 * Advance one kart one fixed step.
 * c = { steer (-1..1, +left), throttle (0..1), brake (0..1), hopA (held), hopB (held) }
 */
export function stepKart(k, c, track, dt = DT) {
  // timers
  k.fizzleT = Math.max(0, k.fizzleT - dt);
  k.shieldT = Math.max(0, k.shieldT - dt); k.invincT = Math.max(0, k.invincT - dt);
  k.slowT = Math.max(0, k.slowT - dt); k.stallT = Math.max(0, k.stallT - dt);
  k.wallT = Math.max(0, k.wallT - dt); k.bumpT = Math.max(0, k.bumpT - dt);
  k.landT += dt;
  if (k.hitT > 0) { k.hitT = Math.max(0, k.hitT - dt); if (!k.hitT) k.hitKind = null; }
  if (k.spinT > 0) k.spinT = Math.max(0, k.spinT - dt);

  if (k.respawnT > 0) {
    k.respawnT -= dt;
    if (k.respawnT <= 0) placeAtRespawn(k, track);
    k._a = c.hopA; k._b = c.hopB;
    return;
  }
  if (k.frozen) { k._a = c.hopA; k._b = c.hopB; k.throttle = c.throttle; k.speed = 0; return; }

  const disabled = k.hitT > 0 || k.spinT > 0;
  k.steer = approach(k.steer, disabled ? 0 : clamp(c.steer, -1, 1), T.STEER_RATE * dt);
  k.throttle = c.throttle;
  const aHit = c.hopA && !k._a, bHit = c.hopB && !k._b;
  k._a = c.hopA; k._b = c.hopB;

  // ---------------------------------------------------------------- hop & slide
  if (k.drift) {
    const held = k.driftBtn === 'a' ? c.hopA : c.hopB;
    const other = k.driftBtn === 'a' ? bHit : aHit;
    if (!held || Math.abs(k.speed) < T.DRIFT_END_V || disabled || (k.air && k.airT > 0.35)) endDrift(k);
    else if (!k.overheat && k.turbos < 3) {
      const r0 = redStart(k);
      const prev = k.charge;
      k.charge = Math.min(1, k.charge + dt / T.CHARGE_T);
      if (prev < r0 && k.charge >= r0) { k.inRed = true; ev(k, 'charge_red'); }
      if (other) {
        if (k.charge >= r0) {
          k.turbos++;
          const tb = T.TURBO[k.turbos];
          addBoost(k, tb.t, tb.tier, tb.kick);
          ev(k, 'turbo' + k.turbos);
          k.charge = 0; k.inRed = false;
        } else {
          k.charge = 0; k.inRed = false; k.fizzleT = 0.45; ev(k, 'fizzle');
        }
      } else if (k.charge >= 1 && !k.easyBoost) {
        k.overheat = true; k.inRed = false; k.fizzleT = 0.6; ev(k, 'overheat');
      }
    }
  } else if (!disabled && (aHit || bHit)) {
    if (!k.air) {
      k.vy = T.HOP_V; k.air = true; k.airT = 0; k.hop = true; k.hopBtn = aHit ? 'a' : 'b';
      ev(k, 'hop');
    } else if (!k.hopBtn) k.hopBtn = aHit ? 'a' : 'b';   // held through a jump: slide on landing
  }
  // late slide start: shoulder still held just after landing a hop, and now steering
  if (!k.drift && !k.air && k.slideGraceT > 0) {
    k.slideGraceT -= dt;
    const held = k.hopBtn === 'a' ? c.hopA : k.hopBtn === 'b' ? c.hopB : false;
    if (!held) { k.slideGraceT = 0; k.hopBtn = null; }
    else if (Math.abs(c.steer) > 0.3 && k.speed > T.DRIFT_MIN_V) { startDrift(k, Math.sign(c.steer), k.hopBtn); k.slideGraceT = 0; k.hopBtn = null; }
    else if (k.slideGraceT <= 0) k.hopBtn = null;
  }

  // ---------------------------------------------------------------- speed
  const vmax = topSpeed(k);
  let thr = disabled || k.stallT > 0 ? 0 : c.throttle, brk = disabled ? 0 : c.brake;
  const accK = statK(k.stats.accel, T.STAT_ACC);
  if (k.boostT > 0) { k.boostT = Math.max(0, k.boostT - dt); if (!k.boostT) { k.boostTier = 0; k.boostMaxT = 0; } }
  if (!k.air) {
    if (brk > 0.05 && !(k.boostT > 0 && thr > 0)) {
      if (k.speed > 0.5) k.speed = Math.max(0, k.speed - T.BRAKE * brk * dt);
      else k.speed = Math.max(-T.REV_MAX, k.speed - T.REV_ACC * brk * dt);
    } else if ((thr > 0.05 || k.boostT > 0) && k.speed >= -0.5) {
      if (k.speed < vmax) {
        let a = T.ACC * accK * Math.max(0.08, 1 - (k.speed / vmax) ** 2) * Math.max(thr, k.boostT > 0 ? 1 : 0);
        if (k.boostT > 0) a = Math.max(a, T.BOOST_ACC);
        k.speed = Math.min(vmax, k.speed + a * dt);
      } else k.speed = Math.max(vmax, k.speed - T.OVER_DECEL * dt * (k.onRoad ? 1 : 2.2));
    } else {
      k.speed = approach(k.speed, 0, T.COAST * dt);
      if (k.speed > vmax) k.speed = Math.max(vmax, k.speed - T.OVER_DECEL * dt);
    }
    if (disabled) k.speed = approach(k.speed, 0, 14 * dt);
  } else {
    k.speed = approach(k.speed, 0, T.AIR_DRAG * dt);
  }

  // ---------------------------------------------------------------- turning
  const turnK = statK(k.stats.turn);
  if (k.drift) {
    const into = k.steer * k.drift;                  // +1 = steering into the slide (tight), -1 = away (wide)
    const rate = k.drift * (T.DRIFT_BASE + T.DRIFT_STEER * into) * turnK;
    k.yaw += rate * dt;
    k.driftAngle = approach(k.driftAngle, T.DRIFT_ANGLE + 0.12 * into, 3.2 * dt);
    k.cornerF = 1;
  } else {
    const v = Math.abs(k.speed);
    const f = Math.min(1, v / T.TURN_FULL_V) * (1 - T.HIGH_V_TURN_LOSS * Math.min(1, v / 30));
    const rate = k.steer * T.TURN * turnK * f * Math.sign(k.speed || 1) * (k.air ? T.AIR_TURN : 1);
    k.yaw += rate * dt;
    k.driftAngle = approach(k.driftAngle, 0, 3.5 * dt);
    // corner scrub (read by topSpeed next step): lateral accel v·ω past a0 costs up to `loss` of top speed
    const C = T.CORNER, aLat = k.air ? 0 : v * Math.abs(rate);
    const loss = C.loss * Math.max(0, 1 - (clamp(k.stats.turn, 1, 5) - 3) * T.STAT_GRIP);
    k.cornerF = 1 - loss * clamp((aLat - C.a0) / (C.a1 - C.a0), 0, 1);
  }
  if (k.spinT > 0) k.yaw += 0;     // the visual spin is the renderer's (spinT); travel keeps its line
  k.yaw = wrapA(k.yaw);

  // ---------------------------------------------------------------- move
  const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
  const pdecay = Math.exp(-5 * dt);
  k.push.x *= pdecay; k.push.z *= pdecay;
  k.vel.x = fx * k.speed + k.push.x; k.vel.z = fz * k.speed + k.push.z;
  const prevS = k.s;
  k.pos.x += k.vel.x * dt; k.pos.z += k.vel.z * dt;

  const pr = track.project(k.pos, k.si, k._pr || (k._pr = {}));
  k.si = pr.i; k.s = pr.s; k.lat = pr.lat;

  // ---------------------------------------------------------------- walls (boundary)
  const R = T.KART_R * 0.8;
  for (const side of [1, -1]) {
    const lim = side > 0 ? pr.limL : pr.limR;
    if (!isFinite(lim)) continue;
    const over = side * pr.lat - (lim - R);
    if (over > 0) {
      // push back inside along the left vector
      k.pos.x -= side * pr.lx * over; k.pos.z -= side * pr.lz * over;
      k.lat -= side * over;
      // reflect heading about the wall line; n = inward normal
      const nx = -side * pr.lx, nz = -side * pr.lz;
      const sp = k.speed;
      let vx = fx * sp, vz = fz * sp;
      const vn = vx * nx + vz * nz;
      if (vn < 0) {
        vx -= (1 + T.WALL_E) * vn * nx; vz -= (1 + T.WALL_E) * vn * nz;
        const ns = Math.hypot(vx, vz);
        const impact = -vn / Math.max(1, Math.abs(sp));
        if (ns > 0.5) {
          k.yaw = Math.atan2(vx * Math.sign(sp || 1), vz * Math.sign(sp || 1));
          k.speed = Math.sign(sp) * Math.max(ns * (1 - 0.25 * impact), Math.abs(sp) * T.WALL_MIN_KEEP);
        }
        if (Math.abs(vn) > 2.5 && k.wallT <= 0) { ev(k, ['wall', Math.min(1, -vn / 20)]); k.wallT = 0.35; }
        if (impact > 0.5) endDrift(k);
      }
      k.push.x = k.push.x * 0.3 + nx * 1.2; k.push.z = k.push.z * 0.3 + nz * 1.2;
    }
  }

  // ---------------------------------------------------------------- vertical
  const ground = pr.y;
  k.surface = pr.surface; k.onRoad = pr.onRoad; k.ground = ground;
  if (!k.air) {
    if (ground > k.pos.y - T.SNAP - Math.abs(k.speed) * 0.004 && isFinite(ground)) {
      k.vy = clamp((ground - k.pos.y) / dt, -25, 25);
      k.pos.y = ground;
      k.airT = 0;
    } else { k.air = true; k.airT = 0; k.hop = false; }
  }
  // ramp lip: crossing a jump's s on (or just above) the road launches you. "Just above" matters:
  // at speed you crest the ramp a hair before the lip and would otherwise sail off without the kick.
  for (const j of track.jumps) {
    const a = track.dS(j.s, prevS), b = track.dS(j.s, k.s);
    if (a < 0 && b >= 0 && k.speed > 3 && k.pos.y - ground < 1.2 && isFinite(ground)) {
      k.vy = Math.max(k.vy, j.vy); k.air = true; k.airT = 0; k.hop = false; ev(k, 'ramp');
    }
  }
  if (k.air) {
    k.vy -= T.GRAV * dt;
    k.pos.y += k.vy * dt;
    k.airT += dt;
    if (k.pos.y <= ground && k.vy <= 0) land(k, c, ground);
  }

  // ---------------------------------------------------------------- pads
  if (!k.air) {
    for (let i = 0; i < track.pads.length; i++) {
      const p = track.pads[i];
      const d = track.dS(p.s, k.s);
      if (d >= 0 && d <= p.len && Math.abs(k.lat - p.lat) <= p.w / 2 + 0.4) {
        const cool = k.padCool.get(i) || 0;
        if (cool < 1) {
          k.padCool.set(i, 999);
          addBoost(k, T.PAD.t, T.PAD.tier, T.PAD.kick); ev(k, 'pad');
        }
      } else if (k.padCool.has(i) && (d < -5 || d > p.len + 5)) k.padCool.delete(i);
    }
  }

  // ---------------------------------------------------------------- fall / water / respawn
  if (track.killY != null && k.pos.y < track.killY && (pr.gap || !pr.onRoad && ground < track.killY)) {
    // fell in a jump's gap: the helper carries you ACROSS (kid-first), not back to try again
    const g = pr.gap && track.gaps.find(g => { const d = track.dS(g.s0, k.s); return d >= -2 && d <= g.len + 2; });
    beginRespawn(k, 'splash', track, g ? g.s0 + g.len + 8 : null);
  }
  else if (k.pos.y < (isFinite(ground) ? ground : pr.cy) - 12 || (!isFinite(ground) && k.pos.y < pr.cy - 8)) beginRespawn(k, 'fall', track);
  if (!k.air && !pr.noRespawn && pr.onRoad) k.lastGoodS = k.s;

  // ground normal (for render tilt) from slope + bank, smoothed
  const tbN = pr.onRoad ? pr.tb : 0;
  const nx0 = -pr.tx * pr.slope + pr.lx * tbN, nz0 = -pr.tz * pr.slope + pr.lz * tbN;
  const nl = Math.hypot(nx0, 1, nz0);
  const kS = k.air ? 2 * dt : 10 * dt;
  k.nrm.x += (nx0 / nl - k.nrm.x) * kS; k.nrm.y += (1 / nl - k.nrm.y) * kS; k.nrm.z += (nz0 / nl - k.nrm.z) * kS;
  k.vel.y = k.air ? k.vy : 0;
}

function land(k, c, ground) {
  const airT = k.airT;
  k.pos.y = ground; k.vy = 0; k.air = false; k.landT = 0;
  const wasHop = k.hop; k.hop = false;
  if (airT > 0.12) ev(k, ['land', Math.min(1, airT)]);
  if (!wasHop && airT >= T.HANG2.air) { addBoost(k, T.HANG2.t, T.HANG2.tier, T.HANG2.kick); ev(k, 'hang2'); }
  else if (!wasHop && airT >= T.HANG1.air) { addBoost(k, T.HANG1.t, T.HANG1.tier, T.HANG1.kick); ev(k, 'hang1'); }
  if (k.hitT > 0 || k.spinT > 0) { k.hopBtn = null; return; }
  // slide starts on landing if the shoulder that hopped is still held and we're steering
  const held = k.hopBtn === 'a' ? c.hopA : k.hopBtn === 'b' ? c.hopB : false;
  if (held && k.speed > T.DRIFT_MIN_V) {
    if (Math.abs(c.steer) > 0.3) { startDrift(k, Math.sign(c.steer), k.hopBtn); k.hopBtn = null; }
    else k.slideGraceT = T.SLIDE_GRACE;
  } else k.hopBtn = null;
}

/** Start the helper's rescue: the kart vanishes, and `respawnAt` (s on the centre line) is decided
 *  NOW so the renderer can show the helper carrying it down there during respawnT. */
export function beginRespawn(k, why, track, atS = null) {
  if (k.respawnT > 0) return;
  k.respawnAt = track.wrapS(atS != null ? atS : track.respawnS(k.lastGoodS));
  endDrift(k);
  k.respawnT = T.RESPAWN_T; k.speed = 0; k.boostT = 0; k.boostTier = 0; k.push.x = k.push.z = 0;
  ev(k, ['respawn', why]);
}
/** Put a kart back on the centre line at its last good spot (called when respawnT runs out). */
export function placeAtRespawn(k, track) {
  const s = k.respawnAt != null ? k.respawnAt : track.respawnS(k.lastGoodS);
  k.respawnAt = null;
  const p = track.pointAt(s, 0);
  k.pos.x = p.x; k.pos.z = p.z; k.pos.y = p.y + T.RESPAWN_DROP;
  k.yaw = p.yaw; k.speed = 9; k.vy = 0; k.lastGoodS = s; k.air = true; k.airT = 0; k.hop = true;
  k.si = track.idx(s); k.s = s; k.respawnT = 0; k.hitT = 0; k.spinT = 0;
  k.invincT = Math.max(k.invincT, 0);  // no free invincibility
  ev(k, 'respawned');
}

/** Circle-circle bumping between all karts. Mass from racer stats. */
export function collideKarts(karts) {
  const R2 = T.KART_R * 2;
  for (let i = 0; i < karts.length; i++) {
    const a = karts[i];
    if (a.respawnT > 0 || a.frozen) continue;
    for (let j = i + 1; j < karts.length; j++) {
      const b = karts[j];
      if (b.respawnT > 0 || b.frozen) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      if (Math.abs(dx) > R2 || Math.abs(dz) > R2 || Math.abs(b.pos.y - a.pos.y) > 1.6) continue;
      const d = Math.hypot(dx, dz);
      if (d >= R2 || d < 1e-6) continue;
      const nx = dx / d, nz = dz / d, over = R2 - d;
      const ima = 1 / a.mass, imb = 1 / b.mass, im = ima + imb;
      a.pos.x -= nx * over * ima / im; a.pos.z -= nz * over * ima / im;
      b.pos.x += nx * over * imb / im; b.pos.z += nz * over * imb / im;
      const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rv < 0) {
        const J = -(1 + 0.6) * rv / im;
        impulse(a, -J * ima * nx, -J * ima * nz);
        impulse(b, J * imb * nx, J * imb * nz);
        if (-rv > 2 && a.bumpT <= 0) { ev(a, ['bump', Math.min(1, -rv / 12)]); a.bumpT = 0.3; }
        if (-rv > 2 && b.bumpT <= 0) { ev(b, ['bump', Math.min(1, -rv / 12)]); b.bumpT = 0.3; }
      }
      // a super-star kart knocks others aside
      if (a.invincT > 0 && b.invincT <= 0) applyHit(b, 'spin');
      else if (b.invincT > 0 && a.invincT <= 0) applyHit(a, 'spin');
    }
  }
}
function impulse(k, dvx, dvz) {
  const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
  const along = dvx * fx + dvz * fz;
  k.speed += along * 0.6;
  k.push.x += (dvx - fx * along); k.push.z += (dvz - fz * along);
}

/** Put a kart on a grid slot, frozen until the race says go. */
export function placeKart(k, slot, track) {
  k.pos.x = slot.x; k.pos.y = slot.y; k.pos.z = slot.z; k.yaw = slot.yaw;
  k.speed = 0; k.vy = 0; k.air = false; k.si = track.idx(slot.s); k.s = slot.s; k.lat = slot.lat;
  k.lastGoodS = slot.s; k.frozen = true;
}

// =====================================================================================
// Self-test: `node src/physics.js`
// =====================================================================================
async function selfTest() {
  const { buildTrack } = await import('./track.js');
  // a long flat straight loop (a big rounded rectangle) so nothing interferes
  // a stadium: two long dead-straight sides joined by semicircles, so nothing interferes
  const stadium = (extra = {}) => {
    const pts = [], L = 700, r = 90;
    for (let z = 0; z <= L; z += 100) pts.push({ x: 0, z });
    for (let a = 1; a < 8; a++) pts.push({ x: r - r * Math.cos(a * Math.PI / 8), z: L + r * Math.sin(a * Math.PI / 8) });
    for (let z = L; z >= 0; z -= 100) pts.push({ x: 2 * r, z });
    for (let a = 1; a < 8; a++) pts.push({ x: r + r * Math.cos(a * Math.PI / 8), z: -r * Math.sin(a * Math.PI / 8) });
    return buildTrack({ id: 'test', width: 30, defaults: { off: 60, wall: 'none' }, points: pts, ...extra });
  };
  const flat = stadium();
  let fails = 0;
  const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!ok) fails++; };
  const fresh = (o = {}) => {
    const k = createKart(o);
    placeKart(k, { x: 0, y: 0, z: 10, yaw: 0, s: 10, lat: 0 }, flat);
    k.frozen = false; return k;
  };
  const C = (o = {}) => ({ steer: 0, throttle: 1, brake: 0, hopA: false, hopB: false, ...o });
  const run = (k, secs, ctrl) => { const out = []; for (let t = 0; t < secs; t += DT) { k.ev.length = 0; stepKart(k, typeof ctrl === 'function' ? ctrl(t, k) : ctrl, flat); out.push(...k.ev); } return out; };

  // 1. top speed & acceleration
  {
    const k = fresh();
    let t90 = null, t = 0;
    for (; t < 6; t += DT) { stepKart(k, C(), flat); if (t90 == null && k.speed >= 0.9 * T.BASE_MAX) t90 = t; }
    check('reaches base top speed', Math.abs(k.speed - T.BASE_MAX) < 0.05, `v=${k.speed.toFixed(2)} m/s`);
    check('0→90% in 1.5–2.5 s', t90 > 1.5 && t90 < 2.5, `t90=${t90?.toFixed(2)} s`);
    const kf = fresh({ stats: { speed: 5, accel: 2, turn: 2 } }); run(kf, 8, C());
    const ks = fresh({ stats: { speed: 1, accel: 4, turn: 4 } }); run(ks, 8, C());
    check('stat spread ±6%', Math.abs(kf.speed / T.BASE_MAX - 1.06) < 0.005 && Math.abs(ks.speed / T.BASE_MAX - 0.94) < 0.005, `fast=${kf.speed.toFixed(2)} slow=${ks.speed.toFixed(2)}`);
  }
  // helper: get to speed, hop+slide left, then press the other shoulder per a policy
  const slideRun = (policy, o = {}) => {
    const k = fresh(o);
    run(k, 4, C());
    let evs = [], pressedAt = [];
    let tIn = 0, bPrev = false;
    evs.push(...run(k, 0.05, C({ steer: 1, hopA: true })));
    for (let t = 0; t < 5; t += DT) {
      tIn += DT;
      const wantB = policy(k, t);
      k.ev.length = 0;
      stepKart(k, C({ steer: 1, hopA: true, hopB: wantB }), flat);
      if (wantB && !bPrev) pressedAt.push(k.charge);
      bPrev = wantB;
      evs.push(...k.ev);
    }
    return { k, evs: evs.map(e => Array.isArray(e) ? e[0] : e) };
  };
  // 2. perfectly timed: press the other shoulder the first frame the meter is in the red
  {
    let hold = 0;
    const { k, evs } = slideRun((k) => { if (hold > 0) { hold--; return true; } if (k.drift && k.inRed && k.turbos < 3) { hold = 3; return true; } return false; });
    const turbos = ['turbo1', 'turbo2', 'turbo3'].filter(e => evs.includes(e));
    check('hop + steer lands into a slide', evs.includes('hop') && evs.includes('drift_start'));
    check('3 perfectly timed presses = 3 turbos', turbos.length === 3 && !evs.includes('fizzle') && !evs.includes('overheat'), `events: ${evs.filter(e => /turbo|fizzle|overheat/.test(e)).join(',')}`);
    check('stage 3 turbo = purple tier', k.boostTier === 3 || evs.includes('turbo3'));
  }
  // 3. slide speed boost: 3 turbos raise speed above base
  {
    let hold = 0, peak = 0;
    slideRun((k) => { peak = Math.max(peak, k.speed); if (hold > 0) { hold--; return true; } if (k.drift && k.inRed && k.turbos < 3) { hold = 3; return true; } return false; });
    check('turbos push speed past base top', peak > T.BASE_MAX * 1.15, `peak=${peak.toFixed(2)} m/s (base ${T.BASE_MAX}, cap ${T.BOOST_MAX})`);
  }
  // 4. early press = fizzle
  {
    let fired = false;
    const { evs } = slideRun((k) => { if (!fired && k.drift && k.charge > 0.3) { fired = true; return true; } return false; });
    check('early press fizzles (no turbo)', evs.includes('fizzle') && !evs.includes('turbo1'));
  }
  // 5. no press = overheat
  {
    const { k, evs } = slideRun(() => false);
    check('never pressing overheats', evs.includes('overheat') && k.overheat, `charge=${k.charge.toFixed(2)}`);
  }
  // 6. easyBoost: wider window, no overheat
  {
    const { evs } = slideRun(() => false, { easyBoost: true });
    check('easyBoost never overheats', !evs.includes('overheat'));
    let fired = false;
    const r = slideRun((k) => { if (!fired && k.drift && k.charge >= 0.6 && k.charge < 0.7) { fired = true; return true; } return false; }, { easyBoost: true });
    const r2 = (() => { let f2 = false; return slideRun((k) => { if (!f2 && k.drift && k.charge >= 0.6 && k.charge < 0.7) { f2 = true; return true; } return false; }); })();
    check('easyBoost window wider (press at 60–70% charge)', r.evs.includes('turbo1') && r2.evs.includes('fizzle') && !r2.evs.includes('turbo1'));
  }
  // 7. counter-steer: steering into the slide turns tighter than steering away
  {
    const yawAfter = steer => {
      const k = fresh(); run(k, 4, C());
      run(k, 0.05, C({ steer: 1, hopA: true }));
      run(k, 0.5, C({ steer: 1, hopA: true }));       // land, slide left
      const y0 = k.yaw; run(k, 1, C({ steer, hopA: true }));
      return { d: wrapA(k.yaw - y0), drift: k.drift };
    };
    const tight = yawAfter(1), wide = yawAfter(-1);
    check('slide: into = tight, away = wide', tight.drift === 1 && wide.drift === 1 && tight.d > wide.d * 2, `tight=${tight.d.toFixed(2)} rad/s wide=${wide.d.toFixed(2)} rad/s`);
  }
  // 8. hang time: a ramp jump with ≥0.5 s air = turbo
  {
    const ramp = stadium({ jumps: [{ at: 1.0, vy: 9 }] });
    const k = createKart(); placeKart(k, ramp.grid[0], ramp); k.frozen = false;
    const evs = [];
    let maxAir = 0;
    for (let t = 0; t < 12; t += DT) { k.ev.length = 0; stepKart(k, C(), ramp); evs.push(...k.ev.map(e => Array.isArray(e) ? e[0] : e)); maxAir = Math.max(maxAir, k.airT); }
    check('ramp jump launches', evs.includes('ramp'), `air=${maxAir.toFixed(2)} s`);
    check('hang time ≥0.5 s gives a turbo', maxAir >= 0.5 && (evs.includes('hang1') || evs.includes('hang2')));
  }
  // 9. offroad slows but never stops
  {
    const k = fresh(); run(k, 4, C());
    { const p = flat.pointAt(k.s, -(flat.HW[k.si] + 6)); k.pos.x = p.x; k.pos.z = p.z; }   // onto the right-hand offroad (lat < 0 = right)
    run(k, 3, C());
    check('offroad: ~35% slower, still moving', k.speed > T.BASE_MAX * 0.55 && k.speed < T.BASE_MAX * 0.75, `v=${k.speed.toFixed(2)} on ${k.surface}`);
  }
  // 10. wall deflects and scrubs, never dead-stops
  {
    const walled = stadium({ width: 14, defaults: { off: 0, wall: 'fence' } });
    const k = createKart(); placeKart(k, { ...walled.grid[0], yaw: 0.9 }, walled); k.frozen = false;
    const evs = []; let minV = 99;
    for (let t = 0; t < 3; t += DT) { k.ev.length = 0; stepKart(k, C(), walled); evs.push(...k.ev); if (t > 1) minV = Math.min(minV, k.speed); }
    check('wall hit deflects without a dead stop', evs.some(e => e[0] === 'wall') && minV > 5 && Math.abs(k.lat) < walled.HW[0], `wallEv=${evs.some(e => e[0] === 'wall')} min v after hit=${minV.toFixed(1)} lat=${k.lat.toFixed(2)}`);
  }
  // 11. pad: instant boost
  {
    const pt = stadium({ pads: [{ at: 1.0, lat: 0 }] });
    const k = createKart(); placeKart(k, { ...pt.pointAt(10, 0), s: 10, lat: 0 }, pt); k.frozen = false;
    const evs = []; let peak = 0;
    const follow = () => C({ steer: clamp(-k.lat * 0.15 + wrapA(pt.frameAt(k.s).yaw - k.yaw) * 1.5, -1, 1) });
    for (let t = 0; t < 8; t += DT) { k.ev.length = 0; stepKart(k, follow(), pt); evs.push(...k.ev); peak = Math.max(peak, k.speed); }
    check('turbo pad boosts', evs.includes('pad') && peak > T.BASE_MAX * 1.2, `peak=${peak.toFixed(1)}`);
  }
  // 12. applyHit / shield
  {
    const k = fresh(); run(k, 3, C());
    k.shieldT = 5; const r1 = applyHit(k, 'flip');
    const r2 = applyHit(k, 'flip');
    check('shield absorbs one hit, next one lands', !r1 && r2 && k.hitT > 0);
  }
  console.log(fails ? `\nphysics self-test: ${fails} FAIL` : '\nphysics self-test: PASS');
  if (fails) process.exitCode = 1;
}

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === new URL('file://' + process.argv[1]).href) selfTest();
