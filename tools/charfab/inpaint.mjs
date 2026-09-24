#!/usr/bin/env node
// Masked img2img touch-up of a render with Krea 2 (e.g. paint out hair, then let Krea smooth it).
//   node tools/charfab/inpaint.mjs <in.png> <mask.png (white = repaint)> <out.png> "<prompt>" [--denoise 0.45] [--seed 7] [--neg "..."]
import fs from 'node:fs'
import { Comfy } from './lib/comfy.mjs'
import { arg } from './lib/common.mjs'
const [inp, mask, out, prompt] = process.argv.slice(2)
const comfy = new Comfy(process.env.COMFY_URL ?? 'http://192.168.15.101:8188')
async function upload(file, name) {
  const fd = new FormData(); fd.append('image', new Blob([fs.readFileSync(file)]), name); fd.append('overwrite', 'true')
  const r = await fetch(`${comfy.base}/upload/image`, { method: 'POST', body: fd }); if (!r.ok) throw new Error('upload ' + r.status); return (await r.json()).name
}
const img = await upload(inp, 'otr_inpaint_in.png'), msk = await upload(mask, 'otr_inpaint_mask.png')
const g = {
  4: { class_type: 'UNETLoader', inputs: { unet_name: 'krea2_raw_fp8_scaled.safetensors', weight_dtype: 'default' } },
  5: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2' } },
  6: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['5', 0] } },
  8: { class_type: 'CLIPTextEncode', inputs: { text: arg('--neg', ''), clip: ['5', 0] } },
  20: { class_type: 'LoadImage', inputs: { image: img } },
  21: { class_type: 'LoadImageMask', inputs: { image: msk, channel: 'red' } },
  22: { class_type: 'VAEEncode', inputs: { pixels: ['20', 0], vae: ['6', 0] } },
  23: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['22', 0], mask: ['21', 0] } },
  10: { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['23', 0], seed: Number(arg('--seed', 7)), steps: 28, cfg: 4.0, sampler_name: 'er_sde', scheduler: 'simple', denoise: Number(arg('--denoise', 0.45)) } },
  11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
  12: { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: 'otr_inpaint' } },
}
const [png] = await comfy.run(g)
fs.writeFileSync(out, png); console.log('OK inpaint ->', out)
