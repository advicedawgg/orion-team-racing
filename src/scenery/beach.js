// scenery/beach.js — Bubbly Beach. Contract: DESIGN.md "Scenery hook"; helpers: scenery/propkit.js.
// (Rewritten by the tracks agent from core's placeholder; the palms are core's.)
//
// Palms, striped umbrellas + towels, a row of pastel beach huts along the start straight, a
// lifeguard tower, the lighthouse at the hairpin, a wooden pier into the sea with a moored boat,
// sailboats, giant rubber ducks bobbing in the lagoon, sandcastles, beach balls, surfboards,
// scuttling crabs (and a giant sand-sculpture crab at Crab Bend), soap bubbles drifting over it
// all, bunting, chevron boards. Everything repeated is instanced; one-offs merged per material.
import { makePropKit } from './propkit.js';

export default function build(ctx) {
  const { THREE, group, track, rng, groundAt, aboveWater } = ctx;
  const K = makePropKit(ctx);
  const { paint, paintBy, merge, place, instanced, mesh, vmat, vmat2 } = K;
  const water = track.water;
  const updaters = [];
  const pick = a => a[(rng() * a.length) | 0];
  const Yup = new THREE.Vector3(0, 1, 0);

  // the gap faces (the lip's and the landing's front walls): packed sand rather than core's tan
  { const gf = group.getObjectByName('gapfaces'); if (gf) gf.material.color.set(0xf2d9a0); }

  // ------------------------------------------------ landmarks first (they need their spots)
  const landmark = [];
  // lighthouse: outside of the tightest LEFT corner (the Lighthouse Hairpin)
  let best = 0, bk = 0; for (let k = 0; k < track.n; k++) if (track.CURV[k] > best) { best = track.CURV[k]; bk = k; }
  {
    const b = K.beside(bk * track.ds, -1, 14), ly = groundAt(b.x, b.z);
    for (let i = 0; i < 6; i++) { const g = new THREE.CylinderGeometry(2.2 - i * 0.22 - 0.22, 2.2 - i * 0.22, 2.4, 14); g.translate(b.x, ly + 1.2 + i * 2.4, b.z); landmark.push(paint(g, i % 2 ? 0xffffff : 0xe0332c)); }
    const gal = new THREE.CylinderGeometry(1.7, 1.7, 0.35, 14); gal.translate(b.x, ly + 14.6, b.z); landmark.push(paint(gal, 0x2d3142));
    const lamp = new THREE.CylinderGeometry(1.0, 1.0, 1.6, 10); lamp.translate(b.x, ly + 15.6, b.z); landmark.push(paint(lamp, 0xfff3a0));
    const roof = new THREE.ConeGeometry(1.4, 1.6, 10); roof.translate(b.x, ly + 17.2, b.z); landmark.push(paint(roof, 0xe0332c));
    const door = new THREE.BoxGeometry(1.1, 1.8, 0.3); place(door, { x: b.x + b.f.lx * 2.05, y: ly + 0.9, z: b.z + b.f.lz * 2.05, ry: b.f.yaw + Math.PI / 2 }); landmark.push(paint(door, 0x2f6fdc));
    K.spots.push({ x: b.x, z: b.z, r: 4 });
  }
  // lifeguard tower: on the beach beside the start straight (right-hand side, toward the sea)
  {
    const b = K.beside(-24, -1, 11), c = K.claim(b.x, b.z, 3.2, { margin: 1 });
    if (c) {
      const y = c.y, yaw = b.f.yaw - Math.PI / 2;
      for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) { const leg = new THREE.CylinderGeometry(0.12, 0.14, 3.4, 6); place(leg, { x: c.x + dx, y: y + 1.7, z: c.z + dz }); landmark.push(paint(leg, 0xffffff)); }
      const cab = new THREE.BoxGeometry(3.2, 2.2, 3.2); place(cab, { x: c.x, y: y + 4.5, z: c.z, ry: yaw }); landmark.push(paintBy(cab, (x, yy) => (yy - y > 4.2 ? 0xe0332c : 0xffffff)));
      const roof = new THREE.ConeGeometry(2.8, 1.3, 4); place(roof, { x: c.x, y: y + 6.25, z: c.z, ry: yaw + Math.PI / 4 }); landmark.push(paint(roof, 0xffd23f));
      const win = new THREE.BoxGeometry(2.4, 0.9, 0.2); const wf = { x: Math.sin(yaw), z: Math.cos(yaw) };
      place(win, { x: c.x - wf.x * 1.62, y: y + 4.8, z: c.z - wf.z * 1.62, ry: yaw }); landmark.push(paint(win, 0x2d3142));
      const ladder = new THREE.BoxGeometry(0.8, 4, 0.12); place(ladder, { x: c.x + wf.x * 2.1, y: y + 1.9, z: c.z + wf.z * 2.1, ry: yaw, rx: -0.35 }); landmark.push(paint(ladder, 0xffffff));
      const pole = new THREE.CylinderGeometry(0.06, 0.06, 3, 5); pole.translate(c.x + 1.3, y + 7.9, c.z + 1.3); landmark.push(paint(pole, 0xdddddd));
      const flag = new THREE.BoxGeometry(0.05, 0.8, 1.3); flag.translate(c.x + 1.3, y + 9, c.z + 1.95); landmark.push(paintBy(flag, (x, yy) => (yy - y > 9 ? 0xe0332c : 0xffd23f)));
      // an orange rescue ring on the leg
      const ring = new THREE.TorusGeometry(0.45, 0.13, 6, 14); place(ring, { x: c.x - wf.x * 1.45, y: y + 2.2, z: c.z - wf.z * 1.45, ry: yaw }); landmark.push(paintBy(ring, (x, yy, z) => (Math.floor(Math.atan2(yy - y - 2.2, x - c.x) / 0.8) & 1 ? 0xff7a1a : 0xffffff)));
    }
  }

  // ------------------------------------------------ the Sandcastle Cave: a giant sandcastle over every `tunnel` stretch of a branch
  for (const br of ctx.branches || []) {
    let u0 = -1;
    for (let k = 0; k <= br.n; k++) {
      const on = k < br.n && (br.FLAG[k] & 8) !== 0;
      if (on && u0 < 0) u0 = k * br.ds;
      else if (!on && u0 >= 0) { sandcastleCave(ctx, K, br, u0, (k - 1) * br.ds, updaters); u0 = -1; }
    }
  }

  // ------------------------------------------------ the pier: from the beach out into the sea, where the shore is nearest
  if (water) {
    let bestP = null;
    for (let s = 0; s < track.length; s += 12) for (const side of [1, -1]) {
      const b0 = K.beside(s, side, 4);
      if (Math.abs(track.dS(s, bk * track.ds)) < 60 || Math.abs(track.dS(s, 0)) < 50) continue;   // not at the lighthouse or the start
      const dir = { x: b0.f.lx * side, z: b0.f.lz * side };
      for (let d = 4; d < 120; d += 2) {
        const x = b0.x + dir.x * d, z = b0.z + dir.z * d;
        if (!ctx.isClear(x, z, 2.5, 1.5)) break;
        if (groundAt(x, z) < water.y - 0.4) {
          // how far can it run out over the water before it meets anything (the other side of the lagoon)?
          let free = 0; while (free < 46 && ctx.isClear(b0.x + dir.x * (d + free + 3), b0.z + dir.z * (d + free + 3), 3, 2.5)) free += 2;
          if (free >= 22 && (!bestP || d - free * 0.5 < bestP.d - bestP.free * 0.5)) bestP = { s, side, d, free, x0: b0.x, z0: b0.z, dir };
          break;
        }
      }
    }
    if (bestP) {
      const { x0, z0, dir, d } = bestP, len = bestP.free, start = Math.max(3, d - 14), deckY = water.y + 1.9;
      const yaw = Math.atan2(dir.x, dir.z), planks = [], posts = [];
      for (let t = start; t < d + len; t += 1.1) {
        const x = x0 + dir.x * t, z = z0 + dir.z * t, gy = groundAt(x, z), y = Math.max(deckY, gy + 0.5);
        const p = new THREE.BoxGeometry(3.4, 0.18, 0.95); place(p, { x, y, z, ry: yaw }); planks.push(p);
        if (Math.round(t / 1.1) % 4 === 0) for (const sd of [-1.5, 1.5]) {
          const px = x + Math.cos(yaw) * sd, pz = z - Math.sin(yaw) * sd, h = y - Math.min(gy, water.y - 2) + 1;
          const post = new THREE.CylinderGeometry(0.16, 0.18, h, 6); post.translate(px, y + 1 - h / 2, pz); posts.push(paint(post, 0x8a5c30));
          const rail = new THREE.CylinderGeometry(0.07, 0.07, 1.1, 5); rail.translate(px, y + 0.6, pz); posts.push(paint(rail, 0xffffff));
        }
      }
      // rope rails along both sides
      for (const sd of [-1.5, 1.5]) {
        const a = new THREE.Vector3(x0 + dir.x * start + Math.cos(yaw) * sd, deckY + 1.1, z0 + dir.z * start - Math.sin(yaw) * sd);
        const bb = new THREE.Vector3(x0 + dir.x * (d + len) + Math.cos(yaw) * sd, deckY + 1.1, z0 + dir.z * (d + len) - Math.sin(yaw) * sd);
        const r = new THREE.CylinderGeometry(0.05, 0.05, a.distanceTo(bb), 4); r.rotateX(Math.PI / 2); r.lookAt(bb.clone().sub(a)); r.translate((a.x + bb.x) / 2, a.y, (a.z + bb.z) / 2); posts.push(paint(r, 0xffffff));
      }
      const wood = ctx.loadTex('wood', null);
      const pm = merge(planks.map(g => paint(g, 0xffffff)));
      { const uv = pm.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.2, uv.getY(i) * 0.3); }
      mesh(pm, new THREE.MeshLambertMaterial({ map: wood, color: 0xffffff }), { name: 'pier', shadow: true });
      mesh(merge(posts), vmat, { name: 'pier-posts', shadow: false });
      bestP.end = { x: x0 + dir.x * (d + len - 4), z: z0 + dir.z * (d + len - 4), yaw };
      for (let t = start - 2; t < d + 4; t += 6) K.spots.push({ x: x0 + dir.x * t, z: z0 + dir.z * t, r: 3 });
    }
    ctx._pier = bestP;
  }

  // ------------------------------------------------ beach huts: a pastel row behind the start straight's right-hand fence
  const huts = [];
  for (let s = -66, i = 0; s < 38; s += 7.5, i++) {
    if (Math.abs(s + 24) < 6) continue;                    // the lifeguard tower
    const b = K.beside(s, -1, 3.4), c = K.claim(b.x, b.z, 2, { margin: 0.4 });
    if (c) huts.push({ x: c.x, y: c.y, z: c.z, ry: b.f.yaw + Math.PI / 2, s: 1, color: [0xff9ec4, 0x8fd8ff, 0xfff08a, 0xa8f0b8, 0xd4b8ff, 0xffb37a][i % 6] });
  }
  {
    const body = new THREE.BoxGeometry(2.4, 2.6, 2.2).translate(0, 1.3, 0);
    paintBy(body, (x, y, z) => (Math.floor((x + 5) / 0.4) & 1) ? 0xffffff : 0xdcdcdc);
    const roof = new THREE.CylinderGeometry(0.01, 1.9, 1.1, 4, 1).translate(0, 3.15, 0); roof.rotateY(Math.PI / 4); roof.scale(1.05, 1, 0.95);
    paint(roof, 0xf0f0f0);
    const door = new THREE.BoxGeometry(1.0, 1.9, 0.1).translate(0, 0.95, 1.12); paint(door, 0x9a9aa8);
    const step = new THREE.BoxGeometry(1.8, 0.25, 0.7).translate(0, 0.12, 1.4); paint(step, 0xc9a070);
    instanced(merge([body, roof, door, step]), new THREE.MeshLambertMaterial({ vertexColors: true }), huts, { name: 'beach-huts', shadow: true });
  }

  // ------------------------------------------------ scatter: palms, umbrellas, rocks, sandcastles, beach balls, surfboards
  const palms = [], brollies = [], rocks = [], castles = [], balls = [], boards = [];
  for (const c of K.scatter({ step: 9, near: 3, far: 29, r: 2.2, chance: 0.95 })) {
    const roll = rng();
    if (roll < 0.5) palms.push(c); else if (roll < 0.64) brollies.push(c); else if (roll < 0.74) rocks.push(c);
    else if (roll < 0.83) castles.push(c); else if (roll < 0.91) boards.push(c); else balls.push(c);
  }
  for (const c of K.scatterWide(90, 3)) palms.push(c);
  // a few families: umbrella + towel + sandcastle + ball clusters near the start
  for (const s of [55, 140, 420, 900]) {
    const b = K.beside(s, rng() < 0.5 ? 1 : -1, 6), c = K.claim(b.x, b.z, 2);
    if (!c) continue; brollies.push(c);
    const c2 = K.claim(b.x + 3, b.z + 2, 1.2); if (c2) castles.push(c2);
    const c3 = K.claim(b.x - 2.5, b.z + 2.5, 0.6); if (c3) balls.push(c3);
  }

  // palm tree: bent trunk + crown (two instanced meshes) — core's model
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
    const list = palms.map(pl => ({ x: pl.x, y: pl.y - 0.2, z: pl.z, ry: rng() * Math.PI * 2, s: 0.8 + rng() * 0.6 }));
    instanced(merge(trunkParts), vmat, list, { name: 'palms', shadow: true });
    instanced(merge(crownParts), vmat2, list, { name: 'palm-crowns', shadow: true });
  }
  // umbrellas: the canopy's stripes alternate white / the instance colour (two meshes); towel in the instance colour
  if (brollies.length) {
    const pole = paint(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5).translate(0, 1.15, 0), 0xf5f5f5);
    const cone = new THREE.ConeGeometry(1.5, 0.6, 12, 1, true).translate(0, 2.35, 0).toNonIndexed();
    const cp = cone.attributes.position.array, colTri = [], whiteTri = [];
    for (let i = 0; i < cp.length; i += 9) {
      const cx = (cp[i] + cp[i + 3] + cp[i + 6]) / 3, cz = (cp[i + 2] + cp[i + 5] + cp[i + 8]) / 3;
      const seg = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 12);
      (seg % 2 ? whiteTri : colTri).push(...cp.slice(i, i + 9));
    }
    const tri = arr => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g; };
    const towel = new THREE.BoxGeometry(1.0, 0.04, 1.9).translate(1.2, 0.03, 0.4);
    const list = brollies.map(b => ({ x: b.x, y: b.y, z: b.z, ry: rng() * 6.28, color: pick([0xff5d73, 0x2f8fe8, 0xffd23f, 0x6ff08f, 0xb07cff, 0xff9d2f]) }));
    instanced(merge([paint(tri(whiteTri), 0xffffff), pole]), vmat2, list.map(o => ({ ...o, color: undefined })), { name: 'umbrellas-white', shadow: false });
    instanced(merge([paint(tri(colTri), 0xffffff), paint(towel, 0xffffff)]), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), list, { name: 'umbrellas', shadow: true });
  }
  if (rocks.length) {
    instanced(paint(new THREE.DodecahedronGeometry(1, 0), 0xa89c8c), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      rocks.map(r => { const s = 0.8 + rng() * 1.6; return { x: r.x, y: r.y + s * 0.2, z: r.z, rx: rng() * 3, ry: rng() * 3, rz: rng() * 3, sx: s * (1 + rng() * 0.5), sy: s * 0.7, sz: s }; }), { name: 'rocks', shadow: false, receive: true });
  }
  if (castles.length) {
    const sandC = 0xf0d49a, parts = [];
    const base = new THREE.BoxGeometry(2.2, 0.8, 2.2).translate(0, 0.4, 0); parts.push(paint(base, sandC));
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const t = new THREE.CylinderGeometry(0.42, 0.5, 1.5, 8).translate(dx, 0.75, dz); parts.push(paint(t, 0xe8c888));
      const c = new THREE.ConeGeometry(0.5, 0.5, 8).translate(dx, 1.75, dz); parts.push(paint(c, sandC));
    }
    const keep = new THREE.CylinderGeometry(0.6, 0.7, 1.4, 8).translate(0, 1.5, 0); parts.push(paint(keep, 0xe8c888));
    const pole = new THREE.CylinderGeometry(0.03, 0.03, 1, 4).translate(0, 2.7, 0); parts.push(paint(pole, 0xffffff));
    const flag = new THREE.BoxGeometry(0.5, 0.32, 0.03).translate(0.26, 3.05, 0); parts.push(paint(flag, 0xff5d73));
    const moat = new THREE.TorusGeometry(1.9, 0.18, 4, 18).rotateX(Math.PI / 2).translate(0, 0.02, 0); parts.push(paint(moat, 0x4ec5f1));
    instanced(merge(parts), vmat, castles.map(c => ({ x: c.x, y: c.y - 0.05, z: c.z, ry: rng() * 6.28, s: 0.9 + rng() * 0.5 })), { name: 'sandcastles', shadow: false });
  }
  if (balls.length) {
    const g = paintBy(new THREE.SphereGeometry(0.55, 12, 8), (x, y, z) => [0xff5d73, 0xffffff, 0x2f8fe8, 0xffffff, 0xffd23f, 0xffffff][Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 3)) % 6]);
    instanced(g, vmat, balls.map(c => ({ x: c.x, y: c.y + 0.5, z: c.z, ry: rng() * 6, rx: rng() }))
      , { name: 'beach-balls', shadow: false });
  }
  if (boards.length) {
    const g = new THREE.CapsuleGeometry(0.42, 2.2, 3, 8); g.scale(1, 1, 0.18); g.translate(0, 1.2, 0);
    const stripe = new THREE.BoxGeometry(0.12, 2.6, 0.2).translate(0, 1.3, 0);
    instanced(merge([paint(g, 0xffffff), paint(stripe, 0xf4f4f4)]), new THREE.MeshLambertMaterial({ color: 0xffffff }),
      boards.map(c => ({ x: c.x, y: c.y - 0.3, z: c.z, ry: rng() * 6.28, rz: (rng() - 0.5) * 0.35, color: pick([0xff5d73, 0x4ec5f1, 0xffd23f, 0x6ff08f, 0xff9d2f]) })), { name: 'surfboards', shadow: false });
  }

  // ------------------------------------------------ crabs: a few scuttle sideways beside the road; a giant sand crab at Crab Bend
  {
    const parts = [];
    const body = new THREE.SphereGeometry(0.5, 12, 8); body.scale(1.2, 0.55, 0.9); body.translate(0, 0.35, 0); parts.push(paint(body, 0xff5a3c));
    for (const sd of [-1, 1]) {
      const stalk = new THREE.CylinderGeometry(0.04, 0.04, 0.3, 4).translate(sd * 0.18, 0.68, 0.3); parts.push(paint(stalk, 0xff5a3c));
      const eye = new THREE.SphereGeometry(0.1, 8, 6).translate(sd * 0.18, 0.86, 0.3); parts.push(paint(eye, 0xffffff));
      const pupil = new THREE.SphereGeometry(0.05, 6, 4).translate(sd * 0.18, 0.88, 0.39); parts.push(paint(pupil, 0x111111));
      const arm = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 5); arm.rotateZ(sd * 0.9); arm.translate(sd * 0.72, 0.5, 0.25); parts.push(paint(arm, 0xff5a3c));
      const claw = new THREE.SphereGeometry(0.22, 8, 6); claw.scale(1, 0.8, 1.2); claw.translate(sd * 0.95, 0.72, 0.35); parts.push(paint(claw, 0xff7a5a));
      for (let l = 0; l < 3; l++) { const leg = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4); leg.rotateZ(sd * 1.1); leg.translate(sd * 0.62, 0.2, -0.2 + l * 0.2); parts.push(paint(leg, 0xe0442a)); }
    }
    const smile = new THREE.TorusGeometry(0.12, 0.025, 4, 8, Math.PI); smile.rotateZ(Math.PI); smile.translate(0, 0.45, 0.46); parts.push(paint(smile, 0x5a1a10));
    const crabGeo = merge(parts);
    const crabs = [];
    for (const s of [track.sOf(16.2), track.sOf(17.8), track.sOf(2.6), track.sOf(9.5), track.sOf(19.3)]) {
      const side = rng() < 0.5 ? 1 : -1, b = K.beside(s, side, 2.5), c = K.claim(b.x, b.z, 1.6, { margin: 0.4 });
      if (c) crabs.push({ ...c, yaw: b.f.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), ph: rng() * 6, dir: { x: b.f.tx, z: b.f.tz } });
    }
    // the giant sand-sculpture crab at the outside of Crab Bend (the last big left)
    const cb = K.corners(40).filter(c => c.dir > 0).sort((a, b) => b.s0 - a.s0)[0];
    if (cb) {
      const b = K.beside(cb.apex, -1, 12), c = K.claim(b.x, b.z, 5, { margin: 1 });
      if (c) crabs.push({ ...c, yaw: Math.atan2(-b.f.lx, -b.f.lz) + Math.PI, ph: 0, big: true, dir: { x: 0, z: 0 } });
    }
    const im = instanced(crabGeo, vmat, crabs.map(c => ({ x: c.x, y: c.y, z: c.z, ry: c.yaw, s: c.big ? 5 : 1.4 })), { name: 'crabs', shadow: false });
    if (im) {
      im.frustumCulled = false;
      updaters.push((dt, t) => {
        crabs.forEach((c, i) => {
          if (c.big) { K.setInstance(im, i, { x: c.x, y: c.y - 0.4, z: c.z, ry: c.yaw + Math.sin(t * 0.6) * 0.08, s: 5 }); return; }
          const u = Math.sin(t * 0.9 + c.ph) * 2.2;
          K.setInstance(im, i, { x: c.x + c.dir.x * u, y: c.y + Math.abs(Math.sin(t * 9 + c.ph)) * 0.06, z: c.z + c.dir.z * u, ry: c.yaw + Math.sin(t * 9 + c.ph) * 0.12, s: 1.4 });
        });
        im.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // ------------------------------------------------ boats at sea, a boat at the pier, rubber ducks in the lagoon
  if (water) {
    const parts = [];
    const hull = new THREE.BoxGeometry(1.6, 0.7, 4.2); hull.translate(0, 0.2, 0); parts.push(paint(hull, 0xffffff));
    const stripe = new THREE.BoxGeometry(1.65, 0.15, 4.25); stripe.translate(0, 0.45, 0); parts.push(paint(stripe, 0x2f6fdc));
    const mast = new THREE.CylinderGeometry(0.07, 0.07, 5, 5); mast.translate(0, 2.8, 0.3); parts.push(paint(mast, 0xdddddd));
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.8, 0.4, 0, 5.1, 0.4, 0, 0.8, -1.8, 0, 0.8, 0.4, 0, 0.8, -1.8, 0, 5.1, 0.4], 3));
    sail.computeVertexNormals(); parts.push(paint(sail, 0xfff6e0));
    const boats = [];
    const b = ctx.bounds;
    for (let i = 0; i < 60 && boats.length < 10; i++) {
      const x = b.x0 + rng() * (b.x1 - b.x0), z = b.z0 + rng() * (b.z1 - b.z0);
      if (aboveWater(x, z, -2.5) || !ctx.isClear(x, z, 6, 10)) continue;
      boats.push({ x, z, yaw: rng() * 6.28, ph: rng() * 6.28 });
    }
    if (ctx._pier?.end) { const e = ctx._pier.end; boats.push({ x: e.x + Math.cos(e.yaw) * 3.6, z: e.z - Math.sin(e.yaw) * 3.6, yaw: e.yaw, ph: 1 }); }
    const im = instanced(merge(parts), vmat2, boats.map(bt => ({ x: bt.x, y: water.y, z: bt.z, ry: bt.yaw, s: 1.3 })), { name: 'boats', shadow: false });
    if (im) {
      im.frustumCulled = false;
      updaters.push((dt, t) => { boats.forEach((bt, i) => K.setInstance(im, i, { x: bt.x, y: water.y + Math.sin(t * 1.3 + bt.ph) * 0.12, z: bt.z, rx: Math.sin(t * 1.1 + bt.ph) * 0.06, ry: bt.yaw, rz: Math.sin(t * 0.9 + bt.ph) * 0.08, s: 1.3 })); im.instanceMatrix.needsUpdate = true; });
    }
    // giant rubber ducks bobbing in the lagoon (and one out at sea)
    const duckParts = [];
    const db = new THREE.SphereGeometry(1, 14, 10); db.scale(1.25, 0.8, 1); db.translate(0, 0.35, 0); duckParts.push(paint(db, 0xffd23f));
    const tail = new THREE.ConeGeometry(0.4, 0.8, 8); tail.rotateZ(-1.2); tail.translate(-1.25, 0.8, 0); duckParts.push(paint(tail, 0xffd23f));
    const head = new THREE.SphereGeometry(0.6, 12, 9); head.translate(0.75, 1.35, 0); duckParts.push(paint(head, 0xffd23f));
    const beak = new THREE.SphereGeometry(0.3, 8, 6); beak.scale(1.3, 0.45, 0.9); beak.translate(1.35, 1.25, 0); duckParts.push(paint(beak, 0xff8a1f));
    for (const sd of [-1, 1]) { const e = new THREE.SphereGeometry(0.1, 6, 4); e.translate(1.18, 1.55, sd * 0.3); duckParts.push(paint(e, 0x111111)); }
    const ducks = [];
    const lagoon = (ctx.def.terrain?.carve || []).find(c => c.type === 'lake');
    for (let i = 0; i < 40 && ducks.length < 5; i++) {
      let x, z;
      if (lagoon && ducks.length < 4) { const a = rng() * 6.28, r = rng() * lagoon.r * 0.6; x = lagoon.x + Math.cos(a) * r; z = lagoon.z + Math.sin(a) * r; }
      else { x = b.x0 + rng() * (b.x1 - b.x0); z = b.z0 + rng() * (b.z1 - b.z0); }
      if (aboveWater(x, z, -1) || !ctx.isClear(x, z, 3, 3)) continue;
      if (ducks.some(d => Math.hypot(d.x - x, d.z - z) < 8)) continue;
      ducks.push({ x, z, yaw: rng() * 6.28, ph: rng() * 6, s: ducks.length < 4 ? 1.6 + rng() * 0.6 : 5 });
    }
    const dim = instanced(merge(duckParts), vmat, ducks.map(d => ({ x: d.x, y: water.y, z: d.z, ry: d.yaw, s: d.s })), { name: 'rubber-ducks', shadow: false });
    if (dim) {
      dim.frustumCulled = false;
      updaters.push((dt, t) => { ducks.forEach((d, i) => K.setInstance(dim, i, { x: d.x, y: water.y - 0.2 * d.s + Math.sin(t * 1.6 + d.ph) * 0.1 * d.s, z: d.z, ry: d.yaw + t * 0.05, rz: Math.sin(t * 1.2 + d.ph) * 0.07, s: d.s })); dim.instanceMatrix.needsUpdate = true; });
    }
  }

  // ------------------------------------------------ bubbles! drifting up over the lagoon and the course (one Points draw)
  {
    const N = 180, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), seeds = [];
    const lagoon = (ctx.def.terrain?.carve || []).find(c => c.type === 'lake');
    const tints = [0xffc9f0, 0xc9f4ff, 0xfff6b8, 0xd9ffd9, 0xe8d4ff].map(c => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      let x, z;
      if (lagoon && i < N * 0.45) { const a = rng() * 6.28, r = rng() * lagoon.r; x = lagoon.x + Math.cos(a) * r; z = lagoon.z + Math.sin(a) * r; }
      else { const f = track.frameAt(rng() * track.length), l = (rng() - 0.5) * 2 * (f.hw + 16); x = f.x + f.lx * l; z = f.z + f.lz * l; }
      const g = Math.max(groundAt(x, z), water ? water.y : -Infinity);
      seeds.push({ x, z, g, ph: rng() * 20, v: 0.5 + rng() * 0.7, top: 9 + rng() * 9 });
      const c = pick(tints); col.set([c.r, c.g, c.b], i * 3);
    }
    const tex = K.canvasTex(64, 64, (g, w, h) => {
      const r = w / 2 - 2, gr = g.createRadialGradient(w / 2, h / 2, r * 0.55, w / 2, h / 2, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0.95)');
      g.fillStyle = gr; g.beginPath(); g.arc(w / 2, h / 2, r, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(w * 0.36, h * 0.34, 6, 4, -0.7, 0, 7); g.fill();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.8, map: tex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    pts.name = 'bubbles'; pts.frustumCulled = false; group.add(pts);
    const put = t => {
      seeds.forEach((s, i) => {
        const u = ((t * s.v + s.ph) % s.top);
        pos[i * 3] = s.x + Math.sin(t * 0.7 + s.ph) * 1.2; pos[i * 3 + 1] = s.g + 0.8 + u; pos[i * 3 + 2] = s.z + Math.cos(t * 0.6 + s.ph) * 1.2;
      });
      geo.attributes.position.needsUpdate = true;
    };
    put(0); updaters.push((dt, t) => put(t));
  }

  // ------------------------------------------------ one-off landmarks merged
  if (landmark.length) mesh(merge(landmark), vmat, { name: 'landmarks', shadow: true });

  // ------------------------------------------------ bunting flags along the start straight (core's) — one mesh
  {
    const parts = [], PAL = [0xff5d73, 0xffd23f, 0x4ec5f1, 0x6ff08f, 0xb07cff];
    for (const side of [1, -1]) {
      for (let s = -70; s < 40; s += 1.6) {
        const f = track.frameAt(s), off = side > 0 ? track.OFFL[f.k] : track.OFFR[f.k];
        const lat = side * (f.hw + off + 0.35), p = track.pointAt(s, lat);
        const sag = 2.6 - 0.25 * Math.sin(((s + 70) % 8) / 8 * Math.PI);
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.45, 0, 0, 0.45, 0, -0.7, 0], 3));
        tri.computeVertexNormals(); tri.rotateY(f.yaw); tri.translate(p.x, p.y + sag, p.z);
        parts.push(paint(tri, PAL[Math.abs(Math.round(s / 1.6)) % PAL.length]));
        if (Math.abs((s + 70) % 8) < 1.6) { const pole = new THREE.CylinderGeometry(0.06, 0.06, 2.9, 5); pole.translate(p.x, p.y + 1.45, p.z); parts.push(paint(pole, 0xf5f5f5)); }
      }
    }
    mesh(merge(parts), vmat2, { name: 'bunting' });
  }

  // ------------------------------------------------ chevron boards before the tight corners
  K.chevrons({ rMax: 40, board: [4, 1.7] });

  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}

/**
 * The Sandcastle Cave (the hidden shortcut — src/tracks/beach.js `branches`): a giant bucket-moulded sandcastle
 * standing over the branch's `tunnel` stretch u0..u1. Inside: an arched cave lit by torches and glowing shells
 * (emissive only — the light pool is fixed). Outside: crenellated walls, four bucket towers, a keep with a flag,
 * shells and starfish pressed into the sand, a giant bucket and spade beside it. Its door is a crumbly sand wall
 * (scenery only — physics never sees it) that bursts into a puff of sand when a kart drives into it and builds
 * itself back once nobody is near. Draws: castle 1 (casts shadow), glow 1, door 1, and while bursting the sand
 * chunks + dust 2. Karts are read from window.__OTR.race (scenery's update only gets dt, t).
 */
function sandcastleCave(ctx, K, br, t0, t1, updaters) {
  // the castle starts a little before the tunnel stretch, so the branch's fence ends inside it
  const u0 = Math.max(0, t0 - 1.2), u1 = Math.min(br.length, t1 + 0.5);
  const { THREE, rng } = ctx;
  const { paint, paintBy, merge, place, mesh, instanced } = K;
  const WI = 7.4, AW = 3.0, AT = 9.4, WO = 10.5, HC = 11.5, BOT = -1.6, TR = 3.0;
  const archH = l => AW + (AT - AW) * Math.sqrt(Math.max(0, 1 - (l / WI) ** 2));
  const P = (u, l, h) => { const f = br.frameAt(u); return [f.x + f.lx * l, f.y + h, f.z + f.lz * l]; };
  const us = []; for (let u = u0; u < u1 - 0.6; u += 1.5) us.push(u); us.push(u1);
  const um = (u0 + u1) / 2;
  // a quad grid through rows of points (every row the same length)
  const ribbon = rows => {
    const nc = rows[0].length, pos = [], idx = [];
    for (const r of rows) for (const p of r) pos.push(p[0], p[1], p[2]);
    for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < nc - 1; c++) { const a = r * nc + c, b = a + nc; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const uv = [], dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    rows.forEach((r, ri) => { let v = 0; r.forEach((p, c) => { if (c) v += dist(p, r[c - 1]); const u = ri ? dist(p, rows[ri - 1][c]) : 0; uv.push(u, v / 7); }); });
    for (let c = 0; c < nc; c++) for (let ri = 1; ri < rows.length; ri++) uv[(ri * nc + c) * 2] += uv[((ri - 1) * nc + c) * 2];
    for (let i = 0; i < uv.length; i += 2) uv[i] /= 7;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); g.userData.uvDone = true; return g;
  };
  const along = prof => ribbon(us.map(u => prof.map(([l, h]) => P(u, l, h))));
  // resample a (lat, h) polyline to n points by arc length
  const resample = (poly, n) => {
    const d = [0]; for (let i = 1; i < poly.length; i++) d.push(d[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    const out = []; let j = 0;
    for (let i = 0; i < n; i++) {
      const t = d[d.length - 1] * i / (n - 1);
      while (j < poly.length - 2 && d[j + 1] < t) j++;
      const f = (t - d[j]) / Math.max(1e-6, d[j + 1] - d[j]);
      out.push([poly[j][0] + (poly[j + 1][0] - poly[j][0]) * f, poly[j][1] + (poly[j + 1][1] - poly[j][1]) * f]);
    }
    return out;
  };
  /** orient a flat geometry (facing +z) to face direction n, then move it to p */
  const _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _n = new THREE.Vector3();
  const stick = (g, p, nx, ny, nz, spin = 0) => {
    g.rotateZ(spin); _n.set(nx, ny, nz).normalize(); _q.setFromUnitVectors(_z, _n); g.applyQuaternion(_q); g.translate(p[0], p[1], p[2]); return g;
  };
  const sandA = 0xf2d7a0, sandB = 0xe3c084, sandIn = 0xb8925c;
  const layered = base => (x, y) => (Math.floor((y - base) / 1.7) & 1 ? sandA : sandB);   // bucket-moulded layers
  const fy = br.frameAt(um).y;
  const parts = [], glow = [];

  // ---- the cave: walls + arch (inside), outer walls + roof, the two front faces with the arched mouths
  const inner = [[-WI, BOT], [-WI, AW]];
  for (let i = 1; i < 16; i++) { const l = -WI + 2 * WI * i / 16; inner.push([l, archH(l)]); }
  inner.push([WI, AW], [WI, BOT]);
  parts.push(paintBy(along(inner), (x, y) => (y - fy > AW + 0.5 ? 0xa98552 : sandIn)));
  for (const prof of [[[-WO, BOT], [-WO, HC]], [[-WO, HC], [WO, HC]], [[WO, HC], [WO, BOT]]]) parts.push(paintBy(along(prof), layered(fy)));
  const outer = [[-WO, BOT], [-WO, HC], [WO, HC], [WO, BOT]], NF = 41;
  const ri = resample(inner, NF), ro = resample(outer, NF);
  for (const u of [u0, u1]) parts.push(paintBy(ribbon([ri.map(([l, h]) => P(u, l, h)), ro.map(([l, h]) => P(u, l, h))]), layered(fy)));
  // ---- crenellations along the top edges
  const merlon = (p, yaw) => parts.push(paintBy(place(new THREE.BoxGeometry(1.6, 1.5, 1.6), { x: p[0], y: p[1], z: p[2], ry: yaw }), () => sandA));
  for (let u = u0 + 1.2; u < u1 - 0.8; u += 3.2) { const f = br.frameAt(u); for (const sd of [1, -1]) merlon(P(u, sd * (WO - 0.8), HC + 0.75), f.yaw); }
  for (const u of [u0 + 0.8, u1 - 0.8]) { const f = br.frameAt(u); for (let l = -WO + 3.2; l < WO - 2; l += 3.2) merlon(P(u, l, HC + 0.75), f.yaw); }
  // ---- four bucket towers on the corners + the keep on the roof (crenellated rims)
  const tower = (c, r, h0, h1, nm) => {
    const cy = new THREE.CylinderGeometry(r, r * 1.15, h1 - h0, 18), cu = cy.attributes.uv;
    for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * Math.PI * 2 * r / 7, cu.getY(i) * (h1 - h0) / 7);
    cy.userData.uvDone = true;
    parts.push(paintBy(place(cy, { x: c[0], y: c[1] + (h0 + h1) / 2, z: c[2] }), layered(fy)));
    for (let i = 0; i < nm; i++) {
      const a = i / nm * Math.PI * 2;
      parts.push(paintBy(place(new THREE.BoxGeometry(1.2, 1.3, 1.0), { x: c[0] + Math.cos(a) * (r - 0.45), y: c[1] + h1 + 0.6, z: c[2] + Math.sin(a) * (r - 0.45), ry: -a }), () => sandA));
    }
  };
  const corners = [];
  for (const u of [u0, u1]) for (const sd of [1, -1]) { const c = P(u, sd * WO, 0); corners.push(c); tower([c[0], br.frameAt(u).y, c[2]], TR, BOT, HC + 3, 8); }
  const keep = P(um, 0, 0); keep[1] = fy;
  tower(keep, 4.2, HC - 0.5, HC + 5.5, 11);
  // flags: a big one on the keep, small ones on the two front towers
  const flag = (x, y, z, h, w, col) => {
    parts.push(paint(new THREE.CylinderGeometry(0.1, 0.12, h, 6).translate(x, y + h / 2, z), 0xffffff));
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -w * 0.55, 0, w, -w * 0.28, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2)); tri.computeVertexNormals();
    parts.push(paint(place(tri, { x, y: y + h, z, ry: rng() * 6.28 }), col));
  };
  flag(keep[0], fy + HC + 5.5, keep[2], 6.5, 3.2, 0xff5d73);
  flag(corners[0][0], fy + HC + 3, corners[0][2], 3.5, 1.8, 0xffd23f);
  flag(corners[1][0], fy + HC + 3, corners[1][2], 3.5, 1.8, 0x2f8fe8);
  // ---- shells + starfish pressed into the sand: around the mouths and over the outer walls
  const scallop = (r, col) => { const g = new THREE.CircleGeometry(r, 9, 0, Math.PI); g.translate(0, -r * 0.35, 0); return paintBy(g, (x, y) => (Math.abs(Math.round(Math.atan2(y + r * 0.35, x) / 0.35)) & 1 ? col : 0xffffff)); };
  const star = (r, col) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i & 1 ? r * 0.42 : r; i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    return paint(new THREE.ShapeGeometry(sh), col);
  };
  const shellCols = [0xff9fc8, 0xffc59a, 0xfff1d6, 0xc9b6ff, 0x9fe6ff], glowCols = [0xff6fb8, 0x5fe8ff, 0xb98bff, 0xffb35f];
  for (const [u, dir] of [[u0, -1], [u1, 1]]) {
    const f = br.frameAt(u);
    for (let i = 0; i <= 12; i++) {   // a frame of shells round the mouth (makes it read as a doorway from the main road)
      const l = -WI * 1.06 + 2 * WI * 1.06 * i / 12, h = (Math.abs(l) >= WI ? AW : archH(l)) + 0.55;
      const g = i % 3 === 1 ? star(0.65, 0xff8a3d) : scallop(0.7, shellCols[i % shellCols.length]);
      parts.push(stick(g, P(u + dir * 0.06, l, h), f.tx * dir, 0, f.tz * dir, Math.atan2(h - AW * 0.6, -l) - Math.PI / 2));
    }
  }
  for (let i = 0; i < 14; i++) {      // scattered over both long walls
    const u = u0 + 2 + rng() * (u1 - u0 - 4), sd = i & 1 ? 1 : -1, f = br.frameAt(u), h = 1.2 + rng() * (HC - 2.5);
    const g = rng() < 0.35 ? star(0.5 + rng() * 0.3, 0xff8a3d) : scallop(0.5 + rng() * 0.35, shellCols[i % shellCols.length]);
    parts.push(stick(g, P(u, sd * (WO + 0.05), h), f.lx * sd, 0, f.lz * sd, rng() * 0.8 - 0.4));
  }
  // ---- inside: torches on both walls (stick merged into the castle, flame glows) and glowing shells up the arch
  for (let u = u0 + 4, i = 0; u < u1 - 2; u += 6.5, i++) {
    const f = br.frameAt(u);
    for (const sd of [1, -1]) {
      const l = sd * (WI - 0.25), b = P(u, l, 2.6);
      const stk = new THREE.CylinderGeometry(0.1, 0.13, 1.3, 6); place(stk, { x: b[0], y: b[1], z: b[2], ry: f.yaw, rz: sd * 0.35 });
      parts.push(paint(stk, 0x7a4a24));
      const top = P(u, l - sd * 0.25, 3.35);
      glow.push(paint(new THREE.ConeGeometry(0.26, 0.75, 7).translate(top[0], top[1] + 0.3, top[2]), 0xffb02e));
      glow.push(paint(new THREE.SphereGeometry(0.2, 7, 5).translate(top[0], top[1] + 0.12, top[2]), 0xfff07a));
      // a shell lamp higher up the arch, facing the road
      const ls = sd * WI * 0.7, hs = archH(ls) - 0.1, sp = P(u + 3.2, ls, hs), nl = -sd * 0.6;
      glow.push(stick(scallop(0.95, glowCols[(i * 2 + (sd > 0 ? 0 : 1)) % glowCols.length]), sp, f.lx * nl - f.tx * 0.75, -0.35, f.lz * nl - f.tz * 0.75, 0));
    }
  }
  // ---- a giant bucket and spade on the sand beside the castle (left of the way in — the side you see from the main road)
  {
    const b = P(u0 + 5, WO + 6.5, 0), c = K.claim(b[0], b[2], 3.2, { margin: 0.5 });
    if (c) {
      const bucket = new THREE.CylinderGeometry(2.3, 1.8, 3.2, 20, 1, true).translate(0, 1.6, 0); parts.push(paint(bucket, 0xe0332c));
      parts.push(paint(new THREE.CircleGeometry(1.8, 20).rotateX(Math.PI / 2).translate(0, 0.02, 0), 0xc22a24));
      parts.push(paint(new THREE.CircleGeometry(2.2, 20).rotateX(-Math.PI / 2).translate(0, 2.9, 0), sandB));
      parts.push(paint(new THREE.TorusGeometry(2.3, 0.14, 6, 24).rotateX(Math.PI / 2).translate(0, 3.2, 0), 0xff5d5d));
      parts.push(paint(new THREE.TorusGeometry(2.2, 0.08, 5, 20, Math.PI).rotateZ(0.25).translate(0, 3.1, 0), 0xffd23f));
      const n = parts.length;
      for (let i = n - 5; i < n; i++) place(parts[i], { x: c.x, y: c.y - 0.1, z: c.z, ry: rng() * 6.28, rz: 0.06 });
      const sp = [paint(new THREE.BoxGeometry(1.5, 1.9, 0.14).translate(0, 0.95, 0), 0x2f8fe8),
        paint(new THREE.CylinderGeometry(0.13, 0.13, 3.0, 8).translate(0, 3.3, 0), 0xffd23f),
        paint(new THREE.BoxGeometry(1.0, 0.22, 0.22).translate(0, 4.85, 0), 0xffd23f)];
      const s2 = P(u0 + 10, WO + 4.2, 0);
      for (const g of sp) parts.push(place(g, { x: s2[0], y: c.y - 0.6, z: s2[2], ry: rng() * 6.28, rx: 0.32 }));
    }
  }
  // keep every other prop off the castle
  for (let u = u0 - 3; u <= u1 + 3; u += 3) for (const sd of [1, -1]) { const p = P(u, sd * (WO + 1), 0); K.spots.push({ x: p[0], z: p[2], r: 4.5 }); }
  for (const c of corners) K.spots.push({ x: c[0], z: c[2], r: TR + 2.5 });

  // one mesh: sand texture with world-space (triplanar-ish) uvs, tinted per vertex
  for (const pg of parts) if (!pg.userData.uvDone) {
    if (!pg.attributes.normal) pg.computeVertexNormals();
    const p = pg.attributes.position, nn = pg.attributes.normal, uv = pg.attributes.uv;
    if (uv) for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i)), az = Math.abs(nn.getZ(i));
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (ay > 0.7) uv.setXY(i, x / 7, z / 7); else if (ax > az) uv.setXY(i, z / 7, y / 7); else uv.setXY(i, x / 7, y / 7);
    }
  }
  const g = merge(parts);
  const castle = mesh(g, new THREE.MeshLambertMaterial({ map: ctx.loadTex(ctx.def.tex?.ground || 'sand', null), vertexColors: true, side: THREE.DoubleSide }), { name: 'sandcastle', shadow: true });
  castle.receiveShadow = true;
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
  mesh(merge(glow), glowMat, { name: 'sandcastle-glow', receive: false });

  // ---- the crumbly door
  const fd = br.frameAt(t0), D = { x: fd.x, y: fd.y, z: fd.z };
  const sh = new THREE.Shape(); sh.moveTo(-WI + 0.05, -0.3); sh.lineTo(-WI + 0.05, AW);
  for (let i = 1; i < 16; i++) { const l = -WI + 2 * WI * i / 16; sh.lineTo(l * 0.993, archH(l) - 0.05); }
  sh.lineTo(WI - 0.05, AW); sh.lineTo(WI - 0.05, -0.3); sh.closePath();
  const dg = new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: false, curveSegments: 2 }); dg.translate(0, 0, -0.45);
  const doorTex = K.canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#ecd096'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { c.fillStyle = rng() < 0.5 ? 'rgba(160,120,60,0.35)' : 'rgba(255,248,220,0.5)'; c.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3); }
    for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(${150 + rng() * 60 | 0},${110 + rng() * 50 | 0},${60 + rng() * 40 | 0},0.55)`; c.beginPath(); c.ellipse(rng() * w, rng() * h, 3 + rng() * 9, 3 + rng() * 7, rng() * 3, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(110,72,30,0.85)'; c.lineCap = 'round';
    for (let i = 0; i < 9; i++) {            // cracks
      let x = w * (0.15 + rng() * 0.7), y = h * (0.1 + rng() * 0.8); c.lineWidth = 2 + rng() * 3; c.beginPath(); c.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (rng() - 0.5) * 50; y += (rng() - 0.5) * 50; c.lineTo(x, y); } c.stroke();
    }
    for (let i = 0; i < 6; i++) { c.fillStyle = ['#ff9fc8', '#fff1d6', '#9fe6ff'][i % 3]; c.beginPath(); c.arc(rng() * w, h * (0.15 + rng() * 0.7), 5 + rng() * 4, Math.PI, 0); c.fill(); }
  });
  doorTex.repeat.set(1 / (2 * WI), 1 / (AT + 0.3)); doorTex.offset.set(0.5, 0.3 / (AT + 0.3));
  const door = mesh(dg, new THREE.MeshLambertMaterial({ map: doorTex }), { name: 'sandcastle-door' });
  door.position.set(D.x, D.y, D.z); door.rotation.y = fd.yaw;

  // ---- the burst: sand chunks (instanced, flung forward) + a dust puff (points)
  const NC = 60, chunks = [];
  for (let i = 0; i < NC; i++) chunks.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, rx: rng() * 6, ry: rng() * 6, s: 0.14 + rng() * 0.26, life: 0, color: [sandA, sandB, 0xd6b070, 0xf7e3b8][i % 4] });
  const cim = instanced(paint(new THREE.DodecahedronGeometry(1, 0), 0xffffff), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), chunks.map(c => ({ ...c, s: 0 })), { name: 'sandcastle-chunks' });
  cim.frustumCulled = false; cim.visible = false;
  const ND = 40, dpos = new Float32Array(ND * 3), dust = [];
  for (let i = 0; i < ND; i++) dust.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dtex = K.canvasTex(64, 64, (c, w, h) => { const gr = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2 - 1); gr.addColorStop(0, 'rgba(255,240,205,0.95)'); gr.addColorStop(0.6, 'rgba(240,215,160,0.55)'); gr.addColorStop(1, 'rgba(240,215,160,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  const dmat = new THREE.PointsMaterial({ size: 2.4, map: dtex, color: 0xf2dcae, transparent: true, depthWrite: false, opacity: 1 });
  const dpts = new THREE.Points(dgeo, dmat); dpts.name = 'sandcastle-dust'; dpts.frustumCulled = false; dpts.visible = false; ctx.group.add(dpts);

  const st = { state: 'up', t: 0, grow: 1, burstT: 9 };
  const burst = k => {
    st.state = 'open'; st.t = 0; st.burstT = 0; door.visible = false; cim.visible = true; dpts.visible = true;
    const dirF = Math.sign((k.vel?.x || Math.sin(k.yaw)) * fd.tx + (k.vel?.z || Math.cos(k.yaw)) * fd.tz) || 1, v = Math.max(8, k.speed || 0);
    for (const c of chunks) {
      const l = (rng() * 2 - 1) * (WI - 0.6), h = rng() * archH(l) * 0.9;
      c.x = D.x + fd.lx * l; c.y = D.y + h; c.z = D.z + fd.lz * l; c.life = 1.1 + rng() * 0.8;
      const f = dirF * (v * (0.45 + rng() * 0.6)), sdv = (rng() * 2 - 1) * 5;
      c.vx = fd.tx * f + fd.lx * sdv; c.vz = fd.tz * f + fd.lz * sdv; c.vy = 2 + rng() * 6;
    }
    dust.forEach((d, i) => {
      const l = (rng() * 2 - 1) * (WI - 1), h = rng() * archH(l) * 0.8;
      d.x = D.x + fd.lx * l; d.y = D.y + h; d.z = D.z + fd.lz * l;
      const f = dirF * (2 + rng() * 6), sdv = (rng() * 2 - 1) * 3;
      d.vx = fd.tx * f + fd.lx * sdv; d.vz = fd.tz * f + fd.lz * sdv; d.vy = 0.5 + rng() * 2.5;
    });
  };
  updaters.push((dt, t) => {
    glowMat.color.setScalar(0.88 + 0.12 * Math.sin(t * 13) * Math.sin(t * 7.3));
    const race = globalThis.__OTR?.race;
    let near = false, hit = null;
    if (race) for (const k of race.karts) {
      const dx = k.pos.x - D.x, dz = k.pos.z - D.z, fw = dx * fd.tx + dz * fd.tz, la = dx * fd.lx + dz * fd.lz;
      if (Math.abs(k.pos.y - D.y) > 6) continue;
      if (dx * dx + dz * dz < 26 * 26) near = true;
      if (Math.abs(fw) < 4.5 && Math.abs(la) < WI) hit = k;
    }
    if (hit && st.state !== 'open') burst(hit);
    st.t += dt; st.burstT += dt;
    if (st.state === 'open' && st.t > 3.5 && !near) { st.state = 'grow'; st.grow = 0; door.visible = true; }
    if (st.state === 'grow') { st.grow = Math.min(1, st.grow + dt / 0.8); if (st.grow >= 1) st.state = 'up'; }
    door.scale.set(1, st.state === 'grow' ? Math.max(0.02, st.grow * st.grow * (3 - 2 * st.grow)) : 1, 1);
    if (cim.visible) {
      let alive = false;
      chunks.forEach((c, i) => {
        c.life -= dt;
        if (c.life > 0) {
          alive = true; c.vy -= 22 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.rx += dt * 6; c.ry += dt * 4;
          if (c.y < D.y + c.s * 0.4) { c.y = D.y + c.s * 0.4; c.vy = Math.abs(c.vy) * 0.25; c.vx *= 0.6; c.vz *= 0.6; }
        }
        K.setInstance(cim, i, { x: c.x, y: c.y, z: c.z, rx: c.rx, ry: c.ry, s: c.life > 0 ? c.s * Math.min(1, c.life / 0.4) : 0 });
      });
      cim.instanceMatrix.needsUpdate = true;
      if (!alive) cim.visible = false;
    }
    if (dpts.visible) {
      const a = st.burstT / 1.6;
      if (a >= 1) dpts.visible = false;
      else {
        dust.forEach((d, i) => { d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.vx *= 1 - dt * 1.5; d.vz *= 1 - dt * 1.5; dpos[i * 3] = d.x; dpos[i * 3 + 1] = d.y; dpos[i * 3 + 2] = d.z; });
        dgeo.attributes.position.needsUpdate = true;
        dmat.opacity = 1 - a * a; dmat.size = 2.4 + a * 3.5;
      }
    }
  });
}
