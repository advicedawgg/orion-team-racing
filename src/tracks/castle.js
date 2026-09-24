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
  const cx = 78, cz = 100, R = 27, out = [];
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
    carve: [{ type: 'channel', pts: [[48, -20], [-195, -20], [-195, 186], [48, 186], [48, -20]], w: 16, depth: 3 }],
  },
  points: [
    M(0, -115, 0.3),                                                       // 0  START in the forecourt, heading north
    M(0, -75, 0.3),                                                        // 1
    M(0, -44, 0.5, { w: 14, off: 2 }),                                     // 2  up to the drawbridge
    M(0, -20, 1.0, { w: 13, off: 0.6, look: 'drawbridge', kerb: false }),  // 3  DRAWBRIDGE over the moat
    M(0, 4, 0.3, { w: 14, off: 0.6, look: 'gate', tunnel: true }),         // 4  gatehouse arch
    M(0, 40, 0.3, { w: 15, off: 3, surf: 'dirt', look: 'hall' }),          // 5  GREAT HALL (roofed)
    M(0, 80, 0.3),                                                         // 6
    M(3, 104, 0.3, { bank: -3 }),                                         // 7  right turn at the throne
    M(16, 121, 0.3, { bank: -4 }),                                        // 8
    M(35, 127, 0.3, { bank: 0, tunnel: false, look: 'ward', surf: 'grass', off: 2, bridge: true }), // 9  out of the side door
    M(55, 127, 0.4),                                                      // 10 under the tower bridge
    M(78, 127, 0.8, { look: 'tower', off: 1, offL: 1.2, offR: 1.2, bridge: true }), // 11 SPIRAL RAMP starts (right-hander)
    ...SPIRAL,                                                             // 12..18 climbing round the Remote Tower
    M(66.6, 134.3, 12, { bank: 0, look: 'battlement', off: 1, raised: true, bridge: true }), // 19 out over the entrance
    M(80, 155, 12, { bank: -4, bridge: false }),                         // 20
    M(105, 163, 12, { bank: 0 }),                                         // 21 north battlements
    M(145, 163, 12),                                                      // 22
    M(165, 158, 12, { bank: -4 }),                                        // 23 NE corner tower
    M(172, 140, 12, { bank: 0 }),                                         // 24 east battlements
    M(172, 100, 12),                                                      // 25
    M(172, 60, 12),                                                       // 26
    M(172, 30, 10.4, { look: 'ramp' }),                                   // 27 sally ramp down
    M(172, 2, 7.4),                                                       // 28
    M(172, -8, 6.6),                                                      // 29 the lip: jump the moat
    M(172, -36, 1.2, { raised: false, look: 'hedge', off: 2 }),           // 30 land in the gardens
    M(168, -60, 0.6),                                                     // 31 GARDEN MAZE
    M(155, -82, 0.4, { bank: -4 }),                                       // 32
    M(130, -94, 0.3, { bank: 0 }),                                        // 33
    M(110, -110, 0.3, { bank: 4 }),                                       // 34
    M(108, -135, 0.3, { bank: 0 }),                                       // 35
    M(95, -158, 0.3, { bank: -4 }),                                       // 36
    M(68, -170, 0.3, { bank: 0 }),                                        // 37
    M(35, -172, 0.3),                                                     // 38
    M(12, -162, 0.3, { bank: -4 }),                                       // 39 into the forecourt
    M(2, -140, 0.3, { bank: 0, look: 'court', off: 4 }),                  // 40
  ],
  start: 0,
  gaps: [{ from: 29.2, to: 29.8 }],
  jumps: [{ at: 29.15, vy: 8 }],
  pads: [
    { at: 1.4, lat: 0 },
    { at: 28.2, lat: 0 },
  ],
  items: [{ at: 1.0 }, { at: 6.0 }, { at: 25.0 }, { at: 33.5 }],
  stars: [
    { at: 5.2, lat: 0, n: 6 },
    { at: 14.0, lat: -3, n: 6, curve: 0 },
    { at: 22.0, lat: 0, n: 6 },
    { at: 36.5, lat: 2, n: 5, curve: 1.5 },
  ],
  checkpointCount: 8,
};
