// scenery/beach.js — Bubbly Beach props (placeholder-quality, written by core; the tracks agent
// may rewrite it). Everything repeated is INSTANCED; the one-offs are merged per material.
// Contract (DESIGN.md "Scenery hook"): default export build(ctx) → optional { update(dt, t) }.
//   ctx = { THREE, group, track, def, env, rng, loadTex, groundAt(x,z), trackGroundAt(x,z),
//           isClear(x,z,r), aboveWater(x,z,h), corridorInfo(x,z), bounds }

export default function build(ctx) {
  const { THREE, group, track, rng, groundAt, isClear, aboveWater } = ctx;
  const water = track.water;
  const updaters = [];
  const col = c => new THREE.Color(c);

  /** tint every vertex of a geometry */
  const paint = (g, c) => { const cc = col(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const merge = geos => {
    const out = new THREE.BufferGeometry(), attrs = ['position', 'normal', 'color'];
    const arr = Object.fromEntries(attrs.map(a => [a, []])); const idx = []; let base = 0;
    for (const g of geos) { for (const a of attrs) arr[a].push(...g.attributes[a].array); if (g.index) for (const i of g.index.array) idx.push(i + base); else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + base); base += g.attributes.position.count; }
    for (const a of attrs) out.setAttribute(a, new THREE.Float32BufferAttribute(arr[a], 3));
    out.setIndex(idx); return out;
  };
  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });

  // ------------------------------------------------ placement along the course
  const spots = [];
  const tryPlace = (x, z, r, list) => {
    if (!isClear(x, z, r, 1.5) || !aboveWater(x, z, 0.35)) return false;
    for (const p of spots) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + r) ** 2) return false;
    const s = { x, z, r, y: groundAt(x, z) }; spots.push(s); list.push(s); return true;
  };
  const palms = [], brollies = [], rocks = [];
  for (let s = 0; s < track.length; s += 9) {
    for (const side of [1, -1]) {
      const f = track.frameAt(s);
      const off = side > 0 ? track.OFFL[f.k] : track.OFFR[f.k];
      const base = f.hw + off + 3;
      const roll = rng();
      const lat = side * (base + rng() * 26);
      const x = f.x + f.lx * lat + (rng() - 0.5) * 4, z = f.z + f.lz * lat + (rng() - 0.5) * 4;
      if (roll < 0.55) tryPlace(x, z, 2.2, palms);
      else if (roll < 0.68) tryPlace(x, z, 2.0, brollies);
      else if (roll < 0.8) tryPlace(x, z, 2.5, rocks);
    }
  }
  // a few far-away palms for the skyline
  for (let i = 0; i < 90; i++) {
    const b = ctx.bounds, x = b.x0 + rng() * (b.x1 - b.x0), z = b.z0 + rng() * (b.z1 - b.z0);
    tryPlace(x, z, 3, palms);
  }

  // ------------------------------------------------ palm tree: bent trunk + crown (two instanced meshes)
  {
    const trunkParts = [], crownParts = [];
    const H = 7, segs = 5, lean = 1.8;
    const bend = t => [lean * t * t, H * t, 0];
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs, a = bend(t0), b = bend(t1);
      const r0 = 0.32 - 0.12 * t0, r1 = 0.32 - 0.12 * t1;
      const g = new THREE.CylinderGeometry(r1, r0 * 1.08, Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.02, 6, 1);
      g.rotateZ(-Math.atan2(b[0] - a[0], b[1] - a[1])); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
      trunkParts.push(paint(g, i % 2 ? 0x9a6b3f : 0xb07e4c));
    }
    const top = bend(1);
    for (let i = 0; i < 7; i++) {
      const ang = i / 7 * Math.PI * 2 + 0.3;
      const frond = new THREE.PlaneGeometry(0.9, 3.4, 1, 3);
      const p = frond.attributes.position;
      for (let v = 0; v < p.count; v++) { const y = p.getY(v) + 1.7; p.setXYZ(v, p.getX(v) * (1 - y / 4.2), -0.28 * y * y, y); }
      frond.computeVertexNormals();
      frond.rotateY(ang); frond.translate(top[0], top[1], top[2]);
      crownParts.push(paint(frond, i % 2 ? 0x3fae4a : 0x55c455));
    }
    for (let i = 0; i < 3; i++) { const c = new THREE.SphereGeometry(0.22, 5, 3); c.translate(top[0] + Math.cos(i * 2.1) * 0.3, top[1] - 0.3, Math.sin(i * 2.1) * 0.3); crownParts.push(paint(c, 0x6b4a2a)); }
    const trunkGeo = merge(trunkParts), crownGeo = merge(crownParts);
    const leafMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const trunks = new THREE.InstancedMesh(trunkGeo, vmat, palms.length), crowns = new THREE.InstancedMesh(crownGeo, leafMat, palms.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    palms.forEach((pl, i) => {
      const s = 0.8 + rng() * 0.6;
      q.setFromAxisAngle(Y, rng() * Math.PI * 2); sc.setScalar(s); p.set(pl.x, pl.y - 0.2, pl.z);
      m.compose(p, q, sc); trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
    });
    for (const im of [trunks, crowns]) { im.castShadow = true; im.receiveShadow = false; im.name = 'palms'; group.add(im); im.computeBoundingSphere(); }
  }

  // ------------------------------------------------ beach umbrellas (striped) + towels: 3 colourways, one instanced mesh each
  if (brollies.length) {
    const VARIANTS = [[0xff5d73, 0xffffff, 0x4ec5f1], [0x2f8fe8, 0xffffff, 0xffd23f], [0xffd23f, 0xff9d2f, 0xff5d73]];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    VARIANTS.forEach(([c1, c2, towelC], vi) => {
      const mine = brollies.filter((_, i) => i % VARIANTS.length === vi);
      if (!mine.length) return;
      const pole = paint(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5).translate(0, 1.15, 0), 0xf5f5f5);
      const g = new THREE.ConeGeometry(1.5, 0.6, 12, 1, true).translate(0, 2.35, 0).toNonIndexed();
      const gp = g.attributes.position, cols = new Float32Array(gp.count * 3), A = col(c1), B = col(c2);
      for (let i = 0; i < gp.count; i += 3) {
        const cx = (gp.getX(i) + gp.getX(i + 1) + gp.getX(i + 2)) / 3, cz = (gp.getZ(i) + gp.getZ(i + 1) + gp.getZ(i + 2)) / 3;
        const seg = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 12), c = seg % 2 ? A : B;
        for (let j = 0; j < 3; j++) { cols[(i + j) * 3] = c.r; cols[(i + j) * 3 + 1] = c.g; cols[(i + j) * 3 + 2] = c.b; }
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
      const towel = paint(new THREE.BoxGeometry(1.0, 0.04, 1.9).translate(1.2, 0.03, 0.4), towelC);
      const im = new THREE.InstancedMesh(merge([pole, g, towel]), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), mine.length);
      mine.forEach((b, i) => { q.setFromAxisAngle(Y, rng() * 6.28); p.set(b.x, b.y, b.z); m.compose(p, q, sc); im.setMatrixAt(i, m); });
      im.castShadow = true; im.name = 'umbrellas'; group.add(im); im.computeBoundingSphere();
    });
  }

  // ------------------------------------------------ rocks
  if (rocks.length) {
    const g = paint(new THREE.DodecahedronGeometry(1, 0), 0xa89c8c);
    const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), rocks.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), E = new THREE.Euler();
    rocks.forEach((r, i) => { E.set(rng() * 3, rng() * 3, rng() * 3); q.setFromEuler(E); const s = 0.8 + rng() * 1.6; sc.set(s * (1 + rng() * 0.5), s * 0.7, s); p.set(r.x, r.y + s * 0.2, r.z); m.compose(p, q, sc); im.setMatrixAt(i, m); });
    im.castShadow = true; im.receiveShadow = true; im.name = 'rocks'; group.add(im); im.computeBoundingSphere();
  }

  // ------------------------------------------------ lighthouse outside the hairpin + tiki huts near the start
  {
    const parts = [];
    // lighthouse: find the outside of the tightest left-hand corner in the first half
    let best = 0, bk = 0; for (let k = 0; k < track.n; k++) { if (track.CURV[k] > best) { best = track.CURV[k]; bk = k; } }
    const f = track.frameAt(bk * track.ds), off = track.OFFR[bk];
    let lx = f.x - f.lx * (f.hw + off + 14), lz = f.z - f.lz * (f.hw + off + 14);
    const ly = groundAt(lx, lz);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.CylinderGeometry(2.2 - i * 0.22 - 0.22, 2.2 - i * 0.22, 2.4, 14); g.translate(lx, ly + 1.2 + i * 2.4, lz);
      parts.push(paint(g, i % 2 ? 0xffffff : 0xe0332c));
    }
    const gal = new THREE.CylinderGeometry(1.7, 1.7, 0.35, 14); gal.translate(lx, ly + 14.6, lz); parts.push(paint(gal, 0x2d3142));
    const lamp = new THREE.CylinderGeometry(1.0, 1.0, 1.6, 10); lamp.translate(lx, ly + 15.6, lz); parts.push(paint(lamp, 0xfff3a0));
    const roof = new THREE.ConeGeometry(1.4, 1.6, 10); roof.translate(lx, ly + 17.2, lz); parts.push(paint(roof, 0xe0332c));
    spots.push({ x: lx, z: lz, r: 4 });
    // tiki huts along the start straight (outside the right-hand fence)
    for (const sOff of [-60, -35, 30]) {
      const fr = track.frameAt(sOff), o = track.OFFR[fr.k];
      const hx = fr.x - fr.lx * (fr.hw + o + 9), hz = fr.z - fr.lz * (fr.hw + o + 9);
      if (!isClear(hx, hz, 3) || !aboveWater(hx, hz)) continue;
      const hy = groundAt(hx, hz);
      const hut = new THREE.BoxGeometry(4, 2.4, 3.4); hut.translate(hx, hy + 1.2, hz); parts.push(paint(hut, 0xe8c58a));
      const rf = new THREE.ConeGeometry(3.4, 2.2, 4); rf.rotateY(Math.PI / 4); rf.translate(hx, hy + 3.5, hz); parts.push(paint(rf, 0xc9a05a));
      for (const [dx, dz] of [[-1.9, -1.6], [1.9, -1.6], [-1.9, 1.6], [1.9, 1.6]]) { const p = new THREE.CylinderGeometry(0.12, 0.12, 2.6, 5); p.translate(hx + dx, hy + 1.3, hz + dz); parts.push(paint(p, 0x8a5c30)); }
    }
    const mesh = new THREE.Mesh(merge(parts), vmat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'landmarks'; group.add(mesh);
  }

  // ------------------------------------------------ sailboats bobbing on the sea
  if (water) {
    const parts = [];
    const hull = new THREE.BoxGeometry(1.6, 0.7, 4.2); hull.translate(0, 0.2, 0); parts.push(paint(hull, 0xffffff));
    const stripe = new THREE.BoxGeometry(1.65, 0.15, 4.25); stripe.translate(0, 0.45, 0); parts.push(paint(stripe, 0x2f6fdc));
    const mast = new THREE.CylinderGeometry(0.07, 0.07, 5, 5); mast.translate(0, 2.8, 0.3); parts.push(paint(mast, 0xdddddd));
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.8, 0.4, 0, 5.1, 0.4, 0, 0.8, -1.8, 0, 0.8, 0.4, 0, 0.8, -1.8, 0, 5.1, 0.4], 3));
    sail.computeVertexNormals(); parts.push(paint(sail, 0xfff6e0));
    const geo = merge(parts);
    const boats = [];
    const b = ctx.bounds;
    for (let i = 0; i < 40 && boats.length < 9; i++) {
      const x = b.x0 + rng() * (b.x1 - b.x0), z = b.z0 + rng() * (b.z1 - b.z0);
      if (aboveWater(x, z, -2.5)) continue;           // needs deep-ish water
      if (!isClear(x, z, 6, 10)) continue;
      boats.push({ x, z, yaw: rng() * 6.28, ph: rng() * 6.28 });
    }
    if (boats.length) {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), boats.length);
      im.name = 'boats'; im.castShadow = true; group.add(im);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1.3, 1.3, 1.3), E = new THREE.Euler();
      const put = t => {
        boats.forEach((bt, i) => { E.set(Math.sin(t * 1.1 + bt.ph) * 0.06, bt.yaw, Math.sin(t * 0.9 + bt.ph) * 0.08); q.setFromEuler(E); p.set(bt.x, water.y + Math.sin(t * 1.3 + bt.ph) * 0.12, bt.z); m.compose(p, q, sc); im.setMatrixAt(i, m); });
        im.instanceMatrix.needsUpdate = true;
      };
      put(0); im.computeBoundingSphere(); im.frustumCulled = false;
      updaters.push((dt, t) => put(t));
    }
  }

  // ------------------------------------------------ bunting flags along the start straight (one mesh)
  {
    const parts = [], PAL = [0xff5d73, 0xffd23f, 0x4ec5f1, 0x6ff08f, 0xb07cff];
    for (const side of [1, -1]) {
      for (let s = -70; s < 40; s += 1.6) {
        const f = track.frameAt(s), off = side > 0 ? track.OFFL[f.k] : track.OFFR[f.k];
        const lat = side * (f.hw + off + 0.35), p = track.pointAt(s, lat);
        const sag = 2.6 - 0.25 * Math.sin(((s + 70) % 8) / 8 * Math.PI);
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.45, 0, 0, 0.45, 0, -0.7, 0], 3));
        tri.computeVertexNormals();
        tri.rotateY(f.yaw); tri.translate(p.x, p.y + sag, p.z);
        parts.push(paint(tri, PAL[Math.abs(Math.round(s / 1.6)) % PAL.length]));
        // rope to the next flag, and a pole every 8 m
        const f2 = track.frameAt(s + 1.6), p2 = track.pointAt(s + 1.6, lat);
        const sag2 = 2.6 - 0.25 * Math.sin(((s + 1.6 + 70) % 8) / 8 * Math.PI);
        const a3 = new THREE.Vector3(p.x, p.y + sag, p.z), b3 = new THREE.Vector3(p2.x, p2.y + sag2, p2.z);
        const rope = new THREE.CylinderGeometry(0.025, 0.025, a3.distanceTo(b3), 3);
        rope.rotateX(Math.PI / 2); rope.lookAt(b3.clone().sub(a3)); rope.translate((a3.x + b3.x) / 2, (a3.y + b3.y) / 2, (a3.z + b3.z) / 2);
        parts.push(paint(rope, 0xf5f5f5));
        if (Math.abs((s + 70) % 8) < 1.6) { const pole = new THREE.CylinderGeometry(0.06, 0.06, 2.9, 5); pole.translate(p.x, p.y + 1.45, p.z); parts.push(paint(pole, 0xf5f5f5)); }
      }
    }
    const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.name = 'bunting'; group.add(mesh);
  }

  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}
