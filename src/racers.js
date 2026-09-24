// racers.js — roster + procedural kart & driver models + animation (characters agent).
//
// Every racer is chunky N64 low-poly: rounded boxes, cones and cylinders merged per rigid part
// and per material (see racerart.js), vertex-coloured, with one small canvas atlas per racer
// for the face. ~12 draw calls and ~1.5k triangles a racer, kart included.
//
// Hierarchy (all positions in metres, kart space: +Z forward, origin on the ground):
//   root            <- core sets position + yaw (incl. drift swing)
//    └ offset       <- per-racer size (King Dad's kart is bigger)
//       └ flip      <- hit flip / spin-out / wobble, pivots at the kart's middle
//          └ base
//             ├ wheels (front L/R steer + spin, rear axle spins)   rig.wheels = 4 wheel-centre anchors
//             └ kart   <- suspension: roll, pitch, bounce, landing squash      rig.body
//                ├ steering column → wheel (turns with steer)
//                ├ exhaust anchors                                             rig.exhausts
//                └ driver (hip pivot: lean, pitch, bob)                         rig.driver
//                   ├ torso → head (look into the turn)                         rig.head
//                   ├ arms (stretch-IK to the steering-wheel grips, or pose)
//                   └ extras (tail, tentacles, energy rings…)
import * as THREE from 'three';
import { MAT, atlasMat, rbox, mapBoxUV, HEAD_FACES, taper, starGeo, Mesher } from './racerart.js';

/* ======================================================================= roster */
export const RACERS = [
  { id: 'orion',    name: 'Orion',    blurb: 'The hero! A rocket-powered kid who never gives up.', stats: { speed: 3, accel: 3, turn: 3 }, colors: { kart: 0x2f6fdc, accent: 0xffd23f, trim: 0xc22532 } },
  { id: 'sootie',   name: 'Sootie',   blurb: 'The family cat. Quick paws, twisty turns. Meow!',     stats: { speed: 2, accel: 3, turn: 4 }, colors: { kart: 0xff6fae, accent: 0x8ff0b4, trim: 0x2b2431 } },
  { id: 'kingdad',  name: 'King Dad', blurb: 'Big, fast, and he has the TV remote.',                stats: { speed: 5, accel: 2, turn: 2 }, colors: { kart: 0xd0342c, accent: 0xffd23f, trim: 0x2f6fd0 } },
  { id: 'mum',      name: 'Mum',      blurb: 'Smooth and speedy off the line. Always gets there!',  stats: { speed: 2, accel: 4, turn: 3 }, colors: { kart: 0x9b59d0, accent: 0xffe066, trim: 0xf4ecff } },
  { id: 'grumblin', name: 'Grumbles', blurb: 'A grumpy green gremlin who loves a big bump.',       stats: { speed: 4, accel: 2, turn: 3 }, colors: { kart: 0xff8a2a, accent: 0x4caf50, trim: 0x3a3f52 } },
  { id: 'jelly',    name: 'Wibble',   blurb: 'A wobbly jellyfish who wiggles round every corner.', stats: { speed: 2, accel: 2, turn: 5 }, colors: { kart: 0x2ec4e0, accent: 0xff8ad8, trim: 0xfff0fb } },
  { id: 'zapdrone', name: 'Zappy',    blurb: 'A buzzy robot that zooms off the start. Bzzt!',     stats: { speed: 2, accel: 5, turn: 2 }, colors: { kart: 0x2d3142, accent: 0x8fe3ff, trim: 0xffd23f } },
  { id: 'prickle',  name: 'Prickles', blurb: 'A spiky little burr-hog. No hugs, please!',          stats: { speed: 4, accel: 3, turn: 2 }, colors: { kart: 0x7ed957, accent: 0x8a5a2b, trim: 0xf7eccb } },
];
const BY_ID = Object.fromEntries(RACERS.map(r => [r.id, r]));
export const getRacer = id => BY_ID[id] || RACERS[0];

/* ======================================================================= layout */
const TAU = Math.PI * 2;
const HIP = [0, .45, -.2];                                  // driver pivot, kart space
const WHEEL = { c: [0, .66, .17], r: .15, tilt: -.5 };       // steering wheel centre / radius / tilt
const FW = { x: .47, z: .55, r: .22, w: .2 };               // front wheels
const RW = { x: .47, z: -.5, r: .28, w: .28 };              // rear wheels (CTR: fat rears)
const FLIP_Y = .55;                                         // hit-flip pivot height
const DARK = 0x2a2a32, TYRE = 0x26262c, CHROME = 0xc7cedb, ENGINE = 0x3a3f52;

/* ======================================================================= build */
const hasDOM = typeof document !== 'undefined';

export function buildRacer(id, { hd = false } = {}) {
  const def = getRacer(id), look = LOOK[def.id];
  const root = new THREE.Group(); root.name = 'racer:' + def.id;
  const offset = new THREE.Group(); offset.scale.setScalar(look.size || 1); root.add(offset);
  const flip = new THREE.Group(); flip.position.y = FLIP_Y; offset.add(flip);
  const base = new THREE.Group(); base.position.y = -FLIP_Y; flip.add(base);
  const kart = new THREE.Group(); kart.name = 'kart'; base.add(kart);

  // steering wheel: column group (tilted) → spinner (turns)
  const steerCol = new THREE.Group(); steerCol.position.set(...WHEEL.c); steerCol.rotation.x = WHEEL.tilt; kart.add(steerCol);
  const steerWheel = new THREE.Group(); steerCol.add(steerWheel);

  const driver = new THREE.Group(); driver.name = 'driver'; driver.position.set(...HIP); kart.add(driver);
  const torso = new THREE.Group(); driver.add(torso);
  const head = new THREE.Group(); head.name = 'head'; torso.add(head);
  const armL = new THREE.Group(), armR = new THREE.Group(); driver.add(armL, armR);

  const c = {
    def, look, col: def.colors,
    face: hasDOM ? atlasMat(def.id) : MAT.matte,
    kart: new Mesher(), steer: new Mesher(), torso: new Mesher(), head: new Mesher(),
    arms: [new Mesher(), new Mesher()],               // [left (+X), right (-X)]
    extras: [],                                       // { group, mesher } for animated bits
    shoulder: [.26, .33], neckY: .4, armLen: .4, headH: .5,
    exhausts: [[-.17, .67, -.99], [.17, .67, -.99]],
    seat: null, legs: null,
  };
  c.extra = (parent, pos = [0, 0, 0]) => {
    const g = new THREE.Group(); g.position.set(...pos); parent.add(g);
    const m = new Mesher(); c.extras.push({ group: g, mesher: m }); return { group: g, m };
  };
  c.groups = { kart, driver, torso, head, steerWheel, base };

  look.driver(c);                 // character first: it may change the seat, exhausts, shoulders
  buildKart(c);
  look.kart?.(c);

  c.kart.build(kart);
  c.steer.build(steerWheel);
  c.torso.build(torso);
  c.head.build(head);
  c.arms[0].build(armL); c.arms[1].build(armR);
  for (const e of c.extras) e.mesher.build(e.group);
  head.position.y = c.neckY;

  // wheels
  const wheels = [], frontPivots = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * FW.x, FW.r, FW.z); base.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const m = new Mesher(); wheelGeo(m, FW, s, c); m.build(spin);
    pivot.userData = { radius: FW.r, spin, baseY: FW.r, front: true };
    frontPivots.push(pivot); wheels.push(pivot);
  }
  const rearAxle = new THREE.Group(); rearAxle.position.set(0, RW.r, RW.z); base.add(rearAxle);
  { const m = new Mesher(); for (const s of [1, -1]) wheelGeo(m, RW, s, c, s * RW.x);
    m.add(MAT.matte, new THREE.CylinderGeometry(.035, .035, RW.x * 2, 6), DARK, [0, 0, 0], [0, 0, Math.PI / 2]);
    m.build(rearAxle); }
  for (const s of [1, -1]) {
    const a = new THREE.Object3D(); a.position.set(s * RW.x, RW.r, RW.z); a.userData = { radius: RW.r, baseY: RW.r, front: false };
    base.add(a); wheels.push(a);
  }

  const exhausts = c.exhausts.map(p => { const o = new THREE.Object3D(); o.position.set(...p); o.rotation.x = .55; kart.add(o); return o; });

  const rig = {
    id: def.id, def, root, offset, flip, base, body: kart, kart, driver, torso, head, headP: head, armL, armR,
    steerWheel, wheels, frontPivots, rearAxle, exhausts,
    extras: c.extras.map(e => e.group), look, floaty: !!c.floaty,
    extraRefs: { tail: c.tail, tentacles: c.tentacles, rings: c.rings },
    shoulder: c.shoulder, armLen: c.armLen, neckY: c.neckY, headH: c.headH, size: look.size || 1,
    procedural: [torso, armL, armR, ...c.extras.map(e => e.group)],
    st: { clock: 0, prevSp: 0, prevAir: false, airAcc: 0, wf: 0, wr: 0 },
    hd: null,
  };
  root.userData.rig = rig;
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  animateRacer(rig, IDLE, 0);       // settle into a valid pose before the first frame
  if (hd) attachHD(rig);
  return { root, rig };
}

function wheelGeo(m, W, s, c, x = 0) {
  const tyre = new THREE.CylinderGeometry(W.r, W.r, W.w, 12);
  m.add(MAT.matte, tyre, TYRE, [x, 0, 0], [0, 0, Math.PI / 2]);
  // hub: accent colour, pushed to the outside face; Mum's karts get tidy whitewalls
  const hubC = c.look.hub ?? c.col.accent;
  m.add(MAT.matte, new THREE.CylinderGeometry(W.r * .55, W.r * .55, W.w * .5, 8), hubC, [x + s * W.w * .3, 0, 0], [0, 0, Math.PI / 2]);
  if (c.look.whitewall) m.add(MAT.matte, new THREE.CylinderGeometry(W.r * .8, W.r * .8, W.w * .3, 12), 0xf4f4f4, [x + s * W.w * .37, 0, 0], [0, 0, Math.PI / 2]);
  // tread blocks: a few chunky lugs so the spin actually reads
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU;
    m.add(MAT.matte, new THREE.BoxGeometry(W.w * .9, .05, .07), 0x3a3a44,
      [x, Math.cos(a) * W.r, Math.sin(a) * W.r], [a, 0, 0]);
  }
}

/* ------------------------------------------------------------------ the kart */
function buildKart(c) {
  const K = c.kart, col = c.col, main = c.look.kartMain ?? col.kart, acc = c.look.kartAccent ?? col.accent;
  // tub + nose
  K.add(MAT.paint, rbox(.62, .14, 1.44, .3), main, [0, .2, -.04]);
  K.add(MAT.paint, rbox(.66, .24, 1.0, .35), main, [0, .36, -.16]);
  K.add(MAT.paint, taper(rbox(.58, .22, .64, .35), 1, .72, 1, .7), main, [0, .34, .5]);
  // cowl / dashboard behind the nose
  K.add(MAT.paint, rbox(.56, .18, .32, .45), main, [0, .5, .3], [.35, 0, 0]);
  // side pods between the wheels, with a stripe
  for (const s of [1, -1]) {
    K.add(MAT.paint, rbox(.16, .2, .62, .4), acc, [s * .39, .3, -.02]);
    K.add(MAT.matte, rbox(.02, .06, .5, 0), c.look.stripe ?? col.trim, [s * .475, .33, -.02]);
  }
  // bumpers
  K.add(MAT.paint, rbox(.7, .1, .1, .5), acc, [0, .25, .85]);
  K.add(MAT.paint, rbox(.66, .09, .09, .5), acc, [0, .27, -.95]);
  // steering column
  K.add(MAT.matte, new THREE.CylinderGeometry(.025, .025, .24, 6), DARK, [0, .58, .25], [WHEEL.tilt + Math.PI / 2 + .1, 0, 0]);
  // steering wheel (on its own spinner)
  c.steer.add(MAT.matte, new THREE.TorusGeometry(WHEEL.r, .028, 4, 12), DARK);
  c.steer.add(MAT.matte, new THREE.CylinderGeometry(.045, .045, .04, 8), acc, [0, 0, .01], [Math.PI / 2, 0, 0]);
  c.steer.add(MAT.matte, new THREE.BoxGeometry(WHEEL.r * 2, .03, .02), DARK);
  // seat (unless the character brings its own)
  const seat = c.seat ?? darken(main, .5);
  if (!c.look.noSeat) {
    K.add(MAT.matte, rbox(.46, .1, .38, .3), seat, [0, .44, -.22]);
    K.add(MAT.matte, rbox(.48, .36, .12, .45), seat, [0, .6, -.44], [-.14, 0, 0]);
  }
  // engine + pipes
  K.add(MAT.paint, rbox(.6, .18, .4, .35), main, [0, .38, -.72]);                     // rear deck
  K.add(MAT.paint, rbox(.54, .13, .05, .3), acc, [0, .37, -.92]);                      // tail panel
  for (const s of [1, -1]) K.add(MAT.glow, rbox(.1, .06, .02, .3), 0xff3b3b, [s * .17, .39, -.95]);
  K.add(MAT.matte, rbox(.36, .16, .24, .3), ENGINE, [0, .53, -.72]);
  for (const s of [1, -1]) K.add(MAT.paint, rbox(.12, .08, .2, .3), CHROME, [s * .1, .63, -.7]);
  for (const [x, y, z] of c.exhausts) {
    const d = [0, Math.sin(.55), -Math.cos(.55)];          // pipe axis: back and up
    K.add(MAT.paint, new THREE.CylinderGeometry(.06, .05, .34, 8), CHROME, [x - d[0] * .17, y - d[1] * .17, z - d[2] * .17], [-(Math.PI / 2 - .55), 0, 0]);
    K.add(MAT.matte, new THREE.CylinderGeometry(.064, .064, .04, 8), DARK, [x - d[0] * .01, y - d[1] * .01, z - d[2] * .01], [-(Math.PI / 2 - .55), 0, 0]);
  }
  // legs (sitting, feet forward under the cowl)
  const L = c.legs;
  if (L) for (const s of [1, -1]) {
    K.add(MAT.matte, rbox(L.w ?? .15, .14, .36, 0), L.thigh, [s * .1, .5, -.04]);
    K.add(MAT.matte, rbox((L.w ?? .15) * .9, .13, .2, 0), L.shin ?? L.thigh, [s * .1, .45, .18], [.5, 0, 0]);
    K.add(MAT.matte, rbox(.16, .1, .2, 0), L.shoe, [s * .1, .4, .3]);
  }
}

/* ------------------------------------------------------------------ driver helpers */
function headBox(c, w, h, d, { y = h / 2, round = .35, z = 0 } = {}) {
  c.head.add(c.face, mapBoxUV(rbox(w, h, d, round, 3), HEAD_FACES), 0xffffff, [0, y, z]);
  c.headH = h;
}
function arms(c, { len, t = .12, sleeve, hand, hs = .13, handRound = .5 }) {
  for (const m of c.arms) {
    m.add(MAT.matte, rbox(t, t, len * .74, .35), sleeve, [0, 0, len * .37]);
    m.add(MAT.matte, rbox(hs, hs * .85, hs * 1.05, handRound), hand, [0, 0, len * .95]);
  }
  c.armLen = len;
}
// Cones pointing out along a direction (spikes, ears).
function coneAt(m, mat, r, h, color, pos, dir, seg = 4) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
  const e = new THREE.Euler().setFromQuaternion(qq);
  m.add(mat, g, color, pos, [e.x, e.y, e.z]);
}
function flower(m, x, y, z, r, petal, centre, rot = [0, 0, 0]) {
  const grp = [];
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU;
    grp.push([rbox(r, r * .6, r * .9, .9, 2), petal, [Math.cos(a) * r * .7, Math.sin(a) * r * .7, 0], [0, 0, a]]);
  }
  grp.push([rbox(r * .7, r * .7, r * .6, .9, 2), centre, [0, 0, r * .12], [0, 0, 0]]);
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
  for (const [g, col, p, rr] of grp) {
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rr)), new THREE.Vector3(1, 1, 1)));
    g.applyMatrix4(M);
    m.add(MAT.matte, g, col);
  }
}
const deg = d => d * Math.PI / 180;
function darken(hex, k) { return new THREE.Color(hex).multiplyScalar(k).getHex(); }

/* ======================================================================= the cast */
const LOOK = {
  /* ---- Orion: SO2 player.js buildOrion — blue star hoodie, red shorts, brown hair tuft.
   * Kart: blue with his flight-suit red+gold rocket fins, a reactor headlight and a star. */
  orion: {
    driver(c) {
      const BLUE = 0x2f6fdc, BLUE_D = 0x1e4fa8, STAR = 0xffd23f, HAIR = 0x3a2a1c, SKIN = 0xf0c39a;
      c.torso.add(MAT.matte, rbox(.46, .4, .32, .35), BLUE, [0, .2, 0]);
      c.torso.add(MAT.matte, rbox(.48, .07, .34, .3), BLUE_D, [0, .04, 0]);            // hem
      c.torso.add(MAT.matte, rbox(.36, .14, .16, .5), BLUE_D, [0, .38, -.13]);          // hood
      c.torso.add(MAT.matte, starGeo(.1), STAR, [0, .22, .158]);
      c.torso.add(MAT.matte, starGeo(.12), STAR, [0, .2, -.158], [0, Math.PI, 0]);      // back too: chase cam
      c.neckY = .38;
      headBox(c, .52, .48, .46, { y: .25 });
      c.head.add(MAT.matte, rbox(.3, .12, .26, .4), HAIR, [0, .52, -.04], [0, 0, .18]);  // SO2's tuft
      c.head.add(MAT.matte, rbox(.18, .1, .16, .4), HAIR, [.07, .56, .06], [.2, 0, -.25]);
      c.shoulder = [.27, .32];
      arms(c, { len: .4, sleeve: BLUE, hand: SKIN });
      c.legs = { thigh: 0xd13b4a, shin: SKIN, shoe: 0xf4f4f4 };
    },
    kart(c) {
      const K = c.kart, RED = 0xc22532, GOLD = 0xe9b93e;
      // rocket fins at the back, like the SO2 flight suit
      for (const s of [1, -1]) {
        const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(.3, 0); fin.lineTo(.02, .3); fin.lineTo(-.08, .32); fin.closePath();
        const g = new THREE.ExtrudeGeometry(fin, { depth: .04, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 1 });
        g.translate(0, 0, -.02);
        K.add(MAT.paint, g, RED, [s * .28, .44, -.98], [0, -Math.PI / 2, -s * .45, 'ZYX']);
        K.add(MAT.paint, rbox(.06, .06, .12, .5), GOLD, [s * .42, .72, -1.02]);
      }
      K.add(MAT.glow, new THREE.CylinderGeometry(.07, .07, .04, 12), 0xcdf4ff, [0, .43, .83], [Math.PI / 2 - .3, 0, 0]); // reactor light
      K.add(MAT.paint, new THREE.TorusGeometry(.085, .02, 5, 12), GOLD, [0, .43, .84], [-.3, 0, 0]);
      K.add(MAT.matte, starGeo(.12), c.col.accent, [0, .455, .5], [-Math.PI / 2 + .2, 0, 0]);      // hood star
    },
  },

  /* ---- Sootie: SO2 SYMBOL.life cat — #2b2431 fur, mint eyes, pink nose, white whiskers;
   * SO1's white chest. Paws on the wheel, tail curling out over the side.
   * Kart: pink with mint trim, cat ears on the nose, a paw print on the hood. */
  sootie: {
    size: .96,
    driver(c) {
      const FUR = 0x2b2431, WHITE = 0xf4f0f8, PINK = 0xff9db0;
      c.torso.add(MAT.matte, rbox(.36, .36, .3, .5), FUR, [0, .18, 0]);
      c.torso.add(MAT.matte, rbox(.22, .24, .06, .6), WHITE, [0, .2, .135]);
      c.neckY = .33;
      headBox(c, .54, .44, .44, { y: .22, round: .55 });
      for (const s of [1, -1]) {
        coneAt(c.head, MAT.matte, .12, .24, FUR, [s * .16, .37, -.02], [s * .35, 1, 0]);
        coneAt(c.head, MAT.matte, .07, .15, PINK, [s * .155, .38, .035], [s * .35, 1, 0]);
      }
      c.shoulder = [.2, .27];
      arms(c, { len: .44, t: .1, sleeve: FUR, hand: WHITE, hs: .12 });
      c.legs = { thigh: FUR, shoe: WHITE, w: .13 };
      // the tail: a question-mark curl hanging out over the right-hand side of the seat
      const { group, m } = c.extra(c.groups.driver, [-.18, .1, -.12]);
      const pts = [[0, 0, 0], [-.12, .02, -.08], [-.24, .06, -.16], [-.3, .16, -.24], [-.3, .3, -.28], [-.26, .42, -.26], [-.2, .48, -.2]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
        const len = a.distanceTo(b) + .04, mid = a.clone().add(b).multiplyScalar(.5);
        const g = rbox(.085, .085, len, .5);
        const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
        const e = new THREE.Euler().setFromQuaternion(qq);
        m.add(MAT.matte, g, i === pts.length - 2 ? WHITE : FUR, mid.toArray(), [e.x, e.y, e.z]);
      }
      c.tail = group;
    },
    kart(c) {
      const K = c.kart, FUR = 0x2b2431, PINK = 0xff9db0;
      for (const s of [1, -1]) {          // cat ears on the nose
        coneAt(K, MAT.paint, .1, .2, c.col.kart, [s * .17, .46, .5], [s * .3, 1, .25]);
        coneAt(K, MAT.matte, .06, .13, c.col.accent, [s * .17, .47, .52], [s * .3, 1, .25]);
      }
      // paw print on the hood
      const P = (x, z, r) => K.add(MAT.matte, new THREE.CylinderGeometry(r, r, .02, 10), FUR, [x, .455 - z * .25, .62 + z], [.28, 0, 0]);
      P(0, 0, .07); P(-.08, .08, .03); P(-.03, .11, .03); P(.03, .11, .03); P(.08, .08, .03);
      // a fish-bone badge on the engine
      K.add(MAT.matte, rbox(.26, .03, .02, 0), 0xf4f0f8, [0, .5, -.86]);
      for (let i = 0; i < 3; i++) K.add(MAT.matte, rbox(.02, .1, .02, 0), 0xf4f0f8, [-.06 + i * .06, .5, -.86]);
      K.add(MAT.matte, rbox(.08, .08, .02, 0), 0xf4f0f8, [.15, .5, -.86], [0, 0, Math.PI / 4]);
    },
  },

  /* ---- King Dad: SO2 world.js king — bald, short black beard, crown, blue gown with dark
   * trim, TV remote. Bigger kart (size 1.1) with a red-and-gold throne for a seat. */
  kingdad: {
    size: 1.1,
    driver(c) {
      const GOWN = 0x2f6fd0, TRIM = 0x1e4d94, SKIN = 0xf0c9a0, BEARD = 0x241a14, GOLD = 0xffd23f;
      c.torso.add(MAT.matte, rbox(.62, .48, .44, .4), GOWN, [0, .24, 0]);
      c.torso.add(MAT.matte, rbox(.64, .09, .46, .3), TRIM, [0, .04, 0]);
      c.torso.add(MAT.matte, rbox(.46, .09, .36, .3), TRIM, [0, .47, 0]);                   // collar
      for (let i = 0; i < 3; i++) c.torso.add(MAT.paint, rbox(.05, .05, .03, .5), GOLD, [0, .14 + i * .1, .225]);
      c.neckY = .48;
      headBox(c, .58, .52, .52, { y: .27, round: .3 });
      c.head.add(MAT.matte, rbox(.6, .2, .3, .45), BEARD, [0, .07, .13]);                  // beard volume
      c.head.add(MAT.matte, rbox(.12, .14, .12, .5), SKIN, [0, .26, .28]);                  // nose
      for (const s of [1, -1]) c.head.add(MAT.matte, rbox(.07, .14, .12, .5), SKIN, [s * .3, .27, 0]);
      // the crown: band, four points, a red jewel
      c.head.add(MAT.paint, new THREE.CylinderGeometry(.24, .22, .13, 8, 1, true), GOLD, [0, .6, 0]);
      c.head.add(MAT.paint, new THREE.CylinderGeometry(.22, .22, .02, 8), 0xb0203a, [0, .56, 0]);
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * TAU + Math.PI / 4;
        c.head.add(MAT.paint, new THREE.ConeGeometry(.06, .16, 4), GOLD, [Math.sin(a) * .2, .74, Math.cos(a) * .2]);
      }
      c.head.add(MAT.glow, rbox(.06, .06, .03, .5), 0xff3a4a, [0, .6, .235]);
      c.shoulder = [.35, .4];
      arms(c, { len: .42, t: .15, sleeve: GOWN, hand: SKIN, hs: .15 });
      // the sceptre of dads everywhere, in his right hand, pointing at the road
      c.arms[1].add(MAT.matte, rbox(.07, .05, .2, .2), 0x23242a, [0, .07, .44]);
      c.arms[1].add(MAT.glow, rbox(.03, .02, .03, 0), 0xff4d4d, [0, .1, .49]);
      c.legs = { thigh: GOWN, shin: TRIM, shoe: 0x8d5fbf, w: .17 };
      c.look.noSeat = true;
    },
    kart(c) {
      const K = c.kart, VEL = 0xb0203a, GOLD = 0xffd23f;
      // throne: velvet seat + tall back with a gold arch and finials, gold armrests
      K.add(MAT.matte, rbox(.56, .12, .4, .3), VEL, [0, .44, -.22]);
      K.add(MAT.matte, rbox(.62, .5, .12, .35), VEL, [0, .68, -.46], [-.1, 0, 0]);
      K.add(MAT.paint, rbox(.7, .09, .16, .4), GOLD, [0, .95, -.49], [-.1, 0, 0]);
      K.add(MAT.paint, rbox(.2, .12, .12, .6), GOLD, [0, 1.02, -.5]);
      for (const s of [1, -1]) {
        K.add(MAT.paint, rbox(.07, .6, .07, .3), GOLD, [s * .34, .7, -.47]);
        K.add(MAT.paint, rbox(.11, .11, .11, .9), GOLD, [s * .34, 1.03, -.49]);
        K.add(MAT.paint, rbox(.08, .08, .34, .4), GOLD, [s * .33, .6, -.26]);
      }
      // a crown on the nose
      K.add(MAT.paint, new THREE.CylinderGeometry(.09, .09, .06, 8), GOLD, [0, .45, .56], [.25, 0, 0]);
      for (let i = 0; i < 3; i++) K.add(MAT.paint, new THREE.ConeGeometry(.03, .08, 4), GOLD, [(i - 1) * .06, .5, .55], [.25, 0, 0]);
    },
  },

  /* ---- Mum (Gemma): SO1 MUM_FRAMES — long brown hair #4a2c14 to the shoulders, purple dress
   * #c46fd4, white shoes. A flower in her hair. Kart: tidy purple, whitewalls, a big flower. */
  mum: {
    whitewall: true,
    driver(c) {
      const DRESS = 0xc46fd4, DRESS_L = 0xe3a8ec, HAIR = 0x5a3518, SKIN = 0xffd9b3;
      c.torso.add(MAT.matte, rbox(.42, .4, .3, .4), DRESS, [0, .2, 0]);
      c.torso.add(MAT.matte, rbox(.3, .07, .2, .4), DRESS_L, [0, .39, .03]);
      c.torso.add(MAT.matte, rbox(.14, .12, .02, .3), SKIN, [0, .36, .15]);                 // neckline
      c.neckY = .38;
      headBox(c, .48, .46, .44, { y: .25, round: .4 });
      c.head.add(MAT.matte, rbox(.54, .2, .5, .6), HAIR, [0, .44, -.02]);                  // crown of hair
      c.head.add(MAT.matte, rbox(.54, .36, .18, .5), HAIR, [0, .27, -.2]);                // long hair down the back…
      c.head.add(MAT.matte, rbox(.48, .32, .14, .65), HAIR, [0, .0, -.23], [.18, 0, 0]);  // …flicking out at the ends
      for (const s of [1, -1]) c.head.add(MAT.matte, rbox(.09, .44, .22, .6), HAIR, [s * .26, .17, -.04]);
      flower(c.head, .27, .42, .08, .07, 0xff8fc0, 0xffe066, [0, Math.PI / 2, 0]);
      c.shoulder = [.25, .32];
      arms(c, { len: .41, t: .11, sleeve: DRESS, hand: SKIN, hs: .12 });
      c.legs = { thigh: DRESS, shin: SKIN, shoe: 0xf4f4f4, w: .14 };
      c.seat = 0xf4ecff;
    },
    kart(c) {
      const K = c.kart;
      flower(K, 0, .47, .52, .1, 0xffffff, c.col.accent, [-Math.PI / 2 + .25, 0, 0]);
      // a little picnic basket on the back
      K.add(MAT.matte, rbox(.4, .2, .22, .2), 0xc98b4a, [0, .7, -.72]);
      K.add(MAT.matte, rbox(.42, .04, .24, .2), 0xf4ecff, [0, .81, -.72]);
      K.add(MAT.matte, new THREE.TorusGeometry(.13, .018, 4, 10, Math.PI), 0x9c6531, [0, .82, -.72]);
      for (let i = 0; i < 4; i++) K.add(MAT.matte, rbox(.06, .02, .24, 0), 0xe0506e, [-.15 + i * .1, .82, -.72]);
    },
  },

  /* ---- Grumbles: SO2 grumblin — the green box with big white eyes and chunky feet, driving
   * with stubby arms. Kart: orange and a bit junky, with a spare tyre on the back. */
  grumblin: {
    driver(c) {
      const G = 0x4caf50, GD = 0x2e7d32;
      c.torso.add(MAT.matte, rbox(.4, .2, .32, .3), G, [0, .1, 0]);
      c.neckY = .15;
      headBox(c, .78, .66, .62, { y: .33, round: .22 });
      for (const s of [1, -1]) coneAt(c.head, MAT.matte, .08, .2, GD, [s * .38, .5, -.05], [s, .6, -.2]);
      c.head.add(MAT.matte, rbox(.12, .08, .12, .5), GD, [0, .69, 0]);
      c.shoulder = [.37, .25];
      arms(c, { len: .36, t: .11, sleeve: G, hand: GD, hs: .13 });
      c.legs = { thigh: G, shoe: GD, w: .16 };
    },
    kart(c) {
      const K = c.kart;
      K.add(MAT.matte, new THREE.TorusGeometry(.2, .08, 6, 12), TYRE, [0, .74, -.62], [0, 0, 0]);
      K.add(MAT.paint, new THREE.CylinderGeometry(.1, .1, .1, 8), c.col.accent, [0, .74, -.62], [Math.PI / 2, 0, 0]);
      // bolted-on patches
      K.add(MAT.matte, rbox(.16, .02, .14, 0), 0x8a8f99, [.14, .455, .45], [.28, 0, .1]);
      K.add(MAT.matte, rbox(.12, .1, .02, 0), 0x8a8f99, [-.33, .38, .2], [0, Math.PI / 2, 0]);
    },
  },

  /* ---- Wibble: SO2 jelly — pink translucent bell with a pale cap and hot-pink tentacles. She
   * floats above the seat; two tentacles steer, the rest trail. Kart: aqua with a clam-shell seat. */
  jelly: {
    driver(c) {
      const BELL = 0xff8ad8, CAP = 0xfff0fb, TENT = 0xff5d73;
      c.neckY = .22;
      const bell = new THREE.SphereGeometry(.34, 14, 7, 0, TAU, 0, Math.PI * .56);
      c.head.add(MAT.jelly, bell, BELL, [0, .12, 0], [0, 0, 0], [1.08, 1, 1.08]);
      c.head.add(MAT.jelly, new THREE.SphereGeometry(.24, 12, 5, 0, TAU, 0, Math.PI * .45), CAP, [0, .3, 0]);
      for (const s of [1, -1]) {
        c.head.add(MAT.matte, new THREE.SphereGeometry(.065, 8, 6), 0x1a1020, [s * .12, .26, .28]);
        c.head.add(MAT.matte, new THREE.SphereGeometry(.022, 6, 4), 0xffffff, [s * .12 - .02, .29, .335]);
        c.head.add(MAT.matte, new THREE.CylinderGeometry(.04, .04, .01, 8), 0xff5aa8, [s * .21, .19, .25], [Math.PI / 2 - .5, s * .6, 0]);
      }
      c.head.add(MAT.matte, new THREE.TorusGeometry(.05, .012, 4, 8, Math.PI), 0x6a1040, [0, .2, .31], [0, 0, Math.PI]);
      c.headH = .5;
      c.shoulder = [.18, .28];
      c.arms.forEach(m => {
        m.add(MAT.matte, new THREE.CylinderGeometry(.03, .045, .44, 6).rotateX(Math.PI / 2), TENT, [0, 0, .22]);
        m.add(MAT.matte, rbox(.07, .07, .07, .8), TENT, [0, 0, .44]);
      });
      c.armLen = .44;
      // trailing tentacles, hanging from the rim and streaming back
      const { group, m } = c.extra(c.groups.torso, [0, c.neckY + .1, 0]);
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i - 2) * .55;
        const x = Math.sin(a) * .22, z = Math.cos(a) * .22;
        for (let k = 0; k < 3; k++) {
          m.add(MAT.matte, new THREE.CylinderGeometry(.03 - k * .006, .036 - k * .006, .2, 5), TENT,
            [x * (1 + k * .25), -.1 - k * .17, z * (1 + k * .35) - k * .05], [-.25 - k * .2, 0, x * .8]);
        }
      }
      c.tentacles = group;
      c.floaty = true;
      c.look.noSeat = true;
    },
    kart(c) {
      const K = c.kart, SHELL = 0xffd6e8;
      // clam-shell seat: fan of ribs
      K.add(MAT.matte, rbox(.46, .1, .38, .3), SHELL, [0, .44, -.22]);
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * .32;
        K.add(MAT.paint, rbox(.13, .5, .08, .5), i % 2 ? SHELL : 0xffb3d1, [Math.sin(a) * .2, .62 + Math.cos(a) * .06, -.45], [-.15, 0, -a]);
      }
      // bubbles on the hood
      for (const [x, z, r] of [[.12, .5, .06], [-.1, .58, .045], [.02, .66, .035], [-.16, .44, .03]])
        K.add(MAT.paint, new THREE.SphereGeometry(r, 8, 6), 0xe8fcff, [x, .46 - (z - .5) * .3, z]);
    },
  },

  /* ---- Zappy: SO2 zapdrone — grey octahedron, big red eye, two crackling energy rings. Made
   * friendlier: a glint in the eye and an antenna bobble. Hovers over the seat. Kart: charcoal
   * with glowing cyan strips, hazard trim, and a tesla coil on the back. */
  zapdrone: {
    driver(c) {
      const GREY = 0x8892a6, DARKG = 0x5a6275;
      c.neckY = .18;
      const body = new THREE.OctahedronGeometry(.32, 0);
      c.head.add(MAT.paint, body, GREY, [0, .32, 0], [0, Math.PI / 4, 0], [1, 1.15, 1]);
      c.head.add(MAT.matte, new THREE.CylinderGeometry(.14, .14, .08, 12), DARKG, [0, .33, .16], [Math.PI / 2, 0, 0]);
      c.head.add(MAT.glow, new THREE.SphereGeometry(.11, 12, 8), 0xff5a5a, [0, .33, .2]);
      c.head.add(MAT.glow, new THREE.SphereGeometry(.035, 6, 4), 0xffffff, [-.04, .37, .3]);
      c.head.add(MAT.matte, new THREE.CylinderGeometry(.012, .012, .2, 4), DARKG, [0, .76, 0]);
      c.head.add(MAT.glow, new THREE.SphereGeometry(.045, 8, 6), 0xffd23f, [0, .87, 0]);
      c.headH = .75;
      c.shoulder = [.2, .3];
      c.arms.forEach(m => {
        m.add(MAT.matte, new THREE.CylinderGeometry(.025, .025, .38, 6).rotateX(Math.PI / 2), DARKG, [0, 0, .19]);
        m.add(MAT.matte, rbox(.08, .08, .08, .8, 2), GREY, [0, 0, .02]);
        m.add(MAT.matte, rbox(.1, .06, .08, .3), 0xffd23f, [0, 0, .4]);
      });
      c.armLen = .42;
      // energy rings (spin in animate)
      const { group, m } = c.extra(c.groups.head, [0, .32, 0]);
      for (const s of [1, -1]) m.add(MAT.glow, new THREE.TorusGeometry(.44, .018, 4, 20), 0x8fe3ff, [0, 0, 0], [Math.PI / 2 + s * .5, 0, s * .4]);
      c.rings = group;
      c.floaty = true;
      c.seat = 0x1c1f2a;
    },
    kart(c) {
      const K = c.kart;
      for (const s of [1, -1]) {
        K.add(MAT.glow, rbox(.02, .04, .9, 0), 0x8fe3ff, [s * .335, .4, -.12]);
        K.add(MAT.glow, rbox(.02, .03, .3, 0), 0x8fe3ff, [s * .2, .43, .52], [-.2, 0, 0]);
      }
      // hazard chevrons on the nose
      for (let i = 0; i < 3; i++) K.add(MAT.matte, rbox(.08, .02, .22, 0), 0x1c1f2a, [-.14 + i * .14, .455, .52], [-.25, .6, 0]);
      K.add(MAT.matte, rbox(.44, .015, .26, 0), c.col.trim, [0, .45, .52], [-.25, 0, 0]);
      // tesla coil
      K.add(MAT.paint, new THREE.CylinderGeometry(.05, .08, .3, 8), CHROME, [0, .74, -.7]);
      for (let i = 0; i < 3; i++) K.add(MAT.paint, new THREE.TorusGeometry(.07 - i * .01, .015, 4, 10), 0xc07a3a, [0, .66 + i * .07, -.7], [Math.PI / 2, 0, 0]);
      K.add(MAT.glow, new THREE.SphereGeometry(.08, 10, 8), 0x8fe3ff, [0, .93, -.7]);
    },
  },

  /* ---- Prickles: SO2 prickle — brown ball, cream spikes — as a cute burr-hog with a cream face.
   * Kart: lime with wooden bumpers and a big leaf spoiler. */
  prickle: {
    kartAccent: 0x8a5a2b,
    driver(c) {
      const BR = 0x6d4c41, CR = 0xf0e6d2;
      c.torso.add(MAT.matte, rbox(.4, .24, .32, .4), BR, [0, .12, 0]);
      c.neckY = .17;
      headBox(c, .66, .62, .6, { y: .32, round: .8 });
      // spikes over the back and top — never the face
      const N = 16;
      for (let i = 0; i < N; i++) {
        const y = 1 - (i + .5) / N * 1.6, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
        const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
        if (d.z > .15) d.z = -d.z * .6;                                                   // keep the face clear
        if (d.y < -.5) continue;
        d.normalize();
        coneAt(c.head, MAT.matte, .075, .24, CR, [d.x * .3, .32 + d.y * .28, d.z * .28], d.toArray());
      }
      c.shoulder = [.3, .22];
      arms(c, { len: .4, t: .11, sleeve: BR, hand: CR, hs: .12 });
      c.legs = { thigh: BR, shoe: CR, w: .14 };
      c.seat = 0x5c3a1a;
    },
    kart(c) {
      const K = c.kart, LEAF = 0x3f9e2f;
      // leaf spoiler on a twig
      const leaf = new THREE.Shape();
      leaf.moveTo(-.42, 0); leaf.quadraticCurveTo(0, .26, .42, 0); leaf.quadraticCurveTo(0, -.26, -.42, 0);
      const g = new THREE.ExtrudeGeometry(leaf, { depth: .03, bevelEnabled: false });
      K.add(MAT.paint, g, LEAF, [0, .96, -.62], [-Math.PI / 2 + .25, 0, 0]);
      K.add(MAT.matte, rbox(.8, .02, .03, 0), 0x2a6b1f, [0, .975, -.62], [.25, 0, 0]);
      K.add(MAT.matte, new THREE.CylinderGeometry(.03, .04, .3, 5), 0x6d4c41, [0, .8, -.64]);
      // acorn on the nose
      K.add(MAT.paint, rbox(.13, .15, .13, .8), 0xc98b4a, [0, .5, .56]);
      K.add(MAT.matte, rbox(.16, .07, .16, .6), 0x6d4c41, [0, .57, .56]);
    },
  },
};

/* ======================================================================= animation */
const IDLE = { speed: 0, maxSpeed: 22, steer: 0, throttle: 0, drift: 0, driftAngle: 0, charge: 0, boostT: 0,
  air: false, airT: 0, landT: 9, hitT: 0, hitKind: null, spinT: 0, cheer: false, sad: false };

// Damped spring toward target (zeta 1 = critically damped). Sub-stepped, so any dt is stable.
function spr(st, key, target, w, z, dt) {
  let y = st[key]; if (!y) y = st[key] = { x: target, v: 0 };
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  for (let i = 0; i < n; i++) { y.v += (w * w * (target - y.x) - 2 * z * w * y.v) * h; y.x += y.v * h; }
  return y.x;
}
function kick(st, key, dv) { const y = st[key] || (st[key] = { x: 0, v: 0 }); y.v += dv; }
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = x => x * x * (3 - 2 * x);

const _M = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _g = new THREE.Vector3(), _sh = new THREE.Vector3(),
  _d = new THREE.Vector3(), _tg = new THREE.Vector3(), _pose = new THREE.Vector3(), _Z = new THREE.Vector3(0, 0, 1);

export function animateRacer(rig, s, dt) {
  const st = rig.st;
  dt = clamp(dt || 0, 0, .1);
  st.clock += dt;
  const t = s.t ?? st.clock;
  const maxS = s.maxSpeed || 22, sp = s.speed || 0, v = clamp(Math.abs(sp) / maxS, 0, 1.4);
  const steer = clamp(s.steer || 0, -1, 1), drift = s.drift || 0, charge = s.charge || 0;
  const boosting = (s.boostT || 0) > 0, air = !!s.air;
  const hitT = s.hitT || 0, hitting = hitT > 0 && hitT < 1;
  const spinning = (s.spinT || 0) > 0;
  const cheer = !!s.cheer && !hitting, sad = !!s.sad && !cheer && !hitting;
  const L = rig.look;

  // --- derived: acceleration (smoothed), landing/takeoff kicks -----------------------
  if (dt > 0) {
    const acc = (sp - st.prevSp) / dt;
    spr(st, 'acc', clamp(acc / 30, -1, 1), 5, 1, dt);
    if (st.prevAir && !air) kick(st, 'sq', 5 + Math.min(1, st.airAcc) * 7);   // squash on landing
    if (!st.prevAir && air) kick(st, 'sq', -4);                                // stretch on the hop
  }
  st.airAcc = air ? (s.airT ?? (st.airAcc + dt)) : (st.prevAir ? st.airAcc : 0);
  st.prevSp = sp; st.prevAir = air;
  const accF = st.acc ? st.acc.x : 0;
  const sq = spr(st, 'sq', 0, 16, .38, dt);               // + squash, − stretch (bouncy)

  // --- driver lean / pitch ------------------------------------------------------------
  const sf = Math.min(1, .3 + v * 1.1);
  let lean = steer * deg(15) * sf;
  if (drift) lean = drift * deg(27) + steer * deg(6);
  if (air) lean *= .6;
  if (cheer || sad) lean = 0;
  const leanX = spr(st, 'lean', lean, 9, .7, dt);
  const redZone = drift && charge > .72;
  const shiver = drift ? Math.sin(t * 57) * (.008 + charge * .02) * (redZone ? 1.8 : 1) : 0;
  let pitch = -accF * .25;
  if (boosting) pitch = .32;
  if (air) pitch -= .08;
  if (sad) pitch = .32; else if (cheer) pitch = -.12;
  const pitchX = spr(st, 'pitch', pitch, 8, .65, dt);

  const D = rig.driver;
  D.rotation.set(pitchX, 0, -leanX + shiver);
  D.position.set(HIP[0] + leanX * .07, HIP[1], HIP[2] - (boosting ? .03 : 0));
  let bob = 0;
  if (cheer) bob = Math.abs(Math.sin(t * 7.5)) * .1;
  if (sad) bob = -.03;
  if (rig.floaty) bob += .08 + Math.sin(t * 2.6) * .045;
  D.position.y += bob;

  // torso squash/stretch + breathing
  const breathe = 1 + Math.sin(t * 2.3) * .015 * (1 - Math.min(1, v));
  const tsy = clamp(1 - sq * .45, .6, 1.35) * breathe;
  rig.torso.scale.set(1 + (1 - tsy) * .5, tsy, 1 + (1 - tsy) * .5);

  // --- head: look into the turn -----------------------------------------------------------
  let yaw = steer * .38 * sf + drift * .42;
  let nod = boosting ? -.22 : 0, tilt = leanX * .45;
  if (cheer) { yaw = Math.sin(t * 3) * .3; nod = -.3; tilt = Math.sin(t * 6) * .12; }
  if (sad) { yaw = Math.sin(t * 1.4) * .28; nod = .42; }
  if (spinning || (s.slowT || 0) > 0) tilt += Math.sin(t * 13) * .25;            // dizzy
  if (hitting) { yaw = Math.sin(t * 20) * .4; nod = -.2; }
  rig.headP.rotation.set(spr(st, 'nod', nod, 10, .7, dt), spr(st, 'yaw', yaw, 9, .8, dt), spr(st, 'tilt', tilt, 10, .6, dt));

  // --- kart body: suspension -----------------------------------------------------------------
  const roll = spr(st, 'roll', steer * sf * .07 + drift * .07, 10, .45, dt);     // rolls OUTWARD, driver leans IN
  const kp = spr(st, 'kp', -accF * .06 - (boosting ? .07 : 0) - (air ? .06 : 0), 10, .5, dt);
  const K = rig.kart;
  const bumps = air ? 0 : (Math.sin(t * 23.7) * .5 + Math.sin(t * 37.1 + 1) * .3 + Math.sin(t * 11.3 + 2) * .2) * .014 * Math.min(1, v);
  const idle = Math.abs(sp) < .5 && !air ? Math.sin(t * 46) * .004 : 0;             // engine idling
  const cheerHop = cheer ? Math.abs(Math.sin(t * 7.5)) * .04 : 0;
  K.rotation.set(kp + bumps * .6, 0, roll + shiver * .6);
  K.position.y = bumps + idle + cheerHop;
  const ksy = clamp(1 - sq * .2, .8, 1.15);
  K.scale.set(1 + (1 - ksy) * .4, ksy, 1 + (1 - ksy) * .4);

  // --- wheels ----------------------------------------------------------------------------------------
  st.wf = (st.wf + sp / FW.r * dt) % TAU; st.wr = (st.wr + sp / RW.r * dt) % TAU;
  const wSteer = spr(st, 'ws', steer * deg(25), 18, 1, dt);
  const droop = spr(st, 'droop', air ? -.07 : 0, 12, .6, dt);
  for (const p of rig.frontPivots) { p.rotation.y = wSteer; p.userData.spin.rotation.x = st.wf; p.position.y = FW.r + droop; }
  rig.rearAxle.rotation.x = st.wr; rig.rearAxle.position.y = RW.r + droop;
  for (const w of rig.wheels) if (!w.userData.front) w.position.y = RW.r + droop;

  // steering wheel
  const sw = spr(st, 'sw', steer * 1.1, 14, .9, dt);
  rig.steerWheel.rotation.z = -sw;

  // --- arms: hands on the wheel (stretch IK) or posed -----------------------------------------
  const handsOn = spr(st, 'hands', (cheer || sad || hitting) ? 0 : 1, 11, 1, dt);
  rig.steerWheel.parent.updateMatrix(); rig.steerWheel.updateMatrix(); D.updateMatrix();
  _M.multiplyMatrices(rig.steerWheel.parent.matrix, rig.steerWheel.matrix);
  _inv.copy(D.matrix).invert();
  const [shx, shy] = rig.shoulder, ty = rig.torso.scale.y;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1, arm = i === 0 ? rig.armL : rig.armR;
    _sh.set(side * shx * rig.torso.scale.x, shy * ty, 0);
    const ga = .45;
    _g.set(side * WHEEL.r * Math.cos(ga), WHEEL.r * Math.sin(ga), 0).applyMatrix4(_M).applyMatrix4(_inv);
    if (handsOn < .999) {
      if (cheer) _pose.set(side * (shx + .1), shy + .5 + Math.sin(t * 9 + i * Math.PI) * .1, .12);
      else if (sad) _pose.set(side * .12, .05, .26);
      else { const ph = t * 17 + i * 2; _pose.set(side * (shx + .2 + Math.cos(ph) * .15), shy + .25 + Math.sin(ph) * .22, .1); }
      _tg.copy(_pose).lerp(_g, clamp(handsOn, 0, 1));
    } else _tg.copy(_g);
    _d.subVectors(_tg, _sh); const len = _d.length() || 1; _d.divideScalar(len);
    arm.position.copy(_sh);
    arm.quaternion.setFromUnitVectors(_Z, _d);
    arm.scale.set(1, 1, clamp(len / rig.armLen, .5, 1.7));
  }

  // --- whole-racer: hit flip, spin-out, remote wobble ----------------------------------------------
  const F = rig.flip;
  let fy = FLIP_Y, rx = 0, ry = 0, rz = 0;
  if (hitting) {
    const h = smooth(hitT);
    fy += Math.sin(Math.PI * hitT) * 1.3;
    rx = -h * TAU; ry = h * TAU;
  }
  if (spinning) ry += s.spinT * TAU * 2;
  if ((s.slowT || 0) > 0) rz = Math.sin(t * 16) * .08 * Math.min(1, s.slowT);
  F.position.y = fy; F.rotation.set(rx, ry, rz);

  // --- per-character extras ------------------------------------------------------------------------
  const X = rig.extraRefs;
  if (X.tail) {
    X.tail.rotation.set(Math.sin(t * 2.2) * .12 - v * .25, Math.sin(t * 3.1) * .3 + leanX * .8, Math.sin(t * 2.7) * .1);
  }
  if (X.tentacles) {
    const w = Math.sin(t * 4.2);
    X.tentacles.rotation.set(-v * .5 + w * .12, leanX * .9, Math.sin(t * 3.3) * .1);
    X.tentacles.scale.set(1, 1 + w * .08 - sq * .3, 1);
    rig.headP.scale.set(1 + w * .04 + sq * .25, 1 - w * .06 - sq * .35, 1 + w * .04 + sq * .25);
  }
  if (X.rings) { X.rings.rotation.y = t * 5; X.rings.rotation.x = Math.sin(t * 2) * .2; }

  if (rig.hd && rig.hd.animate) rig.hd.animate(rig.hd.rig, s, dt);
}

/* ======================================================================= HD hook */
// buildRacer(id, { hd: true }) returns the procedural racer at once; if src/hdracers.js (HD-model
// agent) has a GLB for this racer, the DRIVER is swapped when it loads: every procedural child of
// rig.driver is hidden, the HD root (origin = seat contact, +Z forward) is parented to rig.driver so
// it inherits our lean/pitch/bob, and animateRacer() calls hdracers.animateHD every frame after. The
// kart stays procedural; rig.head is re-pointed at the HD head tracker (TNT-on-head keeps working).
let hdMod = null;
function attachHD(rig) {
  if (!hdMod) hdMod = import('./hdracers.js').catch(() => null);
  hdMod.then(m => {
    if (!m || !m.hasHD || !m.hasHD(rig.id)) return null;
    return m.loadHDRacer(rig.id, { lean: .5 }).then(res => ({ m, res }));
  }).then(x => {
    if (!x || !x.res || !x.res.root || rig.disposed) return;
    for (const c of rig.driver.children) c.visible = false;
    rig.driver.add(x.res.root);
    if (x.res.rig && x.res.rig.wheel) rig.steerWheel.visible = false;       // HD brings its own wheel
    if (x.res.rig && x.res.rig.head) rig.head = x.res.rig.head;
    rig.hd = { animate: x.m.animateHD, root: x.res.root, rig: x.res.rig };
  }).catch(e => console.warn('HD racer unavailable, keeping procedural:', rig.id, e && e.message));
}

/* ======================================================================= portraits */
// Head + shoulders, 3/4 front, rendered once per (id, size, bg) into a 2D canvas and cached.
// One shared offscreen WebGLRenderer; call disposePortraits() to free it (and the cache).
let pr = null;
const portraitCache = new Map();
export function renderPortrait(id, size = 128, { bg = true } = {}) {
  const key = `${id}:${size}:${bg}`;
  if (portraitCache.has(key)) return portraitCache.get(key);
  const out = document.createElement('canvas'); out.width = out.height = size;
  const def = getRacer(id), g = out.getContext('2d');
  if (bg) {
    const col = '#' + def.colors.kart.toString(16).padStart(6, '0');
    const grad = g.createRadialGradient(size * .5, size * .4, size * .05, size * .5, size * .5, size * .5);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(.35, col); grad.addColorStop(1, shade(def.colors.kart, .55));
    g.fillStyle = grad; g.beginPath(); g.arc(size / 2, size / 2, size * .48, 0, TAU); g.fill();
    g.lineWidth = size * .04; g.strokeStyle = '#ffffff'; g.stroke();
  }
  try {
    if (!pr) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, canvas: document.createElement('canvas') });
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfefff, 0x6a5a4a, 1.6));
      const key = new THREE.DirectionalLight(0xfff4e0, 2.6); key.position.set(2, 3, 4); scene.add(key);
      const rim = new THREE.DirectionalLight(0xbfdcff, 1.4); rim.position.set(-3, 2, -3); scene.add(rim);
      const cam = new THREE.PerspectiveCamera(30, 1, .05, 50);
      pr = { renderer, scene, cam };
    }
    const { renderer, scene, cam } = pr;
    renderer.setSize(size, size, false);
    const { root, rig } = buildRacer(id);
    for (let i = 0; i < 20; i++) animateRacer(rig, IDLE, 1 / 30);
    scene.add(root); root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig.head), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const h = Math.max(sz.y, sz.x) * 1.45;
    c.y -= sz.y * .12;
    const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    cam.position.copy(c).add(new THREE.Vector3(.38, .16, 1).normalize().multiplyScalar(dist));
    cam.lookAt(c);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    if (bg) { g.save(); g.beginPath(); g.arc(size / 2, size / 2, size * .46, 0, TAU); g.clip(); }
    g.drawImage(renderer.domElement, 0, 0, size, size);
    if (bg) g.restore();
    scene.remove(root);
    disposeTree(root);
  } catch (e) {
    g.fillStyle = '#fff'; g.font = `bold ${size * .5}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(def.name[0], size / 2, size / 2);
  }
  portraitCache.set(key, out);
  return out;
}
export function disposePortraits() {
  if (pr) { pr.renderer.dispose(); pr.renderer.forceContextLoss?.(); pr = null; }
  portraitCache.clear();
}
function shade(hex, k) {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return '#' + c.getHexString();
}
// Geometry is per-racer; materials are shared (MAT / atlas) and must NOT be disposed here.
export function disposeTree(root) { root.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }

/** Triangle / draw-call count for a built racer (visible meshes). */
export function racerStats(root) {
  let tris = 0, draws = 0;
  root.traverse(o => { if (o.isMesh && o.visible) { draws++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } });
  return { tris, draws };
}
