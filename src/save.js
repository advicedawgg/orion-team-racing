// save.js — the one localStorage save (UI agent owns). Every storage access is wrapped: a private
// window, blocked storage or a full quota must never break the game — it just forgets.
//
//   localStorage['otrSave'] = {
//     v: 1,
//     unlocked: { star: false, paint: false },   // secret tracks by id; paint = the gold/rainbow kart paints (O-T-R on every track)
//     cupWins: { easy: 0, medium: 0, hard: 0 },   // Orion Cup wins per difficulty
//     best: { <trackId>: { lap: s, race: s, racer } },   // Time Trial + every race count
//     shortcuts: { <trackId>: [branchId, …] },          // branches the player has driven (minimap shows them)
//     letters: { <trackId>: true },                     // O-T-R: all three letters collected in one finished race
//     settings: { master, music, sfx (0..1), autoAccel: 'easy'|'on'|'off', kidAssist: bool,
//                 hd: bool, difficulty: 'easy'|'medium'|'hard', quality: 'auto'|'high'|'low',
//                 mpAuto: [p1, p2], mpHelper: [p1, p2] (2 PLAYERS join screen, per player; absent until toggled),
//                 paint: 'std'|'gold'|'rainbow' (the player's kart, once unlocked) },
//     lastRacer, lastTrack,
//   }
//   localStorage['otrGhost:<trackId>'] = { v:1, racer, time, hz, d: [x,y,z,yaw, x,y,z,yaw, …] (dm / mrad ints) }
//
// Pure-ish: no DOM besides localStorage, importable in node (falls back to an in-memory object).

const KEY = 'otrSave';
const GHOST = id => 'otrGhost:' + id;

export const DEFAULTS = () => ({
  v: 1,
  unlocked: { star: false, paint: false },
  cupWins: { easy: 0, medium: 0, hard: 0 },
  best: {},
  shortcuts: {},
  letters: {},
  settings: { master: 0.9, music: 0.7, sfx: 1, autoAccel: 'easy', kidAssist: true, hd: true, hdDefaultV: 1, difficulty: 'easy', quality: 'auto', paint: 'std' },
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
  try {
    const raw = store.get(KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      data = merge(DEFAULTS(), stored);
      // 2026-09-25: FANCY RACERS became the default (switching it on later hitches while the GLBs load).
      // One-time flip for saves written while the default was off. Read the flag off the RAW stored object —
      // after merge() the defaults would make it look already migrated.
      if (!stored.settings || stored.settings.hdDefaultV !== 1) { data.settings.hd = true; data.settings.hdDefaultV = 1; save(); }
    }
  } catch (e) { console.warn('[save] unreadable save, starting fresh', e); }
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

/* ------------------------------------------------------------------ shortcuts (track branches) */
/** The branch ids the player has driven on this track (a Set; empty if none / unreadable). */
export function shortcutsSeen(trackId) {
  try { const a = load().shortcuts?.[trackId]; return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); }
}
/** Remember a driven branch. Returns true the first time (the HUD's "SHORTCUT!" callout). */
export function markShortcut(trackId, branchId) {
  try {
    const d = load(), sc = d.shortcuts && typeof d.shortcuts === 'object' ? d.shortcuts : (d.shortcuts = {});
    const a = Array.isArray(sc[trackId]) ? sc[trackId] : (sc[trackId] = []);
    if (a.includes(branchId)) return false;
    a.push(branchId); save(); return true;
  } catch (e) { console.warn('[save] shortcut not saved', e); return false; }
}

/* ------------------------------------------------------------------ O-T-R letters */
// URL ?ctr=all | ?ctr=<id,id…> fakes completed tracks (and, for all, the paint unlock) for screenshots. URL-only:
// it is read here, never written to the save.
const CTR_Q = (() => { try { return new URLSearchParams(globalThis.location?.search || '').get('ctr'); } catch { return null; } })();
const ctrFake = id => !!CTR_Q && (CTR_Q === 'all' || CTR_Q.split(',').includes(id));
/** Has the player collected all three letters on this track in one race? */
export function lettersDone(trackId) {
  if (ctrFake(trackId)) return true;
  try { return !!load().letters?.[trackId]; } catch { return false; }
}
/** Record a O-T-R on this track. Returns true the first time. */
export function markLetters(trackId) {
  try {
    const d = load(), l = d.letters && typeof d.letters === 'object' ? d.letters : (d.letters = {});
    if (l[trackId]) return false;
    l[trackId] = true; save(); return true;
  } catch (e) { console.warn('[save] letters not saved', e); return false; }
}
/** the gold / rainbow kart paints: unlocked once every track has its O-T-R (menu.js unlocks 'paint') */
export const paintUnlocked = () => CTR_Q === 'all' || isUnlocked('paint');

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
