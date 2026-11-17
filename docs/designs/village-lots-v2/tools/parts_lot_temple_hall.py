"""대웅전 안 (lot_temple_hall) — the walk-in room GLB (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_temple_hall.py -- --layout <lots.json> \
      --png <decoded PBR pngs> [--sacred <dir with the B3s statues' PNG-textured GLBs and the 탱화 PNG>] \
      [--out client/public/models/village/lots/lot_temple_hall.glb] [--report <json>] [--renders <dir>] [--views entry,...]
      [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

`--layout` must carry `interiors` (LOT_INTERIORS). Geometry: temple_room_kit.py; Blender side: b1_blender.run_room, plus the
sacred props' markers (`lotstatue__lot_temple_hall_<name>`, `lotart__lot_temple_hall_taenghwa`: empties at the place, game
yaw, the right 협시보살 mirrored with scale x -1) and `asset.extras.sacred` (node -> PC / phone file under
client/public/models/village/lots/). The game loads those GLBs at the markers (they carry their own KTX2 maps). For the renders
only, `--sacred` imports the statues' PNG-textured builds (art/sacred/build, the same meshes) so the shots show the real hall.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import b1_blender as B  # noqa: E402
import temple_room_kit  # noqa: E402

VIEWDEF = {
    # interior frame (x across from the left wall, z in from the door wall, y up)
    "entry": ((5.7, 1.6, 0.9), (5.7, 2.4, 7.0), 18),
    "door": ((5.7, 1.65, 1.6), (5.7, 2.5, 7.0), 22),
    "cushion": ((4.9, 0.95, 2.8), (5.7, 2.4, 7.0), 22),
    "buddha": ((5.7, 1.7, 4.2), (5.7, 2.6, 6.6), 28),
    "buddha_face": ((5.8, 2.75, 5.05), (5.7, 3.0, 6.5), 45),
    "bodhisattva": ((4.6, 1.8, 4.5), (3.55, 2.6, 6.4), 30),
    "datjip": ((5.7, 1.6, 3.3), (5.7, 4.9, 6.3), 22),
    "ceiling": ((5.7, 1.5, 1.5), (5.7, 6.0, 4.5), 16),
    "offering": ((6.6, 1.35, 4.0), (5.7, 0.95, 5.15), 26),
    "doors": ((5.7, 1.6, 5.0), (5.7, 2.0, 0.0), 20),
    "side": ((9.5, 1.6, 4.6), (0.5, 2.0, 2.0), 20),
}

SACRED_DIR = B.arg("--sacred")


def add_markers(objs, extras):
    sac = []
    for s in temple_room_kit.SACRED:
        x, y, z = s["at"]
        e = B.empty(s["node"], B.l2b((x, y, z)), s["yaw"])
        if s["mirror"]:
            e.scale = (-1.0, 1.0, 1.0)
        objs.append(e)
        sac.append({"node": s["node"], "file": s["file"], "phone": s["phone"], "mirrorX": s["mirror"],
                    "note": "the prop's origin is its bottom centre, front +Z (glTF): place at the node (game yaw), scale x -1 when mirrorX"})
    extras["sacred"] = sac
    extras["caysonverse"] = "lot_temple_hall (lots v2 B3 room kit)"


_export = B.export


def export_with_markers(path, objs, extras):
    add_markers(objs, extras)
    return _export(path, objs, extras)


B.export = export_with_markers

_render_all = B.render_all


def import_sacred():
    """Render only: the statues' PNG-textured builds at their markers, the 탱화 as a textured plane in its red frame."""
    if not SACRED_DIR:
        return
    files = {"buddha": os.path.join(SACRED_DIR, "z_buddha", "lotstatue__lot_temple_hall_buddha.glb"),
             "bodhisattva": os.path.join(SACRED_DIR, "bodhisattva", "lotstatue__lot_temple_hall_bodhisattva.glb")}
    for s in temple_room_kit.SACRED:
        x, y, z = s["at"]
        if "taenghwa" in s["node"]:
            img = os.path.join(SACRED_DIR, "taenghwa", "taenghwa_color.png")
            if not os.path.exists(img):
                continue
            im = bpy.data.images.load(img, check_existing=True)
            w, h = 3.7, 3.7 * im.size[1] / im.size[0]
            me = bpy.data.meshes.new("taenghwa")
            me.from_pydata([(-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h)], [], [(0, 1, 2, 3)])
            uv = me.uv_layers.new()
            for i, l in enumerate(me.loops):
                uv.data[i].uv = [(0, 0), (1, 0), (1, 1), (0, 1)][l.vertex_index]
            m = bpy.data.materials.new("taenghwa")
            m.use_nodes = True
            bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            t = m.node_tree.nodes.new("ShaderNodeTexImage")
            t.image = im
            m.node_tree.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Roughness"].default_value = 0.8
            me.materials.append(m)
            o = bpy.data.objects.new("taenghwa", me)
            bpy.context.scene.collection.objects.link(o)
            o.location = B.l2b((x, y + 0.15, z - 0.03))
            frame = bpy.data.meshes.new("tframe")
            fw, fh, d = w + 0.3, h + 0.3, 0.06
            import bmesh
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            bm.to_mesh(frame)
            bm.free()
            fo = bpy.data.objects.new("tframe", frame)
            bpy.context.scene.collection.objects.link(fo)
            fo.scale = (fw, d, fh)
            fo.location = B.l2b((x, y + 0.15 + h / 2, z + 0.01))
            fm = bpy.data.materials.new("tframe")
            fm.use_nodes = True
            fb = next(n for n in fm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            fb.inputs["Base Color"].default_value = (0.38, 0.05, 0.03, 1)
            fb.inputs["Roughness"].default_value = 0.4
            frame.materials.append(fm)
            continue
        key = "buddha" if "buddha" in s["node"] else "bodhisattva"
        f = files[key]
        if not os.path.exists(f):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f)
        new = [o for o in bpy.data.objects if o not in before]
        root = bpy.data.objects.new("statue_" + s["node"], None)
        bpy.context.scene.collection.objects.link(root)
        for o in new:
            if o.type == "MESH" and o.name.endswith("_phone"):
                o.hide_render = True
            if o.parent is None:
                o.parent = root
        root.location = B.l2b((x, y, z))
        root.rotation_euler = (0.0, 0.0, s["yaw"])
        if s["mirror"]:
            root.scale = (-1.0, 1.0, 1.0)


def render_with_sacred(kit, mats, outdir, viewdef, prefix):
    import_sacred()
    return _render_all(kit, mats, outdir, viewdef, prefix)


B.render_all = render_with_sacred

if __name__ == "__main__":
    B.run_room("lot_temple_hall", temple_room_kit, VIEWDEF, "temple_hall", "temple")
