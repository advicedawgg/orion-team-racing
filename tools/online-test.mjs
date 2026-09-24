// node tools/online-test.mjs [--lag 100 --jitter 30 --loss 0.05] [--port 8975] [--out shots/online] [--skip-spectate] [--skip-reconnect]
//
// ONLINE end to end, measured: starts its OWN game server (PORT/UDP_PORT 8975/8976 by default — the dev
// server on 8955 is left alone; 1-lap races, short waits), 3 netbots (tools/netbot.mjs: 2 over WebRTC, 1
// over the WebSocket fallback) and ONE real browser (GPU headless Chrome, CDP :9333) on the hub dev
// server with ?server=…&netai=1 (the AI drives the browser's kart, through the network like a human's).
//   lobby list → racer select (taken racers) → 5th human refused → waiting room → race (remote humans on
//   screen; smoothness measured per rendered frame) → results → next race on the next track → pause →
//   leave mid-race (kart → bot) → rejoin → spectate (◀ ▶ cycles) → the next race as a racer → connection
//   drop → reconnect → leave → lobby back to idle, idle CPU. Server CPU per lobby measured from /proc.
// --lag/--jitter/--loss run the server's network simulator (both directions) for the bad-network check.
// Screenshots → shots/online/*.png (LOOK at them). Prints PASS/FAIL lines + ONLINE TEST: PASS|FAIL.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes('--' + k);
const PORT = +opt('port', 8975), UDP = PORT + 1;
const LAG = +opt('lag', 0), JIT = +opt('jitter', 0), LOSS = +opt('loss', 0);
const OUT = opt('out', LAG || LOSS ? 'shots/online/badnet' : 'shots/online');
const HUB = '192.168.15.78', SRV = `http://${HUB}:${PORT}`;
const BASE = process.env.BASE || `http://${HUB}:8960/`;
const root = new URL('..', import.meta.url).pathname;
let fails = 0;
const results = {};
const ok = (name, pass, info = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!pass) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const health = async () => (await fetch(SRV + '/health')).json();
const cpuTicks = pid => { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return +f[11] + +f[12]; };   // utime + stime (clock ticks, 100/s)
async function cpuOver(pid, secs) { const a = cpuTicks(pid), t = Date.now(); await sleep(secs * 1000); return (cpuTicks(pid) - a) / ((Date.now() - t) / 1000); }   // % of one core

/* ---------------------------------------------------------------- server */
await fs.mkdir(OUT, { recursive: true }); await fs.mkdir(root + '_scratch', { recursive: true });
const slog = await fs.open(root + `_scratch/online-test-server-${PORT}.log`, 'w');
const server = spawn('node', ['server/index.js'], { cwd: root, stdio: ['ignore', slog.fd, slog.fd],
  env: { ...process.env, PORT: String(PORT), UDP_PORT: String(UDP), LAPS: '1', WAIT_S: '8', RESULTS_S: '6', LOAD_S: '4', NET_LAG_MS: String(LAG), NET_JITTER_MS: String(JIT), NET_LOSS: String(LOSS) } });
const bots = [];
function netbot(name, extra = []) {
  const p = spawn('node', ['tools/netbot.mjs', '--server', `http://127.0.0.1:${PORT}`, '--name', name, '--json', ...extra], { cwd: root });
  const o = { name, p, out: '', json: null, code: null };
  p.stdout.on('data', d => { o.out += d; });
  p.stderr.on('data', d => { o.out += d; });
  o.done = new Promise(res => p.on('exit', c => { o.code = c; try { o.json = JSON.parse(o.out.trim().split('\n').filter(l => l.startsWith('{')).pop()); } catch { /* */ } res(o); }));
  bots.push(o); return o;
}
let browser = null, page = null;
const errs = [];
try {
  for (let i = 0; i < 40; i++) { try { await health(); break; } catch { await sleep(250); } }
  const h0 = await health();
  ok('server up (own port, netsim as asked)', h0.ok && h0.udpPort === UDP, `:${PORT}/udp ${UDP} lag ${h0.netSim.lag}±${h0.netSim.jitter} ms loss ${h0.netSim.loss}`);

  // an old client (another PROTOCOL_VERSION) is turned away with the "please refresh" code
  { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); const got = await new Promise(res => { ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 999 })); ws.onmessage = e => res(JSON.parse(e.data)); setTimeout(() => res(null), 3000); }); ws.close();
    ok('protocol version mismatch → "please refresh"', got?.t === 'err' && got.code === 'version', JSON.stringify(got)); }

  /* ---------------------------------------------------------------- 3 netbots join MEDIUM */
  const nb1 = netbot('nb1', ['--lobby', 'medium', '--racer', 'kingdad', '--force', '--races', '3', '--secs', '420']);
  await sleep(400);
  const nb2 = netbot('nb2', ['--lobby', 'medium', '--racer', 'kingdad', '--force', '--net', 'ws', '--races', '3', '--secs', '420', '--skill', 'hard']);
  const nb3 = netbot('nb3', ['--lobby', 'medium', '--racer', 'grumblin', '--races', '3', '--secs', '420', '--skill', 'easy']);
  for (let i = 0; i < 40; i++) { const h = await health(); if (h.lobbies.find(l => l.id === 'medium').humans.filter(Boolean).length >= 3) break; await sleep(250); }

  /* ---------------------------------------------------------------- browser */
  browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
  const ctx = browser.contexts()[0] || await browser.newContext();
  page = await ctx.newPage();
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  const shot = async n => { await fs.writeFile(`${OUT}/${n}.png`, await page.screenshot({ animations: 'allow' })); console.log('      shot', `${OUT}/${n}.png`); };
  const ev = (fn, a) => page.evaluate(fn, a);
  const waitFor = (fn, ms = 30000, a) => page.waitForFunction(fn, a, { timeout: ms, polling: 100 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}index.html?screen=online&server=${encodeURIComponent(SRV)}&netai=1`, { waitUntil: 'load', timeout: 60000 });
  await waitFor(() => window.__OTR?.ready && __OTR.online?.O?.net && __OTR.menu.screen === 'online', 30000);
  await waitFor(() => document.querySelectorAll('.lobby[data-id="medium"] .slot.p').length >= 3, 10000);
  await sleep(600); await shot('1-lobbies');
  const kind = await ev(() => __OTR.online.O.net.kind);
  ok('lobby list live: MEDIUM shows the 3 netbots', true, `browser transport ${kind}`);
  results.browserTransport = kind;

  // join with the keyboard: → (MEDIUM) then Enter
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await waitFor(() => __OTR.menu.screen === 'onselect', 10000);
  await sleep(900);
  const taken = await ev(() => [...document.querySelectorAll('.rtile.taken')].map(b => b.dataset.id).sort());
  await shot('2-select-taken');
  ok('racer select: the 3 other humans\' racers are taken', taken.length === 3 && taken.includes('kingdad') && taken.includes('grumblin'), taken.join(','));
  await ev(() => __OTR.online.pick('kingdad'));
  await sleep(500);
  ok('picking a taken racer does nothing', await ev(() => __OTR.menu.screen === 'onselect' && !__OTR.online.O.want));
  // pick the focused (free) racer with Enter
  await page.keyboard.press('Enter');
  await waitFor(() => __OTR.menu.screen === 'onwait' || __OTR.state === 'countdown' || __OTR.menu.screen === 'loading', 10000);
  const myRacer = await ev(() => __OTR.online.O.want);
  await sleep(300);
  if (await ev(() => __OTR.menu.screen === 'onwait')) await shot('3-waiting');

  // 5th human: refused
  const nb5 = netbot('nb5', ['--lobby', 'medium', '--secs', '20']);
  await nb5.done;
  ok('5th human refused ("lobby full")', nb5.code === 3 && nb5.json?.errors?.includes('full'), `exit ${nb5.code} errors ${JSON.stringify(nb5.json?.errors)}`);

  /* ---------------------------------------------------------------- race 1 */
  await waitFor(() => __OTR.state === 'countdown' || __OTR.state === 'race', 40000);
  const r1 = await ev(() => ({ track: __OTR.track.id, slot: __OTR.online.nr.slot, grid: __OTR.race.karts.map(k => k.racerId + (k.netHuman ? '*' : '')) }));
  ok('race 1 starts with 4 humans + 4 bots', r1.grid.filter(x => x.endsWith('*')).length === 4 && r1.slot >= 0, `${r1.track}: ${r1.grid.join(' ')}`);
  await waitFor(() => __OTR.state === 'race' && __OTR.race.t > 3, 30000);
  // CPU: 4 humans + 4 bots racing
  results.cpuRace4 = +(await cpuOver(server.pid, 8)).toFixed(2);
  const hr = await health();
  results.stepMs4 = hr.lobbies.find(l => l.id === 'medium').stepMsAvg;
  results.snapBytes = hr.lobbies.find(l => l.id === 'medium').snapBytesAvg;
  // smoothness of remote humans vs bots, per rendered frame (the interpolated visual position)
  // smoothness, per RENDERED frame: how far each kart's drawn position strays from the time-weighted midpoint
  // of its neighbours (cm). Uniform motion = 0; a snapshot hitch or a correction shows up as a spike. My own
  // locally-simulated kart is the baseline.
  const smooth = await ev(async () => {
    const G = __OTR.G, race = __OTR.race, me = __OTR.online.nr.me;
    const idx = race.karts.map(k => k.index);
    const tr = Object.fromEntries(idx.map(i => [i, []])), dr = Object.fromEntries(idx.map(i => [i, 0]));
    await new Promise(res => { let n = 0; const f = ts => { for (const i of idx) { const v = G.visuals[i], k = race.karts[i]; tr[i].push([v.ix, v.iz, ts, k.respawnT > 0 || k.hitT > 0]); if (k.drift) dr[i]++; } if (++n < 300) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const out = {};
    for (const i of idx) {
      const p = tr[i], r = [], sp = [];
      for (let j = 1; j < p.length - 1; j++) {
        const [a, b, c] = [p[j - 1], p[j], p[j + 1]];
        if (a[3] || b[3] || c[3] || c[2] - a[2] <= 0) continue;
        const u = (b[2] - a[2]) / (c[2] - a[2]);
        r.push(Math.hypot(b[0] - (a[0] + (c[0] - a[0]) * u), b[1] - (a[1] + (c[1] - a[1]) * u)) * 100);
        sp.push(Math.hypot(c[0] - a[0], c[1] - a[1]) / ((c[2] - a[2]) / 1000));
      }
      r.sort((x, y) => x - y);
      out[i] = { human: !!race.karts[i].netHuman && race.karts[i] !== me, me: race.karts[i] === me, racer: race.karts[i].racerId, meanV: +(sp.reduce((x, y) => x + y, 0) / Math.max(1, sp.length)).toFixed(1),
        cmP50: +r[r.length >> 1].toFixed(2), cmP95: +r[Math.floor(r.length * 0.95)].toFixed(2), cmMax: +r[r.length - 1].toFixed(1), driftFrames: dr[i] };
    }
    const nr = __OTR.online.nr, dts = tr[0].slice(1).map((x, j) => x[2] - tr[0][j][2]).sort((x, y) => x - y);
    return { karts: out, snap: nr.snapInfo(), extrap: +(nr.stats.extrap / nr.stats.steps).toFixed(3), starved: nr.stats.starved, frameMs: { p50: dts[dts.length >> 1], p95: dts[Math.floor(dts.length * 0.95)] } };
  });
  const K = Object.values(smooth.karts), hum = K.filter(k => k.human), botsK = K.filter(k => !k.human && !k.me), mine = K.find(k => k.me);
  const worst = a => Math.max(...a.map(k => k.cmP95));
  results.smooth = { humans: hum, bots: botsK, me: mine, snap: smooth.snap, extrap: smooth.extrap, starved: smooth.starved, frameMs: smooth.frameMs };
  // (before the netcode fixes: 6–18 cm p95 on the LAN; a kart covers ~37 cm per frame at 22 m/s)
  ok('remote humans move smoothly (drawn-position jitter p95 < 4 cm/frame, max < 20 cm)', hum.length === 3 && hum.every(k => k.cmP95 < 4 && k.cmMax < 20 && k.meanV > 5),
    `humans p95 ${hum.map(k => `${k.racer} ${k.cmP95} cm (max ${k.cmMax}, ${k.meanV} m/s, drift ${k.driftFrames}f)`).join(' · ')} | bots worst p95 ${worst(botsK)} cm | my kart p95 ${mine?.cmP95} cm | snapshots ${smooth.snap.hz.toFixed(1)} Hz gap p95 ${smooth.snap.p95?.toFixed(0)} ms, extrapolating ${(smooth.extrap * 100).toFixed(1)} % | frame p50 ${smooth.frameMs.p50?.toFixed(1)} ms`);
  // a screenshot with another human on screen (and ideally sliding)
  let caught = false;
  for (let i = 0; i < 200 && !caught; i++) {
    const hit = await ev(() => {
      const cam = __OTR.camera, race = __OTR.race, me = __OTR.online.nr?.me;
      if (!race || !me || race.phase !== 'race' || me.finished) return 'over';
      const fx = Math.sin(__OTR.chase.yaw), fz = Math.cos(__OTR.chase.yaw);
      let best = null;
      for (const k of race.karts) {
        if (!k.netHuman || k === me) continue;
        const v = __OTR.G.visuals[k.index]; const dx = v.ix - cam.position.x, dz = v.iz - cam.position.z, d = Math.hypot(dx, dz);
        if (d > 4 && d < 20 && (dx * fx + dz * fz) / d > 0.8 && v.root.visible) best = { racer: k.racerId, d: +d.toFixed(1), drift: k.drift, lean: +k.driftAngle.toFixed(2) };
      }
      return best;
    });
    if (hit === 'over') break;
    if (hit && (hit.drift || i > 100)) { caught = true; await shot('4-race-remote-human'); console.log('      remote human on screen:', JSON.stringify(hit)); results.remoteShot = hit; }
    else await sleep(250);
  }
  if (!caught && await ev(() => !!__OTR.race)) await shot('4-race-remote-human');
  if (caught) ok('an online race screenshot with another human on screen', true, JSON.stringify(results.remoteShot));
  else console.log('WARN  no other human came within 20 m in front of the camera for 50 s — no remote-human screenshot this run');
  if (await ev(() => __OTR.state === 'race')) await shot('4b-race');

  /* ---------------------------------------------------------------- results + the next race */
  await waitFor(() => __OTR.menu.screen === 'results', 150000);
  results.browserItems = await ev(() => { const nr = __OTR.online.nr, W = __OTR.race.items; return { events: nr.stats.events, eventsLate: nr.stats.eventsLate, hitsOnMe: nr.stats.hitsOnMe, place: nr.me.finishPlace, hazards: W.hazards.length }; });
  await sleep(1800); await shot('5-results');
  const rrows = await ev(() => ({ me: document.querySelectorAll('#resList li.me').length, others: document.querySelectorAll('#resList li.mpn').length, btns: [...document.querySelectorAll('.scr-results [data-act]')].map(b => b.dataset.act), focus: document.querySelector('.scr-results .focus')?.dataset.act }));
  ok('results: me + the 3 other humans highlighted, NEXT RACE (focused) + LEAVE', rrows.me === 1 && rrows.others === 3 && rrows.btns.includes('leave') && rrows.focus === 'stay', JSON.stringify(rrows));
  await waitFor(() => __OTR.state === 'countdown' && __OTR.track.id !== undefined && __OTR.online.nr?.start?.raceSeq > 1, 60000);
  const t2 = await ev(() => __OTR.track.id);
  ok('the next race starts by itself on the next track in the rotation', t2 !== r1.track, `${r1.track} → ${t2}`);

  /* ---------------------------------------------------------------- pause, leave mid-race, rejoin → spectate */
  if (!flag('skip-spectate')) {
    await waitFor(() => __OTR.state === 'race' && __OTR.race.t > 4, 30000);
    await page.keyboard.press('Escape');
    await waitFor(() => __OTR.menu.screen === 'onpause', 5000);
    const t0 = await ev(() => __OTR.race.t); await sleep(1000); const t1 = await ev(() => __OTR.race.t);
    await shot('6-pause');
    ok('online pause: the race keeps running underneath', t1 - t0 > 0.8, `race.t +${(t1 - t0).toFixed(2)} s in 1 s`);
    await ev(() => { const b = document.querySelector('[data-act="leave"]'); b.click(); });
    await waitFor(() => __OTR.menu.screen === 'online' && !__OTR.race, 10000);
    await sleep(700);
    const lh = await health(), ml = lh.lobbies.find(l => l.id === 'medium');
    ok('leaving mid-race: back on the lobby list, the lobby carries on with 3', ml.count === 3 && ml.phase === 'racing', `${ml.phase} ${ml.count} humans`);
    // rejoin: pick a racer → the race in progress is spectated
    await ev(() => __OTR.online.join('medium'));
    await waitFor(() => __OTR.menu.screen === 'onselect', 10000);
    await sleep(500); await page.keyboard.press('Enter');
    await waitFor(() => __OTR.online.nr?.spectating && (__OTR.state === 'race' || __OTR.state === 'countdown'), 20000);
    await sleep(2500);
    await shot('7-spectate');
    const f0 = await ev(() => __OTR.online.nr.followIdx);
    await page.keyboard.press('ArrowRight'); await sleep(1500);
    const f1 = await ev(() => __OTR.online.nr.followIdx);
    await shot('7b-spectate-next');
    ok('mid-race joiner spectates, ◀ ▶ switches the kart watched', f1 !== f0, `watching ${f0} → ${f1}`);
    await waitFor(() => __OTR.online.nr && !__OTR.online.nr.spectating && __OTR.state === 'countdown', 150000);
    ok('…and races in the next race', await ev(() => __OTR.online.nr.slot >= 0), await ev(() => `slot ${__OTR.online.nr.slot} on ${__OTR.track.id}`));
  }

  /* ---------------------------------------------------------------- connection drop → reconnect */
  if (!flag('skip-reconnect')) {
    await waitFor(() => __OTR.state === 'race' && __OTR.race.t > 3, 40000);
    await ev(() => { const n = __OTR.online.O.net; try { n.rtc?.close(); } catch { /* */ } try { n.ws?.close(); } catch { /* */ } n.closedNow(); });
    await waitFor(() => __OTR.menu.screen === 'online' && !__OTR.race, 10000);
    await sleep(400);
    await shot('8-dropped');
    const msg = await ev(() => document.querySelector('#onMsg')?.textContent || '');
    ok('a dropped connection lands on the lobby list with a friendly message', /lost the connection/i.test(msg), msg);
    await waitFor(() => __OTR.online.O.net && __OTR.online.O.status === 'online', 15000);
    await ev(() => __OTR.online.join('medium'));
    await waitFor(() => __OTR.menu.screen === 'onselect', 10000);
    await page.keyboard.press('Enter');
    await waitFor(() => __OTR.online.nr && (__OTR.state === 'race' || __OTR.state === 'countdown'), 30000);
    ok('reconnect + rejoin works', true, await ev(() => `${__OTR.online.nr.spectating ? 'spectating' : 'racing'} on ${__OTR.track.id} via ${__OTR.online.O.net.kind}`));
  }

  /* ---------------------------------------------------------------- everyone leaves → idle */
  await ev(() => { __OTR.online.leave(); });
  await sleep(300);
  await ev(() => document.querySelector('.scr-online .backbtn')?.click());
  const bres = await Promise.all([nb1.done, nb2.done, nb3.done]);
  for (const b of bres) {
    const j = b.json || {};
    results['bot_' + b.name] = { transport: j.transport, racer: j.racer, rtt: j.rtt, races: (j.races || []).map(r => ({ track: r.track, place: r.place, spec: r.spectator, hz: r.snaps?.hz?.toFixed(1), p95: r.snaps?.p95?.toFixed(0), extrap: r.extrapFrac, hits: r.hitsOnMe, uses: r.uses })), errors: j.errors };
  }
  ok('netbots: WebRTC + WebSocket clients raced 3 races each at ~20 Hz', bres.every(b => b.code === 0 && (b.json?.races || []).filter(r => !r.spectator).length === 3 && b.json.races.every(r => r.snaps.hz > 17)),
    bres.map(b => `${b.name} ${b.json?.transport} ${(b.json?.races || []).map(r => `${r.track}:${r.place}`).join(',')}`).join(' | '));
  { const all = bres.flatMap(b => b.json?.races || []), hits = all.reduce((a, r) => a + (r.hitsOnMe || 0), 0), uses = all.reduce((a, r) => a + (r.uses || 0), 0), late = all.reduce((a, r) => a + (r.eventsLate || 0), 0);
    results.items = { netbotHitsOnThem: hits, netbotItemsUsed: uses, netbotEventsLate: late, browser: results.browserItems };
    ok('items resolve: humans get hit (applied on their own kart) and fire items (server-side)', hits > 0 && uses > 0 && (results.browserItems?.events || 0) > 0,
      `${all.length} netbot races: ${hits} hits on them, ${uses} items used, ${late} events released late; browser race 1: ${JSON.stringify(results.browserItems)}`); }
  { const [j1, j2] = ['nb1', 'nb2'].map(n => bres.find(b => b.name === n).json || {});   // both asked for kingdad: whoever came second was refused
    ok('racer-taken on the server: two humans asking for King Dad → one refused, gets another racer', (j1.errors?.includes('taken') ^ j2.errors?.includes('taken')) && j1.racer !== j2.racer && [j1.racer, j2.racer].includes('kingdad'), `nb1 ${j1.racer} ${JSON.stringify(j1.errors)} · nb2 ${j2.racer} ${JSON.stringify(j2.errors)}`); }
  await sleep(1500);
  const hEnd = await health(), mEnd = hEnd.lobbies.find(l => l.id === 'medium');
  ok('last human leaves → the lobby resets to idle', mEnd.phase === 'idle' && mEnd.count === 0, `${mEnd.phase}, resets ${mEnd.resets}, races ${mEnd.races}`);
  results.cpuIdle = +(await cpuOver(server.pid, 5)).toFixed(2);
  ok('idle server CPU ~0', results.cpuIdle < 1, `${results.cpuIdle} % of a core over 5 s`);

  /* ---------------------------------------------------------------- 3 humans + 5 bots: server cost per lobby */
  const cb = [0, 1, 2].map(i => netbot('cpu' + i, ['--lobby', 'easy', '--races', '1', '--secs', '200', ...(i === 1 ? ['--net', 'ws'] : [])]));
  for (let i = 0; i < 80; i++) { const h = await health(); const e = h.lobbies.find(l => l.id === 'easy'); if (e.phase === 'racing') break; await sleep(500); }
  await sleep(5000);
  results.cpuRace3 = +(await cpuOver(server.pid, 10)).toFixed(2);
  const he = await health();
  results.stepMs3 = he.lobbies.find(l => l.id === 'easy').stepMsAvg;
  ok('server CPU with 3 humans + 5 bots racing', results.cpuRace3 < 25, `${results.cpuRace3} % of one core (lobby step ${results.stepMs3} ms per 60 Hz step)`);
  await Promise.all(cb.map(b => b.done));
} catch (e) {
  ok('test ran to the end', false, e.message.split('\n')[0]);
  try { await fs.writeFile(`${OUT}/error.png`, await page.screenshot()); } catch { /* */ }
} finally {
  if (errs.length) { console.log('page errors:'); console.log(errs.slice(0, 15).join('\n')); }
  ok('no page errors', !errs.filter(e => !/KHR_parallel_shader_compile/.test(e)).length);
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  for (const b of bots) try { b.p.kill(); } catch { /* */ }
  server.kill();
  console.log('RESULTS ' + JSON.stringify(results));
  console.log(fails ? `\nONLINE TEST: FAIL (${fails})` : '\nONLINE TEST: PASS');
  setTimeout(() => process.exit(fails ? 1 : 0), 300);
}
