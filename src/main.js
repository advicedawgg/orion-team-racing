// main.js — boot, renderer, fixed-step loop with interpolation, state machine, wiring.
//
// States: boot → title (skipped with ?skip=1) → countdown → race → finished (player done, AI
// keeps racing, AI drives the player's kart) → results. setState(name) is the one place state
// changes; screen code (the UI agent's menu.js) subscribes with onState(fn).
//
// URL debug params (DESIGN.md): track, racer, skip, cam=x,y,z,tx,ty,tz, t (fast-forward s with
// AI driving), ai=1 (AI drives the player), hud=0, diff=easy|medium|hard, slot (player grid slot
// 0..7), laps, seed, touch=1, hd=1, shadows=0, fx=0.   window.__OTR exposes state for tests.
import * as THREE from 'three';
import * as In from './input.js';
import { DT, T, redStart, baseTop } from './physics.js';
import { buildTrack } from './track.js';
import { TRACKS, trackById } from './tracks/index.js';
import { createRace, COUNTDOWN } from './race.js';
import { buildTrackMesh, mergeGeos } from './trackmesh.js';
import { ChaseCam } from './camera.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';

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
const hemi = new THREE.HemisphereLight(0xd8f0ff, 0xc8a870, 1.05);
const sun = new THREE.DirectionalLight(0xfff2d6, 2.3);
sun.castShadow = SHADOWS;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 220 });
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
scene.add(hemi, sun, sun.target);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ------------------------------------------------------------------ game state */
const hud = createHud($('hud'));
const fx = Q.get('fx') === '0' ? null : createFx(scene);
const chase = new ChaseCam(camera);
if (Q.get('cam')) chase.pin(Q.get('cam').split(',').map(Number));
const stateFns = new Set();
const G = {
  state: 'boot', track: null, tm: null, race: null, visuals: [], ready: false,
  difficulty: Q.get('diff') || 'easy', racerId: Q.get('racer') || 'orion', trackId: Q.get('track') || TRACKS[0].id,
  slot: qn('slot', 6), laps: Q.has('laps') ? qn('laps', 3) : undefined, seed: qn('seed', 1),
  acc: 0, timeScale: 1, paused: false, override: null, pendA: false, pendB: false, t: 0, frames: 0,
  hd: Q.get('hd') === '1',
};
export function setState(s) {
  const prev = G.state; G.state = s;
  for (const fn of stateFns) try { fn(s, prev); } catch (e) { console.error(e); }
}
export const onState = fn => { stateFns.add(fn); return () => stateFns.delete(fn); };

/* ------------------------------------------------------------------ track */
async function loadTrack(id) {
  if (G.tm) { scene.remove(G.tm.group); G.tm.group.traverse(o => { o.geometry?.dispose?.(); }); }
  const def = trackById(id);
  G.track = buildTrack(def);
  G.tm = await buildTrackMesh(G.track, { scene });
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
  const all = R.RACERS.map(r => r.id);
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
  const { ids, slot } = entrantsFor(G.racerId);
  const stats = id => (R.RACERS.find(r => r.id === id) || {}).stats || { speed: 3, accel: 3, turn: 3 };
  G.race = createRace({ track: G.track, entrants: ids.map(id => ({ racerId: id, stats: stats(id) })), playerIndex: slot,
    difficulty: G.difficulty, laps: G.laps, seed: G.seed });
  if (Q.get('ai') === '1') G.race.autoPlayer = true;
  In.settings.autoAccel = Q.has('auto') ? Q.get('auto') === '1' : false;
  G.slotIndex = slot;
  buildVisuals(ids);
  for (const [i, k] of G.race.karts.entries()) snapVisual(i, k);
  chase.snap(G.race.player);
  fx?.clearSkids();
  hud.results(null); hud.count(null);
  hud.show(Q.get('hud') !== '0');
  audio.enginesOff?.();
  for (const k of G.race.karts) audio.engineStart(k.index, k.isPlayer);
  audio.music(G.track.def.music || G.track.theme);
  G.acc = 0; G.t = 0;
  // warm every shader before the lights go green (three compiles per material × light count)
  try { await renderer.compileAsync(scene, camera); } catch { renderer.compile(scene, camera); }
  setState('countdown');
}

/* ------------------------------------------------------------------ sim stepping */
function playerCtrl() {
  const c = G.override || In.controls;
  const out = { steer: c.steer || 0, throttle: c.throttle || 0, brake: c.brake || 0, hopA: !!c.hopA || G.pendA, hopB: !!c.hopB || G.pendB };
  return out;
}
function stepSim() {
  const race = G.race;
  for (const [i, k] of race.karts.entries()) { const v = G.visuals[i]; v.px = k.pos.x; v.py = k.pos.y; v.pz = k.pos.z; v.pyaw = k.yaw + k.drift * k.driftAngle; }
  race.step(playerCtrl());
  G.pendA = G.pendB = false;
  handleEvents(race.events);
}
/** Fast-forward N seconds synchronously (tests / ?t=). Renders nothing. */
function advance(secs) {
  const n = Math.round(secs / DT);
  G.ff = true;
  try { for (let i = 0; i < n && G.race.phase !== 'done'; i++) stepSim(); } finally { G.ff = false; }
}

/* ------------------------------------------------------------------ events → audio / fx / hud */
const PNAME = id => (R.RACERS.find(r => r.id === id) || { name: id }).name;
let driftLoop = null, offLoop = null;
function handleEvents(events) {
  const race = G.race, P = race.player;
  if (G.ff) {   // fast-forwarding: keep the state machine right, skip the sound and fury
    for (const e of events) {
      if (e.type === 'go' && G.state === 'countdown') setState('race');
      else if (e.type === 'finish' && e.kart === P) setState('finished');
      else if (e.type === 'race_done') showResults();
    }
    return;
  }
  for (const e of events) {
    const k = e.kart, me = k && k === P;
    const at = k && !me ? k.pos : null;
    const near = k && (me || dist2(k.pos, camera.position) < 60 * 60);
    switch (e.type) {
      case 'count': hud.count(e.n); audio.play('countdown'); audio.play('vo_' + e.n); break;
      case 'go': hud.count('GO!'); audio.play('go'); audio.play('vo_go'); setTimeout(() => hud.count(null), 700); if (G.state === 'countdown') setState('race'); break;
      case 'lap': if (me) { audio.play('lap'); if (e.lap < race.laps) hud.banner(`LAP ${e.lap}`, 1300); } break;
      case 'final_lap': if (me) { audio.play('final_lap'); audio.play('vo_final_lap'); hud.banner('FINAL LAP!', 1800, 'final'); } break;
      case 'finish':
        if (me) {
          audio.play('finish'); audio.play(e.place === 1 ? 'win' : e.place <= 3 ? 'finish' : 'lose');
          if (e.place === 1) audio.play('vo_you_win');
          hud.banner(e.place === 1 ? 'YOU WIN!' : `${e.place}${['st', 'nd', 'rd'][e.place - 1] || 'th'} PLACE!`, 3000);
          setState('finished');
        }
        break;
      case 'race_done': showResults(); break;
      case 'stall': if (me) hud.banner('Too early!', 900); break;
      case 'kart': if (near) kartEvent(k, e.e, e.v, me, at); break;
    }
  }
}
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
function kartEvent(k, name, v, me, at) {
  const vol = me ? 1 : 0.55;
  switch (name) {
    case 'hop': audio.play('hop', { vol: vol * 0.8, at }); break;
    case 'land': if (v > 0.25) { audio.play('land', { vol: vol * Math.min(1, v + 0.3), at }); fx?.burst('land', k.pos, { surface: k.surface, n: 10 }); if (me) chase.shake(0.15 * v); } break;
    case 'drift_start': audio.play('drift_start', { vol, at }); if (me) { driftLoop?.stop(0.05); driftLoop = audio.play('drift_loop', { loop: true, vol: 0.8 }); } break;
    case 'drift_end': if (me) { driftLoop?.stop(0.12); driftLoop = null; } break;
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
    case 'wall': audio.play('wall', { vol: vol * (0.5 + (v || 0.5)), at }); fx?.burst('wall', k.pos, { n: 10 }); if (me) chase.shake(0.35 * (v || 0.5)); break;
    case 'bump': audio.play('bump', { vol: vol * (0.5 + (v || 0.5)), at }); if (me) chase.shake(0.2); break;
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
    v.ix = x; v.iy = y; v.iz = z; v.iyaw = k.yaw;
    // far karts: skip drawing (fog hides them anyway; saves ~12 draw calls each)
    const far = (x - camera.position.x) ** 2 + (z - camera.position.z) ** 2 > 230 * 230;
    if (far) root.visible = false;
    // blob shadow on the ground under the kart (not for the player: it has a real one)
    const gy = isFinite(k.ground) ? k.ground : y;
    const hgt = Math.max(0, y - gy), sc = root.visible && i !== race.playerIndex ? Math.max(0.35, 1 - hgt * 0.18) : 0;
    _bq.setFromAxisAngle(_Y, yaw); _bs.set(sc, 1, sc); _bp.set(x, gy + 0.15, z);   // 4 cm lost the depth fight with the road's polygonOffset at grazing angles
    blob.setMatrixAt(i, _bm.compose(_bp, _bq, _bs));
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

/* ------------------------------------------------------------------ frame */
let last = performance.now();
const hudView = {};
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  In.update();
  if (In.hit('hopA')) G.pendA = true;
  if (In.hit('hopB')) G.pendB = true;
  if (In.hit('mute')) audio.toggleMute();
  if (In.hit('fullscreen')) { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); }
  if (In.hit('pause') && (G.state === 'race' || G.state === 'countdown' || G.state === 'finished')) { G.paused = !G.paused; audio.pause?.(G.paused); hud.banner(G.paused ? 'PAUSED' : '', G.paused ? 1e9 : 1); }
  if (G.state === 'title' && (In.hit('confirm') || In.hit('hopA') || In.hit('item'))) { $('screens').classList.add('hide'); startRace(); }
  if (G.state === 'results' && (In.hit('confirm') || In.hit('hopA'))) { G.pendA = false; startRace(); }
  tick(dt);
  render(dt);
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
  const P = G.race.player, pv = G.visuals[G.race.playerIndex];
  chase.update(dt, P, { x: pv.ix, y: pv.iy, z: pv.iz }, lerpAng(pv.pyaw - P.drift * P.driftAngle, P.yaw, alpha), G.track, G.tm.groundAt);
  // sun + shadow camera follow the player; sky follows the camera
  sun.target.position.set(pv.ix, pv.iy, pv.iz);
  sun.position.copy(sun.target.position).addScaledVector(G.sunDir, 120);
  if (G.tm.sky) G.tm.sky.position.copy(camera.position);
  G.tm.update(dt, G.t);
  if (fx && !G.paused) {
    for (const [i, k] of G.race.karts.entries()) fx.kart(k, G.visuals[i].rig, dt, camera.position);
    fx.update(dt, camera);
  }
  // audio
  const fwd = { x: Math.sin(chase.yaw), z: Math.cos(chase.yaw) };
  audio.listener(camera.position, fwd);
  for (const k of G.race.karts) audio.engineUpdate(k.index, { speed: Math.abs(k.speed), maxSpeed: baseTop(k), throttle: k.ctrl?.throttle ?? k.throttle, drift: k.drift !== 0, boost: k.boostT > 0, air: k.air, pos: k.pos, offroad: !k.onRoad && !k.air });
  if (P.respawnT <= 0 && !P.onRoad && !P.air && Math.abs(P.speed) > 5) { if (!offLoop) offLoop = audio.play('offroad', { loop: true, vol: 0.6 }); }
  else if (offLoop) { offLoop.stop(0.15); offLoop = null; }
  // hud
  const race = G.race;
  Object.assign(hudView, { lap: P.lap, laps: race.laps, place: P.place, speed: P.speed, charge: P.charge, redStart: redStart(P), inRed: P.inRed,
    drift: P.drift, overheat: P.overheat, turbos: P.turbos, boostT: P.boostT, boostMaxT: P.boostMaxT, stars: P.stars, finished: P.finished,
    raceTime: P.finished ? P.finishTime : Math.max(0, race.t), wrongWay: false });
  hud.update(hudView);
  renderer.render(scene, camera);
  G.frames++;
}

/* ------------------------------------------------------------------ test hooks */
window.__OTR = {
  get ready() { return G.ready; }, get state() { return G.state; }, G, setState, onState,
  get race() { return G.race; }, get track() { return G.track; }, get player() { return G.race?.player; },
  THREE, scene, camera, renderer, chase, fx, audio, T, DT,
  /** Drive the player with a fixed control object ({steer,throttle,brake,hopA,hopB}) or null to hand back. */
  override(c) { G.override = c; },
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
  loadTrack, startRace,
};

/* ------------------------------------------------------------------ boot */
In.initTouch();
In.onGesture(() => { audio.init(); audio.unlock(); });
setState('boot');
await loadTrack(G.trackId);
requestAnimationFrame(frame);
if (Q.get('skip') === '1' || Q.has('t') || Q.get('ai') === '1') {
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
} else {
  $('card').innerHTML = `<h1>ORION TEAM RACING<small>${G.track.name.toUpperCase()}</small></h1><p class="go">Press Space / A / tap to race!</p>`;
  setState('title');
  // tap anywhere on touch to start
  $('screens').style.pointerEvents = 'auto';
  $('screens').addEventListener('pointerdown', () => { if (G.state === 'title') { $('screens').classList.add('hide'); $('screens').style.pointerEvents = 'none'; startRace(); } }, { once: true });
}
G.ready = true;
