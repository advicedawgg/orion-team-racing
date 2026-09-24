// hud.js — minimal in-race HUD (core stub; the UI agent owns and replaces this file).
// Contract main.js relies on:  const hud = createHud(rootEl);  hud.update(view);  hud.show(bool);
//   hud.banner(text, ms, cls)  hud.results(rows|null)  hud.count(n|'GO!'|null)
// `view` = { lap, laps, place, speed, charge, redStart, inRed, drift, overheat, turbos, boostT, boostMaxT,
//            stars, finished, t, raceTime, wrongWay }
const ORD = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const clock = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };

export function createHud(root) {
  root.innerHTML = `
    <div class="h-lap"><small>LAP</small><b id="hLap">1/3</b></div>
    <div class="h-place" id="hPlace">1<sup>st</sup></div>
    <div class="h-time" id="hTime">0:00.00</div>
    <div class="h-stars" id="hStars">⭐ 0</div>
    <div class="h-speed"><b id="hSpd">0</b><small>km/h</small></div>
    <div class="h-meter" id="hMeter"><i id="hCharge"></i><span class="red" id="hRed"></span><div class="pips" id="hPips"><u></u><u></u><u></u></div></div>
    <div class="h-boost" id="hBoostWrap"><i id="hBoost"></i></div>
    <div class="h-count" id="hCount"></div>
    <div class="h-banner" id="hBanner"></div>
    <div class="h-results" id="hResults"></div>`;
  const $ = id => root.querySelector('#' + id);
  const el = { lap: $('hLap'), place: $('hPlace'), time: $('hTime'), stars: $('hStars'), spd: $('hSpd'), meter: $('hMeter'), charge: $('hCharge'), red: $('hRed'), pips: $('hPips'), boost: $('hBoost'), count: $('hCount'), banner: $('hBanner'), results: $('hResults') };
  let last = {}, bannerT = null;
  const set = (k, v, f) => { if (last[k] !== v) { last[k] = v; f(v); } };
  return {
    show(on) { root.hidden = !on; },
    update(v) {
      set('lap', `${Math.min(v.lap, v.laps)}/${v.laps}`, x => el.lap.textContent = x);
      set('place', v.place, p => { el.place.innerHTML = `${p}<sup>${ORD(p).slice(-2)}</sup>`; el.place.dataset.p = p; });
      set('time', clock(v.raceTime).slice(0, -1), x => el.time.textContent = x);
      set('stars', v.stars, x => el.stars.textContent = `⭐ ${x}`);
      set('spd', Math.round(Math.abs(v.speed) * 3.6), x => el.spd.textContent = x);
      set('red', v.redStart, r => { el.red.style.left = (r * 100) + '%'; el.red.style.width = ((1 - r) * 100) + '%'; });
      el.charge.style.transform = `scaleX(${v.drift ? v.charge : 0})`;
      set('mstate', v.overheat ? 'hot' : v.inRed ? 'red' : v.drift ? 'on' : 'off', s => el.meter.dataset.s = s);
      set('pips', v.drift ? v.turbos : -1, n => { [...el.pips.children].forEach((u, i) => u.classList.toggle('on', i < n)); });
      el.boost.style.transform = `scaleX(${Math.min(1, v.boostT / 3)})`;
    },
    count(n) {
      if (n == null) { el.count.className = 'h-count'; return; }
      el.count.textContent = n; el.count.className = 'h-count on' + (n === 'GO!' ? ' go' : '');
      void el.count.offsetWidth; el.count.classList.add('pop');
    },
    banner(text, ms = 1500, cls = '') {
      el.banner.textContent = text; el.banner.className = 'h-banner on ' + cls;
      clearTimeout(bannerT); bannerT = setTimeout(() => { el.banner.className = 'h-banner'; }, ms);
    },
    results(rows) {
      if (!rows) { el.results.className = 'h-results'; el.results.innerHTML = ''; return; }
      el.banner.className = 'h-banner'; clearTimeout(bannerT);
      el.results.innerHTML = `<h2>RESULTS</h2><ol>${rows.map(r => `<li class="${r.isPlayer ? 'me' : ''}"><span class="p">${ORD(r.place)}</span><span class="n">${r.name}</span><span class="t">${r.estimated ? '—' : clock(r.time)}</span></li>`).join('')}</ol><p class="again">Press ⤴ / Space / A to race again</p>`;
      el.results.className = 'h-results on';
    },
  };
}
