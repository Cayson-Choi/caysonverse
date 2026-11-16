# build_fish.py - lake_fish.glb: 11 freshwater species built from traced side-view profiles (fishspec.py).
#   python art/lake/tools/fish_paint.py <dir>/fish_atlas.jpg      (needs PIL; also writes fish_fins.png)
#   "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --python art/lake/tools/build_fish.py -- out.glb [atlas_dir]
# Each fish is a root node `fish_<id>`: TOTAL length (snout to caudal tip) = 1.0 along local +Z (snout +Z, tail -Z), origin at
# the length centre, up = +Y, width along X, mirror-symmetric. extras.refCm = 100 (client scale = catchCm / refCm), extras.kindIndex = 1..11.
# The mesh has two primitives: M_fish (body, eyes, barbels) and M_fin (alpha-cut fin sheets, alphaMode MASK).
# Body: dense loft of superellipse cross-sections that follow the traced dorsal / ventral / width curves, with head relief
# (raised gill-cover plate with a stepped rear edge, mouth gape groove, open lip ring + mouth cavity), then collapse-decimated
# (X-symmetric) to the triangle budget. Fins: ray strips whose tips follow the traced fin outlines, pleated per ray.
import os, sys, math, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector
from lakelib_gear import G, new_obj, reset_scene, export_glb, ring_pts
import fishspec as FS
import fish_paint as FP

N_TH = 64
BODY_TRIS = {"eel": 700, "catfish": 980, "korean_bullhead": 980, "snakehead": 940}
BODY_TRIS_DEFAULT = 1020
ATLAS_W, ATLAS_H = FP.ATLAS_W, FP.ATLAS_H


def body_uv(cell, u, v):
    ox, oy = FP.cell_origin(cell)
    return ((ox + u * (FP.CW - 1) + 0.5) / ATLAS_W, 1.0 - (oy + v * (FP.BH - 1) + 0.5) / ATLAS_H)


def px_uv(cell, x, y):
    ox, oy = FP.cell_origin(cell)
    return ((ox + x) / ATLAS_W, 1.0 - (oy + y) / ATLAS_H)


def fin_uv(cell, variant, u, t):
    fx, fy = FP.fin_origin(cell, variant)
    return ((fx + u * FP.FCW) / FP.FIN_W, 1.0 - (fy + (FP.FBH - 1.5) - t * (FP.FBH - 3)) / FP.FIN_H)


class Fish:
    def __init__(self, key, idx):
        self.key, self.idx = key, idx
        self.sp = FS.SPECIES[key]
        self.TL = FS.tl(self.sp)
        self.yo = FS.yoff(self.sp)

    def M(self, x, y, X):
        """SL-space (x from snout, y up, X lateral) -> glTF model space Vector (x, y, z)."""
        T = self.TL
        return Vector((X / T, (y - self.yo) / T, 0.5 - x / T))

    def surf(self, x, yn, side=1.0):
        """point + outward normal (SL space, (X, Y)) on the right flank at normalized height yn."""
        th = np.linspace(0, math.pi, 721)
        X, Y, yc, top, bot, w = FS.section(self.sp, np.full_like(th, x), th)
        tgt = bot + yn * (top - bot)
        j = int(np.argmin(np.abs(Y - tgt)))
        j = min(max(j, 1), len(th) - 2)
        tx, ty = X[j + 1] - X[j - 1], Y[j + 1] - Y[j - 1]
        nx, ny = -ty, tx                     # th increases downward on the right flank -> outward = (-ty, tx)
        l = math.hypot(nx, ny) or 1.0
        return float(X[j]) * side, float(Y[j]), nx / l * side, ny / l


def build_body(F):
    sp = F.sp; cell = F.idx
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new("UVMap"); vuv = {}

    def vert(p, uv):
        v = bm.verts.new(G(*p)); vuv[v] = uv; return v

    xs = np.unique(np.concatenate([np.linspace(FS.X_END, 0.42, 34), np.linspace(0.42, 0.012, 104)]))[::-1]
    th = np.linspace(0, 2 * math.pi, N_TH, endpoint=False)
    rings = []
    for x in xs:
        xa = np.full_like(th, x)
        X, Y, yc, top, bot, w = FS.section(sp, xa, th)
        hu = np.where(Y >= yc, np.maximum(top - yc, 1e-6), np.maximum(yc - bot, 1e-6))
        nx = X / np.maximum(w, 1e-6) ** 2; ny = (Y - yc) / hu ** 2
        nl = np.maximum(np.hypot(nx, ny), 1e-9); nx /= nl; ny /= nl
        d = FS.head_disp(sp, xa, X, Y, top, bot, w)
        X = X + d * nx; Y = Y + d * ny
        u = max(0.002, FS.U0 - FS.U1 * x)
        ring = []
        for j in range(N_TH):
            v = th[j] / math.pi if th[j] <= math.pi else (2 * math.pi - th[j]) / math.pi
            ring.append(vert(F.M(x, Y[j], X[j]), body_uv(cell, u, v)))
        rings.append(ring)
    # snout: lip ring (protruding, tilted for an undershot / overshot jaw) and the mouth cavity
    m = sp["MOUTH"]
    x4 = 0.004
    X4, Y4, *_ = FS.section(sp, np.full_like(th, x4), th)
    lip = []
    for k, (sc, dx, uu) in enumerate(((1.0, abs(m["tilt"]) * m["h"], 0.989), (0.72, 0.004 + abs(m["tilt"]) * m["h"], 0.996), (0.36, 0.03, 0.998))):
        ring = []
        for j in range(N_TH):
            c, s = math.sin(th[j]), math.cos(th[j])
            X = m["w"] * sc * c; Y = m["y"] + m["h"] * sc * s
            x = dx + m["tilt"] * (Y - m["y"])
            if k == 0:   # lip ring blends towards the snout section so the lips read as thick rims
                X = 0.75 * X + 0.25 * X4[j]; Y = 0.75 * Y + 0.25 * Y4[j]
            v = th[j] / math.pi if th[j] <= math.pi else (2 * math.pi - th[j]) / math.pi
            ring.append(vert(F.M(x, Y, X), body_uv(cell, uu, v)))
        lip.append(ring)
    pre = []
    for j in range(N_TH):
        v = th[j] / math.pi if th[j] <= math.pi else (2 * math.pi - th[j]) / math.pi
        X = 0.5 * X4[j] + 0.5 * m["w"] * 1.15 * math.sin(th[j]); Y = 0.5 * Y4[j] + 0.5 * (m["y"] + m["h"] * 1.15 * math.cos(th[j]))
        pre.append(vert(F.M(x4 + m["fwd"], Y, X), body_uv(cell, FS.U0 - FS.U1 * 0.0, v)))
    rings += [pre] + lip
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(N_TH):
            k = (j + 1) % N_TH
            f = bm.faces.new((a[j], a[k], b[k], b[j])); f.smooth = True
    cin = vert(F.M(0.05, m["y"], 0.0), body_uv(cell, 0.999, 0.5))
    for j in range(N_TH):
        k = (j + 1) % N_TH
        f = bm.faces.new((rings[-1][j], rings[-1][k], cin)); f.smooth = True
    ctl = vert(F.M(FS.X_END + 0.004, 0.5 * (FS.pchip(sp["TOP"], FS.X_END) + FS.pchip(sp["BOT"], FS.X_END)), 0.0), body_uv(cell, 0.0, 0.5))
    for j in range(N_TH):
        k = (j + 1) % N_TH
        f = bm.faces.new((rings[0][k], rings[0][j], ctl)); f.smooth = True
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = vuv[l.vert]
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    ob = new_obj("tmp_body_" + F.key, bm, [])
    # collapse decimation with X symmetry down to the body budget
    ntri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    target = BODY_TRIS.get(F.key, BODY_TRIS_DEFAULT)
    md = ob.modifiers.new("dec", "DECIMATE")
    md.decimate_type = "COLLAPSE"; md.ratio = target / ntri; md.use_symmetry = True; md.symmetry_axis = "X"
    md.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    return me


def resample(pts, n):
    p = np.asarray(pts, float)
    seg = np.hypot(*np.diff(p, axis=0).T); s = np.concatenate([[0], np.cumsum(seg)]); s /= s[-1]
    t = np.linspace(0, 1, n)
    return np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], 1)


def add_fins(F, bm, uvl, mi_fin, mi_body):
    sp = F.sp; cell = F.idx; T = F.TL
    vuv = {}

    def vert(p, uv):
        v = bm.verts.new(G(*p)); vuv[v] = uv; return v

    def strip(base, tips, variant, pleat=0.004, mids=1, bend=None):
        """rays i: base[i] -> tips[i] (glTF Vectors). UV: ray i at u=(i+.5)/24 of the variant band."""
        n = len(base); rows = []
        for r in range(mids + 2):
            t = r / (mids + 1); row = []
            for i in range(n):
                p = base[i].lerp(tips[i], t)
                if r > 0:
                    p = p + Vector((1, 0, 0)) * (pleat / T) * (1 if i % 2 else -1) * min(1.0, t * 1.4)
                if bend is not None:
                    p = p + bend * (t * (1 - t)) * (base[i] - tips[i]).length
                row.append(vert(p, fin_uv(cell, variant, (i + 0.5) / FP.NRAY, t)))
            rows.append(row)
        for a, b in zip(rows[:-1], rows[1:]):
            for i in range(n - 1):
                f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i])); f.smooth = True; f.material_index = mi_fin
        return rows

    for fin in sp["FINS"]:
        kind = fin[0]
        if kind in ("D", "A"):
            _, variant, x0, x1, outline, n = fin
            n = min(n, FP.NRAY)
            tips = resample(outline, n)
            base = []; tv = []
            for i in range(n):
                x = x0 + (x1 - x0) * i / max(n - 1, 1)
                if kind == "D":
                    y = float(FS.pchip(sp["TOP"], x)) - 0.006
                else:
                    y = float(FS.pchip(sp["BOT"], x)) + 0.006
                base.append(F.M(x, y, 0.0)); tv.append(F.M(tips[i][0], tips[i][1], 0.0))
            strip(base, tv, variant, pleat=0.0035 if n > 6 else 0.002, mids=1)
        elif kind == "C":
            _, variant, outline, n = fin
            tips = resample(outline, n)
            base = []; tv = []
            tp = float(FS.pchip(sp["TOP"], 1.0)); bt = float(FS.pchip(sp["BOT"], 1.0))
            for i in range(n):
                f = i / (n - 1); e = abs(2 * f - 1)
                x = 0.985 - 0.035 * e ** 2
                y = (tp - 0.01) * (1 - f) + (bt + 0.01) * f
                y = float(FS.pchip(sp["TOP"], x)) * (1 - f) + float(FS.pchip(sp["BOT"], x)) * f
                y = y * 0.9 + 0.1 * (tp + bt) / 2
                base.append(F.M(x, y, 0.0)); tv.append(F.M(tips[i][0], tips[i][1], 0.0))
            strip(base, tv, variant, pleat=0.004, mids=1)
        elif kind in ("P", "V"):
            _, variant, x, yn, L, down, out, spread, shape, n, blen = fin
            for side in (1, -1):
                X, Y, nx, ny = F.surf(x, yn, side)
                a, b = math.radians(down), math.radians(out)
                D = Vector((side * math.sin(b), -math.sin(a) * math.cos(b), math.cos(a) * math.cos(b)))       # SL axes (X, y, x = backwards)
                B0 = Vector((0.0, math.cos(a), math.sin(a)))
                B = (B0 - D * B0.dot(D)).normalized()
                base = []; tv = []
                for i in range(n):
                    f = i / max(n - 1, 1)
                    ph = math.radians(spread) * (0.5 - f)       # f=0: upper/leading ray
                    if shape == "point":
                        ln = L * (0.45 + 0.55 * math.exp(-((f - 0.18) / 0.32) ** 2))
                    elif shape == "spine":
                        ln = L * (1.0 if i == 0 else 0.62 + 0.25 * math.sin(math.pi * f))
                    else:
                        ln = L * (0.62 + 0.38 * math.sin(math.pi * min(1.0, f * 0.85 + 0.15)))
                    dirv = (D * math.cos(ph) + B * math.sin(ph)).normalized()
                    bp = Vector((X - nx * 0.004, Y - ny * 0.004, x)) + B * (blen * (0.5 - f))
                    tp = bp + dirv * ln
                    base.append(F.M(bp.z, bp.y, bp.x)); tv.append(F.M(tp.z, tp.y, tp.x))
                if side < 0:
                    base.reverse(); tv.reverse()
                strip(base, tv, variant, pleat=0.0025, mids=1)
    # eyes: domes set into the head, looking along the surface normal (slightly forward)
    ex, ey, er = sp["EYE"]
    th_eye = None
    for side in (1, -1):
        th = np.linspace(0, math.pi, 721)
        X, Y, yc, top, bot, w = FS.section(sp, np.full_like(th, ex), th)
        j = int(np.argmin(np.abs(Y - ey)))
        j = min(max(j, 1), len(th) - 2)
        tx, ty = X[j + 1] - X[j - 1], Y[j + 1] - Y[j - 1]
        nrm = Vector((-ty, tx, 0.0)).normalized()
        nrm = Vector((nrm.x * side, nrm.y, -0.12)).normalized()         # (X, y, x): looks slightly forward
        c = Vector((X[j] * side, Y[j], ex)) - nrm * (0.42 * er)
        up = Vector((0, 1, 0)); t1 = up.cross(nrm).normalized(); t2 = nrm.cross(t1)
        seg, rr = 10, 3
        pole = vert(F.M(c.z + nrm.z * er, c.y + nrm.y * er, c.x + nrm.x * er), px_uv(cell, FP.EYE_X + 32, FP.EYE_Y + 32))
        prev = None
        eye_c = G(*F.M(c.z, c.y, c.x))
        eye_faces = []
        for k in range(1, rr + 1):
            a = math.radians(100) * k / rr
            row = []
            for s in range(seg):
                ph = 2 * math.pi * s / seg
                q = c + (nrm * math.cos(a) + (t1 * math.cos(ph) + t2 * math.sin(ph)) * math.sin(a)) * er
                rad = 31 * (a / math.radians(100)) * 1.0
                uu = FP.EYE_X + 32 + rad * math.cos(ph)
                vv = FP.EYE_Y + 32 - rad * math.sin(ph)
                row.append(vert(F.M(q.z, q.y, q.x), px_uv(cell, uu, vv)))
            if prev is None:
                for s in range(seg):
                    t = (s + 1) % seg
                    fc = bm.faces.new((pole, row[s], row[t])); fc.smooth = True; fc.material_index = mi_body; eye_faces.append(fc)
            else:
                for s in range(seg):
                    t = (s + 1) % seg
                    fc = bm.faces.new((prev[s], prev[t], row[t], row[s])); fc.smooth = True; fc.material_index = mi_body; eye_faces.append(fc)
            prev = row
        for fc in eye_faces:
            fc.normal_update()
            if fc.normal.dot(fc.calc_center_median() - eye_c) < 0:
                fc.normal_flip()
    # barbels: tapered tubes that reach out, droop and trail back
    for (bx, byn, bside, L, r, down, out, fwd) in sp["BARBELS"]:
        for side in (1, -1):
            X, Y, nx, ny = F.surf(bx, byn, side)
            p0 = Vector((X * bside, Y, bx))
            a, b = math.radians(down), math.radians(out)
            d = Vector((side * math.sin(b) * math.cos(a), -math.sin(a), -math.cos(b) * math.cos(a)))   # (X, y, x): out, down, forward
            curl = 0.6 if L > 0.1 else 0.3
            ns = 6 if L > 0.1 else 3
            pts = []
            for k in range(ns + 1):
                t = k / ns
                pts.append(p0 + d * (L * t) + Vector((side * 0.12 * L * t * t, -0.3 * L * t * t, curl * L * t * t)))
            rings = []
            for k, p in enumerate(pts):
                q = pts[min(k + 1, ns)] - pts[max(k - 1, 0)]
                rad = r * (1 - 0.7 * k / ns)
                rp = ring_pts(p, q, rad, 5, Vector((0, 1, 0)))
                rings.append([vert(F.M(pp.z, pp.y, pp.x), px_uv(cell, FP.BARB_X + 30, FP.BARB_Y + 30)) for pp in rp])
            for ra, rb in zip(rings[:-1], rings[1:]):
                for j in range(5):
                    k2 = (j + 1) % 5
                    fc = bm.faces.new((ra[j], ra[k2], rb[k2], rb[j])); fc.smooth = True; fc.material_index = mi_body
                    fc.normal_update()
                    ax = G(*F.M(0.5 * (pts[0].z + pts[-1].z), 0, 0))
                    mid = (G(*F.M(pts[rings.index(ra)].z, pts[rings.index(ra)].y, pts[rings.index(ra)].x)))
                    if fc.normal.dot(fc.calc_center_median() - mid) < 0:
                        fc.normal_flip()
    for f in bm.faces:
        if f.material_index in (mi_fin, mi_body) and f.loops[0].vert in vuv:
            for l in f.loops:
                l[uvl].uv = vuv[l.vert]


def build_species(F, mat_body, mat_fin):
    me = build_body(F)
    bm = bmesh.new(); bm.from_mesh(me)
    uvl = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.material_index = 0; f.smooth = True
    add_fins(F, bm, uvl, 1, 0)
    bpy.data.meshes.remove(me)
    ob = new_obj("fish_" + F.key + "_mesh", bm, [mat_body, mat_fin])
    root = bpy.data.objects.new("fish_" + F.key, None)
    root["refCm"] = 100.0     # model length 1.0 = 100 cm: client scale = catchCm / refCm
    root["kindIndex"] = F.idx + 1
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
    mb = tex_material("M_fish", img, 0.38, False)
    mf = tex_material("M_fin", fimg, 0.5, True)
    objs = []; tris = {}
    for i, k in enumerate(FS.ORDER):
        root, ob = build_species(Fish(k, i), mb, mf)
        ob.data.calc_loop_triangles(); tris[k] = len(ob.data.loop_triangles)
        objs += [root, ob]
    print("TRIS", tris, "TOTAL", sum(tris.values()))
    export_glb(out, selection=objs, animations=False, export_image_format="AUTO", export_extras=True)
    patch_glb(out)
    print("EXPORTED", out, os.path.getsize(out))


main()
