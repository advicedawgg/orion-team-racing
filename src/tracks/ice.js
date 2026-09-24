// Ice Cream Peaks — track 2. Data only: see DESIGN.md "Track data format".
//
// A clockwise lap (mostly RIGHT turns — Bubbly Beach is mostly left) around Strawberry Peak:
// the Vanilla Sweeper off the start, a long climb up the mountain's flank, the Sprinkle
// Hairpin at the summit, a pad-fed jump off the Cherry Scoop into the downhill swoop, S-bends
// down the valley beside the chocolate river, and Cherry Bend — a big 180° slide corner that
// crosses the river on the Wafer Bridge — back onto the start straight.
export default {
  id: 'ice',
  name: 'Ice Cream Peaks',
  theme: 'ice',
  music: 'ice',
  laps: 3,
  width: 16,
  offroad: 'snow',
  defaults: { offL: 7, offR: 7, wallL: 'candy', wallR: 'candy' },
  env: {
    skyTop: 0xc58fd8, skyHorizon: 0xffc9d6, fog: 0xf2c4d0, fogNear: 150, fogFar: 560,
    sunDir: [0.4, 0.75, 0.45], sunColor: 0xfff0e6, sun: 2.2, hemiSky: 0xffe6f0, hemiGround: 0xd6c2e8, hemi: 1.15,
    sky: 'sky_ice', clouds: false,
  },
  tex: { road: 'road_ice', ground: 'snow', snow: 'snow', water: 'water' },
  water: { y: -1.6, color: 0x7a4a2c, tint: 0x9a6038 },        // the chocolate river (scenery re-skins it)
  terrain: {
    base: 0.6, dunes: 1.3, cell: 4.5,
    colors: { ground: 0xffffff, wet: 0xc99a74, deep: 0x6b3d22 },
    hills: [
      { x: -220, z: 80, r: 170, h: 26, color: 0xffb3cc },     // Strawberry Peak (the track climbs it)
      { x: -130, z: 40, r: 90, h: 10, color: 0xff9cc2 },      // its western shoulder (the downhill swoop)
      { x: 120, z: 90, r: 95, h: 30, color: 0x9eeccb },       // Mint Mountain, west of the start
      { x: -60, z: -345, r: 120, h: 34, color: 0xfff0b0 },    // Vanilla Hill, south
      { x: -360, z: -80, r: 110, h: 38, color: 0xc9a3ff },    // Blueberry Bump, far east
    ],
    carve: [
      { type: 'lake', x: -45, z: 30, r: 22, depth: 3 },         // chocolate pond (the river's source)
      { type: 'channel', pts: [[-45, 30], [-44, -40], [-40, -120], [-42, -190], [-30, -260], [0, -330]], w: 16, depth: 3 },
    ],
  },
  points: [
    { x: 0, z: -70, y: 0, w: 17 },                                    // 0  start line, heading north
    { x: 0, z: -8, y: 0 },                                            // 1
    { x: -4, z: 50, y: 0.6 },                                         // 2  VANILLA SWEEPER (right)
    { x: -26, z: 100, y: 1.8, bank: -5 },                             // 3
    { x: -70, z: 130, y: 3.5, bank: -5 },                             // 4
    { x: -130, z: 140, y: 6.5, w: 15, wallR: 'waffle' },              // 5  the climb, Strawberry Peak on the right
    { x: -192, z: 136, y: 10.5 },                                     // 6
    { x: -250, z: 122, y: 14.5 },                                     // 7
    { x: -288, z: 94, y: 17.5, w: 17, bank: -8, kerb: true },         // 8  SPRINKLE HAIRPIN (right, 180°)
    { x: -300, z: 62, y: 18.8, w: 18, bank: -9 },                     // 9
    { x: -284, z: 34, y: 19.5, bank: -8 },                            // 10
    { x: -250, z: 30, y: 20, w: 15, bank: 0, kerb: 'auto', wallL: 'waffle', wallR: 'candy' },   // 11 summit ridge, heading west
    { x: -205, z: 34, y: 20.4, off: 5 },                              // 12
    { x: -168, z: 36, y: 21, w: 14 },                                 // 13 the CHERRY SCOOP lip
    { x: -140, z: 32, y: 15.5 },                                      // 14 landing on the downhill swoop
    { x: -106, z: 16, y: 10.5, w: 15, off: 7 },                       // 15
    { x: -88, z: -18, y: 7.5, bank: 4 },                              // 16 S-bends down the valley (left…
    { x: -96, z: -58, y: 5, bank: -4 },                               // 17 …right…
    { x: -84, z: -98, y: 3, bank: 4 },                                // 18 …left)
    { x: -90, z: -140, y: 1.5, w: 16 },                               // 19
    { x: -82, z: -180, y: 1.2, w: 17, bank: -8, kerb: true },        // 20 CHERRY BEND (right, 180°)…
    { x: -62, z: -202, y: 3.4, w: 16, bank: -5, raised: true, off: 1.5, wallL: 'wafer', wallR: 'wafer' },   // 21 …over the humped WAFER BRIDGE (chocolate river underneath)…
    { x: -24, z: -198, y: 3.4, bank: -5, raised: false, off: 7, wallL: 'candy', wallR: 'candy' },           // 22
    { x: -6, z: -170, y: 1.0, bank: -4 },                             // 23 …and out onto the start straight
    { x: -2, z: -128, y: 0, bank: 0, kerb: 'auto' },                  // 24
  ],
  start: 0,
  jumps: [{ at: 13.02, vy: 10 }],
  pads: [
    { at: 12.2, lat: 0 },                     // feeds the Cherry Scoop jump
    { at: 5.5, lat: 2 },                      // help up the climb
    { at: 23.4, lat: 0 },                     // out of Cherry Bend
  ],
  items: [{ at: 1.3 }, { at: 11.3 }, { at: 17.5 }],
  stars: [
    { at: 3.2, lat: -4, n: 6, curve: -1.5 },
    { at: 9.0, lat: -5, n: 6, curve: -1.5 },   // inside line of the hairpin
    { at: 14.6, lat: 0, n: 5 },
    { at: 20.4, lat: -5, n: 6, curve: -1.5 },
  ],
  checkpointCount: 8,
};
