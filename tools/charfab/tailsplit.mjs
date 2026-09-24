#!/usr/bin/env node
// Non-humanoid appendages (Sootie's tail) confuse Make-It-Animatable: the tail stretches the bbox and the
// predicted skeleton comes out tilted (head joint in front of the face). So: cut the appendage off
// before rigging, rig the body, then graft the appendage back into the rigged mesh bound 100% to one bone.
//   node tailsplit.mjs split <mesh.glb> <body.glb> <tail.json> --zmax -0.06 --xabs 0.12
//   node tailsplit.mjs graft <rigged.glb> <body.glb> <tail.json> <out.glb> [--bone mixamorig:Hips]
// A triangle is "tail" when all three vertices have z < zmax and |x| < xabs (TRELLIS space: y up, +z front).
// Graft maps TRELLIS space -> rigged mesh space with the per-axis scale/offset that maps the body's
// bbox onto the rigged mesh's bbox (MIA normalises uniformly; the script checks the axes agree).
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { compactPrimitive } from '@gltf-transform/functions'
import { arg } from './lib/common.mjs'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const [mode, ...a] = process.argv.slice(2)
const prim0 = doc => doc.getRoot().listMeshes()[0].listPrimitives()[0]
const bbox = arr => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]) } return [mn, mx] }

if (mode === 'split') {
  const [inp, bodyOut, tailOut] = a
  const zmax = Number(arg('--zmax', '-0.06')), xabs = Number(arg('--xabs', '0.12'))
  const doc = await io.read(inp), p = prim0(doc)
  const pos = p.getAttribute('POSITION').getArray(), uv = p.getAttribute('TEXCOORD_0').getArray(), idx = p.getIndices().getArray()
  const isT = v => pos[v * 3 + 2] < zmax && Math.abs(pos[v * 3]) < xabs
  const keep = [], tail = { pos: [], uv: [] }
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]]
    if (tri.every(isT)) for (const v of tri) { tail.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); tail.uv.push(uv[v * 2], uv[v * 2 + 1]) }
    else keep.push(...tri)
  }
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(doc.getRoot().listBuffers()[0]))
  const used = new Set(keep); const bpos = []; for (const v of used) bpos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
  tail.bodyBox = bbox(bpos)
  compactPrimitive(p)   // drop the tail's now-unreferenced vertices (MIA would sample them)
  await io.write(bodyOut, doc)
  fs.writeFileSync(tailOut, JSON.stringify(tail))
  console.log(`OK split: ${idx.length / 3} tris -> body ${keep.length / 3}, tail ${tail.pos.length / 9}`)
} else if (mode === 'graft') {
  const [rigged, , tailIn, out] = a
  const tail = JSON.parse(fs.readFileSync(tailIn, 'utf8'))
  const doc = await io.read(rigged), p = prim0(doc), buf = doc.getRoot().listBuffers()[0]
  const skin = doc.getRoot().listSkins()[0], bone = arg('--bone', 'mixamorig:Hips')
  const bi = skin.listJoints().findIndex(j => j.getName() === bone); if (bi < 0) throw new Error('no bone ' + bone)
  const pos = p.getAttribute('POSITION').getArray()
  const [rmn, rmx] = bbox(pos), [bmn, bmx] = tail.bodyBox
  const s = [0, 1, 2].map(k => (rmx[k] - rmn[k]) / (bmx[k] - bmn[k])), o = [0, 1, 2].map(k => rmn[k] - bmn[k] * s[k])
  console.log('  map scale', s.map(v => v.toFixed(4)).join(' '), 'offset', o.map(v => v.toFixed(4)).join(' '))
  if (Math.max(...s) / Math.min(...s) > 1.03) throw new Error('non-uniform mapping: rigged space is not a uniform rescale of TRELLIS space')
  const n0 = pos.length / 3, nt = tail.pos.length / 3
  const cat = (acc, add, Ctor, w) => { const src = acc.getArray(), dst = new Ctor(src.length + nt * w); dst.set(src); dst.set(add, src.length); acc.setArray(dst) }
  // --lift DEG swings the tail up about its root (the frontmost tail vertex) around +X: a drooping tail
  // would reach through the kart seat and becomes the "seat contact"
  const lift = Number(arg('--lift', '0')) * Math.PI / 180, c = Math.cos(lift), sn = Math.sin(lift)
  let ri = 0; for (let i = 0; i < nt; i++) if (tail.pos[i * 3 + 2] > tail.pos[ri * 3 + 2]) ri = i
  const ry = tail.pos[ri * 3 + 1], rz = tail.pos[ri * 3 + 2]
  const tp = new Float32Array(tail.pos.length)
  for (let i = 0; i < nt; i++) {
    const y = tail.pos[i * 3 + 1] - ry, z = tail.pos[i * 3 + 2] - rz
    const q = [tail.pos[i * 3], ry + y * c - z * sn, rz + y * sn + z * c]
    for (let k = 0; k < 3; k++) tp[i * 3 + k] = q[k] * s[k] + o[k]
  }
  const has = n => p.getAttribute(n)
  cat(has('POSITION'), tp, Float32Array, 3)
  if (has('TEXCOORD_0')) cat(has('TEXCOORD_0'), Float32Array.from(tail.uv), Float32Array, 2)
  if (has('NORMAL')) cat(has('NORMAL'), new Float32Array(nt * 3).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), Float32Array, 3)   // recomputed in pack
  const J = has('JOINTS_0'), jn = new (J.getArray().constructor)(nt * 4); for (let i = 0; i < nt; i++) jn[i * 4] = bi
  cat(J, jn, J.getArray().constructor, 4)
  const W = has('WEIGHTS_0'), WC = W.getArray().constructor
  const ONE = WC === Float32Array ? 1 : WC === Uint8Array ? 255 : 65535   // normalized integer weights: 1 is NOT 1.0
  const wt = new WC(nt * 4); for (let i = 0; i < nt; i++) wt[i * 4] = ONE
  // the tail ROOT stays on the body mesh and MIA binds it to a thigh, so it stretches when the legs bend:
  // hand every body vertex in the tail's neighbourhood (mapped back to TRELLIS space) to the same bone
  const zroot = Number(arg('--zroot', '-0.02')), xabs = Number(arg('--xabs', '0.12')), yr = tail.pos.filter((_, i) => i % 3 === 1)
  const ylo = Math.min(...yr) - 0.03, yhi = Math.max(...yr) + 0.03
  const JA = J.getArray(), WA = W.getArray(); let rooted = 0
  for (let v = 0; v < n0; v++) {
    const x = (pos[v * 3] - o[0]) / s[0], y = (pos[v * 3 + 1] - o[1]) / s[1], z = (pos[v * 3 + 2] - o[2]) / s[2]
    if (z < zroot && Math.abs(x) < xabs && y > ylo && y < yhi) { JA[v * 4] = bi; WA[v * 4] = ONE; for (let k = 1; k < 4; k++) { JA[v * 4 + k] = 0; WA[v * 4 + k] = 0 } rooted++ }
  }
  J.setArray(JA); W.setArray(WA); console.log(`  tail root: ${rooted} body verts rebound to ${bone}`)
  cat(W, wt, WC, 4)
  for (const sem of p.listSemantics()) if (!['POSITION', 'TEXCOORD_0', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'].includes(sem)) { const x = p.getAttribute(sem); p.setAttribute(sem, null); x.dispose() }
  const idx = p.getIndices().getArray(), ni = new Uint32Array(idx.length + nt); ni.set(idx); for (let i = 0; i < nt; i++) ni[idx.length + i] = n0 + i
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buf))
  await io.write(out, doc)
  console.log(`OK graft: +${nt / 3} tail tris on ${bone} -> ${out}`)
} else { console.log('usage: tailsplit.mjs split|graft ...'); process.exit(1) }
