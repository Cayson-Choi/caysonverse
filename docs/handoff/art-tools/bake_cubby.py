"""Bake the shared light texture of the white lacquer cubby interiors (케이슨 마을 추모관, round 6 review; Blender 5.2).

  blender -b art/village/work/memorial_authoring.blend -P art/village/tools/bake_cubby.py -- [--samples 2048]

Run after build_memorial.py and before bake_memorial.py (whose export picks the texture up as M_cubby_in).

Why: the 368 cubbies of banks A and B had five tiny islands each in the hall's 2048 px light map. In the cubby close-up (the
screen a visitor looks at their own pet's cubby on) the white lacquer showed brown / apricot blotches and blur, worse at night.
Now every interior maps its five faces onto ONE cross layout (build_memorial.py cubby_interior / cubby_uv), and this script
bakes that layout once, on a representative cubby (`cubby_probe`, bank A row 3, the middle column) standing in the real hall
with its LED row, the hall's own lights and the sky — the same Cycles DIFFUSE (direct + indirect) bake as the light map:

  - DAY into the left half of T_m_cubby_in.png (u 0..0.5), NIGHT (bake_memorial.setup_night) into the right half;
  - stored already shaded, as the game would draw a light-mapped lacquer texel: albedo x (L + lift) x 0.8 (the light map's
    L / 2 times lightMapIntensity 1.6 pi / pi), sRGB. The game draws it unlit and blends the halves by the night weight
    (client hallNight.ts patchHallCubbyMaterial).
"""
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402
import bake_village as BV  # noqa: E402
import bake_memorial as BM  # noqa: E402

WORK = os.path.join(U.ROOT, "work")
TEXM = os.path.join(WORK, "tex_m")
OUT = os.path.join(TEXM, "T_m_cubby_in.png")
W, H = 1024, 512
DESATURATE = 0.35


def lacquer_albedo():
    img = bpy.data.images.load(os.path.join(TEXM, "T_m_lacquer.png"), check_existing=True)
    img.colorspace_settings.name = "Non-Color"
    px = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(px)
    e = px.reshape(-1, 4)[:, :3].mean(0)
    return np.where(e <= 0.04045, e / 12.92, ((e + 0.055) / 1.055) ** 2.4)


def bake_probe(scene, probe, samples, shift):
    """Bake the probe's irradiance (linear, W x H) with its UVs shifted by `shift` in u (0 = day half, 0.5 = night half)."""
    uv = probe.data.uv_layers["UVMap"].data
    co = np.empty(len(uv) * 2, np.float32)
    uv.foreach_get("uv", co)
    moved = co.copy()
    moved[0::2] += shift
    uv.foreach_set("uv", moved)
    img = bpy.data.images.new("cubby_bake", W, H, alpha=False, float_buffer=True)
    added = []
    for m in probe.data.materials:
        nt = m.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
        added.append((m, n))
    state = BV.BakeMaterialState(False)
    probe.data.uv_layers.active = probe.data.uv_layers["UVMap"]
    BV.select([probe])
    scene.cycles.samples = samples
    scene.render.bake.margin = 24
    scene.render.bake.margin_type = "EXTEND"
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=24, use_clear=True,
                        target="IMAGE_TEXTURES", use_selected_to_active=False)
    state.restore()
    for m, n in added:
        m.node_tree.nodes.remove(n)
    uv.foreach_set("uv", co)
    px = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    a = px.reshape(H, W, 4)[..., :3].copy()
    # a gentle 5 x 5 binomial: the light inside a cubby is smooth; it takes the last of the sampling noise out
    k = np.array([1, 4, 6, 4, 1], np.float32) / 16
    for ax in (0, 1):
        a = sum(np.roll(a, s, axis=ax) * w for s, w in zip((-2, -1, 0, 1, 2), k))
    return a


def main():
    scene = bpy.context.scene
    BV.gpu(scene)
    samples = BV.arg("--samples", 2048, int)
    probe = bpy.data.objects.get("cubby_probe")
    if probe is None:
        raise SystemExit("cubby_probe missing: rebuild with build_memorial.py")
    # the real interiors would sit on the probe's faces: off for this bake; the probe stands in for its cubby
    for o in bpy.data.objects:
        if o.get("cubby_in") or o.get("garden") or o.get("glass") or o.get("cat") in ("door", "collider"):
            o.hide_render = True
    probe.hide_render = False
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 5
    day = bake_probe(scene, probe, samples, 0.0)
    BM.setup_night(scene)
    night = bake_probe(scene, probe, samples, 0.5)
    albedo = lacquer_albedo()
    lin = np.empty((H, W, 3), np.float32)
    half = W // 2
    lin[:, :half] = albedo * (day[:, :half] + BM.LM_LIFT * np.array([0.92, 0.96, 1.0], np.float32)) * 0.8
    lin[:, half:] = albedo * (night[:, half:] + BM.NIGHT["lift"] * np.array([0.92, 0.96, 1.0], np.float32)) * 0.8
    # white lacquer under warm LEDs reads white, not apricot (round 6 review): a third of the light's colour is taken out,
    # keeping each texel's brightness
    lum3 = (lin @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    lin = lum3 + (lin - lum3) * (1 - DESATURATE)
    enc = np.clip(lin, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
    BV.save_png(enc, OUT)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    BV.log("cubby texture", OUT, "albedo", albedo.round(3).tolist(),
           "day p50", float(np.percentile(lum[:, :half], 50)), "night p50", float(np.percentile(lum[:, half:], 50)))


if __name__ == "__main__":
    main()
