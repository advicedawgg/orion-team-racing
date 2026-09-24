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
src/tracks/index.js   track registry (TRACKS) — the gate races every entry      (core; tracks agents append)
src/scenery/*.js      per-theme scenery builders (beach.js: core placeholder)  (tracks agents)
src/kartbox.js        box-kart fallback if racers.js is missing/broken          (core)
src/racers.js         roster + procedural kart & character models + animation  (characters agent)
src/items.js          item boxes, stars, weapons, projectiles, effects          (items agent)
src/hud.js            in-race HUD (core wrote a minimal stub first)             (ui agent)
src/menu.js           title, mode/character/track select, results, podium       (ui agent)
src/audio.js          SFX + music + synthesized engines                          (audio agent)
src/save.js           localStorage save (unlocks, best times, settings)         (ui agent)
tools/check.js        THE GATE: track checks + headless 8-AI race sim           (core, extended by all)
tools/shot.mjs        screenshot through the GPU headless Chrome                 (core)
tools/slide-test.mjs  scripted power slide in the real browser, 3 turbos + shots (core)
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
per-segment tags — see **Track data format** below (the contract for tracks agents). `track.js`
samples it (every ~1 m) and answers `project(pos, hint)` → `{i, s, lat, y, cy, onRoad, surface,
hw, limL, limR, wallL, wallR, gap, tx, tz, lx, lz, tb, slope, noRespawn, tunnel}`. Themes from the
Super Orion worlds:

1. **Bubbly Beach** — easy, wide, gentle sweepers, a jump over a lagoon inlet, palm trees.
2. **Ice Cream Peaks** — snowy ice-cream mountain, hairpins that teach sliding, a big jump.
3. **Taco Volcano** — lava rivers, rock bridges, ramps, a tunnel through the volcano.
4. **King Dad's Castle** — courtyard + castle halls, banners of King Dad, tight technical turns.
5. **Star Road** (secret, unlocked by winning the Orion Cup) — rainbow road in space, can fall off.

A **lap** = crossing the start line after passing all checkpoints in order (the track defines
them as `s` values). 3 laps. Race positions from `(lap, s)`. Offroad (grass/sand/snow) slows
you (~35%) but never stops you; each track tags its offroad surface.

## Track data format (core owns; tracks agents author against it)

A track is **one data-only module** `src/tracks/<id>.js` exporting a plain object, registered in
`src/tracks/index.js` (import it, append to `TRACKS`; the gate then races it). Worked example:
`src/tracks/beach.js`. Everything is metres; the loop is closed automatically (don't repeat point 0).

```js
export default {
  id: 'beach', name: 'Bubbly Beach', theme: 'beach',   // theme → src/scenery/<theme>.js + trackmesh THEMES
  music: 'beach', laps: 3,
  width: 17,                    // default road width (per-point `w` overrides, smoothly interpolated)
  offroad: 'sand',              // default offroad surface name (physics SURFACES in track.js: sand, grass,
                                //   snow, mud, dirt, ice, rock, lava, space — add yours there with a speed factor)
  defaults: { offL: 9, offR: 9, wallL: 'fence', wallR: 'fence' },   // inherited props, see below
  env: { skyTop, skyHorizon, fog, fogNear, fogFar, sunDir: [x,y,z], sunColor, sun, hemiSky, hemiGround, hemi,
         clouds: true },        // all optional; trackmesh THEMES[theme] gives the defaults
  tex: { road: 'road_beach', ground: 'sand', water: 'water', <surfaceName>: '<texName>' },   // optional
  water: { y: -1.4, color, tint },   // optional sea/lake plane. Touching it off-road = rescue. Omit for none.
  terrain: { base: 0.2, shore: 70, dunes: 1.6, cell: 4.5, grass: { above: 1.6, color },
             carve: [{ type: 'lake', x, z, r, depth }, { type: 'channel', pts: [[x,z],…], w, depth }] },
  points: [ { x, z, y, w, bank, …inherited props }, … ],   // DRIVING ORDER. Point 0 = start line.
  start: 0,                     // optional: `at` of the start line (default point 0)
  gaps:  [{ from: 12.06, to: 12.4 }],      // no road here (jump over water/void); needs a jump lip just before
  jumps: [{ at: 12.04, vy: 9 }],           // ramp lip: a kart crossing it on the road is launched at ≥ vy m/s up
  pads:  [{ at: 11.45, lat: 0, len: 7, w: 4.5 }],          // turbo pads (medium turbo)
  items: [{ at: 1.3, n: 4, lat: 0 }],      // item-box ROWS across the road (n defaults from width)
  stars: [{ at: 7.1, lat: 4.5, n: 6, spacing: 3.5, curve: 1.5 }],   // star rows ALONG the road (curve = sideways bow, m)
  checkpoints: [2.5, 6, 9.5, 14],          // optional `at`s; default = checkpointCount (8) evenly spaced, never in a gap
  noRespawn: [{ from, to }],               // optional stretches where the rescue must not drop you
};
```

**Positions along the track are authored as `at` = control-point index + fraction** (`12.5` =
halfway from point 12 to point 13) — you think in your own points, not in metres. `track.sOf(at)`
converts to `s` (metres from the start line).

**Control points** `{ x, z, y=0, w=width, bank=0 }`: centripetal Catmull-Rom through all of
them. `y` = road height (hills, ramps); `bank` in **degrees, + = leans into a LEFT turn** (left
edge low). Banking pivots on the low (inside) edge, which stays at `y`; the outside rises.
Beyond the road edges the offroad stays level at the edge height. `+x` is to the LEFT of a kart
driving `+z` (Y up, forward = `(sin yaw, 0, cos yaw)`, left = `(fz, 0, −fx)`, `lat` + = left).

**Inherited props** — set on a point, they hold for every following segment until changed
(like a pen), starting from `defaults`:
| prop | meaning |
|---|---|
| `offL`, `offR` (`off` = both) | metres of drivable offroad beyond each road edge, then the boundary |
| `wallL`, `wallR` (`wall` = both) | boundary kind: a visible style (`fence`, `beach`, `wood`, `rock`, `ice`, `castle`, `neon` — `WALLS` in trackmesh.js, add yours), `'none'` = invisible wall, `'fall'` = no boundary, you can fall off (Star Road) |
| `surfL`, `surfR` (`surf` = both) | offroad surface name for that side |
| `kerb` | `'auto'` (default: red/white kerbs where the corner is tighter than r≈55 m), `true`, `false` |
| `bridge` | this stretch may pass over/under another stretch (≥5 m apart vertically) |
| `tunnel` | roof over the road (flag only — scenery draws it) |

**Resolved model** (`buildTrack(def)`): `length, n, ds` and per-sample typed arrays `X Y Z TX TZ
TY HW TB CURV HEAD AIL OFFL OFFR FLAG U` (AIL = AI racing-line lateral offset; FLAG bits: 1 gap,
2 bridge, 4 noRespawn, 8 tunnel, 16 jump run-up); `props[k]` (inherited props); `pads`,
`jumps`, `gaps`, `checkpoints` (s), `grid` (8 slots `{s, lat, x, y, z, yaw}`, 0 = pole,
two-wide staggered), and for the **items agent**:
- `itemRows: [{ s, slots: [{ lat, x, y, z }] }]` — put an item box at each slot (y = road surface).
- `starRows: [{ s, points: [{ s, lat, x, y, z }] }]` — put a star at each point.

Helpers: `project(pos, hint, out?)`, `pointAt(s, lat)` → `{x,y,z,yaw}`, `frameAt(s)` → `{x,y,z,
tx,tz,lx,lz,hw,tb,yaw,k}`, `sOf(at)`, `idx(s)`, `wrapS(s)`, `dS(a,b)` (signed shortest), 
`respawnS(s)`, `turnAhead(s, a, b)` (heading change between s+a and s+b), `bounds`, `water`,
`killY`. The gate checks: closed, 600–2000 m, widths 9–30, no self-overlap, slopes ≤35%,
radius ≥10 m, pads/items/stars/grid on the road, every gap has a lip and is clearable at
≤14 m/s, and an 8-AI race on easy/medium/hard finishes with nobody stuck.

**Authoring tips (measured on Bubbly Beach):** base speed 22 m/s, so a ~1000 m lap is ~45 s.
Corners of radius 25–45 m over 120°+ are the satisfying 3-turbo slides; radius < 20 m with a
17 m road is a wall-banger for kids. Put a turbo pad ~30 m before a jump so everyone clears it;
`vy` 9 over a 9 m gap gives ~0.7 s air (≥0.5 s = hang-time turbo). Keep `off` ≥ 5 on easy
tracks — the sand is the forgiveness. Iterate with `node tools/check.js <id>` and an overview
shot: `node tools/shot.mjs 'track=<id>&skip=1&hud=0&cam=x,y,z,tx,ty,tz' shots/o.png`.

### Scenery hook (tracks agents)

`src/scenery/<theme>.js` default-exports `build(ctx)` (may be async) → optional `{ update(dt, t) }`.
A missing file is fine. `ctx = { THREE, group (add your meshes here), track, def, env, rng
(seeded), loadTex(name, fallbackCanvasFn?, {repeat, file, onload}), groundAt(x,z) (terrain height),
trackGroundAt(x,z) (road/offroad height where drivable, else terrain), isClear(x,z,r,margin)
(outside the drivable corridor — never block the road), aboveWater(x,z,h), corridorInfo(x,z),
bounds {x0,z0,x1,z1} }`. **Instance** repeated props, **merge** one-offs per material, and put
props ON `groundAt` (nothing floats). `src/scenery/beach.js` is a worked example (palms,
umbrellas, rocks, lighthouse, huts, boats, bunting ≈ 10 draw calls).

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
  driving the player, `&ai=1` lets AI drive the player, `&hud=0`. Also `&diff=easy|medium|hard`,
  `&slot=0..7` (player grid slot, default 6), `&laps=N`, `&seed=N`, `&touch=1` (force touch UI),
  `&auto=1` (auto-accelerate), `&hd=1`, `&shadows=0`, `&fx=0`. `window.__OTR` exposes game
  state for tests (see **Core runtime APIs**).
- `node tools/slide-test.mjs` drives the player through a real power slide in the browser
  (3 perfect turbos) and screenshots each flame colour to `shots/slide/`.

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
  engineStart(id, isPlayer, racerId?), engineUpdate(id, { speed, maxSpeed, throttle, drift, boost, air, pos,
               /* optional: */ charge, offroad, racerId }), engineStop(id), enginesOff(),
  listener(pos, forward), // camera for distance falloff
  setVolumes({ master, music, sfx }), toggleMute(), muted,
  // added by the audio agent (all optional, all safe): see "## Audio" at the end of this file
  pause(on), bark(racerId, kind), preloadMusic(name), volumes, loaded,
};
// play() returns a handle { stop(fadeSec), set({ vol, rate, at, pan }), playing }; opts also take
// loop:true (for drift_loop/offroad/bomb_roll) and delay (s).
```
SFX names used by the game (audio agent provides all; unknown names are a silent no-op):
`countdown, go, hop, land, drift_start, drift_loop, charge_red, turbo1, turbo2, turbo3, fizzle,
overheat, pad, start_boost, wall, bump, offroad, star, item_box, roulette, item_get, bomb_roll,
explode, rocket, rocket_lock, tnt_drop, tnt_on_head, tnt_tick, nitro, splat, spinout, shield_up,
shield_pop, super_star, remote, warp, flip, lap, final_lap, finish, win, lose, menu_move,
menu_ok, menu_back, respawn` plus announcer VO: `vo_3, vo_2, vo_1, vo_go, vo_final_lap,
vo_you_win, vo_orion_wins …` — full lists in **## Audio** below.

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
effects through `physics.applyHit(kart, kind)` / `physics.addBoost(kart, secs, tier, kick)`):
`pos, vel, yaw, speed, steer, drift, driftAngle, charge, turbos, boostT, air, airT, onRoad,
surface, stars, item, itemCount, shieldT, invincT, hitT, hitKind, spinT, slowT, s, lap,
lapsDone, place, finished, finishTime, racerId, isPlayer`. Units/meaning:
- `yaw` = direction of TRAVEL; the body is drawn at `yaw + drift·driftAngle` (the slide swing).
  `speed` signed m/s along yaw; `vel` world m/s (incl. `push`, the decaying side-shove from walls
  and bumps); `vy`, `air`, `airT` (s in the air), `landT` (s since landing), `hop` (this air is a hop).
- slide: `drift` −1/0/+1 (+ = left), `driftBtn` 'a'|'b', `charge` 0..1, `inRed`, `turbos` 0..3
  this slide, `overheat`, `fizzleT` (s of smoke left).
- boost: `boostT` reserve seconds (decays 1/s, raises top speed, cap 3 s), `boostTier` 1..3
  (3 = purple flames).
- hits: `hitT` = **seconds left** of a flip (`hitDur` total; main passes progress `1 − hitT/hitDur`
  to animateRacer), `spinT` seconds left of a spin-out, `slowT` wobble seconds, `stallT` start stall,
  `shieldT`, `invincT` (super star: immune + knocks others aside + top speed), `stars` (≥10 = +8% top).
- track/race: `s`, `si` (sample hint), `lat`, `ground` (surface y under the kart), `nrm` (smoothed
  ground normal), `lap` (1-based current), `lapsDone`, `nextCp`, `progress` (m, for positions),
  `place`, `finished`, `finishPlace`, `finishTime`, `lapTimes[]`, `frozen` (grid), `respawnT` /
  `respawnAt` (rescue in progress and where it drops you), `ctrl` (last control used).
- `ev[]` — this step's events (strings or `[name, value]`), see Core runtime APIs.

## Core runtime APIs

**`physics.js`** (pure): `DT`, `T` (every tuning number — read these, don't copy them),
`createKart({racerId, stats, isPlayer, easyBoost, pace, index})`, `placeKart(k, slot, track)`,
`stepKart(k, ctrl, track)`, `collideKarts(karts)`, `topSpeed(k)`, `baseTop(k)`, `redStart(k)`,
`addBoost(k, secs, tier=1, kick=3)` (reserve + an instant speed kick), `applyHit(k, 'flip'|'spin'|
'wobble')` → true if it landed (false if shielded/invincible; a shield pops), `beginRespawn(k, why,
track, atS?)`. Control object (player and AI alike): `{ steer (−1..1, +left), throttle 0..1, brake
0..1, hopA, hopB }` (shoulders are HELD booleans; physics does its own edge detection).
Kart events (`k.ev`): `hop, land (air s), drift_start, drift_end, charge_red, turbo1, turbo2,
turbo3, fizzle, overheat, pad, ramp, hang1, hang2, wall (0..1), bump (0..1), respawn ('splash'|
'fall'), respawned, hit (kind), stars_lost (n), shield_pop`.

**`race.js`** (pure): `createRace({ track, entrants: [{racerId, stats}], playerIndex (−1 = all AI),
difficulty, laps, seed, easyBoost, noStall })` → `race` with `karts, brains, player, phase
('countdown'|'race'|'done'), t (s; negative during the countdown), order (by place), laps,
stats[] (per-kart gate stats), autoPlayer (AI drives the player)`, `race.step(playerCtrl)`,
`race.events` (this step: `{type:'count', n}`, `{type:'go'}`, `{type:'lap', kart, lap}`,
`{type:'final_lap', kart}`, `{type:'finish', kart, place}`, `{type:'race_done'}`, `{type:'stall',
kart}`, `{type:'kart', kart, e, v}` for every kart event incl. `start_boost`),
`race.addSystem(fn(race, dt))` (**items agent: hook item logic here** — runs every step after
physics and kart bumping, before laps), `race.results()`. `simulate(race, {maxT, playerCtrl, onStep})`
runs a whole race headless. Countdown = 3.6 s; start boost window −0.25..+0.1 s around GO
(early mash = stall, not on Easy). After the player finishes the AI drives their kart; the race is
called 20 s later (unfinished karts get estimated times).

**`ai.js`** (pure): `DIFFICULTY` table (pace, P(slide), P(turbo), reaction, start boost, rubber
band), `createBrain(kart, track, difficulty, seed)`, `drive(brain, race)` → control object.

**`main.js`**: `setState(name)` / `onState(fn(state, prev))` — states `boot, title, countdown,
race, finished, results` (the UI agent's menus hook here; `title` is a placeholder card).
`window.__OTR`: `ready, state, race, track, player, G, scene, camera, renderer, chase, fx, audio,
T, DT, override(ctrl|null)` (drive the player), `advance(secs)` (fast-forward, silent),
`script(n, fn(k,i) → ctrl, {draw})` (step n frames with scripted controls; returns the player's
kart events), `hold(bool)` (freeze the live loop), `render()`, `info()` (`renderer.info` calls/
triangles), `loadTrack(id)`, `startRace()`.

**`hud.js`** (core stub → UI agent): `createHud(el)` → `{ show(bool), update(view), count(n|'GO!'|null),
banner(text, ms, cls), results(rows|null) }`; `view` = `{lap, laps, place, speed, charge, redStart,
inRed, drift, overheat, turbos, boostT, boostMaxT, stars, finished, raceTime}`.

**`input.js`**: `update()` once per frame; `controls` (same shape as the control object + `item`),
`hit(name)` edges (`hopA hopB item pause mute fullscreen confirm back up down left right`),
`settings.autoAccel`, `initTouch()` wires `[data-btn]` elements, `onGesture(fn)` (audio unlock).

**`trackmesh.js`**: `buildTrackMesh(track)` → `{ group, env, sky, groundAt, isClear, aboveWater,
update(dt,t) }`; `loadTex(name, fallback, opts)` (instant procedural canvas, upgrades to
`assets/tex/<name>.jpg|png` when it loads); `PROC` (procedural textures), `THEMES`, `WALLS`,
`mergeGeos(geos)`.

**`fx.js`**: `createFx(scene)` → `{ kart(k, rig, dt, camPos), burst(kind, pos, opts), update(dt, camera),
clearSkids() }`; burst kinds `land poof fizzle overheat wall splash turbo pad sparkle`; `FLAME`
colours. Two particle draw calls + one skid-mark mesh; no lights.

## Audio (audio agent)

Files: `src/audio.js` (runtime), `tools/gen-sfx.mjs` / `gen-vo.mjs` / `gen-music.mjs` (ElevenLabs,
key read from `/home/ws/studio/.env`, never printed), `tools/audio-lib.mjs` (shared trim/normalise/
index helpers), `tools/looppoints.mjs` (SO2's loop finder as a module), `tools/sfx-qa.mjs` (an
audio model "listens" and scores each file vs its prompt), `tools/mixprobe.mjs` (decode gate + mix
table), `audio-test.html` (button bench: every SFX/VO/music, engine sliders, 6 orbiting AI karts,
auto-drive demo; shift-click = hear the synth fallback). Assets: `assets/sfx/*.mp3` +
`assets/sfx/index.json`, `assets/audio/*.ogg|mp3` + `assets/audio/index.json`. Raw API responses in
`tools/sfx-raw/` (music raws in `tools/sfx-raw/music/`) so `--force` re-processing is free; `--regen`
re-bills and needs explicit names.

**Graph** (DAWG ARENA's measured lessons): one-shots, engines and VO → `sfxBus` (user SFX fader) →
`sfxOut` (master) → 4x-oversampled tanh **soft clipper** (linear below 0.72) → out. Music: `<audio>`
decks → `musicDuck` → `musicBus` (user music fader) → `musicOut` (master) → out — its own path, never
through the clipper. The same `buildMix()` builds the live graph and mixprobe's offline copy, so the
probe can't drift from the game. Balance = `TRIM` (dB per sound) in audio.js; files are mastered by
the generators to a per-category **loudest-100 ms** target (impacts -10, turbos -11..-13, pickups/
movement -15/-16, UI -16..-18, VO -14), synth fallbacks to the same targets.

**Measured mix** (`node tools/mixprobe.mjs`, output dBFS through the real graph, default faders
master 0.9 / music 0.7 / sfx 1): SFX loud100 median -19.4 (turbo3 -15.4, explode -14.4, menu blips
-24); VO -16.4 (sits on top, ducks music to 70%); player engine bed -23 dB rms at speed (-33 idle);
AI engine -25 @5 m, -33 @15 m, -42 @40 m; music -25..-26 dB rms (tracks normalised to -18 LUFS);
spatial explode -17.7 @10 m, -27.7 @30 m, -33.7 @60 m, culled >110 m. Player turbos/pads/super star/
explosions duck the music 20-40 % for the sound's length. All 138 files decode in Chrome 152.

**Engines** are synthesised, no samples: sawtooth + half-rate square through a tanh drive and a
resonant lowpass, amplitude "putt" at half the firing rate, 7 Hz FM wobble; pitch 52→150 Hz with 3
gear-ish rev dips; throttle opens the filter and the drive; boost adds a triangle whine at 7x;
air flares revs +14 %; drift adds band-passed tyre squeal whose pitch rises with `charge`;
`offroad` adds a low rumble. Per-racer pitch (`ENGINE_PITCH`: King Dad 0.82, Zappy 1.28 …) comes
from `racerId`. Player gets its own voice; the **4 nearest AI** within 60 m share a pooled set
(re-picked every 150 ms, mild doppler); everyone else is silent — ~5 voices max on a Steam Deck.

**Music** streams from `<audio loop>` through `createMediaElementSource` (never decoded into a
buffer). Each file is a **seamless loop body** cut by the loop finder (the intro is dropped), Opus
.ogg primary (measured gapless in Chrome; MP3/WAV drop ~6 ms per loop), MP3 for browsers without
Opus, Super Orion 2's track as a last fallback. Files are fetched whole into a blob: URL first,
because the dev server has no HTTP Range support and Chrome then can't seek/loop an Ogg stream.
Two decks crossfade 0.9 s. The context suspends and music pauses while the tab is hidden.

**Unlock**: `init()` also installs keydown/pointerdown/touchend/mousedown listeners that call
`unlock()`; gamepads need the caller (main.js's `In.onGesture` does it). `music()` asked before the
unlock is remembered and starts on unlock. Engines can be registered before init.

### SFX (all ElevenLabs sound-generation, every one with a synth fallback)
| name | when |
|---|---|
| `countdown`, `go` | 3-2-1 beeps, GO |
| `hop` (2 takes), `land` (2) | shoulder hop boing, landing thud |
| `drift_start`, `drift_loop` (seamless, `loop:true`) | tyre chirp, held slide squeal |
| `charge_red` | slide meter entered the red window (ding) |
| `turbo1`, `turbo2`, `turbo3` | slide turbos, rising size/length 0.8/1.0/1.5 s |
| `fizzle`, `overheat` | too-early puff, overheated steam + sputter |
| `pad`, `start_boost` | turbo pad zap-whoosh, start-line rocket launch |
| `wall` (2), `bump` (2) | wall bonk, kart-to-kart bonk |
| `offroad` (seamless loop) | gravel/grass rumble while off-road |
| `star`, `star_spill` | star pickup pop-twinkle, stars spilling when hit |
| `item_box`, `roulette`, `item_get` | box smash, one roulette tick (call per tick), item landed |
| `bomb_roll` (loop), `explode` (2) | Taco Bomb rolling, cartoon boom |
| `rocket`, `rocket_lock` | Cosmic Rocket launch, lock-on beep-beep |
| `tnt_drop`, `tnt_on_head`, `tnt_tick`, `nitro` | crate thunk, bonk-boing onto a head, one tick (call per second), Nitro glass+boom |
| `splat`, `spinout`, `flip` | Ice Cream Splat, spin-out slide whistle, flip whoosh-boing |
| `shield_up`, `shield_pop` | Bubble Shield on / popped |
| `super_star` | Super Star invincibility shimmer |
| `remote` | TV Remote click-bzzt |
| `warp` | Warp Star whoosh |
| `lap`, `final_lap`, `finish`, `win`, `lose` | lap chime, final-lap fanfare, finish fanfare, victory jingle, gentle sad trombone |
| `menu_move`, `menu_ok`, `menu_back` | UI blips |
| `respawn`, `splash` | helper drops you back (sparkle poof), kart into water |
| `meow` (2), `purr`, `cheer` | Sootie, podium kids cheering |

### VO (ElevenLabs eleven_v3; `vo_*` play on a one-at-a-time announcer channel)
Announcer (Charlie, Australian, hyped): `vo_3 vo_2 vo_1 vo_go vo_ready vo_lap_2 vo_final_lap
vo_you_win vo_great_race vo_so_close vo_new_record vo_title` ("Orion Team Racing!") `vo_choose`
("Choose your racer!") `vo_orion_cup vo_great_slide vo_super_turbo vo_ouch vo_nice_shot vo_whoa
vo_boom vo_ten_stars`; item names `vo_taco_bomb vo_rocket vo_tnt vo_ice_cream vo_shield vo_turbo
vo_super_star vo_tv_remote vo_warp_star`; winners `vo_<racerId>_wins` for all 8 (spoken with the
display names: Grumbles, Wibble, Zappy, Prickles).
Barks via `audio.bark(racerId, 'win'|'boost'|'hit'|'item')` (rate-limited to one per 5 s, never cuts
the announcer): Orion `vo_orion_woohoo/yeah/uhoh` (pitched-up voice), King Dad (Russo) `vo_kingdad_count`
("Don't make me count to three!"), `vo_kingdad_back` ("Ooh, my back!"), `vo_kingdad_remote`
("Everybody... PAUSE!"), `vo_kingdad_haha`; Mum (Sophia) `vo_mum_goodjob` ("Good job, sweetheart!"),
`vo_mum_careful`, `vo_mum_wheee`; Sootie = `meow`/`purr`; `vo_grumblin_grr vo_prickle_huff
vo_jelly_wobble vo_zapdrone_zap` (vocal SFX).

### Music (ElevenLabs music_v1, instrumental, loop bodies at -18 LUFS; SO2 fallback in brackets)
`title` 63 s heroic brass/guitar (title) · `beach` 62 s surf guitar + steel drums (coast) · `ice`
60 s glockenspiel + sleigh bells (frost) · `volcano` 81 s marimba + mariachi brass (dunes) · `castle`
87 s silly medieval march (castle) · `star` 60 s synth arpeggios (cosmic) · `results` 40 s happy
podium groove (skyway). Two audio models scored all seven 8-10/10, no vocals.

### Who should call what (not yet wired, as of this writing)
- **ui/menu**: `menu_move/ok/back`; `audio.music('title')` + `vo_title` on the title screen,
  `vo_choose` on racer select; `audio.setVolumes()` from settings; `vo_orion_cup` for the cup.
- **core results**: `vo_<winnerRacerId>_wins` then `bark(winner, 'win')`; `vo_great_race` /
  `vo_so_close` when the player doesn't win; `cheer` on the podium; `vo_new_record` in time trial;
  `vo_lap_2` on lap 2.
- **items**: `item_box` + `roulette` ticks (~12/s) → `item_get` + the item's `vo_*` name; `star`
  per star, `star_spill` + `bark(racer,'hit')` on hits; `bomb_roll` with `{loop:true, at}` and
  `handle.set({at})` each frame; `explode`/`nitro`/`splat`/`shield_*`/`rocket*`/`tnt_*`/`remote`
  (+ `bark('kingdad','item')` when Dad fires it)/`warp`/`super_star`, all with `at` for other karts;
  `vo_ten_stars` at 10 stars; `vo_nice_shot` when the player's weapon hits.
- Regenerate: `node tools/gen-sfx.mjs <name> --regen`, then `node tools/sfx-qa.mjs <name>`, then
  `node tools/mixprobe.mjs`. ElevenLabs starter plan: max 4 concurrent requests; SFX/VO cost ~2 k
  credits for everything, music ~1 k credits/min (≈8 k for the set).
