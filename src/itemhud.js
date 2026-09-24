// itemhud.js — the item slot widget (items agent). hud.js (UI agent) owns the layout: it creates
// this inside its `.hx-item` box and calls update(player, dt, race) every frame.
//
//   const ih = createItemHud(container);  ih.update(kart, dt, race);  ih.dispose();
//
// Shows: the item slot (icon from assets/ui/item_<id>.png, canvas fallback), the ~1.5 s roulette
// (icons whizz by and slow down), a ×3 badge for triple rockets, a SUPER ribbon at 10 stars
// (TNT turns into the Nitro icon), "BOOM!" while your taco bomb rolls (press again to set it off),
// "FIRE!" while a bubble shield is armed (+ a timer ring), a red flashing lock-on warning when a
// rocket / warp star homes on you, and the TNT-on-your-head countdown with 5 hop pips (beside the
// slot; hud.js shows the big "HOP! HOP!" / "ROCKET!" warnings from the same kart fields).
// The star counter itself lives in hud.js. No emoji (they don't render in the headless Chrome).
const IDS = ['taco_bomb', 'rocket', 'tnt', 'icecream', 'shield', 'turbo', 'superstar', 'remote', 'warp'];
const LABEL = { taco_bomb: 'TACO', rocket: 'ROCKET', tnt: 'TNT', nitro: 'NITRO', icecream: 'SPLAT', shield: 'BUBBLE', turbo: 'TURBO', superstar: 'STAR', remote: 'PAUSE', warp: 'WARP' };
const COLOR = { taco_bomb: '#f2b43c', rocket: '#7b4bd6', tnt: '#d0342c', nitro: '#2fbf4a', icecream: '#ff7eb6', shield: '#4ec5f1', turbo: '#ff8a1f', superstar: '#ffd23f', remote: '#2b3a8f', warp: '#9a7bff' };

const CSS = `
.ih{position:relative;width:min(13vmin,112px);height:min(13vmin,112px);font:900 clamp(11px,2.2vmin,20px)/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;pointer-events:none}
.ih-slot{position:absolute;inset:0;border-radius:22%;background:radial-gradient(circle at 50% 38%,rgba(40,52,110,.92),rgba(10,14,34,.92) 70%);
  box-shadow:0 0 0 .22em #ffd23f,0 0 0 .38em rgba(11,16,32,.75),0 .35em .6em rgba(0,0,0,.45);overflow:visible;transition:box-shadow .2s}
.ih.empty .ih-slot{box-shadow:0 0 0 .22em rgba(255,255,255,.35),0 0 0 .38em rgba(11,16,32,.55);background:rgba(10,14,34,.55)}
.ih.empty .ih-slot::after{content:"";position:absolute;inset:30%;border-radius:50%;border:.18em dashed rgba(255,255,255,.25)}
.ih img.ih-icon{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;filter:drop-shadow(0 .12em .1em rgba(0,0,0,.5));transform:scale(1);transition:transform .12s}
.ih.spin img.ih-icon{filter:blur(.6px) drop-shadow(0 .12em .1em rgba(0,0,0,.5));transform:scale(.88)}
.ih.got img.ih-icon{animation:ihpop .42s cubic-bezier(.2,1.9,.4,1)}
@keyframes ihpop{0%{transform:scale(.3) rotate(-25deg)}100%{transform:scale(1) rotate(0)}}
.ih.dim img.ih-icon{opacity:.55}
.ih-n{position:absolute;right:-.35em;bottom:-.35em;min-width:1.7em;padding:.25em .35em;border-radius:1em;background:#ff5d73;box-shadow:0 0 0 .14em #fff;font-size:1.05em;text-align:center;display:none}
.ih.multi .ih-n{display:block}
.ih-sup{position:absolute;left:50%;top:-.9em;transform:translateX(-50%) rotate(-4deg);padding:.2em .45em;border-radius:.4em;font-style:normal;font-size:.8em;letter-spacing:.06em;
  background:linear-gradient(90deg,#ff5d73,#ffd23f,#7ed957,#4ec5f1,#b54dff);box-shadow:0 0 0 .12em #fff,0 0 .7em rgba(255,210,63,.9);display:none;white-space:nowrap;text-shadow:0 .08em 0 rgba(0,0,0,.45)}
.ih.super .ih-sup{display:block;animation:ihsup 1s ease-in-out infinite}
@keyframes ihsup{50%{transform:translateX(-50%) rotate(4deg) scale(1.08)}}
.ih-hint{position:absolute;left:50%;bottom:-1.25em;transform:translateX(-50%);font-style:normal;font-size:.95em;color:#ffd23f;white-space:nowrap;
  -webkit-text-stroke:.05em #5a2a00;text-shadow:0 .1em 0 rgba(0,0,0,.6);display:none;animation:ihpulse .5s ease-in-out infinite}
.ih.hint .ih-hint{display:block}
@keyframes ihpulse{50%{transform:translateX(-50%) scale(1.15)}}
.ih-ring{position:absolute;inset:-.3em;border-radius:26%;display:none;
  background:conic-gradient(#8fe3ff calc(var(--p,1)*360deg),rgba(255,255,255,.08) 0);-webkit-mask:radial-gradient(closest-side,transparent 86%,#000 87%);mask:radial-gradient(closest-side,transparent 86%,#000 87%)}
.ih.timer .ih-ring{display:block}
.ih-lock{position:absolute;left:calc(100% + .6em);top:6%;height:88%;aspect-ratio:1;border-radius:50%;display:none;place-items:center;
  background:radial-gradient(circle,#ff3b3b 0 45%,#8a0000 70%);box-shadow:0 0 0 .18em #fff,0 0 1em #ff2a2a}
.ih.lock .ih-lock{display:grid;animation:ihlock var(--lr,.5s) steps(2,jump-none) infinite}
.ih-lock img{width:78%;height:78%;object-fit:contain;transform:rotate(-45deg)}
.ih-lock b{position:absolute;right:-.25em;top:-.35em;font-size:1.5em;color:#fff;-webkit-text-stroke:.06em #8a0000}
@keyframes ihlock{0%{opacity:1;transform:scale(1.08)}100%{opacity:.35;transform:scale(.92)}}
.ih-tnt{position:absolute;left:calc(100% + .7em);top:0;height:100%;display:none;flex-direction:column;align-items:center;justify-content:center;gap:.35em;white-space:nowrap}
.ih.tnt.lock .ih-lock{left:calc(100% + 4.6em)}
.ih.tnt .ih-tnt{display:flex}
.ih-tnt b{display:grid;place-items:center;width:1.9em;height:1.9em;border-radius:50%;font-size:1.9em;line-height:1;color:#fff;background:radial-gradient(circle,#ffb02e,#d0342c 75%);box-shadow:0 0 0 .1em #fff,0 .12em .3em rgba(0,0,0,.5);-webkit-text-stroke:.04em #5a0a00}
.ih-tnt b.hot{background:radial-gradient(circle,#ff5a3a,#8a0000 75%);animation:ihhot .3s ease-in-out infinite}
@keyframes ihhot{50%{transform:scale(1.15)}}
.ih-tnt .pips{display:flex;gap:.28em}
.ih-tnt .pips u{width:.85em;height:.85em;border-radius:50%;background:rgba(255,255,255,.25);box-shadow:0 0 0 .1em rgba(0,0,0,.4)}
.ih-tnt .pips u.on{background:#7ed957;box-shadow:0 0 0 .1em #fff,0 0 .5em #7ed957}
`;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('ih-style')) return;
  const s = document.createElement('style'); s.id = 'ih-style'; s.textContent = CSS; document.head.appendChild(s);
}

/** Canvas fallback icon (coloured badge + word) if an art PNG is missing. */
const fallbacks = new Map();
function fallbackIcon(id) {
  if (fallbacks.has(id)) return fallbacks.get(id);
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = COLOR[id] || '#888'; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
  const t = LABEL[id] || id.toUpperCase();
  g.font = `900 ${t.length > 5 ? 22 : 28}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(t, 64, 66); g.fillStyle = '#fff'; g.fillText(t, 64, 66);
  const url = c.toDataURL(); fallbacks.set(id, url); return url;
}
const icons = new Map();          // id -> url (art or fallback)
function iconURL(id) {
  if (icons.has(id)) return icons.get(id);
  const url = new URL(`../assets/ui/item_${id}.png`, import.meta.url).href;
  icons.set(id, url);
  const im = new Image();
  im.onerror = () => icons.set(id, fallbackIcon(id));
  im.src = url;
  return url;
}

export function createItemHud(container) {
  injectCss();
  const el = document.createElement('div');
  el.className = 'ih empty';
  el.innerHTML = `<div class="ih-ring"></div><div class="ih-slot"><img class="ih-icon" alt="" hidden></div><b class="ih-n"></b><i class="ih-sup">SUPER</i><em class="ih-hint"></em>
    <div class="ih-lock"><img alt=""><b>!</b></div>
    <div class="ih-tnt"><b>3</b><div class="pips"><u></u><u></u><u></u><u></u><u></u></div></div>`;
  container.appendChild(el);
  const $ = s => el.querySelector(s);
  const img = $('.ih-icon'), n = $('.ih-n'), hint = $('.ih-hint'), ring = $('.ih-ring'), lockImg = $('.ih-lock img');
  const tntN = $('.ih-tnt b'), pips = [...el.querySelectorAll('.ih-tnt .pips u')];
  for (const id of [...IDS, 'nitro']) iconURL(id);            // preload
  img.onerror = () => { const id = img.dataset.id; if (id) { icons.set(id, fallbackIcon(id)); img.src = icons.get(id); } };
  lockImg.src = iconURL('rocket');

  let shown = null, spinT = 0, spinI = 0, lastItem = null, gotT = 0;
  const cls = {};
  const setCls = (c, on) => { if (cls[c] !== on) { cls[c] = on; el.classList.toggle(c, on); } };
  const setIcon = id => { if (shown === id) return; shown = id; if (!id) { img.hidden = true; return; } img.hidden = false; img.dataset.id = id; img.src = iconURL(id); };
  let lastText = {};
  const text = (node, key, v) => { if (lastText[key] !== v) { lastText[key] = v; node.textContent = v; } };

  return {
    el,
    update(k, dt = 1 / 60) {
      if (!k) return;
      const sup = k.stars >= 10;
      // ---- the slot
      let id = null, hintText = '', multi = false, timer = 0, dim = false;
      if (k.roulT > 0) {
        spinT -= dt;
        const prog = 1 - k.roulT / (k.roulDur || 1.5);
        if (spinT <= 0) { spinI = (spinI + 1 + (Math.random() * 3 | 0)) % IDS.length; spinT = 0.05 + 0.2 * prog * prog; }
        id = IDS[spinI];
      } else if (k.item) {
        id = k.item === 'tnt' && sup ? 'nitro' : k.item;
        multi = k.itemCount > 1;
      } else if (k.bomb && k.bomb.alive) { id = 'taco_bomb'; hintText = 'BOOM!'; dim = true; }
      else if (k.shieldT > 0 && k.shieldArmed) { id = 'shield'; hintText = 'FIRE!'; timer = k.shieldT / 15; dim = true; }
      else if (k.invincT > 0) { id = 'superstar'; timer = k.invincT / 10; dim = true; }
      setIcon(id);
      setCls('empty', !id);
      setCls('spin', k.roulT > 0);
      if (k.item && k.item !== lastItem && !(k.roulT > 0)) { gotT = 0.45; el.classList.remove('got'); void el.offsetWidth; }
      lastItem = k.roulT > 0 ? null : k.item;
      gotT = Math.max(0, gotT - dt); setCls('got', gotT > 0);
      setCls('multi', multi); if (multi) text(n, 'n', '×' + k.itemCount);
      setCls('super', sup && !!k.item && !(k.roulT > 0));
      setCls('hint', !!hintText); if (hintText) text(hint, 'hint', hintText);
      setCls('timer', timer > 0); if (timer > 0) ring.style.setProperty('--p', Math.min(1, timer).toFixed(3));
      setCls('dim', dim);
      // ---- lock-on warning
      const lk = k.lockedBy > 0 && !k.finished;
      setCls('lock', lk);
      if (lk) el.style.setProperty('--lr', (isFinite(k.lockDist) ? Math.max(0.14, Math.min(0.6, k.lockDist / 120)) : 0.5).toFixed(2) + 's');
      // ---- TNT on your head
      setCls('tnt', !!k.tnt);
      if (k.tnt) {
        const c = Math.max(1, Math.ceil(k.tnt.t));
        text(tntN, 'tnt', String(c));
        tntN.classList.toggle('hot', c <= 1);
        pips.forEach((u, i) => u.classList.toggle('on', i < k.tnt.hops));
      }
    },
    dispose() { el.remove(); },
  };
}
export default createItemHud;
