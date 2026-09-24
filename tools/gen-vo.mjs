/**
 * Announcer + character voice lines via ElevenLabs.   node tools/gen-vo.mjs [name ...] [--force] [--regen]
 *
 * TTS model eleven_v3 (audio tags like [excited] work). Output assets/sfx/vo_*.mp3 (same folder and
 * index.json as the SFX — src/audio.js routes vo_* to the one-at-a-time announcer channel).
 * Raw responses cached in tools/sfx-raw/ exactly like gen-sfx.mjs (--force = free reprocess,
 * --regen = re-bill, needs names).
 *
 * Voices (premade/library voices on the account, auditioned 2026-09-25 by two audio models):
 *   announcer  Charlie  — Australian, young, hyped
 *   King Dad   Russo    — dramatic Australian TV (pompous-king comedy)
 *   Mum        Sophia   — young Australian female, warm
 *   Orion      Jessica  — playful/bright, pitched up (rubberband, formants shifted) toward a kid
 *   Sootie / baddies     — sound-generation vocalisations, not speech
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadKey, credits, exists, processClip, writeSfxIndex, elevenPost, SFX_DIR, RAW_DIR } from './audio-lib.mjs';

const V = {
  announcer: 'IKne3meq5aSn9XLyUdCD', // Charlie
  kingdad: 'DwI0NZuZgKu8SNwnpa1x',   // Russo
  mum: 'LtPsVjX1k0Kl4StEMZPK',       // Sophia
  orion: 'cgSgspJ2msm6clMCkdW9',     // Jessica (+ pitch)
};
const KID = 'rubberband=pitch=1.26:formant=shifted:tempo=1.0';
const A = (text, o = {}) => ({ text, voice: V.announcer, ...o });
const T = -14; // VO loudest-100 ms target

export const LINES = {
  vo_3: A('[excited] Three!'), vo_2: A('[excited] Two!'), vo_1: A('[excited] One!'), vo_go: A('[shouting] GO!'),
  vo_ready: A('[excited] Ready?'),
  vo_final_lap: A('[excited] Final lap!'), vo_lap_2: A('[excited] Lap two!'),
  vo_you_win: A('[excited] You win!'), vo_great_race: A('[warmly] Great race!'),
  vo_so_close: A('[warmly] So close! Try again!'), vo_new_record: A('[excited] New record!'),
  vo_title: A('[shouting excitedly] Orion Team Racing!'), vo_choose: A('[excited] Choose your racer!'),
  vo_orion_cup: A('[excited] The Orion Cup!'),
  vo_great_slide: A('[excited] Great slide!'), vo_super_turbo: A('[excited] Super turbo!'),
  vo_ouch: A('[playfully] Ouch!'), vo_nice_shot: A('[excited] Nice shot!'), vo_whoa: A('[surprised] Whoa!'),
  vo_boom: A('[excited] Boom!'),
  vo_taco_bomb: A('[excited] Taco Bomb!'), vo_rocket: A('[excited] Cosmic Rocket!'), vo_tnt: A('[shouting excitedly] T! N! T!'),
  vo_ice_cream: A('[excited] Ice Cream Splat!'), vo_shield: A('[excited] Bubble Shield!'),
  vo_turbo: A('[excited] Turbo Rocket!'), vo_super_star: A('[excited] Super Star!'),
  vo_tv_remote: A('[excited] TV Remote!'), vo_warp_star: A('[excited] Warp Star!'),
  vo_ten_stars: A('[excited] Ten stars! Super power!'),
  vo_orion_wins: A('[excited] Orion wins!'), vo_sootie_wins: A('[excited] Sootie wins!'),
  vo_kingdad_wins: A('[excited] King Dad wins!'), vo_mum_wins: A('[excited] Mum wins!'),
  // keyed by racer id, spoken with the display name from src/racers.js RACERS
  vo_grumblin_wins: A('[excited] Grumbles wins!'), vo_prickle_wins: A('[excited] Prickles wins!'),
  vo_jelly_wins: A('[excited] Wibble wins!'), vo_zapdrone_wins: A('[excited] Zappy wins!'),

  // character barks (audio.bark(racerId, kind))
  vo_orion_woohoo: { text: '[excited] Woo-hoo!', voice: V.orion, pre: KID },
  vo_orion_yeah: { text: '[excited] Yeah!', voice: V.orion, pre: KID },
  vo_orion_uhoh: { text: '[surprised] Uh-oh!', voice: V.orion, pre: KID },
  vo_kingdad_count: { text: "[mock stern] Don't make me count to three!", voice: V.kingdad },
  vo_kingdad_back: { text: '[groaning] Ooh, my back!', voice: V.kingdad },
  vo_kingdad_remote: { text: '[shouting triumphantly] Everybody... PAUSE!', voice: V.kingdad },
  vo_kingdad_haha: { text: '[laughing] Ha ha! The King is fast!', voice: V.kingdad },
  vo_mum_goodjob: { text: '[warmly] Good job, sweetheart!', voice: V.mum },
  vo_mum_careful: { text: '[gently] Careful, darling!', voice: V.mum },
  vo_mum_wheee: { text: '[excited] Wheee!', voice: V.mum },
  vo_grumblin_grr: { sfx: 'grumpy little cartoon monster growl, grrrr, funny, not scary', dur: 0.9 },
  vo_prickle_huff: { sfx: 'a small cartoon hedgehog huffing and squeaking, cute and grumpy', dur: 0.8 },
  vo_jelly_wobble: { sfx: 'wobbly jelly, squishy boing boing wobble, cartoon, funny', dur: 0.9 },
  vo_zapdrone_zap: { sfx: 'tiny cartoon robot, electric zap then a happy beep boop, cute', dur: 0.9 },
};

async function main() {
  const args = process.argv.slice(2);
  const only = args.filter(a => !a.startsWith('--'));
  const force = args.includes('--force'), regen = args.includes('--regen');
  if (regen && !only.length) { console.error('--regen needs explicit line names (it costs credits)'); process.exit(1); }
  await fs.mkdir(SFX_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
  const key = await loadKey();
  const c0 = await credits(key);
  const todo = Object.entries(LINES).filter(([n]) => !only.length || only.includes(n));
  const work = async ([name, L]) => {
    const out = path.join(SFX_DIR, `${name}.mp3`), raw = path.join(RAW_DIR, `${name}.mp3`);
    const haveOut = await exists(out), haveRaw = await exists(raw);
    if (haveOut && !force && !regen) return `skip ${name}`;
    let fetched = false;
    if (!haveRaw || regen) {
      const r = L.sfx
        ? await elevenPost(key, 'https://api.elevenlabs.io/v1/sound-generation', { text: L.sfx, duration_seconds: Math.max(0.5, L.dur || 1), prompt_influence: 0.6, model_id: 'eleven_text_to_sound_v2' })
        : await elevenPost(key, `https://api.elevenlabs.io/v1/text-to-speech/${L.voice}?output_format=mp3_44100_128`, {
          text: L.text, model_id: 'eleven_v3',
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true },
        });
      if (!r.buf) return `FAILED ${name} ${r.error} ${r.text ?? ''}`;
      await fs.writeFile(raw, r.buf); fetched = true;
    }
    const m = await processClip(raw, out, { target: L.target ?? T, pre: L.pre || '', lead: -38, tail: -44 });   // v3 leaves breaths/room tail around lines; countdown needs a tight onset
    return `${name.padEnd(18)} ${m.dur.toFixed(2)}s  loud ${m.loud.toFixed(1)}  peak ${m.peak.toFixed(1)}${fetched ? '' : '  (cached raw)'}  "${L.text ?? L.sfx}"`;
  };
  // the starter plan allows 4 concurrent requests account-wide; other tools may be using one
  for (let i = 0; i < todo.length; i += 3) {
    const res = await Promise.all(todo.slice(i, i + 3).map(w => work(w).catch(e => `ERROR ${w[0]}: ${e.message}`)));
    for (const r of res) console.log(r);
  }
  console.log(`index.json: ${await writeSfxIndex()} names`);
  const c1 = await credits(key);
  if (c0 && c1) console.log(`credits: ${c1.used - c0.used} used this run, ${c1.used}/${c1.limit} this period`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
