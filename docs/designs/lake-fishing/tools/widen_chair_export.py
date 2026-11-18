"""Widen the fishing chair (owner 2026-11-19: "캐릭터 옷이 의자를 살짝 뚫고 나오네": the widest skirts and robes (0.49 m each side) went through the
arm rests) and export lake_structures.glb. The 30 chairs share one mesh (`mesh_fishing_chair`, built by parts_lake_structures.build_chair): every
vertex is on one side (|x| 0.19..0.27), so moving the two halves apart by DX keeps the frame's tubes round and stretches the fabric and the cross
tubes between them; the topology and the loops are unchanged, so the baked light-map UVs (structures_lm_uv.npz) still fit.

  blender -b art/lake/work/structures.blend -P docs/designs/lake-fishing/tools/widen_chair_export.py -- --glb out.glb [--dx 0.27] [--export-script art/lake/tools/export_lake_structures.py]
"""
import os
import sys

import bpy

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


DX = float(opt("--dx", "0.27"))
me = bpy.data.meshes["mesh_fishing_chair"]
for v in me.vertices:
    assert abs(v.co.x) > 0.1, "a centre vertex: the halves rule does not hold"
    v.co.x += DX if v.co.x > 0 else -DX
me.update()
print("WIDENED mesh_fishing_chair by", DX, "each side")
script = opt("--export-script", os.path.join(os.path.dirname(bpy.data.filepath), "..", "tools", "export_lake_structures.py"))
script = os.path.abspath(script)
exec(compile(open(script, encoding="utf8").read(), script, "exec"), {"__name__": "__main__", "__file__": script})
