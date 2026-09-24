// scenery/propkit.js — prop helpers shared by the ice, volcano and beach sceneries (tracks agent #2).
// Not a theme itself. (scenery/kit.js is a different kit, used by castle + star — don't merge them.)
//
// Everything here is about the draw-call budget (DESIGN.md: ≲60 scenery calls on a Steam Deck):
//   • geometry is painted with vertex colours and MERGED per material (`merge`, `paint`)
//   • repeated props are INSTANCED (`instanced`), optional per-instance colour tint
//   • placement never blocks the drivable corridor (`ctx.isClear`) and sits ON the ground
//   • `chevrons` puts kid-readable turn-arrow boards on the outside of every tight corner
//   • `lofted` builds a strip that follows the track at a lateral offset (skirts, cliffs, rails)

export function makePropKit(ctx) {
  const { THREE, track, group } = ctx;
  const col = c => (c && c.isColor) ? c : new THREE.Color(c);

  /** Tint every vertex of a geometry (adds/overwrites the `color` attribute). Returns g. */
  function paint(g, c) {
    const cc = col(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }
  /** Per-vertex colour from a function (x, y, z) → hex/Color. */
  function paintBy(g, fn) {
    const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3), tmp = new THREE.Color();
    for (let i = 0; i < n; i++) { const c = fn(p.getX(i), p.getY(i), p.getZ(i)); tmp.set(c); a[i * 3] = tmp.r; a[i * 3 + 1] = tmp.g; a[i * 3 + 2] = tmp.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }
  /** Set every uv of a geometry to one texel (so an untextured part can share a textured material). */
  function uvAt(g, u, v) { const a = g.attributes.uv; if (a) for (let i = 0; i < a.count; i++) a.setXY(i, u, v); return g; }

  /** Merge geometries: position/normal/color (+uv if every part has one). Indexed or not. */
  function merge(geos) {
    geos = geos.filter(Boolean);
    const hasUV = geos.every(g => g.attributes.uv);
    const names = ['position', 'normal', 'color'].concat(hasUV ? ['uv'] : []);
    for (const g of geos) { if (!g.attributes.normal) g.computeVertexNormals(); if (!g.attributes.color) paint(g, 0xffffff); }
    let total = 0; for (const g of geos) total += g.attributes.position.count;
    const out = new THREE.BufferGeometry(), arrs = {};
    for (const a of names) arrs[a] = new Float32Array(total * (a === 'uv' ? 2 : 3));
    const idx = []; let base = 0;
    for (const g of geos) {
      for (const a of names) arrs[a].set(g.attributes[a].array.subarray(0, g.attributes[a].count * g.attributes[a].itemSize), base * (a === 'uv' ? 2 : 3));
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + base);
      else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + base);
      base += g.attributes.position.count;
    }
    for (const a of names) out.setAttribute(a, new THREE.BufferAttribute(arrs[a], a === 'uv' ? 2 : 3));
    out.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  /** geometry transformed by position/rotation/scale — for building merged one-offs. */
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function place(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx, sy, sz } = {}) {
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx ?? s, sy ?? s, sz ?? s);
    return g.applyMatrix4(_m.compose(_p, _q, _s));
  }
  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const vmat2 = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  /**
   * One InstancedMesh for a list of transforms {x,y,z, ry, rx, rz, s | sx,sy,sz, color}.
   * Returns the mesh (already added to the group) or null for an empty list.
   */
  function instanced(geo, mat, list, { name = 'props', shadow = false, receive = false } = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const tmp = new THREE.Color();
    list.forEach((o, i) => {
      setInstance(im, i, o);
      if (o.color != null) im.setColorAt(i, tmp.set(o.color));
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = shadow; im.receiveShadow = receive; im.name = name;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  }
  function setInstance(im, i, o) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); _q.setFromEuler(_e);
    _p.set(o.x, o.y, o.z); _s.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1);
    im.setMatrixAt(i, _m.compose(_p, _q, _s));
  }
  function mesh(geo, mat, { name = 'props', shadow = false, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = shadow; m.receiveShadow = receive; group.add(m); return m;
  }

  // ------------------------------------------------ placement
  const spots = [];
  /** Reserve a round spot if it's clear of the corridor (and other props). Returns {x,y,z,r} or null. */
  function claim(x, z, r, { margin = 1.5, water = 0.35, overlap = true, minY = -Infinity } = {}) {
    if (!ctx.isClear(x, z, r, margin)) return null;
    if (water != null && !ctx.aboveWater(x, z, water)) return null;
    if (overlap) for (const p of spots) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + r) ** 2) return null;
    const y = ctx.groundAt(x, z);
    if (y < minY) return null;
    const s = { x, z, r, y }; spots.push(s); return s;
  }
  /** Point beyond the boundary on one side (+1 = left) at s, `extra` metres out. */
  function beside(s, side, extra = 0) {
    const f = track.frameAt(s), off = side > 0 ? track.OFFL[f.k] : track.OFFR[f.k];
    const lat = side * (f.hw + off + extra);
    return { x: f.x + f.lx * lat, z: f.z + f.lz * lat, f, lat };
  }
  /** Scatter along the course: every `step` m, each side, try a spot `near..far` m past the boundary. */
  function scatter({ step = 10, near = 3, far = 30, r = 2, jitter = 4, chance = 1, rng = ctx.rng, opts = {}, from = 0, to = track.length, sides = [1, -1] } = {}) {
    const out = [];
    for (let s = from; s < to; s += step) for (const side of sides) {
      if (rng() > chance) continue;
      const b = beside(s, side, near + rng() * (far - near));
      const x = b.x + (rng() - 0.5) * jitter, z = b.z + (rng() - 0.5) * jitter;
      const c = claim(x, z, r, opts); if (c) { c.s = s; c.side = side; out.push(c); }
    }
    return out;
  }
  /** Random spots in the whole terrain rectangle. */
  function scatterWide(n, r, opts = {}, rng = ctx.rng) {
    const b = ctx.bounds, out = [];
    for (let i = 0; i < n; i++) { const c = claim(b.x0 + rng() * (b.x1 - b.x0), b.z0 + rng() * (b.z1 - b.z0), r, opts); if (c) out.push(c); }
    return out;
  }

  // ------------------------------------------------ lofted strips along the track
  /**
   * A strip following the track from s0 to s1 (step), through a polyline across the track at each
   * step: edge(s, frame) → [{x,y,z,u?}, …] (same length every time). `flip` reverses the winding.
   * uv: u from the points (default 0..1 across), v = (s − s0) / vScale.
   */
  function lofted(s0, s1, step, edge, { vScale = 8, flip = false } = {}) {
    const pos = [], uv = [], idx = [];
    let cols = -1, row = 0;
    for (let s = s0; s <= s1 + 1e-6; s += step) {
      const f = track.frameAt(s), pts = edge(s, f);
      if (cols < 0) cols = pts.length;
      pts.forEach((p, i) => { pos.push(p.x, p.y, p.z); uv.push(p.u ?? i / (cols - 1), (s - s0) / vScale); });
      if (row > 0) for (let i = 0; i < cols - 1; i++) {
        const a = (row - 1) * cols + i, b = a + 1, c = row * cols + i, d = c + 1;
        if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
      row++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // ------------------------------------------------ corners + chevron signs
  /** Tight corners: contiguous stretches with radius < rMax. [{s0, s1, len, dir (+1 left), apex}] */
  function corners(rMax = 38, minLen = 12) {
    const n = track.n, tight = k => Math.abs(track.CURV[k]) > 1 / rMax;
    const out = [];
    let k0 = 0; while (k0 < n && tight(k0)) k0++;          // start scanning outside a corner
    for (let j = 0; j < n; j++) {
      const k = (k0 + j) % n;
      if (!tight(k)) continue;
      let e = j, sum = 0; while (e < n && tight((k0 + e) % n)) { sum += track.CURV[(k0 + e) % n]; e++; }
      const len = (e - j) * track.ds;
      if (len >= minLen) out.push({ s0: k * track.ds, s1: track.wrapS(k * track.ds + len), len, dir: Math.sign(sum), apex: track.wrapS(k * track.ds + len / 2) });
      j = e;
    }
    return out;
  }
  /** Chevron-arrow boards on the OUTSIDE of each tight corner, facing the oncoming karts. Returns the count. */
  function chevrons({ rMax = 38, spacing = 11, lead = 16, board = [3.2, 1.3], post = 0x8a8f99, extra = 1.4, skip = () => false } = {}) {
    // one texture: arrows point RIGHT (+u); a board on a LEFT turn flips its u
    const tex = canvasTex(256, 104, g => {
      g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 256, 104);
      g.fillStyle = '#e0332c';
      for (let i = 0; i < 3; i++) {
        const x0 = 26 + i * 72;
        g.beginPath(); g.moveTo(x0, 14); g.lineTo(x0 + 40, 52); g.lineTo(x0, 90); g.lineTo(x0 + 22, 90); g.lineTo(x0 + 62, 52); g.lineTo(x0 + 22, 14); g.closePath(); g.fill();
      }
      g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 96);
    });
    const boards = [], posts = [];
    const [bw, bh] = board;
    for (const c of corners(rMax)) {
      if (skip(c)) continue;
      const outside = -c.dir;                              // turning left → boards on the right
      for (let s = c.s0 - lead; s <= c.s0 + c.len * 0.8; s += spacing) {
        const b = beside(s, outside, extra);
        if (track.FLAG[track.idx(s)] & 9) continue;        // not in gaps or tunnels
        const gy = Math.max(ctx.groundAt(b.x, b.z), track.pointAt(s, b.lat).y - 0.4);
        // face the karts coming toward it (normal = −tangent), turned a little toward the road
        const f = b.f, yaw = Math.atan2(-f.tx, -f.tz) - outside * 0.35;
        const q = new THREE.PlaneGeometry(bw, bh);
        if (c.dir > 0) { const uv = q.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
        place(q, { x: b.x, y: gy + 1.5 + bh / 2, z: b.z, ry: yaw });
        boards.push(paint(q, 0xffffff));
        for (const d of [-bw * 0.35, bw * 0.35]) {
          const p = new THREE.CylinderGeometry(0.08, 0.08, 1.6 + bh / 2, 5);
          place(p, { x: b.x + Math.cos(yaw) * d, y: gy + (1.6 + bh / 2) / 2, z: b.z - Math.sin(yaw) * d });
          posts.push(paint(p, post));
        }
      }
    }
    if (!boards.length) return 0;
    mesh(merge(boards), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }), { name: 'chevrons', receive: false });
    mesh(merge(posts), vmat, { name: 'chevron-posts' });
    return boards.length;
  }

  /** A canvas texture (sRGB) drawn by fn(g, w, h). */
  function canvasTex(w, h, fn, { repeat = null, mip = true } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    return t;
  }

  /** Far ground beyond the terrain grid (a frame of 4 quads around it) so its square edge melts into the fog. */
  function farGround(texName, color, y) {
    const B = ctx.bounds, R = 3000, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
    const rect = (xa, za, xb, zb) => { const g = new THREE.PlaneGeometry(xb - xa, zb - za); g.rotateX(-Math.PI / 2); g.translate((xa + xb) / 2, y, (za + zb) / 2); const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 12, p.getZ(i) / 12); return paint(g, color); };
    const parts = [rect(cx - R, cz - R, B.x0 + 2, cz + R), rect(B.x1 - 2, cz - R, cx + R, cz + R), rect(B.x0, cz - R, B.x1, B.z0 + 2), rect(B.x0, B.z1 - 2, B.x1, cz + R)];
    const t = ctx.loadTex(texName, null);
    return mesh(merge(parts), new THREE.MeshLambertMaterial({ map: t, vertexColors: true }), { name: 'farground' });
  }
  /** Shrink the track's infinite `water` plane to the terrain rectangle (so it doesn't show past the far ground). */
  function fitWater(water) {
    const B = ctx.bounds;
    water.scale.set((B.x1 - B.x0) / 4000, (B.z1 - B.z0) / 4000, 1);
    water.position.set((B.x0 + B.x1) / 2, water.position.y, (B.z0 + B.z1) / 2);
  }

  /** The terrain's own vertex tint at (x, z) (ground colour → hill colours, as trackmesh paints it) — so a
   *  prop that rebuilds a piece of ground (a tunnel cap) matches the terrain around it. */
  const T = ctx.def.terrain || {}, hills = T.hills || [];
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function terrainTint(x, z, out = new THREE.Color()) {
    out.set(T.colors?.ground ?? 0xfff4d6);
    for (const hl of hills) if (hl.color != null) { const d = Math.hypot(x - hl.x, z - hl.z) / hl.r; const k = d >= 1 ? 0 : Math.cos(d * Math.PI / 2) ** 2; out.lerp(_tc.set(hl.color), smooth(0.08, 0.35, k)); }
    return out;
  }
  const _tc = new THREE.Color();

  return { col, paint, paintBy, terrainTint, uvAt, merge, place, vmat, vmat2, instanced, setInstance, mesh, spots, claim, beside, scatter, scatterWide, lofted, corners, chevrons, canvasTex, farGround, fitWater };
}
