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
src/items.js          PURE item sim: boxes, stars, weapons, hits, AI item use    (items agent)
src/itemviews.js      item meshes/particles/sounds (THREE, browser only)        (items agent)
src/itemhud.js        item slot + roulette widget (hud.js hosts it)             (items agent)
src/hud.js            in-race HUD: lap/place/rank list/minimap/meter/pops/banners (ui agent)
src/menu.js           title, menus, character/track select, results, cup, podium, pause, settings (ui agent)
src/audio.js          SFX + music + synthesized engines                          (audio agent)
src/save.js           localStorage save (unlocks, best times, settings, ghosts) (ui agent)
ui.css                HUD (.hx-*) + menu (#ui .scr-*) styles, linked from index.html (ui agent)
tools/check.js        THE GATE: track checks + headless 8-AI race sim           (core, extended by all)
tools/balance.js      win share / spread / star economy / kid bots over N races (balance agent)
tools/kidbots.js      kidBot + wobblyKid: models of a young player for the gate  (balance agent)
tools/shot.mjs        screenshot through the GPU headless Chrome                 (core)
tools/slide-test.mjs  scripted power slide in the real browser, 3 turbos + shots (core)
tools/ui-test.mjs     menu/HUD browser driver: screens, key/pad/tap flows, cup, time trial (ui agent)
tools/twoplayer-test.mjs  2P split screen end to end: fake pads, keyboard split, join, cup (multiplayer agent)
tools/shot-2p.mjs     2P screenshots per track: grid / mid-race items / results                (multiplayer agent)
src/protocol.js       PURE wire contract: version, lobbies, rotation, messages, binary snapshot/state codecs (online agent)
src/netgame.js        PURE client half of an online race (interpolation, mirror, events)  (online agent)
src/net.js            client transport: geckos.io WebRTC + WebSocket fallback, clock sync (online agent)
src/online.js         ONLINE mode in the browser: screens, main.js hooks, markers, bars    (online agent)
vendor/geckos.client.js  the geckos.io browser client, one ESM bundle (tools/build-geckos.mjs)
server/               the game server: node ESM, imports ../src pure modules; own package.json (online agent)
tools/netbot.mjs      headless online player over the real transport                       (online agent)
tools/online-test.mjs ONLINE end to end: own server + 3 netbots + the GPU browser            (online agent)
tools/net-jitter.mjs  server-side reconstruction jitter of a remote human (in-process, bad-network knobs) (online agent)
tools/net-interp.mjs  client-side interpolation jitter of remote karts (offline snapshot stream)         (online agent)
tools/build-geckos.mjs  rebuilds vendor/geckos.client.js from server/node_modules                        (online agent)
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
  (10 stars) raises base by 4% — was 8%, see **Balance**).
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
2P bindings (one keyboard split, own pads) are in **Two players**.

## Racers (characters agent)

8 racers, all unlocked from the start (it's for a young kid). Stats 1–5 each for `speed`,
`accel`, `turn`, summing to 9 (balanced) — physics maps them to small deltas worth about the same race
time per point (**Balance** has the mapping and the measurements).
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
   `src/hdracers.js` (HD agent): `HD_MODELS`, `hasHD(id)`, `loadHDRacer(id, opts) → Promise<{root, rig}>`
   (root origin = seat contact, +Z forward, parented to `rig.driver`), `animateHD(rig, s, dt)` (same state
   as `animateRacer`), `preloadHD(ids)`. Only the DRIVER is swapped; the kart stays procedural.
   Provenance, tri counts and the pipeline: `assets/models/README.md`; viewer `hd.html`, `tools/shot-hd.mjs`.

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

**Files:** `src/items.js` (PURE sim: boxes, stars, roulette, every item, hits, spills, AI item
brain — the gate runs it), `src/itemviews.js` (THREE meshes/particles/sounds/shake, browser only),
`src/itemhud.js` (the item-slot widget hud.js hosts in `.hx-item`), `tools/check-items.js` (unit
checks the gate runs per track), `tools/shot-items.mjs` (screenshot every item state).
All tuning is in `items.js`: `IT` (sizes, speeds, times), `ODDS` (roulette by place), `AI_ITEM`
(AI use by difficulty).

Collected from breakable **? item boxes** (`track.itemRows`; pickup radius 1.9 m — generous;
respawn 3 s; rainbow instanced boxes, 1 draw call). A box starts the **roulette** (1.5 s, icons
whizz and slow down in the HUD) only if your slot is empty. Odds by race position (`ODDS`,
8-kart field; other sizes are mapped onto it): 1st gets taco/TNT/ice cream/shield, never
warp/super star/remote (measured: 7 % catch-up items for 1st, 76 % for 8th). One remote "pause"
at a time; one warp star in the air at a time.

**Stars ⭐ = Wumpa fruit.** `track.starRows` (instanced, 1 draw call incl. spilled ones; pickup
radius 1.7 m; a collected star respawns after 14 s). `kart.stars` caps at 10; **10 = Super**:
+4 % top speed (physics `T.STAR_BONUS`) and every item juiced. **A full kart (10) drives through stars
without taking them** (`IT.FULL_PASS`), so they stay for the pack (**Balance**). Getting hit spills the stars physics took
(flip 3, spin 1) as real stars that bounce out and can be grabbed by anyone (the victim after
1.3 s, others after 0.45 s; they blink out after 9 s).

| item (`id` = icon `assets/ui/item_<id>.png`) | as built | super (10⭐) |
|---|---|---|
| Taco Bomb `taco_bomb` | rolls along the road (s/lat, follows every curve) at ≥36 m/s (owner speed + 10); ↓ + item rolls it backward at 16 m/s; explodes on contact (r 1.4 m) or after 170 m / 6 s; press item again to set it off early. Blast r 4.5 m flips everyone in it except the thrower | blast 7.5 m, bigger bomb |
| Cosmic Rocket `rocket` | locks the racer directly ahead (place − 1) the moment it's fired (`target.lockedBy++` → HUD warning + red reticle over the target), follows the road at ≥ target speed + 12 m/s, steers across lanes onto it, rises to meet it over jumps; hits anyone it touches (flip). No one ahead = flies straight 150 m. AI rockets on Easy steer weaker when the target is the kid | 3 rockets (×3 badge) |
| TNT Crate `tnt` | dropped 2.6 m behind (owner immune 1.2 s). Touching it puts it **on your head** (`kart.tnt = {t, hops, need:5}`): ticks 3-2-1 (big world-space number + HUD), **5 hops shake it off**, else BOOM (flip). A super star or a shield (popped) just knocks it away | **Nitro** `nitro`: explodes on contact, r 3 m (catches the dropper too) |
| Ice Cream Splat `icecream` | puddle dropped behind (r 2 m hazard, drawn 2.4 m): spin-out, then it's gone; lasts 35 s | r 3.1 m |
| Bubble Shield `shield` | `shieldT` 10 s absorbs one hit (physics pops it); while armed, **item fires the bubble forward** (↓: backward) — it spins out the first kart it touches | 15 s |
| Turbo Rocket `turbo` | `addBoost(2.2 s, tier 3, kick 6)` (purple flames) | 3.0 s, kick 8 |
| Super Star `superstar` | `invincT` 7 s: immune, top speed, bumps others into spin-outs (physics); knocks TNT off your head. **Sootie's spirit** (a little black cat, mint eyes, glowing) orbits you, gold aura + rainbow sparkles | 10 s |
| TV Remote `remote` | everyone else (unless shielded/starred) `wobble` → `slowT` 3 s, "pause" sign over their heads; event `remote` with `text: 'KING DAD PRESSED PAUSE!'` | 4.5 s |
| Warp Star `warp` | flies up the course at 60 m/s to the **leader** (lock-on warning for them), swerves into anyone it's about to pass (flips everyone in its path), done when it hits the leader. Not rollable in 1st | 85 m/s |

Hit reactions (physics `applyHit`): bomb/rocket/TNT/Nitro/warp = flip (1.2 s, −3 stars); ice
cream / fired bubble / super-star bump = spin (1 s, −1 star); remote = wobble. Shield and super
star are respected everywhere (a blocked hit emits `blocked` with `why: 'shield'|'star'`).

**AI item brain** (`items.aiControl`, called from the end of `ai.js drive()` — one line): thinks
every 0.7/0.4/0.22 s (easy/medium/hard); fires rockets at the kart ahead within 140 m, bombs at
someone ahead in its lane (≤45 m) or backward at a close chaser, drops TNT/puddles when someone is
3–20 m behind, raises the shield when a rocket locks on (P 0.3/0.65/0.95), turbos on straights,
uses super star / remote / warp soon; hops a TNT off its head (easy hops slowly and sometimes
eats the boom); sets off its own bomb when someone is in the blast. **Easy is gentle with the
player**: `mercy` 0.05 × the use chance on attacks aimed at the kid, weaker rocket homing on
the kid, never force-fires a homing item at the kid, and a 25 s break after the kid was hit.
Measured over 15 kid-bot races per difficulty (all 5 tracks × 3 seeds): AI item hits on the kid
per race easy 1.8 (1.0 of which is the mild remote wobble) / medium 4.1 / hard 2.7; AI-on-AI ~4 per
kart per race on every difficulty. Items are a catch-up equaliser like CTR: kid-bot mean place
medium 3.6 → 2.3, hard 7.3 → 5.7 with items on.

### Items API (for other agents)

```js
import { createItems, IT, ITEMS, ITEM_IDS, ODDS, AI_ITEM, trackPoint } from './items.js';
const W = createItems(race, { seed });   // race.items = W; race.addSystem(step) — the gate + main do this
W.give(kart, id, count?)   W.use(kart, back?)   W.hitKart(kart, kind, byKart, itemId)   W.roll(kart)
W.boxes / W.stars / W.spills / W.projs / W.hazards / W.stats    // plain data, read by the views
// controls: the control object may carry  item (held; edge-detected per kart)  and  itemBack (throw backward)
```
Kart fields added: `item` (id | null), `itemCount`, `roulT`/`roulDur` (roulette seconds left),
`tnt` ({t, hops, need, by} | null), `lockedBy` (homing projectiles on you), `lockDist` (m to the
nearest), `bomb` (your rolling bomb), `shieldArmed`, `_hitByT`.

**Events** — pushed to `race.events` as `{ type: 'item', e, kart, ...}` inside the sim step (so a
listener that reads `race.events` after `race.step()` or from its own `race.addSystem` sees them):
`box` {pos, roulette} · `roulette` · `got` {item, count} · `use` {item, super, back} (item `nitro`
for a super TNT) · `drop` {item, pos} · `star` {n, pos} · `super` (reached 10) · `spill` {n, pos} ·
`hit` {by, item, kind} · `blocked` {by, item, why} · `explode` {pos, r, item, big} · `fizzle` {pos,
item} · `lock` {by, item} (kart = the target) · `tnt_on` {by} · `tnt_tick` {n: 3|2|1} · `tnt_hop`
{n, need} · `tnt_off` {why: 'shaken'|'star'|'gone'} · `splat` {pos, by} · `shield_up` · `shield_fire`
· `turbo` · `super_star` {t} · `remote` {text, super, t} · `warp` {target} · `warp_hit` {by, pos} ·
`detonate`. Physics also reports the victim's kart events `hit`, `stars_lost`, `shield_pop`.
hud.js (UI agent) turns `remote`/`hit`/`super`/`super_star`/`blocked`/`tnt_off` into callouts
and `lockedBy`/`tnt` into the flashing "ROCKET! WATCH OUT!" / "HOP! HOP! HOP!" warnings;
itemviews.js adds only the player's own hit callout (`BOOM!`, `ZAPPED!`, `SPLAT!` … via `race.ui`).

**Browser wiring** (main.js, 7 marked lines): `IV = createItemViews({scene, fx, audio, chase,
chaseFor (2P: kart → that player's ChaseCam), visuals})`; `IV.attach(race)` in startRace **before** `compileAsync` (it makes one of every item
mesh visible for that call so no shader compiles mid-race); `IV.step(race.events, G.ff)` after
each step; `IV.update(dt, alpha)` each rendered frame; `IV.detach()` in endRace; the player's
control object gets `item: In item held || latched tap (G.pendI)` and `itemBack: brake > 0.3`.
`window.__OTR.items` = W, `__OTR.itemViews` = IV (`IV.boom(pos, r)`, `IV.info()`).
Sounds used: `item_box roulette (ticks slow down) item_get + vo_<item> star star_spill
bomb_roll (loop, follows the bomb) explode nitro rocket rocket_lock (beeps faster as it closes)
tnt_drop tnt_on_head tnt_tick splat shield_up shield_pop super_star meow remote vo_kingdad_remote
warp turbo3 vo_ouch vo_nice_shot vo_ten_stars` + `audio.bark(racer, 'hit'|'item'|'boost')`.
Explosions = pooled fireball + smoke ball + ground ring + a comic "BOOM!" sprite + fx bursts, and
camera shake scaled by distance to the player. No lights anywhere.

**Debug URL params:** `items=0` (items off: no boxes/stars/AI items; `race.noItems = true` does the
same at runtime — Time Trial), `give=<id>` (the player
gets it at GO; `give=nitro` = TNT + 10 stars), `refill=1` (…again every time the slot empties),
`stars=N` (player starts with N stars). E.g.
`?track=beach&skip=1&give=rocket&refill=1`.

**Verify:** `node tools/check.js` races every track with items ON (prints item stats per race,
checks items get picked up/used/land hits) and runs `tools/check-items.js` per track (20 checks:
star cap/Super, box roulette + respawn, odds by place, shield absorbs one, shield fire, TNT 5
real hops / 3-2-1 boom, Nitro + triple rockets, rocket homing across lanes, bomb roll/detonate/
backward, puddle spin, star spill + re-collect, remote, super star, warp path hits). `--noitems`
for the old item-less races. Screenshots: `node tools/shot-items.mjs [scenario…]` → `shots/items/`
(`--list`). **Cost:** idle items = **2 draw calls** (158 vs 156 at the grid, 74 vs 72 mid-race,
measured by toggling the item group), +~9k triangles; each live projectile/crate/puddle/bubble/
explosion part adds 1. Sim cost ~33 µs per 60 Hz step for 8 karts in node.

## Balance (balance agent — `ai.js`, tuning in `physics.js`/`items.js`, `tools/balance.js`)

Everything here is measured with **`node tools/balance.js`** (N seeded headless 8-AI races per track per
difficulty through the real modules, the real roster parsed from `racers.js`, a rotated shuffled grid so
every racer starts from every slot; worker threads, ~0.4 s/race/core; `--kid`, `--wobbly`, `--regress`
(race time per stat point from random stats), `--flat` (all 3/3/3 control), `--set T.X=…` experiments —
header of the file). N=48 per track leaves ±5 % binomial noise per cell (±2 % on ALL): judge ALL and mean
place, re-run a noisy cell with fresh `--seed0`.

**Why it was broken.** Physics had no cost for cornering and the AI holds its line, so lap time was top
speed + boosts: `speed` was worth ~4 s/race per point, `accel` and `turn` ~0 (`--regress`). And the
leader took every star it drove through, reached 10 by lap 2 and kept a +8 % Super for good (only the
winner was ever Super: 1st 59 % of the race, 4th 1 %). King Dad (5/2/2) won 55–62 % of all races on
every difficulty, the 2-speed karts 0–2 %, and the field finished ~20 s apart.

**Stat mapping** (`T.STAT_*`, per point away from 3; tuned so a point of any stat is worth about the same
race time — `--regress` ≈ −0.6…−0.7 s/point each on Medium):
| stat | effect | 1 ↔ 5 |
|---|---|---|
| speed | top speed and boost cap `STAT_SPEED` 0.0065 | ±1.3 % (21.7 ↔ 22.3 m/s) |
| accel ("ZOOM") | acceleration `STAT_ACC` 0.13 (off the line, out of hits/spins/walls/sand), turbo/pad kick `STAT_KICK` 0.12, boost reserve seconds `STAT_BOOST` 0.12 | 0→90 % 2.4 s ↔ 1.4 s |
| turn | slide top speed `STAT_DRIFT` 0.02 (× `DRIFT_SPEED` 0.97, capped at 1), corner-scrub reduction `STAT_GRIP` 0.4; turn RATE stays `STAT` 0.03 (feel) | slide 20.5 ↔ 22.0 m/s |

**Corner scrub** (new, `T.CORNER`): outside a slide, lateral accel v·ω above 12 m/s² costs up to 7 % of top
speed at 32 m/s² (full lock at full speed); turn 5 loses 20 % of that, turn 1 140 %. The CTR feel is
untouched (slides/turbos/hops are the same numbers); it just means hauling the stick round a hairpin at
full speed isn't free, so the slide and the TURN stat pay. `cornerF` on the kart; self-tested.

**Star economy.** `T.STAR_BONUS` 0.08 → **0.04**, and **a kart at 10 stars drives through stars without
taking them** (`IT.FULL_PASS`, also spilled ones), so they're left for the pack; the AI now detours for
stars (below). Measured: Super time of the karts finishing 1st/4th/8th went 40/2/0 % → 42/9/2 % (Medium),
winner still usually Super (it's the reward), field spread below.

**AI** (`DIFFICULTY` in ai.js; the item brain is still `AI_ITEM` in items.js):
| | easy | medium | hard |
|---|---|---|---|
| pace / P(slide) / P(turbo) | 0.86 / 0.45 / 0.4 | 0.94 / 0.8 / 0.72 | 1.0 / 1.0 / 0.93 |
| rubber band vs the human (× pace at full effect) | ahead 0.86 by 65 m, behind 1.2 by 55 m | 0.95 / 1.05 over 120 / 150 m | 0.985 / 1.02 over 120 / 150 m |
| `grab`: sideways detour for a ? box (empty slot) / star (< 10) | 2 m | 3.5 m | 5 m |
| `dodge`: P(notices a puddle/TNT/Nitro ahead, or a bomb/bubble rolling back, and steers round) | 0.25 | 0.7 | 0.95 |
- Slides end early when even full counter-steer would carry the kart into a wall / off a `fall` edge
  within 0.5 s (road curvature included) — castle hard walls went 6.1 → 0.5 per kart per race, no slide
  runs off Star Road. It swerves wider round a kart that's crashed/spinning/much slower (no pile-ups).
- Hard AI: ~2.0–2.6 turbos per slide (castle's maze ~1.0), 0 reversing, 0 stuck, ~0.1 walls/kart.

**Kid assist** (the player, `kart.assist` = Easy or KID HELPER; `ai.js kidAssist`, applied by race.js
before physics so the bots get exactly what a kid gets): (1) a nudge back toward the road when the kart
is predicted to leave it within 0.7 s (≤ 0.5 steer, never fights a kid already steering back harder);
(2) toward a `fall` edge (1.0 s ahead; on a jump run-up/in the air 1.9 s, i.e. aim the landing) it blends
up to 85 % of the stick toward the road — a firm hand; (3) sand/grass cost 70 % of their slowdown
(`T.ASSIST_OFFROAD`, sand 0.64 → 0.75). Auto-accelerate stays the menu's setting (on in Easy).
**Bots** (`tools/kidbots.js`): `kidBot` (the gate's kid: never slides, loose line) and `wobblyKid` (0.25 s
late, wandering ±0.5 noise, a full-lock yank every ~5 s, hop mashing). The gate races the wobbly kid on
Easy on every track: must finish, ≤ 1 fall, < 15 s behind the winner.

**Measured** (balance.js, items on, N=48/track/diff; before = commit a3c1047, N=24):
| | before | after |
|---|---|---|
| win share range, ALL tracks — easy / medium / hard | 0–55 % / 0–62 % / 0–57 % (King Dad) | 10–15 % / 7–17 % / 9–18 % |
| mean place range (4.5 = fair) — medium | 1.5 (King Dad) … 6.4 | 4.3 … 4.8 |
| AI field gap 1st→8th, mean — easy / medium / hard | 21 / 20 / 18 s | 8.9 / 8.5 / 8.7 s |
| kid bot on Easy: wins, margin, AI within 5 s of it | 83–100 %, by 8–14 s, 0–0.5 | 98–100 %, by 1.7–2.5 s, 4.6–5.9 |
| kid bot on Medium: wins / podium | 8–50 % / 50–88 % | 25–50 % / 58–79 % |
| kid bot on Hard: wins / mean place | 0–8 % / 4.2–6.8 | 0 % / 6.5–7.8 |
| wobbly kid on Easy: behind the winner, falls per race (Star Road) | 8–25 s, 5.3 | 1.9–2.9 s, 0.1 |
Per-track cells still show 20–30 % outliers at N=48 (e.g. Grumbles 29 % on ice medium); re-run with fresh
seeds at N=96 they come back 10–16 % — noise, not a racer. Castle stars are still collected less (its
rows sit off the slide lines): 6.6/kart vs ~11–13 elsewhere.

## Tracks (tracks agents)

Built from a closed spline of control points, each with `{x, y, z, w (road width), bank}`, plus
per-segment tags — see **Track data format** below (the contract for tracks agents). `track.js`
samples it (every ~1 m) and answers `project(pos, hint)` → `{i, s, lat, y, cy, onRoad, surface,
hw, limL, limR, wallL, wallR, gap, tx, tz, lx, lz, tb, slope, noRespawn, tunnel}`. Themes from the
Super Orion worlds:

1. **Bubbly Beach** — easy, wide, gentle sweepers, a jump over a lagoon inlet, palm trees.
2. **Ice Cream Peaks** — snowy ice-cream mountain, hairpins that teach sliding, a big jump.
   *As built:* 1123 m, road 14–18 m, clockwise (mostly RIGHT turns). Vanilla Sweeper → a 0 → 21 m
   climb up Strawberry Peak (pad) → Sprinkle Hairpin (r≈19, 180°) → summit ridge → pad-fed jump
   off the Cherry Scoop (vy 10 into a downhill: ~1 s air = hang-time turbo) → downhill swoop and
   S-bends beside the chocolate river → Cherry Bend (180°) over the humped Wafer Bridge (`raised`).
   Offroad snow; candy-cane/waffle/wafer walls. AI laps 43–62 s.
3. **Taco Volcano** — lava rivers, rock bridges, ramps, a tunnel through the volcano.
   *As built:* 1152 m, road 15–18 m, anticlockwise. Salsa Sweeper → Lava Leap 1 (12 m gap, pad) →
   climb to the Chilli Hairpin mesa (y 10) → down past the volcano (pad) → the ~150 m Taco Tunnel
   through its flank → the Rock Bridge over the lava lake (`raised`, `wall: 'fall'` both sides —
   the only place you can fall in) → S-bends → Taco Turn → Lava Leap 2 onto the start straight.
   Offroad rock; basalt walls, chili hazard stripes by the lava. AI laps 42–63 s.
4. **King Dad's Castle** — courtyard + castle halls, banners of King Dad, tight technical turns.
   *As built:* 1102 m, road 13–15 m, twilight with a big smiling moon. Forecourt start (bunting in the
   family colours, BBQ, the LOST SOCKS pile, washing line) → DRAWBRIDGE over the moat (a small hop at
   its end) → gatehouse → the roofed GREAT HALL (`tunnel`; banquet tables are the barrier, torches,
   King Dad portraits + banners, chandeliers, his giant armchair throne with the TV remote, "DAD'S
   CHAIR — DO NOT SIT", a TV) → right out of the side door, under the tower bridge → the SPIRAL
   RAMP: a 300° climbing right-hander (r 27, 0.8 → 12 m, `raised`) round the Remote Tower (a giant
   TV remote on its roof) that exits OVER its own entrance (`bridge`) → north + east BATTLEMENTS
   (crenellated parapets, no falls) → sally ramp down and a pad-fed JUMP over the moat (13 m gap,
   ~1 s air) → the GARDEN MAZE (hedge walls, 90° zig-zags, Sootie topiary, fountain) → King's
   Hairpin → forecourt. Offroad grass (the hall's is `dirt` wearing the tiled floor). Walls are all
   `none`: the scenery draws the boundary to match a scenery-only `look` tag on the points
   (`court/drawbridge/gate/hall/ward/tower/battlement/ramp/hedge`). AI laps 41–61 s.
5. **Star Road** (secret, unlocked by winning the Orion Cup) — rainbow road in space, can fall off.
   *As built:* 1227 m, road 14–17 m, `secret: true`, `terrain: false`. Two space-waves (a hop off
   the second) → Comet Hairpin (walled) → the RAINBOW DROP (`wall: 'fall'`, cloud shoulders, a star
   gate jump over a 10 m gap) → THE HELIX: a banked right-hand corkscrew winding 450° down round
   itself (8 m per turn, `bridge`) → the STARDUST BRIDGE (no walls) right under the start grid →
   the MOON LOOP (270° left round a moon with a face) → climb back to the start. The road is the
   engine ribbon with its Lambert material patched (`onBeforeCompile`, cached key) into rainbow bands
   + a scrolling glow; the scenery adds the road's glowing edges + dark underside (visible from the
   helix below), glowing rails where the data says `rail: 'glow'` (physical wall `none`), chase-
   light studs on `fall` edges, planets, a ringed planet, an asteroid ring, shooting stars, the
   giant Sootie constellation (mint eyes), rainbow hoops and floating stars. 24 collectible stars
   only: more and the leader's permanent 10-star Super split the easy field > 35 s (that was with the
   old +8 % Super; see **Balance** for the star economy now). AI laps 43–67 s.

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
         clouds: true,          // all optional; trackmesh THEMES[theme] gives the defaults
         sky: 'sky_beach', skyShift: 0 },   // optional painted 2:1 panorama (assets/tex/<sky>.jpg), see below
  tex: { road: 'road_beach', ground: 'sand', water: 'water', <surfaceName>: '<texName>' },   // optional
  water: { y: -1.4, color, tint },   // optional sea/lake plane. Touching it off-road = rescue. Omit for none.
  terrain: { base: 0.2, shore: 70, dunes: 1.6, cell: 4.5, grass: { above: 1.6, color },
             carve: [{ type: 'lake', x, z, r, depth }, { type: 'channel', pts: [[x,z],…], w, depth }],
             hills: [{ x, z, r, h, color? }],            // cos² domes (h < 0 = a crater), see below
             colors: { ground, wet, deep } },           // terrain vertex tints (default: beach sand/wet sand/teal)
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
| `wallL`, `wallR` (`wall` = both) | boundary kind: a visible style (`fence`, `beach`, `wood`, `rock`, `ice`, `castle`, `neon`, `candy`, `waffle`, `wafer`, `chili`, `basalt` — `WALLS` in trackmesh.js, add yours), `'none'` = invisible wall, `'fall'` = no boundary, you can fall off (Star Road) |
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
shot: `node tools/shot.mjs 'track=<id>&skip=1&hud=0&cam=x,y,z,tx,ty,tz' shots/o.png`
(add `--eval "__OTR.scene.fog.near=4000;__OTR.scene.fog.far=5000"` to see the whole map).

**Castle / Star Road extensions (tracks agent 2 — all opt-in):**
- `terrain: false` — no heightfield at all (space); `groundAt` falls back to −10⁴, `water` omitted →
  falls use the `cy − 8 m` rule, the rescue cloud drops you back.
- `secret: true` on the track object — the UI/save gate it behind the Orion Cup.
- Scenery-only inherited tags on points (track.js ignores them): castle `look`, star `rail`. Read
  them with `makeKit(ctx).inherited(key, dflt)(k)` (per sample, via `track.U`).
- trackmesh `groundAt(x, z, hint, y)` takes the asker's height, and the chase camera passes the
  kart's `si` + y: where the track passes over itself (castle spiral, star helix) the camera clamps
  to its OWN level, not the deck above.
- Stacked levels need ≥ 8 m between decks (camera 2 m up + the deck's 1.6 m underside), and a
  walled spiral needs a gap between the inside rail and any tower wall: the chase cam sits on the
  chord behind the kart (~0.9 m inside at r 27) and ended up inside the stone.
- Gate: the lap-time floor now allows the `T.STAR_BONUS` (was 8 %, now 4 %) of a 10-star Super leader when items run (the leader
  holds Super from lap 2 on every track; Star Road's legit laps tripped the old floor).

**Terrain, sky and water extensions (added for Ice Cream Peaks / Taco Volcano — all opt-in):**
- `terrain.hills` — smooth `h·cos²(π/2·d/r)` domes added to the natural ground. The drivable
  corridor still flattens to the road, and within 22 m the ground blends back up to the hill, so a
  road climbing a hill looks cut into its flank (Ice Cream Peaks climbs 0 → 21 m this way). A hill's
  `color` tints its dome. Mountains are data now — the scenery doesn't have to fake them.
- `terrain.colors` — the terrain's base / near-water / under-water vertex tints (× the ground texture).
- `env.sky` — a 2:1 equirect panorama with the horizon at mid-height (the art agent's
  `assets/tex/sky_<theme>.jpg`); its lower half fades into the fog colour so the terrain's far edge
  melts in. The skyTop→skyHorizon gradient is the instant fallback. The panoramas carry their own
  clouds, so those tracks set `clouds: false`. Pick `fog` ≈ the panorama's horizon colour.
- `water` doesn't have to be water: Ice Cream Peaks' is a chocolate river, Taco Volcano's is lava
  (a jump gap over it = the helper carries you across; falling off a `'fall'` edge into it = rescue).
  The scenery re-skins the `water` mesh (`group.getObjectByName('water')`) and shrinks it to the
  terrain rectangle; a far-ground frame hides the terrain's square edge.
- **Surfaces are a top-speed factor only** (`SURFACES` in track.js) — there is no grip model, so a
  slippery ice patch isn't possible without a physics change (Ice Cream Peaks has none).
- `raised` stretches (bridges): the terrain under them stays natural and a `carve` can run under
  them (trackmesh `corridorInfo` now counts distance ALONG the road past a skipped sample, else the
  ground under a bridge snapped up to the approach's height). The Wafer Bridge and the Rock Bridge
  are raised stretches over a carved river / lake.
- **Tunnels**: `tunnel: true` is still a flag only. The heightfield can't hold a hole, so the road
  cuts a V through the hill and `scenery/volcano.js` builds the inside (arch shell + glow strips),
  a rock cap that rebuilds the hill over the cutting (same texture/uv/tint as the terrain via
  `naturalAt` + `terrainTint`, edges sunk under the real ground) and portal faces. Keep the tunnel
  gently curved (r ≳ 80 m) and its roof ≥ 8.5 m: the chase camera sits 2 m up, 5–6 m behind.

### Scenery hook (tracks agents)

`src/scenery/<theme>.js` default-exports `build(ctx)` (may be async) → optional `{ update(dt, t) }`.
A missing file is fine. `ctx = { THREE, group (add your meshes here), track, def, env, rng
(seeded), loadTex(name, fallbackCanvasFn?, {repeat, file, onload}), groundAt(x,z) (terrain height),
trackGroundAt(x,z) (road/offroad height where drivable, else terrain), isClear(x,z,r,margin)
(outside the drivable corridor — never block the road), aboveWater(x,z,h), corridorInfo(x,z),
naturalAt(x,z) (the ground before the corridor flattened it: dunes + hills), bounds {x0,z0,x1,z1} }`.
**Instance** repeated props, **merge** one-offs per material, and put props ON `groundAt` (nothing
floats). Two helper kits (not themes): `scenery/kit.js` (castle, star) and `scenery/propkit.js`
(beach, ice, volcano: `instanced` with per-instance colour, `merge`/`paint`/`paintBy`, `claim`/
`scatter` placement that never blocks the road, `lofted` strips along the track, `chevrons()` —
kid-readable arrow boards on the outside of every corner tighter than r≈40 m — `farGround`,
`fitWater`, `terrainTint`). Budgets as built (scenery only): beach 19 draws / 52k tris, ice 15 /
164k, volcano 23 / 98k, castle 27 / 164k, star 16 / 78k (castle/star replace the sky material
themselves when `sky_castle` / `sky_star` load — the star sky keeps its painted lower half); ≤ 8 of them cast shadows (an InstancedMesh's shadow pass draws every
instance — keep small props shadowless).

## Modes and UI (ui agent — `menu.js`, `hud.js`, `save.js`, `ui.css`)

- **Quick Race** — pick racer, then track; 8 racers, 3 laps. Difficulty chips live on the main menu.
- **Orion Cup** — `CUP_ORDER = beach → ice → volcano → castle` (whichever are registered, in that
  order; missing ones are skipped). Points `POINTS = 10/8/6/5/4/3/2/1`; standings screen after every
  race (rows slide into the new order, points count up); **podium** at the end (3D: top 3 on the
  blocks cheering, trophy, confetti; 4th–8th at the sides, 6th–8th mildly `sad` — never the player).
  Winning (any difficulty) records `cupWins[diff]` and unlocks **Star Road** with a "STAR ROAD
  UNLOCKED!" screen the first time. No "restart" in the pause menu during a cup.
- **Time Trial** — solo race (`G.solo` → main races just the player; `G.noItems` and
  `race.noItems = true` are set — items.js skips its whole step and the AI item brain, itemviews hides
  everything while `race.noItems` is true).
  Best lap + best race saved per track; the best race is saved as a **ghost** (10 Hz pos/yaw) and
  replays as a translucent kart (cloned transparent materials) + a pale minimap dot; HUD shows "BEST".
- **Difficulty**: Easy (default) / Medium / Hard, shown as drawn SVG faces (emoji don't render in the
  headless Chrome). Settings: volumes (master/music/sfx), **AUTO-GO** (auto-accelerate: `easy` =
  on in Easy only (default) / `on` / `off`; touch always auto-accelerates), **KID HELPER**
  (`kidAssist`, default on → `easyBoost` on every difficulty), **FANCY RACERS** (HD models, shown
  only if `hdracers.js` lists any), **GRAPHICS** (`quality`: `auto` (default) / `high` "FANCY" /
  `low` "FAST" → main.js `setQuality`, see **Quality**), CONTROLS help (keys / pad buttons / touch glyphs + turbo how-to).
- **Kid-first**: no reading needed — title (any key/tap) → Quick Race (focused) → racer (last one
  focused) → track → race is four presses of A. Results always celebrate: 1st = "YOU WIN!" +
  confetti, 2nd/3rd = podium messages, 4th+ = "GREAT RACE! You came 5th — Super zooming!".

**Screens** (`menu.js`, DOM in `#ui`, one at a time): `title` (key art `assets/ui/title.jpg` +
`logo.png`, sparkles, "PRESS START!"; fallback = 3D line-up of all racers + CSS text logo) →
`menu` (→ `join` for 2 PLAYERS, see **Two players**) → `select` (4×2 portrait grid + 3D turntable preview with hops, name, blurb, SPEED/ZOOM/TURN
bars; confirm = cheer + bark) → `tracks` (cards `assets/ui/track_<id>.jpg` read live from `TRACKS`;
a `secret: true` / id `star` track shows as a locked "?????" until unlocked; TT shows ghost times)
→ `loading` → race → `results` (overlay; the race keeps running behind; appears 2.6 s after the
player finishes, unfinished rows say "racing…" and fill in live; Race again / Next track / Menu,
or Continue in a cup) → `standings` → `podium` → `unlock`. `pause` (Esc/P/Start/❚❚: Keep racing,
Start again, Settings, Quit to menu), `settings`, `controls`. Music: `title` on menus, `results`
on results/standings/podium; SFX `menu_move/ok/back`; VO `vo_title`, `vo_choose`, `vo_orion_cup`,
`vo_<winner>_wins`, `vo_so_close`, `vo_great_race`, `vo_new_record`, podium `cheer` + winner bark.

**Menu input**: menus read the keyboard (arrows/WASD, Enter/Space/E = OK, Esc/Backspace = back)
and the Gamepad API themselves (d-pad/stick with repeat, A = OK, B = back, Start), because
input.js's `confirm` merges A/B. Focusables are `[data-nav]`; arrows move **spatially** to the
nearest one; `[data-adj]` rows take ←/→. Mouse hover focuses, tap/click activates. While a menu
is up, `body.menu-open` hides the touch buttons. With menu.js loaded, main.js's own pause/title/
results key handling is off (`!MENU` guards); without it core's placeholder title card returns.

**main.js hooks the UI uses** (all small, marked in main.js): `initMenu(api, {skip})` at boot
(awaited before `__OTR.ready`); `G.solo`, `G.autoAccel`, `G.easyBoost` (passed to `createRace`),
`G.hd`, `G.menuCovers` (an opaque screen is up → the idle orbit isn't rendered); `endRace()`
(tear down visuals/engines/HUD, `G.race = null`; also on `__OTR`); `hud.update(view, race)`.
All menu screens run in main's `title` state. `?skip=1` / `?t=` / `?ai=1` races use **only** the
URL (never the saved racer/difficulty/assists) so tests stay deterministic.

**Save** (`save.js`, every access in try/catch; a blocked/private storage just forgets):
```js
localStorage.otrSave = { v: 1, unlocked: { star: false }, cupWins: { easy, medium, hard },
  best: { <trackId>: { lap, race, racer } },            // every finished race counts, TT or not
  settings: { master, music, sfx, autoAccel: 'easy'|'on'|'off', kidAssist, hd, difficulty, quality, mpAuto?: [p1,p2], mpHelper?: [p1,p2] },
  lastRacer, lastTrack }
localStorage['otrGhost:<trackId>'] = { v: 1, racer, time, hz: 10, d: [x,y,z,yaw …] }  // dm / mrad ints, ~20 KB
```

**HUD** (`hud.js`, `.hx-*` in ui.css): LAP big top-left + race timer + lap splits (best green);
**rank list** of portraits down the left in live order (player ringed gold, rows slide);
position huge top-right coloured by place (gold/silver/bronze/blue) with a bump on change; stars
(`assets/ui/star.png`, glows at 10 = SUPER) + the items agent's `itemhud.js` slot top-centre;
minimap bottom-right (top-right under the position on touch) from the sampled centreline, gaps in
blue, a dot per racer in kart colour, player ringed + heading tick; slide meter + turbo pips +
boost bar bottom-centre; turbo pops "TURBO!" / "SUPER TURBO!!" / "ULTRA TURBO!!!" and "OOPS!"
(fizzle/overheat) from player state diffs; bouncy coloured 3-2-1-GO; banners (`LAP 2`, rainbow
`FINAL LAP!`); "TURN AROUND!" wrong-way (heading vs track tangent > ~115° for 0.9 s of **sim**
time); flashing warnings "ROCKET! WATCH OUT!" (`P.lockedBy > 0`) and "HOP! HOP! HOP! n"
(`P.tnt`). **Events into the HUD**: (1) `hud.banner(text, ms, cls)` (big, one at a time);
(2) `hud.event(text, {ms, cls: 'good'|'bad'|'item', icon})` — the callout line under the banner;
(3) `hud.warn(key, text|null)` — persistent flashing warning; (4) a pure module may push
`race.ui.push({ text, ms, cls, icon, kart })` (kart = only show for that kart; `warn:true, key,
on` = a warning) — drained every frame; (5) the HUD also listens to items.js events
`{type:'item', e, kart, by}` itself (collected per sim step by a `race.addSystem` hook): `remote`
→ "KING DAD PRESSED PAUSE!" (e.text), player hits → "GOT 'EM!", `super` → "SUPER STARS!",
`super_star`, shield blocks, TNT shaken off.

**URL**: `?screen=title|menu|select|tracks|settings|controls|standings|podium|unlock|results|pause`
jumps to a screen (results/pause run a real race, fast-forwarded; standings/podium use a fake cup;
`&mode=tt|cup` for tracks/results; `&race=N` for standings). **Test driver**: `node
tools/ui-test.mjs screens|flow|cup|hud|tt|pad|tap [--size 844x390] [--touch] [--only a,b]` →
`shots/ui/*-<size>.png`; fails on page errors, console errors and failed requests. `pad` fakes a
standard gamepad through `navigator.getGamepads`; `cup` and `tt` clear `otrSave` first.

## Two players (split screen — multiplayer agent)

Local 2P, CTR style: two humans + 6 AI on one screen, **top half P1, bottom half P2** (a
horizontal split: at 1280×800 each view is 1280×400; left/right would be two 640×800 slits).
Quick Race and the Orion Cup; Time Trial stays 1P.

**Flow** (`menu.js`): main menu **2 PLAYERS** (under TIME TRIAL — the old positions are kept, the
kid's muscle memory and realflow/ui-test's key paths depend on them) → **join** screen → QUICK
RACE ▶ / ORION CUP ▶ (locked until P2 joins) → racer select for P1, then P2 (P1's racer is greyed
with a P1 badge: one of each racer on the grid; default P2 = King Dad) → tracks / cup standings.
RACE AGAIN / NEXT TRACK / START AGAIN stay 2P; picking QUICK RACE / ORION CUP / TIME TRIAL on the
main menu is 1P again. `?screen=join`; `?players=2&screen=standings|podium|results` for the 2P
versions.

**Join screen.** P1 = the device that opened it (`In.deviceId()`: `pad:N` or `kb`; touch → kb).
P2 joins with A/Start on another pad (`pad:M`), or a right-half key (Enter, Right Shift, `/`, `.`):
if P1 is on the keyboard it splits (`kbL`/`kbR`), if P1 is on a pad P2 gets the whole keyboard
(`kb`). A pad joining after a keyboard split gives P1 the whole keyboard back. The press that
joins is **swallowed** — input.js queues it (`takeJoins()`) before menu.js sees the same key/button
as 'ok', and the join screen's `onAction('ok')` consumes the queue first, so Enter/A never also
clicks the focused button. Per player: **AUTO-GO** and **KID HELPER** toggles (saved as
`settings.mpAuto` / `settings.mpHelper`; defaults P1 = the 1P settings, P2 = off — Orion gets
help, Dad doesn't).

**Input** (`input.js`): `players[0|1]` are per-player controllers (`controls`, `hit`, `down`,
`autoAccel`, `device`) reading ONE device each; `multi(on)` switches their update on (startRace in
2P), `setDevices(d1, d2)`. `'auto'` (URL tests): 2+ pads → pad order; 1 pad → pad + keyboard;
none → `kbL` + `kbR`. The 1P `controls`/`hit` still merge every device exactly as before. Keyboard
state is per `KeyboardEvent.code`:
| | P1 left half (`kbL`) | P2 right half (`kbR`) |
|---|---|---|
| steer / go / brake | A D / W / S | ← → / ↑ / ↓ |
| hop (shoulder A) | Space | Right Shift or `/` |
| turbo (shoulder B) | Left Shift | `.` |
| item | E | Enter (NumpadEnter) |
Esc/P (and Start on any pad) pause for both — menu.js reads them as before. Never Ctrl.

**Race** (`race.js`): `createRace({ players: [{ index, easyBoost, assist }, …] })` → both karts are
`isPlayer` with `pn` 0/1; `race.player` = P1 (every 1P path keeps working), `race.humans` = both,
`race.step([ctrlP1, ctrlP2])`. Start boosts / stalls per human. **Rubber band:** an AI ahead of
every human is banded against the leading human, every other AI against the trailing one (the pack
stays round the kid; measured below). The race is called 20 s after the LAST human finishes, or
`MP_WAIT` 90 s after the first. main's `finished` state = every human home. **Items:** everything
that was "the player" is now "a human": on Easy both get the mercy (never force-homing, 25 s
break after a hit, weaker rockets), the remote's mercy counts any human; itemviews gives each human
their own sounds, callouts, camera shake (`chaseFor(kart)`), roulette ticks and lock beeps; `give=`
/ `stars=` go to both.

**Rendering** (`main.js`): one scene, two cameras (`views[j] = { cam, chase, hud }`), drawn with
`setViewport` + `setScissor` (three's viewport y is from the bottom: P1 at y = H/2). Per view:
kart visibility (`cullKarts`: far cull, and the hide-within-2.4 m rule now also hides the OTHER
player's kart from your lens), the sky dome follows that camera, and particles are re-billboarded
for the second camera with `fx.update(0, cam2)` (dt 0 = no sim step). Blob shadows show if a kart
is seen from either view. `renderer.info.autoReset` is off across the two views, so `info()` and
the perf tools see the whole frame. **2P quality override** (`QUAL_MP`, whatever GRAPHICS says):
no real-time shadow (every kart gets a blob), `fx.q` 0.5, AI karts culled at 120 m (~7 px tall in a
400 px view — FAST's 150 m in 1P). Render scale still follows the setting (two half views = one
full view of pixels). Camera: `ChaseCam.fovMul` 0.66 in 2P (1280×400 at 66° vertical is a 128°
fisheye sideways; 0.66 keeps ~1P's horizontal FOV). `startRace` also renders one real split frame
during the warm-up. `resize()` only runs when the split changes (setSize reallocates the buffer).

**HUD** (`hud.js`, `.hx-*` + `body.split2` rules in ui.css): `createHud(root, { pn })` follows
`race.humans[pn]`; `#hud` = the top half (P1), `#hud2` = the bottom half (P2), each laid out inside
its half at ~80 % of the 1P size, with a P1 (gold) / P2 (cyan) badge bottom-left. Lap, time,
place, rank list (own kart ringed in the player colour, the other human thin-ringed), stars, item
slot + roulette (smaller), meter, pops, banners/events/warnings (below the item slot), wrong-way —
all per half. **Shared:** the countdown (P1's, on the split line), the pause menu, and ONE minimap
(P1's HUD, bottom-right of the top half — straddling the split it covered P2's place) that rings
both humans with their number. `race.ui` entries reach both halves (`hud.drainsUi = false` on all
but the last HUD); each HUD registers its own item-event collector (`_hudSys<pn>`). The body class
is `split2`, NOT `p2`: ui.css already uses `.p2` for "2nd place" on the results panel.

**Audio:** each human kart gets its own engine voice (`audio.js` `S.playerVoices`); the listener
is the midpoint of the two cameras (P1's heading); each human's drift/offroad loops are their own.

**Results / cup:** the results header shows both players (badge, portrait, place); the headline
celebrates the better-placed one ("P1 WINS!" / "P2 ON THE PODIUM!" / "GREAT RACE!") and the sub-line
cheers both; both rows are highlighted (P1 gold, P2 cyan) with badges. Best times record for both.
`M.cup.humans = [p1Racer, p2Racer]`: standings highlight + badge both, ties list humans first, the
podium names both players' places, both cheer on the floor (`stage.podium(order, [ids])`), and
either one winning unlocks Star Road.

**Measured:** gate (`tools/check.js`, 2P on Easy on every track: each control drives only its
own kart, per-player assist, both finish, ≤ 5 flip/spin AI item hits each — measured 0–2). Band
probe (15 races, wobbly kid P1 + a medium-AI "dad" P2, Easy): kid's mean place 6.1 with the
trailing-human band vs 7.5 with a nearest-human band (1P wobbly kid ≈ 5.6); dad 1.0. Perf: README
"Performance" (2P table). Browser: `node tools/twoplayer-test.mjs` → TWO PLAYER TEST: PASS.

## Online (online agent — `src/protocol.js`, `src/netgame.js`, `src/net.js`, `src/online.js`, `server/`)

Three permanent public lobbies, **EASY 🙂 / MEDIUM 😎 / HARD 🔥** (the menu's faces; the difficulty
drives the bots and the item mercy). Each is an 8-kart grid: up to **4 humans** (one per device, no
split screen online) and bots in every other slot. No accounts, no chat, no names. Players are
shown by their racer, with a cyan **P** (a floating marker over the kart, a ring in the rank list,
minimap and results) and a gold **YOU** for yourself.

**Lobby lifecycle** (`server/lobby.js`):
1. **idle.** No timer, no simulation.
2. The first human joins → **waiting**. Once the first racer has picked, a 12 s countdown
   (`NET.WAIT_S`) starts. It drops to 3 s when all 4 are in and picked.
3. → **starting.** START is sent `LOAD_S` (4 s) before the 3.6 s countdown, so every client has
   time to load and warm up. The countdown runs on the synced clock.
4. → **racing** → **results.** Results stay up for 10 s, and the race keeps running behind them.
5. → the next track in `ROTATION` (beach → ice → volcano → castle → **star**; Star Road is in, since
   online racing is its own reward).

Humans who join mid-race pick a racer and then **spectate**. The camera starts on the leader and
◀ ▶ (keys, pad or touch arrows) cycle through the karts. They race in the next one. **A human
leaving mid-race hands their kart to a bot** (same kart and place, the lobby's difficulty, no P
badge any more). If no human is left in the race, it is called at once. **The last human leaving
from any phase resets the lobby**: the race is dropped, the timer stops and it goes back to idle
(measured 0–0.4 % CPU). A member silent for 12 s is dropped, and a race is capped at laps × 100 +
75 s so an AFK kid can't hold a lobby.

**Authority** (Mario Kart style, the local feel is single player's):
- **Your own kart runs on your device** with the exact physics. It is created by the normal
  `createRace` for the server's grid and stepped by the normal `race.step` in main.js. It has zero
  input lag and is never corrected. The client sends its kart state 30 Hz, unreliable, 61 bytes.
- **The server owns everything else**, running the pure modules headlessly at 60 Hz: bots, items
  (boxes, stars, the roulette RNG, projectiles, hazards, hits, spills), laps and checkpoints,
  positions, the finish and the results.
  - Humans are `remote` karts there. Each report is brought forward to the step's time along an arc
    (the yaw rate comes from the last two reports), eased in (25 % of the error per step), and dead-
    reckoned between reports (≤ 0.5 s, so a hidden tab's kart waits).
  - A jump over 60 m with no respawn is refused, and speed is clamped at 45 m/s. That's loose on
    purpose: this is a family game, not anti-cheat.
- **Hits on a human.** The server decides the collision against the reconstructed position. The
  item `hit` event goes to everyone, and the victim's device applies `applyHit` to its own kart
  (clearing its mirrored shield/star first, because the server already decided). A super-star bump on
  a human goes through `items.hitKart` too (`race.starHit`), so the victim hears about it.
- **Items used by a human.** Pressing the item button sends `USE`, and the server fires the item.
  Self-effects come back as events the owner applies locally: Turbo Rocket → `addBoost`, Super Star
  → `invincT`, Bubble Shield. The TNT's hops are counted from a hop counter in the reports.
- **Kart-kart bumps.** Your device bumps your kart off the interpolated others (the normal
  `collideKarts`). The server bumps bots off the humans' reconstructed positions.

**Client** (`src/netgame.js`, PURE, shared by the browser and `tools/netbot.mjs`): `NetRace.attach(race)`
sets `race.netClient` and marks every other kart `remote`. It also sets `items.W.mirror`, which
stops the items world being simulated; it's filled from snapshots instead. It puts an injector first
in `race.systems`. Then:
- `preStep()`, before every step, sets remote karts from **snapshot interpolation**:
  - The view sits ~100 ms (`NET.INTERP`) behind the snapshot stream. The latency offset is the fastest
    (recv − t) over 3 s, slewed ≤ 1 ms per snapshot.
  - The view advances with the local sim clock, exactly DT per step. A wall-clock render time made
    frames that run 0 or 2 steps hitch every remote kart by ~35 cm.
  - x/z use a cubic Hermite through both snapshots' velocities. It extrapolates ≤ 250 ms when
    snapshots stop.
  - The snapshot carries every `animateRacer` field (drift, driftAngle, charge, boost, air, hit/spin,
    respawn), so leans, flames, flips and the rescue cloud show on remote karts.
  - It also mirrors your kart's server-owned fields (stars, item, roulette, shield, star, TNT, lap,
    place) and releases server events. Events about you go at once. Everyone else's wait until the
    view reaches them.
- The injector pushes those events into `race.events` inside the step, so main.js, hud.js and
  itemviews.js react exactly as offline.
- `postStep()` collects your cosmetic kart events and hops, and edge-detects the item button → USE.
- `correctClock(acc)` keeps `race.t` on the server's clock. It jumps when off by more than 0.25 s,
  and otherwise slews 2 ms per frame. This is how GO, the start boost and the race timer line up
  across devices.

**Hooks in shared files** (all small and commented; offline behaviour unchanged, all gates PASS):
- **race.js:** `kart.remote` skips physics, the start boost and the ev reset. `race.netClient` skips
  laps, positions, the rubber band and the end of the race. `race.starHit`.
- **physics.js:** `collideKarts(karts, starHit)`.
- **items.js:** `W.mirror` makes step() return early.
- **main.js:** `G.netGrid` (the server's grid in `entrantsFor`) and `G.net` = online.js's
  `{ setup(race) (after IV.attach), preStep, postStep, frame(dt) }`. `G.net` is null offline.
- **menu.js:** ONLINE under 2 PLAYERS; online.js is imported lazily so it can never break the offline
  game. `menuKit()` (the screen framework for online.js), the online pause, and the results buttons.
- **hud.js:** `k.netHuman` → `.hx-rank.net` and a cyan minimap ring.
- **ui.css:** the "ONLINE" section at the end. The main menu buttons shrank 3.8 → 3.25 vmin to fit
  6 buttons.

**Screens** (`src/online.js`, built with menu.js's framework, so keyboard, pad and touch work like
every other menu):
- **Lobby list.** Three cards: face, name, 4 human slots (portraits, `?` = choosing), and a state
  line: "EMPTY — BE THE FIRST!" / "STARTING IN 8" / "RACING · LAP 2/3 · Taco Volcano" / "FULL!".
  Live at 1 Hz.
- **Racer select.** The normal select look. Racers another human has are greyed with a P and can't be
  picked; the server refuses a race for one with `taken` too.
- **Waiting room.** "RACE STARTS IN 7", player cards (YOU / P / BOT), and the first/next track card.
  ▶ I'M READY! is a harmless focused button, and LEAVE is next to it.
- **Race / spectate.** A "WATCHING <racer> ◀ ▶ · YOU'RE IN THE NEXT RACE!" strip.
- **Online pause.** Esc / Start / ❚❚: "the race keeps going". KEEP RACING (focused), SETTINGS, LEAVE.
- **Results.** Other humans are ringed with P, you get YOU. "NEXT RACE IN 9" with **▶ NEXT RACE!
  focused** (a kid mashing A must never leave by accident) and LEAVE.
- **Connection pill.** Top-right on menus, bottom-left in a race: `ONLINE · 23 ms` (`· ws` on the
  fallback), `CONNECTING`, `OFFLINE`, `PLEASE REFRESH`. It's hidden in a touch race while healthy.
- **Problems.** An unreachable server gives "The online track is closed right now…" with auto-retry
  every 4 s and TRY AGAIN. A drop mid-race goes back to the lobby list with "Oops! We lost the
  connection…" and reconnects by itself. A protocol mismatch shows "please refresh the page!" with
  REFRESH.

**Wire** (`src/protocol.js`, `PROTOCOL_VERSION` 1, checked at HELLO):
- JSON messages `{t, …}` go over geckos `emit('m')`, where reliable = resent 4× every 50 ms, or over
  WebSocket text.
- The two hot paths are binary frames: SNAPSHOT at 20 Hz, unreliable, ~490 B for 8 karts plus items;
  and STATE at 30 Hz, unreliable, 61 B.
- Events (item events + lap/final_lap/finish/race_done) are batched per snapshot, reliable, with kart
  references as indexes.
- Transport is DAWG ARENA's: geckos.io v3, ICE mux on ONE UDP port, with a WebSocket fallback. The
  client picks WebRTC first (5 s timeout).
- Clock: a ping every second; the offset comes from the lowest-RTT of the last 12 and is slewed
  ≤ 1 ms per ping. A jumping offset moved each client's reported kart by v × jump on the server.
- Server URL: `?server=` wins; a private-IP page → same host :8955; anything else → `PROD_SERVER`
  (`https://orion3-net.advicedawg.com`). Ops and env: `server/README.md`.

**Measured** (`tools/online-test.mjs`: its own server + 3 netbots, 2 over WebRTC and 1 over WS, + the
GPU browser over WebRTC; 1-lap races):
- **Drawn-position jitter per rendered frame** (cm; distance from the time-weighted midpoint of the
  neighbouring frames):

  | network | remote humans p95 / max | bots p95 | your own kart p95 |
  |---|---|---|---|
  | LAN | 0.5–3.2 / ≤ 4.4 | 0.6–1.6 | 0.2–0.3 |
  | 100 ± 30 ms each way, 5 % loss | 1.1–2.8 / ≤ 5 | ≤ 1.9 | 0.2–0.4 |

  These are ranges across the final runs. A kart covers ~37 cm per frame at 22 m/s. Before the fixes
  it was 6–18 cm p95 on the LAN.
- **Snapshots:** 20.0 Hz, gap p95 54 ms on the LAN. On the bad network: 18.8 Hz, p95 97 ms, 6 % of
  steps extrapolated.
- **Items and hits resolve:** 9 netbot races had 9 hits on the netbots and 8 items fired; the browser
  saw 122 events in one race and 0 were released late.
- **Server:** 3 humans + 5 bots use 6–10 % of one core (the lobby's step is 0.3–0.4 ms at 60 Hz).
  Idle is 0–0.4 %.
- Gates: `node server/selftest.js` (in-process lifecycle + codecs + hits + real NetRace clients →
  SELFTEST: PASS) and `node tools/online-test.mjs [--lag 100 --jitter 30 --loss 0.05]` → ONLINE TEST:
  PASS.

## Verification (every agent)

- `node tools/check.js` — the gate. Must print PASS. It builds every track through the real
  `track.js`, checks geometry (closed, no self-overlap except tagged bridges, widths, item boxes
  and pads on the road, checkpoints ordered), and runs a **headless 8-AI race on each track**
  through the real `physics.js`/`ai.js`/`race.js`: every AI finishes 3 laps within a time
  limit, nobody is stuck > 3 s, lap times are sane. Add your own checks to it.
- `node src/physics.js` — physics self-test (slide/turbo timing, top speeds, hang-time boost, stat mapping).
- `node tools/balance.js [--n 48] [--kid] [--wobbly]` — the balance table (**Balance**); ~10 min for
  everything at N=48 on the hub, `--tracks`/`--diff` to narrow. Run it after any physics/AI/item tuning.
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
  `&auto=1` (auto-accelerate), `&hd=1`, `&shadows=0`, `&fx=0`, `&q=low|high|auto` (quality),
  `&players=2` (split screen; `&racer2=`, `&dev1=`/`&dev2=` `auto|kb|kbL|kbR|pad:N`, `&auto2=0|1`,
  `&helper1=`/`&helper2=0|1`). `window.__OTR` exposes game
  state for tests (see **Core runtime APIs**). UI: `?screen=<name>` opens a menu screen (see
  **Modes and UI**); `__OTR.menu` = `{ M, screen, show(name), action('up'|'ok'|'back'…), launch(trackId) }`.
- `node tools/slide-test.mjs` drives the player through a real power slide in the browser
  (3 perfect turbos) and screenshots each flame colour to `shots/slide/`.

## Quality, camera, loading (QA agent)

- **Quality** (`main.js` `QUAL`, `setQuality(v)` also on `__OTR` and the menu api; URL `?q=low|high|auto`;
  save `settings.quality`): `low` = pixel ratio ×0.85, no real-time shadow (player gets a blob), `fx.q = 0.5`
  (half the particles), AI karts culled at 150 m (230 m high). `auto` = high until the median rAF interval over
  two consecutive 2 s windows of racing exceeds 20.5 ms, then low for the session (never back up). Pixel ratio +
  particles apply at once; shadows only in `startRace` (the toggle recompiles every shader; compileAsync pays).
- **Race warm-up** (`startRace`): `compileAsync` → `renderer.initTexture` for every texture in the scene → one
  render with frustum culling off (uploads every vertex buffer). `loadTrack` awaits `texturesReady()` (trackmesh:
  every `loadTex` image in flight, 5 s cap) so a jpg can't land mid-race. `loadTrack` disposes the old track's
  geometries, materials and textures (`disposeGroup`).
- **Chase camera** (`camera.js`): slides sideways to stay `CAM.wallMargin` (0.9 m) inside the boundary line from
  `track.project` (no clamp on `'fall'` edges), eases back out; under `tunnel` samples caps height at
  `cy + CAM.tunnelCap` (5.5 m). main.js hides an AI kart that is within 2.4 m of the camera.
- **fx.js**: additive sprites fade out inside 5 m of the camera; every sprite's size is capped at 0.075 × its
  camera distance; exhaust flames are 0.17–0.4 m at alpha 0.55 (the old 0.55 m / 0.85 stacked to white over the kart).
- Tools: `tools/playtest.mjs` (AI-driven live race, chase shots every 4 s + contact sheet, `--perf` draw calls/
  tris/render() CPU/GPU timer ms/whole-frame CPU), `tools/realflow.mjs` (whole game in one session with real keys),
  `tools/input-test.mjs` (fake Xbox pad + keyboard), `tools/leakcheck.mjs` (memory across track switches).
  Measured numbers are in README.md "Performance".

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
  `shieldT`, `invincT` (super star: immune + knocks others aside + top speed), `stars` (≥10 = +`T.STAR_BONUS` top, 4 %), `cornerF` (corner scrub factor, 1 = none), `assist` (kid assist on:
the player on Easy / KID HELPER).
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
players ([{ index, easyBoost, assist }] — 2P, see **Two players**; then `race.humans`, kart `pn`,
`race.step([c1, c2])`), difficulty, laps, seed, easyBoost, noStall, assist })` (`assist` = kid assist for the player, default
`easyBoost ?? difficulty === 'easy'`) → `race` with `karts, brains, player, phase
('countdown'|'race'|'done'), t (s; negative during the countdown), order (by place), laps,
stats[] (per-kart gate stats), autoPlayer (AI drives the player)`, `race.step(playerCtrl)`,
`race.events` (this step: `{type:'count', n}`, `{type:'go'}`, `{type:'lap', kart, lap}`,
`{type:'final_lap', kart}`, `{type:'finish', kart, place}`, `{type:'race_done'}`, `{type:'stall',
kart}`, `{type:'kart', kart, e, v}` for every kart event incl. `start_boost`),
`race.addSystem(fn(race, dt))` (**items agent: hook item logic here** — runs every step after
physics and kart bumping, before laps), `race.results()`. Online: `kart.remote`, `race.netClient`,
`race.starHit(victim, by)` (see **Online**). `simulate(race, {maxT, playerCtrl, onStep})`
runs a whole race headless. Countdown = 3.6 s; start boost window −0.25..+0.1 s around GO
(early mash = stall, not on Easy). After the player finishes the AI drives their kart; the race is
called 20 s later (unfinished karts get estimated times).

**`ai.js`** (pure): `DIFFICULTY` table (pace, P(slide), P(turbo), reaction, start boost, rubber
band + its ramp distances, line, wobble, grab, dodge — see **Balance**), `createBrain(kart, track, difficulty,
seed)`, `drive(brain, race)` → control object, `kidAssist(kart, track, ctrl)` → the player's control with
the kid-assist steering nudge (race.js applies it when `kart.assist`), `ASSIST` (its tuning).

**`main.js`**: `setState(name)` / `onState(fn(state, prev))` — states `boot, title, countdown,
race, finished, results` (menu.js runs every menu screen inside `title`; see **Modes and UI**).
`window.__OTR`: `ready, state, race, track, player, humans, G, scene, camera, renderer, chase, fx, audio,
T, DT, In, camera2, chase2, hud2, views, override(ctrl|null, pn = 0)` (drive the player; pn 1 = P2), `advance(secs)` (fast-forward, silent),
`script(n, fn(k,i) → ctrl, {draw})` (step n frames with scripted controls; returns the player's
kart events), `hold(bool)` (freeze the live loop), `render()`, `info()` (`renderer.info` calls/
triangles), `loadTrack(id)`, `startRace()`, `endRace()`, `hud`, `menu`.

**`hud.js`** (UI agent): `createHud(el, { pn = 0 })` (pn: which human it follows, 2P) → `{ show(bool), update(view, race), count(n|'GO!'|null),
banner(text, ms, cls), event(text, {ms, cls, icon}), warn(key, text|null), pop(text, cls),
results(rows|null) }`; `view` = `{lap, laps, place, speed, charge, redStart, inRed, drift,
overheat, turbos, boostT, boostMaxT, stars, finished, raceTime, wrongWay}`; `race` feeds the rank
list, minimap, wrong-way, pops and item events. `menuOwnsResults` (set by menu.js) turns the stub
results panel off. Also exports `portraitURL(id, size)` (cached data URL of `renderPortrait`),
`clock(t)`, `ordSuffix(n)`.

**`input.js`**: `update()` once per frame; `controls` (same shape as the control object + `item`),
`hit(name)` edges (`hopA hopB item pause mute fullscreen confirm back up down left right`),
`settings.autoAccel`, `initTouch()` wires `[data-btn]` elements, `onGesture(fn)` (audio unlock).
2P: `players[0|1]` (`controls`, `hit`, `down`, `autoAccel`, `device`), `multi(on)`,
`setDevices(d1, d2)`, `autoDevices()`, `takeJoins()`, `deviceId()`, `deviceLabel(d)`,
`padIndices()`, `KEYMAP_L` / `KEYMAP_R` (see **Two players**).

**`trackmesh.js`**: `buildTrackMesh(track)` → `{ group, env, sky, groundAt, isClear, aboveWater,
update(dt,t) }`; `loadTex(name, fallback, opts)` (instant procedural canvas, upgrades to
`assets/tex/<name>.jpg|png` when it loads); `PROC` (procedural textures), `THEMES`, `WALLS`,
`mergeGeos(geos)`.

**`fx.js`**: `createFx(scene)` → `{ kart(k, rig, dt, camPos), burst(kind, pos, opts), update(dt, camera),
clearSkids() }` (`update(0, cam)` re-billboards for another camera without stepping — 2P's second view); burst kinds `land poof fizzle overheat wall splash turbo pad sparkle`; `FLAME`
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
  (wired by the ui agent, incl. results/podium VO, `cheer`, winner bark and `vo_new_record`.)
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
