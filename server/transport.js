// transport.js — one connection interface over two transports (DAWG ARENA's proven pattern):
//   rtc = geckos.io (WebRTC data channel, unordered; unreliable by default, `reliable` = resent `runs` times)
//   ws  = WebSocket fallback (everything reliable + ordered)
// JSON messages go through send(obj, reliable); binary frames (snapshots out, kart states in) through
// sendRaw(buf) / onRaw(fn), always unreliable on rtc.
//
// Network simulator (env, for testing bad networks — applies to BOTH directions of every connection):
//   NET_LAG_MS    one-way delay added to each message (default 0)
//   NET_JITTER_MS ± uniform jitter on top (unreliable frames may reorder, like real UDP)
//   NET_LOSS      0..1 probability an UNRELIABLE message (rtc JSON/raw, or any raw frame on ws) is dropped
// Reliable messages are never dropped and keep their order (each is scheduled no earlier than the last).

const SIM = {
  lag: +(process.env.NET_LAG_MS || 0), jitter: +(process.env.NET_JITTER_MS || 0), loss: +(process.env.NET_LOSS || 0),
};
export const netSim = SIM;
const simOn = () => SIM.lag > 0 || SIM.jitter > 0 || SIM.loss > 0;

/** Wrap a send/dispatch function with the simulator. `reliable` messages keep order and are never lost. */
function delayer() {
  let lastRel = 0;
  return (fn, reliable) => {
    if (!simOn()) return fn();
    if (!reliable && SIM.loss > 0 && Math.random() < SIM.loss) return;
    const d = Math.max(0, SIM.lag + (Math.random() * 2 - 1) * SIM.jitter);
    let at = Date.now() + d;
    if (reliable) { at = Math.max(at, lastRel + 0.01); lastRel = at; }
    setTimeout(fn, Math.max(0, at - Date.now()));
  };
}

const RTC_RELIABLE = { reliable: true, runs: 4, interval: 50 };

/** geckos.io ServerChannel → Conn */
export function wrapGeckos(ch) {
  const out = delayer(), inn = delayer();
  const conn = {
    id: 'rtc:' + ch.id, kind: 'rtc', alive: true, dropped: 0, lastRx: Date.now(),
    send(obj, reliable = true) { if (!conn.alive) return; out(() => { try { ch.emit('m', obj, reliable ? RTC_RELIABLE : undefined); } catch { /* gone */ } }, reliable); },
    sendRaw(buf) { if (!conn.alive) return; out(() => { try { ch.raw.emit(buf); } catch { /* gone */ } }, false); },
    onMsg(fn) { ch.on('m', d => { conn.lastRx = Date.now(); inn(() => fn(d), true); }); },
    onRaw(fn) { ch.onRaw(d => { conn.lastRx = Date.now(); inn(() => fn(d), false); }); },
    onClose(fn) { ch.onDisconnect(() => { if (!conn.alive) return; conn.alive = false; fn(); }); },
    close() { conn.alive = false; try { ch.close(); } catch { /* */ } },
  };
  ch.onDrop?.(() => { conn.dropped++; });
  return conn;
}

/** ws WebSocket → Conn */
export function wrapWs(ws, id) {
  const out = delayer(), inn = delayer();
  let msgFn = null, rawFn = null, closeFn = null;
  const conn = {
    id: 'ws:' + id, kind: 'ws', alive: true, dropped: 0, lastRx: Date.now(),
    send(obj) { if (!conn.alive) return; out(() => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }, true); },
    // binary frames: the simulator treats them as unreliable (they ARE the unreliable stream on rtc)
    sendRaw(buf) { if (!conn.alive) return; if (ws.bufferedAmount > 256 * 1024) { conn.dropped++; return; } out(() => { if (ws.readyState === ws.OPEN) ws.send(buf); }, false); },
    onMsg(fn) { msgFn = fn; },
    onRaw(fn) { rawFn = fn; },
    onClose(fn) { closeFn = fn; },
    close() { conn.alive = false; try { ws.close(); } catch { /* */ } },
  };
  ws.on('message', (data, isBinary) => {
    conn.lastRx = Date.now();
    if (isBinary) { const b = data; inn(() => rawFn?.(b), false); return; }
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    inn(() => msgFn?.(m), true);
  });
  const closed = () => { if (!conn.alive) return; conn.alive = false; closeFn?.(); };
  ws.on('close', closed); ws.on('error', closed);
  return conn;
}

/** An in-process pair for server/selftest.js: { server: Conn, client: { send, sendRaw, msgs, raws, close } } */
export function memoryPair(id = 'mem' + Math.random().toString(36).slice(2, 7)) {
  let msgFn = null, rawFn = null, closeFn = null;
  const client = { msgs: [], raws: [], closed: false,
    send(obj) { if (!client.closed) msgFn?.(JSON.parse(JSON.stringify(obj))); },
    sendRaw(buf) { if (!client.closed) rawFn?.(buf); },
    close() { if (client.closed) return; client.closed = true; server.alive = false; closeFn?.(); },
  };
  const server = {
    id: 'mem:' + id, kind: 'mem', alive: true, dropped: 0, lastRx: Date.now(),
    send(obj) { if (server.alive) client.msgs.push(JSON.parse(JSON.stringify(obj))); },
    sendRaw(buf) { if (server.alive) client.raws.push(buf); },
    onMsg(fn) { msgFn = m => { server.lastRx = Date.now(); fn(m); }; },
    onRaw(fn) { rawFn = b => { server.lastRx = Date.now(); fn(b); }; },
    onClose(fn) { closeFn = fn; },
    close() { client.close(); },
  };
  return { server, client };
}
