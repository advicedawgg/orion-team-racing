// Orion Team Racing — audio (audio agent owns this file).
//
// Three busses, because the sibling projects measured what goes wrong with one:
//
//   sfx voices ─┐                                    (DAWG ARENA 2026-09-04: a limiter BEFORE
//   engines ────┼─ sfxBus ─ sfxOut(master) ─ softClip ─ dest     the fader always sees full scale;
//   VO ─────────┘                                     DynamicsCompressorNode ate 8 dB off every
//   music <audio> ─ deck gain ─ musicBus(duck) ─ musicOut(master) ─ dest   transient; music sharing
//                                                     the effects limiter pre-ducked every hit)
//
// * Every sound has a SYNTHESISED fallback baked at init, then overwritten by the generated file
//   (assets/sfx/index.json) when it decodes — a missing or broken file sounds older, never silent.
// * Balance lives in TRIM (dB). tools/mixprobe.mjs renders every sound through a copy of this
//   graph and prints the loudest 100 ms — measure, don't guess. Keep the two in step.
// * Music streams off an <audio> element (createMediaElementSource), never decoded into a buffer.
// * Engines are synthesised (no samples): a buzzy two-stroke per kart, pooled — the player's plus
//   the 4 nearest AI karts get voices, the rest are silent.
// * Every export is safe in node (no window), before init, before assets load and when muted.

const HAS_WINDOW = typeof window !== 'undefined';
const AC = HAS_WINDOW ? (window.AudioContext || window.webkitAudioContext) : null;
const ASSETS = HAS_WINDOW ? new URL('../assets/', import.meta.url).href : '';

/* ------------------------------------------------------------------ names */

export const SFX_NAMES = [
  'countdown', 'go', 'hop', 'land', 'drift_start', 'drift_loop', 'charge_red', 'turbo1', 'turbo2',
  'turbo3', 'fizzle', 'overheat', 'pad', 'start_boost', 'wall', 'bump', 'offroad', 'star',
  'item_box', 'roulette', 'item_get', 'bomb_roll', 'explode', 'rocket', 'rocket_lock', 'tnt_drop',
  'tnt_on_head', 'tnt_tick', 'nitro', 'splat', 'spinout', 'shield_up', 'shield_pop', 'super_star',
  'remote', 'warp', 'flip', 'lap', 'final_lap', 'finish', 'win', 'lose', 'menu_move', 'menu_ok',
  'menu_back', 'respawn',
  // extras (not in the original contract list, free to use)
  'meow', 'purr', 'cheer', 'splash', 'star_spill',
];

// Announcer lines + character barks (ElevenLabs TTS). Missing files are silent no-ops.
export const VO_NAMES = [
  'vo_3', 'vo_2', 'vo_1', 'vo_go', 'vo_ready', 'vo_final_lap', 'vo_lap_2', 'vo_you_win',
  'vo_great_race', 'vo_so_close', 'vo_new_record', 'vo_title', 'vo_choose', 'vo_orion_cup',
  'vo_great_slide', 'vo_super_turbo', 'vo_ouch', 'vo_nice_shot', 'vo_whoa', 'vo_boom',
  'vo_taco_bomb', 'vo_rocket', 'vo_tnt', 'vo_ice_cream', 'vo_shield', 'vo_turbo', 'vo_super_star',
  'vo_tv_remote', 'vo_warp_star', 'vo_ten_stars',
  'vo_orion_wins', 'vo_sootie_wins', 'vo_kingdad_wins', 'vo_mum_wins', 'vo_grumblin_wins',
  'vo_hardhat_wins', 'vo_jelly_wins', 'vo_zapdrone_wins',
  // character barks — see BARKS below; play through audio.bark(racerId, kind)
  'vo_orion_woohoo', 'vo_orion_yeah', 'vo_orion_uhoh',
  'vo_kingdad_count', 'vo_kingdad_back', 'vo_kingdad_remote', 'vo_kingdad_haha',
  'vo_mum_goodjob', 'vo_mum_careful', 'vo_mum_wheee',
  'vo_grumblin_grr', 'vo_hardhat_beep', 'vo_jelly_wobble', 'vo_zapdrone_zap',
];

export const MUSIC_NAMES = ['title', 'beach', 'ice', 'volcano', 'castle', 'star', 'results'];

// kind → per-racer bark list. Sootie barks are cat SFX.
export const BARKS = {
  orion: { win: ['vo_orion_woohoo', 'vo_orion_yeah'], boost: ['vo_orion_woohoo'], hit: ['vo_orion_uhoh'], item: ['vo_orion_yeah'] },
  sootie: { win: ['purr', 'meow'], boost: ['meow'], hit: ['meow'], item: ['purr'] },
  kingdad: { win: ['vo_kingdad_haha'], boost: ['vo_kingdad_haha'], hit: ['vo_kingdad_back', 'vo_kingdad_count'], item: ['vo_kingdad_remote'] },
  mum: { win: ['vo_mum_goodjob'], boost: ['vo_mum_wheee'], hit: ['vo_mum_careful'], item: ['vo_mum_goodjob'] },
  grumblin: { win: ['vo_grumblin_grr'], hit: ['vo_grumblin_grr'] },
  hardhat: { win: ['vo_hardhat_beep'], hit: ['vo_hardhat_beep'] },
  jelly: { win: ['vo_jelly_wobble'], hit: ['vo_jelly_wobble'] },
  zapdrone: { win: ['vo_zapdrone_zap'], hit: ['vo_zapdrone_zap'], boost: ['vo_zapdrone_zap'] },
};

/* -------------------------------------------------------------------- mix */

// Per-sound trim in dB on top of the file's own mastered level (gen-sfx.mjs normalises every
// file's loudest 100 ms to a per-category target). Tune HERE, one stage at a time, then re-run
// tools/mixprobe.mjs.
export const TRIM = {
  engine: 0, vo: 0,
  countdown: -2, go: 0, menu_move: -6, menu_ok: -3, menu_back: -4, roulette: -6, tnt_tick: -3,
  drift_loop: -8, offroad: -6, bomb_roll: -6, charge_red: -4, purr: -2,
};
// Random pitch variation per play (fraction), so repeated sounds don't machine-gun.
const VARY = { hop: 0.06, land: 0.06, wall: 0.08, bump: 0.1, star: 0.03, item_box: 0.05, offroad: 0.1, splat: 0.05, explode: 0.05, meow: 0.08 };
// Sounds that duck the music a little when the PLAYER triggers them (at == null).
const DUCK = { turbo1: 0.8, turbo2: 0.72, turbo3: 0.62, start_boost: 0.62, pad: 0.75, super_star: 0.6, explode: 0.7, win: 0.4, lose: 0.4, finish: 0.5, final_lap: 0.6 };
// Distance model for sounds played with `at` (inverse, like PannerNode 'inverse', + a hard cull).
export const SPATIAL = { ref: 7, roll: 1.1, max: 110, lpNear: 18 };
// Max simultaneous voices per sound name (oldest is cut).
const MAXPER = { roulette: 2, tnt_tick: 2, star: 4, bump: 3, wall: 3, hop: 3, land: 3 };
const MAX_VOICES = 36;
// Synth wins over a generated file for these (keep it in step with the listening notes in
// DESIGN.md's Audio section).
export const PREFER_SYNTH = new Set([]);

/* ------------------------------------------------------------------ state */

const S = {
  ctx: null, ready: false, unlocked: false, muted: false,
  vol: { master: 0.9, music: 0.55, sfx: 1.0 },
  sfxBus: null, sfxOut: null, musicBus: null, musicOut: null, engineBus: null, voBus: null,
  buffers: new Map(),       // name -> AudioBuffer[] (variants)
  fromFile: new Set(),      // names whose buffer came from a file
  voices: [],               // active one-shot voices
  vo: null,                 // current announcer voice
  lis: { x: 0, y: 0, z: 0, fx: 0, fz: 1 },
  noise: null,
  karts: new Map(),         // id -> kart engine state
  pool: [], playerVoice: null, lastAssign: 0,
  decks: [], deck: -1, musicName: null, wantMusic: null, musicIndex: null,
  duckUntil: 0, paused: false, lastBark: 0, loading: null,
};

const dB = d => Math.pow(10, d / 20);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const now = () => (S.ctx ? S.ctx.currentTime : 0);

/* ======================================================================
 *  SYNTH FALLBACKS — rendered sample-by-sample into Float32Arrays.
 * ==================================================================== */

const SR = 44100;
const TAU = Math.PI * 2;
function wave(type, ph) { // ph in cycles
  const p = ph - Math.floor(ph);
  switch (type) {
    case 'square': return p < 0.5 ? 0.8 : -0.8;
    case 'saw': return 2 * p - 1;
    case 'tri': return 1 - 4 * Math.abs(p - 0.5);
    default: return Math.sin(TAU * p);
  }
}
// seeded PRNG so fallbacks are deterministic
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** envelope: linear attack then exponential decay to ~-60 dB at the end of dur */
function envAt(t, dur, a, shape) {
  if (t < 0 || t > dur) return 0;
  if (t < a) return t / a;
  const r = (t - a) / Math.max(1e-4, dur - a);
  return shape === 'lin' ? 1 - r : shape === 'hold' ? (r < 0.8 ? 1 : (1 - r) * 5) : Math.exp(-6.9 * r);
}

/** oscillator with exponential pitch sweep f0→f1, optional vibrato */
function tone(d, o) {
  const { t0 = 0, dur = 0.2, f0 = 440, f1 = f0, type = 'sine', vol = 0.5, a = 0.004, shape = 'exp', vib = 0, vibHz = 6, curve = 1 } = o;
  const i0 = Math.floor(t0 * SR), n = Math.min(d.length - i0, Math.ceil(dur * SR));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, r = Math.pow(t / dur, curve);
    let f = f0 * Math.pow(f1 / f0, r);
    if (vib) f *= 1 + vib * Math.sin(TAU * vibHz * t);
    ph += f / SR;
    d[i0 + i] += wave(type, ph) * vol * envAt(t, dur, a, shape);
  }
}

/** noise through a state-variable filter; lp/bp/hp with cutoff sweep c0→c1 */
function noise(d, o) {
  const { t0 = 0, dur = 0.2, vol = 0.5, mode = 'lp', c0 = 1000, c1 = c0, q = 0.7, a = 0.003, shape = 'exp', am = 0, amHz = 0 } = o;
  const i0 = Math.floor(t0 * SR), n = Math.min(d.length - i0, Math.ceil(dur * SR));
  let low = 0, band = 0;
  const damp = 1 / Math.max(0.5, q);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const c = c0 * Math.pow(c1 / c0, t / dur);
    const f = 2 * Math.sin(Math.PI * Math.min(c, SR / 6) / SR);
    const x = rnd() * 2 - 1;
    low += f * band; const high = x - low - damp * band; band += f * high;
    let y = mode === 'lp' ? low : mode === 'hp' ? high : band;
    if (am) y *= 1 - am + am * (0.5 + 0.5 * Math.sin(TAU * amHz * t));
    d[i0 + i] += y * vol * envAt(t, dur, a, shape);
  }
}

/** a bell-ish note: sine + inharmonic partial */
function bell(d, t0, f, dur = 0.5, vol = 0.35) {
  tone(d, { t0, dur, f0: f, vol, a: 0.002 });
  tone(d, { t0, dur: dur * 0.6, f0: f * 2.76, vol: vol * 0.25, a: 0.002 });
  tone(d, { t0, dur: dur * 0.3, f0: f * 5.4, vol: vol * 0.1, a: 0.002 });
}
/** a brassy/chiptune note: square + saw, short attack */
function brass(d, t0, f, dur = 0.2, vol = 0.22) {
  tone(d, { t0, dur, f0: f, type: 'square', vol, a: 0.01, shape: 'hold' });
  tone(d, { t0, dur, f0: f * 1.004, type: 'saw', vol: vol * 0.6, a: 0.015, shape: 'hold' });
}
function sparkle(d, t0, dur, n, lo = 1800, hi = 5200, vol = 0.12) {
  for (let k = 0; k < n; k++) {
    const t = t0 + rnd() * dur;
    tone(d, { t0: t, dur: 0.08 + rnd() * 0.08, f0: lo + rnd() * (hi - lo), vol: vol * (0.5 + rnd() * 0.5), a: 0.001 });
  }
}
function whoosh(d, t0, dur, c0, c1, vol = 0.4, q = 1.2) {
  noise(d, { t0, dur, mode: 'bp', c0, c1, q, vol, a: dur * 0.35, shape: 'exp' });
}
/** make a buffer loop cleanly: crossfade the last `x` s into the head, then drop the tail */
function loopify(d, x) {
  const n = Math.floor(x * SR), L = d.length - n;
  for (let i = 0; i < n; i++) { const w = i / n; d[i] = d[i] * w + d[L + i] * (1 - w); }
  return d.subarray(0, L);
}
const semi = (base, k) => base * Math.pow(2, k / 12);

const C5 = 523.25;
const RECIPES = {
  countdown: [0.3, d => { tone(d, { dur: 0.26, f0: 587, type: 'square', vol: 0.25, shape: 'hold' }); tone(d, { dur: 0.26, f0: 1174, vol: 0.15, shape: 'hold' }); }],
  go: [0.7, d => { tone(d, { dur: 0.65, f0: 1174, type: 'square', vol: 0.25, shape: 'hold' }); tone(d, { dur: 0.65, f0: 2348, vol: 0.12, shape: 'hold' }); tone(d, { dur: 0.65, f0: 880, type: 'saw', vol: 0.1, shape: 'hold' }); }],
  hop: [0.3, d => { tone(d, { dur: 0.28, f0: 170, f1: 560, vol: 0.55, vib: 0.08, vibHz: 22, curve: 0.6 }); noise(d, { dur: 0.05, mode: 'lp', c0: 900, vol: 0.2 }); }],
  land: [0.22, d => { tone(d, { dur: 0.18, f0: 120, f1: 55, vol: 0.7 }); noise(d, { dur: 0.12, mode: 'lp', c0: 700, c1: 200, vol: 0.5 }); }],
  drift_start: [0.35, d => { noise(d, { dur: 0.32, mode: 'bp', c0: 2600, c1: 1900, q: 6, vol: 0.9, a: 0.01 }); tone(d, { dur: 0.25, f0: 1500, f1: 1200, type: 'saw', vol: 0.05 }); }],
  drift_loop: [1.25, d => {
    noise(d, { dur: 1.25, mode: 'bp', c0: 2100, q: 7, vol: 0.9, a: 0.01, shape: 'hold', am: 0.35, amHz: 8 });
    tone(d, { dur: 1.25, f0: 1850, vol: 0.03, vib: 0.02, vibHz: 4, shape: 'hold', a: 0.01 });
    return loopify(d, 0.25);
  }],
  charge_red: [0.3, d => { bell(d, 0, 1760, 0.28, 0.3); bell(d, 0.05, 2637, 0.22, 0.2); }],
  turbo1: [0.6, d => { whoosh(d, 0, 0.55, 500, 2400, 0.8); tone(d, { dur: 0.5, f0: 220, f1: 520, type: 'saw', vol: 0.12, a: 0.03 }); }],
  turbo2: [0.8, d => { whoosh(d, 0, 0.75, 600, 3200, 0.85); tone(d, { dur: 0.7, f0: 280, f1: 760, type: 'saw', vol: 0.13, a: 0.03 }); tone(d, { dur: 0.6, f0: 560, f1: 1500, vol: 0.08, a: 0.05 }); }],
  turbo3: [1.1, d => { whoosh(d, 0, 1.0, 700, 4200, 0.9); tone(d, { dur: 0.95, f0: 330, f1: 1040, type: 'saw', vol: 0.14, a: 0.03 }); tone(d, { dur: 0.9, f0: 660, f1: 2100, vol: 0.1, a: 0.05 }); sparkle(d, 0.2, 0.7, 10); }],
  fizzle: [0.5, d => { tone(d, { dur: 0.4, f0: 420, f1: 70, type: 'saw', vol: 0.18 }); noise(d, { dur: 0.45, mode: 'hp', c0: 3000, c1: 1500, vol: 0.2, am: 0.8, amHz: 35 }); }],
  overheat: [1.0, d => { noise(d, { dur: 0.95, mode: 'hp', c0: 4000, c1: 2500, vol: 0.4, a: 0.05 }); tone(d, { dur: 0.8, f0: 160, f1: 60, type: 'square', vol: 0.12, vib: 0.05, vibHz: 12 }); }],
  pad: [0.7, d => { whoosh(d, 0, 0.6, 900, 3800, 0.7); tone(d, { dur: 0.45, f0: 500, f1: 1800, vol: 0.2, a: 0.01 }); tone(d, { t0: 0.05, dur: 0.4, f0: 750, f1: 2700, type: 'tri', vol: 0.12 }); }],
  start_boost: [1.1, d => { whoosh(d, 0, 1.0, 500, 4000, 0.9); tone(d, { dur: 0.9, f0: 260, f1: 900, type: 'saw', vol: 0.14, a: 0.02 }); brass(d, 0.05, 784, 0.12, 0.1); brass(d, 0.17, 1046, 0.3, 0.1); }],
  wall: [0.3, d => { noise(d, { dur: 0.2, mode: 'lp', c0: 1500, c1: 300, vol: 0.8 }); tone(d, { dur: 0.22, f0: 160, f1: 60, vol: 0.6 }); tone(d, { dur: 0.1, f0: 310, type: 'square', vol: 0.08 }); }],
  bump: [0.18, d => { tone(d, { dur: 0.15, f0: 150, f1: 75, vol: 0.6 }); noise(d, { dur: 0.08, mode: 'lp', c0: 600, vol: 0.3 }); }],
  offroad: [0.45, d => { noise(d, { dur: 0.42, mode: 'lp', c0: 900, c1: 500, vol: 0.9, a: 0.02, am: 0.6, amHz: 17 }); for (let k = 0; k < 8; k++) noise(d, { t0: rnd() * 0.35, dur: 0.02, mode: 'bp', c0: 2500, q: 3, vol: 0.3 }); }],
  star: [0.45, d => { bell(d, 0, 1318, 0.2, 0.25); bell(d, 0.06, 1976, 0.35, 0.25); sparkle(d, 0.05, 0.3, 6, 3000, 6000, 0.08); }],
  item_box: [0.55, d => { noise(d, { dur: 0.15, mode: 'bp', c0: 1400, c1: 600, q: 1.5, vol: 0.8 }); tone(d, { dur: 0.12, f0: 300, f1: 900, vol: 0.3 }); bell(d, 0.08, 1568, 0.4, 0.2); bell(d, 0.14, 2093, 0.4, 0.15); }],
  roulette: [0.06, d => { tone(d, { dur: 0.05, f0: 1500, type: 'square', vol: 0.18 }); noise(d, { dur: 0.01, mode: 'hp', c0: 4000, vol: 0.3 }); }],
  item_get: [0.5, d => { bell(d, 0, 1046, 0.2, 0.28); bell(d, 0.09, 1568, 0.4, 0.3); tone(d, { t0: 0.09, dur: 0.3, f0: 784, type: 'tri', vol: 0.12 }); }],
  bomb_roll: [0.6, d => { noise(d, { dur: 0.58, mode: 'lp', c0: 420, vol: 1.0, a: 0.03, shape: 'hold', am: 0.7, amHz: 11 }); tone(d, { dur: 0.58, f0: 70, vol: 0.2, shape: 'hold' }); }],
  explode: [1.2, d => { noise(d, { dur: 1.1, mode: 'lp', c0: 3000, c1: 150, vol: 1.0, a: 0.004 }); tone(d, { dur: 0.7, f0: 110, f1: 32, vol: 0.8 }); noise(d, { t0: 0.02, dur: 0.4, mode: 'bp', c0: 900, c1: 300, vol: 0.4 }); }],
  rocket: [0.9, d => { noise(d, { dur: 0.85, mode: 'hp', c0: 1200, c1: 2600, vol: 0.5, a: 0.03 }); tone(d, { dur: 0.8, f0: 180, f1: 900, type: 'saw', vol: 0.14, a: 0.02 }); tone(d, { dur: 0.1, f0: 90, f1: 50, vol: 0.5 }); }],
  rocket_lock: [0.3, d => { tone(d, { dur: 0.07, f0: 1760, type: 'square', vol: 0.18, shape: 'hold' }); tone(d, { t0: 0.12, dur: 0.07, f0: 1760, type: 'square', vol: 0.18, shape: 'hold' }); }],
  tnt_drop: [0.3, d => { tone(d, { dur: 0.2, f0: 240, f1: 140, vol: 0.55 }); noise(d, { dur: 0.05, mode: 'bp', c0: 1800, q: 2, vol: 0.5 }); }],
  tnt_on_head: [0.5, d => { tone(d, { dur: 0.12, f0: 700, f1: 350, vol: 0.4 }); noise(d, { dur: 0.04, mode: 'bp', c0: 2200, q: 3, vol: 0.5 }); tone(d, { t0: 0.1, dur: 0.35, f0: 250, f1: 700, vol: 0.35, vib: 0.1, vibHz: 18 }); }],
  tnt_tick: [0.12, d => { noise(d, { dur: 0.015, mode: 'bp', c0: 3500, q: 4, vol: 0.9 }); tone(d, { dur: 0.08, f0: 1100, vol: 0.2 }); }],
  nitro: [1.0, d => { noise(d, { dur: 0.9, mode: 'lp', c0: 5000, c1: 300, vol: 0.9 }); tone(d, { dur: 0.5, f0: 140, f1: 40, vol: 0.7 }); sparkle(d, 0.05, 0.6, 14, 2500, 7000, 0.1); }],
  splat: [0.5, d => { noise(d, { dur: 0.35, mode: 'lp', c0: 1800, c1: 250, vol: 0.9, a: 0.005 }); tone(d, { dur: 0.3, f0: 380, f1: 90, vol: 0.4, vib: 0.2, vibHz: 25 }); }],
  spinout: [0.9, d => { tone(d, { dur: 0.85, f0: 1300, f1: 280, vol: 0.3, vib: 0.06, vibHz: 9 }); tone(d, { dur: 0.85, f0: 1300 * 1.5, f1: 420, vol: 0.08, vib: 0.06, vibHz: 9 }); }],
  shield_up: [0.8, d => { tone(d, { dur: 0.6, f0: 300, f1: 900, vol: 0.25, a: 0.05 }); for (let k = 0; k < 9; k++) { const t = 0.05 + k * 0.07; tone(d, { t0: t, dur: 0.06, f0: 500 + k * 90, f1: 1400 + k * 150, vol: 0.18 }); } }],
  shield_pop: [0.3, d => { tone(d, { dur: 0.08, f0: 380, f1: 1600, vol: 0.5 }); noise(d, { dur: 0.05, mode: 'hp', c0: 2000, vol: 0.4 }); sparkle(d, 0.03, 0.2, 5, 2000, 5000, 0.08); }],
  super_star: [1.5, d => { [0, 4, 7, 12, 16, 19, 24].forEach((k, i) => bell(d, i * 0.08, semi(C5, k), 0.6, 0.18)); sparkle(d, 0.1, 1.2, 24, 2500, 7000, 0.07); whoosh(d, 0, 1.2, 600, 3000, 0.3); }],
  remote: [0.6, d => { noise(d, { dur: 0.012, mode: 'bp', c0: 3000, q: 3, vol: 0.9 }); tone(d, { t0: 0.06, dur: 0.45, f0: 110, type: 'square', vol: 0.25, shape: 'hold', vib: 0.03, vibHz: 50 }); noise(d, { t0: 0.06, dur: 0.45, mode: 'hp', c0: 2500, vol: 0.25, shape: 'hold', am: 1, amHz: 60 }); }],
  warp: [1.3, d => { whoosh(d, 0, 0.6, 300, 5000, 0.7, 2); whoosh(d, 0.5, 0.75, 5000, 400, 0.6, 2); tone(d, { dur: 1.2, f0: 200, f1: 1600, vol: 0.15, vib: 0.1, vibHz: 7, a: 0.2 }); }],
  flip: [0.6, d => { tone(d, { dur: 0.5, f0: 320, f1: 1300, vol: 0.3, vib: 0.05, vibHz: 12 }); noise(d, { dur: 0.3, mode: 'bp', c0: 800, c1: 2500, vol: 0.3 }); }],
  lap: [0.7, d => { bell(d, 0, 988, 0.4, 0.3); bell(d, 0.12, 1318, 0.55, 0.3); }],
  final_lap: [1.2, d => { brass(d, 0, semi(C5, 7), 0.14); brass(d, 0.16, semi(C5, 7), 0.14); brass(d, 0.32, semi(C5, 7), 0.14); brass(d, 0.48, semi(C5, 12), 0.6); }],
  finish: [1.6, d => { [0, 4, 7, 12].forEach((k, i) => brass(d, i * 0.12, semi(C5, k), 0.14)); brass(d, 0.5, semi(C5, 16), 0.9); sparkle(d, 0.5, 0.9, 16); }],
  win: [2.4, d => { const m = [[0, 0.15], [4, 0.15], [7, 0.15], [12, 0.3], [7, 0.15], [12, 0.9]]; let t = 0; for (const [k, l] of m) { brass(d, t, semi(C5, k), l + 0.05); bell(d, t, semi(C5 * 2, k), l + 0.2, 0.12); t += l; } sparkle(d, 0.8, 1.4, 24); }],
  lose: [2.2, d => { const m = [[3, 0.35], [2, 0.35], [1, 0.35], [0, 1.0]]; let t = 0; for (const [k, l] of m) { tone(d, { t0: t, dur: l, f0: semi(233, k), type: 'saw', vol: 0.18, a: 0.03, shape: 'hold', vib: k === 0 ? 0.03 : 0, vibHz: 6 }); t += l; } }],
  menu_move: [0.06, d => { tone(d, { dur: 0.05, f0: 880, type: 'square', vol: 0.12 }); }],
  menu_ok: [0.22, d => { tone(d, { dur: 0.08, f0: 880, type: 'square', vol: 0.14, shape: 'hold' }); tone(d, { t0: 0.07, dur: 0.14, f0: 1318, type: 'square', vol: 0.14 }); }],
  menu_back: [0.22, d => { tone(d, { dur: 0.08, f0: 660, type: 'square', vol: 0.14, shape: 'hold' }); tone(d, { t0: 0.07, dur: 0.14, f0: 440, type: 'square', vol: 0.14 }); }],
  respawn: [0.8, d => { tone(d, { dur: 0.6, f0: 300, f1: 1400, vol: 0.25, a: 0.05 }); sparkle(d, 0.2, 0.5, 12); bell(d, 0.5, 1568, 0.3, 0.2); }],
  meow: [0.6, d => { tone(d, { dur: 0.55, f0: 700, f1: 520, type: 'saw', vol: 0.1, a: 0.06, vib: 0.04, vibHz: 5 }); tone(d, { dur: 0.55, f0: 1400, f1: 1040, vol: 0.12, a: 0.06 }); }],
  purr: [1.0, d => { noise(d, { dur: 1.0, mode: 'lp', c0: 350, vol: 1.0, a: 0.1, shape: 'hold', am: 0.9, amHz: 26 }); }],
  cheer: [1.2, d => { for (let k = 0; k < 6; k++) tone(d, { t0: rnd() * 0.2, dur: 0.9, f0: 400 + rnd() * 500, f1: 600 + rnd() * 600, type: 'saw', vol: 0.03, a: 0.1 }); noise(d, { dur: 1.1, mode: 'bp', c0: 1200, q: 0.8, vol: 0.3, a: 0.1 }); }],
  splash: [0.8, d => { noise(d, { dur: 0.7, mode: 'bp', c0: 2500, c1: 800, q: 0.8, vol: 0.8, a: 0.005 }); tone(d, { dur: 0.15, f0: 200, f1: 600, vol: 0.2 }); }],
  star_spill: [0.6, d => { for (let k = 0; k < 4; k++) bell(d, k * 0.09, 1976 - k * 180, 0.25, 0.18); }],
};

function bakeSynth(name) {
  const r = RECIPES[name];
  if (!r || !S.ctx) return null;
  seed = 12345 + name.length * 977;
  let d = new Float32Array(Math.ceil(r[0] * SR));
  const out = r[1](d);
  if (out) d = out;
  // normalise peak to 0.9 so the synth sits at a level the TRIM table can reason about
  let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const g = pk > 0 ? 0.7 / pk : 1;
  const buf = S.ctx.createBuffer(1, d.length, SR);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) ch[i] = d[i] * g;
  return buf;
}

/* ======================================================================
 *  GRAPH
 * ==================================================================== */

function softClip(ctx, knee = 0.72) {
  // exactly linear below the knee, tanh above — a limiter that doesn't touch normal levels
  const ws = ctx.createWaveShaper(), N = 4096, cv = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1, a = Math.abs(x);
    cv[i] = Math.sign(x) * (a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  ws.curve = cv; ws.oversample = '4x';
  return ws;
}

function applyVolumes(ramp = 0.05) {
  if (!S.ctx) return;
  const t = now(), m = S.muted ? 0 : S.vol.master;
  S.sfxOut.gain.setTargetAtTime(m, t, ramp);
  S.musicOut.gain.setTargetAtTime(m, t, ramp);
  S.sfxBus.gain.setTargetAtTime(S.vol.sfx, t, ramp);
  S.musicBus.gain.setTargetAtTime(S.vol.music * (S.paused ? 0.45 : 1), t, ramp);
}

function buildGraph() {
  const ctx = S.ctx;
  S.sfxBus = ctx.createGain();
  S.sfxOut = ctx.createGain();
  S.sfxBus.connect(S.sfxOut).connect(softClip(ctx)).connect(ctx.destination);
  S.engineBus = ctx.createGain(); S.engineBus.gain.value = dB(TRIM.engine); S.engineBus.connect(S.sfxBus);
  S.voBus = ctx.createGain(); S.voBus.gain.value = dB(TRIM.vo); S.voBus.connect(S.sfxBus);
  S.musicBus = ctx.createGain();          // user music volume * pause dip
  S.musicDuck = ctx.createGain();         // turbo duck
  S.musicOut = ctx.createGain();          // master
  S.musicDuck.connect(S.musicBus).connect(S.musicOut).connect(ctx.destination);
  // a shared 2 s white-noise buffer for engine squeal/rumble layers
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
  seed = 99; for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
  S.noise = nb;
  applyVolumes(0.001);
}

/* ======================================================================
 *  LOADING
 * ==================================================================== */

async function loadFiles() {
  let idx = null;
  try {
    const r = await fetch(ASSETS + 'sfx/index.json', { cache: 'no-cache' });
    if (r.ok) idx = await r.json();
  } catch { /* offline / no index: synth only */ }
  try {
    const r = await fetch(ASSETS + 'audio/index.json', { cache: 'no-cache' });
    if (r.ok) S.musicIndex = await r.json();
  } catch { /* music index missing: music plays by conventional filename */ }
  if (!idx || !idx.files) return;
  const jobs = Object.entries(idx.files).map(async ([name, files]) => {
    if (PREFER_SYNTH.has(name)) return;
    const list = Array.isArray(files) ? files : [files];
    const bufs = [];
    for (const f of list) {
      try {
        const r = await fetch(ASSETS + 'sfx/' + f);
        if (!r.ok) continue;
        const ab = await r.arrayBuffer();
        bufs.push(await S.ctx.decodeAudioData(ab));
      } catch (e) { console.warn('[audio] decode failed', f, e?.message || e); }
    }
    if (bufs.length) { S.buffers.set(name, bufs); S.fromFile.add(name); }
  });
  // don't hammer the network all at once: 6 at a time
  for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6));
}

function getBuf(name) {
  let b = S.buffers.get(name);
  if (!b) {
    const s = bakeSynth(name);
    if (!s) return null;
    b = [s]; S.buffers.set(name, b);
  }
  return b.length === 1 ? b[0] : b[(Math.random() * b.length) | 0];
}

/* ======================================================================
 *  SPATIAL
 * ==================================================================== */

/** gain, pan and lowpass cutoff for a source at world pos `at` (null → 2D) */
function spatial(at, sp = SPATIAL) {
  if (!at) return { g: 1, pan: 0, lp: 0, d: 0 };
  const L = S.lis;
  const dx = at.x - L.x, dy = (at.y ?? L.y) - L.y, dz = at.z - L.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > sp.max) return null;
  const g = d <= sp.ref ? 1 : sp.ref / (sp.ref + sp.roll * (d - sp.ref));
  const fade = d > sp.max * 0.8 ? (sp.max - d) / (sp.max * 0.2) : 1;   // no pop at the cull edge
  // right vector = (-fz, fx) for a Y-up world where forward = (sin yaw, 0, cos yaw)
  const h = Math.hypot(dx, dz) || 1;
  const pan = clamp(((dx * -L.fz) + (dz * L.fx)) / h, -1, 1) * clamp(d / 4, 0, 1) * 0.85;
  const lp = d > sp.lpNear ? clamp(20000 * sp.lpNear / d, 900, 20000) : 0;
  return { g: g * fade, pan, lp, d };
}

/* ======================================================================
 *  ONE-SHOTS
 * ==================================================================== */

function reap() {
  const t = now();
  S.voices = S.voices.filter(v => !v.done && (v.loop || v.end > t));
}

function makeHandle(v) {
  return {
    stop(fade = 0.05) {
      if (v.done) return; v.done = true;
      try { v.g.gain.setTargetAtTime(0, now(), Math.max(0.005, fade / 3)); v.src.stop(now() + fade + 0.05); } catch { /* already stopped */ }
    },
    set({ vol, rate, at, pan } = {}) {
      if (v.done || !S.ctx) return;
      const t = now();
      if (rate != null) v.src.playbackRate.setTargetAtTime(Math.max(0.05, rate), t, 0.03);
      let g = vol != null ? (v.vol = vol) : v.vol;
      if (at !== undefined) v.at = at;
      if (v.at) { const s = spatial(v.at); g *= s ? s.g : 0; if (s && v.p) v.p.pan.setTargetAtTime(s.pan, t, 0.05); }
      else if (pan != null && v.p) v.p.pan.setTargetAtTime(pan, t, 0.03);
      v.g.gain.setTargetAtTime(g * v.trim, t, 0.03);
    },
    get playing() { return !v.done && (v.loop || v.end > now()); },
  };
}
const DEAD = { stop() { }, set() { }, playing: false };

function play(name, { vol = 1, rate = 1, pan = 0, at = null, loop = false, delay = 0 } = {}) {
  if (!S.ctx || typeof name !== 'string') return DEAD;
  if (S.muted && !loop) return DEAD;
  const isVO = name.startsWith('vo_');
  const buf = getBuf(name);
  if (!buf) return DEAD;
  const sp = spatial(at);
  if (!sp) return DEAD;                               // culled by distance
  reap();
  // voice limits: per name, then global
  const same = S.voices.filter(v => v.name === name && !v.loop);
  const cap = MAXPER[name] ?? 5;
  if (same.length >= cap) makeHandle(same[0]).stop(0.02);
  if (S.voices.length >= MAX_VOICES) { const old = S.voices.find(v => !v.loop); if (old) makeHandle(old).stop(0.02); }

  const ctx = S.ctx, t = now() + Math.max(0, delay);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const vary = VARY[name] ? 1 + (Math.random() * 2 - 1) * VARY[name] : 1;
  src.playbackRate.value = Math.max(0.05, rate * vary);
  src.loop = loop;
  const g = ctx.createGain();
  const trim = dB((TRIM[name] ?? 0) + (isVO ? 0 : 0));
  g.gain.value = vol * sp.g * trim;
  let node = src;
  node.connect(g); node = g;
  if (sp.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = sp.lp; node.connect(f); node = f; }
  let p = null;
  if (ctx.createStereoPanner) { p = ctx.createStereoPanner(); p.pan.value = at ? sp.pan : clamp(pan, -1, 1); node.connect(p); node = p; }
  node.connect(isVO ? S.voBus : S.sfxBus);
  src.start(t);
  const v = { name, src, g, p, at, vol, trim, loop, done: false, end: t + buf.duration / src.playbackRate.value + 0.05 };
  src.onended = () => { v.done = true; try { g.disconnect(); p?.disconnect(); } catch { /* */ } };
  S.voices.push(v);
  if (isVO) {                                           // one announcer at a time
    if (S.vo && !S.vo.done) makeHandle(S.vo).stop(0.08);
    S.vo = v; duckMusic(0.7, buf.duration);
  } else if (!at && DUCK[name]) duckMusic(DUCK[name], Math.min(1.2, buf.duration));
  return makeHandle(v);
}

function duckMusic(level, hold) {
  if (!S.musicDuck) return;
  const t = now(), g = S.musicDuck.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(Math.min(g.value, level), t + 0.06);
  S.duckUntil = Math.max(S.duckUntil, t + hold);
  g.setValueAtTime(Math.min(g.value, level), S.duckUntil);
  g.linearRampToValueAtTime(1, S.duckUntil + 0.6);
}

/* ======================================================================
 *  ENGINES — synthesised two-stroke buzz, pooled voices
 * ==================================================================== */

export const ENGINE = {
  aiVoices: 4,          // nearest AI karts that get an engine voice
  idleHz: 52, topHz: 150, gears: 3, gearDip: 0.16,
  playerVol: 0.34, aiVol: 0.3, aiRef: 5, aiMax: 60,
};

function hashId(id) { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

function makeEngineVoice() {
  const ctx = S.ctx;
  const out = ctx.createGain(); out.gain.value = 0;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  out.connect(pan).connect(S.engineBus);
  // body: saw + half-rate square, pushed through a soft drive then a lowpass
  const a = ctx.createOscillator(); a.type = 'sawtooth';
  const b = ctx.createOscillator(); b.type = 'square';
  const ga = ctx.createGain(); ga.gain.value = 0.55;
  const gb = ctx.createGain(); gb.gain.value = 0.3;
  const drive = ctx.createGain(); drive.gain.value = 1.2;
  const shaper = ctx.createWaveShaper();
  { const N = 1024, cv = new Float32Array(N); for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; cv[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); } shaper.curve = cv; }
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5; lp.frequency.value = 900;
  // putt: amplitude wobble at half the firing rate
  const am = ctx.createGain(); am.gain.value = 0.75;
  const lfo = ctx.createOscillator(); lfo.type = 'square';
  const lfoG = ctx.createGain(); lfoG.gain.value = 0.25;
  lfo.connect(lfoG).connect(am.gain);
  // FM wobble for a slightly rough, cartoony engine
  const wob = ctx.createOscillator(); wob.type = 'sine'; wob.frequency.value = 7;
  const wobG = ctx.createGain(); wobG.gain.value = 2.5;
  wob.connect(wobG); wobG.connect(a.frequency); wobG.connect(b.frequency);
  a.connect(ga).connect(drive); b.connect(gb).connect(drive);
  drive.connect(shaper).connect(lp).connect(am).connect(out);
  // boost whine
  const w = ctx.createOscillator(); w.type = 'triangle';
  const wg = ctx.createGain(); wg.gain.value = 0;
  w.connect(wg).connect(out);
  // tyre squeal (drift) and offroad rumble from the shared noise buffer
  const nz = ctx.createBufferSource(); nz.buffer = S.noise; nz.loop = true;
  const sq = ctx.createBiquadFilter(); sq.type = 'bandpass'; sq.Q.value = 9; sq.frequency.value = 2000;
  const sqg = ctx.createGain(); sqg.gain.value = 0;
  const rb = ctx.createBiquadFilter(); rb.type = 'lowpass'; rb.frequency.value = 380;
  const rbg = ctx.createGain(); rbg.gain.value = 0;
  nz.connect(sq).connect(sqg).connect(out);
  nz.connect(rb).connect(rbg).connect(out);
  const t = now();
  for (const o of [a, b, lfo, wob, w]) o.start(t);
  nz.start(t, Math.random() * 1.9);
  return { out, pan, a, b, lp, drive, lfo, wob, w, wg, sq, sqg, rbg, kart: null, gain: 0 };
}

function engineState(id, isPlayer) {
  const h = hashId(id);
  return {
    id, isPlayer: !!isPlayer,
    pitch: 1 + (((h % 1000) / 1000) - 0.5) * 0.26,   // per-kart character ±13%
    wob: 5 + (h % 7),
    u: { speed: 0, maxSpeed: 22, throttle: 0, drift: 0, boost: 0, air: false, pos: null },
    prevPos: null, prevT: 0, vr: 0, dist: 0, voice: null,
  };
}

function driveVoice(v, k) {
  const ctx = S.ctx, t = now(), u = k.u;
  const n = clamp(Math.abs(u.speed) / Math.max(1, u.maxSpeed || 22), 0, 1.45);
  const boost = typeof u.boost === 'number' ? clamp(u.boost, 0, 1) : (u.boost ? 1 : 0);
  const thr = clamp(u.throttle ?? 0, 0, 1);
  // gear-ish: rev climbs inside a gear, dips a little on each "shift"
  const G = ENGINE.gears, p = Math.min(n, 0.999) * G, within = p - Math.floor(p);
  let f = ENGINE.idleHz + (ENGINE.topHz - ENGINE.idleHz) * (n * (1 - ENGINE.gearDip) + ENGINE.gearDip * within * Math.min(1, n * 3));
  f *= k.pitch;
  f *= 1 + 0.1 * boost;
  if (u.air) f *= 1.14 + 0.1 * thr;                  // wheels free: revs flare
  // doppler for AI passes (mild)
  if (!k.isPlayer && k.vr) f *= clamp(343 / (343 + k.vr * 0.6), 0.85, 1.15);
  const tc = k.isPlayer ? 0.04 : 0.08;
  v.a.frequency.setTargetAtTime(f, t, tc);
  v.b.frequency.setTargetAtTime(f * 0.5 * 1.006, t, tc);
  v.lfo.frequency.setTargetAtTime(f * 0.5, t, tc);
  v.wob.frequency.setTargetAtTime(k.wob + 4 * n, t, 0.2);
  v.lp.frequency.setTargetAtTime(500 + 1700 * thr + 1400 * n + (u.air ? 800 : 0) + 1500 * boost, t, 0.06);
  v.drive.gain.setTargetAtTime(0.9 + 1.8 * thr + 0.8 * boost, t, 0.06);
  v.w.frequency.setTargetAtTime(f * 7 + 300 * boost, t, 0.05);
  v.wg.gain.setTargetAtTime(0.1 * boost, t, 0.08);
  const drifting = u.drift && !u.air && n > 0.15;
  const charge = clamp(u.charge ?? 0, 0, 1);
  v.sq.frequency.setTargetAtTime(1700 + 900 * charge + 200 * Math.sin(t * 9), t, 0.05);
  v.sqg.gain.setTargetAtTime(drifting ? 0.28 * Math.min(1, n * 1.4) : 0, t, drifting ? 0.03 : 0.06);
  const rough = u.offroad && !u.air && n > 0.05;
  v.rbg.gain.setTargetAtTime(rough ? 0.5 * Math.min(1, n * 2) : 0, t, 0.05);
  // loudness: throttle opens it up; AI distance-attenuated
  let g = (0.55 + 0.45 * thr) * (0.75 + 0.25 * Math.min(1, n));
  let pan = 0;
  if (k.isPlayer) g *= ENGINE.playerVol;
  else {
    const s = u.pos ? spatial(u.pos, { ref: ENGINE.aiRef, roll: 1.3, max: ENGINE.aiMax, lpNear: 1e9 }) : null;
    g = s ? g * ENGINE.aiVol * s.g : 0; pan = s ? s.pan : 0;
  }
  if (S.paused) g = 0;
  v.out.gain.setTargetAtTime(g, t, 0.05);
  if (v.pan.pan) v.pan.pan.setTargetAtTime(pan, t, 0.05);
}

function assignAIVoices() {
  const t = now();
  if (t - S.lastAssign < 0.15) return;
  S.lastAssign = t;
  const L = S.lis;
  const ai = [...S.karts.values()].filter(k => !k.isPlayer && k.u.pos);
  for (const k of ai) k.dist = Math.hypot(k.u.pos.x - L.x, k.u.pos.z - L.z);
  ai.sort((x, y) => x.dist - y.dist);
  const want = new Set(ai.slice(0, ENGINE.aiVoices).filter(k => k.dist < ENGINE.aiMax).map(k => k.id));
  // free voices whose kart is no longer wanted
  for (const v of S.pool) if (v.kart && !want.has(v.kart.id)) { v.out.gain.setTargetAtTime(0, t, 0.06); v.kart.voice = null; v.kart = null; }
  for (const id of want) {
    const k = S.karts.get(id);
    if (k.voice) continue;
    let v = S.pool.find(x => !x.kart);
    if (!v && S.pool.length < ENGINE.aiVoices) { v = makeEngineVoice(); S.pool.push(v); }
    if (!v) break;
    v.kart = k; k.voice = v;
  }
}

/* ======================================================================
 *  MUSIC — two <audio> decks, crossfaded, streamed (never decoded)
 * ==================================================================== */

function musicInfo(name) {
  const m = S.musicIndex?.music?.[name];
  if (typeof m === 'string') return { file: m, gain: 0 };
  if (m) return { file: m.file, gain: m.gain ?? 0, fallback: m.fallback };
  return { file: name + '.mp3', gain: 0 };
}

function makeDeck() {
  const el = new Audio();
  el.preload = 'auto'; el.loop = true;
  const src = S.ctx.createMediaElementSource(el);
  const g = S.ctx.createGain(); g.gain.value = 0;
  src.connect(g).connect(S.musicDuck);
  const d = { el, g, name: null, stopTimer: 0 };
  el.addEventListener('error', () => {
    // file missing or undecodable: try the fallback once
    const info = musicInfo(d.name);
    if (info.fallback && !el.src.endsWith(info.fallback)) { el.src = ASSETS + 'audio/' + info.fallback; el.play().catch(() => { }); }
  });
  return d;
}

function startMusic(name) {
  const ctx = S.ctx;
  if (!ctx || !S.unlocked) return;
  if (S.musicName === name) return;
  if (!S.decks.length) S.decks = [makeDeck(), makeDeck()];
  const t = now();
  // fade the current deck out
  const cur = S.decks[S.deck];
  if (cur && cur.name) {
    cur.g.gain.cancelScheduledValues(t); cur.g.gain.setValueAtTime(cur.g.gain.value, t);
    cur.g.gain.linearRampToValueAtTime(0, t + 0.9);
    clearTimeout(cur.stopTimer);
    const dead = cur;
    dead.stopTimer = setTimeout(() => { if (S.decks[S.deck] !== dead) { dead.el.pause(); dead.name = null; } }, 1000);
  }
  S.musicName = name;
  if (!name) { S.deck = -1; return; }
  S.deck = (S.deck + 1) % 2;
  const d = S.decks[S.deck];
  clearTimeout(d.stopTimer);
  const info = musicInfo(name);
  d.name = name;
  d.el.src = ASSETS + 'audio/' + info.file;
  d.el.currentTime = 0;
  d.g.gain.cancelScheduledValues(t); d.g.gain.setValueAtTime(0, t);
  const target = dB(info.gain || 0);
  d.el.play().then(() => {
    const t2 = now();
    d.g.gain.setValueAtTime(0, t2); d.g.gain.linearRampToValueAtTime(target, t2 + 0.7);
  }).catch(() => { S.musicName = null; });  // autoplay refused: retried on unlock()
}

/* ======================================================================
 *  PUBLIC API
 * ==================================================================== */

function onGesture() { audio.unlock(); }

export const audio = {
  init() {
    if (S.ctx || !AC) return;
    try { S.ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    buildGraph();
    S.ready = true;
    S.loading = loadFiles();
    if (HAS_WINDOW) {
      for (const ev of ['keydown', 'pointerdown', 'touchend', 'mousedown']) window.addEventListener(ev, onGesture, { capture: true, passive: true });
      document.addEventListener('visibilitychange', () => {
        if (!S.ctx) return;
        if (document.hidden) { S.ctx.suspend(); for (const d of S.decks) d.name && d.el.pause(); }
        else if (S.unlocked) { S.ctx.resume(); const d = S.decks[S.deck]; if (d?.name) d.el.play().catch(() => { }); }
      });
    }
    if (S.ctx.state === 'running') S.unlocked = true;   // autoplay policy allows it (Steam Deck launcher)
  },

  unlock() {
    if (!S.ctx) this.init();
    if (!S.ctx) return;
    const go = () => {
      S.unlocked = true;
      if (HAS_WINDOW) for (const ev of ['keydown', 'pointerdown', 'touchend', 'mousedown']) window.removeEventListener(ev, onGesture, { capture: true });
      if (S.wantMusic !== S.musicName) startMusic(S.wantMusic);
    };
    if (S.ctx.state === 'running') go();
    else S.ctx.resume().then(go, () => { });
  },

  /** play a one-shot (or a loop with {loop:true}); returns a handle {stop(fade), set({vol,rate,at,pan}), playing} */
  play(name, opts) {
    try { return play(name, opts); } catch (e) { console.warn('[audio] play', name, e); return DEAD; }
  },

  music(name) {
    S.wantMusic = name ?? null;
    if (!S.ctx) this.init();
    try { startMusic(S.wantMusic); } catch (e) { console.warn('[audio] music', e); }
  },

  engineStart(id, isPlayer = false) {
    if (!S.ctx) return;
    let k = S.karts.get(id);
    if (!k) { k = engineState(id, isPlayer); S.karts.set(id, k); }
    k.isPlayer = !!isPlayer;
    if (k.isPlayer) {
      if (!S.playerVoice) S.playerVoice = makeEngineVoice();
      // one player voice; a second "player" (split screen) shares it
      S.playerVoice.kart = k; k.voice = S.playerVoice;
    }
  },

  engineUpdate(id, u) {
    if (!S.ctx || !u) return;
    const k = S.karts.get(id);
    if (!k) return;
    Object.assign(k.u, u);
    if (u.pos) {
      const t = now();
      const L = S.lis;
      const d = Math.hypot(u.pos.x - L.x, u.pos.z - L.z);
      if (k.prevT && t > k.prevT) k.vr = k.vr * 0.8 + 0.2 * clamp((d - k.dist0) / (t - k.prevT), -60, 60);
      k.dist0 = d; k.prevT = t;
    }
    if (!k.isPlayer) assignAIVoices();
    if (k.voice) driveVoice(k.voice, k);
  },

  engineStop(id) {
    const k = S.karts.get(id);
    if (!k) return;
    if (k.voice) { k.voice.out.gain.setTargetAtTime(0, now(), 0.08); k.voice.kart = null; }
    S.karts.delete(id);
  },

  /** stop every engine (race end / back to menu) */
  enginesOff() { for (const id of [...S.karts.keys()]) this.engineStop(id); },

  listener(pos, forward) {
    if (pos) { S.lis.x = pos.x; S.lis.y = pos.y ?? 0; S.lis.z = pos.z; }
    if (forward) { const h = Math.hypot(forward.x, forward.z) || 1; S.lis.fx = forward.x / h; S.lis.fz = forward.z / h; }
  },

  setVolumes({ master, music, sfx } = {}) {
    if (master != null) S.vol.master = clamp(+master, 0, 1);
    if (music != null) S.vol.music = clamp(+music, 0, 1);
    if (sfx != null) S.vol.sfx = clamp(+sfx, 0, 1);
    applyVolumes();
  },
  get volumes() { return { ...S.vol }; },

  toggleMute(force) {
    S.muted = force != null ? !!force : !S.muted;
    if (S.muted) for (const v of S.voices) if (!v.loop) makeHandle(v).stop(0.03);
    applyVolumes();
    return S.muted;
  },
  get muted() { return S.muted; },

  /** in-race pause: engines silent, music dips (CTR keeps the music under the pause menu) */
  pause(on) {
    S.paused = !!on;
    if (!S.ctx) return;
    const t = now();
    S.engineBus.gain.setTargetAtTime(on ? 0 : dB(TRIM.engine), t, 0.04);
    for (const v of S.voices) if (v.loop && !v.done) v.g.gain.setTargetAtTime(on ? 0 : v.vol * v.trim, t, 0.04);
    applyVolumes();
  },

  /** optional flavour: a character bark ('win'|'boost'|'hit'|'item'), rate-limited so it stays charming */
  bark(racerId, kind, { at = null, force = false } = {}) {
    const list = BARKS[racerId]?.[kind];
    if (!list || !S.ctx) return DEAD;
    const t = now();
    if (!force && t - S.lastBark < 5) return DEAD;
    S.lastBark = t;
    const name = list[(Math.random() * list.length) | 0];
    // barks go through the SFX path (not the one-at-a-time announcer channel) so they never cut the announcer
    const buf = getBuf(name); if (!buf) return DEAD;
    return name.startsWith('vo_') ? playBark(name, at) : play(name, { at, vol: 0.9 });
  },

  /** true once generated files are in (tests) */
  get loaded() { return S.loading || Promise.resolve(); },
  /** introspection for audio-test.html / mixprobe */
  get _debug() { return S; },
};

function playBark(name, at) {
  // same as play(), but routed to the SFX bus instead of the exclusive announcer channel
  const buf = getBuf(name); if (!buf || !S.ctx) return DEAD;
  const sp = spatial(at, { ...SPATIAL, ref: 10 }); if (!sp) return DEAD;
  const src = S.ctx.createBufferSource(); src.buffer = buf;
  const g = S.ctx.createGain(); g.gain.value = 0.85 * sp.g * dB(TRIM.vo);
  const p = S.ctx.createStereoPanner(); p.pan.value = sp.pan;
  src.connect(g).connect(p).connect(S.sfxBus); src.start();
  const v = { name, src, g, p, at, vol: 0.85, trim: dB(TRIM.vo), loop: false, done: false, end: now() + buf.duration + 0.05 };
  src.onended = () => { v.done = true; };
  S.voices.push(v);
  return makeHandle(v);
}

export default audio;
