# Orion Team Racing

A Crash Team Racing-style kart racer for Orion (a young kid) and his family, and the third Super
Orion game. It uses plain ES modules and vendored three.js with no build step. The repo is the
deployable artifact. DESIGN.md is the module contract (read the section you're touching), and
`server/README.md` covers online play.

**Kid rules:** no reading needed to play, big readable UI, nothing scary, generous timing, and
every results screen celebrates. Don't reorder the main menu, because muscle memory is ↓ = CUP
and ↓↓ = TIME TRIAL. When a kid mashes A online, it must never leave the lobby: the focused
button is harmless and LEAVE sits beside it.

## Run and verify

```sh
node tools/serve.mjs 8960      # dev server (no-store) → http://192.168.15.78:8960/
node src/physics.js            # every physics/tuning change  → must PASS
node tools/check.js            # every track/AI/item/race change → must PASS
node server/selftest.js        # every protocol/lobby/netgame change → must PASS
```

Browser tests run against GPU headless Chrome (CDP `http://192.168.15.100:9333`):
`tools/realflow.mjs`, `input-test.mjs`, `twoplayer-test.mjs`, `leakcheck.mjs 2`,
`online-test.mjs` (add `--lag 100 --jitter 30 --loss 0.05` for a bad network), and
`playtest.mjs <track> --perf`. Run realflow, input-test and twoplayer-test after any
menu/input/online-hook change.
A visual change isn't done until you've looked at the PNG (`shots/qa/<track>-sheet.jpg`).

## Invariants

- **Pure modules (race, physics, ai, items, track, protocol, netgame) never import THREE or touch
  the DOM.** The gates *and* the game server import them.
- **Bump `PROTOCOL_VERSION` on any wire change.** The site and server deploy separately, and a
  bump means both ship together.
- **Offline must not change.** Every online hook is inert unless it's set, and menu.js loads
  online.js lazily.
- **2P keeps the 1P paths.** `race.player` is P1, and per-player input is `In.players[pn]`.
  Decide whether "the player" means P1 or every human. The 2P body class is `split2` (`.p2`
  means 2nd place).
- **Never bind Ctrl/Meta/Alt**, because Ctrl+W closes the tab.
- Lights are a fixed pool, so never add, remove or hide one at runtime (everything recompiles).
  Shadow on/off applies only in `startRace`, before the warm-up.
- The Steam Deck's draw-call budget is **≤ ~200**. Merge static scenery, instance props, and keep
  small props shadowless. Only the player's kart casts a real shadow.
- Track shapes: keep ≥ 8 m between stacked decks, make tunnel roofs ≥ 8.5 m, bank around the
  inside edge, and screenshot any new road decal.
- Remote karts interpolate on the SIM clock (DT per step), never the wall clock. In a message,
  `t` is the message type, so server times go in `st`.
- Test URLs (`?skip=1`, `?t=`, `?ai=1`) read only the URL, never saved settings. Keep it that way.

## Test traps

- Close every Playwright page in `finally`. A leaked WebGL tab holds VRAM on a shared GPU.
- The GPU box is vsync-locked, so rAF always reads 16.7 ms. Use `playtest.mjs --perf` (GPU timer
  + CPU inside `render()`), take the p50, and check `…:9333/json/list` for stray tabs first.
- Headless Chrome can't render emoji. Use glyphs or SVG in the UI.
- `tools/online-test.mjs` runs its own server on 8975/8976. The dev game server (8955/8956)
  restarts only via `server/dev.sh`, which is pidfile-scoped. Never use `pkill -f`.

## House rules

- Measure, don't assert. Record numbers in DESIGN.md/README.md.
- Agents may work in parallel. In a file someone else owns (DESIGN.md "Stack and layout"), make
  small exact-string edits right after re-reading it. Never reformat.
- **Don't commit, push or deploy unless asked.** The hub has no git identity, so commit with
  `-c user.name=Claude -c user.email=noreply@anthropic.com`.

## Deploy

- **Site** https://orion3.advicedawg.com (Worker `orion-team-racing`). wrangler OAuth exists only
  on maxpowa, so ship **from a commit, never the working tree**:
  `git archive HEAD index.html ui.css src vendor assets wrangler.jsonc .assetsignore` → scp → extract
  over `D:\dev\orion-team-racing` (a plain copy, not a checkout; this repo is canonical) →
  `npx wrangler deploy` → curl a changed file (new files can 404 for ~30 s).
- **Steam Deck:** `git push` (GitHub `master`) is what reaches it, not wrangler. The Deck updater
  pulls the tarball into `site/3/` and serves it on localhost, which is why the games link
  is `../`.
- **Game server:** container `otr-server` on Unraid, tunnel → https://orion3-net.advicedawg.com
  (`PROD_SERVER`), WebRTC on udp/8956.
  `rsync -a --delete --exclude node_modules server src unraid:/mnt/user/appdata/otr/src/ && ssh unraid bash /boot/config/scripts/otr-run.sh`,
  then `curl -s https://orion3-net.advicedawg.com/health`.
