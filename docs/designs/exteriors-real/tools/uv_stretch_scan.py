"""
Stretched-UV detector (feat/exteriors-real): for every GLB given, every mesh face's texel density and anisotropy on UV map 0
against its material's median, written as JSON.

  blender -b -t 4 --factory-startup -P uv_stretch_scan.py -- <out.json> <a.glb> [b.glb ...]

Per face: J = the 2x2 map from the face's own plane (metres) to UV; s1 >= s2 its singular values.
  density   = sqrt(s1 * s2)          UV units per metre (geometric mean)
  aniso     = s1 / s2                1 = square texels; > 2.5 = visibly stretched one way
A face is a HIT when it is big enough to see (>= 0.04 m2), its material has a real texture (not a flat atlas swatch) and
  aniso > 2.5, or density < median / 4 (blurry, blown up), or density > median * 6 (over-tiled / squashed).
Faces whose UV area is ~0 on a textured material are listed as "collapsed" (a single texel stretched over the face: flat colour).
Results per (file, object, material): face count, hit area, worst values, a sample world position.
"""
import bpy, bmesh, sys, json, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
out_path, files = argv[0], argv[1:]
MIN_AREA = 0.04
report = {"files": {}}


def mat_has_texture(mat):
    if not mat or not mat.use_nodes:
        return False
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image is not None:
            # a texture only feeding a lightmap-ish (2nd UV) input still counts; the GLB importer wires baseColor
            for l in n.outputs[0].links:
                if l.to_socket.name in ("Base Color", "Color", "Fac", "A", "B"):
                    return True
    return False


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else 0.0


for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.gltf(filepath=f)
    except Exception as e:  # noqa
        report["files"][os.path.basename(f)] = {"error": str(e)}
        continue
    rows = []
    per_mat_density = {}
    faces_all = []
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or not ob.data.uv_layers:
            continue
        if ob.name.startswith("col__"):
            continue
        me = ob.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.transform(ob.matrix_world)
        uvl = bm.loops.layers.uv[0]
        for face in bm.faces:
            area = face.calc_area()
            if area < 1e-6 or len(face.loops) < 3:
                continue
            mi = face.material_index
            mat = ob.material_slots[mi].material if mi < len(ob.material_slots) else None
            mname = mat.name if mat else "-"
            # triangle fan; use the first triangle with a good angle for the Jacobian, the whole face for areas
            ls = face.loops
            p0, p1, p2 = ls[0].vert.co, ls[1].vert.co, ls[2].vert.co
            u0, u1, u2 = ls[0][uvl].uv, ls[1][uvl].uv, ls[2][uvl].uv
            e1, e2 = p1 - p0, p2 - p0
            n = e1.cross(e2)
            if n.length < 1e-9:
                continue
            ax = e1.normalized()
            ay = n.normalized().cross(ax)
            # plane coords
            a = (e1.dot(ax), e1.dot(ay))
            b = (e2.dot(ax), e2.dot(ay))
            du1, du2 = u1 - u0, u2 - u0
            det = a[0] * b[1] - a[1] * b[0]
            if abs(det) < 1e-12:
                continue
            # J * [a b] = [du1 du2]  ->  J = [du1 du2] * inv([a b])
            inv = ((b[1] / det, -b[0] / det), (-a[1] / det, a[0] / det))
            J00 = du1.x * inv[0][0] + du2.x * inv[1][0]
            J01 = du1.x * inv[0][1] + du2.x * inv[1][1]
            J10 = du1.y * inv[0][0] + du2.y * inv[1][0]
            J11 = du1.y * inv[0][1] + du2.y * inv[1][1]
            # singular values of a 2x2
            E = (J00 + J11) / 2; F = (J00 - J11) / 2; G = (J10 + J01) / 2; H = (J10 - J01) / 2
            Q = math.hypot(E, H); R = math.hypot(F, G)
            s1, s2 = Q + R, abs(Q - R)
            dens = math.sqrt(s1 * s2) if s2 > 0 else 0.0
            aniso = s1 / s2 if s2 > 1e-9 else 1e9
            c = face.calc_center_median()
            faces_all.append((ob.name, mname, area, dens, aniso, (round(c.x, 2), round(c.y, 2), round(c.z, 2)), mat_has_texture(mat)))
            if area >= MIN_AREA and dens > 1e-6:
                per_mat_density.setdefault(mname, []).append(dens)
        bm.free()
    med = {m: median(v) for m, v in per_mat_density.items()}
    groups = {}
    for (obn, m, area, dens, aniso, c, tex) in faces_all:
        if area < MIN_AREA:
            continue
        md = med.get(m, 0)
        kind = None
        if dens < 1e-4:
            if not tex:
                continue
            kind = "collapsed"
        elif aniso > 2.5 and aniso < 1e8:
            kind = "stretched"
        elif md and dens < md / 4:
            kind = "blurry"
        elif md and dens > md * 6:
            kind = "overtiled"
        if not kind:
            continue
        k = (obn, m, kind)
        g = groups.setdefault(k, {"object": obn, "material": m, "kind": kind, "faces": 0, "area": 0.0, "worst_aniso": 0.0, "min_density": 1e9, "median_density": round(md, 3), "at": c})
        g["faces"] += 1
        g["area"] += area
        g["worst_aniso"] = max(g["worst_aniso"], min(aniso, 999))
        g["min_density"] = min(g["min_density"], dens)
    rows = sorted(groups.values(), key=lambda g: -g["area"])
    for r in rows:
        r["area"] = round(r["area"], 2)
        r["worst_aniso"] = round(r["worst_aniso"], 2)
        r["min_density"] = round(r["min_density"], 4)
    report["files"][os.path.basename(f)] = {"medians": {m: round(v, 3) for m, v in med.items()}, "hits": rows}
    print("SCAN", os.path.basename(f), len(rows), "groups", flush=True)

with open(out_path, "w") as fh:
    json.dump(report, fh, indent=1)
print("DONE", out_path)
