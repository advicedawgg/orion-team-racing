#!/usr/bin/env node
// Repaint dark texels (hair) to skin on the parts of a mesh selected by a position predicate. TRELLIS
// hallucinates the unseen back of the head, so a bald front render can still come back with hair behind.
//   node texpaint.mjs <in.glb> <out.glb> --where "<js expr of x,y,z>" [--dark 95] [--dilate 3] [--preview mask.png]
// e.g. King Dad: --where "y>0.6 && (z<0.02 || (y>0.72 && z<0.08 && Math.abs(x)>0.12))"
// Skin colour = median of the bright, skin-like texels inside the same mask (the bald part of the scalp).
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { arg } from './lib/common.mjs'

const [inp, out] = process.argv.slice(2)
const where = new Function('x', 'y', 'z', `return (${arg('--where', 'false')})`)
const dark = Number(arg('--dark', '95')), dil = Number(arg('--dilate', '3'))
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(inp)
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
const tex = prim.getMaterial().getBaseColorTexture()
const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height, mask = new Uint8Array(W * H)
const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray(), I = prim.getIndices().getArray()
let tris = 0
for (let t = 0; t < I.length; t += 3) {
  const v = [I[t], I[t + 1], I[t + 2]]
  if (!v.every(i => where(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]))) continue
  tris++
  const q = v.map(i => [UV[i * 2] * W, UV[i * 2 + 1] * H])
  const x0 = Math.max(0, Math.floor(Math.min(...q.map(p => p[0]))) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(...q.map(p => p[0]))) + 1)
  const y0 = Math.max(0, Math.floor(Math.min(...q.map(p => p[1]))) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(...q.map(p => p[1]))) + 1)
  const e = (a, b, px, py) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
  const area = e(q[0], q[1], q[2][0], q[2][1]); if (Math.abs(area) < 1e-9) continue
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5
    const w0 = e(q[1], q[2], px, py) / area, w1 = e(q[2], q[0], px, py) / area, w2 = e(q[0], q[1], px, py) / area
    if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) mask[y * W + x] = 1
  }
}
for (let d = 0; d < dil; d++) { const m = mask.slice(); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (!m[y * W + x] && (m[y * W + x - 1] || m[y * W + x + 1] || m[(y - 1) * W + x] || m[(y + 1) * W + x])) mask[y * W + x] = 1 }
const lum = i => 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]
const skin = [[], [], []]
for (let p = 0; p < W * H; p++) if (mask[p]) { const i = p * 4; if (lum(i) > 120 && data[i] > data[i + 1] + 20 && data[i + 1] > data[i + 2] && data[i + 2] > data[i] * 0.45 && data[i + 1] < data[i] * 0.88) for (let k = 0; k < 3; k++) skin[k].push(data[i + k]) }
const med = a => a.sort((x, y) => x - y)[a.length >> 1]
const col = skin.map(med)
if (!skin[0].length) throw new Error('no skin texels found in the mask to sample')
let n = 0
for (let p = 0; p < W * H; p++) if (mask[p]) { const i = p * 4; if (lum(i) < dark) { const shade = 0.9 + 0.1 * (lum(i) / dark); for (let k = 0; k < 3; k++) data[i + k] = Math.round(col[k] * shade); n++ } }
tex.setImage(await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer())
if (arg('--preview', null)) await sharp(Buffer.from(mask.map(v => v * 255)), { raw: { width: W, height: H, channels: 1 } }).png().toFile(arg('--preview'))
await io.write(out, doc)
console.log(`OK texpaint: ${tris} tris selected, ${n} texels -> skin rgb(${col.join(',')}) from ${skin[0].length} samples -> ${out}`)
