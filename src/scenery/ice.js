// scenery/ice.js — Ice Cream Peaks. Contract: DESIGN.md "Scenery hook"; helpers: scenery/propkit.js.
//
// Lollipop trees, giant waffle-cone ice creams with cherries, scoop boulders, candy canes, giant
// sprinkles, penguin spectators, waffle-cone cliffs where the road cuts the mountain, the chocolate
// river (the track's `water`, re-skinned) with the Wafer Bridge and a chocolate fountain, a cherry on
// top of Strawberry Peak, chevron boards before every tight corner. ~20 draw calls, all instanced or
// merged per material.
import { makePropKit } from './propkit.js';

export default function build(ctx) {
  const { THREE, group, track, def, rng, groundAt, naturalAt } = ctx;
  const K = makePropKit(ctx);
  const { paint, paintBy, merge, place, instanced, mesh, vmat, vmat2 } = K;
  const updaters = [];
  const FLAVOURS = [0xffb3cc, 0xbff5dc, 0xfff1c9, 0x9a6242, 0xd9b8ff, 0xffd08a];   // strawberry, mint, vanilla, choc, blueberry, caramel
  const pick = a => a[(rng() * a.length) | 0];

  // ------------------------------------------------ chocolate river: re-skin the track's water, keep it inside the terrain
  const water = group.getObjectByName('water');
  const B = ctx.bounds;
  if (water) {
    const tex = K.canvasTex(256, 256, (g, w, h) => {
      // soft glossy ripples: pale streaks on white (× the chocolate colour)
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const x = rng() * w, y = rng() * h, r = 6 + rng() * 16;
        g.strokeStyle = rng() < 0.5 ? 'rgba(255,236,220,.9)' : 'rgba(205,175,160,.55)'; g.lineWidth = 1.5 + rng() * 2;
        g.beginPath(); g.ellipse(x, y, r, r * 0.35, 0.3, rng() * 3, rng() * 3 + 1.6); g.stroke();
      }
    }, { repeat: [60, 60] });
    water.material = new THREE.MeshPhongMaterial({ color: 0x7a4326, map: tex, specular: 0xffe0c0, shininess: 70 });
    K.fitWater(water);
    tex.repeat.set((B.x1 - B.x0) / 9, (B.z1 - B.z0) / 9);
    updaters.push((dt, t) => { tex.offset.set(t * 0.02, -t * 0.035); });
  }
  // ------------------------------------------------ far snow beyond the terrain grid (hides its square edge in the fog)
  K.farGround('snow', 0xfff4f8, (def.terrain?.base ?? 0) - 0.9);

  // ------------------------------------------------ shared prop geometry
  // scoop: a lumpy ball with a curly rim, white (instance colour = flavour)
  const scoopGeo = (() => {
    const s = new THREE.SphereGeometry(1, 12, 8), p = s.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x), b = Math.acos(Math.max(-1, Math.min(1, y)));
      const k = 1 + 0.07 * Math.sin(a * 5 + b * 3) * Math.sin(b * 4);
      x *= k; z *= k; y = Math.max(y * k, -0.3);
      p.setXYZ(i, x, y, z);
    }
    s.computeVertexNormals();
    // the curly rim where the scoop meets the cone: one wavy torus
    const rim = new THREE.TorusGeometry(0.93, 0.2, 5, 18), q = rim.attributes.position;
    for (let i = 0; i < q.count; i++) { const x = q.getX(i), y = q.getY(i), z = q.getZ(i), a = Math.atan2(y, x), k = 1 + 0.08 * Math.sin(a * 11); q.setXYZ(i, x * k, y * k, z * (1 + 0.3 * Math.sin(a * 11))); }
    rim.rotateX(Math.PI / 2); rim.translate(0, -0.26, 0); rim.computeVertexNormals();
    return merge([paint(s, 0xffffff), paint(rim, 0xf0f0f0)]);
  })();
  const cherryGeo = (() => {
    const c = paint(new THREE.SphereGeometry(0.3, 9, 6), 0xe8203a);
    const stem = new THREE.CylinderGeometry(0.035, 0.045, 0.55, 5); place(stem, { x: 0.08, y: 0.45, rz: -0.35 }); paint(stem, 0x5a8a2a);
    const hl = new THREE.SphereGeometry(0.08, 4, 3); place(hl, { x: -0.12, y: 0.14, z: 0.2 }); paint(hl, 0xffd0d8);
    return merge([c, stem, hl]);
  })();
  const waffleTex = ctx.loadTex('waffle', null, { repeat: [3, 2] });
  const waffleMat = new THREE.MeshLambertMaterial({ map: waffleTex, color: 0xffffff });
  const coneGeo = (() => { const g = new THREE.ConeGeometry(0.95, 3, 18, 1, true); g.rotateX(Math.PI); g.translate(0, -1.5, 0); return g; })();
  const scoopMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const scoops = [], cherries = [], cones = [];
  /** An ice cream: waffle cone (tip in the snow) + 1–2 scoops + a cherry. s = scale (1 ≈ 4 m tall). */
  const iceCream = (x, y, z, s, lean = 0.12) => {
    for (let a = 0; a < 6.28; a += 1.05) y = Math.min(y, groundAt(x + Math.cos(a) * s * 0.9, z + Math.sin(a) * s * 0.9));
    const ry = rng() * 6.28, rx = (rng() - 0.5) * lean, rz = (rng() - 0.5) * lean;
    const up = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    const base = { x, y: y + 3 * s * 0.78, z };
    cones.push({ ...base, rx, ry, rz, s });
    let top = 0.15 * s;
    const n = rng() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const sc = s * (1.05 - i * 0.18);
      scoops.push({ x: base.x + up.x * top, y: base.y + up.y * top + 0.25 * sc, z: base.z + up.z * top, rx, ry: rng() * 6.28, rz, s: sc, color: pick(FLAVOURS) });
      top += sc * 1.25;
    }
    cherries.push({ x: base.x + up.x * (top - 0.05 * s), y: base.y + up.y * (top - 0.05 * s) + 0.1 * s, z: base.z + up.z * (top - 0.05 * s), ry: rng() * 6, s: s * 1.2 });
  };

  // ------------------------------------------------ the Cherry Scoop jump: two giant cherry-topped scoops flank the lip
  const jump = track.jumps[0];
  if (jump) {
    for (const side of [1, -1]) {
      const b = K.beside(jump.s - 4, side, 7.5);
      const s = 5.5;
      let y = Infinity; for (let a = 0; a < 6.28; a += 0.8) y = Math.min(y, groundAt(b.x + Math.cos(a) * s * 0.8, b.z + Math.sin(a) * s * 0.8));
      y = Math.min(y, track.pointAt(jump.s, 0).y) - 0.3 * s - 0.4;
      scoops.push({ x: b.x, y: y + 0.3 * s, z: b.z, ry: rng() * 6, s, color: side > 0 ? 0xfff1c9 : 0xffb3cc });
      cherries.push({ x: b.x, y: y + 0.3 * s + s * 0.98, z: b.z, ry: rng() * 6, s: s * 1.3 });
      K.spots.push({ x: b.x, z: b.z, r: s + 1 });
    }
    // candy-striped lip across the road (a decal just before the launch)
    const stripe = K.canvasTex(128, 32, (g, w, h) => { for (let i = -2; i < 12; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e8374a'; g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 16, 0); g.lineTo(i * 16 + 32, h); g.lineTo(i * 16 + 16, h); g.fill(); } }, { repeat: [1, 1] });
    stripe.wrapS = THREE.RepeatWrapping;
    const lip = K.lofted(jump.s - 3.2, jump.s - 0.2, 0.5, (s, f) => [-1, 1].map(sd => { const p = track.pointAt(s, sd * f.hw); return { x: p.x, y: p.y + 0.05, z: p.z, u: sd > 0 ? 0 : f.hw * 2 / 4 }; }), { vScale: 3 });
    mesh(lip, new THREE.MeshBasicMaterial({ map: stripe, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, side: THREE.DoubleSide }), { name: 'jump-lip' });
  }

  // ------------------------------------------------ Strawberry Peak: a giant cherry on top, sprinkles on its slopes
  const hills = def.terrain?.hills || [];
  const bigSprinkles = [];
  let summit = null;
  hills.forEach((hl, i) => {
    const top = naturalAt(hl.x, hl.z);
    if (i === 0) {
      // Strawberry Peak wears a whipped-cream swirl and a giant cherry
      summit = { x: hl.x, y: top - 1, z: hl.z };
      cherries.push({ x: hl.x, y: top + 13.5, z: hl.z, ry: 0.6, s: 16 });
      K.spots.push({ x: hl.x, z: hl.z, r: 16 });
    } else if (hl.h > 20 && ctx.isClear(hl.x, hl.z, 12, 4)) {
      // a giant ice cream on each big hill top
      iceCream(hl.x, top - 2, hl.z, 3.2 + rng() * 1.2, 0.05);
      K.spots.push({ x: hl.x, z: hl.z, r: 8 });
    }
    for (let j = 0; j < 26; j++) {
      const a = rng() * 6.28, r = hl.r * (0.1 + rng() * 0.55), x = hl.x + Math.cos(a) * r, z = hl.z + Math.sin(a) * r;
      if (!ctx.isClear(x, z, 4, 2)) continue;
      bigSprinkles.push({ x, y: groundAt(x, z) + 0.9, z, ry: rng() * 6.28, rz: Math.PI / 2 + (rng() - 0.5) * 0.3, s: 2.6 + rng() * 1.4, color: pick([0xff5d73, 0xffd23f, 0x4ec5f1, 0x6ff08f, 0xb07cff, 0xffffff, 0xff9d2f]) });
    }
  });

  // ------------------------------------------------ props along the course
  // penguin spectators first (they want the good spots by the road)
  const penguins = [];
  for (const [s0, side, n] of [[-40, -1, 4], [30, 1, 3], [track.sOf(9), 1, 4], [track.sOf(15.5), -1, 3], [track.sOf(23.6), -1, 3], [track.sOf(18), 1, 3]]) {
    for (let i = 0; i < n; i++) {
      const b = K.beside(s0 + (i - n / 2) * 3.2, side, 2.2 + (i % 2) * 1.6);
      const c = K.claim(b.x, b.z, 0.8, { margin: 0.6 });
      if (!c) continue;
      const tp = track.pointAt(s0 + 10, 0);
      c.ry = Math.atan2(tp.x - c.x, tp.z - c.z); c.ph = rng() * 6; c.s = 1.3 + rng() * 0.3;
      penguins.push(c);
    }
  }
  // candy canes: a pair either side of each corner entry + a line along the start straight
  const canes = [];
  for (const c of K.corners(45)) for (const side of [1, -1]) {
    const b = K.beside(c.s0 - 12, side, 2.4);
    const p = K.claim(b.x, b.z, 1, { margin: 0.3 });
    if (p) canes.push({ ...p, ry: Math.atan2(-b.f.tx, -b.f.tz) + (side > 0 ? 0 : Math.PI), s: 1.1 });
  }
  for (let s = -70; s < 40; s += 22) for (const side of [1, -1]) {
    const b = K.beside(s, side, 2.4); const p = K.claim(b.x, b.z, 1, { margin: 0.3 });
    if (p) canes.push({ ...p, ry: Math.atan2(b.f.tx, b.f.tz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), s: 1 });
  }
  // ice creams, lollipops, scoop boulders
  for (const c of K.scatter({ step: 17, near: 3, far: 26, r: 2.6, chance: 0.55 })) iceCream(c.x, c.y, c.z, 0.9 + rng() * 0.8);
  const lollies = K.scatter({ step: 9, near: 2.5, far: 34, r: 2.2, chance: 0.6 }).map(c => ({ ...c, ry: rng() * 6.28, s: 0.8 + rng() * 0.6 }));
  for (const c of K.scatter({ step: 15, near: 4, far: 40, r: 2.5, chance: 0.45 })) {
    const n = 1 + (rng() * 3 | 0);
    for (let i = 0; i < n; i++) { const s = 1.1 + rng() * 1.5; scoops.push({ x: c.x + (rng() - 0.5) * 3, y: c.y + 0.15 * s, z: c.z + (rng() - 0.5) * 3, ry: rng() * 6, s, color: pick(FLAVOURS) }); if (rng() < 0.4) cherries.push({ x: scoops.at(-1).x, y: scoops.at(-1).y + s * 0.97, z: scoops.at(-1).z, ry: 0, s: s * 1.1 }); }
  }
  // far field: skyline ice creams and lollipops out on the snow
  for (const c of K.scatterWide(70, 4, { margin: 12 })) { if (rng() < 0.45) iceCream(c.x, c.y, c.z, 2 + rng() * 2.5); else lollies.push({ ...c, ry: rng() * 6.28, s: 1.6 + rng() * 1.2 }); }

  // ------------------------------------------------ small sprinkles scattered on the offroad snow (flat, drive-over)
  const sprinkles = [];
  for (let s = 0; s < track.length; s += 2.2) for (const side of [1, -1]) {
    if (rng() < 0.5) continue;
    const f = track.frameAt(s), off = side > 0 ? track.OFFL[f.k] : track.OFFR[f.k];
    if (off < 2.5 || (track.FLAG[f.k] & 1)) continue;
    const lat = side * (f.hw + 1.2 + rng() * (off - 2)), p = track.pointAt(s, lat);
    sprinkles.push({ x: p.x, y: p.y + 0.07, z: p.z, ry: rng() * 6.28, rz: Math.PI / 2, s: 0.9 + rng() * 0.4, color: pick([0xff5d73, 0xffd23f, 0x4ec5f1, 0x6ff08f, 0xb07cff, 0xff9d2f]) });
  }

  // ------------------------------------------------ build the instanced props
  instanced(coneGeo, waffleMat, cones, { name: 'cones', shadow: true });
  instanced(scoopGeo, scoopMat, scoops, { name: 'scoops' });
  instanced(cherryGeo, vmat, cherries, { name: 'cherries' });
  const sprinkleGeo = paint(new THREE.CapsuleGeometry(0.13, 0.7, 2, 5), 0xffffff);
  instanced(sprinkleGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), sprinkles.concat(bigSprinkles), { name: 'sprinkles' });
  {
    // lollipop: white stick + a rainbow swirl disc (texture on the caps); the stick samples the white corner
    const swirl = K.canvasTex(256, 256, (g, w, h) => {
      const img = g.createImageData(w, h), C = [[255, 93, 115], [255, 210, 63], [111, 240, 143], [78, 197, 241], [176, 124, 255]];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x - w / 2, dy = y - h / 2, r = Math.hypot(dx, dy) / (w / 2), a = Math.atan2(dy, dx) / (Math.PI * 2);
        let c = [255, 255, 255];
        if (r < 0.97) { const v = (a + r * 2.2) * 5; const fr = v - Math.floor(v); c = fr < 0.18 ? [255, 255, 255] : C[((Math.floor(v) % 5) + 5) % 5]; }
        const i = (y * w + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    const stick = K.uvAt(new THREE.CylinderGeometry(0.13, 0.15, 5.2, 6).translate(0, 2.6, 0), 0.01, 0.99);
    const disc = new THREE.CylinderGeometry(1.9, 1.9, 0.34, 28); disc.rotateX(Math.PI / 2); disc.translate(0, 6.9, 0);
    const g = merge([paint(stick, 0xffffff), paint(disc, 0xffffff)]);
    instanced(g, new THREE.MeshLambertMaterial({ map: swirl }), lollies, { name: 'lollipops', shadow: true });
  }
  {
    // candy cane: stripes painted per vertex along a diagonal
    const shaft = new THREE.CylinderGeometry(0.28, 0.28, 5, 8, 16).translate(0, 2.5, 0);
    const hook = new THREE.TorusGeometry(0.85, 0.28, 8, 12, Math.PI).translate(0.85, 5, 0);
    const stripes = (x, y, z) => (((y * 1.1 + x * 0.9 + z * 0.6) % 1 + 1) % 1) < 0.5 ? 0xe8374a : 0xffffff;
    const g = merge([paintBy(shaft, stripes), paintBy(hook, stripes)]);
    instanced(g, vmat, canes, { name: 'candycanes', shadow: true });
  }
  if (penguins.length) {
    const parts = [];
    const body = new THREE.SphereGeometry(0.5, 14, 10); place(body, { y: 0.62, sy: 1.3, sz: 0.95 }); parts.push(paint(body, 0x2b2d42));
    const belly = new THREE.SphereGeometry(0.4, 12, 8); place(belly, { y: 0.55, z: 0.17, sy: 1.25, sz: 0.8 }); parts.push(paint(belly, 0xffffff));
    for (const sd of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.09, 8, 6); place(eye, { x: sd * 0.15, y: 1.02, z: 0.38 }); parts.push(paint(eye, 0xffffff));
      const pup = new THREE.SphereGeometry(0.05, 6, 4); place(pup, { x: sd * 0.15, y: 1.02, z: 0.46 }); parts.push(paint(pup, 0x111111));
      const fl = new THREE.BoxGeometry(0.1, 0.55, 0.28); place(fl, { x: sd * 0.5, y: 0.62, rz: sd * 0.5 }); parts.push(paint(fl, 0x2b2d42));
      const ft = new THREE.BoxGeometry(0.2, 0.06, 0.28); place(ft, { x: sd * 0.16, y: 0.03, z: 0.18 }); parts.push(paint(ft, 0xff9d2f));
    }
    const beak = new THREE.ConeGeometry(0.08, 0.22, 6); place(beak, { y: 0.92, z: 0.5, rx: Math.PI / 2 }); parts.push(paint(beak, 0xff9d2f));
    const hat = new THREE.ConeGeometry(0.22, 0.4, 10); place(hat, { y: 1.35 }); parts.push(paint(hat, 0xff5d73));
    const pom = new THREE.SphereGeometry(0.08, 6, 4); place(pom, { y: 1.57 }); parts.push(paint(pom, 0xffffff));
    const im = instanced(merge(parts), vmat, penguins.map(p => ({ ...p, y: p.y })), { name: 'penguins', shadow: false });
    im.frustumCulled = false;
    updaters.push((dt, t) => {
      penguins.forEach((p, i) => { const hop = Math.max(0, Math.sin(t * 5 + p.ph)) * 0.25; K.setInstance(im, i, { x: p.x, y: p.y + hop, z: p.z, ry: p.ry + Math.sin(t * 1.3 + p.ph) * 0.3, s: p.s }); });
      im.instanceMatrix.needsUpdate = true;
    });
  }

  // ------------------------------------------------ waffle-cone cliffs: where the road cuts into / stands above the mountain,
  // the slope beside the corridor shows the waffle under the ice cream (with a drippy top edge).
  {
    const geos = [];
    for (const side of [1, -1]) {
      let run = null;
      const flush = () => {
        if (run && run.s1 - run.s0 > 20) geos.push(K.lofted(run.s0, run.s1, 2, (s, f) => {
          const pts = [];
          const off = side > 0 ? track.OFFL[f.k] : track.OFFR[f.k];
          const drip = 7 + 2.2 * Math.sin(s * 0.45) + 1.2 * Math.sin(s * 1.3);
          for (let i = 0; i <= 6; i++) {
            const e = 0.4 + drip * i / 6, lat = side * (f.hw + off + e);
            const x = f.x + f.lx * lat, z = f.z + f.lz * lat;
            pts.push({ x, y: groundAt(x, z) + 0.28, z, u: e / 9 });
          }
          return pts;
        }, { vScale: 9, flip: side < 0 }));
        run = null;
      };
      for (let s = 0; s < track.length; s += 2) {
        const b = K.beside(s, side, 9), road = track.frameAt(s).y;
        const steep = Math.abs(groundAt(b.x, b.z) - road) > 3 && !(track.FLAG[track.idx(s)] & 1) && !track.props[track.idx(s)].raised;
        if (steep) { if (!run) run = { s0: s, s1: s }; else run.s1 = s; } else flush();
      }
      flush();
    }
    if (geos.length) {
      const t = ctx.loadTex('waffle', null, { repeat: [1, 1] });
      const m = mesh(merge(geos.map(g => paint(g, 0xffffff))), new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide }), { name: 'waffle-cliffs' });
      m.receiveShadow = true;
    }
  }

  // ------------------------------------------------ the Wafer Bridge (raised stretch over the chocolate river)
  {
    const parts = [];
    let s0 = null, s1 = null;
    for (let k = 0; k < track.n; k++) if (track.props[k].raised) { const s = k * track.ds; if (s0 == null) s0 = s; s1 = s; }
    if (s0 != null) {
      // deck slab under the road + shoulders, wafer-striped sides
      const deck = K.lofted(s0 - 2, s1 + 2, 1, (s, f) => {
        const L = f.hw + track.OFFL[f.k] + 0.6, R = f.hw + track.OFFR[f.k] + 0.6;
        const a = track.pointAt(s, L), b = track.pointAt(s, -R);
        return [{ x: a.x, y: a.y - 0.05, z: a.z }, { x: a.x, y: a.y - 1.4, z: a.z }, { x: b.x, y: b.y - 1.4, z: b.z }, { x: b.x, y: b.y - 0.05, z: b.z }];
      }, { vScale: 1 });
      parts.push(paintBy(deck, (x, y, z) => (Math.floor((y + 10) / 0.35) & 1) ? 0xffd98a : 0xf5a8c0));
      // abutment blocks at each end, and two pillars into the river
      for (const s of [s0 - 1, s1 + 1, s0 + (s1 - s0) * 0.33, s0 + (s1 - s0) * 0.66]) {
        const f = track.frameAt(s), c = track.pointAt(s, 0), w = f.hw * 2 + track.OFFL[f.k] + track.OFFR[f.k];
        const pier = s === s0 - 1 || s === s1 + 1;
        const h = c.y - (pier ? groundAt(c.x, c.z) - 1 : (track.water?.y ?? 0) - 1);
        const g = new THREE.BoxGeometry(pier ? w + 1 : 2.2, h, pier ? 2.5 : 3.2);
        place(g, { x: c.x, y: c.y - 1.2 - h / 2 + 0.5, z: c.z, ry: f.yaw });
        parts.push(paintBy(g, (x, y) => (Math.floor((y + 10) / 0.5) & 1) ? 0xe8b36a : 0xd29546));
      }
    }
    // chocolate fountain at the river's source pond
    const pond = (def.terrain?.carve || []).find(c => c.type === 'lake');
    if (pond) {
      const y0 = (track.water?.y ?? 0) - 0.5;
      const tiers = [[3.2, 1.2], [2.2, 3.4], [1.3, 5.4], [0.6, 7]];
      for (const [r, h] of tiers) {
        const bowl = new THREE.CylinderGeometry(r, r * 0.7, 0.5, 20); place(bowl, { x: pond.x, y: y0 + h, z: pond.z }); parts.push(paint(bowl, 0xfff1c9));
        const sauce = new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.52, 20); place(sauce, { x: pond.x, y: y0 + h + 0.03, z: pond.z }); parts.push(paint(sauce, 0x7a4326));
        const curtain = new THREE.CylinderGeometry(r * 0.98, r * 1.25, 1.7, 20, 1, true); place(curtain, { x: pond.x, y: y0 + h - 1.05, z: pond.z }); parts.push(paint(curtain, 0x8a4d2c));
      }
      const col = new THREE.CylinderGeometry(0.4, 0.6, 7.5, 10); place(col, { x: pond.x, y: y0 + 3.7, z: pond.z }); parts.push(paint(col, 0xfff1c9));
      K.spots.push({ x: pond.x, z: pond.z, r: pond.r });
    }
    if (parts.length) mesh(merge(parts), vmat2, { name: 'bridge+fountain', shadow: true });
  }

  // ------------------------------------------------ whipped cream on the summit (stacked wavy rings)
  if (summit) {
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const R = 13 - i * 2.1, g = new THREE.TorusGeometry(R, 2.4 - i * 0.2, 8, 26), p = g.attributes.position;
      for (let v = 0; v < p.count; v++) { const x = p.getX(v), y = p.getY(v), a = Math.atan2(y, x), k = 1 + 0.07 * Math.sin(a * 8 + i); p.setXYZ(v, x * k, y * k, p.getZ(v)); }
      g.rotateX(Math.PI / 2); g.rotateY(i * 0.4); g.translate(summit.x, summit.y + 1.5 + i * 2.1, summit.z); g.computeVertexNormals();
      parts.push(paint(g, 0xfffaf2));
    }
    const tip = new THREE.ConeGeometry(2.2, 4, 12); tip.translate(summit.x, summit.y + 13.5, summit.z); parts.push(paint(tip, 0xfffaf2));
    mesh(merge(parts), vmat, { name: 'whipped-cream', shadow: true });
  }

  // ------------------------------------------------ candy bunting over the start straight
  {
    const parts = [], PAL = [0xff8fb1, 0xfff1c9, 0xbff5dc, 0xd9b8ff, 0xffd23f];
    for (const side of [1, -1]) for (let s = -60; s < 30; s += 1.6) {
      const f = track.frameAt(s), off = side > 0 ? track.OFFL[f.k] : track.OFFR[f.k];
      const lat = side * (f.hw + off + 0.4), p = track.pointAt(s, lat), sag = 2.8 - 0.3 * Math.sin(((s + 64) % 8) / 8 * Math.PI);
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.45, 0, 0, 0.45, 0, -0.7, 0], 3));
      tri.rotateY(f.yaw); tri.translate(p.x, p.y + sag, p.z); tri.computeVertexNormals();
      parts.push(paint(tri, PAL[Math.abs(Math.round(s / 1.6)) % PAL.length]));
      if (Math.abs((s + 64) % 8) < 1.6) { const pole = new THREE.CylinderGeometry(0.06, 0.06, 3.1, 5); pole.translate(p.x, p.y + 1.55, p.z); parts.push(paint(pole, 0xffffff)); }
    }
    mesh(merge(parts), vmat2, { name: 'bunting' });
  }

  // ------------------------------------------------ chevron boards before every tight corner (kid-readable)
  K.chevrons({ rMax: 40, board: [4, 1.7] });

  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}
