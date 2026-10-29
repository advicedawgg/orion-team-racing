// scenery/jungle.js — Jungle Jumble. Contract: DESIGN.md "Scenery hook"; helpers: scenery/propkit.js.
//
// A sunny, friendly jungle: the WATERFALL ROCK inside the Waterfall Hairpin (a mossy rock with the hidden
// shortcut's wet cave curving through it; the falls pour over the cave's mouth into a pool, and karts drive
// through the falling water), the SOOTIE TEMPLE over the main road's tunnel (a stepped mossy temple with a big
// smiling carved Sootie face over the door: charcoal fur, glowing mint eyes, pink nose, whiskers, cat ears;
// her tail curls over the exit), the ROPE BRIDGE over Hippo River (planks, posts, sagging rope rails and nets),
// friendly hippos bobbing in the river, turtles on logs, lily pads, parrots (perched and circling), jungle
// trees, palms, banana plants, giant leaves, ferns, flowers, fruit, flower garlands over the start straight,
// a striped lip + JUMP boards at the Hippo Hop, chevron boards. ~24 draw calls; nothing adds a light — what
// glows is MeshBasic (toneMapped:false).
import { makePropKit } from './propkit.js';

export default function build(ctx) {
  const { THREE, group, track, def, rng, groundAt } = ctx;
  const K = makePropKit(ctx);
  const { paint, paintBy, merge, place, instanced, mesh, vmat, vmat2 } = K;
  const updaters = [];
  const pick = a => a[(rng() * a.length) | 0];
  const waterY = track.water?.y ?? -1;
  // buckets merged into one mesh each at the end
  const B = { rock: [], temple: [], glow: [], wood: [], misc: [], curtain: [] };
  // instance lists
  const L = { trees: [], bushes: [], palms: [], bananas: [], leaves: [], ferns: [], flowers: [], boulders: [], hippos: [], turtles: [], lilies: [], parrots: [], logs: [] };
  const S = { THREE, K, B, L, rng, updaters, track, ctx };

  // water: muddy and a little more opaque; the gap faces in mud brown; far ground in jungle green
  const water = group.getObjectByName('water');
  if (water) { K.fitWater(water); water.material.opacity = 0.86; }
  { const gf = group.getObjectByName('gapfaces'); if (gf) gf.material.color.set(0x8a6a48); }
  K.farGround(def.tex?.ground || 'jungle', 0xc8e8b0, (def.terrain?.base ?? 0) - 0.9);

  // ------------------------------------------------ landmarks (they claim their spots before the props)
  for (const br of ctx.branches || []) {
    let u0 = -1;
    for (let k = 0; k <= br.n; k++) {
      const on = k < br.n && (br.FLAG[k] & 8) !== 0;
      if (on && u0 < 0) u0 = k * br.ds;
      else if (!on && u0 >= 0) { waterfallCave(S, br, u0, (k - 1) * br.ds); u0 = -1; }
    }
    causeway(S, br);
    mouthMarkers(S, br);
  }
  {
    let run = null;
    for (let k = 0; k <= track.n; k++) {
      const on = k < track.n && (track.FLAG[k] & 8);
      if (on && !run) run = { s0: k * track.ds };
      if (!on && run) { sootieTemple(S, run.s0, (k - 1) * track.ds); run = null; }
    }
  }
  ropeBridge(S);
  hippoHop(S);
  startGarlands(S);

  // ------------------------------------------------ water life: hippos in the river, turtles on logs, lily pads
  {
    const river = def.terrain?.carve?.find(c => c.type === 'channel') || null;
    const deep = (x, z) => groundAt(x, z) < waterY - 1.2;
    // a point on a carve polyline at a given z (the river runs north-south) / at a fraction along it
    const alongZ = (pts, z) => { for (let i = 0; i + 1 < pts.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; if ((z - az) * (z - bz) <= 0) { const t = (z - az) / (bz - az || 1); return [ax + (bx - ax) * t, z, Math.atan2(bx - ax, bz - az)]; } } return null; };
    if (river) {
      // hippos where you'll see them: either side of the rope bridge, between it and the Hippo Hop, and under the hop
      for (const z of [-22, -36, -70, -84, -98, -112, -140, -152, -170]) {
        const p = alongZ(river.pts, z); if (!p) continue;
        for (let tries = 0; tries < 6; tries++) {
          const x = p[0] + (rng() - 0.5) * river.w * 0.45, zz = z + (rng() - 0.5) * 4;
          if (!deep(x, zz)) continue;
          const c = ctx.corridorInfo(x, zz); if (c.e < 1 && !c.gap) continue;     // not under the bridge deck
          L.hippos.push({ x, y: waterY, z: zz, ry: p[2] + (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 1.2, s: 1.0 + rng() * 0.35, ph: rng() * 6 });
          break;
        }
      }
    }
    // lily pads on calm water near the banks of every channel and round the pool
    for (const c of def.terrain?.carve || []) {
      const ring = c.type === 'lake' ? Array.from({ length: 24 }, (_, i) => [c.x + Math.cos(i / 24 * 6.283) * c.r * 0.62, c.z + Math.sin(i / 24 * 6.283) * c.r * 0.62]) : null;
      const cand = ring || (() => { const out = []; for (let i = 0; i + 1 < c.pts.length; i++) { const [ax, az] = c.pts[i], [bx, bz] = c.pts[i + 1], len = Math.hypot(bx - ax, bz - az), nx = (bz - az) / len, nzz = -(bx - ax) / len; for (let d = 2; d < len; d += 5) for (const sd of [1, -1]) out.push([ax + (bx - ax) * d / len + nx * sd * c.w * (0.28 + rng() * 0.12), az + (bz - az) * d / len + nzz * sd * c.w * (0.28 + rng() * 0.12)]); } return out; })();
      for (const [x, z] of cand) {
        if (rng() < 0.45 || L.lilies.length >= 110) continue;
        const g = groundAt(x, z); if (g > waterY - 0.2) continue;
        if (!ctx.isClear(x, z, 0.8, 0.3)) continue;
        L.lilies.push({ x, y: waterY + 0.04, z, ry: rng() * 6.28, s: 0.7 + rng() * 0.7, color: pick([0x4cb848, 0x5cc850, 0x3fa040]) });
      }
    }
    // logs with turtles along the creek and the pool
    const creek = def.terrain?.carve?.filter(c => c.type === 'channel')[1];
    if (creek) for (let i = 0; i + 1 < creek.pts.length; i++) {
      const [ax, az] = creek.pts[i], [bx, bz] = creek.pts[i + 1];
      for (const t of [0.35, 0.8]) {
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (!ctx.isClear(x, z, 2.5, 0.5) || groundAt(x, z) > waterY) continue;
        const yaw = Math.atan2(bx - ax, bz - az) + (rng() - 0.5) * 0.8;
        L.logs.push({ x, y: waterY + 0.05, z, yaw });
        const n = 1 + (rng() < 0.5 ? 1 : 0);
        for (let j = 0; j < n; j++) { const o = (j - (n - 1) / 2) * 1.5; L.turtles.push({ x: x + Math.sin(yaw) * o, y: waterY + 0.45, z: z + Math.cos(yaw) * o, ry: yaw + (j ? Math.PI : 0) + (rng() - 0.5) * 0.6, s: 0.8 + rng() * 0.3 }); }
      }
    }
  }

  // ------------------------------------------------ plants
  const T = (c, s, extra = {}) => ({ x: c.x, y: c.y, z: c.z, ry: rng() * 6.28, s, ...extra });
  for (const c of K.scatter({ step: 7, near: 4, far: 42, r: 2.3, chance: 0.85 })) L.trees.push(T(c, 0.8 + rng() * 0.5));
  for (const c of K.scatter({ step: 4.5, near: 0.9, far: 9, r: 1.1, chance: 0.75 })) L.bushes.push(T(c, 0.8 + rng() * 0.7, { color: pick([0x4cb040, 0x5cc04a, 0x3f9a38, 0x6fc850]) }));
  for (const c of K.scatterWide(190, 3, { margin: 8 })) L.trees.push(T(c, 1 + rng() * 0.6));
  for (const c of K.scatter({ step: 13, near: 3, far: 26, r: 1.4, chance: 0.55 })) L.palms.push(T(c, 0.85 + rng() * 0.4, { rx: (rng() - 0.5) * 0.12 }));
  for (const c of K.scatterWide(60, 2, { margin: 6 })) L.palms.push(T(c, 1 + rng() * 0.4));
  for (const c of K.scatter({ step: 15, near: 2.5, far: 16, r: 1.4, chance: 0.6 })) L.bananas.push(T(c, 0.9 + rng() * 0.4));
  for (const c of K.scatter({ step: 5.5, near: 1.4, far: 11, r: 0.9, chance: 0.8 })) L.leaves.push(T(c, 0.9 + rng() * 0.8, { rx: -0.15 - rng() * 0.35, color: pick([0x5cc850, 0x4cb848, 0x6fd858, 0x3fa840]) }));
  for (const c of K.scatter({ step: 3.6, near: 0.7, far: 22, r: 0.6, chance: 0.75, opts: { overlap: false } })) L.ferns.push(T(c, 0.7 + rng() * 0.7, { color: pick([0x4cb040, 0x5cc04a, 0x3f9a38]) }));
  for (const c of K.scatter({ step: 2.6, near: 0.4, far: 13, r: 0.3, chance: 0.6, opts: { overlap: false } })) L.flowers.push(T(c, 0.8 + rng() * 0.6, { color: pick([0xff5d73, 0xffd23f, 0xff8a3d, 0xff6fd0, 0xffffff, 0xb07cff]) }));
  for (const c of K.scatter({ step: 14, near: 1.2, far: 26, r: 1.3, chance: 0.45 })) { const s = 0.7 + rng() * 1.4; L.boulders.push({ x: c.x, y: c.y + s * 0.2, z: c.z, rx: rng() * 3, ry: rng() * 3, sx: s * 1.3, sy: s * 0.8, sz: s, color: pick([0x9aa08a, 0x8a9a7a, 0xa8ae96, 0x7f8f6e]) }); }
  // parrots: perched on a few tree tops near the road, and a flock circling high over the track
  for (const t of L.trees) if (L.parrots.length < 26 && rng() < 0.16 && ctx.corridorInfo(t.x, t.z).e < 22) L.parrots.push({ x: t.x + 1.5 * t.s, y: t.y + 13.4 * t.s, z: t.z, ry: rng() * 6.28, s: 1.3, color: pick([0xe8322a, 0x2f8fe8, 0xffd23f, 0x3fc048, 0xff8a1f]) });
  const flyers = [];
  {
    for (let i = 0; i < 10; i++) {
      const p = track.pointAt(track.length * i / 10, 0);
      flyers.push({ cx: p.x, cz: p.z, r: 14 + rng() * 16, h: 15 + rng() * 9, w: (0.35 + rng() * 0.25) * (rng() < 0.5 ? 1 : -1), ph: rng() * 6.28, color: pick([0xe8322a, 0x2f8fe8, 0xffd23f, 0x3fc048, 0xff8a1f]) });
    }
  }

  // ------------------------------------------------ instanced meshes
  const lam = c => new THREE.MeshLambertMaterial({ color: c ?? 0xffffff });
  instanced(treeGeo(S), vmat, L.trees, { name: 'jungle-trees', shadow: true });
  instanced(palmGeo(S), vmat2, L.palms, { name: 'palms' });
  instanced(bushGeo(S), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), L.bushes, { name: 'bushes' });
  instanced(bananaGeo(S), vmat2, L.bananas, { name: 'banana-plants' });
  instanced(leafGeo(S), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), L.leaves, { name: 'giant-leaves' });
  instanced(fernGeo(S), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), L.ferns, { name: 'ferns' });
  instanced(flowerGeo(S), vmat2, L.flowers, { name: 'flowers' });
  instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), L.boulders, { name: 'boulders' });
  instanced(turtleGeo(S), vmat, L.turtles, { name: 'turtles' });
  instanced(lilyGeo(S), lam(), L.lilies, { name: 'lily-pads' });
  for (const lg of L.logs) { const g = new THREE.CylinderGeometry(0.45, 0.5, 4.2, 8); g.rotateZ(Math.PI / 2); g.rotateY(lg.yaw + Math.PI / 2); g.translate(lg.x, lg.y, lg.z); B.wood.push(paint(g, 0x8a6a48)); }
  const him = instanced(hippoGeo(S), vmat, L.hippos.map(h => ({ ...h })), { name: 'hippos' });
  if (him) updaters.push((dt, t) => {
    L.hippos.forEach((h, i) => K.setInstance(him, i, { x: h.x, y: h.y + 0.12 * Math.sin(t * 1.3 + h.ph) - 0.05, z: h.z, ry: h.ry + 0.25 * Math.sin(t * 0.3 + h.ph), rx: 0.05 * Math.sin(t * 0.9 + h.ph), s: h.s }));
    him.instanceMatrix.needsUpdate = true;
  });
  const parrotList = [...L.parrots, ...flyers.map(f => ({ x: f.cx, y: f.h, z: f.cz, s: 1.4, color: f.color }))];
  const pim = instanced(parrotGeo(S), vmat, parrotList, { name: 'parrots' });
  if (pim) {
    pim.frustumCulled = false;
    const n0 = L.parrots.length;
    updaters.push((dt, t) => {
      flyers.forEach((f, i) => {
        const a = f.ph + t * f.w;
        const x = f.cx + Math.cos(a) * f.r, z = f.cz + Math.sin(a) * f.r, y = f.h + Math.sin(t * 2.1 + f.ph) * 0.6;
        const yaw = Math.atan2(-Math.sin(a) * f.w, Math.cos(a) * f.w);
        K.setInstance(pim, n0 + i, { x, y, z, ry: yaw, rz: -Math.sign(f.w) * 0.35, s: 1.4 + 0.12 * Math.sin(t * 14 + i) });
      });
      L.parrots.forEach((p, i) => { if ((i + Math.floor(t * 0.7)) % 5 === 0) K.setInstance(pim, i, { ...p, rx: 0.25 * Math.max(0, Math.sin(t * 9 + i)) }); });
      pim.instanceMatrix.needsUpdate = true;
    });
  }

  // ------------------------------------------------ chevron boards before every tight corner
  K.chevrons({ rMax: 40, board: [4, 1.7], post: 0x6a4a2a });

  // ------------------------------------------------ the merged buckets
  if (B.rock.length) { const m = mesh(merge(B.rock), new THREE.MeshLambertMaterial({ map: ctx.loadTex('rock_mossy', null), vertexColors: true, side: THREE.DoubleSide }), { name: 'waterfall-rock', shadow: true }); m.receiveShadow = true; }
  if (B.temple.length) { const m = mesh(merge(B.temple), new THREE.MeshLambertMaterial({ map: ctx.loadTex('temple_stone', null), vertexColors: true, side: THREE.DoubleSide }), { name: 'sootie-temple', shadow: true }); m.receiveShadow = true; }
  if (B.wood.length) mesh(merge(B.wood), new THREE.MeshLambertMaterial({ map: ctx.loadTex('wood', null), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), { name: 'wood', shadow: true });
  if (B.misc.length) mesh(merge(B.misc), vmat2, { name: 'ropes-vines' });
  if (B.glow.length) mesh(merge(B.glow), S.glowMat || new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }), { name: 'jungle-glow', receive: false });
  if (B.curtain.length) {
    const m = mesh(merge(B.curtain), S.curtainMat, { name: 'waterfall', receive: false });
    m.renderOrder = 2;
  }

  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}

/* =============================================================== shared helpers */
const nz3 = (x, y, z) => Math.sin(x * 0.31 + Math.sin(z * 0.23) * 2) * 0.5 + Math.sin(z * 0.37 + y * 0.29 + Math.sin(x * 0.17) * 2) * 0.35 + Math.sin(y * 0.53 + x * 0.41 - z * 0.11) * 0.15;

function gridGeo(THREE, rows) {
  const nc = rows[0].length, pos = [], idx = [];
  for (const r of rows) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < nc - 1; c++) { const a = r * nc + c, b = a + nc; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** world-space (triplanar-ish) uvs from the normals, so every rock/stone piece tiles like one material */
function worldUV(THREE, g, sc = 7) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay > 0.7) { uv[i * 2] = x / sc; uv[i * 2 + 1] = z / sc; } else if (ax > az) { uv[i * 2] = z / sc; uv[i * 2 + 1] = y / sc; } else { uv[i * 2] = x / sc; uv[i * 2 + 1] = y / sc; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
/** vertex tint: `side` on steep faces, `top` (moss) where the face looks up; a little noise */
function mossTint(THREE, g, side, top, amt = 1) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, a = new Float32Array(p.count * 3), cs = new THREE.Color(side), ct = new THREE.Color(top), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const up = Math.max(0, Math.min(1, (n.getY(i) - 0.45) / 0.35)), w = 0.92 + 0.08 * nz3(p.getX(i) * 3, p.getY(i) * 3, p.getZ(i) * 3);
    c.copy(cs).lerp(ct, up * amt).multiplyScalar(w);
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
/** a thin cylinder from a to b (ropes, vines, poles) */
function seg(THREE, a, b, r, sides = 5) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, true);
  g.rotateX(Math.PI / 2); g.lookAt(d); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}
const sagPts = (a, b, s, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - s * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]; });
/** resample a (lat, h) polyline to n points by arc length */
function resample(poly, n) {
  const d = [0]; for (let i = 1; i < poly.length; i++) d.push(d[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  const out = []; let j = 0;
  for (let i = 0; i < n; i++) {
    const t = d[d.length - 1] * i / (n - 1);
    while (j < poly.length - 2 && d[j + 1] < t) j++;
    const f = (t - d[j]) / Math.max(1e-6, d[j + 1] - d[j]);
    out.push([poly[j][0] + (poly[j + 1][0] - poly[j][0]) * f, poly[j][1] + (poly[j + 1][1] - poly[j][1]) * f, ...(poly[j].length > 2 ? [poly[j][2] + (poly[j + 1][2] - poly[j][2]) * f, poly[j][3] + (poly[j + 1][3] - poly[j][3]) * f] : [])]);
  }
  return out;
}
function glowMaterial(S) {
  if (!S.glowMat) S.glowMat = new S.THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: S.THREE.DoubleSide });
  return S.glowMat;
}
/** is a world point clear of the MAIN road's drivable corridor by `m` metres? */
function clearOfMain(S, x, z, m = 0.6) {
  const q = S._q || (S._q = {});
  S.track.projectOn(0, { x, y: 5, z }, -1, q);
  return Math.abs(q.lat) > q.hw + Math.max(S.track.OFFL[q.i], S.track.OFFR[q.i]) + m;
}

/* =============================================================== the Waterfall Rock + the wet cave (the hidden shortcut) */
/**
 * Over the branch's `tunnel` stretch t0..t1: an arched, wet cave (inner shell: teal-grey, glowing bracket
 * fungi, glow-worms, mint crystals) inside a lumpy mossy rock (outer shell + talus, front faces round the two
 * mouths, a core filling the inside of the U); the WATERFALL pours off the rock over the first mouth (a
 * scrolling transparent curtain + a lip over the top + foam + mist; a kart that drives through it throws up
 * a burst of drops). Trees on top. Props are kept off it via K.spots.
 */
function waterfallCave(S, br, t0, t1) {
  const { THREE, K, B, ctx, rng, updaters } = S;
  const { paint, place } = K;
  const um = (t0 + t1) / 2, km = br.idx(um);
  const WI = br.HW[km] + Math.max(br.OFFL[km], br.OFFR[km]) + 0.25;
  const AW = 3.6, AT = 9.6, WO = WI + 2.6, BOT = -1.4;
  const archH = l => AW + (AT - AW) * Math.sqrt(Math.max(0, 1 - (l / WI) ** 2));
  const u0 = Math.max(0, t0 - 0.6), u1 = Math.min(br.length, t1 + 0.6);
  const Htop = u => 15 + 4 * Math.sin(Math.PI * Math.max(0, Math.min(1, (u - u0) / (u1 - u0))));
  const F = u => br.frameAt(Math.max(0, Math.min(br.length, u)));
  const P = (u, l, h) => { const f = F(u); return [f.x + f.lx * l, f.y + h, f.z + f.lz * l]; };
  const us = []; for (let u = u0; u < u1 - 0.7; u += 1.5) us.push(u); us.push(u1);
  const NF = 41;

  // talus reach per side (+1 = left): as far as the main road's corridor allows (≤ 3.5 m past WO)
  const reach = (u, s) => { let t = 3.5; while (t > 0) { const p = P(u, s * (WO + t), 0); if (clearOfMain(S, p[0], p[2], 0.8)) break; t -= 0.5; } return Math.max(0, t); };
  // profiles across (lat, h, normal-lat, normal-h), left (−) to right… (inner first: −WI → +WI)
  const innerProf = () => {
    const pr = [[-WI, BOT, 1, 0], [-WI, AW, 1, 0]];
    for (let i = 1; i < 16; i++) { const l = -WI + 2 * WI * i / 16; pr.push([l, archH(l), -l / WI, -1]); }
    pr.push([WI, AW, -1, 0], [WI, BOT, -1, 0]);
    return resample(pr, NF);
  };
  const outerProf = u => {
    const H = Htop(u), tl = reach(u, -1), tr = reach(u, 1);
    return resample([[-(WO + tl), BOT, -1, 0.3], [-(WO + 0.6), H * 0.5, -1, 0.2], [-WO, H * 0.85, -1, 0.3], [-WO * 0.55, H, -0.2, 1], [0, H + 0.6, 0, 1], [WO * 0.55, H, 0.2, 1], [WO, H * 0.85, 1, 0.3], [WO + 0.6, H * 0.5, 1, 0.2], [WO + tr, BOT, 1, 0.3]], NF);
  };
  // world point of a profile vertex, displaced by world-space noise along its profile normal
  const W = (u, pv, amp, inward = false) => {
    const f = F(u), [l, h, nl, nh] = pv;
    const x = f.x + f.lx * l, y = f.y + h, z = f.z + f.lz * l;
    let d = amp * nz3(x * 0.9, y * 0.9, z * 0.9); if (inward) d = Math.abs(d);
    const m = Math.hypot(nl, nh) || 1;
    return [x + f.lx * (nl / m) * d * (inward ? -1 : 1), y + (nh / m) * d * (inward ? -1 : 1) * (h > 0.5 ? 1 : 0), z + f.lz * (nl / m) * d * (inward ? -1 : 1)];
  };
  // the cave walls never come inside WI (noise only pushes them OUT), the base rows stay put
  const innerRow = u => innerProf().map(pv => W(u, pv, pv[1] > 0.3 ? 0.35 : 0, true));
  const outerRow = u => outerProf(u).map(pv => W(u, pv, pv[1] > 0 ? 1.1 : 0.4));
  const inner = gridGeo(THREE, us.map(innerRow));
  mossTint(THREE, inner, 0xb4ccc8, 0xc8e0d4, 0.4);
  { const c = inner.attributes.color; for (let i = 0; i < c.array.length; i++) c.array[i] *= 1.75; }
  B.rock.push(worldUV(THREE, inner, 6));
  const outer = gridGeo(THREE, us.map(outerRow));
  B.rock.push(worldUV(THREE, mossTint(THREE, outer, 0xe6e6dc, 0xb8f0a0), 7));
  for (const u of [u0, u1]) B.rock.push(worldUV(THREE, mossTint(THREE, gridGeo(THREE, [innerRow(u), outerRow(u)]), 0xe0e0d6, 0xb8f0a0), 7));
  // wet streaks: darker bands on the inner shell already come from the tint; a glistening wet floor edge strip
  // keep every other prop off the rock
  for (const u of us) for (const s of [1, -1]) { const p = P(u, s * (WO + 1.5), 0); K.spots.push({ x: p[0], z: p[2], r: 4 }); }

  // ---- the core: a lumpy rock filling the inside of the U (the spot inside farthest from every corridor)
  {
    const fa = F(u0), fb = F(u1), mx = (fa.x + fb.x) / 2, mz = (fa.z + fb.z) / 2;
    const apex = F(um), ax = apex.x - mx, az = apex.z - mz, al = Math.hypot(ax, az) || 1;
    let best = null;
    for (let dx = -20; dx <= 20; dx += 1) for (let dz = -20; dz <= 20; dz += 1) {
      const x = mx + dx, z = mz + dz; if ((dx * ax + dz * az) / al < -2) continue;
      const e = ctx.corridorInfo(x, z).e; if (!best || e > best.e) best = { x, z, e };
    }
    if (best && best.e > 5) {
      const R = best.e + (WI - (br.HW[km] + Math.max(br.OFFL[km], br.OFFR[km]))) + 1.0, y0 = ctx.groundAt(best.x, best.z) - 1.2, Hc = Htop(um) + 2.5 + F(um).y - y0;
      const g = new THREE.CylinderGeometry(R * 0.86, R * 1.02, Hc, 26, 7);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const r = Math.hypot(x, z), a = Math.atan2(z, x), wx = best.x + x, wz = best.z + z;
        if (r > 0.01) { const f = 1 + 0.07 * nz3(wx * 0.5, y * 0.5, wz * 0.5); x *= f; z *= f; }
        if (y > Hc / 2 - 0.01) y += 1.4 * nz3(wx * 0.3, 0, wz * 0.3) - 0.8 * (r / R) ** 2;
        p.setXYZ(i, x, y, z); void a;
      }
      g.translate(best.x, y0 + Hc / 2, best.z); g.computeVertexNormals();
      B.rock.push(worldUV(THREE, mossTint(THREE, g, 0xe6e6dc, 0xb8f0a0), 7));
      K.spots.push({ x: best.x, z: best.z, r: R + 2 });
      // a few trees + ferns on top of the rock
      for (let i = 0; i < 7; i++) {
        const a = rng() * 6.28, r = rng() * R * 0.6, x = best.x + Math.cos(a) * r, z = best.z + Math.sin(a) * r;
        S.L.trees.push({ x, y: y0 + Hc - 1.2, z, ry: rng() * 6.28, s: 0.55 + rng() * 0.3 });
      }
      for (let i = 0; i < 18; i++) { const a = rng() * 6.28, r = rng() * R * 0.75; S.L.ferns.push({ x: best.x + Math.cos(a) * r, y: y0 + Hc - 0.6, z: best.z + Math.sin(a) * r, ry: rng() * 6.28, s: 1.2 + rng() * 0.8, color: 0x4cb040 }); }
    }
  }
  // trees on the rock's back
  for (let i = 0; i < 9; i++) { const u = u0 + 4 + rng() * (u1 - u0 - 8), l = (rng() - 0.5) * WO, p = P(u, l, Htop(u) - 0.8); S.L.palms.push({ x: p[0], y: p[1], z: p[2], ry: rng() * 6.28, s: 0.7 + rng() * 0.3 }); }

  // ---- inside: glowing bracket fungi on the walls, glow-worms on the ceiling, mint crystals at the foot of the walls
  const G = B.glow; glowMaterial(S);
  const fungiCols = [0x5fe8ff, 0x8ff0b4, 0xff9fe0, 0xb6ff7a];
  for (let u = u0 + 3, i = 0; u < u1 - 2; u += 4.2, i++) {
    const f = F(u);
    for (const s of [1, -1]) {
      for (let j = 0; j < 3; j++) {
        const h = 2.6 + j * 0.7 + rng() * 0.3, l = s * (WI + 0.12), p = P(u + (j - 1) * 0.6, l, h);
        const cap = new THREE.SphereGeometry(0.5 - j * 0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.32, 1);
        place(cap, { x: p[0], y: p[1], z: p[2] });
        G.push(paint(cap, fungiCols[(i + j + (s > 0 ? 0 : 2)) % fungiCols.length]));
      }
      if (i % 2 === 0) {   // crystals at the wall's foot (on the far side of the kerb line)
        const p = P(u + 1.5, s * (WI - 0.1), 0.2);
        for (let c = 0; c < 3; c++) { const g = new THREE.OctahedronGeometry(1, 0); place(g, { x: p[0] + (rng() - 0.5) * 0.6, y: p[1] + 0.4, z: p[2] + (rng() - 0.5) * 0.6, sx: 0.22, sy: 0.6 + rng() * 0.4, sz: 0.22, rz: s * (0.2 + rng() * 0.3) }); G.push(paint(g, c ? 0x8ff0b4 : 0x5fe8ff)); }
      }
    }
    // glow-worms: tiny cyan dots on the ceiling
    for (let j = 0; j < 9; j++) { const l = (rng() * 2 - 1) * WI * 0.85, p = P(u + rng() * 4, l, archH(l) - 0.05); const g = new THREE.OctahedronGeometry(0.07 + rng() * 0.06, 0); g.translate(p[0], p[1], p[2]); G.push(paint(g, rng() < 0.7 ? 0x9ff8ff : 0xd8ffb0)); }
  }

  // ---- the waterfall over the first mouth (the one you come to first: the entry)
  const fw = F(u0), dir = -1;              // the curtain falls in front of the mouth, toward the oncoming karts
  const cu = u0 + dir * 1.0, H0 = Htop(u0), half = WO + 2.2;
  const curtainTex = K.canvasTex(256, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(176,226,246,0.42)'; g.fillRect(0, 0, w, h);
    const streak = (x, y0, len, ww, a, c) => {
      for (const yy of [y0, y0 - h]) {   // wraps vertically
        const gr = g.createLinearGradient(0, yy, 0, yy + len); gr.addColorStop(0, `rgba(${c},0)`); gr.addColorStop(0.3, `rgba(${c},${a})`); gr.addColorStop(0.7, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = gr; g.fillRect(x, yy, ww, len);
        if (x + ww > w) g.fillRect(x - w, yy, ww, len);
      }
    };
    for (let i = 0; i < 260; i++) streak(rng() * w, rng() * h, 60 + rng() * 260, 1 + rng() * 2.5, (0.25 + rng() * 0.6).toFixed(2), '255,255,255');
    for (let i = 0; i < 80; i++) streak(rng() * w, rng() * h, 80 + rng() * 300, 1 + rng() * 2, (0.2 + rng() * 0.3).toFixed(2), '120,190,225');
  }, { repeat: [1, 1] });
  curtainTex.wrapS = curtainTex.wrapT = THREE.RepeatWrapping;
  S.curtainMat = new THREE.MeshBasicMaterial({ map: curtainTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, vertexColors: true });
  {
    const rows = [], NX = 14, NY = 12, yBot = S.track.water ? S.track.water.y - 0.3 : fw.y - 1.5, yTop = fw.y + H0 - 0.2;
    const lip = [];   // the water sliding over the top edge: from 3.5 m back on top to the curtain
    for (const [du, dh] of [[4, 1.0], [2, 0.75], [0.3, 0.35], [-0.6, 0]]) {
      const row = []; for (let i = 0; i <= NX; i++) { const l = -(WO - 0.8) + 2 * (WO - 0.8) * i / NX; const p = P(u0 + du * 1, l, H0 + dh); row.push(p); } lip.push(row);
    }
    for (let j = 0; j <= NY; j++) {
      const t = j / NY, y = yTop + (yBot - yTop) * t, out = dir * (0.9 + 2.2 * t * t);   // it arcs out as it falls
      const row = []; for (let i = 0; i <= NX; i++) { const ll = (-1 + 2 * i / NX) * ((WO - 0.8) + (half - WO + 0.8) * t * t); const f = fw; row.push([f.x + f.lx * ll + f.tx * out, y, f.z + f.lz * ll + f.tz * out]); }
      rows.push(row);
    }
    const all = [...lip, ...rows];
    const g = gridGeo(THREE, all);
    const uv = [], cols = [];
    let v = 0;
    all.forEach((row, r) => { if (r) v += Math.hypot(row[NX >> 1][0] - all[r - 1][NX >> 1][0], row[NX >> 1][1] - all[r - 1][NX >> 1][1], row[NX >> 1][2] - all[r - 1][NX >> 1][2]); row.forEach((p, i) => { uv.push(i / NX * 2.2, -v / 12); const e = Math.min(1, Math.min(i, NX - i) / 2.5); cols.push(0.85 + 0.15 * e, 0.92 + 0.08 * e, 1); }); });
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    B.curtain.push(g);
    updaters.push((dt, t) => { curtainTex.offset.y = (t * 0.55) % 1; });
  }
  // foam: white blobs round the curtain's foot on the pool (both sides of the causeway) + a ring of bubbles
  {
    const wy = S.track.water?.y ?? fw.y - 1;
    for (let i = 0; i < 36; i++) {
      const l = -half + rng() * 2 * half, out = dir * (2.4 + rng() * 2.5), x = fw.x + fw.lx * l + fw.tx * out, z = fw.z + fw.lz * l + fw.tz * out;
      if (Math.abs(l) < WI + 0.4 && Math.abs(out) < 6) continue;                    // not on the causeway
      if (ctx.groundAt(x, z) > wy - 0.1) continue;
      const g = new THREE.SphereGeometry(0.6 + rng() * 0.7, 7, 4); g.scale(1.4, 0.28, 1.1); g.translate(x, wy + 0.05, z); G.push(paint(g, rng() < 0.5 ? 0xffffff : 0xe8f8ff));
    }
  }
  // mist: soft white puffs rising out of the splash, and a burst of drops when a kart drives through the water
  {
    const N = 46, pos = new Float32Array(N * 3), mist = [];
    for (let i = 0; i < N; i++) mist.push({ l: -half + rng() * 2 * half, ph: rng() * 3, T: 2.2 + rng() * 1.6, out: 1.5 + rng() * 3 });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const tex = K.canvasTex(64, 64, (c, w, h) => { const gr = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2 - 1); gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
    const mat = new THREE.PointsMaterial({ size: 3.4, map: tex, transparent: true, depthWrite: false, opacity: 0.55, color: 0xf4fcff });
    const pts = new THREE.Points(geo, mat); pts.name = 'waterfall-mist'; pts.frustumCulled = false; ctx.group.add(pts);
    const NB = 40, drops = []; for (let i = 0; i < NB; i++) drops.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
    const dpos = new Float32Array(NB * 3), dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    const dmat = new THREE.PointsMaterial({ size: 0.45, map: tex, color: 0xe8f8ff, transparent: true, opacity: 0.95, depthWrite: false });
    const dpts = new THREE.Points(dgeo, dmat); dpts.name = 'waterfall-drops'; dpts.frustumCulled = false; dpts.visible = false; ctx.group.add(dpts);
    const wy = S.track.water?.y ?? fw.y - 1, cx = fw.x + fw.tx * dir, cz = fw.z + fw.tz * dir;
    const inside = new Set();
    updaters.push((dt, t) => {
      mist.forEach((m, i) => { const a = ((t + m.ph) % m.T) / m.T; const x = fw.x + fw.lx * m.l + fw.tx * dir * (m.out + a * 2), z = fw.z + fw.lz * m.l + fw.tz * dir * (m.out + a * 2); pos[i * 3] = x; pos[i * 3 + 1] = Math.max(wy, fw.y - 0.5) + 0.4 + a * 4.5; pos[i * 3 + 2] = z; });
      geo.attributes.position.needsUpdate = true;
      const race = globalThis.__OTR?.race;
      if (race) for (const k of race.karts) {
        const dx = k.pos.x - cx, dz = k.pos.z - cz, fwd = dx * fw.tx + dz * fw.tz, la = dx * fw.lx + dz * fw.lz;
        const now = Math.abs(fwd) < 1.6 && Math.abs(la) < WI && Math.abs(k.pos.y - fw.y) < 4;
        if (now && !inside.has(k)) {
          let n = 0;
          for (const d of drops) { if (d.life > 0 || n > 14) continue; n++; d.x = k.pos.x + (rng() - 0.5) * 2; d.y = k.pos.y + 1 + rng() * 1.5; d.z = k.pos.z + (rng() - 0.5) * 2; d.vx = (rng() - 0.5) * 6 + fw.tx * (k.speed || 10) * 0.4; d.vz = (rng() - 0.5) * 6 + fw.tz * (k.speed || 10) * 0.4; d.vy = 2 + rng() * 4; d.life = 0.6 + rng() * 0.5; }
          dpts.visible = true;
        }
        if (now) inside.add(k); else inside.delete(k);
      }
      if (dpts.visible) {
        let alive = false;
        drops.forEach((d, i) => { if (d.life > 0) { alive = true; d.life -= dt; d.vy -= 20 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; } dpos[i * 3] = d.x; dpos[i * 3 + 1] = d.life > 0 ? d.y : -999; dpos[i * 3 + 2] = d.z; });
        dgeo.attributes.position.needsUpdate = true;
        if (!alive) dpts.visible = false;
      }
    });
  }
  // vines hanging over the far mouth (where you pop out)
  {
    const f = F(u1);
    for (let i = 0; i < 9; i++) {
      const l = -WO + 2 * WO * (i + 0.5) / 9, top = P(u1 + 0.4, l, Htop(u1) * 0.92), low = Math.max(archH(Math.min(WI, Math.abs(l))) + 0.6, Htop(u1) * (0.55 + rng() * 0.2));
      const bot = [top[0] + f.tx * 0.2, f.y + low, top[2] + f.tz * 0.2];
      B.misc.push(paint(seg(THREE, top, bot, 0.07, 4), 0x3f9a38));
      for (let j = 0; j < 4; j++) { const t = (j + 0.5) / 4, lf = new THREE.SphereGeometry(0.28, 5, 3); lf.scale(1.3, 0.5, 0.9); lf.translate(top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t); B.misc.push(paint(lf, j % 2 ? 0x5cc850 : 0x4cb040)); }
      if (i % 3 === 1) { const fl = new THREE.SphereGeometry(0.25, 5, 3); fl.translate(bot[0], bot[1], bot[2]); B.misc.push(paint(fl, 0xff6fd0)); }
    }
  }
}

/* =============================================================== the causeway across the pool (the branch's `raised` stretch) */
function causeway(S, br) {
  const { THREE, K, B } = S;
  let k0 = -1, k1 = -1;
  for (let k = 0; k < br.n; k++) if (br.props[k].raised) { if (k0 < 0) k0 = k; k1 = k; }
  if (k0 < 0) return;
  const u0 = k0 * br.ds - 2, u1 = Math.min(br.length, k1 * br.ds + 2), wy = S.track.water ? S.track.water.y : -1;
  for (const s of [1, -1]) {
    const rows = [];
    for (let u = u0; u <= u1 + 1e-6; u += 1) {
      const f = br.frameAt(u), k = br.idx(u), e = br.HW[k] + (s > 0 ? br.OFFL[k] : br.OFFR[k]);
      const at = (l, h) => { const x = f.x + f.lx * s * l, z = f.z + f.lz * s * l, y = f.y + h; const n = nz3(x, y, z); return [x + f.lx * s * n * 0.25, y, z + f.lz * s * n * 0.25]; };
      rows.push([at(e - 0.2, -0.02), at(e + 0.35, 0.35), at(e + 1.0, -0.4), at(e + 1.8, wy - f.y - 0.6), at(e + 2.6, wy - f.y - 2.6)]);
    }
    const g = gridGeo(THREE, rows);
    B.rock.push(worldUV(THREE, mossTint(THREE, g, 0xd8d8cc, 0xa8e090, 0.7), 5));
    // a row of round mossy kerb stones along the edge (where the invisible wall is)
    for (let u = u0 + 0.6; u < u1; u += 1.35) {
      const f = br.frameAt(u), k = br.idx(u), e = br.HW[k] + (s > 0 ? br.OFFL[k] : br.OFFR[k]) + 0.3;
      const st = new THREE.SphereGeometry(0.55, 7, 5); st.scale(1.1, 0.75, 1); st.translate(f.x + f.lx * s * e, f.y + 0.2, f.z + f.lz * s * e);
      B.rock.push(worldUV(THREE, mossTint(THREE, st, 0xd0d0c4, 0x9ad884), 3));
    }
  }
  for (let u = u0; u <= u1; u += 3) { const f = br.frameAt(u); S.K.spots.push({ x: f.x, z: f.z, r: 9 }); }
}

/* =============================================================== the gap in the main road's fence: two mossy boulder piles + ferns */
function mouthMarkers(S, br) {
  const { THREE, K, B, track, ctx, rng } = S;
  const sideM = br.side === 'R' ? -1 : 1, OPEN = sideM > 0 ? track.OPENL : track.OPENR, OFF = sideM > 0 ? track.OFFL : track.OFFR;
  if (!OPEN) return;
  const open = []; for (let k = 0; k < track.n; k++) if (OPEN[k] > 0 && track.JR[k] === br.route && Math.abs(track.dS(k * track.ds, br.sEntry)) < 70) open.push(k * track.ds);
  if (!open.length) return;
  const s0 = Math.min(...open), s1 = Math.max(...open);
  for (const s of [s0 - 1.2, s1 + 1.2]) {
    const f = track.frameAt(s);
    for (let extra = 0.8; extra < 5; extra += 0.5) {
      const lat = sideM * (f.hw + OFF[f.k] + extra), x = f.x + f.lx * lat, z = f.z + f.lz * lat;
      if (!ctx.isClear(x, z, 1.2, 0.1)) continue;
      const y = ctx.groundAt(x, z);
      for (let i = 0; i < 3; i++) { const g = new THREE.DodecahedronGeometry(1, 1); K.place(g, { x: x + (rng() - 0.5) * 1.2, y: y + 0.5 + i * 0.7, z: z + (rng() - 0.5) * 1.2, s: 1.3 - i * 0.3, ry: rng() * 3 }); B.rock.push(worldUV(THREE, mossTint(THREE, g, 0xd0d0c4, 0x9ad884), 3)); }
      for (let i = 0; i < 4; i++) S.L.ferns.push({ x: x + (rng() - 0.5) * 3, y, z: z + (rng() - 0.5) * 3, ry: rng() * 6.28, s: 1.1 + rng() * 0.5, color: 0x5cc04a });
      K.spots.push({ x, z, r: 2.6 });
      break;
    }
  }
}

/* =============================================================== the Sootie Temple over the main road's tunnel */
function sootieTemple(S, sA, sB) {
  const { THREE, K, B, track, ctx, rng } = S;
  const { paint, place } = K;
  const km = track.idx((sA + sB) / 2);
  const WI = track.HW[km] + Math.max(track.OFFL[km], track.OFFR[km]) + 0.25;
  const AW = 4.6, AT = 9.6, H1 = 12, WO = WI + 7.5, BOT = -1.2, s0 = sA - 0.5, s1 = sB + 0.5, len = s1 - s0, sm = (s0 + s1) / 2;
  const archH = l => AW + (AT - AW) * Math.sqrt(Math.max(0, 1 - (l / WI) ** 2));
  const F = s => track.frameAt(s);
  const P = (s, l, h) => { const f = F(s); return [f.x + f.lx * l, f.y + h, f.z + f.lz * l]; };
  const ss = []; for (let s = s0; s < s1 - 0.7; s += 2) ss.push(s); ss.push(s1);
  const NF = 41;
  const innerP = resample((() => { const pr = [[-WI, BOT], [-WI, AW]]; for (let i = 1; i < 16; i++) { const l = -WI + 2 * WI * i / 16; pr.push([l, archH(l)]); } pr.push([WI, AW], [WI, BOT]); return pr; })(), NF);
  const outerP = resample([[-WO, BOT], [-WO, H1], [WO, H1], [WO, BOT]], NF);
  const stoneA = 0xf6eee0, stoneIn = 0xfff6e8, moss = 0xc8e8a8;
  const T = (g, side = stoneA, top = moss, sc = 6) => B.temple.push(worldUV(THREE, mossTint(THREE, g, side, top, 0.8), sc));
  { const g = mossTint(THREE, gridGeo(THREE, ss.map(s => innerP.map(([l, h]) => P(s, l, h)))), stoneIn, stoneIn); const c = g.attributes.color; for (let i = 0; i < c.array.length; i++) c.array[i] *= 1.6; B.temple.push(worldUV(THREE, g, 6)); }   // its own shadow darkens the inside: lift it
  T(gridGeo(THREE, ss.map(s => outerP.map(([l, h]) => P(s, l, h)))));
  for (const s of [s0, s1]) T(gridGeo(THREE, [innerP.map(([l, h]) => P(s, l, h)), outerP.map(([l, h]) => P(s, l, h))]));
  const fm = F(sm), yaw = fm.yaw, y0 = fm.y;
  const box = (w, h, d, s, l, yb, col = stoneA) => { const g = new THREE.BoxGeometry(w, h, d); const p = P(s, l, yb + h / 2); place(g, { x: p[0], y: p[1], z: p[2], ry: yaw }); T(g, col); return g; };
  // a carved band round the top of tier 1, then the stepped tiers and the shrine on top
  box(2 * WO + 0.8, 0.9, len + 0.8, sm, 0, H1 - 0.2, 0xe2dccb);
  const tiers = [[2 * WO - 6, 8.5, len - 7], [2 * WO - 13, 6, len - 15], [2 * WO - 19, 5, len - 23]];
  let yb = H1 + 0.7;
  for (const [w, h, d] of tiers) { box(w, h, d, sm, 0, yb); box(w + 0.6, 0.6, d + 0.6, sm, 0, yb + h - 0.3, 0xe2dccb); yb += h; }
  // shrine with a little roof and a golden ball
  box(7, 4.2, 7, sm, 0, yb); { const r = new THREE.ConeGeometry(5.6, 3, 4); const p = P(sm, 0, yb + 4.2 + 1.5); place(r, { x: p[0], y: p[1], z: p[2], ry: yaw + Math.PI / 4 }); T(r, 0xe2dccb, moss); }
  { const g = new THREE.SphereGeometry(0.9, 12, 8); const p = P(sm, 0, yb + 8.1); g.translate(p[0], p[1], p[2]); B.glow.push(paint(g, 0xffd23f)); }
  // steps up the side of each tier (decoration)
  // ---- the SOOTIE FACE over the door (the entrance face looks back down the road at the oncoming karts)
  const G = B.glow; glowMaterial(S);
  const fA = F(s0), nx = -fA.tx, nzv = -fA.tz;          // outward normal of the entrance face
  const faceS = s0 + 3.5 - 0.45, cy = y0 + H1 + 5.2, R = 6.3;
  const at = (l, h, out = 0) => { const p = P(faceS, l, 0); return [p[0] + nx * out, cy + h, p[2] + nzv * out]; };
  const facing = (g, l, h, out, rz = 0) => { g.rotateZ(rz); g.rotateY(yaw + Math.PI); const p = at(l, h, out); g.translate(p[0], p[1], p[2]); return g; };
  const FUR = 0x3d3548, WHITE = 0xf4f0f8, PINK = 0xff9db0, MINT = 0x8ff0b4;
  { const g = new THREE.TorusGeometry(R + 0.35, 0.55, 6, 32); T(facing(g, 0, 0, 0.2), 0xe2dccb, 0xe2dccb, 3); }
  B.misc.push(paint(facing(new THREE.CircleGeometry(R, 32), 0, 0, 0.25), FUR));
  for (const sd of [1, -1]) {
    // ears
    const ear = new THREE.ConeGeometry(2.4, 4.6, 4); ear.rotateY(Math.PI / 4); ear.scale(1, 1, 0.45);
    B.misc.push(paint(facing(ear, sd * 3.9, R - 0.2, 0.15, -sd * 0.42), FUR));
    const ein = new THREE.ConeGeometry(1.3, 2.8, 4); ein.rotateY(Math.PI / 4); ein.scale(1, 1, 0.3);
    B.misc.push(paint(facing(ein, sd * 3.95, R - 0.5, 0.75, -sd * 0.42), PINK));
    // eyes: glowing mint, a dark slit pupil, a white sparkle
    const eye = new THREE.CircleGeometry(1.25, 20); eye.scale(1, 1.15, 1); G.push(paint(facing(eye, sd * 2.35, 1.2, 0.32), MINT));
    const pup = new THREE.CircleGeometry(0.42, 12); pup.scale(0.55, 2.0, 1); B.misc.push(paint(facing(pup, sd * 2.35, 1.2, 0.36), 0x141018));
    const spk = new THREE.CircleGeometry(0.24, 8); G.push(paint(facing(spk, sd * 2.35 + 0.35, 1.75, 0.4), 0xffffff));
    // white muzzle cheeks + whiskers
    const ch = new THREE.CircleGeometry(1.25, 16); ch.scale(1.15, 0.9, 1); B.misc.push(paint(facing(ch, sd * 1.05, -1.9, 0.3), WHITE));
    for (let w = 0; w < 3; w++) { const wk = new THREE.BoxGeometry(3.6, 0.13, 0.08); B.misc.push(paint(facing(wk, sd * 4.3, -1.6 - w * 0.5 + 0.4, 0.42, sd * (0.18 - w * 0.18)), WHITE)); }
    // the smile: two little arcs under the nose (a cat's "w")
    const sm2 = new THREE.TorusGeometry(0.62, 0.13, 5, 12, Math.PI); B.misc.push(paint(facing(sm2, sd * 0.6, -2.05, 0.45, Math.PI), 0x141018));
  }
  { const nose = new THREE.CircleGeometry(0.75, 3); B.misc.push(paint(facing(nose, 0, -1.2, 0.42, -Math.PI / 2), PINK)); }
  // guardian kitties: two little sitting stone cats either side of the door, mint-eyed
  for (const sd of [1, -1]) {
    const l = sd * (WI + 3.2), p = P(s0 - 2.2, l, 0);
    if (!ctx.isClear(p[0], p[2], 1.6, 0.2)) continue;
    const gy = ctx.groundAt(p[0], p[2]) - 0.2, cat = [];
    const add = (g, x, y, z) => { g.translate(x, y, z); cat.push(g); };
    add(new THREE.CylinderGeometry(1.4, 1.6, 0.8, 10), 0, 0.4, 0);
    { const b = new THREE.SphereGeometry(1.25, 10, 8); b.scale(1, 1.3, 0.9); add(b, 0, 2.2, 0); }
    add(new THREE.SphereGeometry(0.95, 10, 8), 0, 4.0, 0.1);
    for (const e of [1, -1]) { const ear = new THREE.ConeGeometry(0.42, 0.9, 4); ear.rotateZ(-e * 0.3); add(ear, e * 0.55, 4.95, 0.1); }
    { const tl = new THREE.TorusGeometry(0.9, 0.22, 5, 12, Math.PI); tl.rotateY(Math.PI / 2); add(tl, 1.1, 1.1, -0.2); }
    const g = K.merge(cat.map(c => paint(c, 0xffffff)));
    g.rotateY(yaw + Math.PI); g.translate(p[0], gy, p[2]);
    T(g, stoneA, moss, 2);
    for (const e of [1, -1]) { const eg = new THREE.SphereGeometry(0.17, 6, 4); const lx = e * 0.36; eg.translate(lx, 4.1, 0.95); eg.rotateY(yaw + Math.PI); eg.translate(p[0], gy, p[2]); G.push(paint(eg, MINT)); }
    K.spots.push({ x: p[0], z: p[2], r: 2.4 });
  }
  // torches by the door + inside: flames glow; paired mint "cat eyes" glowing in the walls inside
  const flame = (p) => { const c = new THREE.ConeGeometry(0.3, 0.9, 7); c.translate(p[0], p[1] + 0.35, p[2]); G.push(paint(c, 0xffb02e)); const b = new THREE.SphereGeometry(0.24, 7, 5); b.translate(p[0], p[1] + 0.1, p[2]); G.push(paint(b, 0xfff07a)); };
  for (const sd of [1, -1]) {
    const p = P(s0 - 0.6, sd * (WI + 1.2), 5.2); const st = new THREE.CylinderGeometry(0.12, 0.16, 1.4, 6); st.translate(p[0], p[1] - 0.7, p[2]); B.misc.push(paint(st, 0x6a4424)); flame(p);
  }
  for (let s = s0 + 5, i = 0; s < s1 - 3; s += 7, i++) {
    for (const sd of [1, -1]) {
      const f = F(s), l = sd * (WI - 0.06);
      if (i % 2 === 0) { const p = P(s, l - sd * 0.25, 3.3); const st = new THREE.CylinderGeometry(0.1, 0.13, 1.1, 6); st.translate(p[0], p[1] - 0.6, p[2]); B.misc.push(paint(st, 0x6a4424)); flame(p); }
      else for (const e of [-0.45, 0.45]) { const p = P(s + e, l, 5.6); const g = new THREE.SphereGeometry(0.22, 8, 5); g.scale(0.7, 1, 0.7); g.translate(p[0] - f.lx * sd * 0.05, p[1], p[2] - f.lz * sd * 0.05); G.push(paint(g, MINT)); }
    }
  }
  // her tail curls up over the exit
  {
    const fB = F(s1), V = (l, h) => { const p = P(s1 + 0.6, l, h); return new THREE.Vector3(p[0] + fB.tx * 0.2, p[1], p[2] + fB.tz * 0.2); };
    const curve = new THREE.CatmullRomCurve3([V(-6.5, H1 - 2.5), V(-8.2, H1 + 2.5), V(-7.6, H1 + 6.5), V(-4.8, H1 + 8.6), V(-2.4, H1 + 7.6), V(-2.6, H1 + 5.6), V(-4.2, H1 + 5.4)]);
    const tail = new THREE.TubeGeometry(curve, 48, 0.85, 8, false);
    { const p = tail.attributes.position, r = new Float32Array(p.count); void r; }
    B.misc.push(paint(tail, FUR));
    const tip = new THREE.SphereGeometry(1.05, 10, 8); const e = curve.getPoint(1); tip.translate(e.x, e.y, e.z); B.misc.push(paint(tip, WHITE));
  }
  // vines hanging down the entrance face (never into the doorway)
  for (let i = 0; i < 14; i++) {
    const l = -WO + 2 * WO * (i + 0.5) / 14; if (Math.abs(l) < WI + 0.6 && rng() < 0.6) continue;
    const top = P(s0 - 0.35, l, H1 + 0.2), low = Math.abs(l) < WI + 0.6 ? archH(Math.min(WI, Math.abs(l))) + 0.8 : 1.5 + rng() * 5;
    const bot = [top[0], P(s0, l, low)[1], top[2]];
    B.misc.push(paint(seg(THREE, top, bot, 0.07, 4), 0x3f9a38));
    for (let j = 0; j < 5; j++) { const t = (j + 0.5) / 5, lf = new THREE.SphereGeometry(0.3, 5, 3); lf.scale(1.3, 0.5, 0.9); lf.translate(top[0], top[1] + (bot[1] - top[1]) * t, top[2]); B.misc.push(paint(lf, j % 2 ? 0x5cc850 : 0x4cb040)); }
  }
  // keep props off the temple
  for (let s = s0 - 3; s <= s1 + 3; s += 3) for (const sd of [1, -1, 0]) { const p = P(s, sd * (WO * 0.6), 0); K.spots.push({ x: p[0], z: p[2], r: WO * 0.5 + 2 }); }
}

/* =============================================================== the rope bridge over Hippo River (the main road's `raised` stretch) */
function ropeBridge(S) {
  const { THREE, K, B, track } = S;
  const { paint } = K;
  let s0 = null, s1 = null;
  for (let k = 0; k < track.n; k++) if (track.props[k].raised) { const s = k * track.ds; if (s0 == null) s0 = s; s1 = s; }
  if (s0 == null) return;
  const a = s0 - 1.5, b = s1 + 2.5;
  const edge = (s, sd) => { const f = track.frameAt(s); return f.hw + (sd > 0 ? track.OFFL[f.k] : track.OFFR[f.k]); };
  // planks over the road (wood texture, planks across) + the deck's thickness underneath
  {
    const g = K.lofted(a, b, 0.5, (s, f) => [1, -1].map(sd => { const p = track.pointAt(s, sd * edge(s, sd)); return { x: p.x, y: p.y + 0.035, z: p.z, u: sd > 0 ? 0 : 3 }; }), { vScale: 2.2 });
    B.wood.push(paint(g, 0xf0d8b0));
    const d = K.lofted(a, b, 1, (s, f) => { const L = edge(s, 1) + 0.25, R = edge(s, -1) + 0.25, p = track.pointAt(s, L), q = track.pointAt(s, -R); return [{ x: p.x, y: p.y + 0.02, z: p.z, u: 0 }, { x: p.x, y: p.y - 0.9, z: p.z, u: 0.3 }, { x: q.x, y: q.y - 0.9, z: q.z, u: 2.7 }, { x: q.x, y: q.y + 0.02, z: q.z, u: 3 }]; }, { vScale: 3 });
    B.wood.push(paint(d, 0xb08a60));
  }
  // posts, rope rails (sagging between the posts), a net of strings, and tall anchor posts at both ends with
  // the main ropes swooping down to the middle of the bridge
  const ROPE = 0xe2c48a, step = 3.2;
  for (const sd of [1, -1]) {
    const posts = [];
    for (let s = a; s <= b + 0.01; s += (b - a) / Math.round((b - a) / step)) { const p = track.pointAt(s, sd * (edge(s, sd) + 0.2)); posts.push([p.x, p.y, p.z]); }
    for (const p of posts) { const g = new THREE.CylinderGeometry(0.13, 0.16, 1.75, 6); g.translate(p[0], p[1] + 0.7, p[2]); B.wood.push(paint(g, 0x8a6440)); }
    for (let i = 0; i + 1 < posts.length; i++) {
      const p = posts[i], q = posts[i + 1];
      for (const [h, sg] of [[1.35, 0.16], [0.75, 0.1]]) { const pts = sagPts([p[0], p[1] + h, p[2]], [q[0], q[1] + h, q[2]], sg, 4); for (let j = 0; j + 1 < pts.length; j++) B.misc.push(paint(seg(THREE, pts[j], pts[j + 1], 0.06, 4), ROPE)); }
      for (let t = 0.25; t < 1; t += 0.25) { const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t; B.misc.push(paint(seg(THREE, [x, y + 0.1, z], [x, y + 1.3 - 0.16 * 4 * t * (1 - t), z], 0.025, 3), ROPE)); }
    }
    // anchors
    const ends = [track.pointAt(a - 1.2, sd * (edge(a, sd) + 0.6)), track.pointAt(b + 1.2, sd * (edge(b, sd) + 0.6))];
    for (const e of ends) { const g = new THREE.CylinderGeometry(0.3, 0.38, 4.6, 8); g.translate(e.x, e.y + 1.8, e.z); B.wood.push(paint(g, 0x7a5636)); const c = new THREE.SphereGeometry(0.42, 8, 5); c.translate(e.x, e.y + 4.15, e.z); B.wood.push(paint(c, 0x7a5636)); }
    const top0 = [ends[0].x, ends[0].y + 4, ends[0].z], top1 = [ends[1].x, ends[1].y + 4, ends[1].z];
    const pts = sagPts(top0, top1, 3.0, 12); for (let j = 0; j + 1 < pts.length; j++) B.misc.push(paint(seg(THREE, pts[j], pts[j + 1], 0.09, 5), ROPE));
    for (let i = 1; i < 12; i += 2) { const p = pts[i]; const pr = track.project({ x: p[0], y: p[1], z: p[2] }, -1, {}); const lo = Math.min(p[1] - 0.2, track.pointAt(pr.s, sd * edge(pr.s, sd)).y + 1.35); if (p[1] - lo > 0.3) B.misc.push(paint(seg(THREE, p, [p[0], lo, p[2]], 0.03, 3), ROPE)); }
  }
  for (let s = a - 4; s <= b + 4; s += 3) { const f = track.frameAt(s); K.spots.push({ x: f.x, z: f.z, r: f.hw + 3 }); }
}

/* =============================================================== the Hippo Hop: a striped lip + JUMP boards either side of the run-up */
function hippoHop(S) {
  const { THREE, K, track, ctx } = S;
  const { paint, merge, place, mesh } = K;
  const stripe = K.canvasTex(128, 32, (g, w, h) => { for (let i = -2; i < 12; i++) { g.fillStyle = i % 2 ? '#ffd23f' : '#3fb848'; g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 16, 0); g.lineTo(i * 16 + 32, h); g.lineTo(i * 16 + 16, h); g.fill(); } });
  stripe.wrapS = THREE.RepeatWrapping;
  const lips = track.jumps.map(j => K.lofted(j.s - 3.2, j.s - 0.2, 0.5, (s, f) => [1, -1].map(sd => { const p = track.pointAt(s, sd * f.hw); return { x: p.x, y: p.y + 0.05, z: p.z, u: sd > 0 ? 0 : f.hw * 2 / 4 }; }), { vScale: 3 }));
  if (lips.length) mesh(merge(lips.map(g => paint(g, 0xffffff))), new THREE.MeshBasicMaterial({ map: stripe, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, side: THREE.DoubleSide }), { name: 'jump-lips' });
  const jt = K.canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3fb848'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#2f8a3a'; g.beginPath(); g.moveTo(40, 96); g.quadraticCurveTo(128, -10, 216, 96); g.lineTo(196, 104); g.quadraticCurveTo(128, 20, 60, 104); g.fill();
    g.beginPath(); g.moveTo(216, 96); g.lineTo(232, 64); g.lineTo(186, 78); g.fill();
  });
  const boards = [];
  for (const j of track.jumps) for (const side of [1, -1]) {
    const b = K.beside(j.s - 30, side, 1.2), y = Math.max(ctx.groundAt(b.x, b.z), track.pointAt(j.s - 30, b.lat).y - 0.4);
    const yaw = Math.atan2(-b.f.tx, -b.f.tz) - side * 0.3;
    const q = new THREE.PlaneGeometry(3.4, 1.7); place(q, { x: b.x, y: y + 2.6, z: b.z, ry: yaw }); boards.push(paint(q, 0xffffff));
    for (const d of [-1.1, 1.1]) { const p = new THREE.CylinderGeometry(0.11, 0.13, 2.2, 6); place(p, { x: b.x + Math.cos(yaw) * d, y: y + 1.1, z: b.z - Math.sin(yaw) * d }); S.B.wood.push(paint(p, 0xc8d870)); }
    K.spots.push({ x: b.x, z: b.z, r: 2.2 });
  }
  if (boards.length) mesh(merge(boards), new THREE.MeshBasicMaterial({ map: jt, toneMapped: false, side: THREE.DoubleSide }), { name: 'jump-boards', receive: false });
}

/* =============================================================== flower garlands strung over the start straight */
function startGarlands(S) {
  const { THREE, K, B, track } = S;
  const { paint } = K;
  const PAL = [0xff5d73, 0xffd23f, 0xff8a3d, 0xff6fd0, 0xffffff, 0xb07cff];
  for (let s = -44; s <= 40; s += 14) {
    if (Math.abs(s) < 5) continue;                          // the start arch is there
    const f = track.frameAt(s), Lw = f.hw + track.OFFL[f.k] + 0.6, Rw = f.hw + track.OFFR[f.k] + 0.6;
    const a = track.pointAt(s, Lw), b = track.pointAt(s, -Rw), top = Math.max(a.y, b.y) + 8.6;
    for (const p of [a, b]) {      // bamboo poles: segmented green
      const h = top - p.y + 0.4;
      for (let y = 0; y < h; y += 1.2) { const g = new THREE.CylinderGeometry(0.16, 0.16, Math.min(1.2, h - y) - 0.06, 7); g.translate(p.x, p.y + y + 0.6, p.z); B.misc.push(paint(g, (y / 1.2) & 1 ? 0xb8d060 : 0xc8e070)); }
    }
    const pts = sagPts([a.x, top, a.z], [b.x, top, b.z], 1.1, 10);
    for (let j = 0; j + 1 < pts.length; j++) B.misc.push(paint(seg(THREE, pts[j], pts[j + 1], 0.09, 4), 0x3f9a38));
    pts.forEach((p, j) => {
      const lf = new THREE.SphereGeometry(0.4, 5, 3); lf.scale(1.3, 0.55, 1); lf.translate(p[0], p[1] - 0.2, p[2]); B.misc.push(paint(lf, 0x5cc850));
      const fl = new THREE.IcosahedronGeometry(0.42, 0); fl.translate(p[0], p[1] - 0.55, p[2]); B.misc.push(paint(fl, PAL[((j + Math.round(s)) % PAL.length + PAL.length) % PAL.length]));
    });
  }
}

/* =============================================================== prop geometries (vertex-coloured, merged per type) */
function treeGeo(S) {
  const { THREE, K } = S; const { paint, paintBy, merge } = K;
  const parts = [];
  parts.push(paintBy(new THREE.CylinderGeometry(0.45, 0.75, 10, 7, 1, true).translate(0, 5, 0), (x, y) => (Math.floor(y * 1.6) & 1 ? 0x7a5a3a : 0x8a6844)));
  for (let i = 0; i < 3; i++) { const a = i * 2.09 + 0.4, r = new THREE.BoxGeometry(0.28, 1.4, 1.3); r.translate(0, 0.55, 0.7); r.rotateY(a); parts.push(paint(r, 0x7a5a3a)); }
  for (const [x, y, z, r, c, d] of [[0, 10.4, 0, 4.1, 0x3f9a3a, 1], [2.6, 9.3, 1.0, 3.0, 0x52b048, 0], [-2.4, 9.5, -1.4, 3.2, 0x46a442, 0], [0.4, 12.1, -0.5, 2.6, 0x5cbc4c, 0]]) {
    const g = new THREE.IcosahedronGeometry(r, d); g.scale(1, 0.72, 1); g.translate(x, y, z); parts.push(paint(g, c));
  }
  // a hanging vine
  parts.push(paint(new THREE.CylinderGeometry(0.06, 0.06, 3.8, 4, 1, true).translate(2.4, 6.7, 1.6), 0x3f8a34));
  for (let j = 0; j < 2; j++) parts.push(paint(new THREE.IcosahedronGeometry(0.28, 0).translate(2.4, 7.6 - j * 1.8, 1.6), 0x5cc850));
  return merge(parts);
}

function palmGeo(S) {
  const { THREE, K } = S; const { paint, merge } = K;
  const parts = [];
  let x = 0, y = 0;
  for (let i = 0; i < 5; i++) { const g = new THREE.CylinderGeometry(0.28 - i * 0.015, 0.34 - i * 0.015, 1.8, 6, 1, true); g.translate(x, y + 0.9, 0); g.rotateZ(-0.04 * i); parts.push(paint(g, i & 1 ? 0xa07a50 : 0x8a6844)); x += 0.14 * i; y += 1.75; }
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, f = new THREE.PlaneGeometry(0.9, 4.2, 1, 3); f.translate(0, 2.1, 0);
    const p = f.attributes.position; for (let j = 0; j < p.count; j++) { const yy = p.getY(j); p.setZ(j, -0.09 * yy * yy); p.setX(j, p.getX(j) * (1 - yy / 5)); }
    f.rotateX(-1.15); f.rotateY(a); f.translate(x, y, 0); f.computeVertexNormals(); parts.push(paint(f, i & 1 ? 0x4cb848 : 0x3f9a3a));
  }
  for (let i = 0; i < 3; i++) { const c = new THREE.IcosahedronGeometry(0.27, 0); c.translate(x + Math.cos(i * 2.1) * 0.35, y - 0.3, Math.sin(i * 2.1) * 0.35); parts.push(paint(c, 0x7a5232)); }
  return merge(parts);
}

function bananaGeo(S) {
  const { THREE, K } = S; const { paint, merge } = K;
  const parts = [paint(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 6, 1, true).translate(0, 1.3, 0), 0x8ab050)];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.3, f = new THREE.PlaneGeometry(1.1, 3.4, 1, 3); f.translate(0, 1.7, 0);
    const p = f.attributes.position; for (let j = 0; j < p.count; j++) { const yy = p.getY(j); p.setZ(j, -0.07 * yy * yy); }
    f.rotateX(-0.75 - (i % 2) * 0.3); f.rotateY(a); f.translate(0, 2.5, 0); f.computeVertexNormals(); parts.push(paint(f, i & 1 ? 0x6fd858 : 0x5cc850));
  }
  // a bunch of bananas (three chunky yellow hands) + the purple flower bud
  for (let r = 0; r < 3; r++) { const b = new THREE.IcosahedronGeometry(0.28, 0); b.scale(1.5, 0.75, 1.1); b.rotateZ(0.4); b.translate(0.6, 1.95 - r * 0.33, (r - 1) * 0.1); parts.push(paint(b, r === 1 ? 0xffe14a : 0xffd23f)); }
  parts.push(paint(new THREE.IcosahedronGeometry(0.18, 0).scale(1, 1.6, 1).translate(0.62, 1.15, 0), 0x9a3a7a));
  return merge(parts);
}

function leafGeo(S) {
  const { THREE, K } = S; const { paintBy, paint, merge } = K;
  // a giant monstera-ish leaf on a stem: heart shape with a few notches, bright midrib
  const sh = new THREE.Shape(); const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N * Math.PI * 2, r = 1 - 0.18 * Math.sin(t / 2) ** 8, notch = (i % 4 === 2 && i > 2 && i < N - 2) ? 0.72 : 1;
    const x = 1.3 * Math.sin(t) * r * notch, y = (1.6 * -Math.cos(t) + 0.55 * Math.cos(2 * t) - 0.2) * notch;
    i ? sh.lineTo(x, y + 1.9) : sh.moveTo(x, y + 1.9);
  }
  const g = new THREE.ShapeGeometry(sh, 2);
  const p = g.attributes.position; for (let j = 0; j < p.count; j++) { const xx = p.getX(j); p.setZ(j, 0.18 * xx * xx); }
  g.scale(1.25, 1.25, 1.25); g.rotateX(-0.5); g.translate(0, 1.6, 0.6); g.computeVertexNormals();
  paintBy(g, (x) => (Math.abs(x) < 0.09 ? 0xd8ffb0 : 0xffffff));
  const stem = paint(new THREE.CylinderGeometry(0.06, 0.08, 1.9, 5).translate(0, 0.95, 0.25), 0xb8e890);
  return merge([g, stem]);
}
function fernGeo(S) {
  const { THREE, K } = S; const { paint, merge } = K;
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, f = new THREE.PlaneGeometry(0.42, 1.7, 1, 3); f.translate(0, 0.85, 0);
    const p = f.attributes.position; for (let j = 0; j < p.count; j++) { const yy = p.getY(j); p.setX(j, p.getX(j) * (1 - yy / 2)); p.setZ(j, -0.18 * yy * yy); }
    f.rotateX(-0.6); f.rotateY(a); f.computeVertexNormals(); parts.push(paint(f, 0xffffff));
  }
  return merge(parts);
}
function flowerGeo(S) {
  const { THREE, K } = S; const { paint, merge } = K;
  const head = new THREE.ConeGeometry(0.3, 0.12, 5, 1, true); head.rotateX(Math.PI); head.translate(0, 0.6, 0);
  return merge([paint(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 3, 1, true).translate(0, 0.3, 0), 0x3f8f3a), paint(head, 0xffffff), paint(new THREE.IcosahedronGeometry(0.08, 0).translate(0, 0.6, 0), 0xffe680)]);
}

function hippoGeo(S) {
  const { THREE, K } = S; const { paint, merge } = K;
  const HIP = 0x9a86b0, PINKY = 0xd8a0b8, parts = [];
  const sp = (r, sx, sy, sz, x, y, z, c, ws = 12, hs = 8) => { const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); g.translate(x, y, z); parts.push(paint(g, c)); };
  sp(1.6, 1, 0.5, 1.5, 0, -0.6, -1.0, HIP);          // back (mostly under water)
  sp(1.0, 1, 0.75, 1.05, 0, 0.15, 0.6, HIP);         // head
  sp(1.0, 1.15, 0.55, 0.75, 0, -0.05, 1.45, PINKY);  // snout
  for (const s of [1, -1]) {
    sp(0.11, 1, 0.7, 1, s * 0.32, 0.22, 2.0, 0x4a3050, 6, 4);              // nostrils
    sp(0.32, 1, 1, 1, s * 0.48, 0.78, 0.55, HIP, 8, 6);                    // eye bumps
    sp(0.17, 1, 1, 1, s * 0.5, 0.86, 0.78, 0xffffff, 8, 6);                // eyes
    sp(0.09, 1, 1, 1, s * 0.5, 0.88, 0.92, 0x141018, 6, 4);
    sp(0.22, 0.8, 1, 0.45, s * 0.72, 0.95, 0.15, HIP, 8, 5);               // ears
    sp(0.13, 0.7, 0.9, 0.3, s * 0.72, 0.97, 0.22, PINKY, 6, 4);
  }
  return merge(parts);
}
function turtleGeo(S) {
  const { THREE, K } = S; const { paint, paintBy, merge } = K;
  const shell = new THREE.SphereGeometry(0.75, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); shell.scale(1, 0.6, 1.2);
  paintBy(shell, (x, y, z) => ((Math.floor(x * 2.2 + 10) + Math.floor(z * 2.2 + 10)) & 1 ? 0x4c9a4a : 0x6fb85a));
  const parts = [shell, paint(new THREE.SphereGeometry(0.3, 8, 6).translate(0, 0.12, 1.0), 0x8ac060)];
  for (const [x, z] of [[0.6, 0.6], [-0.6, 0.6], [0.55, -0.6], [-0.55, -0.6]]) parts.push(paint(new THREE.SphereGeometry(0.2, 6, 4).scale(1.4, 0.4, 0.8).translate(x, 0.03, z), 0x8ac060));
  for (const s of [1, -1]) parts.push(paint(new THREE.SphereGeometry(0.06, 5, 3).translate(s * 0.13, 0.22, 1.24), 0x141018));
  return merge(parts);
}
function lilyGeo(S) {
  const { THREE } = S;
  const g = new THREE.CircleGeometry(0.9, 12, 0.35, Math.PI * 2 - 0.7); g.rotateX(-Math.PI / 2);
  return g;
}
function parrotGeo(S) {
  const { THREE, K } = S; const { paint, merge } = K;
  const parts = [];
  parts.push(paint(new THREE.SphereGeometry(0.22, 8, 6).scale(1, 1, 1.7).translate(0, 0, 0), 0xffffff));               // body
  parts.push(paint(new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0.14, 0.32), 0xffffff));                          // head
  parts.push(paint(new THREE.SphereGeometry(0.1, 6, 4).translate(0, 0.16, 0.36).scale(1, 1, 1), 0xf4f0e8));            // face patch (pale)
  parts.push(paint(new THREE.ConeGeometry(0.06, 0.16, 5).rotateX(Math.PI / 2).translate(0, 0.1, 0.5), 0x2a2420));      // beak
  for (const s of [1, -1]) {
    parts.push(paint(new THREE.BoxGeometry(0.42, 0.04, 0.3).translate(s * 0.27, 0.04, 0.02), 0xd8d8d8));                // wings
    parts.push(paint(new THREE.SphereGeometry(0.03, 4, 3).translate(s * 0.1, 0.2, 0.43), 0x141018));                    // eyes
  }
  parts.push(paint(new THREE.BoxGeometry(0.12, 0.03, 0.6).rotateX(0.25).translate(0, -0.05, -0.55), 0xbcbcbc));      // tail
  return merge(parts);
}
function bushGeo(S) {
  const { THREE, K } = S;
  const parts = [];
  for (const [x, y, z, r] of [[0, 0.7, 0, 1.0], [0.8, 0.55, 0.3, 0.75], [-0.7, 0.5, -0.2, 0.8], [0.1, 1.25, -0.2, 0.65]]) parts.push(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z));
  return K.merge(parts.map(g => K.paint(g, 0xffffff)));
}
