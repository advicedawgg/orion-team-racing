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
  //        top-speed pace, P(slide a big corner), P(nail each turbo), reaction s, P(start boost), rubber band (ahead, behind)
  easy:   { pace: 0.86, slide: 0.45, turbo: 0.4,  react: [0.10, 0.25], start: 0.15, band: [0.91, 1.08], line: 0.75, wobble: 1.6 },
  medium: { pace: 0.94, slide: 0.8,  turbo: 0.72, react: [0.04, 0.15], start: 0.45, band: [0.95, 1.05], line: 0.9,  wobble: 0.9 },
  hard:   { pace: 1.0,  slide: 1.0,  turbo: 0.93, react: [0.00, 0.07], start: 0.8,  band: [0.985, 1.02], line: 1.0, wobble: 0.4 },
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
    kart, track, cfg, r,
    phase: r() * 100, lane: (r() - 0.5) * 0.5,   // personal spread across the road, as a fraction of half-width
    sliding: false, slideDir: 0, cornerId: -1, willSlide: false,
    plan: null, pressT: 0, reactT: 0,
    stuckT: 0, reverseT: 0, t: 0,
    releaseB: false,
  };
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
  const hw = tr.HW[tr.idx(s)];

  // ---- where to aim
  const la = 6 + v * 0.5;
  const ks = tr.idx(s + la);
  let lat = tr.AIL[ks] * cfg.line;
  const lane = (b.lane + 0.18 * Math.sin(b.t * 0.23 + b.phase)) * hw * 0.7;
  lat += lane * (1 - Math.min(1, Math.abs(tr.AIL[ks]) / (hw * 0.5)));
  // aim for a pad in the next 45 m (medium/hard mostly)
  for (const p of tr.pads) {
    const d = tr.dS(s, p.s);
    if (d > 0 && d < 45 && b.r() < 0.02 + cfg.turbo * 0.08) b.padLat = p.lat;
    if (d > 0 && d < 45 && b.padLat != null) lat = lat * 0.3 + b.padLat * 0.7;
    if (d < -5 && d > -15) b.padLat = null;
  }
  // light avoidance of karts just ahead
  if (race) for (const o of race.karts) {
    if (o === k || o.respawnT > 0) continue;
    const d = tr.dS(s, o.s);
    if (d > 0 && d < 9 + v * 0.25) {
      const dl = o.lat - lat;
      if (Math.abs(dl) < 2.4) lat += (dl > 0 ? -1 : 1) * (2.4 - Math.abs(dl)) * 0.9;
    }
  }
  const lim = Math.max(0, hw - 1.4);
  lat = clamp(lat, -lim, lim);
  const tp = tr.pointAt(s + la, lat);
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
  const turn = tr.turnAhead(s, 3, 3 + 26 + v * 0.8);
  const turnNear = tr.turnAhead(s, 0, 14 + v * 0.35);
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
    const kap = tr.CURV[tr.idx(s + 4)];
    const need = err * 2.4 + v * kap * 1.05;
    const into = clamp((need * dir - T.DRIFT_BASE) / T.DRIFT_STEER, -1, 1);
    c.steer = k.drift ? into * dir : b.slideDir * (k.air ? 0.4 : 1);
    // end the slide when the corner runs out, or we're way off
    const ending = Math.abs(turnNear) < 0.12 || Math.sign(turnNear) !== dir && Math.abs(turnNear) > 0.05;
    const over = -err * dir;       // + = we've rotated past where we want to point
    const why = !k.drift ? (b.holdT > 0.6 ? 'nodrift' : null) : ending ? 'ending' : over > 0.55 ? 'over' : -over > 1.1 ? 'under' : Math.abs(k.lat) > hw + 3 ? 'wide' : null;
    if (why) { b.sliding = false; c.hopA = false; b.plan = null; b.endWhy = why; b.coolT = why === 'ending' ? 0.3 : 1.2; }
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
  return c;
}
