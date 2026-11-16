"""Export lake_structures.glb from B's structures.blend with the light-map UVs baked by bake_lake_structures.py on UV1 (TEXCOORD_1).

  blender -b art/lake/work/structures.blend -P art/lake/tools/export_lake_structures.py -- --glb art/lake/work/structures_lm.glb

The shared meshes (chairs, stands, benches, picnic tables) become one mesh per object (their light differs); every object's
`UVMap_LM` is replaced by its packed UVs. Loop counts must match the bake's (same source)."""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE_ROOT = os.path.dirname(HERE)
WORK = os.path.join(LAKE_ROOT, "work")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
glb = ARGV[ARGV.index("--glb") + 1]
uvs = np.load(os.path.join(WORK, "structures_lm_uv.npz"))
n_set = 0
for o in list(bpy.data.objects):
    if o.type != "MESH" or o.name not in uvs.files:
        continue
    if o.data.users > 1:
        o.data = o.data.copy()
    me = o.data
    a = uvs[o.name]
    assert len(me.loops) == len(a), (o.name, len(me.loops), len(a))
    layer = me.uv_layers["UVMap_LM"]
    layer.data.foreach_set("uv", a.ravel())
    me.uv_layers.active = me.uv_layers["UVMap"]
    n_set += 1
print("UV1 applied to", n_set, "of", len(uvs.files))
sel = [o for o in bpy.data.objects if not o.users_collection[0].name.startswith("preview")]
bpy.ops.object.select_all(action="DESELECT")
for o in sel:
    o.select_set(True)
kw = dict(filepath=glb, export_format="GLB", use_selection=True, export_extras=True, export_yup=True, export_apply=False, export_image_format="WEBP")
bpy.ops.export_scene.gltf(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10,
                          export_draco_color_quantization=8, export_draco_generic_quantization=12,
                          export_draco_texcoord_quantization=12, **kw)
print("GLB", glb, os.path.getsize(glb))
