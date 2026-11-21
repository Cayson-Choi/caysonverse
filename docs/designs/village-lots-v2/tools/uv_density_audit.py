"""Flag stretched / very low texel-density faces in a GLB (gateuv sweep).
blender -b --factory-startup -t 4 -P uv_density_audit.py -- <in.glb> <out.json> [uv_layer=0]
Per triangle: u = |dUV|/|dXYZ| along the two UV axes (singular values of the Jacobian). stretch = smax/smin, density = sqrt(smin*smax).
A face is flagged when stretch > 2.5 or density < 0.35 x its material's median (area-weighted)."""
import bpy, sys, json, math
import numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
rows = []
for ob in bpy.context.scene.objects:
    if ob.type != "MESH" or ob.name.startswith(("col", "lotnight", "lotshell_col")):
        continue
    me = ob.data
    li = int(a[2]) if len(a) > 2 else 0
    if len(me.uv_layers) <= li:
        continue
    uvl = me.uv_layers[li].data
    mw = ob.matrix_world
    me.calc_loop_triangles()
    for t in me.loop_triangles:
        P = [np.array(mw @ me.vertices[me.loops[l].vertex_index].co) for l in t.loops]
        U = [np.array(uvl[l].uv) for l in t.loops]
        e1, e2 = P[1] - P[0], P[2] - P[0]
        d1, d2 = U[1] - U[0], U[2] - U[0]
        area = np.linalg.norm(np.cross(e1, e2)) / 2
        if area < 1e-4:
            continue
        # Jacobian J (2x3 world->uv) via least squares: [e1;e2] J^T = [d1;d2]
        E = np.array([e1, e2]); D = np.array([d1, d2])
        n = np.cross(e1, e2); n /= np.linalg.norm(n)
        E3 = np.vstack([E, n])
        D3 = np.vstack([D, [0, 0]])
        J = np.linalg.solve(E3, D3)  # 3x2: world -> uv
        s = np.linalg.svd(J, compute_uv=False)
        smax, smin = s[0], max(s[1], 1e-9)
        c = (P[0] + P[1] + P[2]) / 3
        mat = ob.material_slots[t.material_index].material.name if ob.material_slots else "?"
        rows.append((ob.name, mat, float(area), float(smax), float(smin), [round(float(x), 2) for x in c]))
by = {}
for r in rows:
    by.setdefault(r[1], []).append(r)
out = []
for m, rs in by.items():
    dens = np.array([math.sqrt(r[3] * r[4]) for r in rs]); w = np.array([r[2] for r in rs])
    o = np.argsort(dens); cw = np.cumsum(w[o]); med = dens[o][np.searchsorted(cw, cw[-1] / 2)]
    for r, d in zip(rs, dens):
        st = r[3] / r[4]
        if (st > 2.5 or d < 0.35 * med) and r[2] > 0.02 and not m.startswith(("M_glass", "M_lamp", "M_sign")):
            out.append({"obj": r[0], "mat": m, "area": round(r[2], 3), "stretch": round(st, 2), "dens_vs_median": round(d / med, 2), "at": r[5]})
out.sort(key=lambda x: -x["area"] * max(x["stretch"], 1 / max(x["dens_vs_median"], 1e-3)))
json.dump({"n_tris": len(rows), "flagged": out}, open(a[1], "w"), indent=1)
print("AUDIT", a[0], len(rows), "tris", len(out), "flagged")
