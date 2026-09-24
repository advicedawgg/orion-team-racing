#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { WORK, CHARS } from './lib/common.mjs'
const stages = ['render', 'mesh', 'rig', 'pack']
for (const c of CHARS.characters) {
  const d = path.join(WORK, c.slug)
  const has = s => {
    if (s === 'render') return fs.existsSync(path.join(d, 'render', 'done'))
    if (s === 'mesh') return fs.existsSync(path.join(d, 'mesh', `${c.slug}.glb`))
    if (s === 'rig') return fs.existsSync(path.join(d, 'rig', `${c.slug}.glb`))
    if (s === 'pack') return fs.existsSync(path.join(d, 'pack', `${c.slug}.glb`))
  }
  const doneStages = stages.filter(has)
  const next = stages.find(s => !has(s)) ?? 'complete'
  console.log(`${c.slug.padEnd(8)} [${stages.map(s => has(s) ? s[0].toUpperCase() : '.').join('')}]  next: ${next}`)
}
