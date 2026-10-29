// track.js — PURE track model (no THREE, no DOM). `node tools/check.js` imports this.
//
// A track is a CLOSED spline through authored control points, sampled every ~1 m.
// Everything else — surfaces, walls, pads, item rows, jumps, checkpoints, the grid —
// is data hung off that spline. The data format is documented in DESIGN.md under
// "Track data format"; tracks/beach.js is the worked example.
//
// BRANCHES (shortcuts, DESIGN.md "Branches (shortcuts)"): optional OPEN splines (`def.branches`) that
// leave the main road and rejoin it. Each is sampled by the same code as the main road (its own
// arrays, `track.branches[b]`, `track.routes[b + 1]`) and maps its own distance u onto an equivalent,
// monotonic main-road s (`mainS(u)`), so laps, checkpoints and positions keep working on main s.
// Sample indexes are COMBINED across routes (main 0..n-1, branch b at `branches[b].off`…), so a
// project() hint carries the route: project(pos, kart.si) answers on the kart's route and, only where
// the two corridors overlap (the junctions), moves it onto the other route when it is clearly deeper
// inside that one (hysteresis). A track without `branches` behaves exactly as before.
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
  raised: false,               // elevated stretch (castle wall top, sky bridge): the terrain does NOT rise to meet it; scenery holds it up
};

/** Offroad surfaces and their top-speed multiplier. Physics reads this; tracks may add their own names. */
export const SURFACES = {
  road: 1, sand: 0.64, grass: 0.66, snow: 0.62, mud: 0.6, dirt: 0.72, ice: 0.9, rock: 0.7, lava: 0.5, space: 0.7,
};

/** Route switching at junctions (branches): the kart moves to the other route when it is this many
 *  metres deeper inside that road (|lat| − half-width) than inside its own, and within ROUTE_DY in height. */
export const ROUTE = { HYST: 0.4, DY: 2.5, CS_GAP: 100, BLEND: 8 };

const V = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  len: a => Math.hypot(a.x, a.y, a.z),
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth01 = t => t * t * (3 - 2 * t);
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
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
 * One route: a spline through `P` sampled every ~1 m, with its inherited props, features, AI line and
 * projection. `closed` = the main loop (exactly the original single-spline code path); open = a branch
 * (phantom end points reflected, scalars clamped, indexes clamped instead of wrapped).
 * `shared.gapFloor` is read at projection time (it depends on the finished main road).
 */
function buildRoute(P, spec, shared) {
  const { closed, id } = spec;
  const N = P.length;
  if (N < (closed ? 4 : 3)) throw new Error(`track ${id}: needs at least ${closed ? 4 : 3} control points`);
  const W0 = spec.width ?? 16;
  const pts = P.map(p => ({ x: p.x, y: p.y ?? 0, z: p.z }));
  const wid = P.map(p => p.w ?? W0);
  const bnk = P.map(p => (p.bank ?? 0) * Math.PI / 180);
  const at = i => (i % N + N) % N;
  // control-point access: closed wraps; open reflects the end points (natural ends) and clamps scalars
  const refl = (a, b) => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z });
  const pre = closed ? null : refl(pts[0], pts[1]), post = closed ? null : refl(pts[N - 1], pts[N - 2]);
  const PT = closed ? i => pts[at(i)] : i => i < 0 ? pre : i >= N ? post : pts[i];
  const SC = closed ? (arr, i) => arr[at(i)] : (arr, i) => arr[i < 0 ? 0 : i >= N ? N - 1 : i];

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
      if (cur.surfL == null) cur.surfL = spec.offroad || 'sand';
      if (cur.surfR == null) cur.surfR = spec.offroad || 'sand';
      return cur;
    };
    let cur = apply(INHERIT, spec.defaults || {});
    for (let i = 0; i < N; i++) { cur = apply(cur, P[i]); segProps.push(cur); }
  }

  // ---- dense sampling of the spline: u = control index + fraction
  const dense = [];
  const NSEG = closed ? N : N - 1;
  for (let i = 0; i < NSEG; i++) {
    const p0 = PT(i - 1), p1 = pts[i], p2 = PT(i + 1), p3 = PT(i + 2);
    for (let k = 0; k < DENSE; k++) {
      const t = k / DENSE;
      dense.push({ u: i + t, p: crPoint(p0, p1, p2, p3, t) });
    }
  }
  if (!closed) dense.push({ u: N - 1, p: { ...pts[N - 1] } });
  let acc = 0;
  for (let j = 0; j < dense.length; j++) {
    dense[j].d = acc;
    if (!closed && j === dense.length - 1) break;
    const nx = dense[(j + 1) % dense.length].p;
    acc += V.len(V.sub(nx, dense[j].p));
  }
  const rawLen = acc;

  /** u (control index + frac) → distance along the raw spline (from point 0). */
  const dOfU = closed ? u => {
    u = ((u % N) + N) % N;
    const f = u * DENSE, j = Math.floor(f), t = f - j;
    const a = dense[j].d, b = j + 1 < dense.length ? dense[j + 1].d : rawLen;
    return lerp(a, b, t);
  } : u => {
    u = clamp(u, 0, N - 1);
    const f = u * DENSE, j = Math.min(Math.floor(f), dense.length - 2), t = f - j;
    return lerp(dense[j].d, dense[j + 1].d, t);
  };
  /** raw distance → u */
  const uOfD = d => {
    d = closed ? ((d % rawLen) + rawLen) % rawLen : clamp(d, 0, rawLen);
    let lo = 0, hi = dense.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (dense[m].d <= d) lo = m; else hi = m - 1; }
    const a = dense[lo].d, b = lo + 1 < dense.length ? dense[lo + 1].d : rawLen;
    return (lo + (b > a ? (d - a) / (b - a) : 0)) / DENSE;
  };

  // The start line is s = 0. By default it sits on control point 0 (a branch starts at its point 0).
  const startD = closed ? dOfU(spec.start ?? 0) : 0;
  const nSeg = closed ? Math.max(32, Math.round(rawLen / SAMPLE)) : Math.max(4, Math.round(rawLen / SAMPLE));
  const n = closed ? nSeg : nSeg + 1;   // an open route keeps both end samples
  const ds = rawLen / nSeg;
  const length = rawLen;

  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  const TX = new Float64Array(n), TZ = new Float64Array(n), TY = new Float64Array(n);
  const HW = new Float64Array(n), TB = new Float64Array(n), U = new Float64Array(n);
  const OFFL = new Float64Array(n), OFFR = new Float64Array(n);
  const CURV = new Float64Array(n), HEAD = new Float64Array(n), AIL = new Float64Array(n);
  const FLAG = new Uint8Array(n);          // bit0 gap, bit1 bridge, bit2 noRespawn, bit3 tunnel, bit4 jumpApproach
  // junctions (branched tracks): wall openings (|lat| the boundary moves out to, 0 = closed) and which
  // route a kart here may switch to (JR: 0 none, else route index + 1) with a sample hint on it (JH)
  const OPENL = new Float64Array(n), OPENR = new Float64Array(n);
  const JR = new Uint8Array(n), JH = new Int32Array(n).fill(-1);
  const props = new Array(n);

  for (let k = 0; k < n; k++) {
    const d = startD + k * ds;
    const u = uOfD(d);
    const i = closed ? Math.floor(u) % N : Math.min(Math.floor(u), N - 2), t = u - (closed ? Math.floor(u) : i);
    const p = crPoint(PT(i - 1), pts[i], PT(i + 1), PT(i + 2), t);
    X[k] = p.x; Y[k] = p.y; Z[k] = p.z; U[k] = u;
    HW[k] = Math.max(3, crScalar(SC(wid, i - 1), wid[i], SC(wid, i + 1), SC(wid, i + 2), t)) / 2;
    TB[k] = Math.tan(crScalar(SC(bnk, i - 1), bnk[i], SC(bnk, i + 1), SC(bnk, i + 2), t));
    props[k] = segProps[i];
    OFFL[k] = segProps[i].offL; OFFR[k] = segProps[i].offR;
    if (segProps[i].bridge) FLAG[k] |= 2;
    if (segProps[i].tunnel) FLAG[k] |= 8;
  }
  for (let k = 0; k < n; k++) {
    const a = closed ? (k - 1 + n) % n : Math.max(0, k - 1), b = closed ? (k + 1) % n : Math.min(n - 1, k + 1);
    let tx = X[b] - X[a], tz = Z[b] - Z[a], ty = Y[b] - Y[a];
    const h = Math.hypot(tx, tz) || 1;
    TX[k] = tx / h; TZ[k] = tz / h; TY[k] = ty / h;   // TY = slope (dy per horizontal metre)
    HEAD[k] = Math.atan2(TX[k], TZ[k]);
  }
  for (let k = 0; k < n; k++) {
    if (closed) {
      const a = (k - 2 + n) % n, b = (k + 2) % n;
      CURV[k] = wrapA(HEAD[b] - HEAD[a]) / (4 * ds);     // + = turning left (yaw increasing)
    } else {
      const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2);
      CURV[k] = wrapA(HEAD[b] - HEAD[a]) / ((b - a) * ds);
    }
  }

  const wrapS = closed ? s => ((s % length) + length) % length : s => s < 0 ? 0 : s > length ? length : s;
  /** signed shortest distance from a to b along the loop (open route: plain b − a) */
  const dS = closed ? (a, b) => { let d = wrapS(b) - wrapS(a); if (d > length / 2) d -= length; if (d < -length / 2) d += length; return d; } : (a, b) => b - a;
  /** `at` (control index + fraction, as authored) → s in metres from the start line */
  const sOf = closed ? atv => wrapS(dOfU(atv) - startD) : atv => dOfU(atv);
  const idx = closed ? s => ((Math.round(wrapS(s) / ds) % n) + n) % n : s => { const k = Math.round(s / ds); return k < 0 ? 0 : k > n - 1 ? n - 1 : k; };

  // ---- features
  const inRange = closed ? (s, s0, len) => wrapS(s - s0) <= len : (s, s0, len) => s >= s0 && s - s0 <= len;
  const gaps = (spec.gaps || []).map(g => {
    const s0 = sOf(g.from), s1 = sOf(g.to);
    const o = { s0, s1, len: closed ? wrapS(s1 - s0) : s1 - s0 };
    if (g.needsBoost || spec.needsBoost) o.needsBoost = true;
    return o;
  });
  for (const g of gaps) for (let k = 0; k < n; k++) if (inRange(k * ds, g.s0, g.len)) FLAG[k] |= 1 | 4;
  const jumps = (spec.jumps || []).map(j => ({ s: sOf(j.at), vy: j.vy ?? 9 }));
  // no respawning on a jump's run-up either: you'd be dropped onto the lip and fall straight in
  for (const j of jumps) for (let k = 0; k < n; k++) { const d = dS(k * ds, j.s); if (d >= -2 && d <= 45) FLAG[k] |= 4 | 16; }
  for (const r of spec.noRespawn || []) { const s0 = sOf(r.from), len = closed ? wrapS(sOf(r.to) - s0) : sOf(r.to) - s0; for (let k = 0; k < n; k++) if (inRange(k * ds, s0, len)) FLAG[k] |= 4; }

  const frameAt = s => {
    const k = idx(s);
    return { x: X[k], y: Y[k], z: Z[k], tx: TX[k], tz: TZ[k], lx: TZ[k], lz: -TX[k], hw: HW[k], tb: TB[k], yaw: HEAD[k], k };
  };
  /** World point at (s, lat), on the (banked) surface. */
  const pointAt = (s, lat = 0) => {
    const f = frameAt(s);
    return { x: f.x + f.lx * lat, y: bankY(f.y, lat, f.hw, f.tb), z: f.z + f.lz * lat, yaw: f.yaw };
  };

  const pads = (spec.pads || []).map(p => {
    const s = sOf(p.at), lat = p.lat ?? 0, len = p.len ?? 7, w = p.w ?? 4.5;
    return { s, lat, len, w, ...pointAt(s + len / 2, lat) };
  });
  const itemRows = (spec.items || []).map(r => {
    const s = sOf(r.at), f = frameAt(s), cnt = r.n ?? Math.max(3, Math.min(5, Math.round(f.hw * 2 / 3.6)));
    const span = f.hw * 2 * 0.72, slots = [];
    for (let i = 0; i < cnt; i++) { const lat = (r.lat ?? 0) + (cnt === 1 ? 0 : -span / 2 + span * i / (cnt - 1)); slots.push({ lat, ...pointAt(s, lat) }); }
    return { s, slots };
  });
  const starRows = (spec.stars || []).map(r => {
    const s = sOf(r.at), cnt = r.n ?? 5, sp = r.spacing ?? 3.5, points = [];
    for (let i = 0; i < cnt; i++) {
      const si = s + i * sp, lat = (r.lat ?? 0) + (r.curve ?? 0) * Math.sin(Math.PI * i / Math.max(1, cnt - 1));
      points.push({ s: wrapS(si), lat, ...pointAt(si, lat) });
    }
    return { s, points };
  });

  // ---- AI racing line: lean to the inside of corners, smoothed so the car sets up wide.
  {
    const box = closed ? (src, r) => {
      const out = new Float64Array(n), w = Math.max(1, Math.round(r / ds));
      let sum = 0; for (let j = -w; j <= w; j++) sum += src[(j + n) % n];
      for (let k = 0; k < n; k++) { out[k] = sum / (2 * w + 1); sum += src[(k + w + 1) % n] - src[(k - w + n) % n]; }
      return out;
    } : (src, r) => {
      const out = new Float64Array(n), w = Math.max(1, Math.round(r / ds));
      for (let k = 0; k < n; k++) { let sum = 0; for (let j = -w; j <= w; j++) sum += src[clamp(k + j, 0, n - 1)]; out[k] = sum / (2 * w + 1); }
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

  // ---- projection (route-local: o.i is a sample index of THIS route)
  const d2At = (k, p) => { const dx = p.x - X[k], dz = p.z - Z[k], dy = (p.y - Y[k]) * 1.6; return dx * dx + dz * dz + dy * dy; };
  function nearest(p, hint) {
    if (hint == null || hint < 0) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < n; k += 2) { const d = d2At(k, p); if (d < bd) { bd = d; best = k; } }
      if (!closed) { const d = d2At(n - 1, p); if (d < bd) { bd = d; best = n - 1; } }
      hint = best;
    }
    let best = hint, bd = d2At(hint, p);
    // local descent both ways, with a small window to hop tiny bumps
    for (const dir of [1, -1]) {
      let k = hint, miss = 0;
      for (let step = 0; step < n / 2 && miss < 10; step++) {
        if (closed) k = (k + dir + n) % n;
        else { k += dir; if (k < 0 || k >= n) break; }
        const d = d2At(k, p);
        if (d < bd) { bd = d; best = k; miss = 0; } else miss++;
      }
    }
    return best;
  }

  /**
   * Project a world position onto this route.
   * @returns {i, s, lat, cy, y (surface height at lat, or -Infinity where you'd fall),
   *   onRoad, surface, hw, limL, limR (lat bounds of the boundary; ±Infinity where it's 'fall'),
   *   wallL, wallR, gap, tx, tz, lx, lz, tb, slope, noRespawn, tunnel, flag, past}
   *   past = metres beyond an open route's end (0 on the route / on a closed one).
   */
  function projectLocal(p, hint, o) {
    const k = nearest(p, hint);
    // refine on the segment k-1..k or k..k+1
    let i0, i1;
    if (closed) {
      const kb = (k + 1) % n, ka = (k - 1 + n) % n;
      i0 = k; i1 = kb;
      const ex = X[kb] - X[k], ez = Z[kb] - Z[k];
      const t = ((p.x - X[k]) * ex + (p.z - Z[k]) * ez) / (ex * ex + ez * ez || 1);
      if (t < 0) { i0 = ka; i1 = k; }
    } else if (k >= n - 1) { i0 = n - 2; i1 = n - 1; }
    else {
      i0 = k; i1 = k + 1;
      const ex = X[i1] - X[k], ez = Z[i1] - Z[k];
      const t = ((p.x - X[k]) * ex + (p.z - Z[k]) * ez) / (ex * ex + ez * ez || 1);
      if (t < 0 && k > 0) { i0 = k - 1; i1 = k; }
    }
    const ex = X[i1] - X[i0], ez = Z[i1] - Z[i0];
    const tu = ((p.x - X[i0]) * ex + (p.z - Z[i0]) * ez) / (ex * ex + ez * ez || 1);
    const t = clamp(tu, 0, 1);
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
    if (OPENL[kk] > o.limL) o.limL = OPENL[kk];        // junction: the wall opens onto the other route
    if (OPENR[kk] > o.limR) o.limR = OPENR[kk];
    o.onRoad = Math.abs(lat) <= hw;
    o.flag = FLAG[kk];
    o.gap = (FLAG[kk] & 1) !== 0;
    o.noRespawn = (FLAG[kk] & 4) !== 0;
    o.tunnel = (FLAG[kk] & 8) !== 0;
    o.past = closed ? 0 : (i0 === 0 && tu < 0 ? -tu : i1 === n - 1 && tu > 1 ? tu - 1 : 0) * Math.sqrt(ex * ex + ez * ez);
    o.y = bankY(cy, lat, hw, tb);
    o.surface = o.onRoad ? 'road' : (lat > 0 ? pr.surfL : pr.surfR);
    if (o.gap) { o.surface = 'gap'; o.y = shared.gapFloor; o.onRoad = false; }
    else {
      const edge = lat > 0 ? hw + OFFL[kk] : hw + OFFR[kk];
      const fall = lat > 0 ? pr.wallL === 'fall' : pr.wallR === 'fall';
      if (fall && Math.abs(lat) > edge) { o.y = -Infinity; o.surface = 'void'; }
    }
    return o;
  }

  return {
    closed, n, ds, length, X, Y, Z, TX, TZ, TY, HW, TB, U, OFFL, OFFR, CURV, HEAD, AIL, FLAG, props,
    OPENL, OPENR, JR, JH,
    gaps, jumps, pads, itemRows, starRows,
    wrapS, dS, sOf, idx, frameAt, pointAt, nearest, projectLocal, startD,
    /** heading change (rad, + = left) between s+a and s+b ahead — AI corner reading */
    turnAhead(s, a, b) { return wrapA(HEAD[idx(s + b)] - HEAD[idx(s + a)]); },
  };
}

/**
 * Build a track from its data definition. See DESIGN.md "Track data format".
 * Returns the track model: samples, project(), pointAt(), and the resolved feature lists.
 */
export function buildTrack(def) {
  const shared = { gapFloor: 0 };
  const M = buildRoute(def.points, { closed: true, id: def.id, width: def.width ?? 16, offroad: def.offroad, defaults: def.defaults,
    start: def.start ?? 0, gaps: def.gaps, jumps: def.jumps, noRespawn: def.noRespawn, pads: def.pads, items: def.items, stars: def.stars }, shared);
  const { n, ds, length, X, Y, Z, HW, OFFL, OFFR, FLAG, wrapS, dS, idx, frameAt, pointAt } = M;

  let checkpoints;
  if (def.checkpoints) checkpoints = def.checkpoints.map(M.sOf).sort((a, b) => a - b);
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

  const water = def.water ? { y: def.water.y ?? -1.5, color: def.water.color } : null;
  const gapFloor = water ? water.y - 3 : Math.min(...Y) - 20;
  shared.gapFloor = gapFloor;
  const killY = water ? water.y - 0.3 : null;

  /** The s to drop a kart back at, at or before `s`, never in a gap or a jump run-up. */
  function respawnS(s) {
    let k = idx(s - 4);
    for (let j = 0; j < n; j++) { if (!(FLAG[k] & 4)) return k * ds; k = (k - 1 + n) % n; }
    return 0;
  }

  // ---------------------------------------------------------------- branches (shortcuts)
  const branches = (def.branches || []).map((bd, bi) => buildBranch(def, bd, bi, M, shared));
  const NB = branches.length;
  let nAll = n, csAt = length + ROUTE.CS_GAP;
  for (const br of branches) { br.off = nAll; nAll += br.n; br.csOff = csAt; csAt += br.length + ROUTE.CS_GAP; }
  for (const br of branches) analyseJunctions(M, br, branches);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const R of [M, ...branches]) for (let k = 0; k < R.n; k++) {
    const r = R.HW[k] + Math.max(R.OFFL[k], R.OFFR[k]);
    minX = Math.min(minX, R.X[k] - r); maxX = Math.max(maxX, R.X[k] + r);
    minZ = Math.min(minZ, R.Z[k] - r); maxZ = Math.max(maxZ, R.Z[k] + r);
    minY = Math.min(minY, R.Y[k]); maxY = Math.max(maxY, R.Y[k]);
  }

  // ---- projection across routes
  const out0 = {}, pA = {}, pB = {}, pL = {};
  const routes = [null, ...branches];          // routes[0] = the track itself (filled in below)
  const routeOfI = i => { if (i < n) return 0; for (let b = NB - 1; b >= 0; b--) if (i >= branches[b].off) return b + 1; return 0; };
  const copyP = (d, s) => {
    d.i = s.i; d.s = s.s; d.lat = s.lat; d.cy = s.cy; d.hw = s.hw; d.tb = s.tb; d.tx = s.tx; d.tz = s.tz; d.lx = s.lx; d.lz = s.lz; d.slope = s.slope;
    d.wallL = s.wallL; d.wallR = s.wallR; d.limL = s.limL; d.limR = s.limR; d.onRoad = s.onRoad; d.flag = s.flag; d.gap = s.gap; d.noRespawn = s.noRespawn;
    d.tunnel = s.tunnel; d.past = s.past; d.y = s.y; d.surface = s.surface; d.route = s.route; d.rs = s.rs; return d;
  };
  /** route-local projection → combined index / main-equivalent s */
  const projOn = (r, p, local, o) => {
    const R = r ? branches[r - 1] : M;
    R.projectLocal(p, local, o);
    o.route = r; o.rs = o.s;
    if (r) {
      // main-equivalent s: the branch's u → s mapping, except right at the junctions, where it's the kart's
      // own main-road projection (blended over ROUTE.BLEND m) — so s doesn't jump when the route switches
      let s = R.mainS(o.rs);
      const w = R.blendW(o.rs);
      if (w < 1) { const h = R.JH[o.i]; M.projectLocal(p, h >= 0 ? h : -1, pL); s = wrapS(pL.s + dS(pL.s, s) * w); }
      o.s = s; o.i += R.off;
    }
    return o;
  };
  const depth = q => Math.abs(q.lat) - q.hw;
  /** is q (a projection on its route) a place a kart can be: inside the boundary, not past an end, at that level */
  const inside = (q, p) => q.past <= 0.05 && Math.abs(q.lat) <= (q.lat > 0 ? q.limL : q.limR) + 0.05 && (!isFinite(q.y) || Math.abs(p.y - q.y) < ROUTE.DY || q.gap);
  /** should a kart on projection a (route A) move to projection b? A kart still ON the main road stays on
   *  it (a branch that starts on the road is taken by leaving the main road onto it); otherwise it moves
   *  when it's ROUTE.HYST m deeper inside the other road, or has left its own route (past an end / outside). */
  const better = (a, b, p) => {
    if (!inside(b, p)) return false;
    if (a.past > 0.05 || !inside(a, p)) return true;
    if (!a.route && depth(a) < 0) return false;
    return depth(b) < depth(a) - ROUTE.HYST;
  };

  /**
   * Project a world position onto the track.
   * @param p {x,y,z}  @param hint sample index from last time (combined across routes; -1 = global search)
   * @returns {i, s, lat, cy, y (surface height at lat, or -Infinity where you'd fall),
   *   onRoad, surface, hw, limL, limR (lat bounds of the boundary; ±Infinity where it's 'fall'),
   *   wallL, wallR, gap, tx, tz, lx, lz, tb, slope, noRespawn, tunnel, flag, past,
   *   route (0 = main, b + 1 = branches[b]), rs (s along that route; = s on the main road)}
   */
  function project(p, hint = -1, o = out0) {
    if (!NB) { M.projectLocal(p, hint, o); o.route = 0; o.rs = o.s; return o; }
    if (hint == null || hint < 0) {                 // global: the main road unless a branch is clearly it
      projOn(0, p, -1, o);
      for (let b = 1; b <= NB; b++) { projOn(b, p, -1, pB); if (better(o, pB, p)) copyP(o, pB); }
      return o;
    }
    const r = routeOfI(hint), R = r ? branches[r - 1] : M;
    projOn(r, p, hint - (r ? R.off : 0), o);
    const li = o.i - (r ? R.off : 0);
    const jr = R.JR[li];
    if (!jr && !(o.past > 0.05)) return o;
    // a junction: the other route (main ↔ this branch)
    const to = r ? 0 : jr, h = R.JH[li];
    projOn(to, p, h, pA);
    if (r && o.past > 0.05) return copyP(o, pA);   // ran off the end of the branch: back on the main road
    if (better(o, pA, p)) copyP(o, pA);
    return o;
  }

  // ---- route helpers (karts carry route + rs; main-road code paths stay as they were)
  const csOf = (route, rs) => route ? branches[route - 1].csOff + clamp(rs, 0, branches[route - 1].length) : rs;
  /** combined respawn coordinate (main s, or a branch's csOff + u) → { route, rs } */
  const csLoc = cs => { for (let b = NB - 1; b >= 0; b--) if (cs >= branches[b].csOff - 1) return { route: b + 1, rs: clamp(cs - branches[b].csOff, 0, branches[b].length) }; return { route: 0, rs: wrapS(cs) }; };
  const csPoint = (cs, lat = 0) => { if (!NB) return pointAt(cs, lat); const q = csLoc(cs); return q.route ? branches[q.route - 1].pointAt(q.rs, lat) : pointAt(q.rs, lat); };
  /** respawn spot (combined) for a kart last good at cs: on its branch, never in a gap / run-up; else main */
  function respawnCS(cs) {
    if (!NB || cs < length + 1) return wrapS(respawnS(cs));
    const q = csLoc(cs), br = branches[q.route - 1];
    let k = br.idx(q.rs - 4);
    for (; k >= 0; k--) if (!(br.FLAG[k] & 4)) return csOf(q.route, k * br.ds);
    return wrapS(respawnS(br.sEntry));
  }
  /** frame on a route at local s, running off a branch's ends onto the main road */
  const frameOn = (route, u) => {
    if (!route) return frameAt(u);
    const br = branches[route - 1];
    if (u > br.length) return frameAt(br.sExit + u - br.length);
    if (u < 0) return frameAt(br.sEntry + u);
    return br.frameAt(u);
  };
  /** the path a kart will drive `d` m ahead of (route, rs): main → `plan` (a branch index, -1 = none) → main.
   *  Returns { rt (a route object), s (local s on it) } — rt.idx(s), rt.pointAt(s, lat) etc. */
  function pathAt(route, rs, d, plan = -1) {
    if (route) {
      const br = branches[route - 1], u = rs + d;
      if (u > br.length) return { rt: track, s: br.sExit + (u - br.length) };
      if (u < 0) return { rt: track, s: br.sEntry + u };
      return { rt: br, s: u };
    }
    if (plan >= 0) {
      const br = branches[plan], e = dS(rs, br.sEntry);
      if (d >= e && e > -br.zoneIn - 6) return pathAt(plan + 1, 0, d - e);
    }
    return { rt: track, s: rs + d };
  }

  const track = {
    def, id: def.id, name: def.name, theme: def.theme || def.id, laps: def.laps ?? 3,
    length, n, ds, X, Y, Z, TX: M.TX, TZ: M.TZ, TY: M.TY, HW, TB: M.TB, U: M.U, OFFL, OFFR, CURV: M.CURV, HEAD: M.HEAD, AIL: M.AIL, FLAG, props: M.props,
    OPENL: M.OPENL, OPENR: M.OPENR, JR: M.JR, JH: M.JH,
    gaps: M.gaps, jumps: M.jumps, pads: M.pads, itemRows: M.itemRows, starRows: M.starRows, checkpoints, grid, water, killY, gapFloor,
    bounds: { minX, maxX, minZ, maxZ, minY, maxY },
    wrapS, dS, sOf: M.sOf, idx, frameAt, pointAt, project, respawnS, nearest: M.nearest,
    /** heading change (rad, + = left) between s+a and s+b ahead — AI corner reading */
    turnAhead: M.turnAhead,
    // ---- branches (empty on an unbranched track; every helper below reduces to the main-road one)
    closed: true, off: 0, route: 0, csOff: 0, mainS: wrapS,
    branches, routes, nAll,
    /** every item-box / star row on every route, routes in order (items.js builds its boxes/stars from these) */
    allItemRows: [...M.itemRows.map(r => ({ ...r, route: 0, rs: r.s })), ...branches.flatMap(br => br.itemRows.map(r => ({ ...r, route: br.route, rs: r.s, s: br.mainS(r.s) })))],
    allStarRows: [...M.starRows.map(r => ({ ...r, route: 0 })), ...branches.flatMap(br => br.starRows.map(r => ({ ...r, route: br.route, s: br.mainS(r.s), points: r.points.map(q => ({ ...q, rs: q.s, s: br.mainS(q.s) })) })))],
    routeOfI, csOf, csLoc, csPoint, respawnCS, frameOn, pathAt,
    /** project onto ONE route only (no junction switching; `hint` is that route's own sample index) */
    projectOn: (route, p, hint = -1, o = {}) => (route ? branches[route - 1] : M).projectLocal(p, hint, o),
    /** a kart's frame `d` m ahead on its own route (k.route / k.rs; plain frameAt(k.s + d) on the main road) */
    kartFrame: (k, d = 0) => k.route ? frameOn(k.route, k.rs + d) : frameAt(k.s + d),
    /** heading change between a and b m ahead of (route, rs), across a branch's end */
    turnOn: (route, rs, a, b) => route ? wrapA(frameOn(route, rs + b).yaw - frameOn(route, rs + a).yaw) : M.turnAhead(rs, a, b),
    branchById: id => branches.find(b => b.id === id) || null,
  };
  routes[0] = track;
  return track;
}

/** Resolve one `def.branches[]` entry into a route (open spline + the u → main s mapping). */
function buildBranch(def, bd, bi, M, shared) {
  if (!bd.points || bd.points.length < 3) throw new Error(`track ${def.id}: branch ${bd.id ?? bi} needs at least 3 points`);
  const R = buildRoute(bd.points, { closed: false, id: `${def.id}/${bd.id}`, width: bd.width ?? def.width ?? 16, offroad: bd.offroad ?? def.offroad,
    defaults: { ...(def.defaults || {}), ...(bd.defaults || {}) }, gaps: bd.gaps, jumps: bd.jumps, noRespawn: bd.noRespawn,
    pads: bd.pads, items: bd.items, stars: bd.stars, needsBoost: bd.needsBoost }, shared);
  Object.assign(R, {
    def: bd, id: bd.id ?? `b${bi}`, name: bd.name ?? bd.id ?? `branch ${bi}`, index: bi, route: bi + 1, side: bd.side ?? null, sideTo: bd.sideTo ?? bd.side ?? null,
    ai: { easy: 0, medium: 0.25, hard: 0.5, ...(bd.ai || {}) }, hidden: bd.hidden !== false, needsBoost: !!bd.needsBoost || R.gaps.some(g => g.needsBoost),
    from: bd.from, to: bd.to,
  });
  return R;
}

/**
 * Where a branch meets the main road: the junction zones at both ends (where the two corridors
 * overlap), the u → main-s mapping (projection inside the zones, linear between them, monotonic),
 * the wall openings on both routes and the route-switch hints. Pure geometry, run once per build.
 */
function analyseJunctions(M, br) {
  const n = br.n, MS = new Float64Array(n), LATM = new Float64Array(n), KM = new Int32Array(n);
  const q = {};
  let hint = -1;
  for (let j = 0; j < n; j++) {
    M.projectLocal({ x: br.X[j], y: br.Y[j], z: br.Z[j] }, hint, q);
    KM[j] = q.i; LATM[j] = q.lat; MS[j] = q.s; hint = q.i;
  }
  // corridors overlap at branch sample j (the branch's cross-section reaches into main's corridor)
  const overlap = j => {
    const k = KM[j], side = LATM[j] >= 0 ? 1 : -1, mOff = side > 0 ? M.OFFL[k] : M.OFFR[k];
    const bOff = Math.max(br.OFFL[j], br.OFFR[j]);
    return Math.abs(LATM[j]) - (br.HW[j] + bOff) < M.HW[k] + mOff && Math.abs(br.Y[j] - M.Y[k]) < 6;
  };
  let jE = 0; while (jE < n - 1 && overlap(jE + 1)) jE++;
  let jX = n - 1; while (jX > 0 && overlap(jX - 1)) jX--;
  if (!overlap(0) || !overlap(n - 1)) br.junctionError = `ends not on the main road (start overlaps: ${overlap(0)}, end overlaps: ${overlap(n - 1)})`;
  if (jE >= jX) { br.junctionError = (br.junctionError ? br.junctionError + '; ' : '') + 'branch overlaps the main road along its whole length'; jE = Math.min(jE, n >> 1); jX = Math.max(jX, jE + 1); }
  br.jIn = jE; br.jOut = jX; br.zoneIn = jE * br.ds; br.zoneOut = (n - 1 - jX) * br.ds;
  // mapping u → main s, unwrapped from the entry: the projection of the branch centre while it's still ON the
  // main road (well conditioned there — further out, inside a bend, projections race ahead), linear in u
  // between those two anchors, monotonic
  const L = M.length, base = MS[0];
  const unw = s => base + M.dS(base, s);
  const onRoad = j => Math.abs(LATM[j]) <= M.HW[KM[j]];
  let aE = 0; while (aE < jE && onRoad(aE + 1)) aE++;
  let aX = n - 1; while (aX > jX && onRoad(aX - 1)) aX--;
  for (let j = 0; j <= aE; j++) MS[j] = unw(MS[j]);
  for (let j = aX; j < n; j++) MS[j] = unw(MS[j]);
  if (MS[aX] <= MS[aE]) MS[aX] = MS[aE] + 1;   // (a broken branch: the gate reports it)
  for (let j = aE + 1; j < aX; j++) MS[j] = lerp(MS[aE], MS[aX], (j - aE) / (aX - aE));
  for (let j = 1; j < n; j++) if (MS[j] <= MS[j - 1]) MS[j] = MS[j - 1] + 1e-3;
  br.anchorIn = aE * br.ds; br.anchorOut = (n - 1 - aX) * br.ds;
  /** 0 = use the kart's own main-road projection for s (junctions), 1 = the u → s mapping */
  const B = ROUTE.BLEND, uA = br.anchorIn, uB = br.length - br.anchorOut;
  br.blendW = u => u <= uA ? 0 : u >= uB ? 0 : u < uA + B ? (u - uA) / B : u > uB - B ? (uB - u) / B : 1;
  br.MS = MS; br.KM = KM; br.LATM = LATM;
  br.sEntry = M.wrapS(MS[0]); br.sExit = M.wrapS(MS[n - 1]); br.span = MS[n - 1] - MS[0];
  br.crossesStart = MS[n - 1] >= L || MS[0] < 0;
  /** branch u → equivalent main-road s (monotonic in u) */
  br.mainS = u => { const f = clamp(u / br.ds, 0, n - 1), j = Math.min(Math.floor(f), n - 2); return M.wrapS(lerp(MS[j], MS[j + 1], f - j)); };
  /** main-road s (inside the span) → branch u (inverse of mainS; netgame uses it for remote karts) */
  br.uOfMainS = s => {
    const v = base + M.dS(base, s);
    if (v <= MS[0]) return 0; if (v >= MS[n - 1]) return br.length;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (MS[m] <= v) lo = m; else hi = m; }
    const t = (v - MS[lo]) / Math.max(1e-9, MS[lo + 1] - MS[lo]);
    return (lo + clamp(t, 0, 1)) * br.ds;
  };

  // ---- wall openings + switch hints
  const qa = {}, qb = {};
  const inMain = (x, y, z, h) => { M.projectLocal({ x, y, z }, h, qa); const lim = qa.lat > 0 ? M.HW[qa.i] + M.OFFL[qa.i] : M.HW[qa.i] + M.OFFR[qa.i]; return Math.abs(qa.lat) <= lim + 0.01 && Math.abs(y - qa.y) < ROUTE.DY; };
  const inBranch = (x, y, z, h) => { br.projectLocal({ x, y, z }, h, qb); const lim = qb.lat > 0 ? br.HW[qb.i] + br.OFFL[qb.i] : br.HW[qb.i] + br.OFFR[qb.i]; return qb.past <= 0.01 && Math.abs(qb.lat) <= lim + 0.01 && Math.abs(y - qb.y) < ROUTE.DY; };
  const zone = j => j <= jE || j >= jX;
  // branch samples in the zones: switch → main, hint = its nearest main sample; open the walls that face into main's corridor
  for (let j = 0; j < n; j++) {
    if (!zone(j)) continue;
    br.JR[j] = 1; br.JH[j] = KM[j];
    for (const side of [1, -1]) {
      if ((side > 0 ? br.props[j].wallL : br.props[j].wallR) === 'fall') continue;
      const lx = br.TZ[j], lz = -br.TX[j];
      let lat = br.HW[j] + (side > 0 ? br.OFFL[j] : br.OFFR[j]);
      const w = br.pointAt(j * br.ds, side * lat);
      if (!inMain(w.x, w.y, w.z, KM[j])) continue;
      let far = lat;
      for (let e = 0.5; e < 60; e += 0.5) { const x = br.X[j] + lx * side * (lat + e), z = br.Z[j] + lz * side * (lat + e); if (!inMain(x, w.y, z, KM[j])) break; far = lat + e; }
      if (side > 0) br.OPENL[j] = far + 0.3; else br.OPENR[j] = far + 0.3;
    }
  }
  // main samples near the zones: switch → this branch, hint = the branch sample; open main's walls that face into the branch corridor
  const mark = new Map();
  for (let j = 0; j < n; j++) if (zone(j)) for (let d = -5; d <= 5; d++) {
    const k = (KM[j] + d + M.n) % M.n;
    if (!mark.has(k)) mark.set(k, j);
  }
  for (const [k, j] of mark) {
    if (M.JR[k] && M.JR[k] !== br.route) { if (!/shares/.test(br.junctionError || '')) br.junctionError = (br.junctionError ? br.junctionError + '; ' : '') + 'shares a junction stretch with another branch'; continue; }
    M.JR[k] = br.route; M.JH[k] = j;
    for (const side of [1, -1]) {
      if ((side > 0 ? M.props[k].wallL : M.props[k].wallR) === 'fall') continue;
      const lx = M.TZ[k], lz = -M.TX[k];
      const lat = M.HW[k] + (side > 0 ? M.OFFL[k] : M.OFFR[k]);
      const w = M.pointAt(k * M.ds, side * lat);
      if (!inBranch(w.x, w.y, w.z, j)) continue;
      let far = lat;
      for (let e = 0.5; e < 60; e += 0.5) { const x = M.X[k] + lx * side * (lat + e), z = M.Z[k] + lz * side * (lat + e); if (!inBranch(x, w.y, z, j)) break; far = lat + e; }
      if (side > 0) M.OPENL[k] = Math.max(M.OPENL[k], far + 0.3); else M.OPENR[k] = Math.max(M.OPENR[k], far + 0.3);
    }
  }
}

export const _internals = { crPoint, smooth01 };
