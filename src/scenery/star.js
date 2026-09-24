// scenery/star.js — Star Road (tracks agent). Contract: DESIGN.md "Scenery hook".
//
// The engine draws the road; this file turns it into a RAINBOW ROAD (a shader-light tweak of the
// road's own Lambert material: rainbow bands across the width, a glow pulse scrolling along it,
// emissive so it shines in space), gives the floating road a body (glowing edges + a dark
// underside you can see from the helix below), and draws the glowing rails where the data says
// `rail: 'glow'` (the physical wall there is `none`), edge lights where it's `fall`.
// Then space: the nebula sky, a twinkling starfield, planets, a ringed planet, a moon with a
// face floating inside the Moon Loop, an asteroid ring, shooting stars, a giant Sootie
// constellation, rainbow hoops, a star gate over the jump, floating stars everywhere.
//
// Budget: ≈20 draw calls — everything merged per material or instanced; emissive = MeshBasic,
// toneMapped:false. No lights are added.
import { makeKit } from './kit.js';

const TAU = Math.PI * 2;
const RAINBOW = [0xff5d73, 0xff9d2f, 0xffe14a, 0x6ff08f, 0x4ec5f1, 0x7a7cff, 0xc77dff];

export default function build(ctx) {
  const { THREE, group, track, def, rng, loadTex } = ctx;
  const K = makeKit(ctx);
  const { P } = K;
  const n = track.n, HW = track.HW, Y = track.Y;
  const B = K.buckets(group);
  const updaters = [];
  const rail = K.inherited('rail', 'glow');
  const isGap = k => (track.FLAG[K.wrap(k)] & 1) !== 0;
  const W = mx => -mx;
  const col = new THREE.Color();
  const hue = (h, s = 0.85, l = 0.62) => col.setHSL(((h % 1) + 1) % 1, s, l).getHex();

  /* =============================================================== the rainbow road (shader tweak of the engine's road material) */
  const road = group.getObjectByName('road');
  const uTime = { value: 0 };
  if (road) {
    const m = road.material;
    const uU1 = { value: Math.max(0.01, HW[0] * 2 / 6) };     // trackmesh: u runs 0 (left edge) → HW[0]*2/6 (right edge)
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime; sh.uniforms.uU1 = uU1;
      sh.fragmentShader = 'uniform float uTime;\nuniform float uU1;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          float rbF = clamp(vMapUv.x / uU1, 0.0, 1.0);
          vec3 rbC = 0.5 + 0.5 * cos(6.28318 * (rbF * 0.86 + vec3(0.0, 0.33, 0.67)));
          float rbP = 0.5 + 0.5 * sin(vMapUv.y * 1.3 - uTime * 4.0);
          float rbS = dot(diffuseColor.rgb, vec3(0.333));
          diffuseColor.rgb = rbC * (0.45 + 0.75 * rbS);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += rbC * (0.28 + 0.3 * rbP) + vec3(0.9, 0.9, 1.0) * smoothstep(0.82, 0.98, rbS) * 0.5;`);
    };
    m.customProgramCacheKey = () => 'otr-rainbow-road';
    m.needsUpdate = true;
    updaters.push((dt, t) => { uTime.value = t; });
  }
  // the engine's edge lines + kerbs: keep (glowing white edges read well); shoulders are clouds (tex space→cloud)

  // the engine's gap faces (lip / landing walls down to the gap floor) are a brown slab in space: hide them
  { const gf = group.getObjectByName('gapfaces'); if (gf) gf.visible = false; }

  /* =============================================================== the road's body: glowing edges + dark underside */
  const bL = k => HW[K.wrap(k)] + track.OFFL[K.wrap(k)], bR = k => -(HW[K.wrap(k)] + track.OFFR[K.wrap(k)]);
  {
    let rowsU = [], rowsL = [], rowsR = [];
    const flush = () => {
      if (rowsU.length > 1) B.add('under', K.strip(rowsU, { uS: 8, vS: 8, color: 0xffffff }));
      if (rowsL.length > 1) B.add('edge', K.strip(rowsL, { uS: 4, vS: 1, colors: r => rowsL[r].c }));
      if (rowsR.length > 1) B.add('edge', K.strip(rowsR, { uS: 4, vS: 1, colors: r => rowsR[r].c }));
      rowsU = []; rowsL = []; rowsR = [];
    };
    for (let j = 0; j <= n; j++) {
      const k = j % n;
      if (isGap(k)) { flush(); continue; }
      const l = bL(k) + 0.5, r = bR(k) - 0.5;
      const a = P(k, l, 0.02), b = P(k, r, 0.02), a1 = P(k, l, -0.7), b1 = P(k, r, -0.7), a2 = P(k, l * 0.7, -1.6), b2 = P(k, r * 0.7, -1.6);
      rowsU.push([a1, a2, b2, b1]);
      const c = hue(j * track.ds / 140);
      const rl = [a, a1]; rl.c = c; rowsL.push(rl);
      const rr = [b1, b]; rr.c = hue(j * track.ds / 140 + 0.5); rowsR.push(rr);
    }
    flush();
  }

  /* =============================================================== rails (glow sections) + edge lights (fall sections) */
  const posts = [], studs = [];
  {
    for (const s of [1, -1]) {
      let rows = [], panel = [], last = -99;
      const flush = () => {
        if (rows.length > 1) { B.add('glow', K.strip(rows, { uS: 4, vS: 1, colors: r => rows[r].c })); }
        if (panel.length > 1) { B.add('field', K.strip(panel, { uS: 6, vS: 1, colors: r => panel[r].c })); }
        rows = []; panel = [];
      };
      for (let j = 0; j <= n; j++) {
        const k = j % n, sAt = j * track.ds;
        if (isGap(k)) { flush(); continue; }
        const b = s > 0 ? bL(k) : bR(k);
        if (rail(k) === 'glow') {
          const c = hue(sAt / 90 + (s > 0 ? 0 : 0.5));
          const r1 = [P(k, b, 1.05), P(k, b, 1.25), P(k, b + s * 0.2, 1.25)]; r1.c = c; rows.push(r1);
          const p1 = [P(k, b + s * 0.05, 0), P(k, b + s * 0.05, 1.08)]; p1.c = c; panel.push(p1);
          if (sAt - last >= 5) { last = sAt; const p = P(k, b + s * 0.08, 0); posts.push({ x: p[0], y: p[1], z: p[2], c }); }
        } else {
          flush();
          if (sAt - last >= 4) { last = sAt; const p = P(k, b, 0.15); studs.push({ x: p[0], y: p[1], z: p[2], c: RAINBOW[Math.floor(sAt / 4) % RAINBOW.length] }); }
        }
      }
      flush();
    }
    // posts: glowing sticks with a star cap
    const pg = K.merge([K.paint(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 6).translate(0, 0.65, 0), 0xffffff), K.paint(new THREE.OctahedronGeometry(0.28, 0).translate(0, 1.45, 0), 0xffffff)]);
    const pm = K.instanced(pg, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), posts, 'posts');
    if (pm) { posts.forEach((p, i) => pm.setColorAt(i, col.set(p.c))); group.add(pm); }
    const sg = K.paint(new THREE.SphereGeometry(0.28, 8, 5), 0xffffff);
    const sm = K.instanced(sg, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), studs, 'studs');
    if (sm) {
      studs.forEach((p, i) => sm.setColorAt(i, col.set(p.c))); group.add(sm);
      // chase lights: the studs pulse in a wave that runs along the edge (instance colours only)
      const base = studs.map(p => new THREE.Color(p.c));
      updaters.push((dt, t) => { for (let i = 0; i < studs.length; i++) { const w = 0.55 + 0.45 * Math.sin(t * 6 - i * 0.5); sm.setColorAt(i, col.copy(base[i]).multiplyScalar(w)); } sm.instanceColor.needsUpdate = true; });
    }
  }

  /* =============================================================== the star gate over the jump, rainbow hoops */
  {
    for (const g of track.gaps) {
      const s = g.s0 + g.len / 2, f = track.frameAt(s), c = track.pointAt(s, 0);
      const tor = new THREE.TorusGeometry(11.5, 0.7, 10, 48);
      const cols = []; const p = tor.attributes.position;
      for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getY(i), p.getX(i)); cols.push(...col.set(hue(a / TAU)).toArray()); }
      tor.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      tor.rotateY(f.yaw); tor.translate(c.x, c.y + 4.5, c.z);
      B.add('glow', tor);
    }
    const hoops = [];
    const hoopAt = s => { const f = track.frameAt(s), c = track.pointAt(s, 0); hoops.push({ x: c.x, y: c.y + 2.5, z: c.z, yaw: f.yaw, c: hue(hoops.length / 7) }); };
    for (let s = track.sOf(0.4); s < track.sOf(2.2); s += 24) hoopAt(s);
    for (let s = track.sOf(26.2); s < track.sOf(27.9); s += 22) hoopAt(s);
    const hg = K.paint(new THREE.TorusGeometry(13.5, 0.45, 8, 56), 0xffffff);
    const hm = K.instanced(hg, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.85 }), hoops, 'hoops');
    if (hm) { hoops.forEach((h, i) => hm.setColorAt(i, col.set(h.c))); group.add(hm); }
  }

  /* =============================================================== floating stars everywhere (decorative, they spin + bob) */
  {
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.45 : 1.1; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) starShape.moveTo(x, y); else starShape.lineTo(x, y); }
    const sg = new THREE.ExtrudeGeometry(starShape, { depth: 0.35, bevelEnabled: false }); sg.translate(0, 0, -0.175);
    K.paint(sg, 0xffffff);
    const deco = [];
    for (let s = 6; s < track.length; s += 11) {
      const k = track.idx(s); if (isGap(k)) continue;
      const side = (Math.floor(s / 11) % 2) ? 1 : -1;
      const b = side > 0 ? bL(k) : bR(k);
      const p = P(k, b + side * (3.5 + rng() * 9), 2.5 + rng() * 8);
      deco.push({ x: p[0], y: p[1], z: p[2], ph: rng() * TAU, s: 0.9 + rng() * 1.3, c: [0xffe14a, 0xffffff, 0xff9dd8, 0x9fe8ff, 0xffd23f][deco.length % 5] });
    }
    const dm = K.instanced(sg, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), deco, 'decostars');
    if (dm) {
      deco.forEach((d, i) => dm.setColorAt(i, col.set(d.c))); group.add(dm); dm.frustumCulled = false;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), E = new THREE.Euler();
      updaters.push((dt, t) => {
        deco.forEach((d, i) => { E.set(0, t * 1.4 + d.ph, 0); q.setFromEuler(E); p.set(d.x, d.y + Math.sin(t * 1.7 + d.ph) * 0.5, d.z); sc.setScalar(d.s); dm.setMatrixAt(i, m4.compose(p, q, sc)); });
        dm.instanceMatrix.needsUpdate = true;
      });
    }
  }

  /* =============================================================== the moon with a face, floating inside the Moon Loop */
  {
    // find the Moon Loop: the centre of the authored loop points (map (−40, −165))
    const cx = W(-40), cz = -165;
    let rIn = Infinity, yAvg = 0, cnt = 0;
    for (let k = 0; k < n; k++) { const d = Math.hypot(track.X[k] - cx, track.Z[k] - cz); if (d < 60) { rIn = Math.min(rIn, d - HW[k] - track.OFFL[k] - track.OFFR[k]); yAvg += Y[k]; cnt++; } }
    yAvg = cnt ? yAvg / cnt : -8;
    const r = Math.max(8, Math.min(22, rIn - 4));
    const tex = K.canvasTex(1024, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff6d8'); gr.addColorStop(1, '#f0d890'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(200,170,110,.35)'; for (let i = 0; i < 40; i++) { const x = Math.random() * w, y = h * 0.15 + Math.random() * h * 0.7, rr = 8 + Math.random() * 30; g.beginPath(); g.ellipse(x, y, rr * 1.4, rr, 0, 0, 7); g.fill(); }
      // the face at u = 0.25 (SphereGeometry: u = 0.25 faces local +Z); the sphere is squashed in u, so draw ellipses wide
      const fx = w * 0.25, fy = h * 0.5;
      g.strokeStyle = '#7a5a2a'; g.lineWidth = 16; g.lineCap = 'round';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(fx + s * 70, fy - 40, 34, 26, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }  // happy closed eyes ^ ^
      g.beginPath(); g.ellipse(fx, fy + 20, 95, 60, 0, Math.PI * 0.12, Math.PI * 0.88); g.stroke();
      g.fillStyle = 'rgba(255,120,150,.55)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(fx + s * 135, fy + 30, 42, 24, 0, 0, 7); g.fill(); }
    });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 24), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x6a5a30, emissiveIntensity: 0.9 }));
    moon.position.set(cx, yAvg - 2, cz);
    moon.lookAt(cx - 40, yAvg + 6, cz + 40);         // face the Stardust Bridge + the climb back to the start
    moon.name = 'scenery:moon'; group.add(moon);
    const moonY = moon.position.y;
    updaters.push((dt, t) => { moon.position.y = moonY + Math.sin(t * 0.6) * 0.6; });
  }

  /* =============================================================== planets (lit, no fog), a ringed planet, the asteroid ring */
  const tb = track.bounds, tcx = (tb.minX + tb.maxX) / 2, tcz = (tb.minZ + tb.maxZ) / 2;
  {
    const planet = (x, y, z, r, cols, bands = 7, seg = 40) => {
      const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.6));
      const p = g.attributes.position, c = [], cc = cols.map(h => new THREE.Color(h));
      for (let i = 0; i < p.count; i++) {
        const v = p.getY(i) / r, w = (Math.sin(v * bands * 1.7 + Math.sin(p.getX(i) / r * 3) * 0.4) + 1) / 2;
        const a = cc[Math.floor(w * (cc.length - 1) + 0.5) % cc.length];
        c.push(a.r, a.g, a.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.rotateZ(0.3); g.translate(tcx + x, y, tcz + z);
      return g;
    };
    B.add('planets', planet(-620, 160, 780, 170, [0xffb86b, 0xfff0d0, 0xe8864a, 0xffd89a]));        // big stripy giant, ahead-left of the start
    B.add('planets', planet(760, 90, 520, 105, [0xc9a0ff, 0xf0d8ff, 0x9a6ae0]));                     // the ringed one
    B.add('planets', planet(-380, -140, -560, 55, [0xff6a5a, 0xffa08a, 0xd84a3a], 4, 28));          // little red one, below
    B.add('planets', planet(900, -80, -420, 85, [0x7fe0ff, 0xe0fbff, 0x4ab0e0], 5));                 // ice planet
    B.add('planets', planet(-980, -320, -80, 240, [0x6ad8a0, 0xb8f5d0, 0x3aa87a, 0x9fe8c0], 9, 48)); // huge green giant far below
    B.mesh('planets', new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, emissive: 0x2a1a44 }));
    // rings round the ringed planet
    {
      const rg = new THREE.RingGeometry(140, 230, 72, 3);
      const p = rg.attributes.position, c = [];
      for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getY(i)); const t = (d - 140) / 90; c.push(...col.set(hue(0.85 + t * 0.35, 0.8, 0.72)).toArray()); }
      rg.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      rg.rotateX(-Math.PI / 2 + 0.35); rg.rotateZ(0.25); rg.translate(tcx + 760, 90, tcz + 520);
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, side: THREE.DoubleSide, fog: false, depthWrite: false, toneMapped: false }));
      m.name = 'scenery:rings'; group.add(m);
    }
    // the asteroid ring round the whole course, below it, turning slowly
    {
      const rocks = [];
      for (let i = 0; i < 280; i++) {
        const a = rng() * TAU, R = 470 + rng() * 110;
        rocks.push({ x: Math.cos(a) * R, y: -85 + (rng() - 0.5) * 30 + Math.sin(a * 3) * 12, z: Math.sin(a) * R, s: 2 + rng() * rng() * 11, yaw: rng() * TAU, rx: rng() * 3, rz: rng() * 3, c: [0x8a7a9a, 0x6a5a7a, 0xa08a78, 0x7a6a8a][i % 4] });
      }
      const g = K.paint(new THREE.DodecahedronGeometry(1, 0), 0xffffff);
      const im = K.instanced(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), rocks, 'asteroids');
      rocks.forEach((r, i) => im.setColorAt(i, col.set(r.c)));
      const holder = new THREE.Group(); holder.position.set(tcx, 0, tcz); holder.add(im); group.add(holder);
      im.frustumCulled = false;
      updaters.push((dt, t) => { holder.rotation.y = t * 0.012; });
    }
  }

  /* =============================================================== sky: nebula texture, starfield, Sootie constellation, shooting stars */
  const sky = group.userData.sky;
  loadTex('sky_star', () => { const c = document.createElement('canvas'); c.width = c.height = 4; return c; }, {
    onload: (tex) => { tex.wrapT = THREE.ClampToEdgeWrapping; if (sky) sky.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }); },
  });
  if (sky) {
    // starfield (all round, twinkling)
    {
      const pts = [], cols = [];
      for (let i = 0; i < 2200; i++) {
        const u = rng() * 2 - 1, a = rng() * TAU, r = 1500, s = Math.sqrt(1 - u * u);
        pts.push(Math.cos(a) * s * r, u * r, Math.sin(a) * s * r);
        const w = 0.6 + rng() * 0.4; const tint = rng();
        cols.push(w * (tint < 0.2 ? 1 : 0.85), w * 0.9, w * (tint > 0.8 ? 1 : 0.95));
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const m = new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true, toneMapped: false });
      const stars = new THREE.Points(g, m); stars.name = 'scenery:starfield'; stars.frustumCulled = false; stars.renderOrder = -0.9;
      sky.add(stars);
      updaters.push((dt, t) => { m.opacity = 0.8 + Math.sin(t * 2.3) * 0.2; });
    }
    // the giant Sootie constellation: a sitting cat, ahead of the start (north), big in the sky
    {
      // 2D outline in "sky units" (x right, y up); lines join consecutive points of each polyline
      const cat = [
        [[-0.85, 1.55], [-0.75, 2.45], [-0.3, 1.95], [0.3, 1.95], [0.75, 2.45], [0.85, 1.55]],          // ears + top of the head
        [[0.85, 1.55], [0.6, 1.05], [0, 0.9], [-0.6, 1.05], [-0.85, 1.55]],                              // cheeks
        [[-0.45, 0.95], [-1.1, 0.1], [-1.3, -1.1], [-1.0, -2.2], [-0.3, -2.5], [0.3, -2.5], [1.0, -2.2], [1.3, -1.1], [1.1, 0.1], [0.45, 0.95]], // body
        [[1.0, -2.2], [1.9, -2.3], [2.4, -1.6], [2.3, -0.7], [1.9, -0.4]],                              // the tail curling up
        [[-0.5, 1.2], [-1.3, 1.3]], [[-0.5, 1.1], [-1.25, 0.95]], [[0.5, 1.2], [1.3, 1.3]], [[0.5, 1.1], [1.25, 0.95]], // whiskers
      ];
      const eyes = [[-0.35, 1.4], [0.35, 1.4]];
      const dir = new THREE.Vector3(0.05, 0.3, 1).normalize(), R = 1450, S = 105;
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize().negate();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize().negate();
      const to3 = ([x, y]) => dir.clone().multiplyScalar(R).addScaledVector(right, x * S).addScaledVector(up, y * S);
      const lp = [], sp = [], sc = [];
      for (const pl of cat) for (let i = 0; i < pl.length; i++) { const v = to3(pl[i]); sp.push(v.x, v.y, v.z); sc.push(1, 0.95, 0.85); if (i) { const a = to3(pl[i - 1]); lp.push(a.x, a.y, a.z, v.x, v.y, v.z); } }
      for (const e of eyes) { const v = to3(e); sp.push(v.x, v.y, v.z); sc.push(0.56, 1.0, 0.7); sp.push(v.x, v.y, v.z); sc.push(0.56, 1.0, 0.7); }  // mint-green eyes (Sootie!), doubled = brighter
      { const v = to3([0, 1.2]); sp.push(v.x, v.y, v.z); sc.push(1, 0.55, 0.75); }                  // pink nose
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xa8c8ff, transparent: true, opacity: 0.55, fog: false, depthWrite: false, toneMapped: false }));
      lines.name = 'scenery:sootie-lines'; lines.frustumCulled = false; lines.renderOrder = -0.85; sky.add(lines);
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
      const pm = new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, map: glowDot(THREE), transparent: true, fog: false, depthWrite: false, toneMapped: false });
      const pts = new THREE.Points(sg, pm); pts.name = 'scenery:sootie-stars'; pts.frustumCulled = false; pts.renderOrder = -0.84; sky.add(pts);
      updaters.push((dt, t) => { pm.size = 9 + Math.sin(t * 3) * 1.5; });
    }
    // shooting stars: streaks that zip across the sky now and then
    {
      const tex = K.canvasTex(256, 16, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.85, 'rgba(255,240,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.fillRect(0, 3, w, h - 6); });
      const N = 6, streaks = [];
      for (let i = 0; i < N; i++) streaks.push({ a: rng() * TAU, el: 0.2 + rng() * 0.7, dirA: rng() * TAU, ph: rng() * 9, per: 5 + rng() * 6 });
      const g = new THREE.PlaneGeometry(160, 3);
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const im = new THREE.InstancedMesh(g, m, N); im.name = 'scenery:shootingstars'; im.frustumCulled = false; im.renderOrder = -0.8;
      sky.add(im);
      const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), Z = new THREE.Vector3(), X = new THREE.Vector3(), Yv = new THREE.Vector3(), mm = new THREE.Matrix4();
      updaters.push((dt, t) => {
        streaks.forEach((s, i) => {
          const u = ((t + s.ph) % s.per) / 1.2;           // 1.2 s streak, then a rest
          const on = u < 1;
          const R = 1300;
          Z.set(Math.cos(s.a) * Math.cos(s.el), Math.sin(s.el), Math.sin(s.a) * Math.cos(s.el));  // where on the sky
          X.set(-Math.sin(s.a), 0, Math.cos(s.a)).applyAxisAngle(Z, s.dirA).normalize();            // travel direction on the sky
          Yv.crossVectors(Z, X).normalize();
          p.copy(Z).multiplyScalar(R).addScaledVector(X, (u - 0.5) * 500);
          mm.makeBasis(X, Yv, Z); q.setFromRotationMatrix(mm);
          sc.set(on ? 1 : 0, on ? 1 : 0, 1);
          im.setMatrixAt(i, m4.compose(p, q, sc));
        });
        im.instanceMatrix.needsUpdate = true;
      });
    }
  }

  /* =============================================================== build the merged meshes */
  B.mesh('under', new THREE.MeshBasicMaterial({ color: 0x2a1650, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
  B.mesh('edge', new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }));
  B.mesh('glow', new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }));
  B.mesh('field', new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));

  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}

/** a soft round dot texture for point sprites */
function glowDot(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
