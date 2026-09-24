// hud.js — the in-race HUD (UI agent owns; CSS in ui.css, `.hx-*`).
//
// Contract main.js relies on (unchanged from core's stub):
//   const hud = createHud(rootEl);  hud.show(bool);  hud.update(view, race?);
//   hud.count(n|'GO!'|null);  hud.banner(text, ms, cls);  hud.results(rows|null)
// `view` = { lap, laps, place, speed, charge, redStart, inRed, drift, overheat, turbos, boostT,
//            boostMaxT, stars, finished, raceTime, wrongWay }.  `race` (optional 2nd arg) gives the
// rank list, minimap, wrong-way detection, turbo pops and the items agent's item slot.
//
// Extras for other modules:
//   hud.event(text, { ms, cls, icon })  — a secondary callout under the banner (item events:
//                                          "KING DAD PRESSED PAUSE!", "ZAPPED!"…); never clobbers
//                                          FINAL LAP.  cls: 'good' | 'bad' | 'item' | 'warn'.
//   hud.warn(key, text|null)            — a persistent flashing warning while text is set
//                                          (e.g. hud.warn('rocket', 'ROCKET!') / hud.warn('rocket', null)).
//   hud.pop(text, cls)                  — the turbo-style pop over the slide meter.
//   race.ui = [{ text, ms, cls, icon, kart, warn, key, on }]  — a queue a PURE module (items.js)
//     may push to; the HUD drains it every frame and shows entries whose `kart` is the player or
//     absent. `warn:true` entries call hud.warn(key, on ? text : null).
//   hud.menuOwnsResults = true          — set by menu.js: hud.results() then only hides the stub panel.
//   portraitURL(id, size)               — cached data-URL of racers.js renderPortrait (menus use it too).
//
// 2P split screen (multiplayer agent): createHud(root, { pn }) follows human `pn` (race.humans[pn];
// default 0 = race.player). main.js makes one per half. The rank list rings the HUD's own kart
// gold and the other human in their player colour; the minimap (shown by P1's HUD only, straddling
// the split) rings both humans. `hud.drainsUi = false` on all but the last HUD so race.ui
// entries reach every half before they're cleared.

const ORD = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
export const ordSuffix = n => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
export const clock = (t, dp = 2) => { if (!isFinite(t)) return '-:--'; t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(dp).padStart(dp ? 3 + dp : 2, '0')}`; };
const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0');

/* ------------------------------------------------------------------ racers (portraits, colours) */
let R = null;
const rp = import('./racers.js').then(m => { R = m; }).catch(e => console.warn('[hud] racers.js unavailable, letter portraits', e));
const purls = new Map();
/** Cached data URL of a racer portrait (bg disc). Falls back to a lettered disc. */
export function portraitURL(id, size = 96) {
  const key = id + ':' + size;
  if (purls.has(key)) return purls.get(key);
  let url = '';
  try {
    if (R?.renderPortrait) url = R.renderPortrait(id, size).toDataURL('image/png');
  } catch (e) { console.warn('[hud] portrait failed', id, e); }
  if (!url) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    g.fillStyle = racerColor(id); g.beginPath(); g.arc(size / 2, size / 2, size * .46, 0, 7); g.fill();
    g.lineWidth = size * .05; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = `900 ${size * .5}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText((racerName(id)[0] || '?').toUpperCase(), size / 2, size / 2 + size * .03);
    url = c.toDataURL();
    if (!R) return url;          // don't cache the fallback while racers.js is still loading
  }
  purls.set(key, url);
  return url;
}
export const racersReady = rp;
export const racerDef = id => R?.RACERS?.find(r => r.id === id) || null;
export const racerName = id => racerDef(id)?.name || id;
export const racerColor = id => { const d = racerDef(id); return d ? hex(d.colors.kart) : '#4ec5f1'; };

/* ------------------------------------------------------------------ item HUD (items agent) */
let createItemHud = null;
const ip = import('./itemhud.js').then(m => { createItemHud = m.createItemHud || m.default || null; }).catch(() => { /* not there yet: fine */ });

const PLACE_COL = ['#ffd23f', '#e9f0ff', '#ffa24a', '#8fd3ff', '#8fd3ff', '#8fd3ff', '#8fd3ff', '#8fd3ff'];
const POPS = { 1: ['TURBO!', 't1'], 2: ['SUPER TURBO!!', 't2'], 3: ['ULTRA TURBO!!!', 't3'] };

export const PN_COL = ['#ffd23f', '#4ec5f1'];   // P1 gold, P2 cyan (HUD rings, badges, menus)
export function createHud(root, { pn = 0 } = {}) {
  root.innerHTML = `
    <div class="hx-pn" id="hPn">P${pn + 1}</div>
    <div class="hx-tl">
      <div class="hx-lap"><small>LAP</small><b id="hLap">1</b><i id="hLaps">/3</i></div>
      <div class="hx-time" id="hTime">0:00.00</div>
      <div class="hx-best" id="hBest"></div>
      <ol class="hx-laps" id="hLapList"></ol>
    </div>
    <div class="hx-ranks" id="hRanks"></div>
    <div class="hx-place" id="hPlace"><b>1</b><sup>st</sup></div>
    <div class="hx-top">
      <div class="hx-stars" id="hStarsBox"><img src="assets/ui/star.png" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'★'}))"><b id="hStars">0</b></div>
      <div class="hx-item" id="hItem"></div>
    </div>
    <canvas class="hx-map" id="hMap" width="220" height="220"></canvas>
    <div class="hx-meter" id="hMeter"><i id="hCharge"></i><span class="red" id="hRed"></span><div class="pips" id="hPips"><u></u><u></u><u></u></div></div>
    <div class="hx-boost"><i id="hBoost"></i></div>
    <div class="hx-pop" id="hPop"></div>
    <div class="hx-count" id="hCount"></div>
    <div class="hx-banner" id="hBanner"></div>
    <div class="hx-event" id="hEvent"></div>
    <div class="hx-warn" id="hWarn"></div>
    <div class="hx-wrong" id="hWrong"><span class="arr">↶</span>TURN AROUND!</div>
    <div class="hx-results" id="hResults"></div>`;
  const $ = id => root.querySelector('#' + id);
  const el = { lap: $('hLap'), laps: $('hLaps'), lapList: $('hLapList'), place: $('hPlace'), time: $('hTime'), stars: $('hStars'), starsBox: $('hStarsBox'),
    meter: $('hMeter'), charge: $('hCharge'), red: $('hRed'), pips: $('hPips'), boost: $('hBoost'), count: $('hCount'), banner: $('hBanner'),
    event: $('hEvent'), warn: $('hWarn'), wrong: $('hWrong'), results: $('hResults'), ranks: $('hRanks'), map: $('hMap'), item: $('hItem'), pop: $('hPop') };
  let last = {}, bannerT = null, eventT = null, popT = null, countT = null;
  const set = (k, v, f) => { if (last[k] !== v) { last[k] = v; f(v); } };
  const warns = new Map();
  let itemHud = null, itemTried = false;
  let raceRef = null, rankRows = [], mapCache = null, wrongT = 0, prevK = null, lastNow = performance.now(), lastRaceT = null;
  const meOf = race => race.humans?.[pn] || race.player;      // the kart this HUD follows

  /* ---------------- rank list (CTR: portraits down the side in current order) */
  function buildRanks(race) {
    el.ranks.innerHTML = '';
    const me = meOf(race);
    rankRows = race.karts.map(k => {
      const d = document.createElement('div');
      d.className = 'hx-rank' + (k === me ? ' me' : k.isPlayer ? ' mate pn' + (k.pn + 1) : '');
      d.innerHTML = `<span class="n"></span><img alt="">`;
      const img = d.querySelector('img'); img.src = portraitURL(k.racerId, 96);
      if (!R) rp.then(() => { purls.delete(k.racerId + ':96'); img.src = portraitURL(k.racerId, 96); });
      el.ranks.appendChild(d);
      return { k, d, n: d.firstChild, place: -1 };
    });
  }
  function updateRanks(race) {
    for (const r of rankRows) {
      const p = r.k.place || 1;
      if (p !== r.place) {
        r.place = p; r.d.style.setProperty('--i', p - 1); r.n.textContent = p;
        r.d.classList.toggle('lead', p === 1);
      }
    }
  }

  /* ---------------- minimap */
  function buildMap(track) {
    const c = el.map, W = c.width, H = c.height, pad = 16;
    const n = track.n, X = track.X, Z = track.Z;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { const x = -X[i], z = -Z[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const sc = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (z1 - z0 || 1));
    const ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
    const P = (x, z) => [ox + (-x - x0) * sc, oz + (-z - z0) * sc];
    const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    const g = bg.getContext('2d');
    g.lineJoin = g.lineCap = 'round';
    const path = () => { g.beginPath(); for (let i = 0; i <= n; i += 2) { const [a, b] = P(X[i % n], Z[i % n]); i ? g.lineTo(a, b) : g.moveTo(a, b); } g.closePath(); };
    const gapAt = i => track.FLAG && (track.FLAG[i] & 1);
    path(); g.strokeStyle = 'rgba(8,12,30,.75)'; g.lineWidth = 15; g.stroke();
    path(); g.strokeStyle = '#fff6e0'; g.lineWidth = 8; g.stroke();
    // gaps (jumps over water/void) in blue
    g.strokeStyle = '#4ec5f1'; g.lineWidth = 8;
    for (let i = 0; i < n; i++) if (gapAt(i)) { const [a, b] = P(X[i], Z[i]); const [c2, d2] = P(X[(i + 1) % n], Z[(i + 1) % n]); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke(); }
    // start line: a chequered tick across the road
    const f = track.frameAt(0), [sx, sz] = P(f.x, f.z), [lx, lz] = P(f.x + f.lx * 9, f.z + f.lz * 9);
    g.strokeStyle = '#111'; g.lineWidth = 5; g.beginPath(); g.moveTo(sx - (lx - sx), sz - (lz - sz)); g.lineTo(lx, lz); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
    mapCache = { bg, P, track };
  }
  function drawMap(race, t) {
    const c = el.map, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(mapCache.bg, 0, 0);
    const mine = meOf(race), hum = [];
    if (race.ghostPos) {   // Time Trial ghost (menu.js)
      const [x, y] = mapCache.P(race.ghostPos.x, race.ghostPos.z);
      g.fillStyle = 'rgba(223,244,255,.75)'; g.strokeStyle = 'rgba(11,16,32,.6)'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill(); g.stroke();
    }
    for (const k of race.order.slice().reverse()) {
      if (k.isPlayer) { hum.push(k); continue; }
      const [x, y] = mapCache.P(k.pos.x, k.pos.z);
      g.fillStyle = racerColor(k.racerId); g.strokeStyle = '#0b1020'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill(); g.stroke();
    }
    // humans on top (2P: both, each ringed in their player colour; this HUD's own kart last)
    hum.sort((a, b) => (a === mine) - (b === mine));
    const multi = hum.length > 1;
    for (const me of hum) {
      const [x, y] = mapCache.P(me.pos.x, me.pos.z), r = 9 + Math.sin(t * 8) * 1.5;
      g.fillStyle = multi ? (me.pn ? 'rgba(78,197,241,.4)' : 'rgba(255,210,63,.4)') : 'rgba(255,210,63,.35)'; g.beginPath(); g.arc(x, y, r + 5, 0, 7); g.fill();
      g.fillStyle = racerColor(me.racerId); g.strokeStyle = multi ? PN_COL[me.pn] || '#fff' : '#fff'; g.lineWidth = 3.5;
      g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.stroke();
      // heading tick
      const hx2 = -Math.sin(me.yaw), hz2 = -Math.cos(me.yaw);
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + hx2 * 9, y + hz2 * 9); g.lineTo(x + hx2 * 16, y + hz2 * 16); g.stroke();
      if (multi) { g.font = '900 13px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = '#0b1020'; g.strokeText(me.pn + 1, x, y + 0.5); g.fillStyle = '#fff'; g.fillText(me.pn + 1, x, y + 0.5); }
    }
  }

  /* ---------------- per-race setup */
  function attach(race) {
    raceRef = race; prevK = null; wrongT = 0; lastRaceT = null;
    for (const k of warns.keys()) warns.delete(k);
    el.warn.className = 'hx-warn';
    el.lapList.innerHTML = ''; last.lapN = -1;
    root.querySelector('#hBest').textContent = race.bestTime ? 'BEST ' + clock(race.bestTime) : '';
    root.classList.toggle('solo', race.karts.length === 1);
    root.classList.toggle('mp', (race.humans?.length || 1) > 1);
    buildRanks(race);
    try { buildMap(race.track); el.map.hidden = false; } catch (e) { console.warn('[hud] minimap', e); el.map.hidden = true; mapCache = null; }
    if (!itemTried && createItemHud) { itemTried = true; try { itemHud = createItemHud(el.item); } catch (e) { console.warn('[hud] createItemHud failed', e); itemHud = null; } }
    // item events ({type:'item', e, kart, ...} from items.js) — collected every sim step so a
    // render frame that ran several steps doesn't drop any
    itemQ.length = 0;
    const sysKey = '_hudSys' + pn;   // one collector per HUD (2P: two HUDs on one race)
    if (race.addSystem && !race[sysKey]) { race[sysKey] = true; race.addSystem(r => { if (r !== raceRef) return; for (const e of r.events) if (e.type === 'item' && itemQ.length < 24) itemQ.push(e); }); }
  }
  const itemQ = [];
  function itemEvents(P) {
    for (const e of itemQ.splice(0)) {
      const me = e.kart === P, byMe = e.by === P;
      switch (e.e) {
        case 'remote': if (!me) api.event(e.text || 'KING DAD PRESSED PAUSE!', { cls: 'bad', ms: 2600, icon: 'assets/ui/item_remote.png' }); else api.event('EVERYONE ELSE PAUSED!', { cls: 'good', ms: 2200, icon: 'assets/ui/item_remote.png' }); break;
        case 'hit': if (byMe && !me) api.event('GOT \'EM!', { cls: 'good', ms: 1300 }); break;
        case 'super': if (me) api.event('SUPER STARS!', { cls: 'good', ms: 1800, icon: 'assets/ui/star.png' }); break;
        case 'super_star': if (me) api.event('SUPER STAR!', { cls: 'good', ms: 1800, icon: 'assets/ui/item_superstar.png' }); break;
        case 'blocked': if (me && e.why === 'shield') api.event('SHIELD SAVED YOU!', { cls: 'good', ms: 1300, icon: 'assets/ui/item_shield.png' }); break;
        case 'tnt_off': if (me && e.why === 'shaken') api.event('SHOOK IT OFF!', { cls: 'good', ms: 1300 }); break;
      }
    }
  }

  function turboFeedback(k) {
    if (!prevK) { prevK = { turbos: k.turbos, fizzleT: k.fizzleT, overheat: k.overheat, hitT: k.hitT }; return; }
    if (k.turbos > prevK.turbos && POPS[k.turbos]) api.pop(...POPS[k.turbos]);
    else if (k.overheat && !prevK.overheat) api.pop('OOPS!', 'oops');
    else if (k.fizzleT > 0 && prevK.fizzleT <= 0 && !k.overheat) api.pop('OOPS!', 'oops');
    prevK.turbos = k.turbos; prevK.fizzleT = k.fizzleT; prevK.overheat = k.overheat;
  }

  function wrongWay(k, race, dt) {
    let bad = false;
    if (!k.finished && !k.air && !(k.respawnT > 0) && race.phase === 'race' && Math.abs(k.speed) > 2) {
      const f = race.track.frameAt(k.s);
      let d = (k.speed >= 0 ? k.yaw : k.yaw + Math.PI) - f.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      bad = Math.abs(d) > (wrongT > 0 ? 1.6 : 2.0);
    }
    wrongT = bad ? wrongT + dt : Math.max(0, wrongT - dt * 3);
    return wrongT > 0.9;
  }

  const api = {
    menuOwnsResults: false, drainsUi: true, pn,
    show(on) { root.hidden = !on; if (!on) { api.warnClear(); } },
    update(v, race) {
      const now = performance.now(), dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
      if (race && race !== raceRef) attach(race);
      if (!itemHud && !itemTried && createItemHud && raceRef) attach(raceRef);
      set('lap', Math.min(v.lap, v.laps), x => { el.lap.textContent = x; el.lap.parentElement.classList.remove('bump'); void el.lap.offsetWidth; el.lap.parentElement.classList.add('bump'); });
      set('laps', v.laps, x => el.laps.textContent = '/' + x);
      set('place', v.place, p => {
        el.place.innerHTML = `<b>${p}</b><sup>${ordSuffix(p)}</sup>`; el.place.dataset.p = p;
        el.place.style.setProperty('--pc', PLACE_COL[p - 1] || PLACE_COL[7]);
        el.place.classList.remove('bump'); void el.place.offsetWidth; el.place.classList.add('bump');
      });
      set('time', clock(v.raceTime).slice(0, -1), x => el.time.textContent = x);
      set('stars', v.stars, x => { el.stars.textContent = x >= 10 ? '10' : x; el.starsBox.classList.toggle('super', x >= 10); el.starsBox.classList.remove('bump'); void el.starsBox.offsetWidth; el.starsBox.classList.add('bump'); });
      set('red', v.redStart, r => { el.red.style.left = (r * 100) + '%'; el.red.style.width = ((1 - r) * 100) + '%'; });
      el.charge.style.transform = `scaleX(${v.drift ? v.charge : 0})`;
      set('mstate', v.overheat ? 'hot' : v.inRed ? 'red' : v.drift ? 'on' : 'off', s => el.meter.dataset.s = s);
      set('pips', v.drift ? v.turbos : -1, n => { [...el.pips.children].forEach((u, i) => u.classList.toggle('on', i < n)); });
      el.boost.style.transform = `scaleX(${Math.min(1, (v.boostT || 0) / 3)})`;
      set('fin', !!v.finished, f => root.classList.toggle('fin', f));
      if (!race) return;
      const P = meOf(race);
      if (P) {
        set('lapN', P.lapTimes?.length || 0, n => {
          el.lapList.innerHTML = (P.lapTimes || []).map((t, i) => `<li${t === Math.min(...P.lapTimes) && n > 1 ? ' class="best"' : ''}><small>L${i + 1}</small> ${clock(t)}</li>`).join('');
        });
        turboFeedback(P);
        const simDt = Math.max(0, Math.min(0.25, race.t - (lastRaceT ?? race.t))); lastRaceT = race.t;   // sim time: correct under fast-forward/scripts
        set('wrong', wrongWay(P, race, simDt) || !!v.wrongWay, w => el.wrong.classList.toggle('on', w));
        itemEvents(P);
        api.warn('lock', P.lockedBy > 0 && !P.finished ? 'ROCKET! WATCH OUT!' : null);
        api.warn('tnt', P.tnt && !P.finished ? `HOP! HOP! HOP! ${Math.max(0, (P.tnt.need || 5) - (P.tnt.hops || 0))}` : null);
        if (itemHud) try { itemHud.update(P, dt, race); } catch (e) { if (!api._iw) { api._iw = 1; console.warn('[hud] itemHud.update threw', e); } }
      }
      updateRanks(race);
      if (mapCache) drawMap(race, now / 1000);
      if (race.ui && race.ui.length) {
        const q = api.drainsUi ? race.ui.splice(0, race.ui.length) : race.ui.slice();
        for (const u of q) {
          if (u.kart && u.kart !== P) continue;
          if (u.warn) api.warn(u.key || u.text, u.on === false ? null : u.text);
          else api.event(u.text, u);
        }
      }
    },
    count(n) {
      clearTimeout(countT);
      if (n == null) { el.count.className = 'hx-count'; return; }
      el.count.textContent = n; el.count.className = 'hx-count';
      void el.count.offsetWidth;
      el.count.className = 'hx-count on c' + (n === 'GO!' ? 'go' : n);
      if (n === 'GO!') countT = setTimeout(() => { el.count.className = 'hx-count'; }, 900);
    },
    banner(text, ms = 1500, cls = '') {
      if (!text) { el.banner.className = 'hx-banner'; clearTimeout(bannerT); return; }
      el.banner.textContent = text; el.banner.className = 'hx-banner';
      void el.banner.offsetWidth;
      el.banner.className = 'hx-banner on ' + cls;
      clearTimeout(bannerT); bannerT = setTimeout(() => { el.banner.className = 'hx-banner'; }, ms);
    },
    event(text, { ms = 1800, cls = 'item', icon = null } = {}) {
      if (!text) { el.event.className = 'hx-event'; return; }
      el.event.innerHTML = (icon ? `<img src="${icon}" alt="">` : '') + `<span></span>`;
      el.event.lastChild.textContent = text;
      el.event.className = 'hx-event';
      void el.event.offsetWidth;
      el.event.className = 'hx-event on ' + cls;
      clearTimeout(eventT); eventT = setTimeout(() => { el.event.className = 'hx-event'; }, ms);
    },
    warn(key, text) {
      if ((warns.get(key) || null) === (text || null)) return;
      if (text) warns.set(key, text); else warns.delete(key);
      const t = [...warns.values()].pop();
      if (t) { el.warn.textContent = t; el.warn.className = 'hx-warn on'; } else el.warn.className = 'hx-warn';
    },
    warnClear() { warns.clear(); el.warn.className = 'hx-warn'; el.wrong.classList.remove('on'); last.wrong = false; },
    pop(text, cls = '') {
      el.pop.textContent = text; el.pop.className = 'hx-pop';
      void el.pop.offsetWidth;
      el.pop.className = 'hx-pop on ' + cls;
      clearTimeout(popT); popT = setTimeout(() => { el.pop.className = 'hx-pop'; }, 900);
    },
    results(rows) {
      if (!rows || api.menuOwnsResults) { el.results.className = 'hx-results'; el.results.innerHTML = ''; if (!rows) return; }
      el.banner.className = 'hx-banner'; clearTimeout(bannerT);
      if (api.menuOwnsResults) return;
      el.results.innerHTML = `<h2>RESULTS</h2><ol>${rows.map(r => `<li class="${r.isPlayer ? 'me' : ''}"><span class="p">${ORD(r.place)}</span><span class="n">${r.name}</span><span class="t">${r.estimated ? '—' : clock(r.time)}</span></li>`).join('')}</ol><p class="again">Press Space / A to race again</p>`;
      el.results.className = 'hx-results on';
    },
  };
  ip.then(() => { if (raceRef && !itemTried && createItemHud) attach(raceRef); });
  return api;
}
