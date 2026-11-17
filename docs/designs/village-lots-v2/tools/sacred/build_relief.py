# Height map (16-bit PNG, 0.2 m full scale) + mask -> closed relief mesh (front surface + side skirt + flat back) as STL.
#   blender -b --factory-startup -P build_relief.py -- <height.png> <mask.png> <height_m_of_image> <out.stl> [grid_w]
import bpy, bmesh, sys, os
import numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
hp, mp, Hm, out = os.path.abspath(a[0]), os.path.abspath(a[1]), float(a[2]), os.path.abspath(a[3])
GW = int(a[4]) if len(a) > 4 else 420
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
him = bpy.data.images.load(hp); mim = bpy.data.images.load(mp)
for im in (him, mim): im.colorspace_settings.name = "Non-Color"
W0, H0 = him.size


def arr(im):
    p = np.empty(W0 * H0 * 4, np.float32); im.pixels.foreach_get(p); return p.reshape(H0, W0, 4)[..., 0]  # bottom-up rows


h = arr(him) * 0.2; m = arr(mim) > 0.5
GH = int(GW * H0 / W0)
xi = (np.arange(GW) * (W0 - 1) / (GW - 1)).astype(int); yi = (np.arange(GH) * (H0 - 1) / (GH - 1)).astype(int)
hs = h[np.ix_(yi, xi)]; ms = m[np.ix_(yi, xi)]
Wm = Hm * W0 / H0
bm = bmesh.new()
V = {}
for j in range(GH):
    for i in range(GW):
        if ms[j, i]:
            V[(i, j)] = bm.verts.new((Wm * (i / (GW - 1) - 0.5), -float(hs[j, i]), Hm * j / (GH - 1)))
for j in range(GH - 1):
    for i in range(GW - 1):
        q = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
        if all(k in V for k in q):
            bm.faces.new([V[k] for k in q])
# skirt + back: extrude the open boundary back to y = 0 and cap it
bound = [e for e in bm.edges if e.is_boundary]
r = bmesh.ops.extrude_edge_only(bm, edges=bound)
for v in [g for g in r["geom"] if isinstance(g, bmesh.types.BMVert)]: v.co.y = 0.0
nb = [e for e in bm.edges if e.is_boundary]
try: bmesh.ops.holes_fill(bm, edges=nb, sides=0)
except Exception as ex: print("cap", ex)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
me = bpy.data.meshes.new("relief"); bm.to_mesh(me); bm.free()
o = bpy.data.objects.new("relief", me); bpy.context.scene.collection.objects.link(o)
for x in bpy.context.scene.objects: x.select_set(x == o)
bpy.ops.wm.stl_export(filepath=out, export_selected_objects=True, ascii_format=False)
print("RELIEF tris", len(me.polygons), "size", round(Wm, 3), round(Hm, 3))
