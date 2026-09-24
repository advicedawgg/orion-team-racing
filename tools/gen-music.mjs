/**
 * OTR music: ElevenLabs Music API (music_v1, instrumental) with Super Orion 2's tracks as fallbacks.
 *
 *   node tools/gen-music.mjs [name ...] [--fetch] [--regen] [--so2]
 *     --fetch  generate any track whose raw render is missing (costs credits, ~1k/min measured)
 *     --regen  re-generate the named tracks (names required)
 *     --so2    (re)bake the SO2 fallback copies too
 *   With no flags it only re-bakes from the cached raws in tools/sfx-raw/music/ (free).
 *
 * Bake = find a seamless loop (tools/looppoints.mjs, SO2's algorithm), cut the loop BODY
 * loopStart..loopEnd, normalise to MUSIC_LUFS integrated, encode Opus .ogg (primary — measured
 * gapless under <audio loop> in Chrome) + MP3 (for browsers without Opus; ~6 ms gap per loop).
 * Writes assets/audio/index.json, which src/audio.js reads.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadKey, credits, exists, run, elevenPost, MUSIC_DIR, RAW_DIR } from './audio-lib.mjs';
import { findLoop } from './looppoints.mjs';

// Music sits well under the SFX (loudest-100 ms targets -10..-18 dBFS). SO2 shipped at -14 LUFS
// with nothing else playing; a racer has engines + SFX on top, so -18.
export const MUSIC_LUFS = -18;
const RAW = path.join(RAW_DIR, 'music');
const SO2 = '/home/ws/hub/so2/assets/audio';
const SO2_LOOPS = await import('/home/ws/hub/so2/src/music.js').then(m => m.LOOPS, () => ({}));

const COMMON = 'Instrumental only, no vocals, no singing, no voice, no choir. Bright, bouncy, catchy video game music for young children, in the style of a 1990s cartoon kart racing game. Tight drums, bouncy slap bass. Keeps its energy the whole way through: no slow intro, no fade-out ending.';
export const TRACKS = {
  title: { bpm: 140, ms: 75000, so2: 'title', prompt: `Title screen theme for a kids' kart racing game called Orion Team Racing. Heroic, fun and exciting: punchy brass fanfare melody, electric guitar, bouncy bass, big drums. 140 BPM, D major. ${COMMON}` },
  beach: { bpm: 150, ms: 100000, so2: 'coast', prompt: `Bubbly Beach race track music. Sunny surf rock: twangy reverb surf guitar melody, steel drums, ukulele strums, bouncy slap bass, driving surf drums. 150 BPM, F major. ${COMMON}` },
  ice: { bpm: 150, ms: 100000, so2: 'frost', prompt: `Ice Cream Peaks race track music, a snowy mountain made of ice cream. Glockenspiel and celesta melody, jingling sleigh bells, pizzicato strings, bouncy bass, upbeat drums. Sparkly and happy. 150 BPM, A major. ${COMMON}` },
  volcano: { bpm: 155, ms: 100000, so2: 'dunes', prompt: `Taco Volcano race track music. Playful Mexican-flavoured kart racing tune: marimba melody, mariachi trumpets, nylon guitar strums, bouncy bass, driving drums with congas. Hot and fun, never scary. 155 BPM, A minor. ${COMMON}` },
  castle: { bpm: 145, ms: 100000, so2: 'castle', prompt: `King Dad's Castle race track music. Playful comedic medieval march: pompous brass fanfares, harpsichord, tuba bass, snare drum march beat, a little bit silly and royal. 145 BPM, C major. ${COMMON}` },
  star: { bpm: 150, ms: 100000, so2: 'cosmic', prompt: `Star Road race track music, a rainbow road in outer space. Sparkly synth arpeggios, retro synth lead melody, twinkling bells, pulsing synth bass, energetic electronic drums. Wondrous and exciting. 150 BPM, E major. ${COMMON}` },
  results: { bpm: 120, ms: 50000, so2: 'skyway', prompt: `Race results and podium celebration music for a kids' kart racing game. Happy, proud, relaxed groove: brass and xylophone melody, bouncy bass, light drums, hand claps. 120 BPM, G major. Instrumental only, no vocals, no singing, no voice, no choir. Loops nicely, no fade-out ending.` },
};

async function lufs(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const I = Number(stderr.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)[0]);
  const TP = Number(stderr.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)[0]);
  return { I, TP };
}

/** cut the loop body, normalise, encode ogg+mp3. Returns index entry. */
async function bake(name, raw, bpm, outBase, { after = 0, loop = null } = {}) {
  const L = loop ? { ...loop, dur: '?', bpm: '?', score: 'SO2-approved', corr: '-', step: '-' } : findLoop(raw, bpm, { after });
  if (!L) throw new Error(`${name}: no loop found`);
  const stage = path.join(MUSIC_DIR, `.${outBase}.stage.wav`);
  // tiny 4 ms fades at the cut would click on every loop — cut sample-exact instead; the loop
  // finder already aligned the waveform at the seam.
  await run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', `atrim=start=${L.loopStart}:end=${L.loopEnd},asetpts=N/SR/TB`, '-ar', '48000', '-ac', '2', stage], { maxBuffer: 1 << 26 });
  const m = await lufs(stage);
  const gain = MUSIC_LUFS - m.I;
  const af = `volume=${gain.toFixed(2)}dB,alimiter=limit=0.89:level=0:latency=1`;
  await run('ffmpeg', ['-y', '-v', 'error', '-i', stage, '-af', af, '-c:a', 'libopus', '-b:a', '112k', path.join(MUSIC_DIR, `${outBase}.ogg`)], { maxBuffer: 1 << 26 });
  await run('ffmpeg', ['-y', '-v', 'error', '-i', stage, '-af', af, '-c:a', 'libmp3lame', '-b:a', '160k', path.join(MUSIC_DIR, `${outBase}.mp3`)], { maxBuffer: 1 << 26 });
  await fs.unlink(stage);
  const after2 = await lufs(path.join(MUSIC_DIR, `${outBase}.ogg`));
  console.log(`${outBase.padEnd(14)} raw ${L.dur}s  loop ${L.loopStart}–${L.loopEnd}s (${(L.loopEnd - L.loopStart).toFixed(1)}s) · ${L.bpm} BPM (asked ${bpm}) · spectral ${L.score} · wave ${L.corr} · step ${L.step} dB · ${m.I.toFixed(1)} → ${after2.I.toFixed(1)} LUFS, TP ${after2.TP.toFixed(1)}`);
  return { file: `${outBase}.ogg`, mp3: `${outBase}.mp3`, loop: [L.loopStart, L.loopEnd], lufs: +after2.I.toFixed(1) };
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.filter(a => !a.startsWith('--'));
  const fetchMissing = args.includes('--fetch'), regen = args.includes('--regen'), so2 = args.includes('--so2');
  if (regen && !only.length) { console.error('--regen needs names'); process.exit(1); }
  await fs.mkdir(RAW, { recursive: true });
  await fs.mkdir(MUSIC_DIR, { recursive: true });
  const idxFile = path.join(MUSIC_DIR, 'index.json');
  const idx = JSON.parse(await fs.readFile(idxFile, 'utf8').catch(() => '{"music":{}}'));
  idx.music ||= {};
  const key = (fetchMissing || regen) ? await loadKey() : null;
  const c0 = key ? await credits(key) : null;

  for (const [name, T] of Object.entries(TRACKS)) {
    if (only.length && !only.includes(name)) continue;
    const raw = path.join(RAW, `${name}.mp3`);
    const entry = idx.music[name] || {};
    if ((regen || (fetchMissing && !(await exists(raw))))) {
      console.log(`${name}: generating ${T.ms / 1000}s …`);
      const r = await elevenPost(key, 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', {
        prompt: T.prompt, music_length_ms: T.ms, model_id: 'music_v1', force_instrumental: true,
      }, { tries: 2 });
      if (r.buf) await fs.writeFile(raw, r.buf);
      else console.log(`${name}: FAILED ${r.error} ${r.text ?? ''}`);
    }
    if (so2 || !entry.fallback) {
      const f = path.join(SO2, `${T.so2}.mp3`);
      if (await exists(f)) {
        // SO2's loop points were listened to and approved by the family — reuse them verbatim
        const b = await bake(name, f, 0, `${name}.so2`, { loop: SO2_LOOPS[T.so2] || null });
        entry.fallback = b.file; entry.fallbackMp3 = b.mp3; entry.so2 = T.so2;
      }
    }
    if (await exists(raw)) {
      const b = await bake(name, raw, T.bpm, name);
      Object.assign(entry, b, { src: 'elevenlabs music_v1' });
    } else if (entry.fallback && !entry.file) {
      entry.file = entry.fallback; entry.mp3 = entry.fallbackMp3; entry.src = `so2 ${T.so2}`;
    }
    idx.music[name] = entry;
  }
  idx.note = 'generated by tools/gen-music.mjs — each file is a seamless loop body; src/audio.js plays `file` (Opus) or `mp3`, falling back to `fallback` (Super Orion 2)';
  await fs.writeFile(idxFile, JSON.stringify(idx, null, 1) + '\n');
  if (c0) { const c1 = await credits(key); console.log(`credits: ${c1.used - c0.used} used this run, ${c1.used}/${c1.limit}`); }
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
