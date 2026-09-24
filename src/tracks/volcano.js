// Taco Volcano — track 3. Data only: see DESIGN.md "Track data format".
//
// An anticlockwise lap around (and THROUGH) a friendly taco volcano: the Salsa Sweeper off the
// start, a pad-fed leap over the first lava river, the Chilli Hairpin, the Taco Tunnel straight
// through the volcano's flank, the Rock Bridge over the lava lake (no rails — you can fall in, the
// cloud pops you straight back), S-bends, the Taco Turn, and a second lava leap onto the start
// straight. The lava is the track's `water` (a splash = rescue); scenery makes it glow.
export default {
  id: 'volcano',
  name: 'Taco Volcano',
  theme: 'volcano',
  music: 'volcano',
  laps: 3,
  width: 16,
  offroad: 'rock',
  defaults: { offL: 6, offR: 6, wallL: 'basalt', wallR: 'basalt' },
  env: {
    skyTop: 0x7a3a5a, skyHorizon: 0xffb070, fog: 0xf0a878, fogNear: 160, fogFar: 600,
    sunDir: [-0.5, 0.7, -0.3], sunColor: 0xffe2c0, sun: 2.3, hemiSky: 0xffd2b0, hemiGround: 0xb06a50, hemi: 1.1,
    sky: 'sky_volcano', clouds: false,
  },
  tex: { road: 'road_volcano', ground: 'sand', rock: 'rock_volcanic', water: 'lava' },
  water: { y: -2.2, color: 0xff7a1a, tint: 0xffffff },            // LAVA (scenery re-skins it: emissive, flowing)
  terrain: {
    base: 1.0, dunes: 1.3, cell: 4.5,
    colors: { ground: 0xffd9b8, wet: 0xb0604a, deep: 0x6a3024 },
    hills: [
      { x: 0, z: 72, r: 134, h: 62, color: 0xa8604c },               // THE VOLCANO (the tunnel goes through its flank)
      { x: 0, z: 72, r: 36, h: -24 },                                // its crater (the taco sits in it)
      { x: -360, z: 168, r: 132, h: 34, color: 0xf0b888 },           // mesas out east
      { x: -300, z: -312, r: 108, h: 26, color: 0xf0b888 },
      { x: 300, z: -108, r: 120, h: 30, color: 0xf0b888 },            // and west
      { x: 204, z: 276, r: 144, h: 40, color: 0xf0b888 },
      { x: -160, z: 112, r: 80, h: 9, color: 0xf0b888 },             // the Chilli Hairpin's mesa
    ],
    carve: [
      { type: 'lake', x: -120, z: -24, r: 14, depth: 3 },            // lava pool fed by the lava fall
      { type: 'channel', pts: [[-120, -24], [-174, -29], [-240, -36], [-324, -22]], w: 13, depth: 3 },   // river 1 (jump 1)
      { type: 'lake', x: 137, z: -48, r: 53, depth: 3 },             // the lava lake under the Rock Bridge
      { type: 'channel', pts: [[106, -58], [96, -120], [91, -175], [86, -282]], w: 13, depth: 3 },        // river 2 (jump 2)
    ],
  },
  points: [
    { x: 0, z: -170, y: 0, w: 17 },                                                  // 0  start line, heading east
    { x: -66, z: -168, y: 0.3 },                                                     // 1
    { x: -120, z: -154, y: 0.8, bank: 5 },                                           // 2  SALSA SWEEPER (left)
    { x: -161, z: -120, y: 1.2, bank: 6 },                                           // 3
    { x: -175, z: -79, y: 1.8, bank: 2, off: 3, wall: 'chili' },                     // 4  pad run-up
    { x: -178, z: -43, y: 3.2, w: 16 },                                              // 5  LAVA LEAP 1 lip
    { x: -176, z: -7, y: 1.6, off: 6, wall: 'basalt' },                              // 6  landing
    { x: -175, z: 38, y: 3.5 },                                                        // 7
    { x: -192, z: 84, y: 7, w: 18, bank: 8, kerb: true },                            // 8  CHILLI HAIRPIN (left, 180°)
    { x: -180, z: 127, y: 9.5, w: 18, bank: 10 },                                    // 9
    { x: -144, z: 142, y: 10, w: 18, bank: 10 },                                    // 10
    { x: -115, z: 115, y: 9, w: 17, bank: 6 },                                         // 11
    { x: -109, z: 67, y: 7, w: 16, bank: 0, kerb: 'auto' },                           // 12 heading south past the volcano
    { x: -101, z: 29, y: 5.2, bank: -5 },                                             // 13 right, into…
    { x: -70, z: 8, y: 4, w: 15, bank: -3, off: 1.5, wall: 'none', tunnel: true, kerb: false },   // 14 …the TACO TUNNEL
    { x: -22, z: 1, y: 4.5, bank: 0 },                                               // 15
    { x: 26, z: 5, y: 4.5 },                                                         // 16
    { x: 72, z: 17, y: 4, bank: 3, tunnel: false, off: 5, wall: 'basalt', kerb: 'auto' },          // 17 out of the tunnel
    { x: 110, z: 12, y: 3.2, w: 16, bank: 7 },                                        // 18 left toward the lava lake
    { x: 132, z: -19, y: 3, w: 17, bank: 2, off: 1, wall: 'fall', raised: true },    // 19 ROCK BRIDGE (no rails!)
    { x: 137, z: -70, y: 3, bank: 0 },                                               // 20
    { x: 129, z: -103, y: 2.6, bank: 3, off: 6, wall: 'basalt', raised: false },     // 21 S-bends
    { x: 142, z: -136, y: 2, bank: -3 },                                              // 22
    { x: 131, z: -168, y: 1.5, w: 17, bank: 8, kerb: true },                         // 23 TACO TURN (left)
    { x: 104, z: -179, y: 2.2, w: 16, bank: 0, kerb: 'auto', off: 3, wall: 'chili' }, // 24 LAVA LEAP 2 lip
    { x: 67, z: -175, y: 0.5, off: 6, wall: 'basalt' },                             // 25 landing, onto the start straight
  ],
  start: 0,
  gaps: [{ from: 5.08, to: 5.42 }, { from: 24.1, to: 24.42 }],
  jumps: [{ at: 5.04, vy: 9 }, { at: 24.05, vy: 9 }],
  pads: [
    { at: 4.3, lat: 0 },                      // feeds lava leap 1
    { at: 23.6, lat: -2 },                    // feeds lava leap 2
    { at: 12.3, lat: 0 },                     // down the volcano's east side toward the tunnel
  ],
  items: [{ at: 1.4 }, { at: 7.2 }, { at: 16.5 }, { at: 21.4 }],
  stars: [
    { at: 2.3, lat: 4, n: 6, curve: 1.5 },
    { at: 9.2, lat: 5, n: 6, curve: 1.5 },    // inside line of the hairpin
    { at: 14.6, lat: 0, n: 6 },               // down the tunnel
    { at: 19.4, lat: 0, n: 6, spacing: 4 },   // across the bridge — stay in the middle!
  ],
  checkpointCount: 8,
};
