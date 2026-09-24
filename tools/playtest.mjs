// node tools/playtest.mjs [tracks…] [--every 4] [--speed 2] [--out shots/qa] [--size 1280x800] [--perf] [--query extra]
//
// QA driver: races each track in the GPU headless Chrome with the AI driving the player
// (`ai=1`), LIVE (so particles/animation are real), and screenshots the chase cam every
// `--every` seconds of race time. With --perf it also wraps renderer.render() and records per
// frame: draw calls, triangles, CPU ms inside render() (driver/command-stream cost) and GPU ms
// (EXT_disjoint_timer_query_webgl2). The box is vsync-locked — rAF timing means nothing; these do.
// Writes <out>/<track>/chase-tNNN.jpg + <out>/<track>/perf.json and prints a table. Contact
// sheet per track: <out>/<track>-sheet.jpg (ImageMagick montage). Pages always closed in finally.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes('--' + k);
const valued = new Set(['--every', '--speed', '--out', '--size', '--query', '--max', '--throttle']);
const tracks = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const TRACKS = tracks.length ? tracks : ['beach', 'ice', 'volcano', 'castle', 'star'];
const EVERY = +opt('every', 4), SPEED = +opt('speed', 2), OUT = opt('out', 'shots/qa'), MAXT = +opt('max', 200);
const [W, H] = opt('size', '1280x800').split('x').map(Number);
const EXTRA = opt('query', '');
const PERF = flag('perf'), NOSHOTS = flag('noshots');
const THROTTLE = +opt('throttle', 0);
const BASE = process.env.BASE || 'http://192.168.15.78:8960/';

const PERF_HOOK = () => {
  const O = window.__OTR, r = O.renderer, gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const orig = r.render.bind(r), pend = [];
  const S = window.__perf = { frames: [], gpuOK: !!ext };
  r.render = (s, c) => {
    let q = null;
    if (ext && pend.length < 8) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    const t0 = performance.now();
    orig(s, c);
    const cpu = performance.now() - t0;
    if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    const f = { t: O.race ? O.race.t : -99, cpu, calls: r.info.render.calls, tris: r.info.render.triangles, gpu: null, state: O.state, progs: r.info.programs?.length, tex: r.info.memory.textures };
    S.frames.push(f);
    if (q) pend.push([q, f]);
    for (let i = pend.length - 1; i >= 0; i--) {
      const [qq, ff] = pend[i];
      if (gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) ff.gpu = gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(qq); pend.splice(i, 1);
      }
    }
  };
};

const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const summ = fr => ({
  n: fr.length,
  calls: Math.round(pct(fr.map(f => f.calls), 0.5)), callsMax: Math.max(...fr.map(f => f.calls)),
  ktris: Math.round(pct(fr.map(f => f.tris), 0.5) / 1000),
  cpu50: +pct(fr.map(f => f.cpu), 0.5).toFixed(2), cpuMax: +Math.max(...fr.map(f => f.cpu)).toFixed(1),
  gpu50: +pct(fr.filter(f => f.gpu != null).map(f => f.gpu), 0.5).toFixed(2), gpu95: +pct(fr.filter(f => f.gpu != null).map(f => f.gpu), 0.95).toFixed(2),
});

const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333');
const ctx = browser.contexts()[0] || await browser.newContext();
const table = [];
let fail = 0;
for (const id of TRACKS) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('requestfailed', r => errs.push('requestfailed: ' + r.url()));
  const dir = path.join(OUT, id);
  await fs.mkdir(dir, { recursive: true });
  try {
    await page.setViewportSize({ width: W, height: H });
    if (THROTTLE) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
    const t0 = Date.now();
    await page.goto(`${BASE}index.html?track=${id}&skip=1&ai=1&seed=2${EXTRA ? '&' + EXTRA : ''}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__OTR?.ready, null, { timeout: 90000 });
    const loadMs = Date.now() - t0;
    if (PERF) await page.evaluate(PERF_HOOK);
    await page.evaluate(sp => { window.__OTR.G.timeScale = sp; }, SPEED);
    let nextT = -2, shots = 0;
    const tStart = Date.now();
    for (;;) {
      const st = await page.evaluate(() => ({ t: window.__OTR.race?.t ?? 0, state: window.__OTR.state, phase: window.__OTR.race?.phase }));
      if (st.state === 'results' || st.phase === 'done' || st.t > MAXT || Date.now() - tStart > 400000) break;
      if (!NOSHOTS && st.t >= nextT) {
        const f = path.join(dir, `chase-t${String(Math.max(0, Math.round(st.t))).padStart(3, '0')}.jpg`);
        await fs.writeFile(f, await page.screenshot({ type: 'jpeg', quality: 78 }));
        shots++; nextT = Math.max(nextT + EVERY, st.t + EVERY * 0.5);
      }
      await page.waitForTimeout(150);
    }
    const info = await page.evaluate(() => window.__OTR.info());
    let perf = null;
    if (PERF) {
      const fr = await page.evaluate(() => window.__perf.frames);
      const grid = fr.filter(f => f.state === 'countdown' || (f.t > -99 && f.t < 0));
      const mid = fr.filter(f => f.t > 10 && f.state === 'race');
      const first5 = fr.filter(f => f.t > -99 && f.t < 5);
      perf = { grid: summ(grid), mid: summ(mid), worstFirst5: +Math.max(...first5.map(f => f.cpu)).toFixed(1) };
      if (flag('spikes')) { let pp = 0, pt = 0; for (const f of fr) { if (f.cpu > 12 || f.progs !== pp || f.tex !== pt) console.log('  spike/change', JSON.stringify({ t: +f.t.toFixed(2), cpu: +f.cpu.toFixed(1), gpu: f.gpu && +f.gpu.toFixed(1), progs: f.progs, tex: f.tex, state: f.state })); pp = f.progs; pt = f.tex; } }
      await fs.writeFile(path.join(dir, 'perf.json'), JSON.stringify({ perf, loadMs }, null, 1));
    }
    table.push({ id, loadMs, shots, perf, info, errs: errs.length });
    console.log(id, JSON.stringify({ loadMs, shots, perf, info }));
    if (errs.length) { console.log('  errors:\n   ' + [...new Set(errs)].slice(0, 12).join('\n   ')); }
  } catch (e) {
    console.error(id, 'FAILED:', e.message); fail = 1;
  } finally {
    await page.close().catch(() => {});
  }
  if (!NOSHOTS) {
    try {
      const files = (await fs.readdir(dir)).filter(f => f.startsWith('chase-')).sort().map(f => path.join(dir, f));
      if (files.length) execFileSync('montage', [...files, '-tile', '4x', '-geometry', '480x300+4+4', '-label', '%f', '-pointsize', '14', path.join(OUT, `${id}-sheet.jpg`)]);
    } catch (e) { console.error('montage failed', e.message); }
  }
}
await browser.close().catch(() => {});
if (PERF) {
  console.log('\n| track | load s | grid calls | grid ktris | grid cpu ms p50 | grid gpu ms p50 | mid calls p50/max | mid ktris | mid cpu p50/max | mid gpu p50/p95 | worst render() first 5 s |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of table) if (r.perf) { const g = r.perf.grid, m = r.perf.mid; console.log(`| ${r.id} | ${(r.loadMs / 1000).toFixed(1)} | ${g.calls} | ${g.ktris} | ${g.cpu50} | ${g.gpu50} | ${m.calls}/${m.callsMax} | ${m.ktris} | ${m.cpu50}/${m.cpuMax} | ${m.gpu50}/${m.gpu95} | ${r.perf.worstFirst5} |`); }
}
process.exit(fail);
