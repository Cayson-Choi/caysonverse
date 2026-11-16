"""A8 exterior mock-up (design only): house_1 now vs upgraded (B-plan body 11.2 x 8.4 = interior + walls, raised plinth +
2 steps, shingle course lips, box gutters + 2 down pipes per eave, LPG cage + gas pipe, nameplate, for-sale stake).
blender -b --factory-startup -P mock_ext.py -- --tools <art/village/tools> --variant now|up --views front,34,eave --out DIR"""
import math
import os
import sys

import bpy
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]


def arg(n, d=None):
    return a[a.index(n) + 1] if n in a else d


sys.path.insert(0, arg("--tools"))
import vlib as U  # noqa: E402
from vlib import V  # noqa: E402
import build_village as BV  # noqa: E402
import parts_houses as PH  # noqa: E402
import parts_house_extras as PX  # noqa: E402
from parts_houses import lbox, lq, ltube, rgba, WALL_TOP, EAVE, RAKE, TAN_P  # noqa: E402

variant = arg("--variant", "now")
out = arg("--out", ".")
views = arg("--views", "front,34").split(",")
res = arg("--res", "1400x900")
samples = int(arg("--samples", "64"))
LIFT = 0.30
os.makedirs(out, exist_ok=True)


def upgrade(P, F, g, h):
    mb, det = P.main, P.detail
    hx, zb, zf, zc, Db = g.hx, g.zb, g.zf, g.zc, g.Db
    granite = rgba("#B9B6AE")
    xe = hx + RAKE
    ze_off = Db / 2 + EAVE
    y_r_top = g.y_ridge_u + g.vt
    y_e_top = WALL_TOP - EAVE * TAN_P + g.vt
    n = 16
    for s in (-1, 1):
        # shingle course lips: a 1.6 cm step at every course (overlapping tabs, not painted stripes)
        for k in range(1, n + 1):
            t = k / n
            zz = zc + s * ze_off * t
            yy = y_r_top + (y_e_top - y_r_top) * t
            lq(det, F, [(-xe, zz, yy), (xe, zz, yy), (xe, zz, yy + 0.028), (-xe, zz, yy + 0.028)], "LM_roof", rgba("#1E2024"), (0, s, 0.2))
        ze = zc + s * ze_off
        # drip edge on the fascia top
        lbox(det, F, -xe - 0.02, xe + 0.02, min(ze, ze + s * 0.03), max(ze, ze + s * 0.03), y_e_top - 0.06, y_e_top + 0.005,
             "A_metal", None, cell="metal_grey", skip=("bot",))
        # K-style box gutter 0.13 x 0.12 with hangers every 0.6 m
        gz0, gz1 = ze + s * 0.03, ze + s * 0.16
        z0_, z1_ = min(gz0, gz1), max(gz0, gz1)
        gy1 = y_e_top - 0.03
        gy0 = gy1 - 0.12
        lbox(det, F, -xe - 0.05, xe + 0.05, z0_, z1_, gy0, gy1, "A_metal", None, cell="metal_dark")
        x = -xe + 0.1
        while x < xe:
            lbox(det, F, x - 0.012, x + 0.012, z0_, z1_, gy1 - 0.005, gy1 + 0.012, "A_metal", None, cell="metal_grey")
            x += 0.6
        # two down pipes per eave: offset elbow back to the wall, clips, a splash block
        zwall = zc + s * (Db / 2 + 0.06)
        gzc = (gz0 + gz1) / 2
        for px in (-(hx - 0.25), hx - 0.25):
            pts = [(px, gzc, gy0), (px, gzc, gy0 - 0.25), (px, zwall, gy0 - 0.25 - abs(gzc - zwall)), (px, zwall, -LIFT + 0.12)]
            for p0, p1 in zip(pts, pts[1:]):
                ltube(det, F, [p0, p1], 0.045, "A_metal", "metal_dark", segs=4)
            for yy in (1.0, 2.6, 4.2, 5.8, 7.0):
                lbox(det, F, px - 0.055, px + 0.055, min(zwall, zwall - s * 0.06), max(zwall, zwall - s * 0.06), yy, yy + 0.04,
                     "A_metal", None, cell="metal_grey")
            lbox(det, F, px - 0.25, px + 0.25, min(zwall + s * 0.05, zwall + s * 0.65), max(zwall + s * 0.05, zwall + s * 0.65),
                 -LIFT, -LIFT + 0.06, "LM_stone", granite)
    # LPG: two cylinders in a steel cage at the right gable, a yellow gas pipe up to a meter and into the wall
    xs = hx + 0.06
    for zz in (zc - 3.3, zc - 2.75):
        ltube(det, F, [(xs + 0.33, zz, -LIFT + 0.02), (xs + 0.33, zz, -LIFT + 1.25)], 0.18, "A_metal", "steel", segs=10)
        ltube(det, F, [(xs + 0.33, zz, -LIFT + 1.25), (xs + 0.33, zz, -LIFT + 1.40)], 0.07, "A_metal", "steel", segs=6)
    corners = ((xs + 0.08, zc - 3.6), (xs + 0.6, zc - 3.6), (xs + 0.6, zc - 2.45), (xs + 0.08, zc - 2.45))
    for (cx, cz) in corners:
        ltube(det, F, [(cx, cz, -LIFT), (cx, cz, -LIFT + 1.5)], 0.015, "A_metal", "frame_dark", segs=4)
    for yy in (0.3, 1.5):
        for p0, p1 in zip(corners, corners[1:]):
            ltube(det, F, [(p0[0], p0[1], -LIFT + yy), (p1[0], p1[1], -LIFT + yy)], 0.012, "A_metal", "frame_dark", segs=4)
    yel = rgba("#E8B820")
    ltube(det, F, [(xs + 0.33, zc - 3.0, -LIFT + 1.42), (xs + 0.03, zc - 3.0, 1.3), (xs + 0.03, zc - 3.0, 1.6), (xs + 0.03, zc - 2.1, 1.6),
                   (xs + 0.03, zc - 2.1, 2.1)], 0.018, "A_metal", "crane_yellow")
    lbox(det, F, xs, xs + 0.12, zc - 2.25, zc - 1.95, 1.75, 2.05, "LM_render", rgba("#D9D9D4"))
    lbox(det, F, xs, xs + 0.14, zc - 1.75, zc - 1.3, 1.4, 2.0, "LM_render", rgba("#CFCFCB"))
    # nameplate right of the door (stone plate, cream name panel) and a for-sale stake in the right front bed
    lbox(det, F, 1.25, 1.75, zf, zf + 0.03, 1.55, 1.85, "LM_stone", rgba("#3A3A38"))
    lbox(det, F, 1.29, 1.71, zf + 0.03, zf + 0.035, 1.62, 1.78, "LM_render", rgba("#E8E2D2"))
    sx = g.W_fp / 2 - 0.9
    ltube(det, F, [(sx, g.z_edge + 0.5, -LIFT), (sx, g.z_edge + 0.5, -LIFT + 1.2)], 0.03, "A_metal", "plank", segs=4)
    lbox(det, F, sx - 0.45, sx + 0.45, g.z_edge + 0.53, g.z_edge + 0.56, -LIFT + 0.75, -LIFT + 1.3, "LM_render", rgba("#F4F1E8"))
    lbox(det, F, sx - 0.40, sx + 0.40, g.z_edge + 0.56, g.z_edge + 0.565, -LIFT + 1.12, -LIFT + 1.25, "LM_render", rgba("#3E7A54"))
    # side deck on the right gable (c12 style): oak boards at floor level, a skirt, posts and a rail; a step at the front
    oak = rgba("#9C7650")
    dx0, dx1, dz0, dz1 = hx + 0.12, hx + 2.9, zc - 1.0, zf + 0.6
    lbox(mb, F, dx0, dx1, dz0, dz1, -0.05, 0.0, "LM_wood", oak, skip=("bot",))
    zz = dz0
    while zz < dz1 - 0.01:
        lq(det, F, [(dx0, zz, 0.002), (dx1, zz, 0.002), (dx1, zz + 0.012, 0.002), (dx0, zz + 0.012, 0.002)], "LM_wood", rgba("#5E4630"), (0, 0, 1))
        zz += 0.15
    lbox(mb, F, dx0, dx1, dz0, dz1, -LIFT, -0.05, "LM_wood", rgba("#A58763"), skip=("bot", "top"))
    for (px_, pz_) in ((dx1 - 0.05, dz0 + 0.05), (dx1 - 0.05, (dz0 + dz1) / 2), (dx0 + 0.6, dz0 + 0.05)):
        lbox(det, F, px_ - 0.045, px_ + 0.045, pz_ - 0.045, pz_ + 0.045, 0.0, 0.95, "LM_wood", oak)
    lbox(det, F, dx1 - 0.08, dx1, dz0, dz1 - 1.1, 0.88, 0.95, "LM_wood", oak)
    lbox(det, F, dx0, dx1, dz0, dz0 + 0.08, 0.88, 0.95, "LM_wood", oak)
    k = 0
    zz = dz0 + 0.12
    while zz < dz1 - 1.15:
        lbox(det, F, dx1 - 0.06, dx1 - 0.02, zz, zz + 0.04, 0.0, 0.88, "LM_wood", oak); zz += 0.14
    lbox(mb, F, dx1 - 1.0, dx1, dz1, dz1 + 0.34, -LIFT, -0.15, "LM_wood", oak, skip=("bot", "back"))
    # the granite plinth skirt and two porch steps (the whole house stands 0.30 m up)
    pdx = PX.deck_half(g, PH.HOUSE_SPEC[h["id"]])
    lbox(mb, F, -hx - 0.08, hx + 0.08, zb - 0.08, zf, -LIFT, 0.0, "LM_stone", granite, skip=("bot", "top"))
    lbox(mb, F, -hx - 0.08, hx + 0.08, zf, g.z_edge, -LIFT, 0.0, "LM_stone", granite, skip=("bot", "back"))
    sw = min(pdx, 1.6)
    lbox(mb, F, -sw, sw, g.z_edge, g.z_edge + 0.34, -LIFT, -0.15, "LM_stone", granite, skip=("bot", "back"))


if variant == "up":
    _init = PH.Geo.__init__

    def geo_up(self, h):
        _init(self, h)
        self.W_fp, self.Wb, self.Db = 11.2, 11.2, 8.4
        self.D_fp = self.Db + 2.35
        self.hx = self.Wb / 2
        self.zb = -self.D_fp / 2 + 0.10
        self.zf = self.zb + self.Db
        self.zc = (self.zb + self.zf) / 2
        self.z_edge = self.D_fp / 2
        self.y_ridge_u = WALL_TOP + (self.Db / 2) * TAN_P
        self.ridge_top = self.y_ridge_u + self.vt
        self.win_dx = self.hx - 1.40
    PH.Geo.__init__ = geo_up
    _build = PX.build_house

    def build_up(P, FS, PT, h, seed, BV_):
        F, g = _build(P, FS, PT, h, seed, BV_)
        upgrade(P, F, g, h)
        return F, g
    PX.build_house = build_up


def main():
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    root = U.coll("village")
    cols = U.coll("colliders", root)
    BV.setup_light(scene)
    BV.setup_render(scene, samples=samples)
    scene.cycles.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = (int(v) for v in res.split("x"))
    import parts_buildings as PB
    PB.houses(U.coll("houses", root), cols, only=["house_1"])
    if variant == "up":
        for o in bpy.data.objects:
            if o.type in ("MESH", "LIGHT") and not o.name.startswith("col__"):
                o.location.z += LIFT
    mb = U.MB()
    mb.face([V(-120, -120, 0), V(120, -120, 0), V(120, 120, 0), V(-120, 120, 0)], "LM_grass", hint=Vector((0, 0, 1)))
    mb.finish("ground", U.coll("plaza", root))
    h = next(s for s in U.LAYOUT["sceneryHouses"] if s["id"] == "house_1")
    cx, cz = h["centre"]["x"], h["centre"]["z"]
    zf = (10.75 if variant == "up" else 8.4) / 2

    def P(lx, lz, y):
        x, z = U.loc(cx, cz, 0.0, lx, lz)
        return (x, z, y)
    cams = {
        "front": (P(0, zf + 19, 3.4), P(0, 0, 4.6), 30),
        "34": (P(12.5, zf + 13, 3.6), P(0, 0, 4.0), 30),
        "eave": (P(8.6, zf + 4.4, 2.0), P(4.4, zf - 2.6, 5.4), 32),
        "side": (P(17, -1.0, 3.0), P(0, -1.0, 4.0), 32),
    }
    for v in views:
        eye, tgt, lens = cams[v]
        cam = BV.camera(scene, f"cam_{v}", eye, tgt, lens=lens)
        scene.camera = cam
        scene.render.filepath = os.path.join(out, f"house_1_{variant}_{v}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)
    nt = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH"}
    print("TRIS", nt)


main()
