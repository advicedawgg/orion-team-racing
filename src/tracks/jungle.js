// Jungle Jumble — track 6. Data only: see DESIGN.md "Track data format".
//
// A sunny, friendly jungle, clockwise (mostly RIGHT turns). Up the start straight past the WATERFALL
// ROCK, round the Waterfall Hairpin (slide!), the Parrot Sweeper (left), through the Sootie Temple's
// tunnel (a giant smiling cat face carved over the door), over the Rope Bridge across Hippo River,
// round the Coconut Hairpin (slide!), a pad-fed HIPPO HOP over the river, the Banana S-bends, and
// back. Offroad grass (mud on the hop's run-up). Hidden shortcut: BEHIND THE WATERFALL (`branches`, at the bottom).
export default {
  id: 'jungle',
  name: 'Jungle Jumble',
  theme: 'jungle',
  music: 'jungle',
  laps: 3,
  width: 15,
  offroad: 'grass',
  defaults: { offL: 4, offR: 4, wallL: 'bamboo', wallR: 'bamboo' },
  env: {
    skyTop: 0x2f8fe8, skyHorizon: 0xc8f0e0, fog: 0xc8ecdc, fogNear: 150, fogFar: 560,
    sunDir: [0.4, 0.8, 0.3], sunColor: 0xfff0d0, sun: 2.3, hemiSky: 0xd8f4ff, hemiGround: 0x7aa860, hemi: 1.05,
    sky: 'sky_jungle', clouds: false,
  },
  tex: { road: 'road_jungle', ground: 'jungle', grass: 'jungle', mud: 'mud', water: 'water' },
  water: { y: -1.0, color: 0x5cb8a0, tint: 0x9ad8b8 },   // muddy river (Hippo River) + the waterfall's pool + creek
  terrain: {
    base: 0.4, dunes: 0.9, cell: 4.5,
    colors: { ground: 0xf2ffe6, wet: 0x9a7a4a, deep: 0x4a7a5a },
    hills: [
      { x: -300, z: 180, r: 160, h: 55, color: 0x6fb04e },   // jungle mountains all round
      { x: 250, z: 190, r: 150, h: 45, color: 0x6fb04e },
      { x: 330, z: -250, r: 170, h: 60, color: 0x6fb04e },
      { x: -380, z: -280, r: 150, h: 50, color: 0x6fb04e },
      { x: 60, z: 280, r: 130, h: 38, color: 0x6fb04e },
      { x: -100, z: -300, r: 120, h: 30, color: 0x6fb04e },
    ],
    carve: [
      { type: 'channel', pts: [[-138, 220], [-136, 60], [-135, -52], [-133, -92], [-130, -128], [-124, -200], [-115, -330]], w: 16, depth: 3 },   // HIPPO RIVER (bridge + jump)
      { type: 'lake', x: 84, z: 80, r: 10, depth: 3 },                                                                                         // the waterfall's pool
      { type: 'channel', pts: [[80, 77], [68, 62], [64, 35], [62, -10], [60, -50], [35, -82], [-20, -85], [-80, -86], [-133, -92]], w: 8, depth: 2.2 },  // the creek it feeds
    ],
  },
  points: [
    { x: 110, z: -50, y: 0.3, w: 16 },                                       // 0  start line, heading north
    { x: 110, z: -10, y: 0.6 },                                              // 1
    { x: 110, z: 30, y: 1.3 },                                               // 2  a gentle rise, the Waterfall Rock ahead on the right
    { x: 110, z: 64, y: 1.1 },                                               // 3
    { x: 110, z: 94, y: 1.1, w: 17, bank: -6, kerb: true, wallR: 'mossy', offR: 2 },   // 4  WATERFALL HAIRPIN (right, 180°, r≈33–41)
    { x: 103.57, z: 118, y: 1.4, bank: -9 },                                 // 5
    { x: 86, z: 135.57, y: 1.6, bank: -10 },                                 // 6
    { x: 62, z: 142, y: 1.7, bank: -10 },                                    // 7
    { x: 38, z: 135.57, y: 1.6, bank: -10 },                                 // 8
    { x: 20.43, z: 118, y: 1.4, bank: -8 },                                  // 9
    { x: 14, z: 94, y: 1.2, w: 16, bank: -4, kerb: 'auto', wallR: 'bamboo', offR: 4 },   // 10
    { x: 14, z: 60, y: 1.0, w: 15, bank: 0 },                                // 11 back south
    { x: 14, z: 24, y: 0.9 },                                                // 12
    { x: 14, z: -12, y: 0.8 },                                               // 13 PARROT SWEEPER (left, r≈29)
    { x: 8.64, z: -32, y: 0.7, bank: 4 },                                    // 14
    { x: -6, z: -46.64, y: 0.6, bank: 5 },                                   // 15
    { x: -26, z: -52, y: 0.5, bank: 2 },                                     // 16 heading east
    { x: -52, z: -52, y: 0.5, w: 14, bank: 0, off: 1.5, wall: 'none', tunnel: true, kerb: false },   // 17 into the SOOTIE TEMPLE
    { x: -77, z: -52, y: 0.5 },                                              // 18
    { x: -102, z: -52, y: 0.5, w: 15, off: 4, wall: 'bamboo', tunnel: false, kerb: 'auto' },        // 19 out of the temple
    { x: -120, z: -52, y: 2.2, w: 13, off: 1, wall: 'none', raised: true },  // 20 ROPE BRIDGE over Hippo River
    { x: -136, z: -52, y: 1.9 },                                             // 21
    { x: -152, z: -52, y: 2.2, w: 15, off: 4, wall: 'bamboo', raised: false },   // 22
    { x: -185, z: -52, y: 1.7 },                                             // 23
    { x: -222, z: -52, y: 2.0, w: 17, bank: -6, kerb: true },                // 24 COCONUT HAIRPIN (right, 180°, r≈28–33)
    { x: -241, z: -57.1, y: 2.2, bank: -9 },                                 // 25
    { x: -254.9, z: -71, y: 2.4, bank: -10 },                                // 26
    { x: -260, z: -90, y: 2.5, bank: -10 },                                  // 27
    { x: -254.9, z: -109, y: 2.4, bank: -10 },                               // 28
    { x: -241, z: -122.9, y: 2.2, bank: -8 },                                // 29
    { x: -222, z: -128, y: 2.0, w: 16, bank: -3, kerb: 'auto' },             // 30 heading west
    { x: -196, z: -128, y: 1.6, w: 15, bank: 0 },                            // 31
    { x: -165, z: -128, y: 1.8, off: 3, surf: 'mud' },                       // 32 pad run-up
    { x: -141, z: -128, y: 3.0, w: 16 },                                     // 33 HIPPO HOP lip
    { x: -113, z: -128, y: 0.9, w: 15, off: 4, surf: 'grass' },              // 34 landing
    { x: -80, z: -127, y: 0.7 },                                             // 35 BANANA S-BENDS (r≈25–30)
    { x: -59, z: -131, y: 0.6, bank: -2 },                                 // 36
    { x: -38, z: -127, y: 0.6, bank: 0 },                                    // 37
    { x: -17, z: -123, y: 0.5, bank: 2 },                                  // 38
    { x: 4, z: -127, y: 0.5, bank: 0 },                                      // 39
    { x: 25, z: -131, y: 0.4, bank: -2 },                                  // 40
    { x: 46, z: -127, y: 0.4, bank: 0 },                                     // 41
    { x: 70, z: -127, y: 0.3, w: 16, bank: -4 },                             // 42 MANGO CORNER (right, r≈30)
    { x: 90, z: -121.64, y: 0.3, bank: -6 },                                 // 43
    { x: 104.64, z: -107, y: 0.3, bank: -5 },                                // 44
    { x: 110, z: -87, y: 0.3, bank: -2 },                                    // 45
  ],
  start: 0,
  gaps: [{ from: 33.2, to: 33.56 }],
  jumps: [{ at: 33.16, vy: 9 }],
  pads: [
    { at: 32.1, lat: 0 },                     // feeds the Hippo Hop
    { at: 17.9, lat: 0 },                     // through the temple
  ],
  items: [{ at: 0.6 }, { at: 12.5 }, { at: 23.3 }, { at: 35.4 }],
  stars: [
    { at: 1.6, lat: 3, n: 6 },
    { at: 7.4, lat: -5, n: 6, curve: 1.5 },   // inside line of the Waterfall Hairpin
    { at: 18.4, lat: 0, n: 6 },               // through the temple
    { at: 26.6, lat: -5, n: 6, curve: 1.5 },  // inside line of the Coconut Hairpin
    { at: 38.2, lat: 0, n: 6 },
  ],
  checkpointCount: 8,
  // O-T-R letters (DESIGN.md "Track data format" → letters): C in the wet cave behind the waterfall (the outside of its
  // U-turn), T in the Sootie Temple's right lane, R on the inside of the Coconut Hairpin.
  letters: [{ at: 12, lat: 2, route: 'falls' }, { at: 17.7, lat: -3.5 }, { at: 27.0, lat: -5.5 }],
  // Hidden shortcut (DESIGN.md "Branches (shortcuts)"): BEHIND THE WATERFALL. On the start straight, just before the
  // Waterfall Hairpin, a gap in the right-hand fence and a star trail lead onto a stone causeway across the falls' pool,
  // straight through the falling water into a wet, glow-lit cave that U-turns inside the Waterfall Rock (scenery/jungle.js
  // `waterfallCave`) and lets you out onto the return straight. No gaps, no pads. Junction points sit on the main road's
  // banked surface (fit() as in tools/fixtures/branches.js); the S-curves are smoothstep shifts of x.
  branches: [{
    id: 'falls', name: 'Behind the Waterfall',
    from: 2.14, to: 11.61, side: 'R',
    width: 11,
    defaults: { offL: 2, offR: 2, wallL: 'bamboo', wallR: 'bamboo' },
    points: [
      { x: 106.5, z: 35, y: 1.317, bank: 0.05 },   // 0  leaves the start straight on the right lane
      { x: 105.58, z: 41.63, y: 1.31, bank: 0.22 },   // 1  an S out through the gap in the right-hand fence (tightest r≈17)
      { x: 103.14, z: 48.25, y: 1.289, bank: 0.39 },   // 2
      { x: 99.7, z: 54.88, y: 1.233, bank: 0.43 },   // 3
      { x: 95.75, z: 61.5, y: 1.15 },   // 4
      { x: 91.8, z: 68.13, y: 1.15 },   // 5
      { x: 88.36, z: 74.75, y: 1.15, raised: true, wallL: 'none', wallR: 'none', offL: 1, offR: 1 },   // 6  the stone causeway across the waterfall's pool
      { x: 85.92, z: 81.38, y: 1.15 },   // 7
      { x: 85, z: 88, y: 1.15, tunnel: true, raised: false },   // 8  through the falling water into the WET CAVE behind it
      { x: 85, z: 94, y: 1.15 },   // 9
      { x: 81.92, z: 105.5, y: 1.15 },   // 10 U-turn (r 23) inside the rock
      { x: 73.5, z: 113.92, y: 1.15 },   // 11
      { x: 62, z: 117, y: 1.15 },   // 12
      { x: 50.5, z: 113.92, y: 1.15 },   // 13
      { x: 42.08, z: 105.5, y: 1.15 },   // 14
      { x: 39, z: 94, y: 1.15 },   // 15
      { x: 39, z: 88, y: 1.15, tunnel: false, offL: 2, offR: 2, wallL: 'bamboo', wallR: 'bamboo' },   // 16 out of the rock
      { x: 38.08, z: 81.75, y: 1.15 },   // 17
      { x: 35.64, z: 75.5, y: 1.15 },   // 18
      { x: 32.2, z: 69.25, y: 1.15 },   // 19
      { x: 28.25, z: 63, y: 1.15 },   // 20
      { x: 24.3, z: 56.75, y: 1.012, bank: 0.15 },   // 21
      { x: 20.86, z: 50.5, y: 1.01, bank: 0.29 },   // 22
      { x: 18.42, z: 44.25, y: 0.979, bank: 0.28 },   // 23
      { x: 17.5, z: 38, y: 0.951, bank: 0.18 },   // 24 rejoins the return straight on the right lane
    ],
    pads: [],
    stars: [{ at: 1.5, lat: 0, n: 5, spacing: 4 }],          // the star trail into the gap
    ai: { easy: 0, medium: 0.25, hard: 0.5 },
    hidden: true,
  }],
};
