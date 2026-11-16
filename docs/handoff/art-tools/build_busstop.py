"""The village's bus stop kit — the waiting pad, the shelter and the stop sign (Blender 5.2, background).

  blender -b --factory-startup -P art/village/tools/build_busstop.py -- [--out <glb>] [--renders <dir>]

Modelled in game axes and placed in WORLD coordinates (the file's origin is the village's), so the game loads it with no
transform (client/src/village/BusStopShelter.tsx). x east, y up, z south; the road is on the west side (-x) of the stop.

  * The pad (xwalk fix 2026-11-13, owner: "버스 정류장하고 버스하고 너무 붙어 있어서 캐릭터가 들어가기가 힘들어"): a paved
    waiting area 4 cm above the ground (an L, x 38.6..43.4, z -10.8..-1.4, notched round the café's corner) that runs back
    from the sidewalk, so the shelter stands at the BACK of it with 3 m of clear paving between the roadway's kerb and its
    roof, as at a real Korean stop (shelter 1-3 m from the kerb, bench facing the road), instead of on the kerb
    with the bus's doors 1.5 m away.
  * The shelter (research photos of Korean city bus shelters): an arched roof (light grey, blue trim) on square aluminium
    posts, open to the road (-x), glass back wall and glass ends in thin frames with a kick plate, a route light box in
    the middle of the back wall (our own map: the ring road, the stop, "마을버스 1004"), a slatted bench with arm
    dividers and a back rest along the back wall, an arrival display (BIS, amber dots) hung under the roof's front edge, an
    LED strip under the roof. 3.6 m long, 1.5 m deep, 3.3 m to the roof's underside.
    (owner 2026-11-13: "정류장이 더 높아야겠어 모자가 닿여": the chibi avatars' hats reach 2.69 m (wizard), so the roof went up from
    2.55 to 3.3 m; the arrival display left its hanger under the roof for the roof's front fascia, above every hat.)
  * The stop sign: a post at the pad's south end with the blue plate (ring with a bus pictogram, "케이슨 마을", "1004").
Our own lettering only (Jua): no real route, company or brand.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_signals as bs  # Part, Frame, material helpers (the module's main() is guarded)

ROOT = os.path.dirname(HERE)
TEX = os.path.join(ROOT, "work", "tex_busstop")
EXPORT = os.path.join(ROOT, "export")
Part, Frame, srgb, material = bs.Part, bs.Frame, bs.srgb, bs.material


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


OUT = arg("--out", os.path.join(EXPORT, "village_busstop.glb"))
RENDERS = arg("--renders")

# --- placement (shared/src/village/villageLayout.ts busStop) ---------------------------------------------------------
CX, CZ = 40.9, -4.9  # the shelter's centre
DEPTH, LEN = 1.5, 3.6
PAD = [(38.6, -10.8), (40.4, -10.8), (40.4, -7.4), (43.4, -7.4), (43.4, -1.4), (38.6, -1.4)]
PAD_H = 0.045
SIGN_AT = (40.0, -1.8)

MAT = {}


def make_materials():
    m = bpy.data
    MAT["frame"] = material("M_stop_frame", srgb("#3F464D"), 0.5, 0.6)
    MAT["roof"] = material("M_stop_roof", srgb("#D7DCE1"), 0.5, 0.2)
    MAT["trim"] = material("M_stop_trim", srgb("#1665B4"), 0.45, 0.1)
    MAT["wood"] = material("M_stop_wood", srgb("#9C7448"), 0.7, 0.0)
    MAT["steel"] = material("M_stop_steel", srgb("#8D949A"), 0.45, 0.7)
    MAT["black"] = material("M_stop_black", srgb("#16181B"), 0.5, 0.1)
    MAT["concrete"] = material("M_stop_concrete", srgb("#A6A39D"), 0.9, 0.0)
    MAT["led"] = material("M_stop_led", srgb("#FFF3DC"), 0.4, 0.0, emissive=srgb("#FFF0D0"))
    glass = material("M_stop_glass", srgb("#BFE3EE"), 0.08, 0.0)
    b = next(n for n in glass.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Alpha"].default_value = 0.22
    try:
        glass.surface_render_method = "BLENDED"
    except Exception:
        pass
    MAT["glass"] = glass
    for key, img, em in (("map", "T_stop_map.png", 0.55), ("bis", "T_stop_bis.png", 1.0), ("sign", "T_stop_sign.png", 0.0), ("pad", "T_pad.png", 0.0)):
        mat = material("M_stop_" + key, (1, 1, 1), 0.7 if key != "pad" else 0.9, 0.0, image=os.path.join(TEX, img))
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        if em:
            tex = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = em
        MAT[key] = mat


def box(part, x, y, z, sx, sy, sz):
    part.box((x, y, z), (sx, sy, sz))


def inset(poly, d):
    """Offset a simple counter-clockwise polygon inward by d (mitred; rectilinear shapes stay rectilinear)."""
    n = len(poly)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1, n2 = Vector((-e1.y, e1.x)), Vector((-e2.y, e2.x))  # left normals = inward for CCW
        # intersection of the two offset lines
        a, b = p0 + n1 * d, p1 + n1 * d
        c, e = p1 + n2 * d, p2 + n2 * d
        den = (b - a).x * (e - c).y - (b - a).y * (e - c).x
        t = ((c - a).x * (e - c).y - (c - a).y * (e - c).x) / den if abs(den) > 1e-9 else 0
        q = a + (b - a) * t
        out.append((q.x, q.y))
    return out


def build_pad(parts):
    """The pad: a 4.5 cm slab with a chamfered top edge (a 2 cm band inset 2.5 cm), paver top (planar UV, 2 m a repeat)."""
    from mathutils.geometry import tessellate_polygon

    top, side = parts["pad"], parts["concrete"]
    top.flat = side.flat = True
    poly = PAD  # (x, z), counter-clockwise in plain (x, z) axes
    n = len(poly)
    ins = inset(poly, 0.025)
    y0, y1, y2 = 0.0, PAD_H - 0.02, PAD_H
    ids0 = [side.vert((x, y0, z)) for x, z in poly]
    ids1 = [side.vert((x, y1, z)) for x, z in poly]
    ids2 = [side.vert((x, y2, z)) for x, z in ins]
    for k in range(n):
        m = (k + 1) % n
        side.quad(ids0[m], ids0[k], ids1[k], ids1[m])  # outward (see the winding note in the file header)
        side.quad(ids1[m], ids1[k], ids2[k], ids2[m])
    tids = [top.vert((x, y2, z)) for x, z in ins]
    for tri in tessellate_polygon([[Vector((x, z, 0)) for x, z in ins]]):
        a, b, c = tri
        pa, pb, pc = ins[a], ins[b], ins[c]
        cross_y = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
        # normal (b-a) x (c-a) has y = -(dx1*dz2 - dz1*dx2): face +y needs cross_y < 0 in (x, z)
        top.tri(tids[a], tids[b], tids[c]) if cross_y < 0 else top.tri(tids[a], tids[c], tids[b])
    top.uvfn = lambda p: (p[0] / 2.0, p[2] / 2.0)


def build_shelter(parts):
    fr, roof, trim, glass, steel, wood, led, black = (parts[k] for k in ("frame", "roof", "trim", "glass", "steel", "wood", "led", "black"))
    x0, x1 = CX - DEPTH / 2, CX + DEPTH / 2  # front (road side) and back
    z0, z1 = CZ - LEN / 2, CZ + LEN / 2
    yb = PAD_H  # floor
    ROOF_BOTTOM = 3.3  # was 2.55; the wizard hat is 2.69 m (shared/src/village/villageLayout.ts BUS_SHELTER_ROOF)
    # --- roof: an arched profile (x, y) extruded along z, with blue trim boards on the front and back edges
    f = Frame((0, 0, z0 - 0.25), (0, 0, 1))  # local x = world x, y up, z along +z
    rx0, rx1 = CX - 1.05, CX + 1.05
    pts = []
    N = 10
    for i in range(N + 1):
        t = i / N
        x = rx0 + (rx1 - rx0) * t
        sag = 0.07 * (1 - ((x - CX) / 1.05) ** 2)
        pts.append((x, ROOF_BOTTOM + 0.10 + sag))
    prof = [(rx0, ROOF_BOTTOM), (rx1, ROOF_BOTTOM)] + list(reversed(pts))
    f.prism(roof, prof, 0.0, LEN + 0.5)
    for xx in (rx0 + 0.03, rx1 - 0.03):  # trim boards (front and back edge), blue
        box(trim, xx, ROOF_BOTTOM - 0.01, CZ, 0.06, 0.16, LEN + 0.5)
    for zz in (z0 - 0.25 + 0.015, z1 + 0.25 - 0.015):  # end caps
        box(trim, CX, ROOF_BOTTOM + 0.04, zz, 2.1, 0.20, 0.03)
    # LED strip under the roof along the front
    box(led, CX - 0.55, ROOF_BOTTOM - 0.02, CZ, 0.05, 0.02, LEN - 0.4)
    # --- posts (square aluminium): front pair, back four
    post = lambda x, z: box(fr, x, (yb + ROOF_BOTTOM) / 2, z, 0.08, ROOF_BOTTOM - yb, 0.08)
    for z in (z0 + 0.05, z1 - 0.05):
        post(x0 + 0.05, z)
    back = [z0 + 0.05, CZ - 0.62, CZ + 0.62, z1 - 0.05]
    for z in back:
        post(x1 - 0.05, z)
    # --- back wall: glass | light box | glass, each in a thin frame, kick plate and top rail
    xb = x1 - 0.05
    gy0, gy1 = yb + 0.16, ROOF_BOTTOM - 0.10

    def glass_panel_zy(xc, za, zb):
        box(glass, xc, (gy0 + gy1) / 2, (za + zb) / 2, 0.012, gy1 - gy0, zb - za - 0.08)
        box(fr, xc, gy0 - 0.08, (za + zb) / 2, 0.05, 0.16, zb - za)  # kick plate
        box(fr, xc, gy1 + 0.04, (za + zb) / 2, 0.05, 0.05, zb - za)  # top rail
        box(fr, xc, (gy0 + gy1) / 2, (za + zb) / 2, 0.03, 0.03, zb - za - 0.08)  # a mid rail
        box(fr, xc, yb + 1.0, (za + zb) / 2, 0.03, 0.03, zb - za - 0.08)  # a lower rail (the glass is 3 m tall now)
    glass_panel_zy(xb, back[0], back[1])
    glass_panel_zy(xb, back[2], back[3])
    # light box in the middle bay
    lb_y0, lb_y1 = yb + 0.62, yb + 2.42
    box(fr, xb + 0.01, (lb_y0 + lb_y1) / 2, CZ, 0.075, lb_y1 - lb_y0, 1.24)
    box(fr, xb, (yb + lb_y0) / 2, CZ, 0.05, lb_y0 - yb, 1.24)
    box(fr, xb, (lb_y1 + ROOF_BOTTOM) / 2, CZ, 0.05, ROOF_BOTTOM - lb_y1, 1.24)
    mp = parts["map"]
    xm = xb + 0.01 - 0.0375 - 0.001
    zz0, zz1 = CZ - 0.52, CZ + 0.52
    ids = [mp.vert((xm, y, z)) for z, y in ((zz0, lb_y0 + 0.06), (zz1, lb_y0 + 0.06), (zz1, lb_y1 - 0.06), (zz0, lb_y1 - 0.06))]
    mp.quad(*ids)
    mp.uvq = [(0, 0), (1, 0), (1, 1), (0, 1)]
    mp.flat = True
    # --- the ends: a glass panel each, full height
    for z in (z0 + 0.05, z1 - 0.05):
        xc = (x0 + 0.05 + x1 - 0.05) / 2
        w = (x1 - x0) - 0.1
        box(glass, xc, (gy0 + gy1) / 2, z, w - 0.08, gy1 - gy0, 0.012)
        box(fr, xc, gy0 - 0.08, z, w, 0.16, 0.05)
        box(fr, xc, gy1 + 0.04, z, w, 0.05, 0.05)
    # --- bench along the back wall: 3 seat slats, 2 back slats, 2 end frames + 2 arm dividers
    bz0, bz1 = CZ - 1.15, CZ + 1.15
    for dx in (0.10, 0.25, 0.40):
        box(wood, x1 - 0.50 + dx - 0.20, yb + 0.45, CZ, 0.13, 0.035, bz1 - bz0)
    for y in (yb + 0.72, yb + 0.90):
        box(wood, x1 - 0.17, y, CZ, 0.03, 0.13, bz1 - bz0)
    for z in (bz0 + 0.03, bz1 - 0.03, CZ - 0.38, CZ + 0.38):
        steel.tube((x1 - 0.20, yb, z), (x1 - 0.20, yb + 0.44, z), 0.018, 0.018, seg=8)
        steel.tube((x1 - 0.52, yb, z), (x1 - 0.52, yb + 0.44, z), 0.018, 0.018, seg=8)
        steel.tube((x1 - 0.20, yb + 0.44, z), (x1 - 0.17, yb + 1.0, z), 0.015, 0.015, seg=8)
    for z in (CZ - 0.38, CZ + 0.38):
        box(steel, x1 - 0.36, yb + 0.68, z, 0.40, 0.025, 0.04)
    # --- arrival display (BIS) on the roof's front fascia (it hung under the roof's edge at 2.0..2.46 m: a hat touched it):
    # a black housing standing 0.5 m up from the roof's front edge, the dot-matrix face looking at the road (-x), clear of
    # every head under the roof. Top-mounted LED boards are common on Korean shelters.
    bz = CZ
    by0, by1 = ROOF_BOTTOM + 0.06, ROOF_BOTTOM + 0.62
    hx = rx0 + 0.05
    box(black, hx, (by0 + by1) / 2, bz, 0.10, by1 - by0, 1.14)
    for dz in (-0.45, 0.45):
        box(fr, hx + 0.01, ROOF_BOTTOM + 0.04, bz + dz, 0.06, 0.10, 0.06)  # feet on the fascia
    bis = parts["bis"]
    xf = hx - 0.05 - 0.001
    ids = [bis.vert((xf, y, z)) for z, y in ((bz - 0.52, by0 + 0.05), (bz + 0.52, by0 + 0.05), (bz + 0.52, by1 - 0.05), (bz - 0.52, by1 - 0.05))]
    bis.quad(*ids)
    bis.uvq = [(0, 0), (1, 0), (1, 1), (0, 1)]
    bis.flat = True


def build_sign(parts):
    sx, sz = SIGN_AT
    steel, black, sign = parts["steel"], parts["black"], parts["sign"]
    steel.tube((sx, PAD_H, sz), (sx, 3.95, sz), 0.04, 0.04, seg=14)
    steel.tube((sx, 3.95, sz), (sx, 3.99, sz), 0.04, 0.0, seg=14)
    black.tube((sx, PAD_H, sz), (sx, PAD_H + 0.1, sz), 0.07, 0.07, seg=14)
    w, h, y0 = 0.46, 0.92, 2.95
    box(black, sx + 0.0, y0 + h / 2, sz, w + 0.02, h + 0.02, 0.03)
    # clamps
    for y in (y0 + 0.12, y0 + h - 0.12):
        box(black, sx, y, sz - 0.03, 0.05, 0.06, 0.04)
    z = sz + 0.0165  # front face (+z): the approaching bus sees it
    ids = [sign.vert((sx + dx, y, z)) for dx, y in ((-w / 2, y0), (w / 2, y0), (w / 2, y0 + h), (-w / 2, y0 + h))]
    sign.quad(*ids)
    z = sz - 0.0165  # back face (-z)
    ids2 = [sign.vert((sx + dx, y, z)) for dx, y in ((w / 2, y0), (-w / 2, y0), (-w / 2, y0 + h), (w / 2, y0 + h))]
    sign.quad(*ids2)
    sign.uvq = [(0, 0), (1, 0), (1, 1), (0, 1)] * 2
    sign.flat = True


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    root = bpy.data.objects.new("village_busstop", None)
    bpy.context.collection.objects.link(root)
    spec = {
        "frame": ("stop_frame", "frame"), "roof": ("stop_roof", "roof"), "trim": ("stop_trim", "trim"), "wood": ("stop_wood", "wood"),
        "steel": ("stop_steel", "steel"), "black": ("stop_black", "black"), "concrete": ("pad_side", "concrete"),
        "led": ("stop_led", "led"), "glass": ("stop_glass", "glass"), "map": ("stop_map", "map"), "bis": ("stop_bis", "bis"),
        "sign": ("stop_sign", "sign"), "pad": ("pad_top", "pad"),
    }
    parts = {k: Part(n, MAT[m]) for k, (n, m) in spec.items()}
    build_pad(parts)
    build_shelter(parts)
    build_sign(parts)
    for k, p in parts.items():
        if not p.f:
            continue
        ob = p.to_object(root)
        me = ob.data
        uvq = getattr(p, "uvq", None)
        uvfn = getattr(p, "uvfn", None)
        if uvq or uvfn:
            uv = me.uv_layers.new(name="UVMap")
            for poly in me.polygons:
                for li, vi in zip(poly.loop_indices, poly.vertices):
                    if uvfn:
                        uv.data[li].uv = uvfn(p.v[vi])
                    else:
                        face = p.f[poly.index]
                        uv.data[li].uv = uvq[(poly.index % (len(uvq) // 4)) * 4 + face.index(vi)]
        for poly in me.polygons:
            poly.use_smooth = k in ("steel",)
        if k in ("steel",):
            me.set_sharp_from_angle(angle=math.radians(40))
    return root


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="AUTO",
                              export_cameras=False, export_lights=False)


def preview(dirpath):
    os.makedirs(dirpath, exist_ok=True)
    sc = bpy.context.scene
    try:
        sc.render.engine = "CYCLES"
        sc.cycles.samples = 24
        sc.cycles.device = "CPU"
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 960, 640
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
    bg.inputs["Strength"].default_value = 1.1
    sc.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.0
    so = bpy.data.objects.new("sun", sun)
    bpy.context.collection.objects.link(so)
    so.rotation_euler = (math.radians(55), 0, math.radians(-35))
    bpy.ops.mesh.primitive_plane_add(size=60, location=(CX, -CZ, 0))
    bpy.context.object.data.materials.append(material("ground", srgb("#7d8a6a"), 0.9))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.collection.objects.link(cam)
    sc.camera = cam

    def shot(name, loc, target, lens=35):
        cam.location = (loc[0], -loc[2], loc[1])
        cam.data.lens = lens
        d = Vector((target[0], -target[2], target[1])) - Vector(cam.location)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(dirpath, name)
        bpy.ops.render.render(write_still=True)

    shot("front.png", (35.0, 1.7, -4.9), (41.0, 1.3, -4.9), 30)
    shot("front34.png", (36.0, 2.2, 0.6), (41.0, 1.1, -5.2), 32)
    shot("back34.png", (47.0, 2.4, -9.0), (40.5, 1.2, -4.9), 32)
    shot("top.png", (41.0, 16.0, -5.2), (41.0, 0.0, -5.4), 40)
    shot("sign.png", (40.6, 2.4, 2.6), (40.0, 2.4, -1.8), 40)


if __name__ == "__main__":
    build()
    export(OUT)
    print("exported", OUT)
    if RENDERS:
        preview(RENDERS)
