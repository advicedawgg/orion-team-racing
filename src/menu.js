// menu.js — every screen that isn't the race: title, main menu, character select, track select,
// results, Orion Cup standings + podium + unlock, pause, settings, controls help. UI agent owns.
//
// main.js calls initMenu(api, { skip }) once at boot (api = G, Q, scene, renderer, audio, hud, In, R,
// loadTrack, startRace, endRace, setState, onState, advance). This module never imports main.js (no
// import cycle); it drives the game only through that api and main's onState() states:
//   title (every menu screen) → countdown → race → finished → results.
// Screens are DOM in #ui (CSS in ui.css). One small three.js "stage" renderer (its own canvas) draws
// the character-select turntable, the podium and the title fallback line-up.
//
// Input: menus read the keyboard (keydown) and the Gamepad API themselves, with their own edge
// detection — input.js's `confirm` merges A/B/Enter/Space, and a menu needs B = back. Touch/mouse
// = tap. Every focusable element has [data-nav]; arrows move spatially between them.
//
// URL: ?screen=title|menu|select|tracks|results|standings|podium|unlock|pause|settings|controls
// jumps straight to a screen (screenshots). ?skip=1 etc. still go straight into a race.
import * as THREE from 'three';
import * as S from './save.js';
import { portraitURL, racerName, racerColor, clock, ordSuffix, racersReady } from './hud.js';
import { TRACKS } from './tracks/index.js';

let HDM = null;
const hdp = import('./hdracers.js').then(m => { HDM = m; }).catch(() => { /* optional */ });

export const CUP_ORDER = ['beach', 'ice', 'volcano', 'castle'];
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const DIFFS = ['easy', 'medium', 'hard'];
const DIFF_LABEL = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };
const isSecret = t => !!t.secret || t.id === 'star';
const trackDef = id => TRACKS.find(t => t.id === id);
const THEME_COL = { beach: ['#36c2f0', '#ffd98a'], ice: ['#bfe9ff', '#ff9ed8'], volcano: ['#ff6a2a', '#5a1a10'], castle: ['#9b7bd8', '#3a2f6a'], star: ['#2a1a6a', '#ff6fff'] };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cheers = ["You're awesome!", 'Great racing!', 'What a driver!', 'Super zooming!', 'Brilliant driving!', 'You did it!'];
const pick = a => a[(Math.random() * a.length) | 0];

/* ------------------------------------------------------------------ SVG pictures (emoji don't render everywhere) */
const FACE = {
  easy: `<svg viewBox="0 0 64 64" class="face"><circle cx="32" cy="34" r="26" fill="#6ff08f" stroke="#1d5a2c" stroke-width="4"/><circle cx="23" cy="29" r="4" fill="#1d3a24"/><circle cx="41" cy="29" r="4" fill="#1d3a24"/><path d="M19 40q13 12 26 0" fill="none" stroke="#1d3a24" stroke-width="4.5" stroke-linecap="round"/><circle cx="16" cy="39" r="4" fill="#ff9aa8" opacity=".7"/><circle cx="48" cy="39" r="4" fill="#ff9aa8" opacity=".7"/></svg>`,
  medium: `<svg viewBox="0 0 64 64" class="face"><circle cx="32" cy="34" r="26" fill="#ffd23f" stroke="#7a5200" stroke-width="4"/><path d="M12 27h40v4q-2 9-10 9t-9-8h-2q-1 8-9 8t-10-9z" fill="#1b1b2a"/><path d="M17 30l6-2" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M36 30l6-2" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M22 47q10 5 21-3" fill="none" stroke="#3a2600" stroke-width="4.5" stroke-linecap="round"/></svg>`,
  hard: `<svg viewBox="0 0 64 64" class="face"><path d="M20 16q-2-10 6-14 0 7 6 8 1-7 8-9-2 8 4 12 3-5 6-4-2 6 0 10z" fill="#ffb02e" stroke="#b33a00" stroke-width="2.5"/><circle cx="32" cy="36" r="24" fill="#ff5d4a" stroke="#6a1200" stroke-width="4"/><path d="M17 26l11 5M47 26l-11 5" stroke="#3a0800" stroke-width="4.5" stroke-linecap="round"/><circle cx="24" cy="35" r="3.6" fill="#3a0800"/><circle cx="40" cy="35" r="3.6" fill="#3a0800"/><path d="M20 44q12 10 24 0z" fill="#fff" stroke="#3a0800" stroke-width="3.5" stroke-linejoin="round"/></svg>`,
};
const ICON = {
  flag: `<svg viewBox="0 0 64 64"><path d="M14 58V6" stroke="#fff6e0" stroke-width="5" stroke-linecap="round"/><path d="M16 8h38v28H16z" fill="#fff"/><path d="M16 8h9.5v7H16zM35 8h9.5v7H35zM25.5 15H35v7h-9.5zM44.5 15H54v7h-9.5zM16 22h9.5v7H16zM35 22h9.5v7H35zM25.5 29H35v7h-9.5zM44.5 29H54v7h-9.5z" fill="#1b1b2a"/></svg>`,
  cup: `<svg viewBox="0 0 64 64"><path d="M18 6h28v14a14 14 0 0 1-28 0z" fill="#ffd23f" stroke="#8a5a00" stroke-width="3"/><path d="M18 11H8q0 13 12 14M46 11h10q0 13-12 14" fill="none" stroke="#ffd23f" stroke-width="4.5"/><path d="M28 33h8v10h-8z" fill="#e2a91e"/><path d="M18 45h28l3 11H15z" fill="#ffd23f" stroke="#8a5a00" stroke-width="3"/><path d="M32 11l2.4 5 5.4.6-4 3.7 1.1 5.3L32 23l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" fill="#fff6c0"/></svg>`,
  clock: `<svg viewBox="0 0 64 64"><circle cx="32" cy="36" r="23" fill="#fff" stroke="#4ec5f1" stroke-width="6"/><path d="M26 6h12M32 6v7M50 15l4-4" stroke="#fff6e0" stroke-width="5" stroke-linecap="round"/><path d="M32 36V21M32 36l9 6" stroke="#1b1b2a" stroke-width="5" stroke-linecap="round"/></svg>`,
  gear: `<svg viewBox="0 0 64 64"><path d="M27 4h10l1.6 7.6 5.4 2.3 6.5-4.3 7 7-4.3 6.5 2.3 5.4L63 30v10l-7.6 1.6-2.3 5.4 4.3 6.5-7 7-6.5-4.3-5.4 2.3L37 66H27l-1.6-7.6-5.4-2.3-6.5 4.3-7-7 4.3-6.5-2.3-5.4L1 40V30l7.6-1.6 2.3-5.4-4.3-6.5 7-7 6.5 4.3 5.4-2.3z" transform="translate(0 -3)" fill="#b7c4ea" stroke="#3d4d8f" stroke-width="3"/><circle cx="32" cy="32" r="10" fill="#232e5c"/></svg>`,
  lock: `<svg viewBox="0 0 64 64"><path d="M20 28v-8a12 12 0 0 1 24 0v8" fill="none" stroke="#dce6ff" stroke-width="7"/><rect x="12" y="27" width="40" height="31" rx="7" fill="#ffd23f" stroke="#8a5a00" stroke-width="3"/><circle cx="32" cy="40" r="4.5" fill="#5a3a00"/><path d="M32 42v8" stroke="#5a3a00" stroke-width="4.5" stroke-linecap="round"/></svg>`,
  ghost: `<svg viewBox="0 0 64 64"><path d="M12 58V30a20 20 0 0 1 40 0v28l-7-6-6 6-7-6-7 6-6-6z" fill="#dff4ff" opacity=".9"/><circle cx="25" cy="30" r="4" fill="#233"/><circle cx="39" cy="30" r="4" fill="#233"/></svg>`,
};
// gamepad button glyph / keyboard key / touch glyph for the controls screen
const PAD = (t, cls = '') => `<span class="pad ${cls}">${t}</span>`;
const KEY = t => `<kbd>${t}</kbd>`;
const TCH = t => `<span class="tch">${t}</span>`;

/* ------------------------------------------------------------------ module state */
let api = null, root = null, cur = null;
const M = {
  screen: null, mode: 'quick', diff: 'easy', racer: 'orion', track: 'beach',
  cup: null, lastResults: null, resultsShown: false, finishTimer: 0, ghost: null, rec: null, record: null,
  focusMem: {}, pauseFrom: null, settingsFrom: 'menu', pendingUnlock: false,
};

/* ================================================================== stage (3D preview renderer) */
const stage = (() => {
  let r = null, scene, cam, canvas, mode = null, t = 0, actors = [], extra = null, w = 0, h = 0, hopT = 2.2;
  const mats = [];
  function init() {
    canvas = document.createElement('canvas'); canvas.className = 'stage-cv';
    r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    r.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x806a58, 1.5));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.6); key.position.set(3, 6, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xa8d0ff, 1.6); rim.position.set(-4, 3, -4); scene.add(rim);
    cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  }
  function clear() {
    for (const a of actors) { scene.remove(a.root); try { api.R.disposeTree?.(a.root); } catch { /* shared mats */ } }
    actors = [];
    if (extra) { scene.remove(extra); extra.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); extra = null; }
    for (const m of mats.splice(0)) { m.map?.dispose(); m.dispose(); }
  }
  function actor(id, x = 0, y = 0, z = 0, ry = 0, extraS = {}) {
    let b = null;
    try { b = api.R.buildRacer(id, { hd: !!S.settings().hd && !!HDM?.hasHD?.(id) }); } catch (e) { console.warn('[menu] buildRacer', id, e); }
    if (!b) return null;
    b.root.position.set(x, y, z); b.root.rotation.y = ry;
    scene.add(b.root);
    const a = { id, root: b.root, rig: b.rig, y0: y, phase: Math.random() * 6, s: { speed: 0, maxSpeed: 22, steer: 0, throttle: 0, drift: 0, driftAngle: 0, charge: 0, boostT: 0, air: false, airT: 0, landT: 9, hitT: 0, hitKind: null, spinT: 0, cheer: false, sad: false, t: 0, ...extraS } };
    actors.push(a);
    return a;
  }
  const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };
  function numTex(n, bg) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
    g.font = '900 96px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeText(n, 64, 70); g.fillStyle = '#fff'; g.fillText(n, 64, 70);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  }
  function turntable(rad = 1.9, col = 0x3d4d8f) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.04, 0.22, 48), mat({ color: col, roughness: .5, metalness: .2 }));
    top.position.y = -0.11; g.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.06, 8, 64), mat({ color: 0xffd23f, emissive: 0x6a4a00, roughness: .3 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.0; g.add(ring);
    return g;
  }
  function trophy() {
    const g = new THREE.Group();
    const gold = mat({ color: 0xffc83a, metalness: .85, roughness: .22, emissive: 0x5a3a00, emissiveIntensity: .35 });
    const pts = [[0, 0], [.42, 0], [.42, .1], [.16, .16], [.12, .42], [.1, .55], [.2, .62], [.46, .84], [.56, 1.25], [.52, 1.3], [0, 1.3]].map(([x, y]) => new THREE.Vector2(x, y));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 32), gold));
    for (const s of [-1, 1]) { const hdl = new THREE.Mesh(new THREE.TorusGeometry(.2, .05, 8, 20, Math.PI * 1.2), gold); hdl.position.set(s * .56, 1.02, 0); hdl.rotation.z = s > 0 ? -Math.PI * .6 : Math.PI * 1.6; g.add(hdl); }
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(.16, 0), mat({ color: 0xffffff, emissive: 0xfff2a0, emissiveIntensity: 1 }));
    star.position.y = 1.5; star.name = 'tstar'; g.add(star);
    return g;
  }
  return {
    get canvas() { return canvas; },
    mount(slot) { if (!r) init(); if (slot && canvas.parentElement !== slot) slot.appendChild(canvas); },
    one(id) {
      if (!r) init();
      clear(); mode = 'one'; hopT = 2.2;
      extra = new THREE.Group(); extra.add(turntable()); scene.add(extra);
      actor(id, 0, 0, 0, 0.5);
      cam.fov = 30; cam.position.set(0, 1.9, 5.4); cam.lookAt(0, 0.7, 0); cam.userData.look = [0, 0.7, 0];
    },
    cheer() { const a = actors[0]; if (a) { a.cheerT = 2.4; } },
    podium(order, playerId) {
      if (!r) init();
      clear(); mode = 'podium';
      extra = new THREE.Group(); scene.add(extra);
      const ground = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 0.2, 48), mat({ color: 0x3d4d8f, roughness: .8 }));
      ground.position.y = -0.1; extra.add(ground);
      const spots = [[0, 1.5, 0xffd23f, '1'], [-2.5, 1.0, 0xcfd8ea, '2'], [2.5, 0.6, 0xff9d4a, '3']];
      spots.forEach(([x, hgt, col, n], i) => {
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.3, hgt, 2.3), [mat({ color: col, roughness: .45 }), mat({ color: col, roughness: .45 }), mat({ color: col, roughness: .45 }), mat({ color: col, roughness: .45 }), mat({ map: numTex(n, '#' + new THREE.Color(col).getHexString()), roughness: .5 }), mat({ color: col, roughness: .45 })]);
        box.position.set(x, hgt / 2, 0); extra.add(box);
        if (order[i]) actor(order[i], x, hgt, 0, 0, { cheer: true });
      });
      const tr = trophy(); tr.position.set(0, 3.9, 0.2); tr.name = 'trophy'; extra.add(tr);
      // everyone else on the floor either side — the player always cheers, never sulks
      const rest = order.slice(3);
      rest.forEach((id, i) => {
        const side = i % 2 ? 1 : -1, k = (i >> 1);
        const x = side * (4.9 + k * 1.9), z = 0.9 + k * 0.5;
        actor(id, x, 0, z, -side * 0.45, { cheer: id === playerId, sad: id !== playerId && i >= 3 });
      });
      cam.fov = 38; cam.position.set(0, 3.4, 14); cam.lookAt(0, 2.3, 0); cam.userData.look = [0, 2.3, 0];
    },
    lineup(ids) {
      if (!r) init();
      clear(); mode = 'lineup';
      ids.forEach((id, i) => actor(id, (i - (ids.length - 1) / 2) * 1.9, 0, -Math.abs(i - (ids.length - 1) / 2) * .35, 0.25 - i * 0.07));
      cam.fov = 32; cam.position.set(0, 2.4, 15); cam.lookAt(0, 0.8, 0); cam.userData.look = [0, 0.8, 0];
    },
    clear() { clear(); mode = null; },
    render(dt) {
      if (!r || !canvas.isConnected || !mode) return;
      const pw = canvas.clientWidth | 0, ph = canvas.clientHeight | 0;
      if (!pw || !ph) return;
      if (pw !== w || ph !== h) { w = pw; h = ph; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
      t += dt;
      if (mode === 'one') {
        const a = actors[0];
        if (extra) extra.rotation.y = 0;
        if (a) {
          a.root.rotation.y = 0.5 + Math.sin(t * 0.6) * 0.75;
          hopT -= dt;
          const s = a.s; s.t = t; s.steer = Math.sin(t * 1.7) * 0.5; s.throttle = 0.5 + 0.5 * Math.sin(t * 3.1);
          a.cheerT = Math.max(0, (a.cheerT || 0) - dt); s.cheer = a.cheerT > 0;
          if (hopT < 0 && !s.cheer) { hopT = 2.6; a.hop = 0; }
          if (a.hop != null) { a.hop += dt; const u = a.hop / 0.42; s.air = u < 1; a.root.position.y = u < 1 ? Math.sin(u * Math.PI) * 0.45 : 0; if (u >= 1) { a.hop = null; s.landT = 0; } }
          s.landT += dt;
        }
      } else if (mode === 'podium') {
        const tr = extra?.getObjectByName('trophy');
        if (tr) { tr.rotation.y = t * 1.2; tr.position.y = 3.9 + Math.sin(t * 2) * 0.12; }
        cam.position.x = Math.sin(t * 0.25) * 2.2; cam.lookAt(...cam.userData.look);
      } else if (mode === 'lineup') {
        actors.forEach((a, i) => { a.root.position.y = Math.max(0, Math.sin(t * 4 + i * 0.9)) * 0.25; a.s.air = a.root.position.y > 0.02; });
      }
      for (const a of actors) {
        a.s.t = t + a.phase;
        if (mode !== 'one') { a.s.steer = Math.sin(t * 1.3 + a.phase) * 0.3; a.s.throttle = 0.5; }
        try { api.R.animateRacer?.(a.rig, a.s, dt); } catch { /* keep the menu alive */ }
      }
      r.render(scene, cam);
    },
  };
})();

/* ================================================================== confetti (2D overlay) */
const confetti = (() => {
  let cv = null, g = null, parts = [], rainT = 0;
  const COLS = ['#ffd23f', '#ff5d73', '#4ec5f1', '#6ff08f', '#b54dff', '#ff9d2f', '#ffffff'];
  function ensure() {
    if (cv) return;
    cv = document.createElement('canvas'); cv.id = 'confetti'; document.body.appendChild(cv); g = cv.getContext('2d');
  }
  function spawn(x, y, vx, vy) { parts.push({ x, y, vx, vy, r: Math.random() * 6, vr: (Math.random() - .5) * 12, w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, c: COLS[(Math.random() * COLS.length) | 0], life: 5 }); }
  return {
    burst(n = 120) { ensure(); const W = innerWidth, H = innerHeight; for (let i = 0; i < n; i++) spawn(W * (0.2 + Math.random() * 0.6), H * 0.35, (Math.random() - .5) * 900, -300 - Math.random() * 700); },
    rain(secs = 4) { ensure(); rainT = Math.max(rainT, secs); },
    stop() { rainT = 0; parts = []; if (g) g.clearRect(0, 0, cv.width, cv.height); },
    update(dt) {
      if (!cv) return;
      if (rainT > 0) { rainT -= dt; const W = innerWidth; for (let i = 0; i < 90 * dt; i++) spawn(Math.random() * W, -20, (Math.random() - .5) * 80, 60 + Math.random() * 120); }
      if (!parts.length) { if (cv.width) { cv.width = 0; } return; }
      if (cv.width !== innerWidth || cv.height !== innerHeight) { cv.width = innerWidth; cv.height = innerHeight; }
      g.clearRect(0, 0, cv.width, cv.height);
      const sc = Math.max(0.7, Math.min(innerWidth, innerHeight) / 700);
      parts = parts.filter(p => (p.life -= dt) > 0 && p.y < innerHeight + 40);
      for (const p of parts) {
        p.vy += 520 * dt; p.vx *= 1 - 1.6 * dt; p.vy = Math.min(p.vy, 260); p.x += p.vx * dt + Math.sin(p.r * 2) * 30 * dt; p.y += p.vy * dt; p.r += p.vr * dt;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(sc, Math.abs(Math.cos(p.r * 1.3)) * sc + 0.1);
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      }
    },
  };
})();

/* ================================================================== screen framework */
function mount(name, html, opts = {}) {
  unmount(false);
  const el = document.createElement('div');
  el.className = `scr scr-${name} ${opts.cls || ''}`;
  el.innerHTML = html;
  root.appendChild(el);
  root.className = 'on' + (opts.overlay ? ' overlay' : '');
  document.body.classList.add('menu-open');
  api.G.menuCovers = !opts.overlay;
  cur = { name, el, ...opts, focus: null, want: opts.focus };
  M.screen = name;
  el.addEventListener('click', e => {
    const d = e.target.closest('[data-d]');
    if (d && cur?.adj) { const row = d.closest('[data-nav]'); setFocus(row); cur.adj(row, +d.dataset.d); return; }
    const t = e.target.closest('[data-nav]');
    if (t && el.contains(t)) { setFocus(t, true); activate(t); }
  });
  el.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; const t = e.target.closest('[data-nav]'); if (t && t !== cur?.focus) setFocus(t, true); });
  opts.onShow?.(el);
  const mem = M.focusMem[name];
  const f = (typeof opts.focus === 'string' ? el.querySelector(opts.focus) : opts.focus) || (mem && el.querySelector(`[data-key="${mem}"]`)) || el.querySelector('[data-nav]');
  if (f) setFocus(f, true);
  if (opts.music !== undefined) api.audio.music(opts.music);
  return el;
}
function unmount(hide = true) {
  if (cur) { cur.onHide?.(); cur.el.remove(); cur = null; }
  if (hide) { root.className = ''; document.body.classList.remove('menu-open'); api.G.menuCovers = false; M.screen = null; }
}
function setFocus(t, silent) {
  if (!cur || !t) return;
  if (cur.focus === t) return;
  cur.focus?.classList.remove('focus');
  cur.focus = t; t.classList.add('focus');
  if (t.dataset.key) M.focusMem[cur.name] = t.dataset.key;
  if (!silent) sfx('menu_move');
  cur.onFocus?.(t);
}
function activate(t) {
  if (!cur || !t) return;
  if (t.classList.contains('locked')) { sfx('menu_back'); t.classList.remove('nope'); void t.offsetWidth; t.classList.add('nope'); return; }
  const fn = cur.acts?.[t.dataset.act];
  if (fn) { if (!t.dataset.quiet) sfx('menu_ok'); fn(t); }
}
function goBack() { if (cur?.back) { sfx('menu_back'); cur.back(); } }
function move(dir) {
  if (!cur) return;
  const f = cur.focus;
  if (f && f.hasAttribute('data-adj') && (dir === 'left' || dir === 'right') && cur.adj) { cur.adj(f, dir === 'left' ? -1 : 1); return; }
  const els = [...cur.el.querySelectorAll('[data-nav]')].filter(e => e.offsetParent !== null);
  if (!els.length) return;
  if (!f) { setFocus(els[0]); return; }
  const a = f.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bs = Infinity;
  for (const e of els) {
    if (e === f) continue;
    const b = e.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    const prim = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const sec = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    // overlap on the other axis counts as "in line"
    const overl = dir === 'left' || dir === 'right' ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
    if (prim <= 2) continue;
    const sc = prim + (overl > 0 ? 0 : sec * 2.2);
    if (sc < bs) { bs = sc; best = e; }
  }
  if (!best && cur.wrap) {   // wrap vertically in lists
    const sorted = els.slice().sort((p, q) => p.getBoundingClientRect().top - q.getBoundingClientRect().top);
    if (dir === 'down') best = sorted[0]; else if (dir === 'up') best = sorted[sorted.length - 1];
  }
  if (best) setFocus(best);
}
const sfx = n => { try { api.audio.play(n); } catch { /* silent */ } };
const vo = n => { try { api.audio.play(n); } catch { /* silent */ } };

/* ================================================================== input */
const pad = { prev: new Set(), rep: 0, repKey: null };
function action(a, repeat = false) {
  if (!cur) {
    // in a race: only pause
    if (a === 'pause' && inRace()) openPause();
    return;
  }
  if (repeat && (a === 'ok' || a === 'back' || a === 'pause')) return;
  if (cur.onAction && cur.onAction(a) === true) return;
  if (a === 'up' || a === 'down' || a === 'left' || a === 'right') move(a);
  else if (a === 'ok') activate(cur.focus);
  else if (a === 'back') goBack();
  else if (a === 'pause') { if (cur.name === 'pause') resume(); else if (cur.name === 'title') cur.acts.start(); }
}
const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'ok', Space: 'ok', KeyE: 'ok', NumpadEnter: 'ok', Escape: 'back', Backspace: 'back', KeyP: 'pause' };
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  let a = KEYS[e.code];
  if (!a) return;
  if (!cur) { if (e.code === 'Escape' || e.code === 'KeyP') { if (inRace()) { e.preventDefault(); action('pause'); } } return; }
  if (cur.name === 'title') { e.preventDefault(); if (!e.repeat) cur.acts.start(); return; }
  if (e.code === 'Escape' && cur.name === 'pause') a = 'pause';
  e.preventDefault();
  action(a, e.repeat);
}
function pollPad(dt) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const now = new Set();
  for (const p of pads) {
    const b = i => !!p.buttons[i]?.pressed;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (b(12) || ay < -0.55) now.add('up');
    if (b(13) || ay > 0.55) now.add('down');
    if (b(14) || ax < -0.55) now.add('left');
    if (b(15) || ax > 0.55) now.add('right');
    if (b(0)) now.add('ok');
    if (b(1)) now.add('back');
    if (b(9)) now.add('pause');
  }
  for (const a of now) if (!pad.prev.has(a)) {
    if (!cur) { if (a === 'pause') action('pause'); }
    else if (cur.name === 'title' && (a === 'ok' || a === 'pause')) cur.acts.start();
    else action(a);
    if (['up', 'down', 'left', 'right'].includes(a)) { pad.repKey = a; pad.rep = 0.38; }
  }
  if (pad.repKey && now.has(pad.repKey) && cur) { pad.rep -= dt; if (pad.rep <= 0) { pad.rep = 0.13; action(pad.repKey, true); } }
  else if (pad.repKey && !now.has(pad.repKey)) pad.repKey = null;
  pad.prev = now;
}
const inRace = () => !!api.G.race && ['countdown', 'race', 'finished'].includes(api.G.state) && !cur;

/* ================================================================== helpers */
const racers = () => api.R.RACERS || [];
const cupTracks = () => CUP_ORDER.filter(id => trackDef(id));
const unlockedTracks = () => TRACKS.filter(t => !isSecret(t) || S.isUnlocked(t.id));
function trackCard(t, { locked = false, small = false, extraHtml = '' } = {}) {
  const [c1, c2] = THEME_COL[t.theme] || THEME_COL[t.id] || ['#4ec5f1', '#232e5c'];
  const b = S.best(t.id);
  return `<div class="tcard${locked ? ' locked' : ''}${small ? ' small' : ''}" data-nav data-act="track" data-id="${t.id}" data-key="t-${t.id}" style="--c1:${c1};--c2:${c2}">
    <div class="thumb"><img src="assets/ui/track_${t.id}.jpg" alt="" onerror="this.remove()">${locked ? `<div class="lockv">${ICON.lock}</div>` : ''}</div>
    <div class="tname">${locked ? '?????' : esc(t.name)}</div>
    ${locked ? `<div class="tsub">Win the Orion Cup!</div>` : (!small && b.lap ? `<div class="tsub">Best lap ${clock(b.lap)}</div>` : '')}
    ${extraHtml}
  </div>`;
}
function applyRaceSettings() {
  const s = S.settings(), G = api.G;
  G.difficulty = M.diff;
  G.racerId = M.racer;
  G.autoAccel = s.autoAccel === 'on' || (s.autoAccel === 'easy' && M.diff === 'easy');
  G.easyBoost = s.kidAssist ? true : undefined;
  if (!api.Q.has('hd')) G.hd = !!s.hd;
  G.solo = M.mode === 'tt';
  G.noItems = M.mode === 'tt';
  if (M.mode !== 'tt' && !api.Q.has('laps')) G.laps = undefined;
}
async function launch(trackId) {
  M.track = trackId;
  const d = S.get(); d.lastRacer = M.racer; d.lastTrack = trackId; S.save();
  applyRaceSettings();
  const t = trackDef(trackId) || TRACKS[0];
  mount('loading', `<div class="load">
      <div class="lcard">${trackCard(t, { small: false }).replace('data-nav', '')}</div>
      <div class="lget">GET READY!</div><div class="dots"><i></i><i></i><i></i></div></div>`, { cls: 'bg-dark', music: undefined });
  M.resultsShown = false; clearTimeout(M.finishTimer); confetti.stop();
  await new Promise(r => setTimeout(r, 30));       // let the loading card paint
  try {
    if (api.G.race) api.endRace();
    if (!api.G.track || api.G.track.id !== trackId) { await api.loadTrack(trackId); }
    api.G.trackId = trackId;
    await api.startRace();
  } catch (e) {
    console.error('[menu] could not start the race', e);
    showMenu();
  }
}

/* ================================================================== screens */
function showTitle() {
  const touch = document.body.classList.contains('touch');
  const sparks = Array.from({ length: 14 }, (_, i) => `<i class="spark" style="left:${(i * 37) % 100}%;top:${(i * 53) % 70 + 3}%;animation-delay:${(i * 0.37) % 2.4}s"></i>`).join('');
  mount('title', `
    <div class="art"><img src="assets/ui/title.jpg" alt="" id="titleArt"><div class="lines"></div>${sparks}</div>
    <div class="stage-slot" id="titleStage"></div>
    <a class="gamesq" href="https://orion.advicedawg.com/" data-quiet>◀ GAMES</a>
    <div class="tlogo">
      <img src="assets/ui/logo.png" alt="Orion Team Racing" id="titleLogo">
      <h1 class="txtlogo"><span class="o">ORION</span><span class="r">TEAM RACING</span></h1>
    </div>
    <div class="press">${touch ? 'TAP TO START!' : 'PRESS START!'}</div>`, {
    music: 'title', cls: 'title',
    acts: {
      start() {
        if (M.screen !== 'title') return;
        sfx('menu_ok'); vo('vo_title');
        showMenu();
      },
    },
    onShow(el) {
      if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') el.querySelector('.gamesq').href = '../';
      el.querySelector('.gamesq').addEventListener('click', e => e.stopPropagation());
      const logo = el.querySelector('#titleLogo');
      logo.onload = () => el.classList.add('haslogo');
      logo.onerror = () => logo.remove();
      const art = el.querySelector('#titleArt');
      art.onerror = () => { art.remove(); el.classList.add('noart'); stage.mount(el.querySelector('#titleStage')); stage.lineup(racers().map(r => r.id)); };
      el.addEventListener('pointerdown', e => { if (!e.target.closest('.gamesq')) cur?.acts?.start(); });
    },
  });
}

function showMenu(focusKey) {
  api.setState?.('title');
  const s = S.settings();
  M.diff = s.difficulty || 'easy';
  const wins = S.get().cupWins;
  const trophies = DIFFS.filter(d => wins[d] > 0).map(d => `<span class="troph ${d}" title="${d}">${ICON.cup}${wins[d] > 1 ? `<b>${wins[d]}</b>` : ''}</span>`).join('');
  const el = mount('menu', `
    <div class="mlogo"><img src="assets/ui/logo.png" alt="" onerror="this.remove()"><h1 class="txtlogo sm"><span class="o">ORION</span><span class="r">TEAM RACING</span></h1></div>
    <div class="mcol">
      <button class="mbtn big" data-nav data-act="quick" data-key="quick"><i>${ICON.flag}</i><span>QUICK RACE</span></button>
      <button class="mbtn" data-nav data-act="cup" data-key="cup"><i>${ICON.cup}</i><span>ORION CUP</span><em class="trophies">${trophies}</em></button>
      <button class="mbtn" data-nav data-act="tt" data-key="tt"><i>${ICON.clock}</i><span>TIME TRIAL</span></button>
      <button class="mbtn" data-nav data-act="settings" data-key="settings"><i>${ICON.gear}</i><span>SETTINGS</span></button>
    </div>
    <div class="diffs">
      ${DIFFS.map(d => `<button class="diff ${d}${d === M.diff ? ' sel' : ''}" data-nav data-act="diff" data-v="${d}" data-key="d-${d}">${FACE[d]}<span>${DIFF_LABEL[d]}</span></button>`).join('')}
    </div>`, {
    cls: 'bg-art', music: 'title', focus: focusKey ? `[data-key="${focusKey}"]` : null, wrap: true,
    acts: {
      quick() { M.mode = 'quick'; showSelect(); },
      cup() { M.mode = 'cup'; showSelect(); },
      tt() { M.mode = 'tt'; showSelect(); },
      settings() { M.settingsFrom = 'menu'; showSettings(); },
      diff(t) {
        M.diff = t.dataset.v; S.setSetting('difficulty', M.diff);
        cur.el.querySelectorAll('.diff').forEach(b => b.classList.toggle('sel', b === t));
      },
    },
    back() { showTitle(); },
  });
  return el;
}

function statBars(st) {
  const row = (lbl, v, cls) => `<div class="stat ${cls}"><span>${lbl}</span><div class="bar">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</div></div>`;
  return row('SPEED', st.speed, 'spd') + row('ZOOM', st.accel, 'acc') + row('TURN', st.turn, 'trn');
}
function showSelect() {
  const list = racers();
  if (!list.find(r => r.id === M.racer)) M.racer = S.get().lastRacer || 'orion';
  if (!list.find(r => r.id === M.racer)) M.racer = list[0]?.id;
  const title = { quick: 'QUICK RACE', cup: 'ORION CUP', tt: 'TIME TRIAL' }[M.mode];
  let el = null;
  el = mount('select', `
    <div class="shead"><h2>CHOOSE YOUR RACER!</h2><small>${title} · ${FACE[M.diff]} ${DIFF_LABEL[M.diff]}</small></div>
    <div class="sgrid">${list.map(r => `
      <button class="rtile" data-nav data-act="pick" data-id="${r.id}" data-key="${r.id}" style="--rc:${racerColor(r.id)}">
        <img src="${portraitURL(r.id, 128)}" alt=""><span>${esc(r.name)}</span></button>`).join('')}
    </div>
    <div class="spanel">
      <div class="stage-slot" id="selStage"></div>
      <div class="sinfo"><h3 id="sName"></h3><p id="sBlurb"></p><div class="stats" id="sStats"></div></div>
      <button class="gobtn" data-nav data-act="go" data-key="go">GO! ▶</button>
    </div>
    <button class="backbtn" data-nav data-act="back" data-key="back">◀ BACK</button>`, {
    cls: 'bg-dark', music: 'title', focus: `[data-key="${M.racer}"]`,
    onShow(el) {
      stage.mount(el.querySelector('#selStage'));
      racersReady.then(() => el.querySelectorAll('.rtile img').forEach((img, i) => { img.src = portraitURL(list[i].id, 128); }));
      setTimeout(() => vo('vo_choose'), 250);
    },
    onFocus(t) { if (t.dataset.id) preview(t.dataset.id); },
    acts: {
      pick(t) { preview(t.dataset.id); choose(); },
      go() { choose(); },
      back() { goBack(); },
    },
    back() { showMenu(M.mode === 'cup' ? 'cup' : M.mode === 'tt' ? 'tt' : 'quick'); },
  });
  preview(M.racer, true);
  function preview(id, force) {
    if (!el) return;
    if (id === M.racer && !force && el.dataset.shown === id) return;
    M.racer = id; el.dataset.shown = id;
    const r = list.find(x => x.id === id) || list[0];
    el.querySelector('#sName').textContent = r.name;
    el.querySelector('#sName').style.color = racerColor(id);
    el.querySelector('#sBlurb').textContent = r.blurb || '';
    el.querySelector('#sStats').innerHTML = statBars(r.stats || { speed: 3, accel: 3, turn: 3 });
    el.querySelectorAll('.rtile').forEach(b => b.classList.toggle('sel', b.dataset.id === id));
    stage.one(id);
  }
  let chosen = false;
  function choose() {
    if (chosen) return; chosen = true;
    stage.cheer();
    try { api.audio.bark?.(M.racer, 'win', { force: true }); } catch { /* */ }
    el.classList.add('chosen');
    setTimeout(() => {
      if (M.screen !== 'select') return;
      if (M.mode === 'cup') startCup();
      else showTracks();
    }, 750);
  }
}

function showTracks() {
  const vis = TRACKS.filter(t => !isSecret(t) || true);
  let focus = `[data-key="t-${M.track}"]`;
  if (!vis.find(t => t.id === M.track && (!isSecret(t) || S.isUnlocked(t.id)))) focus = null;
  mount('tracks', `
    <div class="shead"><h2>PICK A TRACK!</h2><small>${M.mode === 'tt' ? 'TIME TRIAL · race the clock' : 'QUICK RACE'} · <img src="${portraitURL(M.racer, 64)}" class="mini" alt=""> ${esc(racerName(M.racer))}</small></div>
    <div class="tgrid n${vis.length}">${vis.map(t => {
      const locked = isSecret(t) && !S.isUnlocked(t.id);
      const gh = M.mode === 'tt' && !locked && S.loadGhost(t.id);
      return trackCard(t, { locked, extraHtml: gh ? `<div class="gh">${ICON.ghost}<span>${clock(gh.time)}</span></div>` : '' });
    }).join('')}
    </div>
    <button class="backbtn" data-nav data-act="back" data-key="back">◀ BACK</button>`, {
    cls: 'bg-dark', music: 'title', focus,
    acts: {
      track(t) { launch(t.dataset.id); },
      back() { goBack(); },
    },
    back() { showSelect(); },
  });
}

/* ---------------------------------------------------------------- Orion Cup */
function startCup() {
  const ids = cupTracks();
  M.cup = { tracks: ids.length ? ids : [TRACKS[0].id], i: 0, points: Object.fromEntries(racers().map(r => [r.id, 0])), last: {}, prevOrder: null, diff: M.diff, racer: M.racer };
  vo('vo_orion_cup');
  showStandings(true);
}
function cupStandings() {
  const c = M.cup;
  return Object.keys(c.points).sort((a, b) => (c.points[b] - c.points[a]) || ((c.last[b] || 0) - (c.last[a] || 0)) || (a === M.racer ? -1 : b === M.racer ? 1 : 0));
}
function showStandings(intro = false) {
  const c = M.cup, done = c.i >= c.tracks.length;
  const order = cupStandings();
  const prev = c.prevOrder || order;
  const nextT = !done && trackDef(c.tracks[c.i]);
  const strip = c.tracks.map((id, i) => { const t = trackDef(id); return `<div class="cstep${i < c.i ? ' done' : ''}${i === c.i ? ' next' : ''}"><img src="assets/ui/track_${id}.jpg" alt="" onerror="this.remove()"><span>${esc(t?.name || id)}</span>${i < c.i ? '<b>✓</b>' : ''}</div>`; }).join('');
  const el = mount('standings', `
    <div class="shead"><h2>ORION CUP</h2><small>${intro ? `${c.tracks.length} RACES · WIN THE MOST POINTS!` : done ? 'FINAL STANDINGS' : `AFTER RACE ${c.i} OF ${c.tracks.length}`}</small></div>
    <div class="cstrip">${strip}</div>
    <div class="stand"><ol id="standList">${prev.map((id, i) => `
      <li class="${id === c.racer ? 'me' : ''}" data-id="${id}" style="--i:${i}"><b class="pl">${i + 1}</b><img src="${portraitURL(id, 96)}" alt=""><span class="nm">${esc(racerName(id))}</span>
      <em class="gain">${c.last[id] ? '+' + c.last[id] : ''}</em><span class="pts">${c.points[id] - (intro ? 0 : (c.last[id] || 0))}</span></li>`).join('')}</ol></div>
    <div class="res-btns">
      <button class="mbtn big" data-nav data-act="next" data-key="next">${done ? 'TO THE PODIUM! ▶' : intro ? `START! ▶` : 'NEXT RACE ▶'}</button>
      ${intro ? '' : `<button class="mbtn sm" data-nav data-act="quit" data-key="quit">QUIT CUP</button>`}
    </div>`, {
    cls: 'bg-dark', music: intro ? 'title' : 'results', focus: '[data-key="next"]',
    acts: {
      next() { if (done) showPodium(); else launch(c.tracks[c.i]); },
      quit() { M.cup = null; showMenu('cup'); },
    },
    back() { if (intro) showSelect(); },
  });
  if (!intro) {
    // count the points up and slide rows into their new order
    setTimeout(() => {
      if (M.screen !== 'standings') return;
      const lis = [...el.querySelectorAll('#standList li')];
      for (const li of lis) {
        const id = li.dataset.id, idx = order.indexOf(id);
        li.style.setProperty('--i', idx); li.querySelector('.pl').textContent = idx + 1;
        const pts = li.querySelector('.pts'), from = +pts.textContent, to = c.points[id];
        if (to !== from) { li.classList.add('up'); countUp(pts, from, to); }
      }
      sfx('star');
    }, 650);
  }
  if (nextT) el.querySelector('.cstep.next')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
}
function countUp(elm, from, to) {
  const t0 = performance.now(), d = 700;
  const step = () => { const u = Math.min(1, (performance.now() - t0) / d); elm.textContent = Math.round(from + (to - from) * u); if (u < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function cupAddRace(results) {
  const c = M.cup;
  c.prevOrder = cupStandings();
  c.last = {};
  for (const r of results) { const p = POINTS[r.place - 1] || 0; c.points[r.racerId] = (c.points[r.racerId] || 0) + p; c.last[r.racerId] = p; }
  c.i++;
}
function showPodium() {
  const c = M.cup;
  const order = cupStandings();
  const won = order[0] === c.racer;
  const myPlace = order.indexOf(c.racer) + 1;
  if (won && !c.recorded) {
    c.recorded = true; S.addCupWin(c.diff);
    M.pendingUnlock = S.unlock('star');
  }
  if (api.G.race) api.endRace();
  mount('podium', `
    <div class="stage-slot full" id="podStage"></div>
    <div class="podtop"><h2>${won ? 'YOU WON THE ORION CUP!' : 'ORION CUP CHAMPION!'}</h2>
      <p>${won ? `${esc(racerName(order[0]))} is the champion!` : `${esc(racerName(order[0]))} wins! You came ${myPlace}${ordSuffix(myPlace)} — ${pick(cheers)}`}</p></div>
    <div class="res-btns bottom"><button class="mbtn big" data-nav data-act="ok" data-key="ok">${M.pendingUnlock ? 'WHAT\'S THIS?! ▶' : 'HOORAY! ▶'}</button></div>`, {
    cls: 'bg-podium', music: 'results',
    onShow(el) { stage.mount(el.querySelector('#podStage')); stage.podium(order, c.racer); confetti.burst(160); confetti.rain(won ? 9 : 4); sfx('cheer'); setTimeout(() => { vo(`vo_${order[0]}_wins`); sfx('win'); }, 500); setTimeout(() => { try { api.audio.bark?.(order[0], 'win', { force: true }); } catch { /* */ } }, 2600); },
    onHide() { confetti.stop(); },
    acts: { ok() { if (M.pendingUnlock) showUnlock(); else { M.cup = null; showMenu('cup'); } } },
    back() { cur.acts.ok(); },
  });
}
function showUnlock() {
  M.pendingUnlock = false; M.cup = null;
  const st = trackDef('star') || TRACKS.find(isSecret) || { id: 'star', name: 'Star Road', theme: 'star' };
  mount('unlock', `
    <div class="unl">
      <h2 class="rainbow">STAR ROAD<br>UNLOCKED!</h2>
      <div class="ucard"><img src="assets/ui/track_${st.id}.jpg" alt="" onerror="this.remove()"><span>${esc(st.name)}</span></div>
      <p>A secret rainbow road in space! Find it in Quick Race.</p>
      <button class="mbtn big" data-nav data-act="ok" data-key="ok">YAY! ▶</button>
    </div>`, {
    cls: 'bg-space', music: 'results',
    onShow() { confetti.burst(200); confetti.rain(5); sfx('win'); sfx('super_star'); },
    onHide() { confetti.stop(); },
    acts: { ok() { M.mode = 'quick'; M.track = st.id; showMenu('quick'); } },
    back() { cur.acts.ok(); },
  });
}

/* ---------------------------------------------------------------- results */
function resultRows() {
  const race = api.G.race;
  if (!race) return [];
  return race.order.map((k, i) => ({ place: i + 1, racerId: k.racerId, name: racerName(k.racerId), time: k.finishTime, finished: k.finished, estimated: !!k.estimated, isPlayer: k.isPlayer, lapTimes: k.lapTimes }));
}
function showResults() {
  const race = api.G.race; if (!race) return;
  M.resultsShown = true; clearTimeout(M.finishTimer);
  api.hud.show(false);
  const P = race.player, place = P.finishPlace || P.place;
  const tt = M.mode === 'tt' || race.karts.length === 1;
  const cup = M.mode === 'cup' && M.cup;
  const rec = M.record || {};
  let title, sub, cls = 'p' + Math.min(place, 4);
  if (tt) { title = rec.newRace ? 'NEW RECORD!' : 'FINISH!'; sub = rec.newRace ? 'Fastest ever on this track!' : pick(cheers); cls = rec.newRace ? 'p1' : 'p2'; }
  else if (place === 1) { title = 'YOU WIN!'; sub = 'Champion driving!'; }
  else if (place === 2) { title = '2nd PLACE!'; sub = 'So close — brilliant racing!'; }
  else if (place === 3) { title = '3rd PLACE!'; sub = 'On the podium! Awesome!'; }
  else { title = 'GREAT RACE!'; sub = `You came ${place}${ordSuffix(place)} — ${pick(cheers)}`; }
  const b = S.best(M.track);
  const btns = cup
    ? `<button class="mbtn big" data-nav data-act="cont" data-key="cont">CONTINUE ▶</button>`
    : `<button class="mbtn" data-nav data-act="retry" data-key="retry">${tt ? 'TRY AGAIN' : 'RACE AGAIN'}</button>
       <button class="mbtn big" data-nav data-act="next" data-key="next">NEXT TRACK ▶</button>
       <button class="mbtn" data-nav data-act="menu" data-key="menu">MENU</button>`;
  const el = mount('results', `
    <div class="rpanel ${cls}">
      <div class="rhead"><img class="rport" src="${portraitURL(P.racerId, 128)}" alt=""><div><h2>${title}</h2><p>${esc(sub)}</p></div>
        ${tt ? '' : `<div class="rbadge"><b>${place}</b><sup>${ordSuffix(place)}</sup></div>`}</div>
      ${tt ? `<div class="ttbox"><div class="big">${clock(P.finishTime)}</div>
          <ol class="ttlaps">${(P.lapTimes || []).map((t, i) => `<li${t === Math.min(...P.lapTimes) ? ' class="best"' : ''}><small>LAP ${i + 1}</small>${clock(t)}</li>`).join('')}</ol>
          <div class="ttbest"><span>BEST LAP <b>${clock(b.lap)}</b>${rec.newLap ? ' <em>NEW!</em>' : ''}</span><span>BEST RACE <b>${clock(b.race)}</b>${rec.newRace ? ' <em>NEW!</em>' : ''}</span></div></div>`
      : `<ol class="rlist" id="resList"></ol>`}
      <div class="res-btns">${btns}</div>
    </div>`, {
    cls: 'res', overlay: true, music: 'results', focus: cup ? '[data-key="cont"]' : '[data-key="next"]',
    acts: {
      retry() { if (M.mode === 'cup') return; launch(M.track); },
      next() {
        const list = unlockedTracks(); const i = list.findIndex(t => t.id === M.track);
        launch((list[(i + 1) % list.length] || list[0]).id);
      },
      menu() { api.endRace(); showMenu(M.mode === 'tt' ? 'tt' : 'quick'); },
      cont() {
        const r = api.G.race;
        if (r && r.phase !== 'done') api.advance(40);     // finish the race silently for the points
        cupAddRace(resultRows());
        api.endRace();
        showStandings(false);
      },
    },
    back() { },
  });
  if (!tt) paintResultRows(el);
  if (!tt && place === 1) { confetti.burst(140); confetti.rain(3); }
  if (tt && rec.newRace) { confetti.burst(120); vo('vo_new_record'); }
  else if (!tt) {
    const winner = race.order[0];
    setTimeout(() => { if (place === 1) return; vo(place <= 3 ? 'vo_so_close' : 'vo_great_race'); }, 400);
    if (winner && !winner.isPlayer) setTimeout(() => vo(`vo_${winner.racerId}_wins`), 1900);
  }
}
let resSig = '';
function paintResultRows(el = cur?.el) {
  const list = el?.querySelector('#resList'); if (!list) return;
  const rows = resultRows();
  const sig = rows.map(r => r.racerId + (r.finished ? r.time?.toFixed(2) : '')).join('|');
  if (sig === resSig && list.children.length) return;
  resSig = sig;
  const cup = M.mode === 'cup';
  list.innerHTML = rows.map(r => `<li class="${r.isPlayer ? 'me' : ''}${r.place <= 3 ? ' top' + r.place : ''}"><b class="pl">${r.place}<sup>${ordSuffix(r.place)}</sup></b><img src="${portraitURL(r.racerId, 96)}" alt="">
    <span class="nm">${esc(r.name)}</span><span class="tm${r.estimated ? ' est' : ''}">${r.finished ? clock(r.time) : '<i class="racing">racing…</i>'}</span>${cup ? `<em class="gain">+${POINTS[r.place - 1] || 0}</em>` : ''}</li>`).join('');
}

/* ---------------------------------------------------------------- pause */
function openPause() {
  const G = api.G; if (!G.race) return;
  G.paused = true; api.audio.pause?.(true);
  clearTimeout(M.finishTimer);
  mount('pause', `
    <div class="ppanel"><h2>PAUSED</h2>
      <button class="mbtn big" data-nav data-act="resume" data-key="resume">▶ KEEP RACING</button>
      ${M.mode === 'cup' ? '' : `<button class="mbtn" data-nav data-act="restart" data-key="restart">START AGAIN</button>`}
      <button class="mbtn" data-nav data-act="settings" data-key="settings">SETTINGS</button>
      <button class="mbtn" data-nav data-act="quit" data-key="quit">QUIT TO MENU</button>
    </div>`, {
    cls: 'res', overlay: true, focus: '[data-key="resume"]', wrap: true,
    acts: {
      resume() { resume(); },
      restart() { resume(true); launch(M.track); },
      settings() { M.settingsFrom = 'pause'; showSettings(); },
      quit() { resume(true); api.endRace(); M.cup = null; showMenu(); },
    },
    back() { resume(); },
  });
  M.focusMem.pause = 'resume';
}
function resume(silent) {
  const G = api.G;
  G.paused = false; api.audio.pause?.(false);
  unmount();
  if (!silent) sfx('menu_back');
  if (G.state === 'finished' && !M.resultsShown) M.finishTimer = setTimeout(() => { if (api.G.state === 'finished' || api.G.state === 'results') showResults(); }, 1200);
}

/* ---------------------------------------------------------------- settings + controls */
const AUTO_LBL = { easy: 'EASY ONLY', on: 'ALWAYS', off: 'OFF' };
function showSettings() {
  const s = S.settings();
  const hdAny = !!HDM && Object.keys(HDM.HD_MODELS || {}).length > 0;
  const vol = (k, lbl) => `<div class="opt" data-nav data-adj data-k="${k}" data-key="${k}"><span class="lbl">${lbl}</span>
      <button class="nudge" data-d="-1">−</button><span class="meter" data-k="${k}"><i style="transform:scaleX(${s[k]})"></i></span><button class="nudge" data-d="1">+</button><span class="pct">${Math.round(s[k] * 100)}%</span></div>`;
  const tog = (k, lbl, val, hint) => `<div class="opt tog" data-nav data-adj data-act="tog" data-k="${k}" data-key="${k}"><span class="lbl">${lbl}<small>${hint}</small></span>
      <button class="nudge" data-d="-1">◀</button><span class="val">${val}</span><button class="nudge" data-d="1">▶</button></div>`;
  const pause = M.settingsFrom === 'pause';
  const el = mount('settings', `
    <div class="setp"><h2>SETTINGS</h2>
      <div class="opts">
        ${vol('master', 'VOLUME')}${vol('music', 'MUSIC')}${vol('sfx', 'EFFECTS')}
        ${tog('autoAccel', 'AUTO-GO', AUTO_LBL[s.autoAccel] || 'EASY ONLY', 'kart drives forward by itself')}
        ${tog('kidAssist', 'KID HELPER', s.kidAssist ? 'ON' : 'OFF', 'easy turbos, no overheating')}
        ${hdAny ? tog('hd', 'FANCY RACERS', s.hd ? 'ON' : 'OFF', 'detailed 3D models') : ''}
      </div>
      <div class="res-btns"><button class="mbtn" data-nav data-act="controls" data-key="controls">CONTROLS</button><button class="mbtn big" data-nav data-act="back" data-key="back">◀ BACK</button></div>
    </div>`, {
    cls: pause ? 'res' : 'bg-dark', overlay: pause, music: pause ? undefined : 'title', wrap: true,
    adj(row, d) { change(row, d); },
    acts: {
      tog(row) { change(row, 1); },
      controls() { showControls(); },
      back() { goBack(); },
    },
    back() { if (M.settingsFrom === 'pause') openPause(); else showMenu('settings'); },
    onShow(el) {
      // drag/tap a volume bar to set it outright
      el.querySelectorAll('.meter').forEach(m => {
        const setX = e => { const b = m.getBoundingClientRect(); const k = m.dataset.k; setVal(k, Math.max(0, Math.min(1, (e.clientX - b.left) / b.width))); };
        m.addEventListener('pointerdown', e => { e.stopPropagation(); m.setPointerCapture?.(e.pointerId); setX(e); const mv = ev => setX(ev); m.addEventListener('pointermove', mv); m.addEventListener('pointerup', () => m.removeEventListener('pointermove', mv), { once: true }); });
      });
    },
  });
  function setVal(k, v) {
    v = Math.round(Math.max(0, Math.min(1, v)) * 20) / 20;
    S.setSetting(k, v); api.audio.setVolumes({ [k]: v });
    const row = el.querySelector(`.opt[data-k="${k}"]`);
    row.querySelector('.meter i').style.transform = `scaleX(${v})`; row.querySelector('.pct').textContent = Math.round(v * 100) + '%';
  }
  function change(row, d) {
    const k = row.dataset.k, s2 = S.settings();
    if (k === 'master' || k === 'music' || k === 'sfx') { setVal(k, s2[k] + d * 0.1); sfx(k === 'music' ? 'menu_move' : 'star'); return; }
    if (k === 'autoAccel') { const o = ['easy', 'on', 'off']; const v = o[(o.indexOf(s2.autoAccel) + d + 3) % 3]; S.setSetting(k, v); row.querySelector('.val').textContent = AUTO_LBL[v]; }
    else { const v = !s2[k]; S.setSetting(k, v); row.querySelector('.val').textContent = v ? 'ON' : 'OFF'; if (k === 'hd' && !api.Q.has('hd')) api.G.hd = v; }
    sfx('menu_move');
  }
}
function showControls() {
  const rows = [
    ['STEER', KEY('←') + KEY('→'), PAD('✥', 'dpad') + PAD('L', 'stick'), TCH('◀') + TCH('▶')],
    ['GO!', KEY('↑'), PAD('A', 'a') + PAD('RT', 'trig'), '<small>by itself</small>'],
    ['BRAKE', KEY('↓'), PAD('X', 'x') + PAD('LT', 'trig'), TCH('▼')],
    ['HOP + SLIDE', KEY('SPACE', 'w'), PAD('RB', 'sh'), TCH('⤴')],
    ['TURBO!', KEY('SHIFT'), PAD('LB', 'sh'), TCH('⚡')],
    ['USE ITEM', KEY('E') + KEY('ENTER'), PAD('B', 'b') + PAD('Y', 'y'), TCH('◆')],
    ['PAUSE', KEY('ESC') + KEY('P'), PAD('START', 'st'), TCH('❚❚')],
  ];
  mount('controls', `
    <div class="setp wide"><h2>CONTROLS</h2>
      <table class="ctab"><thead><tr><th></th><th>KEYBOARD</th><th>GAMEPAD</th><th>TOUCH</th></tr></thead>
      <tbody>${rows.map(r => `<tr><th>${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table>
      <div class="howto"><b>TURBO TRICK:</b> hold HOP to slide round a corner · when the bar goes
        <span class="redbar"><i></i></span> press TURBO! · do it 3 times for an <em>ULTRA TURBO!!!</em></div>
      <div class="res-btns"><button class="mbtn big" data-nav data-act="back" data-key="back">◀ BACK</button></div>
    </div>`, {
    cls: M.settingsFrom === 'pause' ? 'res' : 'bg-dark', overlay: M.settingsFrom === 'pause',
    acts: { back() { goBack(); } },
    back() { showSettings(); },
  });
}

/* ================================================================== race hooks */
function onState(s, prev) {
  const G = api.G;
  if (s === 'countdown') {
    unmount(); confetti.stop();
    M.resultsShown = false; M.record = null; resSig = '';
    clearTimeout(M.finishTimer);
    if (G.race && G.noItems) G.race.noItems = true;   // Time Trial: items.js may skip boxes (DESIGN.md)
    setupGhost();
  } else if (s === 'finished') {
    const P = G.race?.player;
    if (P) {
      const tid = G.track?.id || M.track;
      M.track = tid;
      M.record = S.recordRace(tid, { time: P.finishTime, lapTimes: P.lapTimes, racer: P.racerId });
      if ((M.mode === 'tt' || G.race.karts.length === 1) && M.rec && M.record.newRace) {
        M.rec.time = P.finishTime; S.saveGhost(tid, M.rec);
      }
      if (M.mode === 'tt' || G.race.karts.length === 1) api.hud.banner(M.record.newRace ? 'NEW RECORD!' : 'FINISH!', 2500);
    }
    clearTimeout(M.finishTimer);
    M.finishTimer = setTimeout(() => { if (!cur && (api.G.state === 'finished' || api.G.state === 'results')) showResults(); }, 2600);
  } else if (s === 'results') {
    if (!M.resultsShown && !cur) { clearTimeout(M.finishTimer); showResults(); }
    else if (cur?.name === 'results') paintResultRows();
  } else if (s === 'title') {
    removeGhost();
  }
}

/* ---------------------------------------------------------------- Time Trial ghost */
function removeGhost() {
  if (M.ghost) {
    api.scene.remove(M.ghost.root);
    M.ghost.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
    M.ghost = null;
  }
}
function setupGhost() {
  removeGhost(); M.rec = null;
  const G = api.G, race = G.race;
  if (!race || race.karts.length !== 1) return;
  const tid = G.track.id;
  M.rec = { racer: race.player.racerId, hz: 10, samples: [], time: 0 };
  const data = S.loadGhost(tid);
  race.bestTime = S.best(tid).race || null;
  if (data && data.samples.length > 2) {
    try {
      const b = api.R.buildRacer(data.racer || 'orion', { hd: false });
      b.root.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = false;
        const clone = m => { const c = m.clone(); c.transparent = true; c.opacity = 0.38; c.depthWrite = false; if (c.color) c.color.lerp(new THREE.Color(0xbfe8ff), 0.5); return c; };
        o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
        o.renderOrder = 2;
      });
      b.root.visible = false;
      api.scene.add(b.root);
      M.ghost = { root: b.root, data };
    } catch (e) { console.warn('[menu] ghost build failed', e); }
  }
  let n = 0;
  const rec = M.rec, gh = M.ghost;
  race.addSystem(r => {
    if (r.t < 0 || r !== api.G.race) return;
    const P = r.player;
    if (!P.finished && (n++ % 6) === 0) rec.samples.push([P.pos.x, P.pos.y, P.pos.z, P.yaw + P.drift * P.driftAngle]);
    if (gh && gh === M.ghost) {
      const sm = gh.data.samples, f = r.t * gh.data.hz, i = Math.floor(f), a = f - i;
      if (i >= sm.length - 1) { gh.root.visible = false; r.ghostPos = null; return; }
      const p = sm[i], q = sm[i + 1];
      let dy = q[3] - p[3]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      gh.root.position.set(p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a, p[2] + (q[2] - p[2]) * a);
      gh.root.rotation.set(0, p[3] + dy * a, 0);
      gh.root.visible = true;
      r.ghostPos = gh.root.position;
    }
  });
}

/* ================================================================== loop */
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  pollPad(dt);
  stage.render(dt);
  confetti.update(dt);
  if (cur?.name === 'results') paintResultRows();
}

/* ================================================================== debug screens (?screen=) */
async function debugScreen(name) {
  const G = api.G;
  const fakeCup = (i) => {
    M.mode = 'cup'; M.racer = M.racer || 'orion';
    M.cup = { tracks: cupTracks().length ? cupTracks() : [TRACKS[0].id], i: 0, points: {}, last: {}, prevOrder: null, diff: M.diff, racer: M.racer };
    const ids = racers().map(r => r.id);
    const pts = [36, 30, 27, 20, 14, 12, 9, 6];
    ids.forEach((id, k) => { M.cup.points[id] = Math.round(pts[(k + 2) % 8] * i / 4); M.cup.last[id] = POINTS[(k + 3) % 8]; });
    if (i >= 4) { M.cup.points[M.racer] = 40; }
    M.cup.i = Math.min(i, M.cup.tracks.length);
    M.cup.prevOrder = ids.slice().reverse();
  };
  switch (name) {
    case 'menu': showMenu(); break;
    case 'select': M.mode = 'quick'; showSelect(); break;
    case 'tracks': M.mode = api.Q.get('mode') || 'quick'; showTracks(); break;
    case 'settings': M.settingsFrom = 'menu'; showSettings(); break;
    case 'controls': M.settingsFrom = 'menu'; showControls(); break;
    case 'standings': fakeCup(+(api.Q.get('race') || 2)); showStandings(false); break;
    case 'podium': fakeCup(4); showPodium(); break;
    case 'unlock': M.pendingUnlock = true; showUnlock(); break;
    case 'results': case 'pause': {
      M.mode = api.Q.get('mode') || 'quick';
      applyRaceSettings();
      G.difficulty = M.diff;
      await api.startRace();
      G.race.autoPlayer = true;
      if (name === 'pause') { api.advance(3.6 + 12); G.race.autoPlayer = false; openPause(); }
      else { api.advance(3.6 + 400); }
      break;
    }
    default: showTitle();
  }
}

/* ================================================================== init */
export async function initMenu(a, { skip = false } = {}) {
  api = a;
  root = document.createElement('div'); root.id = 'ui'; document.body.appendChild(root);
  document.getElementById('screens')?.classList.add('hide');
  api.hud.menuOwnsResults = true;
  const s = S.settings();
  try { api.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx }); } catch { /* */ }
  M.track = api.G.track?.id || api.G.trackId || TRACKS[0].id;
  if (skip) {
    // ?skip=1 / ?t= / ?ai=1 (other agents' tests): the race is exactly what the URL says — core's
    // defaults, never the saved racer/difficulty/assists (the test browser profile has a save too).
    // Saved settings only apply from the next race launched through the menus.
    M.mode = 'quick'; M.racer = api.G.racerId; M.diff = api.G.difficulty;
  } else {
    M.diff = api.Q.get('diff') || s.difficulty || 'easy';
    M.racer = api.Q.get('racer') || S.get().lastRacer || 'orion';
    if (!api.Q.has('hd')) api.G.hd = !!s.hd;
  }
  addEventListener('keydown', onKey);
  document.querySelector('[data-btn="pause"]')?.addEventListener('pointerdown', () => { if (inRace()) openPause(); });
  api.onState(onState);
  requestAnimationFrame(loop);
  window.__OTR && (window.__OTR.menu = { M, get screen() { return M.screen; }, show: debugScreen, action, launch, save: S, stage, confetti });
  if (!skip) {
    api.setState('title');
    const scr = api.Q.get('screen');
    await debugScreen(scr || 'title');
  }
  hdp.then(() => { if (cur?.name === 'settings') showSettings(); });
}
