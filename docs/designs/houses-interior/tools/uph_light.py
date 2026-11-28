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

  tag_upholstery(objs)                before the floor is joined: face attribute "uph" = 1 on upholstery faces of seating pieces and on the
                                      smooth faces of the small table decor (polish3, below)
  bake_vertex_light(obs)              after the texel bake, same lights: per-vertex light {object name: (N, 3) array}
  paint(obs, a, vlight)               overwrites the upholstery texels of the float bake a [rows from the bottom, cols, 3]
"""
import re

import bmesh
import bpy
import numpy as np

UPH_MATS = ("H_fabric", "H_leather", "H_check", "H_floral", "H_velvet", "H_linen")
# polish3 (owner 2026-11-28, house 1's dining table: "초·컵이 육각형, 꽃병이 허접"): a cup, a candle, a vase or a fruit is a few texels of the
# atlas per face, so every face baked to one flat value and the round things read faceted. The smooth faces of the small table decor
# (pieces under DECOR_SIZE across, not lamps / glass / mirrors) take the same vertex light, interpolated round them.
DECOR_SIZE = 0.5
# the place mats and the table runner (thin linen sheets, their hem band a narrow strip of the atlas): the same vertex light, so no edge of
# them bakes a dark smudge
# the styled table tops (HB props_table / props_desk, coffee_styling, console_vignette): a book stack, a mug and a vase spread wider
# than DECOR_SIZE
DECOR_SET = re.compile(r"props|styling|vignette|cstyle")
TABLE_LINEN = re.compile(r"^(mats|runner)\d*$")
DECOR_SKIP = ("H_lamp", "H_shade", "H_glass", "H_mirror", "H_screen")
# polish3 (owner 2026-11-28, house 6: "가죽 소파가 밋밋"): the vertex light of round 2 lost the leather's soft creases and its sheen. The
# leather vertices take a short-range ambient occlusion (creases between the cushions, under the rolled arms; vertex-based, so no seam can
# come back) and a broad view-independent sheen on the faces turned up toward the room (the rolled arm tops and the cushion crowns
# catch the ceiling and window light like a waxed hide).
LEATHER = "H_leather"
AO_DIST = 0.15
AO_FLOOR = 0.4
SHEEN_BASE = 0.8     # the day bake clips on the lit tops: the sheen is a contrast (the hide a shade deeper, its crowns back up)
SHEEN = 0.75
SHEEN_POW = 4.0
SEATING = re.compile(r"sofa|armchair|chair|lounge|bench|ottoman|bean|seat|stool|rocker|cush|pillow|daybed|boryo|bangseok|mattress")
ATTR = "uph"
VCOL = "LM_vertex"


def tag_upholstery(objs):
    n = 0
    for ob in objs:
        if ob.type != "MESH":
            continue
        me = ob.data
        names = [m.name if m else "" for m in me.materials]
        if SEATING.search(ob.name.split("_", 2)[-1].lower()):
            vals = [1 if (p.material_index < len(names) and names[p.material_index] in UPH_MATS) else 0 for p in me.polygons]
        elif TABLE_LINEN.search(ob.name.split("_", 2)[-1].lower()):
            vals = [1 if (p.material_index < len(names) and names[p.material_index] == "H_drape") else 0 for p in me.polygons]
        elif len(me.vertices) and ((max(ob.dimensions[0], ob.dimensions[1]) < DECOR_SIZE and ob.dimensions[2] < 0.7) or
                                   (DECOR_SET.search(ob.name.split("_", 2)[-1].lower()) and max(ob.dimensions) < 1.6)):
            vals = [1 if (p.use_smooth and p.material_index < len(names) and names[p.material_index] not in DECOR_SKIP) else 0 for p in me.polygons]
        else:
            continue
        if not any(vals):
            continue
        at = me.attributes.get(ATTR) or me.attributes.new(ATTR, "INT", "FACE")
        at.data.foreach_set("value", vals)
        n += 1
    for ob in objs:          # every piece carries the attribute, so the join keeps it
        if ob.type == "MESH" and ATTR not in ob.data.attributes:
            ob.data.attributes.new(ATTR, "INT", "FACE")
    return n


AO = {}


def _bake_vertex(obs, select, kind, **kw):
    for ob in obs:
        me = ob.data
        if VCOL in me.color_attributes:
            me.color_attributes.remove(me.color_attributes[VCOL])
        ca = me.color_attributes.new(VCOL, "FLOAT_COLOR", "POINT")
        me.color_attributes.active_color = ca
    select(obs)
    bpy.ops.object.bake(type=kind, target="VERTEX_COLORS", use_selected_to_active=False, **kw)
    out = {}
    for ob in obs:
        me = ob.data
        ca = me.color_attributes[VCOL]
        v = np.empty(len(me.vertices) * 4, np.float32)
        ca.data.foreach_get("color", v)
        out[ob.name] = v.reshape(-1, 4)[:, :3].copy()
        me.color_attributes.remove(ca)
    return out


def _leather_ao(scene, obs, select):
    """short-range ambient occlusion per vertex of the floors that have leather (polish3)"""
    AO.clear()
    has = [ob for ob in obs if any(m and m.name.startswith(LEATHER) for m in ob.data.materials)]
    if not has:
        return
    w = scene.world
    keep = w.light_settings.distance
    w.light_settings.distance = AO_DIST
    keep_col = {ob.name: ob.data.color_attributes.active_color_name for ob in obs}
    try:
        res = _bake_vertex(obs, select, "AO")
        for ob in has:
            AO[ob.name] = res[ob.name][:, 0].copy()
    finally:
        w.light_settings.distance = keep
        for ob in obs:
            n = keep_col[ob.name]
            if n and n in ob.data.color_attributes:
                ob.data.color_attributes.active_color = ob.data.color_attributes[n]


def bake_vertex_light(scene, obs, select):
    """the Cycles diffuse bake (direct + indirect, no colour) once more, into a point-domain colour attribute"""
    _leather_ao(scene, obs, select)
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


def _leather_look(ob, bm, faces, light, centre):
    """creases (AO) and a broad sheen on the leather vertices of these upholstery faces (polish3)"""
    ao = AO.get(ob.name)
    names = [m.name if m else "" for m in ob.data.materials]
    lv = {v.index for f in faces if f.material_index < len(names) and names[f.material_index].startswith(LEATHER) for v in f.verts}
    if not lv or ao is None:
        return 0
    idx = np.array(sorted(lv))
    mw = ob.matrix_world
    m3 = mw.to_3x3()
    bm.verts.ensure_lookup_table()
    k = np.clip(ao[idx], 0.0, 1.0)
    light[idx] *= (AO_FLOOR + (1.0 - AO_FLOOR) * k)[:, None]
    sh = np.empty(len(idx), np.float32)
    for j, i in enumerate(idx):
        v = bm.verts[int(i)]
        n = (m3 @ v.normal).normalized()
        pw = mw @ v.co
        to_c = (centre - pw)
        to_c.z = 0.0
        if to_c.length > 1e-6:
            to_c.normalize()
        hv = (to_c * 0.75 + n.__class__((0.0, 0.0, 1.0))).normalized()
        sh[j] = max(0.0, n.dot(hv)) ** SHEEN_POW
    light[idx] *= (SHEEN_BASE + SHEEN * sh)[:, None]
    print("[bake_house] uph leather vertices", ob.name, len(idx), "ao mean %.2f sheen mean %.2f" % (float(k.mean()), float(sh.mean())))
    return len(idx)


def paint(obs, a, vlight, layer="UV_LM", ring=2.0):
    """rasterises every upholstery triangle into the float bake a with its vertex light interpolated (and `ring` texels past its edges)"""
    H, W = a.shape[0], a.shape[1]
    inside = np.zeros((H, W), bool)
    n_tri = n_fix = 0
    from mathutils import Vector
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in obs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    centre = (lo + hi) * 0.5
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
        _leather_look(ob, bm, faces, light, centre)
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
