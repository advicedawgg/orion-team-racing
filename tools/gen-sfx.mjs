/**
 * Generate OTR's sound effects with the ElevenLabs sound-generation API.
 *   node tools/gen-sfx.mjs [name ...] [--force] [--regen] [--dry]
 *
 * Output: mono 44.1 kHz MP3 in assets/sfx/ + assets/sfx/index.json (src/audio.js loads these over
 * its synth fallbacks — a missing file is never silent). Variants are `name.v2.mp3` etc.
 * Raw API responses live in tools/sfx-raw/ so re-processing never re-bills:
 *   --force  re-process from the cached raw responses (free)
 *   --regen  call the API again for the named sounds (costs credits — name them!)
 *
 * Fields: [prompt, seconds, prompt_influence, target dB (loudest 100 ms), opts]
 *   opts.maxDur  hard-trim after silence removal (ticks/blips the API pads out)
 *   opts.loop    ask the API for a seamless loop (eleven_text_to_sound_v2) and skip trimming
 *   opts.variants  how many takes to keep (played at random)
 *
 * Targets by category (loudest-100 ms dBFS): UI -18..-16, movement -16, pickups -15,
 * jingles -14, turbos -12, impacts -10. Balance after that is TRIM in src/audio.js,
 * measured with tools/mixprobe.mjs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadKey, credits, exists, processClip, writeSfxIndex, elevenPost, SFX_DIR, RAW_DIR } from './audio-lib.mjs';

const K = 'cartoon kart racing video game, kid friendly';
export const SOUNDS = {
  countdown: ['retro arcade race countdown beep, one short mid-pitched electronic beep, clean, no music', 0.5, 0.8, -16, { maxDur: 0.3 }],
  go: ['retro arcade race start signal, one long bright high-pitched electronic beep, clean, no music', 0.8, 0.8, -15, { maxDur: 0.7 }],
  hop: [`cartoon boing spring jump, quick bouncy rising pitch, bright and playful, ${K}`, 0.5, 0.6, -16, { variants: 2 }],
  land: [`small go-kart landing on the road, soft rubbery thud with a tiny spring bounce, ${K}`, 0.5, 0.6, -16, { variants: 2 }],
  drift_start: [`go-kart tyres chirp and screech as it starts a power slide, short, ${K}`, 0.6, 0.6, -16],
  drift_loop: ['continuous go-kart tyre squeal while drifting on asphalt, steady, no engine', 2.0, 0.6, -18, { loop: true }],
  charge_red: ['bright sparkly ding, one short high chime, arcade ready signal, no music', 0.5, 0.7, -17],
  turbo1: ['short jet engine boost, whoosh of rushing air rising in pitch, arcade racing game sound effect', 0.8, 0.6, -13],
  turbo2: ['jet engine turbo boost, strong whoosh of rushing air with a rising roar, arcade racing game sound effect', 1.0, 0.6, -12],
  turbo3: ['massive rocket boost blast, roaring jet whoosh rising in pitch, arcade racing game, powerful and exciting', 1.5, 0.6, -11],
  fizzle: ['cartoon engine sputter fizzle, a sad little puff of smoke, pfft, short, funny', 0.6, 0.6, -16],
  overheat: ['engine overheating, loud steam hiss and a sputtering clanky cough, cartoon', 1.2, 0.6, -15],
  pad: [`kart drives over a speed boost pad, zappy electric whoosh rising in pitch, ${K}`, 0.8, 0.6, -13],
  start_boost: ['race car launching off the start line, engine roar and a rocket whoosh, arcade racing game', 1.3, 0.6, -12],
  wall: ['toy go-kart crashes into a padded wall, rubbery bonk with a plastic clunk, cartoon, short', 0.5, 0.65, -13, { variants: 2 }],
  bump: ['two toy go-karts lightly bump together, soft rubber bonk, cartoon, short', 0.5, 0.65, -15, { variants: 2 }],
  offroad: ['tyres rolling over gravel and grass, crunchy bumpy rattling, close', 1.0, 0.65, -16],
  star: ['collecting a shiny star in a video game, bright sparkly pop with a twinkle, short, cheerful', 0.5, 0.65, -15, { variants: 2 }],
  item_box: [`smashing an item box, crisp cardboard pop with a magical sparkle, ${K}`, 0.7, 0.6, -14],
  roulette: ['one single short plastic tick of a prize wheel, clicky, dry', 0.5, 0.8, -18, { maxDur: 0.12 }],
  item_get: ['video game item received jingle, quick happy two-note chime, bright, no drums', 0.7, 0.65, -15],
  bomb_roll: ['heavy ball rolling fast along a road, steady rumbly rolling, cartoon', 1.5, 0.6, -17, { loop: true }],
  explode: ['big cartoon explosion, punchy boom with a poof of smoke, fun not scary, kids game', 1.3, 0.6, -10, { variants: 2 }],
  rocket: ['cartoon rocket launching, whoosh and fizz of a firework rocket taking off', 1.0, 0.6, -13],
  rocket_lock: ['target lock-on warning, two quick electronic beeps, video game, clean', 0.5, 0.75, -16],
  tnt_drop: ['wooden crate dropped onto the road, hollow wooden thunk, cartoon', 0.5, 0.65, -14],
  tnt_on_head: ['wooden box bonks onto a head, hollow wooden bonk followed by a springy boing, cartoon', 0.8, 0.6, -14],
  tnt_tick: ['one single loud cartoon clock tick, dry wooden click', 0.5, 0.8, -16, { maxDur: 0.15 }],
  nitro: ['cartoon explosion with a glass crate shattering and a fizzy pop, kids game', 1.1, 0.6, -10],
  splat: ['cartoon splat of melted ice cream, wet squelchy gooey splat, funny', 0.6, 0.6, -14],
  spinout: ['cartoon character spinning out, slide whistle going down with a wobbly twirl, funny', 1.0, 0.6, -14],
  shield_up: ['magical bubble shield forming, bubbly gurgle with a shimmering rising tone, cartoon', 0.9, 0.6, -15],
  shield_pop: ['big soap bubble popping, cartoon pop with a sparkle', 0.5, 0.6, -14],
  super_star: ['magical invincibility power up, rising sparkling chimes and a whoosh, video game, joyful', 1.5, 0.6, -13],
  remote: ['a remote control click followed by a loud electric buzzing zap, bzzzzt, cartoon TV switching off', 1.0, 0.6, -14],
  warp: ['cartoon warp star flying away, magical whoosh with a zooming twinkle', 1.3, 0.6, -13],
  flip: ['cartoon go-kart flipping through the air, whooshy spin with a boing, funny', 0.8, 0.6, -14],
  lap: ['two bright ascending bell chimes, ding ding, video game lap complete', 0.8, 0.7, -15],
  final_lap: ['final lap fanfare, short exciting brass trumpet flourish, video game', 1.4, 0.6, -14],
  finish: ['race finish fanfare, short triumphant brass flourish with a cymbal, video game', 1.8, 0.6, -13],
  win: ['short victory jingle, happy triumphant brass and bells fanfare, video game winner', 2.8, 0.55, -14],
  lose: ['funny sad trombone, wah wah wah wahhh, cartoon, gentle', 2.2, 0.7, -15],
  menu_move: ['soft short menu cursor blip, video game user interface, clean', 0.5, 0.8, -18, { maxDur: 0.12 }],
  menu_ok: ['video game menu confirm sound, bright happy two-note chime, short, clean', 0.5, 0.75, -16],
  menu_back: ['video game menu cancel sound, soft descending two-note blip, short, clean', 0.5, 0.75, -17],
  respawn: ['magical cartoon pop-in, a character reappears with a twinkly sparkle and a soft poof', 0.8, 0.6, -14],
  meow: ['a cute friendly cat meow, short, clean, close', 0.7, 0.7, -15, { variants: 2 }],
  purr: ['domestic cat purring loudly, close up, real cat', 1.5, 0.7, -17],
  cheer: ['small group of children cheering yay, happy, short', 1.5, 0.6, -15],
  splash: ['cartoon splash, a go-kart plunges through a puddle, big playful water splash', 0.8, 0.6, -14],
  star_spill: ['several small stars scattering and bouncing away, descending twinkly pings, cartoon', 0.7, 0.6, -15],
};

async function main() {
  const args = process.argv.slice(2);
  const only = args.filter(a => !a.startsWith('--'));
  const force = args.includes('--force'), regen = args.includes('--regen'), dry = args.includes('--dry');
  if (regen && !only.length) { console.error('--regen needs explicit sound names (it costs credits)'); process.exit(1); }
  await fs.mkdir(SFX_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
  const key = await loadKey();
  const c0 = dry ? null : await credits(key);

  const todo = [];
  for (const [name, [prompt, dur, infl, target, opts = {}]] of Object.entries(SOUNDS)) {
    if (only.length && !only.includes(name)) continue;
    const nv = opts.variants || 1;
    for (let v = 1; v <= nv; v++) todo.push({ name, v, prompt, dur, infl, target, opts });
  }

  const work = async ({ name, v, prompt, dur, infl, target, opts }) => {
    const tag = v === 1 ? name : `${name}.v${v}`;
    const out = path.join(SFX_DIR, `${tag}.mp3`);
    const raw = path.join(RAW_DIR, `${tag}.mp3`);
    const haveOut = await exists(out), haveRaw = await exists(raw);
    if (haveOut && !force && !regen) return `skip ${tag}`;
    let fetched = false;
    if (!haveRaw || regen) {
      if (dry) return `would fetch ${tag}`;
      const body = { text: prompt, duration_seconds: Math.max(0.5, dur), prompt_influence: infl, model_id: 'eleven_text_to_sound_v2' };
      if (opts.loop) body.loop = true;
      const r = await elevenPost(key, 'https://api.elevenlabs.io/v1/sound-generation', body);
      if (!r.buf) return `FAILED ${tag} ${r.error} ${r.text ?? ''}`;
      await fs.writeFile(raw, r.buf); fetched = true;
    }
    const m = await processClip(raw, out, { target, maxDur: opts.maxDur || 0, loop: !!opts.loop });
    return `${tag.padEnd(14)} ${m.dur.toFixed(2)}s  loud ${m.loud.toFixed(1)}  peak ${m.peak.toFixed(1)}  gain ${m.gain >= 0 ? '+' : ''}${m.gain.toFixed(1)}${fetched ? '' : '  (cached raw)'}`;
  };
  // 4 in flight — polite to the API, quick enough
  for (let i = 0; i < todo.length; i += 3) {   // starter plan: 4 concurrent account-wide
    const res = await Promise.all(todo.slice(i, i + 3).map(w => work(w).catch(e => `ERROR ${w.name}: ${e.message}`)));
    for (const r of res) console.log(r);
  }
  const n = await writeSfxIndex();
  console.log(`index.json: ${n} names`);
  if (c0) { const c1 = await credits(key); if (c1) console.log(`credits: ${c1.used - c0.used} used this run, ${c1.used}/${c1.limit} this period`); }
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
