// trackmesh.js — track model (track.js) → three.js meshes. Core owns; tracks agents extend.
//
// Everything static is merged per material: road, shoulders (per offroad surface), kerbs,
// walls, terrain, water, sky, start arch, pads, start-line decal ≈ a dozen draw calls.
// Textures come from assets/tex/<name>.(jpg|png|webp) when the art agent has made them and fall
// back to procedural canvas textures instantly, so nothing ever waits on (or breaks for) art.
//
// Scenery: if src/scenery/<theme>.js exists its default export is called with a context
// (see DESIGN.md "Scenery hook"); a missing file is fine.

import * as THREE from 'three';
import { bankY } from './track.js';

const TEX_BASE = new URL('../assets/tex/', import.meta.url).href;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* =============================================================== textures */
const texCache = new Map();
/**
 * A texture that exists immediately (procedural canvas) and upgrades itself to
 * assets/tex/<name>.jpg|png|webp if the file loads. Never throws, never blocks.
 */
export function loadTex(name, fallback, { repeat = null, srgb = true, anisotropy = 8, file = true, onload = null } = {}) {
  const key = name + (repeat ? repeat.join('x') : '');
  if (texCache.has(key)) return texCache.get(key);
  const canvas = (fallback || PROC[name] || PROC.checker)();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.userData.procedural = true;
  texCache.set(key, tex);
  if (name && file && typeof Image !== 'undefined') {
    const exts = ['jpg', 'png'];
    const tryExt = i => {
      if (i >= exts.length) return;
      const img = new Image();
      // dispose first: the GPU storage was sized for the canvas, a bigger image can't be sub-uploaded into it
      img.onload = () => { tex.dispose(); tex.image = img; tex.needsUpdate = true; tex.userData.procedural = false; tex.userData.src = img.src; onload?.(tex); };
      img.onerror = () => tryExt(i + 1);
      img.src = `${TEX_BASE}${name}.${exts[i]}`;
    };
    tryExt(0);
  }
  return tex;
}

function cv(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h); return c;
}
function noise(g, w, h, n, cols, rmin = 1, rmax = 3, alpha = 0.35) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * Math.random();
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    const r = rmin + Math.random() * (rmax - rmin);
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}
/** Procedural fallbacks. Keep them BRIGHT: a textured material multiplies colour by texture luma. */
export const PROC = {
  checker: () => cv(64, 64, (g) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) & 1 ? '#222' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } }),
  road: () => cv(256, 256, (g, w, h) => {
    g.fillStyle = '#9a9aa2'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 2600, ['#7c7c86', '#b4b4bc', '#8a8a92', '#a8a0a0'], 0.6, 1.8, 0.5);
  }),
  road_beach: () => cv(256, 256, (g, w, h) => {
    g.fillStyle = '#c9b89a'; g.fillRect(0, 0, w, h);                // sandy packed road
    noise(g, w, h, 2400, ['#b09c7c', '#dccbaa', '#bfae90', '#a89478'], 0.6, 2.2, 0.5);
  }),
  sand: () => cv(256, 256, (g, w, h) => {
    g.fillStyle = '#f2dfae'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 3000, ['#e6cf96', '#fff1cc', '#dcc38a', '#f7e6bb'], 0.5, 1.6, 0.55);
  }),
  grass: () => cv(256, 256, (g, w, h) => {
    g.fillStyle = '#86c95c'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 3000, ['#6fb24a', '#9ad86c', '#78bd52', '#a6e07a'], 0.6, 2, 0.55);
  }),
  snow: () => cv(256, 256, (g, w, h) => { g.fillStyle = '#f4f8ff'; g.fillRect(0, 0, w, h); noise(g, w, h, 2000, ['#dfe8f7', '#ffffff', '#e8eefa'], 0.6, 2, 0.5); }),
  dirt: () => cv(256, 256, (g, w, h) => { g.fillStyle = '#b08a60'; g.fillRect(0, 0, w, h); noise(g, w, h, 2600, ['#98744c', '#c49a6c', '#a57f56'], 0.6, 2, 0.55); }),
  rock: () => cv(256, 256, (g, w, h) => { g.fillStyle = '#8d8478'; g.fillRect(0, 0, w, h); noise(g, w, h, 2600, ['#6f675d', '#a39a8e', '#7d7469'], 1, 4, 0.5); }),
  water: () => cv(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,220,235,.9)'; g.lineWidth = 2;
    for (let i = 0; i < 40; i++) { const x = Math.random() * w, y = Math.random() * h, r = 6 + Math.random() * 18; g.beginPath(); g.ellipse(x, y, r, r * 0.45, Math.random() * 3, 0, 5); g.stroke(); }
  }),
  pad: () => cv(128, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ff9d00'); gr.addColorStop(1, '#ffe14a');
    g.fillStyle = '#ff5a1f'; g.fillRect(0, 0, w, h);
    g.fillStyle = gr;
    for (let i = 0; i < 2; i++) {             // two chevrons pointing +v (forward)
      const y0 = i * h / 2 + h * 0.08;
      g.beginPath(); g.moveTo(w * 0.1, y0 + h * 0.18); g.lineTo(w / 2, y0 + h * 0.4); g.lineTo(w * 0.9, y0 + h * 0.18);
      g.lineTo(w * 0.9, y0 + h * 0.06); g.lineTo(w / 2, y0 + h * 0.28); g.lineTo(w * 0.1, y0 + h * 0.06); g.closePath(); g.fill();
    }
  }),
  banner: () => cv(512, 128, (g, w, h) => {
    const sq = 16;
    for (let y = 0; y < h; y += sq) for (let x = 0; x < w; x += sq) { g.fillStyle = ((x + y) / sq) & 1 ? '#111' : '#fff'; g.fillRect(x, y, sq, sq); }
    g.fillStyle = '#ffd23f'; g.fillRect(64, 22, w - 128, h - 44);
    g.strokeStyle = '#c22532'; g.lineWidth = 6; g.strokeRect(64, 22, w - 128, h - 44);
    g.fillStyle = '#c22532'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // fit the text inside the yellow panel (a fixed 54px spilled 'O' and 'G' onto the checkers)
    let fs = 54; g.font = `900 ${fs}px system-ui, sans-serif`;
    while (fs > 20 && g.measureText('ORION RACING').width > w - 128 - 24) { fs -= 2; g.font = `900 ${fs}px system-ui, sans-serif`; }
    g.fillText('ORION RACING', w / 2, h / 2 + 3);
  }),
  startline: () => cv(128, 32, (g, w, h) => { const sq = 16; for (let y = 0; y < h; y += sq) for (let x = 0; x < w; x += sq) { g.fillStyle = ((x + y) / sq) & 1 ? '#111' : '#fff'; g.fillRect(x, y, sq, sq); } }),
};

/* =============================================================== themes */
/** Per-theme defaults; a track's `env` / `tex` / `terrain` override. Tracks agents: add yours. */
export const THEMES = {
  beach: { road: 'road_beach', ground: 'sand', grass: 'grass', fog: 0xc4ecff, skyTop: 0x2f8fe8, skyHorizon: 0xbfeaff },
  default: { road: 'road', ground: 'grass', grass: 'grass', fog: 0xcfe6ff, skyTop: 0x3b86d8, skyHorizon: 0xd6ecff },
  ice: { road: 'road_ice', ground: 'snow', grass: 'snow', fog: 0xf2c4d0, skyTop: 0xc58fd8, skyHorizon: 0xffc9d6 },
  volcano: { road: 'road_volcano', ground: 'rock_volcanic', grass: 'rock_volcanic', fog: 0xe89a6a, skyTop: 0x7a3a5a, skyHorizon: 0xffb070 },
};
/** Wall styles: [colour A, colour B (alternating every `seg` m), height, seg]. */
export const WALLS = {
  fence: [0xffffff, 0xe0332c, 1.0, 3],
  beach: [0xffffff, 0x1fa7d6, 1.0, 3],
  wood: [0xa0703f, 0x8a5c30, 1.1, 2],
  rock: [0x8a8076, 0x6f675d, 1.6, 5],
  ice: [0xdff4ff, 0xa9dcf5, 1.2, 4],
  castle: [0xb8b0a4, 0x9a9286, 2.2, 4],
  neon: [0xff4fd8, 0x4fe3ff, 0.9, 2],
  candy: [0xffffff, 0xe8374a, 1.1, 1.6],     // candy-cane barrier (Ice Cream Peaks)
  waffle: [0xe8b36a, 0xd29546, 1.4, 2.5],    // waffle-cone cliff edge
  wafer: [0xffe08a, 0xf5a8c0, 1.2, 1.2],     // pink/yellow wafer bridge rail
  chili: [0xffc21f, 0xe0332c, 1.1, 2],       // hazard stripes by the lava (Taco Volcano)
  basalt: [0x8a6a5e, 0x77584e, 1.7, 5],      // warm volcanic rock
};

/* =============================================================== build */
/**
 * @returns {Promise<{group, update(dt,t), groundAt(x,z), isClear(x,z,r), stats, env}>}
 */
export async function buildTrackMesh(track, { scene } = {}) {
  const def = track.def, theme = THEMES[track.theme] || THEMES.default;
  const env = { ...theme, ...(def.env || {}) };
  const texNames = { road: theme.road, ground: theme.ground, grass: theme.grass, ...(def.tex || {}) };
  const group = new THREE.Group(); group.name = 'track:' + track.id;
  const n = track.n, X = track.X, Y = track.Y, Z = track.Z, HW = track.HW, TB = track.TB;
  const lxA = k => track.TZ[k], lzA = k => -track.TX[k];
  const isGap = k => (track.FLAG[(k + n) % n] & 1) !== 0;
  const P = (k, lat, dy = 0) => { k = (k + n) % n; return [X[k] + lxA(k) * lat, bankY(Y[k], lat, HW[k], TB[k]) + dy, Z[k] + lzA(k) * lat]; };
  const updaters = [];

  // ------------------------------------------------ ribbon helper
  // Builds a strip along the loop between lat a(k) and b(k), skipping gap samples.
  function ribbon({ a, b, dy = 0, u0 = 0, u1 = 1, vScale = 1 / 16, keep = () => true, color = null, cols = 1 }) {
    const pos = [], uv = [], col = [], idx = [];
    let prevOk = false, base = 0;
    for (let j = 0; j <= n; j++) {
      const k = j % n;
      const ok = keep(k) && !isGap(k);
      if (!ok) { prevOk = false; continue; }
      const la = a(k), lb = b(k), v = j * track.ds * vScale;
      const start = pos.length / 3;
      for (let c = 0; c <= cols; c++) {
        const lat = la + (lb - la) * c / cols;
        pos.push(...P(k, lat, dy)); uv.push(u0 + (u1 - u0) * c / cols, v);
        if (color) { const cc = color(k, c / cols, j); col.push(cc.r, cc.g, cc.b); }
      }
      if (prevOk) for (let c = 0; c < cols; c++) {
        const p0 = base + c, p1 = start + c;
        idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
      }
      prevOk = true; base = start;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  // note on winding: a left→right strip walked forward faces +Y when lat a > lat b (left first).

  // ------------------------------------------------ road
  const roadTex = loadTex(texNames.road, null);
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // a real (tileable, line-free) road texture tiles every ROAD_TILE m; the procedural one spans the width
  const ROAD_TILE = 6;
  const roadGeo = ribbon({ a: k => HW[k], b: k => -HW[k], cols: 2, vScale: 1 / ROAD_TILE, u1: HW[0] * 2 / ROAD_TILE });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true; road.name = 'road';
  group.add(road);

  // ------------------------------------------------ shoulders (offroad strips), one mesh per surface
  const surfSet = new Set();
  for (let k = 0; k < n; k++) { surfSet.add(track.props[k].surfL); surfSet.add(track.props[k].surfR); }
  const groundTexName = texNames.ground;
  for (const surf of surfSet) {
    const tex = loadTex(texNames[surf] || surf, PROC[surf] || PROC.sand);
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const vs = 1 / 8;
    const gL = ribbon({ a: k => HW[k] + track.OFFL[k] + 0.5, b: k => HW[k] - 0.2, vScale: vs, u0: 0, u1: (track.OFFL[0] + 0.7) / 8, keep: k => track.props[k].surfL === surf && track.OFFL[k] > 0 });
    const gR = ribbon({ a: k => -HW[k] + 0.2, b: k => -HW[k] - track.OFFR[k] - 0.5, vScale: vs, u0: 0, u1: (track.OFFR[0] + 0.7) / 8, keep: k => track.props[k].surfR === surf && track.OFFR[k] > 0 });
    for (const g of [gL, gR]) { if (!g.index.count) continue; const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = 'shoulder:' + surf; group.add(m); }
  }

  // ------------------------------------------------ kerbs (red/white rumble strips) on tight corners
  {
    const kerbOn = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const kp = track.props[k].kerb;
      if (kp === true) kerbOn[k] = 1;
      else if (kp === 'auto' || kp == null) {
        let m = 0; for (let j = -6; j <= 6; j++) m = Math.max(m, Math.abs(track.CURV[(k + j + n) % n]));
        if (m > 1 / 55) kerbOn[k] = 1;
      }
    }
    const red = new THREE.Color(0xe0332c), white = new THREE.Color(0xffffff);
    const colr = (k, c, j) => (Math.floor(j * track.ds / 2.5) & 1) ? red : white;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const geos = [];
    const lineC = () => white;
    for (const side of [1, -1]) {
      geos.push(side > 0
        ? ribbon({ a: k => HW[k] + 0.9, b: k => HW[k] - 0.15, dy: 0.05, keep: k => kerbOn[k], color: colr })
        : ribbon({ a: k => -HW[k] + 0.15, b: k => -HW[k] - 0.9, dy: 0.05, keep: k => kerbOn[k], color: colr }));
      // painted edge line where there's no kerb
      geos.push(side > 0
        ? ribbon({ a: k => HW[k] - 0.45, b: k => HW[k] - 0.8, dy: 0.02, keep: k => !kerbOn[k], color: lineC })
        : ribbon({ a: k => -HW[k] + 0.8, b: k => -HW[k] + 0.45, dy: 0.02, keep: k => !kerbOn[k], color: lineC }));
    }
    const m = new THREE.Mesh(mergeGeos(geos.filter(g => g.index.count)), mat); m.receiveShadow = true; m.name = 'kerbs+lines'; group.add(m);
  }

  // ------------------------------------------------ walls along the boundary
  {
    const pos = [], col = [], idx = [];
    const cA = new THREE.Color(), cB = new THREE.Color();
    for (const side of [1, -1]) {
      let prev = null;
      for (let j = 0; j <= n; j++) {
        const k = j % n;
        const style = side > 0 ? track.props[k].wallL : track.props[k].wallR;
        const W = WALLS[style];
        if (!W || isGap(k)) { prev = null; continue; }
        const off = side > 0 ? track.OFFL[k] : track.OFFR[k];
        const lat = side * (HW[k] + off + 0.15);
        const base = P(k, lat, -0.4), top = P(k, lat, W[2]);
        const outB = P(k, lat + side * 0.35, -0.4), outT = P(k, lat + side * 0.35, W[2]);
        const stripe = Math.floor(j * track.ds / W[3]) & 1;
        cA.set(stripe ? W[1] : W[0]);
        const s0 = pos.length / 3;
        pos.push(...base, ...top, ...outT, ...outB);
        for (let q = 0; q < 4; q++) col.push(cA.r, cA.g, cA.b);
        if (prev != null) {
          // inner face (faces the road), top, outer face
          const a = prev, b = s0;
          if (side > 0) { idx.push(a, a + 1, b, b, a + 1, b + 1); idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2); idx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3); }
          else { idx.push(a, b, a + 1, b, b + 1, a + 1); idx.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2); idx.push(a + 2, b + 2, a + 3, b + 2, b + 3, a + 3); }
        }
        prev = s0;
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      m.castShadow = true; m.receiveShadow = true; m.name = 'walls';
      group.add(m);
    }
  }

  // ------------------------------------------------ gap faces: the ramp's lip and the landing's front
  {
    const pos = [], idx = [];
    const wy = track.water ? track.water.y - 1 : track.gapFloor;
    for (const gp of track.gaps) {
      for (const [s, facing] of [[gp.s0 - track.ds * 0.5, 1], [gp.s0 + gp.len + track.ds * 0.5, -1]]) {
        const k = track.idx(s);
        const hw = HW[k] + Math.max(track.OFFL[k], track.OFFR[k]) + 0.5;
        const a = P(k, hw), b = P(k, -hw);
        const i0 = pos.length / 3;
        pos.push(...a, ...b, a[0], wy, a[2], b[0], wy, b[2]);
        if (facing > 0) idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); else idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xb8875a, side: THREE.DoubleSide }));
      m.name = 'gapfaces'; m.receiveShadow = true; group.add(m);
    }
  }

  // ------------------------------------------------ terrain heightfield
  const T = def.terrain || {};
  const water = track.water;
  const B = track.bounds, M = 170, CELL = def.terrain?.cell ?? 4.5;
  const x0 = B.minX - M, z0 = B.minZ - M, nx = Math.ceil((B.maxX - B.minX + 2 * M) / CELL) + 1, nz = Math.ceil((B.maxZ - B.minZ + 2 * M) / CELL) + 1;
  const H = new Float32Array(nx * nz);
  const baseH = T.base ?? 0, shore = T.shore ?? Infinity, dunes = T.dunes ?? 1;
  const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // terrain.hills: [{x, z, r, h, color?}] — smooth cos² domes added to the natural ground (mountains the
  // road climbs / cuts through; the corridor still flattens under the road). `color` tints the dome.
  const hills = T.hills || [];
  const hillK = (hl, x, z) => { const d = Math.hypot(x - hl.x, z - hl.z) / hl.r; return d >= 1 ? 0 : Math.cos(d * Math.PI / 2) ** 2; };
  const natural = (x, z) => {
    let h = baseH + dunes * (vnoise(x / 38, z / 38) * 1.2 + vnoise(x / 13, z / 13) * 0.35 - 0.7);
    for (const hl of hills) h += hl.h * hillK(hl, x, z);
    return h;
  };
  const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
  const carveDepth = (x, z) => {                 // how far below water level to push the ground (0 = no carve)
    let d = 0;
    for (const c of T.carve || []) {
      if (c.type === 'lake') { const r = Math.hypot(x - c.x, z - c.z); d = Math.max(d, (c.depth ?? 3) * (1 - smooth(c.r * 0.55, c.r, r))); }
      else if (c.type === 'channel') {
        let m = Infinity; for (let i = 0; i + 1 < c.pts.length; i++) m = Math.min(m, segDist(x, z, c.pts[i][0], c.pts[i][1], c.pts[i + 1][0], c.pts[i + 1][1]));
        d = Math.max(d, (c.depth ?? 3) * (1 - smooth(c.w * 0.3, c.w * 0.5 + 6, m)));
      }
    }
    return d;
  };
  // nearest centre-line sample per vertex (coarse global, then refine)
  // `raised` stretches (inherited prop) are skipped for the TERRAIN: the ground stays natural under a
  // castle wall top / sky bridge instead of rising into an embankment; scenery builds what holds it up.
  const raisedA = new Uint8Array(n); let anyRaised = false;
  for (let k = 0; k < n; k++) if (track.props[k].raised) { raisedA[k] = 1; anyRaised = true; }
  const near = (x, z, skipRaised = false) => {
    const skip = skipRaised && anyRaised;
    let best = -1, bd = Infinity;
    for (let k = 0; k < n; k += 3) { if (skip && raisedA[k]) continue; const dx = x - X[k], dz = z - Z[k], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = k; } }
    if (best < 0) return near(x, z);
    for (let j = -3; j <= 3; j++) { const k = (best + j + n) % n; if (skip && raisedA[k]) continue; const dx = x - X[k], dz = z - Z[k], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = k; } }
    return best;
  };
  const corridorInfo = (x, z, skipRaised = false) => {
    const k = near(x, z, skipRaised);
    const lat = (x - X[k]) * lxA(k) + (z - Z[k]) * lzA(k);
    const lim = HW[k] + (lat > 0 ? track.OFFL[k] : track.OFFR[k]);
    // past the END of the nearest sample (only happens next to skipped `raised` samples — under a bridge):
    // distance along the road counts too, else the ground under a bridge snaps up to the approach's height
    const along = Math.abs((x - X[k]) * track.TX[k] + (z - Z[k]) * track.TZ[k]) - track.ds;
    return { k, lat, e: Math.max(Math.abs(lat) - lim, along), planeY: bankY(Y[k], lat, HW[k], TB[k]), gap: isGap(k) };
  };
  const t0 = performance.now();
  const noTerrain = def.terrain === false;      // `terrain: false` = no ground at all (Star Road floats in space)
  if (noTerrain) H.fill(-1e4);
  else for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = x0 + ix * CELL, z = z0 + iz * CELL;
    const ci = corridorInfo(x, z, true);
    let h = natural(x, z);
    const edgeY = bankY(Y[ci.k], Math.sign(ci.lat) * 1e3, HW[ci.k], TB[ci.k]);
    if (!ci.gap) {
      if (ci.e < 0.6) h = ci.planeY - 0.45;                        // under the shoulders: hidden, never pokes through
      else h = edgeY - 0.3 + (h - edgeY + 0.3) * smooth(0, 22, ci.e);
    }
    if (water) {
      if (ci.e > shore) h = Math.min(h, h - (ci.e - shore) * 0.12);
      const cd = carveDepth(x, z);
      if (cd > 0 && (ci.gap || ci.e > 1)) h = Math.min(h, water.y - cd * smooth(0, 1, cd / 3) + (h - water.y) * (1 - smooth(0, 1.5, cd)));
      if (ci.gap) h = Math.min(h, water.y - 2);
    }
    H[iz * nx + ix] = h;
  }
  const terrainMs = performance.now() - t0;
  const groundAtGrid = (x, z) => {
    const fx = clamp((x - x0) / CELL, 0, nx - 1.001), fz = clamp((z - z0) / CELL, 0, nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = H[iz * nx + ix], b = H[iz * nx + ix + 1], c = H[(iz + 1) * nx + ix], d = H[(iz + 1) * nx + ix + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
  if (!noTerrain) {
    const g = new THREE.PlaneGeometry((nx - 1) * CELL, (nz - 1) * CELL, nx - 1, nz - 1);
    g.rotateX(-Math.PI / 2);
    const pa = g.attributes.position, colors = new Float32Array(pa.count * 3);
    // terrain.colors: { ground, wet, deep } override the beach defaults (vertex tints × the ground texture)
    const TC = T.colors || {};
    const sandC = new THREE.Color(TC.ground ?? 0xfff4d6), grassC = new THREE.Color(T.grass?.color ?? 0x8fd06a), wetC = new THREE.Color(TC.wet ?? 0xd9c08a), deepC = new THREE.Color(TC.deep ?? 0x3aa6a0), tmp = new THREE.Color();
    const grassAbove = T.grass?.above ?? Infinity;
    const hillC = hills.map(hl => hl.color != null ? new THREE.Color(hl.color) : null);
    for (let i = 0; i < pa.count; i++) {
      // after rotateX(-90°) PlaneGeometry row 0 sits at the smallest z: same layout as H
      const ix = i % nx, iz = Math.floor(i / nx);
      const x = x0 + ix * CELL, z = z0 + iz * CELL;
      const h = H[iz * nx + ix];
      pa.setXYZ(i, x, h, z);
      tmp.copy(sandC);
      if (h > grassAbove) tmp.lerp(grassC, smooth(grassAbove, grassAbove + 0.8, h));
      for (let j = 0; j < hills.length; j++) if (hillC[j]) tmp.lerp(hillC[j], smooth(0.08, 0.35, hillK(hills[j], x, z)));
      if (water) {
        tmp.lerp(wetC, 1 - smooth(water.y + 0.2, water.y + 1.2, h));
        tmp.lerp(deepC, 1 - smooth(water.y - 2.5, water.y - 0.2, h));
      }
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // uv in metres/8 so the ground texture tiles at a sane scale
    const uva = g.attributes.uv;
    for (let i = 0; i < pa.count; i++) uva.setXY(i, pa.getX(i) / 9, pa.getZ(i) / 9);
    g.computeVertexNormals();
    const tex = loadTex(groundTexName, null);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
    m.receiveShadow = true; m.name = 'terrain';
    group.add(m);
  }

  // ------------------------------------------------ water
  if (water) {
    let mat;
    const tex = loadTex(def.tex?.water || 'water', PROC.water, { repeat: [220, 220], onload: () => { mat.color.set(water.tint ?? 0xffffff); } });
    mat = new THREE.MeshPhongMaterial({ color: tex.userData.procedural ? (water.color ?? 0x22c7d8) : (water.tint ?? 0xffffff), map: tex, transparent: true, opacity: 0.8, shininess: 90, specular: 0x9fe8ff, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mat);
    m.rotation.x = -Math.PI / 2; m.position.set((B.minX + B.maxX) / 2, water.y, (B.minZ + B.maxZ) / 2);
    m.name = 'water'; m.renderOrder = 1; group.add(m);
    updaters.push((dt, t) => { tex.offset.set(t * 0.004, t * 0.0025); });
  }

  // ------------------------------------------------ sky dome
  {
    const g = new THREE.SphereGeometry(1800, 24, 12);
    let mat;
    if (env.sky) {
      // env.sky = '<tex name>': a 2:1 equirect panorama (assets/tex/sky_<theme>.jpg, horizon at mid-height).
      // Instant fallback = the skyTop→skyHorizon gradient; below the horizon it fades into the fog colour
      // so the terrain's far edge melts into it. env.skyShift nudges the painted horizon (v units).
      // The texture is NOT decoded as sRGB and the shader writes it raw: the painted colours reach the screen as-is.
      const hex = c => '#' + new THREE.Color(c).getHexString();
      const tex = loadTex(env.sky, () => cv(64, 256, (g2, w, h) => {
        const gr = g2.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, hex(env.skyTop)); gr.addColorStop(0.5, hex(env.skyHorizon)); gr.addColorStop(1, hex(env.fog ?? env.skyHorizon));
        g2.fillStyle = gr; g2.fillRect(0, 0, w, h);
      }), { srgb: false, anisotropy: 1 });
      tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.wrapT = THREE.ClampToEdgeWrapping;
      mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, fogc: { value: new THREE.Color().setHex(env.fog ?? 0xcfe6ff, THREE.LinearSRGBColorSpace) }, shift: { value: env.skyShift ?? 0 } },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform sampler2D map; uniform vec3 fogc; uniform float shift; varying vec3 vP; void main(){ vec3 d = normalize(vP); float u = atan(d.x, d.z) * 0.1591549 + 0.5; float v = clamp(0.5 + asin(clamp(d.y, -1.0, 1.0)) * 0.3183099 + shift, 0.002, 0.998); vec3 c = texture2D(map, vec2(u, v)).rgb; c = mix(c, fogc, (1.0 - smoothstep(-0.02, 0.05, d.y)) * 0.9); gl_FragColor = vec4(c, 1.0); }',
        side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
      });
    } else mat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(env.skyTop) }, hor: { value: new THREE.Color(env.skyHorizon) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.05,0.0,1.0); gl_FragColor = vec4(mix(hor, top, pow(h,0.7)),1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(g, mat); m.name = 'sky'; m.renderOrder = -1; m.frustumCulled = false;
    group.add(m);
    updaters.push(() => {}); // sky follows the camera in main (sky.position)
    group.userData.sky = m;
  }

  // ------------------------------------------------ sky clouds: a ring of soft billboards far out (1 draw call)
  if (env.clouds !== false) {
    const tex = loadTex('skycloud', () => cv(256, 128, (g, w, h) => {
      for (let i = 0; i < 26; i++) {
        const x = w * (0.15 + 0.7 * Math.random()), y = h * (0.45 + 0.25 * Math.random() - 0.1 * Math.sin(Math.PI * x / w)), r = 18 + Math.random() * 26 * Math.sin(Math.PI * x / w);
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.7, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    }), { file: false });
    const geos = [];
    const cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2;
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + r() * 0.3, R = 700 + r() * 350, w = 160 + r() * 160;
      const q = new THREE.PlaneGeometry(w, w * 0.45);
      q.lookAt(new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
      q.translate(cx + Math.cos(a) * R, 90 + r() * 160, cz + Math.sin(a) * R);
      geos.push(q);
    }
    const m = new THREE.Mesh(mergeGeos(geos), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, opacity: 0.95 }));
    m.name = 'clouds'; m.renderOrder = -0.5; m.frustumCulled = false; group.add(m);
  }

  // ------------------------------------------------ start line decal + arch
  {
    const f = track.frameAt(0), hw = f.hw;
    const lineTex = loadTex('startline', PROC.startline, { file: false });
    lineTex.repeat.set(Math.round(hw * 2 / 2), 1);
    const lg = ribbon({ a: k => HW[k], b: k => -HW[k], vScale: 1 / 2.4, keep: k => k === 0 || k === 1 || k === 2 });
    // ribbon over samples 0..2 (≈2 m); remap uv so the checker is 1 m squares
    const uv = lg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * hw * 2 / 2, uv.getY(i));
    const lm = new THREE.Mesh(lg, new THREE.MeshLambertMaterial({ map: lineTex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    lm.position.y = 0.02; lm.receiveShadow = true; lm.name = 'startline'; group.add(lm);
    lineTex.repeat.set(1, 1);

    const W = hw + 1.8, Hh = 6.5;
    const posts = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.55, 0.7, Hh + 1, 10);
    const pm = new THREE.MeshLambertMaterial({ color: 0xffd23f });
    const geos = [];
    for (const side of [1, -1]) {
      const p = track.pointAt(0, side * W);
      const gg = postGeo.clone(); gg.translate(p.x, p.y + (Hh + 1) / 2 - 0.5, p.z); geos.push(gg);
      const ball = new THREE.SphereGeometry(0.9, 12, 8); ball.translate(p.x, p.y + Hh + 1.1, p.z); geos.push(ball);
    }
    const merged = mergeGeos(geos);
    const pmesh = new THREE.Mesh(merged, pm); pmesh.castShadow = true; pmesh.name = 'archposts'; posts.add(pmesh);
    // banner
    const bannerTex = loadTex('banner', PROC.banner, { file: false });
    const bw = W * 2, bh = 2.0;
    const bgeo = new THREE.BoxGeometry(bw, bh, 0.3);
    const bmats = [pm, pm, pm, pm, new THREE.MeshBasicMaterial({ map: bannerTex, toneMapped: false }), new THREE.MeshBasicMaterial({ map: bannerTex, toneMapped: false })];
    const banner = new THREE.Mesh(bgeo, bmats);
    const c = track.pointAt(0, 0);
    banner.position.set(c.x, c.y + Hh - 0.2, c.z);
    banner.rotation.y = f.yaw;
    banner.castShadow = true; banner.name = 'banner';
    posts.add(banner);
    group.add(posts);
  }

  // ------------------------------------------------ turbo pads (glowing chevrons, scrolling)
  if (track.pads.length) {
    const tex = loadTex('pad', PROC.pad, { file: false });
    const pos = [], uv = [], idx = [];
    for (const p of track.pads) {
      const steps = Math.max(2, Math.round(p.len / track.ds));
      const i0 = pos.length / 3;
      for (let i = 0; i <= steps; i++) {
        const s = p.s + p.len * i / steps, f = track.frameAt(s);
        for (const [lat, u] of [[p.lat + p.w / 2, 0], [p.lat - p.w / 2, 1]]) {
          const q = track.pointAt(s, lat); pos.push(q.x, q.y + 0.045, q.z); uv.push(u, i / steps * p.len / 3.5);
        }
      }
      for (let i = 0; i < steps; i++) { const a = i0 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    m.name = 'pads'; group.add(m);
    updaters.push((dt, t) => { tex.offset.y = -(t * 1.6) % 1; });
  }

  // ------------------------------------------------ queries for scenery / camera
  // `y` = height of whoever asks (the chase camera passes the kart's): picks the right level where the track crosses itself
  const groundAt = (x, z, hint = -1, y = 50) => {
    const pr = track.project({ x, y, z }, hint, {});
    if (!pr.gap && Math.abs(pr.lat) <= Math.max(pr.limL === Infinity ? 0 : pr.limL, pr.limR === Infinity ? 0 : pr.limR) + 0.4 && isFinite(pr.y)) {
      const lim = pr.lat > 0 ? pr.limL : pr.limR;
      if (Math.abs(pr.lat) <= lim) return pr.y;
    }
    return groundAtGrid(x, z);
  };
  /** true if a prop of radius r at (x,z) stays clear of the drivable corridor (+ a margin) */
  const isClear = (x, z, r = 1, margin = 1.5) => { const ci = corridorInfo(x, z); return ci.e > r + margin + 0.5 && !ci.gap; };
  const aboveWater = (x, z, h = 0.2) => !water || groundAtGrid(x, z) > water.y + h;

  // ------------------------------------------------ scenery hook
  let scenery = null;
  try {
    const mod = await import(`./scenery/${track.theme}.js`);
    const build = mod.default || mod.buildScenery;
    if (build) {
      let seed = 1234;
      const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      scenery = await build({ THREE, group, track, def, env, rng, loadTex, groundAt: groundAtGrid, trackGroundAt: groundAt, naturalAt: natural, isClear, aboveWater, corridorInfo, bounds: { x0, z0, x1: x0 + (nx - 1) * CELL, z1: z0 + (nz - 1) * CELL } });
    }
  } catch (e) {
    if (!/Failed to fetch|Importing a module script failed|error loading dynamically imported module|404/i.test(String(e))) console.warn('[trackmesh] scenery failed:', e);
  }

  return {
    group, env, sky: group.userData.sky, groundAt, groundAtGrid, isClear, aboveWater,
    stats: { terrainMs, terrainVerts: nx * nz },
    update(dt, t) { for (const u of updaters) u(dt, t); if (scenery?.update) scenery.update(dt, t); },
  };
}

/** Minimal BufferGeometry merge (position/normal/uv/color, all indexed or all not). */
export function mergeGeos(geos) {
  const attrs = ['position', 'normal', 'uv', 'color'];
  const out = new THREE.BufferGeometry();
  const has = attrs.filter(a => geos.every(g => g.attributes[a]));
  const arrays = Object.fromEntries(has.map(a => [a, []]));
  const idx = []; let base = 0;
  for (let g of geos) {
    if (!g.index) g = g.toNonIndexed().clone();
    for (const a of has) arrays[a].push(...g.attributes[a].array);
    if (g.index) for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count;
  }
  for (const a of has) out.setAttribute(a, new THREE.Float32BufferAttribute(arrays[a], geos[0].attributes[a].itemSize));
  if (idx.length) out.setIndex(idx);
  return out;
}
