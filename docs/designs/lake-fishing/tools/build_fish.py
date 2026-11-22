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
import fish_photo as PH

N_TH = 64
# v2 (lake v2): rounder silhouettes up close; LOD1 (`fish_<id>_lod1`) for anglers far away
BODY_TRIS = {"eel": 1500, "catfish": 2100, "korean_bullhead": 2100, "snakehead": 2000, "minnow": 2000}
BODY_TRIS_DEFAULT = 2400
LOD1_TRIS = 520
# the photo is sampled this far toward the body's middle line (the outline's edge pixels are often background)
INSET = 0.9
# hotfix 2026-11-17: the body a little thicker than the traced widths (the photos are side on; a caught fish held up reads flat)
BODY_WIDE = 1.15
# fins: the half-thickness at the base (model units: the fish is 1.0 long), thinning to nothing at the edge
FIN_THICK = 0.0045
UV_X_MAX = 0.995      # the body's photo ends where the traced tail fin begins: the stalk's last rings repeat its last column
FIN_EMB = 0.03        # dorsal / anal: how deep (SL) the fin base sits inside the body
FIN_EMB_P = 0.012     # paired fins
STALK_TAPER = 0.55     # the peduncle's width at its end, as a loss (0.55 -> 45 % of the traced width)
ATLAS_W, ATLAS_H = FP.ATLAS_W, FP.ATLAS_H


def body_uv(cell, u, v):
    ox, oy = FP.cell_origin(cell)
    return ((ox + u * (FP.CW - 1) + 0.5) / ATLAS_W, 1.0 - (oy + v * (FP.BH - 1) + 0.5) / ATLAS_H)


def px_uv(cell, x, y):
    ox, oy = FP.cell_origin(cell)
    return ((ox + x) / ATLAS_W, 1.0 - (oy + y) / ATLAS_H)


def photo_uv(cell, x, Y):
    """SL point -> the species' photo cell (fish_photo.py: the projection the shapes were traced in)."""
    ox, oy = PH.cell_origin(cell)
    px, py = PH.to_px(x, Y)
    return ((ox + float(px)) / PH.AW, 1.0 - (oy + float(py)) / PH.AH)


def eye_uv(cell, dx, dy):
    """the painted eye (fish_photo.py: 64 px at the cell's bottom-right), dx / dy px from its centre."""
    ox, oy = PH.cell_origin(cell)
    cx = PH.CW - PH.EYE / 2 - 2; cy = PH.CH - PH.EYE / 2 - 2
    return ((ox + cx + dx) / PH.AW, 1.0 - (oy + cy + dy) / PH.AH)


def swatch_uv(cell, k):
    """k 0: mouth cavity, 1: lips / barbels (fish_photo.py swatches at the cell's bottom-left)."""
    ox, oy = PH.cell_origin(cell)
    return ((ox + PH.SW * k + PH.SW / 2) / PH.AW, 1.0 - (oy + PH.CH - PH.SW / 2) / PH.AH)


def inset_y(sp, x, Y):
    top = float(FS.pchip(sp["TOP"], min(max(x, 0.0), FS.X_END))); bot = float(FS.pchip(sp["BOT"], min(max(x, 0.0), FS.X_END)))
    mid = 0.5 * (top + bot)
    return mid + (Y - mid) * INSET


def fin_uv(cell, variant, u, t):
    fx, fy = FP.fin_origin(cell, variant)
    return ((fx + u * FP.FCW) / FP.FIN_W, 1.0 - (fy + (FP.FBH - 1.5) - t * (FP.FBH - 3)) / FP.FIN_H)


class Fish:
    def __init__(self, key, idx, eyes=None):
        self.key, self.idx = key, idx
        self.sp = dict(FS.SPECIES[key])
        if eyes and key in eyes:     # v2: the eye dome sits on the photo's own eye (fish_photo.py eyes.json)
            ex, ey, er = self.sp["EYE"]
            self.sp["EYE"] = (eyes[key][0], eyes[key][1], er)
        # hotfix 2026-11-17 (owner: "좀더 입체적으로 실감나게"): more volume — a thicker body, a fuller (rounder) section with a
        # defined belly, a raised gill-cover ridge
        sp = self.sp
        sp["WID"] = [(x, w * BODY_WIDE) for x, w in sp["WID"]]
        sp["NT"] = [(x, n + 0.2) for x, n in sp["NT"]]
        sp["NB"] = [(x, n + 0.35) for x, n in sp["NB"]]
        ox, ob, oh = sp["OP"]
        sp["OP"] = (ox, ob, oh * 1.7)
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
        tp = 1.0 - STALK_TAPER * float(FS.smoothstep(0.84, FS.X_END, x))      # the caudal peduncle narrows: the tail fin grows out of it
        X = X * tp
        ring = []
        for j in range(N_TH):
            ring.append(vert(F.M(x, Y[j], X[j]), photo_uv(cell, min(x, UV_X_MAX), inset_y(sp, min(x, UV_X_MAX), Y[j]))))
        rings.append(ring)
    # the tail end closes in a rounded stalk instead of a flat cut (the caudal fin rays start inside it)
    xe = FS.X_END
    for cx, cs in ((xe + 0.012, 0.8), (xe + 0.026, 0.6), (xe + 0.04, 0.36), (xe + 0.05, 0.14)):
        xa = np.full_like(th, xe)
        X, Y, yc, top, bot, w = FS.section(sp, xa, th)
        tp = 1.0 - STALK_TAPER
        ring = []
        for j in range(N_TH):
            ring.append(vert(F.M(cx, yc[j] + (Y[j] - yc[j]) * cs, X[j] * tp * cs), photo_uv(cell, UV_X_MAX, inset_y(sp, UV_X_MAX, Y[j]))))
        rings.insert(0, ring)
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
            ring.append(vert(F.M(x, Y, X), photo_uv(cell, max(x, 0.004), Y) if k < 2 else swatch_uv(cell, 0)))
        lip.append(ring)
    pre = []
    for j in range(N_TH):
        v = th[j] / math.pi if th[j] <= math.pi else (2 * math.pi - th[j]) / math.pi
        X = 0.5 * X4[j] + 0.5 * m["w"] * 1.15 * math.sin(th[j]); Y = 0.5 * Y4[j] + 0.5 * (m["y"] + m["h"] * 1.15 * math.cos(th[j]))
        pre.append(vert(F.M(x4 + m["fwd"], Y, X), photo_uv(cell, x4, Y)))
    rings += [pre] + lip
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(N_TH):
            k = (j + 1) % N_TH
            f = bm.faces.new((a[j], a[k], b[k], b[j])); f.smooth = True
    cin = vert(F.M(0.05, m["y"], 0.0), swatch_uv(cell, 0))
    for j in range(N_TH):
        k = (j + 1) % N_TH
        f = bm.faces.new((rings[-1][j], rings[-1][k], cin)); f.smooth = True
    yct = 0.5 * (FS.pchip(sp["TOP"], FS.X_END) + FS.pchip(sp["BOT"], FS.X_END))
    ctl = vert(F.M(FS.X_END + 0.056, yct, 0.0), photo_uv(cell, UV_X_MAX, yct))
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


def add_fins(F, bm, uvl, mi_fin, mi_body, mi_photo=2):
    sp = F.sp; cell = F.idx; T = F.TL
    vuv = {}

    def vert(p, uv):
        v = bm.verts.new(G(*p)); vuv[v] = uv; return v

    def strip(base, tips, variant, pleat=0.004, mids=4, nray=None, curl=0.0, emb=0.0, spine=False, seed=0):
        """A fin: columns i run from the base (inside the body) to the ray tips (glTF Vectors); `nray` rays, two columns per ray (the
        ray itself, then the membrane between it and the next: shorter, so the trailing edge is scalloped, and sunk a little, so the
        membrane is pleated between raised rays). `emb` = how far (SL) the base sits inside the body: the texture starts where the
        fin leaves the body. `curl` bends the fin sideways toward its tip (a fin is never flat). `spine`: a stiff leading spine."""
        n = len(base); rows = []
        nr = nray or max(2, (n + 1) // 2)
        rng = np.random.RandomState(31 + seed)
        jit = rng.rand(n)
        nrm = []
        for i in range(n):
            a = tips[i] - base[i]; b = base[min(i + 1, n - 1)] - base[max(i - 1, 0)]
            c = a.cross(b)
            nrm.append(c.normalized() if c.length > 1e-9 else Vector((1, 0, 0)))
        for r in range(mids + 2):
            t = r / (mids + 1); row = []
            for i in range(n):
                f = i / max(n - 1, 1)
                is_ray = (i % 2 == 0)
                ln_f = 1.0 - (0.0 if is_ray else 0.05) - 0.025 * jit[i]
                if spine and i == 0:
                    ln_f = 1.0
                d = tips[i] - base[i]
                p = base[i] + d * (t * ln_f)
                t0 = min(0.6, emb / max(1e-6, d.length * T))
                ut = max(0.0, (t * ln_f - t0) / (1.0 - t0))
                ramp = float(FS.smoothstep(0.0, 0.4, t))
                amp = (pleat / T) * (0.5 if is_ray else -0.5) * ramp
                if spine and i <= 1:
                    amp = (pleat / T) * (1.4 if i == 0 else 0.2) * ramp
                p = p + nrm[i] * amp
                if curl:
                    p = p + Vector((1, 0, 0)) * curl * (t * t) * d.length
                uv = fin_uv(cell, variant, (f * (nr - 1) + 0.5) / FP.NRAY, min(1.0, ut))
                row.append(vert(p, uv))
            rows.append(row)
        for a, b in zip(rows[:-1], rows[1:]):
            for i in range(n - 1):
                f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i])); f.smooth = True; f.material_index = mi_fin
        return rows

    # lie along the body (the traced angles were for fins spread wide): pectorals fold back against the flank, pelvics under the belly
    def lie(kind, down, out):
        return (down * 0.55, max(11.0, out * 0.5)) if kind == "P" else (down * 0.6, max(14.0, out * 0.7))

    for fin in sp["FINS"]:
        kind = fin[0]
        if kind in ("D", "A"):
            _, variant, x0, x1, outline, n = fin
            n = min(n, FP.NRAY)
            m = 2 * (n - 1) + 1
            tips = resample(outline, m)
            base = []; tv = []
            for i in range(m):
                x = x0 + (x1 - x0) * i / max(m - 1, 1)
                if kind == "D":
                    y = float(FS.pchip(sp["TOP"], x)) - FIN_EMB
                else:
                    y = float(FS.pchip(sp["BOT"], x)) + FIN_EMB
                base.append(F.M(x, y, 0.0)); tv.append(F.M(tips[i][0], tips[i][1], 0.0))
            strip(base, tv, variant, pleat=0.004 if n > 6 else 0.0025, nray=n, curl=0.05, emb=FIN_EMB, spine=True, seed=sum(map(ord, F.key + kind)) % 97)
        elif kind == "C":
            _, variant, outline, n = fin
            m = 2 * (n - 1) + 1
            tips = resample(outline, m)
            base = []; tv = []
            for i in range(m):
                f = i / (m - 1); e = abs(2 * f - 1)
                x = 0.925 - 0.03 * e ** 2
                top = float(FS.pchip(sp["TOP"], x)); bot = float(FS.pchip(sp["BOT"], x))
                mid = 0.5 * (top + bot); hh = 0.5 * (top - bot) * 0.78
                y = mid + hh * (1 - 2 * f)
                base.append(F.M(x, y, 0.0)); tv.append(F.M(tips[i][0], tips[i][1], 0.0))
            strip(base, tv, variant, pleat=0.005, nray=n, curl=0.04, emb=0.125, seed=7 + F.idx)
        elif kind in ("P", "V"):
            _, variant, x, yn, L, down, out, spread, shape, n, blen = fin
            down, out = lie(kind, down, out)
            for side in (1, -1):
                X, Y, nx, ny = F.surf(x, yn, side)
                a, b = math.radians(down), math.radians(out)
                D = Vector((side * math.sin(b), -math.sin(a) * math.cos(b), math.cos(a) * math.cos(b)))       # SL axes (X, y, x = backwards)
                B0 = Vector((0.0, math.cos(a), math.sin(a)))
                B = (B0 - D * B0.dot(D)).normalized()
                base = []; tv = []
                m = 2 * (n - 1) + 1
                for i in range(m):
                    f = i / max(m - 1, 1)
                    ph = math.radians(spread * 0.75) * (0.5 - f)       # f=0: upper/leading ray
                    if shape == "point":
                        ln = L * (0.45 + 0.55 * math.exp(-((f - 0.18) / 0.32) ** 2))
                    elif shape == "spine":
                        ln = L * (1.0 if f < 0.5 / max(n - 1, 1) else 0.62 + 0.25 * math.sin(math.pi * f))
                    else:
                        ln = L * (0.62 + 0.38 * math.sin(math.pi * min(1.0, f * 0.85 + 0.15)))
                    dirv = (D * math.cos(ph) + B * math.sin(ph)).normalized()
                    bp = Vector((X - nx * FIN_EMB_P, Y - ny * FIN_EMB_P, x)) + B * (blen * (0.5 - f))
                    tp = bp + dirv * (ln + FIN_EMB_P)
                    base.append(F.M(bp.z, bp.y, bp.x)); tv.append(F.M(tp.z, tp.y, tp.x))
                if side < 0:
                    base.reverse(); tv.reverse()
                strip(base, tv, variant, pleat=0.003, nray=n, curl=0.05 * side, emb=FIN_EMB_P, spine=(side > 0 and (shape == "spine" or F.key in ("carp", "mirror_carp", "bass"))), seed=3 + F.idx)
    # eyes: domes set into the head, looking along the surface normal (slightly forward)
    ex, ey, er = sp["EYE"]
    photo_eye = F.key != "eel"     # the eel's cell is painted: its dome wears the painted eye
    th_eye = None
    for side in (1, -1):
        th = np.linspace(0, math.pi, 721)
        X, Y, yc, top, bot, w = FS.section(sp, np.full_like(th, ex), th)
        j = int(np.argmin(np.abs(Y - ey)))
        j = min(max(j, 1), len(th) - 2)
        tx, ty = X[j + 1] - X[j - 1], Y[j + 1] - Y[j - 1]
        nrm = Vector((-ty, tx, 0.0)).normalized()
        nrm = Vector((nrm.x * side, nrm.y, -0.12)).normalized()         # (X, y, x): looks slightly forward
        c = Vector((X[j] * side, Y[j], ex)) - nrm * (0.42 * er)       # hotfix: a proud domed eye (was 0.68: set in, flat from the side)
        up = Vector((0, 1, 0)); t1 = up.cross(nrm).normalized(); t2 = nrm.cross(t1)
        seg, rr = 10, 3
        pole = vert(F.M(c.z + nrm.z * er, c.y + nrm.y * er, c.x + nrm.x * er), photo_uv(cell, ex, ey) if photo_eye else eye_uv(cell, 0, 0))
        prev = None
        eye_c = G(*F.M(c.z, c.y, c.x))
        eye_faces = []
        for k in range(1, rr + 1):
            a = math.radians(100) * k / rr
            row = []
            for s in range(seg):
                ph = 2 * math.pi * s / seg
                q = c + (nrm * math.cos(a) + (t1 * math.cos(ph) + t2 * math.sin(ph)) * math.sin(a)) * er
                rad = 31 * (a / math.radians(100))
                # the photo's own eye, projected flat (a slightly enlarged disc so its iris rim reaches the dome's edge)
                uv = photo_uv(cell, ex + (q.z - ex) * 0.92, ey + (q.y - ey) * 0.92) if photo_eye else eye_uv(cell, rad * math.cos(ph), -rad * math.sin(ph))
                row.append(vert(F.M(q.z, q.y, q.x), uv))
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
                rings.append([vert(F.M(pp.z, pp.y, pp.x), swatch_uv(cell, 1)) for pp in rp])
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
        if f.material_index in (mi_fin, mi_body, mi_photo) and f.loops[0].vert in vuv:
            for l in f.loops:
                l[uvl].uv = vuv[l.vert]


def build_species(F, mats):
    me = build_body(F)
    bm = bmesh.new(); bm.from_mesh(me)
    uvl = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.material_index = 0; f.smooth = True
    add_fins(F, bm, uvl, 1, 0, 2)
    bpy.data.meshes.remove(me)
    ob = new_obj("fish_" + F.key + "_mesh", bm, mats)
    root = bpy.data.objects.new("fish_" + F.key, None)
    root["refCm"] = 100.0     # model length 1.0 = 100 cm: client scale = catchCm / refCm
    root["kindIndex"] = F.idx + 1
    bpy.context.scene.collection.objects.link(root)
    ob.parent = root
    # LOD1: the same fish collapsed to LOD1_TRIS (an angler far away)
    lod = ob.copy(); lod.data = ob.data.copy(); lod.name = "fish_" + F.key + "_lod1"
    bpy.context.scene.collection.objects.link(lod)
    lod.parent = root
    ob.data.calc_loop_triangles(); n = len(ob.data.loop_triangles)
    md = lod.modifiers.new("dec", "DECIMATE")
    md.decimate_type = "COLLAPSE"; md.ratio = min(1.0, LOD1_TRIS / n); md.use_symmetry = True; md.symmetry_axis = "X"
    md.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    lme = bpy.data.meshes.new_from_object(lod.evaluated_get(dg))
    lod.modifiers.clear(); old = lod.data; lod.data = lme; bpy.data.meshes.remove(old)
    for i, m in enumerate(mats):
        if i < len(lod.data.materials):
            lod.data.materials[i] = m
    return root, ob, lod


def tex_material(name, img, rough, alpha, normal=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
                break
            except Exception:
                pass
    if normal is not None:
        nt_tex = nt.nodes.new("ShaderNodeTexImage"); nt_tex.image = normal
        nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.inputs["Strength"].default_value = 1.0
        nt.links.new(nt_tex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
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
            m["alphaMode"] = "BLEND"   # v2: see-through membranes with soft edges (fish_photo.py paint_fins_v2)
            m.pop("alphaCutoff", None)
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
    need = ["fish_photo.jpg", "fish_photo_n.jpg", "fish_fins.png", "fish_fins_n.png"]
    for n in need:
        assert os.path.exists(os.path.join(adir, n)), "run fish_paint.py (fish_fins.png) and fish_photo.py first: missing " + n
    img = bpy.data.images.load(os.path.join(adir, "fish_photo.jpg")); img.colorspace_settings.name = "sRGB"
    nimg = bpy.data.images.load(os.path.join(adir, "fish_photo_n.jpg")); nimg.colorspace_settings.name = "Non-Color"
    fimg = bpy.data.images.load(os.path.join(adir, "fish_fins.png")); fimg.colorspace_settings.name = "sRGB"; fimg.alpha_mode = "STRAIGHT"
    mb = tex_material("M_fish", img, 0.32, False, nimg)
    fn = bpy.data.images.load(os.path.join(adir, "fish_fins_n.png")); fn.colorspace_settings.name = "Non-Color"
    mf = tex_material("M_fin", fimg, 0.5, True, fn)
    objs = []; tris = {}; ltris = {}
    ej = os.path.join(adir, "eyes.json")
    eyes = json.load(open(ej)) if os.path.exists(ej) else None
    for i, k in enumerate(FS.ORDER):
        root, ob, lod = build_species(Fish(k, i, eyes), [mb, mf])
        ob.data.calc_loop_triangles(); tris[k] = len(ob.data.loop_triangles)
        lod.data.calc_loop_triangles(); ltris[k] = len(lod.data.loop_triangles)
        objs += [root, ob, lod]
    print("TRIS", tris, "TOTAL", sum(tris.values()))
    print("LOD1", ltris, "TOTAL", sum(ltris.values()))
    # v2: Draco (the client's GLTFLoader has the village's decoder): 36k triangles in ~1/5 of the bytes
    export_glb(out, selection=objs, animations=False, export_image_format="WEBP", export_image_quality=86, export_extras=True,
               export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
               export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=13)
    patch_glb(out)
    print("EXPORTED", out, os.path.getsize(out))


main()
