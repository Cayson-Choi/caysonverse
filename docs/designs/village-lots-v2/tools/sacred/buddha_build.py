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


def dress(mesh, output, lod):
    from buddha_head import FACE, FACE_AXIS, HEAD_X, URNA_RADII, URNA_Z, profile
    from buddha_ear_atlas import ear_chart_uv, ear_finish_patch, ear_tangent_basis

    access = local_access(mesh)
    tiles = {key:i for i,key in enumerate(KEYS)}
    face_limit = .180
    chin, crown = 1.420, 1.820
    curl_lattice = mesh.uv_layers["Curl lattice"]
    uv = mesh.uv_layers.new(name="Leaf and pigment")
    for p in mesh.polygons:
        finish = mesh.materials[p.material_index].name
        for k in p.loop_indices:
            index = mesh.loops[k].vertex_index
            x,y,z = mesh.vertices[index].co
            if finish == "Face pigment":
                u = .5 + (x-HEAD_X)/(2*face_limit)
                v = min(.997, max(.003, (z-chin)/(crown-chin)))
                uv.data[k].uv = (.5 + .5*u, v)
                continue
            if finish == "Auricular relief":
                u,v = ear_chart_uv(x-HEAD_X,y,z)
                tile = tiles["crease"]
                uv.data[k].uv = ((tile%4+u)/8,(tile//4+v)/2)
                continue
            tile = tiles[finish]
            if finish == "urna":
                # Project the little burnished dome onto its own gilt swatch.
                u = .5+.43*(x-HEAD_X-FACE_AXIS)/URNA_RADII[0]
                v = .5+.43*(z-URNA_Z)/URNA_RADII[2]
                uv.data[k].uv = ((tile%4+u)/8,(tile//4+v)/2)
                continue
            if finish == "hair":
                u,v = curl_lattice.data[k].uv
                uv.data[k].uv = ((tile%4+u)/8,(tile//4+v)/2)
                continue
            phase = .50 + .47*math.sin(7*x + 6*y + 9*z + .6*math.sin(5*y - 4*z))
            tone = access[index]
            if finish == "skin" and 1.42 < z < 1.48:
                # Soft contact wash on the anterior neck directly under the chin.
                under_chin = math.exp(-((x-HEAD_X)/.091)**2-((y-.075)/.043)**2
                                      -((z-1.450)/.018)**2)
                tone = max(.05, tone-.24*under_chin)
            uv.data[k].uv = ((tile%4 + .06 + .88*tone)/8,
                             (tile//4 + .06 + .88*phase)/2)
    for layer in list(mesh.uv_layers):
        if layer.name != "Leaf and pigment":
            mesh.uv_layers.remove(layer)
    mesh.uv_layers.active = mesh.uv_layers[0]
    mesh.uv_layers[0].active_render = True
    ear_basis = ear_tangent_basis(mesh, mesh.uv_layers[0])
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
            if key == "crease":
                ear_finish_patch(patch, kind, ear_basis)
                continue
            if kind == "color":
                for channel, value in enumerate(color):
                    # Subtle warm reflected light remains in leaf recesses.
                    shade = .86 + .14*ao if key == "skin" else .73 + .27*ao
                    linear = np.clip(value * shade * (1+.009*wave), 0, 1)
                    patch[:,:,channel] = np.where(linear <= .0031308, 12.92*linear, 1.055*linear**(1/2.4)-.055)
            elif kind == "orm":
                patch[:,:,0] = .81 + .19*ao if key == "skin" else .46 + .54*ao
                patch[:,:,1] = rough + .016*wave + .026*(1-ao)
                patch[:,:,2] = metal
            else:
                strength = .006 if key == "gold" else .002
                patch[:,:,0] = .5 + strength*wave
                patch[:,:,1] = .5 + strength*np.sin(31*v+11*u)
                patch[:,:,2] = 1
            if key == "urna" and kind == "color":
                # A broad pale crest rolls into the warmer foot of the bead.
                crest = np.exp(-((u-.46)/.27)**2-((v-.69)/.25)**2)
                for c, value in enumerate(color):
                    linear = value*(.81+.19*v)+(1.-value*.81)*crest
                    patch[:,:,c] = np.where(linear<=.0031308,12.92*linear,1.055*linear**(1/2.4)-.055)
            if key == "urna" and kind == "orm":
                patch[:,:,0] = 1.
                patch[:,:,1] = .39
                patch[:,:,2] = .71
            if key == "hair":
                # Seven whorls accommodate six beads and the inter-row offset
                # at the forehead without sampling outside the hair swatch.
                x = 2*np.mod(7*(u-.04)/.92, 1)-1
                y = 2*(v-.04)/.92-1
                r = np.sqrt(x*x+y*y)
                angle = np.arctan2(y,x)
                dome = np.clip(1-r*r,0,1)**1.32
                whorl = np.cos(angle-7.4*r-.72)
                groove = .021*dome*(1-np.exp(-r*r/.045))*(.5+.5*whorl)**3
                if kind == "normal":
                    height = .69*dome-groove
                    dy,dx = np.gradient(height, 2/(.92*(tile_height-1)),14/(.92*(tile_size-1)))
                    length = np.sqrt(1+dx*dx+dy*dy)
                    patch[:,:,0] = .5-.5*dx/length
                    patch[:,:,1] = .5-.5*dy/length
                    patch[:,:,2] = .5+.5/length
                elif kind == "color":
                    # The exposed upper crest of each bead is burnished;
                    # the black lacquer still collects in the low turns.
                    crest = np.exp(-((x+.11)/.44)**2-((y-.34)/.32)**2)
                    for c,value in enumerate(color):
                        linear = value*(.12+2.95*dome-groove)+(.080,.084,.090)[c]*crest
                        # The phone has no overhead spot. Lift the shoulders
                        # and the top of each bead while retaining black seams.
                        if lod == "phone":
                            shoulder = 4*dome*(1-dome)
                            linear = .0025+3.70*linear+.021*shoulder*(1-crest)+.060*dome**3
                        patch[:,:,c] = np.where(linear<=.0031308,12.92*linear,1.055*linear**(1/2.4)-.055)
                else:
                    patch[:,:,0] = .54+.44*dome
                    patch[:,:,1] = rough+.15*(1-dome)
                    patch[:,:,2] = .83-.73*dome
                    if lod == "pc":
                        # The warm altar spot is reflected at grazing angles.
                        # Dark lacquer on the raised beads gives a softer return.
                        patch[:,:,1] += .13*dome
                        patch[:,:,2] += .30*dome
        x = ((np.arange(w//2)+.5)/(w//2)*2 - 1)*face_limit
        z = chin + (np.arange(h)+.5)/h*(crown-chin)
        jaw_width = np.array([profile(FACE, height)[0] for height in z])
        arr[:,w//2:,:3] = face_patch(kind, x[None,:], z[:,None], phone=lod == "phone",
                                      half_width=jaw_width[:,None])
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
    limit = 10000 if phone else 40000
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
    if count > limit:
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
