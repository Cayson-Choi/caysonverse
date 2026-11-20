"""Render the temple attendants' packed GLBs in the same light for both LODs.

blender -b -P bodhi_studio.py -- <sacred-GLB-directory> <output> [pc|phone ...]
"""
import math
from pathlib import Path
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from buddha_studio import camera, load_model, render_settings, studio


def render_portraits(source, output, tier):
    folder = output / tier
    folder.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    name = "lotstatue__lot_temple_hall_bodhisattva"
    load_model(source / (name + ("_phone" if tier == "phone" else "") + ".glb"), folder)
    scene = bpy.context.scene
    render_settings(scene)
    studio(scene)
    bpy.data.objects["Under"].hide_render = True
    scene.render.resolution_x, scene.render.resolution_y = 520, 624
    scene.cycles.samples = 24
    # In Blender the statue looks along -Y. Rotate around its head, which is
    # slightly off the body's centre line in the original standing pose.
    for name, angle in [("front", 0), ("three-quarter", 40), ("profile", 90)]:
        yaw = math.radians(angle)
        direction = (math.sin(yaw), -math.cos(yaw), 0)
        scene.camera = camera(scene, name, direction, (-.047, .071, 2.007), .666)
        scene.render.filepath = str(folder / (name + ".png"))
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    source, output, *tiers = sys.argv[sys.argv.index("--") + 1:]
    for tier in tiers or ["pc", "phone"]:
        if tier not in ("pc", "phone"):
            raise ValueError("Use pc or phone for the LOD")
        render_portraits(Path(source).resolve(), Path(output).resolve(), tier)
