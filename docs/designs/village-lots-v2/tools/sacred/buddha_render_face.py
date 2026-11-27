"""Render registered, model-only face crops with Blender and its bundled NumPy.

    node node/buddha_unpack.mjs MODEL.glb UNPACKED_DIR
    blender -b -t 4 -P buddha_render_face.py -- MODEL.gltf OUTPUT_DIR LIGHT [names...]

LIGHT: tent (portrait reflectors), clay (plain gilt), or studio (softboxes).
The six default crops reproduce face21-work/render_crops.py, including its 2x
output resolution. Additional named eye/ear crops are available, or supply a
custom crop as NAME=VIEW,X0,Y0,X1,Y1,WIDTH,HEIGHT. Coordinates are the registered
turnaround sheet's pixels; VIEW is front, left, or right. WIDTH and HEIGHT are
the nominal crop size, rendered at 2x just like the existing crops. Example:

    blender -b -t 4 -P buddha_render_face.py -- model.gltf renders tent eyes-front
    blender -b -t 4 -P buddha_render_face.py -- model.gltf renders clay \
        detail=left,544,97,586,142,672,720

No calibration directory is needed. Protected reference images are never read
or copied; the calibration below contains only numeric camera registration.
"""
import json
import math
from pathlib import Path
import sys

# Keep reproducible rendering from creating untracked __pycache__ directories.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy
from mathutils import Vector
import numpy as np
import buddha_studio as S


CALIBRATION = dict(pixelsPerMetre=265, groundRow=551.5, pitchTangent=.068)
PITCH = CALIBRATION["pitchTangent"]
# Pass-17 pupil/chin registration, also used by buddha_board18.mjs.
REG = {
    "front": dict(ref=(196.12011419126338, 108.89939538181166), model=(195.82814395942916, 108.65280539188187), scale=.9919544340073664, sheet=0),
    "left": dict(ref=(569.0622755548725, 108.07777330914251), model=(568.6474687480413, 109.46649657778491), scale=.993294419715006, sheet=384),
    "right": dict(ref=(1363.272280361039, 107.7625766375115), model=(1363.8002335203992, 109.5742462606064), scale=.9920241018349292, sheet=1152),
}
VIEW = {
    "front": dict(direction=(0, -1, PITCH), right=(1, 0, 0), origin=197),
    "left": dict(direction=(1, 0, PITCH), right=(0, 1, 0), origin=192),
    "right": dict(direction=(-1, 0, PITCH), right=(0, -1, 0), origin=203.5),
}

# name: (view, sheet-pixel box x0,y0,x1,y1, nominal output width,height)
CROPS = {
    "owner-front": ("front", (175 + 122.3565 / 18, 97 + 423.8095 / 18,
                              175 + (122.3565 + 556 * 1.00025) / 18, 97 + (423.8095 + 326 * 1.0015) / 18), 716, 420),
    "owner-side": ("left", (544 + 72.50175 / 16, 97 + 351.59055 / 16,
                            544 + (72.50175 + 290 * .99945) / 16, 97 + (351.59055 + 276 * 1.000025) / 16), 441, 420),
    "nose-front": ("front", (175, 97, 217, 142), 756, 810),
    "nose-left": ("left", (544, 97, 586, 142), 672, 720),
    "nose-right": ("right", (1349, 97, 1391, 142), 672, 720),
    "face-front": ("front", (130, 16, 255, 178), 500, 648),
}
DEFAULT_CROPS = tuple(CROPS)
CROPS.update({
    "head-front": ("front", (130, 14, 262, 180), 528, 664),
    "head-left": ("left", (500, 14, 640, 180), 560, 664),
    "eyes-front": ("front", (145, 82, 247, 116), 816, 272),
    "eyes-left": ("left", (545, 82, 585, 116), 480, 408),
    "eyes-right": ("right", (1345, 82, 1385, 116), 480, 408),
    "ears-front": ("front", (130, 77, 262, 170), 660, 465),
    "ear-left": ("left", (598, 77, 646, 174), 384, 776),
    "ear-right": ("right", (1290, 77, 1338, 174), 384, 776),
})


def to_model(view, x, y):
    r = REG[view]
    return ((x - r["ref"][0]) / r["scale"] + r["model"][0] - r["sheet"],
            (y - r["ref"][1]) / r["scale"] + r["model"][1])


def tent(scene):
    scene.world = bpy.data.worlds.new("Graduated photographic silk")
    scene.world.use_nodes = True
    nodes = scene.world.node_tree
    bg = next(n for n in nodes.nodes if n.type == "BACKGROUND")
    w, h = 512, 256
    lon = (0.5 - (np.arange(w) + 0.5) / w) * 2 * np.pi
    lat = ((np.arange(h) + 0.5) / h - 0.5)[:, None] * np.pi
    x, y, z = np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)
    radiance = np.zeros((h, w, 4), dtype=np.float32)
    radiance[..., :3] = (.60, .48, .27)
    for direction, spread, power in [((-.24, -.88, .42), 4.2, 1.27), ((-.98, -.10, -.18), 5.5, .81),
                                     ((.96, -.10, -.23), 5.5, .76), ((.05, .75, .66), 5.0, .48)]:
        dx, dy, dz = Vector(direction).normalized()
        radiance[..., :3] += (power * np.exp(spread * (dx * x + dy * y + dz * z - 1)))[..., None]
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


def select_crops(names):
    selected = {}
    for spec in names or DEFAULT_CROPS:
        if "=" not in spec:
            if spec not in CROPS:
                raise ValueError(f"Unknown crop {spec!r}; available: {', '.join(CROPS)}")
            selected[spec] = CROPS[spec]
            continue
        name, values = spec.split("=", 1)
        fields = values.split(",")
        if len(fields) != 7 or fields[0] not in VIEW:
            raise ValueError("Custom crop must be NAME=VIEW,X0,Y0,X1,Y1,WIDTH,HEIGHT")
        if not name or name in (".", "..") or any(c in name for c in '/\\:'):
            raise ValueError("Crop names must be plain filenames without an extension")
        box = tuple(float(v) for v in fields[1:5])
        w, h = (int(v) for v in fields[5:])
        if not all(math.isfinite(v) for v in box) or box[2] <= box[0] or box[3] <= box[1] or min(w, h) <= 0:
            raise ValueError("Crop bounds and dimensions must describe a positive finite rectangle")
        selected[name] = (fields[0], box, w, h)
    return selected


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 3:
        raise SystemExit(__doc__)
    model_arg, output_arg, light, *names = argv
    if light not in ("tent", "clay", "studio"):
        raise ValueError("LIGHT must be tent, clay, or studio")
    crops = select_crops(names)
    model, output = Path(model_arg).resolve(), Path(output_arg).resolve()
    if model.suffix.lower() != ".gltf":
        raise ValueError("First unpack the GLB with node/buddha_unpack.mjs; provide its model.gltf")
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(model))
    scene = bpy.context.scene
    S.render_settings(scene)
    if light in ("tent", "clay"):
        tent(scene)
        if light == "clay":
            for mat in bpy.data.materials:
                if not mat.node_tree:
                    continue
                bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if not bsdf:
                    continue
                for name, value in [("Base Color", (.95, .52, .07, 1)), ("Metallic", .85), ("Roughness", .70), ("Emission Strength", 0.0)]:
                    sock = bsdf.inputs[name]
                    for link in list(sock.links):
                        mat.node_tree.links.remove(link)
                    sock.default_value = value
                for link in list(bsdf.inputs["Normal"].links):
                    mat.node_tree.links.remove(link)
    else:
        S.studio(scene)
        bpy.data.objects["Under"].hide_render = True
        scene.cycles.samples = 48

    scene.render.film_transparent = True
    p = CALIBRATION["pixelsPerMetre"]
    manifest = {}
    for name, (view, (x0, y0, x1, y1), w, h) in crops.items():
        (mx0, my0), (mx1, my1) = to_model(view, x0, y0), to_model(view, x1, y1)
        v = VIEW[view]
        direction = Vector(v["direction"]).normalized()
        right = Vector(v["right"])
        up = direction.cross(right).normalized()
        cx, cy = (mx0 + mx1) / 2, (my0 + my1) / 2
        center = right * (cx - v["origin"]) / p + up * (CALIBRATION["groundRow"] - cy) / p
        span_x, span_y = (mx1 - mx0) / p, (my1 - my0) / p
        cam = S.camera(scene, name, direction, center, max(span_x, span_y * w / h) if w >= h else max(span_y, span_x * h / w))
        cam.data.sensor_fit = "HORIZONTAL" if w >= h else "VERTICAL"
        cam.data.ortho_scale = span_x if w >= h else span_y
        scene.camera = cam
        scene.render.resolution_x, scene.render.resolution_y = 2 * w, 2 * h
        scene.render.filepath = str(output / (name + ".png"))
        bpy.ops.render.render(write_still=True)
        manifest[name] = dict(view=view, sheetBox=[x0, y0, x1, y1], modelBox=[mx0, my0, mx1, my1], size=[w, h], aspectError=(span_x / span_y) / (w / h))
    (output / "crops.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print("CROPS", json.dumps(manifest))


if __name__ == "__main__":
    main()
