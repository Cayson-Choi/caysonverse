"""Lake vegetation (art chunk A): reeds (갈대), cattails (부들), grass tufts and daisies, shore willows (버드나무), bushes and the
backdrop trees of the hills. Everything on the walkable side is real geometry (stalks with thickness, curved blades; no flat
cards), GPU-instanced like the village's trees: a variant mesh built once at the origin, placed many times.

Tiers (design 10): instance roots named `inst__lakehi_*` are drawn only on the PC tier; `inst__lake_*` always. Colours are
vertex colours ('Col', albedo at build time, lit by bake_lake.py); `_sway` is the wind weight (0 at the root to 1 at the tip).
Nothing tall grows on ground a player can reach (bank band s <= 0.7 m, hills past the walk limit): vegetation here has no
collider, so the walkable ground only gets knee-high grass and daisies.
"""
import math
import random

import bpy
import numpy as np
from mathutils import Vector

import lake_geo as G
import vlib as U
from vlib import V, MB

LAY = G.LAY


# ------------------------------------------------------------------------------------------------ materials

def plant_material():
    """M_plant: base colour = the vertex colour 'Col' (albedo here, lit light in the export), double sided."""
    if "M_plant" in bpy.data.materials:
        return
    m = bpy.data.materials.new("M_plant")
    m["export"] = "M_plant"
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Roughness"].default_value = 0.65
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    nt.links.new(ca.outputs["Color"], tr.inputs["Color"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = 0.35
    nt.links.new(b.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = False
    U._MATS["M_plant"] = m


def hexc(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mixc(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


# ---------------------------------------------------------------------------------------------- geometry

class Plant:
    """A bmesh in game coordinates around the origin with per-loop albedo ('Col') and a per-vertex sway weight."""

    def __init__(self):
        self.mb = MB()
        self.sway = self.mb.bm.verts.layers.float.new("_sway")

    def quad(self, pts, cols, sways):
        """pts: [(x, z, y)] game; cols: albedo per corner (linear rgb); sways per corner."""
        f = self.mb.face([V(*p) for p in pts], "M_plant", None)
        if f is None:
            return None
        for lp, c, sw in zip(f.loops, cols, sways):
            lp[self.mb.col] = U._to_layer((c[0], c[1], c[2], 1.0))
            lp.vert[self.sway] = sw
        return f

    def ribbon(self, path, widths, c0, c1, sway0, sway1, side=(1.0, 0.0)):
        """A blade: path = [(x, z, y)], widths per point (last one 0 = a pointed tip), colour/sway interpolated."""
        n = len(path)
        sx, sz = side
        for i in range(n - 1):
            t0, t1 = i / (n - 1), (i + 1) / (n - 1)
            a, b = path[i], path[i + 1]
            w0, w1 = widths[i] / 2, widths[i + 1] / 2
            pa = (a[0] - sx * w0, a[1] - sz * w0, a[2])
            pb = (a[0] + sx * w0, a[1] + sz * w0, a[2])
            pc = (b[0] + sx * w1, b[1] + sz * w1, b[2])
            pd = (b[0] - sx * w1, b[1] - sz * w1, b[2])
            ca, cb = mixc(c0, c1, t0), mixc(c0, c1, t1)
            sa, sb = sway0 + (sway1 - sway0) * t0, sway0 + (sway1 - sway0) * t1
            if widths[i + 1] <= 1e-6:
                self.quad([pa, pb, pc], [ca, ca, cb], [sa, sa, sb])
            else:
                self.quad([pa, pb, pc, pd], [ca, ca, cb, cb], [sa, sa, sb, sb])

    def tube(self, path, radii, c0, c1, sway0, sway1, sides=3, cap_top=False):
        n = len(path)
        rings = []
        for i, p in enumerate(path):
            a = Vector(path[max(i - 1, 0)])
            b = Vector(path[min(i + 1, n - 1)])
            t = (b - a)
            t.normalize()
            ref = Vector((1, 0, 0)) if abs(t.y) > 0.9 else Vector((0, 1, 0))
            u = t.cross(ref)
            u.normalize()
            v = t.cross(u)
            ring = []
            for k in range(sides):
                an = 2 * math.pi * k / sides + 0.5
                q = Vector(p) + (u * math.cos(an) + v * math.sin(an)) * radii[i]
                ring.append((q.x, q.y, q.z))
            rings.append(ring)
        for i in range(n - 1):
            t0, t1 = i / (n - 1), (i + 1) / (n - 1)
            ca, cb = mixc(c0, c1, t0), mixc(c0, c1, t1)
            sa, sb = sway0 + (sway1 - sway0) * t0, sway0 + (sway1 - sway0) * t1
            for k in range(sides):
                k2 = (k + 1) % sides
                if radii[i + 1] <= 1e-6:
                    self.quad([rings[i][k], rings[i][k2], path[i + 1]], [ca, ca, cb], [sa, sa, sb])
                else:
                    self.quad([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], [ca, ca, cb, cb],
                              [sa, sa, sb, sb])
        if cap_top:
            self.quad(rings[-1], [c1] * sides, [sway1] * sides)

    def finish(self, name, coll):
        return self.mb.finish(name, coll, cat="leaf", auto=False)


def arch(base, h, az, lean, bend, n=3):
    """Stalk centreline from base (x, z, y), height h, leaning towards azimuth az by `lean` (rad), bending more at the top."""
    out = []
    for i in range(n):
        t = i / (n - 1)
        ang = lean + bend * t * t
        r = h * t
        out.append((base[0] + math.cos(az) * math.sin(ang) * r, base[1] + math.sin(az) * math.sin(ang) * r,
                    base[2] + math.cos(ang) * r))
    return out


# ------------------------------------------------------------------------------------------ plant variants

C = {
    "reed_base": hexc("#6d7c33"), "reed_mid": hexc("#a7a24f"), "reed_dry": hexc("#c7b070"), "plume": hexc("#6e5e4b"),
    "plume_hi": hexc("#8c7b64"), "leaf_g": hexc("#6f8a35"), "leaf_y": hexc("#a39a4e"),
    "cat_leaf": hexc("#5f7f2e"), "cat_tip": hexc("#9a9248"), "cat_spike": hexc("#4a2e18"), "cat_stem": hexc("#7d8c3d"),
    "grass_b": hexc("#4f7226"), "grass_t": hexc("#9fae52"), "grass_d": hexc("#a58f4c"),
    "daisy": hexc("#f4f1e7"), "daisy_c": hexc("#e8b51f"), "stem": hexc("#5b7a2f"),
}


def reed_clump(seed, stalks=8, spread=0.34):
    """About 27 triangles a stalk: a 3-sided stalk of two bent segments, two drooping leaf blades, a plume. Real
    thickness (stalk 1.2 -> 0.6 cm, blades 4-5 cm wide), 1.4-2.3 m."""
    rng = random.Random(seed)
    P = Plant()
    for i in range(stalks):
        a = rng.uniform(0, 2 * math.pi)
        r = spread * math.sqrt(rng.random())
        bx, bz = math.cos(a) * r, math.sin(a) * r
        h = rng.uniform(1.4, 2.3) * (0.8 + 0.2 * (1 - r / spread))
        az = rng.uniform(0, 2 * math.pi)
        lean = rng.uniform(0.02, 0.16)
        bend = rng.uniform(0.15, 0.55)
        path = arch((bx, bz, 0.0), h, az, lean, bend, n=3)
        cols_top = mixc(C["reed_mid"], C["reed_dry"], rng.random())
        P.tube(path, [0.0115, 0.009, 0.0055], C["reed_base"], cols_top, 0.05, 0.85, sides=3)
        for j, t in enumerate((rng.uniform(0.4, 0.6),)):
            idx = 1 if t < 0.6 else 2
            q0 = Vector(path[idx - 1]).lerp(Vector(path[idx]), 0.5 if idx == 1 else 0.8)
            la = az + rng.uniform(-1.6, 1.6) + (math.pi if j else 0)
            L_ = rng.uniform(0.55, 0.95)
            lp = []
            for k in range(4):
                u = k / 3
                up = max(0.0, 0.6 * math.sin(u * 2.0)) * L_ * 0.55
                lp.append((q0.x + math.cos(la) * L_ * u, q0.y + math.sin(la) * L_ * u, q0.z + up - L_ * 0.5 * u * u))
            side = (-math.sin(la), math.cos(la))
            P.ribbon(lp, [0.02, 0.04, 0.032, 0.0], mixc(C["leaf_g"], C["reed_mid"], 0.1), mixc(C["leaf_y"], C["reed_mid"], 0.25),
                     0.25 + 0.2 * t, 0.95, side=side)
        top = Vector(path[-1])
        dirv = (top - Vector(path[-2])).normalized()
        L_ = rng.uniform(0.16, 0.26)
        ppath = [(top.x, top.y, top.z), (top.x + dirv.x * L_ * 0.5, top.y + dirv.y * L_ * 0.5, top.z + dirv.z * L_ * 0.5),
                 (top.x + dirv.x * L_ + math.cos(az) * 0.06, top.y + dirv.y * L_ + math.sin(az) * 0.06, top.z + dirv.z * L_)]
        P.tube(ppath, [0.003, 0.013, 0.0], C["plume"], C["plume_hi"], 0.9, 1.0, sides=3)
    return P


def cattail_clump(seed, plants=3, spread=0.25):
    rng = random.Random(seed)
    P = Plant()
    for i in range(plants):
        a = rng.uniform(0, 2 * math.pi)
        r = spread * math.sqrt(rng.random())
        bx, bz = math.cos(a) * r, math.sin(a) * r
        h = rng.uniform(1.5, 2.2)
        az = rng.uniform(0, 2 * math.pi)
        path = arch((bx, bz, 0.0), h, az, rng.uniform(0.0, 0.07), rng.uniform(0.0, 0.2), n=3)
        P.tube(path, [0.011, 0.009, 0.006], C["cat_stem"], C["cat_stem"], 0.05, 0.8, sides=3)
        t0 = Vector(path[1]).lerp(Vector(path[2]), 0.25)
        d = (Vector(path[2]) - Vector(path[1])).normalized()
        Ls = rng.uniform(0.18, 0.26)
        sp = [(t0.x, t0.y, t0.z), (t0.x + d.x * Ls * 0.5, t0.y + d.y * Ls * 0.5, t0.z + d.z * Ls * 0.5),
              (t0.x + d.x * Ls, t0.y + d.y * Ls, t0.z + d.z * Ls)]
        P.tube(sp, [0.019, 0.023, 0.016], C["cat_spike"], mixc(C["cat_spike"], hexc("#6b4524"), 0.5), 0.8, 0.9, sides=6, cap_top=True)
        for j in range(4):
            la = az + j * math.pi / 2 + rng.uniform(-0.5, 0.5)
            L_ = rng.uniform(1.2, 1.75)
            lp = []
            tw = rng.uniform(-0.5, 0.5)
            for k in range(5):
                u = k / 4
                lp.append((bx + math.cos(la) * (0.25 * u + 0.35 * u * u) * L_ * 0.55, bz + math.sin(la) * (0.25 * u + 0.35 * u * u) * L_ * 0.55,
                           L_ * u * (1.0 - 0.18 * u)))
            side = (-math.sin(la + tw * 0.4), math.cos(la + tw * 0.4))
            P.ribbon(lp, [0.04, 0.05, 0.048, 0.034, 0.0], C["cat_leaf"], C["cat_tip"], 0.05, 0.95, side=side)
    return P


def grass_tuft(seed, blades=13, rad=0.14, hmin=0.22, hmax=0.5):
    rng = random.Random(seed)
    P = Plant()
    for i in range(blades):
        a = rng.uniform(0, 2 * math.pi)
        r = rad * math.sqrt(rng.random())
        bx, bz = math.cos(a) * r, math.sin(a) * r
        h = rng.uniform(hmin, hmax) * (1.0 - 0.35 * r / rad)
        az = a + rng.uniform(-0.6, 0.6)
        out = rng.uniform(0.25, 0.9) * h
        path = [(bx, bz, 0.0), (bx + math.cos(az) * out * 0.35, bz + math.sin(az) * out * 0.35, h * 0.6),
                (bx + math.cos(az) * out, bz + math.sin(az) * out, h * 0.95 - out * 0.15)]
        side = (-math.sin(az), math.cos(az))
        c1 = mixc(C["grass_t"], C["grass_d"], rng.random() * 0.5)
        P.ribbon(path, [0.022, 0.017, 0.0], C["grass_b"], c1, 0.05, 1.0, side=side)
    return P


def daisy_patch(seed, n=4, rad=0.3):
    rng = random.Random(seed)
    P = Plant()
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi)
        r = rad * math.sqrt(rng.random())
        bx, bz = math.cos(a) * r, math.sin(a) * r
        h = rng.uniform(0.22, 0.42)
        az = rng.uniform(0, 6.28)
        path = arch((bx, bz, 0.0), h, az, rng.uniform(0.05, 0.25), 0.2, n=2)
        P.tube(path, [0.004, 0.003], C["stem"], C["stem"], 0.1, 0.9, sides=3)
        top = path[-1]
        for j in range(2):
            la = rng.uniform(0, 6.28)
            lp = [(bx, bz, 0.02), (bx + math.cos(la) * 0.06, bz + math.sin(la) * 0.06, 0.07), (bx + math.cos(la) * 0.1, bz + math.sin(la) * 0.1, 0.06)]
            P.ribbon(lp, [0.02, 0.026, 0.0], C["grass_b"], C["leaf_g"], 0.1, 0.4, side=(-math.sin(la), math.cos(la)))
        tilt = rng.uniform(0.2, 0.8)
        for k in range(8):
            an = 2 * math.pi * k / 8
            tip = (top[0] + math.cos(an) * 0.032, top[1] + math.sin(an) * 0.032, top[2] + 0.004 + math.sin(an) * 0.01 * tilt)
            l = (top[0] + math.cos(an - 0.3) * 0.008, top[1] + math.sin(an - 0.3) * 0.008, top[2] + 0.003)
            rr = (top[0] + math.cos(an + 0.3) * 0.008, top[1] + math.sin(an + 0.3) * 0.008, top[2] + 0.003)
            P.quad([l, rr, tip], [C["daisy"]] * 3, [1.0] * 3)
        P.quad([(top[0] + 0.009 * math.cos(2 * math.pi * k / 6), top[1] + 0.009 * math.sin(2 * math.pi * k / 6), top[2] + 0.006) for k in range(6)],
               [C["daisy_c"]] * 6, [1.0] * 6)
    return P


# ---------------------------------------------------------------------------------------------- placement

def keepout():
    """Boxes vegetation stays out of: decks, the office, huts, props, benches, picnic tables, the pavilion."""
    boxes = []
    for d in LAY["decks"]:
        boxes.append((d["minX"] - 1.0, d["maxX"] + 1.0, d["minZ"] - 1.0, d["maxZ"] + 1.0))
    s = LAY["shop"]
    boxes.append((s["minX"] - 2.0, s["maxX"] + 2.0, s["minZ"] - 2.0, s["maxZ"] + 8.0))
    for h in LAY["huts"]:
        boxes.append((h["minX"] - 1.0, h["maxX"] + 1.0, h["minZ"] - 1.0, h["maxZ"] + 1.0))
    for p in LAY["props"]:
        boxes.append((p["minX"] - 1.0, p["maxX"] + 1.0, p["minZ"] - 1.0, p["maxZ"] + 1.0))
    for b in LAY["benches"]:
        boxes.append((b["x"] - 1.4, b["x"] + 1.4, b["z"] - 1.4, b["z"] + 1.4))
    for t in LAY["picnicTables"]:
        boxes.append((t["x"] - 2.2, t["x"] + 2.2, t["z"] - 2.2, t["z"] + 2.2))
    pv = LAY["pavilion"]["bounds"]
    boxes.append((pv["minX"] - 1.5, pv["maxX"] + 1.5, pv["minZ"] - 1.5, pv["maxZ"] + 1.5))
    return boxes


KEEP = None


def allowed(x, z, margin=0.0, spots=True):
    global KEEP
    if KEEP is None:
        KEEP = keepout()
    for a, b, c, d in KEEP:
        if a - margin < x < b + margin and c - margin < z < d + margin:
            return False
    if spots:
        for sp in LAY["spots"]:
            ax, az = sp["anchor"]["x"], sp["anchor"]["z"]
            fx, fz = sp["float"]["x"], sp["float"]["z"]
            if math.hypot(x - ax, z - az) < 2.2 + margin:
                return False
            dx, dz = fx - ax, fz - az
            t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
            if math.hypot(x - ax - t * dx, z - az - t * dz) < 1.6 + margin:
                return False
            if math.hypot(x - fx, z - fz) < 3.2 + margin:
                return False
    return True


def trail_min_dist(x, z):
    pts = [(p["x"], p["z"]) for p in LAY["trail"]["points"]]
    best = 1e9
    for (ax, az), (bx, bz) in zip(pts[:-1], pts[1:]):
        dx, dz = bx - ax, bz - az
        t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
        best = min(best, math.hypot(x - ax - t * dx, z - az - t * dz))
    return best


def poisson(rng, x0, x1, z0, z1, spacing, ok, tries=30000):
    """Dart throwing: points at least `spacing` apart inside the box where ok(x, z)."""
    pts = []
    cell = spacing / math.sqrt(2)
    grid = {}
    for _ in range(tries):
        x, z = rng.uniform(x0, x1), rng.uniform(z0, z1)
        if not ok(x, z):
            continue
        gx, gz = int(x / cell), int(z / cell)
        good = True
        for i in range(gx - 2, gx + 3):
            for j in range(gz - 2, gz + 3):
                q = grid.get((i, j))
                if q and (q[0] - x) ** 2 + (q[1] - z) ** 2 < spacing ** 2:
                    good = False
                    break
            if not good:
                break
        if good:
            grid[(gx, gz)] = (x, z)
            pts.append((x, z))
    return pts


def sfield(xs, zs):
    return G.Raster.s(np.asarray(xs, float), np.asarray(zs, float))


def walkable_pts(xs, zs, s):
    return G.Raster.inwalk(np.asarray(xs, float), np.asarray(zs, float)) & (np.asarray(s) >= 0.8)


def shore_normal(i):
    sh = G.SHORE
    a, b = sh[(i - 1) % len(sh)], sh[(i + 1) % len(sh)]
    tx, tz = b[0] - a[0], b[1] - a[1]
    L_ = math.hypot(tx, tz)
    nx, nz = tz / L_, -tx / L_
    x, z = sh[i]
    if G.inside_closed(np.array([x + nx]), np.array([z + nz]), G.SHORE)[0]:
        nx, nz = -nx, -nz
    return nx, nz


# --------------------------------------------------------------------------------------------------- build

def build(coll, hfn):
    import parts_fill as PF
    import parts_trees as PT
    plant_material()
    src = U.coll("variants_src", coll)
    inst = U.coll("instances", coll)
    rng = random.Random(2026)
    H = lambda xs, zs: G.height(np.asarray(xs, float), np.asarray(zs, float))
    report = {}

    def variant_plant(name, builder):
        if name in PF._VARIANTS:
            return PF._VARIANTS[name]
        P = builder()
        ob = P.finish("var_" + name, src)
        me = ob.data
        bpy.data.objects.remove(ob)
        PF._VARIANTS[name] = [(me, "plant")]
        return PF._VARIANTS[name]

    def inst_tf(pts, scale=(0.85, 1.2)):
        if not pts:
            return []
        hs = H([p[0] for p in pts], [p[1] for p in pts])
        return [(x, z, float(h), rng.uniform(0, 6.2832), rng.uniform(*scale)) for (x, z), h in zip(pts, hs)]

    def split_tiers(tf, lo_share):
        lo, hi = [], []
        for i, t in enumerate(tf):
            (lo if (i * 0.6180339887) % 1.0 < lo_share else hi).append(t)
        return lo, hi

    # ---------------------------------------------------------------- reeds and cattails
    reed_v = [variant_plant(f"reed_{k}", lambda k=k: reed_clump(100 + k, stalks=6 + (k % 2))) for k in range(4)]
    cat_v = [variant_plant(f"cattail_{k}", lambda k=k: cattail_clump(200 + k, plants=3)) for k in range(3)]
    reeds, cats = [], []
    for bed in LAY["reeds"]:
        cx, cz, r = bed["centre"]["x"], bed["centre"]["z"], bed["radius"]
        cand = poisson(rng, cx - r * 1.2, cx + r * 1.2, cz - r * 1.2, cz + r * 1.2, 0.56,
                       lambda x, z, cx=cx, cz=cz, r=r: math.hypot(x - cx, z - cz) <= r * 1.15)
        if not cand:
            continue
        s = sfield([c[0] for c in cand], [c[1] for c in cand])
        for (x, z), si in zip(cand, s):
            patch = float(G.vnoise(np.array([x * 0.9]), np.array([z * 0.9]), 4.0)[0])
            if not (-1.7 < si < 0.6) or patch < -0.6 or not allowed(x, z):
                continue
            (cats if (rng.random() < 0.16 and si > -0.9) else reeds).append((x, z))
    for k in range(7):
        i = rng.randrange(len(G.SHORE))
        x, z = G.SHORE[i]
        if allowed(x, z, margin=1.0) and not walkable_pts([x], [z], sfield([x], [z]))[0]:
            cats.append((x + rng.uniform(-0.4, 0.4), z + rng.uniform(-0.4, 0.4)))
    tfr = inst_tf(reeds, scale=(0.85, 1.25))
    tfc = inst_tf(cats, scale=(0.9, 1.2))
    report["reed_clumps"] = len(tfr)
    report["cattail_clumps"] = len(tfc)
    for kk, meshes in enumerate(reed_v):
        sub = [t for i, t in enumerate(tfr) if i % len(reed_v) == kk]
        lo, hi = split_tiers(sub, 0.32)
        PF.place(inst, f"lake_reed_{kk}", meshes, lo)
        PF.place(inst, f"lakehi_reed_{kk}", meshes, hi)
    for kk, meshes in enumerate(cat_v):
        sub = [t for i, t in enumerate(tfc) if i % len(cat_v) == kk]
        lo, hi = split_tiers(sub, 0.5)
        PF.place(inst, f"lake_cattail_{kk}", meshes, lo)
        PF.place(inst, f"lakehi_cattail_{kk}", meshes, hi)

    # ---------------------------------------------------------------- grass tufts and daisies
    grass_v = [variant_plant(f"grass_{k}", lambda k=k: grass_tuft(300 + k, blades=8 + k, hmax=0.42 + 0.06 * k)) for k in range(4)]
    tall_v = [variant_plant(f"grasstall_{k}", lambda k=k: grass_tuft(320 + k, blades=14, rad=0.2, hmin=0.45, hmax=0.9)) for k in range(2)]
    daisy_v = [variant_plant(f"daisy_{k}", lambda k=k: daisy_patch(340 + k, n=3)) for k in range(2)]
    cand = poisson(rng, 96.0, 189.0, -69.0, 48.0, 0.85, lambda x, z: True, tries=200000)
    xs = np.array([c[0] for c in cand])
    zs = np.array([c[1] for c in cand])
    s = sfield(xs, zs)
    inw = G.Raster.inwalk(xs, zs)
    grass, tall, daisies = [], [], []
    for (x, z), si, iw in zip(cand, s, inw):
        if si < 0.55 or not allowed(x, z, margin=0.3, spots=False):
            continue
        if trail_min_dist(x, z) < LAY["trail"]["width"] / 2 + 0.2:
            continue
        near = math.exp(-max(0.0, si - 0.8) / 2.6)
        pn = 0.14 + 0.62 * near
        pn *= 0.55 + 0.45 * (G.vnoise(np.array([x * 0.6]), np.array([z * 0.6]), 9.0)[0] + 1) / 2
        if rng.random() > pn:
            continue
        walk = bool(iw and si >= 0.8)
        if near > 0.45 and not walk and rng.random() < 0.55:
            tall.append((x, z))
        else:
            grass.append((x, z))
        if rng.random() < 0.1:
            daisies.append((x + rng.uniform(-0.4, 0.4), z + rng.uniform(-0.4, 0.4)))
    tfg = inst_tf(grass, scale=(0.8, 1.3))
    tft = inst_tf(tall, scale=(0.8, 1.2))
    tfd = inst_tf([d for d in daisies if allowed(d[0], d[1], 0.2, spots=False)], scale=(0.9, 1.3))
    report.update(grass=len(tfg), tall_grass=len(tft), daisies=len(tfd))
    for kk, meshes in enumerate(grass_v):
        sub = [t for i, t in enumerate(tfg) if i % len(grass_v) == kk]
        lo, hi = split_tiers(sub, 0.3)
        PF.place(inst, f"lake_grass_{kk}", meshes, lo)
        PF.place(inst, f"lakehi_grass_{kk}", meshes, hi)
    for kk, meshes in enumerate(tall_v):
        sub = [t for i, t in enumerate(tft) if i % len(tall_v) == kk]
        lo, hi = split_tiers(sub, 0.4)
        PF.place(inst, f"lake_grasstall_{kk}", meshes, lo)
        PF.place(inst, f"lakehi_grasstall_{kk}", meshes, hi)
    for kk, meshes in enumerate(daisy_v):
        sub = [t for i, t in enumerate(tfd) if i % len(daisy_v) == kk]
        PF.place(inst, f"lakehi_daisy_{kk}", meshes, sub)

    # ---------------------------------------------------------------- willows, bushes, hill trees (not on walkable ground)
    willow_v = [PF.variant(f"lake_willow_{k}", src, lambda F, k=k: PT.tree(F, 0, 0, "willow", 8.5 + k * 1.2, 4.2 + k * 0.4, 70 + k, trunk_r=0.22)) for k in range(3)]
    shrub_v = [PF.variant(f"lake_shrub_{k}", src, lambda F, k=k: PT.shrub(F, 0, 0, 0.95 + 0.2 * k, 0.65 + 0.1 * k, 90 + k)) for k in range(2)]
    near_v = [PF.variant(f"lake_tree_{k}", src, lambda F, k=k: PT.tree(F, 0, 0, "green", 6.6 + k * 0.9, 2.5 + 0.3 * k, 110 + k, trunk_r=0.13)) for k in range(3)]
    far_v = [PF.variant(f"lake_far_{k}", src, lambda F, k=k: PT.far_tree(F, 0, 0, 0, 1.0, 130 + k)) for k in range(3)]

    def land_ok(x, z, min_e=0.5, min_s=1.6):
        s_ = float(sfield([x], [z])[0])
        if s_ < min_s:
            return False
        if G.Raster.inwalk(x, z):
            return False
        return float(G.Raster.dwo(x, z)) >= min_e
    willows = []
    for i in range(len(G.SHORE)):
        x, z = G.SHORE[i]
        if x < 118 or rng.random() > 0.2:
            continue
        nx, nz = shore_normal(i)
        d = rng.uniform(2.6, 4.0)
        px, pz = x + nx * d, z + nz * d
        if land_ok(px, pz, 0.5, 2.0) and all(math.hypot(px - w[0], pz - w[1]) > 7.5 for w in willows):
            willows.append((px, pz))
    willows = willows[:10]
    hw = H([w[0] for w in willows], [w[1] for w in willows]) if willows else []
    for kk, meshes in enumerate(willow_v):
        tf = [(x, z, float(h) - 0.05, rng.uniform(0, 6.28), rng.uniform(0.9, 1.15)) for i, ((x, z), h) in enumerate(zip(willows, hw)) if i % 3 == kk]
        PF.place(inst, f"lake_willow_{kk}", meshes, tf)
    report["willows"] = len(willows)
    bushes = []
    for i in range(0, len(G.SHORE), 3):
        if rng.random() > 0.2:
            continue
        x, z = G.SHORE[i]
        nx, nz = shore_normal(i)
        d = rng.uniform(1.0, 2.2)
        px, pz = x + nx * d, z + nz * d
        if not allowed(px, pz, 0.6) or walkable_pts([px], [pz], sfield([px], [pz]))[0]:
            continue
        bushes.append((px, pz))
    hb = H([b[0] for b in bushes], [b[1] for b in bushes]) if bushes else []
    for kk, meshes in enumerate(shrub_v):
        tf = [(x, z, float(h) - 0.05, rng.uniform(0, 6.28), rng.uniform(0.8, 1.4)) for i, ((x, z), h) in enumerate(zip(bushes, hb)) if i % 2 == kk]
        PF.place(inst, f"lake_shrub_{kk}", meshes, tf)
    report["bushes"] = len(bushes)
    cand = poisson(rng, 96.0, 190.0, -70.0, 49.0, 3.7, lambda x, z: land_ok(x, z, 2.2, 3.0) and allowed(x, z, 1.0, spots=False), tries=90000)
    near_t, far_t = [], []
    if cand:
        xs = np.array([c[0] for c in cand])
        zs = np.array([c[1] for c in cand])
        dw = G.Raster.dwo(xs, zs)
        ss = sfield(xs, zs)
        for (x, z), d_, s_ in zip(cand, dw, ss):
            if rng.random() < 0.16:
                continue
            (near_t if min(d_, s_) < 11 and rng.random() < 0.5 and len(near_t) < 48 else far_t).append((x, z))
    hn = H([c[0] for c in near_t], [c[1] for c in near_t]) if near_t else []
    hf = H([c[0] for c in far_t], [c[1] for c in far_t]) if far_t else []
    for kk, meshes in enumerate(near_v):
        tf = [(x, z, float(h) - 0.1, rng.uniform(0, 6.28), rng.uniform(0.85, 1.25)) for i, ((x, z), h) in enumerate(zip(near_t, hn)) if i % 3 == kk]
        PF.place(inst, f"lake_tree_{kk}", meshes, tf)
    for kk, meshes in enumerate(far_v):
        tf = [(x, z, float(h) - 0.6, rng.uniform(0, 6.28), rng.uniform(7.0, 12.0)) for i, ((x, z), h) in enumerate(zip(far_t, hf)) if i % 3 == kk]
        PF.place(inst, f"lake_far_{kk}", meshes, tf)
    report.update(near_trees=len(near_t), far_trees=len(far_t))
    for o in list(src.objects):
        bpy.data.objects.remove(o)
    print("VEG", report)
    return report
