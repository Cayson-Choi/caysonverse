"""triangles per piece of an authoring blend:  blender -b art/village/work/house_N_authoring.blend -P tri_report.py"""
import bpy
rows = []
for o in bpy.data.objects:
    if o.type == "MESH" and o.get("cat") == "lm":
        me = o.data
        rows.append((sum(len(p.vertices) - 2 for p in me.polygons), o.name))
rows.sort(reverse=True)
tot = {1: 0, 2: 0}
for t, n in rows:
    tot[int(n.split("_")[1])] += t
print("TRIS", tot, sum(tot.values()))
print("TOP", "; ".join(f"{n.split('_',2)[2]}@{n.split('_')[1]}:{t}" for t, n in rows[:35]))
