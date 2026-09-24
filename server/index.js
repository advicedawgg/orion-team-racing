// index.js — the Orion Team Racing game server. `node server/index.js` (or server/Dockerfile).
//
// One HTTP port (default 8955) carries: GET /health, GET /lobbies, the geckos.io WebRTC signalling
// (/.wrtc/v2/*) and the WebSocket fallback (/ws). WebRTC data flows over ONE UDP port (default 8956,
// ICE mux) — prod: the HTTP port sits behind the Cloudflare tunnel, the UDP port is forwarded on the
// router. See server/README.md for env vars and the ops checklist.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import geckos from '@geckos.io/server';
import { Lobby } from './lobby.js';
import { wrapGeckos, wrapWs, netSim } from './transport.js';
import { PROTOCOL_VERSION, LOBBIES, MSG, NET, DEFAULT_PORTS, rosterFromSource, binType, BIN, asBytes } from '../src/protocol.js';

const env = process.env;
const PORT = +(env.PORT || DEFAULT_PORTS.http);
const UDP_PORT = +(env.UDP_PORT || DEFAULT_PORTS.udp);
const PUBLIC_IP = env.PUBLIC_IP || '';
const STUN = (env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean);
const NO_RTC = env.NO_RTC === '1';
const QUIET = env.QUIET === '1';
/** Browser origins allowed to talk to us (CORS for the signalling POSTs, Origin check on /ws). */
const ORIGINS = (env.ALLOWED_ORIGINS || 'https://orion3.advicedawg.com,https://orion.advicedawg.com,http://192.168.15.78:8960')
  .split(',').map(s => s.trim()).filter(Boolean);
const originOk = o => !o || o === 'null' ? true : ORIGINS.includes('*') || ORIGINS.includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
const log = (...a) => { if (!QUIET) console.log(new Date().toISOString().slice(11, 19), ...a); };

const roster = rosterFromSource(readFileSync(new URL('../src/racers.js', import.meta.url), 'utf8'));
const laps = env.LAPS ? +env.LAPS : undefined;       // tests: LAPS=1
const timing = {};
for (const k of ['WAIT_S', 'WAIT_FULL_S', 'LOAD_S', 'RESULTS_S']) if (env[k]) timing[k] = +env[k];
const lobbies = new Map(LOBBIES.map(d => [d.id, new Lobby(d, { roster, log, timing, laps })]));
const clients = new Map();                         // cid → { conn, lobby, hello }
let cidN = 0;
const t0 = Date.now();

/* ------------------------------------------------------------------ one connection, either transport */
function attach(conn) {
  const cid = 'c' + (++cidN).toString(36);
  const c = { cid, conn, lobby: null, hello: false };
  clients.set(cid, c);
  const lob = () => c.lobby && lobbies.get(c.lobby);
  const err = (code) => conn.send({ t: MSG.ERR, code }, true);
  conn.onMsg(m => {
    if (!m || typeof m !== 'object') return;
    if (m.t === MSG.PING) { conn.send({ t: MSG.PONG, ct: m.ct, st: Date.now() }, false); return; }
    if (m.t === MSG.HELLO) {
      if (m.v !== PROTOCOL_VERSION) { err('version'); setTimeout(() => conn.close(), 1500); return; }
      c.hello = true;
      conn.send({ t: MSG.WELCOME, v: PROTOCOL_VERSION, id: cid, st: Date.now(), kind: conn.kind, lobbies: [...lobbies.values()].map(l => l.info()) }, true);
      return;
    }
    if (!c.hello) return;
    switch (m.t) {
      case MSG.LOBBIES: conn.send({ t: MSG.LOBBIES, list: [...lobbies.values()].map(l => l.info()) }, true); break;
      case MSG.JOIN: {
        const L = lobbies.get(String(m.lobby));
        if (!L) { err('nolobby'); break; }
        if (c.lobby && c.lobby !== L.id) { lob()?.leave(cid); c.lobby = null; }
        const r = L.join(cid, conn);
        if (r !== 'ok') err(r); else c.lobby = L.id;
        break;
      }
      case MSG.PICK: { const r = lob()?.pick(cid, String(m.racer)); if (r && r !== 'ok') err(r); break; }
      case MSG.LEAVE: lob()?.leave(cid); c.lobby = null; conn.send({ t: MSG.LOBBIES, list: [...lobbies.values()].map(l => l.info()) }, true); break;
      case MSG.USE: lob()?.onUse(cid, m); break;
    }
  });
  conn.onRaw(buf => {
    const b = asBytes(buf);
    if (binType(b) === BIN.STATE) lob()?.onState(cid, b);
  });
  conn.onClose(() => { lob()?.leave(cid, 'disconnected'); clients.delete(cid); log(`${cid} closed (${conn.kind})`); });
  log(`${cid} connected via ${conn.kind}`);
}

/* ------------------------------------------------------------------ HTTP */
const server = http.createServer((req, res) => {
  const o = req.headers.origin;
  if (o && originOk(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }); res.end(); return; }
  if (url === '/health') {
    const L = [...lobbies.values()];
    const body = { ok: true, v: PROTOCOL_VERSION, uptime: Math.round((Date.now() - t0) / 1000), clients: clients.size,
      transports: { rtc: [...clients.values()].filter(c => c.conn.kind === 'rtc').length, ws: [...clients.values()].filter(c => c.conn.kind === 'ws').length },
      udpPort: NO_RTC ? null : UDP_PORT, netSim,
      lobbies: L.map(l => ({ ...l.info(), races: l.stats.races, resets: l.stats.resets, stepMsAvg: l.stats.lastTickMs.length ? +(l.stats.lastTickMs.reduce((a, b) => a + b, 0) / l.stats.lastTickMs.length).toFixed(3) : null,
        snapBytesAvg: l.stats.snaps ? Math.round(l.stats.snapBytes / l.stats.snaps) : null })) };
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); return;
  }
  if (url === '/lobbies') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify([...lobbies.values()].map(l => l.info()))); return; }
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Orion Team Racing game server. Play at https://orion3.advicedawg.com\n'); return; }
  res.writeHead(404); res.end();
});

/* ------------------------------------------------------------------ WebSocket fallback */
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
  if (!originOk(req.headers.origin)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => attach(wrapWs(ws, Math.random().toString(36).slice(2, 8))));
});

/* ------------------------------------------------------------------ WebRTC (geckos.io, ICE mux on ONE udp port) */
if (!NO_RTC) {
  const io = geckos({
    iceServers: STUN.map(urls => ({ urls })),
    portRange: { min: UDP_PORT, max: UDP_PORT },
    multiplex: true,
    ordered: false,
    cors: { origin: req => { const o = req.headers.origin; return o && originOk(o) ? o : ORIGINS[0]; }, allowAuthorization: false },
  });
  io.addServer(server);
  io.onConnection(ch => attach(wrapGeckos(ch)));
  if (PUBLIC_IP) patchPublicIp(io, PUBLIC_IP);
}

/** Advertise a public IP as an extra srflx candidate for every host candidate (NAT without working STUN).
 *  Straight from DAWG ARENA's server/index.ts. */
function patchPublicIp(g, ip) {
  const cm = g.connectionsManager;
  const orig = cm.createConnection.bind(cm);
  const rewrite = cand => {
    const m = cand.match(/^(a=)?candidate:(\S+) (\d+) (\S+) (\d+) (\d+\.\d+\.\d+\.\d+) (\d+) typ host(.*)$/);
    if (!m) return null;
    const [, pre = '', found, comp, proto, prio, addr, port, rest] = m;
    if (addr === ip) return null;
    return `${pre}candidate:${found}pub ${comp} ${proto} ${Number(prio) - 1} ${ip} ${port} typ srflx raddr ${addr} rport ${port}${rest}`;
  };
  cm.createConnection = async (...args) => {
    const res = await orig(...args);
    const id = res?.connection?.id;
    if (!id) return res;
    const ld = res.connection.localDescription;
    if (ld?.sdp) {
      const lines = ld.sdp.split('\r\n'), extra = [];
      for (const l of lines) { const r = rewrite(l); if (r) extra.push(r); }
      if (extra.length) ld.sdp = lines.filter(l => !l.startsWith('a=end-of-candidates')).concat(extra, ['a=end-of-candidates', '']).join('\r\n');
    }
    const c = cm.getConnection(id);
    if (c?.additionalCandidates) {
      const arr = c.additionalCandidates, push = arr.push.bind(arr);
      arr.push = (...items) => { let n = 0; for (const it of items) { n = push(it); const r = rewrite(it.candidate); if (r) n = push({ candidate: r, sdpMid: it.sdpMid }); } return n; };
      for (const it of [...arr]) { const r = rewrite(it.candidate); if (r) push({ candidate: r, sdpMid: it.sdpMid }); }
    }
    return res;
  };
}

/* ------------------------------------------------------------------ lobby list for everyone browsing (1 Hz) */
setInterval(() => {
  if (!clients.size) return;
  const msg = { t: MSG.LOBBIES, list: [...lobbies.values()].map(l => l.info()) };
  for (const c of clients.values()) if (c.hello && !c.lobby) c.conn.send(msg, false);
}, 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OTR game server v${PROTOCOL_VERSION}: http+ws :${PORT}  webrtc ${NO_RTC ? 'OFF' : 'udp:' + UDP_PORT}  stun ${STUN.join(',') || '-'}${PUBLIC_IP ? '  public ' + PUBLIC_IP : ''}` +
    `  origins ${ORIGINS.join(',')}  lobbies ${[...lobbies.keys()].join('/')}${netSim.lag || netSim.jitter || netSim.loss ? `  NETSIM lag ${netSim.lag}±${netSim.jitter} ms loss ${netSim.loss}` : ''}  (max ${NET.MAX_HUMANS} humans each)`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('bye'); process.exit(0); });
