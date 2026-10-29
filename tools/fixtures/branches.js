// tools/fixtures/branches.js — the BRANCH TEST FIXTURE (gate + tests + `?fixture=1` in the browser). NOT a
// shipped track: it's Bubbly Beach plus one shortcut, "Crab Cut", across the inside of Crab Bend — narrower
// (11 m, 3 m of sand, beach walls), a ramp and a needsBoost jump over a tide pool (a full-width pad right
// before the lip; without the boost you land in the pool and the rescue puts you back on the main road
// before the entry), one item-box row and a star row. The real per-track shortcuts are authored in
// src/tracks/*.js by the tracks agents (DESIGN.md "Branches (shortcuts)").
//
// Its junction points come from the built main road (pointAt), so they sit exactly on the banked surface.
import beach from '../../src/tracks/beach.js';
import { buildTrack } from '../../src/track.js';

export const FIXTURE_ID = 'beach-fx';

export function fixtureDef() {
  const main = buildTrack(beach), HWB = 5.5;
  // a junction point: on the main road's banked surface, banked like it (bank pivots on the low edge, so
  // the branch centre sits hw·|tb| below the main surface there — then the two surfaces match across)
  const fit = (x, z) => {
    const q = main.project({ x, y: 1, z }, -1, {}), tb = q.tb;
    return { x: +x.toFixed(2), z: +z.toFixed(2), y: +(q.y - HWB * Math.abs(tb)).toFixed(3), bank: +(Math.atan(tb) * 180 / Math.PI).toFixed(2) };
  };
  const on = (at, lat) => { const p = main.pointAt(main.sOf(at), lat); return fit(p.x, p.z); };
  return {
    ...beach,
    id: FIXTURE_ID, name: 'Bubbly Beach (branch fixture)',
    branches: [{
      id: 'crabcut', name: 'Crab Cut',
      from: 15.25, to: 19.7, side: 'L',
      width: 11,
      defaults: { offL: 3, offR: 3, wallL: 'beach', wallR: 'beach' },
      points: [
        on(15.25, 3.5),                        // 0  leaves Crab Bend's entry on the left lane
        on(15.47, 7.4),                        // 1  drifts to the left edge, through the opening in the left wall
        fit(133.9, -147.4),                    // 2  peels off into the dunes inside the bend (r≈25 m)
        { x: 123.5, z: -154.8, y: 0.3 },       // 3
        { x: 108, z: -156.8, y: 0.5 },         // 4  item row, then the ramp starts
        { x: 88, z: -156.8, y: 1.7 },          // 5  the lip (needsBoost jump over the tide pool)
        { x: 64, z: -156.5, y: 0.4 },          // 6  landing on the far bank
        { x: 46, z: -153.3, y: 0.3 },          // 7  star row, then a r≈30 m swing back toward the start straight
        fit(27.7, -150.6),                     // 8
        fit(17.8, -143.7),                     // 9
        on(19.7, 3.5),                         // 10 rejoins on the left lane
      ],
      items: [{ at: 3.55 }],
      pads: [{ at: 4.62, lat: 0, len: 8, w: 9 }],   // 9 of the 11 m: a kart within 1 m of an edge misses it (pool → rescue before the entry)
      jumps: [{ at: 4.98, vy: 9 }],
      gaps: [{ from: 5.03, to: 5.77 }],
      needsBoost: true,
      stars: [{ at: 6.3, lat: 0, n: 5, spacing: 3.2 }],
      ai: { easy: 0.15, medium: 0.4, hard: 0.7 },
      hidden: true,
    }],
  };
}
