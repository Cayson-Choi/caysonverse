"""Build the original Buddha LODs. Blender 5.3: blender -b -P buddha_build.py -- <build-dir>"""
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from buddha_mesh import FINISHES, build_lotus
from buddha_pigment import face_patch

NAME = "lotstatue__lot_temple_hall_buddha"
KEYS = tuple(FINISHES)


def triangles(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def join_objects(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    # Baking transforms into vertices keeps the anchor at (0,0,0), even if the
    # module's first part was built around its own local origin.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = name
    obj.data.name = name
    return obj


def reduce_to(obj, limit):
    total = triangles(obj.data)
    if total <= limit:
        return
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("Simplify the turned rims and backs of the leaves", "DECIMATE")
    mod.ratio = limit / total
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)


def local_access(mesh):
    # Local visibility for the underside of a fold, between curls and under the chin.
    # A finite reach prevents the whole back or a downward-facing palm from going dark.
    tree = BVHTree.FromPolygons([v.co for v in mesh.vertices], [list(p.vertices) for p in mesh.polygons])
    hemisphere = []
    for i in range(28):
        z = (i + .5) / 28
        angle = 2.39996323 * i
        radius = math.sqrt(1 - z*z)
        hemisphere.append(Vector((radius*math.cos(angle), radius*math.sin(angle), z)))
    access = []
    for vertex in mesh.vertices:
        n = vertex.normal.normalized()
        rotation = n.to_track_quat("Z", "Y")
        origin = vertex.co + n*.0014
        shade = 0.
        for ray in hemisphere:
            distance = tree.ray_cast(origin, rotation @ ray, .058)[3]
            if distance is not None:
                shade += 1 - distance / .058
        access.append(max(.04, 1 - shade / len(hemisphere)))
    return access


def face_visibility(xs, zs):
    """Skylight reaching the sculpt, sampled on the frontal pigment island."""
    from buddha_head import SKULL, fy, profile

    # In the hall the face receives a uniform fill. The gilding underpaint
    # carries the soft contact shadows of the actual brow, lids and nostrils.
    step = .0025
    x = np.arange(-.18, .1801, step)
    z = np.arange(1.420, 1.8201, step)
    height = np.array([[-fy(i,j) for i in x] for j in z])
    margin = 16
    padded = np.pad(height, margin, mode="edge")
    blocked = np.zeros_like(height)
    for dx, dz, weight in ((0,1,.44), (-1,1,.17), (1,1,.17),
                           (-1,0,.09), (1,0,.09), (0,-1,.04)):
        horizon = np.zeros_like(height)
        for n in (1,2,4,7,11,margin):
            row, col = margin+n*dz, margin+n*dx
            neighbor = padded[row:row+len(z), col:col+len(x)]
            slope = (neighbor-height)/(n*step*math.hypot(dx,dz))
            np.maximum(horizon, slope, out=horizon)
        blocked += weight*np.arctan(horizon)*(2/math.pi)
    # The side rolls into the original gilt at the ear. Keep the planar
    # island's cut edge invisible, even at the narrowest part of the jaw.
    width = np.array([profile(SKULL,j)[0] for j in z])[:,None]
    fade = np.clip((width-np.abs(x))/.030, 0, 1)
    visibility = 1-.69*blocked*fade**2*(3-2*fade)
    rows = np.array([np.interp(xs,x,row) for row in visibility])
    return np.array([np.interp(zs,z,col) for col in rows.T]).T


def dress(mesh, output, lod):
    access = local_access(mesh)
    tiles = {key:i for i,key in enumerate(KEYS)}
    face_limit = .180
    chin, crown = 1.420, 1.820
    uv = mesh.uv_layers.new(name="Leaf and pigment")
    for p in mesh.polygons:
        finish = mesh.materials[p.material_index].name
        for k in p.loop_indices:
            index = mesh.loops[k].vertex_index
            x,y,z = mesh.vertices[index].co
            if finish == "Face pigment":
                u = .5 + x/(2*face_limit)
                v = min(.997, max(.003, (z-chin)/(crown-chin)))
                uv.data[k].uv = (.5 + .5*u, v)
                continue
            tile = tiles[finish]
            phase = .50 + .47*math.sin(7*x + 6*y + 9*z + .6*math.sin(5*y - 4*z))
            tone = access[index]
            if finish == "skin" and 1.438 < z < 1.805 and y < -.068:
                # Retain the wash beneath the jaw on the original neck.
                tone = max(.05, tone-.29*math.exp(-((abs(x)-.020)/.095)**2-((z-1.454)/.016)**2))
            uv.data[k].uv = ((tile%4 + .06 + .88*tone)/8,
                             (tile//4 + .06 + .88*phase)/2)
    for layer in list(mesh.uv_layers):
        if layer.name != "Leaf and pigment":
            mesh.uv_layers.remove(layer)
    mesh.uv_layers.active = mesh.uv_layers[0]
    mesh.uv_layers[0].active_render = True
    for p in mesh.polygons:
        p.material_index = 0
    mesh.materials.clear()
    material = bpy.data.materials.new(NAME + "_gilt")
    mesh.materials.append(material)
    material.use_nodes = True
    nt = material.node_tree
    shader = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")

    def texture(kind, tile_size):
        # The left half keeps the original gilt palette. The right half is
        # a spatial face island, 1024 square for desktop pigment, 512 on phones.
        tile_height = tile_size*2 if kind == "color" else tile_size
        h, w = tile_height*2, tile_size*8
        arr = np.ones((h,w,4), dtype=np.float32)
        v,u = np.ogrid[0:1:tile_height*1j, 0:1:tile_size*1j]
        ao = np.clip((u-.06)/.88, 0, 1)
        wave = np.sin(11*v + .4*np.sin(18*u)) * np.sin(9*u+5*v)
        for i, key in enumerate(KEYS):
            color, rough, metal = FINISHES[key]
            patch = arr[(i//4)*tile_height:(i//4+1)*tile_height,(i%4)*tile_size:(i%4+1)*tile_size]
            if kind == "color":
                for channel, value in enumerate(color):
                    # Subtle warm reflected light remains in leaf recesses.
                    shade = .50 + .50*ao if key == "skin" else .73 + .27*ao
                    linear = np.clip(value * shade * (1+.009*wave), 0, 1)
                    patch[:,:,channel] = np.where(linear <= .0031308, 12.92*linear, 1.055*linear**(1/2.4)-.055)
            elif kind == "orm":
                patch[:,:,0] = .46 + .54*ao
                patch[:,:,1] = rough + .016*wave + .026*(1-ao)
                patch[:,:,2] = metal
            else:
                strength = .006 if key == "gold" else .002
                patch[:,:,0] = .5 + strength*wave
                patch[:,:,1] = .5 + strength*np.sin(31*v+11*u)
                patch[:,:,2] = 1
        x = ((np.arange(w//2)+.5)/(w//2)*2 - 1)*face_limit
        z = chin + (np.arange(h)+.5)/h*(crown-chin)
        face = face_patch(kind, x[None,:], z[:,None])
        if kind == "color":
            # Apply visibility in linear light, then return to sRGB storage.
            light = face_visibility(x,z)[:,:,None]
            linear = np.where(face <= .04045, face/12.92, ((face+.055)/1.055)**2.4)*light
            face = np.where(linear <= .0031308, 12.92*linear, 1.055*linear**(1/2.4)-.055)
        arr[:,w//2:,:3] = face
        image = bpy.data.images.new(kind, w, h, alpha=False, float_buffer=False)
        image.colorspace_settings.name = "sRGB" if kind == "color" else "Non-Color"
        image.pixels.foreach_set(arr.ravel())
        image.filepath_raw = str(output / (lod + "-" + kind + ".png"))
        image.file_format = "PNG"
        image.save()
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = image
        return node.outputs["Color"]

    size = 128 if lod == "phone" else 256
    nt.links.new(texture("color", size), shader.inputs["Base Color"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(texture("normal", size), nm.inputs["Color"])
    nt.links.new(nm.outputs[0], shader.inputs["Normal"])
    split = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(texture("orm", size//2), split.inputs[0])
    nt.links.new(split.outputs["Green"], shader.inputs["Roughness"])
    nt.links.new(split.outputs["Blue"], shader.inputs["Metallic"])
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    output_node = nt.nodes.new("ShaderNodeGroup")
    output_node.node_tree = group
    nt.links.new(split.outputs["Red"], output_node.inputs["Occlusion"])


def build(output, lod):
    from buddha_body import build_body
    from buddha_head import build_head

    bpy.ops.wm.read_factory_settings(use_empty=True)
    phone = lod == "phone"
    build_body(phone)
    build_head(phone)
    figures = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    build_lotus(phone)
    seat = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o not in figures)
    limit = 9950 if phone else 39900
    figure_count = sum(triangles(o.data) for o in figures)
    # Keep each lotus carving at its established resolution. Reallocating its
    # triangles when the figure changes would also move the outer petal tips.
    reduce_to(seat, 1747 if phone else 8329)
    # Edge collapses on the underside may put a vertex below the bearing ring.
    # Keep the lotus flat on the unchanged room anchor on both devices.
    for v in seat.data.vertices:
        if v.co.z < .001:
            v.co.z = 0
    seat.data.update()
    obj = join_objects([seat, *figures], NAME + ("_phone" if phone else ""))
    obj.data.update()
    count = triangles(obj.data)
    print(f"{lod}: {figure_count} figure triangles, {count} total", flush=True)
    if count > limit + 50:
        raise ValueError(f"{lod} triangle budget exceeded: {count}")
    dress(obj.data, output, lod)
    bpy.ops.export_scene.gltf(filepath=str(output / (lod + ".glb")), export_format="GLB",
                              use_selection=True, export_yup=True, export_normals=True,
                              export_texcoords=True, export_image_format="AUTO", export_animations=False)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    directory = Path(args[0]).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    for level in ("pc", "phone"):
        build(directory, level)
