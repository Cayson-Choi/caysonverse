"""Bring the bake's saved scenes, work/village_lmprep.blend and work/village_export.blend, up to what the game ships
(bus review r3, 2026-11-11). Both were saved by the Nov 3 bake run (bake_village.py) and the later changes were made
on copies of them that were never saved: the two plaza carts taken out (commit c4ff25e), the crude box bus taken out
and the 9 m bus standing in its place as an occluder (the light maps' re-bake, ec70f90), col__bus moved to the 9 m
bus's box, and T_plaza redrawn round its bay. A night re-bake (bake_village.py --night loads village_lmprep.blend)
or a re-export from village_export.blend would have brought the carts and the old bus back.

  blender -b --factory-startup -P art/village/tools/sync_village_work.py -- [--export <out.glb>]

  village_lmprep.blend: the carts' 164 faces out of plaza_details and col__plaza_cart_1/2 gone; the old box bus
      (object village_bus) gone; the 9 m bus (export/village_bus.glb, parts_props.bus_occluder: its ground quad left
      out) standing at busStop.bus as an occluder, cat "occluder", as a full build puts it.
  village_export.blend: the carts' 164 faces and the old bus's 115 faces out of village_lm_11 (the bus's faces found by
      their centres, work/old_bus_faces.json: the lmprep's village_bus object, as export_bus_patch did), the carts'
      colliders gone, col__bus at layout.json's busStop.bus bounds, 3.3 m tall; T_plaza reloaded from //tex/T_plaza.png
      (make_textures.py plaza).
  --export: then export village.glb from the saved village_export.blend exactly as bake_village.py does (Draco, WebP
      80, bake_village.patch_glb) to <out.glb>, for comparing with the shipped file.

Idempotent: what is already gone is not looked for again (a second run changes nothing). Run one Blender at a time.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
WORK = os.path.join(ROOT, "work")
LAYOUT = json.load(open(os.path.join(ROOT, "layout.json"), encoding="utf-8"))
CARTS = [(-4.602, 26.098), (20.300, -17.034)]   # game (x, z) = Blender (x, -y)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
EXPORT_TO = argv[argv.index("--export") + 1] if "--export" in argv else None


def log(*a):
    print("[sync]", *a, flush=True)


def near_cart(c):
    return c.z > 0.1 and min(math.hypot(c.x - cx, -c.y - cz) for cx, cz in CARTS) < 1.5


def delete_faces(ob, idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in idx], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def drop(name):
    o = bpy.data.objects.get(name)
    if o is not None:
        bpy.data.objects.remove(o)
        return True
    return False


def lmprep():
    path = os.path.join(WORK, "village_lmprep.blend")
    bpy.ops.wm.open_mainfile(filepath=path)
    objs = bpy.data.objects
    ob = objs["plaza_details"]
    mw = ob.matrix_world
    kill = [p.index for p in ob.data.polygons if near_cart(mw @ p.center)]
    assert len(kill) in (0, 164), len(kill)
    if kill:
        delete_faces(ob, kill)
    carts = sum(drop(n) for n in ("col__plaza_cart_1", "col__plaza_cart_2"))
    old = objs.get("village_bus")
    if old is not None and old.get("cat") != "occluder":
        cen = [list(old.matrix_world @ p.center) for p in old.data.polygons]
        log("old box bus", len(cen), "faces, cat", old.get("cat"))
        objs.remove(old)
    occ = [o for o in objs if o.get("cat") == "occluder" and o.name.startswith("village_bus")]
    for o in occ:      # an older occluder: the current export/village_bus.glb replaces it
        objs.remove(o)
    if occ:            # its mesh, materials and images too (else the new import's names get a .001)
        bpy.data.orphans_purge(do_recursive=True)
    import parts_props as PP
    coll = bpy.data.collections.get("props") or bpy.context.scene.collection
    new = PP.bus_occluder(coll)
    meshes = [o for o in new if o.type == "MESH"]
    mats = sorted({m.name for o in meshes for m in o.data.materials if m})
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    log("lmprep: cart faces", len(kill), "cart colliders", carts, "| bus occluder", [o.name for o in new], mats, tris, "tris")
    assert not any(m.startswith("M_bus_ground") for o in meshes for m in [o.data.materials[p.material_index].name
                                                                          for p in o.data.polygons])
    bpy.ops.wm.save_as_mainfile(filepath=path)
    log("saved", path)


def export_blend():
    path = os.path.join(WORK, "village_export.blend")
    bpy.ops.wm.open_mainfile(filepath=path)
    objs = bpy.data.objects
    ob = objs["village_lm_11"]
    mw = ob.matrix_world
    me = ob.data
    old = [Vector(c) for c in json.load(open(os.path.join(WORK, "old_bus_faces.json")))]
    cart, bus = [], []
    for p in me.polygons:
        c = mw @ p.center
        if near_cart(c):
            cart.append(p.index)
        elif 32.5 < c.x < 36.5 and -11 < -c.y < -1 and min((c - o).length for o in old) < 0.002:
            bus.append(p.index)
    assert len(cart) in (0, 164) and len(bus) in (0, 115), (len(cart), len(bus))
    if cart or bus:
        delete_faces(ob, cart + bus)
    carts = sum(drop(n) for n in ("col__plaza_cart_1", "col__plaza_cart_2"))
    bb = LAYOUT["busStop"]["bus"]["bounds"]
    cb = objs["col__bus"]
    h = 3.3
    cb.location = ((bb["minX"] + bb["maxX"]) / 2, -(bb["minZ"] + bb["maxZ"]) / 2, h / 2)
    cb.scale = (bb["maxX"] - bb["minX"], bb["maxZ"] - bb["minZ"], h)
    im = bpy.data.images["T_plaza.png"]
    im.filepath = "//tex/T_plaza.png"
    im.reload()
    log("export: cart faces", len(cart), "old bus faces", len(bus), "cart colliders", carts, "| col__bus",
        tuple(round(v, 4) for v in cb.location), tuple(round(v, 4) for v in cb.scale), "| T_plaza", im.filepath,
        tuple(im.size), "| village_lm_11", len(me.polygons), "faces")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    log("saved", path)


def export_glb(out):
    """As bake_village.main's export, from the saved village_export.blend."""
    import bake_village as BV
    objs = bpy.data.objects
    exported = sorted([o for o in objs if o.type == "MESH" and o.name.startswith("village_") and o.get("cat") != "collider"],
                      key=lambda o: o.name)
    inst = [o for o in objs if o.get("cat") in ("inst", "inst_root")]
    cols = [o for o in objs if o.get("cat") == "collider"]
    lights = [o for o in objs if o.get("cat") == "light"]
    log("exporting", len(exported), "meshes,", len(inst), "instances,", len(cols), "colliders,", len(lights), "lights")
    BV.select(exported + inst + cols + lights, exported[0])
    kw = dict(filepath=out, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=False, export_materials="EXPORT", export_image_format="WEBP",
              export_image_quality=80, export_animations=False, export_cameras=False, export_lights=False,
              export_extras=False, export_skins=False, export_morph=False, export_vertex_color="MATERIAL",
              export_tangents=False, export_gpu_instances=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
              export_draco_position_quantization=16, export_draco_normal_quantization=10,
              export_draco_texcoord_quantization=14, export_draco_color_quantization=10,
              export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**kw)
    BV.patch_glb(out)
    log("wrote", out, os.path.getsize(out))


lmprep()
export_blend()
if EXPORT_TO:
    export_glb(EXPORT_TO)
