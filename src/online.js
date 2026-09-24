// online.js — ONLINE mode in the browser: the lobby list, racer select (racers other humans have are
// taken), the waiting room, spectating, the online pause/results, the connection bar, and the main.js
// hooks (G.net) that turn a normal race into a network race through src/netgame.js.
// DESIGN.md "Online" is the contract. menu.js loads this lazily (menu → ONLINE) and hands it its screen
// framework (menuKit), so a failure here can never break the offline game.
//
// Flow: ONLINE → lobby list (EASY / MEDIUM / HARD, live) → join → pick a racer → waiting room (or
// spectate the race in progress) → START → loading → race → results (the next race starts by itself)
// → … ; LEAVE is on every screen; Esc / Start / ❚❚ opens the online pause (the race can't stop).
// URL: ?server=<url> (see net.js serverUrl), ?net=ws|rtc (force a transport), ?netai=1 (the AI drives
// your kart — tests), ?screen=online.
import * as THREE from 'three';
import { connectNet, serverUrl } from './net.js';
import { NetRace } from './netgame.js';
import { MSG, NET, LOBBIES, ERR_TEXT, BIN, binType, ROTATION } from './protocol.js';
import { portraitURL, racerName, racerColor, racersReady } from './hud.js';
import * as S from './save.js';

let K = null, api = null, G = null;
const Q = new URLSearchParams(location.search);
const O = {
  net: null, connecting: null, status: 'off', cid: null, lobbies: [], lobby: null, lobbySeq: -1, lobbyId: null,
  start: null, nr: null, markers: [], err: null, toast: null, toastT: 0, want: null, retryT: 0, bar: null, spec: null,
};
const $ = (el, q) => el.querySelector(q);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TRACK_NAME = { beach: 'Bubbly Beach', ice: 'Ice Cream Peaks', volcano: 'Taco Volcano', castle: "King Dad's Castle", star: 'Star Road' };
const trackName = id => K?.trackDef?.(id)?.name || TRACK_NAME[id] || id;

export function init(kit) {
  K = kit; api = kit.api; G = api.G;
  makeBar();
  if (window.__OTR) window.__OTR.online = { O, get nr() { return O.nr; }, leave, showLobbies, join, pick: pickRacer, follow: d => follow(d) };
}
export const spectating = () => !!O.nr?.spectating;

/* ================================================================== connection */
async function ensureNet() {
  if (O.net && !O.net.closed) return O.net;
  if (O.connecting) return O.connecting;
  O.status = 'connecting'; paintBar();
  O.connecting = (async () => {
    const net = await connectNet(serverUrl(), { prefer: Q.get('net') || 'auto' });
    wire(net);
    const welcome = new Promise((res, rej) => { const off = net.on(MSG.WELCOME, m => { off(); res(m); }); setTimeout(() => rej(new Error('no welcome')), 6000); });
    net.hello();
    await welcome;
    O.net = net; O.status = 'online'; O.err = null; paintBar();
    return net;
  })().catch(e => { O.status = O.err === 'version' ? 'old' : 'offline'; paintBar(); throw e; }).finally(() => { O.connecting = null; });
  return O.connecting;
}
function wire(net) {
  net.on(MSG.WELCOME, m => { O.cid = m.id; O.lobbies = m.lobbies || []; paintLobbies(); });
  net.on(MSG.LOBBIES, m => { O.lobbies = m.list || []; paintLobbies(); });
  net.on(MSG.LOBBY, m => {
    if (m.seq <= O.lobbySeq && O.lobby?.id === m.lobby.id) return;
    O.lobbySeq = m.seq; O.lobby = m.lobby; O.lobbyId = m.lobby.id;
    onLobby();
  });
  net.on(MSG.START, m => onStart(m));
  net.on(MSG.EV, m => O.nr?.onEvents(m));
  net.on(MSG.ERR, m => onErr(m.code));
  net.onRaw(buf => { if (O.nr && binType(buf) === BIN.SNAP) O.nr.onSnapshot(buf); });
  net.onClose(() => {
    if (O.net !== net && O.net) return;
    if (O.status === 'old') { O.net = null; paintBar(); return; }   // the server hangs up after "please refresh": keep that message
    O.net = null; O.status = 'offline'; paintBar();
    const wasOnline = !!O.lobbyId || !!G.net;
    O.lobby = null; O.lobbyId = null; O.lobbySeq = -1;
    if (wasOnline || isOnlineScreen()) { teardownRace(); showLobbies('Oops! We lost the connection. Pick a lobby to jump back in!'); }
  });
}
function onErr(code) {
  O.err = code;
  if (code === 'version') { O.status = 'old'; paintBar(); showLobbies(ERR_TEXT.version, true); return; }
  if (code === 'taken') { toast(ERR_TEXT.taken); O.want = null; if (K.cur?.name === 'onselect') showPick(); return; }
  if (code === 'full' || code === 'nolobby') { O.lobbyId = null; O.lobby = null; showLobbies(ERR_TEXT[code]); return; }
  toast(ERR_TEXT[code] || 'Something went wrong — try again!');
}
const isOnlineScreen = () => ['online', 'onselect', 'onwait', 'onpause'].includes(K.cur?.name);
const meIn = (L = O.lobby) => L?.members?.find(m => m.cid === O.cid) || null;

/* ================================================================== lobby list */
export function showLobbies(msg = null, fatal = false) {
  teardownRace();
  O.lobbyId = null; O.lobby = null; O.lobbySeq = -1; O.want = null; O.start = null;
  const card = d => `<button class="lobby" data-nav data-act="join" data-id="${d.id}" data-key="l-${d.id}">
      <div class="lface">${K.FACE[d.diff]}</div><div class="lname">${K.DIFF_LABEL[d.diff] || d.name}</div>
      <div class="lslots">${[0, 1, 2, 3].map(() => '<i class="slot"></i>').join('')}</div>
      <div class="lstate">…</div></button>`;
  const el = K.mount('online', `
    <div class="shead"><h2>ONLINE</h2><small>RACE OTHER PLAYERS! · UP TO 4 PER LOBBY · BOTS FILL THE REST</small></div>
    <div class="lobbies">${LOBBIES.map(card).join('')}</div>
    <div class="onmsg${msg ? ' on' : ''}${fatal ? ' fatal' : ''}" id="onMsg">${esc(msg || '')}</div>
    <div class="res-btns"><button class="mbtn sm" data-nav data-act="retry" data-key="retry" id="onRetry" hidden>TRY AGAIN</button>${fatal ? '<button class="mbtn" data-nav data-act="reload" data-key="reload">REFRESH ▶</button>' : ''}</div>
    <button class="backbtn" data-nav data-act="back" data-key="back">◀ BACK</button>`, {
    cls: 'bg-dark', music: 'title', focus: '[data-key="l-easy"]',
    acts: {
      join(t) { if (t.classList.contains('locked')) return; join(t.dataset.id); },
      retry() { connectAndPaint(true); },
      reload() { location.reload(); },
      back() { K.cur.back(); },
    },
    back() { disconnect(); K.showMenu('online'); },
    tick(dt) { O.retryT -= dt; if (!O.net && !O.connecting && O.retryT <= 0 && O.status !== 'old') connectAndPaint(false); },
  });
  paintLobbies();
  if (!fatal) connectAndPaint(false);
  return el;
}
function connectAndPaint(manual) {
  O.retryT = 4;
  if (O.status === 'old') return;
  ensureNet().then(() => {
    O.net.send({ t: MSG.LOBBIES });
    const m = $(document, '#onMsg'); if (m && /can't reach|closed/i.test(m.textContent)) { m.textContent = ''; m.classList.remove('on'); }
    paintLobbies();
  }).catch(() => {
    const m = $(document, '#onMsg');
    if (m && K.cur?.name === 'online') { m.textContent = "The online track is closed right now — we can't reach it. Try again soon!"; m.classList.add('on'); const r = $(document, '#onRetry'); if (r) r.hidden = false; }
    if (manual) K.sfx('menu_back');
    paintLobbies();
  });
}
function lobbyLine(L) {
  if (!L) return O.status === 'online' ? '…' : O.status === 'connecting' ? 'CONNECTING…' : 'OFFLINE';
  if (L.full) return 'FULL!';
  switch (L.phase) {
    case 'idle': return 'EMPTY — BE THE FIRST!';
    case 'waiting': return L.left != null ? `STARTING IN ${L.left}` : 'WAITING FOR RACERS';
    case 'starting': return `STARTING · ${esc(trackName(L.track))}`;
    case 'racing': return `RACING · LAP ${Math.max(1, L.lap)}/${L.laps} · ${esc(trackName(L.track))}`;
    case 'results': return 'RESULTS · NEXT RACE SOON';
  }
  return '';
}
function paintLobbies() {
  if (K.cur?.name !== 'online') return;
  const el = K.cur.el;
  for (const d of LOBBIES) {
    const b = $(el, `[data-id="${d.id}"]`); if (!b) continue;
    const L = O.lobbies.find(x => x.id === d.id);
    b.classList.toggle('locked', !L || !!L.full || O.status !== 'online');
    b.classList.toggle('busy', !!L && L.count > 0);
    $(b, '.lstate').innerHTML = lobbyLine(L);
    const slots = b.querySelectorAll('.slot');
    slots.forEach((s, i) => {
      const h = L?.humans?.[i];
      const key = h === undefined ? '' : h === null ? '?' : h;
      if (s.dataset.k === key) return;
      s.dataset.k = key;
      s.className = 'slot' + (h === undefined ? '' : h === null ? ' q' : ' p');
      s.innerHTML = h ? `<img src="${portraitURL(h, 64)}" alt="">` : h === null ? '?' : '';
    });
  }
}

/* ================================================================== join + racer select */
async function join(id) {
  try { await ensureNet(); } catch { connectAndPaint(true); return; }
  O.lobbySeq = -1; O.want = null; O.start = null;
  O.net.send({ t: MSG.JOIN, lobby: id });
  O.joining = id;
}
function onLobby() {
  const L = O.lobby, me = meIn();
  if (!me) return;
  if (O.joining === L.id) { O.joining = null; showPick(); return; }
  const scr = K.cur?.name;
  if (scr === 'onselect') { paintPick(); if (me.racer && O.want === me.racer) afterPick(); }
  else if (scr === 'onwait') paintWait();
}
function takenBy(id) { return O.lobby?.members?.find(m => m.racer === id && m.cid !== O.cid) || null; }
function showPick() {
  const list = K.racers();
  const L = O.lobby, dl = K.DIFF_LABEL[L?.diff] || '';
  const want = [S.get().lastRacer, ...list.map(r => r.id)].find(id => id && list.some(r => r.id === id) && !takenBy(id));
  let shown = want, el = null;
  el = K.mount('onselect', `
    <div class="shead"><h2>CHOOSE YOUR RACER!</h2><small>ONLINE · ${K.FACE[L?.diff] || ''} ${dl} · RACERS WITH A <b class="pbadge pbn sm">P</b> ARE TAKEN</small></div>
    <div class="sgrid">${list.map(r => `
      <button class="rtile" data-nav data-act="pick" data-id="${r.id}" data-key="${r.id}" style="--rc:${racerColor(r.id)}">
        <img src="${portraitURL(r.id, 128)}" alt=""><span>${esc(r.name)}</span></button>`).join('')}
    </div>
    <div class="spanel">
      <div class="stage-slot" id="selStage"></div>
      <div class="sinfo"><h3 id="sName"></h3><p id="sBlurb"></p><div class="stats" id="sStats"></div></div>
      <button class="gobtn" data-nav data-act="go" data-key="go">GO! ▶</button>
    </div>
    <button class="backbtn" data-nav data-act="back" data-key="back">◀ LEAVE</button>`, {
    cls: 'bg-dark', music: 'title', focus: `[data-key="${want}"]`,
    onShow(el) {
      K.stage.mount(el.querySelector('#selStage'));
      racersReady.then(() => el.querySelectorAll('.rtile img').forEach((img, i) => { img.src = portraitURL(list[i].id, 128); }));
      setTimeout(() => K.vo('vo_choose'), 250);
    },
    onFocus(t, byMouse) { if (t.dataset.id && !byMouse) preview(t.dataset.id); },   // mouse hover never changes the pick (lead's fix in menu.js)
    acts: {
      pick(t) { if (t.classList.contains('taken')) return; preview(t.dataset.id); choose(t.dataset.id); },
      go() { choose(shown); },
      back() { K.cur.back(); },
    },
    back() { leave(); },
  });
  paintPick();
  preview(want, true);
  function preview(id, force) {
    if (!el || !id || (id === shown && !force) || takenBy(id)) return;
    shown = id;
    const r = list.find(x => x.id === id) || list[0];
    $(el, '#sName').textContent = r.name; $(el, '#sName').style.color = racerColor(id);
    $(el, '#sBlurb').textContent = r.blurb || '';
    $(el, '#sStats').innerHTML = K.statBars(r.stats || { speed: 3, accel: 3, turn: 3 });
    el.querySelectorAll('.rtile').forEach(b => b.classList.toggle('sel', b.dataset.id === id));
    K.stage.one(id);
  }
  function choose(id) {
    if (!id || takenBy(id) || O.want) return;
    O.want = id;
    const d = S.get(); d.lastRacer = id; S.save();
    K.stage.cheer();
    try { api.audio.bark?.(id, 'win', { force: true }); } catch { /* */ }
    el.classList.add('chosen');
    O.net?.send({ t: MSG.PICK, racer: id });
  }
}
function paintPick() {
  if (K.cur?.name !== 'onselect') return;
  for (const b of K.cur.el.querySelectorAll('.rtile')) {
    const t = takenBy(b.dataset.id);
    b.classList.toggle('taken', !!t); b.classList.toggle('locked', !!t);
    const has = b.querySelector('.pbadge');
    if (t && !has) b.insertAdjacentHTML('beforeend', '<b class="pbadge pbn">P</b>'); else if (!t && has) has.remove();
  }
}
function pickRacer(id) { const b = K.cur?.el?.querySelector(`.rtile[data-id="${id}"]`); if (b) K.cur.acts.pick(b); }
function afterPick() {
  const L = O.lobby;
  setTimeout(() => {
    if (K.cur?.name !== 'onselect') return;
    if (O.start && O.start.you < 0 && ['starting', 'racing'].includes(L?.phase)) launchRace(O.start);   // a race is on: watch it
    else showWait();
  }, 700);
}

/* ================================================================== waiting room */
function showWait() {
  const L = O.lobby;
  K.mount('onwait', `
    <div class="shead"><h2>GET READY!</h2><small>ONLINE · ${K.FACE[L?.diff] || ''} ${K.DIFF_LABEL[L?.diff] || ''}</small></div>
    <div class="wbig" id="wBig">WAITING FOR RACERS…</div>
    <div class="wplayers" id="wPlayers"></div>
    <div class="wnext" id="wNext"></div>
    <div class="res-btns"><button class="mbtn big" data-nav data-act="ready" data-key="ready">▶ I'M READY!</button><button class="mbtn sm" data-nav data-act="leave" data-key="leave">LEAVE</button></div>`, {
    cls: 'bg-dark', music: 'title', focus: '[data-key="ready"]',
    acts: { ready() { K.sfx('star'); const b = $(document, '#wBig'); if (b) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } }, leave() { leave(); } },
    back() { leave(); },
    tick() { paintWaitClock(); },
  });
  paintWait();
}
function paintWait() {
  if (K.cur?.name !== 'onwait') return;
  const L = O.lobby, el = K.cur.el; if (!L) return;
  const ms = L.members.slice().sort((a, b) => a.order - b.order);
  const cards = [0, 1, 2, 3].map(i => {
    const m = ms[i];
    if (!m) return `<div class="wp empty"><i class="slot"></i><span>BOT</span></div>`;
    const mine = m.cid === O.cid;
    return `<div class="wp${mine ? ' me' : ''}">${m.racer ? `<img src="${portraitURL(m.racer, 128)}" alt="">` : '<i class="slot q">?</i>'}
      <span>${m.racer ? esc(racerName(m.racer)) : 'CHOOSING…'}</span>${mine ? '<b class="pbadge">YOU</b>' : '<b class="pbadge pbn">P</b>'}</div>`;
  }).join('');
  const w = $(el, '#wPlayers'); if (w.dataset.sig !== cards) { w.dataset.sig = cards; w.innerHTML = cards; }
  const nt = L.next;
  const nx = $(el, '#wNext'), sig = String(nt) + L.phase;
  if (nx.dataset.sig !== sig) { nx.dataset.sig = sig; nx.innerHTML = `<small>${L.phase === 'waiting' ? 'FIRST TRACK' : 'NEXT TRACK'}</small>${K.trackCard(K.trackDef(nt) || { id: nt, name: trackName(nt), theme: nt }, { small: true }).replace('data-nav', '')}`; }
  paintWaitClock();
}
function paintWaitClock() {
  const L = O.lobby, b = $(document, '#wBig'); if (!b || !L) return;
  const left = L.phaseEnd && O.net ? Math.max(0, Math.ceil((L.phaseEnd - O.net.serverNow()) / 1000)) : null;
  const txt = L.phase === 'waiting' ? (left != null ? `RACE STARTS IN <b>${left}</b>` : 'WAITING FOR RACERS…')
    : L.phase === 'results' ? `NEXT RACE IN <b>${left ?? '…'}</b>` : 'RACE STARTING!';
  if (b.dataset.t !== txt) { b.dataset.t = txt; b.innerHTML = txt; }
}

/* ================================================================== races */
function onStart(m) {
  O.start = m;
  const me = meIn();
  if (m.you >= 0) { launchRace(m); return; }
  // a spectator START: the race in progress when we joined — watch it once we've picked a racer
  if (me?.racer && ['onwait'].includes(K.cur?.name)) launchRace(m);
}
function pickFollow(m) { return m.humans?.[0]?.slot ?? 0; }
async function launchRace(m) {
  const nr = new NetRace({ start: m, clock: O.net, onUse: ({ back }) => O.net?.send({ t: MSG.USE, raceSeq: m.raceSeq, back }) });
  O.nr = nr;
  const s = S.settings();
  const slot = m.you >= 0 ? m.you : pickFollow(m);
  K.M.mode = 'online'; K.M.players = 1; K.M.track = m.track;
  const t = K.trackDef(m.track);
  K.mount('loading', `<div class="load">
      <div class="lcard">${t ? K.trackCard(t).replace('data-nav', '') : ''}</div>
      <div class="lget">${m.you >= 0 ? 'GET READY!' : 'WATCH THIS RACE — YOU\'RE IN THE NEXT ONE!'}</div><div class="dots"><i></i><i></i><i></i></div></div>`, { cls: 'bg-dark', music: undefined });
  Object.assign(G, {
    difficulty: m.diff, racerId: m.grid[slot], laps: m.laps, seed: m.seed, solo: false, noItems: false, players: 1,
    autoAccel: s.autoAccel === 'on' || (s.autoAccel === 'easy' && m.diff === 'easy'), easyBoost: s.kidAssist ? true : undefined,
    netGrid: { ids: m.grid.slice(), slot }, net: ctl,
  });
  if (!api.Q.has('hd')) G.hd = !!s.hd;
  await new Promise(r => setTimeout(r, 30));
  try {
    if (G.race) api.endRace();
    if (!G.track || G.track.id !== m.track) await api.loadTrack(m.track);
    G.trackId = m.track;
    if (O.nr !== nr) return;                   // superseded (left / another START) while loading
    await api.startRace();
    if (O.nr !== nr) return;
    if (G.race.phase === 'race') api.setState('race');
    paintBar();
  } catch (e) {
    console.error('[online] could not start the race', e);
    leave();
  }
}
/** main.js hooks while an online race is up (G.net) */
const ctl = {
  setup(race) {
    const nr = O.nr; if (!nr) return;
    nr.attach(race);
    if (Q.get('netai') === '1' && nr.me) race.autoPlayer = true;   // tests: the AI drives my kart (it still goes through the network)
    addMarkers(race);
  },
  preStep(race) { if (O.nr?.race === race) O.nr.preStep(); },
  postStep(race) {
    const nr = O.nr; if (!nr || nr.race !== race) return;
    nr.postStep();
    if (nr.me && race.stepN % 2 === 0) O.net?.sendRaw(nr.statePacket());
  },
  frame(dt) {
    const nr = O.nr, race = G.race;
    if (race && nr?.race === race) {
      G.acc = nr.correctClock(G.acc);
      if (nr.spectating && !nr.autoFollowed && nr.newest && race.order[0]) { nr.autoFollowed = true; follow(race.order[0].index - nr.followIdx, true); }   // start on the leader
      if (nr.spectating && !K.cur) { if (api.In.hit('left')) follow(-1); else if (api.In.hit('right')) follow(1); }
      for (const mk of O.markers) mk.s.visible = !!mk.k.netHuman;
    }
    paintBar(dt);
  },
};
function follow(d, quiet = false) {
  const nr = O.nr; if (!nr?.spectating || !G.race) return;
  const k = nr.follow(nr.followIdx + d);
  window.__OTR?.chase?.snap(k);
  document.querySelectorAll('#hud .hx-rank').forEach((r, i) => r.classList.toggle('me', i === k.index));
  if (!quiet) K.sfx('menu_move');
  paintBar();
}
/** a floating "P" over every other human's kart (one sprite each, parented to the kart's visual) */
let markerTex = null;
function addMarkers(race) {
  O.markers = [];
  if (!markerTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#4ec5f1'; g.strokeStyle = '#fff'; g.lineWidth = 10;
    g.beginPath(); g.moveTo(64, 120); g.lineTo(40, 88); g.arc(64, 56, 42, Math.PI * 0.8, Math.PI * 2.2); g.closePath(); g.fill(); g.stroke();
    g.font = '900 64px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 8; g.strokeStyle = '#0b1020';
    g.strokeText('P', 64, 60); g.fillStyle = '#fff'; g.fillText('P', 64, 60);
    markerTex = new THREE.CanvasTexture(c); markerTex.colorSpace = THREE.SRGBColorSpace;
  }
  for (const k of race.karts) {
    if (!k.netHuman || k === O.nr?.me) continue;
    const v = G.visuals[k.index]; if (!v?.root) continue;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, depthWrite: false, transparent: true }));
    s.scale.set(0.95, 0.95, 1); s.position.set(0, 2.55, 0); s.renderOrder = 6; s.name = 'netmarker';
    v.root.add(s);
    O.markers.push({ s, k });
  }
}
function teardownRace() {
  O.nr = null;
  if (G && (G.net || G.netGrid)) {
    for (const mk of O.markers) { mk.s.parent?.remove(mk.s); mk.s.material.dispose(); }
    O.markers = [];
    G.net = null; G.netGrid = null; G.laps = undefined; G.seed = 1;
    if (G.race) api.endRace();
    if (K.M.mode === 'online') K.M.mode = 'quick';
  }
  paintBar();
}
export function leave() {
  if (O.net && O.lobbyId) O.net.send({ t: MSG.LEAVE });
  showLobbies();
}
function disconnect() {
  teardownRace();
  const n = O.net; O.net = null; O.status = 'off';
  if (n) { n.onClose(() => {}); n.close(); }
  paintBar();
}

/* ================================================================== online pause + results */
export function openPause() {
  const spec = spectating();
  K.mount('onpause', `
    <div class="ppanel"><h2>${spec ? 'WATCHING' : 'ONLINE RACE'}</h2>
      <p class="pnote">The race keeps going — online races can't pause!</p>
      <button class="mbtn big" data-nav data-act="resume" data-key="resume">▶ ${spec ? 'KEEP WATCHING' : 'KEEP RACING'}</button>
      <button class="mbtn" data-nav data-act="settings" data-key="settings">SETTINGS</button>
      <button class="mbtn" data-nav data-act="leave" data-key="leave">LEAVE ONLINE RACE</button>
    </div>`, {
    cls: 'res', overlay: true, focus: '[data-key="resume"]', wrap: true,
    onAction(a) { if (a === 'pause') { close(); return true; } return false; },
    acts: { resume() { close(); }, settings() { K.showSettings(); }, leave() { leave(); } },
    back() { close(); },
  });
  function close() { K.unmount(); K.sfx('menu_back'); }
}
export function resultButtons() {
  return `<div class="netnext" id="netNext">NEXT RACE SOON…</div>
    <button class="mbtn big" data-nav data-act="stay" data-key="stay">▶ NEXT RACE!</button>
    <button class="mbtn sm" data-nav data-act="leave" data-key="leave">LEAVE</button>`;
}

/* ================================================================== connection bar + spectate strip */
function makeBar() {
  O.bar = document.createElement('div'); O.bar.id = 'netbar'; O.bar.hidden = true;
  O.bar.innerHTML = '<i class="dot"></i><b></b><span></span>';
  O.spec = document.createElement('div'); O.spec.id = 'netspec'; O.spec.hidden = true;
  O.spec.innerHTML = `<button class="nsb" data-d="-1">◀</button><div class="nsw"><small>WATCHING</small><img alt=""><b></b></div><button class="nsb" data-d="1">▶</button><em>YOU'RE IN THE NEXT RACE!</em>`;
  O.spec.addEventListener('pointerdown', e => { const b = e.target.closest('.nsb'); if (b) { e.preventDefault(); follow(+b.dataset.d); } });
  document.body.append(O.bar, O.spec);
}
let barT = 0;
function paintBar(dt = 1) {
  if (!O.bar) return;
  barT -= dt;
  const inRace = !!G?.net && !!G.race;
  const show = !!O.net || O.status === 'connecting' || inRace || isOnlineScreen() || K?.cur?.name === 'online';
  O.bar.hidden = !show;
  const spec = inRace && spectating() && !K.cur;
  O.spec.hidden = !spec;
  if (spec) {
    const k = G.race.player, key = k?.racerId;
    if (O.spec.dataset.k !== key) { O.spec.dataset.k = key; $(O.spec, 'img').src = portraitURL(key, 64); $(O.spec, 'b').textContent = racerName(key) + (k.netHuman ? ' (P)' : ''); }
  }
  const nn = $(document, '#netNext');
  if (nn && O.lobby && O.net) {
    const L = O.lobby, left = L.phaseEnd ? Math.max(0, Math.ceil((L.phaseEnd - O.net.serverNow()) / 1000)) : null;
    const txt = L.phase === 'results' && left != null ? `NEXT RACE IN <b>${left + NET.LOAD_S}</b>` : L.phase === 'starting' ? 'HERE WE GO!' : 'NEXT RACE SOON…';
    if (nn.dataset.t !== txt) { nn.dataset.t = txt; nn.innerHTML = txt; }
  }
  if (!show || barT > 0) return;
  barT = 0.5;
  const n = O.net;
  const cls = n ? 'ok' : O.status === 'connecting' ? 'wait' : 'bad';
  const label = n ? 'ONLINE' : O.status === 'connecting' ? 'CONNECTING' : O.status === 'old' ? 'PLEASE REFRESH' : 'OFFLINE';
  const detail = n ? `${Math.round(n.rtt)} ms${n.kind === 'ws' ? ' · ws' : ''}` : '';
  O.bar.className = cls + (inRace ? ' race' : '');
  $(O.bar, 'b').textContent = label; $(O.bar, 'span').textContent = detail;
}
function toast(text) {
  const m = $(document, '#onMsg');
  if (m) { m.textContent = text; m.classList.add('on'); }
  else { try { api.hud.event(text, { cls: 'bad', ms: 2200 }); } catch { /* */ } }
}
