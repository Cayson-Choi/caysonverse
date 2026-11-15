"""Build the shared small props of the houses (kit_props.PROPS) -> art/village/export/houses_props.glb

  blender -b --factory-startup -P art/village/tools/houses/build_houses_props.py -- [--samples 128] [--size 1024] [--no-bake]

One mesh (= one glTF node `prop__<name>`) per prop, real size, origin at the bottom centre, front +z. All props share ONE
material M_props: the colour atlas multiplied by a Cycles DIFFUSE bake (colour + direct + indirect) under a soft studio dome
and a sun, so the AO/shade is in the texture and GPU instancing needs no light map (the memorial_props.glb approach).
Draco, WebP, no normals/colours. Then post_house.py --props copies it to client/public/models/village/houses/.
"""
import json
import math
import os
import struct
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit_core as K  # noqa: E402
import kit_props as KP  # noqa: E402


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for i, x in enumerate(a):
        if x == name:
            return cast(a[i + 1]) if i + 1 < len(a) and not a[i + 1].startswith("--") else True
    return default


def build():
    objs = []
    for n, fn in KP.PROPS:
        K.begin("prop__" + n)
        K.S.fuv = None
        fn(K.Frame(0, 0, 0, 0))
        K.S.fuv = None
        ob = K.end(None, link=False)
        ob.name = "prop__" + n
        bpy.context.scene.collection.objects.link(ob)
        objs.append(ob)
    return objs


def stage(objs):
    """lay the props out on a grid (the bake needs them apart); returns the stage plane"""
    x, row, rowh = 0.0, 0.0, 0.0
    for ob in objs:
        bpy.context.view_layer.update()
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        w = max(p.x for p in pts) - min(p.x for p in pts)
        d = max(p.y for p in pts) - min(p.y for p in pts)
        if x + w > 3.5:
            x, row, rowh = 0.0, row - rowh - 0.15, 0.0
        ob.location = (x + w / 2 + 0.05, row, 0.0)
        x += w + 0.15
        rowh = max(rowh, d)
    me = bpy.data.meshes.new("stage")
    me.from_pydata([(-5, -8, -0.001), (9, -8, -0.001), (9, 3, -0.001), (-5, 3, -0.001)], [], [(0, 1, 2, 3)])
    st = bpy.data.objects.new("stage", me)
    m = bpy.data.materials.new("stage_m")
    nt = m.node_tree
    nt.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1)
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    me.materials.append(m)
    bpy.context.scene.collection.objects.link(st)
    return st


def bake(objs, size, samples, out):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    c = scene.cycles
    c.samples = samples
    c.use_denoising = False
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        c.device = "GPU"
    except Exception as e:
        print("gpu", e)
    # world: uniform soft dome + a warm sun
    w = bpy.data.worlds.new("pw")
    scene.world = w
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.85, 0.88, 0.95, 1)
    bg.inputs["Strength"].default_value = 0.8
    sd = bpy.data.lights.new("psun", "SUN")
    sd.energy = 2.5
    sd.angle = math.radians(12)
    so = bpy.data.objects.new("psun", sd)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-30))
    # second UV set, packed over all props
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    for o in objs:
        o.data.uv_layers.new(name="UV_P")
        o.data.uv_layers.active = o.data.uv_layers["UV_P"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.lightmap_pack(PREF_CONTEXT="ALL_FACES", PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False, PREF_BOX_DIV=18, PREF_MARGIN_DIV=0.2)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("PropsBake", size, size)
    for o in objs:
        for m in o.data.materials:
            nt = m.node_tree
            tn = nt.nodes.new("ShaderNodeTexImage")
            tn.image = img
            nt.nodes.active = tn
            tn.select = True
        o.data.uv_layers.active = o.data.uv_layers["UV_P"]
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = True
    scene.render.bake.margin = 6
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type="DIFFUSE")
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    print("BAKED", out)
    return img


def export(objs, tex, glb):
    old_mats = [m for o in objs for m in o.data.materials]
    m = bpy.data.materials.new("M_props")
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    o_ = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Roughness"].default_value = 1.0
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(tex, check_existing=True)
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(b.outputs[0], o_.inputs["Surface"])
    for o in objs:
        me = o.data
        uvp = me.uv_layers["UV_P"].data
        uv0 = me.uv_layers["UVMap"].data
        for li in range(len(uv0)):
            uv0[li].uv = uvp[li].uv
        me.uv_layers.remove(me.uv_layers["UV_P"])
        me.materials.clear()
        me.materials.append(m)
        if "Col" in me.color_attributes:
            me.color_attributes.remove(me.color_attributes["Col"])
        if "uvx" in me.attributes:
            me.attributes.remove(me.attributes["uvx"])
        o.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=False, export_materials="EXPORT",
                              export_image_format="WEBP", export_image_quality=85, export_animations=False,
                              export_cameras=False, export_lights=False, export_extras=False, export_vertex_color="NONE",
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    print("EXPORTED", glb, os.path.getsize(glb))


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    objs = build()
    tri = {o.name: K.tri_count(o) for o in objs}
    print("TRIS", sum(tri.values()), tri)
    out_dir = os.path.abspath(arg("--out", K.EXPORT))
    os.makedirs(out_dir, exist_ok=True)
    tex = os.path.join(K.WORK, "houses_props_bake.png")
    st = stage(objs)
    if not arg("--no-bake"):
        bake(objs, arg("--size", 1024, int), arg("--samples", 128, int), tex)
    bpy.data.objects.remove(st)
    glb = os.path.join(out_dir, "houses_props.glb")
    export(objs, tex, glb)
    json.dump(dict(tris=tri, bytes=os.path.getsize(glb)), open(os.path.join(K.WORK, "houses_props_stats.json"), "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(K.WORK, "houses_props.blend"), copy=True)


main()
