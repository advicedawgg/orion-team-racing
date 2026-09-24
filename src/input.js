// input.js — keyboard + Gamepad API (standard mapping) + touch → one abstract control set.
// Call update() once per rendered frame BEFORE reading. Read `controls` for driving and
// hit(name) for edge-triggered menu/buttons. NEVER binds Ctrl (Ctrl+W closes the tab).
//
//   controls = { steer (-1..1, +left), throttle (0..1), brake (0..1), hopA, hopB (held), item (held) }
//   hit('hopA'|'hopB'|'item'|'pause'|'mute'|'fullscreen'|'confirm'|'back'|'up'|'down'|'left'|'right')
//
// Shoulder taps shorter than a frame are latched so a quick press is never lost; main.js also
// latches shoulder presses until a physics step has seen them (a render frame may run 0 steps).

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'hopA', ShiftLeft: 'hopB', ShiftRight: 'hopB',
  KeyE: 'item', Enter: 'item',
  Escape: 'pause', KeyP: 'pause', KeyM: 'mute', KeyF: 'fullscreen',
};

const keys = new Set(), pad = new Set(), touch = new Set(), latched = new Set();
const held = new Set(), prev = new Set();
let padSteer = 0, padThr = 0, padBrk = 0, touchSteer = 0;
let anyGesture = null;

/** Settings the game may flip. autoAccel = always accelerate unless braking (default ON in Easy). */
export const settings = { autoAccel: false, touchUI: false };
export const controls = { steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false, item: false };
export const down = n => held.has(n);
export const hit = n => held.has(n) && !prev.has(n);
/** Register a callback for the first user gesture (audio unlock). */
export const onGesture = fn => { anyGesture = fn; };
let lastDevice = 'keyboard';
export const device = () => lastDevice;

const gesture = () => { if (anyGesture) { const f = anyGesture; anyGesture = null; f(); } };

if (typeof addEventListener !== 'undefined') {
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;          // never steal browser shortcuts
    const n = KEYMAP[e.code];
    if (n) { keys.add(n); latched.add(n); e.preventDefault(); lastDevice = 'keyboard'; }
    gesture();
  });
  addEventListener('keyup', e => { const n = KEYMAP[e.code]; if (n) keys.delete(n); });
  addEventListener('blur', () => keys.clear());
  addEventListener('pointerdown', gesture);
}

/* -------------------------------------------------------------- gamepad */
function pollPad() {
  pad.clear(); padSteer = padThr = padBrk = 0;
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const p = [...(pads || [])].find(Boolean);
  if (!p) return;
  const b = i => !!p.buttons[i]?.pressed;
  const v = i => p.buttons[i]?.value || 0;
  const ax = p.axes[0] || 0;
  padSteer = Math.abs(ax) < 0.18 ? 0 : -Math.sign(ax) * (Math.abs(ax) - 0.18) / 0.82;   // stick right = steer right (−)
  if (b(14)) padSteer = 1; if (b(15)) padSteer = -1;
  padThr = Math.max(b(0) ? 1 : 0, v(7) > 0.1 ? v(7) : 0);
  padBrk = Math.max(b(2) ? 1 : 0, v(6) > 0.1 ? v(6) : 0);
  if (b(5)) pad.add('hopA');
  if (b(4)) pad.add('hopB');
  if (b(1) || b(3)) pad.add('item');
  if (b(9)) pad.add('pause');
  if (b(12) || (p.axes[1] || 0) < -0.6) pad.add('up');
  if (b(13) || (p.axes[1] || 0) > 0.6) pad.add('down');
  if (b(14) || ax < -0.6) pad.add('left');
  if (b(15) || ax > 0.6) pad.add('right');
  if (b(0)) pad.add('confirm');
  if (b(1)) pad.add('back');
  if (pad.size || padThr || padBrk || padSteer) { lastDevice = 'pad'; gesture(); }
}

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

/* --------------------------------------------------------------- update */
export function update() {
  prev.clear(); for (const n of held) prev.add(n);
  pollPad();
  held.clear();
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
}
