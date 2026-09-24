import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const WORK = path.resolve(ROOT, '../../work')   // otr/work (gitignored)
export const CHARS = JSON.parse(fs.readFileSync(path.join(ROOT, 'characters.json'), 'utf8'))
export function arg(name, def) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def }
export function flag(name) { return process.argv.includes(name) }
export function ok(stage, msg) { console.log(`OK ${stage}: ${msg}`) }
export function fail(stage, msg) { console.log(`FAIL ${stage}: ${msg}`); process.exit(1) }
export function done(dir) { fs.writeFileSync(path.join(dir, 'done'), new Date().toISOString() + '\n') }
export function isDone(dir) { return fs.existsSync(path.join(dir, 'done')) }
