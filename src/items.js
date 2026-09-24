// items.js — PURE item simulation (no THREE, no DOM): ? boxes, stars, the roulette, every
// weapon/projectile/hazard, hits, star spills and the AI's item decisions. The browser and the
// node gate (tools/check.js) run exactly this; the THREE views live in itemviews.js and the HUD
// widget in itemhud.js.
//
//   const items = createItems(race, { seed });  // attaches itself: race.items = items, race.addSystem(step)
//   items.give(kart, 'rocket')                  // debug / tests
//   // AI: ai.js calls race.items.aiControl(brain, ctrl) at the end of drive() (one-line hook)
//   // Player: main.js puts `item` (held) and `itemBack` (throw backward) on the control object;
//   //         every kart's item press is edge-detected here from kart.ctrl.
//
// Events go into race.events as { type: 'item', e, kart, ...extra } — see DESIGN.md "Items".
// Hits go through physics.applyHit (shield / super star respected) so they also show up as
// kart events ('hit', 'stars_lost', 'shield_pop').

import { applyHit, addBoost, T as PT } from './physics.js';
import { bankY } from './track.js';
import { rng, DIFFICULTY } from './ai.js';

/** Item ids (= icon names assets/ui/item_<id>.png). 'nitro' is the Super TNT. */
export const ITEM_IDS = ['taco_bomb', 'rocket', 'tnt', 'icecream', 'shield', 'turbo', 'superstar', 'remote', 'warp'];
export const ITEMS = {
  taco_bomb: { name: 'Taco Bomb', vo: 'vo_taco_bomb' },
  rocket: { name: 'Cosmic Rocket', vo: 'vo_rocket' },
  tnt: { name: 'TNT Crate', vo: 'vo_tnt' },
  nitro: { name: 'Nitro Crate', vo: 'vo_tnt' },
  icecream: { name: 'Ice Cream Splat', vo: 'vo_ice_cream' },
  shield: { name: 'Bubble Shield', vo: 'vo_shield' },
  turbo: { name: 'Turbo Rocket', vo: 'vo_turbo' },
  superstar: { name: 'Super Star', vo: 'vo_super_star' },
  remote: { name: 'TV Remote', vo: 'vo_tv_remote' },
  warp: { name: 'Warp Star', vo: 'vo_warp_star' },
};

/** All item tuning. Pickups are generous, hazards a bit smaller than they look (kid-first). */
export const IT = {
  BOX_R: 1.9, BOX_DY: 2.6, BOX_RESPAWN: 3,
  ROULETTE: 1.5,
  STAR_R: 1.7, STAR_DY: 2.4, STAR_RESPAWN: 14,
  SPILL: { life: 9, grace: 0.45, ownerGrace: 1.3, v: 6, vy: 7 },
  HAZ_DY: 1.3,                                             // a jump clears a hazard, a hop doesn't
  BOMB: { speed: 36, overOwner: 10, back: 16, range: 170, life: 6, r: 1.4, blast: 4.5, blastSuper: 7.5, y: 0.5 },
  ROCKET: { speed: 40, over: 12, life: 9, r: 1.35, y: 0.75, lost: 150 },
  TNT: { r: 1.25, fuse: 3, hops: 5, life: 45, arm: 1.2, nitroBlast: 3 },
  PUDDLE: { r: 2.0, rSuper: 3.1, life: 35, arm: 1.0 },
  SHIELD: { t: 10, tSuper: 15, shotSpeed: 38, shotLife: 3.5, r: 1.5 },
  TURBO: { t: 2.2, tSuper: 3.0, kick: 6, kickSuper: 8 },
  STAR: { t: 7, tSuper: 10 },
  REMOTE: { t: 3, tSuper: 4.5 },
  WARP: { speed: 60, speedSuper: 85, r: 2.5, life: 20, y: 1.1 },
  HIT_DY: 2.2,
  REMOTE_TEXT: 'KING DAD PRESSED PAUSE!',
};

/** Roulette odds by race position (8-kart field; other field sizes are mapped onto it).
 *  CTR-style: leaders get defensive stuff, the back of the pack gets the catch-up items. */
export const ODDS = [
  { upTo: 1, w: { taco_bomb: 26, rocket: 4, tnt: 22, icecream: 26, shield: 18, turbo: 4 } },
  { upTo: 3, w: { taco_bomb: 22, rocket: 20, tnt: 14, icecream: 14, shield: 12, turbo: 14, superstar: 2, remote: 1, warp: 1 } },
  { upTo: 5, w: { taco_bomb: 14, rocket: 24, tnt: 9, icecream: 8, shield: 10, turbo: 20, superstar: 7, remote: 4, warp: 4 } },
  { upTo: 8, w: { taco_bomb: 8, rocket: 22, tnt: 5, icecream: 3, shield: 8, turbo: 22, superstar: 14, remote: 9, warp: 9 } },
];

/** How the AI uses items, by difficulty. `mercy` scales attacks aimed at the human player. */
export const AI_ITEM = {
  easy:   { think: 0.7,  use: 0.35, mercy: 0.05, aimLat: 3.4, defend: 0.3,  hopGap: 0.3,  hold: 3.5, homing: 9,  homingVsPlayer: 3 },
  medium: { think: 0.4,  use: 0.6,  mercy: 0.55, aimLat: 2.6, defend: 0.65, hopGap: 0.14, hold: 2,   homing: 13, homingVsPlayer: 9 },
  hard:   { think: 0.22, use: 0.9,  mercy: 1,    aimLat: 2.0, defend: 0.95, hopGap: 0.05, hold: 1,   homing: 16, homingVsPlayer: 16 },
};

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const approach = (v, t, r) => v < t ? Math.min(t, v + r) : Math.max(t, v - r);
const h2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** Interpolated point on the track at (s, lat) — pointAt() snaps to 1 m samples, projectiles need smooth. */
export function trackPoint(tr, s, lat, o = {}) {
  s = tr.wrapS(s);
  const f = s / tr.ds, i0 = Math.floor(f) % tr.n, i1 = (i0 + 1) % tr.n, t = f - Math.floor(f);
  let tx = tr.TX[i0] + (tr.TX[i1] - tr.TX[i0]) * t, tz = tr.TZ[i0] + (tr.TZ[i1] - tr.TZ[i0]) * t;
  const h = Math.hypot(tx, tz) || 1; tx /= h; tz /= h;
  const lx = tz, lz = -tx;
  const cx = tr.X[i0] + (tr.X[i1] - tr.X[i0]) * t, cz = tr.Z[i0] + (tr.Z[i1] - tr.Z[i0]) * t, cy = tr.Y[i0] + (tr.Y[i1] - tr.Y[i0]) * t;
  const hw = tr.HW[i0] + (tr.HW[i1] - tr.HW[i0]) * t, tb = tr.TB[i0] + (tr.TB[i1] - tr.TB[i0]) * t;
  o.x = cx + lx * lat; o.z = cz + lz * lat; o.y = bankY(cy, lat, hw, tb); o.yaw = Math.atan2(tx, tz); o.hw = hw; o.i = i0;
  o.limL = hw + tr.OFFL[i0]; o.limR = hw + tr.OFFR[i0];
  return o;
}

/**
 * Attach the item system to a race. opts: { seed, enabled (default true), boxes (default true) }.
 * Returns the item world W (also race.items).
 */
export function createItems(race, { seed = 1 } = {}) {
  const tr = race.track, L = tr.length;
  const r = rng(seed * 7727 + 31);
  const W = {
    race, track: tr, r, t: 0,
    boxes: [], stars: [], spills: [], projs: [], hazards: [],
    stats: { boxes: 0, got: {}, used: {}, hits: {}, blocked: 0, stars: 0, spilled: 0, tntOn: 0, tntShaken: 0, tntBoom: 0, detonated: 0, rocketHits: 0, rocketsFired: 0 },
    step: dt => step(W, dt),
    give: (k, id, count) => give(W, k, id, count),
    use: (k, back = false) => useItem(W, k, back),
    aiControl: (b, c) => aiControl(W, b, c),
    roll: k => rollItem(W, k),
    hitKart: (k, kind, by, item) => hitKart(W, k, kind, by, item),
    nextId: 1,
  };
  for (const row of tr.itemRows) for (const sl of row.slots) W.boxes.push({ x: sl.x, y: sl.y, z: sl.z, s: row.s, lat: sl.lat, alive: true, respawnT: 0, bornT: -9 });
  for (const row of tr.starRows) for (const p of row.points) W.stars.push({ x: p.x, y: p.y, z: p.z, s: p.s, alive: true, respawnT: 0, bornT: -9 });
  for (const k of race.karts) {
    k.item = null; k.itemCount = 0; k.roulT = 0; k.roulDur = IT.ROULETTE; k.tnt = null; k.lockedBy = 0; k.lockDist = Infinity;
    k.bomb = null; k.shieldArmed = false; k._iPrev = false; k.stars = k.stars || 0;
  }
  race.items = W;
  race.addSystem((rc, dt) => step(W, dt));
  return W;
}

/* ============================================================================ events */
function emit(W, e, kart, extra) { W.race.events.push({ type: 'item', e, kart, ...extra }); }
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

/* ============================================================================ roulette */
function rollItem(W, k) {
  const race = W.race, n = race.karts.length;
  const place8 = n > 1 ? 1 + Math.round((k.place - 1) * 7 / (n - 1)) : 1;
  const row = ODDS.find(o => place8 <= o.upTo) || ODDS[ODDS.length - 1];
  const w = { ...row.w };
  const leader = k.place === 1;
  if (leader) { delete w.warp; delete w.superstar; delete w.remote; }
  if (race.karts.some(o => o.slowT > 0)) delete w.remote;                 // one "pause" at a time
  if (W.projs.some(p => p.kind === 'warp')) delete w.warp;
  let sum = 0; for (const id in w) sum += w[id];
  let x = W.r() * sum;
  for (const id in w) { x -= w[id]; if (x <= 0) return id; }
  return 'taco_bomb';
}
function give(W, k, id, count) {
  k.item = id; k.roulT = 0;
  k.itemCount = count ?? (id === 'rocket' && k.stars >= PT.STARS_SUPER ? 3 : 1);
  bump(W.stats.got, id);
  emit(W, 'got', k, { item: id, count: k.itemCount });
}

/* ============================================================================ hits */
function hitKart(W, k, kind, by, item) {
  if (k.finished || k.respawnT > 0) return false;
  const why = k.invincT > 0 ? 'star' : k.shieldT > 0 ? 'shield' : null;
  const landed = applyHit(k, kind);
  if (landed) {
    bump(W.stats.hits, item); emit(W, 'hit', k, { by, item, kind });   // a TNT on the head keeps ticking
    if (by && by !== k) k._hitByT = W.t;                                // Easy AI leaves a kid alone for a while after this
    // spill now (the end-of-step scan only catches hits from physics, e.g. super-star bumps)
    const e = k.ev[k.ev.length - 1];
    if (Array.isArray(e) && e[0] === 'stars_lost' && !e[2]) { e[2] = true; spill(W, k, e[1]); }
  }
  else { W.stats.blocked++; emit(W, 'blocked', k, { by, item, why: why || 'none' }); }
  return landed;
}
function explode(W, x, y, z, rad, item, owner, { hitOwner = false, big = false, skip = null } = {}) {
  emit(W, 'explode', owner, { pos: { x, y, z }, r: rad, item, big });
  if (rad <= 0) return;
  for (const o of W.race.karts) {
    if (o === skip || (o === owner && !hitOwner) || o.finished || o.respawnT > 0) continue;
    if (h2(o.pos, { x, z }) < rad * rad && Math.abs(o.pos.y - y) < 3) hitKart(W, o, 'flip', owner, item);
  }
}

/* ============================================================================ using items */
function canAct(k) { return !k.finished && k.respawnT <= 0 && k.hitT <= 0 && k.spinT <= 0 && !k.frozen; }

function useItem(W, k, back = false) {
  if (k.bomb && k.bomb.alive) { detonate(W, k.bomb); return 'detonate'; }
  if (!k.item) {
    if (k.shieldT > 0 && k.shieldArmed) { fireShield(W, k, back); return 'shield_fire'; }
    return null;
  }
  if (k.roulT > 0) return null;
  const id = k.item, sup = k.stars >= PT.STARS_SUPER;
  k.itemCount--; if (k.itemCount <= 0) { k.item = null; k.itemCount = 0; }
  const used = id === 'tnt' && sup ? 'nitro' : id;
  bump(W.stats.used, used);
  emit(W, 'use', k, { item: used, super: sup, back });
  const tr = W.track;
  switch (id) {
    case 'taco_bomb': {
      const B = IT.BOMB;
      const p = spawnProj(W, 'taco_bomb', k, back ? -2.6 : 2.4, back ? -B.back : Math.max(B.speed, k.speed + B.overOwner));
      p.range = B.range; p.life = B.life; p.r = B.r; p.blast = sup ? B.blastSuper : B.blast; p.super = sup; p.yOff = B.y;
      k.bomb = p;
      break;
    }
    case 'rocket': {
      const R = IT.ROCKET;
      const p = spawnProj(W, 'rocket', k, 2.2, Math.max(R.speed, k.speed + R.over));
      p.life = R.life; p.r = R.r; p.yOff = R.y; p.super = sup;
      const tgt = W.race.order.find(o => o.place === k.place - 1 && o !== k);
      const human = k.isPlayer && !W.race.autoPlayer;
      const cfg = human ? AI_ITEM.hard : aiCfgFor(W, k);
      if (tgt && !tgt.finished) {
        p.target = tgt; tgt.lockedBy++;
        p.homing = tgt.isPlayer && !W.race.autoPlayer && !human ? cfg.homingVsPlayer : cfg.homing;
        emit(W, 'lock', tgt, { by: k, item: 'rocket' });
      } else p.homing = 0;
      W.stats.rocketsFired++;
      break;
    }
    case 'tnt': {
      const f = { x: Math.sin(k.yaw), z: Math.cos(k.yaw) };   // dropped behind (↓ changes nothing)
      addHazard(W, sup ? 'nitro' : 'tnt', k, k.pos.x - f.x * 2.6, k.pos.z - f.z * 2.6, IT.TNT.r, IT.TNT.life, IT.TNT.arm);
      break;
    }
    case 'icecream': {
      const f = { x: Math.sin(k.yaw), z: Math.cos(k.yaw) };
      addHazard(W, 'puddle', k, k.pos.x - f.x * 2.8, k.pos.z - f.z * 2.8, sup ? IT.PUDDLE.rSuper : IT.PUDDLE.r, IT.PUDDLE.life, IT.PUDDLE.arm).super = sup;
      break;
    }
    case 'shield':
      k.shieldT = sup ? IT.SHIELD.tSuper : IT.SHIELD.t; k.shieldArmed = true;
      emit(W, 'shield_up', k, { super: sup });
      break;
    case 'turbo':
      addBoost(k, sup ? IT.TURBO.tSuper : IT.TURBO.t, 3, sup ? IT.TURBO.kickSuper : IT.TURBO.kick);
      emit(W, 'turbo', k, { super: sup });
      break;
    case 'superstar':
      k.invincT = sup ? IT.STAR.tSuper : IT.STAR.t;
      if (k.tnt) { k.tnt = null; emit(W, 'tnt_off', k, { why: 'star' }); }
      emit(W, 'super_star', k, { super: sup, t: k.invincT });
      break;
    case 'remote': {
      const t = sup ? IT.REMOTE.tSuper : IT.REMOTE.t;
      for (const o of W.race.karts) {
        if (o === k || o.finished || o.respawnT > 0) continue;
        if (hitKart(W, o, 'wobble', k, 'remote')) o.slowT = t;
      }
      emit(W, 'remote', k, { text: IT.REMOTE_TEXT, super: sup, t });
      break;
    }
    case 'warp': {
      const Wp = IT.WARP;
      const p = spawnProj(W, 'warp', k, 2, sup ? Wp.speedSuper : Wp.speed);
      p.life = Wp.life; p.r = Wp.r; p.yOff = Wp.y; p.super = sup; p.hitSet = new Set([k]);
      const tgt = W.race.order.find(o => o !== k && !o.finished);
      if (tgt && tgt.place < k.place) { p.target = tgt; tgt.lockedBy++; emit(W, 'lock', tgt, { by: k, item: 'warp' }); }
      else p.range = 250;
      emit(W, 'warp', k, { target: p.target || null });
      break;
    }
  }
  return used;
}

function fireShield(W, k, back) {
  k.shieldT = 0; k.shieldArmed = false;
  const S = IT.SHIELD;
  const p = spawnProj(W, 'shield_shot', k, back ? -2.4 : 2.4, back ? -S.shotSpeed * 0.6 : Math.max(S.shotSpeed, k.speed + 10));
  p.life = S.shotLife; p.r = S.r; p.yOff = 0.8;
  bump(W.stats.used, 'shield_shot');
  emit(W, 'shield_fire', k, { back });
}

function spawnProj(W, kind, k, ahead, v) {
  const tr = W.track;
  const s = tr.wrapS(k.s + ahead);
  const hw = tr.HW[tr.idx(s)];
  const lat = clamp(k.lat, -hw + 0.8, hw - 0.8);
  const p = { id: W.nextId++, kind, owner: k, alive: true, s, lat, v, t: 0, life: 5, r: 1.3, yOff: 0.6, travelled: 0, range: Infinity,
    target: null, homing: 0, blast: 0, super: false, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, yaw: 0, dy: 0, hitSet: null };
  trackPoint(tr, s, lat, p);
  p.y += p.yOff; p.dy = Math.max(0, k.pos.y - (p.y - p.yOff));   // launched from an airborne kart: settle down to the road
  p.y += p.dy;
  p.px = p.x; p.py = p.y; p.pz = p.z;
  W.projs.push(p);
  return p;
}
function addHazard(W, kind, owner, x, z, r, life, arm) {
  const tr = W.track;
  const pr = tr.project({ x, y: owner.pos.y, z }, owner.si, {});
  const y = isFinite(pr.y) ? pr.y : owner.pos.y;
  const h = { id: W.nextId++, kind, owner, alive: true, x, y, z, r, t: 0, life, arm, super: false, s: pr.s, lat: pr.lat, drop: owner.air ? Math.max(0, owner.pos.y - y) : 0.6 };
  W.hazards.push(h);
  emit(W, 'drop', owner, { item: kind, pos: { x, y, z } });
  return h;
}
function detonate(W, p) {
  W.stats.detonated++;
  emit(W, 'detonate', p.owner, {});
  endProj(W, p, true);
}
function endProj(W, p, boom) {
  if (!p.alive) return;
  p.alive = false;
  if (p.target) { p.target.lockedBy = Math.max(0, p.target.lockedBy - 1); p.target = null; }
  if (p.owner.bomb === p) p.owner.bomb = null;
  if (boom) {
    if (p.kind === 'taco_bomb') explode(W, p.x, p.y, p.z, p.blast, 'taco_bomb', p.owner, { big: p.super });
    else if (p.kind === 'rocket') explode(W, p.x, p.y, p.z, 0, 'rocket', p.owner);
    else emit(W, 'fizzle', p.owner, { pos: { x: p.x, y: p.y, z: p.z }, item: p.kind });
  }
}

/* ============================================================================ the step */
function step(W, dt) {
  const race = W.race;
  if (race.phase !== 'race' && race.phase !== 'done') return;
  W.t += dt;
  const karts = race.karts, tr = W.track;

  // ---- per kart: roulette, item press, TNT on the head
  for (const k of karts) {
    if (k.roulT > 0) {
      k.roulT -= dt;
      if (k.roulT <= 0) give(W, k, rollItem(W, k));
    }
    const c = k.ctrl || {};
    const held = !!c.item, press = held && !k._iPrev;
    k._iPrev = held;
    if (press && canAct(k)) useItem(W, k, !!(c.itemBack ?? (c.brake > 0.3)));
    if (k.shieldT <= 0) k.shieldArmed = false;
    if (k.tnt) stepTnt(W, k, dt);
    k.lockDist = Infinity;
  }

  // ---- ? boxes
  for (const b of W.boxes) {
    if (!b.alive) { b.respawnT -= dt; if (b.respawnT <= 0) { b.alive = true; b.bornT = W.t; } continue; }
    for (const k of karts) {
      if (k.respawnT > 0) continue;
      if (h2(k.pos, b) < IT.BOX_R * IT.BOX_R && Math.abs(k.pos.y - b.y) < IT.BOX_DY) {
        b.alive = false; b.respawnT = IT.BOX_RESPAWN; W.stats.boxes++;
        const start = !k.item && k.roulT <= 0 && !k.finished;
        emit(W, 'box', k, { pos: { x: b.x, y: b.y, z: b.z }, roulette: start });
        if (start) { k.roulT = k.roulDur = IT.ROULETTE; emit(W, 'roulette', k, {}); }
        break;
      }
    }
  }

  // ---- stars on the track
  for (const st of W.stars) {
    if (!st.alive) { st.respawnT -= dt; if (st.respawnT <= 0) { st.alive = true; st.bornT = W.t; } continue; }
    for (const k of karts) {
      if (k.respawnT > 0) continue;
      if (h2(k.pos, st) < IT.STAR_R * IT.STAR_R && Math.abs(k.pos.y - st.y) < IT.STAR_DY) {
        st.alive = false; st.respawnT = IT.STAR_RESPAWN;
        collectStar(W, k, st);
        break;
      }
    }
  }

  // ---- spilled stars (ballistic, then resting; collectible)
  for (let i = W.spills.length - 1; i >= 0; i--) {
    const sp = W.spills[i];
    sp.t += dt;
    if (!sp.rest) {
      sp.vy -= PT.GRAV * dt;
      sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.z += sp.vz * dt;
      const pr = tr.project(sp, sp.si, sp._pr || (sp._pr = {})); sp.si = pr.i;
      const g = isFinite(pr.y) ? pr.y : -1e9;
      // keep them inside the boundary
      const lim = sp.lat > 0 ? pr.limL : pr.limR;
      if (isFinite(lim) && Math.abs(pr.lat) > lim - 0.5) { sp.vx = -sp.vx * 0.5; sp.vz = -sp.vz * 0.5; sp.x -= pr.lx * Math.sign(pr.lat) * 0.3; sp.z -= pr.lz * Math.sign(pr.lat) * 0.3; }
      sp.lat = pr.lat;
      if (sp.y <= g && sp.vy < 0) {
        sp.y = g;
        if (sp.bounces++ < 1) { sp.vy = -sp.vy * 0.35; sp.vx *= 0.5; sp.vz *= 0.5; }
        else { sp.rest = true; sp.vx = sp.vz = sp.vy = 0; }
      }
      if (sp.y < (tr.killY ?? -1e9) || (!isFinite(pr.y) && sp.y < pr.cy - 15)) { W.spills.splice(i, 1); continue; }
    }
    if (sp.t > sp.life) { W.spills.splice(i, 1); continue; }
    for (const k of karts) {
      if (k.respawnT > 0 || sp.t < (k === sp.from ? IT.SPILL.ownerGrace : IT.SPILL.grace)) continue;
      if (h2(k.pos, sp) < IT.STAR_R * IT.STAR_R && Math.abs(k.pos.y - sp.y) < IT.STAR_DY) {
        W.spills.splice(i, 1); collectStar(W, k, sp); break;
      }
    }
  }

  // ---- projectiles
  for (const p of W.projs) if (p.alive) stepProj(W, p, dt);
  if (W.projs.length > 24 || W.projs.some(p => !p.alive)) W.projs = W.projs.filter(p => p.alive);

  // ---- hazards on the road
  for (const h of W.hazards) {
    if (!h.alive) continue;
    h.t += dt; h.drop = Math.max(0, h.drop - dt * 6);
    if (h.t > h.life) { h.alive = false; emit(W, 'fizzle', h.owner, { pos: { x: h.x, y: h.y, z: h.z }, item: h.kind }); continue; }
    for (const k of karts) {
      if (k.respawnT > 0 || k.finished) continue;
      if (k === h.owner && h.t < h.arm) continue;
      if (h2(k.pos, h) < h.r * h.r && k.pos.y - h.y < IT.HAZ_DY && k.pos.y - h.y > -1.5) { triggerHazard(W, h, k); if (!h.alive) break; }
    }
  }
  if (W.hazards.length > 30 || W.hazards.some(h => !h.alive)) W.hazards = W.hazards.filter(h => h.alive);

  // ---- stars spill out of whoever got hit this step
  for (const k of karts) for (const e of k.ev) if (Array.isArray(e) && e[0] === 'stars_lost' && !e[2]) { e[2] = true; spill(W, k, e[1]); }
}

function collectStar(W, k, st) {
  const was = k.stars;
  k.stars = Math.min(PT.STARS_MAX, k.stars + 1);
  W.stats.stars++;
  emit(W, 'star', k, { n: k.stars, pos: { x: st.x, y: st.y, z: st.z } });
  if (was < PT.STARS_SUPER && k.stars >= PT.STARS_SUPER) emit(W, 'super', k, {});
}

function spill(W, k, n) {
  if (!n) return;
  W.stats.spilled += n;
  for (let i = 0; i < n; i++) {
    const a = W.r() * Math.PI * 2, v = IT.SPILL.v * (0.6 + W.r() * 0.6);
    W.spills.push({ x: k.pos.x, y: k.pos.y + 1, z: k.pos.z, vx: Math.cos(a) * v + k.vel.x * 0.35, vy: IT.SPILL.vy * (0.8 + W.r() * 0.5), vz: Math.sin(a) * v + k.vel.z * 0.35,
      t: 0, life: IT.SPILL.life, from: k, rest: false, bounces: 0, si: k.si, lat: k.lat, id: W.nextId++ });
  }
  if (W.spills.length > 48) W.spills.splice(0, W.spills.length - 48);
  emit(W, 'spill', k, { n, pos: { x: k.pos.x, y: k.pos.y, z: k.pos.z } });
}

function triggerHazard(W, h, k) {
  if (h.kind === 'puddle') {
    h.alive = false;
    emit(W, 'splat', k, { pos: { x: h.x, y: h.y, z: h.z }, by: h.owner });
    hitKart(W, k, 'spin', h.owner, 'icecream');
    return;
  }
  if (h.kind === 'nitro') {
    h.alive = false;
    explode(W, h.x, h.y + 0.5, h.z, IT.TNT.nitroBlast, 'nitro', h.owner, { hitOwner: true, big: true });
    return;
  }
  // TNT: lands on your head (unless you're a super star, have a shield, or already wear one)
  h.alive = false;
  if (k.invincT > 0) { emit(W, 'explode', h.owner, { pos: { x: h.x, y: h.y + 0.5, z: h.z }, r: 0, item: 'tnt' }); emit(W, 'blocked', k, { by: h.owner, item: 'tnt', why: 'star' }); W.stats.blocked++; return; }
  if (k.shieldT > 0) { hitKart(W, k, 'flip', h.owner, 'tnt'); emit(W, 'explode', h.owner, { pos: { x: h.x, y: h.y + 0.5, z: h.z }, r: 0, item: 'tnt' }); return; }
  if (k.tnt) { k.tnt = null; explode(W, k.pos.x, k.pos.y + 1.3, k.pos.z, 0, 'tnt', h.owner); hitKart(W, k, 'flip', h.owner, 'tnt'); W.stats.tntBoom++; return; }
  k.tnt = { t: IT.TNT.fuse, hops: 0, need: IT.TNT.hops, by: h.owner, tick: 3, age: 0 };
  W.stats.tntOn++;
  emit(W, 'tnt_on', k, { by: h.owner });
  emit(W, 'tnt_tick', k, { n: 3 });
}

function stepTnt(W, k, dt) {
  const tn = k.tnt;
  if (k.respawnT > 0 || k.finished) { k.tnt = null; emit(W, 'tnt_off', k, { why: 'gone' }); return; }
  tn.age += dt;
  for (const e of k.ev) if (e === 'hop') { tn.hops++; emit(W, 'tnt_hop', k, { n: tn.hops, need: tn.need }); }
  if (tn.hops >= tn.need) { k.tnt = null; W.stats.tntShaken++; emit(W, 'tnt_off', k, { why: 'shaken' }); return; }
  tn.t -= dt;
  const tick = Math.ceil(tn.t);
  if (tick < tn.tick && tick > 0) { tn.tick = tick; emit(W, 'tnt_tick', k, { n: tick }); }
  if (tn.t <= 0) {
    k.tnt = null; W.stats.tntBoom++;
    explode(W, k.pos.x, k.pos.y + 1.3, k.pos.z, 0, 'tnt', tn.by);
    hitKart(W, k, 'flip', tn.by, 'tnt');
  }
}

const _tp = {};
function stepProj(W, p, dt) {
  const tr = W.track, race = W.race, L = tr.length;
  p.px = p.x; p.py = p.y; p.pz = p.z;
  p.t += dt;
  if (p.t > p.life) { endProj(W, p, p.kind === 'taco_bomb' || p.kind === 'rocket'); return; }

  // ---- steering along the road
  let wantLat = p.lat, latRate = 0, wantY = null;
  const tg = p.target;
  if (tg && (tg.finished || tg.respawnT > 0)) {
    tg.lockedBy = Math.max(0, tg.lockedBy - 1); p.target = null;
    if (p.kind === 'warp') {            // the leader vanished: chase the new one
      const nt = race.order.find(o => o !== p.owner && !o.finished && o.respawnT <= 0 && !p.hitSet.has(o));
      if (nt) { p.target = nt; nt.lockedBy++; }
    }
  }
  if (p.target) {
    const t = p.target;
    const fwd = tr.wrapS(t.s - p.s);
    if (fwd > L - 8) {                  // flew past it (it braked / got bumped): give up the lock, fly on
      t.lockedBy = Math.max(0, t.lockedBy - 1); p.target = null; p.range = p.travelled + IT.ROCKET.lost;
    } else {
      t.lockDist = Math.min(t.lockDist, fwd);
      if (p.kind === 'rocket') p.v = Math.max(IT.ROCKET.speed, t.speed + IT.ROCKET.over);
      const near = p.kind === 'warp' ? 70 : 80;
      if (fwd < near) { wantLat = t.lat; latRate = p.kind === 'warp' ? 40 : p.homing; }
      else { wantLat = t.lat * 0.5; latRate = p.homing * 0.4 + (p.kind === 'warp' ? 6 : 0); }
      if (fwd < 25) wantY = t.pos.y + p.yOff;
    }
  } else if (p.kind === 'warp' || p.kind === 'rocket') {
    wantLat = 0; latRate = 3;
    if (p.range === Infinity) p.range = IT.ROCKET.lost;
  }
  if (p.kind === 'warp') {             // hungry: swerve into anyone it's about to pass (everyone "in its path")
    let bd = 12;
    for (const o of race.karts) {
      if (o === p.owner || o.finished || o.respawnT > 0 || p.hitSet.has(o)) continue;
      const d = tr.dS(p.s, o.s);
      if (d > -1 && d < bd && Math.abs(o.lat - p.lat) < 4.5) { bd = d; wantLat = o.lat; latRate = 40; }
    }
  }
  p.lat = approach(p.lat, wantLat, latRate * dt);
  const ds = p.v * dt;
  p.s = tr.wrapS(p.s + ds); p.travelled += Math.abs(ds);
  trackPoint(tr, p.s, p.lat, _tp);
  const edge = p.kind === 'rocket' || p.kind === 'warp' ? Math.min(_tp.limL, _tp.limR, _tp.hw + 6) - 0.5 : _tp.hw - 0.6;
  if (Math.abs(p.lat) > edge) { p.lat = Math.sign(p.lat) * edge; trackPoint(tr, p.s, p.lat, _tp); }
  let y = _tp.y + p.yOff;
  p.dy = Math.max(0, p.dy - dt * 8);
  if (p.kind === 'taco_bomb') y += Math.abs(Math.sin(p.t * 9)) * 0.25;
  if (wantY != null) p.y += (Math.max(y, wantY) - p.y) * Math.min(1, dt * 8);
  else p.y = y + p.dy;
  if (!isFinite(p.y)) p.y = y;
  p.x = _tp.x; p.z = _tp.z; p.yaw = p.v >= 0 ? _tp.yaw : _tp.yaw + Math.PI;

  // ---- contact
  for (const k of race.karts) {
    if (k === p.owner || k.respawnT > 0 || k.finished) continue;
    if (p.hitSet && p.hitSet.has(k)) continue;
    if (h2(k.pos, p) > p.r * p.r || Math.abs(k.pos.y + 0.5 - p.y) > IT.HIT_DY) continue;
    switch (p.kind) {
      case 'taco_bomb': endProj(W, p, true); return;
      case 'rocket': {
        const skip = k;
        if (hitKart(W, k, 'flip', p.owner, 'rocket')) W.stats.rocketHits++;
        endProj(W, p, false);
        explode(W, p.x, p.y, p.z, 0, 'rocket', p.owner, { skip });
        return;
      }
      case 'shield_shot': hitKart(W, k, 'spin', p.owner, 'shield'); p.alive = false; emit(W, 'fizzle', p.owner, { pos: { x: p.x, y: p.y, z: p.z }, item: 'shield_shot' }); return;
      case 'warp': {
        p.hitSet.add(k);
        hitKart(W, k, 'flip', p.owner, 'warp');
        emit(W, 'warp_hit', k, { by: p.owner, pos: { x: p.x, y: p.y, z: p.z } });
        if (k === p.target) { endProj(W, p, false); emit(W, 'fizzle', p.owner, { pos: { x: p.x, y: p.y, z: p.z }, item: 'warp' }); return; }
        break;
      }
    }
  }
  if (p.travelled >= p.range) endProj(W, p, p.kind === 'taco_bomb' || p.kind === 'rocket');
}

/* ============================================================================ AI */
function aiCfgFor(W, k) {
  const b = W.race.brains?.[k.index];
  if (b) for (const key in DIFFICULTY) if (DIFFICULTY[key] === b.cfg) return AI_ITEM[key];
  return AI_ITEM[k.isPlayer ? 'easy' : W.race.difficulty] || AI_ITEM.easy;
}

/**
 * The AI's item brain. ai.js calls this at the end of drive(): it may add `item` / `itemBack`
 * to the control object, and takes over the shoulders to hop a TNT off its head.
 */
function aiControl(W, b, c) {
  const k = b.kart, race = W.race, tr = W.track;
  const dt = 1 / 60;
  const cfg = aiCfgFor(W, k);
  const st = b.it || (b.it = { thinkT: W.r() * 0.5, holdT: 0, last: null, hopHold: 0, hopWait: 0.2 });
  c.item = false;
  if (race.phase !== 'race' || k.finished && !k.isPlayer) return c;

  // ---- TNT on the head: hop it off
  if (k.tnt) {
    b.sliding = false;
    c.hopA = false; c.hopB = false;
    if (st.hopHold > 0) { st.hopHold -= dt; c.hopA = true; }
    else if (!k.air && k.hitT <= 0 && k.spinT <= 0) {
      st.hopWait -= dt;
      if (st.hopWait <= 0) { c.hopA = true; st.hopHold = 1.5 / 60; st.hopWait = cfg.hopGap * (0.6 + W.r() * 0.8); }
    }
    c.steer = clamp(c.steer, -0.25, 0.25);
  } else st.hopWait = cfg.hopGap;

  const has = k.item || (k.shieldT > 0 && k.shieldArmed) || (k.bomb && k.bomb.alive);
  if (k.item !== st.last) { st.last = k.item; st.holdT = 0; }
  if (!has) { st.holdT = 0; return c; }
  st.holdT += dt;
  st.thinkT -= dt;
  if (st.thinkT > 0) return c;
  st.thinkT = cfg.think * (0.7 + W.r() * 0.6);
  if (k.hitT > 0 || k.spinT > 0 || k.respawnT > 0 || k.roulT > 0) return c;

  const human = o => o.isPlayer && !race.autoPlayer && !o.finished;
  const gentleMercy = cfg.mercy < 0.5;
  const chance = o => !o || !human(o) ? cfg.use : gentleMercy && W.t - (o._hitByT ?? -99) < 25 ? 0 : cfg.use * cfg.mercy;
  const roll = p => W.r() < p;
  // nearest kart ahead / behind in a lateral lane
  const scan = (d0, d1, lane) => {
    let best = null, bd = Infinity;
    for (const o of race.karts) {
      if (o === k || o.finished || o.respawnT > 0) continue;
      const d = tr.dS(k.s, o.s);
      if (d < d0 || d > d1) continue;
      if (lane != null && Math.abs(o.lat - k.lat) > lane) continue;
      if (Math.abs(d) < bd) { bd = Math.abs(d); best = o; }
    }
    return best;
  };
  const press = (back = false) => { c.item = true; c.itemBack = back; return c; };
  let timeout = st.holdT > 16;
  const gentle = gentleMercy;                  // Easy: never force a homing item onto the kid

  // a bomb in flight: set it off when someone is in the blast
  if (k.bomb && k.bomb.alive) {
    const bp = k.bomb;
    for (const o of race.karts) {
      if (o === k || o.finished || o.respawnT > 0) continue;
      if (h2(o.pos, bp) < (bp.blast * 0.8) ** 2 && roll(chance(o))) return press();
    }
    return c;
  }
  if (!k.item) {                                       // armed shield: fire it at someone ahead
    const o = scan(5, 35, cfg.aimLat);
    if (o && roll(chance(o))) return press();
    return c;
  }
  switch (k.item) {
    case 'rocket': {
      const tgt = race.order.find(o => o.place === k.place - 1);
      if (tgt && !tgt.finished && tr.dS(k.s, tgt.s) < 140 && roll(chance(tgt))) return press();
      if (!tgt && st.holdT > 8) return press();
      if (gentle && tgt && human(tgt)) timeout = false;
      break;
    }
    case 'taco_bomb': {
      const a = scan(6, 45, cfg.aimLat);
      if (a && roll(chance(a))) return press(false);
      const bh = scan(-22, -4, cfg.aimLat);
      if (bh && roll(chance(bh) * 0.7)) return press(true);
      break;
    }
    case 'tnt': case 'icecream': {
      const bh = scan(-20, -3, cfg.aimLat + 1);
      if (bh && roll(chance(bh))) return press();
      if (st.holdT > 10 && roll(0.3)) return press();
      break;
    }
    case 'shield':
      if (k.lockedBy > 0 && roll(cfg.defend)) return press();
      if (scan(-25, -2, null) && roll(0.25)) return press();
      if (st.holdT > cfg.hold * 3) return press();
      break;
    case 'turbo':
      if (st.holdT > 0.5 && !k.drift && !k.air && k.boostT < 0.3 && Math.abs(tr.turnAhead(k.s, 0, 45)) < 0.35 && roll(Math.min(1, cfg.use + 0.3))) return press();
      break;
    case 'superstar':
      if (st.holdT > cfg.hold && roll(0.8)) return press();
      break;
    case 'remote': {
      const P = race.player && human(race.player) ? Math.sqrt(cfg.mercy) : 1;
      if (st.holdT > cfg.hold && roll(cfg.use * P)) return press();
      break;
    }
    case 'warp': {
      const lead = race.order[0];
      if (st.holdT > cfg.hold && roll(chance(lead))) return press();
      if (gentle && human(lead)) timeout = false;
      break;
    }
  }
  if (timeout) return press();
  return c;
}
