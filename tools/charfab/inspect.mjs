#!/usr/bin/env node
// Print skeleton, animation and bounds facts about GLBs: node tools/charfab/inspect.mjs a.glb [b.glb ...]
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f)
  const root = doc.getRoot()
  console.log('==', f)
  const scene = root.listScenes()[0]
  console.log('bounds', JSON.stringify(getBounds(scene)))
  console.log('nodes', root.listNodes().length, 'meshes', root.listMeshes().map(m => m.getName() + ':' + m.listPrimitives().map(p => (p.getIndices()?.getCount() ?? 0) / 3).join('/')).join(' '))
  for (const s of root.listSkins()) console.log('skin joints', s.listJoints().length, s.listJoints().map(j => j.getName()).join(','))
  for (const a of root.listAnimations()) console.log('anim', a.getName(), a.listChannels().length, 'ch', Math.max(...a.listSamplers().map(s => s.getInput().getMax([])[0])).toFixed(2) + 's')
  const walk = (n, d) => { if (d < 4) console.log(' '.repeat(d) + n.getName(), JSON.stringify(n.getTranslation().map(v => +v.toFixed(3))), JSON.stringify(n.getRotation().map(v => +v.toFixed(2))), JSON.stringify(n.getScale().map(v => +v.toFixed(2)))); if (d < 3) for (const c of n.listChildren()) walk(c, d + 1) }
  for (const n of scene.listChildren()) walk(n, 0)
}
