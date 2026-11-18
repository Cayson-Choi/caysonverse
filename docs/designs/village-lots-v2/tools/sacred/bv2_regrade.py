# 본존불 v2 — re-grade an existing bake (bv2_bake.py's albedo step, newer formula) without baking again, and re-export the GLB.
#   blender -b <out_dir>/lotstatue__lot_temple_hall_buddha.blend -P bv2_regrade.py -- <out_dir> <old_lo> <old_k>
#   (the old albedo was multiplied by old_lo + (1 - old_lo) * AO; it is divided back out first)
#   blender -b <out_dir>/lotstatue__lot_temple_hall_buddha.blend -P bv2_regrade.py -- <out_dir> reload
#   (the PNGs were edited outside Blender: reload them and export the GLB again)
import bpy, sys, os
import numpy as np
A = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(A[0]); RELOAD = A[1] == "reload"; OLD_LO = 0.0 if RELOAD else float(A[1])
NAME = "lotstatue__lot_temple_hall_buddha"
def load(kind):
    im = bpy.data.images.load(os.path.join(OUT, f"{NAME}_{kind}.png"), check_existing=True); im.reload(); return im
al_i = load("albedo"); ao_i = load("ao"); orm_i = load("orm")
W = al_i.size[0]; T = ao_i.size[0]; k = W // T
px = lambda im: np.array(im.pixels[:], np.float32).reshape(im.size[1], im.size[0], 4)
if not RELOAD:
    al = px(al_i); ao = px(ao_i)[..., 0]; orm = px(orm_i)
    mk = (orm[..., 2] < 0.45).astype(np.float32)          # metal 0 = hair
    aoU = np.repeat(np.repeat(ao, k, 0), k, 1); mkU = np.repeat(np.repeat(mk, k, 0), k, 1)
    tint = np.array([0.97, 0.90, 0.76], np.float32)
    al[..., :3] /= (OLD_LO + (1 - OLD_LO) * aoU)[..., None]
    al[..., :3] *= (0.45 + 0.55 * aoU)[..., None] * (tint * (1 - mkU[..., None]) + mkU[..., None])
    al = np.clip(al, 0, 1)
    al_i.pixels.foreach_set(al.ravel()); al_i.filepath_raw = os.path.join(OUT, f"{NAME}_albedo.png"); al_i.file_format = "PNG"; al_i.save()
for im in bpy.data.images: 
    if im.filepath: im.reload()
lo = bpy.data.objects[NAME]; ph = bpy.data.objects[NAME + "_phone"]
for o in bpy.context.scene.objects: o.select_set(o in (lo, ph))
bpy.context.view_layer.objects.active = lo
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{NAME}.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_image_format="AUTO", export_tangents=False, export_normals=True, export_texcoords=True, export_materials="EXPORT", export_extras=False)
bpy.ops.wm.save_mainfile()
print("REGRADE done")
