/**
 * The mix table + decode gate. Drives audio-test.html in the GPU headless Chrome and:
 *   1. decodes EVERY shipped audio file (assets/sfx + assets/audio) with decodeAudioData;
 *   2. renders every SFX / VO (file AND synth fallback), spatial falloff, engine states and
 *      music through src/audio.js's REAL graph (buildMix) in an OfflineAudioContext, and prints
 *      the loudest 100 ms (what the ear judges a one-shot by), RMS and peak.
 *
 *   node tools/mixprobe.mjs [--json out.json]      (BASE=http://192.168.15.78:8960 by default)
 *
 * Read the loud100 column, not the peak (DAWG ARENA: a transient and a chime at equal peak are
 * ~12 dB apart). Never tap the live master with an analyser. Exit code 1 on any decode failure.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const BASE = process.env.BASE || 'http://192.168.15.78:8960';
const CDP = process.env.CDP || 'http://192.168.15.100:9333';
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0] || await browser.newContext();
const page = await ctx.newPage();
let failed = false;
try {
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto(BASE + '/audio-test.html?t=' + Date.now(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__audioTest, null, { timeout: 30000 });

  const dec = await page.evaluate(() => window.__audioTest.decodeAll());
  console.log(`DECODE: ${dec.ok}/${dec.files} files decode in Chrome`);
  for (const f of dec.fail) console.log('  FAIL', f);
  if (dec.fail.length) failed = true;

  const r = await page.evaluate(() => window.__audioTest.mix());
  const f = x => (x == null ? '' : String(x)).padStart(7);
  console.log(`\nfaders: master ${r.vol.master} · music ${r.vol.music} · sfx ${r.vol.sfx}   (dBFS at the output, through the real graph)`);
  console.log(`\n${'sound'.padEnd(20)}${'trim'.padStart(6)}${f('loud100')}${f('peak')}${f('dur')}   ${'synth'.padStart(7)}${f('s.peak')}`);
  for (const x of r.rows) {
    if (!x.file && !x.synth) { console.log(`${x.name.padEnd(20)}  (missing)`); continue; }
    console.log(`${x.name.padEnd(20)}${String(x.trim).padStart(6)}${f(x.file?.loud)}${f(x.file?.peak)}${f(x.dur)}   ${f(x.synth?.loud)}${f(x.synth?.peak)}${x.file ? '' : '   <- synth only'}`);
  }
  console.log('\nspatial (explode, inverse falloff, ref 7 m, cull 110 m):');
  for (const x of r.spatial) console.log(`  ${x.name.padEnd(18)} ${x.culled ? 'culled' : `loud100 ${x.loud}  peak ${x.peak}`}`);
  console.log('\nengines (steady state, 1 s):');
  for (const x of r.engines) console.log(`  ${x.label.padEnd(24)} loud100 ${f(x.loud)}  rms ${f(x.rms)}  peak ${f(x.peak)}`);
  console.log('\nmusic (whole loop through the music bus):');
  for (const x of r.music) console.log(`  ${x.name.padEnd(30)} ${String(x.dur).padStart(6)}s  rms ${f(x.rms)}  loud100 ${f(x.loud)}  peak ${f(x.peak)}`);

  const files = r.rows.filter(x => x.file).map(x => x.file.loud);
  const sfxOnly = r.rows.filter(x => x.file && x.kind === 'sfx');
  const vo = r.rows.filter(x => x.file && x.kind === 'vo');
  const med = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
  console.log(`\nSUMMARY  sfx loud100 median ${med(sfxOnly.map(x => x.file.loud))} (range ${Math.min(...sfxOnly.map(x => x.file.loud))}..${Math.max(...sfxOnly.map(x => x.file.loud))})`
    + ` · VO median ${med(vo.map(x => x.file.loud))} · music rms median ${med(r.music.map(x => x.rms))}`
    + ` · player engine top ${r.engines[2].rms} rms · ${files.length} file-backed, ${r.rows.filter(x => !x.file && x.synth).length} synth-only`);
  if (errs.length) console.log('\npage errors/warnings:\n  ' + [...new Set(errs)].slice(0, 20).join('\n  '));
  if (jsonOut) await fs.writeFile(jsonOut, JSON.stringify({ decode: dec, ...r }, null, 1));
} finally {
  await page.close();
}
process.exit(failed ? 1 : 0);
