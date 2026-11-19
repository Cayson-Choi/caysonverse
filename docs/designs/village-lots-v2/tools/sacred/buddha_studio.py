"""Blender 5.3: blender -b -P buddha_studio.py -- MODEL CALIBRATION OUTPUT [--scene] [views...].

Render the exported GLB in the fixed reference coordinate system. With --scene
save the editable model, cameras and two photographic alignment planes outside
the repository. First run buddha_measure.mjs prepare to create the calibration.
Pass portrait or full-portrait for the registered face or full figure under the same soft light.
"""
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import zlib

import bpy
from mathutils import Vector
import numpy as np


def load_model(model, output):
    # External PNGs give Blender's glTF importer the sRGB colour transfer and
    # linear normals/ORM that the runtime applies to these embedded KTX2 maps.
    raw = model.read_bytes()
    length = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20+length])
    if "KHR_texture_basisu" not in gltf.get("extensionsUsed", []):
        bpy.ops.import_scene.gltf(filepath=str(model))
        return
    from io_scene_gltf2.io.imp.gltf2_io_ktx import KtxDecoder
    binary = raw[28+length:]
    local = output/"gltf-import"
    local.mkdir(exist_ok=True)

    def chunk(tag, contents):
        return struct.pack(">I", len(contents))+tag+contents+struct.pack(">I", zlib.crc32(tag+contents))

    for image in gltf["images"]:
        view = gltf["bufferViews"][image.pop("bufferView")]
        start = view.get("byteOffset", 0)
        source = local/(image["name"]+".ktx2")
        source.write_bytes(binary[start:start+view["byteLength"]])
        w, h, values = KtxDecoder.decode_file(SimpleNamespace(), source)
        rgba = np.rint(np.asarray(values).reshape(h, w, 4)[::-1]*255).astype(np.uint8)
        rows = b"".join(b"\x00"+row.tobytes() for row in rgba)
        image.update(mimeType="image/png", uri=image["name"]+".png")
        (local/image["uri"]).write_bytes(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR", struct.pack(">2I5B", w,h,8,6,0,0,0))
                                        +chunk(b"IDAT",zlib.compress(rows))+chunk(b"IEND",b""))
    for texture in gltf["textures"]:
        texture["source"] = texture.pop("extensions")["KHR_texture_basisu"]["source"]
    for key in ("extensionsUsed","extensionsRequired"):
        if "KHR_texture_basisu" in gltf.get(key, []):
            gltf[key].remove("KHR_texture_basisu")
    gltf["buffers"][0]["uri"] = "mesh.bin"
    (local/"mesh.bin").write_bytes(binary)
    (local/"model.gltf").write_text(json.dumps(gltf), encoding="utf-8")
    bpy.ops.import_scene.gltf(filepath=str(local/"model.gltf"), import_ktx_texture=False)


def render_settings(scene):
    scene.render.engine = "CYCLES"
    device_prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX","CUDA"):
        try:
            device_prefs.compute_device_type = backend
            device_prefs.refresh_devices()
            if any(d.type == backend for d in device_prefs.devices):
                for device in device_prefs.devices:
                    device.use = device.type == backend
                scene.cycles.device = "GPU"
                break
        except (TypeError, RuntimeError):
            continue
    scene.cycles.samples = 18
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 5
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -.20


def softbox(scene, name, pos, target, width, height, power):
    light = bpy.data.lights.new(name, "AREA")
    light.energy, light.shape, light.size, light.size_y = power, "RECTANGLE", width, height
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = pos
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat("-Z","Y").to_euler()


def studio(scene):
    scene.world = bpy.data.worlds.new("Softbox studio")
    scene.world.use_nodes = True
    nodes = scene.world.node_tree
    bg = next(n for n in nodes.nodes if n.type == "BACKGROUND")
    texture = nodes.nodes.new("ShaderNodeTexEnvironment")
    texture.image = bpy.data.images.load(str(Path(bpy.utils.resource_path("LOCAL"))/"datafiles/studiolights/world/studio.exr"))
    mix = nodes.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "ADD"
    mix.inputs[0].default_value = .38
    mix.inputs[1].default_value = (.40,.36,.30,1)
    nodes.links.new(texture.outputs[0],mix.inputs[2])
    nodes.links.new(mix.outputs[0],bg.inputs[0])
    bg.inputs[1].default_value = .84
    for name, pos, width, height, power in [
        ("Key",(-2,-2.7,3.7),2.4,3,175), ("Rim",(2.1,-.8,2.6),.58,2.5,105),
        ("Top",(.4,.9,3.2),1.8,1.5,180), ("Front",(0,-2.3,.42),1.9,.62,18),
        ("Back",(-2,1.7,1.25),1.3,2.7,160), ("Under",(0,-.8,-2.1),2,1.1,100)]:
        softbox(scene,name,pos,(0,0,.95),width,height,power)


def camera(scene, name, outward, target, span):
    direction = Vector(outward).normalized()
    data = bpy.data.cameras.new(name+" orthographic")
    data.type, data.ortho_scale = "ORTHO", span
    obj = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(obj)
    obj.location = Vector(target)+direction*5
    obj.rotation_euler = (-direction).to_track_quat("-Z","Y").to_euler()
    return obj


def portrait(scene, reg, output, full_figure=False):
    # The owner's front crop covers (130,16) through (255,178) on the
    # registered panel. Keep the same sight line and magnification for every LOD.
    if full_figure:
        left, top, width, height = 0, 0, reg["width"], reg["height"]
    else:
        left, top, width, height = 130, 16, 125, 162
    p = reg["pixelsPerMetre"]
    direction = Vector((0,-1,reg["pitchTangent"])).normalized()
    right = Vector((1,0,0))
    up = direction.cross(right)
    center = (right*(left+width/2-reg["front"]["originX"])
              + up*(reg["groundRow"]-top-height/2))/p
    scene.camera = camera(scene,"Portrait",direction,center,height/p)
    # A graduated photographic tent gives polished leaf a broad reflection
    # with a soft edge. The identical neutral light is used for both LODs.
    scene.world = bpy.data.worlds.new("Graduated photographic silk")
    scene.world.use_nodes = True
    nodes = scene.world.node_tree
    bg = next(n for n in nodes.nodes if n.type == "BACKGROUND")
    w, h = 512, 256
    lon = (0.5 - (np.arange(w)+0.5)/w) * 2*np.pi
    lat = ((np.arange(h)+0.5)/h - 0.5)[:,None] * np.pi
    x, y, z = np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)
    radiance = np.zeros((h,w,4), dtype=np.float32)
    radiance[..., :3] = (.60,.48,.27)
    for direction, spread, power in [((-.24,-.88,.42), 4.2, 1.27),
                                     ((-.98,-.10,-.18), 5.5, .81),
                                     ((.96,-.10,-.23), 5.5, .76),
                                     ((.05,.75,.66), 5.0, .48)]:
        dx, dy, dz = Vector(direction).normalized()
        reflection = np.exp(spread*(dx*x + dy*y + dz*z - 1))
        radiance[..., :3] += (power*reflection)[...,None]
    radiance[..., 3] = 1
    image = bpy.data.images.new("Portrait reflectors", w, h, float_buffer=True)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(radiance.ravel())
    env = nodes.nodes.new("ShaderNodeTexEnvironment")
    env.image = image
    nodes.links.new(env.outputs[0], bg.inputs["Color"])
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -.45
    scene.cycles.samples = 48
    scale = 2 if full_figure else 4
    scene.render.resolution_x,scene.render.resolution_y = scale*width,scale*height
    scene.render.filepath = str(output/("full-portrait.png" if full_figure else "portrait.png"))
    bpy.ops.render.render(write_still=True)


def photo_plane(scene, name, camera_obj, width, height, image, registration):
    # A real mesh/image plane parallel to its calibrated view. It sits behind
    # all statue geometry. It is viewable in Blender and invisible to renders.
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.object
    obj.name = name+" reference plane"
    obj.rotation_euler = camera_obj.rotation_euler
    obj.location = camera_obj.location+camera_obj.rotation_euler.to_quaternion() @ Vector((0,0,-7))
    obj.scale = (width,height,1)
    obj.hide_render = True
    material = bpy.data.materials.new(name+" reference photograph")
    material.use_nodes = True
    nodes = material.node_tree
    picture = nodes.nodes.new("ShaderNodeTexImage")
    picture.image = bpy.data.images.load(str(image), check_existing=True)
    nodes.nodes.active = picture
    emission = nodes.nodes.new("ShaderNodeEmission")
    nodes.links.new(picture.outputs[0], emission.inputs[0])
    nodes.links.new(emission.outputs[0], next(n for n in nodes.nodes if n.type == "OUTPUT_MATERIAL").inputs[0])
    obj.data.materials.append(material)
    # Named, optional viewport guides on the two photographs. Keep them out
    # of the rendered masks and out of the statue's exported geometry.
    guides = bpy.data.collections.new(name+" registration marks")
    scene.collection.children.link(guides)
    for label,(u,v) in registration[name]["alignmentPoints"].items():
        guide = bpy.data.objects.new(name+" / "+label, None)
        guides.objects.link(guide)
        guide.parent = obj
        guide.location = (u/registration["width"]-.5,.5-v/registration["height"],.002)
        guide.empty_display_type = "CIRCLE"
        guide.empty_display_size = .009
    guides.hide_viewport = True


def main():
    model, refs, output, *options = sys.argv[sys.argv.index("--")+1:]
    model, refs, output = Path(model).resolve(), Path(refs).resolve(), Path(output).resolve()
    output.mkdir(exist_ok=True, parents=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load_model(model,output)
    scene = bpy.context.scene
    render_settings(scene)
    reg = json.loads((refs/"calibration.json").read_text(encoding="utf-8"))
    if options in (["portrait"], ["full-portrait"]):
        portrait(scene,reg,output,full_figure=options == ["full-portrait"])
        return
    studio(scene)
    p, t = reg["pixelsPerMetre"], reg["pitchTangent"]
    w, h = reg["width"], reg["height"]
    views = {}
    for name,direction,right,center in [
        ("front",(0,-1,t),(1,0,0),reg["front"]["originX"]),
        ("left",(1,0,t),(0,1,0),reg["left"]["originX"]),
        ("back",(0,1,t),(-1,0,0),192), ("right",(-1,0,t),(0,-1,0),195)]:
        up = Vector(direction).normalized().cross(Vector(right)).normalized()
        target = Vector(right)*(w*.5-center)/p+up*(reg["groundRow"]-h*.5)/p
        cam = camera(scene, name, direction, target, h/p)
        views[name] = (cam,w,h)
        if name in ("front","left"):
            photo_plane(scene,name,cam,w/p,h/p,refs/(name+".png"),reg)
    views["top"] = (camera(scene,"top",(0,-.20,1),(0,-.025,.85),768/315),768,449)
    views["bottom"] = (camera(scene,"bottom",(0,-.00001,-1),(0,-.025,.2),768/294),768,449)
    scene.camera = views["front"][0]
    scene.render.resolution_x,scene.render.resolution_y = 2*w,2*h
    if "--scene" in options:
        options.remove("--scene")
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == "VIEW_3D":
                    area.spaces.active.region_3d.view_perspective = "CAMERA"
                    area.spaces.active.shading.color_type = "TEXTURE"
        scene["metres_per_reference_pixel"] = 1/p
        bpy.ops.wm.save_as_mainfile(filepath=str(output/"registration.blend"))
    if "--no-render" in options:
        return
    for name in options or views:
        cam,w,h = views[name]
        scene.camera = cam
        scene.render.resolution_x,scene.render.resolution_y = 2*w,2*h
        bpy.data.objects["Under"].hide_render = name != "bottom"
        scene.render.filepath = str(output/(name+".png"))
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
