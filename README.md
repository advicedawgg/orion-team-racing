# Orion Team Racing

A Crash Team Racing-style kart racer for Orion (a young kid) and his family: the third Super
Orion game, after Super Orion 1 (2D platformer) and Super Orion 2 (3D platformer). Eight
racers, five tracks, the CTR power slide with 3-stage turbos, a full set of silly items, the
Orion Cup, Time Trial with ghosts, and an announcer. No reading is needed to play: title,
Quick Race, racer, track is four presses of A.

It is plain ES modules and three.js r185 (vendored), with no build step. The repo is the
deployable artifact.

![tour](shots/tour.jpg) *(`shots/tour.jpg` is local only; `shots/` isn't committed)*

## Run it

```sh
node tools/serve.mjs 8960        # no-cache static server; any static server works
# open http://localhost:8960/
```

`file://` doesn't work because ES modules need http. On the Steam Deck, copy the repo, serve it
over `http://localhost` and open it in the browser (full-screen with **F**). The Deck's controls
show up as a standard Xbox 360 pad.

Handy URLs:
- `?track=castle&racer=kingdad&skip=1` jumps straight into a race.
- `&diff=hard`, `&ai=1` (the AI drives you), `&t=30` (fast-forward), `&laps=1`, `&hud=0`.
- `&q=low|high|auto` sets graphics quality. `&hd=1` turns on the HD racer models.
- `?screen=podium|select|tracks|settings|…` opens one menu screen.

The full list is in DESIGN.md under "Verification".

## Controls

| action | keyboard | gamepad (Steam Deck / Xbox) | touch |
|---|---|---|---|
| steer | ← → or A D | left stick / d-pad | ◀ ▶ |
| go | ↑ or W (or AUTO-GO) | A or RT | automatic |
| brake / reverse | ↓ or S | X or LT | ▼ |
| hop + power slide | Space | RB | ⤴ |
| turbo during a slide (when the bar is red) | Shift | LB | ⚡ |
| use item (hold ↓ to throw it backwards) | E or Enter | B or Y | ◆ |
| pause | Esc or P | Start | ❚❚ |
| mute / full-screen | M / F | | |

Either shoulder starts a slide and the other one fires the turbo, so both hands work. Up to three
turbos per slide gives an ULTRA TURBO. Nothing is bound to Ctrl, and arrows and Space never
scroll the page.

## Modes

- **Quick Race**: pick a racer and a track, 8 karts, 3 laps. Easy, Medium or Hard is picked on
  the main menu. Easy is the default.
- **Orion Cup**: Bubbly Beach, Ice Cream Peaks, Taco Volcano, then King Dad's Castle. Points go
  10/8/6/5/4/3/2/1 and the cup ends on a 3D podium. Winning it unlocks **Star Road**.
- **Time Trial**: you race alone with no items. Your best race is saved as a ghost.
- **Settings**:
  - volumes
  - AUTO-GO (drive forward by itself: on in Easy by default)
  - KID HELPER (easy turbos, no overheating)
  - FANCY RACERS (HD models)
  - GRAPHICS (AUTO / FANCY / FAST, see Performance below)

## Tracks

| track | theme | notes |
|---|---|---|
| Bubbly Beach | palms, lagoon jump | easy, wide sweepers |
| Ice Cream Peaks | strawberry snow, candy canes | hairpins that teach sliding, the Cherry Scoop jump |
| Taco Volcano | lava, cacti, papel picado | two lava leaps, the Taco Tunnel, the Rock Bridge (you can fall in) |
| King Dad's Castle | twilight, bunting | Great Hall, spiral ramp round the Remote Tower, battlements, moat jump, hedge maze |
| Star Road *(secret)* | rainbow road in space | the helix, the Moon Loop, open edges |

## Racers

| racer | speed / zoom / turn | |
|---|---|---|
| Orion | 3/3/3 | the hero, a rocket-powered kid |
| Sootie | 2/3/4 | the family cat |
| King Dad | 5/2/2 | big, fast, has the TV remote |
| Mum | 2/4/3 | smooth and speedy off the line |
| Grumbles | 4/2/3 | grumpy green gremlin |
| Wibble | 2/2/5 | wobbly jellyfish |
| Zappy | 2/5/2 | buzzy robot |
| Prickles | 4/3/2 | spiky burr-hog |

**Items** come out of ? boxes: Taco Bomb, Cosmic Rocket, TNT (hop 5 times to shake it off) and
Nitro, Ice Cream Splat, Bubble Shield, Turbo Rocket, Super Star, King Dad's TV Remote (pauses
everyone) and Warp Star. **Stars** work like Wumpa fruit: 10 of them make you Super.

## The gates

```sh
node src/physics.js      # physics self-test: slide/turbo timing, top speeds, hang time → PASS
node tools/check.js      # THE GATE: every track's geometry + 8-AI races on every difficulty + item checks → PASS
```

Both run in plain node, with no browser. Browser checks run through the GPU headless Chrome on
Unraid (CDP `http://192.168.15.100:9333`; the dev server must be reachable from it):

```sh
node tools/realflow.mjs          # the whole game in ONE page session, driven by real keys
                                 # (title → race → results → next → Orion Cup ×4 → podium → unlock → Star Road);
                                 # checks memory, engines, pause, compile hitches
node tools/input-test.mjs        # fake Xbox pad + keyboard in a race: steer/slide/turbo/item/pause, no scroll, no Ctrl
node tools/leakcheck.mjs 2       # switch through all 5 tracks twice: geometries/textures must stay flat
node tools/playtest.mjs [tracks] [--perf] [--throttle 4] [--query q=low]
                                 # AI-driven live race per track: chase shots every 4 s + contact sheet,
                                 # --perf = draw calls / tris / CPU ms in render() / GPU ms (timer query)
node tools/ui-test.mjs screens|flow|cup|hud|tt|pad|tap [--size 844x390 --touch]   # menus/HUD
node tools/shot.mjs '<query>' out.png [--eval js] [--info]                          # one screenshot
```

## Performance (Steam Deck, 1280×800)

Measured on the GPU headless Chrome on an Arc B60. The box is vsync-locked, so the numbers are
GPU timer queries and CPU time inside `renderer.render()`, not frame rate
(`tools/playtest.mjs --perf`).

| track | draw calls (start grid) | draw calls mid-race p50/max | ktris mid | render() CPU ms p50 | GPU ms p50 |
|---|---|---|---|---|---|
| Bubbly Beach | 158 | 60 / 74 | 184 | 2.2 | 0.68 |
| Ice Cream Peaks | 151 | 58 / 68 | 307 | 1.8 | 0.71 |
| Taco Volcano | 151 | 68 / 104 | 269 | 1.9 | 0.72 |
| King Dad's Castle | 167 | 71 / 97 | 303 | 2.4 | 0.80 |
| Star Road | 149 | 62 / 73 | 130 | 1.8 | 0.62 |

The whole game frame (input, sim, particles, HUD and render) takes 2–2.5 ms of CPU at p50.

**GRAPHICS** setting (`src/main.js` `QUAL`):
- **FAST** renders at 0.85 scale with no real-time shadow (the player gets a blob shadow like
  everyone else), half the particles, and draws AI karts out to 150 m instead of 230 m. On the
  castle that is 141 draw calls at the grid (down from 167), 48 mid-race (down from 71), and GPU
  0.68 ms (down from 0.86).
- **AUTO** starts at FANCY and switches to FAST for the rest of the session if the median frame
  time stays above ~20 ms for 4 s of racing.

A cold start downloads about 5 MB to reach the title screen and about 9 MB to reach the first
race. Music is fetched per track, when it's needed.

## Files

```
index.html            import map, canvas, HUD/menu roots, touch buttons
ui.css                HUD + menu styles
src/main.js           boot, renderer, loop, state machine, quality, race start/teardown
src/physics.js        PURE kart physics (+ self-test)       src/track.js     PURE track model
src/race.js           PURE race manager                      src/ai.js        PURE AI driver
src/items.js          PURE item sim + AI item brain          src/itemviews.js item meshes/fx/sounds
src/input.js          keyboard + Gamepad API + touch         src/camera.js    chase camera (wall/tunnel clamp)
src/fx.js             particles + skid marks (2+1 draw calls)
src/trackmesh.js      track → road/walls/terrain/sky meshes, texture loader
src/scenery/*.js      per-theme props (beach, ice, volcano, castle, star; kit.js/propkit.js helpers)
src/tracks/*.js       track data (one file each) + index.js registry
src/racers.js         8 procedural racers + animation         src/hdracers.js  optional HD driver models
src/hud.js src/itemhud.js src/menu.js src/save.js    HUD, menus, save (localStorage)
src/audio.js          SFX, VO, music, synthesised engines
vendor/               three.js r185 (+ GLTFLoader, meshopt)
assets/               tex/ sfx/ audio/ ui/ models/ (generated art, sound, music, HD models)
tools/                gates, browser drivers, asset generators (not shipped)
DESIGN.md             the contract between modules: read it before changing an interface
AGENTS.md             the short version for whoever works on this next
```

## Deploying

The Cloudflare Worker static-assets setup is ready (`wrangler.jsonc`, worker
`orion-team-racing`), the same as Super Orion 2. `.assetsignore` ships only `index.html`,
`ui.css`, `src/`, `vendor/` and `assets/`, which comes to about 40.7 MB in 234 files. It
hasn't been deployed. Run `npx wrangler deploy` when it should be, and add a custom domain in
`wrangler.jsonc`.

About 20 MB of that is audio duplicates that most players never download:
- **MP3 copies** (13 MB) of every Opus track, for browsers without Opus.
- **Super Orion 2 fallback tracks** (`*.so2.*`, 7.5 MB), used if a track fails to load.

`audio.js` lists all of them as fallbacks, so they stay. Dropping them would shrink the deploy
but not what a player downloads.
