# build_fish.py - lake_fish.glb: 11 freshwater species. Body atlas (JPEG, 2048x768) + alpha-cut fin atlas (PNG, 512x192). No bones.
#   python art/lake/tools/fish_paint.py <dir>/fish_atlas.jpg      (needs PIL; also writes fish_fins.png)
#   "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --python art/lake/tools/build_fish.py -- out.glb [atlas_dir]
# Each fish is a root node `fish_<id>`: TOTAL length (snout to caudal tip) = 1.0 along local +Z (snout +Z, tail -Z), origin at
# the length centre, up = +Y, width along X, mirror-symmetric. extras.refCm = 100 (client scale = catchCm / refCm), extras.kindIndex = 1..11.
# The mesh has two primitives: M_fish (body, eyes, barbels) and M_fin (alpha-cut fin sheets, alphaMode MASK).
import os, sys, math, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector
from lakelib import *
import fish_paint as FP

# s: 0 = caudal peduncle, 1 = snout; rows (s, half-height top, half-height bottom, half-width)
# fins (lens listed from the tail side to the head side, in units of total length):
#   ("D"/"A", s0, s1, lens, lean_rear_deg, lean_front_deg)   dorsal / anal ridge fins
#   ("P"/"V", s, L, out)  paired pectoral / pelvic      ("T", s0, s1, lens)  adipose     ("C", style, L, spread)  caudal
SP = {
    "crucian_carp": dict(z0=-0.35, drop=0.10, op=.775,
        prof=[(0, .034, .030, .020), (.12, .058, .050, .032), (.3, .118, .098, .056), (.5, .152, .120, .066), (.64, .150, .118, .066), (.78, .118, .088, .056), (.9, 0.087, 0.058, 0.045), (.95, 0.070, 0.046, 0.038), (1, .008, .008, .008)],
        fins=[("D", .26, .66, [.058, .064, .070, .076, .083, .091, .099, .106], 12, 40), ("A", .12, .26, [.030, .048, .062], 8, 28), ("P", .71, .10, .5), ("V", .56, .08, .5), ("C", "fork", .15, .07)],
        eye=(.855, .012), barbels=[]),
    "bluegill": dict(z0=-0.36, drop=0.0, op=.78,
        prof=[(0, .030, .028, .016), (.12, .070, .065, .030), (.3, .165, .150, .052), (.5, .210, .185, .060), (.7, .195, .170, .056), (.86, .130, .105, .044), (.95, 0.091, 0.065, 0.039), (1, .008, .008, .008)],
        fins=[("D", .22, .80, [.040, .075, .098, .104, .092, .056, .074, .080, .082, .078], 8, 14), ("A", .20, .52, [.032, .060, .074, .070, .062, .056], 8, 20), ("P", .72, .15, .45), ("V", .60, .10, .45), ("C", "trunc", .14, .06)],
        eye=(.86, .014), barbels=[]),
    "minnow": dict(z0=-0.35, drop=0.0, op=.78,
        prof=[(0, .020, .018, .012), (.15, .042, .040, .024), (.4, .068, .060, .040), (.6, .078, .066, .044), (.8, .068, .052, .036), (.94, .042, .030, .022), (1, .008, .008, .008)],
        fins=[("D", .42, .60, [.045, .070, .086, .082], 15, 30), ("A", .20, .40, [.030, .050, .066, .070], 10, 25), ("P", .72, .10, .5), ("V", .56, .07, .5), ("C", "fork", .15, .08)],
        eye=(.86, .012), barbels=[]),
    "prussian_carp": dict(z0=-0.35, drop=0.10, op=.775,
        prof=[(0, .036, .030, .020), (.12, .064, .052, .032), (.3, .136, .102, .060), (.5, .180, .128, .070), (.64, .176, .124, .070), (.78, .138, .092, .058), (.9, 0.096, 0.063, 0.045), (.95, 0.076, 0.049, 0.038), (1, .008, .008, .008)],
        fins=[("D", .22, .70, [.062, .068, .074, .080, .090, .100, .112, .124], 12, 42), ("A", .12, .26, [.032, .050, .066], 8, 28), ("P", .71, .10, .5), ("V", .56, .085, .5), ("C", "fork", .15, .06)],
        eye=(.855, .012), barbels=[]),
    "bass": dict(z0=-0.36, drop=-0.05, op=.80,
        prof=[(0, .030, .028, .020), (.12, .056, .052, .034), (.3, .092, .084, .052), (.5, .104, .090, .062), (.7, .104, .086, .066), (.86, .095, .072, .062), (.95, .075, .048, .048), (1, .020, .014, .016)],
        fins=[("D", .52, .80, [.040, .070, .086, .090, .086, .076], 6, 22), ("D", .26, .44, [.034, .058, .070, .060, .045], 12, 28), ("A", .10, .26, [.030, .050, .065], 10, 25), ("P", .73, .11, .5), ("V", .61, .10, .5), ("C", "trunc", .14, .06)],
        eye=(.87, .014), barbels=[]),
    "carp": dict(z0=-0.35, drop=0.12, op=.78,
        prof=[(0, .040, .034, .026), (.12, .068, .056, .040), (.3, .124, .100, .064), (.5, .158, .124, .080), (.66, .154, .120, .078), (.8, .120, .090, .066), (.9, 0.092, 0.067, 0.056), (.95, 0.076, 0.054, 0.049), (1, .012, .012, .012)],
        fins=[("D", .20, .72, [.052, .058, .063, .069, .075, .084, .097, .112], 8, 36), ("A", .10, .24, [.030, .050, .070], 8, 26), ("P", .71, .10, .5), ("V", .56, .09, .5), ("C", "fork", .15, .06)],
        eye=(.86, .012), barbels=[(.992, .040, .55, 0.0), (.96, .062, .70, -0.2)]),
    "korean_bullhead": dict(z0=-0.38, drop=0.0, op=.80,
        prof=[(0, .018, .016, .014), (.15, .040, .036, .030), (.4, .060, .050, .052), (.62, .070, .052, .070), (.82, .066, .042, .082), (.95, .052, .030, .070), (1, .012, .010, .030)],
        fins=[("D", .66, .72, [.092, .128], 4, 20), ("A", .08, .38, [.030, .040, .048, .050, .048, .042], 8, 15), ("T", .10, .40, [.018, .026, .028, .026, .020, .012]), ("P", .70, .11, .7), ("V", .45, .06, .5), ("C", "round", .12, .30)],
        eye=(.89, .009), barbels=[(.99, .15, .65, .0), (.975, .05, .55, .0), (.945, .075, .60, -.15), (.93, .06, .55, -.15)]),
    "catfish": dict(z0=-0.38, drop=0.0, op=.80,
        prof=[(0, .016, .014, .010), (.2, .036, .030, .022), (.45, .056, .044, .044), (.65, .060, .044, .060), (.82, .054, .034, .080), (.95, .042, .026, .070), (1, .010, .008, .034)],
        fins=[("D", .66, .74, [.040, .052], 5, 15), ("A", .06, .70, [.016, .032, .042, .048, .050, .050, .046, .040, .024], 8, 8), ("P", .72, .06, .6), ("V", .40, .045, .4), ("C", "round", .12, .30)],
        eye=(.90, .007), barbels=[(.995, .21, .70, .0), (.97, .12, .60, .0), (.94, .09, .50, -.1), (.92, .07, .45, -.12)]),
    "mirror_carp": dict(z0=-0.35, drop=0.12, op=.78,
        prof=[(0, .040, .034, .028), (.12, .074, .060, .044), (.3, .138, .108, .070), (.5, .172, .130, .088), (.66, .166, .126, .086), (.8, .126, .096, .068), (.9, 0.096, 0.072, 0.058), (.95, 0.078, 0.057, 0.051), (1, .012, .012, .012)],
        fins=[("D", .20, .72, [.058, .064, .070, .076, .082, .090, .102, .116], 8, 36), ("A", .10, .24, [.034, .054, .072], 8, 26), ("P", .71, .11, .5), ("V", .56, .095, .5), ("C", "fork", .15, .06)],
        eye=(.86, .012), barbels=[(.992, .040, .55, 0.0), (.96, .062, .70, -0.2)]),
    "snakehead": dict(z0=-0.37, drop=-0.10, op=.80,
        prof=[(0, .030, .028, .028), (.15, .050, .048, .042), (.4, .060, .055, .054), (.65, .060, .054, .056), (.85, .042, .034, .062), (.96, .026, .016, .050), (1, .010, .008, .026)],
        fins=[("D", .12, .84, [.016, .034, .042, .045, .046, .045, .043, .037, .022], 4, 4), ("A", .12, .62, [.016, .034, .040, .041, .038, .026], 4, 4), ("P", .72, .09, .5), ("V", .56, .05, .5), ("C", "round", .13, .30)],
        eye=(.905, .009), barbels=[]),
    "eel": dict(z0=-0.46, drop=0.0, op=.90,
        prof=[(0, .014, .014, .012), (.2, .026, .024, .021), (.5, .036, .034, .030), (.8, .039, .034, .033), (.94, .030, .022, .024), (1, .006, .005, .008)],
        fins=[("D", .05, .90, [.008, .016, .020, .020, .020, .020, .018, .010], 3, 3), ("A", .05, .72, [.008, .015, .018, .018, .016, .010], 3, 3), ("P", .86, .035, .6), ("C", "round", .04, .30)],
        eye=(.935, .0045), barbels=[]),
}
N_RING = 16
ATLAS_W, ATLAS_H = 2048, 768
FW, FH = FP.FW, FP.FH


def interp(prof, s, k):
    cap = 1.0
    if s > 0.9 and k > 0:
        cap = max(0.0, 1 - ((min(s, 1.0) - 0.9) / 0.1) ** 2) ** 0.5
    s = min(s, 0.95)
    return _interp(prof, s, k) * cap if k > 0 else _interp(prof, s, k)


def _interp(prof, s, k):
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


def fin_uv(cell, f, t):
    fx, fy = (cell % 4) * FW, (cell // 4) * FH
    return ((fx + 1 + f * (FW - 2)) / (FW * 4), 1.0 - (fy + (FH - 2) - t * (FH - 4)) / (FH * 3))


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def build_species(idx, key, cfg, mat_body, mat_fin):
    prof = cfg["prof"]; z0 = cfg["z0"]; drop = cfg["drop"]; op = cfg["op"]
    zs = lambda s: z0 + s * (0.5 - z0)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    vuv = {}

    def vert(p, uv):
        v = bm.verts.new(G(*p)); vuv[v] = uv; return v

    def surf(s, phi, inset=0.0):
        top = interp(prof, s, 1); bot = interp(prof, s, 2); ww = interp(prof, s, 3)
        g = 1.0 - 0.045 * math.exp(-((s - op) / 0.014) ** 2)      # gill-cover groove
        sn = math.sin(phi)
        y = sn * (top if sn > 0 else bot) * g
        x = math.cos(phi) * ww * g
        y -= drop * top * smoothstep(0.82, 1.0, s)                # sub-terminal mouth: snout droops
        return Vector((x, y - inset * 0, zs(s)))

    rings = []
    ss = [i / 23 * 0.9 for i in range(24)] + [0.93, 0.955, 0.975, 0.99, 1.0]
    for s in ss:
        ring = []
        for j in range(N_RING):
            phi = 2 * math.pi * j / N_RING
            v = (1 - math.sin(phi)) / 2
            ring.append(vert(surf(s, phi), uv_px(idx, 4 + s * 503, 4 + v * 184)))
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(N_RING):
            k = (j + 1) % N_RING
            f = bm.faces.new((a[j], a[k], b[k], b[j])); f.smooth = True
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        yc = 0 if flip else -drop * interp(prof, 1.0, 1) * 0
        c = vert(Vector((0, -drop * interp(prof, 0.9, 1) * (0 if flip else 1), zs(0 if flip else 1))), uv_px(idx, 256, 96))
        for j in range(N_RING):
            k = (j + 1) % N_RING
            f = bm.faces.new((c, ring[k], ring[j]) if flip else (c, ring[j], ring[k])); f.smooth = True

    def fin_grid(base, dirs, lens, rows=2, sweep=0.0):
        nb = len(base); grid = []
        for r in range(rows + 1):
            t = r / rows; row = []
            for i in range(nb):
                p = base[i] + dirs[i] * (lens[i] * t) + Vector((0, 0, -1)) * (sweep * lens[i] * t * t)
                f = i / max(nb - 1, 1)
                row.append(vert(p, fin_uv(idx, f, t)))
            grid.append(row)
        for a, b in zip(grid[:-1], grid[1:]):
            for i in range(nb - 1):
                fc = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i])); fc.smooth = False; fc.material_index = 1

    for fin in cfg["fins"]:
        kind = fin[0]
        if kind in ("D", "A", "T"):
            if kind == "T":
                _, s0, s1, lens = fin; lr = lf = 20
            else:
                _, s0, s1, lens, lr, lf = fin
            n = len(lens); base = []; dirs = []
            for i in range(n):
                f = i / max(n - 1, 1); s = s0 + (s1 - s0) * f
                ph = -math.pi / 2 if kind == "A" else math.pi / 2
                p = surf(s, ph)
                base.append(p + Vector((0, 0.004 if kind == "A" else -0.004, 0)))
                ang = math.radians(lr + (lf - lr) * f)
                dirs.append(Vector((0, math.cos(ang) * (-1 if kind == "A" else 1), -math.sin(ang))).normalized())
            fin_grid(base, dirs, lens, 2, 0.15)
        elif kind in ("P", "V"):
            _, s, L, out = fin
            for sgn in (1, -1):
                phi = (math.radians(200) if sgn > 0 else math.radians(340)) if kind == "P" else (math.radians(250) if sgn > 0 else math.radians(290))
                base = []
                for d in (-0.014, -0.005, 0.005, 0.014):
                    p = surf(s + d, phi)
                    base.append(p - Vector((sgn * 0.004, 0, 0)))
                dd = Vector((sgn * out, -0.25 if kind == "P" else -0.5, -0.8)).normalized()
                fin_grid(base, [dd] * 4, [L * 0.6, L, L * 0.92, L * 0.55], 2, 0.1)
        elif kind == "C":
            _, style, L, spread = fin
            top = interp(prof, 0, 1); bot = interp(prof, 0, 2)
            n = 9; base = []; dirs = []; lens = []
            for i in range(n):
                f = i / (n - 1); e = abs(2 * f - 1)
                base.append(Vector((0, (f - 0.5) * (top + bot) * 0.9, z0)))
                if style == "fork":
                    ln = L * (0.42 + 0.58 * e ** 1.1)
                elif style == "round":
                    ln = L * (0.55 + 0.45 * (1 - e * e) ** 0.5)
                else:
                    ln = L * (0.78 + 0.22 * e ** 1.5)
                lens.append(ln)
                dirs.append(Vector((0, (f - 0.5) * spread * 4.0, -1)).normalized())
            fin_grid(base, dirs, lens, 3)
    # eyes (set into the head: sphere centre inside the surface)
    es, er = cfg["eye"]
    er *= 1.75
    top = interp(prof, es, 1); ww = interp(prof, es, 3)
    ey = top * 0.34 - drop * top * smoothstep(0.82, 1.0, es)
    for sgn in (1, -1):
        c = Vector((sgn * ww * 0.80, ey, zs(es)))
        seg, rg = 10, 7
        rows_ = []
        for a in range(rg + 1):
            th = math.pi * a / rg
            row = []
            for b in range(seg):
                ph = 2 * math.pi * b / seg
                q = Vector((math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph))) * er
                uu = 0.5 - q.z / (2 * er) * (1 if sgn > 0 else -1)
                vv = 0.5 + q.y / (2 * er)
                row.append(vert(c + q, uv_px(idx, 400 + uu * 63, 192 + (1 - vv) * 63)))
            rows_.append(row)
        for a, b in zip(rows_[:-1], rows_[1:]):
            for j in range(seg):
                k = (j + 1) % seg
                try:
                    fc = bm.faces.new((a[j], b[j], b[k], a[k]) if sgn > 0 else (a[j], a[k], b[k], b[j])); fc.smooth = True
                except ValueError:
                    pass
    # barbels: (s, length, side offset (fraction of half-width), drop)
    for (s, L, sd, dp) in cfg["barbels"]:
        for sgn in (1, -1):
            ww = interp(prof, s, 3); bt = interp(prof, s, 2)
            p0 = Vector((sgn * ww * sd, -bt * 0.30 - drop * interp(prof, s, 1) * smoothstep(0.82, 1.0, s), zs(s)))
            pts = [p0, p0 + Vector((sgn * L * 0.30, -L * (0.20 - dp), L * 0.55)), p0 + Vector((sgn * L * 0.62, -L * (0.40 - dp), L * 0.80)), p0 + Vector((sgn * L * 0.9, -L * (0.45 - dp), L * 0.85))]
            for a, b, rr in zip(pts[:-1], pts[1:], (0.0032, 0.0024, 0.0016)):
                r0 = ring_pts(a, b - a, rr, 5, Vector((0, 1, 0))); r1 = ring_pts(b, b - a, rr * 0.8, 5, Vector((0, 1, 0)))
                va = [vert(p, uv_px(idx, 256, 96)) for p in r0]; vb = [vert(p, uv_px(idx, 256, 96)) for p in r1]
                for j in range(5):
                    k = (j + 1) % 5
                    fc = bm.faces.new((va[j], va[k], vb[k], vb[j])); fc.smooth = True
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = vuv[l.vert]
    ob = new_obj("fish_" + key + "_mesh", bm, [mat_body, mat_fin])
    root = bpy.data.objects.new("fish_" + key, None)
    root["refCm"] = 100.0     # model length 1.0 = 100 cm: client scale = catchCm / refCm
    root["kindIndex"] = idx + 1
    bpy.context.scene.collection.objects.link(root)
    ob.parent = root
    return root, ob


def tex_material(name, img, rough, alpha):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    m.use_backface_culling = False
    return m


def patch_glb(path):
    buf = open(path, "rb").read()
    jl = struct.unpack_from("<I", buf, 12)[0]
    js = json.loads(buf[20:20 + jl].decode("utf8"))
    rest = buf[20 + jl:]
    for m in js.get("materials", []):
        m["doubleSided"] = True
        if m["name"] == "M_fin":
            m["alphaMode"] = "MASK"; m["alphaCutoff"] = 0.5
        else:
            m.pop("alphaMode", None)
    jb = json.dumps(js, separators=(",", ":")).encode("utf8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + len(rest)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb); f.write(rest)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[0] if argv else "lake_fish.glb"
    adir = os.path.abspath(argv[1]) if len(argv) > 1 else os.path.dirname(os.path.abspath(out))
    reset_scene()
    png = os.path.join(adir, "fish_atlas.jpg"); fpng = os.path.join(adir, "fish_fins.png")
    assert os.path.exists(png) and os.path.exists(fpng), "run: python art/lake/tools/fish_paint.py <dir>/fish_atlas.jpg first (needs PIL)"
    img = bpy.data.images.load(png); img.colorspace_settings.name = "sRGB"
    fimg = bpy.data.images.load(fpng); fimg.colorspace_settings.name = "sRGB"; fimg.alpha_mode = "STRAIGHT"
    mb = tex_material("M_fish", img, 0.42, False)
    mf = tex_material("M_fin", fimg, 0.5, True)
    objs = []; tris = {}
    for i, k in enumerate(FP.ORDER):
        root, ob = build_species(i, k, SP[k], mb, mf)
        ob.data.calc_loop_triangles(); tris[k] = len(ob.data.loop_triangles)
        objs += [root, ob]
    print("TRIS", tris, "TOTAL", sum(tris.values()))
    export_glb(out, selection=objs, animations=False, export_image_format="AUTO", export_extras=True)
    patch_glb(out)
    print("EXPORTED", out, os.path.getsize(out))


main()
