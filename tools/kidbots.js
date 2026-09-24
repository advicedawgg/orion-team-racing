// kidbots.js — models of a young human player for the gate (tools/check.js) and tools/balance.js.
// Both drive the PLAYER kart through race.step(ctrl), so the race applies the real assists of the
// difficulty (easyBoost, kid assist steering nudge + softer sand, auto-accelerate = throttle always 1).
//
//   const bot = kidBot(race.player, track, seed);      // never power-slides, sloppy line, sways
//   const bot = wobblyKid(race.player, track, seed);   // + slow reactions, random steering noise,
//                                                      //   full-lock yanks and hop-mashing
//   simulate(race, { playerCtrl: r => bot.drive(r) });

import { createBrain, drive, DIFFICULTY, rng } from '../src/ai.js';

/** The gate's original kid: full pace, never slides, loose line, wobbles; uses items like an Easy AI. */
export function kidBot(kart, track, seed) {
  const b = createBrain(kart, track, 'easy', seed);
  b.cfg = { ...DIFFICULTY.easy, slide: 0, turbo: 0, line: 0.4, wobble: 4, grab: 1.5, dodge: 0.1 };
  return { brain: b, drive: race => drive(b, race) };
}

/**
 * A wobbly little kid: reacts 0.25 s late, steering carries a wandering noise (±0.5, ~0.7 s
 * correlation), every ~5 s yanks the stick to full lock for a moment, mashes hop now and then (which
 * sometimes turns into an accidental slide), never fires a turbo on purpose. Auto-accelerate.
 */
export function wobblyKid(kart, track, seed) {
  const bot = kidBot(kart, track, seed);
  const r = rng(seed * 131 + 7);
  const hist = [];
  let noise = 0, yankT = 0, yank = 0, hopT = 0, hopHold = 0;
  const DELAY = 15;                                    // frames (0.25 s)
  return {
    brain: bot.brain,
    drive(race) {
      const c = bot.drive(race);
      hist.push(c.steer);
      const lagged = hist.length > DELAY ? hist.shift() : 0;
      const dt = 1 / 60;
      noise += (-noise / 0.7) * dt + 0.5 * Math.sqrt(2 / 0.7) * Math.sqrt(dt) * (r() * 2 - 1) * 1.7;
      if (yankT > 0) yankT -= dt; else if (r() < dt / 5) { yankT = 0.2 + r() * 0.35; yank = r() < 0.5 ? -1 : 1; }
      let steer = yankT > 0 ? yank : lagged + noise;
      steer = Math.max(-1, Math.min(1, steer));
      // hop mashing: a tap every ~4 s, held 0.1–0.6 s (a held hop + steer = an accidental slide)
      if (hopHold > 0) hopHold -= dt; else if ((hopT -= dt) <= 0) { hopT = 2 + r() * 4; hopHold = 0.1 + r() * 0.5; }
      return { ...c, steer, throttle: 1, brake: 0, hopA: c.hopA || hopHold > 0, hopB: false };
    },
  };
}
