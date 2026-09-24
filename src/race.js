// race.js — PURE race manager (no THREE, no DOM): countdown, the fixed-step sim for all
// karts (AI + player), laps via ordered checkpoints, positions, finish. The browser and the
// node gate run exactly this. main.js feeds the player's controls in and reads events out.
//
//   const race = createRace({ track, entrants, playerIndex, difficulty });
//   race.step(playerCtrl)            // one 1/60 s step
//   race.events                      // this step's events (cleared at the start of each step)
//   race.addSystem(fn)               // fn(race, dt) runs every step after physics (items agent)

import { DT, createKart, placeKart, stepKart, collideKarts, addBoost, T } from './physics.js';
import { createBrain, drive, DIFFICULTY, kidAssist } from './ai.js';

export const COUNTDOWN = 3.6;          // s from the start of the countdown to GO
export const START_WINDOW = [-0.25, 0.1]; // press accelerate in here (s relative to GO) for a start boost
export const AFTER_PLAYER = 20;        // s the race keeps going after the player finishes before it's called

/**
 * entrants: [{ racerId, stats }] (grid order: index 0 = pole). playerIndex: which one is the
 * player (-1 = all AI, e.g. the gate). opts: difficulty, laps, seed, easyBoost (kid assist, player),
 * noStall (disable the early-mash stall; always on in easy).
 */
export function createRace({ track, entrants, playerIndex = -1, difficulty = 'easy', laps, seed = 1, easyBoost, noStall, assist } = {}) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.easy;
  laps = laps ?? track.laps ?? 3;
  const easy = difficulty === 'easy';
  const karts = entrants.map((e, i) => {
    const isPlayer = i === playerIndex;
    const k = createKart({ racerId: e.racerId, stats: e.stats, isPlayer, index: i,
      easyBoost: isPlayer ? (easyBoost ?? easy) : false, pace: isPlayer ? 1 : cfg.pace });
    k.assist = isPlayer && (assist ?? easyBoost ?? easy);   // kid assist: steering nudge + softer offroad (ai.js kidAssist, balance agent)
    placeKart(k, track.grid[i % track.grid.length], track);
    return k;
  });
  const brains = karts.map(k => createBrain(k, track, k.isPlayer ? 'hard' : difficulty, seed));
  const race = {
    track, karts, brains, laps, difficulty, cfg, playerIndex,
    player: playerIndex >= 0 ? karts[playerIndex] : null,
    t: -COUNTDOWN, phase: 'countdown', events: [], order: karts.slice(), finishCount: 0,
    autoPlayer: false, systems: [], stepN: 0, doneT: null,
    stats: karts.map(() => ({ stuck: 0, maxStuck: 0, respawns: 0, walls: 0, turbos: 0, fizzles: 0, overheats: 0, pads: 0, jumps: 0, bestLap: Infinity })),
    addSystem(fn) { this.systems.push(fn); },
    step(playerCtrl) { stepRace(this, playerCtrl); },
    /** Results in finishing order: [{ kart, place, time, finished }] */
    results() {
      return this.order.map((k, i) => ({ kart: k, racerId: k.racerId, place: i + 1, time: k.finishTime, finished: k.finished, estimated: !!k.estimated, lapTimes: k.lapTimes }));
    },
  };
  for (const k of karts) { k.lap = 1; k.lapsDone = 0; k.nextCp = 0; k.lapStartT = 0; k._thrEdge = -99; k._thrPrev = 0; }
  race.noStall = noStall ?? easy;
  return race;
}

const NOCTRL = { steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false };

function emit(race, type, k, extra) { race.events.push({ type, kart: k, ...extra }); }

function stepRace(race, playerCtrl = NOCTRL) {
  const { track, karts, brains } = race;
  race.events.length = 0;
  const prevT = race.t;
  race.t += DT; race.stepN++;
  const t = race.t;

  // ---------------------------------------------------------------- countdown
  if (race.phase === 'countdown') {
    for (const n of [3, 2, 1]) if (prevT < -n && t >= -n) emit(race, 'count', null, { n });
    // record throttle edges for the start boost
    for (const k of karts) {
      const thr = k.isPlayer && !race.autoPlayer ? playerCtrl.throttle : 0;
      if (thr > 0.5 && k._thrPrev <= 0.5) k._thrEdge = t;
      k._thrPrev = thr;
    }
    if (t >= 0) {
      race.phase = 'race';
      emit(race, 'go', null);
      for (const k of karts) {
        k.frozen = false; k.lapStartT = 0;
        if (k.isPlayer && !race.autoPlayer) {
          if (k._thrPrev > 0.5 && k._thrEdge >= START_WINDOW[0]) startBoost(race, k);
          else if (k._thrPrev > 0.5 && k._thrEdge > -COUNTDOWN + 0.01 && !race.noStall) { k.stallT = T.STALL_T; emit(race, 'stall', k); }
        } else if (brains[k.index].r() < race.cfg.start || (k.isPlayer && race.autoPlayer)) startBoost(race, k);
      }
    } else {
      for (const k of karts) { k.ev.length = 0; stepKart(k, k.isPlayer ? { ...NOCTRL, throttle: playerCtrl.throttle } : NOCTRL, track); }
      // grid order until the lights go green
      for (const k of karts) k.progress = k.s > track.length / 2 ? k.s - track.length : k.s;
      race.order.sort((a, b) => b.progress - a.progress); race.order.forEach((k, i) => { k.place = i + 1; });
      return;
    }
  }
  // late start boost: a clean press just after GO still counts
  if (t <= START_WINDOW[1] && race.player && !race.player._sb && !race.autoPlayer) {
    const k = race.player;
    if (playerCtrl.throttle > 0.5 && k._thrPrev <= 0.5 && k.stallT <= 0) startBoost(race, k);
    k._thrPrev = playerCtrl.throttle;
  }

  // ---------------------------------------------------------------- rubber band (AI pace vs the player)
  const focus = race.player;
  if (focus) for (const k of karts) {
    if (k.isPlayer) continue;
    const d = k.progress - focus.progress;           // + = AI ahead
    const [ahead, behind] = race.cfg.band, [dA, dB] = race.cfg.bandD || [120, 150];   // full effect at dA m ahead / dB m behind
    const f = d > 0 ? 1 + (ahead - 1) * Math.min(1, d / dA) : 1 + (behind - 1) * Math.min(1, -d / dB);
    k.pace = race.cfg.pace * f;
  }

  // ---------------------------------------------------------------- drive
  for (const k of karts) {
    k.ev.length = 0;
    const b = brains[k.index];
    const useAI = !k.isPlayer || race.autoPlayer || k.finished;
    const c = useAI ? drive(b, race) : k.assist ? kidAssist(k, track, playerCtrl) : playerCtrl;
    k.ctrl = c;
    stepKart(k, c, track);
  }
  collideKarts(karts);
  for (const fn of race.systems) fn(race, DT);

  // ---------------------------------------------------------------- laps
  const L = track.length, cps = track.checkpoints;
  for (const k of karts) {
    const st = race.stats[k.index];
    for (const e of k.ev) {
      const name = Array.isArray(e) ? e[0] : e;
      emit(race, 'kart', k, { e: name, v: Array.isArray(e) ? e[1] : undefined });
      if (name === 'respawn') st.respawns++; else if (name === 'wall') st.walls++;
      else if (name.startsWith('turbo')) st.turbos++; else if (name === 'fizzle') st.fizzles++;
      else if (name === 'overheat') st.overheats++; else if (name === 'pad') st.pads++; else if (name === 'ramp') st.jumps++;
    }
    if (k.respawnT > 0) { k._prevS = k.s; continue; }
    const prev = k._prevS ?? k.s;
    k._prevS = k.s;
    if (k.nextCp < cps.length) {
      const d = track.dS(cps[k.nextCp], k.s);
      if (d >= 0 && d < 80) k.nextCp++;
    }
    const crossed = prev > L - 60 && k.s < 60;
    if (crossed && k.nextCp >= cps.length && !k.finished) {
      k.lapsDone++; k.nextCp = 0;
      const lt = t - k.lapStartT; k.lapTimes.push(lt); k.lastLapT = lt; k.lapStartT = t;
      st.bestLap = Math.min(st.bestLap, lt);
      if (k.lapsDone >= race.laps) {
        k.finished = true; k.finishTime = t; k.finishPlace = ++race.finishCount;
        emit(race, 'finish', k, { place: k.finishPlace });
        if (k.isPlayer) race.playerDoneT = t;
      } else {
        k.lap = k.lapsDone + 1;
        emit(race, 'lap', k, { lap: k.lap });
        if (k.lap === race.laps) emit(race, 'final_lap', k);
      }
    }
    k.progress = k.lapsDone * L + (k.nextCp === 0 && k.s > L / 2 ? k.s - L : k.s);
    // stuck stats (for the gate)
    const disabled = k.hitT > 0 || k.spinT > 0 || k.frozen;
    if (!disabled && !k.finished && k.speed < 3) { st.stuck += DT; st.maxStuck = Math.max(st.maxStuck, st.stuck); }
    else st.stuck = 0;
  }

  // ---------------------------------------------------------------- positions
  race.order.sort((a, b) => {
    if (a.finished || b.finished) {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
      return a.finished ? -1 : 1;
    }
    return b.progress - a.progress;
  });
  race.order.forEach((k, i) => { k.place = i + 1; });

  // ---------------------------------------------------------------- end of race
  if (race.phase === 'race') {
    const all = karts.every(k => k.finished);
    const called = race.playerDoneT != null && t - race.playerDoneT > AFTER_PLAYER;
    if (all || called) {
      // estimate the rest from their pace so far
      for (const k of race.order) if (!k.finished) {
        const avg = Math.max(8, k.progress / Math.max(1, t));
        k.finishTime = t + (race.laps * L - k.progress) / avg; k.estimated = true; k.finished = true; k.finishPlace = ++race.finishCount;
      }
      race.order.sort((a, b) => a.finishPlace - b.finishPlace);
      race.phase = 'done'; race.doneT = t;
      emit(race, 'race_done', null);
    }
  }
}

function startBoost(race, k) {
  if (k._sb) return;
  k._sb = true;
  addBoost(k, T.START.t, T.START.tier, T.START.kick);
  emit(race, 'kart', k, { e: 'start_boost' });
}

/** Run a whole race headless. Returns the race. onStep(race) optional. */
export function simulate(race, { maxT = 400, playerCtrl = null, onStep = null } = {}) {
  while (race.phase !== 'done' && race.t < maxT) {
    race.step(playerCtrl ? playerCtrl(race) : NOCTRL);
    if (onStep) onStep(race);
  }
  return race;
}
