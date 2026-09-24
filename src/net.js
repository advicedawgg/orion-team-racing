// net.js — the client transport (browser, and node ≥ 22 for tools/netbot.mjs). One interface over
// geckos.io (WebRTC data channel to ONE server UDP port; unreliable binary + reliable-by-resend JSON)
// with a WebSocket fallback (everything reliable), exactly DAWG ARENA's pattern:
//
//   const net = await connectNet(url, { onStatus, prefer: 'auto'|'rtc'|'ws' });
//   net.send(obj, reliable = true)   net.sendRaw(arrayBuffer)   net.on(type, fn)   net.onRaw(fn)
//   net.onClose(fn)   net.close()   net.kind ('rtc'|'ws')   net.rtt (ms)   net.serverNow() (server ms)
//
// The geckos browser client is the vendored ESM bundle vendor/geckos.client.js (tools/build-geckos.mjs),
// imported lazily: when it's missing, or WebRTC can't connect within RTC_TIMEOUT, we use the WebSocket.
// Clock: a ping every second (5 quick ones first); the server-time offset comes from the lowest-RTT
// sample of the last 12 (NTP-style), so jitter doesn't wobble the countdown.
import { MSG, PROD_SERVER, DEFAULT_PORTS, PROTOCOL_VERSION, NET } from './protocol.js';

const RTC_TIMEOUT = 5000;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const isPrivateHost = h => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /\.local$/.test(h);

/** Where the game server is: ?server=<url> wins; a LAN dev server (private IP) → same host :8955;
 *  anything else (orion3.advicedawg.com, a Steam Deck's localhost copy) → the production server. */
export function serverUrl(loc = typeof location !== 'undefined' ? location : null) {
  const q = loc ? new URLSearchParams(loc.search).get('server') : null;
  if (q) return /^https?:\/\//.test(q) ? q.replace(/\/$/, '') : `http://${q}`;
  if (loc && isPrivateHost(loc.hostname)) return `${loc.protocol}//${loc.hostname}:${DEFAULT_PORTS.http}`;
  return PROD_SERVER;
}

export async function connectNet(url, { onStatus = () => {}, prefer = 'auto', geckosImport = null } = {}) {
  const net = new Net(url);
  let lastErr = null;
  if (prefer !== 'ws') {
    try { onStatus('connecting'); await net.connectRtc(geckosImport); }
    catch (e) { lastErr = e; if (prefer === 'rtc') throw e; }
  }
  if (!net.kind) {
    onStatus('connecting (websocket)');
    await net.connectWs();
  }
  net.startPing();
  net.lastErr = lastErr;
  return net;
}

export class Net {
  constructor(url) {
    this.url = url.replace(/\/$/, ''); this.kind = null; this.rtt = 0; this.offset = 0; this.synced = false;
    this.handlers = new Map(); this.rawFns = []; this.closeFns = []; this.samples = [];
    this.rtc = null; this.ws = null; this.closed = false; this.rx = 0; this.tx = 0; this.lastRx = now();
  }
  async connectRtc(geckosImport) {
    const mod = await (geckosImport ? geckosImport() : import('../vendor/geckos.client.js'));
    const geckos = mod.default || mod;
    await new Promise((resolve, reject) => {
      const ch = geckos({ url: this.url, port: null });
      const to = setTimeout(() => { try { ch.close(); } catch { /* */ } reject(new Error('webrtc timeout')); }, RTC_TIMEOUT);
      ch.onConnect(err => {
        clearTimeout(to);
        if (err) { reject(err); return; }
        this.rtc = ch; this.kind = 'rtc';
        ch.on('m', d => this.dispatch(d));
        ch.onRaw(d => this.dispatchRaw(d));
        ch.onDisconnect(() => this.closedNow());
        resolve();
      });
    });
  }
  connectWs() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url.replace(/^http/, 'ws') + '/ws');
      ws.binaryType = 'arraybuffer';
      const to = setTimeout(() => { try { ws.close(); } catch { /* */ } reject(new Error('websocket timeout')); }, 6000);
      ws.onopen = () => { clearTimeout(to); this.ws = ws; this.kind = 'ws'; resolve(); };
      ws.onerror = () => { clearTimeout(to); if (!this.kind) reject(new Error('websocket failed')); };
      ws.onclose = () => { clearTimeout(to); if (this.kind === 'ws') this.closedNow(); else reject(new Error('websocket closed')); };
      ws.onmessage = ev => {
        if (typeof ev.data === 'string') { let m; try { m = JSON.parse(ev.data); } catch { return; } this.dispatch(m); }
        else this.dispatchRaw(ev.data);
      };
    });
  }
  dispatch(m) {
    if (!m || typeof m !== 'object') return;
    this.rx++; this.lastRx = now();
    if (m.t === MSG.PONG) { this.pong(m); return; }
    for (const fn of this.handlers.get(m.t) || []) try { fn(m); } catch (e) { console.error('[net]', m.t, e); }
    for (const fn of this.handlers.get('*') || []) try { fn(m); } catch (e) { console.error('[net]', e); }
  }
  dispatchRaw(d) {
    this.rx++; this.lastRx = now();
    const buf = d instanceof ArrayBuffer ? d : ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d;
    for (const fn of this.rawFns) try { fn(buf); } catch (e) { console.error('[net] raw', e); }
  }
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const a = this.handlers.get(type); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  onRaw(fn) { this.rawFns.push(fn); }
  onClose(fn) { this.closeFns.push(fn); }
  send(obj, reliable = true) {
    if (this.closed) return;
    this.tx++;
    if (this.rtc) this.rtc.emit('m', obj, reliable ? { reliable: true, runs: 4, interval: 50 } : undefined);
    else if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
  sendRaw(buf) {
    if (this.closed) return;
    this.tx++;
    if (this.rtc) this.rtc.raw.emit(buf);
    else if (this.ws && this.ws.readyState === 1 && this.ws.bufferedAmount < 64 * 1024) this.ws.send(buf);
  }
  hello() { this.send({ t: MSG.HELLO, v: PROTOCOL_VERSION }); }
  startPing() {
    let n = 0;
    const ping = () => { if (this.closed) return; this.send({ t: MSG.PING, ct: now() }, false); n++; this.pingT = setTimeout(ping, n < 6 ? 150 : NET.PING_MS); };
    ping();
  }
  pong(m) {
    const t = now(), rtt = t - m.ct;
    if (!(rtt >= 0) || rtt > 5000) return;
    this.samples.push({ rtt, off: m.st - (m.ct + rtt / 2) });
    if (this.samples.length > 12) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    // slew, don't jump: every new lowest-RTT sample moved the offset by ±10 ms on a jittery line, which
    // shifted this client's reported kart by speed × that on the server (~20 cm hitches for everyone else)
    if (!this.synced || Math.abs(best.off - this.offset) > 50) this.offset = best.off;
    else this.offset += Math.max(-1, Math.min(1, best.off - this.offset));
    this.synced = true;
    this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
    this.rttBest = best.rtt;
  }
  /** estimated server Date.now() */
  serverNow() { return now() + this.offset; }
  closedNow() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.pingT);
    for (const fn of this.closeFns) try { fn(); } catch { /* */ }
  }
  close() {
    const fns = this.closeFns; this.closeFns = [];
    this.closedNow();
    try { this.rtc?.close(); } catch { /* */ }
    try { this.ws?.close(); } catch { /* */ }
    this.closeFns = fns;
  }
}
