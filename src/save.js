// save.js — the one localStorage save (UI agent owns). Every storage access is wrapped: a private
// window, blocked storage or a full quota must never break the game — it just forgets.
//
//   localStorage['otrSave'] = {
//     v: 1,
//     unlocked: { star: false },                 // secret tracks by id
//     cupWins: { easy: 0, medium: 0, hard: 0 },   // Orion Cup wins per difficulty
//     best: { <trackId>: { lap: s, race: s, racer } },   // Time Trial + every race count
//     settings: { master, music, sfx (0..1), autoAccel: 'easy'|'on'|'off', kidAssist: bool,
//                 hd: bool, difficulty: 'easy'|'medium'|'hard' },
//     lastRacer, lastTrack,
//   }
//   localStorage['otrGhost:<trackId>'] = { v:1, racer, time, hz, d: [x,y,z,yaw, x,y,z,yaw, …] (dm / mrad ints) }
//
// Pure-ish: no DOM besides localStorage, importable in node (falls back to an in-memory object).

const KEY = 'otrSave';
const GHOST = id => 'otrGhost:' + id;

export const DEFAULTS = () => ({
  v: 1,
  unlocked: { star: false },
  cupWins: { easy: 0, medium: 0, hard: 0 },
  best: {},
  settings: { master: 0.9, music: 0.7, sfx: 1, autoAccel: 'easy', kidAssist: true, hd: false, difficulty: 'easy' },
  lastRacer: 'orion', lastTrack: null,
});

const mem = new Map();
const store = {
  get(k) { try { return globalThis.localStorage ? localStorage.getItem(k) : (mem.get(k) ?? null); } catch { return mem.get(k) ?? null; } },
  set(k, v) { try { if (globalThis.localStorage) localStorage.setItem(k, v); else mem.set(k, v); return true; } catch { mem.set(k, v); return false; } },
  del(k) { try { if (globalThis.localStorage) localStorage.removeItem(k); } catch { /* ignore */ } mem.delete(k); },
};

let data = null;

function merge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in over)) continue;
    const b = base[k], o = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) base[k] = merge(b, o);
    else if (typeof o === typeof b || b == null) base[k] = o;
  }
  // keep extra keys (best times per track, unlocked ids we don't know about yet)
  for (const k of Object.keys(over)) if (!(k in base)) base[k] = over[k];
  return base;
}

/** The live save object (loaded once). Mutate through the helpers below, or mutate + save(). */
export function load() {
  if (data) return data;
  data = DEFAULTS();
  try { const raw = store.get(KEY); if (raw) data = merge(DEFAULTS(), JSON.parse(raw)); } catch (e) { console.warn('[save] unreadable save, starting fresh', e); }
  return data;
}
export function save() { try { store.set(KEY, JSON.stringify(load())); } catch (e) { console.warn('[save] could not save', e); } }
export const get = () => load();
export const settings = () => load().settings;
export function setSetting(k, v) { load().settings[k] = v; save(); }

export const isUnlocked = id => !!load().unlocked[id];
export function unlock(id) { const d = load(); const was = !!d.unlocked[id]; d.unlocked[id] = true; save(); return !was; }
export function addCupWin(diff) { const d = load(); d.cupWins[diff] = (d.cupWins[diff] || 0) + 1; save(); }
export const cupWins = () => { const c = load().cupWins; return (c.easy || 0) + (c.medium || 0) + (c.hard || 0); };

/** Record a finished race for the player. Returns { newLap, newRace, prev } (prev = old best). */
export function recordRace(trackId, { time, lapTimes = [], racer } = {}) {
  const d = load();
  const prev = { ...(d.best[trackId] || {}) };
  const b = d.best[trackId] || (d.best[trackId] = {});
  const lap = lapTimes.length ? Math.min(...lapTimes) : null;
  let newLap = false, newRace = false;
  if (lap && isFinite(lap) && (!b.lap || lap < b.lap)) { b.lap = lap; newLap = true; }
  if (time && isFinite(time) && (!b.race || time < b.race)) { b.race = time; b.racer = racer; newRace = true; }
  save();
  return { newLap, newRace, prev };
}
export const best = trackId => load().best[trackId] || {};

/* ------------------------------------------------------------------ ghosts (Time Trial) */
// Positions quantised: x,y,z in decimetres, yaw in milliradians → ~20 KB for a 3-lap race at 10 Hz.
export function saveGhost(trackId, g) {
  try {
    const d = [];
    for (const s of g.samples) d.push(Math.round(s[0] * 10), Math.round(s[1] * 10), Math.round(s[2] * 10), Math.round(s[3] * 1000));
    return store.set(GHOST(trackId), JSON.stringify({ v: 1, racer: g.racer, time: g.time, hz: g.hz, d }));
  } catch (e) { console.warn('[save] ghost not saved', e); return false; }
}
export function loadGhost(trackId) {
  try {
    const raw = store.get(GHOST(trackId)); if (!raw) return null;
    const j = JSON.parse(raw); if (!j || j.v !== 1 || !Array.isArray(j.d)) return null;
    const samples = [];
    for (let i = 0; i + 3 < j.d.length; i += 4) samples.push([j.d[i] / 10, j.d[i + 1] / 10, j.d[i + 2] / 10, j.d[i + 3] / 1000]);
    return { racer: j.racer, time: j.time, hz: j.hz, samples };
  } catch { return null; }
}

/** Tests / a "reset save" button. */
export function reset() { data = DEFAULTS(); store.del(KEY); save(); }
