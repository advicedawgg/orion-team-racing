// ai.js — PURE AI driver (no THREE, no DOM). A later agent deepens this (items, personalities).
//
// Each AI kart gets a `brain` (createBrain) and each fixed step returns a control object
// exactly like the player's: { steer, throttle, brake, hopA, hopB }. The same physics runs
// both, so an AI can't do anything a kid can't.
//
// Racing line = track.AIL (centre line + a smoothed inside-of-corner offset, built in track.js)
// + a personal offset so the pack spreads out + light avoidance of the kart ahead.
// Corners with enough turn ahead get a power slide; turbo timing depends on difficulty.

import { redStart, T } from './physics.js';

export const DIFFICULTY = {
  // pace = top-speed factor; slide = P(slide a big corner); turbo = P(nail each turbo); react = turbo press lag (s);
  // start = P(start boost); startWin = the human's start-boost window [s before GO, s after] (Easy: you can react to GO!); band = rubber band vs the human: pace × [ahead, behind] at full effect, reached
  // bandD = [m ahead, m behind] (race.js ramps linearly; Easy keeps the pack round the kid); line = racing-line commitment;
  // wobble = steering sway; grab = m of sideways detour it takes for an item box / star (balance agent);
  // dodge = P(it notices a hazard ahead and steers round it); catchup = [lift, from m, full at m]: EVERY kart (AI or
  // human) that far behind the race leader gets top speed × (1 + lift), ramped (race.js) — the pack reels a runaway in
  easy:   { pace: 0.86, slide: 0.45, turbo: 0.4,  react: [0.10, 0.25], start: 0.15, startWin: [-0.5, 0.45], band: [0.84, 1.24], bandD: [60, 50], catchup: [0.10, 25, 140], line: 0.75, wobble: 1.6, grab: 2.0, dodge: 0.25 },
  medium: { pace: 0.94, slide: 0.8,  turbo: 0.72, react: [0.04, 0.15], start: 0.45, startWin: [-0.35, 0.3], band: [0.92, 1.1], bandD: [100, 110], catchup: [0.08, 30, 160], line: 0.9,  wobble: 0.9, grab: 3.5, dodge: 0.7 },
  hard:   { pace: 1.0,  slide: 1.0,  turbo: 0.93, react: [0.00, 0.07], start: 0.8,  startWin: [-0.25, 0.1], band: [0.96, 1.06], bandD: [110, 130], catchup: [0.06, 40, 180], line: 1.0, wobble: 0.4, grab: 5.0, dodge: 0.95 },
};

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Small deterministic PRNG so headless races are repeatable. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function createBrain(kart, track, difficulty = 'easy', seed = 1) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.easy;
  const r = rng(seed * 7919 + kart.index * 104729 + 17);
  return {
    kart, track, cfg, r, diff: difficulty,
    phase: r() * 100, lane: (r() - 0.5) * 0.5,   // personal spread across the road, as a fraction of half-width
    sliding: false, slideDir: 0, cornerId: -1, willSlide: false,
    plan: null, pressT: 0, reactT: 0,
    stuckT: 0, reverseT: 0, t: 0,
    releaseB: false,
    seen: new Map(),            // hazard/projectile id → noticed it? (decided once, by cfg.dodge)
    pick: null,                 // branches: { b, lap, take } — this lap's decision for the next branch
  };
}

/**
 * Branches (shortcuts): which branch this brain will take next, or -1. Decided once per lap per
 * branch, ~150 m before it, with the branch's `ai[difficulty]` probability; `race.forceBranch`
 * (tests / URL `&branch=<id>`; '-' = never) overrides it for every brain. Pure, cheap.
 */
function branchPlan(b, race) {
  const k = b.kart, tr = b.track;
  if (k.route) return -1;
  let best = -1, bd = Infinity;
  for (const br of tr.branches) {
    const d = tr.dS(k.s, br.sEntry);
    if (d < -br.zoneIn - 6 || d > 150) continue;     // passed it (missed the opening) / too far ahead
    if (d < bd) { bd = d; best = br.index; }
  }
  if (best < 0) return -1;
  const key = best * 1000 + k.lapsDone;
  if (!b.pick || b.pick.key !== key) {
    const br = tr.branches[best], f = b.forceBranch ?? race?.forceBranch;   // brain.forceBranch: per-brain test hook
    const take = f ? f === br.id : b.r() < (br.ai[b.diff] ?? 0);
    b.pick = { key, b: best, take };
  }
  return b.pick.take ? best : -1;
}

/** Lazily index the items world for the AI: box rows (by s) and track stars with their lat. */
function pickIndex(W, tr) {
  if (W._aiIdx) return W._aiIdx;
  const rows = [];
  for (const bx of W.boxes) { const ro = bx.route | 0; let r = rows.find(r => Math.abs(r.s - bx.s) < 0.5 && r.route === ro); if (!r) rows.push(r = { s: bx.s, route: ro, boxes: [] }); r.boxes.push(bx); }
  const stars = [];
  let i = 0;
  for (const row of tr.allStarRows || tr.starRows) for (const p of row.points) { const st = W.stars[i++]; if (st) stars.push({ st, s: p.s, lat: p.lat, route: row.route | 0 }); }
  stars.sort((a, b) => a.s - b.s);
  return (W._aiIdx = { rows, stars });
}

/**
 * Where the AI wants to be across the road (lat, m) given its racing-line wish `lat`:
 * steer round hazards / bombs coming back at it (by cfg.dodge), else detour to a ? box (no item)
 * or a star (< 10) when it's within cfg.grab metres of the line. Pure, cheap (few dozen objects).
 */
function pickLat(b, race, lat, v, lim) {
  const k = b.kart, tr = b.track, cfg = b.cfg, W = race?.items;
  if (!W || race.noItems || race.phase !== 'race') return lat;
  const route = k.route | 0;      // branches: only what's on our own route (lat is per route)
  // ---- dodge: hazards on the road ahead, bombs/shield shots rolling back at us
  let dodge = null, dBest = Infinity;
  const consider = (id, s, hl, r, ro) => {
    if ((ro | 0) !== route) return;
    const d = tr.dS(k.s, s);
    if (d < 1.5 || d > 12 + v * 0.9 || d > dBest) return;
    if (Math.abs(hl - lat) > r + 1.5) return;
    let saw = b.seen.get(id);
    if (saw == null) { saw = b.r() < cfg.dodge; b.seen.set(id, saw); if (b.seen.size > 64) b.seen.delete(b.seen.keys().next().value); }
    if (!saw) return;
    dBest = d;
    const left = hl + r + 1.7, right = hl - r - 1.7;           // pass on the side nearer our line that fits
    const okL = left <= lim, okR = right >= -lim;
    dodge = okL && (!okR || Math.abs(left - lat) < Math.abs(right - lat)) ? left : okR ? right : lat;
  };
  for (const h of W.hazards) if (h.alive && !(h.owner === k && h.t < 0.5)) consider(h.id, h.s, h.lat, h.r, h.route);
  for (const p of W.projs) if (p.alive && p.owner !== k && p.v < 0) consider(p.id, p.s, p.lat, (p.blast || p.r) * 0.7, p.route);
  if (dodge != null) return dodge;
  if (cfg.grab <= 0 || b.sliding && k.turbos < 1 && k.charge < 0.2) return lat;   // don't wreck a slide just started
  // ---- detour to a ? box when the slot is empty
  const I = pickIndex(W, tr);
  const reach = cfg.grab, far = 14 + v * 1.1;
  if (!k.item && k.roulT <= 0 && !(k.bomb && k.bomb.alive) && !k.shieldArmed) {
    let best = null, bd = Infinity;
    for (const r of I.rows) {
      if (r.route !== route) continue;
      const d = tr.dS(k.s, r.s);
      if (d < 2 || d > far) continue;
      for (const bx of r.boxes) if (bx.alive || bx.respawnT < d / Math.max(8, v)) {
        const dl = Math.abs(bx.lat - lat);
        if (dl < reach && dl + d * 0.05 < bd) { bd = dl + d * 0.05; best = bx.lat; }
      }
    }
    if (best != null) return clamp(best, -lim, lim);
  }
  // ---- stars: the nearest one ahead that's close to the line (a full kart drives through them)
  if (k.stars < T.STARS_MAX) {
    let best = null, bd = Infinity;
    for (const e of I.stars) {
      if (!e.st.alive || e.route !== route) continue;
      const d = tr.dS(k.s, e.s);
      if (d < 2 || d > far * 0.8) continue;
      const dl = Math.abs(e.lat - lat);
      if (dl < reach * 0.8 && d + dl * 3 < bd) { bd = d + dl * 3; best = e.lat; }
    }
    for (const sp of W.spills) {
      if (!sp.rest) continue;
      const q = tr.project(sp, sp.si, sp._pr || {});
      if ((q.route | 0) !== route) continue;
      const d = tr.dS(k.s, tr.wrapS(q.s ?? 0));
      if (d < 2 || d > far * 0.6) continue;
      const dl = Math.abs(sp.lat - lat);
      if (dl < reach * 0.6 && d + dl * 3 < bd) { bd = d + dl * 3; best = sp.lat; }
    }
    if (best != null) return clamp(best, -lim, lim);
  }
  return lat;
}

/** Decide how this turbo attempt goes: a charge level to press at, or never (overheat). */
function planTurbo(b) {
  const k = b.kart, r0 = redStart(k), win = 1 - r0;
  const ok = b.r() < b.cfg.turbo;
  if (ok) return { at: r0 + win * (0.1 + 0.55 * b.r()) + b.cfg.react[0] * (1 / T.CHARGE_T) * b.r() };
  return b.r() < 0.6 ? { at: r0 * (0.45 + 0.4 * b.r()) } : { at: 2 };   // too early (fizzle) or never (overheat)
}

/**
 * One step of driving. `race` gives other karts (for avoidance) and is optional.
 * Returns { steer, throttle, brake, hopA, hopB }.
 */
export function drive(b, race) {
  const k = b.kart, tr = b.track, cfg = b.cfg, dt = 1 / 60;
  b.t += dt;
  const c = { steer: 0, throttle: 1, brake: 0, hopA: false, hopB: false };
  if (k.frozen || k.respawnT > 0) { b.sliding = false; return c; }
  const v = Math.max(0, k.speed);
  const s = k.s;
  // the path ahead: this route, then the branch it chose (main) / the main road after the exit (branch).
  // On an unbranched track this is exactly tr.idx(s + d) etc. (route 0, no plan).
  let route = k.route | 0, rs = route ? k.rs : s;
  const plan = tr.branches?.length ? branchPlan(b, race) : -1;
  // slid onto a branch it chose NOT to take (a drift past the main road's edge at the mouth, a bump): still in
  // the entry zone, so steer on along the main road (from its own main-road projection) and the junction puts
  // it back on main — instead of committing to the shortcut
  if (route && rs < tr.routes[route].zoneIn && !(b.pick && b.pick.b === route - 1 && b.pick.take)) {
    const br = tr.routes[route], h = br.JH[clamp(k.si - br.off, 0, br.n - 1)];
    route = 0; rs = tr.projectOn(0, k.pos, h, b._mq || (b._mq = {})).s;
  }
  const at = d => tr.pathAt ? tr.pathAt(route, rs, d, plan) : { rt: tr, s: s + d };
  const head = d => { const q = at(d); return q.rt.HEAD[q.rt.idx(q.s)]; };
  const rt0 = route ? tr.routes[route] : tr;
  const hw = rt0.HW[rt0.idx(rs)];

  // ---- where to aim
  const la = 6 + v * 0.5;
  const A = at(la), ks = A.rt.idx(A.s);
  let lat = A.rt.AIL[ks] * cfg.line;
  const lane = (b.lane + 0.18 * Math.sin(b.t * 0.23 + b.phase)) * hw * 0.7;
  lat += lane * (1 - Math.min(1, Math.abs(A.rt.AIL[ks]) / (hw * 0.5)));
  // aim for a pad in the next 45 m (medium/hard mostly)
  for (const p of rt0.pads) {
    const d = rt0.dS(rs, p.s);
    if (d > 0 && d < 45 && b.r() < 0.02 + cfg.turbo * 0.08) b.padLat = p.lat;
    if (d > 0 && d < 45 && b.padLat != null) lat = lat * 0.3 + b.padLat * 0.7;
    if (d < -5 && d > -15) b.padLat = null;
  }
  const lim = Math.max(0, hw - 1.4);
  // items world: dodge hazards, detour for ? boxes and stars (balance agent)
  lat = pickLat(b, race, clamp(lat, -lim, lim), v, lim);
  // avoidance of karts just ahead — wider round one that's crashed/spinning or much slower (no pile-ups)
  if (race) for (const o of race.karts) {
    if (o === k || o.respawnT > 0 || (o.route | 0) !== route) continue;
    const d = tr.dS(s, o.s);
    const slow = o.hitT > 0 || o.spinT > 0 || o.speed < v - 6;
    const w = slow ? 3.2 : 2.4;
    if (d > 0 && d < (slow ? 14 : 9) + v * 0.25) {
      const dl = o.lat - lat;
      if (Math.abs(dl) < w) lat += (dl > 0 ? -1 : 1) * (w - Math.abs(dl)) * 0.9;
    }
  }
  lat = clamp(lat, -lim, lim);
  // a branch it's heading for: once the aim point is on it, the lateral clamp is the branch's
  const tp = A.rt === rt0 ? A.rt.pointAt(A.s, lat) : A.rt.pointAt(A.s, clamp(lat, -(A.rt.HW[ks] - 1.4), A.rt.HW[ks] - 1.4));
  const want = Math.atan2(tp.x - k.pos.x, tp.z - k.pos.z);
  const err = wrapA(want - k.yaw);

  // ---- stuck / wrong way recovery
  if (b.reverseT > 0) {
    b.reverseT -= dt;
    c.throttle = 0; c.brake = 1; c.steer = -Math.sign(err) || 1;
    return c;
  }
  const disabled = k.hitT > 0 || k.spinT > 0;
  if (!disabled && v < 2.0 && !k.air) b.stuckT += dt; else b.stuckT = Math.max(0, b.stuckT - dt * 2);
  if (b.stuckT > 1.1) { b.stuckT = 0; b.reverseT = 0.8; b.sliding = false; return c; }

  // ---- slide decision: read the corner ahead
  const turn = wrapA(head(3 + 26 + v * 0.8) - head(3));
  const turnNear = wrapA(head(14 + v * 0.35) - head(0));
  const corner = Math.floor(tr.dS(0, s + 40) / 60);
  if (!b.sliding) {
    if (corner !== b.cornerId) { b.cornerId = corner; b.willSlide = b.r() < cfg.slide; }
    const big = Math.abs(turn) > 0.8 && Math.sign(turnNear) === Math.sign(turn) && Math.abs(turnNear) > 0.28;
    b.coolT = Math.max(0, (b.coolT || 0) - dt);
    if (b.willSlide && big && v > 15 && !k.air && Math.abs(err) < 0.5 && !disabled && k.landT > 0.3 && b.coolT <= 0) {
      b.sliding = true; b.slideDir = Math.sign(turn); b.plan = planTurbo(b); b.pressT = 0; b.holdT = 0;
    }
  }

  if (b.sliding) {
    b.holdT += dt;
    c.hopA = true;
    const dir = k.drift || b.slideDir;
    // steer to hold the line: needed yaw rate ≈ heading error correction + path curvature
    const K4 = at(4), kap = K4.rt.CURV[K4.rt.idx(K4.s)];
    const need = err * 2.4 + v * kap * 1.05;
    const into = clamp((need * dir - T.DRIFT_BASE) / T.DRIFT_STEER, -1, 1);
    c.steer = k.drift ? into * dir : b.slideDir * (k.air ? 0.4 : 1);
    // end the slide when the corner runs out, or we're way off
    const ending = Math.abs(turnNear) < 0.12 || Math.sign(turnNear) !== dir && Math.abs(turnNear) > 0.05;
    const over = -err * dir;       // + = we've rotated past where we want to point
    // about to slide into a wall / off a fall edge even steering fully "away" (a slide can't turn less than
    // (DRIFT_BASE − DRIFT_STEER) rad/s): let go. Predicts 0.5 s ahead with the road curving under us.
    const pr = k._pr;
    let wall = false;
    if (pr && pr.lx != null && k.drift) {
      const tq = 0.5, rel = wrapA(k.yaw - head(0));
      const minRate = k.drift * (T.DRIFT_BASE - T.DRIFT_STEER) * (1 + (k.stats.turn - 3) * T.STAT);
      const KQ = at(v * tq * 0.5), relRate = minRate - v * KQ.rt.CURV[KQ.rt.idx(KQ.s)];
      const pl = k.lat + v * Math.sin(rel) * tq + 0.5 * v * relRate * tq * tq;
      const limL = isFinite(pr.limL) ? pr.limL : pr.hw + 0.3, limR = isFinite(pr.limR) ? pr.limR : pr.hw + 0.3;
      wall = pl > limL - 0.9 || pl < -limR + 0.9;
    }
    const why = !k.drift ? (b.holdT > 0.6 ? 'nodrift' : null) : ending ? 'ending' : over > 0.55 ? 'over' : -over > 1.1 ? 'under' : wall ? 'wall' : Math.abs(k.lat) > hw + 3 ? 'wide' : null;
    if (why) { b.sliding = false; c.hopA = false; b.plan = null; b.endWhy = why; b.coolT = why === 'ending' ? 0.3 : why === 'wall' ? 0.7 : 1.2; }
    // turbo presses
    if (k.drift && b.plan && !k.overheat && k.turbos < 3) {
      if (b.pressT > 0) { c.hopB = true; b.pressT -= dt; if (b.pressT <= 0) b.plan = planTurbo(b); }
      else if (k.charge >= b.plan.at) { c.hopB = true; b.pressT = 3 / 60; }
    }
    if (!c.hopA) c.steer = clamp(err * 2.4, -1, 1);
  } else {
    // normal steering: proportional on heading error, with a touch of human wobble on easy
    c.steer = clamp(err * 2.6 + Math.sin(b.t * 1.7 + b.phase) * 0.04 * cfg.wobble, -1, 1);
  }

  // ---- speed control: lift/brake when way off the line
  if (Math.abs(err) > 1.1 && v > 10) { c.throttle = 0; c.brake = 0.6; }
  else if (Math.abs(err) > 0.7 && v > 18 && !k.drift) c.throttle = 0.4;
  return race?.items ? race.items.aiControl(b, c) : c;   // items agent: item use + TNT shake-off (items.js)
}

/**
 * KID ASSIST (Easy, or the KID HELPER setting): a gentle steering nudge back toward the road for the
 * human player. It only acts when the kart is predicted to leave the road within ~0.7 s (or already
 * has), is strongest toward a `fall` edge (Star Road), adds at most ±ASSIST.max steer on top of the
 * player's input and never fights a player who's already steering back harder. Race.js applies it
 * to the player's control object before physics (so the gate's bots get exactly what a kid gets).
 */
export const ASSIST = {
  look: 0.7, margin: 0.6, ramp: 3, max: 0.5, offroad: 0.3, edge: 0.6,   // ordinary edges (sand/grass then a wall): a nudge
  fallLook: 1.0, fallMargin: 1.6, fallRamp: 2.5, fallMax: 0.85,        // a `fall` edge (Star Road): a firm hand on the wheel
  jumpLook: 1.9,                                                       // on a jump run-up: aim the landing (lip + ~1 s of air)
};
export function kidAssist(k, tr, c) {
  const pr = k._pr;
  if (!pr || pr.lx == null || k.respawnT > 0 || k.frozen || k.hitT > 0 || k.spinT > 0 || k.speed < 4) return c;
  const A = ASSIST;
  const vLat = k.vel.x * pr.lx + k.vel.z * pr.lz;                  // + = drifting toward the left edge
  const side = vLat >= 0 ? 1 : -1;
  const fall = side > 0 ? !isFinite(pr.limL) : !isFinite(pr.limR);
  if (fall) {
    // heading for a drop (also in the air — weak there): blend the stick toward "back onto the road"
    const runUp = (pr.flag ?? tr.FLAG[pr.i]) & 16;
    const pl = k.lat + vLat * (runUp || k.air ? A.jumpLook : A.fallLook), edge = pr.hw - A.fallMargin;
    const over = side * pl - edge;
    if (over > 0) {
      const a = Math.min(A.fallMax, over / A.fallRamp);
      return { ...c, steer: clamp(c.steer * (1 - a) - side * a, -1, 1) };
    }
  }
  if (k.air) return c;
  const pl = k.lat + vLat * A.look;                                // where we'll be across the road soon
  const edge = pr.hw - A.margin;
  let over = pl > edge ? pl - edge : pl < -edge ? pl + edge : 0;   // + = heading off the left side
  if (!over && Math.abs(k.lat) > pr.hw) over = k.lat - Math.sign(k.lat) * pr.hw;   // already on the sand: ease back
  if (!over) return c;
  const w = Math.abs(k.lat) > pr.hw && Math.abs(pl) <= Math.abs(k.lat) ? A.offroad : A.edge;
  const nudge = -Math.sign(over) * Math.min(1, Math.abs(over) / A.ramp) * A.max * w;
  if (Math.sign(c.steer) === Math.sign(nudge) && Math.abs(c.steer) >= Math.abs(nudge)) return c;
  return { ...c, steer: clamp(c.steer + nudge, -1, 1) };
}
