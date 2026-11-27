"""Upholstery light from the vertices (sofa seams round 2, owner 2026-11-27: "소파에 어두운 줄·얼룩"; the coordinator's list after round 1:
sawtooth notches along the cushion edges, a line across a back cushion, a dark smudge behind a scatter pillow, dark ends on the rolled arms).

Every one of those came from the light-map atlas, not from the light: a cushion is a rounded box, smart-project cuts its round-overs into
many small islands, some under a texel wide, and the texels along each island's edge took the margin fill of the atlas, so neighbouring
islands showed different light along their shared edge (the notches), a sub-texel strip showed somebody else's light (the line), and the
cushion faces that run INTO a pillow or the back frame (the hidden end of a rolled arm) baked black and bled into the visible texels.

So the upholstery of the seating pieces takes its light from the mesh instead: the same Cycles diffuse bake is done once more into a
per-vertex colour (vertices are shared across every island seam, so the light is continuous by construction), vertices buried inside
other geometry (much darker than the rest of their own connected part, e.g. the cushion under a pillow, a cap inside the back frame) take
the mean of their lit neighbours, and the upholstery triangles are then painted into the light map with that light interpolated across
them, two texels past their edges (the islands are four texels apart). The cushions are dense (rounded boxes, subdivided tops), so the
vertex light keeps the soft shading; walls, floors and every other piece keep the texel bake.

  tag_upholstery(objs)                before the floor is joined: face attribute "uph" = 1 on upholstery faces of seating pieces
  bake_vertex_light(obs)              after the texel bake, same lights: per-vertex light {object name: (N, 3) array}
  paint(obs, a, vlight)               overwrites the upholstery texels of the float bake a [rows from the bottom, cols, 3]
"""
import re

import bmesh
import bpy
import numpy as np

UPH_MATS = ("H_fabric", "H_leather", "H_check", "H_floral", "H_velvet", "H_linen")
SEATING = re.compile(r"sofa|armchair|chair|lounge|bench|ottoman|bean|seat|stool|rocker|cush|pillow|daybed|boryo|bangseok|mattress")
ATTR = "uph"
VCOL = "LM_vertex"


def tag_upholstery(objs):
    n = 0
    for ob in objs:
        if ob.type != "MESH" or not SEATING.search(ob.name.split("_", 2)[-1].lower()):
            continue
        me = ob.data
        names = [m.name if m else "" for m in me.materials]
        vals = [1 if (p.material_index < len(names) and names[p.material_index] in UPH_MATS) else 0 for p in me.polygons]
        if not any(vals):
            continue
        at = me.attributes.get(ATTR) or me.attributes.new(ATTR, "INT", "FACE")
        at.data.foreach_set("value", vals)
        n += 1
    for ob in objs:          # every piece carries the attribute, so the join keeps it
        if ob.type == "MESH" and ATTR not in ob.data.attributes:
            ob.data.attributes.new(ATTR, "INT", "FACE")
    return n


def bake_vertex_light(scene, obs, select):
    """the Cycles diffuse bake (direct + indirect, no colour) once more, into a point-domain colour attribute"""
    keep = {}
    for ob in obs:
        me = ob.data
        keep[ob.name] = me.color_attributes.active_color_name
        if VCOL in me.color_attributes:
            me.color_attributes.remove(me.color_attributes[VCOL])
        ca = me.color_attributes.new(VCOL, "FLOAT_COLOR", "POINT")
        me.color_attributes.active_color = ca
    select(obs)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="VERTEX_COLORS", use_selected_to_active=False)
    out = {}
    for ob in obs:
        me = ob.data
        ca = me.color_attributes[VCOL]
        v = np.empty(len(me.vertices) * 4, np.float32)
        ca.data.foreach_get("color", v)
        out[ob.name] = v.reshape(-1, 4)[:, :3].copy()
        me.color_attributes.remove(ca)
        if keep[ob.name] and keep[ob.name] in me.color_attributes:
            me.color_attributes.active_color = me.color_attributes[keep[ob.name]]
    return out


def _fix_buried(bm, uph_faces, light):
    """vertices far darker than their own connected part (buried in a pillow, the back frame...) take their lit neighbours' mean"""
    verts = {v.index for f in uph_faces for v in f.verts}
    adj = {i: set() for i in verts}
    for f in uph_faces:
        vs = [v.index for v in f.verts]
        for k in range(len(vs)):
            a, b = vs[k], vs[(k + 1) % len(vs)]
            adj[a].add(b)
            adj[b].add(a)
    lum = light @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    seen, fixed = set(), 0
    for s in verts:
        if s in seen:
            continue
        comp, stack = [], [s]
        seen.add(s)
        while stack:
            i = stack.pop()
            comp.append(i)
            for j in adj[i]:
                if j not in seen:
                    seen.add(j)
                    stack.append(j)
        ref = float(np.percentile(lum[comp], 75))
        bad = {i for i in comp if lum[i] < 0.2 * ref}
        if not bad or len(bad) == len(comp):
            continue
        for _ in range(64):
            done = []
            for i in bad:
                good = [j for j in adj[i] if j not in bad]
                if good:
                    light[i] = light[good].mean(axis=0)
                    done.append(i)
            if not done:
                break
            bad -= set(done)
            fixed += len(done)
    return fixed


def paint(obs, a, vlight, layer="UV_LM", ring=2.0):
    """rasterises every upholstery triangle into the float bake a with its vertex light interpolated (and `ring` texels past its edges)"""
    H, W = a.shape[0], a.shape[1]
    inside = np.zeros((H, W), bool)
    n_tri = n_fix = 0
    for ob in obs:
        me = ob.data
        if ATTR not in me.attributes:
            continue
        light = vlight[ob.name]
        bm = bmesh.new()
        bm.from_mesh(me)
        al = bm.faces.layers.int.get(ATTR)
        uvl = bm.loops.layers.uv[layer]
        faces = [f for f in bm.faces if f[al]]
        if not faces:
            bm.free()
            continue
        n_fix += _fix_buried(bm, faces, light)
        for f in faces:
            ls = list(f.loops)
            for t in range(1, len(ls) - 1):
                tri = (ls[0], ls[t], ls[t + 1])
                P = np.array([(l[uvl].uv.x * W, l[uvl].uv.y * H) for l in tri], np.float64)
                C = np.array([light[l.vert.index] for l in tri], np.float32)
                (x0, y0), (x1, y1), (x2, y2) = P
                den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
                if abs(den) < 1e-12:
                    continue
                lo = np.floor(P.min(0) - ring).astype(int)
                hi = np.ceil(P.max(0) + ring).astype(int)
                lo = np.maximum(lo, 0)
                hi = np.minimum(hi, [W - 1, H - 1])
                if hi[0] < lo[0] or hi[1] < lo[1]:
                    continue
                gx, gy = np.meshgrid(np.arange(lo[0], hi[0] + 1) + 0.5, np.arange(lo[1], hi[1] + 1) + 0.5)
                w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
                w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
                w2 = 1.0 - w0 - w1
                # distance-ish tolerance: barycentric slack of `ring` texels over the triangle's smallest altitude
                area2 = abs(den)
                edges = [np.hypot(*(P[1] - P[2])), np.hypot(*(P[2] - P[0])), np.hypot(*(P[0] - P[1]))]
                alt = area2 / max(max(edges), 1e-9)
                tol = ring / max(alt, 1e-6)
                m_in = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
                m_ring = (w0 >= -tol) & (w1 >= -tol) & (w2 >= -tol)
                if not m_ring.any():
                    continue
                c0, c1, c2 = np.clip(w0, 0, None), np.clip(w1, 0, None), np.clip(w2, 0, None)
                s = c0 + c1 + c2
                s[s == 0] = 1
                val = (c0[..., None] * C[0] + c1[..., None] * C[1] + c2[..., None] * C[2]) / s[..., None]
                ys, xs = slice(lo[1], hi[1] + 1), slice(lo[0], hi[0] + 1)
                sub, subin = a[ys, xs], inside[ys, xs]
                w_ring = m_ring & ~subin          # the ring never overwrites another upholstery triangle's own texels
                sub[w_ring] = val[w_ring]
                sub[m_in] = val[m_in]
                subin |= m_in
                n_tri += 1
        bm.free()
    return n_tri, n_fix
