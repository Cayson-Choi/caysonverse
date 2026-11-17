"""L6: bake a walk-in room's light into lightmaps (Blender 5.3, Cycles on the CPU: CV_CPU=1, one Blender at a time).

Called by a room's parts script with `--lightmap <dir>` (b2_blender.run_room, before the export):

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_chapel_nave.py -- --layout <lots.json> \
      --png <decoded PBR pngs> --lightmap <dir for the PNGs> [--lm-size 1024] [--lm-samples 96] [--out <glb>] ...

What it does, on the room's own meshes (`lotroom__<unit>_shell`; the furniture, instanced kinds, glass, the light pools,
the flames and the night glow are left out):
  1. a second UV map `lm` on each (TEXCOORD_1 in the GLB), all of them smart-projected into ONE atlas;
  2. the room's light baked into it twice — by day (the sky and the sun through the windows, the room's lamps) and by night
     (the lamps, candles and fill at their night strength) — as Cycles diffuse irradiance (direct + indirect, no colour);
  3. both written as 8-bit sRGB PNGs, `irradiance = (png ^ 2.2) * scale`; `scale` (the brighter bake's 99.5th percentile,
     shared by day and night so they mix) goes in the GLB extras `lightmap`.
The game (LotRoom.tsx) puts the day map on `lightMap` (channel 1) and mixes the night map in by one uniform.
The glass is made see-through for the bake (a transparent shader on M_glass), so the sun reaches the floor.
"""
import math
import os

import bpy
import numpy as np

import b1_blender as B


def _targets(objs, unit_id):
    # the room's shell (walls, floor, vaults, the big fixed pieces): the furniture's thousands of small faces would
    # crumble the atlas into specks (the pilot's first bake); they keep the game's live light
    keep = ("lotroom__%s_shell" % unit_id,)
    return [o for o in objs if o.type == "MESH" and o.name.split(".")[0] in keep]


def _lightmap_uvs(targets):
    for o in targets:
        me = o.data
        if "lm" not in me.uv_layers:
            me.uv_layers.new(name="lm")
        me.uv_layers.active = me.uv_layers["lm"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in targets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006, area_weight=1.0, correct_aspect=True, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, margin=0.004)
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in targets:
        # the textures' UVs stay the first map (TEXCOORD_0): only the bake reads `lm`
        o.data.uv_layers.active = o.data.uv_layers[0]
        o.data.uv_layers[0].active_render = True


def _glass_clear():
    """The bake's glass: fully transparent (the sun through the windows onto the floor and the pews)."""
    m = bpy.data.materials.get("M_glass")
    if m is None:
        return
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    nt.links.new(tr.outputs["BSDF"], out.inputs["Surface"])


def _bake_one(targets, size, samples, name):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    nodes = []
    seen = set()
    for o in targets:
        o.data.uv_layers.active = o.data.uv_layers["lm"]
        for m in o.data.materials:
            if m is None or m.name in seen:
                continue
            seen.add(m.name)
            m.use_nodes = True
            n = m.node_tree.nodes.new("ShaderNodeTexImage")
            n.image = img
            m.node_tree.nodes.active = n
            nodes.append((m, n))
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    try:
        sc.cycles.use_denoising = False
    except Exception:
        pass
    sc.render.bake.margin = 6
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    bpy.ops.object.select_all(action="DESELECT")
    for o in targets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=6, use_clear=True)
    for m, n in nodes:
        m.node_tree.nodes.remove(n)
    for o in targets:
        o.data.uv_layers.active = o.data.uv_layers[0]
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)[:, :, :3]
    return img, px


def _blur_seams(px, it=2):
    """A light box blur of the texels (the bake's sample noise), keeping the unbaked (black) gutter out of the average."""
    lit = (px.max(axis=2) > 1e-6).astype(np.float32)[:, :, None]
    for _ in range(it):
        acc = np.zeros_like(px)
        w = np.zeros_like(lit)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(px * lit, dy, 0), dx, 1)
                w += np.roll(np.roll(lit, dy, 0), dx, 1)
        px = np.where(lit > 0, acc / np.maximum(w, 1e-6), px)
    return px


def _save(px, scale, path):
    size = px.shape[0]
    v = np.clip(px / scale, 0.0, 1.0) ** (1.0 / 2.2)
    rgba = np.concatenate([v, np.ones((size, size, 1), dtype=np.float32)], axis=2)
    img = bpy.data.images.new(os.path.basename(path), size, size, alpha=False)
    img.pixels = rgba.ravel().tolist()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


def bake_room(kit, objs, unit_id, out_dir, setup_day_night, size=1024, samples=96, file_id=None):
    """Bakes the room's day and night lightmaps; returns the GLB extras entry (`lightmap`)."""
    os.makedirs(out_dir, exist_ok=True)
    targets = _targets(objs, unit_id)
    if not targets:
        B.log("lightmap: no room meshes")
        return None
    _lightmap_uvs(targets)
    _glass_clear()
    out = {}
    for t in ("day", "night"):
        setup_day_night(t == "day")
        B.log("lightmap: baking", t, size, "px", samples, "samples")
        _, px = _bake_one(targets, size, samples, "lm_%s_%s" % (unit_id, t))
        out[t] = _blur_seams(px)
    lit = np.concatenate([out["day"][out["day"].max(axis=2) > 1e-6], out["night"][out["night"].max(axis=2) > 1e-6]])
    scale = float(np.percentile(lit.max(axis=1), 99.5)) if lit.size else 1.0
    files = {}
    for t in ("day", "night"):
        p = os.path.join(out_dir, "%s_lm_%s.png" % (file_id or unit_id, t))
        _save(out[t], scale, p)
        files[t] = p
        B.log("lightmap:", t, "->", p, "mean", float(out[t].mean()))
    return {"scale": round(scale, 4), "size": size, "channel": 1, "files": files}
