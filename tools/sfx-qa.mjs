/**
 * "Listen" to generated audio with a multimodal model (OpenRouter, Gemini Flash) — nobody on the
 * team has ears at 3 am. For each file: what it actually sounds like, a 1-10 fit score against
 * its prompt, and defects. Results go to tools/sfx-qa.json; re-roll anything < 6 with
 *   node tools/gen-sfx.mjs <name> --regen
 *
 *   node tools/sfx-qa.mjs [name ...]      (needs OPENROUTER_API_KEY, env or /home/ws/studio/.env)
 *   node tools/sfx-qa.mjs --vo            (announcer/character lines: transcript + delivery)
 *   node tools/sfx-qa.mjs --dir <dir>     (score candidate takes / rendered synth in <dir>, <name>.<tag>.mp3|wav;
 *                                         results in <dir>/qa.<model>.json)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, SFX_DIR } from './audio-lib.mjs';
import { SOUNDS } from './gen-sfx.mjs';

const MODEL = process.env.QA_MODEL || 'google/gemini-3.8-flash';
async function orKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const txt = await fs.readFile('/home/ws/studio/.env', 'utf8');
  return txt.match(/^\s*OPENROUTER_API_KEY\s*=\s*["']?([^"'\s]+)/m)?.[1];
}

async function ask(key, file, question) {
  const b64 = (await fs.readFile(file)).toString('base64');
  const fmt = file.endsWith('.wav') ? 'wav' : 'mp3';
  for (let a = 0; a < 3; a++) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: question },
          { type: 'input_audio', input_audio: { data: b64, format: fmt } },
        ] }],
      }),
    });
    if (!r.ok) { console.warn('  HTTP', r.status, (await r.text()).slice(0, 200)); continue; }
    const j = await r.json();
    const txt = j.choices?.[0]?.message?.content ?? '';
    try { return JSON.parse(txt.replace(/^```json\s*|```$/g, '')); } catch { return { raw: txt }; }
  }
  return { error: true };
}

const args = process.argv.slice(2);
const vo = args.includes('--vo');
const synthDir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;
const only = args.filter(a => !a.startsWith('--') && a !== synthDir);
const key = await orKey();
const outFile = synthDir ? path.join(synthDir, `qa.${MODEL.replace(/\W+/g, '_')}.json`) : path.join(ROOT, 'tools', vo ? 'vo-qa.json' : 'sfx-qa.json');
const prev = JSON.parse(await fs.readFile(outFile, 'utf8').catch(() => '{}'));

let jobs = [];
if (vo) {
  const { LINES } = await import('./gen-vo.mjs');
  for (const [name, spec] of Object.entries(LINES)) {
    if (only.length && !only.includes(name)) continue;
    jobs.push({ name, file: path.join(SFX_DIR, name + '.mp3'), q:
      `Voice line for a kids' kart racing game. Intended ${spec.text ? `text: "${spec.text.replace(/\[[^\]]*\] */g, "")}"` : `vocal sound: "${spec.sfx}"`}. Reply JSON {"heard": verbatim transcript, "delivery": one short phrase, "score": 1-10 (correct words, energetic, warm and kid-friendly, clean), "defects": string or ""}.` });
  }
} else {
  const files = (synthDir ? await fs.readdir(synthDir) : await fs.readdir(SFX_DIR)).filter(f => /\.(mp3|wav)$/.test(f) && !f.startsWith('vo_'));
  for (const f of files) {
    const name = f.split('.')[0];
    const tag = f.replace(/\.(mp3|wav)$/, '');
    if (only.length && !only.includes(name) && !only.includes(tag)) continue;
    const spec = SOUNDS[name]; if (!spec) continue;
    jobs.push({ name: tag, file: path.join(synthDir || SFX_DIR, f), q:
      `Sound effect for a bright, cartoony kids' kart racing game (think Crash Team Racing). It is used for the game event "${name}" and was meant to be: "${spec[0]}". Reply JSON {"heard": one sentence describing what you actually hear, "score": 1-10 for fit to the event and prompt, "defects": string ("" if none — mention silence, hiss/noise floor, speech, unwanted music, harshness, clipping, too long)}.` });
  }
}

const res = { ...prev };
for (let i = 0; i < jobs.length; i += 6) {
  await Promise.all(jobs.slice(i, i + 6).map(async j => {
    const a = await ask(key, j.file, j.q);
    res[j.name] = a;
    console.log(`${j.name.padEnd(18)} ${String(a.score ?? '?').padStart(2)}  ${a.heard ?? a.raw ?? ''}${a.defects ? '  !! ' + a.defects : ''}${a.delivery ? '  [' + a.delivery + ']' : ''}`);
  }));
}
await fs.writeFile(outFile, JSON.stringify(res, null, 1) + '\n');
