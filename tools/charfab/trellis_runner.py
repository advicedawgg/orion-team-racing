#!/usr/bin/env python
"""Runs INSIDE the TRELLIS.2 container. image PNG -> textured GLB (+ optional turntable mp4).
Usage: python trellis_runner.py --input in.png --out out.glb [--resolution 1024|512|1536]
                                [--preview out.mp4] [--decimation 200000] [--texture 2048] [--seed 42]
Gated deps are redirected to ungated mirrors (no HF license acceptance needed):
  DINOV3_REPO (default camenduru/dinov3-vitl16-pretrain-lvd1689m)
  RMBG_REPO   (default camenduru/RMBG-2.0)
"""
import os, argparse
os.environ.setdefault('OPENCV_IO_ENABLE_OPENEXR', '1')
os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')
import numpy as np
from PIL import Image
import torch

DINOV3 = os.environ.get('DINOV3_REPO', 'camenduru/dinov3-vitl16-pretrain-lvd1689m')
RMBG   = os.environ.get('RMBG_REPO',   'camenduru/RMBG-2.0')

def patch_gated():
    # swap the two gated model ids for ungated mirrors before the pipeline is built
    from trellis2.modules import image_feature_extractor as ife
    _dino = ife.DinoV3FeatureExtractor.__init__
    def dino(self, model_name, image_size=512):
        _dino(self, DINOV3, image_size)
    ife.DinoV3FeatureExtractor.__init__ = dino
    from trellis2.pipelines.rembg import BiRefNet as _BiRefNet
    _rb = _BiRefNet.__init__
    def rb(self, model_name='ZhengPeng7/BiRefNet'):
        _rb(self, RMBG)
    _BiRefNet.__init__ = rb

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--resolution', default='1024', choices=['512', '1024', '1536'])
    ap.add_argument('--preview', default=None)
    ap.add_argument('--decimation', default='200000', help='comma list: one GLB per target, out_<N>.glb when >1')
    ap.add_argument('--texture', type=int, default=2048)
    ap.add_argument('--seed', type=int, default=42)
    a = ap.parse_args()

    patch_gated()
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    import o_voxel
    pt = {'512': '512', '1024': '1024_cascade', '1536': '1536_cascade'}[a.resolution]

    print(f'[trellis] loading pipeline (dino={DINOV3}, rmbg={RMBG})', flush=True)
    pipe = Trellis2ImageTo3DPipeline.from_pretrained('microsoft/TRELLIS.2-4B')
    pipe.low_vram = True
    pipe.cuda()

    img = Image.open(a.input).convert('RGBA')
    print('[trellis] running image->3D ...', flush=True)
    out = pipe.run(img, seed=a.seed, pipeline_type=pt, return_latent=False)
    mesh = out[0]

    if a.preview:
        try:
            import cv2, imageio
            from trellis2.utils import render_utils
            from trellis2.renderers import EnvMap
            hdri = 'assets/hdri/forest.exr'
            envmap = EnvMap(torch.tensor(cv2.cvtColor(cv2.imread(hdri, cv2.IMREAD_UNCHANGED), cv2.COLOR_BGR2RGB), dtype=torch.float32, device='cuda')) if os.path.isfile(hdri) else None
            m = mesh
            try: m.simplify(16777216)
            except Exception: pass
            frames = render_utils.make_pbr_vis_frames(render_utils.render_video(m, envmap=envmap))
            imageio.mimsave(a.preview, frames, fps=15)
            print('[trellis] preview:', a.preview, flush=True)
        except Exception as e:
            print('[trellis] preview-skip:', repr(e), flush=True)

    targets = [int(x) for x in str(a.decimation).split(',') if x.strip()]
    for tgt in targets:
        out = a.out if len(targets) == 1 else a.out.replace('.glb', f'_{tgt}.glb')
        print(f'[trellis] extracting GLB @ {tgt} tris ...', flush=True)
        # to_glb decimates BEFORE uv-unwrap + texture bake, so every target gets its own clean bake
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices.clone(), faces=mesh.faces.clone(), attr_volume=mesh.attrs.clone(), coords=mesh.coords.clone(),
            attr_layout=getattr(pipe, 'pbr_attr_layout', getattr(mesh, 'layout', None)),
            grid_size=int(a.resolution), aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=tgt, texture_size=a.texture,
            remesh=True, remesh_band=1, remesh_project=0, use_tqdm=True)
        glb.export(out, extension_webp=False)
        print('[trellis] glb:', out, os.path.getsize(out), 'bytes', flush=True)

if __name__ == '__main__':
    main()
