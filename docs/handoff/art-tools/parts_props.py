"""Street furniture: benches, lamps, banner poles, the bus stop and the village bus's stand-in for the bakes."""
import math
import os

from mathutils import Vector

import vlib as U
from vlib import V, MB, loc

L = U.LAYOUT


def aabb_of(cx, cz, yaw, sx, sz):
    c, s = abs(math.cos(yaw)), abs(math.sin(yaw))
    hx = (sx * c + sz * s) / 2
    hz = (sx * s + sz * c) / 2
    return cx - hx, cx + hx, cz - hz, cz + hz


def bench(mb, cx, cz, yaw):
    """Modern park bench: granite end blocks, oiled wood slats, a slatted backrest on dark steel brackets.
    Local +z faces the way the sitter looks."""
    for lx in (-0.78, 0.78):
        x, z = loc(cx, cz, yaw, lx, -0.02)
        mb.box(x, z, 0.0, 0.14, 0.52, 0.40, "LM_stone", yaw=yaw)
    for k in range(5):
        lz = -0.22 + k * 0.11
        x, z = loc(cx, cz, yaw, 0, lz)
        mb.box(x, z, 0.40, 1.86, 0.085, 0.045, "LM_wood", yaw=yaw, tint=U.rgba("#E8C9A6"))
    for k in range(3):
        x, z = loc(cx, cz, yaw, 0, -0.30 - k * 0.012)
        mb.box(x, z, 0.56 + k * 0.12, 1.86, 0.04, 0.085, "LM_wood", yaw=yaw, tint=U.rgba("#E8C9A6"))
    mb.cell = "metal_dark"
    for lx in (-0.6, 0.6):
        x, z = loc(cx, cz, yaw, lx, -0.31)
        mb.box(x, z, 0.40, 0.05, 0.05, 0.50, "A_metal", yaw=yaw)
    mb.cell = None


def benches(c, cols):
    mb = MB()
    for i, b in enumerate(L["plaza"]["benches"]):
        bench(mb, b["x"], b["z"], b["yaw"])
        x0, x1, z0, z1 = aabb_of(b["x"], b["z"], b["yaw"], 1.9, 0.66)
        U.collider(cols, f"col__bench_{i + 1}", round(x0, 2), round(x1, 2), round(z0, 2), round(z1, 2), 1.0)
    return mb.finish("benches", c)


def lamp(mb, glow, x, z, h=4.4):
    mb.cell = "metal_dark"
    mb.lathe(x, z, [(0.17, 0.0), (0.17, 0.35), (0.12, 0.42), (0.065, 0.48), (0.06, h - 0.55), (0.09, h - 0.5),
                    (0.09, h - 0.42), (0.05, h - 0.4)], "A_metal", segs=10)
    # lantern: cap, frame posts, glass (emissive)
    top = h - 0.42
    mb.lathe(x, z, [(0.0, top + 0.62), (0.08, top + 0.6), (0.26, top + 0.48), (0.23, top + 0.44), (0.0, top + 0.44)],
             "A_metal", segs=8, smooth=False)
    mb.lathe(x, z, [(0.12, top), (0.2, top + 0.05), (0.0, top + 0.05)], "A_metal", segs=8, smooth=False)
    mb.cell = None
    rings = glow.lathe(x, z, [(0.15, top + 0.05), (0.20, top + 0.44)], "M_lamp", segs=8, smooth=False,
                       uv_mode=(1.0, 1.0))
    U.light("lamp", V(x, z, top + 0.25))


def lamp_positions():
    pts = [(p["x"], p["z"]) for p in L["plaza"]["lamps"]]
    # ring road lamps on the outer sidewalk (r 38.4), skipping lane crossings and the bus stop
    lane_angles = []
    for lane in L["lanes"]:
        a = lane["points"][0]
        lane_angles.append(math.atan2(a["z"], a["x"]))
        if len(lane["points"]) > 1:
            b = lane["points"][1]
            lane_angles.append(math.atan2(b["z"], b["x"]))
    for k in range(18):
        a = 2 * math.pi * (k + 0.5) / 18
        if any(abs(math.atan2(math.sin(a - la), math.cos(a - la))) < math.radians(7) for la in lane_angles):
            continue
        x, z = 38.4 * math.cos(a), 38.4 * math.sin(a)
        if abs(x - 38) < 3 and -11 < z < -1:
            continue
        pts.append((x, z))
    return pts


def lamps(c):
    mb = MB()
    glow = MB()
    for (x, z) in lamp_positions():
        lamp(mb, glow, x, z)
    ob = glow.finish("lamp_glass", c, cat="lamp", auto=False)
    me = ob.data
    uvl = me.uv_layers["UVMap"].data
    for p in me.polygons:
        for li in p.loop_indices:
            u, v = uvl[li].uv
            uvl[li].uv = U.glow_uv("lamp", min(1, max(0, u)), min(1, max(0, v / 0.4)))
    return mb.finish("lamps", c)


def banners(c):
    """Tall banner poles (6.6 m) with vertical fabric banners, around the paving at r 26."""
    mb = MB()
    angs = [-100, -80, -50, -20, 30, 55, 125, 150]
    for i, deg in enumerate(angs):
        a = math.radians(deg)
        x, z = 26.0 * math.cos(a), 26.0 * math.sin(a)
        yaw = math.atan2(-x, -z)
        mb.cell = "metal_dark"
        mb.lathe(x, z, [(0.12, 0), (0.12, 0.25), (0.05, 0.3), (0.045, 6.6), (0.06, 6.62), (0.0, 6.7)], "A_metal",
                 segs=8)
        for hy in (6.25, 4.15):
            ax, az = loc(x, z, yaw, 0.38, 0)
            mb.box(ax, az, hy, 0.72, 0.03, 0.03, "A_metal", yaw=yaw)
        mb.cell = None
        region = "banner_a" if i % 2 == 0 else "banner_b"
        p = [loc(x, z, yaw, 0.06, 0), loc(x, z, yaw, 0.70, 0)]
        for side in (1, -1):
            off = 0.012 * side
            a0 = loc(x, z, yaw, 0.06, off)
            a1 = loc(x, z, yaw, 0.70, off)
            pts = [V(a0[0], a0[1], 4.15), V(a1[0], a1[1], 4.15), V(a1[0], a1[1], 6.25), V(a0[0], a0[1], 6.25)]
            uvs = [U.region_uv(region, 0, 0), U.region_uv(region, 1, 0), U.region_uv(region, 1, 1),
                   U.region_uv(region, 0, 1)]
            fz = V(math.sin(yaw) * side, math.cos(yaw) * side) - V(0, 0)
            mb.face(pts, "A_paint", uvs, hint=fz)
    return mb.finish("banners", c)


# ------------------------------------------------------------------------------------------- bus stop --

def bus_stop(c, cols):
    """The bus stop's bakes. XWALK FIX 2026-11-13: the box shelter, bench and sign pole that were built here are gone: the stop
    (a paved waiting pad, a Korean-style glass shelter at its back, the stop sign) is its own lit model now,
    export/village_busstop.glb from build_busstop.py, placed by the game as it is (client BusStopShelter.tsx). So the
    village bake no longer holds a shelter; what stays is the bus's shade (bus_occluder) and the bus's collider.
    (The shipped village.glb had the old shelter taken out in place by scripts/patch-village-busstop.mjs; its light
    maps still hold the old shelter's shadow until the next bake.)"""
    bus_occluder(c)
    bb = L["busStop"]["bus"]["bounds"]
    # 3.3 m: the roof's air conditioner (village_bus.glb tops out at 3.28)
    U.collider(cols, L["busStop"]["bus"]["node"], bb["minX"], bb["maxX"], bb["minZ"], bb["maxZ"], 3.3)


def bus_occluder(c):
    """The village bus (마을버스) is its own live-lit model since 2026-11-11: village_bus.glb, built by build_bus.py (a 9 m
    low-floor midibus) and placed by the game at busStop.bus, nose north, doors east. The crude box bus that was
    built here is gone. The bus only stands in the bakes: imported from export/village_bus.glb at the layout's spot,
    cat "occluder" (it shades the road and the shelter in the day and night light maps and occludes the foliage's
    vertex light; never light-mapped, never exported: bake_village.py). Its ground quad (M_bus_ground: the contact
    shadow, the sun's shadow and the night's light pools the game draws on the road, 5 cm up) is taken out: in the bake it would be a
    15 x 21.5 m sheet over the road, shading it all (bus review r3)."""
    import bmesh
    import bpy
    b = L["busStop"]["bus"]
    path = os.path.join(U.ROOT, "export", "village_bus.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for coll in list(o.users_collection):
            coll.objects.unlink(o)
        c.objects.link(o)
        if o.parent is None:
            o.location = V(b["centre"]["x"], b["centre"]["z"])
        o["cat"] = "occluder"
        if o.type == "MESH":
            slots = {i for i, m in enumerate(o.data.materials) if m and m.name.startswith("M_bus_ground")}
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in slots], context="FACES")
            bm.to_mesh(o.data)
            bm.free()
            o.data.update()
    return new


# ------------------------------------------------------------------------------------------ plaza details --

def plaza_details(c, cols):
    """A few more things on the plaza, at r 24.5 so the 30 m gathering space inside stays open: four square granite
    planters with a clipped shrub ball and flowers. (The two coffee / flower carts under striped umbrellas that stood at
    r 26.5 were taken out on 2026-11-10 at the owner's request, with their colliders col__plaza_cart_1/2.)"""
    import parts_trees as PT
    mb = MB()
    fl = MB()
    FS = PT.Forest()
    for i, deg in enumerate((-135, -65, 75, 140)):
        a = math.radians(deg)
        x, z = 24.5 * math.cos(a), 24.5 * math.sin(a)
        s = 2.2
        mb.box(x, z, 0.0, s, s, 0.5, "LM_stone")
        mb.cell = "soil"
        mb.box(x, z, 0.5, s - 0.3, s - 0.3, 0.02, "A_paint")
        mb.cell = None
        PT.shrub(FS, x, z, 1.1, 0.75, 1500 + i, y0=0.5)
        PT.flower_patch(fl, lambda px, pz, x=x, z=z: max(abs(px - x), abs(pz - z)) < s / 2 - 0.2 and
                        math.hypot(px - x, pz - z) > 0.55, (x - s / 2, x + s / 2, z - s / 2, z + s / 2), 0.52, 10.0,
                        [0, 1, 2], 1600 + i, h=(0.25, 0.4))
        U.collider(cols, f"col__plaza_planter_{i + 1}", round(x - 1.15, 2), round(x + 1.15, 2), round(z - 1.15, 2),
                   round(z + 1.15, 2), 0.6)
    mb.finish("plaza_details", c)
    fl.finish("plaza_details_flowers", c, cat="leaf", auto=False)
    FS.finish("plaza_details_shrubs", c)
