// Toy Box Turbo — track 7. Data only: see DESIGN.md "Track data format".
//
// Racing TINY across a giant kid's bedroom at night-light time (warm lamp light, glow-in-the-dark stars on
// the ceiling). The road is an orange toy-car track laid out over the carpet, fenced with wooden blocks.
// Up the start straight along the west wall, round the corner and UP THE BOOK RAMP onto the desk, past giant
// crayons and building bricks, a turbo pad and the DESK JUMP across the gap onto the bed. Over the bumpy
// quilt past the pillow where Sootie is curled up asleep, round onto the SLIDE and whoosh down beside the bed
// to the floor, round the foot of the bed, back up its other side, past the desk, and through the PLAY RUG
// wiggles back to the line. Clockwise (mostly RIGHT turns). Offroad: fluffy carpet on the floor, soft quilt
// on the bed, the desk's wood on the desk. Hidden shortcut: UNDER THE BED (`branches`, at the bottom).
//
// Authored in "map" coordinates (mx = east, z = north) and converted: world x = −mx (+x is LEFT of a kart
// driving +z). The room: mx −180..180, z −150..160; the bed's head is against the north wall (mx 20..120, z −55..160
// with a ROUND foot: r 50 round mx 70, z −5; quilt at y 10.7), the desk west of it (mx −58..9.5, z 85..160, top y 13).
// src/scenery/bedroom.js builds all of it (the walls of the room are scenery; the physical walls here are the toy fences).
const M = (mx, z, y, extra = {}) => ({ x: -mx, z, y, ...extra });
const ss = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const r2 = v => Math.round(v * 100) / 100;

// The main road is laid out like a toy track: straight pieces and curved pieces. `lay` walks a turtle from
// (mx, z) at heading hd (degrees, 0 = north, 90 = east) through segments — { L } straight (or { toX } / { toZ }
// to land exactly on a coordinate), { r, a } an arc (a > 0 = right turn, degrees) — dropping a control point
// every ≤ 14 m on straights and every ≤ 22.5° on arcs (the centripetal spline then follows the arc closely;
// three points per 90° made the r 28 corners r 16). Each segment may set `y` (height at its end, eased by
// `ease`: 'lin' or 'ss' smoothstep), `bank` (degrees on its points; + = into a LEFT turn), `tag` (inherited
// props on its first point) and `mark` (a name for the index of its first point, for the `at`s below).
function lay(mx, z, hd, y, segs, open = false) {
  const pts = [], at = {};
  let H = hd * Math.PI / 180;
  pts.push(M(r2(mx), r2(z), y, segs[0].tag || {}));
  segs.forEach((g, gi) => {
    if (g.mark) at[g.mark] = pts.length - 1;
    const y0 = y, y1 = g.y ?? y, ease = g.ease === 'ss' ? ss : t => t;
    let n, step;
    if (g.r) n = Math.max(1, Math.ceil(Math.abs(g.a) / 22.5));
    else {
      const sx = Math.sin(H), sz = Math.cos(H);
      const L = g.L ?? (g.toX != null ? (g.toX - mx) / sx : (g.toZ - z) / sz);
      n = g.one ? 1 : Math.max(1, Math.ceil(L / 14)); step = L / n;
    }
    for (let i = 1; i <= n; i++) {
      if (g.r) {
        const da = (g.a / n) * Math.PI / 180, side = Math.sign(g.a);          // right turn: centre on the right
        const cx = mx + Math.cos(H) * g.r * side, cz = z - Math.sin(H) * g.r * side;
        H += da; mx = cx - Math.cos(H) * g.r * side; z = cz + Math.sin(H) * g.r * side;
      } else { mx += Math.sin(H) * step; z += Math.cos(H) * step; }
      const yy = r2(y0 + (y1 - y0) * ease(i / n));
      const p = M(r2(mx), r2(z), yy);
      if (g.bank != null) p.bank = i === n && !g.keepBank ? (segs[gi + 1]?.bank ?? 0) : g.bank;
      const nt = segs[gi + 1]?.tag;
      if (i === n && nt && gi + 1 < segs.length) Object.assign(p, nt);
      pts.push(p);
    }
    y = y1;
  });
  if (open) return { pts, at };
  const last = pts.pop();                                   // the loop closes itself: the last point = the first
  return { pts, at, closure: Math.hypot(last.x - pts[0].x, last.z - pts[0].z) };
}

const MAIN = lay(-150, 0, 0, 0.3, [
  { L: 97, tag: { w: 16 } },                                                         // START straight, north along the west wall
  { r: 28, a: 90, bank: -6, mark: 'corner1' },                                       // Block Corner (right)
  { L: 4, one: true, y: 0.32, tag: { w: 15 } },
  { L: 67, y: 13, ease: 'ss', mark: 'ramp', tag: { raised: true, off: 1.2, wall: 'books', kerb: false } },   // the BOOK RAMP up onto the desk
  { toX: 9.5, mark: 'desk', tag: { off: 3, surf: 'dirt', wall: 'pencils' } },       // along the DESK: crayons, bricks, the lamp
  { L: 11, one: true, y: 10.9, mark: 'lip', tag: {} },                               // the DESK JUMP (gap) onto the bed
  { toX: 103, mark: 'bed', tag: { w: 16, surf: 'quilt', off: 3, wall: 'none' } },    // over the quilt, past the pillow (Sootie)
  { r: 28, a: 90, bank: -6, mark: 'pillowTurn', tag: { offL: 0.8 } },                // Pillow Turn (right)
  { L: 52, y: 0.3, ease: 'ss', mark: 'slide', tag: { w: 14, off: 0.8, wall: 'slide', kerb: false } },   // the SLIDE down beside the bed
  { toZ: -5, mark: 'east', tag: { w: 15, raised: false, surf: 'carpet', offL: 3, wallL: 'blocks', offR: 2, wallR: 'none', kerb: 'auto' } },   // floor, the quilt on the right
  { r: 61, a: 180, bank: -4, mark: 'foot', tag: { offR: 0.6 } },                    // Foot-of-the-Bed Sweeper (right, 180°)
  { toZ: 40, mark: 'west', tag: { offR: 2, offL: 3 } },                                // north up the bed's other side
  { r: 28, a: -90, bank: 6, mark: 'deskCorner', tag: { offR: 4, offL: 4, wallR: 'blocks' } },  // Desk Corner (left)
  { toX: -48, mark: 'deskFront' },
  { r: 25, a: -90, bank: 6, mark: 'rugCorner' },                                     // (left) onto the PLAY RUG
  { L: 6 },
  { r: 45, a: -28, bank: 3, mark: 'wiggle' },                                        // Rug Wiggles
  { r: 45, a: 56, bank: -4 },
  { r: 45, a: -28, bank: 3 },
  { toZ: -85 },
  { r: 25, a: 90, bank: -6, mark: 'toybox' },                                        // Toy Box Turn (right)
  { toX: -125 },
  { r: 25, a: 90, bank: -6 },                                                        // (right)
  { toZ: 0 },                                                                        // back to the line
]);
if (MAIN.closure > 0.05) throw new Error('bedroom: main road does not close (' + MAIN.closure.toFixed(2) + ' m)');
const A = MAIN.at;
/** main-road `at` where the stretch from point i0 on crosses map z (straights running north or south) */
const atZ = (i0, z) => { const P = MAIN.pts; for (let i = i0; i < i0 + 12; i++) { const a = P[i].z, b = P[i + 1].z; if ((z - a) * (z - b) <= 0) return +(i + (z - a) / (b - a)).toFixed(3); } throw new Error('atZ'); };

// UNDER THE BED: off the floor road beside the bed (heading south, the bed on the right), through a gap in the
// dangling quilt, a right turn in under the bed, west along the dark space under it past the lost toys and the
// LOST SOCKS (lit by a toy torch and glow-in-the-dark socks), a right turn out through a gap in the quilt on the
// other side and onto the floor road heading north. Both ends ride main's right lane (main is flat there: y 0.3,
// no bank, so the branch's surface matches it exactly). The bed's slats are 8.7 m over it (tunnel roof ≥ 8.5).
const UNDER = lay(127.5, 42, 180, 0.3, [
  { L: 2, tag: {} },
  { r: 38.5, a: 35.7 }, { r: 38.5, a: -35.7, mark: 'gapIn' },                         // an S in through the gap in the quilt
  { r: 43, a: 180, mark: 'under', tag: { tunnel: true, offL: 1.5, offR: 1 } },                        // the U-turn under the bed (round the middle legs)
  { r: 38.5, a: -35.7, tag: { tunnel: false, off: 1 } }, { r: 38.5, a: 35.7, mark: 'gapOut' },   // out through the quilt on the other side
  { L: 2 },
], true);

export default {
  id: 'bedroom',
  name: 'Toy Box Turbo',
  theme: 'bedroom',
  music: 'bedroom',
  laps: 3,
  width: 15,
  offroad: 'carpet',
  defaults: { offL: 4, offR: 4, wallL: 'blocks', wallR: 'blocks' },
  env: {
    skyTop: 0x1a2a6a, skyHorizon: 0x6a5aa8, fog: 0x5a4f86, fogNear: 220, fogFar: 760,
    sunDir: [-0.45, 0.75, 0.35], sunColor: 0xffc890, sun: 1.75, hemiSky: 0xa8b0ff, hemiGround: 0xb08a70, hemi: 1.4,
    sky: 'sky_bedroom', clouds: false,
  },
  tex: { road: 'road_bedroom', ground: 'carpet', carpet: 'carpet', quilt: 'quilt', dirt: 'wood' },
  // an invisible floor under the floor: falling into the desk-to-bed gap = the helper carries you across
  // (the scenery hides this plane; the carpet is the terrain, flat at y 0)
  water: { y: -1.6, color: 0x2a3a6a, tint: 0x2a3a6a },
  terrain: {
    base: 0, dunes: 0, cell: 6,
    grass: { above: 99 },
    colors: { ground: 0xffffff, wet: 0xffffff, deep: 0xffffff },
  },
  points: MAIN.pts,
  start: 0,
  gaps: [{ from: A.lip + 0.03, to: A.lip + 0.97 }],
  jumps: [{ at: A.lip - 0.02, vy: 10 }],
  pads: [
    { at: A.lip - 2.2, lat: 0 },               // feeds the desk jump
    { at: A.ramp - 0.6, lat: 0 },              // up the book ramp
  ],
  items: [{ at: 0.5 }, { at: A.bed + 1.3 }, { at: A.east + 2.3 }, { at: A.west + 3.5 }, { at: A.wiggle + 0.2 }],
  stars: [
    { at: 1.6, lat: 3, n: 6 },
    { at: A.bed + 2.5, lat: -3.5, n: 6 },
    { at: A.slide + 1.2, lat: 0, n: 5 },
    { at: A.foot + 3.5, lat: 0, n: 6 },
    { at: A.wiggle + 1.6, lat: 0, n: 6 },
  ],
  checkpointCount: 8,
  // O-T-R letters (DESIGN.md "Track data format" → letters): C on the desk among the crayons, T in the dark under the
  // bed (the outside of its long right curve), R on the outside of the rug wiggles' right kink.
  letters: [{ at: A.desk + 1.5, lat: -4 }, { at: 9.5, lat: 2.5, route: 'underbed' }, { at: A.wiggle + 3, lat: 3 }],
  // Hidden shortcut (DESIGN.md "Branches (shortcuts)"): UNDER THE BED — see UNDER above; scenery/bedroom.js
  // `underBed` draws the quilt gaps, the dark space, the bed legs, the lost toys and socks, the torch.
  branches: [{
    id: 'underbed', name: 'Under the Bed',
    from: atZ(A.slide, 42), to: atZ(A.west, 42), side: 'R',
    width: 11,
    defaults: { offL: 1, offR: 1, wallL: 'none', wallR: 'none', kerb: false },
    points: UNDER.pts,
    stars: [{ at: 0.4, lat: 0, n: 5, spacing: 4 }],          // the star trail into the gap
    ai: { easy: 0, medium: 0.25, hard: 0.5 },
    hidden: true,
  }],
};
