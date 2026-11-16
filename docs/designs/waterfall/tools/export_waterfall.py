"""Re-export waterfall.glb from bake_waterfall.py's saved export scene (no re-bake: the light maps stay valid while the
geometry and its UV_LM do not change). Same images caps and glTF settings as bake_waterfall.py.

  blender -b art/village/work/falls_w3_export.blend -P art/village/tools/export_waterfall.py
"""
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(os.path.dirname(HERE), "work")
TEX_MAX = 512
TEX_MAX_BY_NAME = {"T_bark": 256}

for m in bpy.data.materials:
    if not (m.users and m.node_tree and "falls" in m):
        continue
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            im = n.image
            w, h = im.size
            cap = next((v for k, v in TEX_MAX_BY_NAME.items() if im.name.startswith(k)), TEX_MAX)
            if max(w, h) > cap:
                im.scale(min(w, cap), min(h, cap))
coll = [c for c in bpy.data.collections if c.name in ("waterfall_w1", "falls_water")]
sel = [o for c in coll for o in c.objects if o.type in ("MESH", "EMPTY")]
for o in bpy.context.view_layer.objects:
    o.select_set(False)
for o in sel:
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = sel[0]
glb = os.path.join(WORK, "waterfall.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_texcoords=True, export_normals=False, export_materials="EXPORT", export_image_format="WEBP",
                          export_image_quality=70, export_animations=False, export_cameras=False, export_lights=False,
                          export_extras=True, export_skins=False, export_morph=False, export_vertex_color="ACTIVE",
                          export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
                          export_tangents=False, export_gpu_instances=True,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
                          export_draco_position_quantization=14, export_draco_normal_quantization=8,
                          export_draco_texcoord_quantization=11, export_draco_color_quantization=8,
                          export_draco_generic_quantization=12)
print("[falls-w3] GLB", glb, os.path.getsize(glb))
