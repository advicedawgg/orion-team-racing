// scenery/castle.js — King Dad's Castle (tracks agent). Contract: DESIGN.md "Scenery hook".
//
// The track data (tracks/castle.js) tags stretches with a scenery-only `look`; this file draws the
// boundary to match (the physical walls are `none`): forecourt walls, drawbridge rails, gatehouse,
// the roofed GREAT HALL (tables are the barrier), the Remote Tower the spiral climbs, crenellated
// parapets on the battlements with the curtain wall underneath, garden-maze hedges. Plus the
// King Dad touches (portraits, banners, throne armchair, TV, sock pile, barbecue, washing line)
// and a twilight sky with a big friendly moon.
//
// Budget: everything static is merged per material (stone, stone-hall, wood, planks, hedge, floor,
// roof, props, glow, atlas, bunting …) and repeated props are instanced — ≈30 draw calls.
// Emissive = MeshBasic + toneMapped:false. No lights are ever added.
import { makeKit } from './kit.js';

const TAU = Math.PI * 2;
// family colours (racers.js): Orion blue/yellow/red, Sootie pink/mint, Mum purple, King Dad red/gold
const FAMILY = [0x2f6fdc, 0xffd23f, 0xc22532, 0xff6fae, 0x8ff0b4, 0x9b59d0, 0xd0342c];
const GOLD = 0xffd23f, VELVET = 0xc0283a, GOWN = 0x2f6fd0, TRIM = 0x1e4d94, SKIN = 0xf0c9a0, BEARD = 0x241a14;

export default function build(ctx) {
  const { THREE, group, track, def, rng, loadTex, groundAt, isClear, corridorInfo } = ctx;
  const K = makeKit(ctx);
  const { P, box, cyl, cone, sphere, strip, quad } = K;
  const n = track.n, HW = track.HW, Y = track.Y;
  const B = K.buckets(group);
  const updaters = [];
  const flames = [], smokeAt = [], fountainAt = [];
  const look = K.inherited('look', 'court');
  const W = mx => -mx;                       // map east (mx) → world x
  const isGap = k => (track.FLAG[K.wrap(k)] & 1) !== 0;
  const inCorridor = (x, z, m = 0.8) => corridorInfo(x, z).e < m;

  /* =============================================================== materials */
  const T = (name, fb) => loadTex(name, fb || null);
  const stoneTex = T('castle_wall'), woodTex = T('wood'), hedgeTex = T('hedge'), floorTex = T('castle_floor');
  const stoneMat = new THREE.MeshLambertMaterial({ map: stoneTex, vertexColors: true, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshLambertMaterial({ map: woodTex, vertexColors: true, side: THREE.DoubleSide });
  const plankMat = new THREE.MeshLambertMaterial({ map: woodTex, vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const hedgeMat = new THREE.MeshLambertMaterial({ map: hedgeTex, vertexColors: true, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTex, vertexColors: true });
  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });

  /* =============================================================== the atlas (portraits, banners, signs, TV) */
  const AW = 2048, AH = 1024;
  const cells = {};
  const atlasTex = K.canvasTex(AW, AH, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, AW, AH);
    const cell = (name, x, y, w, h, draw) => { g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, w, h); g.restore(); cells[name] = [(x + 3) / AW, 1 - (y + h - 3) / AH, (x + w - 3) / AW, 1 - (y + 3) / AH]; };   // inset: no bleeding from the neighbours
    // --- King Dad portraits (3 poses)
    for (let v = 0; v < 3; v++) cell('portrait' + v, v * 300, 0, 300, 380, (c, w, h) => drawKingDad(c, w, h, v));
    // --- banners (tall): red with a gold crown, blue with a remote
    cell('bannerCrown', 900, 0, 150, 420, (c, w, h) => drawBanner(c, w, h, '#c22532', '#ffd23f', 'crown'));
    cell('bannerRemote', 1050, 0, 150, 420, (c, w, h) => drawBanner(c, w, h, '#2f6fd0', '#ffd23f', 'remote'));
    cell('bannerStar', 1200, 0, 150, 420, (c, w, h) => drawBanner(c, w, h, '#9b59d0', '#ffe066', 'star'));
    // --- signs
    cell('signChair', 1350, 0, 698, 200, (c, w, h) => drawSign(c, w, h, ["DAD'S CHAIR", 'DO NOT SIT'], '#fff4d6', '#c22532'));
    cell('signCount', 1350, 200, 698, 150, (c, w, h) => drawSign(c, w, h, ["DON'T MAKE ME", 'COUNT TO THREE!'], '#ffd23f', '#2d3142'));
    cell('signWelcome', 0, 400, 900, 170, (c, w, h) => drawSign(c, w, h, ["KING DAD'S CASTLE"], '#2f6fd0', '#ffd23f', true));
    cell('signBBQ', 900, 430, 500, 140, (c, w, h) => drawSign(c, w, h, ["DAD'S FAMOUS", 'SAUSAGES'], '#fff4d6', '#8a4a1a'));
    cell('signSocks', 1400, 350, 648, 140, (c, w, h) => drawSign(c, w, h, ['LOST SOCKS', 'DEPARTMENT'], '#f4ecff', '#9b59d0'));
    cell('signLights', 1400, 490, 648, 140, (c, w, h) => drawSign(c, w, h, ['WHO LEFT ALL', 'THE LIGHTS ON?'], '#ffd23f', '#2d3142'));
    // --- chevrons (arrow points to the RIGHT of the cell; flip the UV for left turns)
    cell('chevron', 0, 580, 360, 180, (c, w, h) => drawChevron(c, w, h));
    // --- TV screen: a kart race on telly
    cell('tv', 360, 580, 480, 280, (c, w, h) => drawTV(c, w, h));
    // --- the moon's friendly face
    cell('moon', 840, 580, 400, 400, (c, w, h) => drawMoon(c, w, h));
    // --- window glow (warm, with cross bars)
    cell('window', 1240, 640, 120, 200, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffe9a8'); gr.addColorStop(1, '#ffb347'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.fillStyle = '#5a3a20'; c.fillRect(w / 2 - 5, 0, 10, h); c.fillRect(0, h * 0.45, w, 10); c.strokeStyle = '#5a3a20'; c.lineWidth = 14; c.strokeRect(0, 0, w, h); });
    // --- sock (for the washing line and the pile)
    cell('sock', 1360, 640, 120, 160, (c, w, h) => { c.clearRect(0, 0, w, h); });
  });
  atlasTex.generateMipmaps = true;
  const atlasMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, toneMapped: false, side: THREE.DoubleSide, fog: true });
  const moonMat = new THREE.MeshBasicMaterial({ map: atlasTex, transparent: true, depthWrite: false, fog: false, toneMapped: false });

  /* =============================================================== boundary geometry (walls follow the road) */
  // per-sample boundary lat on each side (+1 left, −1 right)
  const bLat = (k, s) => s * (HW[K.wrap(k)] + (s > 0 ? track.OFFL[K.wrap(k)] : track.OFFR[K.wrap(k)]));
  const styleOf = (k, s) => {
    const l = look(k);
    switch (l) {
      case 'court': case 'ward': return 'low';
      case 'drawbridge': return 'rail';
      case 'gate': return 'gate';
      case 'hall': return 'tables';
      case 'tower': return 'parapet';                          // a gap between ramp and tower: the chase cam never ends up inside the stone
      case 'battlement': case 'ramp': return 'parapet';
      case 'hedge': return 'hedge';
      default: return 'low';
    }
  };
  const roadY = k => Y[K.wrap(k)];
  const gY = (x, z) => groundAt(x, z);
  // runs of consecutive samples with the same style per side
  const runs = [];
  for (const s of [1, -1]) {
    let cur = null;
    for (let j = 0; j <= n; j++) {
      const k = j % n, st = isGap(k) ? null : styleOf(k, s);
      if (!cur || st !== cur.style) { if (cur && cur.ks.length > 1) runs.push(cur); cur = st ? { style: st, s, ks: [] } : null; if (cur && j > 0 && !isGap(k - 1)) cur.ks.push(K.wrap(k - 1)); }
      if (cur) cur.ks.push(k);
    }
    if (cur && cur.ks.length > 1) runs.push(cur);
  }
  const STONE_LIGHT = 0xfff6ea, STONE_DARK = 0xd9cfc2;
  const merlonList = []; let bannerN = 0;
  for (const run of runs) {
    const { style, s, ks } = run;
    const rowsWall = [], rowsSkirt = [], rowsUnder = [], rowsHedge = [], rowsRail = [], rowsFascia = [];
    let lastMerlon = -99, along = 0, lastBanner = -10;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i], b = bLat(k, s), base = P(k, b);
      if (i > 0) along += track.ds;
      const out = (d, dy) => P(k, b + s * d, dy);
      if (style === 'low' || style === 'parapet') {
        const h = style === 'low' ? 1.3 : 1.2, t = style === 'low' ? 0.9 : 1.1;
        // inner face → top → outer face (repeated points = crisp creases)
        rowsWall.push([out(0, -0.6), out(0, h), out(0, h), out(t, h), out(t, h), out(t, style === 'parapet' ? -0.3 : -0.6)]);
        if (along - lastMerlon >= 2.6 && i > 0 && i < ks.length - 1) {
          lastMerlon = along;
          const p = out(t / 2, h);
          merlonList.push({ x: p[0], y: p[1], z: p[2], yaw: track.HEAD[k] - Math.PI / 2, sx: 1.2, sy: style === 'low' ? 0.55 : 0.9, sz: t + 0.02 });
        }
      }
      if (style === 'hedge') {
        const h = 2.3, t = 1.6;
        rowsHedge.push([out(0, -0.5), out(0, h), out(0, h), out(t * 0.5, h + 0.25), out(t * 0.5, h + 0.25), out(t, h), out(t, h), out(t, -0.5)]);
      }
      if (style === 'rail') {
        rowsRail.push([out(0.05, 0.95), out(0.05, 1.2), out(0.05, 1.2), out(0.3, 1.2), out(0.3, 1.2), out(0.3, 0.95)]);
        rowsFascia.push([out(0.3, 0.95), out(0.3, -0.25), out(0.3, -0.25), [base[0] + K.lxA(k) * s * 0.3, -2.6, base[2] + K.lzA(k) * s * 0.3]]);
        if (along - lastMerlon >= 2.5 || i === 0 || i === ks.length - 1) { lastMerlon = along; const p = out(0.17, 0); B.add('wood', box(0.3, 1.35, 0.3, p[0], p[1] - 0.1, p[2], track.HEAD[k], 0xd8b48a, 1.2)); }
      }
      if (style === 'gate') {
        rowsWall.push([out(0, -0.6), out(0, 9.2), out(0, 9.2), out(1.5, 9.2)]);
      }
      // the curtain wall under raised stretches: outer face down to the ground (or a deck edge over a road)
      if (style === 'parapet' || style === 'inner') {
        const t = style === 'parapet' ? 1.1 : 0.4;
        const top = out(t, style === 'parapet' ? -0.3 : 0);
        const gy = gY(top[0], top[2]);
        if (top[1] - gy > 0.4) {
          const below = K.roadBelow(top[0], top[2], top[1], k) || K.roadBelow(base[0], base[2], base[1], k);
          const bottom = below ? top[1] - 1.6 : gy - 1.0;
          rowsSkirt.push([top, [top[0], bottom, top[2]]]);
          if (below) rowsUnder.push(k);
          // family banners hanging on the outside of the walls (break up the long stone faces)
          else if (style === 'parapet' && along - lastBanner >= 21 && top[1] - gy > 8) {
            lastBanner = along;
            const pb = out(t + 0.06, -3.6), yawB = Math.atan2(s * K.lxA(k), s * K.lzA(k));
            B.add('atlas', quad(2.4, 6.4, pb[0], pb[1], pb[2], yawB, [cells.bannerCrown, cells.bannerRemote, cells.bannerStar][bannerN++ % 3], 0xe8e8e8));
          }
        } else if (rowsSkirt.length) { B.add('stone', strip(rowsSkirt.splice(0), { uS: 4, vS: 4, color: STONE_DARK, vAbs: true })); }
      }
    }
    if (rowsWall.length > 1) B.add(style === 'gate' ? 'stone' : 'stone', strip(rowsWall, { uS: 4, vS: 4, color: style === 'low' ? STONE_LIGHT : 0xf4ece0 }));
    if (rowsSkirt.length > 1) B.add('stone', strip(rowsSkirt, { uS: 4, vS: 4, color: STONE_DARK, vAbs: true }));
    if (rowsHedge.length > 1) B.add('hedge', strip(rowsHedge, { uS: 3, vS: 3, color: 0xe8ffd8 }));
    if (rowsRail.length > 1) B.add('wood', strip(rowsRail, { uS: 3, vS: 1, color: 0xe8c8a0 }));
    if (rowsFascia.length > 1) B.add('wood', strip(rowsFascia, { uS: 3, vS: 3, color: 0xc89a6a }));
    // deck underside where a raised stretch passes over another road (the tower bridge)
    if (rowsUnder.length > 1 && s > 0) {
      const rows = rowsUnder.map(k => { const l = bLat(k, 1) + 1.1, r = bLat(k, -1) - 1.1; const a = P(k, l, -1.6), c = P(k, r, -1.6); return [a, c]; });
      B.add('stone', strip(rows, { uS: 4, vS: 4, color: 0xc8beb0 }));
    }
  }
  // merlons: one instanced stone mesh
  {
    const mg = K.worldUV(K.paint(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), 0xf6eee2), 1);
    const im = K.instanced(mg, stoneMat, merlonList, 'merlons', { cast: true });
    if (im) group.add(im);
  }

  /* =============================================================== drawbridge planks + chains */
  {
    const ks = []; for (let k = 0; k < n; k++) if (look(k) === 'drawbridge') ks.push(k);
    const rows = ks.map(k => { const b = HW[k] + track.OFFL[k] + 0.1; return [P(k, b, 0.02), P(k, -b, 0.02)]; });
    // planks run across the road: u along the track, so rotate by building v along the road
    const g = strip(rows, { uS: 1.2, vS: 4, color: 0xf0d8b8 });
    if (g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); } B.add('planks', g); }
    // chains from the deck up to the gatehouse
    if (ks.length) {
      const k0 = ks[Math.floor(ks.length * 0.25)];
      for (const s of [1, -1]) {
        const a = P(k0, s * (HW[k0] + 0.5), 1.1), bb = [W(s * -8.6), 11.5, -4.4];
        const steps = 14;
        for (let i = 0; i < steps; i++) {
          const t = (i + 0.5) / steps, sag = Math.sin(Math.PI * t) * 1.2;
          const x = a[0] + (bb[0] - a[0]) * t, y = a[1] + (bb[1] - a[1]) * t - sag, z = a[2] + (bb[2] - a[2]) * t;
          const link = new THREE.TorusGeometry(0.28, 0.08, 4, 8); link.rotateY(i % 2 ? 0 : Math.PI / 2); link.translate(x, y, z);
          B.add('props', K.paint(link, 0x4a4a55));
        }
      }
    }
  }

  /* =============================================================== the castle: curtain walls, towers, gatehouse */
  const WALL_H = 12;
  /** a straight wall of panels from map (m0,z0) to (m1,z1); skips panels on the drivable corridor (makes doorways) */
  function wall(m0, z0, m1, z1, { h = WALL_H, t = 5, merlons = true, bucket = 'stone', door = 0, windows = 0, torchSide = 0 } = {}) {
    const x0 = W(m0), x1 = W(m1), L = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(-(z1 - z0), x1 - x0), nx = Math.sin(yaw), nz = Math.cos(yaw);
    const seg = Math.max(1, Math.round(L / 2)), sl = L / seg;
    let run = 0;
    const flush = (i) => { if (!run) return; const a = (i - run) / seg, b = i / seg, cx = x0 + (x1 - x0) * (a + b) / 2, cz = z0 + (z1 - z0) * (a + b) / 2; const base = Math.min(gY(cx, cz), 0) - 1.2; B.add(bucket, box(L * (b - a), h - base, t, cx, base, cz, yaw, 0xf2e9dc)); run = 0; };
    for (let i = 0; i < seg; i++) {
      const t0 = (i + 0.5) / seg, x = x0 + (x1 - x0) * t0, z = z0 + (z1 - z0) * t0;
      const open = inCorridor(x, z, 1.0) || inCorridor(x + nx * t / 2, z + nz * t / 2, 1.0) || inCorridor(x - nx * t / 2, z - nz * t / 2, 1.0);
      if (open) { flush(i); if (door) B.add(bucket, box(sl + 0.02, h - door, t, x, door, z, yaw, 0xf2e9dc)); }
      else run++;
    }
    flush(seg);
    if (merlons) for (let d = 1.2; d < L - 0.6; d += 2.6) {
      const x = x0 + (x1 - x0) * d / L, z = z0 + (z1 - z0) * d / L;
      for (const side of [1, -1]) { if (inCorridor(x, z, 1.5)) continue; merlonList2.push({ x: x + nx * side * (t / 2 - 0.5), y: h, z: z + nz * side * (t / 2 - 0.5), yaw, sx: 1.2, sy: 1.0, sz: 1.0 }); }
    }
    for (let d = 8; d < L - 4 && windows; d += windows) {
      const x = x0 + (x1 - x0) * d / L, z = z0 + (z1 - z0) * d / L;
      for (const side of [1, -1]) { if (torchSide && side !== torchSide) continue; if (inCorridor(x, z, 2)) continue; B.add('atlas', quad(1.4, 2.4, x + nx * side * (t / 2 + 0.03), h * 0.62, z + nz * side * (t / 2 + 0.03), yaw + (side > 0 ? 0 : Math.PI), cells.window, 0xffffff)); }
    }
  }
  const merlonList2 = [];
  function tower(m, z, r, h, roof = 0x3d5aa8, flagC = 0xffd23f, { bucket = 'stone', crown = false } = {}) {
    const x = W(m), base = Math.min(gY(x, z), 0) - 1.5;
    B.add(bucket, cyl(r, r * 1.04, h - base, 20, x, base, z, 0xf0e6d8, 4));
    // corbel ring + merlons
    B.add(bucket, cyl(r + 0.7, r, 1.2, 20, x, h - 0.2, z, 0xe8dccc, 4));
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; merlonList2.push({ x: x + Math.cos(a) * (r + 0.2), y: h + 1, z: z + Math.sin(a) * (r + 0.2), yaw: -a + Math.PI / 2, sx: 1.3, sy: 1.0, sz: 0.9 }); }
    if (!crown) {
      B.add('props', cone(r + 0.9, r * 1.6, 16, x, h + 1.0, z, roof));
      B.add('props', cyl(0.12, 0.12, 4, 5, x, h + 1 + r * 1.6 - 0.3, z, 0xdddddd));
      flag(x, h + 1 + r * 1.6 + 2.6, z, flagC);
    }
    // glowing windows
    for (let i = 0; i < 3; i++) { const a = rng() * TAU, y = 5 + i * (h - 8) / 3; B.add('atlas', quad(1.2, 2.0, x + Math.cos(a) * (r + 0.05), y, z + Math.sin(a) * (r + 0.05), -a + Math.PI / 2, cells.window, 0xffffff)); }
  }
  const flags = [];
  function flag(x, y, z, c) { flags.push({ x, y, z, c }); }

  // the forecourt side of the moat has no wall; the castle proper:
  const HALL = { w0: -17, w1: 17, z0: 12, z1: 142, h: 13 };
  wall(-20, 2, -16, 2, { t: 6 });                                  // south wall, west of the gatehouse
  wall(16, 2, 150, 2, { t: 6, windows: 0 });                       // south wall, east of the gatehouse
  wall(-20, 2, -20, 162, { t: 6 });                                // west wall (the hall's west wall inside it)
  wall(-20, 162, 88, 162, { t: 6 });                               // north wall, west part (the road lands on it further east)
  tower(-20, 2, 7, 19, 0x3d5aa8, 0x2f6fdc);
  tower(-20, 162, 7, 19, 0xc22532, 0xffd23f);
  tower(184, 174, 7.5, 20, 0x3d5aa8, 0xff6fae);
  tower(152, 2, 6, 16, 0xc22532, 0x9b59d0);
  // gatehouse: two side blocks + a lintel over the passage, flanking towers, portcullis, welcome sign
  {
    const zc = 4, d = 16, pw = 8.1;
    for (const s of [1, -1]) B.add('stone', box(7, 15.5, d, W(s * (pw + 3.5)), -1.5, zc, 0, 0xf2e9dc));
    B.add('stone', box(pw * 2 + 0.2, 6.3, d, 0, 9.2, zc, 0, 0xeee4d6));
    for (let i = -3; i <= 3; i++) merlonList2.push({ x: i * 2.6, y: 15.5, z: zc - d / 2 + 0.6, yaw: 0, sx: 1.3, sy: 1.1, sz: 1.2 });
    tower(-15.5, -4.5, 5, 19, 0xc22532, 0xffd23f);
    tower(15.5, -4.5, 5, 19, 0xc22532, 0x2f6fdc);
    // portcullis (raised): bars + spikes just showing under the lintel
    for (let i = -7; i <= 7; i++) { B.add('props', box(0.25, 3.2, 0.25, W(i * 1.05), 9.0, zc - d / 2 + 1.2, 0, 0x3a3a44)); B.add('props', cone(0.18, 0.6, 4, W(i * 1.05), 8.4, zc - d / 2 + 1.2, 0x3a3a44)); }
    for (let j = 0; j < 2; j++) B.add('props', box(pw * 2, 0.25, 0.25, 0, 9.6 + j * 1.3, zc - d / 2 + 1.2, 0, 0x3a3a44));
    B.add('atlas', quad(13, 2.45, 0, 12.6, zc - d / 2 - 0.22, Math.PI, cells.signWelcome, 0xffffff));
    B.add('props', box(13.6, 3.0, 0.3, 0, 11.1, zc - d / 2 - 0.05, 0, GOLD));
  }

  /* =============================================================== the Remote Tower (the spiral climbs round it) */
  {
    const cmx = 78, cz = 97, cx = W(cmx);
    let rMin = Infinity; for (let k = 0; k < n; k++) if (look(k) === 'tower') { const b = P(k, bLat(k, -1)); rMin = Math.min(rMin, Math.hypot(b[0] - cx, b[2] - cz)); }
    const r = Math.max(10, rMin - 3.6), h = 27;
    B.add('stone', cyl(r, r, h + 1.5, 36, cx, -1.5, cz, 0xf4ecdf, 4));
    B.add('stone', cyl(r + 1.0, r, 1.4, 36, cx, h - 0.4, cz, 0xeadfce, 4));
    for (let i = 0; i < 26; i++) { const a = i / 26 * TAU; merlonList2.push({ x: cx + Math.cos(a) * (r + 0.4), y: h + 1, z: cz + Math.sin(a) * (r + 0.4), yaw: -a + Math.PI / 2, sx: 1.6, sy: 1.3, sz: 1.0 }); }
    B.add('stone', cyl(r + 0.6, r + 0.6, 0.3, 36, cx, h + 0.7, cz, 0xd8ccbc, 4)); // roof deck
    // the giant TV remote standing on top (King Dad's sceptre), glowing buttons
    const rx = cx, ry = h + 1, rz = cz;
    B.add('props', box(4.2, 12, 2.2, rx, ry, rz, 0.5, 0x26272e));
    B.add('props', box(3.2, 0.5, 1.6, rx, ry + 12, rz, 0.5, 0x34353d));
    const bt = (dx, dy, c, s = 0.7) => { const a = 0.5, fx = Math.cos(a), fz = -Math.sin(a); for (const face of [1, -1]) { const g = new THREE.CylinderGeometry(s, s, 0.3, 12); g.rotateX(Math.PI / 2); g.rotateY(a); g.translate(rx + fx * dx + Math.sin(a) * face * 1.12, ry + dy, rz + fz * dx + Math.cos(a) * face * 1.12); B.add('glow', K.paint(g, c)); } };
    bt(0, 10.4, 0xff3a4a, 0.9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) bt(-1.1 + j * 1.1, 4.2 + i * 1.5, [0x8ff0b4, 0xffd23f, 0x6fb8ff][j], 0.42);
    bt(0, 8.2, 0x6fb8ff, 0.7);
    // windows spiralling up the tower
    for (let i = 0; i < 14; i++) { const a = -i * 0.9, y = 3 + i * 1.6; B.add('atlas', quad(1.1, 1.9, cx + Math.cos(a) * (r + 0.06), y + 6, cz + Math.sin(a) * (r + 0.06), -a + Math.PI / 2, cells.window, 0xffffff)); }
    flag(cx + 2.6, h + 16, cz, 0xc22532);
    B.add('props', cyl(0.14, 0.14, 7, 5, cx + 2.6, h + 11, cz, 0xdddddd));
  }

  /* =============================================================== the GREAT HALL */
  {
    const { w0, w1, z0, z1, h } = HALL;
    // walls (panels skip the corridor → the south arch from the gatehouse and the east side door)
    wall(w0 - 1, z0, w0 - 1, z1 + 2, { h, t: 2, merlons: false, bucket: 'stoneHall', door: 9.5 });
    wall(w1 + 1, z0, w1 + 1, z1 + 2, { h, t: 2, merlons: false, bucket: 'stoneHall', door: 9.5, windows: 12, torchSide: -1 });
    wall(w0 - 2, z1 + 1, w1 + 2, z1 + 1, { h, t: 2, merlons: false, bucket: 'stoneHall' });
    wall(w0 - 2, z0 - 0.5, w1 + 2, z0 - 0.5, { h, t: 1, merlons: false, bucket: 'stoneHall', door: 9.2 });
    // ceiling + beams, roof
    const cw = (w1 - w0), cl = z1 - z0 + 2;
    const ceil = new THREE.PlaneGeometry(cw + 2, cl); ceil.rotateX(Math.PI / 2); ceil.translate(0, h, (z0 + z1) / 2 + 1);
    B.add('ceiling', K.worldUV(K.paint(ceil, 0xd8b890), 4));
    for (let z = z0 + 4; z < z1; z += 8) B.add('ceiling', box(cw + 2, 0.8, 0.7, 0, h - 0.8, z, 0, 0x9a6a40, 2));
    for (const mx of [-9, 0, 9]) B.add('ceiling', box(0.7, 0.7, cl, W(mx), h - 1.5, (z0 + z1) / 2 + 1, 0, 0x9a6a40, 2));
    // gable roof
    {
      const rh = 8, e = 2.5, za = z0 - 1.5, zb = z1 + 2.5;
      const pos = [], mk = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      mk([W(w0 - e), h, za], [0, h + rh, za], [0, h + rh, zb], [W(w0 - e), h, zb]);
      mk([W(w1 + e), h, za], [W(w1 + e), h, zb], [0, h + rh, zb], [0, h + rh, za]);
      pos.push(W(w0 - 1), h, za + 0.8, W(w1 + 1), h, za + 0.8, 0, h + rh - 0.3, za + 0.8);
      pos.push(W(w0 - 1), h, zb - 0.8, 0, h + rh - 0.3, zb - 0.8, W(w1 + 1), h, zb - 0.8);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      const cols = new Float32Array(pos.length); const cR = new THREE.Color(0x6f7aa8), cS = new THREE.Color(0xe6dccb);
      for (let i = 0; i < pos.length / 3; i++) { const c = i >= 12 ? cS : cR; cols.set([c.r, c.g, c.b], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      B.add('roof', g);
      for (let z = za + 3; z < zb; z += 12) B.add('roof', box(1.2, 2.8, 1.2, W(w1 - 4), h + 3, z, 0, 0xa33a2a));
    }
    // floor tiles
    const fl = new THREE.PlaneGeometry(cw, z1 - z0); fl.rotateX(-Math.PI / 2); fl.translate(0, 0.24, (z0 + z1) / 2);
    const fuv = fl.attributes.uv, fp = fl.attributes.position; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fp.getX(i) / 4, fp.getZ(i) / 4);
    B.add('floor', K.paint(fl, 0xffffff));
    // red carpet up the middle of the road? no — the road is cobbles; a carpet runner beyond the throne instead
    // tables along the boundary inside the hall
    const tables = [];
    for (const s of [1, -1]) {
      let last = -99;
      for (let k = 0; k < n; k++) {
        if (look(k) !== 'hall' || isGap(k)) continue;
        const sOf = k * track.ds; if (sOf - last < 4.6) continue;
        const p = P(k, bLat(k, s) + s * 1.25);
        const mx = -p[0];
        if (mx < w0 + 1.6 || mx > w1 - 1.6 || p[2] < z0 + 2.5 || p[2] > z1 - 2) continue;
        last = sOf;
        tables.push({ x: p[0], y: 0.25, z: p[2], yaw: track.HEAD[k] });
      }
    }
    {
      const parts = [];
      parts.push(box(4.7, 0.18, 2.3, 0, 0.92, 0, 0, 0xffffff, 2));
      for (const [dx, dz] of [[-2.1, -0.9], [2.1, -0.9], [-2.1, 0.9], [2.1, 0.9]]) parts.push(box(0.22, 0.92, 0.22, dx, 0, dz, 0, 0xe8d0b0, 1));
      // the barrier really is the table: a skirt panel on the road side so nothing looks drivable underneath
      parts.push(box(4.7, 0.6, 0.08, 0, 0.3, -1.12, 0, 0xd8b890, 2)); parts.push(box(4.7, 0.6, 0.08, 0, 0.3, 1.12, 0, 0xd8b890, 2));
      const tg = K.merge(parts);
      const tmesh = K.instanced(tg, woodMat, tables.map(t => ({ ...t, yaw: t.yaw + Math.PI / 2 })), 'tables', { cast: true }); if (tmesh) group.add(tmesh);
      // table cloth runner + food
      const food = [];
      food.push(box(4.72, 0.04, 1.0, 0, 1.1, 0, 0, 0xfff4f4, 4));
      food.push(K.cyl(0.55, 0.6, 0.45, 14, -1.2, 1.12, 0, 0xff8ad8));            // cake
      food.push(K.cyl(0.4, 0.45, 0.35, 14, -1.2, 1.57, 0, 0xffffff));
      food.push(sphere(0.12, -1.2, 2.0, 0, 0xe0102a, 8, 6));
      food.push(K.cyl(0.45, 0.45, 0.06, 14, 0.6, 1.12, -0.45, 0xffffff));          // plate + pizza
      food.push(K.cyl(0.4, 0.4, 0.05, 12, 0.6, 1.18, -0.45, 0xf2b23a));
      for (let i = 0; i < 5; i++) food.push(sphere(0.07, 0.6 + Math.cos(i * 1.3) * 0.25, 1.24, -0.45 + Math.sin(i * 1.3) * 0.25, 0xc22532, 6, 4));
      food.push(sphere(0.35, 1.7, 1.35, 0.35, 0xb0652a, 10, 7));                    // roast chicken
      food.push(K.cyl(0.18, 0.2, 0.55, 10, 0.2, 1.12, 0.5, 0x6fb8ff));             // jug of squash
      for (let i = 0; i < 7; i++) food.push(sphere(0.1, 1.9 + (i % 3) * 0.14, 1.2 + Math.floor(i / 3) * 0.12, -0.5 + (i % 2) * 0.1, 0x8f4fd0, 6, 4)); // grapes
      const fg = K.merge(food);
      const fm = K.instanced(fg, vmat, tables.map((t, i) => ({ ...t, yaw: t.yaw + Math.PI / 2 + (i % 2) * Math.PI })), 'food'); if (fm) group.add(fm);
    }
    // portraits of King Dad, banners, torches on the inner walls
    const torches = [];
    for (const side of [1, -1]) {
      const mxw = side > 0 ? w0 : w1;                       // west wall (mx −17) faces +mx (east): world yaw
      const face = side > 0 ? -Math.PI / 2 : Math.PI / 2;   // quad normal must point into the hall
      let v = side > 0 ? 0 : 1;
      for (let z = z0 + 9; z < z1 - 6; z += 15) {
        const inset = side > 0 ? 0.08 : -0.08;
        const x = W(mxw) - inset;
        if (inCorridor(x, z, 2.5)) continue;
        B.add('props', box(0.3, 4.9, 3.9, x - inset * 1.5, 4.15, z, 0, GOLD));   // frame
        B.add('atlas', quad(3.3, 4.2, x - inset * 4, 6.6, z, face, cells['portrait' + (v++ % 3)], 0xe8e8e8));
        // banners between portraits
        const bz = z + 7.5;
        if (bz < z1 - 6) { B.add('atlas', quad(2.0, 5.6, x - inset * 3, 8.6, bz, face, [cells.bannerCrown, cells.bannerRemote, cells.bannerStar][(v + (side > 0 ? 0 : 1)) % 3], 0xe0e0e0)); torches.push({ x: x - inset, y: 4.4, z: bz }); }
      }
    }
    // chandeliers over the road (candles glow)
    for (let z = z0 + 18; z < 96; z += 26) {
      const x = 0, y = h - 3.4;
      B.add('props', K.paint(new THREE.TorusGeometry(2.2, 0.12, 5, 20).rotateX(Math.PI / 2).translate(x, y, z), 0x5a4a3a));
      B.add('props', cyl(0.05, 0.05, 3.4, 4, x, y, z, 0x3a3a3a));
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; flames.push({ x: x + Math.cos(a) * 2.2, y: y + 0.35, z: z + Math.sin(a) * 2.2, s: 0.55 }); }
    }
    for (const t of torches) addTorch(t.x, t.y, t.z, t.x > 0 ? -Math.PI / 2 : Math.PI / 2);
    // THE THRONE: a giant armchair at the end of the hall, facing the racers, TV remote on the armrest
    {
      const x = W(0), z = z1 - 6.2, ya = Math.PI;             // faces −z (down the hall)
      const put = (g) => { g.rotateY(ya); g.translate(x, 0.25, z); return g; };
      const velvet = [], gold = [];
      velvet.push(K.paint(new THREE.BoxGeometry(9, 2.6, 6).translate(0, 1.3 + 0.8, 0), VELVET));    // seat base
      velvet.push(K.paint(new THREE.BoxGeometry(8, 1.2, 5.2).translate(0, 4.0, 0.2), 0xd83a4c));      // cushion
      velvet.push(K.paint(new THREE.BoxGeometry(9, 9, 1.8).translate(0, 5.3, -2.6), VELVET));         // back
      velvet.push(K.paint(new THREE.SphereGeometry(1, 16, 8).scale(4.5, 1.5, 0.9).translate(0, 9.8, -2.6), VELVET));
      for (const s of [1, -1]) {
        velvet.push(K.paint(new THREE.BoxGeometry(1.8, 3.4, 6.2).translate(s * 5.2, 2.5, 0), VELVET));   // armrests
        velvet.push(K.paint(new THREE.CylinderGeometry(0.95, 0.95, 6.3, 12).rotateX(Math.PI / 2).translate(s * 5.2, 4.3, 0), 0xd83a4c));
        gold.push(K.paint(new THREE.CylinderGeometry(0.5, 0.35, 0.9, 8).translate(s * 3.8, 0.45, 2.3), GOLD));
        gold.push(K.paint(new THREE.CylinderGeometry(0.5, 0.35, 0.9, 8).translate(s * 3.8, 0.45, -2.3), GOLD));
      }
      for (let i = 0; i < 5; i++) gold.push(K.paint(new THREE.ConeGeometry(0.55, 1.6, 5).translate(-3.2 + i * 1.6, 11.6, -2.6), GOLD));   // a crown on top
      gold.push(K.paint(new THREE.BoxGeometry(8.2, 0.7, 0.9).translate(0, 10.9, -2.6), GOLD));
      gold.push(K.paint(new THREE.SphereGeometry(0.45, 10, 6).translate(0, 11.0, -2.1), 0xff3a4a));
      // the TV remote on the right armrest (his right = −x in chair space)
      gold.push(K.paint(new THREE.BoxGeometry(1.1, 0.45, 2.8).translate(-5.2, 5.5, 0.6), 0x26272e));
      for (const g of [...velvet, ...gold]) B.add('props', K.worldUV(put(g), 4));
      const btn = K.paint(new THREE.BoxGeometry(0.3, 0.12, 0.3).translate(-5.2, 5.78, 1.5), 0xff3a4a); B.add('glow', put(btn));
      for (let i = 0; i < 3; i++) B.add('glow', put(K.paint(new THREE.BoxGeometry(0.22, 0.1, 0.22).translate(-5.4 + i * 0.22, 5.78, 0.6), [0x8ff0b4, 0xffd23f, 0x6fb8ff][i])));
      // DAD'S CHAIR — DO NOT SIT sign on a post in front of it
      const sx = W(-7), sz = z - 5.5;
      B.add('wood', box(0.35, 3.2, 0.35, sx, 0.25, sz, 0, 0xd8b890, 1));
      B.add('atlas', quad(4.2, 1.2, sx, 3.4, sz - 0.2, Math.PI, cells.signChair, 0xffffff));
      // the TV on the north wall, left of the chair, and a DON'T MAKE ME COUNT sign right of it
      B.add('props', box(9.4, 5.6, 0.5, W(-10.5), 5.2, z1 - 0.4, 0, 0x1e1f26));
      B.add('atlas', quad(8.6, 4.8, W(-10.5), 8.0, z1 - 0.7, Math.PI, cells.tv, 0xffffff));
      B.add('atlas', quad(6.0, 1.3, W(10.5), 9.4, z1 - 0.3, Math.PI, cells.signCount, 0xffffff));
      // a rug in front of the chair
      const rug = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2).scale(7.5, 1, 3.5).translate(x, 0.27, z - 5); B.add('props', K.paint(rug, 0x9b59d0));
    }
  }

  /* =============================================================== torches + flames */
  function addTorch(x, y, z, yaw) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    B.add('props', box(0.35, 0.35, 0.9, x + fx * 0.3, y - 0.2, z + fz * 0.3, yaw, 0x3a3030));
    B.add('props', cyl(0.28, 0.16, 0.5, 8, x + fx * 0.7, y, z + fz * 0.7, 0x5a4636));
    flames.push({ x: x + fx * 0.7, y: y + 0.75, z: z + fz * 0.7, s: 1 });
  }

  /* =============================================================== the forecourt: bunting, lamps, barbecue, sock pile, washing line */
  {
    // bunting zig-zags ACROSS the start straight between poles on the walls (family colours)
    const bunt = [];
    const along = []; for (let k = 0; k < n; k++) if (look(k) === 'court') along.push(k);
    for (let i = 0; i < along.length; i += 16) {
      const k = along[i], L = bLat(k, 1) + 0.5, R = bLat(k, -1) - 0.5;
      const a = P(k, L, 6.8), b = P(k, R, 6.8);
      for (const p of [a, b]) B.add('wood', box(0.22, 7.2, 0.22, p[0], p[1] - 7.4, p[2], 0, 0xd8b890, 1));
      const flagsN = 14;
      for (let j = 0; j < flagsN; j++) {
        const t0 = j / flagsN, t1 = (j + 1) / flagsN, sag = t => Math.sin(Math.PI * t) * 1.4;
        const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] - sag(t0), a[2] + (b[2] - a[2]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] - sag(t1), a[2] + (b[2] - a[2]) * t1];
        const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 0.85, (p0[2] + p1[2]) / 2];
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...mid], 3)); g.computeVertexNormals();
        bunt.push(K.paint(g, FAMILY[(j + i) % FAMILY.length]));
        const rope = new THREE.BufferGeometry(); rope.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, p1[0], p1[1] + 0.06, p1[2], ...p0, p1[0], p1[1] + 0.06, p1[2], p0[0], p0[1] + 0.06, p0[2]], 3)); rope.computeVertexNormals();
        bunt.push(K.paint(rope, 0xf5f5f5));
      }
    }
    for (const g of bunt) B.add('bunting', g);
    // lamp posts with glowing lanterns along the forecourt walls
    for (let i = 8; i < along.length; i += 22) {
      for (const s of [1, -1]) {
        const k = along[i], p = P(k, bLat(k, s) + s * 2.2);
        const gy = gY(p[0], p[2]);
        B.add('props', cyl(0.12, 0.16, 4.2, 6, p[0], gy, p[2], 0x2d3142));
        B.add('props', box(0.7, 0.12, 0.7, p[0], gy + 4.2, p[2], 0, 0x2d3142));
        B.add('glow', K.paint(new THREE.BoxGeometry(0.5, 0.7, 0.5).translate(p[0], gy + 4.65, p[2]), 0xffd98a));
        B.add('props', cone(0.5, 0.45, 4, p[0], gy + 5.0, p[2], 0x2d3142));
      }
    }
    // the BARBECUE (right of the start straight), the SOCK PILE (left), the washing line
    const spot = (s, sAlong, extra) => { const k = track.idx(sAlong), p = P(k, bLat(k, s) + s * extra); return { x: p[0], z: p[2], y: gY(p[0], p[2]), yaw: track.HEAD[k] }; };
    {
      const o = spot(-1, track.length - 22, 6.5);
      const parts = [];
      parts.push(K.cyl(1.3, 1.1, 1.0, 16, 0, 1.1, 0, 0x2d3142));                 // bowl
      parts.push(K.paint(new THREE.SphereGeometry(1.3, 16, 8, 0, TAU, 0, Math.PI / 2).translate(0, 2.1, -0.35).rotateX(-0.9), 0x2d3142));
      for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; parts.push(box(0.12, 1.2, 0.12, Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9, 0, 0x444a5a)); }
      for (let i = 0; i < 5; i++) { const g = new THREE.CapsuleGeometry(0.13, 0.9, 3, 6).rotateZ(Math.PI / 2).translate(0, 2.2, -0.6 + i * 0.3); parts.push(K.paint(g, 0xb85a3a)); } // sausages
      const g = K.merge(parts); g.rotateY(o.yaw); g.translate(o.x, o.y, o.z); B.add('props', g);
      const coals = K.paint(new THREE.CylinderGeometry(1.15, 1.15, 0.1, 16).translate(o.x, o.y + 2.05, o.z), 0xff7a2a); B.add('glow', coals);
      // sign
      B.add('wood', box(0.25, 2.4, 0.25, o.x + 2.4, o.y, o.z, 0, 0xd8b890, 1));
      B.add('atlas', quad(3.2, 0.9, o.x + 2.4, o.y + 2.6, o.z, o.yaw + Math.PI, cells.signBBQ, 0xffffff));
      smokeAt.push({ x: o.x, y: o.y + 2.6, z: o.z });
    }
    {
      // the giant sock pile: a heap of little socks (instanced), in family colours
      const o = spot(1, track.length - 45, 8.5);
      const socks = [];
      for (let i = 0; i < 220; i++) {
        const r = Math.pow(rng(), 0.7) * 5.5, a = rng() * TAU, hgt = Math.max(0, 4.8 * (1 - (r / 5.5) ** 1.6)) * (0.3 + 0.7 * rng());
        socks.push({ x: o.x + Math.cos(a) * r, y: o.y + hgt, z: o.z + Math.sin(a) * r, yaw: rng() * TAU, rx: rng() * 3, rz: rng() * 3, s: 1.2 + rng() * 0.6, c: FAMILY[i % FAMILY.length] });
      }
      const sg = K.merge([box(0.35, 0.9, 0.35, 0, -0.45, 0), box(0.35, 0.3, 0.8, 0, -0.45, 0.25)]);
      const im = K.instanced(sg, vmat, socks, 'socks'); if (im) { const c = new THREE.Color(); socks.forEach((s, i) => im.setColorAt(i, c.set(s.c))); group.add(im); }
      B.add('wood', box(0.25, 2.8, 0.25, o.x - 6.5, o.y, o.z, 0, 0xd8b890, 1));
      B.add('atlas', quad(3.6, 0.8, o.x - 6.5, o.y + 3.0, o.z, o.yaw + Math.PI, cells.signSocks, 0xffffff));
      // washing line with socks and a crown-print t-shirt between two poles
      const a = spot(1, track.length - 70, 6), b = spot(1, track.length - 58, 13);
      for (const p of [a, b]) B.add('wood', box(0.18, 3.4, 0.18, p.x, p.y, p.z, 0, 0xd8b890, 1));
      const items = 9;
      for (let j = 0; j < items; j++) {
        const t = (j + 0.5) / items, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + 3.3 - Math.sin(Math.PI * t) * 0.5;
        const yaw = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
        B.add('props', box(0.3, 0.8, 0.06, x, y - 0.8, z, yaw, FAMILY[(j * 3) % FAMILY.length]));
        B.add('props', box(0.5, 0.25, 0.06, x + Math.sin(yaw + Math.PI / 2) * 0.1, y - 0.95, z + Math.cos(yaw + Math.PI / 2) * 0.1, yaw, FAMILY[(j * 3) % FAMILY.length]));
      }
      const rope = new THREE.BufferGeometry(); rope.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y + 3.35, a.z, b.x, b.y + 3.35, b.z, b.x, b.y + 3.25, b.z], 3)); rope.computeVertexNormals(); B.add('props', K.paint(rope, 0xffffff));
    }
    {
      // WHO LEFT ALL THE LIGHTS ON? sign by the drawbridge, with a string of fairy lights
      const o = spot(-1, track.sOf(2.3), 3.5);
      B.add('wood', box(0.25, 2.8, 0.25, o.x, o.y, o.z, 0, 0xd8b890, 1));
      B.add('atlas', quad(3.6, 0.8, o.x, o.y + 3.0, o.z, o.yaw + Math.PI, cells.signLights, 0xffffff));
    }
  }

  /* =============================================================== garden maze: extra hedges, topiary, fountain, flowers */
  {
    const hedges = [];
    // decorative hedge walls on a grid round the maze (the fake corridors of the maze)
    for (let mx = 30; mx <= 215; mx += 11) for (let z = -205; z <= -38; z += 11) {
      if (rng() < 0.35) continue;
      const horiz = rng() < 0.5, len = 7 + rng() * 6;
      const x = W(mx + rng() * 2), zz = z + rng() * 2;
      const r = len / 2 + 1.2;
      if (!isClear(x, zz, r, 1.6) || !isClear(x + (horiz ? len / 2 : 0), zz + (horiz ? 0 : len / 2), 1.2, 1.2) || !isClear(x - (horiz ? len / 2 : 0), zz - (horiz ? 0 : len / 2), 1.2, 1.2)) continue;
      if (Math.abs(x) < 20 && zz > -60) continue;
      hedges.push(box(horiz ? len : 1.6, 2.3, horiz ? 1.6 : len, x, gY(x, zz) - 0.3, zz, 0, 0xe8ffd8, 3));
    }
    for (const g of hedges) B.add('hedge', g);
    // Sootie topiary (a green cat!), a fountain and flower beds
    const tp = [];
    const findClear = (mx, z, r) => { for (let i = 0; i < 40; i++) { const x = W(mx + (rng() - 0.5) * 30), zz = z + (rng() - 0.5) * 30; if (isClear(x, zz, r, 2)) return [x, zz]; } return null; };
    const cat = findClear(140, -115, 4);
    if (cat) {
      const [x, z] = cat, y = gY(x, z);
      tp.push(sphere(2.2, x, y + 2.0, z, 0xe8ffd8, 14, 10)); tp.push(sphere(1.5, x, y + 4.6, z + 0.3, 0xe8ffd8, 14, 10));
      for (const s of [1, -1]) tp.push(K.paint(new THREE.ConeGeometry(0.6, 1.3, 6).translate(x + s * 0.9, y + 6.1, z + 0.3), 0xe8ffd8));
      tp.push(K.paint(new THREE.TorusGeometry(1.6, 0.35, 6, 12, Math.PI).rotateY(Math.PI / 2).translate(x, y + 1.6, z - 2.0), 0xe8ffd8));
      for (const g of tp) B.add('hedge', K.worldUV(g, 3));
      B.add('props', cyl(2.6, 2.8, 0.6, 16, x, y - 0.1, z, 0xd8cfc2));
    }
    const ft = findClear(80, -100, 5);
    if (ft) {
      const [x, z] = ft, y = gY(x, z);
      B.add('stone', cyl(4.4, 4.6, 0.9, 24, x, y - 0.2, z, 0xf2e9dc, 2));
      B.add('stone', cyl(0.6, 0.8, 2.6, 10, x, y, z, 0xf2e9dc, 2));
      B.add('stone', cyl(1.8, 1.2, 0.4, 16, x, y + 2.5, z, 0xf2e9dc, 2));
      const water = K.paint(new THREE.CircleGeometry(4.0, 24).rotateX(-Math.PI / 2).translate(x, y + 0.62, z), 0x7fd4ff); B.add('glow', water);
      fountainAt.push({ x, y: y + 2.9, z });
    }
    // flower beds dotted round the gardens
    const flowers = [];
    for (let i = 0; i < 260; i++) {
      const x = W(30 + rng() * 190), z = -205 + rng() * 170;
      if (!isClear(x, z, 0.5, 0.6)) continue;
      flowers.push({ x, y: gY(x, z) + 0.2, z, s: 0.8 + rng() * 0.6, c: FAMILY[i % FAMILY.length] });
    }
    const fg = K.merge([K.paint(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 3).translate(0, 0.05, 0), 0x3f8f3a), K.paint(new THREE.IcosahedronGeometry(0.22, 0).translate(0, 0.35, 0), 0xffffff)]);
    const fim = K.instanced(fg, vmat, flowers, 'flowers'); if (fim) { const c = new THREE.Color(); flowers.forEach((f, i) => fim.setColorAt(i, c.set(f.c))); group.add(fim); }
  }

  /* =============================================================== the inner ward: trees, hay, a trampoline */
  {
    const trees = [];
    const tryTree = (x, z, s = 1) => { if (!isClear(x, z, 3 * s, 1.5)) return; if (Math.hypot(-x - 78, z - 97) < 26) return; if (-x > -18 && -x < 184 && z > 4 && z < 170 && !(z > 12 && z < 150 && -x > 25 && -x < 160)) return; trees.push({ x, y: gY(x, z) - 0.2, z, s: s * (0.8 + rng() * 0.5), yaw: rng() * TAU }); };
    // inside the ward (between the hall, the tower and the east wall)
    for (let i = 0; i < 70; i++) tryTree(W(25 + rng() * 135), 14 + rng() * 132, 0.9);
    // outside the castle: a forest ring beyond the moat
    const b = ctx.bounds;
    for (let i = 0; i < 520; i++) {
      const x = b.x0 + rng() * (b.x1 - b.x0), z = b.z0 + rng() * (b.z1 - b.z0);
      const mx = -x;
      if (mx > -60 && mx < 210 && z > -35 && z < 200) continue;               // the castle + moat
      if (mx > 20 && mx < 215 && z > -210 && z < -35) continue;               // the maze garden
      if (Math.abs(mx) < 30 && z > -170 && z < -35) continue;                 // forecourt
      tryTree(x, z, 1.2);
    }
    const trunk = K.merge([K.cyl(0.35, 0.5, 3.2, 7, 0, 0, 0, 0x8a5c30)]);
    const crown = K.merge([K.paint(new THREE.IcosahedronGeometry(2.6, 1).translate(0, 4.8, 0), 0x3f9a4a), K.paint(new THREE.IcosahedronGeometry(1.9, 0).translate(0.8, 6.6, 0.3), 0x4fae55), K.paint(new THREE.IcosahedronGeometry(1.5, 0).translate(-0.9, 6.2, -0.5), 0x58b85a)]);
    const t1 = K.instanced(trunk, vmat, trees, 'trunks'), t2 = K.instanced(crown, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), trees, 'crowns', { cast: true });
    if (t1) group.add(t1); if (t2) group.add(t2);
  }

  /* =============================================================== far land ring + hills (the terrain grid ends; this hides the edge) */
  {
    const b = ctx.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const rIn = Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2 - 20;
    const ring = new THREE.RingGeometry(rIn, 2600, 64, 3); ring.rotateX(-Math.PI / 2); ring.translate(cx, -0.55, cz);
    const uv = ring.attributes.uv, p = ring.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 9, p.getZ(i) / 9);
    const grass = loadTex('grass', null);
    const m = new THREE.Mesh(K.paint(ring, 0xd8f0b8), new THREE.MeshLambertMaterial({ map: grass, vertexColors: true }));
    m.name = 'scenery:farland'; m.receiveShadow = false; group.add(m);
    // rolling hills on the horizon
    const hills = [];
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * TAU + rng() * 0.2, R = 900 + rng() * 350, r = 140 + rng() * 160, hgt = 60 + rng() * 90;
      const g = new THREE.SphereGeometry(1, 14, 6, 0, TAU, 0, Math.PI / 2).scale(r, hgt, r * 0.8).rotateY(rng() * TAU).translate(cx + Math.cos(a) * R, -2, cz + Math.sin(a) * R);
      hills.push(K.paint(g, i % 2 ? 0x5f9a58 : 0x6aa862, 0x8fc27a));
    }
    const hm = new THREE.Mesh(K.merge(hills), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    hm.name = 'scenery:hills'; group.add(hm);
  }

  /* =============================================================== chevron signs before the sharp corners */
  {
    const done = [];
    for (let k = 0; k < n; k++) {
      const s = k * track.ds, turn = track.turnAhead(s, 0, 30);
      if (Math.abs(turn) < 1.0) continue;
      if (done.some(d => Math.abs(track.dS(d, s)) < 70)) continue;
      done.push(s);
      const dir = Math.sign(turn);                            // +1 = left turn → signs on the right (outside)
      for (let j = 0; j < 3; j++) {
        const kk = track.idx(s + 16 + j * 7);
        if (isGap(kk) || look(kk) === 'hall' && j > 0) continue;
        const side = -dir, b = bLat(kk, side);
        const st = styleOf(kk, side);
        const extra = st === 'hedge' ? 1.7 : st === 'parapet' ? 1.3 : st === 'low' ? 1.0 : st === 'tables' ? 2.6 : 0.6;
        const p = P(kk, b + side * extra, 0);
        const back = track.pointAt(s - 10, 0), yaw = Math.atan2(back.x - p[0], back.z - p[2]);
        const y = p[1] + (st === 'hedge' ? 2.9 : st === 'parapet' ? 2.6 : 2.2);
        B.add('props', box(2.9, 1.6, 0.18, p[0] - Math.sin(yaw) * 0.12, y - 0.8, p[2] - Math.cos(yaw) * 0.12, yaw, 0x8a6a4a));
        B.add('atlas', quad(2.7, 1.35, p[0], y, p[2], yaw, cells.chevron, 0xffffff, dir > 0));
        if (st !== 'parapet' && st !== 'tables') B.add('props', box(0.2, y - 0.8 - p[1], 0.2, p[0] - Math.sin(yaw) * 0.3, p[1], p[2] - Math.cos(yaw) * 0.3, yaw, 0x8a6a4a));
      }
    }
  }

  /* =============================================================== flags (instanced, they wave) */
  let flagMesh = null;
  if (flags.length) {
    const fg = new THREE.PlaneGeometry(3.2, 1.9, 6, 1).translate(1.6, 0, 0);
    flagMesh = K.instanced(fg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), flags.map(f => ({ x: f.x, y: f.y, z: f.z, yaw: rng() * TAU })), 'flags');
    const c = new THREE.Color(); flags.forEach((f, i) => flagMesh.setColorAt(i, c.set(f.c)));
    group.add(flagMesh);
    const base = fg.attributes.position.array.slice();
    updaters.push((dt, t) => {
      const p = flagMesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = base[i * 3]; p.setZ(i, Math.sin(t * 4 - x * 1.6) * 0.18 * x); }
      p.needsUpdate = true;
    });
  }

  /* =============================================================== flames (torches + candles), BBQ smoke, fountain spray */
  {
    const fg = new THREE.ConeGeometry(0.26, 0.8, 7).translate(0, 0.35, 0);
    K.paint(fg, 0xffc03a, 0xff6a1a);
    const inner = new THREE.ConeGeometry(0.14, 0.5, 6).translate(0, 0.25, 0); K.paint(inner, 0xfff4b0);
    const g = K.merge([fg, inner]);
    const fm = K.instanced(g, glowMat, flames, 'flames');
    if (fm) {
      group.add(fm); fm.frustumCulled = false;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      updaters.push((dt, t) => {
        flames.forEach((f, i) => { const k = 1 + Math.sin(t * 13 + i * 1.7) * 0.12 + Math.sin(t * 7.3 + i) * 0.08; sc.set(f.s * (2 - k) * 0.9, f.s * k, f.s * (2 - k) * 0.9); p.set(f.x, f.y, f.z); fm.setMatrixAt(i, m4.compose(p, q, sc)); });
        fm.instanceMatrix.needsUpdate = true;
      });
    }
    // BBQ smoke + fountain spray: little puffs that rise and fade (one instanced mesh)
    const puffs = [];
    for (const s of smokeAt) for (let i = 0; i < 8; i++) puffs.push({ ...s, kind: 0, ph: i / 8 });
    for (const s of fountainAt) for (let i = 0; i < 10; i++) puffs.push({ ...s, kind: 1, ph: i / 10, a: i / 10 * TAU });
    if (puffs.length) {
      const pg = K.paint(new THREE.IcosahedronGeometry(0.45, 0), 0xffffff);
      const pm = K.instanced(pg, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false }), puffs, 'puffs');
      const c = new THREE.Color(); puffs.forEach((p, i) => pm.setColorAt(i, c.set(p.kind ? 0xbfefff : 0xd8d8e0)));
      group.add(pm); pm.frustumCulled = false;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      updaters.push((dt, t) => {
        puffs.forEach((f, i) => {
          const u = (t * 0.35 + f.ph) % 1;
          if (f.kind === 0) { p.set(f.x + Math.sin(u * 5 + i) * 0.4, f.y + u * 5, f.z + u * 1.2); sc.setScalar(0.5 + u * 1.6); }
          else { p.set(f.x + Math.cos(f.a) * u * 3, f.y + Math.sin(u * Math.PI) * 1.4 - u * 1.8, f.z + Math.sin(f.a) * u * 3); sc.setScalar(0.35 * (1 - u) + 0.1); }
          pm.setMatrixAt(i, m4.compose(p, q, sc));
        });
        pm.instanceMatrix.needsUpdate = true;
      });
    }
  }

  /* =============================================================== sky: texture (if the art is there), stars, the moon */
  const sky = group.userData.sky;
  {
    const skyTex = loadTex('sky_castle', () => { const c = document.createElement('canvas'); c.width = c.height = 4; return c; }, {
      onload: (tex) => {
        tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
        if (sky) sky.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false, color: 0xe8e0f0 });
      },
    });
    void skyTex;
    if (sky) {
      // stars in the upper sky (they twinkle by the sky's own clock)
      const pts = [], cols = [];
      for (let i = 0; i < 900; i++) {
        const a = rng() * TAU, el = 0.25 + Math.pow(rng(), 0.6) * 1.2, r = 1500;
        pts.push(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r);
        const w = 0.7 + rng() * 0.3; cols.push(w, w, 0.85 + rng() * 0.15);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const sm = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false });
      const stars = new THREE.Points(g, sm); stars.name = 'scenery:stars'; stars.frustumCulled = false; stars.renderOrder = -0.9;
      sky.add(stars);
      updaters.push((dt, t) => { sm.opacity = 0.75 + Math.sin(t * 2.1) * 0.15; });
      // the big friendly moon, low over the castle ahead of the start line
      const dir = new THREE.Vector3(-0.25, 0.3, 1).normalize();
      const moon = new THREE.Mesh(quad(300, 300, 0, 0, 0, 0, cells.moon, 0xffffff), moonMat);
      moon.position.copy(dir.clone().multiplyScalar(1400)); moon.lookAt(0, 0, 0);
      moon.name = 'scenery:moon'; moon.renderOrder = -0.8; moon.frustumCulled = false;
      sky.add(moon);
    }
  }

  // the engine's gap faces (ramp lip / landing bank) in castle stone
  { const gf = group.getObjectByName('gapfaces'); if (gf) gf.material.color.set(0xcfc4b4); }

  /* =============================================================== build the merged meshes */
  B.mesh('stone', stoneMat, { cast: true });
  B.mesh('stoneHall', stoneMat, { cast: false });
  if (merlonList2.length) { const mg = K.worldUV(K.paint(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), 0xf6eee2), 1); const im = K.instanced(mg, stoneMat, merlonList2, 'merlons2', { cast: true }); if (im) group.add(im); }
  B.mesh('wood', woodMat, { cast: true });
  B.mesh('planks', plankMat);
  B.mesh('hedge', hedgeMat, { cast: true });
  B.mesh('floor', floorMat);
  B.mesh('ceiling', woodMat, { cast: false });
  B.mesh('roof', vmat, { cast: false });
  B.mesh('props', vmat, { cast: true });
  B.mesh('glow', glowMat);
  B.mesh('atlas', atlasMat);
  B.mesh('bunting', new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));

  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}

/* =============================================================== canvas art */
function drawKingDad(c, w, h, pose) {
  // background + gold frame inset
  const bg = ['#6fb8ff', '#ffb0c8', '#b8f0c8'][pose];
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 10; i++) { c.beginPath(); c.arc(w * (i % 3) / 2.2 + 20, h * Math.floor(i / 3) / 3 + 30, 18, 0, 7); c.fill(); }
  const cx = w / 2, cy = h * 0.46;
  // gown + shoulders
  c.fillStyle = '#2f6fd0'; c.beginPath(); c.ellipse(cx, h * 0.98, w * 0.46, h * 0.3, 0, Math.PI, 0); c.fill();
  c.fillStyle = '#1e4d94'; c.fillRect(cx - w * 0.2, h * 0.72, w * 0.4, 16);
  c.fillStyle = '#ffd23f'; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(cx, h * 0.8 + i * 22, 6, 0, 7); c.fill(); }
  // head
  c.fillStyle = '#f0c9a0'; c.beginPath(); c.ellipse(cx, cy, w * 0.26, h * 0.2, 0, 0, 7); c.fill();
  c.beginPath(); c.ellipse(cx - w * 0.26, cy + 4, 14, 20, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(cx + w * 0.26, cy + 4, 14, 20, 0, 0, 7); c.fill();
  // beard (short, black)
  c.fillStyle = '#241a14'; c.beginPath(); c.moveTo(cx - w * 0.25, cy + 6); c.quadraticCurveTo(cx - w * 0.24, cy + h * 0.2, cx, cy + h * 0.22); c.quadraticCurveTo(cx + w * 0.24, cy + h * 0.2, cx + w * 0.25, cy + 6); c.quadraticCurveTo(cx, cy + h * 0.1, cx - w * 0.25, cy + 6); c.fill();
  // mouth (a big smile), nose, eyes, brows
  c.fillStyle = '#fff'; c.beginPath(); c.ellipse(cx, cy + h * 0.1, 22, 11, 0, 0, Math.PI); c.fill();
  c.fillStyle = '#e8a880'; c.beginPath(); c.ellipse(cx, cy + 10, 12, 15, 0, 0, 7); c.fill();
  for (const s of [-1, 1]) {
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(cx + s * 28, cy - 10, 13, 15, 0, 0, 7); c.fill();
    c.fillStyle = '#2d2a3a'; c.beginPath(); c.arc(cx + s * 28 + (pose === 1 ? s * 3 : 2), cy - 8, 7, 0, 7); c.fill();
    c.strokeStyle = '#241a14'; c.lineWidth = 6; c.beginPath(); c.moveTo(cx + s * 16, cy - 30 - (pose === 2 ? 6 : 0)); c.lineTo(cx + s * 42, cy - 34 + (pose === 2 ? 4 : 0)); c.stroke();
  }
  // shiny bald head
  c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(cx - 18, cy - h * 0.13, 16, 7, -0.3, 0, 7); c.fill();
  // crown
  c.fillStyle = '#ffd23f'; c.beginPath();
  const ct = cy - h * 0.2, cw = w * 0.34;
  c.moveTo(cx - cw / 2, ct + 8); c.lineTo(cx - cw / 2, ct - 30); c.lineTo(cx - cw / 4, ct - 12); c.lineTo(cx, ct - 40); c.lineTo(cx + cw / 4, ct - 12); c.lineTo(cx + cw / 2, ct - 30); c.lineTo(cx + cw / 2, ct + 8); c.closePath(); c.fill();
  c.fillStyle = '#e0203a'; c.beginPath(); c.arc(cx, ct - 4, 7, 0, 7); c.fill();
  c.fillStyle = '#6fb8ff'; c.beginPath(); c.arc(cx - cw / 3.2, ct - 2, 5, 0, 7); c.fill(); c.beginPath(); c.arc(cx + cw / 3.2, ct - 2, 5, 0, 7); c.fill();
  // the TV remote (pose 0: raised like a sceptre; 1: pointing; 2: thumbs up + remote)
  c.save();
  const hx = pose === 1 ? cx + w * 0.3 : cx - w * 0.3, hy = pose === 0 ? h * 0.66 : h * 0.78;
  c.translate(hx, hy); c.rotate(pose === 0 ? -0.2 : pose === 1 ? -1.1 : 0.15);
  c.fillStyle = '#26272e'; c.fillRect(-11, -70, 22, 76);
  c.fillStyle = '#ff3a4a'; c.beginPath(); c.arc(0, -58, 6, 0, 7); c.fill();
  c.fillStyle = '#8ff0b4'; c.fillRect(-7, -42, 5, 5); c.fillStyle = '#ffd23f'; c.fillRect(2, -42, 5, 5); c.fillStyle = '#6fb8ff'; c.fillRect(-7, -32, 5, 5); c.fillRect(2, -32, 5, 5);
  c.fillStyle = '#f0c9a0'; c.beginPath(); c.arc(0, 4, 14, 0, 7); c.fill();
  c.restore();
  if (pose === 2) { c.fillStyle = '#f0c9a0'; c.beginPath(); c.arc(cx + w * 0.3, h * 0.78, 14, 0, 7); c.fill(); c.fillRect(cx + w * 0.3 - 5, h * 0.78 - 34, 10, 26); }
  // frame
  c.strokeStyle = '#b8860b'; c.lineWidth = 16; c.strokeRect(8, 8, w - 16, h - 16);
  c.strokeStyle = '#ffd23f'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16);
}
function drawBanner(c, w, h, bg, fg, emblem) {
  c.fillStyle = bg; c.beginPath(); c.moveTo(0, 0); c.lineTo(w, 0); c.lineTo(w, h); c.lineTo(w / 2, h - 50); c.lineTo(0, h); c.closePath(); c.fill();
  c.fillStyle = fg; c.fillRect(0, 0, w, 16); c.fillRect(8, 16, 8, h - 60); c.fillRect(w - 16, 16, 8, h - 60);
  const cx = w / 2, cy = h * 0.42;
  c.fillStyle = fg;
  if (emblem === 'crown') { c.beginPath(); c.moveTo(cx - 45, cy + 30); c.lineTo(cx - 45, cy - 20); c.lineTo(cx - 22, cy); c.lineTo(cx, cy - 36); c.lineTo(cx + 22, cy); c.lineTo(cx + 45, cy - 20); c.lineTo(cx + 45, cy + 30); c.closePath(); c.fill(); }
  else if (emblem === 'remote') { c.fillRect(cx - 18, cy - 60, 36, 120); c.fillStyle = bg; c.beginPath(); c.arc(cx, cy - 40, 9, 0, 7); c.fill(); for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) c.fillRect(cx - 12 + j * 16, cy - 16 + i * 18, 8, 8); }
  else { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 22 : 52; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } c.closePath(); c.fill(); }
}
function drawSign(c, w, h, lines, bg, fg, big = false) {
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.strokeStyle = fg; c.lineWidth = 12; c.strokeRect(8, 8, w - 16, h - 16);
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
  const fs = Math.min(big ? 110 : 72, (h - 30) / lines.length * 0.86);
  c.font = `900 ${fs}px system-ui, sans-serif`;
  lines.forEach((l, i) => { let f = fs; c.font = `900 ${f}px system-ui, sans-serif`; while (c.measureText(l).width > w - 50 && f > 10) { f -= 2; c.font = `900 ${f}px system-ui, sans-serif`; } c.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * fs * 1.05 + 3); });
}
function drawChevron(c, w, h) {
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#e0332c';
  for (let i = 0; i < 3; i++) {
    const x0 = 30 + i * 105;
    c.beginPath(); c.moveTo(x0, 20); c.lineTo(x0 + 45, 20); c.lineTo(x0 + 95, h / 2); c.lineTo(x0 + 45, h - 20); c.lineTo(x0, h - 20); c.lineTo(x0 + 50, h / 2); c.closePath(); c.fill();
  }
}
function drawTV(c, w, h) {
  const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#5fb8ff'); sky.addColorStop(1, '#c8f0ff'); c.fillStyle = sky; c.fillRect(0, 0, w, h);
  c.fillStyle = '#7cc35a'; c.fillRect(0, h * 0.55, w, h); c.fillStyle = '#9a9aa2';
  c.beginPath(); c.moveTo(w * 0.42, h * 0.55); c.lineTo(w * 0.58, h * 0.55); c.lineTo(w * 0.95, h); c.lineTo(w * 0.05, h); c.closePath(); c.fill();
  // a blue kart with a star
  c.fillStyle = '#2f6fdc'; c.fillRect(w * 0.4, h * 0.7, w * 0.2, h * 0.14); c.fillStyle = '#222'; c.fillRect(w * 0.37, h * 0.8, w * 0.06, h * 0.08); c.fillRect(w * 0.57, h * 0.8, w * 0.06, h * 0.08);
  c.fillStyle = '#ffd23f'; c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 9 : 20; c.lineTo(w / 2 + Math.cos(a) * r, h * 0.66 + Math.sin(a) * r); } c.closePath(); c.fill();
  c.fillStyle = '#ffffff'; c.font = '900 34px system-ui, sans-serif'; c.textAlign = 'left'; c.fillText('LAP 3/3', 14, 40);
  c.fillStyle = '#ffd23f'; c.textAlign = 'right'; c.fillText('1ST', w - 14, 40);
}
function drawMoon(c, w, h) {
  c.clearRect(0, 0, w, h);
  const r = w * 0.46, cx = w / 2, cy = h / 2;
  const glow = c.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.08); glow.addColorStop(0, 'rgba(255,250,220,.5)'); glow.addColorStop(1, 'rgba(255,250,220,0)');
  c.fillStyle = glow; c.fillRect(0, 0, w, h);
  const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r); g.addColorStop(0, '#fffbe8'); g.addColorStop(1, '#f2dfa0');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r * 0.86, 0, 7); c.fill();
  c.fillStyle = 'rgba(210,190,130,.45)'; for (const [x, y, rr] of [[-0.45, -0.35, 0.12], [0.4, 0.45, 0.1], [0.5, -0.1, 0.07], [-0.3, 0.5, 0.08]]) { c.beginPath(); c.arc(cx + x * r, cy + y * r, rr * r, 0, 7); c.fill(); }
  // sleepy happy face
  c.strokeStyle = '#8a6a3a'; c.lineWidth = r * 0.06; c.lineCap = 'round';
  for (const s of [-1, 1]) { c.beginPath(); c.arc(cx + s * r * 0.3, cy - r * 0.08, r * 0.12, Math.PI * 0.1, Math.PI * 0.9); c.stroke(); }
  c.beginPath(); c.arc(cx, cy + r * 0.12, r * 0.3, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
  c.fillStyle = 'rgba(255,140,160,.5)'; for (const s of [-1, 1]) { c.beginPath(); c.ellipse(cx + s * r * 0.5, cy + r * 0.18, r * 0.12, r * 0.07, 0, 0, 7); c.fill(); }
}
