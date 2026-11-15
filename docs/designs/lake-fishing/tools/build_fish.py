# build_fish.py - lake_fish.glb: 11 freshwater species (design chapter 8: 10 + eel), one 2048x768 JPEG atlas, no bones.
#   "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --python art/lake/tools/build_fish.py -- out.glb [atlas_dir]
# Each fish is a root node `fish_<id>`: TOTAL length (snout to caudal tip) = 1.0 along local +Z (snout +Z, tail -Z), origin at
# the length centre, up = +Y, width along X, mirror-symmetric. The client scales it to cm/100 and waves the tail in the vertex
# shader from the z coordinate (tail = negative z). Eyes are separate meshes in the same node.
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector
from lakelib import *
import fish_paint as FP

# s: 0 = caudal peduncle, 1 = snout; rows (s, half-height top, half-height bottom, half-width)
SP = {
    "crucian_carp": dict(z0=-0.35, prof=[(0, .034, .030, .020), (.12, .060, .052, .032), (.32, .125, .105, .058), (.5, .150, .120, .068), (.68, .135, .105, .062), (.84, .098, .070, .046), (.95, .052, .038, .026), (1, .008, .008, .008)],
        fins=[("D", .22, .70, .095, .35, .45), ("A", .12, .26, .05, .5, .5), ("P", .70, .09, 0.5), ("V", .55, .08, 0.5), ("C", "fork", .15, .05)], eye=(.82, .011), barbels=0),
    "bluegill": dict(z0=-0.36, prof=[(0, .030, .028, .016), (.12, .070, .065, .030), (.3, .165, .150, .052), (.5, .215, .185, .060), (.7, .200, .170, .056), (.86, .130, .105, .044), (.96, .060, .045, .024), (1, .008, .008, .008)],
        fins=[("D", .26, .80, .12, .30, .30), ("A", .20, .50, .08, .4, .4), ("P", .72, .14, 0.5), ("V", .60, .10, 0.45), ("C", "trunc", .14, .06)], eye=(.84, .014), barbels=0),
    "minnow": dict(z0=-0.35, prof=[(0, .020, .018, .012), (.15, .042, .040, .024), (.4, .068, .060, .040), (.6, .078, .066, .044), (.8, .066, .050, .036), (.94, .040, .030, .022), (1, .008, .008, .008)],
        fins=[("D", .42, .60, .09, .3, .5), ("A", .20, .40, .075, .4, .5), ("P", .72, .10, 0.5), ("V", .55, .07, 0.5), ("C", "fork", .15, .07)], eye=(.84, .011), barbels=0),
    "prussian_carp": dict(z0=-0.35, prof=[(0, .036, .030, .020), (.12, .068, .052, .032), (.32, .150, .110, .062), (.5, .185, .125, .072), (.68, .165, .108, .066), (.84, .115, .072, .048), (.95, .060, .040, .028), (1, .008, .008, .008)],
        fins=[("D", .20, .72, .115, .30, .45), ("A", .12, .26, .055, .5, .5), ("P", .70, .10, 0.5), ("V", .55, .085, 0.5), ("C", "fork", .15, .055)], eye=(.82, .011), barbels=0),
    "bass": dict(z0=-0.36, prof=[(0, .030, .028, .020), (.12, .060, .055, .034), (.3, .095, .085, .052), (.5, .105, .090, .062), (.7, .105, .085, .066), (.86, .095, .070, .060), (.96, .065, .042, .040), (1, .018, .014, .014)],
        fins=[("D", .30, .80, .085, .35, .30), ("A", .10, .26, .06, .4, .5), ("P", .72, .11, 0.5), ("V", .60, .10, 0.5), ("C", "trunc", .14, .06)], eye=(.84, .013), barbels=0),
    "carp": dict(z0=-0.35, prof=[(0, .040, .034, .026), (.12, .070, .058, .040), (.32, .130, .105, .066), (.5, .160, .125, .080), (.68, .145, .112, .075), (.84, .105, .078, .056), (.95, .058, .044, .034), (1, .012, .012, .012)],
        fins=[("D", .24, .70, .12, .30, .50), ("A", .10, .24, .07, .5, .5), ("P", .70, .10, 0.5), ("V", .55, .09, 0.5), ("C", "fork", .15, .06)], eye=(.84, .012), barbels=2),
    "korean_bullhead": dict(z0=-0.38, prof=[(0, .018, .016, .014), (.15, .040, .036, .030), (.4, .060, .050, .052), (.62, .070, .052, .070), (.82, .066, .042, .082), (.95, .050, .028, .068), (1, .012, .010, .030)],
        fins=[("D", .52, .62, .10, .3, .6), ("A", .08, .38, .05, .5, .4), ("P", .70, .11, 0.7), ("V", .45, .06, 0.5), ("C", "round", .12, .30), ("T", .30, .22, .03)], eye=(.88, .008), barbels=4),
    "catfish": dict(z0=-0.38, prof=[(0, .016, .014, .010), (.2, .036, .030, .022), (.45, .056, .044, .044), (.65, .060, .044, .060), (.82, .054, .034, .080), (.95, .040, .024, .068), (1, .010, .008, .034)],
        fins=[("D", .66, .74, .05, .4, .5), ("A", .06, .70, .04, .5, .3), ("P", .72, .06, 0.6), ("V", .40, .045, 0.4), ("C", "round", .12, .30)], eye=(.88, .007), barbels=6),
    "mirror_carp": dict(z0=-0.35, prof=[(0, .040, .034, .028), (.12, .074, .060, .044), (.32, .145, .110, .072), (.5, .175, .130, .088), (.68, .160, .118, .082), (.84, .112, .082, .060), (.95, .062, .046, .036), (1, .012, .012, .012)],
        fins=[("D", .24, .70, .12, .30, .50), ("A", .10, .24, .07, .5, .5), ("P", .70, .11, 0.5), ("V", .55, .095, 0.5), ("C", "fork", .15, .06)], eye=(.84, .012), barbels=2),
    "snakehead": dict(z0=-0.37, prof=[(0, .030, .028, .028), (.15, .050, .048, .042), (.4, .060, .055, .054), (.65, .060, .054, .056), (.85, .052, .040, .058), (.96, .036, .022, .048), (1, .010, .008, .026)],
        fins=[("D", .10, .84, .04, .6, .2), ("A", .10, .62, .035, .5, .2), ("P", .72, .08, 0.5), ("V", .55, .05, 0.5), ("C", "round", .13, .30)], eye=(.90, .009), barbels=0),
    "eel": dict(z0=-0.46, prof=[(0, .014, .014, .012), (.2, .026, .024, .021), (.5, .036, .034, .030), (.8, .039, .034, .033), (.94, .030, .022, .024), (1, .006, .005, .008)],
        fins=[("D", .05, .86, .016, .5, .1), ("A", .05, .70, .014, .5, .1), ("P", .84, .03, 0.6), ("C", "round", .04, .30)], eye=(.93, .0045), barbels=0),
}
N_ST = 28
N_RING = 16
ATLAS_W, ATLAS_H = 2048, 768


def interp(prof, s, k):
    cap = 1.0
    if s > 0.9 and k > 0:
        cap = max(0.0, 1 - ((min(s, 1.0) - 0.9) / 0.1) ** 2) ** 0.5
    s = min(s, 0.95)
    return _interp(prof, s, k) * cap if k > 0 else _interp(prof, s, k)


def _interp(prof, s, k):
    """monotone-ish cubic Hermite (Catmull-Rom tangents) through the profile rows."""
    n = len(prof)
    for idx in range(n - 1):
        a, b = prof[idx], prof[idx + 1]
        if a[0] <= s <= b[0]:
            h = max(b[0] - a[0], 1e-9); t = (s - a[0]) / h
            pa = prof[idx - 1] if idx > 0 else a
            pb = prof[idx + 2] if idx + 2 < n else b
            m0 = (b[k] - pa[k]) / max(b[0] - pa[0], 1e-9) * h
            m1 = (pb[k] - a[k]) / max(pb[0] - a[0], 1e-9) * h
            t2 = t * t; t3 = t2 * t
            return (2 * t3 - 3 * t2 + 1) * a[k] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b[k] + (t3 - t2) * m1
    return prof[-1][k]


def uv_px(cell, x, y):
    ox, oy = FP.cell_origin(cell)
    return ((ox + x) / ATLAS_W, 1.0 - (oy + y) / ATLAS_H)


def build_species(idx, key, cfg, mat):
    prof = cfg["prof"]; z0 = cfg["z0"]
    zs = lambda s: z0 + s * (0.5 - z0)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    vuv = {}

    def vert(p, uv):
        v = bm.verts.new(G(*p)); vuv[v] = uv; return v

    def surf(s, phi, inset=0.0):
        top = interp(prof, s, 1); bot = interp(prof, s, 2); ww = interp(prof, s, 3)
        sn = math.sin(phi)
        y = sn * (top if sn > 0 else bot); x = math.cos(phi) * ww
        return Vector((x, y, zs(s))) * 1.0 - Vector((x, y, 0)) * inset

    # body
    rings = []
    ss = [i / 21 * 0.9 for i in range(22)] + [0.93, 0.955, 0.975, 0.99, 1.0]
    for s in ss:
        ring = []
        for j in range(N_RING):
            phi = 2 * math.pi * j / N_RING
            p = surf(s, phi)
            u = s
            v = (1 - math.sin(phi)) / 2     # back at top row (v=0)
            ring.append(vert(p, uv_px(idx, 4 + u * 503, 4 + v * 184)))
        rings.append(ring)
    faces = []
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(N_RING):
            k = (j + 1) % N_RING
            f = bm.faces.new((a[j], a[k], b[k], b[j])); f.smooth = True; faces.append(f)
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        c = vert(Vector((0, 0, zs(0 if flip else 1))), uv_px(idx, 256, 96))
        for j in range(N_RING):
            k = (j + 1) % N_RING
            f = bm.faces.new((c, ring[k], ring[j]) if flip else (c, ring[j], ring[k])); f.smooth = True

    def fin_grid(base, dirs, lens, rows=3, sweep=0.0, bend=None, fin_cell=idx):
        """base: list of points; dirs: list of unit vectors; lens: list of lengths; builds a (len(base) x rows+1) grid."""
        nb = len(base); grid = []
        for r in range(rows + 1):
            t = r / rows; row = []
            for i in range(nb):
                p = base[i] + dirs[i] * (lens[i] * t) + Vector((0, 0, -1)) * (sweep * lens[i] * t * t)
                f = i / (nb - 1)
                row.append(vert(p, uv_px(fin_cell, 8 + f * 367, 251 - t * 55)))
            grid.append(row)
        for a, b in zip(grid[:-1], grid[1:]):
            for i in range(nb - 1):
                fc = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i])); fc.smooth = False

    for fin in cfg["fins"]:
        kind = fin[0]
        if kind in ("D", "A"):
            _, s0, s1, hmax, peak, sweep = fin
            n = 8; base = []; dirs = []; lens = []
            for i in range(n):
                f = i / (n - 1); s = s0 + (s1 - s0) * f
                ph = math.pi / 2 if kind == "D" else -math.pi / 2
                base.append(surf(s, ph, 0.004))
                # length profile: rises to the peak then falls (spiny front taller for dorsal)
                lf = (f / peak) if f < peak else (1 - f) / (1 - peak) * 0.8 + 0.2 * (1 - f)
                lens.append(hmax * max(lf, 0.18) if kind == "D" or True else hmax)
                ang = math.radians(10 + 25 * (1 - f)) if sweep > 0 else 0.0
                d = Vector((0, 1 if kind == "D" else -1, 0))
                d = Vector((0, math.cos(ang) * (1 if kind == "D" else -1), -math.sin(ang)))
                dirs.append(d.normalized())
            fin_grid(base, dirs, lens, 3, sweep * 0.3)
        elif kind == "T":   # adipose fin
            _, s0, h, w = fin
            base = [surf(s0 + (i / 4) * 0.12, math.pi / 2, 0.004) for i in range(5)]
            lens = [h * 0.4, h * 0.8, h, h * 0.8, h * 0.2]
            fin_grid(base, [Vector((0, 1, -0.4)).normalized()] * 5, lens, 2)
        elif kind in ("P", "V"):
            _, s, L, out = fin
            for sgn in (1, -1):
                phi = math.radians(215 if sgn > 0 else 325) if kind == "P" else math.radians(250 if sgn > 0 else 290)
                if kind == "P":
                    phi = math.radians(200) if sgn > 0 else math.radians(340)
                base = [surf(s + d, phi, 0.004) for d in (-0.012, 0.0, 0.012)]
                dd = Vector((sgn * out, -0.25 if kind == "P" else -0.5, -0.8)).normalized()
                fin_grid(base, [dd] * 3, [L * 0.85, L, L * 0.6], 3, 0.1)
        elif kind == "C":
            _, style, L, spread = fin
            top = interp(prof, 0, 1); bot = interp(prof, 0, 2)
            n = 9; base = []; dirs = []; lens = []
            for i in range(n):
                f = i / (n - 1); e = abs(2 * f - 1)
                base.append(Vector((0, (f - 0.5) * (top + bot) * 0.9, z0)))
                if style == "fork":
                    ln = L * (0.50 + 0.50 * e ** 1.1)
                elif style == "round":
                    ln = L * (0.55 + 0.45 * (1 - e * e) ** 0.5)
                else:
                    ln = L * (0.80 + 0.20 * e)
                lens.append(ln)
                dirs.append(Vector((0, (f - 0.5) * spread * 4.0, -1)).normalized())
            fin_grid(base, dirs, lens, 4)
    # eyes
    es, er = cfg["eye"]
    er *= 1.55
    top = interp(prof, es, 1); ww = interp(prof, es, 3)
    ey = top * 0.38
    for sgn in (1, -1):
        c = Vector((sgn * ww * 0.88, ey, zs(es)))
        seg, rg = 10, 7
        eye_rows = []
        for a in range(rg + 1):
            th = math.pi * a / rg
            row = []
            for b in range(seg):
                ph = 2 * math.pi * b / seg
                q = Vector((math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph))) * er
                p = c + q
                # planar side projection: u from z, v from y (flipped for the other side is unnecessary: iris is round)
                uu = 0.5 + q.z / (2 * er) * (1 if sgn > 0 else -1) * -1
                vv = 0.5 + q.y / (2 * er)
                row.append(vert(p, uv_px(idx, 400 + uu * 63, 192 + (1 - vv) * 63)))
            eye_rows.append(row)
        for a, b in zip(eye_rows[:-1], eye_rows[1:]):
            for j in range(seg):
                k = (j + 1) % seg
                try:
                    fc = bm.faces.new((a[j], b[j], b[k], a[k]) if sgn > 0 else (a[j], a[k], b[k], b[j])); fc.smooth = True
                except ValueError:
                    pass
    # barbels
    nb = cfg["barbels"]
    if nb:
        sets = {2: [(0.97, 0.45, 1)], 4: [(0.99, 0.30, 1), (0.93, 0.15, 1)], 6: [(0.99, 0.45, 1), (0.97, 0.30, 1), (0.93, 0.15, 1)]}[nb]
        for (s, vf, _) in sets:
            for sgn in (1, -1):
                ww = interp(prof, s, 3); tp = interp(prof, s, 1); bt = interp(prof, s, 2)
                p0 = Vector((sgn * ww * 0.6, -bt * 0.25 + tp * 0.0, zs(s)))
                L = 0.06 if nb == 2 else (0.10 if vf > 0.4 else 0.045)
                if nb == 6 and vf > 0.4:
                    L = 0.11
                pts = [p0, p0 + Vector((sgn * L * 0.35, -L * 0.15, L * 0.55)), p0 + Vector((sgn * L * 0.7, -L * 0.35, L * 0.75)), p0 + Vector((sgn * L, -L * 0.30, L * 0.80))]
                for a, b, rr in zip(pts[:-1], pts[1:], (0.0035, 0.0028, 0.002)):
                    r0 = ring_pts(a, b - a, rr, 5, Vector((0, 1, 0))); r1 = ring_pts(b, b - a, rr * 0.8, 5, Vector((0, 1, 0)))
                    va = [vert(p, uv_px(idx, 256, 96)) for p in r0]; vb = [vert(p, uv_px(idx, 256, 96)) for p in r1]
                    for j in range(5):
                        k = (j + 1) % 5
                        fc = bm.faces.new((va[j], va[k], vb[k], vb[j])); fc.smooth = True
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = vuv[l.vert]
    ob = new_obj("fish_" + key + "_mesh", bm, [mat])
    root = bpy.data.objects.new("fish_" + key, None)
    root["refCm"] = 100.0   # model length 1.0 = 100 cm: client scale = catchCm / refCm
    root["kindIndex"] = idx + 1
    bpy.context.scene.collection.objects.link(root)
    ob.parent = root
    return root, ob


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[0] if argv else "lake_fish.glb"
    adir = os.path.abspath(argv[1]) if len(argv) > 1 else os.path.dirname(os.path.abspath(out))
    reset_scene()
    atlas_png = os.path.join(adir, "fish_atlas.png")
    assert os.path.exists(atlas_png), 'run: python art/lake/tools/fish_paint.py <dir>/fish_atlas.png first (needs PIL)'
    img = bpy.data.images.load(atlas_png)
    img.colorspace_settings.name = "sRGB"
    m = bpy.data.materials.new("M_fish")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.42
    bsdf.inputs["Metallic"].default_value = 0.0
    m.use_backface_culling = False
    objs = []; tris = {}
    for i, k in enumerate(FP.ORDER):
        root, ob = build_species(i, k, SP[k], m)
        ob.data.calc_loop_triangles(); tris[k] = len(ob.data.loop_triangles)
        # lay the fish out in a row only for debugging; the exported nodes keep identity transforms
        objs += [root, ob]
    print("TRIS", tris, "TOTAL", sum(tris.values()))
    export_glb(out, selection=objs, animations=False, export_image_format="JPEG", export_jpeg_quality=86, export_extras=True)
    print("EXPORTED", out, os.path.getsize(out))


main()
