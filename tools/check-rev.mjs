// node tools/check-rev.mjs — the start-line rev gauge (race.js revGauge) is the old start-boost rule made visible:
// for every difficulty and a sweep of press / release times, boost / stall / over-rev / backfire match the rule.
import { TRACKS } from '../src/tracks/index.js';
import { buildTrack } from '../src/track.js';
import { DT, T } from '../src/physics.js';
import { createRace, COUNTDOWN } from '../src/race.js';
import { DIFFICULTY } from '../src/ai.js';
const def = Array.isArray(TRACKS) ? TRACKS[0] : Object.values(TRACKS)[0];
const tr = buildTrack(def);
const entrants = Array.from({ length: 8 }, (_, i) => ({ racerId: 'orion', stats: {} }));
let fails = 0, n = 0;
for (const diff of ['easy', 'medium', 'hard']) {
  const [w0, w1] = DIFFICULTY[diff].startWin;
  for (let press = -3.7; press <= 0.6; press += 0.0137) for (const release of [null, -0.6, -0.05, 0.3]) {
    if (release != null && release <= press) continue;
    const race = createRace({ track: tr, entrants, playerIndex: 0, difficulty: diff, seed: 1 });
    const k = race.player; let maxRev = 0, over = false, overAt = null, bf = [], stall = false, boost = false, smokeAtGo = 0;
    while (race.t < 1.2) {
      const t1 = race.t + DT;
      const held = t1 >= press && (release == null || t1 < release);
      race.step({ steer: 0, throttle: held ? 1 : 0, brake: 0, hopA: false, hopB: false });
      maxRev = Math.max(maxRev, k.rev); if (k.overRev && !over) { over = true; overAt = race.t; }
      for (const e of race.events) { if (e.type === 'kart' && e.kart === k && e.e === 'backfire') bf.push([race.t, e.v]); if (e.type === 'stall' && e.kart === k) stall = true; if (e.type === 'kart' && e.kart === k && e.e === 'start_boost') boost = true; if (e.type === 'go') smokeAtGo = k.misfireT; }
    }
    // the OLD rule, independent: edge = first step >= press after a release-free start (edge at the very first step = held from before)
    const firstStep = -COUNTDOWN + DT, edge = press <= firstStep + 1e-9 ? null : press;   // null: held since the lights → no mash
    const heldAtGo = release == null || release > 0;
    const expBoost = edge != null && ((heldAtGo && edge >= w0 - DT && edge < 0) || (edge >= 0 && edge <= w1 + DT));
    const expOver = edge != null && heldAtGo ? edge < w0 - DT : (edge != null && release != null && release - edge > -w0 + DT);
    const expStall = edge != null && heldAtGo && edge < w0 - DT && diff !== 'easy';
    n++;
    const bad = [];
    // boundaries within one step are ambiguous (press time vs step grid): skip ±1.5 DT around them
    const near = x => Math.abs(press - x) < 1.5 * DT;
    if (near(w0) || near(0) || near(w1) || near(firstStep) || (release != null && Math.abs(release - press + w0) < 2 * DT)) continue;
    if (boost !== expBoost) bad.push(`boost ${boost} exp ${expBoost}`);
    if (stall !== expStall) bad.push(`stall ${stall} exp ${expStall}`);
    if (over !== expOver) bad.push(`overRev ${over} exp ${expOver}`);
    if (over && !bf.length) bad.push('over-rev without a backfire');
    if (!over && bf.length) bad.push('backfire without an over-rev');
    if (over && boost) bad.push('over-revved AND boosted');
    if (edge != null && edge < 0 && heldAtGo && !over && maxRev <= 0) bad.push('fresh press never moved the gauge');
    if (edge == null && maxRev > 0) bad.push('held-from-before moved the gauge');
    if (bad.length) { fails++; if (fails < 15) console.log(diff, 'press', press.toFixed(3), 'release', release, bad.join('; '), 'bf', JSON.stringify(bf.slice(0, 3))); }
  }
}
console.log(fails ? `FAIL ${fails}/${n}` : `PASS ${n} cases`);
process.exit(fails ? 1 : 0);
