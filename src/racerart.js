// racerart.js — geometry + texture helpers for the procedural racers (characters agent).
//
// The whole cast is built from a handful of primitives that are MERGED per rigid part and per
// material, so a racer costs ~12 draw calls however many boxes went into it. Colour lives in
// vertex colours (one shared material for every flat-coloured part of every racer); only faces
// get a texture, one small canvas atlas per racer.
import * as THREE from 'three';

/* ------------------------------------------------------------------ materials */
// Shared across ALL racers. Vertex colours carry the palette, so eight racers = these four
// materials + one face atlas each. No metalness: there's no env map and metal goes black.
export const MAT = {
  paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0 }),
  matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  jelly: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, transparent: true, opacity: 0.88,
    emissive: 0x5a1040, emissiveIntensity: 0.5 }),
};
MAT.paint.name = 'racer-paint'; MAT.matte.name = 'racer-matte'; MAT.glow.name = 'racer-glow'; MAT.jelly.name = 'racer-jelly';

const atlasMats = new Map();
export function atlasMat(id) {
  let m = atlasMats.get(id);
  if (!m) {
    const tex = new THREE.CanvasTexture(faceAtlas(id));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    m = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.8, metalness: 0 });
    m.name = 'racer-face-' + id;
    atlasMats.set(id, m);
  }
  return m;
}

/* ------------------------------------------------------------------ geometry */
// Rounded box: a segmented box whose vertices are pulled toward the inscribed ellipsoid by
// `round` (0 = box, 1 = ball). Faces keep their own UV grid, so an atlas face still maps.
export function rbox(w, h, d, round = 0.45, seg = 2) {
  // small or unrounded bits don't need the extra segments (48 tris -> 12)
  if (seg === 2 && (round < .1 || Math.max(w, h, d) < .1)) { seg = 1; round = 0; }
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  if (round > 0) {
    const p = g.attributes.position, n = g.attributes.normal;
    const hw = w / 2, hh = h / 2, hd = d / 2, v = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i) / hw, p.getY(i) / hh, p.getZ(i) / hd);
      s.copy(v).normalize();
      const q = v.clone().lerp(s, round);
      p.setXYZ(i, q.x * hw, q.y * hh, q.z * hd);
      // soft normals: blend the flat face normal toward the ellipsoid normal
      const fn = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i));
      const en = new THREE.Vector3(q.x / hw, q.y / hh, q.z / hd).normalize();
      fn.lerp(en, Math.min(1, round * 1.3)).normalize();
      n.setXYZ(i, fn.x, fn.y, fn.z);
    }
  }
  g.userData.seg = seg;
  return g;
}

// Canvas-space rect (origin top-left, 0..1) -> UV rect, accounting for flipY. (SO2 player.js)
export const q = (x, y, w, h) => [x, 1 - (y + h), x + w, 1 - y];
// Atlas layout (512x256): face front = left half; right half = 2x2 of side/back/top/bottom.
export const UV = { F: q(0, 0, .5, 1), S: q(.5, 0, .25, .5), B: q(.75, 0, .25, .5), T: q(.5, .5, .25, .5), N: q(.75, .5, .25, .5) };
// BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z.
export const HEAD_FACES = [UV.S, UV.S, UV.T, UV.N, UV.F, UV.B];

export function mapBoxUV(geo, faces) {
  const seg = geo.userData.seg || 1, per = (seg + 1) * (seg + 1), uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = faces[f];
    for (let i = 0; i < per; i++) {
      const k = f * per + i;
      uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
    }
  }
  uv.needsUpdate = true;
  return geo;
}

// Scale X (and optionally Y) linearly along Z: back gets fb, front gets ff. Wedges, noses.
export function taper(geo, fb, ff, yb = 1, yf = 1) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox, p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getZ(i) - min.z) / (max.z - min.z || 1);
    p.setX(i, p.getX(i) * (fb + (ff - fb) * t));
    p.setY(i, p.getY(i) * (yb + (yf - yb) * t));
  }
  geo.computeVertexNormals();
  return geo;
}

// Flat star / flower / paw decals are Shape geometries lying in the XY plane.
export function starGeo(r, inner = .45, pts = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < pts * 2; i++) {
    const rr = i % 2 ? r * inner : r, a = Math.PI / 2 + i * Math.PI / pts;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  return new THREE.ExtrudeGeometry(s, { depth: .02, bevelEnabled: false });
}

/* ------------------------------------------------------------------ merging */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(),
  _p = new THREE.Vector3(), _c = new THREE.Color();

// Collects primitives for ONE rigid part; build() emits one mesh per material.
export class Mesher {
  constructor() { this.lists = new Map(); }
  add(mat, geo, color = 0xffffff, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ')),
      typeof scale === 'number' ? _s.setScalar(scale) : _s.set(scale[0], scale[1], scale[2]));
    geo.applyMatrix4(_m);
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push({ geo, color });
    return geo;
  }
  build(group, { shadow = true } = {}) {
    const out = [];
    for (const [mat, list] of this.lists) {
      const mesh = new THREE.Mesh(mergeColored(list), mat);
      mesh.castShadow = shadow; mesh.receiveShadow = false;
      group.add(mesh); out.push(mesh);
    }
    this.lists.clear();
    return out;
  }
}

function mergeColored(list) {
  let nv = 0, ni = 0;
  for (const { geo } of list) { nv += geo.attributes.position.count; ni += geo.index ? geo.index.count : geo.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const { geo, color } of list) {
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, n = P.count;
    if (!N) geo.computeVertexNormals();
    const NN = geo.attributes.normal;
    _c.set(color);
    for (let i = 0; i < n; i++) {
      pos.set([P.getX(i), P.getY(i), P.getZ(i)], (vo + i) * 3);
      nor.set([NN.getX(i), NN.getY(i), NN.getZ(i)], (vo + i) * 3);
      if (U) uv.set([U.getX(i), U.getY(i)], (vo + i) * 2);
      col.set([_c.r, _c.g, _c.b], (vo + i) * 3);
    }
    if (geo.index) { const I = geo.index.array; for (let i = 0; i < I.length; i++) idx[io++] = I[i] + vo; }
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n;
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/* ------------------------------------------------------------------ face atlases */
// 512x256. Left half = face front (drawn in 0..1 of that square via fx/fy helpers);
// right half = side (top-left), back (top-right), top (bottom-left), bottom (bottom-right).
const atlasCache = new Map();
export function faceAtlas(id) {
  if (atlasCache.has(id)) return atlasCache.get(id);
  const W = 512, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  // region painters: coordinates in 0..1 of the region
  const region = (x0, y0, w, h) => ({
    rect: (x, y, ww, hh, c) => { g.fillStyle = c; g.fillRect(x0 + x * w, y0 + y * h, ww * w, hh * h); },
    ell: (x, y, rx, ry, c, rot = 0) => { g.fillStyle = c; g.beginPath(); g.ellipse(x0 + x * w, y0 + y * h, rx * w, ry * h, rot, 0, Math.PI * 2); g.fill(); },
    line: (pts, c, lw) => { g.strokeStyle = c; g.lineWidth = lw * w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      pts.forEach(([x, y], i) => i ? g.lineTo(x0 + x * w, y0 + y * h) : g.moveTo(x0 + x * w, y0 + y * h)); g.stroke(); },
    poly: (pts, c) => { g.fillStyle = c; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x0 + x * w, y0 + y * h) : g.moveTo(x0 + x * w, y0 + y * h)); g.closePath(); g.fill(); },
    arc: (x, y, r, a0, a1, c, lw) => { g.strokeStyle = c; g.lineWidth = lw * w; g.lineCap = 'round'; g.beginPath(); g.arc(x0 + x * w, y0 + y * h, r * w, a0, a1); g.stroke(); },
    fill: c => { g.fillStyle = c; g.fillRect(x0, y0, w, h); },
  });
  const F = region(0, 0, 256, 256), S = region(256, 0, 128, 128), B = region(384, 0, 128, 128),
    T = region(256, 128, 128, 128), N = region(384, 128, 128, 128);
  (FACES[id] || FACES.orion)(F, S, B, T, N);
  atlasCache.set(id, cv);
  return cv;
}

// Cartoon eye: white, iris, pupil, glint. Big and round reads at 40px.
function eye(R, x, y, rx, ry, iris, look = 0) {
  R.ell(x, y, rx, ry, '#ffffff');
  R.ell(x + look * rx * .3, y + ry * .1, rx * .62, ry * .66, iris);
  R.ell(x + look * rx * .3, y + ry * .1, rx * .34, ry * .38, '#141018');
  R.ell(x + look * rx * .3 - rx * .22, y - ry * .18, rx * .2, ry * .2, '#ffffff');
}

const FACES = {
  // Orion — straight from SO2 art.js orionAtlas (head front quadrant, scaled 2x), plus a bit
  // more hair on the back because the chase camera only ever sees the back of his head.
  orion(F, S, B, T, N) {
    const SKIN = '#f7cfa6', HAIR = '#3a2a1c';
    F.fill(SKIN);
    F.rect(0, 0, 1, .24, HAIR);                                  // fringe
    F.poly([[0, .22], [.22, .22], [.12, .32], [0, .4]], HAIR);    // side-burn tufts
    F.poly([[1, .22], [.78, .22], [.88, .32], [1, .4]], HAIR);
    F.poly([[.3, .22], [.42, .31], [.5, .22]], HAIR);            // a flick of fringe
    eye(F, .31, .45, .11, .12, '#5a3a22', .2); eye(F, .69, .45, .11, .12, '#5a3a22', .2);
    F.line([[.2, .3], [.38, .28]], HAIR, .035); F.line([[.62, .28], [.8, .3]], HAIR, .035); // brows
    F.ell(.17, .62, .08, .05, '#ffab9a'); F.ell(.83, .62, .08, .05, '#ffab9a');         // cheeks
    F.poly([[.34, .66], [.66, .66], [.6, .76], [.5, .79], [.4, .76]], '#8a2f2a');        // grin
    F.rect(.38, .66, .24, .035, '#ffffff');                       // teeth
    S.fill('#f2c69c'); S.rect(0, 0, 1, .48, HAIR); S.ell(.5, .6, .13, .16, '#e8b98e');   // hair wrap + ear
    B.fill('#f2c69c'); B.rect(0, 0, 1, .7, HAIR); B.poly([[0, .7], [.2, .82], [.4, .7], [.6, .84], [.8, .7], [1, .8], [1, .7]], HAIR);
    T.fill(HAIR); N.fill('#e8b98e');
  },
  // Sootie — SO2 SYMBOL.life: #2b2431 body, mint #8ff0b4 eyes with slit pupils, pink nose,
  // white whiskers. SO1 gave her a white chest (that's on the torso).
  sootie(F, S, B, T, N) {
    const FUR = '#2b2431';
    F.fill(FUR);
    F.ell(.5, .72, .3, .2, '#3b3345');                            // muzzle, a shade lighter
    for (const x of [.3, .7]) {
      F.ell(x, .44, .14, .17, '#8ff0b4');
      F.ell(x, .45, .04, .14, '#141018');
      F.ell(x - .05, .37, .035, .04, '#ffffff');
    }
    F.poly([[.5, .7], [.44, .63], [.56, .63]], '#ff9db0');         // nose
    F.line([[.43, .76], [.47, .79], [.5, .75], [.53, .79], [.57, .76]], '#e8e0f0', .02); // w-mouth
    for (const s of [-1, 1]) for (const dy of [-.03, .03]) F.line([[.5 + s * .16, .7 + dy], [.5 + s * .48, .66 + dy * 2.2]], '#ffffff', .014);
    S.fill(FUR); B.fill(FUR); T.fill(FUR); N.fill('#3b3345');
  },
  // King Dad — SO2 world.js king: skin #f0c9a0, bald, short black beard #241a14, heavy brows.
  kingdad(F, S, B, T, N) {
    const SKIN = '#f0c9a0', BEARD = '#241a14';
    F.fill(SKIN);
    // short beard: jaw band + moustache framing a big smile
    F.poly([[0, .52], [.14, .6], [.3, .68], [.7, .68], [.86, .6], [1, .52], [1, 1], [0, 1]], BEARD);
    F.poly([[.26, .66], [.5, .6], [.74, .66], [.66, .7], [.34, .7]], BEARD);           // moustache
    F.poly([[.34, .74], [.66, .74], [.6, .84], [.5, .87], [.4, .84]], '#8a2f2a');        // smile
    F.rect(.36, .74, .28, .04, '#ffffff');
    eye(F, .3, .38, .1, .11, '#3a2a1c', 0); eye(F, .7, .38, .1, .11, '#3a2a1c', 0);
    F.poly([[.16, .25], [.44, .21], [.44, .27], [.18, .31]], BEARD);                    // big brows
    F.poly([[.84, .25], [.56, .21], [.56, .27], [.82, .31]], BEARD);
    F.ell(.14, .54, .07, .045, '#f2a08c'); F.ell(.86, .54, .07, .045, '#f2a08c');
    F.ell(.5, .06, .18, .03, 'rgba(255,255,255,.35)');                                  // bald shine
    S.fill(SKIN); S.poly([[0, .55], [1, .45], [1, 1], [0, 1]], BEARD); S.ell(.45, .45, .12, .15, '#e5b48a');
    B.fill(SKIN); B.rect(0, .82, 1, .18, BEARD);
    T.fill(SKIN); T.ell(.4, .4, .18, .12, 'rgba(255,255,255,.35)'); N.fill(BEARD);
  },
  // Mum (Gemma) — SO1 MUM_FRAMES: long brown hair #4a2c14 framing the face, skin #ffd9b3.
  mum(F, S, B, T, N) {
    const SKIN = '#ffd9b3', HAIR = '#5a3518';
    F.fill(SKIN);
    F.poly([[0, 0], [1, 0], [1, .5], [.86, .3], [.62, .24], [.3, .2], [.14, .3], [0, .5]], HAIR);   // side-swept fringe
    F.rect(0, 0, .08, 1, HAIR); F.rect(.92, 0, .08, 1, HAIR);
    for (const x of [.32, .68]) {
      eye(F, x, .47, .1, .11, '#3f6f5a', 0);
      const s = x < .5 ? -1 : 1;
      F.line([[x + s * .06, .37], [x + s * .13, .33]], '#2a1a10', .022);                   // lashes
      F.line([[x + s * .09, .4], [x + s * .15, .38]], '#2a1a10', .018);
    }
    F.ell(.2, .62, .07, .045, '#ff9fb0'); F.ell(.8, .62, .07, .045, '#ff9fb0');
    F.poly([[.37, .7], [.63, .7], [.57, .78], [.5, .8], [.43, .78]], '#c9486a');           // smile
    F.rect(.4, .7, .2, .03, '#ffffff');
    S.fill(HAIR); B.fill(HAIR); T.fill(HAIR); N.fill(SKIN);
  },
  // Grumbles — SO2 grumblin: green #4caf50 box with big white eyes. Grumpy, not scary: the
  // brows are cross, the mouth is a wobbly pout with one tooth.
  grumblin(F, S, B, T, N) {
    const G = '#4caf50', D = '#2e7d32';
    F.fill(G);
    for (const x of [.3, .7]) {
      F.ell(x, .34, .13, .15, '#ffffff'); F.ell(x + .02, .37, .06, .07, '#1a1a1a'); F.ell(x - .01, .34, .02, .02, '#ffffff');
    }
    F.poly([[.14, .16], [.44, .24], [.42, .3], [.14, .22]], '#1f4d24');
    F.poly([[.86, .16], [.56, .24], [.58, .3], [.86, .22]], '#1f4d24');
    F.line([[.36, .62], [.44, .58], [.5, .61], [.56, .58], [.64, .62]], '#1f4d24', .035);
    F.poly([[.46, .6], [.52, .605], [.49, .66]], '#ffffff');                            // one tooth
    F.ell(.2, .52, .06, .04, '#7cc97f'); F.ell(.8, .52, .06, .04, '#7cc97f');
    for (const R of [S, B, T]) { R.fill(G); R.ell(.3, .3, .12, .1, D); R.ell(.7, .65, .1, .12, D); R.ell(.25, .8, .07, .06, D); }
    N.fill(D);
  },
  // Prickles — SO2 prickle (brown #6d4c41, cream spikes) as a ball with a cream face patch.
  prickle(F, S, B, T, N) {
    const BR = '#6d4c41', CR = '#f7eccb';
    F.fill(BR);
    F.ell(.5, .6, .4, .36, CR);
    for (const x of [.34, .66]) { F.ell(x, .5, .08, .1, '#1a1210'); F.ell(x - .025, .46, .025, .03, '#ffffff'); }
    F.ell(.5, .66, .07, .05, '#ff8fa6');
    F.arc(.5, .66, .12, .35, Math.PI - .35, '#5c3a1a', .025);
    F.ell(.24, .66, .06, .04, '#ffb3b3'); F.ell(.76, .66, .06, .04, '#ffb3b3');
    S.fill(BR); B.fill(BR); T.fill(BR); N.fill(CR);
  },
};
