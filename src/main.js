// main.js — boot, renderer, fixed-step loop with interpolation, state machine, wiring.
//
// States: boot → title (skipped with ?skip=1) → countdown → race → finished (player done, AI
// keeps racing, AI drives the player's kart) → results. setState(name) is the one place state
// changes; screen code (the UI agent's menu.js) subscribes with onState(fn).
//
// URL debug params (DESIGN.md): track, racer, skip, cam=x,y,z,tx,ty,tz, t (fast-forward s with
// AI driving), ai=1 (AI drives the player), hud=0, diff=easy|medium|hard, slot (player grid slot
// 0..7), laps, seed, touch=1, hd=1, shadows=0, fx=0, q=low|high|auto (quality).   window.__OTR exposes state for tests.
//
// 2P split screen (multiplayer agent; DESIGN.md "Two players"): G.players = 2 races two humans
// (race.humans) in one shared scene drawn twice — top half P1, bottom half P2 (setViewport +
// setScissor, one ChaseCam each), one HUD per half, per-player input devices (input.js players[]).
// URL: players=2, racer2=<id>, dev1/dev2=auto|kb|kbL|kbR|pad:N, auto2=0|1 (P2 auto-accelerate),
// helper1/helper2=0|1 (per-player kid helper). In 2P shadows are off and FAST-style particles/culling
// apply whatever the GRAPHICS setting (QUAL_MP).
import * as THREE from 'three';
import * as In from './input.js';
import { DT, T, redStart, baseTop } from './physics.js';
import { buildTrack } from './track.js';
import { TRACKS, trackById } from './tracks/index.js';
import { createRace, COUNTDOWN } from './race.js';
import { buildTrackMesh, mergeGeos, texturesReady } from './trackmesh.js';
import { ChaseCam } from './camera.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { createItemViews } from './itemviews.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const qn = (k, d) => Q.has(k) ? +Q.get(k) : d;

/* ------------------------------------------------------------------ optional modules */
const NOAUDIO = new Proxy({}, { get: (_, k) => k === 'muted' ? false : () => ({ stop() {}, set() {}, playing: false }) });
let audio = NOAUDIO;
try { audio = (await import('./audio.js')).audio || NOAUDIO; } catch (e) { console.warn('[otr] audio.js missing/broken, silent', e); }
let R = null;
try { R = await import('./racers.js'); if (!R.buildRacer || !R.RACERS) throw new Error('racers.js incomplete'); }
catch (e) { console.warn('[otr] racers.js missing/broken, using box karts', e); R = await import('./kartbox.js'); }
let MENU = null;   // ui agent: title/menus/results/pause (menu.js). Missing = core's placeholder title card.
try { MENU = await import('./menu.js'); } catch (e) { console.warn('[otr] menu.js missing/broken, placeholder title', e); }

/* ------------------------------------------------------------------ renderer */
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const SHADOWS = Q.get('shadows') !== '0';
renderer.shadowMap.enabled = SHADOWS;
renderer.shadowMap.type = THREE.PCFShadowMap;   // r185: PCFSoft is deprecated (falls back to this anyway)
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 0.3, 2400);
const camera2 = new THREE.PerspectiveCamera(66, 1, 0.3, 2400);   // 2P: the bottom half's camera
const hemi = new THREE.HemisphereLight(0xd8f0ff, 0xc8a870, 1.05);
const sun = new THREE.DirectionalLight(0xfff2d6, 2.3);
sun.castShadow = SHADOWS;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 220 });
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
scene.add(hemi, sun, sun.target);
let splitView = false;   // = G.mp (resize() runs before G exists)
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const a = splitView ? w / (h / 2) : w / h;          // 2P: each view is the full width, half the height
  camera.aspect = a; camera.updateProjectionMatrix(); camera2.aspect = w / (h / 2); camera2.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ------------------------------------------------------------------ quality (Steam Deck) */
// G.quality = 'auto' | 'high' | 'low' (Settings → GRAPHICS; URL ?q=). The effective level is
// G.qLevel. 'low' = render scale 0.85, no real-time shadow (the player's kart gets a blob like
// everyone else), half the particles, AI karts culled at 150 m instead of 230 m. 'auto' starts
// high and drops to low for the session if the race runs slower than ~48 fps for 4 s (median
// rAF interval over two 2 s windows) — never back up, so it can't oscillate. Pixel ratio and
// particles change at once; shadows change at the next race start (toggling them recompiles
// every shader, which startRace's compileAsync already pays for).
const QUAL = { high: { scale: 1, shadows: true, fx: 1, far: 230 }, low: { scale: 0.85, shadows: false, fx: 0.5, far: 150 } };
// 2P: the scene is drawn twice, so whatever GRAPHICS says: no real-time shadow (every kart gets a
// blob), half the particles, AI karts culled at 120 m (a kart there is ~7 px tall in a 400 px view —
// the same as FAST's 150 m in 1P). The render scale still follows the setting (two half-height
// views are the same pixel count as one full view).
const QUAL_MP = { shadows: false, fx: 0.5, far: 120 };
// 2P camera: a 1280×400 view at the 1P vertical FOV (66°) is a 128° fisheye sideways; ×0.66 keeps
// the horizontal FOV near 1P's (~95°)
const CAM_MP = { fovMul: 0.66 };
const qual = () => { const q = QUAL[G.qLevel] || QUAL.high; return G.mp ? { ...q, ...QUAL_MP } : q; };
function applyQuality() {
  const q = qual();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * q.scale); resize();
  if (fx) fx.q = q.fx;
}
function setQuality(v) {
  G.quality = v === 'high' || v === 'low' ? v : 'auto';
  G.qLevel = G.quality === 'low' ? 'low' : G.quality === 'high' ? 'high' : (G.autoLow ? 'low' : 'high');
  applyQuality();
}
const qWatch = { dts: [], sum: 0, bad: 0 };
function watchQuality(dt) {
  if (G.quality !== 'auto' || G.qLevel === 'low' || G.state !== 'race' || G.paused || document.hidden || dt > 0.5) { qWatch.dts.length = 0; qWatch.sum = 0; return; }
  qWatch.dts.push(dt); qWatch.sum += dt;
  if (qWatch.sum < 2 || qWatch.dts.length < 20) return;      // 2 s windows of wall time
  const med = [...qWatch.dts].sort((a, b) => a - b)[qWatch.dts.length >> 1]; qWatch.dts.length = 0; qWatch.sum = 0;
  qWatch.bad = med > 0.0205 ? qWatch.bad + 1 : 0;
  if (qWatch.bad >= 2) { G.autoLow = true; setQuality('auto'); console.info('[otr] auto quality: frame time', (med * 1000).toFixed(1), 'ms → low'); }
}

/* ------------------------------------------------------------------ game state */
const hud = createHud($('hud'));
const hud2 = createHud($('hud2'), { pn: 1 });   // 2P: the bottom half's HUD
const fx = Q.get('fx') === '0' ? null : createFx(scene);
const chase = new ChaseCam(camera);
const chase2 = new ChaseCam(camera2);
/** 2P views: [{ cam, chase, hud }] per human (pn order); 1P uses views[0] only. */
const views = [{ cam: camera, chase, hud }, { cam: camera2, chase: chase2, hud: hud2 }];
const viewOf = k => views[k && k.pn > 0 ? k.pn : 0];
const hudOf = k => viewOf(k).hud;
const IV = createItemViews({ scene, fx, audio, chase, chaseFor: k => viewOf(k).chase, visuals: () => G.visuals });   // items (itemviews.js)
if (Q.get('cam')) chase.pin(Q.get('cam').split(',').map(Number));
const stateFns = new Set();
const G = {
  state: 'boot', track: null, tm: null, race: null, visuals: [], ready: false,
  difficulty: Q.get('diff') || 'easy', racerId: Q.get('racer') || 'orion', trackId: Q.get('track') || TRACKS[0].id,
  slot: qn('slot', 6), laps: Q.has('laps') ? qn('laps', 3) : undefined, seed: qn('seed', 1),
  acc: 0, timeScale: 1, paused: false, override: null, pendA: false, pendB: false, t: 0, frames: 0,
  hd: Q.get('hd') === '1',
  quality: 'auto', qLevel: 'high', autoLow: false,
  // 2P (menu.js sets these from the join screen; URL players=2 for tests)
  players: Q.get('players') === '2' ? 2 : 1, mp: false, racerId2: Q.get('racer2') || null,
  devs: [Q.get('dev1') || 'auto', Q.get('dev2') || 'auto'],
  pcfg: [{ autoAccel: undefined, helper: Q.has('helper1') ? Q.get('helper1') === '1' : undefined }, { autoAccel: Q.has('auto2') ? Q.get('auto2') === '1' : undefined, helper: Q.has('helper2') ? Q.get('helper2') === '1' : undefined }],
  override2: null, pend2: { A: false, B: false, I: false },
};
export function setState(s) {
  const prev = G.state; G.state = s;
  for (const fn of stateFns) try { fn(s, prev); } catch (e) { console.error(e); }
}
export const onState = fn => { stateFns.add(fn); return () => stateFns.delete(fn); };

/* ------------------------------------------------------------------ track */
/** Free the GPU side of a track: geometries, materials and every texture they reference (maps and
 *  shader uniforms). three re-uploads a disposed texture if it's drawn again, so trackmesh's
 *  texture cache stays valid. Measured with tools/leakcheck.mjs: without this, textures grew by
 *  ~20 per lap of the 5 tracks (canvas textures rebuilt per scenery build were never freed). */
function disposeGroup(root) {
  const mats = new Set(), texs = new Set();
  root.traverse(o => {
    o.geometry?.dispose?.();
    if (o.material) for (const m of [].concat(o.material)) mats.add(m);
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v?.isTexture) texs.add(v);
    if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u?.value; if (v?.isTexture) texs.add(v); }
    m.dispose();
  }
  for (const t of texs) t.dispose();
}
async function loadTrack(id) {
  if (G.tm) { scene.remove(G.tm.group); disposeGroup(G.tm.group); }
  const def = trackById(id);
  G.track = buildTrack(def);
  G.tm = await buildTrackMesh(G.track, { scene });
  await texturesReady(5000);   // the loading screen is up anyway: don't let a big jpg land (and upload) mid-race
  scene.add(G.tm.group);
  const env = G.tm.env;
  scene.fog = new THREE.Fog(env.fog ?? 0xcfe6ff, env.fogNear ?? 140, env.fogFar ?? 520);
  renderer.setClearColor(env.fog ?? 0xcfe6ff);
  hemi.color.set(env.hemiSky ?? 0xd8f0ff); hemi.groundColor.set(env.hemiGround ?? 0xc8a870); hemi.intensity = env.hemi ?? 1.05;
  sun.color.set(env.sunColor ?? 0xfff2d6); sun.intensity = env.sun ?? 2.3;
  G.sunDir = new THREE.Vector3(...(env.sunDir || [-0.45, 0.8, 0.35])).normalize();
}

/* ------------------------------------------------------------------ racers */
function entrantsFor(playerId) {
  if (G.solo) return { ids: [playerId], slot: 0 };          // Time Trial (menu.js sets G.solo)
  const all = R.RACERS.map(r => r.id);
  if (G.players === 2) {
    // 2P: P1 in G.slot (default 6), P2 beside them on the same grid row, 6 AI fill the rest
    let p2 = G.racerId2 && all.includes(G.racerId2) && G.racerId2 !== playerId ? G.racerId2 : all.find(id => id !== playerId);
    const ids = all.filter(id => id !== playerId && id !== p2).slice(0, 6);
    const slot = Math.max(0, Math.min(7, G.slot)), slot2 = slot % 2 ? slot - 1 : slot + 1;
    const lo = Math.min(slot, slot2);
    ids.splice(lo, 0, lo === slot ? playerId : p2, lo === slot ? p2 : playerId);
    return { ids, slot, slot2 };
  }
  const others = all.filter(id => id !== playerId);
  const ids = others.slice(0, 7);
  const slot = Math.max(0, Math.min(7, G.slot));
  ids.splice(slot, 0, playerId);
  return { ids, slot };
}
function buildVisuals(ids) {
  for (const v of G.visuals) { scene.remove(v.root); try { R.disposeTree?.(v.root); } catch { /* not ours to fix */ } }
  G.visuals = ids.map(id => {
    let built;
    try { built = R.buildRacer(id, { hd: G.hd }); } catch (e) { console.warn('[otr] buildRacer failed for', id, e); built = null; }
    if (!built) built = { root: new THREE.Group(), rig: null };
    // Only the player's kart casts a real shadow (draw calls are the Deck's budget: a racer is
    // ~12 meshes, and the shadow pass would draw every one again). Everyone gets a blob shadow.
    const isP = ids.indexOf(id) === G.slotIndex;
    built.root.traverse(o => { if (o.isMesh) { o.castShadow = isP; } });
    scene.add(built.root);
    return { id, root: built.root, rig: built.rig, px: 0, py: 0, pz: 0, pyaw: 0, anim: {} };
  });
}

/* ------------------------------------------------------------------ blob shadows (1 draw call for all karts) */
const blob = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(0.65, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(2.2, 2.9); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }), 8);
  mesh.name = 'blobshadows'; mesh.frustumCulled = false; mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
})();
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _bp = new THREE.Vector3();

/* ------------------------------------------------------------------ the rescue cloud (falls/splashes) */
// A friendly puffy cloud carries the kart back down onto the centre line (DESIGN: "a friendly
// helper drops you back within 1.5 s"). One merged mesh, one per kart, hidden when idle.
const makeCloud = () => {
  const geos = [];
  for (const [x, y, z, r] of [[0, 0, 0, 0.9], [0.8, -0.1, 0.1, 0.7], [-0.8, -0.1, -0.1, 0.7], [0.3, 0.35, -0.3, 0.6], [-0.35, 0.3, 0.35, 0.6], [0, -0.2, 0.7, 0.55], [0, -0.2, -0.7, 0.55]]) {
    const g = new THREE.SphereGeometry(r, 10, 7); g.translate(x, y, z); geos.push(g);
  }
  const m = new THREE.Mesh(mergeGeos(geos), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8899aa }));
  m.visible = false; m.name = 'rescuecloud'; scene.add(m); return m;
};
const clouds = [];

/* ------------------------------------------------------------------ race */
async function startRace() {
  const { ids, slot, slot2 } = entrantsFor(G.racerId);
  const stats = id => (R.RACERS.find(r => r.id === id) || {}).stats || { speed: 3, accel: 3, turn: 3 };
  const two = slot2 != null;
  // 2P: per-player kid helper (true/false; undefined = the difficulty default, like 1P)
  const hp = i => G.pcfg[i].helper ?? (i === 0 ? G.easyBoost : undefined);
  G.race = createRace({ track: G.track, entrants: ids.map(id => ({ racerId: id, stats: stats(id) })), playerIndex: slot,
    players: two ? [{ index: slot, easyBoost: hp(0), assist: hp(0) }, { index: slot2, easyBoost: hp(1), assist: hp(1) }] : null,
    difficulty: G.difficulty, laps: G.laps, seed: G.seed, easyBoost: G.easyBoost });
  if (Q.get('ai') === '1') G.race.autoPlayer = true;
  In.settings.autoAccel = Q.has('auto') ? Q.get('auto') === '1' : !!G.autoAccel;   // G.autoAccel/easyBoost: menu.js settings
  const reSize = splitView !== two;
  G.mp = splitView = two;
  In.multi(two);
  if (two) {
    In.setDevices(G.devs[0], G.devs[1]);
    In.players[0].autoAccel = In.settings.autoAccel;
    In.players[1].autoAccel = G.pcfg[1].autoAccel ?? In.settings.autoAccel;
    G.pend2.A = G.pend2.B = G.pend2.I = false;
  }
  document.body.classList.toggle('split2', two);
  chase.fovMul = chase2.fovMul = two ? CAM_MP.fovMul : 1;
  $('split').hidden = !two;
  if (reSize) resize();                       // only when the split changes: setSize reallocates the drawing buffer
  if (fx) fx.q = qual().fx;
  G.slotIndex = slot;
  buildVisuals(ids);
  IV.attach(G.race);                         // items: before compileAsync so item shaders are warmed too
  for (const [i, k] of G.race.karts.entries()) snapVisual(i, k);
  chase.snap(G.race.player);
  if (two) chase2.snap(G.race.humans[1]);
  fx?.clearSkids();
  hud.results(null); hud.count(null);
  hud.show(Q.get('hud') !== '0');
  hud.drainsUi = !two; hud2.show(two && Q.get('hud') !== '0'); hud2.count(null);
  audio.enginesOff?.();
  for (const k of G.race.karts) audio.engineStart(k.index, k.isPlayer);
  audio.music(G.track.def.music || G.track.theme);
  G.acc = 0; G.t = 0;
  // HD drivers swap in asynchronously (racers.js attachHD) — wait for them, capped, so the GLB decode and
  // their shaders land in the warm-up below instead of hitching mid-race; then re-apply the shadow rule
  // (only the player's kart casts) to the freshly attached HD meshes.
  { const hdw = G.visuals.map(v => v.rig?.hdReady).filter(Boolean);
    if (hdw.length) await Promise.race([Promise.all(hdw), new Promise(r => setTimeout(r, 8000))]);
    G.visuals.forEach((v, i) => v.root.traverse(o => { if (o.isMesh) o.castShadow = i === G.slotIndex; })); }
  // quality: shadows on/off only changes here, right before the warm-up compiles everything anyway
  const wantSh = SHADOWS && qual().shadows;
  if (renderer.shadowMap.enabled !== wantSh) {
    renderer.shadowMap.enabled = wantSh; sun.castShadow = wantSh;
    scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  }
  G.shadowsOn = wantSh;
  // warm every shader before the lights go green (three compiles per material × light count)
  try { await renderer.compileAsync(scene, camera); } catch { renderer.compile(scene, camera); }
  // …and upload every texture now: compile doesn't, and anything behind the start camera (sky
  // panorama halves, far scenery, item sprites) otherwise uploads on first sight mid-race
  { const texs = new Set(); scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) { for (const v of Object.values(m)) if (v?.isTexture) texs.add(v); if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) texs.add(u.value); } });
    for (const t of texs) try { renderer.initTexture(t); } catch { /* not ready */ } }
  // …and one throwaway frame with culling off, so every vertex buffer is on the GPU before GO
  { const off = []; scene.traverse(o => { if (o.isMesh && o.frustumCulled) { o.frustumCulled = false; off.push(o); } });
    try { renderer.render(scene, camera); } finally { for (const o of off) o.frustumCulled = true; } }
  if (two) render(0);   // 2P: one real split-screen frame too (both views, scissor) so the first countdown frame isn't the first of its kind
  setState('countdown');
}
/** Tear the race down (menus: quit / back to the menu). The idle track orbit renders again. */
function endRace() {
  for (const v of G.visuals) { scene.remove(v.root); try { R.disposeTree?.(v.root); } catch { /* shared mats */ } }
  G.visuals = []; G.race = null; G.paused = false; IV.detach();
  blob.count = 0; for (const c of clouds) c.visible = false;
  for (const h of driftLoops.values()) h.stop(0.05); driftLoops.clear(); for (const h of offLoops.values()) h.stop(0.05); offLoops.clear();
  audio.enginesOff?.(); audio.pause?.(false);
  hud.show(false); hud.count(null); hud.banner('');
  hud2.show(false); hud2.count(null); hud2.banner('');
  if (G.mp) { G.mp = splitView = false; In.multi(false); document.body.classList.remove('split2'); $('split').hidden = true; resize(); if (fx) fx.q = qual().fx; }
  fx?.clearSkids();
}

/* ------------------------------------------------------------------ sim stepping */
function playerCtrl() {
  const c = G.override || (G.mp ? In.players[0].controls : In.controls);
  const out = { steer: c.steer || 0, throttle: c.throttle || 0, brake: c.brake || 0, hopA: !!c.hopA || G.pendA, hopB: !!c.hopB || G.pendB,
    item: !!c.item || G.pendI, itemBack: (c.brake || 0) > 0.3 };   // items: held + latched tap; ↓ = throw backward
  return out;
}
/** 2P: player 2's control object (same latching as P1's) */
function player2Ctrl() {
  const c = G.override2 || In.players[1].controls, p = G.pend2;
  return { steer: c.steer || 0, throttle: c.throttle || 0, brake: c.brake || 0, hopA: !!c.hopA || p.A, hopB: !!c.hopB || p.B,
    item: !!c.item || p.I, itemBack: (c.brake || 0) > 0.3 };
}
function stepSim() {
  const race = G.race;
  for (const [i, k] of race.karts.entries()) { const v = G.visuals[i]; v.px = k.pos.x; v.py = k.pos.y; v.pz = k.pos.z; v.pyaw = k.yaw + k.drift * k.driftAngle; }
  race.step(G.mp ? [playerCtrl(), player2Ctrl()] : playerCtrl());
  G.pendA = G.pendB = G.pendI = false; G.pend2.A = G.pend2.B = G.pend2.I = false;
  handleEvents(race.events);
  IV.step(race.events, G.ff);
}
/** Fast-forward N seconds synchronously (tests / ?t=). Renders nothing. */
function advance(secs) {
  const n = Math.round(secs / DT);
  G.ff = true;
  try { for (let i = 0; i < n && G.race.phase !== 'done'; i++) stepSim(); } finally { G.ff = false; }
}

/* ------------------------------------------------------------------ events → audio / fx / hud */
const PNAME = id => (R.RACERS.find(r => r.id === id) || { name: id }).name;
const driftLoops = new Map(), offLoops = new Map();   // per human kart (2P: each player hears their own)
/** every human is home (1P: the player) → the 'finished' state (AI drives the finished karts) */
const humansDone = race => race.humans.every(h => h.finished);
function handleEvents(events) {
  const race = G.race, H = race.humans;
  if (G.ff) {   // fast-forwarding: keep the state machine right, skip the sound and fury
    for (const e of events) {
      if (e.type === 'go' && G.state === 'countdown') setState('race');
      else if (e.type === 'finish' && e.kart.isPlayer && humansDone(race)) setState('finished');
      else if (e.type === 'race_done') showResults();
    }
    return;
  }
  for (const e of events) {
    const k = e.kart, me = !!k && k.isPlayer;
    const at = k && !me ? k.pos : null;
    const near = k && (me || dist2(k.pos, camera.position) < 60 * 60 || G.mp && dist2(k.pos, camera2.position) < 60 * 60);
    const kh = me ? hudOf(k) : hud;
    switch (e.type) {
      case 'count': hud.count(e.n); audio.play('countdown'); audio.play('vo_' + e.n); break;
      case 'go': hud.count('GO!'); audio.play('go'); audio.play('vo_go'); setTimeout(() => hud.count(null), 700); if (G.state === 'countdown') setState('race'); break;
      case 'lap': if (me) { audio.play('lap'); if (e.lap < race.laps) kh.banner(`LAP ${e.lap}`, 1300); } break;
      case 'final_lap': if (me) { audio.play('final_lap'); if (!H.some(h => h !== k && h.lap >= race.laps)) audio.play('vo_final_lap'); kh.banner('FINAL LAP!', 1800, 'final'); } break;
      case 'finish':
        if (me) {
          audio.play('finish'); audio.play(e.place === 1 ? 'win' : e.place <= 3 ? 'finish' : 'lose');
          if (e.place === 1) audio.play('vo_you_win');
          kh.banner(e.place === 1 ? 'YOU WIN!' : `${e.place}${['st', 'nd', 'rd'][e.place - 1] || 'th'} PLACE!`, 3000);
          if (humansDone(race)) setState('finished');
        }
        break;
      case 'race_done': showResults(); break;
      case 'stall': if (me) kh.banner('Too early!', 900); break;
      case 'kart': if (near) kartEvent(k, e.e, e.v, me, at); break;
    }
  }
}
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
function kartEvent(k, name, v, me, at) {
  const vol = me ? 1 : 0.55;
  switch (name) {
    case 'hop': audio.play('hop', { vol: vol * 0.8, at }); break;
    case 'land': if (v > 0.25) { audio.play('land', { vol: vol * Math.min(1, v + 0.3), at }); fx?.burst('land', k.pos, { surface: k.surface, n: 10 }); if (me) viewOf(k).chase.shake(0.15 * v); } break;
    case 'drift_start': audio.play('drift_start', { vol, at }); if (me) { driftLoops.get(k)?.stop(0.05); driftLoops.set(k, audio.play('drift_loop', { loop: true, vol: 0.8 })); } break;
    case 'drift_end': if (me) { driftLoops.get(k)?.stop(0.12); driftLoops.delete(k); } break;
    case 'charge_red': if (me) audio.play('charge_red'); break;
    case 'turbo1': case 'turbo2': case 'turbo3': {
      audio.play(name, { vol, at }); fx?.burst('turbo', k.pos, { n: 8 + 4 * +name.slice(-1), color: name === 'turbo3' ? 0xb54dff : 0xffc23a });
      if (me && name === 'turbo3') audio.bark?.(k.racerId, 'boost');
      break;
    }
    case 'fizzle': audio.play('fizzle', { vol, at }); fx?.burst('fizzle', k.pos, { n: 8 }); break;
    case 'overheat': audio.play('overheat', { vol, at }); fx?.burst('overheat', k.pos, { n: 14 }); break;
    case 'pad': audio.play('pad', { vol, at }); fx?.burst('pad', k.pos, { n: 14 }); break;
    case 'hang1': case 'hang2': audio.play(name === 'hang2' ? 'turbo2' : 'turbo1', { vol, at }); break;
    case 'start_boost': audio.play('start_boost', { vol, at }); fx?.burst('turbo', k.pos, { n: 16 }); break;
    case 'wall': audio.play('wall', { vol: vol * (0.5 + (v || 0.5)), at }); fx?.burst('wall', k.pos, { n: 10 }); if (me) viewOf(k).chase.shake(0.35 * (v || 0.5)); break;
    case 'bump': audio.play('bump', { vol: vol * (0.5 + (v || 0.5)), at }); if (me) viewOf(k).chase.shake(0.2); break;
    case 'respawn': audio.play('respawn', { vol, at }); if (v === 'splash') { audio.play('splash', { vol, at }); fx?.burst('splash', { x: k.pos.x, y: G.track.water?.y ?? k.pos.y, z: k.pos.z }); } break;
    case 'respawned': fx?.burst('poof', k.pos, { n: 14 }); fx?.burst('sparkle', k.pos, { n: 10 }); break;
    case 'hit': audio.play(v === 'flip' ? 'flip' : 'spinout', { vol, at }); break;
    case 'shield_pop': audio.play('shield_pop', { vol, at }); break;
  }
}
function showResults() {
  const rows = G.race.results().map(r => ({ place: r.place, name: PNAME(r.racerId), time: r.time, estimated: r.estimated, isPlayer: r.kart.isPlayer, racerId: r.racerId }));
  hud.results(rows);
  audio.music('results');
  setState('results');
}

/* ------------------------------------------------------------------ visuals */
const _qa = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _up = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
function snapVisual(i, k) { const v = G.visuals[i]; v.px = k.pos.x; v.py = k.pos.y; v.pz = k.pos.z; v.pyaw = k.yaw + k.drift * k.driftAngle; }
const lerpAng = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
function drawKarts(alpha, dt) {
  const race = G.race;
  blob.count = race.karts.length; blob.instanceMatrix.needsUpdate = true;
  for (const [i, k] of race.karts.entries()) {
    const v = G.visuals[i], root = v.root;
    let x = v.px + (k.pos.x - v.px) * alpha, y = v.py + (k.pos.y - v.py) * alpha, z = v.pz + (k.pos.z - v.pz) * alpha;
    let yaw = lerpAng(v.pyaw, k.yaw + k.drift * k.driftAngle, alpha);
    // rescue: sink out of sight for a beat, then ride the cloud down to the drop point
    const cloud = clouds[i] || (clouds[i] = makeCloud());
    cloud.visible = false;
    root.visible = true;
    if (k.respawnT > 0 && k.respawnAt != null) {
      const ride = T.RESPAWN_T - 0.3;                         // seconds of cloud ride at the end
      if (k.respawnT > ride) root.visible = false;
      else {
        const p = G.track.pointAt(k.respawnAt, 0), u = k.respawnT / ride;   // 1 → 0
        x = p.x; z = p.z; y = p.y + T.RESPAWN_DROP + u * u * 9; yaw = p.yaw;
        cloud.visible = true; cloud.position.set(x, y + 2.2, z); cloud.rotation.y = G.t * 0.8;
      }
      v.px = x; v.py = y; v.pz = z; v.pyaw = yaw;
    } else if (k.air && k.hop && k.vy < 0 && k.pos.y - k.ground > 1.5 && !k.hitT) {
      // just released by the cloud: let it float up and away
      const cl = clouds[i]; cl.visible = true; cl.position.set(x, k.ground + T.RESPAWN_DROP + 2.2 + (T.RESPAWN_DROP - (y - k.ground)) * 2.5, z);
    }
    root.position.set(x, y, z);
    _up.set(k.nrm.x, k.nrm.y, k.nrm.z).normalize();
    _qa.setFromUnitVectors(_Y, _up); _qy.setFromAxisAngle(_Y, yaw);
    root.quaternion.copy(_qa).multiply(_qy);
    v.ix = x; v.iy = y; v.iz = z; v.iyaw = k.yaw; v.byaw = yaw;
    v.base = root.visible;                    // before the per-view culling (cullKarts)
    v.gy = isFinite(k.ground) ? k.ground : y;
    if (v.rig && R.animateRacer) {
      const a = v.anim;
      a.speed = k.speed; a.maxSpeed = baseTop(k); a.steer = k.steer; a.throttle = k.throttle; a.drift = k.drift; a.driftAngle = k.driftAngle;
      a.charge = k.charge; a.boostT = k.boostT; a.air = k.air; a.airT = k.airT; a.landT = k.landT;
      a.hitT = k.hitT > 0 ? 1 - k.hitT / k.hitDur : 0; a.hitKind = k.hitKind; a.spinT = k.spinT; a.slowT = k.slowT;
      a.cheer = k.finished && k.finishPlace <= 3; a.sad = k.finished && k.finishPlace > 5;
      a.t = G.t;
      try { R.animateRacer(v.rig, a, dt); } catch (e) { if (!v.warned) { console.warn('[otr] animateRacer threw', e); v.warned = true; } }
    }
  }
}

/** Is kart i drawn from this camera? Far karts are skipped (fog hides them anyway; ~12 draw calls
 *  each), and an AI kart (2P: or the OTHER player's kart) right on top of the camera would fill the
 *  screen with the inside of its model (seen at the grid: King Dad's crown) — hidden for those frames. */
function kartSeen(i, cam, self, farD) {
  const v = G.visuals[i];
  if (!v.base) return false;
  const dx = v.ix - cam.position.x, dz = v.iz - cam.position.z;
  if (dx * dx + dz * dz > farD * farD) return false;
  return i === self || dx * dx + (v.iy + 0.8 - cam.position.y) ** 2 + dz * dz >= 2.4 * 2.4;
}
/** Per-view kart visibility (1P: the one camera) + the blob shadows (visible from any view). */
function cullKarts(nv) {
  const race = G.race, farD = qual().far;
  for (let j = 0; j < nv; j++) {
    const vw = views[j], self = race.humans[j]?.index ?? race.playerIndex, seen = vw.seen || (vw.seen = []);
    seen.length = race.karts.length;
    for (let i = 0; i < seen.length; i++) seen[i] = kartSeen(i, vw.cam, self, farD);
  }
  for (const [i] of race.karts.entries()) {
    const v = G.visuals[i], seen = views[0].seen[i] || (nv > 1 && views[1].seen[i]);
    v.root.visible = seen;
    // blob shadow on the ground under the kart (not for the 1P player with shadows on: it has a real one)
    const hgt = Math.max(0, v.iy - v.gy), sc = seen && (i !== race.playerIndex || !G.shadowsOn) ? Math.max(0.35, 1 - hgt * 0.18) : 0;
    _bq.setFromAxisAngle(_Y, v.byaw); _bs.set(sc, 1, sc); _bp.set(v.ix, v.gy + 0.15, v.iz);   // 4 cm lost the depth fight with the road's polygonOffset at grazing angles
    blob.setMatrixAt(i, _bm.compose(_bp, _bq, _bs));
  }
}
const _near = { x: 0, y: 0, z: 0 };
/** 2P: the camera nearest a kart (particle LOD) */
const nearCam = k => { if (!G.mp) return camera.position; const a = camera.position, b = camera2.position; return dist2(k.pos, a) <= dist2(k.pos, b) ? a : b; };

/* ------------------------------------------------------------------ frame */
let last = performance.now();
const hudView = {};
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  In.update();
  if (G.mp) {
    const [p1, p2] = In.players;
    if (p1.hit('hopA')) G.pendA = true; if (p1.hit('hopB')) G.pendB = true; if (p1.hit('item')) G.pendI = true;
    if (p2.hit('hopA')) G.pend2.A = true; if (p2.hit('hopB')) G.pend2.B = true; if (p2.hit('item')) G.pend2.I = true;
  } else {
    if (In.hit('hopA')) G.pendA = true;
    if (In.hit('hopB')) G.pendB = true;
    if (In.hit('item')) G.pendI = true;
  }
  if (In.hit('mute')) audio.toggleMute();
  if (In.hit('fullscreen')) { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); }
  // with menu.js loaded it owns pause / title / results input (its own keyboard + pad reading)
  if (!MENU && In.hit('pause') && (G.state === 'race' || G.state === 'countdown' || G.state === 'finished')) { G.paused = !G.paused; audio.pause?.(G.paused); hud.banner(G.paused ? 'PAUSED' : '', G.paused ? 1e9 : 1); }
  if (!MENU && G.state === 'title' && (In.hit('confirm') || In.hit('hopA') || In.hit('item'))) { $('screens').classList.add('hide'); startRace(); }
  if (!MENU && G.state === 'results' && (In.hit('confirm') || In.hit('hopA'))) { G.pendA = false; startRace(); }
  tick(dt);
  render(dt);
  watchQuality((now - (frame.prev ?? now)) / 1000); frame.prev = now;
}
function tick(dt) {
  if (!G.race || G.paused || G.state === 'boot' || G.state === 'title') return;
  G.t += dt;
  G.acc += dt * G.timeScale;
  let steps = 0;
  while (G.acc >= DT && steps < 10) { stepSim(); G.acc -= DT; steps++; }
  if (steps === 10) G.acc = 0;
}
function render(dt) {
  if (!G.race) {
    if (G.menuCovers) return;   // an opaque menu screen is up: don't draw the orbit behind it
    if (renderer.getScissorTest()) { renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight); }
    // title / loading: a slow orbit around the start arch
    if (G.track) {
      G.t += dt; const f = G.track.frameAt(0), a = G.t * 0.12;
      camera.position.set(f.x + Math.cos(a) * 34, f.y + 9, f.z + Math.sin(a) * 34); camera.lookAt(f.x, f.y + 3, f.z);
      if (G.tm.sky) G.tm.sky.position.copy(camera.position);
      G.tm.update(dt, G.t);
      sun.target.position.set(f.x, f.y, f.z); sun.position.copy(sun.target.position).addScaledVector(G.sunDir, 120);
    }
    renderer.render(scene, camera); return;
  }
  const alpha = Math.min(1, G.acc / DT);
  drawKarts(G.paused ? 1 : alpha, G.paused ? 0 : dt);
  const race = G.race, P = race.player, pv = G.visuals[race.playerIndex];
  const nv = G.mp ? 2 : 1;
  for (let j = 0; j < nv; j++) {   // one chase camera per human (2P: P1 top, P2 bottom)
    const k = race.humans[j] || P, v = G.visuals[k.index];
    views[j].chase.update(dt, k, { x: v.ix, y: v.iy, z: v.iz }, lerpAng(v.pyaw - k.drift * k.driftAngle, k.yaw, alpha), G.track, G.tm.groundAt);
  }
  cullKarts(nv);
  // sun + shadow camera follow the player; sky follows the camera
  sun.target.position.set(pv.ix, pv.iy, pv.iz);
  sun.position.copy(sun.target.position).addScaledVector(G.sunDir, 120);
  if (G.tm.sky) G.tm.sky.position.copy(camera.position);
  G.tm.update(dt, G.t);
  if (!G.paused) IV.update(dt, alpha);
  if (fx && !G.paused) {
    for (const [i, k] of race.karts.entries()) fx.kart(k, G.visuals[i].rig, dt, nearCam(k));
    fx.update(dt, camera);
  }
  // audio: 1P listens at the camera; 2P at the midpoint of the two cameras (P1's heading). Both
  // players' engines are "player" voices (audio.js gives each human kart its own), so both stay loud.
  const fwd = { x: Math.sin(chase.yaw), z: Math.cos(chase.yaw) };
  if (G.mp) { _near.x = (camera.position.x + camera2.position.x) / 2; _near.y = (camera.position.y + camera2.position.y) / 2; _near.z = (camera.position.z + camera2.position.z) / 2; audio.listener(_near, fwd); }
  else audio.listener(camera.position, fwd);
  for (const k of race.karts) audio.engineUpdate(k.index, { speed: Math.abs(k.speed), maxSpeed: baseTop(k), throttle: k.ctrl?.throttle ?? k.throttle, drift: k.drift !== 0, boost: k.boostT > 0, air: k.air, pos: k.pos, offroad: !k.onRoad && !k.air, charge: k.drift ? k.charge : 0, racerId: k.racerId });
  for (const h of race.humans) {
    const off = offLoops.get(h);
    if (h.respawnT <= 0 && !h.onRoad && !h.air && Math.abs(h.speed) > 5) { if (!off) offLoops.set(h, audio.play('offroad', { loop: true, vol: G.mp ? 0.45 : 0.6 })); }
    else if (off) { off.stop(0.15); offLoops.delete(h); }
  }
  // hud (one per human)
  for (let j = 0; j < nv; j++) {
    const k = race.humans[j] || P;
    Object.assign(hudView, { lap: k.lap, laps: race.laps, place: k.place, speed: k.speed, charge: k.charge, redStart: redStart(k), inRed: k.inRed,
      drift: k.drift, overheat: k.overheat, turbos: k.turbos, boostT: k.boostT, boostMaxT: k.boostMaxT, stars: k.stars, finished: k.finished,
      raceTime: k.finished ? k.finishTime : Math.max(0, race.t), wrongWay: false });
    views[j].hud.update(hudView, race);
  }
  if (!G.mp) {
    renderer.render(scene, camera);
  } else {
    // two views of the one scene: top half = P1, bottom half = P2 (three's viewport y is from the bottom)
    const W = innerWidth, Hh = innerHeight / 2;
    renderer.info.autoReset = false; renderer.info.reset();
    renderer.setScissorTest(true);
    for (let j = 0; j < 2; j++) {
      const vw = views[j], y = j === 0 ? Hh : 0;
      renderer.setViewport(0, y, W, Hh); renderer.setScissor(0, y, W, Hh);
      for (const [i, v] of G.visuals.entries()) v.root.visible = vw.seen[i];
      if (G.tm.sky) G.tm.sky.position.copy(vw.cam.position);
      if (fx && !G.paused && j === 1) fx.update(0, vw.cam);   // re-billboard the particles for this camera (dt 0 = no sim step)
      renderer.render(scene, vw.cam);
    }
    renderer.setScissorTest(false); renderer.setViewport(0, 0, W, innerHeight);
    renderer.info.autoReset = true;          // info() now holds the whole frame (both views)
  }
  G.frames++;
}

/* ------------------------------------------------------------------ test hooks */
window.__OTR = {
  get ready() { return G.ready; }, get state() { return G.state; }, G, setState, onState,
  get race() { return G.race; }, get track() { return G.track; }, get player() { return G.race?.player; },
  get humans() { return G.race?.humans || []; },
  THREE, scene, camera, renderer, chase, fx, audio, T, DT, In, camera2, chase2, hud2, views,
  /** Drive the player (2P: pn 1 = player 2) with a fixed control object ({steer,throttle,brake,hopA,hopB}) or null to hand back. */
  override(c, pn = 0) { if (pn === 1) G.override2 = c; else G.override = c; },
  /** Fast-forward the sim synchronously (no rendering), then render one frame. */
  advance(secs) { advance(secs); render(0); },
  /** Step N sim frames with a per-step control function (k, i) => ctrl; returns collected kart events for the player. */
  script(n, fn, { draw = false } = {}) {
    const evs = [];
    for (let i = 0; i < n; i++) {
      G.override = fn(G.race.player, i); stepSim(); G.acc = 0;
      for (const e of G.race.events) if (e.kart === G.race.player && e.type === 'kart') evs.push(e.e);
      if (draw) render(DT);
    }
    G.override = null; render(DT); return evs;
  },
  /** Freeze the live loop (screenshots of scripted states): the sim stops, rendering continues. */
  hold(on = true) { G.timeScale = on ? 0 : 1; G.acc = 0; },
  render() { render(1 / 60); },
  info() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length }; },
  setPaused(p) { G.paused = p; },
  loadTrack, startRace, endRace, hud, setQuality,
};

/* ------------------------------------------------------------------ boot */
setQuality(Q.get('q') || 'auto');   // menu.js re-applies the saved GRAPHICS setting (unless ?q=)
In.initTouch();
In.onGesture(() => { audio.init(); audio.unlock(); });
setState('boot');
await loadTrack(G.trackId);
requestAnimationFrame(frame);
const SKIP = Q.get('skip') === '1' || Q.has('t') || Q.get('ai') === '1';
if (MENU) {
  try {
    await MENU.initMenu({ G, Q, scene, camera, renderer, audio, hud, hud2, In, R, loadTrack, startRace, endRace, setState, onState,
      advance(s) { advance(s); render(0); }, setQuality }, { skip: SKIP });
  } catch (e) { console.error('[otr] menu.js init failed, placeholder title', e); MENU = null; }
}
if (SKIP) {
  $('screens').classList.add('hide');
  await startRace();
  if (Q.has('t')) {
    // fast-forward: AI drives the player through the countdown + t seconds, then hands back
    const wasAuto = G.race.autoPlayer;
    G.race.autoPlayer = true;
    advance(COUNTDOWN + qn('t', 0));
    G.race.autoPlayer = wasAuto;
    for (const [i, k] of G.race.karts.entries()) snapVisual(i, k);
    chase.snap(G.race.player);
    if (G.race.phase === 'race' && G.state === 'countdown') setState('race');
    hud.count(null);
  }
} else if (!MENU) {
  $('card').innerHTML = `<h1>ORION TEAM RACING<small>${G.track.name.toUpperCase()}</small></h1><p class="go">Press Space / A / tap to race!</p>`;
  setState('title');
  // tap anywhere on touch to start
  $('screens').style.pointerEvents = 'auto';
  $('screens').addEventListener('pointerdown', () => { if (G.state === 'title') { $('screens').classList.add('hide'); $('screens').style.pointerEvents = 'none'; startRace(); } }, { once: true });
}
G.ready = true;
