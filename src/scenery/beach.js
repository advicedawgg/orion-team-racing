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
