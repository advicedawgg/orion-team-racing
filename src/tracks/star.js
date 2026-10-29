// Star Road — the SECRET track (unlocked by winning the Orion Cup; `secret: true` below — the UI
// hides/unlocks it). A glowing rainbow road floating in space: a nod to Super Orion 1's Star Road.
// Data only: see DESIGN.md "Track data format".
//
// From the start you roll north over two big space-waves (a hang-time hop off the second), round
// the Comet Hairpin (walled), then plunge down the RAINBOW DROP — no walls, cloud shoulders, and a
// star-gate jump halfway — into the HELIX: a banked right-hand corkscrew that winds 450° down
// round itself (it passes under its own entrance). Out of the bottom you skim the STARDUST BRIDGE
// (no walls again) right under the start straight, swing round the Moon Loop and climb back up.
//
// Authored in "map" coordinates (mx = east, z = north); world x = −mx (+x is LEFT of a kart
// driving +z). Walls are `none` where src/scenery/star.js draws glowing rails, `fall` where there
// is nothing but space (off = the cloud shoulder you can still drive on).
// Hidden shortcut: the Warp Ribbon across the inside of the Comet Hairpin (`branches`, at the bottom).
const M = (mx, z, y, extra = {}) => ({ x: -mx, z, y, ...extra });

// the helix: centre (80, −80), radius 40, clockwise from the east point, 450°, dropping 8 m per turn
const HELIX = (() => {
  const cx = 80, cz = -80, R = 40, out = [];
  for (let a = -45; a >= -450; a -= 45) {
    const r = a * Math.PI / 180, y = -4 - 8 * (-a / 360);
    out.push(M(cx + R * Math.cos(r), cz + R * Math.sin(r), +y.toFixed(2), { bank: -9 }));
  }
  return out;
})();

export default {
  id: 'star',
  name: 'Star Road',
  theme: 'star',
  music: 'star',
  laps: 3,
  secret: true,                 // unlocked by winning the Orion Cup (UI/save own the unlock)
  width: 16,
  offroad: 'space',
  defaults: { offL: 1.5, offR: 1.5, wallL: 'none', wallR: 'none', kerb: false, rail: 'glow' },
  env: {
    skyTop: 0x120a2e, skyHorizon: 0x4a2a7a, fog: 0x2a1a4a, fogNear: 320, fogFar: 1600,
    sunDir: [-0.3, 0.8, 0.45], sunColor: 0xfff0ff, sun: 1.6, hemiSky: 0xb8a8ff, hemiGround: 0x5a3a8a, hemi: 1.25,
    clouds: false,
  },
  tex: { road: 'road_star', space: 'cloud' },
  terrain: false,               // nothing below you but stars
  points: [
    M(0, -120, 0, { bridge: true }),                                       // 0  START (the Stardust Bridge passes under the grid)
    M(0, -70, 0, { bridge: false }),                                       // 1
    M(0, -30, 1.5, { w: 16 }),                                             // 2  space waves
    M(0, 5, 6.5),                                                          // 3  crest one
    M(0, 30, 2.5),                                                         // 4  dip
    M(0, 56, 8.5),                                                         // 5  crest two: hop!
    M(2, 82, 5.5, { w: 17 }),                                              // 6  land, into the COMET HAIRPIN (right)
    M(21.1, 138.9, 9, { bank: -8 }),                                       // 7
    M(60, 155, 12, { bank: -9 }),                                          // 8
    M(98.9, 138.9, 14, { bank: -8 }),                                      // 9
    M(115, 100, 15, { bank: -2, w: 14, rail: 'none', wall: 'fall', off: 1.3 }), // 10 RAINBOW DROP: no walls
    M(118, 60, 12.5, { bank: 0 }),                                         // 11
    M(120, 20, 8.5),                                                       // 12 star-gate jump
    M(120, -8, 4.2, { bridge: true }),                                     // 13
    M(120, -44, -1.5, { bridge: true }),                                   // 14
    M(120, -80, -4, { w: 15, rail: 'glow', wall: 'none', off: 1.5, bank: -9 }), // 15 THE HELIX (right, down)
    ...HELIX,                                                              // 16..25
    M(40, -124, -14, { bank: 0, w: 14, rail: 'none', wall: 'fall', off: 1.5 }), // 26 STARDUST BRIDGE (no walls)
    M(0, -128, -14),                                                       // 27 under the start straight
    M(-40, -128, -13, { w: 16, rail: 'glow', wall: 'none', bridge: false, bank: 6 }), // 28 MOON LOOP (left, 270°)
    M(-66.2, -138.8, -12, { bank: 8 }),                                    // 29
    M(-77, -165, -10.5, { bank: 9 }),                                      // 30
    M(-66.2, -191.2, -8.5, { bank: 9 }),                                   // 31
    M(-40, -202, -6.5, { bank: 9 }),                                       // 32
    M(-13.8, -191.2, -4.5, { bank: 7 }),                                   // 33
    M(-3, -165, -2.5, { bank: 2, bridge: true }),                          // 34 climb back up
    M(0, -142, -0.6, { bank: 0 }),                                         // 35
  ],
  start: 0,
  gaps: [{ from: 12.25, to: 12.62 }],
  jumps: [{ at: 12.22, vy: 7 }, { at: 5.0, vy: 7 }],
  pads: [
    { at: 11.3, lat: 0 },                   // feeds the star-gate jump
    { at: 26.4, lat: 0 },
    { at: 34.3, lat: 0 },
  ],
  items: [{ at: 1.7 }, { at: 9.5 }, { at: 20.0 }, { at: 27.5 }],
  stars: [
    { at: 2.6, lat: 0, n: 6 },
    { at: 7.5, lat: -3, n: 6, curve: -1.5 },
    { at: 26.2, lat: 2, n: 6, curve: -2 },
    { at: 30.5, lat: 3, n: 6, curve: 1.5 },
  ],
  checkpointCount: 8,
  // O-T-R letters (DESIGN.md "Track data format" → letters): C on the first space-wave crest, T on the Warp Ribbon
  // after its turbo pad, R on the outside of the Moon Loop.
  letters: [{ at: 3.0, lat: 4 }, { at: 7.0, lat: 0, route: 'warp' }, { at: 31.0, lat: -2.5 }],
  // Hidden shortcut (DESIGN.md "Branches (shortcuts)"): the WARP RIBBON. Landing off the second space-wave,
  // the inside (right) rail of the Comet Hairpin has a gap under a big spinning rainbow star gate, with a star
  // trail into it: a narrow glowing ribbon (scenery/star.js `warpRibbon`) that cuts straight across the inside
  // of the hairpin through a tunnel of warp rings, over a turbo pad, and rejoins at the top of the Rainbow
  // Drop. Glowing rails both sides (walls `none`), no gaps. Points are WORLD x/z (not M()): a Hermite chord
  // from the hairpin's run-in to its exit, resampled every ~9 m; the points over the main road sit in its
  // banked surface plane along the branch's own heading (Δy ≤ 0.24 m). Tightest r=32 m.
  // offL 3 (the side facing the main road) at both ends stretches the junction zones, so a kart riding main's inside
  // shoulder past a mouth slides back onto the main road instead of being carried down the ribbon.
  branches: [{
    id: 'warp', name: 'Warp Ribbon',
    from: 6.3, to: 9.95, side: 'R',
    width: 10,
    defaults: { offL: 1.5, offR: 1.5, wallL: 'none', wallR: 'none', rail: 'glow' },
    points: [
      { x: -8.28, z: 98.08, y: 5.895, bank: -2.16, offL: 3 }, // 0  leaves the hairpin's run-in on the right lane (offL 3 at both ends: see below)
      { x: -15.14, z: 109.49, y: 6.473, bank: -4.27 },    // 1  through the gap in the inside rail, under the star gate
      { x: -21.62, z: 115.95, y: 7.14, bank: -3.37 },     // 2
      { x: -29.43, z: 120.74, y: 8.083, bank: -3.59, offL: 1.5 }, // 3  the warp rings
      { x: -37.94, z: 124.04, y: 8.973, bank: -5.45 },    // 4
      { x: -46.89, z: 126.1, y: 9.731, bank: -6 },        // 5  turbo pad
      { x: -55.98, z: 127.02, y: 10.489, bank: -6 },      // 6
      { x: -65.14, z: 126.91, y: 11.246, bank: -6 },      // 7
      { x: -74.27, z: 125.74, y: 12.004, bank: -6 },      // 8
      { x: -83.13, z: 123.48, y: 12.762, bank: -5.45 },   // 9
      { x: -91.56, z: 120, y: 13.793, bank: -1.94 },      // 10
      { x: -99.28, z: 115.09, y: 14.779, bank: 0.92, offL: 3 }, // 11
      { x: -105.68, z: 108.57, y: 14.906, bank: -1.47 },  // 12
      { x: -111.69, z: 100.93, y: 14.99, bank: -2.17 },   // 13 rejoins on the right lane at the top of the Rainbow Drop
    ],
    pads: [{ at: 5.2, lat: 0, len: 7, w: 7 }],
    stars: [{ at: 0.9, lat: 0, n: 5, spacing: 4 }],         // the trail into the gap
    ai: { easy: 0, medium: 0.25, hard: 0.5 },
    hidden: true,
  }],
};
