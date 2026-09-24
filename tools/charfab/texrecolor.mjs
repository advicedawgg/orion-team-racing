#!/usr/bin/env node
// Recolour one colour class of a model's base-colour texture toward a target, keeping its shading.
//   node texrecolor.mjs <in.glb> <out.glb> --class "<js expr of r,g,b,l (0-255)>" [--where "<js of x,y,z>"]
//        [--to "#ffd9b3"] [--measure] [--strength 1] [--mode mul|lum] [--ramp lo,hi]
// Texels (inside the triangles selected by --where, default all) that satisfy --class are multiplied per
// channel by to/median(class), so the class median lands on the target and lips/shadows keep their relative
// hue and shading. --measure only prints the class median and count.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { arg, flag } from './lib/common.mjs'

const [inp, out] = process.argv.slice(2)
const cls = new Function('r', 'g', 'b', 'l', `return (${arg('--class', 'false')})`)
const whereSrc = arg('--where', null)
const where = whereSrc ? new Function('x', 'y', 'z', `return (${whereSrc})`) : null
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(inp)
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
const tex = prim.getMaterial().getBaseColorTexture()
const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height
let mask = null
if (where) {
  mask = new Uint8Array(W * H)
  const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray(), I = prim.getIndices().getArray()
  const e = (a, b, px, py) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]]
    if (!v.every(i => where(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]))) continue
    const q = v.map(i => [UV[i * 2] * W, UV[i * 2 + 1] * H]), area = e(q[0], q[1], q[2][0], q[2][1]); if (Math.abs(area) < 1e-9) continue
    const x0 = Math.max(0, Math.floor(Math.min(...q.map(p => p[0]))) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(...q.map(p => p[0]))) + 1)
    const y0 = Math.max(0, Math.floor(Math.min(...q.map(p => p[1]))) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(...q.map(p => p[1]))) + 1)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w0 = e(q[1], q[2], x + .5, y + .5) / area, w1 = e(q[2], q[0], x + .5, y + .5) / area, w2 = e(q[0], q[1], x + .5, y + .5) / area
      if (w0 >= -0.03 && w1 >= -0.03 && w2 >= -0.03) mask[y * W + x] = 1
    }
  }
}
const sel = []
for (let p = 0; p < W * H; p++) {
  if (mask && !mask[p]) continue
  const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2]
  if (cls(r, g, b, 0.3 * r + 0.59 * g + 0.11 * b)) sel.push(p)
}
if (!sel.length) { console.log('no texels matched'); process.exit(1) }
const med = k => { const a = sel.map(p => data[p * 4 + k]).sort((x, y) => x - y); return a[a.length >> 1] }
const m = [0, 1, 2].map(med)
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
console.log(`class median ${hex(m)} rgb(${m}) over ${sel.length} texels (${(100 * sel.length / (W * H)).toFixed(1)}% of the atlas)`)
if (flag('--measure')) process.exit(0)
const to = arg('--to', '#ffffff').replace('#', '').match(/../g).map(h => parseInt(h, 16)), s = Number(arg('--strength', '1'))
const f = [0, 1, 2].map(k => 1 + (to[k] / Math.max(1, m[k]) - 1) * s)
// --mode lum: replace the hue, keep relative brightness (for near-black classes where a per-channel ratio explodes)
const ramp = arg('--ramp', null)?.split(',').map(Number)   // soft weight by luminance: 0 at lo, 1 at hi
const lumMode = arg('--mode', 'mul') === 'lum', lm = Math.max(1, 0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2])
for (const p of sel) {
  const i = p * 4, l = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2], k2 = Math.min(1.8, Math.max(0.35, l / lm))
  for (let k = 0; k < 3; k++) {
    const w = ramp ? Math.min(1, Math.max(0, (l - ramp[0]) / (ramp[1] - ramp[0]))) : 1
    const v = lumMode ? data[i + k] + (to[k] * k2 - data[i + k]) * s * w : data[i + k] * (1 + (f[k] - 1) * w)
    data[i + k] = Math.max(0, Math.min(255, Math.round(v)))
  }
}
tex.setImage(await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer())
await io.write(out, doc)
console.log(`OK texrecolor: ${sel.length} texels x(${f.map(v => v.toFixed(2))}) -> ${out}`)
