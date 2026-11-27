"""Render the temple attendants' packed GLBs in the same light for both LODs.

blender -b -P bodhi_studio.py -- <sacred-GLB-directory> <output> [pc|phone ...] [--reference]
"""
import argparse
import math
from pathlib import Path
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from buddha_studio import camera, load_model, render_settings, studio


def render_portraits(source, output, tier, reference=False):
    folder = output / tier
    if reference:
        folder = folder / "reference"
    folder.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    name = "lotstatue__lot_temple_hall_" + ("buddha" if reference else "bodhisattva")
    load_model(source / (name + ("_phone" if tier == "phone" else "") + ".glb"), folder)
    scene = bpy.context.scene
    if reference:
        # Register the seated Buddha's eyes to the attendant's eyes at the
        # same portrait scale, keeping the softboxes and camera fixed.
        from bodhi_face import AXIS, EYE_Z, ZS
        from buddha_head import FACE_AXIS, HEAD_X

        statue = next(obj for obj in scene.objects if obj.type == "MESH")
        statue.scale *= ZS
        statue.location = (AXIS - ZS*(HEAD_X + FACE_AXIS), -.041, EYE_Z - ZS*1.680)
    render_settings(scene)
    studio(scene)
    bpy.data.objects["Under"].hide_render = True
    scene.render.resolution_x, scene.render.resolution_y = 520, 624
    scene.cycles.samples = 24
    # In Blender the statue looks along -Y. Rotate around its head, which is
    # slightly off the body's centre line in the original standing pose.
    views = [("front", 0)] if reference else [("front", 0), ("three-quarter", 40), ("profile", 90)]
    for name, angle in views:
        yaw = math.radians(angle)
        direction = (math.sin(yaw), -math.cos(yaw), 0)
        scene.camera = camera(scene, name, direction, (-.047, .071, 2.007), .666)
        scene.render.filepath = str(folder / (name + ".png"))
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("tiers", nargs="*")
    parser.add_argument("--reference", action="store_true", help="Render the main Buddha in the same light")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    for tier in args.tiers or ["pc", "phone"]:
        if tier not in ("pc", "phone"):
            raise ValueError("Use pc or phone for the LOD")
        render_portraits(args.source.resolve(), args.output.resolve(), tier, args.reference)
