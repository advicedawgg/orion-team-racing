// Minimal ComfyUI HTTP client: queue a graph, wait for it, fetch the images.
export class Comfy {
  constructor(base) { this.base = base.replace(/\/$/, '') }
  async stats() { const r = await fetch(`${this.base}/system_stats`); if (!r.ok) throw new Error(`comfy ${r.status}`); return r.json() }
  async queue(graph) {
    const r = await fetch(`${this.base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'charfab' }) })
    const j = await r.json()
    if (!r.ok || j.error) throw new Error(`comfy /prompt: ${JSON.stringify(j.error ?? j).slice(0, 400)}`)
    return j.prompt_id
  }
  async wait(id, timeoutMs = 10 * 60_000) {
    const t0 = Date.now()
    for (;;) {
      const r = await fetch(`${this.base}/history/${id}`)
      const h = await r.json()
      const e = h[id]
      if (e?.status?.completed) return e
      if (e?.status?.status_str === 'error') throw new Error(`comfy job failed: ${JSON.stringify(e.status.messages).slice(0, 600)}`)
      if (Date.now() - t0 > timeoutMs) throw new Error('comfy job timed out')
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  async image(info) {
    const q = new URLSearchParams({ filename: info.filename, subfolder: info.subfolder ?? '', type: info.type ?? 'output' })
    const r = await fetch(`${this.base}/view?${q}`)
    if (!r.ok) throw new Error(`comfy /view ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  /** Run a graph and return the PNG buffers of every SaveImage output. */
  async run(graph) {
    const id = await this.queue(graph)
    const e = await this.wait(id)
    const out = []
    for (const node of Object.values(e.outputs ?? {})) for (const img of node.images ?? []) out.push(await this.image(img))
    return out
  }
}

/** Krea 2 text-to-image graph, same shape as the krea2 adapter on maxpowa. */
export function krea2Graph({ prompt, negative = '', width = 832, height = 1216, seed = 1, model = 'raw', clip = 'qwen3vl_4b_fp8_scaled.safetensors', prefix = 'charfab' }) {
  const cfg = model === 'turbo'
    ? { unet: 'krea2_turbo_fp8_scaled.safetensors', steps: 8, cfg: 1.0, sampler: 'euler', scheduler: 'simple' }
    : { unet: 'krea2_raw_fp8_scaled.safetensors', steps: 28, cfg: 4.0, sampler: 'er_sde', scheduler: 'simple' }
  return {
    4: { class_type: 'UNETLoader', inputs: { unet_name: cfg.unet, weight_dtype: 'default' } },
    5: { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: 'krea2' } },
    6: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['5', 0] } },
    8: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['5', 0] } },
    9: { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    10: { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['9', 0], seed, steps: cfg.steps, cfg: cfg.cfg, sampler_name: cfg.sampler, scheduler: cfg.scheduler, denoise: 1.0 } },
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['6', 0] } },
    12: { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: prefix } },
  }
}
