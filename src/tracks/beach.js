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
  // SANDCASTLE CAVE — the hidden shortcut across the inside of the Lighthouse Hairpin (DESIGN.md
  // "Branches (shortcuts)"). A gap in the inside fence on the shore straight's last bend leads to a
  // giant sandcastle; you burst through its crumbly sand door (scenery only) into a short, straight,
  // shell-lit cave and pop out onto the hairpin's exit. Wide, walled, no gaps: nothing to fall into.
  // Junction points sit on the main road's banked surface (fit() in tools/fixtures/branches.js).
  branches: [{
    id: 'cave', name: 'Sandcastle Cave',
    from: 5.25, to: 9.85, side: 'L',
    width: 12,
    defaults: { offL: 3, offR: 3, wallL: 'beach', wallR: 'beach' },
    points: [
      { x: 140.37, z: 164.15, y: 0.325, bank: 0.12 },          // 0  leaves the shore straight's last bend on the left lane
      { x: 149.86, z: 156.55, y: 0.24, bank: 0.69 },           // 1  through the gap in the inside fence
      { x: 155.28, z: 150.9, y: 0.3 },                          // 2  a r=30 m left across the sand…
      { x: 159.06, z: 144.04, y: 0.3 },                         // 3
      { x: 160.93, z: 136.43, y: 0.3 },                         // 4  …onto the turbo pad
      { x: 161.11, z: 130, y: 0.3, tunnel: true, offL: 1, offR: 1, wallL: 'none', wallR: 'none' },   // 5  the crumbly door: into the cave
      { x: 161.11, z: 120, y: 0.3 },                            // 6  inside: torches and glowing shells
      { x: 161.11, z: 110, y: 0.3 },                            // 7
      { x: 159.89, z: 98.11, y: 0.3, tunnel: false, offL: 3, offR: 3, wallL: 'beach', wallR: 'beach' },  // 8  out of the cave (r=80 m left)
      { x: 156.28, z: 84.64, y: 0.3 },                          // 9
      { x: 146.2, z: 67.2, y: 0.3 },                            // 10 straight down to the hairpin's exit
      { x: 134.75, z: 48.56, y: 0.226, bank: 0.76 },           // 11
      { x: 127.79, z: 40.77, y: 0.289, bank: 0.28 },           // 12 rejoins on the left lane
    ],
    pads: [{ at: 3.45, lat: 0, len: 8, w: 7 },                // burst through the door on a turbo
           { at: 7.2, lat: 0, len: 8, w: 7 }],                // and another shoots you out of the cave
    stars: [{ at: 2.0, lat: 0, n: 5, spacing: 3.5 }],         // a star trail leads from the fence gap to the door
    ai: { easy: 0, medium: 0.25, hard: 0.5 },
    hidden: true,
  }],
};
