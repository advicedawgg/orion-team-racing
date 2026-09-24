# Core engine notes (wave 1)

Open **http://192.168.15.78:8960/?track=beach&racer=orion&skip=1**: an 8-kart, 3-lap race on
Bubbly Beach with the CTR power slide and 3-stage turbos. Keyboard: arrows/WASD, Space = hop/slide,
Shift = turbo, Esc/P = pause, M = mute, F = fullscreen. Pad: A/RT accelerate, X/LT brake, RB/LB
shoulders. Touch buttons appear on touch screens (`&touch=1` forces them). Without `skip=1` you get
a placeholder title card (press Space/A/tap), which the UI agent replaces.

## How to test

```sh
node src/physics.js                 # 18 physics checks → "physics self-test: PASS"
node tools/check.js                 # THE GATE (geometry + 8-AI race × easy/medium/hard + kid bot), ~3 s
node tools/check.js beach --diff hard --seed 3 --quiet
node tools/shot.mjs 'track=beach&skip=1&t=20' shots/x.png --info          # GPU Chrome screenshot + draw calls
node tools/shot.mjs 'track=beach&skip=1&hud=0&cam=-60,160,-260,104,0,-10' shots/overview.png
node tools/slide-test.mjs           # scripted slide in the real browser: 3 turbos + flame-colour shots in shots/slide/
```
`shot.mjs --eval '<js>'` runs code in the page after `__OTR.ready` (e.g. `__OTR.advance(60)`,
`__OTR.hold(true); __OTR.script(n, k => ctrl, {draw:true})`). Pages are always closed in `finally`.

## What's there

- **physics.js** — arcade kart: `yaw` = travel direction, body drawn at `yaw + drift·driftAngle`.
  Hop (either shoulder) → land steering = slide in that direction, locked; counter-steer range
  2.1 rad/s (into) … 0.1 rad/s (away). Charge 0.9 s, red window last 25% (easyBoost 45%, no
  overheat), other shoulder in the red = turbo 1/2/3 (0.6/0.8/1.1 s reserve, tier 3 = purple),
  early = fizzle, full = overheat (locked till the slide ends). Boost reserve (cap 3 s) raises top
  speed 22 → up to 30 m/s. Hang time ≥0.5 s / ≥1.0 s = small/medium turbo. Pads = medium turbo.
  Start boost (race.js). Offroad by surface table. Walls reflect heading (restitution 0.25) and
  scrub — measured min speed after a 50° hit: 10 m/s, never stops. Kart bumping by mass (speed stat).
  Ramps (`jumps`) launch whatever crosses the lip on/near the road. Rescue: splash/fall → 1.2 s →
  dropped from a cloud on the centre line (a gap splash drops you on the FAR side — kid-first).
- **track.js** — the data format is in DESIGN.md "Track data format". Banking pivots on the inside
  edge (it was digging the inside of the hairpin into the sea — found by the scripted slide).
- **race.js** — countdown 3.6 s, laps via 7 ordered checkpoints, positions, finish, AI drives the
  player after they finish, race called 20 s later. `race.addSystem(fn)` is the items hook.
- **ai.js** — racing line + personal lane + light avoidance; slides corners with ≥~0.8 rad of
  turn ahead and holds the line with the same counter-steer maths a human has; turbo success by
  difficulty; start boosts; mild rubber band vs the player.
- **trackmesh.js** — road/shoulders/kerbs+edge lines/walls/gap faces/terrain heightfield (lakes,
  channels, shore)/water/sky dome/cloud ring/start arch/pads, merged per material. Uses the art
  agent's `assets/tex/*.jpg` (road_beach, sand, water) with instant procedural fallbacks.
- **scenery/beach.js** — placeholder props (instanced palms/umbrellas/rocks/boats, merged
  lighthouse/huts/bunting). Tracks agents may rewrite.
- **camera.js / fx.js / input.js / hud.js (stub) / kartbox.js (fallback racer)** — see DESIGN.md.

## Measured

| thing | number |
|---|---|
| Bubbly Beach lap | 1004 m; AI laps easy 48–54 s, medium 43–49 s, hard 40–45 s |
| kid bot (no slides, sloppy line) | 1st on Easy, 7th on Hard (gate checks ≤3rd / >1st) |
| AI turbos per race (8 karts) | easy ~50, medium ~108, hard ~159; 0 respawns, 0 walls, max stuck 0.2 s |
| gate runtime | ~3.3 s for 3 full races + kid races |
| draw calls, start line 1280×800 | **151** (123 without shadows), 189k triangles |
| draw calls, alone mid-race | 57, 168k triangles |
| of which racers | ~12 calls each (characters agent), ≈ 96 at the grid |

Only the player's kart casts a real shadow; AI karts get a blob shadow (one instanced mesh) —
that cut the shadow pass from ~118 to ~28 calls. Karts beyond 230 m aren't drawn.

## Known gaps / next wave

- **Items**: kart fields exist (`stars, item, itemCount, shieldT, invincT`), `applyHit`/`addBoost`
  work (self-tested), `track.itemRows`/`starRows` are resolved positions. Nothing draws boxes or
  stars yet and `controls.item` is read but unused. Hook item logic in with `race.addSystem`.
- **AI**: no items, no personalities, no line variety beyond a lane offset. Finishing order
  follows the speed stat closely (King Dad, speed 5, tends to win) — worth a look once items exist.
- **UI**: title card and results are placeholders in index.html/hud.js; states are `boot, title,
  countdown, race, finished, results` via `setState`/`onState`. No settings screen yet
  (`input.settings.autoAccel` exists; `&auto=1`). Wrong-way indicator not done.
- **Tracks**: only beach is registered. The beach's lap is 1004 m; the S-bend after the landing
  (r≈18 m) is the tightest spot.
- **Audio**: all hooks called (count/go/VO, hop, land, drift_start + drift_loop, charge_red,
  turbo1-3, fizzle, overheat, pad, start_boost, wall, bump, respawn/splash, lap, final_lap,
  finish/win/lose, offroad loop, engines per kart, listener). Fast-forward (`t=`) is silent.
- Emoji don't render in the headless Chrome; HUD/touch use ★ ◆ ❚❚ instead.
- Blob shadows at +0.04 m above the road were invisible (lost the depth test, cause not pinned
  down — the road has polygonOffset −2); at +0.15 m they show. Screenshot any new road decal.
