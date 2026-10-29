// letters.js — PURE (no THREE, no DOM): the C-T-R letters (DESIGN.md "Modes and UI" → C-T-R letters).
//
// Every track has three floating letter tokens, C, T and R, authored as data (`def.letters`, in that
// order — see DESIGN.md "Track data format"). They're only in the race for a solo human (1P Quick Race
// and Time Trial; never the cup, 2P or online, so those races stay fair) — main.js decides and calls
// attachLetters(race). Only race.player collects them: the AI, items, physics and the wire never see
// them. Collect all three in ONE race and finish → save.js marks the track (the tracks screen's gold
// C-T-R badge); all tracks → the gold / rainbow kart paints.
//
//   const L = attachLetters(race);   // race.letters = L; a system checks the player every step
//   L.list   [{ i, ch, color, route, rs, s, lat, x, y (road), z, cy (token centre) }]
//   L.got    [bool, bool, bool];  L.n (count);  L.all (all three this race)
//   race.events ← { type: 'letter', kart, i, n }   (n = how many after this one; 3 = the set)
//   L.collect(i, quiet) — tests / ?ctrgot=1 (marks one collected; quiet = no event)
//
// The shapes (LETTER_SHAPES) are outlines in a unit box (height 1, y up): letterviews.js extrudes them
// in 3D, letterSVG() draws the same outline for the HUD slots and the menu badges (no font, no emoji).

export const LETTER_CHARS = ['C', 'T', 'R'];
export const LETTER_COLORS = [0x2fb8ff, 0x7ed957, 0xff4f8a];      // C sky blue, T green, R pink: one colour each, everywhere
export const LETTER = {
  Y: 2.0,          // token centre above the road surface (m): a kart drives straight through it
  H: 3.2,          // token height (m) — over twice a kart's: it reads from 60 m away
  R: 2.7,          // pick-up radius, horizontal (m, kart centre ↔ token axis)
  DY: 2.4,         // …and vertical (kart middle, 0.6 m up, ↔ token centre): stacked decks are ≥ 8 m apart
};

const arc = (cx, cy, r, a0, a1, n) => { const o = []; for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
const D = Math.PI / 180;
/** Outlines, counter-clockwise, unit height; `w` = width. Chunky strokes (~0.28) so they read at 60 m. */
export const LETTER_SHAPES = [
  // C: a thick ring with the mouth open to the right
  { w: 0.92, outer: [...arc(0.5, 0.5, 0.5, 42 * D, 318 * D, 22), ...arc(0.5, 0.5, 0.22, 318 * D, 42 * D, 14)], holes: [] },
  // T
  { w: 0.9, outer: [[0, 1], [0, 0.72], [0.31, 0.72], [0.31, 0], [0.59, 0], [0.59, 0.72], [0.9, 0.72], [0.9, 1]], holes: [] },
  // R: stem + round bowl + kicked leg, one outline with the bowl's hole
  { w: 0.86, outer: [[0, 0], [0.28, 0], [0.28, 0.4], [0.36, 0.4], [0.58, 0], [0.88, 0], [0.62, 0.45],
      ...arc(0.47, 0.715, 0.285, -58 * D, 90 * D, 12), [0, 1]],
    holes: [[[0.28, 0.6], ...arc(0.47, 0.715, 0.115, -90 * D, 90 * D, 8), [0.28, 0.83]]] },
];

/** An SVG of letter i (0 C, 1 T, 2 R): `on` = collected (its colour, glowing), else a dim slot outline. */
export function letterSVG(i, { on = true, cls = '' } = {}) {
  const sh = LETTER_SHAPES[i], col = '#' + LETTER_COLORS[i].toString(16).padStart(6, '0');
  const pad = 0.14, W = sh.w + pad * 2, H = 1 + pad * 2;
  const P = pts => 'M' + pts.map(([x, y]) => `${(x + pad).toFixed(3)} ${(1 - y + pad).toFixed(3)}`).join('L') + 'Z';
  const d = P(sh.outer) + sh.holes.map(P).join('');
  return `<svg class="ctrl ${on ? 'on' : 'off'} ${cls}" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}"><path d="${d}" fill-rule="evenodd" fill="${on ? col : 'rgba(255,255,255,.12)'}" stroke="${on ? '#0b1020' : 'rgba(255,255,255,.55)'}" stroke-width="0.07" stroke-linejoin="round"/></svg>`;
}
/** the three letters side by side (menus: the track card badge, the results celebration) */
export const ctrSVG = (cls = '') => `<span class="ctrrow ${cls}">${[0, 1, 2].map(i => letterSVG(i)).join('')}</span>`;

/**
 * Resolve a track's `def.letters` against the built track. Entries: { at, lat = 0, y = LETTER.Y, route }
 * — `route` = a branch id (then `at` is that branch's point index + fraction), else the main road.
 * An entry whose route doesn't exist (the gate's branch fixture copies Bubbly Beach's data) is skipped.
 */
export function resolveLetters(track) {
  const defs = track.def?.letters || [];
  const out = [];
  defs.slice(0, 3).forEach((L, i) => {
    let rt = track, route = 0;
    if (L.route) { const br = track.branchById?.(L.route); if (!br) return; rt = br; route = br.route; }
    const rs = rt.sOf(L.at), lat = L.lat ?? 0;
    const p = rt.pointAt(rs, lat);
    const s = route ? rt.mainS(rs) : rs;
    out.push({ i, ch: LETTER_CHARS[i], color: LETTER_COLORS[i], route, routeId: L.route || null, rs, s, lat, x: p.x, y: p.y, z: p.z, cy: p.y + (L.y ?? LETTER.Y), def: L });
  });
  return out;
}

/** Is kart k touching letter e? (the kart's origin is on its wheels) */
export const touches = (k, e) => (k.pos.x - e.x) ** 2 + (k.pos.z - e.z) ** 2 < LETTER.R * LETTER.R && Math.abs(k.pos.y + 0.6 - e.cy) < LETTER.DY;

/** Put the letters in this race (main.js: solo human only). Returns race.letters. */
export function attachLetters(race, { kart = race.player } = {}) {
  const list = resolveLetters(race.track);
  const L = {
    list, got: list.map(() => false), n: 0, all: false, kart,
    collect(i, quiet = false) {
      if (L.got[i] == null || L.got[i]) return false;
      L.got[i] = true; L.n++; L.all = L.n >= 3 && L.got.length === 3;
      if (!quiet) race.events.push({ type: 'letter', kart: L.kart, i, n: L.n });
      return true;
    },
  };
  race.letters = L;
  if (!kart || list.length < 3) return L;
  race.addSystem(r => {
    if (r.letters !== L || r.phase !== 'race') return;
    const k = L.kart;
    if (k.finished || k.respawnT > 0) return;
    for (const e of L.list) if (!L.got[e.i] && touches(k, e)) L.collect(e.i);
  });
  return L;
}
