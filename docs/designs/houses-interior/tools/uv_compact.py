"""Albedo-UV compaction before the Draco export (houses-real pass, owner 2026-11-21: "smeared streaks" on the sofa cushions and arms).

The kit writes albedo UVs ("UVMap") in world metres / tile, so one floor's fabric spans u, v ~ -1300..1300. Draco quantises each
primitive's texcoords to 14 bits over that whole range: a step of ~0.15 UV (~8 cm of fabric), so every bevel strip, cushion side and
welt narrower than that got both edges snapped to the SAME u or v and the texture smeared into streaks across it.

Every UV island is moved by a whole number of tiles to sit next to the origin (the albedos repeat, so the picture is unchanged), which
shrinks the range to a few units and the quantisation step to well under a texel. Islands already inside 0..1 (paintings, atlas cells)
keep their place (their centre's floor is 0). The light-map set ("UV_LM") is not touched.
"""
import math

import bmesh


def compact_uv0(objs, layer="UVMap"):
    moved = 0
    for ob in objs:
        if ob is None or ob.type != "MESH" or layer not in ob.data.uv_layers:
            continue
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        uvl = bm.loops.layers.uv[layer]
        seen = set()
        for f0 in bm.faces:
            if f0.index in seen:
                continue
            # flood fill over edges whose two faces share the same UVs at both ends (one UV island)
            island, stack = [], [f0]
            seen.add(f0.index)
            while stack:
                f = stack.pop()
                island.append(f)
                for lp in f.loops:
                    e = lp.edge
                    a0, a1 = lp[uvl].uv, lp.link_loop_next[uvl].uv
                    for lo in e.link_loops:
                        g = lo.face
                        if g.index in seen or g.material_index != f.material_index:
                            continue
                        # lo runs the edge the other way round: lo.vert == lp.link_loop_next.vert
                        if lo.vert == lp.vert:          # same winding (flipped neighbour)
                            b0, b1 = lo[uvl].uv, lo.link_loop_next[uvl].uv
                        else:
                            b0, b1 = lo.link_loop_next[uvl].uv, lo[uvl].uv
                        if (a0 - b0).length < 1e-5 and (a1 - b1).length < 1e-5:
                            seen.add(g.index)
                            stack.append(g)
            su = sv = 0.0
            k = 0
            for f in island:
                for lp in f.loops:
                    su += lp[uvl].uv.x
                    sv += lp[uvl].uv.y
                    k += 1
            du, dv = math.floor(su / k), math.floor(sv / k)
            if du or dv:
                moved += 1
                for f in island:
                    for lp in f.loops:
                        lp[uvl].uv.x -= du
                        lp[uvl].uv.y -= dv
        bm.to_mesh(ob.data)
        bm.free()
    return moved
