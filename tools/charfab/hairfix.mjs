#!/usr/bin/env node
// Long hair glued to the arms: Make-It-Animatable binds hair that hangs beside the arms in the A-pose to
// the shoulder/arm bones, so raising the arms (cheer) drags sheets of hair up with them. Every vertex whose
// base-colour texel is in the hair class has its shoulder/arm/hand weight moved onto Spine2.
//   node tools/charfab/hairfix.mjs in.glb out.glb [--class "<js of r,g,b>"] [--cut]
// Run on the rigged GLB BEFORE texrecolor (the class is measured on TRELLIS's own colours). Taj: default class.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { arg } from './lib/common.mjs'

const [inp, out] = process.argv.slice(2)
const cls = new Function('r', 'g', 'b', `return (${arg('--class', 'r>g+10 && r>b+30 && b<=g*0.78')})`)
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(inp)
const skin = doc.getRoot().listSkins()[0]
const names = skin.listJoints().map(j => j.getName().replace(':', ''))
const spine2 = names.indexOf('mixamorigSpine2')
const arm = new Set(names.map((n, i) => /(Shoulder|Arm|ForeArm|Hand)/.test(n) ? i : -1).filter(i => i >= 0))
if (spine2 < 0 || !arm.size) { console.log('FAIL hairfix: no Spine2/arm bones', names.join()); process.exit(1) }
let moved = 0, hairV = 0
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const tex = prim.getMaterial()?.getBaseColorTexture(); if (!tex) continue
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const UV = prim.getAttribute('TEXCOORD_0'), J = prim.getAttribute('JOINTS_0'), Wt = prim.getAttribute('WEIGHTS_0')
  const uv = [0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0]
  for (let v = 0; v < UV.getCount(); v++) {
    UV.getElement(v, uv)
    const x = Math.min(W - 1, Math.max(0, Math.floor(uv[0] * W))), y = Math.min(H - 1, Math.max(0, Math.floor(uv[1] * H))), p = (y * W + x) * 4
    if (!cls(data[p], data[p + 1], data[p + 2])) continue
    hairV++
    J.getElement(v, j); Wt.getElement(v, w)
    let acc = 0, hit = false
    for (let k = 0; k < 4; k++) if (arm.has(j[k]) && w[k] > 0) { acc += w[k]; w[k] = 0; hit = true }
    if (!hit) continue
    const k0 = j.indexOf(spine2) >= 0 && w[j.indexOf(spine2)] >= 0 ? j.indexOf(spine2) : w.indexOf(Math.min(...w))
    j[k0] = spine2; w[k0] += acc
    const s = w.reduce((a, b) => a + b, 0); for (let k = 0; k < 4; k++) w[k] /= s
    J.setElement(v, j); Wt.setElement(v, w); moved++
  }
}
// --cut: TRELLIS fuses the hanging hair/shirt to the inside of the A-pose arms. Delete the bridging triangles:
// one corner (almost) all arm, another with no arm weight at all — a real shoulder blends between the two.
let cut = 0
if (process.argv.includes('--cut')) for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const J = prim.getAttribute('JOINTS_0'), Wt = prim.getAttribute('WEIGHTS_0'), I = prim.getIndices()
  const j = [0, 0, 0, 0], w = [0, 0, 0, 0], armW = new Float32Array(J.getCount())
  for (let v = 0; v < J.getCount(); v++) { J.getElement(v, j); Wt.getElement(v, w); for (let k = 0; k < 4; k++) if (arm.has(j[k])) armW[v] += w[k] }
  const src = I.getArray(), keep = []
  for (let t = 0; t < src.length; t += 3) {
    const a = [armW[src[t]], armW[src[t + 1]], armW[src[t + 2]]]
    if (Math.max(...a) > 0.8 && Math.min(...a) < 0.02) { cut++; continue }
    keep.push(src[t], src[t + 1], src[t + 2])
  }
  I.setArray(new Uint32Array(keep))
}
await io.write(out, doc)
console.log(`OK hairfix: ${hairV} hair verts, ${moved} moved off the arms, ${cut} bridge triangles cut -> ${out}`)
