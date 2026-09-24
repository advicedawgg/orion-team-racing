// track.js — PURE track model (no THREE, no DOM). `node tools/check.js` imports this.
//
// A track is a CLOSED spline through authored control points, sampled every ~1 m.
// Everything else — surfaces, walls, pads, item rows, jumps, checkpoints, the grid —
// is data hung off that spline. The data format is documented in DESIGN.md under
// "Track data format"; tracks/beach.js is the worked example.
//
// Conventions (DESIGN.md): Y up, forward = (sin yaw, 0, cos yaw), LEFT = (fz, 0, -fx).
// `lat` is the signed lateral offset from the centre line, + = LEFT of the driving direction.
// `s` is metres along the centre line from the start line (0 .. length).

const SAMPLE = 1.0;            // metres between samples
const DENSE = 40;              // dense sub-steps per control segment before resampling

/** Per-point properties that are INHERITED: set once, they hold until a later point changes them. */
export const INHERIT = {
  offL: 10, offR: 10,          // metres of drivable offroad beyond each road edge, then the boundary
  wallL: 'fence', wallR: 'fence', // boundary kind: a visible style name, 'none' (invisible), or 'fall' (no boundary: you can fall off)
  surfL: null, surfR: null,    // offroad surface name (null = track.offroad)
  kerb: 'auto',                // 'auto' = kerbs where the corner is tight, true/false to force
  bridge: false,               // this stretch may pass over/under another stretch (overlap check)
  tunnel: false,               // roof over the road (trackmesh / scenery may use it)
};

/** Offroad surfaces and their top-speed multiplier. Physics reads this; tracks may add their own names. */
export const SURFACES = {
  road: 1, sand: 0.64, grass: 0.66, snow: 0.62, mud: 0.6, dirt: 0.72, ice: 0.9, rock: 0.7, lava: 0.5, space: 0.7,
};

const V = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  len: a => Math.hypot(a.x, a.y, a.z),
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth01 = t => t * t * (3 - 2 * t);
/** Surface height at `lat`. The road is a banked plane that pivots on its LOW (inside) edge, which
 *  stays at the centre-line height `y` — banking raises the outside, it never digs the inside into
 *  the sea. Beyond the road edges the offroad stays level at the edge height. */
export const bankY = (cy, lat, hw, tb) => cy + hw * Math.abs(tb) - (lat < -hw ? -hw : lat > hw ? hw : lat) * tb;

/** Centripetal Catmull-Rom (alpha 0.5) on one scalar/point quad, evaluated at t in [0,1]. */
function crPoint(p0, p1, p2, p3, t) {
  const tj = (ti, a, b) => ti + Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)));
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const u = lerp(t1, t2, t);
  const L = (a, b, ta, tb) => {
    const k = (u - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
  };
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}
/** Uniform Catmull-Rom for scalars (width, bank). */
const crScalar = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

/**
 * Build a track from its data definition. See DESIGN.md "Track data format".
 * Returns the track model: samples, project(), pointAt(), and the resolved feature lists.
 */
export function buildTrack(def) {
  const P = def.points;
  const N = P.length;
  if (N < 4) throw new Error(`track ${def.id}: needs at least 4 control points`);
  const W0 = def.width ?? 16;
  const pts = P.map(p => ({ x: p.x, y: p.y ?? 0, z: p.z }));
  const wid = P.map(p => p.w ?? W0);
  const bnk = P.map(p => (p.bank ?? 0) * Math.PI / 180);
  const at = i => (i % N + N) % N;

  // ---- inherited per-segment properties
  const segProps = [];
  {
    // shorthands: off/wall/surf set both sides
    const apply = (cur, p) => {
      cur = { ...cur };
      if (p.off !== undefined) cur.offL = cur.offR = p.off;
      if (p.wall !== undefined) cur.wallL = cur.wallR = p.wall;
      if (p.surf !== undefined) cur.surfL = cur.surfR = p.surf;
      for (const k of Object.keys(INHERIT)) if (p[k] !== undefined) cur[k] = p[k];
      if (cur.surfL == null) cur.surfL = def.offroad || 'sand';
      if (cur.surfR == null) cur.surfR = def.offroad || 'sand';
      return cur;
    };
    let cur = apply(INHERIT, def.defaults || {});
    for (let i = 0; i < N; i++) { cur = apply(cur, P[i]); segProps.push(cur); }
  }

  // ---- dense sampling of the spline: u = control index + fraction
  const dense = [];
  for (let i = 0; i < N; i++) {
    const p0 = pts[at(i - 1)], p1 = pts[i], p2 = pts[at(i + 1)], p3 = pts[at(i + 2)];
    for (let k = 0; k < DENSE; k++) {
      const t = k / DENSE;
      dense.push({ u: i + t, p: crPoint(p0, p1, p2, p3, t) });
    }
  }
  let acc = 0;
  for (let j = 0; j < dense.length; j++) {
    dense[j].d = acc;
    const nx = dense[(j + 1) % dense.length].p;
    acc += V.len(V.sub(nx, dense[j].p));
  }
  const rawLen = acc;

  /** u (control index + frac) → distance along the raw spline (from point 0). */
  const dOfU = u => {
    u = ((u % N) + N) % N;
    const f = u * DENSE, j = Math.floor(f), t = f - j;
    const a = dense[j].d, b = j + 1 < dense.length ? dense[j + 1].d : rawLen;
    return lerp(a, b, t);
  };
  /** raw distance → u */
  const uOfD = d => {
    d = ((d % rawLen) + rawLen) % rawLen;
    let lo = 0, hi = dense.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (dense[m].d <= d) lo = m; else hi = m - 1; }
    const a = dense[lo].d, b = lo + 1 < dense.length ? dense[lo + 1].d : rawLen;
    return (lo + (b > a ? (d - a) / (b - a) : 0)) / DENSE;
  };

  // The start line is s = 0. By default it sits on control point 0.
  const startD = dOfU(def.start ?? 0);
  const n = Math.max(32, Math.round(rawLen / SAMPLE));
  const ds = rawLen / n;
  const length = rawLen;

  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  const TX = new Float64Array(n), TZ = new Float64Array(n), TY = new Float64Array(n);
  const HW = new Float64Array(n), TB = new Float64Array(n), U = new Float64Array(n);
  const OFFL = new Float64Array(n), OFFR = new Float64Array(n);
  const CURV = new Float64Array(n), HEAD = new Float64Array(n), AIL = new Float64Array(n);
  const FLAG = new Uint8Array(n);          // bit0 gap, bit1 bridge, bit2 noRespawn, bit3 tunnel, bit4 jumpApproach
  const props = new Array(n);

  const posAtD = d => {
    const u = uOfD(d);
    const i = Math.floor(u) % N, t = u - Math.floor(u);
    return crPoint(pts[at(i - 1)], pts[i], pts[at(i + 1)], pts[at(i + 2)], t);
  };
  for (let k = 0; k < n; k++) {
    const d = startD + k * ds;
    const u = uOfD(d);
    const i = Math.floor(u) % N, t = u - Math.floor(u);
    const p = crPoint(pts[at(i - 1)], pts[i], pts[at(i + 1)], pts[at(i + 2)], t);
    X[k] = p.x; Y[k] = p.y; Z[k] = p.z; U[k] = u;
    HW[k] = Math.max(3, crScalar(wid[at(i - 1)], wid[i], wid[at(i + 1)], wid[at(i + 2)], t)) / 2;
    TB[k] = Math.tan(crScalar(bnk[at(i - 1)], bnk[i], bnk[at(i + 1)], bnk[at(i + 2)], t));
    props[k] = segProps[i];
    OFFL[k] = segProps[i].offL; OFFR[k] = segProps[i].offR;
    if (segProps[i].bridge) FLAG[k] |= 2;
    if (segProps[i].tunnel) FLAG[k] |= 8;
  }
  for (let k = 0; k < n; k++) {
    const a = (k - 1 + n) % n, b = (k + 1) % n;
    let tx = X[b] - X[a], tz = Z[b] - Z[a], ty = Y[b] - Y[a];
    const h = Math.hypot(tx, tz) || 1;
    TX[k] = tx / h; TZ[k] = tz / h; TY[k] = ty / h;   // TY = slope (dy per horizontal metre)
    HEAD[k] = Math.atan2(TX[k], TZ[k]);
  }
  const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  for (let k = 0; k < n; k++) {
    const a = (k - 2 + n) % n, b = (k + 2) % n;
    CURV[k] = wrapA(HEAD[b] - HEAD[a]) / (4 * ds);     // + = turning left (yaw increasing)
  }

  const wrapS = s => ((s % length) + length) % length;
  /** signed shortest distance from a to b along the loop */
  const dS = (a, b) => { let d = wrapS(b) - wrapS(a); if (d > length / 2) d -= length; if (d < -length / 2) d += length; return d; };
  /** `at` (control index + fraction, as authored) → s in metres from the start line */
  const sOf = atv => wrapS(dOfU(atv) - startD);
  const idx = s => ((Math.round(wrapS(s) / ds) % n) + n) % n;

  // ---- features
  const gaps = (def.gaps || []).map(g => {
    const s0 = sOf(g.from), s1 = sOf(g.to);
    return { s0, s1, len: wrapS(s1 - s0) };
  });
  const inRange = (s, s0, len) => wrapS(s - s0) <= len;
  for (const g of gaps) for (let k = 0; k < n; k++) if (inRange(k * ds, g.s0, g.len)) FLAG[k] |= 1 | 4;
  const jumps = (def.jumps || []).map(j => ({ s: sOf(j.at), vy: j.vy ?? 9 }));
  // no respawning on a jump's run-up either: you'd be dropped onto the lip and fall straight in
  for (const j of jumps) for (let k = 0; k < n; k++) { const d = dS(k * ds, j.s); if (d >= -2 && d <= 45) FLAG[k] |= 4 | 16; }
  for (const r of def.noRespawn || []) { const s0 = sOf(r.from), len = wrapS(sOf(r.to) - s0); for (let k = 0; k < n; k++) if (inRange(k * ds, s0, len)) FLAG[k] |= 4; }

  const frameAt = s => {
    const k = idx(s);
    return { x: X[k], y: Y[k], z: Z[k], tx: TX[k], tz: TZ[k], lx: TZ[k], lz: -TX[k], hw: HW[k], tb: TB[k], yaw: HEAD[k], k };
  };
  /** World point at (s, lat), on the (banked) surface. */
  const pointAt = (s, lat = 0) => {
    const f = frameAt(s);
    return { x: f.x + f.lx * lat, y: bankY(f.y, lat, f.hw, f.tb), z: f.z + f.lz * lat, yaw: f.yaw };
  };

  const pads = (def.pads || []).map(p => {
    const s = sOf(p.at), lat = p.lat ?? 0, len = p.len ?? 7, w = p.w ?? 4.5;
    return { s, lat, len, w, ...pointAt(s + len / 2, lat) };
  });
  const itemRows = (def.items || []).map(r => {
    const s = sOf(r.at), f = frameAt(s), cnt = r.n ?? Math.max(3, Math.min(5, Math.round(f.hw * 2 / 3.6)));
    const span = f.hw * 2 * 0.72, slots = [];
    for (let i = 0; i < cnt; i++) { const lat = (r.lat ?? 0) + (cnt === 1 ? 0 : -span / 2 + span * i / (cnt - 1)); slots.push({ lat, ...pointAt(s, lat) }); }
    return { s, slots };
  });
  const starRows = (def.stars || []).map(r => {
    const s = sOf(r.at), cnt = r.n ?? 5, sp = r.spacing ?? 3.5, points = [];
    for (let i = 0; i < cnt; i++) {
      const si = s + i * sp, lat = (r.lat ?? 0) + (r.curve ?? 0) * Math.sin(Math.PI * i / Math.max(1, cnt - 1));
      points.push({ s: wrapS(si), lat, ...pointAt(si, lat) });
    }
    return { s, points };
  });
  let checkpoints;
  if (def.checkpoints) checkpoints = def.checkpoints.map(sOf).sort((a, b) => a - b);
  else {
    const m = def.checkpointCount ?? 8; checkpoints = [];
    for (let j = 1; j < m; j++) {
      let c = length * j / m;
      for (let g = 0; g < 200 && (FLAG[idx(c)] & 1); g++) c += 2;   // never inside a gap
      checkpoints.push(c);
    }
  }

  // Start grid: 8 slots, two wide, staggered like CTR. Slot 0 = pole (front left).
  const grid = [];
  {
    const f = frameAt(0);
    for (let i = 0; i < 8; i++) {
      const row = Math.floor(i / 2), side = i % 2 === 0 ? 1 : -1;
      const back = 6 + row * 6.5 + (i % 2) * 3;
      const lat = side * Math.min(f.hw * 0.42, 3.4);
      const p = pointAt(-back, lat);
      grid.push({ s: wrapS(-back), lat, x: p.x, y: p.y, z: p.z, yaw: frameAt(-back).yaw });
    }
  }

  // ---- AI racing line: lean to the inside of corners, smoothed so the car sets up wide.
  {
    const box = (src, r) => {
      const out = new Float64Array(n), w = Math.max(1, Math.round(r / ds));
      let sum = 0; for (let j = -w; j <= w; j++) sum += src[(j + n) % n];
      for (let k = 0; k < n; k++) { out[k] = sum / (2 * w + 1); sum += src[(k + w + 1) % n] - src[(k - w + n) % n]; }
      return out;
    };
    let kS = box(box(CURV, 14), 14);
    for (let k = 0; k < n; k++) {
      const lim = Math.max(0, HW[k] - 2.2);
      AIL[k] = clamp(kS[k] * 16 * HW[k], -lim, lim);
    }
    const sm = box(AIL, 10);
    for (let k = 0; k < n; k++) AIL[k] = sm[k];
  }

  // ---- projection
  const out0 = {};
  const d2At = (k, p) => { const dx = p.x - X[k], dz = p.z - Z[k], dy = (p.y - Y[k]) * 1.6; return dx * dx + dz * dz + dy * dy; };
  function nearest(p, hint) {
    if (hint == null || hint < 0) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < n; k += 2) { const d = d2At(k, p); if (d < bd) { bd = d; best = k; } }
      hint = best;
    }
    let best = hint, bd = d2At(hint, p);
    // local descent both ways, with a small window to hop tiny bumps
    for (const dir of [1, -1]) {
      let k = hint, miss = 0;
      for (let step = 0; step < n / 2 && miss < 10; step++) {
        k = (k + dir + n) % n;
        const d = d2At(k, p);
        if (d < bd) { bd = d; best = k; miss = 0; } else miss++;
      }
    }
    return best;
  }

  /**
   * Project a world position onto the track.
   * @param p {x,y,z}  @param hint sample index from last time (or -1 for a global search)
   * @returns {i, s, lat, cy, y (surface height at lat, or -Infinity where you'd fall),
   *   onRoad, surface, hw, limL, limR (lat bounds of the boundary; ±Infinity where it's 'fall'),
   *   wallL, wallR, gap, tx, tz, lx, lz, tb, slope, noRespawn, tunnel}
   */
  function project(p, hint = -1, o = out0) {
    const k = nearest(p, hint);
    // refine on the segment k-1..k or k..k+1
    const kb = (k + 1) % n, ka = (k - 1 + n) % n;
    let i0 = k, i1 = kb;
    {
      const ex = X[kb] - X[k], ez = Z[kb] - Z[k];
      const t = ((p.x - X[k]) * ex + (p.z - Z[k]) * ez) / (ex * ex + ez * ez || 1);
      if (t < 0) { i0 = ka; i1 = k; }
    }
    const ex = X[i1] - X[i0], ez = Z[i1] - Z[i0];
    const t = clamp(((p.x - X[i0]) * ex + (p.z - Z[i0]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
    const cx = lerp(X[i0], X[i1], t), cz = lerp(Z[i0], Z[i1], t), cy = lerp(Y[i0], Y[i1], t);
    let tx = lerp(TX[i0], TX[i1], t), tz = lerp(TZ[i0], TZ[i1], t);
    const h = Math.hypot(tx, tz) || 1; tx /= h; tz /= h;
    const lx = tz, lz = -tx;
    const lat = (p.x - cx) * lx + (p.z - cz) * lz;
    const hw = lerp(HW[i0], HW[i1], t), tb = lerp(TB[i0], TB[i1], t);
    const kk = t < 0.5 ? i0 : i1;
    const pr = props[kk];
    const s = wrapS(i0 * ds + t * ds);
    o.i = kk; o.s = s; o.lat = lat; o.cy = cy; o.hw = hw; o.tb = tb;
    o.tx = tx; o.tz = tz; o.lx = lx; o.lz = lz; o.slope = lerp(TY[i0], TY[i1], t);
    o.wallL = pr.wallL; o.wallR = pr.wallR;
    o.limL = pr.wallL === 'fall' ? Infinity : hw + OFFL[kk];
    o.limR = pr.wallR === 'fall' ? Infinity : hw + OFFR[kk];
    o.onRoad = Math.abs(lat) <= hw;
    o.gap = (FLAG[kk] & 1) !== 0;
    o.noRespawn = (FLAG[kk] & 4) !== 0;
    o.tunnel = (FLAG[kk] & 8) !== 0;
    o.y = bankY(cy, lat, hw, tb);
    o.surface = o.onRoad ? 'road' : (lat > 0 ? pr.surfL : pr.surfR);
    if (o.gap) { o.surface = 'gap'; o.y = gapFloor; o.onRoad = false; }
    else {
      const edge = lat > 0 ? hw + OFFL[kk] : hw + OFFR[kk];
      const fall = lat > 0 ? pr.wallL === 'fall' : pr.wallR === 'fall';
      if (fall && Math.abs(lat) > edge) { o.y = -Infinity; o.surface = 'void'; }
    }
    return o;
  }

  const water = def.water ? { y: def.water.y ?? -1.5, color: def.water.color } : null;
  const gapFloor = water ? water.y - 3 : Math.min(...Y) - 20;
  const killY = water ? water.y - 0.3 : null;

  /** The s to drop a kart back at, at or before `s`, never in a gap or a jump run-up. */
  function respawnS(s) {
    let k = idx(s - 4);
    for (let j = 0; j < n; j++) { if (!(FLAG[k] & 4)) return k * ds; k = (k - 1 + n) % n; }
    return 0;
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < n; k++) {
    const r = HW[k] + Math.max(OFFL[k], OFFR[k]);
    minX = Math.min(minX, X[k] - r); maxX = Math.max(maxX, X[k] + r);
    minZ = Math.min(minZ, Z[k] - r); maxZ = Math.max(maxZ, Z[k] + r);
    minY = Math.min(minY, Y[k]); maxY = Math.max(maxY, Y[k]);
  }

  return {
    def, id: def.id, name: def.name, theme: def.theme || def.id, laps: def.laps ?? 3,
    length, n, ds, X, Y, Z, TX, TZ, TY, HW, TB, U, OFFL, OFFR, CURV, HEAD, AIL, FLAG, props,
    gaps, jumps, pads, itemRows, starRows, checkpoints, grid, water, killY, gapFloor,
    bounds: { minX, maxX, minZ, maxZ, minY, maxY },
    wrapS, dS, sOf, idx, frameAt, pointAt, project, respawnS, nearest,
    /** heading change (rad, + = left) between s+a and s+b ahead — AI corner reading */
    turnAhead(s, a, b) { return wrapA(HEAD[idx(s + b)] - HEAD[idx(s + a)]); },
  };
}

export const _internals = { crPoint, smooth01 };
