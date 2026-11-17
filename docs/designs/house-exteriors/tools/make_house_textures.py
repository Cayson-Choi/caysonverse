"""A8 house body kit (X1) — the houses' photo-real PBR tiling sets (contract 6, HOUSE_SURFACE_RULES).

  python docs/designs/house-exteriors/tools/make_house_textures.py --src <art/village/downloads/tex_x1> --out <dir>

Seven surface families (HOUSE_SURFACE_RULES.sets) in five materials, each an albedo (sRGB), a tangent-space normal (OpenGL,
+Y up = glTF) and a roughness map (grey), 1024 x 1024 WebP:

  render  (LM_render)  ambientCG Plaster001 (CC0): trowelled exterior stucco (drivit / stucco), 2.0 m per tile = 512 px/m
  granite (LM_stone)   ambientCG Granite005A (CC0): speckled grey granite, honed (rougher than the polished scan), 1.0 m
  shingle (LM_roof)    procedural 3-tab asphalt shingles: 14 courses of 0.1429 m exposure, 3 tabs per 1 m shingle, keyways,
                       granule noise, per-tab tone; 2.0 m per tile (512 px/m). Each modelled course maps ONE row (build script).
  oak + timber_cladding (LM_wood, two bands): top = Poly Haven oak_veneer_01 (CC0) turned so the grain runs along U, 1.83 m
                       along U x 0.915 m; bottom = Poly Haven japanese_cedar_planks (CC0), the boards along U, 1.13 m x 0.565 m
  metal_painted + pvc_frame (LM_metal, two bands): top = ambientCG Metal027 (CC0) powder-coated steel, bottom = ambientCG
                       Plastic013A (CC0) white PVC; both 1.0 m along U x 0.5 m

Owner 2026-11-17: "유럽 시골 마을의 동화같은 주택이지만 모두가 새것이어야 해 헌집은 없어야 해" — every set is BRAND-NEW: the
scans' broad stains, clouds and run-off are taken out (`fresh`: their low frequencies flattened, the fine grain, pores and
trowel marks kept), no streaks, no worn edges, the cedar freshly oiled, the shingles even. The tintable sets (render, metal,
pvc, shingle) are neutral and bright: the house's colour comes from COLOR_0 (vertex colour = the tint), so the owner's
pastels stay exact. A band's UVs never cross its V range (the build script
splits faces), so bands need only tile along U. Licences: tools/SOURCES.md.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image

N = 1024


def load(p, mode="RGB"):
    return np.asarray(Image.open(p).convert(mode), dtype=np.float32) / 255.0


def resize(a, w, h=None):
    h = h or w
    mode = "L" if a.ndim == 2 else "RGB"
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), mode).resize((w, h), Image.LANCZOS)
    return np.asarray(img, dtype=np.float32) / 255


def s2l(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def neutral(albedo, target_lin, contrast=1.0):
    """A bright neutral albedo for tinting: the luminance ratio around its mean (x contrast) at `target_lin` (linear)."""
    lin = s2l(albedo)
    lum = lin @ LUMA
    r = lum / max(float(lum.mean()), 1e-4)
    r = 1 + (r - 1) * contrast
    return l2s((target_lin * r)[..., None].repeat(3, -1))


def normal_strength(n, k):
    v = n * 2 - 1
    v[..., 0] *= k
    v[..., 1] *= k
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return v * 0.5 + 0.5


def height_to_normal(h, strength):
    """Height (1 = up) -> OpenGL tangent normal (x right, y up in the image), wrapping."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * 0.5
    v = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return v * 0.5 + 0.5


def rough_remap(r, mean, spread=1.0):
    return np.clip(mean + (r - r.mean()) * spread, 0.02, 1.0)


def blur(a, r):
    """Box blur with wrap (separable, radius r px)."""
    if r <= 0:
        return a
    k = 2 * r + 1
    c = np.cumsum(np.pad(a, ((0, 0), (r + 1, r)), mode="wrap"), axis=1)
    a = (c[:, k:] - c[:, :-k]) / k
    c = np.cumsum(np.pad(a, ((r + 1, r), (0, 0)), mode="wrap"), axis=0)
    return (c[k:] - c[:-k]) / k


def fresh(lin, r=48, keep=0.0):
    """Brand-new (owner 2026-11-17): divide a linear albedo by its own broad luminance (box blur radius `r`, wrapping) so the
    scan's stains, clouds and weathering patches go and its fine grain stays; `keep` leaves that share of the broad tone."""
    lum = lin @ LUMA
    lo = blur(blur(lum, r), r)
    k = (lo.mean() / np.maximum(lo, 1e-4)) ** (1.0 - keep)
    return lin * k[..., None]


def rot_normal(nor):
    """The normal map of an image turned 90 degrees counter-clockwise (np.rot90 k=1): new x = -old y, new y = old x."""
    v = nor * 2 - 1
    return np.stack([-v[..., 1], v[..., 0], v[..., 2]], -1) * 0.5 + 0.5


# ------------------------------------------------------------------------------------------------- sets --

def set_render(src):
    d = os.path.join(src, "Plaster001", "Plaster001_2K-JPG_")
    alb = resize(load(d + "Color.jpg"), N)
    nor = resize(load(d + "NormalGL.jpg"), N)
    rou = resize(load(d + "Roughness.jpg", "L"), N)
    alb = l2s(fresh(s2l(alb), 24))                 # the scan's grey clouds out: clean new stucco, its trowel grain kept
    return neutral(alb, 0.82, contrast=1.25), normal_strength(nor, 1.35), rough_remap(rou, 0.86, 1.2)


def set_granite(src):
    d = os.path.join(src, "Granite005A", "Granite005A_2K-JPG_")
    alb = resize(load(d + "Color.jpg"), N)
    nor = resize(load(d + "NormalGL.jpg"), N)
    lum = alb @ LUMA
    lin = s2l(alb)
    grey = s2l(lum)[..., None].repeat(3, -1)
    lin = grey * 0.72 + lin * 0.28              # mostly grey (Korean Pocheon granite), a hint of the scan's specks
    lin = lin * np.array([1.0, 0.985, 0.96], np.float32) * 0.92
    rng = np.random.default_rng(7)
    h = rng.standard_normal((N, N)).astype(np.float32) * 0.5 + blur(rng.standard_normal((N, N)).astype(np.float32), 1) * 1.2
    h = (h - h.min()) / (h.max() - h.min())
    m = height_to_normal(h, 2.0) * 2 - 1        # the honed surface's fine pitting
    n = nor * 2 - 1
    v = np.stack([n[..., 0] + m[..., 0], n[..., 1] + m[..., 1], n[..., 2]], -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    rou = np.clip(0.64 + ((1 - lum) - (1 - lum).mean()) * 0.25 + (h - 0.5) * 0.06, 0.35, 0.92)
    return l2s(lin), v * 0.5 + 0.5, rou


SHINGLE_ROWS = 14
TILE_SHINGLE_M = 2.0


def set_shingle(src):
    """3-tab asphalt shingles at 512 px/m: tabs 1/3 m, 6 mm keyways up the exposure, granules, the shadow under the course
    above (each row's top), a crisp butt edge (each row's bottom), a barely varying tone: a new roof (owner 2026-11-17)."""
    rng = np.random.default_rng(11)
    H = W = N
    rh = H / SHINGLE_ROWS
    pxm = W / TILE_SHINGLE_M
    tab = pxm / 3.0
    slot = max(3, int(round(0.007 * pxm)))
    g = rng.random((H, W)).astype(np.float32)
    gran = (g - 0.5) * 0.55 + blur(rng.standard_normal((H, W)).astype(np.float32), 1) * 0.6
    sparkle = (rng.random((H, W)) > 0.985).astype(np.float32) * 0.5 - (rng.random((H, W)) > 0.982).astype(np.float32) * 0.4
    base = 0.60 + gran * 0.16 + sparkle * 0.22 + blur(rng.standard_normal((H, W)).astype(np.float32), 8) * 0.06  # new: even
    tone = np.ones((H, W), np.float32)
    height = 0.6 + gran * 0.10
    xx = np.arange(W)
    for r in range(SHINGLE_ROWS):
        y0, y1 = int(round(r * rh)), int(round((r + 1) * rh))
        off = rng.random() * W
        for t in range(int(round(W / tab))):
            xa = (off + t * tab) % W
            cols = (xx - xa) % W
            tone[y0:y1, cols < tab] *= 1.0 + rng.normal(0, 0.025)  # new shingles from one batch: barely varying
            ks = cols < slot
            depth = int(rh * 0.86)
            tone[y1 - depth:y1, ks] *= 0.40
            height[y1 - depth:y1, ks] -= 0.35
        sh = np.clip(1 - (np.arange(y1 - y0) / (rh * 0.24)), 0, 1) ** 1.5
        tone[y0:y1] *= (1 - 0.40 * sh)[:, None]
        height[y0:y1] -= (0.22 * sh)[:, None]
        tone[y1 - 2:y1] *= 0.86
        height[y1 - 2:y1] -= 0.10
        height[y0:y1] += np.linspace(-0.05, 0.05, y1 - y0)[:, None]
    alb = np.clip(base * tone, 0.03, 1)[..., None].repeat(3, -1) * np.array([1.0, 1.0, 1.02], np.float32)
    nor = height_to_normal(height, 5.0)
    rou = np.clip(0.88 + gran * 0.05 - sparkle * 0.12, 0.6, 1.0)
    return np.clip(alb, 0, 1), nor, rou


def band_pair(top, bot):
    """Two (albedo, normal, rough) sets as the top and bottom halves of one 1024 x 1024 map."""
    return tuple(np.concatenate([a, b], 0) for a, b in zip(top, bot))


def set_oak(src):
    p = os.path.join(src, "oak_veneer_01_")
    alb = np.rot90(resize(load(p + "diff_2k.jpg"), N), 1)
    nor = rot_normal(np.rot90(resize(load(p + "nor_gl_2k.jpg"), N), 1))
    rou = np.rot90(resize(load(p + "rough_2k.jpg", "L"), N), 1)
    alb = l2s(fresh(s2l(alb), 40, keep=0.3) * 0.97)   # new veneer: even, its grain kept
    return alb[:512], normal_strength(nor[:512].copy(), 1.2), rough_remap(rou[:512], 0.48, 0.8)


def set_cedar(src):
    p = os.path.join(src, "japanese_cedar_planks_")
    alb = np.rot90(resize(load(p + "diff_2k.jpg"), N), 1)
    nor = rot_normal(np.rot90(resize(load(p + "nor_gl_2k.jpg"), N), 1))
    rou = np.rot90(resize(load(p + "rough_2k.jpg", "L"), N), 1)
    lin = fresh(s2l(alb), 40, keep=0.35)     # the scan's dark, patchy boards evened: new cladding
    lum = (lin @ LUMA)[..., None]
    lin = lum + (lin - lum) * 0.65             # freshly oiled cedar: warm, not the weathered grey (owner 2026-11-17)
    return l2s(lin * 1.25)[:512], normal_strength(nor[:512].copy(), 1.4), rough_remap(rou[:512], 0.58, 0.8)


def set_metal(src):
    d = os.path.join(src, "Metal027", "Metal027_2K-JPG_")
    alb = resize(load(d + "Color.jpg"), N)
    nor = resize(load(d + "NormalGL.jpg"), N)
    rou = resize(load(d + "Roughness.jpg", "L"), N)
    # new powder coat (owner 2026-11-17): no run-off streaks, the scan's clouds evened, its fine orange peel kept
    a = np.clip(neutral(l2s(fresh(s2l(alb), 24)), 0.72, contrast=0.6), 0, 1)
    return a[:512], normal_strength(nor[:512].copy(), 1.0), rough_remap(rou[:512], 0.42, 2.0)


def set_pvc(src):
    d = os.path.join(src, "Plastic013A", "Plastic013A_2K-JPG_")
    alb = resize(load(d + "Color.jpg"), N)
    nor = resize(load(d + "NormalGL.jpg"), N)
    rou = resize(load(d + "Roughness.jpg", "L"), N)
    return neutral(alb, 0.86, contrast=1.3)[512:], normal_strength(nor[512:].copy(), 0.8), rough_remap(rou[512:], 0.36, 1.0)


# ------------------------------------------------------------------------------- Colmar sets (2026-11-17) --
# Owner 2026-11-17 (Colmar Petite Venise photo): a storybook Alsatian village, half-timbered, every house brand new.

TILE_ROWS = 14
TILE_M = 2.0                  # 1024 px = 2 m: 512 px/m; 14 courses of 0.1429 m, 11 tiles of 0.1818 m per row


def set_tile(src):
    """Biberschwanz (beaver-tail) clay tiles, new: 11 tiles of 18 cm per 2 m row, rounded (segmental) butt ends, each course
    shifted half a tile (double-lap), between the round ends the course below in shadow, per-tile tone (orange to red-brown,
    as a new kiln batch varies), fine fired-clay grain with the plaster scan's micro relief. Each modelled course maps ONE row."""
    rng = np.random.default_rng(23)
    H = W = N
    rh = H / TILE_ROWS
    tw = W / 11.0
    d = os.path.join(src, "Plaster001", "Plaster001_2K-JPG_")
    micro = resize(load(d + "NormalGL.jpg"), N)
    grain = blur(rng.standard_normal((H, W)).astype(np.float32), 1) * 0.5 + rng.standard_normal((H, W)).astype(np.float32) * 0.25
    alb = np.zeros((H, W, 3), np.float32)
    height = np.zeros((H, W), np.float32)
    rough = np.zeros((H, W), np.float32)
    xx = np.arange(W, dtype=np.float32)
    clay = [np.array(c, np.float32) for c in ((0.80, 0.34, 0.17), (0.74, 0.29, 0.15), (0.85, 0.40, 0.20), (0.69, 0.27, 0.16),
                                             (0.80, 0.37, 0.22))]
    for r in range(TILE_ROWS):
        y0, y1 = int(round(r * rh)), int(round((r + 1) * rh))
        off = (r % 2) * tw * 0.5 + rng.uniform(-3, 3)
        ys = np.arange(y0, y1, dtype=np.float32)
        t = (ys - y0) / (y1 - y0)                                  # 0 at the row's top (under the course above), 1 at the butt
        for k in range(12):
            xa = (off + k * tw) % W
            cols = (xx - xa) % W
            sel = cols < tw - 1.5                                  # 1.5 px between tiles
            c = clay[rng.integers(len(clay))] * (1 + rng.normal(0, 0.04))
            u = (cols[sel] / tw) * 2 - 1                           # -1 .. 1 across the tile
            arc = 1 - 0.22 * (u ** 2)                              # the rounded butt (row fraction; 1 = the row's bottom)
            inside = t[:, None] <= arc[None, :]
            block = np.where(inside[..., None], c[None, None, :], (c * 0.38)[None, None, :])
            sub_a = alb[y0:y1]
            sub_a[:, sel] = block
            h = np.where(inside, 0.55 + 0.25 * t[:, None] - np.clip(np.abs(u) - 0.85, 0, 1)[None, :], 0.12)
            sub_h = height[y0:y1]
            sub_h[:, sel] = h
            sub_r = rough[y0:y1]
            sub_r[:, sel] = np.where(inside, 0.62 + rng.normal(0, 0.03), 0.8)
        sh = np.clip(1 - (np.arange(y1 - y0) / (rh * 0.26)), 0, 1) ** 1.6
        alb[y0:y1] *= (1 - 0.45 * sh)[:, None, None]
        height[y0:y1] -= (0.18 * sh)[:, None]
    alb = np.clip(alb * (1 + grain[..., None] * 0.08), 0, 1)
    nor = height_to_normal(height + grain * 0.02, 6.0) * 2 - 1
    m = micro * 2 - 1
    v = np.stack([nor[..., 0] + m[..., 0] * 0.6, nor[..., 1] + m[..., 1] * 0.6, nor[..., 2]], -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    rough = np.clip(rough + grain * 0.03, 0.4, 0.95)
    return alb, v * 0.5 + 0.5, rough


def set_sandstone(src):
    """Dressed Vosges sandstone, new: the plinths, sills, door surrounds, quoins and steps of Alsace. Neutral warm-light so a
    pink or a buff stone is a tint: fine sand grain, faint bedding laminae along U; relief from the granite scan's fine pitting
    (CC0) softened, no weathering."""
    rng = np.random.default_rng(31)
    d = os.path.join(src, "Granite005A", "Granite005A_2K-JPG_")
    nor = normal_strength(resize(load(d + "NormalGL.jpg"), N), 0.55)
    g = rng.standard_normal((N, N)).astype(np.float32)
    fine = g * 0.35 + blur(g, 1) * 0.9
    lam = np.cumsum(blur(rng.standard_normal((N, N)).astype(np.float32), 2), axis=1)
    lam = blur((lam - lam.mean(1, keepdims=True)) / (lam.std() + 1e-4), 3) * 0.6
    broad = blur(blur(rng.standard_normal((N, N)).astype(np.float32), 24), 24)
    broad = broad / (np.abs(broad).max() + 1e-4)
    lum = 0.66 * (1 + fine * 0.035 + lam * 0.025 + broad * 0.03)
    base = np.array([1.0, 0.93, 0.86], np.float32)
    alb = l2s(np.clip(s2l(lum)[..., None] * base, 0, 1))
    h = (fine - fine.min()) / (fine.max() - fine.min())
    m = height_to_normal(h, 1.6) * 2 - 1
    n = nor * 2 - 1
    v = np.stack([n[..., 0] + m[..., 0], n[..., 1] + m[..., 1], n[..., 2]], -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    rou = np.clip(0.80 + fine * 0.03, 0.6, 0.95)
    return alb, v * 0.5 + 0.5, rou


def set_painted_boards(src):
    """Painted boards (shutters, plank doors, soffits, porch ceilings): the cedar scan's boards and joints with its colour taken
    out (a bright neutral that the paint colour tints) and a satin paint's smoother sheen, new."""
    p = os.path.join(src, "japanese_cedar_planks_")
    alb = np.rot90(resize(load(p + "diff_2k.jpg"), N), 1)
    nor = rot_normal(np.rot90(resize(load(p + "nor_gl_2k.jpg"), N), 1))
    lin = fresh(s2l(alb), 40, keep=0.2)
    lum = lin @ LUMA
    r = lum / lum.mean()
    a = l2s(np.clip(0.80 * (1 + (r - 1) * 0.35), 0, 1))[..., None].repeat(3, -1)
    rou = np.full((N, N), 0.42, np.float32) + (1 - r) * 0.05
    return a[:512], normal_strength(nor[:512].copy(), 0.9), np.clip(rou[:512], 0.3, 0.6)


def save(out, name, alb, nor, rou):
    os.makedirs(out, exist_ok=True)
    files = {}
    for kind, a, mode, q in (("albedo", alb, "RGB", 84), ("normal", nor, "RGB", 88), ("rough", rou, "L", 70)):
        img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
        p = os.path.join(out, f"house_{name}_{kind}.webp")
        img.save(p, "WEBP", quality=q, method=6)
        files[kind] = os.path.basename(p)
    return files


# metres of surface per whole texture width (U); band V ranges in Blender UV (v = 0 at the image's bottom)
LAYOUT = {
    "LM_render": {"sets": ["render"], "u_m": 2.0, "v_m": 2.0},
    "LM_stone": {"sets": ["sandstone"], "u_m": 1.0, "v_m": 1.0},
    "LM_roof": {"sets": ["clay_tile"], "u_m": TILE_M, "rows": TILE_ROWS, "exposure_m": TILE_M / TILE_ROWS},
    "LM_wood": {"sets": ["oak", "painted_boards"],
                "bands": {"oak": {"v0": 0.5, "v1": 1.0, "u_m": 1.83, "v_m": 0.915},
                          "timber_cladding": {"v0": 0.0, "v1": 0.5, "u_m": 1.13, "v_m": 0.565}}},
    "LM_metal": {"sets": ["iron", "painted_frame"],
                 "bands": {"metal_painted": {"v0": 0.5, "v1": 1.0, "u_m": 1.0, "v_m": 0.5},
                           "pvc_frame": {"v0": 0.0, "v1": 0.5, "u_m": 1.0, "v_m": 0.5}}},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = {
        "LM_render": save(a.out, "render", *set_render(a.src)),
        "LM_stone": save(a.out, "sandstone", *set_sandstone(a.src)),
        "LM_roof": save(a.out, "tile", *set_tile(a.src)),
        "LM_wood": save(a.out, "wood", *band_pair(set_oak(a.src), set_painted_boards(a.src))),
        "LM_metal": save(a.out, "metal", *band_pair(set_metal(a.src), set_pvc(a.src))),
    }
    total = sum(os.path.getsize(os.path.join(a.out, f)) for m in out.values() for f in m.values())
    meta = {"format": "caysonverse-house-textures", "version": 1, "mapSide": N, "bytes": total, "materials": {}}
    for k, files in out.items():
        meta["materials"][k] = {**LAYOUT[k], "maps": files}
    with open(os.path.join(a.out, "house_textures.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")
    print("textures", a.out, "total", total, "bytes")


if __name__ == "__main__":
    main()
