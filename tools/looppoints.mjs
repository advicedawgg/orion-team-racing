// Loop-point finder, ported from Super Orion 2 tools/looppoints.js (same algorithm, now a module).
//
// Finds seamless loop points in a generated track and writes them to
// src/music.js. The game plays 0..loopEnd once (the intro), then repeats
// loopStart..loopEnd forever.
//
// Three things have to be right or the seam is audible:
//
//   1. TEMPO. Autocorrelation of an onset envelope happily locks onto 4/3 or
//      3/2 of the real beat. So we score several candidate periods — the
//      autocorrelation peaks, their halves and doubles, AND the BPM the track
//      was generated with (genmusic.js knows it) — and keep whichever yields
//      the best loop.
//   2. THE DOWNBEAT, not just the beat. A loop that starts on beat 3 lands on
//      the right pulse and still feels wrong, because the bar restarts in the
//      wrong place. We try every beat-phase within the bar and let the match
//      score pick.
//   3. SAMPLE-LEVEL PHASE. Frame resolution is ~23ms, which is enough slop to
//      hear as a flam. After the coarse search we slide loopEnd by up to a
//      third of a beat, maximising waveform cross-correlation against loopStart.
//
// OTR bakes the loop BODY (loopStart..loopEnd) into the shipped file, because music streams off an
// <audio loop> element (measured: Opus loops with no audible gap in Chrome; MP3/WAV drop ~6 ms).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 22050, WIN = 2048, HOP = 512, BANDS = 24, FPS = SR / HOP;
const MIN_LOOP = 18, BEATS_PER_BAR = 4;

/* ------------------------------------------------------------------ decode */
const decode = file => {
  const raw = execFileSync('ffmpeg',
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30, encoding: 'buffer' });
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
};

/* --------------------------------------------------------------------- FFT */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]];[im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const ur = re[a], ui = im[a];
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[a] = ur + vr; im[a] = ui + vi;
        re[b] = ur - vr; im[b] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/* ---------------------------------------------------- per-frame features */
// Unit-normalised log-band spectra: the match is then about WHAT is playing,
// not how loud, so quiet moments don't all look alike.
function features(pcm) {
  const n = Math.floor((pcm.length - WIN) / HOP);
  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN);
  const edges = [];
  for (let b = 0; b <= BANDS; b++)
    edges.push(Math.min(WIN / 2 - 1, Math.max(1, Math.round(40 * Math.pow(200, b / BANDS) * WIN / SR))));

  const feats = [], re = new Float64Array(WIN), im = new Float64Array(WIN);
  for (let f = 0; f < n; f++) {
    const off = f * HOP;
    for (let i = 0; i < WIN; i++) { re[i] = pcm[off + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const v = new Float32Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      let s = 0;
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) s += Math.hypot(re[k], im[k]);
      v[b] = Math.log1p(s);
    }
    let nn = 0; for (const x of v) nn += x * x;
    nn = Math.sqrt(nn) || 1;
    for (let b = 0; b < BANDS; b++) v[b] /= nn;
    feats.push(v);
  }
  return feats;
}

const onsets = feats => {
  const flux = new Float32Array(feats.length);
  for (let f = 1; f < feats.length; f++) {
    let s = 0;
    for (let b = 0; b < BANDS; b++) s += Math.max(0, feats[f][b] - feats[f - 1][b]);
    flux[f] = s;
  }
  return flux;
};

/* -------------------------------------------------------- tempo selection */
// Choose the beat period on BEAT-TRACKING evidence — how well onsets line up
// with the grid — and only then search for loops on it.
//
// The earlier version handed every candidate tempo to the loop search and kept
// whichever produced the best match. That is backwards: the loop score is a
// timbre-repeat detector, so it happily picked 172 BPM for a 124 BPM beach
// track because that grid happened to expose a tight timbre repeat. Tempo is a
// separate question and needs its own evidence.
function chooseBeat(flux, hintBpm) {
  const lo = Math.round(FPS * 60 / 200), hi = Math.round(FPS * 60 / 60);
  let mean = 0; for (const x of flux) mean += x;
  mean = (mean / flux.length) || 1e-9;

  // How much more onset energy sits on the grid than on average. Dividing by
  // the number of grid points keeps this comparable across periods.
  const comb = P => {
    let bestPhase = 0, bestSum = -1;
    for (let p = 0; p < P; p++) {
      let s = 0, n = 0;
      for (let f = p; f < flux.length; f += P) { s += flux[f]; n++; }
      if (n && s / n > bestSum) { bestSum = s / n; bestPhase = p; }
    }
    return { score: bestSum / mean, phase: bestPhase };
  };

  const cands = new Set();
  if (hintBpm) {
    // We ASKED the model for this tempo and it honours the request closely
    // (132 requested → 136 rendered), so search ±10% of it and nothing else.
    // Deliberately no half/double: the comb score inherently favours sparser
    // grids — a half-tempo grid only has to hit the strongest downbeats — so
    // offering octaves just lets it drift to 66 BPM on a 132 BPM track.
    const t = FPS * 60 / hintBpm;
    for (let P = Math.round(t * 0.9); P <= Math.round(t * 1.1); P++)
      if (P >= lo && P <= hi) cands.add(P);
  }
  if (!cands.size) {                       // no hint: fall back to autocorrelation
    const ac = new Float64Array(hi + 1);
    for (let lag = lo; lag <= hi; lag++) {
      let s = 0;
      for (let f = lag; f < flux.length; f++) s += flux[f] * flux[f - lag];
      ac[lag] = s / (flux.length - lag);
    }
    const peaks = [];
    for (let lag = lo + 1; lag < hi; lag++)
      if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) peaks.push(lag);
    peaks.sort((a, b) => ac[b] - ac[a]);
    for (const p of peaks.slice(0, 6)) for (const m of [0.5, 1, 2]) {
      const v = Math.round(p * m);
      if (v >= lo && v <= hi) cands.add(v);
    }
  }

  let best = null;
  for (const P of cands) {
    const c = comb(P);
    if (!best || c.score > best.score) best = { beat: P, ...c };
  }
  return best;
}

/* --------------------------------------------------------------- loudness */
// Per-frame RMS in dB. `features()` normalises every frame to unit length, so
// by design it cannot tell loud from quiet — which is exactly the thing a
// listener notices at a bad seam.
function levels(pcm) {
  const n = Math.floor((pcm.length - WIN) / HOP);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < WIN; i++) { const x = pcm[off + i]; e += x * x; }
    out[f] = 20 * Math.log10(Math.sqrt(e / WIN) + 1e-9);
  }
  return out;
}

/* ------------------------------------------------------------ loop search */
// Score how alike the music AROUND `a` is to the music AROUND `b`. If they
// match, the jump from b back to a is inaudible — what plays next is what
// would have played anyway.
//
// The window looks BOTH WAYS on purpose. A forward-only window silently
// disqualifies every loop end within two bars of the track end, which is
// exactly where the best loop point usually is — you want to use the whole
// track. Backward context is always available, so late ends stay in the race.
function makeSim(feats, bar) {
  const back = bar, fwdMax = bar;
  return (a, b) => {
    const fwd = Math.min(fwdMax, feats.length - 1 - Math.max(a, b));
    const bk = Math.min(back, a, b);
    let s = 0, n = 0;
    for (let i = -bk; i < fwd; i++) {
      const fa = feats[a + i], fb = feats[b + i];
      let d = 0;
      for (let k = 0; k < BANDS; k++) d += fa[k] * fb[k];   // both unit-norm already
      s += d; n++;
    }
    return n ? s / n : -1;
  };
}

function searchGrid(feats, flux, beat) {
  const bar = beat * BEATS_PER_BAR;
  const sim = makeSim(feats, bar);
  const minLoop = Math.round(MIN_LOOP * FPS);
  const out = [];

  // Beat phase first (most onset energy), then try each beat within the bar as
  // the downbeat — landing on beat 3 sits on the grid and still feels wrong.
  let beatPhase = 0, bp = -1;
  for (let p = 0; p < beat; p++) {
    let s = 0;
    for (let f = p; f < flux.length; f += beat) s += flux[f];
    if (s > bp) { bp = s; beatPhase = p; }
  }

  for (let k = 0; k < BEATS_PER_BAR; k++) {
    const phase = beatPhase + k * beat;
    const bars = [];
    for (let f = phase; f < feats.length - Math.round(0.25 * bar); f += bar) bars.push(f);
    for (const s of bars) {
      if (s < bar) continue;                       // leave room for an intro
      for (const e of bars) {
        if (e - s < minLoop) continue;
        out.push({ s, e, score: sim(s, e), beat, bar, phase });
      }
    }
  }
  return out;
}

/* -------------------------------------------------- sample-level refinement */
// Frame resolution is ~23ms — plenty to hear as a flam. Slide loopEnd against
// loopStart and take the waveform cross-correlation peak.
function refine(pcm, sSec, eSec, beatSec) {
  const W = Math.round(0.4 * SR);
  const range = Math.round(beatSec / 3 * SR);
  const S = Math.round(sSec * SR);
  const E0 = Math.round(eSec * SR);
  let bestD = 0, bestC = -2;
  for (let d = -range; d <= range; d++) {
    const E = E0 + d;
    if (E < 0 || E + W >= pcm.length || S + W >= pcm.length) continue;
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < W; i++) {
      const x = pcm[S + i], y = pcm[E + i];
      ab += x * y; aa += x * x; bb += y * y;
    }
    const c = ab / (Math.sqrt(aa * bb) || 1);
    if (c > bestC) { bestC = c; bestD = d; }
  }
  return { loopEnd: (E0 + bestD) / SR, corr: bestC, shiftMs: bestD / SR * 1000 };
}


/**
 * Find a loop in `file`. Returns { loopStart, loopEnd, bpm, score, corr, step, dur }.
 * `hintBpm` = the tempo the track was generated with. `after` keeps the loop start after N s.
 */
export function findLoop(file, hintBpm = 0, { after = 0, maxStep = 2.5 } = {}) {
  const pcm = decode(file);
  const dur = pcm.length / SR;
  const feats = features(pcm);
  const flux = onsets(feats);
  const tempo = chooseBeat(flux, hintBpm);
  let all = tempo ? searchGrid(feats, flux, tempo.beat) : [];
  if (after) { const kept = all.filter(c => c.s / FPS >= after); if (kept.length) all = kept; }
  if (!all.length) return null;
  const lvl = levels(pcm);
  const meanLvl = (from, to) => {
    let s = 0, n = 0;
    for (let f = Math.max(0, Math.round(from)); f < Math.min(lvl.length, Math.round(to)); f++) { s += lvl[f]; n++; }
    return n ? s / n : 0;
  };
  const stepOf = c => meanLvl(c.s, c.s + c.bar) - meanLvl(c.e - c.bar, c.e);
  const levelled = all.filter(c => Math.abs(stepOf(c)) <= maxStep);
  const pool = levelled.length ? levelled : all;
  const top = pool.reduce((a, b) => (b.score > a.score ? b : a));
  const TOL = 0.006;
  const best = pool.filter(c => c.score >= top.score - TOL).reduce((a, b) => {
    const la = a.e - a.s, lb = b.e - b.s;
    if (lb !== la) return lb > la ? b : a;
    return Math.abs(stepOf(b)) < Math.abs(stepOf(a)) ? b : a;
  });
  const beatSec = best.beat / FPS;
  const fine = refine(pcm, best.s / FPS, best.e / FPS, beatSec);
  return {
    loopStart: +(best.s / FPS).toFixed(4), loopEnd: +fine.loopEnd.toFixed(4), bpm: +(60 / beatSec).toFixed(1),
    score: +best.score.toFixed(4), corr: +fine.corr.toFixed(3), step: +stepOf(best).toFixed(1), dur: +dur.toFixed(2),
    levelled: levelled.length > 0,
  };
}
