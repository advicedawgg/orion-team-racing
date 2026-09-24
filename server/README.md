# Orion Team Racing — online game server

Plain node ESM (no TypeScript, no build). It imports the game's pure modules from `../src`
(`track.js`, `physics.js`, `race.js`, `ai.js`, `items.js`, `protocol.js`), the same code the
browser and the gate run. DESIGN.md "Online" has the whole model. This file covers running it.

```
server/index.js      HTTP (/health, /lobbies), WebSocket fallback (/ws), geckos.io WebRTC, the lobby manager
server/lobby.js      one lobby: lifecycle, the headless race (bots, items, laps), human reports, snapshots
server/transport.js  one Conn interface over geckos.io + ws, plus the network simulator (NET_* env)
server/selftest.js   the in-process gate (no sockets, fake clock, ~5 s)
server/dev.sh        (re)start on the hub, pidfile-scoped, log in _scratch/otr-server.log
server/Dockerfile    production image (build context = the REPO ROOT)
```

## Run it

```sh
cd server && npm install        # once: @geckos.io/server (node-datachannel prebuilt), ws
node server/selftest.js         # → SELFTEST: PASS
server/dev.sh                   # dev server on the hub: http+ws :8955, webrtc udp :8956
curl -s localhost:8955/health
```

Open the game with `?server=http://192.168.15.78:8955`. The hub dev server
(`http://192.168.15.78:8960/`) already defaults to `<same host>:8955` because it's a private IP
(`src/net.js serverUrl()`). Everything else, including orion3.advicedawg.com and a Steam Deck's
localhost copy, goes to `PROD_SERVER` in `src/protocol.js`, which is
`https://orion3-net.advicedawg.com`.

## Environment

| var | default | what |
|---|---|---|
| `PORT` | 8955 | HTTP + WebSocket + WebRTC signalling (TCP) |
| `UDP_PORT` | 8956 | the ONE UDP port every WebRTC data channel uses (ICE mux) |
| `PUBLIC_IP` | — | extra srflx candidate if STUN can't find the WAN address (DAWG ARENA's patch) |
| `STUN_URLS` | `stun:stun.l.google.com:19302` | comma list; empty = none |
| `ALLOWED_ORIGINS` | `https://orion3.advicedawg.com,https://orion.advicedawg.com,http://192.168.15.78:8960` | CORS for the signalling POSTs + Origin check on `/ws`; `http(s)://localhost:*` / `127.0.0.1:*` are always allowed; `*` = any |
| `NO_RTC` | — | `1` = WebSocket only |
| `NET_LAG_MS` / `NET_JITTER_MS` / `NET_LOSS` | 0 | network simulator, applied to both directions of every connection: one-way delay, ± uniform jitter, and a drop chance for unreliable messages. Reliable ones are never dropped and stay in order. |
| `LAPS`, `WAIT_S`, `LOAD_S`, `RESULTS_S`, `WAIT_FULL_S` | 3 laps, 12/4/10/3 s | test overrides (`tools/online-test.mjs` uses `LAPS=1 WAIT_S=8 RESULTS_S=6`) |
| `QUIET` | — | `1` = no per-connection logs |

## Endpoints

- `GET /health` returns `{ ok, v, uptime, clients, transports: {rtc, ws}, udpPort, netSim, lobbies:
  [{ id, phase, count, humans, track, lap, laps, races, resets, stepMsAvg, snapBytesAvg }] }`. The
  container HEALTHCHECK uses it.
- `GET /lobbies` returns the public lobby list.
- `/.wrtc/v2/*` is the geckos.io signalling, CORS per `ALLOWED_ORIGINS`.
- `/ws` is the WebSocket fallback (Origin-checked, max 16 KB per message).

## Production (the ops step — not done yet)

Run it like DAWG ARENA: on Unraid with host networking, HTTP through a Cloudflare tunnel, and UDP
through a router port forward.

```sh
# from the repo root, on the build box
docker build -f server/Dockerfile -t otr-server .
docker run -d --name otr-server --network host --restart always \
  -e PORT=8955 -e UDP_PORT=8956 [-e PUBLIC_IP=<wan ip>] otr-server
```

1. **Ports.** 8955/tcp and 8956/udp were free on both the hub and Unraid on 2026-09-25. DAWG ARENA
   uses 8950/8951.
2. **Cloudflare tunnel.** Point `orion3-net.advicedawg.com` at `http://localhost:8955`. It carries
   HTTP, the signalling and the WebSocket. If you pick another hostname, change `PROD_SERVER` in
   `src/protocol.js` (one constant) and redeploy the static site.
3. **UniFi.** Forward `udp/8956 → 192.168.15.100:8956`. Create it through the controller API, not the
   MCP tool, because the MCP drops fields (see the memory note on it).
4. **Check.** `curl https://orion3-net.advicedawg.com/health`. Then open
   https://orion3.advicedawg.com, go to ONLINE, and check the pill in the top-right corner. `ONLINE ·
   N ms` means WebRTC. `ONLINE · N ms · ws` means it fell back to WebSocket, so check the UDP
   forward or `PUBLIC_IP`.
5. **Origins.** The defaults already allow orion3/orion.advicedawg.com. Add any new static host to
   `ALLOWED_ORIGINS`.
6. **The static site.** `.assetsignore` keeps `server/` out of the Cloudflare deploy.
   `vendor/geckos.client.js` must ship. Rebuild it with `node tools/build-geckos.mjs` when bumping
   geckos.

Without the UDP forward everything still works over the WebSocket fallback through the tunnel. It
just has TCP head-of-line blocking on a bad connection.

## Measured (hub, 4-core VM, node 22)

- **Server CPU, 3 humans + 5 bots racing:** 5.9–9.8 % of one core for the whole process. The
  lobby's own step is 0.30–0.43 ms per 60 Hz step, including the snapshot encode. With 4 humans + 4
  bots it is 14–19 % (the browser's WebRTC session adds some).
- **Idle, no humans:** 0–0.4 %. Lobbies run no timer when empty. What's left is the 1 Hz lobby-list
  broadcast and geckos' own housekeeping.
- **Snapshot:** ~490 bytes at 20 Hz for 8 karts plus the items world. That's ~10 KB/s down per
  client. Own-kart reports are 61 bytes at 30 Hz.
- `tools/online-test.mjs` prints all of the above as `RESULTS {...}`.
