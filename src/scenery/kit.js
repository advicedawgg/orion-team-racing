// scenery/kit.js — small geometry kit shared by the castle and star sceneries (tracks agent).
// Not a theme itself (there is no track with theme 'kit'). Pure helpers over ctx.THREE + track:
//   P(k, lat, dy)        world point on the (banked) track surface at sample k, lateral `lat`
//   strip(rows, opts)    a grid mesh through rows of points (one row per sample), world-ish UVs
//   box / cyl / cone     positioned primitives with world-space UVs (so one texture tiles evenly)
//   paint(g, color)      vertex colours;  worldUV(g, scale);  bake(g) → position/normal/uv/color
//   buckets()            collect geometry per material name, then .mesh(name, material) merges
//                        each bucket into ONE draw call (typed-array merge, no argument spreading).
import { bankY } from '../track.js';

export function makeKit(ctx) {
  const { THREE, track } = ctx;
  const n = track.n, X = track.X, Y = track.Y, Z = track.Z, HW = track.HW, TB = track.TB;
  const wrap = k => ((k % n) + n) % n;
  const lxA = k => track.TZ[wrap(k)], lzA = k => -track.TX[wrap(k)];
  /** world point [x,y,z] on the track surface at sample k, lateral lat (+ = left), raised dy */
  const P = (k, lat, dy = 0) => { k = wrap(k); return [X[k] + lxA(k) * lat, bankY(Y[k], lat, HW[k], TB[k]) + dy, Z[k] + lzA(k) * lat]; };
  const col = new THREE.Color();

  function paint(g, c, c2 = null) {
    const cnt = g.attributes.position.count, a = new Float32Array(cnt * 3);
    col.set(c);
    for (let i = 0; i < cnt; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    if (c2 != null) { // vertical gradient: c at the bottom → c2 at the top
      const c2c = new THREE.Color(c2), p = g.attributes.position; let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < cnt; i++) { lo = Math.min(lo, p.getY(i)); hi = Math.max(hi, p.getY(i)); }
      for (let i = 0; i < cnt; i++) { const t = (p.getY(i) - lo) / (hi - lo || 1); a[i * 3] = col.r + (c2c.r - col.r) * t; a[i * 3 + 1] = col.g + (c2c.g - col.g) * t; a[i * 3 + 2] = col.b + (c2c.b - col.b) * t; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }
  /** UVs from world position, projected along each vertex's dominant normal axis (boxes tile evenly). */
  function worldUV(g, s = 4) {
    const p = g.attributes.position, nm = g.attributes.normal, cnt = p.count, uv = new Float32Array(cnt * 2);
    for (let i = 0; i < cnt; i++) {
      const ax = Math.abs(nm.getX(i)), ay = Math.abs(nm.getY(i)), az = Math.abs(nm.getZ(i));
      let u, v;
      if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
      uv[i * 2] = u / s; uv[i * 2 + 1] = v / s;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
  /** cylindrical UVs (towers): u = arc length, v = height, both / s */
  function cylUV(g, cx, cz, s = 4) {
    const p = g.attributes.position, cnt = p.count, uv = new Float32Array(cnt * 2);
    let rMax = 0; for (let i = 0; i < cnt; i++) rMax = Math.max(rMax, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz));
    for (let i = 0; i < cnt; i++) {
      const a = Math.atan2(p.getZ(i) - cz, p.getX(i) - cx);
      uv[i * 2] = (a + Math.PI) * rMax / s; uv[i * 2 + 1] = p.getY(i) / s;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
  const place = (g, x, y, z, yaw = 0) => { if (yaw) g.rotateY(yaw); g.translate(x, y, z); return g; };
  /** box centred at (x, y + h/2, z) — i.e. y is the BOTTOM — rotated yaw about Y */
  const box = (w, h, d, x, y, z, yaw = 0, c = 0xffffff, uvS = 4) => worldUV(paint(place(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, yaw), c), uvS);
  const cyl = (rt, rb, h, seg, x, y, z, c = 0xffffff, uvS = 4, open = false) => cylUV(paint(place(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), x, y + h / 2, z), c), x, z, uvS);
  const cone = (r, h, seg, x, y, z, c = 0xffffff) => worldUV(paint(place(new THREE.ConeGeometry(r, h, seg), x, y + h / 2, z), c), 4);
  const sphere = (r, x, y, z, c = 0xffffff, ws = 10, hs = 7) => worldUV(paint(place(new THREE.SphereGeometry(r, ws, hs), x, y, z), c), 4);

  /**
   * A grid mesh through `rows` (array of rows, each an array of [x,y,z]); consecutive rows are
   * joined. Repeat a point in a row to get a crisp crease (the zero-area face between the copies
   * doesn't affect the normals). u runs along the rows (metres / uS), v across them (metres / vS).
   */
  function strip(rows, { uS = 4, vS = 4, color = 0xffffff, colors = null, vAbs = false } = {}) {
    const R = rows.length; if (R < 2) return null;
    const m = rows[0].length;
    const pos = new Float32Array(R * m * 3), uv = new Float32Array(R * m * 2), cl = new Float32Array(R * m * 3);
    let along = 0;
    col.set(color);
    for (let r = 0; r < R; r++) {
      const row = rows[r];
      if (r > 0) { const a = rows[r - 1][0], b = row[0]; along += Math.hypot(b[0] - a[0], b[2] - a[2]); }
      let across = 0;
      if (colors) col.set(colors(r));
      for (let c = 0; c < m; c++) {
        const p = row[c], i = r * m + c;
        if (c > 0) { const q = row[c - 1]; across += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
        pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
        uv[i * 2] = along / uS; uv[i * 2 + 1] = (vAbs ? p[1] : across) / vS;
        cl[i * 3] = col.r; cl[i * 3 + 1] = col.g; cl[i * 3 + 2] = col.b;
      }
    }
    const idx = [];
    for (let r = 0; r + 1 < R; r++) for (let c = 0; c + 1 < m; c++) {
      const a = r * m + c, b = a + 1, d = a + m, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  /** make sure a geometry has indexed position/normal/uv/color */
  function bake(g) {
    if (!g.index) { const cnt = g.attributes.position.count, ix = new Uint32Array(cnt); for (let i = 0; i < cnt; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.color) paint(g, 0xffffff);
    return g;
  }
  /** typed-array merge of baked geometries (position, normal, uv, color, index) */
  function merge(geos) {
    geos = geos.filter(Boolean).map(bake);
    let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), cl = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const g of geos) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3);
      uv.set(g.attributes.uv.array, ov * 2); cl.set(g.attributes.color.array, ov * 3);
      const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx[oi + i] = gi[i] + ov;
      ov += c; oi += gi.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  function buckets(group) {
    const map = new Map();
    return {
      add(name, g) { if (!g) return; if (!map.has(name)) map.set(name, []); map.get(name).push(g); },
      has: name => map.has(name) && map.get(name).length > 0,
      /** merge bucket `name` into one mesh with `material`; opts {cast, receive, order} */
      mesh(name, material, { cast = false, receive = true, order = 0, frustum = true } = {}) {
        const list = map.get(name); if (!list || !list.length) return null;
        const m = new THREE.Mesh(merge(list), material);
        m.name = 'scenery:' + name; m.castShadow = cast; m.receiveShadow = receive; m.renderOrder = order; m.frustumCulled = frustum;
        group.add(m); map.delete(name); return m;
      },
    };
  }
  /** An InstancedMesh from a list of {x,y,z,yaw,s|sx,sy,sz} */
  function instanced(geo, material, list, name, { cast = false } = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(bake(geo), material, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), E = new THREE.Euler();
    list.forEach((o, i) => {
      E.set(o.rx || 0, o.yaw || 0, o.rz || 0); q.setFromEuler(E);
      sc.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1); p.set(o.x, o.y, o.z);
      im.setMatrixAt(i, m4.compose(p, q, sc));
    });
    im.name = 'scenery:' + name; im.castShadow = cast; im.computeBoundingSphere();
    return im;
  }

  /** Per-sample value of a scenery-only inherited prop on the authored points (e.g. `look`). */
  function inherited(key, dflt) {
    const per = []; let cur = def0(key, dflt);
    for (const p of ctx.def.points) { if (p[key] !== undefined) cur = p[key]; per.push(cur); }
    const N = ctx.def.points.length;
    return k => per[Math.floor(track.U[wrap(k)]) % N];
  }
  const def0 = (key, dflt) => ctx.def.defaults?.[key] ?? dflt;

  /** simple spatial hash over the centre-line samples: `near(x, z, r)` → sample indices within r (2D) */
  const CELL = 12, hash = new Map();
  for (let k = 0; k < n; k++) { const key = Math.floor(X[k] / CELL) + ',' + Math.floor(Z[k] / CELL); if (!hash.has(key)) hash.set(key, []); hash.get(key).push(k); }
  function samplesNear(x, z, r) {
    const out = [], c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) { const l = hash.get(i + ',' + j); if (l) for (const k of l) if ((X[k] - x) ** 2 + (Z[k] - z) ** 2 <= r * r) out.push(k); }
    return out;
  }
  /** true if another stretch of road (≥ `apart` m away along the loop) runs BELOW (x,z,y) within its corridor */
  function roadBelow(x, z, y, k0, apart = 30, clear = 3.5) {
    for (const k of samplesNear(x, z, 20)) {
      if (Math.abs(track.dS(k0 * track.ds, k * track.ds)) < apart) continue;
      if (Y[k] > y - clear) continue;
      const lat = (x - X[k]) * lxA(k) + (z - Z[k]) * lzA(k);
      const lim = HW[k] + Math.max(track.OFFL[k], track.OFFR[k]) + 2.5;
      if (Math.abs(lat) < lim) return true;
    }
    return false;
  }

  /** a canvas texture (sRGB) */
  function canvasTex(w, h, draw, { repeat = false } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  /** a textured quad (for atlas cells): centre (x,y,z), size w×h, facing yaw (+Z rotated), uv rect [u0,v0,u1,v1] */
  function quad(w, h, x, y, z, yaw, uvr, c = 0xffffff, flip = false) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv; const [u0, v0, u1, v1] = uvr;
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, flip ? u1 + (u0 - u1) * u : u0 + (u1 - u0) * u, v0 + (v1 - v0) * v); }
    return paint(place(g, x, y, z, yaw), c);
  }

  return { P, wrap, lxA, lzA, paint, worldUV, cylUV, place, box, cyl, cone, sphere, strip, bake, merge, buckets, instanced, inherited, samplesNear, roadBelow, canvasTex, quad };
}
