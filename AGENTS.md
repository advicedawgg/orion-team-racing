# Working on Orion Team Racing

Read this before touching anything. It's short on purpose. DESIGN.md is the contract between
modules; README.md covers what the game is and how to run it.

## The gates

```sh
node src/physics.js     # every physics / tuning change                 → "physics self-test: PASS"
node tools/check.js     # every track / AI / item / race change        → "PASS"
```

A change isn't done until the relevant gate prints PASS. Both run in plain node with no
browser. They import the real `track.js`, `physics.js`, `race.js`, `ai.js` and `items.js`, and
they don't re-implement them, which is why they can be trusted. The pure modules must never import
THREE or touch the DOM.

Browser checks (GPU headless Chrome, CDP `http://192.168.15.100:9333`, dev server
`http://192.168.15.78:8960/`):

```sh
node tools/realflow.mjs      # whole game in one page session, real keys → REALFLOW: PASS
node tools/input-test.mjs    # pad + keyboard in a race                  → INPUT TEST: PASS
node tools/twoplayer-test.mjs  # 2P split screen: pads, keyboard split, join, cup → TWO PLAYER TEST: PASS
node tools/leakcheck.mjs 2   # geometries/textures flat across 10 track switches (--query players=2)
node tools/playtest.mjs castle --perf   # chase shots + draw calls / CPU / GPU ms (--query players=2 for 2P)
node tools/shot-2p.mjs beach castle     # 2P screenshots: grid / mid-race items / results → shots/mp/
node server/selftest.js      # online, in-process (every protocol / lobby / netgame change) → SELFTEST: PASS
node tools/online-test.mjs   # online end to end: own server + 3 netbots + the browser → ONLINE TEST: PASS
                             #   (add --lag 100 --jitter 30 --loss 0.05 for the bad-network run)
```

A visual change isn't done until you've looked at the screenshot (Read the PNG). Use the contact
sheet `shots/qa/<track>-sheet.jpg` from `playtest.mjs`.

## Traps learned the hard way

**The browser**
- **Close every page in `finally`.** A leaked WebGL tab holds GPU VRAM on a shared card.
- **The box is vsync-locked.** rAF time reads 16.7 ms whatever you draw. Measure GPU time with
  `EXT_disjoint_timer_query_webgl2` (the result is in ns) and CPU time inside
  `renderer.render()`. `playtest.mjs --perf` does both. Take the p50, and check
  `curl …:9333/json/list` for stray tabs before believing a bad number.
- **Emoji don't render** in the headless Chrome. The HUD and touch buttons use ★ ◆ ❚❚ and SVG
  faces instead.
- **`?skip=1` / `?t=` / `?ai=1` use only the URL**, never the saved racer or settings, so
  tests stay deterministic. `?screen=podium` uses a fake cup with the saved `lastRacer`. Pass
  `&racer=orion` for a known champion.

**Input**
- **Never bind Ctrl** (Ctrl+W closes the tab). `input.js` and `menu.js` both return early on
  Ctrl, Meta or Alt.
- Arrow keys and Space are `preventDefault`-ed, so the page never scrolls.
- Keys are released on window `blur`, so the Steam overlay or an alt-tab can't leave a key
  stuck.
- **2P keeps the 1P paths intact.** `race.player` is still P1 and `In.controls` still merges
  every device. Per-player input is `In.players[pn]`, and humans are `race.humans` / `kart.pn`.
  Anything written for "the player" must ask whether it means P1 or every human (DESIGN.md "Two
  players").
- **The press that joins P2 must not click.** Enter or A on the join screen is both a join and a
  menu 'ok'. input.js queues the join before menu.js sees the key, and the join screen's
  `onAction` eats the 'ok'.
- **Don't reorder the main menu.** 2 PLAYERS sits under TIME TRIAL, because realflow/ui-test and
  the kid's muscle memory rely on ↓ = ORION CUP and ↓↓ = TIME TRIAL.

**Rendering**
- Warm-up before GO has three parts:
  1. Lights are a fixed pool: don't add, remove or hide one at runtime, because every
     material recompiles.
  2. Shaders are warmed with `compileAsync`.
  3. `startRace` also pushes every texture to the GPU (`initTexture`) and renders one
     throwaway frame with frustum culling off, so vertex buffers upload too. Without that, the
     first sight of far scenery hitched 25–38 ms mid-race.
- **Shadows on/off recompiles every shader.** The GRAPHICS setting only applies it in
  `startRace`, right before the warm-up.
- **Dispose the old track.** `loadTrack` frees geometries, materials and their textures,
  shader-uniform textures included. Before that fix, textures grew by about 20 for every lap of
  the five tracks. three re-uploads a disposed texture if it's drawn again, so trackmesh's
  texture cache stays valid.
- **2P draws the scene twice** (setViewport + setScissor). One GPU timer query must span both
  views: a query per view read the second one about 3× too high. `renderer.info` isn't reset
  between the views, so `info()` is the whole frame. The start grid in 2P is 266–291 calls,
  because every racer is in both views. Shadows are always off in 2P.
- **The 2P body class is `split2`, not `p2`.** ui.css uses `.p2` for "2nd place" on the results
  panel.
- **Draw calls are the Steam Deck's budget.** Stay at or under ~200.
  - Merge static scenery per material and instance repeated props.
  - An InstancedMesh's shadow pass draws every instance, so keep small props shadowless.
  - Only the player's kart casts a real shadow; AI karts get one instanced blob.
  - The racers are 12–16 calls each, so the 8 at the grid are about 110 calls on their own.
- **Additive sprites stack to white.** Exhaust flames and turbo sparks used to white-out the
  player's kart. `fx.js` now keeps flame quads small at 0.55 alpha, and near the lens any sprite
  is shrunk to about 7.5% of its distance from the camera. Glowing sprites also fade out inside
  5 m.
- **A textured material multiplies colour by the texture's luma.** A dark texture turns bright
  colours brown.
- **Metal with no env map renders dark.** The podium trophy at metalness .85 came out brown.
  Keep metalness low and use emissive.
- **Blob shadows at +0.04 m lost the depth test** against the road's polygonOffset. +0.15 m
  works. Screenshot any new road decal.

**Camera and track shapes**
- **The chase camera has no physics.** `camera.js` slides the boom inside the boundary line: it
  keeps the camera `wallMargin` inside `±lim` from `track.project`, and 'fall' edges have no wall.
  Under a `tunnel` it caps the height at `tunnelCap` above the road.
- **The camera clamps to its own deck.** `groundAt(x, z, hint, y)` takes the kart's sample and
  height, so where the track crosses itself the camera clamps to its own level.
  - Stacked decks need ≥ 8 m between them.
  - Tunnel roofs need to be ≥ 8.5 m.
  - A walled spiral needs a gap between the inside rail and the tower.
- An AI kart within 2.4 m of the camera is hidden for those frames. Otherwise, at the grid, King
  Dad's crown filled the screen.
- Scenery props that are tall and sit close to the wall end up next to the lens on the outside
  of corners. Cacti use `near: 5.5`.
- Banking pivots on the inside edge. The other way dug the hairpin into the sea.
- Surfaces set top speed only. There is no grip model.

**Audio**
- Music is fetched whole into a blob URL, because the dev server has no Range support and Chrome
  can't loop an Ogg stream without it.
- Opus is the primary format; MP3 is for browsers without it, and SO2's tracks are the last
  fallback.
- Fast-forward (`advance`, `?t=`) is silent.

**Online** (DESIGN.md "Online", `server/README.md`)
- **Bump `PROTOCOL_VERSION` (src/protocol.js) on any wire change.** Old clients then get "please
  refresh" instead of misreading bytes. The server and the static site deploy separately.
- **The pure modules run on the server too.** `server/` imports `../src/*.js`, so a THREE or DOM
  import in race/physics/ai/items/track/protocol/netgame breaks the game server as well as the gate.
- **Offline must not change.** Every online hook is inert unless set: `kart.remote`,
  `race.netClient`, `race.starHit`, `W.mirror`, `G.net`, `G.netGrid`. menu.js imports online.js
  lazily. After touching them, run check.js, realflow, input-test and twoplayer-test.
- **Remote karts move on the SIM clock.** netgame.js advances the interpolation time by exactly DT per
  step. Deriving it from the wall clock made main.js's 0-step/2-step frames hitch every remote kart by
  ~35 cm. Keep the Hermite x/z interpolation too: linear left a kink every snapshot.
- **The server must be able to rewind a report.** A client frame that runs 2 steps sends a report
  "from the future". Clamping its lag at 0 jittered that kart ~18 cm/step
  (`node tools/net-jitter.mjs 10 burst 100 30 0.05`: in-process Lobby + NetRace + delayed reports;
  `tools/net-interp.mjs` is the client-side twin).
- **Measure smoothness per rendered frame from `G.visuals[i].ix/iz` with the rAF timestamp**, as
  distance from the time-weighted midpoint of the neighbouring frames. Per-frame speed change is
  dominated by frame timing and made bots look as bad as humans.
- **START's `t` field is the message type.** A spread `{...startMsg, t: now}` silently turned START
  into an unknown message. Server times go in `st`.
- **A kid mashing A must never leave.** The online results and waiting room focus a harmless button
  (▶ NEXT RACE! / ▶ I'M READY!), and LEAVE sits beside it.
- **Test on your own port.** `tools/online-test.mjs` starts its own server on 8975/8976, so the dev
  server (8955/8956, `server/dev.sh`) keeps running. Restart the dev server with `server/dev.sh` only:
  it's pidfile-scoped, never `pkill -f`.

## House rules

- Measure, don't assert. Put numbers in DESIGN.md or README.md when you change something that
  has one.
- Every file has an owner (DESIGN.md "Stack and layout"). In someone else's file, make small
  exact-string edits and re-read it right before editing, because agents work in parallel.
  Never reformat someone else's file.
- Keep it kid-friendly: big readable things, nothing scary, generous timing, and every result
  screen celebrates.
- Don't commit or deploy unless asked.

## Deploy (live since 2026-09-25)

**https://orion3.advicedawg.com** = Cloudflare Worker `orion-team-racing` (static assets, `wrangler.jsonc`),
card 3 on the family launcher at https://orion.advicedawg.com (repo `D:\dev\Oriongame` on maxpowa).
wrangler's OAuth only exists on **maxpowa**, so deploys go from a plain copy at `D:\dev\orion-team-racing`
(not a git checkout — the hub repo is canonical). Ship from a COMMIT, never the working tree (another agent's
half-done files would go live): `git archive HEAD index.html ui.css src vendor assets wrangler.jsonc .assetsignore`
→ tar → scp → extract over that copy → `npx wrangler deploy`. Then check a changed file on the live URL with curl.
The Steam Deck does NOT have this game yet (its updater pulls GitHub tarballs; this repo has no remote).
