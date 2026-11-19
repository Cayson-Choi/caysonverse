"""Add cast-brass lettering to the exterior name plaque of a baked village.

fonttools varLib.instancer NotoSansKR-VF.ttf wght=550 -o NotoSansKR-Medium.ttf
blender -b -P docs/handoff/art-tools/memorial_plaque.py -- <village.glb> <NotoSansKR-Medium.ttf>
"""
import json
import struct
import sys
from pathlib import Path

import bpy


def lettering(font):
    curve = bpy.data.curves.new("hall name", "FONT")
    curve.body = "케이슨 마을 추모관"
    curve.font = bpy.data.fonts.load(str(font.resolve()))
    curve.space_character = 1.08
    curve.resolution_u = 2
    curve.extrude = 0.010
    obj = bpy.data.objects.new("hall name", curve)
    bpy.context.collection.objects.link(obj)
    obj = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = obj.to_mesh()
    mesh.calc_loop_triangles()
    vertices = [v.co for v in mesh.vertices]
    xmin, xmax = min(v.x for v in vertices), max(v.x for v in vertices)
    ymin, ymax = min(v.y for v in vertices), max(v.y for v in vertices)
    back = min(v.z for v in vertices)
    scale = 2.50 / (xmax - xmin)
    points, normals, indices, seen = [], [], [], {}
    for tri in mesh.loop_triangles:
        if tri.normal.z < -0.99:  # the rear of the casting sits against the stone
            continue
        normal = tuple(round(n, 5) for n in tri.normal)
        for i in tri.vertices:
            key = (i, normal)
            if key not in seen:
                seen[key] = len(points)
                v = vertices[i]
                points.append(((v.x - (xmin + xmax) / 2) * scale,
                               (v.y - (ymin + ymax) / 2) * scale, (v.z - back) * scale))
                normals.append(normal)
            indices.append(seen[key])
    obj.to_mesh_clear()
    return points, normals, indices


model, font = map(Path, sys.argv[sys.argv.index("--") + 1:])
data = model.read_bytes()
size, = struct.unpack_from("<I", data, 12)
gltf = json.loads(data[20:20 + size])
name = "memorial_facade_letters"
if any(n.get("name") == name for n in gltf["nodes"]):
    print("Exterior plaque already lettered")
else:
    blob = bytearray(data[28 + size:][:gltf["buffers"][0]["byteLength"]])
    points, normals, indices = lettering(font)

    def accessor(values, fmt, kind, dimensions, **extra):
        blob.extend(bytes(-len(blob) % 4))
        view = len(gltf["bufferViews"])
        raw = b"".join(struct.pack("<" + fmt, *row) for row in values)
        gltf["bufferViews"].append(dict(buffer=0, byteOffset=len(blob), byteLength=len(raw),
                                        target=34963 if dimensions == "SCALAR" else 34962))
        blob.extend(raw)
        gltf["accessors"].append(dict(bufferView=view, componentType=kind, count=len(values), type=dimensions, **extra))
        return len(gltf["accessors"]) - 1

    # Share the village atlas's pearl-white swatch and the name plaque's baked day/night UV chart.
    # The bronze front catches the open sky. Ends and returns keep their darker metal colour.
    colours = []
    for nx, ny, nz in normals:
        light = 1 if nz > 0.99 else 0.47 + 0.22 * ny + 0.10 * nx
        colours.append(tuple(c * light for c in (0.95, 0.73, 0.45)))
    baked_uv = [(0.65649 + x * 0.005444, 0.62055 - y * 0.005484) for x, y, _ in points]
    attrs = dict(POSITION=accessor(points, "3f", 5126, "VEC3", min=list(map(min, zip(*points))),
                                   max=list(map(max, zip(*points)))), NORMAL=accessor(normals, "3f", 5126, "VEC3"),
                 TEXCOORD_0=accessor([(0.79492, 0.09180)] * len(points), "2f", 5126, "VEC2"),
                 TEXCOORD_1=accessor(baked_uv, "2f", 5126, "VEC2"), COLOR_0=accessor(colours, "3f", 5126, "VEC3"))
    atlas = next(i for i, material in enumerate(gltf["materials"]) if material["name"] == "LM_atlas")
    primitive = dict(attributes=attrs, indices=accessor([(i,) for i in indices], "H", 5123, "SCALAR"), material=atlas)
    gltf["scenes"][gltf.get("scene", 0)]["nodes"].append(len(gltf["nodes"]))
    # Front plane of the model's granite plaque spans x=3.70..6.70, y=.30..90, z=-51.80.
    gltf["nodes"].append(dict(name=name, mesh=len(gltf["meshes"]), translation=[5.20, 0.60, -51.799]))
    gltf["meshes"].append(dict(name=name, primitives=[primitive]))
    gltf["buffers"][0]["byteLength"] = len(blob)
    chunk = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode()
    chunk += b" " * (-len(chunk) % 4)
    blob.extend(bytes(-len(blob) % 4))
    model.write_bytes(struct.pack("<4sIII4s", b"glTF", 2, 28 + len(chunk) + len(blob), len(chunk), b"JSON")
                      + chunk + struct.pack("<I4s", len(blob), b"BIN\0") + blob)
    print("Memorial plaque:", len(indices) // 3, "triangles")
