#!/usr/bin/env node
// Stage 6: game-ready avatar. The packed GLBs are still ~186k tris because bpy's export split every
// vertex (normals differ per face) so weld/simplify were no-ops. Here we drop the normals, weld by
// position+uv+skin, simplify hard, rebuild smooth normals, and meshopt-pack again.
//   node tools/charfab/decimate.mjs <slug|all> [--tris 0] [--out client/public/models/chars]
// --tris 0 (the default) means NO simplification: every simplifier tried merges the clothing shell
// into the body underneath (skin shows through the jersey) and shreds loose cloth into slivers, even
// attribute-aware at error 0.01. Full-res welded meshes are ~5.5 MB and look right; use --tris N to
// experiment.
import fs from 'node:fs'
import path from 'node:path'
import { NodeIO, Document } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dequantize, prune, dedup, quantize, reorder } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { WORK, arg, flag } from './lib/common.mjs'

const slugArg = process.argv[2] || 'all'
const targetTris = Number(arg('--tris', '0'))
const outDir = arg('--out', path.resolve('client/public/models/chars'))
const triCount = doc => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0)
/** gltf-transform's weld is exact-match; these verts differ only in the (now dropped) normals and in
 *  float noise, so weld on quantised position + uv + joints ourselves. */
function weldPrims(doc) {
  const buffer = doc.getRoot().listBuffers()[0]
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const A = n => prim.getAttribute(n)
    const pos = A('POSITION').getArray(), uv = A('TEXCOORD_0')?.getArray(), jn = A('JOINTS_0')?.getArray(), wt = A('WEIGHTS_0')?.getArray()
    const n = pos.length / 3
    const q = (v, s) => Math.round(v * s)
    const map = new Map(), remap = new Uint32Array(n), keep = []
    for (let i = 0; i < n; i++) {
      let k = `${q(pos[i * 3], 1e4)},${q(pos[i * 3 + 1], 1e4)},${q(pos[i * 3 + 2], 1e4)}`
      if (uv) k += `|${q(uv[i * 2], 4096)},${q(uv[i * 2 + 1], 4096)}`
      if (jn) k += `|${jn[i * 4]},${jn[i * 4 + 1]},${jn[i * 4 + 2]},${jn[i * 4 + 3]}`
      let m = map.get(k)
      if (m === undefined) { m = keep.length; map.set(k, m); keep.push(i) }
      remap[i] = m
    }
    const gather = (src, w, Ctor) => { const out = new Ctor(keep.length * w); keep.forEach((i, o) => { for (let c = 0; c < w; c++) out[o * w + c] = src[i * w + c] }); return out }
    const setAttr = (name, arr, type) => { const old = A(name); prim.setAttribute(name, doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer)); old?.dispose() }
    setAttr('POSITION', gather(pos, 3, Float32Array), 'VEC3')
    if (uv) setAttr('TEXCOORD_0', gather(uv, 2, Float32Array), 'VEC2')
    if (jn) setAttr('JOINTS_0', gather(jn, 4, Uint16Array), 'VEC4')
    if (wt) setAttr('WEIGHTS_0', gather(wt, 4, Float32Array), 'VEC4')
    const oldIdx = prim.getIndices()?.getArray()
    const idx = new Uint32Array(oldIdx ? oldIdx.length : n)
    for (let i = 0; i < idx.length; i++) idx[i] = remap[oldIdx ? oldIdx[i] : i]
    const oi = prim.getIndices(); prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer)); oi?.dispose()
    console.log(`  weld: ${n} -> ${keep.length} verts`)
  }
}
/** area-weighted smooth normals over the welded index buffer (gltf-transform's normals() makes flat ones and unwelds) */
function smoothNormals(doc) {
  const buffer = doc.getRoot().listBuffers()[0]
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray()
    // accumulate per POSITION (uv-seam duplicates share one normal) so seams don't shade as creases
    const n = pos.length / 3, key = new Int32Array(n), groups = new Map()
    for (let i = 0; i < n; i++) { const k = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`; let g = groups.get(k); if (g === undefined) { g = groups.size; groups.set(k, g) } key[i] = g }
    const acc = new Float32Array(groups.size * 3)
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2]
      const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2]
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
      for (const v of [idx[t], idx[t + 1], idx[t + 2]]) { const g = key[v] * 3; acc[g] += nx; acc[g + 1] += ny; acc[g + 2] += nz }
    }
    const nrm = new Float32Array(pos.length)
    for (let i = 0; i < n; i++) { const g = key[i] * 3; const l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1; nrm[i * 3] = acc[g] / l; nrm[i * 3 + 1] = acc[g + 1] / l; nrm[i * 3 + 2] = acc[g + 2] / l }
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
  }
}
/** meshopt directly: topology-preserving first (pruning loose bits), then the sloppy simplifier for
 *  whatever the messy TRELLIS topology will not let collapse. Vertices are then compacted. */
function simplifyPrims(doc, targetTris) {
  const buffer = doc.getRoot().listBuffers()[0]
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION').getArray()
    let idx = prim.getIndices().getArray()
    // attribute-aware (uv, so the texture survives), pruning loose fragments; no sloppy pass -
    // sloppy ignores attributes and turns the texture into static. The messy TRELLIS topology
    // stalls this well above the target, which is the price of a texture that still maps.
    const uv = prim.getAttribute('TEXCOORD_0')?.getArray()
    const err = Number(arg('--error', '0.01')), uvw = Number(arg('--uvw', '2')), flags = flag('--noprune') ? [] : ['Prune']
    let [out] = uv
      ? MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, uv, 2, [uvw, uvw], null, targetTris * 3, err, flags)
      : MeshoptSimplifier.simplify(idx, pos, 3, targetTris * 3, err, flags)
    console.log(`  simplify: ${idx.length / 3} -> ${out.length / 3} tris`)
    const [remap, unique] = MeshoptSimplifier.compactMesh(out)
    for (const sem of prim.listSemantics()) {
      const acc = prim.getAttribute(sem), w = acc.getElementSize(), src = acc.getArray()
      const dst = new src.constructor(unique * w)
      for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let c = 0; c < w; c++) dst[remap[i] * w + c] = src[i * w + c]
      prim.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(dst).setBuffer(buffer)); acc.dispose()
    }
    // compactMesh has already rewritten `out` through the remap
    const oi = prim.getIndices(); prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(out).setBuffer(buffer)); oi.dispose()
  }
}
/** Make-It-Animatable parks every vertex it could not place on a `neutral_bone` that never moves,
 *  so those verts (forearms, hands, ~2.5% of the mesh) stay at the bind pose and the skin stretches
 *  after them. Hand them to whichever real bone segment is nearest in the bind pose. */
function fixNeutralWeights(doc) {
  const skin = doc.getRoot().listSkins()[0]; if (!skin) return
  const joints = skin.listJoints(), names = joints.map(j => j.getName())
  const neutral = names.indexOf('neutral_bone'); if (neutral < 0) return
  const ibm = skin.getInverseBindMatrices().getArray()
  // joint positions in mesh space = translation of inverse(IBM)
  const pos = joints.map((_, i) => {
    const m = Array.from(ibm.slice(i * 16, i * 16 + 16))
    // inverse of an affine matrix: -R^T t for the translation (R may carry uniform scale; use the full 3x3 inverse)
    const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], k = m[10]
    const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g)
    const inv = [(e * k - f * h) / det, (c * h - b * k) / det, (b * f - c * e) / det, (f * g - d * k) / det, (a * k - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]
    const tx = m[12], ty = m[13], tz = m[14]
    return [-(inv[0] * tx + inv[1] * ty + inv[2] * tz), -(inv[3] * tx + inv[4] * ty + inv[5] * tz), -(inv[6] * tx + inv[7] * ty + inv[8] * tz)]
  })
  const parentOf = new Map(); joints.forEach((j, i) => { for (const c of j.listChildren()) { const ci = joints.indexOf(c); if (ci >= 0) parentOf.set(ci, i) } })
  // segments: parent->child owned by the parent; leaves get a stub continuing their parent's direction
  const segs = []
  joints.forEach((_, i) => {
    if (i === neutral) return
    const kids = [...parentOf].filter(([, p]) => p === i).map(([c]) => c)
    if (kids.length) for (const c of kids) segs.push({ bone: i, a: pos[i], b: pos[c] })
    else { const p = parentOf.get(i); const a = pos[i]; const d = p !== undefined ? [a[0] - pos[p][0], a[1] - pos[p][1], a[2] - pos[p][2]] : [0, 0.1, 0]; segs.push({ bone: i, a, b: [a[0] + d[0] * 0.8, a[1] + d[1] * 0.8, a[2] + d[2] * 0.8] }) }
  })
  const dist2 = (p, s) => {
    const ax = s.a[0], ay = s.a[1], az = s.a[2], bx = s.b[0] - ax, by = s.b[1] - ay, bz = s.b[2] - az
    const l2 = bx * bx + by * by + bz * bz || 1e-9
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * bx + (p[1] - ay) * by + (p[2] - az) * bz) / l2))
    const dx = p[0] - (ax + bx * t), dy = p[1] - (ay + by * t), dz = p[2] - (az + bz * t)
    return dx * dx + dy * dy + dz * dz
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION').getArray(), J = prim.getAttribute('JOINTS_0').getArray(), W = prim.getAttribute('WEIGHTS_0').getArray()
    let moved = 0
    for (let i = 0; i < J.length / 4; i++) {
      for (let k = 0; k < 4; k++) {
        if (J[i * 4 + k] !== neutral || W[i * 4 + k] === 0) continue
        const v = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
        let best = segs[0], bd = Infinity
        for (const sg of segs) { const d = dist2(v, sg); if (d < bd) { bd = d; best = sg } }
        // merge into an existing slot for that bone if there is one, else retarget this slot
        let slot = -1; for (let m = 0; m < 4; m++) if (m !== k && J[i * 4 + m] === best.bone && W[i * 4 + m] > 0) slot = m
        if (slot >= 0) { W[i * 4 + slot] += W[i * 4 + k]; W[i * 4 + k] = 0; J[i * 4 + k] = 0 } else J[i * 4 + k] = best.bone
        moved++
      }
    }
    prim.getAttribute('JOINTS_0').setArray(J); prim.getAttribute('WEIGHTS_0').setArray(W)
    console.log(`  neutral_bone: ${moved} weights reassigned`)
  }
}
const slugs = slugArg === 'all' ? fs.readdirSync(WORK).filter(s => fs.existsSync(path.join(WORK, s, 'pack', `${s}.glb`))) : [slugArg]
await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

for (const slug of slugs) {
  const inGlb = path.join(WORK, slug, 'pack', `${slug}.glb`)
  const doc = await io.read(inGlb)
  const tris0 = triCount(doc)
  await doc.transform(dequantize())
  fixNeutralWeights(doc)
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const n = p.getAttribute('NORMAL'); if (n) { p.setAttribute('NORMAL', null); n.dispose() } const t = p.getAttribute('TANGENT'); if (t) { p.setAttribute('TANGENT', null); t.dispose() } }
  weldPrims(doc)
  const trisW = triCount(doc)
  if (targetTris > 0 && targetTris < trisW) simplifyPrims(doc, targetTris)
  smoothNormals(doc)
  await doc.transform(dedup(), prune())
  console.log(`  ${slug}: verts ${doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount()}`)
  const tris1 = triCount(doc)
  // no quantize(): on these skinned meshes it streaks the texture (the compensating transform it
  // adds is on a node skinning ignores). meshopt compression on the float attributes is enough.
  if (!flag('--noquant')) {
    await doc.transform(reorder({ encoder: MeshoptEncoder }))
    if (flag('--quant')) await doc.transform(quantize({ pattern: /^(NORMAL|TEXCOORD_0)$/, quantizeNormal: 8, quantizeTexcoord: 12 }))
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
  }
  fs.mkdirSync(outDir, { recursive: true })
  const out = path.join(outDir, `${slug}.glb`)
  await io.write(out, doc)
  console.log(`${slug}: ${tris0} tris -> welded ${trisW} -> ${tris1} tris, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB -> ${out}`)
}
