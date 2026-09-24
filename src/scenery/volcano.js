// scenery/volcano.js — Taco Volcano. Contract: DESIGN.md "Scenery hook"; helpers: scenery/propkit.js.
//
// Glowing lava (the track's `water`, re-skinned: unlit + flowing), the Taco Tunnel (inner arch shell
// with glowing lamps, a rock cap that re-covers the terrain's cutting, taco-shell portal arches), a
// giant taco shell sitting in the crater with salsa-lava inside and harmless erupting blobs + smoke,
// the Rock Bridge's arches over the lava lake, cacti, giant chillies, nacho-chip rocks, boulders,
// papel picado over the start straight, candy-striped jump lips, chevron boards. ~25 draw calls.
// No lights are added: everything that glows is MeshBasic (toneMapped:false) or emissive.
import { makePropKit } from './propkit.js';

export default function build(ctx) {
  const { THREE, group, track, def, rng, groundAt, naturalAt } = ctx;
  const K = makePropKit(ctx);
  const { paint, paintBy, merge, place, instanced, mesh, vmat, vmat2 } = K;
  const updaters = [];
  const pick = a => a[(rng() * a.length) | 0];
  const lavaY = track.water?.y ?? -2;

  // ------------------------------------------------ lava: the track's water plane, unlit and flowing
  const water = group.getObjectByName('water');
  if (water) {
    const tex = ctx.loadTex('lava', null, { repeat: [1, 1] });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const B = ctx.bounds;
    tex.repeat.set((B.x1 - B.x0) / 22, (B.z1 - B.z0) / 22);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, toneMapped: false });
    water.material = mat; water.renderOrder = 0;
    K.fitWater(water);
    const c0 = new THREE.Color(0xffffff), c1 = new THREE.Color(0xffc9a0);
    updaters.push((dt, t) => { tex.offset.set(t * 0.006, t * 0.011); mat.color.copy(c0).lerp(c1, 0.5 + 0.5 * Math.sin(t * 1.7)); });
  }
  // the gap faces (trackmesh: the lip's and the landing's front walls) in warm rock instead of beach tan
  { const gf = group.getObjectByName('gapfaces'); if (gf) gf.material.color.set(0x9a5e48); }
  K.farGround('sand', 0xffd9b8, (def.terrain?.base ?? 0) - 0.9);

  // ------------------------------------------------ the Taco Tunnel
  const tunnelRanges = [];
  {
    let run = null;
    for (let k = 0; k <= track.n; k++) {
      const on = k < track.n && (track.FLAG[k] & 8);
      if (on && !run) run = { s0: k * track.ds };
      if (!on && run) { run.s1 = (k - 1) * track.ds; tunnelRanges.push(run); run = null; }
    }
  }
  const ARCH_WALL = 5, ARCH_TOP = 8.8, ROOF = 9.6;
  const archH = (lat, W) => ARCH_WALL + (ARCH_TOP - ARCH_WALL) * Math.sqrt(Math.max(0, 1 - (lat / W) ** 2));
  for (const tr of tunnelRanges) {
    const sA = tr.s0 - 0.5, sB = tr.s1 + 0.5;
    const Wof = f => f.hw + Math.max(track.OFFL[f.k], track.OFFR[f.k]) + 0.2;
    // inner shell (faces inward): wall base → wall top → arch → other wall
    const shell = K.lofted(sA, sB, 1, (s, f) => {
      const W = Wof(f), pts = [];
      const prof = [[-W, -0.6], [-W, ARCH_WALL]];
      for (let i = 1; i < 10; i++) { const l = -W + 2 * W * i / 10; prof.push([l, archH(l, W)]); }
      prof.push([W, ARCH_WALL], [W, -0.6]);
      let u = 0, prev = null;
      for (const [l, h] of prof) {
        const x = f.x + f.lx * l, z = f.z + f.lz * l, y = f.y + h;
        if (prev) u += Math.hypot(l - prev[0], h - prev[1]) / 5; prev = [l, h];
        pts.push({ x, y, z, u });
      }
      return pts;
    }, { vScale: 5, flip: true });
    paintBy(shell, (x, y, z) => 0xe8c8b8);
    const rockTex = ctx.loadTex('rock_volcanic', null);
    const sm = mesh(shell, new THREE.MeshLambertMaterial({ map: rockTex, vertexColors: true, side: THREE.DoubleSide }), { name: 'tunnel-shell', shadow: true });
    sm.receiveShadow = true;

    // glow: a lava-light strip along each wall base and down the ceiling, lamps every 9 m
    const glow = [];
    const strip = (latF, h0, h1, c) => K.lofted(sA + 1, sB - 1, 1, (s, f) => { const W = Wof(f) - 0.05, l = latF * W; return [{ x: f.x + f.lx * l, y: f.y + h0, z: f.z + f.lz * l }, { x: f.x + f.lx * l, y: f.y + h1, z: f.z + f.lz * l }]; }, { flip: latF > 0 });
    glow.push(paint(strip(1, 0.25, 0.75, 0), 0xff8a1f), paint(strip(-1, 0.25, 0.75, 0), 0xff8a1f));
    glow.push(paint(K.lofted(sA + 1, sB - 1, 1, (s, f) => [-0.5, 0.5].map(l => ({ x: f.x + f.lx * l, y: f.y + ARCH_TOP - 0.08, z: f.z + f.lz * l })), { flip: false }), 0xffd35a));
    for (let s = sA + 4, i = 0; s < sB - 3; s += 9, i++) {
      const f = track.frameAt(s), side = i % 2 ? 1 : -1, W = Wof(f) - 0.35, l = side * W;
      const lamp = new THREE.SphereGeometry(0.5, 10, 7);
      place(lamp, { x: f.x + f.lx * l, y: f.y + 3.6, z: f.z + f.lz * l, sy: 1.4 });
      glow.push(paint(lamp, 0xffe066));
    }
    mesh(merge(glow), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }), { name: 'tunnel-glow', receive: false });

    // rock cap: rebuilds the mountain over the terrain's V-cutting (edges sink under the real terrain)
    const EX = 24, NL = 16;
    const capY = (s, f, l) => {
      const W = Wof(f), x = f.x + f.lx * l, z = f.z + f.lz * l, a = Math.abs(l);
      const roof = f.y + ROOF - Math.max(0, a - W - 1) * 0.9;
      const nat = naturalAt(x, z);
      return { x, z, y: a >= W + EX - 0.01 ? nat - 1.2 : Math.max(nat + 0.12, roof) };
    };
    const lats = []; for (let i = 0; i <= NL; i++) { const t = -1 + 2 * i / NL; lats.push(Math.sign(t) * Math.abs(t) ** 1.3); }
    const cap = K.lofted(sA - 0.5, sB + 0.5, 2, (s, f) => lats.map(t => { const W = Wof(f), p = capY(s, f, t * (W + EX)); return { ...p, u: p.x / 9 }; }), { vScale: 1, flip: false });
    // world-ish uvs (x/9, z/9) so it tiles like the terrain
    { const p = cap.attributes.position, uv = cap.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 9, p.getZ(i) / 9); }
    // portal faces: from the cutting (or the arch) up to the cap profile
    const faces = [];
    for (const [s, dir] of [[sA, -1], [sB, 1]]) {
      const f = track.frameAt(s), W = Wof(f), pos = [], uv = [], idx = [];
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const l = -(W + EX) + 2 * (W + EX) * i / N, c = capY(s, f, l);
        const low = Math.abs(l) <= W ? f.y + archH(l, W) : Math.min(groundAt(c.x, c.z), c.y);
        const hi = Math.max(low, c.y);
        pos.push(c.x, low - 0.05, c.z, c.x, hi + 0.05, c.z);
        uv.push(c.x / 9, low / 9, c.x / 9, hi / 9);
        if (i) { const a = (i - 1) * 2; if (dir < 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      faces.push(g);
    }
    // same texture, uv scale and vertex tint as the terrain, so the rebuilt ground is seamless
    const tint = (x, y, z) => K.terrainTint(x, z);
    const capMesh = mesh(merge([cap, ...faces].map(g => paintBy(g, tint))), new THREE.MeshLambertMaterial({ map: ctx.loadTex(def.tex?.ground || 'sand', null), vertexColors: true, side: THREE.DoubleSide }), { name: 'tunnel-cap', shadow: true });
    capMesh.receiveShadow = true;
    // keep props off the cap
    for (let s = sA; s <= sB; s += 8) { const f = track.frameAt(s); K.spots.push({ x: f.x, z: f.z, r: Wof(f) + EX }); }

    // taco-shell portal arches: a crunchy yellow shell with a lettuce frill, at each mouth
    const parts = [];
    for (const [s, dir] of [[sA, -1], [sB, 1]]) {
      // an elliptical arch standing on the ground, wide enough to clear the tunnel's walls
      const f = track.frameAt(s), RX = Wof(f) + 3, RY = ARCH_TOP + 2, base = f.y - 0.5;
      const ox = f.tx * dir * 0.7, oz = f.tz * dir * 0.7;
      const arch = new THREE.TorusGeometry(RX, 1.3, 8, 28, Math.PI);
      arch.scale(1, RY / RX, 1.6);
      place(arch, { x: f.x + ox, y: base, z: f.z + oz, ry: f.yaw });
      paintBy(arch, (x, y, z) => (Math.sin(x * 2.1) * Math.sin(y * 1.7) * Math.sin(z * 1.9) > 0.35 ? 0xd99a3a : 0xf5c64e));
      parts.push(arch);
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI * i / 20, lx = Math.cos(a) * (RX + 1.1), ly = Math.sin(a) * (RY + 1.1);
        const leaf = new THREE.SphereGeometry(0.95, 6, 4);
        place(leaf, { x: f.x + f.lx * lx + ox * 1.6, y: base + ly, z: f.z + f.lz * lx + oz * 1.6, sx: 1.3, sy: 0.75, ry: f.yaw });
        parts.push(paint(leaf, i % 3 ? 0x6fcf3a : 0x8fe04a));
        if (i % 4 === 2) { const tom = new THREE.BoxGeometry(0.9, 0.9, 0.9); place(tom, { x: f.x + f.lx * lx * 1.02 + ox * 2.4, y: base + ly * 1.02 + 0.3, z: f.z + f.lz * lx * 1.02 + oz * 2.4, ry: i, rx: i }); parts.push(paint(tom, 0xe8322a)); }
      }
    }
    mesh(merge(parts), vmat, { name: 'tunnel-portals', shadow: true });
  }

  // ------------------------------------------------ the giant taco in the crater (salsa-lava inside, erupting)
  const hills = def.terrain?.hills || [];
  const volc = hills[0];
  if (volc) {
    const floor = naturalAt(volc.x, volc.z);
    const R = 38, H = 36, D0 = 9, cx = volc.x, cz = volc.z, y0 = floor + 5, yaw = 0.12;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const W = (X, Y, Z) => ({ x: cx + X * cy + Z * sy, y: y0 + Y, z: cz - X * sy + Z * cy });
    const NX = 28, NV = 18, pos = [], col = [], idx = [];
    const shellC = new THREE.Color(0xf5c64e), toast = new THREE.Color(0xd9953a), tmp = new THREE.Color();
    const Yb = X => H - H * Math.sqrt(Math.max(0, 1 - (X / R) ** 2));
    const Dz = X => D0 * Math.pow(Math.max(0, 1 - (X / R) ** 2), 0.45);
    for (let i = 0; i <= NX; i++) {
      const X = -R + 2 * R * i / NX;
      for (let j = 0; j <= NV; j++) {
        const v = -1 + 2 * j / NV, a = v * Math.PI / 2;
        const Y = Yb(X) + (H - Yb(X)) * (1 - Math.cos(a)), Z = Dz(X) * Math.sin(a);
        const p = W(X, Y, Z); pos.push(p.x, p.y, p.z);
        const n = Math.sin(X * 0.9 + j) * Math.sin(Y * 0.7) * Math.sin(Z * 1.3 + i);
        tmp.copy(shellC).lerp(toast, n > 0.3 ? 0.8 : 0); col.push(tmp.r, tmp.g, tmp.b);
        if (i && j) { const A = (i - 1) * (NV + 1) + j - 1, Bq = A + NV + 1; idx.push(A, Bq, A + 1, A + 1, Bq, Bq + 1); }
      }
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); shell.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); shell.setIndex(idx); shell.computeVertexNormals();
    // lettuce frill + tomatoes + cheese along both top edges
    const trim = [];
    for (let i = 0; i <= 44; i++) {
      const X = -R * 0.97 + 2 * R * 0.97 * i / 44;
      for (const sd of [-1, 1]) {
        const p = W(X, H + 0.6, sd * Dz(X) * 0.92);
        const leaf = new THREE.SphereGeometry(2.3, 7, 5); place(leaf, { x: p.x, y: p.y + 0.8, z: p.z, sx: 1.3, sy: 1.05, ry: i }); trim.push(paint(leaf, i % 2 ? 0x6fcf3a : 0x92e050));
        if (i % 5 === 2) { const q = W(X, H + 1.5, sd * Dz(X) * 0.7); const tom = new THREE.BoxGeometry(2.6, 2.6, 2.6); place(tom, { x: q.x, y: q.y, z: q.z, ry: i, rx: i * 0.3 }); trim.push(paint(tom, 0xe8322a)); }
        if (i % 3 === 0) { const q = W(X, H + 1.2, sd * Dz(X) * 0.8); const ch = new THREE.BoxGeometry(0.8, 0.8, 4.5); place(ch, { x: q.x, y: q.y, z: q.z, ry: i * 1.7 }); trim.push(paint(ch, 0xffd23f)); }
      }
    }
    mesh(merge([shell, ...trim]), vmat2, { name: 'taco', shadow: true });
    // the salsa-lava filling: a glowing surface inside the shell, a little below the rim
    const FY = H * 0.78, fpos = [], fidx = [];
    for (let i = 0; i <= NX; i++) {
      const X = -R + 2 * R * i / NX, yb = Yb(X);
      let zf = 0; if (yb < FY) { const c = 1 - (FY - yb) / (H - yb); zf = Dz(X) * Math.sin(Math.acos(Math.max(-1, Math.min(1, c)))); }
      for (const sd of [-1, 1]) { const p = W(X, FY, sd * zf * 0.98); fpos.push(p.x, p.y, p.z); }
      if (i) { const a = (i - 1) * 2; fidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const fill = new THREE.BufferGeometry();
    fill.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3)); fill.setIndex(fidx); fill.computeVertexNormals();
    const lavaTex = ctx.loadTex('lava', null, { repeat: [3, 1] });
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xffb080, map: lavaTex, toneMapped: false, side: THREE.DoubleSide });
    { const uv = []; for (let i = 0; i < fpos.length / 3; i++) uv.push(fpos[i * 3] / 12, fpos[i * 3 + 2] / 12); fill.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); }
    mesh(fill, fillMat, { name: 'taco-salsa', receive: false });
    // the crater is brimming with lava; the taco stands in it
    {
      const py = y0 + 2.5; let pr = 5; while (pr < 60 && naturalAt(cx + pr, cz) < py && naturalAt(cx, cz + pr) < py) pr += 0.5;
      const pool = new THREE.CircleGeometry(pr + 1, 40); pool.rotateX(-Math.PI / 2); pool.translate(cx, py, cz);
      const uv = pool.attributes.uv, pp = pool.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / 12, pp.getZ(i) / 12);
      mesh(pool, fillMat, { name: 'crater-lava', receive: false });
    }
    // glowing lava streams down the cone's far sides (away from the road), flowing with the salsa texture
    const streams = [];
    for (const [a0, ph] of [[Math.PI / 2, 0], [Math.PI * 0.78, 1.7], [Math.PI * 0.2, 3.1]]) {
      const pos = [], uv = [], idx = [], d0 = 31, d1 = volc.r * 0.78, N = 30;
      for (let i = 0; i <= N; i++) {
        const d = d0 + (d1 - d0) * i / N, a = a0 + 0.12 * Math.sin(d * 0.07 + ph);
        const w = 4.8 - 2.6 * i / N, px = -Math.sin(a), pz = Math.cos(a);
        for (const sd of [-1, 1]) {
          const x = volc.x + Math.cos(a) * d + px * sd * w / 2, z = volc.z + Math.sin(a) * d + pz * sd * w / 2;
          pos.push(x, Math.max(naturalAt(x, z), groundAt(x, z)) + 0.35, z); uv.push(sd > 0 ? 1 : 0, d / 10);
        }
        if (i) { const q = (i - 1) * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      streams.push(g);
    }
    mesh(merge(streams.map(g => paint(g, 0xffffff))), new THREE.MeshBasicMaterial({ color: 0xffb080, map: lavaTex, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), { name: 'lava-streams', receive: false });
    K.spots.push({ x: cx, z: cz, r: R + 6 });

    // erupting blobs (harmless, visual): ballistic arcs out of the taco, forever
    const blobs = [];
    for (let i = 0; i < 16; i++) blobs.push({ ph: rng() * 4, T: 3 + rng() * 1.8, vy: 17 + rng() * 9, vx: (rng() - 0.5) * 16, vz: (rng() - 0.5) * 16, X: (rng() - 0.5) * R, s: 1.2 + rng() * 1.6 });
    const bim = instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff8a1f, toneMapped: false }), blobs.map(() => ({ x: cx, y: -999, z: cz })), { name: 'lava-blobs' });
    bim.frustumCulled = false;
    const puffs = [];
    for (let i = 0; i < 12; i++) puffs.push({ ph: rng() * 8, T: 7 + rng() * 3, X: (rng() - 0.5) * R * 0.8, dx: (rng() - 0.5) * 6 });
    const pim = instanced(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshLambertMaterial({ color: 0xfff8f0, emissive: 0x6a4a40, transparent: true, opacity: 0.42, depthWrite: false }), puffs.map(() => ({ x: cx, y: -999, z: cz })), { name: 'smoke' });
    pim.frustumCulled = false;
    updaters.push((dt, t) => {
      blobs.forEach((b, i) => {
        const u = ((t + b.ph) % b.T), p = W(b.X, FY, 0);
        const y = p.y + b.vy * u - 7.5 * u * u;
        const alive = y > y0 + 8;
        K.setInstance(bim, i, alive ? { x: p.x + b.vx * u, y, z: p.z + b.vz * u, s: b.s, rx: u * 3 } : { x: p.x, y: -999, z: p.z, s: 0.01 });
      });
      bim.instanceMatrix.needsUpdate = true;
      puffs.forEach((p, i) => {
        const u = ((t + p.ph) % p.T) / p.T, q = W(p.X + p.dx * u, FY + 2 + u * 42, 0);
        K.setInstance(pim, i, { x: q.x, y: q.y, z: q.z, s: (3 + u * 9) * Math.min(1, (1 - u) * 4), ry: u * 2 });
      });
      pim.instanceMatrix.needsUpdate = true;
      lavaTex.offset.set(t * 0.03, t * 0.02);
    });
  }

  // ------------------------------------------------ lava leaps: candy-striped lips + JUMP boards
  {
    const stripe = K.canvasTex(128, 32, (g, w, h) => { for (let i = -2; i < 12; i++) { g.fillStyle = i % 2 ? '#ffd23f' : '#e0332c'; g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 16, 0); g.lineTo(i * 16 + 32, h); g.lineTo(i * 16 + 16, h); g.fill(); } });
    stripe.wrapS = THREE.RepeatWrapping;
    const lips = track.jumps.map(j => K.lofted(j.s - 3.2, j.s - 0.2, 0.5, (s, f) => [1, -1].map(sd => { const p = track.pointAt(s, sd * f.hw); return { x: p.x, y: p.y + 0.05, z: p.z, u: sd > 0 ? 0 : f.hw * 2 / 4 }; }), { vScale: 3 }));
    if (lips.length) mesh(merge(lips.map(g => paint(g, 0xffffff))), new THREE.MeshBasicMaterial({ map: stripe, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, side: THREE.DoubleSide }), { name: 'jump-lips' });
    // "JUMP!" boards either side of each run-up
    const jt = K.canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e0332c'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#e0332c'; g.beginPath(); g.moveTo(40, 96); g.quadraticCurveTo(128, -10, 216, 96); g.lineTo(196, 104); g.quadraticCurveTo(128, 20, 60, 104); g.fill();
      g.beginPath(); g.moveTo(216, 96); g.lineTo(232, 64); g.lineTo(186, 78); g.fill();
    });
    const boards = [], posts = [];
    for (const j of track.jumps) for (const side of [1, -1]) {
      const b = K.beside(j.s - 30, side, 1.2), y = Math.max(groundAt(b.x, b.z), track.pointAt(j.s - 30, b.lat).y - 0.4);
      const yaw = Math.atan2(-b.f.tx, -b.f.tz) - side * 0.3;
      const q = new THREE.PlaneGeometry(3.4, 1.7); place(q, { x: b.x, y: y + 2.6, z: b.z, ry: yaw }); boards.push(paint(q, 0xffffff));
      for (const d of [-1.1, 1.1]) { const p = new THREE.CylinderGeometry(0.09, 0.09, 2.2, 5); place(p, { x: b.x + Math.cos(yaw) * d, y: y + 1.1, z: b.z - Math.sin(yaw) * d }); posts.push(paint(p, 0x5a4a48)); }
    }
    if (boards.length) { mesh(merge(boards), new THREE.MeshBasicMaterial({ map: jt, toneMapped: false, side: THREE.DoubleSide }), { name: 'jump-boards', receive: false }); mesh(merge(posts), vmat, { name: 'jump-posts' }); }
  }

  // ------------------------------------------------ the Rock Bridge: deck + arches over the lava lake
  {
    let s0 = null, s1 = null;
    for (let k = 0; k < track.n; k++) if (track.props[k].raised) { const s = k * track.ds; if (s0 == null) s0 = s; s1 = s; }
    if (s0 != null) {
      const parts = [];
      const deck = K.lofted(s0 - 3, s1 + 3, 1, (s, f) => {
        const L = f.hw + track.OFFL[f.k] + 0.3, R = f.hw + track.OFFR[f.k] + 0.3, a = track.pointAt(s, L), b = track.pointAt(s, -R);
        return [{ x: a.x, y: a.y - 0.08, z: a.z }, { x: a.x, y: a.y - 2.2, z: a.z }, { x: b.x, y: b.y - 2.2, z: b.z }, { x: b.x, y: b.y - 0.08, z: b.z }];
      });
      parts.push(paint(deck, 0x8a6a5e));
      // arches: a pier every ~16 m standing in the lava, with a glowing lava line where it enters
      const len = s1 - s0, n = Math.max(2, Math.round(len / 16));
      for (let i = 0; i <= n; i++) {
        const s = s0 + len * i / n, f = track.frameAt(s), c = track.pointAt(s, 0), w = f.hw * 2 + 2.5;
        const h = c.y - lavaY + 2;
        const g = new THREE.BoxGeometry(w * 0.9, h, 3.2); place(g, { x: c.x, y: c.y - 2 - h / 2 + 0.2, z: c.z, ry: f.yaw });
        parts.push(paintBy(g, (x, y) => ((Math.floor(y * 0.8) & 1) ? 0x7a5c52 : 0x8a6a5e)));
      }
      mesh(merge(parts), vmat, { name: 'rock-bridge', shadow: true });
    }
  }

  // ------------------------------------------------ props
  // cacti (saguaro with a pink flower), chillies, nacho chips, boulders
  const cacti = K.scatter({ step: 10, near: 3, far: 36, r: 1.8, chance: 0.6 }).map(c => ({ ...c, ry: rng() * 6.28, s: 0.8 + rng() * 0.7 }));
  for (const c of K.scatterWide(90, 2, { margin: 10 })) cacti.push({ ...c, ry: rng() * 6.28, s: 1 + rng() * 0.9 });
  const chillies = K.scatter({ step: 19, near: 3, far: 26, r: 2.4, chance: 0.6 }).map(c => ({ x: c.x, y: c.y + 0.55 * 1.4, z: c.z, ry: rng() * 6.28, rz: Math.PI / 2 - 0.25, s: 1.2 + rng() * 0.8, color: pick([0xe8322a, 0xe8322a, 0x5cc43a, 0xffb020, 0xff6a1a]) }));
  const nachos = K.scatter({ step: 31, near: 6, far: 40, r: 4, chance: 0.55 }).map(c => ({ x: c.x, y: c.y - 0.6, z: c.z, ry: rng() * 6.28, rx: (rng() - 0.5) * 0.4, s: 1.4 + rng() * 1.4 }));
  const boulders = K.scatter({ step: 8, near: 1.5, far: 30, r: 1.6, chance: 0.55 }).map(c => { const s = 0.7 + rng() * 1.5; return { x: c.x, y: c.y + s * 0.2, z: c.z, rx: rng() * 3, ry: rng() * 3, sx: s * 1.3, sy: s * 0.8, sz: s, color: pick([0x8a6a5e, 0x7a5c52, 0x9a7a66, 0x6e5248]) }; });
  for (const c of K.scatterWide(60, 3, { margin: 8 })) { const s = 2 + rng() * 3; boulders.push({ x: c.x, y: c.y, z: c.z, rx: rng() * 3, ry: rng() * 3, sx: s * 1.4, sy: s * 0.9, sz: s, color: pick([0x8a6a5e, 0x7a5c52, 0x9a7a66]) }); }
  {
    const trunk = new THREE.CylinderGeometry(0.5, 0.55, 5, 8).translate(0, 2.5, 0);
    const top = new THREE.SphereGeometry(0.5, 8, 5).translate(0, 5, 0);
    const parts = [paintBy(trunk, (x, y, z) => (Math.round(Math.atan2(z, x) / (Math.PI / 4)) & 1) ? 0x3f9a45 : 0x4cb552), paint(top, 0x4cb552)];
    for (const [sd, h, len] of [[1, 2.2, 1.6], [-1, 3, 1.3]]) {
      const arm = new THREE.CylinderGeometry(0.32, 0.32, 1.2, 7); arm.rotateZ(Math.PI / 2); arm.translate(sd * 0.9, h, 0); parts.push(paint(arm, 0x3f9a45));
      const up = new THREE.CylinderGeometry(0.32, 0.32, len, 7).translate(sd * 1.45, h + len / 2, 0); parts.push(paint(up, 0x4cb552));
      const cap = new THREE.SphereGeometry(0.32, 7, 4).translate(sd * 1.45, h + len, 0); parts.push(paint(cap, 0x4cb552));
    }
    const flower = new THREE.SphereGeometry(0.28, 6, 4).translate(0, 5.45, 0); parts.push(paint(flower, 0xff6fae));
    instanced(merge(parts), vmat, cacti, { name: 'cacti', shadow: true });
  }
  {
    // chilli: a curled lathe (tinted per instance) + a green stem
    const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.45 * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * t)), 0.7) * (1 - 0.55 * t), -1.4 + 2.8 * t)); }
    const body = new THREE.LatheGeometry(prof, 10), p = body.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), a = (y + 1.4) / 2.8; p.setX(i, p.getX(i) + 0.6 * a * a); }
    body.computeVertexNormals();
    const stem = new THREE.CylinderGeometry(0.1, 0.16, 0.6, 6).translate(0, -1.6, 0);
    const calyx = new THREE.SphereGeometry(0.34, 7, 4).translate(0, -1.33, 0);
    instanced(merge([paint(body, 0xffffff)]), new THREE.MeshLambertMaterial({ color: 0xffffff }), chillies, { name: 'chillies', shadow: false });
    instanced(merge([paint(stem, 0x3f9a45), paint(calyx, 0x4cb552)]), vmat, chillies.map(c => ({ ...c, color: undefined })), { name: 'chilli-stems' });
  }
  if (nachos.length) {
    // nacho chip: a thick triangle standing on a corner, cheese on top
    const tri = new THREE.CylinderGeometry(2, 2, 0.25, 3); tri.rotateX(Math.PI / 2); tri.rotateZ(Math.PI / 2); tri.translate(0, 1.2, 0);
    const cheese = new THREE.SphereGeometry(0.6, 6, 4); cheese.scale(1.2, 0.5, 0.5); cheese.translate(0, 2.6, 0);
    instanced(merge([paintBy(tri, (x, y, z) => (Math.sin(x * 3 + y * 2) > 0.6 ? 0xe0a53a : 0xf7c84a)), paint(cheese, 0xffb020)]), vmat, nachos, { name: 'nachos', shadow: false });
  }
  instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), boulders, { name: 'boulders' });

  // ------------------------------------------------ papel picado strung over the start straight
  {
    const parts = [], PAL = [0xff5d73, 0xffd23f, 0x4ec5f1, 0x6ff08f, 0xb07cff, 0xff9d2f];
    for (let s = -48; s <= 36; s += 14) {
      if (Math.abs(s) < 4) continue;                       // the start arch is there
      const f = track.frameAt(s), L = f.hw + track.OFFL[f.k] + 0.6, R = f.hw + track.OFFR[f.k] + 0.6;
      const a = track.pointAt(s, L), b = track.pointAt(s, -R), top = Math.max(a.y, b.y) + 8.2;
      for (const p of [a, b]) { const pole = new THREE.CylinderGeometry(0.12, 0.14, top - p.y + 0.3, 6); pole.translate(p.x, (top + p.y) / 2, p.z); parts.push(paint(pole, 0x8a5c30)); }
      const n = Math.round((L + R) / 1.25);
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = top - 0.9 * Math.sin(Math.PI * t);
        if (i < n) { const r = new THREE.CylinderGeometry(0.03, 0.03, 1.3, 3); r.rotateZ(Math.PI / 2); r.rotateY(f.yaw + Math.PI / 2); r.translate(x + (b.x - a.x) / n / 2, y - 0.05, z + (b.z - a.z) / n / 2); parts.push(paint(r, 0xffffff)); }
        const flag = new THREE.PlaneGeometry(0.95, 1.2); flag.rotateY(f.yaw); flag.translate(x, y - 0.65, z);
        parts.push(paint(flag, PAL[(((i + Math.round(s)) % PAL.length) + PAL.length) % PAL.length]));
      }
    }
    mesh(merge(parts), vmat2, { name: 'papel-picado' });
  }

  // ------------------------------------------------ chevron boards before every tight corner
  K.chevrons({ rMax: 40, board: [4, 1.7], post: 0x5a4a48 });

  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}
