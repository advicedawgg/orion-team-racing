// Item unit checks for the gate (tools/check.js imports runItemChecks). Everything runs through
// the REAL items.js + physics.js + race.js; scenarios teleport karts and step the item system.
import { DT, T, stepKart, baseTop } from '../src/physics.js';
import { createRace } from '../src/race.js';
import { createItems, IT, ODDS } from '../src/items.js';

const ENT = Array.from({ length: 8 }, (_, i) => ({ racerId: 'k' + i, stats: { speed: 3, accel: 3, turn: 3 } }));
const NOC = { steer: 0, throttle: 0, brake: 0, hopA: false, hopB: false };

/** A race past the countdown with items attached; karts frozen in place unless a test moves them. */
function setup(tr, { diff = 'medium', seed = 5, player = -1 } = {}) {
  const race = createRace({ track: tr, entrants: ENT, playerIndex: player, difficulty: diff, seed });
  const W = createItems(race, { seed });
  race.phase = 'race'; race.t = 1;
  for (const k of race.karts) { k.frozen = false; k.ctrl = NOC; }
  return { race, W, K: race.karts };
}
/** Put kart k at (s, lat) on the road, heading along it. */
function put(tr, k, s, lat = 0, speed = 0) {
  for (let g = 0; g < 60 && (tr.FLAG[tr.idx(s)] & 1); g++) s += 2;   // never inside a jump's gap (the kart would just fall)
  const p = tr.pointAt(s, lat);
  k.pos.x = p.x; k.pos.y = p.y; k.pos.z = p.z; k.yaw = p.yaw; k.s = tr.wrapS(s); k.lat = lat; k.si = tr.idx(s);
  k.speed = speed; k.air = false; k.vy = 0; k.hitT = 0; k.spinT = 0;
}
const park = (tr, K, from = 1) => K.slice(from).forEach((k, i) => put(tr, k, tr.length * 0.5 + i * 12, 0));
/** Step only the item system (karts stay put) n frames; returns the item events. */
function itemSteps(race, W, n, each) {
  const out = [];
  for (let i = 0; i < n; i++) {
    race.events.length = 0;
    for (const k of race.karts) k.ev.length = 0;
    if (each) each(i);
    W.step(DT);
    out.push(...race.events.filter(e => e.type === 'item'));
  }
  return out;
}
const has = (evs, e, k) => evs.some(x => x.e === e && (!k || x.kart === k));

export function runItemChecks(tr, ok) {
  // 1. stars: collect, cap at 10, Super raises top speed
  {
    const { race, W, K } = setup(tr); const k = K[0]; park(tr, K);
    k.stars = 8;
    const base0 = baseTop(k);
    let evs = [];
    for (const st of W.stars.slice(0, 4)) { k.pos.x = st.x; k.pos.y = st.y; k.pos.z = st.z; evs.push(...itemSteps(race, W, 1)); }
    ok('items: stars collect, cap at 10, 10 = Super (+8% top speed)', k.stars === 10 && has(evs, 'super', k) && evs.filter(e => e.e === 'star').length >= 4 && Math.abs(baseTop(k) / base0 - (1 + T.STAR_BONUS)) < 1e-6,
      `stars=${k.stars}, star events ${evs.filter(e => e.e === 'star').length}, top ${base0.toFixed(1)}→${baseTop(k).toFixed(1)}`);
    const dead = W.stars.slice(0, 4).every(s => !s.alive);
    itemSteps(race, W, Math.ceil(IT.STAR_RESPAWN / DT) + 2, () => { k.pos.x = 1e4; });
    ok('items: collected stars respawn', dead && W.stars.slice(0, 4).every(s => s.alive), `${IT.STAR_RESPAWN} s`);
  }
  // 2. ? box: breaks, roulette ~1.5 s, item arrives; box respawns in 3 s
  {
    const { race, W, K } = setup(tr); const k = K[0]; park(tr, K);
    const b = W.boxes[0];
    k.pos.x = b.x + 1.2; k.pos.y = b.y; k.pos.z = b.z;     // generous pickup radius: 1.2 m off still counts
    let evs = itemSteps(race, W, 1);
    const rolled = has(evs, 'box', k) && has(evs, 'roulette', k) && k.roulT > 0;
    k.pos.x = 1e4;
    evs = itemSteps(race, W, Math.round(IT.ROULETTE / DT) + 1);
    ok('items: ? box breaks (1.2 m off-centre), roulette 1.5 s, then an item', rolled && has(evs, 'got', k) && k.item, `got ${k.item}`);
    itemSteps(race, W, Math.round((IT.BOX_RESPAWN - IT.ROULETTE) / DT) + 2);
    ok('items: box respawns after 3 s', b.alive);
  }
  // 3. roulette odds by position
  {
    const { W, K } = setup(tr); const k = K[0];
    const tally = place => { k.place = place; const c = {}; for (let i = 0; i < 3000; i++) { const id = W.roll(k); c[id] = (c[id] || 0) + 1; } return c; };
    const first = tally(1), last = tally(8);
    const catchUp = c => ((c.rocket || 0) + (c.turbo || 0) + (c.superstar || 0) + (c.remote || 0) + (c.warp || 0)) / 3000;
    ok('items: leader never rolls warp/superstar/remote; the back gets mostly catch-up items', !first.warp && !first.superstar && !first.remote && catchUp(last) > 0.6 && catchUp(first) < 0.15,
      `1st catch-up ${(catchUp(first) * 100) | 0}%, 8th ${(catchUp(last) * 100) | 0}%`);
    void ODDS;
  }
  // 4. shield absorbs exactly one hit
  {
    const { race, W, K } = setup(tr); const k = K[0]; park(tr, K); put(tr, k, 100);
    W.give(k, 'shield'); W.use(k);
    const up = k.shieldT >= IT.SHIELD.t - 0.01;
    const r1 = W.hitKart(k, 'flip', K[1], 'rocket'), r2 = W.hitKart(k, 'flip', K[1], 'rocket');
    ok('items: bubble shield (10 s) absorbs one hit, the next lands', up && !r1 && r2 && k.hitT > 0 && k.shieldT === 0);
    void race;
  }
  // 5. armed shield fires forward and spins the kart ahead
  {
    const { race, W, K } = setup(tr); const [a, b] = K; park(tr, K, 2);
    put(tr, a, 200, 0, 20); put(tr, b, 225, 0.5, 0);
    W.give(a, 'shield'); W.use(a);
    race.events.length = 0; W.use(a);
    const evs = [...race.events, ...itemSteps(race, W, 90)];
    ok('items: pressing again fires the bubble forward (spin-out)', has(evs, 'shield_fire', a) && evs.some(e => e.e === 'hit' && e.kart === b && e.item === 'shield') && b.spinT > 0 && a.shieldT === 0);
  }
  // 6. TNT: lands on the head; 5 hops shake it off (real physics hops); no hops = boom at 3 s
  for (const hops of [true, false]) {
    const { race, W, K } = setup(tr); const [a, b] = K; park(tr, K, 2);
    put(tr, a, 300, 0, 0); put(tr, b, 270, 0, 0);
    W.give(a, 'tnt'); W.use(a);
    const h = W.hazards[0];
    itemSteps(race, W, Math.ceil(IT.TNT.arm / DT));
    b.pos.x = h.x; b.pos.z = h.z; b.pos.y = h.y;
    let evs = itemSteps(race, W, 1);
    const on = !!b.tnt && has(evs, 'tnt_on', b);
    // now drive b with real physics: hop every time it's back on the ground (or not at all)
    let prevA = false;
    for (let i = 0; i < Math.ceil((IT.TNT.fuse + 0.5) / DT); i++) {
      race.events.length = 0; b.ev.length = 0;
      const wantHop = hops && !b.air && !prevA;
      const c = { steer: 0, throttle: 1, brake: 0, hopA: wantHop, hopB: false };
      prevA = wantHop;
      stepKart(b, c, tr); b.ctrl = c;
      W.step(DT);
      evs.push(...race.events.filter(e => e.type === 'item'));
      if (!b.tnt) break;
    }
    if (hops) ok('items: TNT lands on the head; 5 real hops shake it off', on && has(evs, 'tnt_off', b) && evs.filter(e => e.e === 'tnt_hop').length === 5 && b.hitT === 0, `${evs.filter(e => e.e === 'tnt_hop').length} hops`);
    else ok('items: TNT ticks 3-2-1 and flips you if you don\'t hop', on && evs.filter(e => e.e === 'tnt_tick').map(e => e.n).join('') === '321' && has(evs, 'hit', b) && b.hitKind === 'flip');
  }
  // 7. Super (10 stars): TNT becomes Nitro and explodes on contact; rockets come in threes
  {
    const { race, W, K } = setup(tr); const [a, b] = K; park(tr, K, 2);
    put(tr, a, 300); put(tr, b, 280);
    a.stars = 10; W.give(a, 'tnt'); const evU = []; race.events.length = 0; W.use(a); evU.push(...race.events);
    const h = W.hazards[0];
    b.pos.x = h.x; b.pos.z = h.z; b.pos.y = h.y;
    put(tr, a, 330);                              // the dropper drives on (a Nitro blast would catch it too)
    const evs = itemSteps(race, W, 1);
    W.give(a, 'rocket');
    ok('items: Super TNT = Nitro, explodes on contact; Super rocket = 3', h.kind === 'nitro' && evU.some(e => e.e === 'use' && e.item === 'nitro') && has(evs, 'explode') && b.hitT > 0 && !b.tnt && a.itemCount === 3);
  }
  // 8. rocket homes on the racer directly ahead, on another lane, through the real race sim
  {
    const { race, W, K } = setup(tr, { diff: 'hard' });
    const a = K[0], b = K[1];
    park(tr, K, 2);
    put(tr, a, 120, -4, 20); put(tr, b, 185, 4.5, 20);
    for (const k of K) { k.item = null; k.stars = 0; k.lapsDone = 0; k.nextCp = 0; }
    race.step(NOC);                              // positions update
    W.give(a, 'rocket');
    const target = race.order.find(o => o.place === a.place - 1);
    W.use(a);
    const locked = target.lockedBy === 1;
    let hitT = null;
    for (let i = 0; i < 8 / DT && hitT == null; i++) {
      race.step(NOC);
      if (race.events.some(e => e.type === 'item' && (e.e === 'hit' || e.e === 'blocked') && e.item === 'rocket' && e.kart === target)) hitT = i * DT;
    }
    ok('items: rocket locks the racer directly ahead and homes onto it (another lane, 65 m)', target === b && locked && hitT != null && target.lockedBy === 0, `hit after ${hitT?.toFixed(2)} s`);
  }
  // 9. taco bomb: rolls ahead, a second press detonates it early; blast flips karts nearby
  {
    const { race, W, K } = setup(tr); const [a, b] = K; park(tr, K, 2);
    put(tr, a, 400, 0, 20); put(tr, b, 428, 3.2, 0);
    W.give(a, 'taco_bomb'); W.use(a);
    let evs = itemSteps(race, W, 40);            // ~0.66 s × 36 m/s ≈ 24 m + start 2.4 m ahead → b is 3.5 m to the side, inside the 4.5 m blast
    const bomb = W.projs.find(p => p.kind === 'taco_bomb');
    const rolled = bomb && bomb.travelled > 15;
    race.events.length = 0; W.use(a);
    evs = race.events.filter(e => e.type === 'item');
    ok('items: taco bomb rolls down the road, second press detonates it, blast flips a kart 3.5 m away', rolled && has(evs, 'detonate', a) && has(evs, 'explode') && has(evs, 'hit', b) && !a.bomb, `rolled ${bomb?.travelled.toFixed(1)} m`);
    // backward throw
    W.give(a, 'taco_bomb'); W.use(a, true);
    const back = W.projs.find(p => p.kind === 'taco_bomb' && p.alive);
    itemSteps(race, W, 30);
    ok('items: ↓ + item rolls the bomb backward', back && tr.dS(400, back.s) < -5, `at ${tr.dS(400, back?.s ?? 400).toFixed(1)} m`);
  }
  // 10. ice cream puddle spins out whoever drives in, once
  {
    const { race, W, K } = setup(tr); const [a, b] = K; park(tr, K, 2);
    put(tr, a, 500); put(tr, b, 470);
    W.give(a, 'icecream'); W.use(a);
    const h = W.hazards[0];
    b.pos.x = h.x + 1.5; b.pos.z = h.z; b.pos.y = h.y;
    const evs = itemSteps(race, W, 2);
    ok('items: ice cream splat spins out (then it\'s gone)', has(evs, 'splat', b) && b.spinT > 0 && !W.hazards.length);
  }
  // 11. getting hit spills stars that others can pick up
  {
    const { race, W, K } = setup(tr); const [a, b] = K; park(tr, K, 2);
    put(tr, a, 600, 0, 15); put(tr, b, 640);
    a.stars = 6;
    race.events.length = 0; a.ev.length = 0;
    W.hitKart(a, 'flip', b, 'rocket');
    const lost = 6 - a.stars;
    W.step(DT);                                   // the system spills what applyHit reported in a.ev
    let evs;
    const n = W.spills.length;
    itemSteps(race, W, 90);
    const rest = W.spills.every(s => s.rest);
    const sp = W.spills[0];
    b.pos.x = sp.x; b.pos.y = sp.y; b.pos.z = sp.z;
    evs = itemSteps(race, W, 1);
    ok('items: a flip spills 3 stars; they land and are collectible', lost === 3 && n === 3 && rest && has(evs, 'star', b) && b.stars === 1, `lost ${lost}, spilled ${n}`);
  }
  // 12. TV remote wobbles everyone else; super star = invincible, bumps others aside
  {
    const { race, W, K } = setup(tr); const [a] = K; park(tr, K, 1); put(tr, a, 700);
    race.events.length = 0;
    W.give(a, 'remote'); W.use(a);
    const banner = race.events.find(e => e.type === 'item' && e.e === 'remote');
    ok('items: TV remote slows everyone else 3 s + "KING DAD PRESSED PAUSE!" event', K.slice(1).every(k => k.slowT >= IT.REMOTE.t - 1e-6) && a.slowT === 0 && banner?.text === IT.REMOTE_TEXT);
    W.give(a, 'superstar'); W.use(a);
    const blocked = !W.hitKart(a, 'flip', K[1], 'rocket');
    ok('items: super star = 7 s invincible', a.invincT === IT.STAR.t && blocked);
  }
  // 13. warp star flies to the leader and hits it (and whoever is in the way)
  {
    const { race, W, K } = setup(tr, { diff: 'hard' });
    park(tr, K, 3);
    const [a, m, lead] = K;
    put(tr, a, 100, 0, 15); put(tr, m, 160, 0.5, 15); put(tr, lead, 260, -3, 15);
    for (const k of K.slice(3)) put(tr, k, 20 + k.index * 3, 0, 0);
    for (const k of K) { k.item = null; k.lapsDone = 0; k.nextCp = 0; }
    race.step(NOC);
    W.give(a, 'warp'); W.use(a);
    const hits = new Set();
    for (let i = 0; i < 6 / DT; i++) { race.step(NOC); for (const e of race.events) if (e.type === 'item' && e.e === 'hit' && e.item === 'warp') hits.add(e.kart); }
    const leader = race.order[0] === a ? race.order[1] : race.order[0];
    ok('items: warp star hits the leader and everyone in its path', hits.has(lead) && hits.has(m), `hit ${[...hits].map(k => k.racerId).join(',')} (leader ${leader.racerId})`);
  }
}
