// Bubbly Beach — track 1. Easy, wide, sunny. Data only: see DESIGN.md "Track data format".
//
// The loop runs anticlockwise seen from above (mostly LEFT turns) with one right-hand
// kink, two proper slide corners (the Lighthouse Hairpin and Crab Bend), gentle sweepers
// along the shore, and a turbo-pad-fed jump over the lagoon inlet.
export default {
  id: 'beach',
  name: 'Bubbly Beach',
  theme: 'beach',
  music: 'beach',
  laps: 3,
  width: 17,
  offroad: 'sand',
  // everything inherits from here until a point changes it
  defaults: { offL: 9, offR: 9, wallL: 'fence', wallR: 'fence' },
  env: {
    skyTop: 0x2f8fe8, skyHorizon: 0xbfeaff, fog: 0xc4ecff, fogNear: 140, fogFar: 520,
    sunDir: [-0.45, 0.8, 0.35], sunColor: 0xfff2d6, sun: 2.3, hemiSky: 0xd8f0ff, hemiGround: 0xc8a870, hemi: 1.05,
    sky: 'sky_beach', clouds: false,   // painted panorama (assets/tex/sky_beach.jpg, has its own clouds); the gradient above is its fallback
  },
  water: { y: -1.4, color: 0x22c7d8, deep: 0x0d7fb4 },
  terrain: {
    base: 0.2,            // natural ground height near the track
    shore: 70,            // metres from the track edge where the island falls into the sea
    dunes: 1.6,           // amplitude of gentle rolling dunes away from the road
    grass: { above: 1.6, color: 0x7cc35a },
    carve: [              // below-water cuts: the lagoon inside the loop and the inlet the jump crosses
      { type: 'lake', x: 62, z: 20, r: 34 },
      { type: 'channel', pts: [[62, -8], [98, -38], [170, -48], [320, -60]], w: 22 },
    ],
  },
  // x, z in metres; y = height; w = road width; bank in degrees (+ = leans into a LEFT turn).
  // Driving order. Point 0 is the start/finish line.
  points: [
    { x: 0, z: -70, y: 0 },                                   // 0  start line, heading north along the beach front
    { x: 0, z: -10, y: 0 },                                   // 1
    { x: 4, z: 50, y: 0.6 },                                  // 2  gentle left sweeper begins
    { x: 24, z: 116, y: 1.8, bank: 4 },                       // 3  over a low dune
    { x: 70, z: 160, y: 1.2, bank: 5 },                       // 4
    { x: 128, z: 170, y: 0.4 },                               // 5  shore straight, sea on the left
    { x: 178, z: 150, y: 0.3, bank: 3 },                      // 6
    { x: 208, z: 112, y: 0.3, w: 18, bank: 9, kerb: true },    // 7  LIGHTHOUSE HAIRPIN (slide!)
    { x: 200, z: 72, y: 0.3, bank: 9 },                       // 8
    { x: 164, z: 52, y: 0.3, bank: 3, kerb: 'auto' },         // 9  hairpin exit, heading west
    { x: 124, z: 34, y: 0.3 },                                // 10 bend south toward the lagoon
    { x: 102, z: 4, y: 0.4, offL: 5, offR: 5 },               // 11 turbo pad run-up to the jump
    { x: 98, z: -26, y: 1.9, w: 16, offL: 3, offR: 3 },       // 12 the ramp lip
    { x: 97, z: -54, y: 0.4, w: 16 },                         // 13 landing on the far bank
    { x: 104, z: -90, y: 0.2, offL: 9, offR: 9 },             // 14
    { x: 134, z: -118, y: 0.2, bank: -4 },                    // 15 right-hand kink toward the rocks
    { x: 146, z: -156, y: 0.2, bank: 4 },                     // 16 Crab Bend begins (long left)
    { x: 112, z: -186, y: 0.2, w: 18, bank: 8, kerb: true },  // 17 CRAB BEND apex
    { x: 64, z: -192, y: 0.2, bank: 6 },                      // 18
    { x: 24, z: -164, y: 0.2, bank: 3, kerb: 'auto' },        // 19 exit toward home
    { x: 4, z: -120, y: 0 },                                  // 20 back onto the start straight
  ],
  // `at` = control point index + fraction along to the next point.
  start: 0,
  gaps: [{ from: 12.06, to: 12.4 }],        // the lagoon inlet under the jump
  jumps: [{ at: 12.04, vy: 9 }],           // lip: launches a grounded kart at >= vy m/s
  pads: [
    { at: 11.45, lat: 0 },                   // feeds the jump
    { at: 5.4, lat: -3 },                    // shore straight
    { at: 19.6, lat: 2 },                    // out of Crab Bend onto the start straight
  ],
  items: [{ at: 1.3 }, { at: 9.7 }, { at: 14.5 }],
  stars: [
    { at: 2.2, lat: 3, n: 6, curve: 0 },
    { at: 7.1, lat: 4.5, n: 6, curve: 1.5 },  // on the inside line of the hairpin
    { at: 13.35, lat: 0, n: 5 },              // just after the landing
    { at: 17.2, lat: 4.5, n: 6, curve: 1.5 },
  ],
  checkpointCount: 8,
};
