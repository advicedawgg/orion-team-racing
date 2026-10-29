// scenery/bedroom.js — Toy Box Turbo. Contract: DESIGN.md "Scenery hook"; helpers: scenery/propkit.js.
//
// A giant kid's bedroom at night-light time, racing tiny. The room itself (wallpapered walls, a dark-blue
// ceiling covered in glow-in-the-dark stars, the window with the real sky dome showing through it, curtains,
// skirting, door, posters, the moon night-light), the DESK (legs, drawers, the warm desk lamp, a pencil cup,
// giant crayons, building bricks, a drawing), the BOOK RAMP (stacked books under the road), the BED (legs,
// frame, mattress, a puffy patchwork quilt hanging down the sides with gaps where the shortcut goes in and out,
// headboard, pillows and SOOTIE curled up asleep on one, breathing), the yellow SLIDE and its tower, the PLAY
// RUG (a little town map), the toy box, a teddy, block towers, balls, toy cars — and UNDER THE BED: a darker
// space (a shadow decal), the slats overhead with a few glow stars stuck on them, a toy torch lying on the
// carpet shining on the LOST SOCKS pile (glow-in-the-dark socks), lost toys and fluffy dust bunnies.
// ~20 draw calls; nothing adds a light — what glows is MeshBasic (toneMapped:false). Map coords (mx east,
// z north) as in tracks/bedroom.js: world x = −mx.
import { makePropKit } from './propkit.js';

const TAU = Math.PI * 2;
// the room, the desk and the bed (map coords; keep in step with tracks/bedroom.js)
export const ROOM = { x0: -180, x1: 180, z0: -150, z1: 160, h: 110 };
export const DESK = { x0: -58, x1: 9.5, z0: 85, z1: 160, top: 12.9 };
export const BED = { x0: 20, x1: 120, z0: -55, z1: 160, slats: 9.0, top: 10.72, gapZ: [4, 31] };
const FAMILY = [0x2f6fdc, 0xffd23f, 0xe8443a, 0xff6fae, 0x8ff0b4, 0x9b59d0, 0x5cc850, 0xff9a3a];

export default function build(ctx) {
  const { THREE, group, track, rng, loadTex } = ctx;
  const K = makePropKit(ctx);
  const { paint, paintBy, merge, place, instanced, mesh, vmat, vmat2 } = K;
  const updaters = [], lostToys = [];
  const pick = a => a[(rng() * a.length) | 0];
  const B = { misc: [], wood: [], quilt: [], wall: [], glow: [], poster: [] };
  // geometry helpers in MAP coords
  const box = (w, h, d, mx, y, z, c, ry = 0) => paint(place(new THREE.BoxGeometry(w, h, d), { x: -mx, y: y + h / 2, z, ry }), c);
  const boxAB = (ax, bx, y0, y1, az, bz, c) => box(Math.abs(bx - ax), y1 - y0, Math.abs(bz - az), (ax + bx) / 2, y0, (az + bz) / 2, c);
  const sph = (r, mx, y, z, c, sx = 1, sy = 1, sz = 1, seg = 12) => paint(place(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), { x: -mx, y, z, sx, sy, sz }), c);
  const cyl = (rt, rb, h, mx, y, z, c, seg = 12, rx = 0, rz = 0, ry = 0) => paint(place(new THREE.CylinderGeometry(rt, rb, h, seg), { x: -mx, y, z, rx, rz, ry }), c);
  const worldUV = (g, s) => { const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)); let u, v; if (ay > 0.7) { u = p.getX(i); v = p.getZ(i); } else if (ax > Math.abs(n.getZ(i))) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); } uv[i * 2] = u / s; uv[i * 2 + 1] = v / s; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g; };
  const inBox = (mx, z, R, m = 0) => mx > R.x0 - m && mx < R.x1 + m && z > R.z0 - m && z < R.z1 + m;
  const SLIDE_TOWER = { x0: 120, x1: 141, z0: 96, z1: 130 };
  const blocked = (mx, z, m = 0) => inBox(mx, z, DESK, m) || inBox(mx, z, BED, m) || inBox(mx, z, SLIDE_TOWER, m) || !inBox(mx, z, ROOM, -6);

  // the hidden water plane (the gap's helper floor) and the gap faces: the desk and the mattress are their own sides
  { const w = group.getObjectByName('water'); if (w) w.visible = false; const gf = group.getObjectByName('gapfaces'); if (gf) gf.visible = false; }
  // the terrain dips into a pool under a jump gap (it expects water there): flatten the carpet back
  {
    const t = group.getObjectByName('terrain');
    if (t) { const p = t.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.6) p.setY(i, -0.02); p.needsUpdate = true; t.geometry.computeVertexNormals(); }
  }

  /* =============================================================== the room */
  const R = ROOM, H = R.h;
  const WIN = { x0: -48, x1: -2, y0: 34, y1: 84 };          // the window, north wall (map x)
  {
    // walls (inward faces), built as quads; the north wall leaves the window open (the sky dome shows through)
    const quad = (ax, az, bx, bz, y0, y1) => {      // a vertical quad from (ax,az) to (bx,bz), facing its left
      const g = new THREE.BufferGeometry(), pos = [-ax, y0, az, -bx, y0, bz, -bx, y1, bz, -ax, y1, az];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const la = Math.hypot(bx - ax, bz - az);
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, y0 / 40, la / 40, y0 / 40, la / 40, y1 / 40, 0, y1 / 40], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals(); return paint(g, 0xffffff);
    };
    const W = B.wall;
    W.push(quad(R.x1, R.z0, R.x0, R.z0, 0, H));                              // south
    W.push(quad(R.x0, R.z0, R.x0, R.z1, 0, H));                              // west
    W.push(quad(R.x1, R.z1, R.x1, R.z0, 0, H));                              // east
    W.push(quad(R.x0, R.z1, WIN.x0, R.z1, 0, H));                            // north, round the window
    W.push(quad(WIN.x1, R.z1, R.x1, R.z1, 0, H));
    W.push(quad(WIN.x0, R.z1, WIN.x1, R.z1, 0, WIN.y0));
    W.push(quad(WIN.x0, R.z1, WIN.x1, R.z1, WIN.y1, H));
    // the quads above face their left in map space — world x is mirrored, so flip every winding
    for (const g of W) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
    // ceiling (dark blue night), skirting boards, window frame + sill, curtains, the door
    const ceil = new THREE.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0); ceil.rotateX(Math.PI / 2); ceil.translate(0, H, (R.z0 + R.z1) / 2);
    B.glow.push(paint(ceil, 0x2c3474));             // unlit: a lambert ceiling only sees the floor's hemi light (black)
    for (const [ax, az, bx, bz] of [[R.x0, R.z0 + 0.6, R.x1, R.z0 + 0.6], [R.x0 + 0.6, R.z0, R.x0 + 0.6, R.z1], [R.x1 - 0.6, R.z0, R.x1 - 0.6, R.z1], [R.x0, R.z1 - 0.6, R.x1, R.z1 - 0.6]])
      B.misc.push(boxAB(Math.min(ax, bx) - (ax === bx ? 0.6 : 0), Math.max(ax, bx) + (ax === bx ? 0.6 : 0), 0, 4, Math.min(az, bz) - (az === bz ? 0.6 : 0), Math.max(az, bz) + (az === bz ? 0.6 : 0), 0xf4efe6));
    const zW = R.z1;
    B.misc.push(boxAB(WIN.x0 - 2, WIN.x1 + 2, WIN.y0 - 2.5, WIN.y0, zW - 4, zW, 0xf4efe6));            // sill
    B.misc.push(boxAB(WIN.x0 - 2, WIN.x1 + 2, WIN.y1, WIN.y1 + 2, zW - 1.2, zW, 0xf4efe6));
    B.misc.push(boxAB(WIN.x0 - 2, WIN.x0, WIN.y0, WIN.y1, zW - 1.2, zW, 0xf4efe6));
    B.misc.push(boxAB(WIN.x1, WIN.x1 + 2, WIN.y0, WIN.y1, zW - 1.2, zW, 0xf4efe6));
    B.misc.push(boxAB((WIN.x0 + WIN.x1) / 2 - 0.6, (WIN.x0 + WIN.x1) / 2 + 0.6, WIN.y0, WIN.y1, zW - 1, zW, 0xf4efe6));   // the window bars
    B.misc.push(boxAB(WIN.x0, WIN.x1, (WIN.y0 + WIN.y1) / 2 - 0.6, (WIN.y0 + WIN.y1) / 2 + 0.6, zW - 1, zW, 0xf4efe6));
    for (const [cx, sd] of [[WIN.x0 - 7, -1], [WIN.x1 + 7, 1]]) {                       // curtains: wavy pink drapes
      const g = new THREE.PlaneGeometry(12, WIN.y1 + 8 - 6, 16, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 1.6) * 0.8); }
      g.translate(-cx, (WIN.y1 + 8 + 6) / 2, zW - 2.5); g.computeVertexNormals();
      B.misc.push(paintBy(g, (x, y) => (y > WIN.y1 + 4 ? 0xff8ab8 : 0xffa8c8)));
      B.misc.push(cyl(0.6, 0.6, 0.1, cx, WIN.y1 + 8, zW - 2.5, 0xffd23f));
    }
    B.misc.push(cyl(0.5, 0.5, WIN.x1 - WIN.x0 + 34, (WIN.x0 + WIN.x1) / 2, WIN.y1 + 8.5, zW - 2.5, 0xffd23f, 8, 0, Math.PI / 2));   // curtain rail
    // the door (south wall) with a round knob
    B.misc.push(boxAB(70, 115, 0, 92, R.z0, R.z0 + 1.2, 0xf6e7c8));
    B.misc.push(boxAB(73, 112, 4, 88, R.z0 + 1.2, R.z0 + 1.6, 0xeed9b0));
    B.misc.push(sph(2, 76, 46, R.z0 + 3, 0xffd23f));
  }

  // wallpaper: soft blue with stripes, little moons and stars (canvas, tiles every 40 m)
  const wallTex = K.canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#8fa8e8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#9cb4ee' : '#86a0e2'; g.fillRect(i * 64, 0, 64, h); }
    const star = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = 64 + i * 128 + (j % 2) * 64, y = 64 + j * 128;
      if ((i + j) % 3 === 0) { g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(x, y, 16, 0, TAU); g.fill(); g.fillStyle = '#8fa8e8'; g.beginPath(); g.arc(x + 8, y - 5, 14, 0, TAU); g.fill(); }
      else star(x, y, 14, (i + j) % 2 ? '#ffffff' : '#ffe680');
    }
  }, { repeat: null });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;

  // glow-in-the-dark stars: ceiling, upper walls, and a few on the bed slats (seen from under the bed)
  const starGeo = (() => { const s = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.42 : 1; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (k) s.lineTo(x, y); else s.moveTo(x, y); } return new THREE.ShapeGeometry(s); })();
  const glowStars = [];
  for (let i = 0; i < 150; i++) {
    const mx = R.x0 + 10 + rng() * (R.x1 - R.x0 - 20), z = R.z0 + 10 + rng() * (R.z1 - R.z0 - 20);
    glowStars.push({ x: -mx, y: H - 0.3, z, rx: -Math.PI / 2, rz: rng() * TAU, s: 2.5 + rng() * 4, color: pick([0xd8ff9a, 0xc8ffb8, 0xfff6a8, 0xb8f4ff]) });
  }
  for (let i = 0; i < 60; i++) {                              // upper walls
    const side = i % 4, t = rng(), y = 62 + rng() * (H - 70), s = 2 + rng() * 3, c = pick([0xd8ff9a, 0xfff6a8, 0xc8ffb8]);
    if (side === 0) glowStars.push({ x: -(R.x0 + t * (R.x1 - R.x0)), y, z: R.z0 + 0.3, s, rz: rng() * TAU, color: c });
    else if (side === 1) glowStars.push({ x: -(R.x0 + t * (R.x1 - R.x0)), y, z: R.z1 - 0.3, ry: Math.PI, s, rz: rng() * TAU, color: c });
    else if (side === 2) glowStars.push({ x: -(R.x0 + 0.3), y, z: R.z0 + t * (R.z1 - R.z0), ry: -Math.PI / 2, s, rz: rng() * TAU, color: c });
    else glowStars.push({ x: -(R.x1 - 0.3), y, z: R.z0 + t * (R.z1 - R.z0), ry: Math.PI / 2, s, rz: rng() * TAU, color: c });
  }
  for (let i = 0; i < 14; i++) glowStars.push({ x: -(BED.x0 + 12 + rng() * (BED.x1 - BED.x0 - 24)), y: BED.slats - 0.25, z: -45 + rng() * 80, rx: Math.PI / 2, rz: rng() * TAU, s: 1.2 + rng() * 1.2, color: pick([0xd8ff9a, 0xfff6a8, 0xffb8e8]) });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
  const starMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });
  instanced(starGeo, starMat, glowStars, { name: 'glow-stars' });

  // the moon night-light, plugged in low on the west wall by the start
  B.glow.push(paint(place(new THREE.CircleGeometry(4.5, 20), { x: -(R.x0 + 0.5), y: 9, z: -60, ry: -Math.PI / 2 }), 0xfff3b0));
  B.misc.push(boxAB(R.x0, R.x0 + 1.2, 6, 12, -64, -56, 0xf4efe6));

  // posters (one canvas atlas): a rocket, a crayon Sootie, a rainbow, the star — south and west walls
  const PW = 1024, PH = 512;
  const posterTex = K.canvasTex(PW, PH, (g) => {
    const cell = (i, bg, draw) => { const x = (i % 4) * 256, y = Math.floor(i / 4) * 256; g.save(); g.translate(x, y); g.fillStyle = '#fffaf0'; g.fillRect(0, 0, 256, 256); g.fillStyle = bg; g.fillRect(12, 12, 232, 232); draw(g); g.restore(); };
    cell(0, '#2a3a8a', c => { c.fillStyle = '#fff'; for (let i = 0; i < 20; i++) c.fillRect(20 + (i * 53) % 210, 20 + (i * 97) % 210, 3, 3); c.fillStyle = '#e8443a'; c.beginPath(); c.moveTo(128, 40); c.quadraticCurveTo(170, 90, 160, 170); c.lineTo(96, 170); c.quadraticCurveTo(86, 90, 128, 40); c.fill(); c.fillStyle = '#9ad8ff'; c.beginPath(); c.arc(128, 105, 18, 0, TAU); c.fill(); c.fillStyle = '#ffd23f'; c.beginPath(); c.moveTo(100, 170); c.lineTo(128, 225); c.lineTo(156, 170); c.fill(); });
    cell(1, '#fff6d8', c => { c.fillStyle = '#3a3a44'; c.beginPath(); c.ellipse(128, 150, 70, 50, 0, 0, TAU); c.fill(); c.beginPath(); c.arc(128, 95, 42, 0, TAU); c.fill(); c.beginPath(); c.moveTo(92, 75); c.lineTo(100, 35); c.lineTo(120, 62); c.fill(); c.beginPath(); c.moveTo(164, 75); c.lineTo(156, 35); c.lineTo(136, 62); c.fill(); c.fillStyle = '#8ff0b4'; c.beginPath(); c.arc(112, 92, 8, 0, TAU); c.arc(144, 92, 8, 0, TAU); c.fill(); c.fillStyle = '#ff8ab8'; c.beginPath(); c.arc(128, 108, 5, 0, TAU); c.fill(); c.strokeStyle = '#e8443a'; c.lineWidth = 6; c.beginPath(); c.moveTo(30, 230); for (let x = 30; x < 230; x += 20) c.lineTo(x + 10, 220 + (x % 40 ? 8 : -8)); c.stroke(); });
    cell(2, '#bfe9ff', c => { ['#e8443a', '#ff9a3a', '#ffd23f', '#5cc850', '#2f6fdc', '#9b59d0'].forEach((col, i) => { c.strokeStyle = col; c.lineWidth = 14; c.beginPath(); c.arc(128, 190, 100 - i * 14, Math.PI, 0); c.stroke(); }); c.fillStyle = '#fff'; c.beginPath(); c.arc(40, 190, 22, 0, TAU); c.arc(216, 190, 22, 0, TAU); c.fill(); });
    cell(3, '#ff8ab8', c => { c.fillStyle = '#ffd23f'; c.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 40 : 95; c.lineTo(128 + Math.cos(a) * r, 135 + Math.sin(a) * r); } c.fill(); c.fillStyle = '#2d3142'; c.beginPath(); c.arc(112, 130, 7, 0, TAU); c.arc(144, 130, 7, 0, TAU); c.fill(); c.strokeStyle = '#2d3142'; c.lineWidth = 5; c.beginPath(); c.arc(128, 145, 16, 0.2, Math.PI - 0.2); c.stroke(); });
    // the play rug lives in its own canvas; cells 4..7: the drawing on the desk, a book cover, toy-box side, the clock
    cell(4, '#ffffff', c => { c.strokeStyle = '#2f6fdc'; c.lineWidth = 8; c.beginPath(); c.arc(70, 70, 30, 0, TAU); c.stroke(); c.strokeStyle = '#ffd23f'; for (let k = 0; k < 8; k++) { c.beginPath(); c.moveTo(70 + Math.cos(k) * 40, 70 + Math.sin(k) * 40); c.lineTo(70 + Math.cos(k) * 55, 70 + Math.sin(k) * 55); c.stroke(); } c.fillStyle = '#5cc850'; c.fillRect(12, 200, 232, 44); c.fillStyle = '#e8443a'; c.fillRect(120, 140, 70, 60); c.fillStyle = '#8a4a1a'; c.beginPath(); c.moveTo(110, 140); c.lineTo(155, 100); c.lineTo(200, 140); c.fill(); });
    cell(5, '#2f9f6f', c => { c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(128, 128, 60, 0, TAU); c.fill(); c.fillStyle = '#e8443a'; c.fillRect(30, 30, 196, 16); c.fillRect(30, 210, 196, 16); });
    cell(6, '#e8443a', c => { c.fillStyle = '#ffd23f'; c.fillRect(0, 100, 256, 56); for (let i = 0; i < 5; i++) { c.fillStyle = ['#2f6fdc', '#5cc850', '#ff6fae', '#fff', '#9b59d0'][i]; c.beginPath(); c.arc(28 + i * 50, 128, 16, 0, TAU); c.fill(); } });
    cell(7, '#fffaf0', c => { c.strokeStyle = '#2f6fdc'; c.lineWidth = 16; c.beginPath(); c.arc(128, 128, 100, 0, TAU); c.stroke(); c.fillStyle = '#2d3142'; for (let k = 0; k < 12; k++) c.fillRect(128 + Math.cos(k * TAU / 12) * 80 - 4, 128 + Math.sin(k * TAU / 12) * 80 - 4, 8, 8); c.lineWidth = 10; c.strokeStyle = '#e8443a'; c.beginPath(); c.moveTo(128, 128); c.lineTo(128, 70); c.moveTo(128, 128); c.lineTo(170, 128); c.stroke(); });
  });
  const cellUV = i => [(i % 4) * 0.25, 1 - (Math.floor(i / 4) + 1) * 0.5, (i % 4 + 1) * 0.25, 1 - Math.floor(i / 4) * 0.5];
  const poster = (i, w, h, mx, y, z, ry, tilt = 0) => {
    const g = new THREE.PlaneGeometry(w, h); const [u0, v0, u1, v1] = cellUV(i), uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
    if (tilt) g.rotateX(tilt);
    B.poster.push(paint(place(g, { x: -mx, y, z, ry }), 0xffffff));
  };
  poster(0, 36, 36, -120, 58, R.z0 + 0.4, 0);                 // south wall: rocket, Sootie drawing, rainbow
  poster(1, 36, 36, -30, 62, R.z0 + 0.4, 0);
  poster(2, 40, 40, 30, 55, R.z0 + 0.4, 0);
  poster(3, 34, 34, R.x0 + 0.4, 60, 40, Math.PI / 2);          // west wall: the star
  poster(2, 34, 34, R.x0 + 0.4, 58, -80, Math.PI / 2);
  poster(0, 30, 30, R.x1 - 0.4, 64, 20, -Math.PI / 2);          // east wall
  poster(7, 26, 26, R.x1 - 0.4, 70, -90, -Math.PI / 2);          // the clock
  poster(3, 30, 30, 90, 66, R.z1 - 0.4, Math.PI);              // over the bed (north wall)

  /* =============================================================== the desk */
  const D = DESK;
  {
    B.wood.push(boxAB(D.x0, D.x1, D.top - 1.6, D.top, D.z0, D.z1, 0xffffff));          // the top
    for (const [x, z] of [[D.x0 + 2, D.z0 + 2], [D.x1 - 2, D.z0 + 2], [D.x0 + 2, D.z1 - 2], [D.x1 - 2, D.z1 - 2]]) B.wood.push(boxAB(x - 1.6, x + 1.6, 0, D.top - 1.6, z - 1.6, z + 1.6, 0xe8d8c0));
    B.wood.push(boxAB(D.x0 + 4, D.x0 + 24, 2, D.top - 1.6, D.z0 + 3, D.z1 - 3, 0xf0e2c8));   // drawers
    for (const y of [3.5, 7.2]) { B.misc.push(boxAB(D.x0 + 5, D.x0 + 23, y, y + 2.8, D.z0 + 2.4, D.z0 + 3, 0xffd8a8)); B.misc.push(sph(0.6, D.x0 + 14, y + 1.4, D.z0 + 2.2, 0xe8443a)); }
    const top = D.top;
    // the desk lamp (warm): a heavy round foot, a bent arm, a tilted shade, the glowing bulb
    const L = { mx: -38, z: 150 };
    B.misc.push(cyl(4, 4.5, 1.2, L.mx, top + 0.6, L.z, 0x2f6fdc, 16));
    B.misc.push(cyl(0.6, 0.6, 16, L.mx, top + 8.5, L.z, 0x2f6fdc, 8));
    B.misc.push(cyl(0.6, 0.6, 14, L.mx + 4.5, top + 18.5, L.z - 4, 0x2f6fdc, 8, -0.75, 0.3));
    B.misc.push(paint(place(new THREE.ConeGeometry(5.5, 6, 16, 1, true), { x: -(L.mx + 9), y: top + 21.5, z: L.z - 9.5, rx: -0.5 }), 0xffd23f));
    B.glow.push(sph(2.6, L.mx + 9, top + 19.2, L.z - 10.8, 0xfff2c8, 1, 1, 1, 12));
    // a soft warm pool of light on the desk under it
    {
      const g = new THREE.CircleGeometry(14, 28); g.rotateX(-Math.PI / 2); g.translate(-(L.mx + 9), top + 0.05, L.z - 14);
      const t = K.canvasTex(128, 128, (c, w, h) => { const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,220,140,0.55)'); gr.addColorStop(1, 'rgba(255,220,140,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
      mesh(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), { name: 'lamp-pool', receive: false });
    }
    // a pencil cup full of crayons, the drawing, an eraser, a ruler
    B.misc.push(cyl(4, 3.6, 8, -8, top + 4, 150, 0xe8443a, 16));
    poster(4, 16, 16, 0.5, top + 0.08, 100, 0, -Math.PI / 2);   // the drawing (lies flat)
    B.misc.push(boxAB(-54, -46, top, top + 1.6, 140, 144, 0xff8ab8));
    B.misc.push(boxAB(-30, 5, top, top + 0.35, 154, 157, 0xffe680));
  }

  // crayons: standing in the cup and lying around on the desk and the carpet (instanced, per-instance colour)
  const crayonGeo = (() => { const body = new THREE.CylinderGeometry(0.55, 0.55, 7, 8); const tip = new THREE.ConeGeometry(0.55, 1.6, 8); tip.translate(0, 4.3, 0); const band = new THREE.CylinderGeometry(0.58, 0.58, 1.2, 8); band.translate(0, -2, 0); return merge([paint(body, 0xffffff), paint(tip, 0xffffff), paint(band, 0xdddddd)]); })();
  const crayons = [];
  for (let i = 0; i < 9; i++) crayons.push({ x: 8 + Math.cos(i * 2.4) * 2.2, y: D.top + 6.5, z: 150 + Math.sin(i * 2.4) * 2.2, rx: Math.cos(i) * 0.12, rz: Math.sin(i * 1.3) * 0.12, s: 1.15, color: FAMILY[i % FAMILY.length] });
  for (const [mx, z, ry] of [[-45, 96, 0.4], [-36, 94, 1.1], [-20, 100, 2.2], [-5, 141, 0.9], [-28, 146, 2.6], [2, 92, 1.7]]) crayons.push({ x: -mx, y: D.top + 0.6, z, rz: Math.PI / 2, ry, s: 1.2, color: pick(FAMILY) });
  // building bricks (studded), on the desk and in piles on the floor
  const brickGeo = (() => { const parts = [paint(new THREE.BoxGeometry(4, 1.6, 2).translate(0, 0.8, 0), 0xffffff)]; for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) parts.push(paint(new THREE.CylinderGeometry(0.32, 0.32, 0.35, 8).translate(-1.5 + i, 1.78, -0.5 + j), 0xffffff)); return merge(parts); })();
  const bricks = [];
  const brickPile = (mx, z, y0, n, spread = 6) => { for (let i = 0; i < n; i++) { const lvl = Math.floor(i / 4); bricks.push({ x: -(mx + (rng() - 0.5) * spread), y: y0 + lvl * 1.6, z: z + (rng() - 0.5) * spread, ry: Math.floor(rng() * 4) * Math.PI / 2 + (rng() - 0.5) * 0.2, s: 1.4, color: pick(FAMILY) }); } };
  brickPile(-48, 92, D.top, 10, 10); brickPile(-15, 152, D.top, 7, 8); brickPile(-30, 93, D.top, 5, 6);
  for (let k = 0; k < 4; k++) for (let i = 0; i < 8; i++) bricks.push({ x: -(-25 + k * 6), y: D.top + i * 2.24, z: 143 + (k % 2) * 0.4, ry: (i % 2) * Math.PI / 2, s: 1.4, color: FAMILY[(i + k) % FAMILY.length] });   // a brick tower behind the road

  /* =============================================================== the book ramp */
  {
    const tr = track, A0 = tr.sOf(tr.def.points.findIndex(p => p.raised === true)), A1 = A0 + 72;
    const mxAt = s => -tr.pointAt(s, 0).x, yAt = s => tr.pointAt(s, 0).y;
    const BOOK = [0x2f6fdc, 0xe8443a, 0x5cc850, 0xffd23f, 0x9b59d0, 0xff8ab8, 0x2f9f9f, 0xff9a3a];
    const T = 1.4;                                              // book thickness: the ribbon's sawtooth gap stays under the 1.1 m book fence
    for (let lv = 0; lv * T < D.top - 0.1; lv++) {
      const y0 = lv * T, y1 = y0 + T;
      let s = A0; while (s < A1 && yAt(s) < y1 - 0.05) s += 0.5;   // the layer starts where the road has climbed past its top
      let x = mxAt(s);
      while (x < D.x0 + 1) {
        const len = 11 + rng() * 7, xe = Math.min(D.x0 + 1, x + len), w = 21 + rng() * 3, dz = (rng() - 0.5) * 1.6;
        const c = pick(BOOK);
        B.misc.push(boxAB(x, xe, y0, y1 - 0.12, 125 - w / 2 + dz, 125 + w / 2 + dz, c));
        B.misc.push(boxAB(x + 0.4, xe - 0.4, y0 + 0.15, y1 - 0.25, 125 - w / 2 + dz - 0.06, 125 + w / 2 + dz + 0.06, 0xfff4dc));   // the pages
        x = xe;
      }
    }
    // a few loose books by the ramp's foot
    for (const [mx, z, ry, c] of [[-128, 142, 0.3, 0xe8443a], [-131, 140, 0.9, 0x2f6fdc], [-112, 104, 1.4, 0x5cc850]]) B.misc.push(box(20, 1.4, 15, mx, 0, z, c, ry));
  }

  /* =============================================================== the bed */
  // A round-ended bed (a toy-race bed): straight sides from the headboard down to z = FOOT.z, then a semicircular foot
  // of radius FOOT.r round (FOOT.mx, FOOT.z) — the Foot-of-the-Bed Sweeper (r 61) runs round it, and a square foot's
  // corners stuck out into that road (the drape hung across it).
  const BD = BED, FOOT = { mx: 70, z: -5, r: 50 };
  const inBed = (mx, z, m = 0) => z > FOOT.z ? (mx > BD.x0 - m && mx < BD.x1 + m && z < BD.z1 + m) : Math.hypot(mx - FOOT.mx, z - FOOT.z) < FOOT.r + m;
  {
    const legs = [[BD.x0 + 3, BD.z1 - 3], [BD.x1 - 3, BD.z1 - 3], [BD.x0 + 3, 55], [BD.x1 - 3, 55], [FOOT.mx, FOOT.z], [70, 90]];
    for (const [x, z] of legs) B.wood.push(boxAB(x - 2.5, x + 2.5, 0, BD.slats + 0.4, z - 2.5, z + 2.5, 0xe0c8a8));
    B.wood.push(boxAB(BD.x0, BD.x0 + 1.5, BD.slats - 1.6, BD.slats + 0.6, FOOT.z, BD.z1, 0xe8d0b0));           // frame rails
    B.wood.push(boxAB(BD.x1 - 1.5, BD.x1, BD.slats - 1.6, BD.slats + 0.6, FOOT.z, BD.z1, 0xe8d0b0));
    { const g = new THREE.TorusGeometry(FOOT.r - 0.8, 1.1, 6, 40, Math.PI); g.rotateX(Math.PI / 2); g.translate(-FOOT.mx, BD.slats - 0.5, FOOT.z); B.wood.push(paint(g, 0xe8d0b0)); }
    const roundSlab = (r, y0, y1, c) => { const g = new THREE.CylinderGeometry(r, r, y1 - y0, 40, 1, false, Math.PI / 2, Math.PI); g.translate(-FOOT.mx, (y0 + y1) / 2, FOOT.z); return paint(g, c); };
    B.wood.push(boxAB(BD.x0, BD.x1, BD.slats, BD.slats + 0.4, FOOT.z, BD.z1, 0x8a7a8a));                     // the slats' underside (dusky)
    B.wood.push(roundSlab(FOOT.r, BD.slats, BD.slats + 0.4, 0x8a7a8a));
    for (let z = FOOT.z - FOOT.r + 8; z < BD.z1 - 4; z += 9) { const hw = z > FOOT.z ? 48.5 : Math.sqrt(Math.max(0, (FOOT.r - 1.5) ** 2 - (z - FOOT.z) ** 2)); if (hw > 4) B.wood.push(boxAB(FOOT.mx - hw, FOOT.mx + hw, BD.slats - 0.6, BD.slats, z - 1.6, z + 1.6, 0xa89a9a)); }
    B.misc.push(boxAB(BD.x0 + 0.4, BD.x1 - 0.4, BD.slats + 0.4, BD.top - 0.25, FOOT.z, BD.z1 - 1, 0xf6f0e4));   // mattress
    B.misc.push(roundSlab(FOOT.r - 0.4, BD.slats + 0.4, BD.top - 0.25, 0xf6f0e4));
    // headboard: a tall rounded board against the north wall
    B.wood.push(boxAB(BD.x0 - 2, BD.x1 + 2, 0, 30, BD.z1 - 2, BD.z1 + 1.5, 0xf0dcc0));
    B.wood.push(cyl(2.4, 2.4, BD.x1 - BD.x0 + 6, (BD.x0 + BD.x1) / 2, 30, BD.z1 - 0.3, 0xe0c8a8, 12, 0, Math.PI / 2));
    for (const x of [BD.x0 - 2, BD.x1 + 2]) B.wood.push(cyl(2.8, 2.8, 34, x, 17, BD.z1 - 0.3, 0xe0c8a8, 12));
    for (const x of [BD.x0 - 2, BD.x1 + 2]) B.wood.push(sph(3.4, x, 34.5, BD.z1 - 0.3, 0xffd23f));
    // the quilt: a puffy top (bumps only away from the road) …
    const OV = 1.2, qx0 = BD.x0 - OV, qx1 = BD.x1 + OV, qz0 = FOOT.z - FOOT.r - OV, qz1 = BD.z1 - 6;
    {
      const g = new THREE.PlaneGeometry(qx1 - qx0, qz1 - qz0, 64, 120); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        let mx = (qx0 + qx1) / 2 + p.getX(i), z = (qz0 + qz1) / 2 + p.getZ(i);
        let edgeD = Math.min(mx - qx0, qx1 - mx);
        if (z < FOOT.z) {   // the round end: pull the grid in onto the circle
          const dx = mx - FOOT.mx, dz = z - FOOT.z, d = Math.hypot(dx, dz), R = FOOT.r + OV;
          if (d > R) { mx = FOOT.mx + dx / d * R; z = FOOT.z + dz / d * R; }
          edgeD = R - Math.min(d, R);
        }
        const e = ctx.corridorInfo(-mx, z).e;
        const puff = Math.max(0, Math.sin(mx * 0.42) * Math.sin(z * 0.42)) * 0.35 * Math.min(1, Math.max(0, (e - 1) / 3));
        p.setXYZ(i, -mx, BD.top - 0.1 + puff + (edgeD < 1.2 ? -0.4 : 0), z);
        uv.setXY(i, mx / 24, z / 24);
      }
      g.computeVertexNormals();
      B.quilt.push(paint(g, 0xffffff));
    }
    // … and the sides hanging down to near the carpet, in folds, with GAPS where the shortcut slips under
    const drape = (pts, y0, y1) => {      // pts: [[mx, z, outward nx, nz], …] along the edge
      const pos = [], uvs = [], idx = []; let along = 0;
      pts.forEach(([mx, z, nx, nz], i) => {
        if (i) along += Math.hypot(mx - pts[i - 1][0], z - pts[i - 1][1]);
        const f = 0.7 + 0.7 * Math.sin(along * 0.55);
        for (const [y, out] of [[y1, 0.2], [y0, f]]) { pos.push(-(mx + nx * out), y, z + nz * out); uvs.push(along / 24, y / 24); }
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
      return paint(g, 0xffffff);
    };
    const line = (ax, az, bx, bz, nx, nz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5), out = []; for (let i = 0; i <= n; i++) out.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n, nx, nz]); return out; };
    const [g0, g1] = BD.gapZ, yb = 1.4, yt = BD.top - 0.3;
    for (const [x, nx] of [[qx0, -1], [qx1, 1]]) {
      B.quilt.push(drape(line(x, FOOT.z, x, g0, nx, 0), yb, yt));
      B.quilt.push(drape(line(x, g0, x, g0 + 2.5, nx, 0), yt - 3.5, yt));      // the gap's edges are tucked up
      B.quilt.push(drape(line(x, g1 - 2.5, x, g1, nx, 0), yt - 3.5, yt));
      B.quilt.push(drape(line(x, g1, x, qz1, nx, 0), yb, yt));
    }
    { const R = FOOT.r + OV, pts = []; for (let i = 0; i <= 80; i++) { const a = Math.PI + i / 80 * Math.PI; pts.push([FOOT.mx + Math.cos(a) * R, FOOT.z + Math.sin(a) * R, Math.cos(a), Math.sin(a)]); } B.quilt.push(drape(pts, yb, yt)); }
    // pillows
    for (const [cx, c] of [[45, 0xfff8f0], [95, 0xdcecff]]) B.misc.push(sph(1, cx, BD.top + 2.6, 146, c, 17, 3.6, 8.5, 20));
  }

  /* =============================================================== Sootie, asleep on the pillow (breathing) */
  let sootie = null;
  {
    const FUR = 0x45455a, FUR2 = 0x58586c, PINK = 0xff8ab8;
    const cx = 95, cz = 146, parts = [];
    parts.push(sph(1, 0, 3.4, 0, FUR, 9.5, 4.6, 8, 20));                           // the curled body
    parts.push(sph(1, -1, 4.6, -1, FUR2, 6.5, 3.2, 5.5, 16));                       // back highlight
    parts.push(sph(4.2, -6.2, 4.2, 4.2, FUR, 1, 0.92, 1, 16));                      // head, tucked in
    for (const sx of [-1, 1]) parts.push(paint(place(new THREE.ConeGeometry(1.5, 2.8, 8), { x: 6.2 + sx * 2.2, y: 7.6, z: 4.6, rz: sx * 0.35, rx: 0.2 }), FUR));
    for (const sx of [-1, 1]) parts.push(paint(place(new THREE.ConeGeometry(0.8, 1.4, 6), { x: 6.2 + sx * 2.2, y: 7.5, z: 5.1, rz: sx * 0.35, rx: 0.2 }), PINK));
    for (const sx of [-1, 1]) parts.push(paint(place(new THREE.TorusGeometry(0.75, 0.16, 6, 10, Math.PI), { x: 6.2 + sx * 1.6, y: 4.7, z: 8.2, rz: Math.PI }), 0x1a1a22));   // closed eyes ‿
    parts.push(sph(0.5, -6.2, 3.6, 8.3, PINK));                                     // nose
    parts.push(sph(1, -6.2, 2.9, 7.6, 0xd8d8e0, 1.6, 0.9, 0.9, 10));                 // muzzle
    const tail = new THREE.TorusGeometry(8.6, 1.3, 8, 24, Math.PI * 1.2); tail.rotateX(Math.PI / 2); tail.rotateY(0.6); tail.translate(0, 1.4, 0);
    parts.push(paint(tail, FUR)); parts.push(sph(1.5, 7.8, 1.4, -3.6, 0xd8d8e0));    // the white tail tip
    for (const sx of [-1, 1]) parts.push(sph(1, -6.2 + sx * 3.2, 1.2, 8, 0xd8d8e0, 1.6, 0.9, 1.8, 10));   // front paws
    const g = merge(parts);
    sootie = mesh(g, vmat, { name: 'sootie', shadow: true });
    sootie.position.set(-cx, BD.top + 5.4, cz); sootie.rotation.y = 0.3; sootie.scale.setScalar(1.3);
    updaters.push((dt, t) => { const b = 0.035 * Math.sin(t * 1.6); sootie.scale.set(1.3 * (1 + b * 0.4), 1.3 * (1 + b), 1.3 * (1 + b * 0.6)); });
  }

  /* =============================================================== the slide + its tower */
  {
    const tr = track, s0 = tr.sOf(tr.def.points.findIndex(p => p.wall === 'slide')), s1 = s0 + 54;
    const chute = K.lofted(s0, s1, 1, (s, f) => { const p = tr.pointAt(s, 0), hw = f.hw + 1.1; return [[hw, 1.3], [hw, -0.9], [-hw, -0.9], [-hw, 1.3]].map(([lat, dy], i) => ({ x: p.x + f.lx * lat, y: p.y + dy, z: p.z + f.lz * lat, u: i / 3 })); });
    B.misc.push(paint(chute, 0xffd23f));
    // a lip curling out at the bottom, legs under the chute, the tower (platform + ladder) under the Pillow Turn
    for (const [z, y] of [[78, 6.4], [62, 1.9]]) for (const dx of [-7.5, 7.5]) B.misc.push(boxAB(131 + dx - 0.8, 131 + dx + 0.8, 0, y, z - 0.8, z + 0.8, 0x2f6fdc));
    const T = SLIDE_TOWER;
    B.misc.push(boxAB(T.x0 + 1, T.x1, BED.top - 1.6, BED.top - 0.25, T.z0, T.z1, 0xe8443a));
    for (const [x, z] of [[T.x0 + 2, T.z0 + 1], [T.x1 - 1, T.z0 + 1], [T.x0 + 2, T.z1 - 1], [T.x1 - 1, T.z1 - 1]]) B.misc.push(boxAB(x - 1, x + 1, 0, BED.top - 1.6, z - 1, z + 1, 0x2f6fdc));
    for (let y = 2; y < BED.top - 2; y += 2.2) B.misc.push(boxAB(T.x1 - 1.2, T.x1 + 0.6, y, y + 0.5, T.z0 + 6, T.z1 - 6, 0x5cc850));   // ladder rungs
    B.misc.push(boxAB(T.x1 - 0.2, T.x1 + 0.8, 0, BED.top + 2, T.z0 + 5, T.z0 + 6, 0x5cc850));
    B.misc.push(boxAB(T.x1 - 0.2, T.x1 + 0.8, 0, BED.top + 2, T.z1 - 6, T.z1 - 5, 0x5cc850));
  }

  /* =============================================================== the play rug (a little town map) */
  {
    const rugTex = K.canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = '#7cd06a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#5ab0e8'; g.beginPath(); g.ellipse(760, 260, 120, 80, 0.4, 0, TAU); g.fill();          // a pond
      g.strokeStyle = '#8a8f99'; g.lineWidth = 56; g.lineCap = 'round';
      g.beginPath(); g.moveTo(80, 160); g.bezierCurveTo(400, 100, 500, 500, 940, 520); g.moveTo(240, 960); g.bezierCurveTo(300, 600, 600, 700, 700, 980); g.moveTo(100, 600); g.lineTo(560, 640); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.setLineDash([24, 22]);
      g.beginPath(); g.moveTo(80, 160); g.bezierCurveTo(400, 100, 500, 500, 940, 520); g.moveTo(240, 960); g.bezierCurveTo(300, 600, 600, 700, 700, 980); g.moveTo(100, 600); g.lineTo(560, 640); g.stroke(); g.setLineDash([]);
      const house = (x, y, c, r) => { g.fillStyle = c; g.fillRect(x - 30, y - 22, 60, 44); g.fillStyle = r; g.beginPath(); g.moveTo(x - 38, y - 22); g.lineTo(x, y - 56); g.lineTo(x + 38, y - 22); g.fill(); g.fillStyle = '#ffe680'; g.fillRect(x - 10, y - 10, 20, 18); };
      house(200, 330, '#ff8ab8', '#e8443a'); house(330, 820, '#ffd23f', '#2f6fdc'); house(820, 760, '#bfe9ff', '#9b59d0'); house(600, 330, '#fff', '#ff9a3a'); house(120, 820, '#ffb070', '#5a3a2a');
      for (let i = 0; i < 26; i++) { const x = (i * 337) % 1000 + 12, y = (i * 571) % 1000 + 12; g.fillStyle = '#3f9a38'; g.beginPath(); g.arc(x, y, 18, 0, TAU); g.fill(); }
      g.strokeStyle = '#ffd23f'; g.lineWidth = 26; g.strokeRect(13, 13, w - 26, h - 26);
    }, { repeat: null });
    const g = new THREE.PlaneGeometry(100, 150, 1, 1); g.rotateX(-Math.PI / 2); g.translate(68, 0.06, -15);
    mesh(paint(g, 0xffffff), new THREE.MeshLambertMaterial({ map: rugTex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }), { name: 'play-rug' });
  }

  /* =============================================================== under the bed */
  {
    // a dusky shadow over the whole space under the bed (darkens the carpet and the shortcut's road, not the karts)
    const g = (() => { const sh = new THREE.Shape(); const r = FOOT.r - 0.6; sh.moveTo(BD.x0 + 0.6, BD.z1 - 3); sh.lineTo(BD.x0 + 0.6, FOOT.z); sh.absarc(FOOT.mx, FOOT.z, r, Math.PI, 2 * Math.PI, false); sh.lineTo(BD.x1 - 0.6, BD.z1 - 3); sh.closePath(); const g = new THREE.ShapeGeometry(sh, 24); g.rotateX(Math.PI / 2); g.scale(-1, 1, 1); g.translate(0, 0.42, 0); const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (-p.getX(i) - BD.x0) / (BD.x1 - BD.x0), (p.getZ(i) - FOOT.z + FOOT.r) / (BD.z1 - FOOT.z + FOOT.r)); return g; })();
    const t = K.canvasTex(64, 64, (c, w, h) => { const gr = c.createRadialGradient(32, 32, 10, 32, 32, 46); gr.addColorStop(0, 'rgba(16,14,40,0.62)'); gr.addColorStop(1, 'rgba(16,14,40,0.38)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
    mesh(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }), { name: 'underbed-shade', receive: false }).renderOrder = 2;
    // the toy torch, lying on the carpet inside the U, shining on the lost-socks pile
    const TO = { mx: 70, z: 14 }, PILE = { mx: 70, z: -24 };
    B.misc.push(cyl(1.3, 1.1, 6, TO.mx, 1.3, TO.z, 0x2f6fdc, 12, Math.PI / 2));
    B.misc.push(cyl(1.8, 1.4, 1.6, TO.mx, 1.8, TO.z - 3.6, 0xffd23f, 12, Math.PI / 2));
    B.glow.push(paint(place(new THREE.CircleGeometry(1.55, 14), { x: -TO.mx, y: 1.8, z: TO.z - 4.45, ry: Math.PI }), 0xfffbe0));
    {
      const L = TO.z - PILE.z - 6, beam = new THREE.CylinderGeometry(6.5, 1.5, L, 18, 1, true); beam.rotateX(-Math.PI / 2); beam.translate(-TO.mx, 2.2, TO.z - 4.5 - L / 2);
      const bt = K.canvasTex(16, 64, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,240,170,0.0)'); gr.addColorStop(1, 'rgba(255,240,170,0.38)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
      mesh(beam, new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), { name: 'torch-beam', receive: false }).renderOrder = 3;
    }
    // the LOST SOCKS: a glowing pile in the torch light, more strays along the way (and a few in the toy box)
    const sockGeo = (() => { const leg = new THREE.CylinderGeometry(0.55, 0.55, 2.4, 8); leg.translate(0, 1.2, 0); const foot = new THREE.CylinderGeometry(0.55, 0.55, 1.8, 8); foot.rotateZ(Math.PI / 2); foot.translate(0.7, 0.1, 0); const toe = new THREE.SphereGeometry(0.55, 8, 6); toe.translate(1.6, 0.1, 0); const cuff = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 8); cuff.translate(0, 2.3, 0); return merge([paint(leg, 0xffffff), paint(foot, 0xffffff), paint(toe, 0xffffff), paint(cuff, 0xffffff)]); })();
    const socks = [];
    const SOCKC = [0x8ff0b4, 0xff9ad0, 0xfff07a, 0x9ad8ff, 0xd0a8ff, 0xffb070];
    for (let i = 0; i < 46; i++) { const a = rng() * TAU, r = Math.sqrt(rng()) * 7, h = Math.max(0, 4.2 - r * 0.55) * rng(); socks.push({ x: -(PILE.mx + Math.cos(a) * r), y: 0.6 + h, z: PILE.z + Math.sin(a) * r, rx: rng() * 3, ry: rng() * 3, rz: rng() * 3, s: 2.1, color: SOCKC[i % SOCKC.length] }); }
    for (const [mx, z] of [[95, -14], [92, 30], [50, 24], [48, -16], [62, -30], [85, -25], [30, 44], [104, 46]]) if (ctx.isClear(-mx, z, 2.5, 1)) socks.push({ x: -mx, y: 0.6, z, rz: Math.PI / 2, ry: rng() * TAU, s: 1.5, color: pick(SOCKC) });
    const sockMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    instanced(sockGeo, sockMat, socks, { name: 'lost-socks' });
    // dust bunnies (soft grey fluff, no faces) and lost toys under there
    for (const [mx, z, r] of [[100, 40, 2.4], [40, 40, 2], [80, -22, 2.2], [56, -22, 1.8], [60, 30, 2.6]]) if (ctx.isClear(-mx, z, r, 1)) B.misc.push(sph(r, mx, r * 0.7, z, 0xb8b4c8, 1, 0.7, 1, 10));
    lostToys.push([84, 10, 'ball'], [56, -10, 'car'], [88, -12, 'block'], [52, 10, 'block']);
  }

  /* =============================================================== toys round the room */
  const blocks = [], balls = [], cars = [];
  // the toy box (east strip), with toys poking out
  {
    const T = { mx: 160, z: -10 };
    B.misc.push(boxAB(T.mx - 14, T.mx + 14, 0, 16, T.z - 20, T.z + 20, 0xe8443a));
    B.misc.push(boxAB(T.mx - 14.5, T.mx + 14.5, 6.5, 9.5, T.z - 20.5, T.z + 20.5, 0xffd23f));
    B.misc.push(paint(place(new THREE.BoxGeometry(28, 1.4, 40), { x: -(T.mx + 14), y: 26, z: T.z, rz: -1.2 }), 0xe8443a));     // the open lid
    for (let i = 0; i < 6; i++) balls.push({ x: -(T.mx - 8 + rng() * 16), y: 15 + rng() * 2, z: T.z - 14 + rng() * 28, s: 3 + rng() * 1.5, color: pick(FAMILY) });
    for (let i = 0; i < 5; i++) blocks.push({ x: -(T.mx - 9 + rng() * 18), y: 14 + rng() * 3, z: T.z - 14 + rng() * 28, rx: rng(), ry: rng() * 3, s: 4, color: pick(FAMILY) });
  }
  // a teddy bear sitting in the south-east corner, a bookshelf on the east wall
  {
    const T = { mx: 158, z: -118 }, BR = 0xc88a50, BL = 0xe8c090;
    B.misc.push(sph(1, T.mx, 12, T.z, BR, 11, 12, 10, 16));
    B.misc.push(sph(8.5, T.mx, 30, T.z, BR, 1, 1, 1, 16));
    for (const sx of [-1, 1]) { B.misc.push(sph(3.2, T.mx + sx * 6.5, 37, T.z, BR)); B.misc.push(sph(1.8, T.mx + sx * 6.5, 37, T.z + 1.8, BL)); B.misc.push(sph(1, T.mx + sx * 10, 12, T.z + 5, BR, 3.2, 3.2, 6)); B.misc.push(sph(1, T.mx + sx * 6, 3.6, T.z + 9, BR, 3.6, 3.4, 6.5)); }
    B.misc.push(sph(3.2, T.mx, 28, T.z + 7.2, BL, 1, 0.8, 1));
    B.misc.push(sph(1.1, T.mx, 29, T.z + 10, 0x2d3142));
    for (const sx of [-1, 1]) B.misc.push(sph(0.9, T.mx + sx * 3, 32.5, T.z + 7.6, 0x2d3142));
    B.misc.push(paint(place(new THREE.TorusGeometry(3.2, 0.9, 6, 16), { x: -T.mx, y: 21.5, z: T.z + 2, rx: Math.PI / 2 }), 0xe8443a));   // a bow tie-ish ribbon
    const S = { x0: 172, x1: 180, z0: 50, z1: 120 };
    B.wood.push(boxAB(S.x1 - 1.5, S.x1, 0, 70, S.z0, S.z1, 0xf0dcc0));                       // back + sides (open front)
    for (const z of [S.z0, S.z1 - 1.5]) B.wood.push(boxAB(S.x0, S.x1, 0, 70, z, z + 1.5, 0xf0dcc0));
    for (let y = 2; y < 70; y += 17) {
      B.wood.push(boxAB(S.x0 - 1, S.x1, y - 1.2, y, S.z0, S.z1, 0xe0c8a8));
      let z = S.z0 + 1.5; while (z < S.z1 - 3) { const t = 2 + rng() * 3, hh = 10 + rng() * 4; B.misc.push(boxAB(S.x0 + 0.5, S.x1 - 1.5, y, y + hh, z, z + t, pick([0x2f6fdc, 0xe8443a, 0x5cc850, 0xffd23f, 0x9b59d0, 0xff8ab8]))); z += t + 0.3; }
    }
  }
  // block towers and scattered toys on the carpet, never on the road, never inside the furniture
  {
    const towerAt = (mx, z, n) => { for (let i = 0; i < n; i++) blocks.push({ x: -(mx + (rng() - 0.5) * 0.8), y: i * 4, z: z + (rng() - 0.5) * 0.8, ry: (rng() - 0.5) * 0.5, s: 4, color: FAMILY[(i * 3 + n) % FAMILY.length] }); };
    const free = (mx, z, r) => !blocked(mx, z, r) && ctx.isClear(-mx, z, r, 2);
    for (const [mx, z, n] of [[-115, 60, 6], [-110, -30, 4], [-100, 10, 8], [-30, 40, 5], [-25, -95, 7], [150, -60, 5], [155, 60, 4], [-165, 130, 6], [60, -120, 5], [-60, -135, 4]]) if (free(mx, z, 4)) towerAt(mx, z, n);
    for (let i = 0; i < 70; i++) {
      const mx = ROOM.x0 + 8 + rng() * (ROOM.x1 - ROOM.x0 - 16), z = ROOM.z0 + 8 + rng() * (ROOM.z1 - ROOM.z0 - 16);
      if (!free(mx, z, 3)) continue;
      const kind = rng();
      if (kind < 0.45) blocks.push({ x: -mx, y: 0, z, ry: rng() * 3, s: 4, color: pick(FAMILY) });
      else if (kind < 0.65) balls.push({ x: -mx, y: 2.6, z, s: 2.6, color: pick(FAMILY) });
      else if (kind < 0.85) brickPile(mx, z, 0, 3 + (rng() * 4 | 0), 5);
      else cars.push({ x: -mx, y: 0, z, ry: rng() * TAU, s: 1.3, color: pick(FAMILY) });
    }
    for (let i = 0; i < 10; i++) { const mx = -150 + rng() * 300, z = -140 + rng() * 280; if (free(mx, z, 3)) crayons.push({ x: -mx, y: 0.6, z, rz: Math.PI / 2, ry: rng() * TAU, s: 1.2, color: pick(FAMILY) }); }
    // the lost toys under the bed
    for (const [mx, z, kind] of lostToys) {
      if (!ctx.isClear(-mx, z, 3, 1)) continue;
      if (kind === 'ball') balls.push({ x: -mx, y: 2.6, z, s: 2.6, color: 0xff6fae });
      else if (kind === 'car') cars.push({ x: -mx, y: 0, z, ry: 1.2, s: 1.3, color: 0x2f6fdc });
      else blocks.push({ x: -mx, y: 0, z, ry: rng() * 3, s: 4, color: pick(FAMILY) });
    }
  }
  // instanced toys
  instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), blocks, { name: 'blocks' });
  instanced(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshLambertMaterial({ color: 0xffffff }), balls, { name: 'balls' });
  instanced(crayonGeo, vmat, crayons, { name: 'crayons' });
  instanced(brickGeo, vmat, bricks, { name: 'bricks' });
  const carGeo = (() => { const p = [paint(new THREE.BoxGeometry(6, 1.6, 3).translate(0, 1.6, 0), 0xffffff), paint(new THREE.BoxGeometry(3, 1.3, 2.6).translate(-0.4, 3, 0), 0xd8f0ff)]; for (const x of [-2, 2]) for (const z of [-1.5, 1.5]) p.push(paint(new THREE.CylinderGeometry(0.8, 0.8, 0.6, 10).rotateX(Math.PI / 2).translate(x, 0.8, z), 0x2d3142)); return merge(p); })();
  instanced(carGeo, vmat, cars, { name: 'toy-cars' });

  // chevron boards on the tight floor corners (not on the desk or the bed)
  K.chevrons({ rMax: 34, skip: c => track.pointAt(c.s0, 0).y > 1 });

  /* =============================================================== merge the buckets */
  const woodTex = loadTex('wood', null), quiltTex = loadTex('quilt', null);
  mesh(merge(B.wall), new THREE.MeshLambertMaterial({ map: wallTex, vertexColors: true }), { name: 'room-walls' });
  mesh(merge(B.misc), vmat2, { name: 'room-props' });
  mesh(merge(B.wood.map(g => worldUV(g, 18))), new THREE.MeshLambertMaterial({ map: woodTex, vertexColors: true }), { name: 'furniture-wood', shadow: true });
  mesh(merge(B.quilt), new THREE.MeshLambertMaterial({ map: quiltTex, vertexColors: true, side: THREE.DoubleSide }), { name: 'quilt' });
  mesh(merge(B.glow), glowMat, { name: 'glow', receive: false });
  mesh(merge(B.poster), new THREE.MeshLambertMaterial({ map: posterTex, vertexColors: true, side: THREE.DoubleSide }), { name: 'posters' });

  return { update(dt, t) { for (const u of updaters) u(dt, t); } };
}
