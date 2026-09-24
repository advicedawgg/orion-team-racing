#!/usr/bin/env node
// Stage 1: render candidate reference images for a character with Krea 2 on the 4090 box (maxpowa).
//   node tools/charfab/render.mjs <slug|all|humans|creatures> [--pose apose|seated|creature] [--n 4]
//        [--model raw|turbo] [--seed 1000] [--force]
// Default pose = apose for kind=human, creature for kind=creature.
// Writes work/<slug>/render-<pose>/NN.png + contact.jpg + prompt.txt. Skips if render-<pose>/done exists.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { Comfy, krea2Graph } from './lib/comfy.mjs'
import { CHARS, WORK, arg, flag, done, fail, ok } from './lib/common.mjs'

const sel = process.argv[2] || 'all'
const pick = c => sel === 'all' || sel === c.slug || (sel === 'humans' && c.kind === 'human') || (sel === 'creatures' && c.kind === 'creature')
const list = CHARS.characters.filter(pick)
if (!list.length) fail('render', `unknown selection ${sel}`)
const n = Number(arg('--n', 4))
const model = arg('--model', 'raw')
const seed0 = Number(arg('--seed', 1000))
const start = Number(arg('--start', 0))   // file index offset: append re-rolls next to earlier candidates
const descOverride = arg('--desc', null)
const comfy = new Comfy(process.env.COMFY_URL ?? 'http://192.168.15.101:8188')

try { await comfy.stats() } catch (e) { fail('render', `ComfyUI not reachable at ${comfy.base} (${e.message})`) }

for (const c of list) {
  const poseName = arg('--pose', c.kind === 'creature' ? 'creature' : 'apose')
  const pose = CHARS.poses[poseName]
  if (!pose) fail('render', `unknown pose ${poseName}`)
  const dir = path.join(WORK, c.slug, `render-${poseName}`)
  if (!flag('--force') && !start && fs.existsSync(path.join(dir, 'done'))) { ok('render', `${c.slug}/${poseName}: already rendered (${dir})`); continue }
  fs.mkdirSync(dir, { recursive: true })
  const prompt = `${descOverride ?? c.desc}, ${pose.text}, ${CHARS.style}`
  const files = []
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    const imgs = await comfy.run(krea2Graph({ prompt, negative: model === 'raw' ? [CHARS.negative, c.neg].filter(Boolean).join(', ') : '', seed: seed0 + i, model, width: pose.width, height: pose.height, prefix: `otr_${c.slug}_${poseName}` }))
    const f = path.join(dir, `${String(start + i).padStart(2, '0')}.png`)
    fs.writeFileSync(f, imgs[0])
    files.push(f)
    console.log(`  ${c.slug}/${poseName} ${i + 1}/${n} seed ${seed0 + i} ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${f}`)
  }
  const tile = pose.width > pose.height ? '448x320+6+6' : pose.width === pose.height ? '420x420+6+6' : '384x560+6+6'
  execFileSync('montage', [...files, '-tile', `${n}x1`, '-geometry', tile, '-background', '#222', '-fill', 'white', '-pointsize', '28', '-label', '%t', path.join(dir, start ? `contact-${start}.jpg` : 'contact.jpg')])
  fs.appendFileSync(path.join(dir, 'prompt.txt'), `files ${start}..${start + n - 1} model=${model} seeds=${seed0}..${seed0 + n - 1} ${pose.width}x${pose.height}\n${prompt}\nNEGATIVE: ${model === 'raw' ? [CHARS.negative, c.neg].filter(Boolean).join(', ') : ''}\n`)
  done(dir)
  ok('render', `${c.slug}/${poseName}: ${n} candidates -> ${path.join(dir, 'contact.jpg')}`)
}
