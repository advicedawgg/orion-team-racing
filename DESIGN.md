# Orion Team Racing — design contract

The third Super Orion game: a **Crash Team Racing**-style kart racer for Orion (a young kid) and
his family. Sibling of Super Orion 1 (2D platformer, `advicedawgg/super-orion`) and Super Orion 2
(three.js 3D platformer, working copy `/home/ws/hub/so2`). Read `/home/ws/hub/so2/AGENTS.md` and
`/home/ws/hub/so2/README.md` once — this project inherits their house style and their habits:
**measure, don't assert; pure modules that a node gate can import; ship working and documented,
don't gold-plate.**

This file is the contract between the agents building it in parallel. If you change an
interface here, update this file in the same edit.

## Stack and layout

- three.js r185 vendored in `vendor/` (`three.module.js` + `three.core.js`), wired with an
  **import map** in `index.html` exactly like SO2. **No build step, no bundler, no npm runtime
  deps.** The repo is the deployable artifact (Cloudflare Worker static assets + Steam Deck
  local copy served over `http://localhost`, like SO2). `file://` is not supported.
- Dev server: `node tools/serve.mjs 8960` (no-store caching) — already running at
  **http://192.168.15.78:8960/** on the hub. Don't start another on the same port.
- Dev-only node deps (playwright-core etc.) may go in `devDependencies`; nothing under `src/`
  may import from `node_modules`.

```
index.html            import map, DOM for HUD/menus, CSS
src/main.js           boot, renderer, game loop, state machine wiring           (core)
src/physics.js        PURE kart dynamics: drive, hop, power slide, boosts, air (core)
src/track.js          PURE track model: spline, projection, laps, surfaces      (core)
src/race.js           PURE-ish race manager: countdown, laps, positions, finish (core)
src/ai.js             PURE AI driver (racing line, drifting, items)             (core → ai agent)
src/input.js          keyboard + Gamepad API + touch → abstract controls        (core)
src/camera.js         chase camera                                              (core)
src/fx.js             particles: drift sparks, exhaust flames, dust, skid marks (core)
src/trackmesh.js      track data → road/walls/terrain meshes                    (core → tracks agent)
src/tracks/*.js       one file per track (data only)                            (tracks agents)
src/scenery/*.js      per-theme scenery builders                               (tracks agents)
src/racers.js         roster + procedural kart & character models + animation  (characters agent)
src/items.js          item boxes, stars, weapons, projectiles, effects          (items agent)
src/hud.js            in-race HUD                                               (ui agent)
src/menu.js           title, mode/character/track select, results, podium       (ui agent)
src/audio.js          SFX + music + synthesized engines                          (audio agent)
src/save.js           localStorage save (unlocks, best times, settings)         (ui agent)
tools/check.js        THE GATE: track checks + headless 8-AI race sim           (core, extended by all)
tools/shot.mjs        screenshot through the GPU headless Chrome                 (core)
assets/tex|ui|sfx|audio|models   generated assets
```

"Owner" = who writes the file first. Others may make **small, surgical** edits to wire their
feature in (use exact-string Edit, re-read the file right before editing — other agents are
editing in parallel). Never rewrite or reformat a file you don't own.

## Units and conventions (everyone)

- 1 unit = 1 metre. Y up. Gravity 30 m/s² (arcadey, CTR karts are floaty-but-snappy).
- **Every model faces +Z.** Kart origin = ground contact, centred under the kart. A kart is
  ~1.7 m long, ~1.2 m wide.
- Heading `yaw` is rotation about +Y; forward vector = `(sin yaw, 0, cos yaw)`.
  `steer` is −1..+1 with **+1 = turn left** (yaw increasing).
- Pure modules (`physics.js`, `track.js`, `race.js`, `ai.js`, the logic half of `items.js`)
  must not import THREE or touch the DOM, so `tools/check.js` can run a whole race in node.
  Use plain `{x,y,z}` objects / small vec helpers there.
- Fixed-step simulation at **60 Hz** (`DT = 1/60`), rendering interpolated. The same step
  functions run in the browser and in the node gate.

## The feel (non-negotiable — this is what makes it CTR)

**Power slide + 3-stage turbo.**
- Two "shoulder" buttons, HOP_A and HOP_B (keyboard: `Space` and `Shift`; pad: RB and LB; also
  RT/LT are NOT shoulders — see Controls). Pressing either shoulder while steering = **hop**;
  landing with steer held = **power slide** in that direction. Slide persists while that
  shoulder is held; releasing it ends the slide.
- While sliding a **charge meter** fills (~0.9 s to full). The meter goes green → yellow → **red**
  in the last ~25%. Pressing the **other** shoulder while the meter is in the red window fires a
  **turbo** (stage 1 small, 2 medium, 3 big), resets the meter, and the slide continues. Up to
  3 turbos per slide. Pressing too early does nothing but resets? **No** — too early = fizzle
  (meter resets, no boost, black puff); letting it fill completely = **overheat** (black smoke,
  meter locked until slide ends). Too late / too early both show clear feedback.
- `easyBoost` (on by default in Easy difficulty and the kid-assist setting): wider red window
  (last 45%) and no overheat.
- Exhaust flame colour shows the charge: none → blue-white while charging → orange in the
  red window → purple flames during stage-3 turbo. The kart visibly swings out ~25–35° into the
  slide, counter-steer tightens/loosens the arc (steer into slide = tight, away = wide).
- **Boost reserve**: turbos add to a reserve (seconds) that decays; stacking turbos, pads, jump
  landings all feed it; it raises top speed above base (base ~22 m/s, boost cap ~30 m/s, "super"
  (10 stars) raises base by ~8%).
- **Hang-time turbo**: landing from ≥0.5 s of air gives a small turbo, ≥1.0 s a medium one.
- **Start boost**: press accelerate as "GO!" appears (window ~0.25 s around it) = turbo;
  mashing early = stall/spin briefly (CTR style; disabled on Easy).
- **Turbo pads** on tracks: instant medium turbo.

**The lean.** Racers lean INTO corners (body roll toward the turn centre, head looks into the
turn), exaggerate during a slide, bob on bumps, squash on landing, tuck forward during boosts,
flail when hit, cheer at the finish. The kart body rolls/pitches slightly with the suspension
and the wheels steer and spin. This is `animateRacer()` in `racers.js`.

**Karts are forgiving.** No damage model. Wall contact deflects and scrubs speed, never stops
you dead. Falling off the course (only possible on tracks that allow it) = a friendly helper
(Sootie on a cloud? a crane? owner's call) drops you back on the centre line within 1.5 s.

## Controls

| action | keyboard | gamepad (standard mapping) | touch |
|---|---|---|---|
| steer | ←/→ or A/D | left stick / d-pad | left-side ◀ ▶ buttons |
| accelerate | ↑ or W | A (0) or RT (7) | auto (always on for touch) |
| brake / reverse | ↓ or S | X (2) or LT (6) | ▼ button |
| hop / slide (shoulder A) | Space | RB (5) | ⤴ big button |
| turbo in slide (shoulder B) | Shift | LB (4) | ⚡ button |
| use item (hold ↓ to throw backward) | E or Enter | B (1) or Y (3) | 🎁 button |
| pause | Esc or P | Start (9) | ⏸ |
| mute / fullscreen | M / F | | |

Either shoulder starts a slide and the *other* one boosts, so both hands work. **Never bind
Ctrl** (Ctrl+W closes the tab — DAWG ARENA lost a week to it). `preventDefault` arrow keys and
Space so the page doesn't scroll. **Auto-accelerate** is a setting, default ON in Easy.

## Racers (characters agent)

8 racers, all unlocked from the start (it's for a young kid). Stats 1–5 each for `speed`,
`accel`, `turn`, summing to 9 (balanced) — physics maps them to small (±6%) deltas, never large.
Family first: **Orion** (the hero kid — match his look in SO2 `src/player.js`/`art.js`),
**Sootie** (the family's black cat — SO2 `art.js` SYMBOL.life: near-black #2b2431 with mint-green
eyes), **King Dad** (bald, short black beard, crown, TV remote — SO2 `world.js` king), **Mum**
(Gemma — the rescue character from SO1, repo advicedawgg/super-orion `1.html`), plus four
Super Orion baddies with strong silhouettes picked from SO2's `ENEMY` table (e.g. grumblin,
hardhat, jelly, zapdrone, flapjack, prickle, hopper).

Two model tiers:
1. **Procedural (always present)**: chunky N64/CTR-style low-poly built from boxes/cylinders/
   spheres with canvas-drawn texture atlases, like SO2's Orion. ~1–3k tris per racer incl. kart.
2. **HD (optional, charfab)**: AI-generated textured GLBs in `assets/models/<id>.glb`, rigged
   (mixamorig) or static. If present and the `hd` setting is on, `buildRacer` uses it; otherwise
   falls back to procedural. The game must run perfectly with no GLBs at all.

### Roster (as built — `src/racers.js` `RACERS`, order = menu order)

| id | name | speed/accel/turn | kart / accent / trim | source look | kart flourish |
|---|---|---|---|---|---|
| `orion` | Orion | 3/3/3 | blue `#2f6fdc` / yellow `#ffd23f` / red `#c22532` | SO2 `player.js` + `orionAtlas`: blue star hoodie (star on the back too), brown hair tuft, red shorts | red rocket fins (flight-suit red+gold), reactor headlight, hood star |
| `sootie` | Sootie | 2/3/4 | pink `#ff6fae` / mint `#8ff0b4` / fur `#2b2431` | SO2 `SYMBOL.life`: #2b2431 fur, mint slit eyes, pink nose, white whiskers; SO1's white chest | cat ears on the nose, paw print on the hood, fish-bone badge; her tail curls out over the right side |
| `kingdad` | King Dad | 5/2/2 | red `#d0342c` / gold `#ffd23f` / blue `#2f6fd0` | SO2 `world.js` king: bald, short black beard, crown, blue gown, TV remote in his right hand | **size 1.1** kart; velvet throne with gold arch + finials; crown on the nose |
| `mum` | Mum | 2/4/3 | purple `#9b59d0` / yellow `#ffe066` / lilac `#f4ecff` | SO1 `MUM_FRAMES`: long brown hair, purple dress `#c46fd4`, white shoes; flower in her hair | whitewall tyres, big flower on the hood, picnic basket |
| `grumblin` | Grumbles | 4/2/3 | orange `#ff8a2a` / green `#4caf50` / slate `#3a3f52` | SO2 grumblin: green box, big white eyes, cross brows, one tooth | spare tyre on the back, bolted patches |
| `jelly` | Wibble | 2/2/5 | aqua `#2ec4e0` / pink `#ff8ad8` / pale `#fff0fb` | SO2 jelly: translucent pink bell, pale cap, hot-pink tentacles; floats over the seat, steers with two tentacles | clam-shell seat, bubbles on the hood |
| `zapdrone` | Zappy | 2/5/2 | charcoal `#2d3142` / cyan `#8fe3ff` / yellow `#ffd23f` | SO2 zapdrone: grey octahedron, red eye (with a friendly glint), two spinning energy rings, antenna bobble; hovers | glowing cyan strips, hazard chevrons, tesla coil |
| `prickle` | Prickles | 4/3/2 | lime `#7ed957` / wood `#8a5a2b` / cream `#f7eccb` | SO2 prickle: brown ball, cream spikes (back + top only), cream face patch | leaf spoiler, acorn on the nose, wooden bumpers |

Blurbs are in `RACERS[i].blurb`. `getRacer(id)` returns the entry (falls back to Orion).

### Racer API details (beyond the stub in Cross-module APIs)

- `buildRacer(id, { hd })` → `{ root, rig }`. Hierarchy: `root` (core sets position + yaw incl.
  drift swing) → `rig.offset` (per-racer size) → `rig.flip` (hit flip / spin-out / wobble, pivot at
  the kart's middle) → `rig.base` → wheels + `rig.body` (= `rig.kart`, suspension) → `rig.driver`
  (hip pivot) → torso → head. Don't transform anything below `root` from outside.
- `rig.wheels` = 4 Object3D at the **wheel centres** `[frontL, frontR, rearL, rearR]` (L = +X);
  `wheel.userData.radius` gives the contact offset (ground = centre.y − radius, in kart space).
- `rig.exhausts` = 2 anchors at the pipe tips; each anchor's **local −Z** points out of the pipe
  (back and up). Flames/smoke go there.
- `rig.head` = head group (TNT-on-head: put things at its world position + ~`rig.headH·size`).
  If an HD driver loads, `rig.head` is re-pointed at the HD head tracker.
- `animateRacer(rig, s, dt)`: every render frame, any dt (springs are sub-stepped). Reads the
  DESIGN state fields plus optional `slowT` (TV-remote wobble). `s.t` optional (falls back to an
  internal clock). Landing squash / hop stretch are detected from `air` transitions (landT not
  required). `hitT` in (0,1) = flip + spin + pop-up of `rig.flip`; `spinT` (seconds left) spins
  it 2 turns/s so it lands at 0 when `spinT` reaches 0.
- `renderPortrait(id, size, { bg = true })` → cached canvas (head + shoulders, 3/4 front; `bg`
  paints a kart-colour disc with a white ring — pass `bg:false` for transparent). One shared
  offscreen renderer; `disposePortraits()` frees it.
- `racerStats(root)` → `{ tris, draws }`; `disposeTree(root)` frees per-racer geometry (materials
  are shared across all racers — never dispose them).
- Cost: **12–16 draw calls, ~2.4–3.3k tris per racer** incl. kart (King Dad is the 16: gold crown
  + throne). Materials: 4 shared (`racer-paint`, `racer-matte`, `racer-glow`, `racer-jelly`) +
  one 512×256 face atlas per racer. Colour lives in vertex colours.
- Preview: `racers.html` (`?grid=roster|poses|sheet|one&id=&pose=&cam=&p=&still=1`, header
  comment lists everything); screenshots: `node tools/shot-racers.mjs '<query>' out.png [W H]`.

## Items (items agent) — CTR's set, Orion-themed

Collected from breakable **? item boxes** (rows across the track, respawn 3 s). A roulette spins
~1.5 s. Distribution weighted by race position (leaders get defensive items, back-markers get
the good stuff, like CTR).

**Stars ⭐ = Wumpa fruit.** Rows/crates of stars on the racing line; holding **10 stars** makes
every item **Super** (juiced) and raises top speed slightly. Getting hit spills stars.

| item | CTR analogue | behaviour | super (10⭐) |
|---|---|---|---|
| Taco Bomb | bowling bomb | rolls forward along the track, explodes on contact/after range; hold ↓ to roll backward; press item again to detonate early | bigger blast |
| Cosmic Rocket | homing missile | homes on the racer directly ahead | 3 rockets |
| TNT Crate | TNT | dropped behind; lands ON the head of whoever hits it, 3-2-1 then boom unless they hop 5 times to shake it off | Nitro: explodes on contact |
| Ice Cream Splat | beaker | dropped puddle, causes a spin-out | bigger puddle |
| Bubble Shield | shield | absorbs one hit for 10 s; item button fires it forward | lasts longer |
| Turbo Rocket | turbo | big turbo | bigger/longer |
| Super Star | Aku Aku / Uka Uka | invincible + top speed 7 s, knocks others aside (Sootie's spirit orbits you) | longer |
| TV Remote | clock | "KING DAD PRESSED PAUSE!" everyone else spins/slows 3 s | longer |
| Warp Star | warp orb | flies along the course and hits the leader (and anyone in its path) | faster |

Hit reactions: bomb/rocket = kart flips up and spins (~1.2 s, lose ~3 stars); puddle = spin-out
(~1 s); remote = wobble slowdown.

## Tracks (tracks agents)

Built from a closed spline of control points, each with `{x, y, z, w (road width), bank}`, plus
per-segment tags. `track.js` samples it (every ~1 m) and answers `project(pos, hintS)` →
`{s, lat, y, normal, onRoad, surface, wall}`. Themes from the Super Orion worlds:

1. **Bubbly Beach** — easy, wide, gentle sweepers, a jump over a lagoon inlet, palm trees.
2. **Ice Cream Peaks** — snowy ice-cream mountain, hairpins that teach sliding, a big jump.
3. **Taco Volcano** — lava rivers, rock bridges, ramps, a tunnel through the volcano.
4. **King Dad's Castle** — courtyard + castle halls, banners of King Dad, tight technical turns.
5. **Star Road** (secret, unlocked by winning the Orion Cup) — rainbow road in space, can fall off.

A **lap** = crossing the start line after passing all checkpoints in order (the track defines
them as `s` values). 3 laps. Race positions from `(lap, s)`. Offroad (grass/sand/snow) slows
you (~35%) but never stops you; each track tags its offroad surface.

## Modes

- **Quick Race** (pick racer, track, difficulty) — 8 racers, 3 laps.
- **Orion Cup** (Grand Prix): tracks 1→4, points 10/8/6/5/4/3/2/1, podium at the end; winning
  unlocks Star Road.
- **Time Trial** (stretch): solo, best-lap ghost saved in localStorage.
- Difficulty: **Easy** (default; AI at ~85% pace, kid assist on), **Medium**, **Hard**.
  Mild rubber-banding on Easy/Medium so the race stays together.

## Verification (every agent)

- `node tools/check.js` — the gate. Must print PASS. It builds every track through the real
  `track.js`, checks geometry (closed, no self-overlap except tagged bridges, widths, item boxes
  and pads on the road, checkpoints ordered), and runs a **headless 8-AI race on each track**
  through the real `physics.js`/`ai.js`/`race.js`: every AI finishes 3 laps within a time
  limit, nobody is stuck > 3 s, lap times are sane. Add your own checks to it.
- `node src/physics.js` — physics self-test (slide/turbo timing, top speeds, hang-time boost).
- Visual: `node tools/shot.mjs '<url query>' <out.png>` screenshots through the **GPU headless
  Chrome on Unraid** (CDP `http://192.168.15.100:9333`, real WebGL on an Arc B60 — see memory
  `reference_gpu_headless_browser`). **Always close your page in a `finally`** — leaked tabs
  hold VRAM. It is vsync-locked: rAF timing is meaningless there. The GPU Chrome reaches the hub
  dev server at `http://192.168.15.78:8960/`. Look at your screenshots (Read the PNG) — a
  feature isn't done until you've seen it.
- URL debug params (core provides, all extend): `?track=beach&racer=orion&skip=1` jumps straight
  into a race, `&cam=x,y,z,tx,ty,tz` pins the camera, `&t=12` fast-forwards the sim 12 s with AI
  driving the player, `&ai=1` lets AI drive the player, `&hud=0`. `window.__OTR` exposes game
  state for tests.

## Hard-won rules inherited from the sibling projects

- three.js compiles a shader per material×light-count the first time it's drawn: **never
  add/remove/hide lights at runtime** (keep a fixed pool, set intensity 0), and warm up with
  `renderer.compileAsync(scene, camera)` before the race starts.
- A textured material multiplies colour by the texture's luma — a dark texture turns bright
  colours brown. Check it in a screenshot.
- `MeshBasicMaterial` + `toneMapped:false` for things that must keep their colour (HUD-ish
  world signs, item glows).
- Draw calls are the budget on the Steam Deck: merge static scenery per material, instance
  repeated props (palms, cones, stars, item boxes).
- Everything must work on keyboard, pad (Steam Deck 1280×800) and touch.
- Kid-first: big readable text, no reading required to play, nothing scary, generous timing.

## Cross-module APIs (stubs exist from the start so nobody blocks on anybody)

**`src/audio.js`** (audio agent owns; core calls it; every call must be safe before assets load
and when muted):
```js
export const audio = {
  init(),                 // idempotent; creates AudioContext lazily
  unlock(),               // call on first user gesture (keydown/pointerdown/gamepad press)
  play(name, { vol=1, rate=1, pan=0, at=null /* {x,y,z} world pos for distance falloff */ } = {}),
  music(name | null),     // crossfade to a track by name ('title','beach','ice','volcano','castle','star','results'), null = stop
  engineStart(id, isPlayer), engineUpdate(id, { speed, maxSpeed, throttle, drift, boost, air, pos }), engineStop(id),
  listener(pos, forward), // camera for distance falloff
  setVolumes({ master, music, sfx }), toggleMute(), muted,
};
```
SFX names used by the game (audio agent provides all; unknown names are a silent no-op):
`countdown, go, hop, land, drift_start, drift_loop, charge_red, turbo1, turbo2, turbo3, fizzle,
overheat, pad, start_boost, wall, bump, offroad, star, item_box, roulette, item_get, bomb_roll,
explode, rocket, rocket_lock, tnt_drop, tnt_on_head, tnt_tick, nitro, splat, spinout, shield_up,
shield_pop, super_star, remote, warp, flip, lap, final_lap, finish, win, lose, menu_move,
menu_ok, menu_back, respawn` plus announcer VO: `vo_3, vo_2, vo_1, vo_go, vo_final_lap,
vo_you_win, vo_orion_wins …` (see audio.js for the full list once written).

**`src/racers.js`** (characters agent owns):
```js
export const RACERS = [{ id, name, blurb, stats: { speed, accel, turn }, colors: { kart, accent, trim } }, …];
export function buildRacer(id, { hd = false } = {}) // -> { root: THREE.Group, rig }  (sync; HD may swap in later)
export function animateRacer(rig, s, dt)
//  s = { speed, maxSpeed, steer (-1..1,+left), throttle, drift (-1|0|1), driftAngle (rad),
//        charge (0..1), boostT (s), air (bool), airT, landT (s since landing), hitT (0..1 flip/spin progress),
//        hitKind, spinT, cheer (bool), sad (bool), t (s) }
//  rig.exhausts : Object3D[]  (world anchors for flames), rig.wheels : Object3D[] (for skid marks),
//  rig.head : Object3D (for TNT-on-head), rig.body
export function renderPortrait(id, size) // -> HTMLCanvasElement (offscreen render, for HUD/menus)
```

**Kart state** (`physics.js`, core owns — other modules read these fields, and items add
effects through `physics.applyHit(kart, kind)` / `physics.addBoost(kart, secs, tier)`):
`pos, vel, yaw, speed, steer, drift, driftAngle, charge, turbos, boostT, air, airT, onRoad,
surface, stars, item, itemCount, shieldT, invincT, hitT, hitKind, spinT, slowT, s, lap,
lapsDone, place, finished, finishTime, racerId, isPlayer`.
