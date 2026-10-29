# Procedural orange toy-track road tile (the MOSS renders came out flat orange with seam-cut blotches).
# usage (from the repo root): python3 tools/tex-toytrack.py  → assets/tex/road_bedroom.jpg + assets/tex/512/road_bedroom.jpg
# Seamless by construction: periodic noise (sum of integer-frequency sines) + one joint across the tile.
import numpy as np
from PIL import Image, ImageFilter
N = 1024
rng = np.random.default_rng(3119)
y, x = np.mgrid[0:N, 0:N] / N
n = np.zeros((N, N))
for f in [3, 5, 8, 13, 21, 34, 55]:
    for _ in range(3):
        fx, fy = rng.integers(-f, f + 1, 2); ph = rng.random() * 6.283
        n += np.sin(2 * np.pi * (fx * x + fy * y) + ph) / f ** 0.6
n = (n - n.mean()) / n.std()
grain = rng.normal(0, 1, (N, N)); grain = np.array(Image.fromarray(((grain * 20) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))) / 128.0 - 1
base = np.array([247, 134, 38], float)
img = base[None, None, :] * (1 + 0.012 * n[..., None] + 0.03 * grain[..., None])
# the joint between two track pieces: a dark groove with a light lip either side, across the road
d = np.abs(y - 0.5)
img *= (1 - 0.32 * np.exp(-(d / 0.0045) ** 2))[..., None]
img *= (1 + 0.10 * np.exp(-((d - 0.012) / 0.005) ** 2))[..., None]
# two faint moulded grooves along the piece edges of a plastic strip, every quarter tile
for g in [0.25, 0.75]:
    img *= (1 - 0.06 * np.exp(-((y - g) / 0.003) ** 2))[..., None]
im = Image.fromarray(img.clip(0, 255).astype(np.uint8))
im.save("assets/tex/road_bedroom.jpg", quality=85)
im.resize((512, 512), Image.LANCZOS).save("assets/tex/512/road_bedroom.jpg", quality=85)
print("ok", img.mean(axis=(0, 1)))
