// input.js — keyboard + Gamepad API (standard mapping) + touch → one abstract control set.
// Call update() once per rendered frame BEFORE reading. Read `controls` for driving and
// hit(name) for edge-triggered menu/buttons. NEVER binds Ctrl (Ctrl+W closes the tab).
//
//   controls = { steer (-1..1, +left), throttle (0..1), brake (0..1), hopA, hopB (held), item (held) }
//   hit('hopA'|'hopB'|'item'|'pause'|'mute'|'fullscreen'|'confirm'|'back'|'up'|'down'|'left'|'right')
//
// Shoulder taps shorter than a frame are latched so a quick press is never lost; main.js also
// latches shoulder presses until a physics step has seen them (a render frame may run 0 steps).
//
// 2P split screen (multiplayer agent): `players[0|1]` are per-player controllers with the same
// shape (`controls`, `hit(n)`, `down(n)`, `autoAccel`), each reading ONE device:
//   'kb'  the whole keyboard (1P bindings)      'pad:N'  the gamepad with Gamepad.index N
//   'kbL' left half: WASD, Space hop, Left Shift turbo, E item
//   'kbR' right half: arrows, Right Shift or / hop, . turbo, Enter item
//   'auto' (default): 2+ pads → P1 = first pad, P2 = second; 1 pad → P1 = pad, P2 = keyboard;
//          no pads → P1 = kbL, P2 = kbR.
// setDevices(d1, d2) assigns them (the join screen); multi(true) switches the per-player update
// on. The 1P `controls` above keep merging every device exactly as before. takeJoins() returns the
// devices that pressed a "join" button since the last call (A/Start on a pad, Space/E/LShift on
// the left half, Enter/RShift/'/'/'.' on the right half) — the join screen reads it.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'hopA', ShiftLeft: 'hopB', ShiftRight: 'hopB',
  KeyE: 'item', Enter: 'item',
  Escape: 'pause', KeyP: 'pause', KeyM: 'mute', KeyF: 'fullscreen',
};
/** 2P, one keyboard: two non-overlapping halves (KeyboardEvent.code tells ShiftLeft from ShiftRight). */
export const KEYMAP_L = { KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down', Space: 'hopA', ShiftLeft: 'hopB', KeyE: 'item' };
export const KEYMAP_R = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', ShiftRight: 'hopA', Slash: 'hopA', Period: 'hopB', Enter: 'item', NumpadEnter: 'item' };
const JOIN_L = new Set(['Space', 'KeyE', 'ShiftLeft']);
const JOIN_R = new Set(['Enter', 'NumpadEnter', 'ShiftRight', 'Slash', 'Period']);
const BOUND = new Set([...Object.keys(KEYMAP), ...Object.keys(KEYMAP_L), ...Object.keys(KEYMAP_R)]);

const codes = new Set(), codeLatch = new Set();      // keyboard: held KeyboardEvent.codes + taps shorter than a frame
const pad = new Set(), touch = new Set(), latched = new Set();
const held = new Set(), prev = new Set();
let padSteer = 0, padThr = 0, padBrk = 0, touchSteer = 0;
let anyGesture = null;
const pads = new Map();                              // Gamepad.index → { names, steer, thr, brk, a, start }
const joins = [];

/** Settings the game may flip. autoAccel = always accelerate unless braking (default ON in Easy). */
export const settings = { autoAccel: false, touchUI: false };
export const controls = { steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false, item: false };
export const down = n => held.has(n);
export const hit = n => held.has(n) && !prev.has(n);
/** Register a callback for the first user gesture (audio unlock). */
export const onGesture = fn => { anyGesture = fn; };
let lastDevice = 'keyboard', lastPad = 0;
export const device = () => lastDevice;
/** The last used device as a player device id: 'kb' | 'pad:N' | 'touch'. */
export const deviceId = () => lastDevice === 'pad' ? 'pad:' + lastPad : lastDevice === 'touch' ? 'touch' : 'kb';

const gesture = () => { if (anyGesture) { const f = anyGesture; anyGesture = null; f(); } };

if (typeof addEventListener !== 'undefined') {
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;          // never steal browser shortcuts
    if (BOUND.has(e.code)) {
      codes.add(e.code); codeLatch.add(e.code); e.preventDefault(); lastDevice = 'keyboard';
      if (!e.repeat && joins.length < 16) { if (JOIN_L.has(e.code)) joins.push('kbL'); else if (JOIN_R.has(e.code)) joins.push('kbR'); }
    }
    gesture();
  });
  addEventListener('keyup', e => { codes.delete(e.code); });
  addEventListener('blur', () => codes.clear());
  addEventListener('pointerdown', gesture);
}
/** names a keymap gives the held (and just-tapped) keys */
function keyNames(map, out) {
  for (const c of codes) { const n = map[c]; if (n) out.add(n); }
  for (const c of codeLatch) { const n = map[c]; if (n) out.add(n); }
  return out;
}

/* -------------------------------------------------------------- gamepad */
function readPad(p, st) {
  const b = i => !!p.buttons[i]?.pressed;
  const v = i => p.buttons[i]?.value || 0;
  const ax = p.axes[0] || 0;
  const names = st.names; names.clear();
  let steer = Math.abs(ax) < 0.18 ? 0 : -Math.sign(ax) * (Math.abs(ax) - 0.18) / 0.82;   // stick right = steer right (−)
  if (b(14)) steer = 1; if (b(15)) steer = -1;
  st.steer = steer;
  st.thr = Math.max(b(0) ? 1 : 0, v(7) > 0.1 ? v(7) : 0);
  st.brk = Math.max(b(2) ? 1 : 0, v(6) > 0.1 ? v(6) : 0);
  if (b(5)) names.add('hopA');
  if (b(4)) names.add('hopB');
  if (b(1) || b(3)) names.add('item');
  if (b(9)) names.add('pause');
  if (b(12) || (p.axes[1] || 0) < -0.6) names.add('up');
  if (b(13) || (p.axes[1] || 0) > 0.6) names.add('down');
  if (b(14) || ax < -0.6) names.add('left');
  if (b(15) || ax > 0.6) names.add('right');
  if (b(0)) names.add('confirm');
  if (b(1)) names.add('back');
  const a = b(0), start = b(9);
  if ((a && !st.a || start && !st.start) && joins.length < 16) joins.push('pad:' + p.index);
  st.a = a; st.start = start;
  st.active = names.size > 0 || st.thr > 0 || st.brk > 0 || st.steer !== 0;
}
function pollPad() {
  pad.clear(); padSteer = padThr = padBrk = 0;
  const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const seen = new Set();
  let first = null;
  for (const p of list || []) {
    if (!p) continue;
    const idx = p.index ?? 0;
    seen.add(idx);
    let st = pads.get(idx);
    if (!st) { st = { names: new Set(), steer: 0, thr: 0, brk: 0, a: false, start: false, active: false }; pads.set(idx, st); }
    readPad(p, st);
    if (!first) first = st;
    if (st.active) { lastDevice = 'pad'; lastPad = idx; }
  }
  for (const idx of [...pads.keys()]) if (!seen.has(idx)) pads.delete(idx);
  // 1P: the first connected pad, exactly as before
  if (!first) return;
  for (const n of first.names) pad.add(n);
  padSteer = first.steer; padThr = first.thr; padBrk = first.brk;
  if (first.active) gesture();
  for (const st of pads.values()) if (st.active) { gesture(); break; }
}
/** connected gamepad indices, ascending */
export const padIndices = () => [...pads.keys()].sort((a, b) => a - b);

/* ---------------------------------------------------------------- touch */
/** Wire the on-screen buttons (elements with data-btn="left|right|brake|hopA|hopB|item|pause"). */
export function initTouch(root = document) {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (!coarse && !/[?&]touch=1/.test(location.search)) return false;
  document.body.classList.add('touch');
  settings.touchUI = true;
  for (const el of root.querySelectorAll('[data-btn]')) {
    const name = el.dataset.btn;
    const ids = new Set();
    const on = e => { e.preventDefault(); ids.add(e.pointerId); touch.add(name); latched.add(name); el.classList.add('on'); lastDevice = 'touch'; gesture(); };
    const off = e => { ids.delete(e.pointerId); if (!ids.size) { touch.delete(name); el.classList.remove('on'); } };
    el.addEventListener('pointerdown', on);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, off);
  }
  return true;
}

/* ---------------------------------------------------------- 2P players */
function makePlayer(n) {
  const heldP = new Set(), prevP = new Set(), kb = new Set();
  const P = {
    n, dev: 'auto', device: null, autoAccel: false,
    controls: { steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false, item: false },
    down: name => heldP.has(name),
    hit: name => heldP.has(name) && !prevP.has(name),
    _update(dev) {
      P.device = dev;
      prevP.clear(); for (const x of heldP) prevP.add(x);
      heldP.clear(); kb.clear();
      let pSteer = 0, pThr = 0, pBrk = 0;
      if (dev === 'kb' || dev === 'kbL' || dev === 'kbR') {
        keyNames(dev === 'kb' ? KEYMAP : dev === 'kbL' ? KEYMAP_L : KEYMAP_R, kb);
        for (const x of kb) heldP.add(x);
      } else if (dev && dev.startsWith('pad:')) {
        const st = pads.get(+dev.slice(4));
        if (st) { for (const x of st.names) heldP.add(x); pSteer = st.steer; pThr = st.thr; pBrk = st.brk; }
      }
      const c = P.controls;
      const kSteer = (heldP.has('left') ? 1 : 0) - (heldP.has('right') ? 1 : 0);
      c.steer = pSteer || kSteer;
      const brake = Math.max(kb.has('down') ? 1 : 0, pBrk);
      let thr = Math.max(kb.has('up') ? 1 : 0, pThr);
      if (P.autoAccel) thr = brake > 0.1 ? 0 : 1;
      c.throttle = thr; c.brake = brake;
      c.hopA = heldP.has('hopA'); c.hopB = heldP.has('hopB'); c.item = heldP.has('item');
    },
  };
  return P;
}
export const players = [makePlayer(0), makePlayer(1)];
let multiOn = false;
/** Turn the per-player update on (2P race) or off. */
export function multi(on) { multiOn = !!on; if (!on) for (const p of players) p._update(null); }
/** Assign devices: 'auto' | 'kb' | 'kbL' | 'kbR' | 'pad:N'. */
export function setDevices(d1 = 'auto', d2 = 'auto') { players[0].dev = d1 || 'auto'; players[1].dev = d2 || 'auto'; }
/** What 'auto' resolves to right now (see header). */
export function autoDevices() {
  const idx = padIndices();
  if (idx.length >= 2) return ['pad:' + idx[0], 'pad:' + idx[1]];
  if (idx.length === 1) return ['pad:' + idx[0], 'kb'];
  return ['kbL', 'kbR'];
}
/** Devices that pressed a join button since the last call (oldest first). */
export function takeJoins() { return joins.splice(0); }
/** Short human label for a device id (join screen / controls). */
export const deviceLabel = d => !d ? '' : d === 'kb' ? 'KEYBOARD' : d === 'kbL' ? 'KEYBOARD LEFT' : d === 'kbR' ? 'KEYBOARD RIGHT' : d.startsWith('pad:') ? 'PAD ' + (+d.slice(4) + 1) : d === 'touch' ? 'TOUCH' : d;

/* --------------------------------------------------------------- update */
export function update() {
  prev.clear(); for (const n of held) prev.add(n);
  pollPad();
  held.clear();
  const keys = keyNames(KEYMAP, new Set());
  for (const s of [keys, pad, touch]) for (const n of s) held.add(n);
  for (const n of latched) held.add(n);
  latched.clear();
  if (held.has('item') || held.has('hopA')) held.add('confirm');
  if (held.has('pause')) held.add('back');

  const kSteer = (down('left') ? 1 : 0) - (down('right') ? 1 : 0);
  touchSteer = (touch.has('left') ? 1 : 0) - (touch.has('right') ? 1 : 0);
  controls.steer = padSteer || kSteer || touchSteer;
  const brake = Math.max(keys.has('down') ? 1 : 0, touch.has('brake') ? 1 : 0, padBrk);
  let thr = Math.max(keys.has('up') ? 1 : 0, padThr);
  if (settings.autoAccel || settings.touchUI) thr = brake > 0.1 ? 0 : 1;
  controls.throttle = thr;
  controls.brake = brake;
  controls.hopA = down('hopA');
  controls.hopB = down('hopB');
  controls.item = down('item');

  if (multiOn) {
    const auto = autoDevices();
    players.forEach((p, i) => p._update(p.dev === 'auto' ? auto[i] : p.dev));
  }
  codeLatch.clear();
}
