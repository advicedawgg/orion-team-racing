// itemviews.js — the browser half of the items: THREE meshes, particles, sounds, camera shake
// and HUD callouts for everything items.js simulates. Browser only (imports THREE).
//
//   const IV = createItemViews({ scene, fx, audio, chase, visuals: () => G.visuals });
//   IV.attach(race)        // new race: createItems(race) + (re)build the instanced boxes/stars.
//                          //   Call BEFORE renderer.compileAsync so every item material is warmed.
//   IV.step(race.events, ff)   // after each race.step(): sounds/fx/UI for this step's item events
//   IV.update(dt, alpha)   // every render frame, after the karts are drawn
//
// Draw calls: boxes 1 (instanced) + stars 1 (instanced, track + spilled) + only what's live
// (each projectile/crate/puddle/bubble/explosion is one merged mesh). No lights, ever.
// URL debug params: items=0 (off), give=<id> (player gets it at GO), refill=1 (…every time the
// slot empties), stars=N (player starts with N stars). See DESIGN.md "Items".
import * as THREE from 'three';
import { createItems, IT, ITEMS } from './items.js';
import { rbox } from './racerart.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const TAU = Math.PI * 2;
const HIT_TEXT = { taco_bomb: 'BOOM!', rocket: 'ZAPPED!', tnt: 'KA-BOOM!', nitro: 'KA-BOOM!', icecream: 'SPLAT!', shield: 'BONK!', remote: 'PAUSED!', warp: 'WARPED!' };

/* ============================================================================ canvas textures */
function canvasTex(w, h, draw, { srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const rrect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
const FONT = '900 {S}px system-ui,-apple-system,"Segoe UI",Arial,sans-serif';
const font = s => FONT.replace('{S}', s);

const TEX = {};
function textures() {
  if (TEX.ready) return TEX;
  // ? box face: light tile (tinted per instance) with a bold "?"; emissive map = just the "?"
  TEX.box = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 10, 64, 64, 90); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#bdbdbd');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.lineWidth = 10; g.strokeStyle = '#ffffff'; rrect(g, 7, 7, 114, 114, 16); g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(40,20,80,.55)'; rrect(g, 13, 13, 102, 102, 12); g.stroke();
    g.font = font(92); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = '#2a1850'; g.strokeText('?', 64, 70);
    g.fillStyle = '#ffffff'; g.fillText('?', 64, 70);
  });
  TEX.boxQ = canvasTex(128, 128, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
    g.font = font(92); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText('?', 64, 70);
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.35)'; rrect(g, 7, 7, 114, 114, 16); g.stroke();
  });
  TEX.tnt = canvasTex(128, 128, (g) => {
    g.fillStyle = '#c8742e'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#a95a1d'; for (let i = 0; i < 4; i++) g.fillRect(0, 8 + i * 32, 128, 3);          // planks
    g.lineWidth = 12; g.strokeStyle = '#6b3a12'; g.strokeRect(6, 6, 116, 116);
    g.fillStyle = '#f6e6c4'; rrect(g, 16, 36, 96, 50, 8); g.fill();
    g.font = font(44); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#d0201a'; g.fillText('TNT', 64, 63);
    for (let i = -1; i < 9; i++) { g.fillStyle = i % 2 ? '#1b1b1b' : '#ffd23f'; g.beginPath(); g.moveTo(i * 16, 128); g.lineTo(i * 16 + 16, 128); g.lineTo(i * 16 + 28, 98); g.lineTo(i * 16 + 12, 98); g.fill(); }
    g.lineWidth = 12; g.strokeStyle = '#6b3a12'; g.strokeRect(6, 6, 116, 116);
  });
  TEX.nitro = canvasTex(128, 128, (g) => {
    const gr = g.createLinearGradient(0, 0, 128, 128); gr.addColorStop(0, '#6dff7a'); gr.addColorStop(1, '#179b2c');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.lineWidth = 10; g.strokeStyle = '#0d5a1a'; g.strokeRect(5, 5, 118, 118);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(72, 14); g.lineTo(36, 70); g.lineTo(62, 70); g.lineTo(52, 114); g.lineTo(92, 54); g.lineTo(66, 54); g.closePath(); g.fill();
    g.lineWidth = 5; g.strokeStyle = '#0d5a1a'; g.stroke();
  });
  TEX.nitroE = canvasTex(128, 128, (g) => {
    g.fillStyle = '#0b3a10'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(72, 14); g.lineTo(36, 70); g.lineTo(62, 70); g.lineTo(52, 114); g.lineTo(92, 54); g.lineTo(66, 54); g.closePath(); g.fill();
  });
  TEX.splat = canvasTex(256, 256, (g) => {
    // a pink strawberry ice-cream splat with sprinkles and the cone
    const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.fillStyle = 'rgba(120,20,70,.35)'; for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; blob(128 + Math.cos(a) * 80, 132 + Math.sin(a) * 80, 22 + rnd() * 16); } blob(128, 132, 88);
    g.fillStyle = '#ff7eb6'; for (let i = 0; i < 14; i++) { const a = i / 14 * TAU + 0.1; blob(128 + Math.cos(a) * 74, 128 + Math.sin(a) * 74, 20 + rnd() * 16); } blob(128, 128, 84);
    g.fillStyle = '#ffb3d4'; blob(110, 108, 46); blob(150, 140, 30);
    g.fillStyle = '#fff4f8'; blob(98, 96, 14); blob(160, 150, 8);
    const sp = ['#ffd23f', '#4ec5f1', '#7ed957', '#ffffff', '#b54dff'];
    g.lineCap = 'round'; g.lineWidth = 7;
    for (let i = 0; i < 26; i++) { const a = rnd() * TAU, r = rnd() * 70, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r, b = rnd() * TAU; g.strokeStyle = sp[i % sp.length]; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * 9, y + Math.sin(b) * 9); g.stroke(); }
    // the cone, tipped over
    g.save(); g.translate(176, 70); g.rotate(-0.7);
    g.fillStyle = '#e0a04a'; g.beginPath(); g.moveTo(-22, 0); g.lineTo(22, 0); g.lineTo(0, 70); g.closePath(); g.fill();
    g.strokeStyle = '#a8692a'; g.lineWidth = 3; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-22 + i * 11, 0); g.lineTo(-5 + i * 3, 50); g.stroke(); }
    g.restore();
  });
  TEX.dot = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const comic = (text, fill, stroke, w = 256) => canvasTex(w, 128, (g) => {
    g.translate(w / 2, 64);
    // spiky burst
    g.fillStyle = stroke; g.beginPath();
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, r = i % 2 ? 44 : 62; g.lineTo(Math.cos(a) * r * (w / 128), Math.sin(a) * r); } g.fill();
    g.fillStyle = '#fff3a0'; g.beginPath();
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU + 0.13, r = i % 2 ? 38 : 54; g.lineTo(Math.cos(a) * r * (w / 128) * 0.95, Math.sin(a) * r * 0.9); } g.fill();
    g.font = font(58); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = stroke; g.strokeText(text, 0, 4); g.fillStyle = fill; g.fillText(text, 0, 4);
  });
  TEX.boom = comic('BOOM!', '#ff4a1a', '#5a1400');
  TEX.splatWord = comic('SPLAT!', '#ff5aa8', '#5a0030');
  TEX.digits = [1, 2, 3].map(n => canvasTex(128, 128, (g) => {
    g.fillStyle = n === 1 ? '#ff2a2a' : n === 2 ? '#ff8a1f' : '#ffd23f';
    g.beginPath(); g.arc(64, 64, 56, 0, TAU); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
    g.font = font(86); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#3a0a00'; g.strokeText(String(n), 64, 70); g.fillStyle = '#fff'; g.fillText(String(n), 64, 70);
  }));
  TEX.pause = canvasTex(128, 128, (g) => {
    g.fillStyle = '#2b3a8f'; rrect(g, 8, 20, 112, 88, 18); g.fill();
    g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.stroke();
    g.fillStyle = '#ffd23f'; rrect(g, 40, 38, 16, 52, 4); g.fill(); rrect(g, 72, 38, 16, 52, 4); g.fill();
  });
  TEX.reticle = canvasTex(128, 128, (g) => {
    g.strokeStyle = '#ff2a2a'; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 64, 44, 0, TAU); g.stroke();
    g.lineWidth = 7; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.beginPath(); g.moveTo(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30); g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); g.stroke(); }
    g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(64, 64, 8, 0, TAU); g.fill();
  });
  TEX.ready = true;
  return TEX;
}

/* ============================================================================ geometry helpers */
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _s4 = new THREE.Vector3(), _p4 = new THREE.Vector3();
function part(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _m4.compose(_p4.set(...pos), _q4.setFromEuler(_e4.set(rot[0], rot[1], rot[2])), typeof scale === 'number' ? _s4.setScalar(scale) : _s4.set(...scale));
  g.applyMatrix4(_m4);
  const n = g.attributes.position.count, c = new THREE.Color(color), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function merge(parts) {
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
function starShape(r, inner, pts = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < pts * 2; i++) { const rr = i % 2 ? r * inner : r, a = Math.PI / 2 + i * Math.PI / pts; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  s.closePath(); return s;
}
function chunkyStar(r = 0.55) {
  const g = new THREE.ExtrudeGeometry(starShape(r, 0.5), { depth: 0.2, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -0.1); g.computeVertexNormals(); return g;
}

function tacoBombGeo() {
  const P = [];
  P.push(part(new THREE.SphereGeometry(0.42, 16, 12), 0x2b2b3a, [0, 0.5, 0]));
  P.push(part(new THREE.SphereGeometry(0.1, 8, 6), 0x8d8da8, [-0.16, 0.7, 0.2]));                  // shine
  P.push(part(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 10), 0x6d6d80, [0, 0.93, 0]));
  P.push(part(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 5), 0x8a5a2b, [0.04, 1.06, 0], [0, 0, -0.4]));
  // the taco shell: a half cylinder cradling the bomb, axis across the kart (X), open at the top
  // theta π..2π = the x<0 half; rotating about Z by +90° turns x<0 into y<0 (the bottom half)
  const shell = new THREE.CylinderGeometry(0.56, 0.56, 0.62, 18, 1, true, Math.PI, Math.PI);
  P.push(part(shell, 0xf2b43c, [0, 0.52, 0], [0, 0, Math.PI / 2]));
  for (const z of [-0.5, 0.5]) for (const x of [-0.2, 0, 0.2]) {
    P.push(part(new THREE.SphereGeometry(0.1, 7, 5), 0x5fc238, [x, 0.56, z * 1.06], [0, 0, 0], [1.3, 0.8, 1]));
    P.push(part(new THREE.BoxGeometry(0.1, 0.08, 0.08), 0xe0302a, [x + 0.08, 0.6, z * 0.98]));
  }
  return merge(P);
}
function rocketGeo() {
  const P = [];
  P.push(part(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 12), 0x7b4bd6, [0, 0, 0], [Math.PI / 2, 0, 0]));
  P.push(part(new THREE.ConeGeometry(0.2, 0.42, 12), 0xf2f2ff, [0, 0, 0.66], [Math.PI / 2, 0, 0]));
  P.push(part(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 12), 0xffd23f, [0, 0, 0.3], [Math.PI / 2, 0, 0]));
  P.push(part(new THREE.CylinderGeometry(0.16, 0.2, 0.14, 12), 0x3a3f52, [0, 0, -0.5], [Math.PI / 2, 0, 0]));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    P.push(part(new THREE.BoxGeometry(0.04, 0.26, 0.3), 0xe8402a, [Math.cos(a) * 0.26, Math.sin(a) * 0.26, -0.32], [0, 0, a - Math.PI / 2]));
  }
  // a little yellow star on each side
  for (const s of [1, -1]) P.push(part(new THREE.ExtrudeGeometry(starShape(0.11, 0.45), { depth: 0.02, bevelEnabled: false }), 0xffd23f, [s * 0.2, 0, -0.05], [0, s * Math.PI / 2, 0]));
  return merge(P);
}
function spiritGeo() {
  // Sootie's spirit: a chibi black cat (SO2 #2b2431 fur, mint eyes, pink nose), big head, flying
  const P = [], B = 0x3a3148, E = 0x8ff0b4, IN = 0xff8fc0;
  P.push(part(new THREE.SphereGeometry(0.17, 12, 9), B, [0, -0.02, -0.12], [0, 0, 0], [0.85, 0.75, 1.15]));   // body
  P.push(part(new THREE.SphereGeometry(0.24, 14, 11), B, [0, 0.16, 0.08], [0, 0, 0], [1.1, 0.95, 1]));        // head
  for (const s of [1, -1]) {
    P.push(part(new THREE.ConeGeometry(0.09, 0.2, 4), B, [s * 0.15, 0.42, 0.06], [0, Math.PI / 4, -s * 0.35]));   // ears
    P.push(part(new THREE.ConeGeometry(0.05, 0.11, 4), IN, [s * 0.145, 0.41, 0.1], [0, Math.PI / 4, -s * 0.35]));
    P.push(part(new THREE.SphereGeometry(0.06, 10, 8), E, [s * 0.1, 0.19, 0.3], [0, 0, 0], [1, 1.25, 0.6]));   // big mint eyes
    P.push(part(new THREE.SphereGeometry(0.022, 6, 4), 0x10301f, [s * 0.1, 0.19, 0.335]));
    P.push(part(new THREE.SphereGeometry(0.018, 6, 4), 0xffffff, [s * 0.085, 0.215, 0.34]));
    P.push(part(new THREE.CylinderGeometry(0.04, 0.035, 0.14, 6), B, [s * 0.08, -0.14, -0.02]));              // paws
    for (const w of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.17, 0.01, 0.01), 0xffffff, [s * 0.2, 0.1 + w * 0.025, 0.28], [0, 0, s * w * 0.18]));   // whiskers
  }
  P.push(part(new THREE.SphereGeometry(0.03, 6, 4), IN, [0, 0.11, 0.33]));                                       // nose
  const tail = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.02, -0.28), new THREE.Vector3(0.02, 0.06, -0.4), new THREE.Vector3(0.08, 0.2, -0.42), new THREE.Vector3(0.14, 0.26, -0.34)]), 10, 0.028, 6);
  P.push(part(tail, B));
  return merge(P);
}

const SHIELD_VS = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`;
const SHIELD_FS = `uniform float uT; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, 2.2);
  vec3 rainbow = 0.55 + 0.45 * cos(6.2831 * (rim * 0.9 + vP.y * 0.25 + uT * 0.2 + vec3(0.0, 0.33, 0.67)));
  vec3 c = mix(vec3(0.75, 0.95, 1.0), rainbow, 0.65);
  float shine = smoothstep(0.93, 0.985, dot(normalize(vN), normalize(vec3(-0.45, 0.65, 0.6)))) * 0.7;
  gl_FragColor = vec4(c * (0.35 + rim * 1.2) + shine * 0.9, (0.1 + rim * 0.8 + shine * 0.6) * uA);
}`;

/* ============================================================================ the views */
export function createItemViews({ scene, fx = null, audio = null, chase = null, visuals = () => [] }) {
  const T_ = textures();
  const au = audio || { play: () => ({ stop() {}, set() {} }), bark() {} };
  const root = new THREE.Group(); root.name = 'items'; scene.add(root);
  let W = null, race = null, P = null, t = 0;

  // ---------------------------------------------------------------- materials (shared)
  const M = {
    box: new THREE.MeshLambertMaterial({ map: T_.box, emissive: 0xffffff, emissiveMap: T_.boxQ, emissiveIntensity: 0.9, toneMapped: false }),
    star: new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xb07000, toneMapped: false }),
    vc: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    tnt: new THREE.MeshLambertMaterial({ map: T_.tnt }),
    nitro: new THREE.MeshLambertMaterial({ map: T_.nitro, emissive: 0xffffff, emissiveMap: T_.nitroE, emissiveIntensity: 0.9 }),
    puddle: new THREE.MeshLambertMaterial({ map: T_.splat, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    spirit: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    warp: new THREE.MeshBasicMaterial({ color: 0xb49bff, toneMapped: false }),
    core: new THREE.MeshBasicMaterial({ color: 0xfff09a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    ring: new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  };
  // the ? boxes glow in their own (per-instance rainbow) colour, so they read in any light
  M.box.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.55;'); };
  M.box.customProgramCacheKey = () => 'otr-itembox';
  const shieldMat = () => new THREE.ShaderMaterial({ vertexShader: SHIELD_VS, fragmentShader: SHIELD_FS, uniforms: { uT: { value: 0 }, uA: { value: 1 } }, transparent: true, depthWrite: false });
  const spriteMat = (map, o = {}) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, ...o });

  // ---------------------------------------------------------------- geometry (shared)
  const GEO = {
    box: rbox(1.2, 1.2, 1.2, 0.28, 2),
    star: chunkyStar(0.62),
    bomb: tacoBombGeo(),
    rocket: rocketGeo(),
    flame: (() => { const g = new THREE.ConeGeometry(0.17, 0.7, 10); g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.9); return g; })(),
    crate: rbox(0.95, 0.95, 0.95, 0.12, 2),
    puddle: (() => { const g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2); return g; })(),
    bubble: new THREE.SphereGeometry(1, 28, 18),
    spirit: spiritGeo(),
    bigStar: chunkyStar(0.9),
    ball: new THREE.SphereGeometry(1, 18, 12),
    ring: (() => { const g = new THREE.RingGeometry(0.75, 1, 36); g.rotateX(-Math.PI / 2); return g; })(),
  };

  // ---------------------------------------------------------------- pools
  function pool(n, make) {
    const list = [];
    for (let i = 0; i < n; i++) { const o = make(i); o.visible = false; root.add(o); list.push(o); }
    list.used = 0;
    return list;
  }
  const mesh = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.frustumCulled = true; return m; };
  const sprite = (mat, name) => { const s = new THREE.Sprite(mat); s.name = name; s.renderOrder = 6; return s; };

  const bombs = pool(6, () => mesh(GEO.bomb, M.vc, 'item:bomb'));
  const rockets = pool(8, () => { const m = mesh(GEO.rocket, M.vc, 'item:rocket'); const f = mesh(GEO.flame, M.flame, 'item:flame'); m.add(f); m.userData.flame = f; return m; });
  const crates = pool(12, () => mesh(GEO.crate, M.tnt, 'item:crate'));        // TNT/Nitro on the road
  const flyCrates = pool(4, () => mesh(GEO.crate, M.tnt, 'item:crateflying')); // shaken off a head
  const puddles = pool(12, () => { const m = mesh(GEO.puddle, M.puddle, 'item:puddle'); m.renderOrder = 1; return m; });
  const shots = pool(4, () => { const m = mesh(GEO.bubble, shieldMat(), 'item:shieldshot'); m.renderOrder = 4; return m; });
  const warps = pool(2, () => { const g = new THREE.Group(); g.name = 'item:warp'; const s = mesh(GEO.bigStar, M.warp, 'item:warpstar'); const h = sprite(spriteMat(T_.dot, { color: 0x9a7bff, blending: THREE.AdditiveBlending }), 'item:warphalo'); h.scale.setScalar(4.5); g.add(s, h); g.userData.star = s; return g; });
  const flyers = [];                                           // crates shaken off heads: view-only ballistic
  // explosions
  const booms = pool(6, () => {
    const g = new THREE.Group(); g.name = 'item:boom';
    const core = mesh(GEO.ball, M.core.clone(), 'boom:core'), ball = mesh(GEO.ball, new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, depthWrite: false, toneMapped: false }), 'boom:ball');
    const ring = mesh(GEO.ring, M.ring.clone(), 'boom:ring'), word = sprite(spriteMat(T_.boom, { depthTest: false }), 'boom:word');
    core.renderOrder = 5; ball.renderOrder = 4; ring.renderOrder = 5;
    g.add(ball, core, ring, word); g.userData = { core, ball, ring, word, t: 9, r: 3 };
    return g;
  });
  // per-kart: shield bubble, TNT countdown sprite, super-star spirit + aura, remote "pause" icon, lock-on reticle
  let perKart = [];
  function buildPerKart(n) {
    for (const pk of perKart) for (const o of Object.values(pk)) if (o?.isObject3D) root.remove(o);
    perKart = [];
    for (let i = 0; i < n; i++) {
      const bubble = mesh(GEO.bubble, shieldMat(), 'item:shield'); bubble.renderOrder = 4;
      const digit = sprite(spriteMat(T_.digits[2], { depthTest: false }), 'item:tntdigit'); digit.renderOrder = 7;
      const spirit = mesh(GEO.spirit, M.spirit, 'item:sootie');
      const halo = sprite(spriteMat(T_.dot, { color: 0x6fffc0, blending: THREE.AdditiveBlending }), 'item:halo'); halo.renderOrder = 3;
      const aura = sprite(spriteMat(T_.dot, { color: 0xffc23a, blending: THREE.AdditiveBlending, opacity: 0.35 }), 'item:aura');
      const pause = sprite(spriteMat(T_.pause, { depthTest: false }), 'item:pause');
      const reticle = sprite(spriteMat(T_.reticle, { depthTest: false }), 'item:reticle'); reticle.renderOrder = 8;
      const crate = mesh(GEO.crate, M.tnt, 'item:cratehead');
      const pk = { bubble, digit, spirit, halo, aura, pause, reticle, crate };
      for (const o of [bubble, digit, spirit, halo, aura, pause, reticle, crate]) { o.visible = false; root.add(o); }
      perKart.push(pk);
    }
  }

  // ---------------------------------------------------------------- instanced boxes + stars
  let boxIM = null, starIM = null, nTrackStars = 0;
  const SPILL_MAX = 48;
  const _o = new THREE.Object3D(), _c = new THREE.Color(), _v = new THREE.Vector3();
  function buildInstances() {
    for (const im of [boxIM, starIM]) if (im) { root.remove(im); im.dispose(); }
    boxIM = starIM = null;
    if (!W) return;
    boxIM = new THREE.InstancedMesh(GEO.box, M.box, Math.max(1, W.boxes.length));
    boxIM.name = 'item:boxes'; boxIM.frustumCulled = false;
    for (let i = 0; i < boxIM.count; i++) boxIM.setColorAt(i, _c.setHSL(i * 0.13 % 1, 0.85, 0.6));
    nTrackStars = W.stars.length;
    starIM = new THREE.InstancedMesh(GEO.star, M.star, nTrackStars + SPILL_MAX);
    starIM.name = 'item:stars'; starIM.frustumCulled = false;
    root.add(boxIM, starIM);
    updateInstances(0);
  }
  const hide = (im, i) => { _o.position.set(0, -1e4, 0); _o.scale.setScalar(0.0001); _o.updateMatrix(); im.setMatrixAt(i, _o.matrix); };
  const popIn = age => age < 0 ? 1 : age >= 0.4 ? 1 : (() => { const x = age / 0.4; return Math.max(0.01, 1 + Math.sin(x * Math.PI) * 0.35 * (1 - x) - (1 - x) ** 3); })();
  function updateInstances() {
    if (!boxIM) return;
    const B = W.boxes;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!b.alive) { hide(boxIM, i); continue; }
      const sc = popIn(W.t - b.bornT);
      _o.position.set(b.x, b.y + 1.05 + Math.sin(t * 2.2 + i * 1.7) * 0.12, b.z);
      _o.rotation.set(0.35 * Math.sin(t * 0.9 + i), t * 1.3 + i * 0.9, 0.25 * Math.cos(t * 0.7 + i));
      _o.scale.setScalar(sc); _o.updateMatrix(); boxIM.setMatrixAt(i, _o.matrix);
      boxIM.setColorAt(i, _c.setHSL((t * 0.22 + i * 0.13) % 1, 0.9, 0.62));
    }
    boxIM.instanceMatrix.needsUpdate = true; if (boxIM.instanceColor) boxIM.instanceColor.needsUpdate = true;
    const S = W.stars;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (!s.alive) { hide(starIM, i); continue; }
      _o.position.set(s.x, s.y + 1.0 + Math.sin(t * 3 + i * 0.8) * 0.1, s.z);
      _o.rotation.set(0, t * 2.6 + i * 0.5, 0);
      _o.scale.setScalar(popIn(W.t - s.bornT)); _o.updateMatrix(); starIM.setMatrixAt(i, _o.matrix);
    }
    for (let j = 0; j < SPILL_MAX; j++) {
      const sp = W.spills[j], idx = nTrackStars + j;
      if (!sp) { hide(starIM, idx); continue; }
      const blink = sp.life - sp.t < 2 && Math.floor(sp.t * 10) % 2 === 0;
      if (blink) { hide(starIM, idx); continue; }
      _o.position.set(sp.x, sp.y + (sp.rest ? 0.75 + Math.sin(t * 4 + j) * 0.08 : 0.4), sp.z);
      _o.rotation.set(sp.rest ? 0 : sp.t * 9, t * 4 + j, 0);
      _o.scale.setScalar(0.8); _o.updateMatrix(); starIM.setMatrixAt(idx, _o.matrix);
    }
    starIM.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- explosions (view-only)
  function boom(pos, r, { item = 'taco_bomb', big = false, word = true } = {}) {
    const g = booms.find(b => b.userData.t >= 1.0) || booms.reduce((a, b) => (a.userData.t > b.userData.t ? a : b));
    const u = g.userData;
    u.t = 0; u.r = Math.min(6.5, Math.max(2.2, r || 2.2)) * (big ? 1.25 : 1);
    u.nitro = item === 'nitro';
    u.word.material.map = T_.boom; u.word.visible = word;
    g.position.set(pos.x, pos.y + 0.4, pos.z);
    g.visible = true;
    if (fx) {
      fx.burst('turbo', { x: pos.x, y: pos.y, z: pos.z }, { n: 22, color: u.nitro ? 0x6dff7a : 0xff8a1f });
      fx.burst('wall', { x: pos.x, y: pos.y + 0.4, z: pos.z }, { n: 16 });
      fx.burst('fizzle', { x: pos.x, y: pos.y + 0.6, z: pos.z }, { n: 12 });
      fx.burst('sparkle', { x: pos.x, y: pos.y + 0.6, z: pos.z }, { n: 10, color: 0xffe070 });
    }
  }
  function stepBooms(dt) {
    for (const g of booms) {
      const u = g.userData;
      if (u.t >= 1.0) { g.visible = false; continue; }
      u.t += dt; const k = u.t, r = u.r;
      const e = 1 - (1 - Math.min(1, k / 0.18)) ** 3;
      u.core.scale.setScalar(r * (0.25 + 0.5 * e));
      u.core.material.opacity = Math.max(0, 1 - k / 0.4);
      u.core.material.color.setHex(u.nitro ? 0xc8ffb0 : 0xfff09a);
      u.ball.scale.setScalar(r * (0.35 + 0.75 * (1 - (1 - Math.min(1, k / 0.5)) ** 2)));
      u.ball.material.opacity = k < 0.2 ? 0.95 : Math.max(0, 0.95 - (k - 0.2) / 0.5);
      u.ball.material.color.setHex(u.nitro ? 0x3ad65a : 0xff7a1f).lerp(_c.setHex(0x55505a), Math.min(1, Math.max(0, (k - 0.15) / 0.45)));
      u.ring.scale.setScalar(r * (0.4 + 1.9 * Math.min(1, k / 0.45)));
      u.ring.material.opacity = Math.max(0, 1 - k / 0.45);
      u.ring.position.y = -0.35;
      const ws = k < 0.12 ? (k / 0.12) * 1.25 : k < 0.2 ? 1.25 - (k - 0.12) / 0.08 * 0.25 : 1;
      u.word.scale.set(3.2 * ws, 1.6 * ws, 1); u.word.position.y = r * 0.6 + 0.8 + k * 0.8;
      u.word.material.opacity = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
      if (k >= 1.0) g.visible = false;
    }
  }

  // ---------------------------------------------------------------- attach
  let bombSnd = new Map(), lockT = 0, roulT = 0, lastLock = 0, lastTnt = false, debugGive = null, refill = false;
  function attach(r) {
    race = r; P = r.player; t = 0;
    for (const [, h] of bombSnd) h.stop?.(0.05);
    bombSnd = new Map(); flyers.length = 0; lastLock = 0; lastTnt = false;
    if (Q.get('items') === '0') { W = null; buildInstances(); buildPerKart(0); return null; }
    W = createItems(r, { seed: (r.seed ?? 1) + 11 });
    r.ui = r.ui || [];
    buildInstances();
    buildPerKart(r.karts.length);
    if (Q.has('stars') && P) P.stars = Math.max(0, Math.min(10, +Q.get('stars') | 0));
    debugGive = Q.get('give'); refill = Q.get('refill') === '1';
    if (typeof window !== 'undefined' && window.__OTR) { window.__OTR.items = W; window.__OTR.itemViews = api; }
    // warm-up: make one of everything visible so renderer.compileAsync() compiles every item
    // material now (the first rocket must not hitch). update() hides the unused ones again.
    for (const list of [bombs, rockets, crates, flyCrates, puddles, shots, warps, booms]) list[0].visible = true;
    crates[1].material = M.nitro; crates[1].visible = true;
    const pk = perKart[0]; if (pk) for (const o of Object.values(pk)) if (o?.isObject3D) o.visible = true;
    booms[0].userData.t = 0.99;
    return W;
  }

  // ---------------------------------------------------------------- per-step events
  const push = (u) => { if (race?.ui) race.ui.push(u); };
  function step(events, ff = false) {
    if (!W) return;
    for (const e of events) {
      if (e.type === 'go' && debugGive && P) giveDebug();
      if (e.type !== 'item') continue;
      if (ff) continue;
      const k = e.kart, me = k && k === P;
      const at = e.pos || (k && !me ? k.pos : null);
      const near = !at || !P || (at.x - P.pos.x) ** 2 + (at.z - P.pos.z) ** 2 < 90 * 90;
      if (!near) continue;
      const vol = me ? 1 : 0.6;
      switch (e.e) {
        case 'box':
          au.play('item_box', { vol, at: me ? null : e.pos });
          if (fx) { fx.burst('sparkle', { x: e.pos.x, y: e.pos.y + 0.8, z: e.pos.z }, { n: 14, color: 0xffffff }); fx.burst('turbo', { x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z }, { n: 12, color: [0xff5d73, 0x4ec5f1, 0x7ed957, 0xffd23f, 0xb54dff][(t * 10 | 0) % 5] }); }
          break;
        case 'got': if (me) { au.play('item_get'); const vo = ITEMS[e.item]?.vo; if (vo) au.play(vo); } break;
        case 'star':
          au.play('star', { vol: me ? 0.9 : 0.4, at: me ? null : e.pos });
          fx?.burst('sparkle', { x: e.pos.x, y: e.pos.y + 0.9, z: e.pos.z }, { n: 8, color: 0xffd23f });
          break;
        case 'super': if (me) { au.play('vo_ten_stars'); fx?.burst('sparkle', k.pos, { n: 30, color: 0xffd23f }); } break;   // hud.js shows the callout
        case 'spill': au.play('star_spill', { vol, at: me ? null : e.pos }); break;
        case 'use': useFx(e, me, vol); break;
        case 'hit':
          if (me) {
            chase?.shake(e.kind === 'flip' ? 0.6 : e.kind === 'spin' ? 0.3 : 0.15);
            if (e.item !== 'remote') push({ text: HIT_TEXT[e.item] || 'OUCH!', cls: 'bad', ms: 1200, kart: P });
            if (e.kind === 'flip') au.play('vo_ouch');
          }
          if (e.by === P && !me && e.item !== 'remote') au.play('vo_nice_shot');                  // hud.js: "GOT 'EM!"
          if (e.kind !== 'wobble') au.bark?.(k.racerId, 'hit', { at: me ? null : k.pos });
          break;
        case 'blocked':
          fx?.burst('sparkle', k.pos, { n: 14, color: e.why === 'star' ? 0xffd23f : 0x8fe3ff });
          break;
        case 'explode': {
          const nitro = e.item === 'nitro';
          au.play(nitro ? 'nitro' : 'explode', { vol: 1, at: e.pos });
          if (e.item === 'rocket' || e.item === 'tnt' || e.r > 0) boom(e.pos, e.r > 0 ? e.r : 2.4, { item: e.item, big: e.big });
          else boom(e.pos, 2.4, { item: e.item });
          if (P && e.pos) { const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z); if (d < 20) chase?.shake(0.55 * (1 - d / 20)); }
          break;
        }
        case 'lock': if (k === P) { au.play('rocket_lock'); lockT = 0; } break;
        case 'tnt_on': au.play('tnt_on_head', { vol, at: me ? null : k.pos }); if (me) au.bark?.(k.racerId, 'hit'); break;
        case 'tnt_tick': au.play('tnt_tick', { vol: me ? 1 : 0.5, at: me ? null : k.pos, rate: e.n === 1 ? 1.25 : 1 }); break;
        case 'tnt_hop': if (me) au.play('roulette', { rate: 0.6 + e.n * 0.15, vol: 0.8 }); break;
        case 'tnt_off':
          if (e.why === 'shaken') {
            au.play('bump', { vol, at: me ? null : k.pos });
            const v = visuals()[k.index];
            flyers.push({ x: v?.ix ?? k.pos.x, y: (v?.iy ?? k.pos.y) + 1.5, z: v?.iz ?? k.pos.z, vx: (Math.random() - 0.5) * 6, vy: 7, vz: (Math.random() - 0.5) * 6, t: 0, spin: Math.random() * 10 });
          }
          break;
        case 'remote':
          au.play('remote'); au.play('vo_kingdad_remote');
          // hud.js shows e.text ("KING DAD PRESSED PAUSE!") from the item event itself
          chase?.shake(0.2);
          break;
        case 'splat':
          au.play('splat', { vol, at: me ? null : e.pos });
          if (fx) fx.burst('turbo', { x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z }, { n: 16, color: 0xff7eb6 });
          if (me) chase?.shake(0.25);
          break;
        case 'fizzle': fx?.burst('poof', e.pos, { n: 10 }); break;
        case 'warp_hit': fx?.burst('sparkle', e.pos, { n: 24, color: 0xb49bff }); au.play('explode', { vol: 0.6, at: e.pos }); break;
        case 'shield_up': au.play('shield_up', { vol, at: me ? null : k.pos }); break;
        case 'shield_fire': au.play('shield_pop', { vol, at: me ? null : k.pos }); au.play('rocket', { vol: vol * 0.5, rate: 1.4, at: me ? null : k.pos }); break;
        case 'super_star': au.play('super_star', { vol, at: me ? null : k.pos }); au.play('meow', { vol: vol * 0.8, at: me ? null : k.pos }); fx?.burst('sparkle', k.pos, { n: 30, color: 0xffd23f }); break;
        case 'turbo': fx?.burst('turbo', k.pos, { n: 26, color: 0xb54dff }); break;
      }
    }
  }
  function useFx(e, me, vol) {
    const k = e.kart, at = me ? null : k.pos;
    switch (e.item) {
      case 'taco_bomb': au.bark?.(k.racerId, 'item', { at }); break;
      case 'rocket': au.play('rocket', { vol, at }); fx?.burst('poof', k.pos, { n: 8 }); break;
      case 'tnt': case 'nitro': case 'icecream': au.play('tnt_drop', { vol, at, rate: e.item === 'icecream' ? 1.3 : 1 }); break;
      case 'turbo': au.play('turbo3', { vol, at }); au.bark?.(k.racerId, 'boost', { at }); break;
      case 'remote': if (k.racerId === 'kingdad') au.bark?.('kingdad', 'item', { at, force: true }); break;
      case 'warp': au.play('warp', { vol, at }); break;
    }
  }
  function giveDebug() {
    if (!W || !P || !debugGive) return;
    if (debugGive === 'nitro') { P.stars = 10; W.give(P, 'tnt'); } else if (ITEMS[debugGive]) W.give(P, debugGive);
  }

  // ---------------------------------------------------------------- per-frame update
  const _hp = new THREE.Vector3();
  function update(dt, alpha = 1) {
    if (!W || !race) { root.visible = false; return; }
    root.visible = true;
    t += dt;
    const V = visuals();
    const lerp = (a, b) => a + (b - a) * alpha;
    if (refill && debugGive && P && race.phase === 'race' && !P.item && P.roulT <= 0 && !(P.bomb && P.bomb.alive)) giveDebug();
    updateInstances();

    // ---- projectiles
    let nb = 0, nr = 0, ns = 0, nw = 0;
    const liveBombs = new Set();
    for (const p of W.projs) {
      if (!p.alive) continue;
      const x = lerp(p.px, p.x), y = lerp(p.py, p.y), z = lerp(p.pz, p.z);
      if (p.kind === 'taco_bomb' && nb < bombs.length) {
        const m = bombs[nb++]; m.visible = true;
        m.position.set(x, y - IT.BOMB.y, z); m.rotation.set(0, p.yaw, Math.sin(p.t * 18) * 0.28);
        m.scale.setScalar(p.super ? 1.5 : 1.2);
        if (fx && Math.random() < 0.5) fx.burst('sparkle', { x: x + Math.sin(p.t * 18) * 0.3, y: y + 0.55, z }, { n: 1, color: 0xffb030 });
        liveBombs.add(p.id);
        let h = bombSnd.get(p.id);
        if (!h) { h = au.play('bomb_roll', { loop: true, vol: 0.8, at: { x, y, z } }); bombSnd.set(p.id, h); }
        else h.set?.({ at: { x, y, z } });
      } else if (p.kind === 'rocket' && nr < rockets.length) {
        const m = rockets[nr++]; m.visible = true;
        m.position.set(x, y, z); m.rotation.set(0, p.yaw, Math.sin(p.t * 14) * 0.25); m.scale.setScalar(1.45);
        m.userData.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
        if (fx) { fx.burst('turbo', { x: x - Math.sin(p.yaw) * 1.1, y: y - 0.5, z: z - Math.cos(p.yaw) * 1.1 }, { n: 1, color: 0xff9a2a }); if (Math.random() < 0.35) fx.burst('poof', { x: x - Math.sin(p.yaw) * 1.3, y: y - 0.3, z: z - Math.cos(p.yaw) * 1.3 }, { n: 1 }); }
      } else if (p.kind === 'shield_shot' && ns < shots.length) {
        const m = shots[ns++]; m.visible = true;
        m.position.set(x, y + 0.2, z); m.scale.setScalar(1.0 + Math.sin(p.t * 20) * 0.06);
        m.material.uniforms.uT.value = t; m.material.uniforms.uA.value = 1;
      } else if (p.kind === 'warp' && nw < warps.length) {
        const g = warps[nw++]; g.visible = true;
        g.position.set(x, y + 0.3, z); g.rotation.set(0, p.yaw, 0);
        g.userData.star.rotation.set(0, 0, p.t * 9);
        g.children[1].material.opacity = 0.75 + Math.sin(p.t * 30) * 0.25;
        if (fx) fx.burst('sparkle', { x, y: y - 0.2, z }, { n: 2, color: [0xb49bff, 0x8fe3ff, 0xff8ad8, 0xffd23f][(p.t * 20 | 0) % 4] });
      }
    }
    for (const [id, h] of bombSnd) if (!liveBombs.has(id)) { h.stop?.(0.08); bombSnd.delete(id); }
    for (let i = nb; i < bombs.length; i++) bombs[i].visible = false;
    for (let i = nr; i < rockets.length; i++) rockets[i].visible = false;
    for (let i = ns; i < shots.length; i++) shots[i].visible = false;
    for (let i = nw; i < warps.length; i++) warps[i].visible = false;

    // ---- hazards (+ crates on heads, + flyers)
    let nc = 0, np = 0;
    for (const h of W.hazards) {
      if (!h.alive) continue;
      if (h.kind === 'puddle') {
        if (np >= puddles.length) continue;
        const m = puddles[np++]; m.visible = true;
        const grow = Math.min(1, h.t / 0.25);
        m.position.set(h.x, h.y + 0.16, h.z); m.rotation.set(0, h.id * 2.39, 0);
        m.scale.setScalar(h.r * 1.2 * (0.4 + 0.6 * grow));
      } else {
        if (nc >= crates.length) continue;
        const m = crates[nc++]; m.visible = true; m.material = h.kind === 'nitro' ? M.nitro : M.tnt;
        m.position.set(h.x, h.y + 0.48 + h.drop, h.z);
        m.rotation.set(0, h.id * 1.3, 0);
        m.scale.setScalar(h.kind === 'nitro' ? 1 + Math.sin(t * 8) * 0.03 : 1);
      }
    }
    for (let i = np; i < puddles.length; i++) puddles[i].visible = false;

    // ---- per kart
    const K = race.karts;
    for (let i = 0; i < K.length && i < perKart.length; i++) {
      const k = K[i], pk = perKart[i], v = V[i];
      const shown = v && v.root && v.root.visible !== false && k.respawnT <= 0;
      const kx = v?.ix ?? k.pos.x, ky = v?.iy ?? k.pos.y, kz = v?.iz ?? k.pos.z;
      // shield bubble
      const sh = shown && k.shieldT > 0;
      pk.bubble.visible = sh;
      if (sh) {
        pk.bubble.position.set(kx, ky + 0.75, kz);
        pk.bubble.scale.set(1.45, 1.2, 1.6).multiplyScalar(1 + Math.sin(t * 6 + i) * 0.03);
        pk.bubble.material.uniforms.uT.value = t;
        pk.bubble.material.uniforms.uA.value = k.shieldT < 2 ? (Math.sin(t * 22) > 0 ? 1 : 0.35) : 1;
      }
      // TNT on the head
      if (k.tnt && shown) {
        const rig = v.rig;
        if (rig?.head) { rig.head.getWorldPosition(_hp); _hp.y += (rig.headH || 0.5) * (rig.size || 1) + 0.42; }
        else _hp.set(kx, ky + 1.9, kz);
        const m = pk.crate;
        {
          m.visible = true;
          const hop = k.tnt.hops, jig = Math.sin(t * 30) * 0.05 * (1 + hop * 0.3);
          m.position.set(_hp.x, _hp.y + Math.abs(Math.sin(t * 9)) * 0.08, _hp.z);
          m.rotation.set(jig, k.yaw + jig * 2, -jig);
          const pulse = k.tnt.t < 1 ? 1 + Math.abs(Math.sin(t * 16)) * 0.12 : 1;
          m.scale.setScalar(0.72 * pulse);
        }
        const n = Math.max(1, Math.min(3, Math.ceil(k.tnt.t)));
        pk.digit.material.map = T_.digits[n - 1];
        pk.digit.visible = true;
        const frac = k.tnt.t - Math.floor(k.tnt.t);
        const s = 1.1 + (frac > 0.8 ? (frac - 0.8) * 3 : 0);
        pk.digit.position.set(_hp.x, _hp.y + 1.0, _hp.z); pk.digit.scale.setScalar(s);
      } else { pk.crate.visible = false; pk.digit.visible = false; }
      // super star: Sootie's spirit orbits, golden aura, rainbow sparkles
      const inv = shown && k.invincT > 0;
      pk.spirit.visible = pk.halo.visible = pk.aura.visible = inv;
      if (inv) {
        const a = t * 3.2 + i, R = 1.7;
        const sx = kx + Math.cos(a) * R, sz = kz + Math.sin(a) * R, sy = ky + 1.7 + Math.sin(t * 5 + i) * 0.22;
        pk.spirit.position.set(sx, sy, sz);
        // she faces back at the chase camera (and so at the kid) with a little sway
        pk.spirit.rotation.set(Math.sin(t * 5) * 0.15, k.yaw + Math.PI + Math.sin(t * 2.3 + i) * 0.5, Math.sin(t * 4) * 0.12);
        pk.spirit.scale.setScalar(1.5);
        pk.halo.position.set(sx, sy + 0.1, sz); pk.halo.scale.setScalar(1.9 + Math.sin(t * 9) * 0.15);
        const fade = k.invincT < 1.5 ? (Math.sin(t * 20) > 0 ? 1 : 0.3) : 1;
        pk.halo.material.opacity = 0.85 * fade;
        pk.aura.position.set(kx, ky + 0.8, kz); pk.aura.scale.setScalar(3.6 + Math.sin(t * 7) * 0.3); pk.aura.material.opacity = 0.3 * fade;
        if (fx && Math.random() < 0.7) fx.burst('sparkle', { x: sx, y: sy - 0.3, z: sz }, { n: 1, color: [0xff5d73, 0xffd23f, 0x7ed957, 0x4ec5f1, 0xb54dff][(t * 12 | 0) % 5] });
      }
      // TV remote: a "pause" sign bobbing over everyone who's slowed
      const paused = shown && k.slowT > 0;
      pk.pause.visible = paused;
      if (paused) { pk.pause.position.set(kx, ky + 2.6 + Math.sin(t * 4 + i) * 0.1, kz); pk.pause.scale.setScalar(k.slowT < 0.6 ? k.slowT / 0.6 * 0.95 : 0.95); pk.pause.material.rotation = Math.sin(t * 6 + i) * 0.2; }
      // lock-on reticle over a homing target
      const locked = shown && k.lockedBy > 0;
      pk.reticle.visible = locked;
      if (locked) {
        pk.reticle.position.set(kx, ky + 1.1, kz);
        pk.reticle.material.rotation = t * 3;
        const close = isFinite(k.lockDist) ? Math.max(0, 1 - k.lockDist / 80) : 0;
        pk.reticle.scale.setScalar(2.6 - close * 0.8 + Math.sin(t * (8 + close * 12)) * 0.15);
      }
    }
    // crates shaken off: tumble away
    let nf = 0;
    for (let j = flyers.length - 1; j >= 0; j--) {
      const f = flyers[j]; f.t += dt; f.vy -= 30 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      if (f.t > 1.2) { fx?.burst('poof', f, { n: 8 }); flyers.splice(j, 1); continue; }
      if (nf >= flyCrates.length) continue;
      const m = flyCrates[nf++]; m.visible = true;
      m.position.set(f.x, f.y, f.z); m.rotation.set(f.t * f.spin, f.t * 5, f.t * 3); m.scale.setScalar(0.72);
    }
    for (let i = nf; i < flyCrates.length; i++) flyCrates[i].visible = false;
    for (let i = nc; i < crates.length; i++) crates[i].visible = false;

    stepBooms(dt);

    // ---- player-facing: roulette ticks, lock-on beeps, HUD warnings
    if (P) {
      if (P.roulT > 0) {
        roulT -= dt;
        if (roulT <= 0) { au.play('roulette', { vol: 0.7 }); roulT = 0.07 + 0.12 * (1 - P.roulT / (P.roulDur || IT.ROULETTE)) ** 2; }
      } else roulT = 0;
      const lk = P.lockedBy > 0 && !P.finished;
      if (lk) {
        lockT -= dt;
        if (lockT <= 0) { au.play('rocket_lock', { vol: 0.8 }); lockT = Math.max(0.16, Math.min(0.7, (isFinite(P.lockDist) ? P.lockDist : 80) / 110)); }
      }
      // (the flashing "ROCKET!" / "HOP! HOP!" warnings are hud.js's, from P.lockedBy / P.tnt)
    }
  }

  function detach() {
    for (const [, h] of bombSnd) h.stop?.(0.05);
    bombSnd = new Map(); flyers.length = 0;
    W = null; race = null; P = null; root.visible = false;
  }
  const api = {
    attach, detach, step, update, boom,
    get world() { return W; },
    get group() { return root; },
    /** debug: count of visible item objects (draw-call budget checks) */
    info() { let n = 0; root.traverse(o => { if ((o.isMesh || o.isSprite) && o.visible) n++; }); return { objects: n, boxes: W?.boxes.length ?? 0, stars: W?.stars.length ?? 0 }; },
  };
  return api;
}
