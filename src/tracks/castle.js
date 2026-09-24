// King Dad's Castle — track 4, the Orion Cup finale. Data only: see DESIGN.md "Track data format".
//
// Twilight at the castle. From the forecourt you race north over the DRAWBRIDGE, through the
// gatehouse and down the GREAT HALL (roofed: banquet tables, torches, portraits of King Dad and
// his giant armchair throne at the end), out of the side door and UP THE SPIRAL RAMP round the
// Remote Tower (300° of climbing right-hander — a 3-turbo slide — which comes out OVER its own
// entrance), along the BATTLEMENTS of the north and east walls, down the sally ramp and JUMP the
// moat, then wriggle through the GARDEN MAZE back to the forecourt.
//
// Authored in "map" coordinates (mx = east, z = north) and converted: world x = −mx (+x is LEFT
// of a kart driving +z). `look` is a scenery-only inherited tag (src/scenery/castle.js draws the
// boundary to match: courtyard wall, drawbridge rails, hall tables, tower, parapet, hedge).
const M = (mx, z, y, extra = {}) => ({ x: -mx, z, y, ...extra });

// the spiral: centre (mx 78, z 100), radius 27, clockwise from the top point, 300°, climbing 0.8 → 12
const SPIRAL = (() => {
  const cx = 78, cz = 97, R = 27, out = [];
  const angs = [45, 0, -45, -90, -135, -180, -210];
  angs.forEach((a, i) => {
    const r = a * Math.PI / 180, y = 0.8 + 11.2 * (90 - a) / 300;
    out.push(M(cx + R * Math.cos(r), cz + R * Math.sin(r), +y.toFixed(2), { bank: -6, ...(i === 0 ? { raised: true } : {}) }));
  });
  return out;
})();

export default {
  id: 'castle',
  name: "King Dad's Castle",
  theme: 'castle',
  music: 'castle',
  laps: 3,
  width: 15,
  offroad: 'grass',
  defaults: { offL: 4, offR: 4, wallL: 'none', wallR: 'none', look: 'court' },
  env: {
    skyTop: 0x27327a, skyHorizon: 0xf2a79a, fog: 0x8a78a8, fogNear: 170, fogFar: 640,
    sunDir: [0.35, 0.75, -0.55], sunColor: 0xffe2c4, sun: 1.9, hemiSky: 0xc4c8ff, hemiGround: 0x8a7a70, hemi: 1.35,
    clouds: false,
  },
  tex: { road: 'road_castle', ground: 'grass', grass: 'grass', dirt: 'castle_floor', rock: 'castle_floor' },
  water: { y: -1.4, color: 0x3a7fb8, tint: 0xb8d8ff },
  terrain: {
    base: 0.2, dunes: 0.5, cell: 4.5,
    grass: { above: -5, color: 0xd8f0b8 },
    // the moat: a ring round the curtain walls
    carve: [{ type: 'channel', pts: [[48, -17], [-195, -17], [-195, 186], [48, 186], [48, -17]], w: 13, depth: 3 }],
  },
  points: [
    M(0, -100, 0.3),                                                       // 0  START in the forecourt, heading north
    M(0, -70, 0.3),                                                        // 1
    M(0, -44, 0.5, { w: 14, off: 2 }),                                     // 2  up to the drawbridge
    M(0, -20, 1.3, { w: 13, off: 0.6, look: 'drawbridge', kerb: false }),  // 3  DRAWBRIDGE over the moat (hop at the far end)
    M(0, 4, 0.3, { w: 14, off: 0.6, look: 'gate', tunnel: true }),         // 4  gatehouse arch
    M(0, 40, 0.3, { w: 15, off: 3, surf: 'dirt', look: 'hall' }),          // 5  GREAT HALL (roofed)
    M(0, 78, 0.3),                                                         // 6
    M(0, 100, 0.3, { bank: -3 }),                                          // 7  right turn under the throne
    M(5.9, 114.1, 0.3, { bank: -5 }),                                      // 8
    M(20, 120, 0.3, { bank: -3 }),                                         // 9  out of the side door
    M(40, 122, 0.3, { tunnel: false, look: 'ward', surf: 'grass', off: 2, bridge: true }), // 10
    M(58, 124, 0.5),                                                       // 11 under the tower bridge
    M(78, 124, 0.8, { look: 'tower', off: 1.2 }),                          // 12 SPIRAL RAMP starts (right-hander)
    ...SPIRAL,                                                             // 13..19 climbing round the Remote Tower
    M(66.6, 131.3, 12, { look: 'battlement', off: 1 }),                    // 20 out over the entrance
    M(80, 152, 12, { bank: -4, bridge: false }),                           // 21
    M(105, 162, 12),                                                       // 22 north battlements
    M(147, 163, 12),                                                       // 23
    M(164.7, 155.7, 12, { bank: -5 }),                                     // 24 NE corner tower
    M(172, 138, 12),                                                       // 25 east battlements
    M(172, 100, 12),                                                       // 26
    M(172, 60, 12),                                                        // 27
    M(172, 30, 10.4, { look: 'ramp' }),                                    // 28 sally ramp down
    M(172, 2, 7.4),                                                        // 29
    M(172, -8, 6.6),                                                       // 30 the lip: JUMP THE MOAT
    M(172, -25, 1.3, { raised: false, look: 'hedge', off: 2 }),            // 31 land in the gardens
    M(172, -48, 0.8),                                                      // 32 GARDEN MAZE
    M(166, -63, 0.6, { bank: -5 }),                                        // 33 right
    M(150, -70, 0.4),                                                      // 34
    M(126, -70, 0.3),                                                      // 35
    M(110, -77, 0.3, { bank: 5 }),                                         // 36 left
    M(104, -92, 0.3),                                                      // 37
    M(104, -106, 0.3),                                                     // 38
    M(98, -120, 0.3, { bank: -5 }),                                        // 39 right
    M(82, -126, 0.3),                                                      // 40
    M(62, -126, 0.3),                                                      // 41
    M(46, -133, 0.3, { bank: 5 }),                                         // 42 left
    M(40, -148, 0.3),                                                      // 43
    M(40, -160, 0.3, { bank: -4 }),                                        // 44 KING'S HAIRPIN (right)
    M(34, -174, 0.3, { bank: -7 }),                                        // 45
    M(20, -180, 0.3, { bank: -7 }),                                        // 46
    M(6, -174, 0.3, { bank: -5 }),                                         // 47
    M(0, -158, 0.3, { look: 'court', off: 4 }),                            // 48 into the forecourt
    M(0, -130, 0.3),                                                       // 49
  ],
  start: 0,
  gaps: [{ from: 30.06, to: 30.96 }],
  jumps: [{ at: 30.02, vy: 9 }, { at: 3.5, vy: 7.5 }],
  pads: [
    { at: 1.4, lat: 0 },
    { at: 5.4, lat: 0 },
    { at: 26.3, lat: 0 },
    { at: 29.1, lat: 0 },
  ],
  items: [{ at: 1.0 }, { at: 6.3 }, { at: 22.6 }, { at: 34.5 }],
  stars: [
    { at: 5.0, lat: -4, n: 6 },
    { at: 15.0, lat: -3, n: 6 },
    { at: 23.2, lat: 0, n: 6 },
    { at: 37.2, lat: 0, n: 5 },
    { at: 45.2, lat: -3, n: 5, curve: -1.5 },
  ],
  checkpointCount: 8,
};
