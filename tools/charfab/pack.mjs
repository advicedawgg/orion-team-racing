#!/usr/bin/env node
// Stage 4: rigged (or static) GLB -> game-ready GLB in assets/models/<id>.glb
//   node tools/charfab/pack.mjs <in.glb> <out.glb> [--tex 1024] [--quality 88] [--tris 0] [--static]
// 1. neutral_bone reweight (Make-It-Animatable parks unplaceable verts on a bone that never moves)
// 2. drop normals/tangents, weld on quantised pos+uv+joints (bpy split every vertex), smooth normals
// 3. optional meshopt simplify (--tris N; default 0 = keep what TRELLIS baked at, see README)
// 4. drop the metallic-roughness map (hdracers.js renders a flat soft plastic), texture -> WebP
// 5. meshopt compression. NO quantize(): it streaks the texture on skinned meshes.
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dequantize, prune, dedup, reorder, textureCompress } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { arg, flag } from './lib/common.mjs'
import { fixNeutralWeights, weldPrims, smoothNormals, simplifyPrims, triCount } from './lib/meshfix.mjs'

const [inGlb, outGlb] = process.argv.slice(2)
if (!inGlb || !outGlb) { console.log('usage: pack.mjs <in.glb> <out.glb> [--tex 1024] [--tris 0]'); process.exit(1) }
const tex = Number(arg('--tex', '1024')), quality = Number(arg('--quality', '88')), targetTris = Number(arg('--tris', '0'))
await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(inGlb)
const tris0 = triCount(doc)
await doc.transform(dequantize())
fixNeutralWeights(doc)
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  for (const a of ['NORMAL', 'TANGENT']) { const x = p.getAttribute(a); if (x) { p.setAttribute(a, null); x.dispose() } }
  // TRELLIS writes a COLOR_0 on some exports; the texture carries the colour
  const c = p.getAttribute('COLOR_0'); if (c) { p.setAttribute('COLOR_0', null); c.dispose() }
}
weldPrims(doc)
if (targetTris > 0 && targetTris < triCount(doc)) simplifyPrims(doc, targetTris, { error: Number(arg('--error', '0.01')), uvw: Number(arg('--uvw', '2')) })
smoothNormals(doc)
for (const mat of doc.getRoot().listMaterials()) {
  const mr = mat.getMetallicRoughnessTexture(); if (mr) mat.setMetallicRoughnessTexture(null)
  mat.setMetallicFactor(0).setRoughnessFactor(0.72)
  mat.setDoubleSided(false)
}
await doc.transform(
  dedup(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality }),
  reorder({ encoder: MeshoptEncoder }),
)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
fs.mkdirSync(outGlb.replace(/\/[^/]*$/, ''), { recursive: true })
await io.write(outGlb, doc)
console.log(`OK pack: ${inGlb} ${tris0} tris -> ${triCount(doc)} tris, ${(fs.statSync(outGlb).size / 1e6).toFixed(2)} MB -> ${outGlb}`)
