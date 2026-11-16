"""Face-aware denoise of the memorial hall's light map (Task 8; Blender 5.2, background).

  blender -b art/village/work/memorial_lmprep.blend -P art/village/tools/denoise_lm.py -- [--sigma 2.2] [--radius 4]

Reads work/memorial_lm.png (the averaged bake, L / 2 as sRGB) and the light-map UVs ("UV_LM") of every cat "lm" mesh in
memorial_lmprep.blend (the exact UVs the bake used). Every face is rasterised into an id map; each texel is then
averaged with its neighbours (Gaussian, `sigma` px, window `radius`) that belong to THE SAME face, in linear light.
Light gradients (LED glow, downlight scallops) survive, the low-sample grain inside each flat face goes, and nothing
bleeds between faces or islands. Texels outside every face (the bake margin) are refilled from the nearest denoised
face texel so bilinear filtering at island edges stays clean.
Writes work/memorial_lm.png (the noisy input is kept as work/memorial_lm_noisy.png).
"""
import os
import shutil
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402

WORK = os.path.join(U.ROOT, "work")


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return cast(a[a.index(name) + 1]) if name in a else default


def id_map(size):
    ids = np.full((size, size), -1, np.int32)
    fid = 0
    for o in bpy.data.objects:
        if o.type != "MESH" or o.get("cat") != "lm" or "UV_LM" not in o.data.uv_layers:
            continue
        me = o.data
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers["UV_LM"].data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2) * size - 0.5
        for p in me.polygons:
            li = list(p.loop_indices)
            pts = uv[li]
            for k in range(1, len(li) - 1):
                tri = np.stack([pts[0], pts[k], pts[k + 1]])
                x0, y0 = np.floor(tri.min(0)).astype(int)
                x1, y1 = np.ceil(tri.max(0)).astype(int)
                x0, y0 = max(x0, 0), max(y0, 0)
                x1, y1 = min(x1, size - 1), min(y1, size - 1)
                if x1 < x0 or y1 < y0:
                    continue
                gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
                a, b, c = tri
                d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
                if abs(d) < 1e-12:
                    continue
                l1 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / d
                l2 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / d
                l3 = 1 - l1 - l2
                e = -0.6 / max(1.0, np.abs(d) ** 0.5)       # include texels whose centre is just outside (edges)
                inside = (l1 >= e) & (l2 >= e) & (l3 >= e)
                sub = ids[y0:y1 + 1, x0:x1 + 1]
                sub[inside & (sub < 0)] = fid
            fid += 1
    return ids, fid


def main():
    src = os.path.join(WORK, "memorial_lm.png")
    noisy = os.path.join(WORK, "memorial_lm_noisy.png")
    shutil.copy2(src, noisy)
    img = bpy.data.images.load(noisy)
    img.colorspace_settings.name = "Non-Color"
    size = img.size[0]
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    enc = px.reshape(size, size, 4)[..., :3].astype(np.float64)
    lin = np.where(enc <= 0.04045, enc / 12.92, ((enc + 0.055) / 1.055) ** 2.4)
    ids, n = id_map(size)
    print("faces rasterised", n, "covered texels %.1f%%" % (100 * (ids >= 0).mean()), flush=True)
    sigma = arg("--sigma", 2.2, float)
    R = arg("--radius", 4, int)
    acc = np.zeros_like(lin)
    wsum = np.zeros(ids.shape)
    pad_ids = np.pad(ids, R, constant_values=-2)
    pad_lin = np.pad(lin, ((R, R), (R, R), (0, 0)))
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            w = np.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
            sid = pad_ids[R + dy:R + dy + size, R + dx:R + dx + size]
            same = (sid == ids) & (ids >= 0)
            acc += pad_lin[R + dy:R + dy + size, R + dx:R + dx + size] * (w * same)[..., None]
            wsum += w * same
    out = lin.copy()
    m = wsum > 0
    out[m] = acc[m] / wsum[m][:, None]
    # margins: grow the denoised face texels outward (8 steps) over texels that belong to no face
    filled = ids >= 0
    for _ in range(8):
        grow = np.zeros_like(out)
        cnt = np.zeros(ids.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh_f = np.roll(filled, (dy, dx), (0, 1))
            grow += np.roll(out, (dy, dx), (0, 1)) * sh_f[..., None]
            cnt += sh_f
        newly = (~filled) & (cnt > 0)
        out[newly] = grow[newly] / cnt[newly][:, None]
        filled = filled | newly
    e = np.where(out <= 0.0031308, out * 12.92, 1.055 * np.power(np.clip(out, 0, 1), 1 / 2.4) - 0.055)
    o = bpy.data.images.new("lm_dn", size, size, alpha=False)
    o.colorspace_settings.name = "Non-Color"
    o4 = np.ones((size, size, 4), np.float32)
    o4[..., :3] = e
    o.pixels.foreach_set(o4.ravel())
    o.filepath_raw = src
    o.file_format = "PNG"
    o.save()
    print("DENOISED", src, "mean change", float(np.abs(e - enc).mean()))


if __name__ == "__main__":
    main()
