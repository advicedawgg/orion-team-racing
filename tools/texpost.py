"""Post-process one raw Krea render into a shipped OTR asset.

    python3 tools/texpost.py <kind> <raw.png> <out>

kinds
  tex    seamless tile both axes (overlap-crossfade-and-crop, from SO2's
         seamless.py), 1024 jpg q85 + a 512 copy in assets/tex/512/
  sky    wraps horizontally only (it's a panorama), 2048x1024 jpg q85
  title  1920x1080 jpg q85
  track  640x360 jpg q85 (centre crop to 16:9)
  icon   key the flat background out (flood fill from the border, so white
         INSIDE the object survives), add a white sticker rim + soft shadow,
         256x256 RGBA png

Prints the numbers that matter: mean luma (textures multiply the material
colour — dark ones brown everything), seam ratio before/after for tiles, and
opaque coverage for icons. Previews land in work/preview/ (2x2 tiles, the sky
rolled by half so the wrap seam sits mid-frame, icons at 64 px).
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PREV = os.path.join(ROOT, 'work', 'preview')
BLEND = 0.16          # fraction of each axis consumed by the crossfade
Q = 85


def wrap_axis(a, axis, frac):
    n = a.shape[axis]
    b = max(1, int(n * frac))
    a = np.moveaxis(a, axis, 0)
    t = np.linspace(0.0, 1.0, b).reshape(-1, *([1] * (a.ndim - 1)))
    merged = a[n - b:] * (1.0 - t) + a[:b] * t
    out = a.copy()
    out[:b] = merged
    out = out[:n - b]
    return np.moveaxis(out, 0, axis)


def wrap_axis_phase(a, axis, frac=0.10):
    """Like wrap_axis, but first picks the crop length L whose tail best
    MATCHES the head (searching 72-100% of the axis). For regular patterns
    (planks, tiles, tread plate, waffle) that lines the pattern up in phase,
    so the crossfade blends like with like instead of leaving a ghosted band.
    For irregular textures it degrades to the plain crossfade."""
    a = np.moveaxis(a, axis, 0)
    n = a.shape[0]
    b = max(1, int(n * frac))
    lum = a.mean(axis=2) if a.ndim == 3 else a
    head = lum[:b]
    best, bestL = None, n - b
    for L in range(int(n * 0.72), n - b + 1):
        d = np.abs(lum[L:L + b] - head).mean()
        if best is None or d < best:
            best, bestL = d, L
    L = bestL
    A, B = a[L:L + b], a[:b]
    # Min-error boundary cut (image quilting) through the overlap instead of a
    # straight crossfade: a linear blend of two different irregular patterns
    # double-exposes them (ghosted stones); a cut along where they already
    # agree, feathered by a few px, doesn't. Rows above the cut come from the
    # tail A (continues a[L-1]), rows below from the head B (continues a[b]).
    e = np.abs(A - B).sum(axis=2) if A.ndim == 3 else np.abs(A - B)   # b x m
    m = e.shape[1]
    # Keep the cut off the very first/last rows so both ends stay continuous.
    pad = max(2, b // 8)
    e[:pad] = e[-pad:] = e.max() * 4 + 1
    cost = e.copy()
    back = np.zeros_like(e, dtype=np.int8)
    for j in range(1, m):
        prev = cost[:, j - 1]
        up = np.r_[np.inf, prev[:-1]]
        dn = np.r_[prev[1:], np.inf]
        stack = np.stack([up, prev, dn])
        k = stack.argmin(axis=0)
        cost[:, j] += stack[k, np.arange(b)]
        back[:, j] = k - 1
    cut = np.zeros(m, dtype=int)
    cut[-1] = int(cost[:, -1].argmin())
    for j in range(m - 1, 0, -1):
        cut[j - 1] = cut[j] + back[cut[j], j]
    rows = np.arange(b).reshape(-1, 1)
    feather = max(2, b // 16)
    w = np.clip((rows - cut.reshape(1, -1)) / feather + 0.5, 0, 1)      # 0 = A, 1 = B
    w = w.reshape(b, m, *([1] * (a.ndim - 2)))
    out = a[:L].copy()
    out[:b] = A * (1 - w) + B * w
    return np.moveaxis(out, 0, axis)


def seam_ratio(a, axis):
    a = np.moveaxis(a, axis, 0)
    seam = np.abs(a[0] - a[-1]).mean()
    typical = np.abs(np.diff(a, axis=0)).mean()
    return seam / typical if typical else float('inf')


def luma(a):
    a = a[..., :3]
    return float((a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722).mean())


def save_jpg(im, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    im.convert('RGB').save(dest, quality=Q, optimize=True, progressive=True)
    return os.path.getsize(dest) // 1024


def name_of(dest):
    return os.path.splitext(os.path.basename(dest))[0]


def lift(a, target):
    """Gamma the image so its mean luma hits `target` (0-255). Keeps hue;
    used to pull dark renders up to mid-tone (textures multiply colour)."""
    if not target:
        return a
    lo, hi = 0.2, 3.0
    for _ in range(30):
        g = (lo + hi) / 2
        if luma(255 * (a / 255) ** g) > target:
            lo = g
        else:
            hi = g
    return 255 * (a / 255) ** ((lo + hi) / 2)


def flatten(a):
    """Remove baked low-frequency lighting (big bright/dark patches, and the
    band the crossfade leaves where two differently-lit edges meet): divide
    by a wide wrap-around blur, keep the mean. Only for already-tiling input."""
    h, w = a.shape[:2]
    big = np.tile(a, (3, 3, 1))
    im = Image.fromarray(np.clip(big, 0, 255).astype(np.uint8))
    low = np.asarray(im.filter(ImageFilter.GaussianBlur(w / 10))).astype(np.float32)[h:2 * h, w:2 * w]
    m = a.reshape(-1, 3).mean(axis=0)
    return a / np.maximum(low, 1) * m


def do_tex(src, dest, target=None, flat=False):
    a = np.asarray(src.convert('RGB')).astype(np.float32)
    before = (seam_ratio(a, 0), seam_ratio(a, 1))
    out = wrap_axis_phase(wrap_axis_phase(a, 0), 1)
    if flat:
        out = flatten(out)
    out = lift(np.clip(out, 0, 255), target)
    after = (seam_ratio(out, 0), seam_ratio(out, 1))
    im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS)
    kb = save_jpg(im, dest)
    small = os.path.join(os.path.dirname(dest), '512', os.path.basename(dest))
    kb2 = save_jpg(im.resize((512, 512), Image.LANCZOS), small)
    # 2x2 preview at 512 per tile
    s = im.resize((512, 512), Image.LANCZOS)
    p = Image.new('RGB', (1024, 1024))
    for x in (0, 512):
        for y in (0, 512):
            p.paste(s, (x, y))
    os.makedirs(PREV, exist_ok=True)
    p.save(os.path.join(PREV, name_of(dest) + '_2x2.jpg'), quality=80)
    ok = max(after) < 2.0
    return (f'luma {luma(np.asarray(im)):.0f}  seam {before[0]:.1f}/{before[1]:.1f} -> '
            f'{after[0]:.2f}/{after[1]:.2f} {"OK" if ok else "STILL SEAMS"}  {kb}KB (+512: {kb2}KB)')


def do_sky(src, dest):
    # 2:1. A 16:9 render loses a strip top and bottom: keep more of the
    # bottom (horizon side), the zenith is flat sky anyway.
    w, h = src.size
    if abs(w / h - 2) > 0.01:
        nh = round(w / 2)
        top = int((h - nh) * 0.35)
        src = src.crop((0, top, w, top + nh))
    a = np.asarray(src.convert('RGB')).astype(np.float32)
    before = seam_ratio(a, 1)
    out = wrap_axis_phase(a, 1)
    after = seam_ratio(out, 1)
    im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((2048, 1024), Image.LANCZOS)
    kb = save_jpg(im, dest)
    os.makedirs(PREV, exist_ok=True)
    rolled = np.roll(np.asarray(im), 1024, axis=1)
    Image.fromarray(rolled).resize((1024, 512)).save(os.path.join(PREV, name_of(dest) + '_rolled.jpg'), quality=80)
    return f'luma {luma(np.asarray(im)):.0f}  x-seam {before:.1f} -> {after:.2f}  {kb}KB'


def cover(src, W, H):
    w, h = src.size
    sc = max(W / w, H / h)
    im = src.convert('RGB').resize((round(w * sc), round(h * sc)), Image.LANCZOS)
    l = (im.width - W) // 2
    t = (im.height - H) // 2
    return im.crop((l, t, l + W, t + H))


def do_title(src, dest):
    im = cover(src, 1920, 1080)
    return f'luma {luma(np.asarray(im)):.0f}  {save_jpg(im, dest)}KB'


def do_track(src, dest):
    im = cover(src, 640, 360)
    return f'luma {luma(np.asarray(im)):.0f}  {save_jpg(im, dest)}KB'


def do_icon(src, dest):
    rgb = src.convert('RGB')
    a = np.asarray(rgb).astype(np.int16)
    H, W = a.shape[:2]
    # Background colour = median of the outer ring.
    ring = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(ring, axis=0)
    near = (np.abs(a - bg).max(axis=2) < 28).astype(np.uint8) * 255
    # Flood fill from the border through "near background" pixels only.
    m = Image.fromarray(np.pad(near, 1, constant_values=255)).copy()   # .copy(): floodfill silently no-ops on a fromarray view
    ImageDraw.floodfill(m, (0, 0), 128, thresh=0)
    bgmask = (np.asarray(m)[1:-1, 1:-1] == 128)
    obj = (~bgmask).astype(np.uint8) * 255
    # Drop specks (sparkles floating free are fine; single-pixel noise isn't).
    objm = Image.fromarray(obj).filter(ImageFilter.MedianFilter(5))
    bbox = objm.getbbox()
    if not bbox:
        raise SystemExit('icon: nothing left after keying')
    alpha = objm.filter(ImageFilter.GaussianBlur(1.2))           # soft edge
    # Square crop around the object with a margin for the sticker rim.
    l, t, r, b = bbox
    side = int(max(r - l, b - t) * 1.14)
    cx, cy = (l + r) // 2, (b + t) // 2
    box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
    rgbc = Image.new('RGB', (side, side), (255, 255, 255))
    rgbc.paste(rgb.crop(box))
    ac = Image.new('L', (side, side), 0)
    ac.paste(alpha.crop(box))
    # Sticker rim: dilate the silhouette (blur + threshold), fill white.
    rim_r = max(3, side // 55)
    rim = ac.filter(ImageFilter.GaussianBlur(rim_r)).point(lambda v: 255 if v > 18 else int(v * 255 / 18))
    shadow = rim.filter(ImageFilter.GaussianBlur(rim_r * 1.5)).point(lambda v: int(v * 0.45))
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sh = Image.new('RGBA', (side, side), (20, 20, 50, 0))
    sh.putalpha(shadow)
    off = max(2, side // 90)
    out.alpha_composite(sh, (off, off * 2))
    white = Image.new('RGBA', (side, side), (255, 255, 255, 0))
    white.putalpha(rim)
    out.alpha_composite(white)
    fg = rgbc.convert('RGBA')
    fg.putalpha(ac)
    out.alpha_composite(fg)
    out = out.resize((256, 256), Image.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    out.save(dest, optimize=True)
    cov = (np.asarray(out)[..., 3] > 128).mean()
    os.makedirs(PREV, exist_ok=True)
    out.resize((64, 64), Image.LANCZOS).save(os.path.join(PREV, name_of(dest) + '_64.png'))
    return f'bg {tuple(int(x) for x in bg)}  coverage {cov:.0%}  {os.path.getsize(dest) // 1024}KB'


def main():
    kind, raw, dest = sys.argv[1:4]
    target = float(sys.argv[sys.argv.index('--luma') + 1]) if '--luma' in sys.argv else None
    src = Image.open(raw)
    if kind == 'tex':
        print(do_tex(src, dest, target, '--flat' in sys.argv))
    else:
        print({'sky': do_sky, 'title': do_title, 'track': do_track, 'icon': do_icon}[kind](src, dest))


if __name__ == '__main__':
    main()
