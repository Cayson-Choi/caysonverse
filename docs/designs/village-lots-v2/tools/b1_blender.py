"""B1 (lots v2: school + library) — the Blender side shared by parts_lot_school.py and parts_lot_library.py (Blender 5.3,
background): turn a kit (school_kit / library_kit, pure python on b1_geom.py) into objects, check it numerically, export the
lot's own GLB (Draco, no images: the PBR library's KTX2 sets are named in a texture manifest) and render it.

Nodes (contract 6): `lotshell__<lot>` (always drawn); `lotdetail__<lot>` (empty, near-only) with `lotdetail__<lot>_mesh`
(structure) and `lotgoods__<lot>` (empty: `lotgoods__<lot>_mesh` + one empty per instanced kind `lotinst__<lot>_<kind>` whose
children share one mesh -> EXT_mesh_gpu_instancing); `lotnight__<lot>_<part>` (night glow, COLOR_0 = the glow colour; the game
draws them with its own night material); `door__<door id>` (empty at the door's centre on the wall line, game yaw) with the
two swing leaves `door__<door id>_l` / `_r` (origin = the hinge on the jamb, they turn 0 -> 90 degrees inward: asset.extras.
doors); `seat__<seat id>`; `slot__<lot>_<name>`; `col__<id>` (unit cubes, translation + scale, the contract's boxes to the cm).
Materials: `LM_<lot>_<surface>` -> a PBR library set (texture manifest `lots/<dir>/<lot>_textures.json`), `M_glass`.
"""
import json
import math
import os
import re
import struct
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import b1_geom as G  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
LOTS = os.path.join(REPO, "client", "public", "models", "village", "lots")
LAYOUT = arg("--layout")
PNG = arg("--png")  # decoded KTX2 sets (ktx2png.cjs) for the renders
REPORT = arg("--report")
RENDERS = arg("--renders")
VIEWS = arg("--views")
TIMES = arg("--times", "day,night").split(",")
RES = tuple(int(v) for v in arg("--res", "1280x800").split("x"))
SAMPLES = int(arg("--samples", "16"))
BLEND = arg("--blend")
T0 = time.time()
LOT = None
YAW = 0.0
CX = CZ = 0.0


def log(*a):
    print("[b1 %6.1fs]" % (time.time() - T0), *a, flush=True)


DOOR_YAW = {"s": 0.0, "n": math.pi, "e": math.pi / 2, "w": -math.pi / 2}


def l2w(x, z):
    """Lot local (x, z) -> world (x, z): rotation about +y by the door yaw (lotLocalToWorld)."""
    c, s = math.cos(YAW), math.sin(YAW)
    return (CX + x * c + z * s, CZ - x * s + z * c)


def l2b(p):
    wx, wz = l2w(p[0], p[2])
    return (wx, -wz, p[1])


def w2l(wx, wz):
    dx, dz = wx - CX, wz - CZ
    c, s = math.cos(YAW), math.sin(YAW)
    return (dx * c - dz * s, dx * s + dz * c)


# ------------------------------------------------------------------------------------------------ materials --

def tile_meters():
    src = open(os.path.join(REPO, "client", "src", "village", "pbr", "pbrManifest.generated.ts"), encoding="utf-8").read()
    return {m.group(1): float(m.group(2)) for m in re.finditer(r'"id": "([a-z0-9_]+)",[\s\S]*?"tileMeters": ([0-9.]+)', src)}


def make_materials(matdefs):
    tiles = tile_meters()
    mats = {}
    for name, d in matdefs.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        if d.get("glass"):
            b.inputs["Base Color"].default_value = (0.6, 0.66, 0.7, 1)
            b.inputs["Roughness"].default_value = 0.03
            b.inputs["Alpha"].default_value = 0.14
            b.inputs["IOR"].default_value = 1.5
            try:
                m.surface_render_method = "BLENDED"
            except Exception:
                pass
            mats[name] = m
            continue
        sid = d["set"]
        k = 1.0 / tiles[sid]
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (k, k, 1)
        nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])

        def img(kind, data):
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = bpy.data.images.load(os.path.join(PNG, "%s_%s.png" % (sid, kind)), check_existing=True)
            if data:
                t.image.colorspace_settings.name = "Non-Color"
            t.interpolation = "Cubic"
            nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
            return t
        a = img("albedo", False)
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        nt.links.new(a.outputs["Color"], mx.inputs["A"])
        nt.links.new(vc.outputs["Color"], mx.inputs["B"])
        ao = nt.nodes.new("ShaderNodeMix")
        ao.data_type = "RGBA"
        ao.blend_type = "MULTIPLY"
        ao.inputs["Factor"].default_value = 1.0
        nt.links.new(mx.outputs["Result"], ao.inputs["A"])
        aon = None
        nrm = img("normal", True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = d.get("normal", 1.0)
        nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
        orm = img("orm", True)
        sp = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(orm.outputs["Color"], sp.inputs["Color"])
        nt.links.new(sp.outputs["Red"], ao.inputs["B"])
        nt.links.new(ao.outputs["Result"], b.inputs["Base Color"])
        rm = nt.nodes.new("ShaderNodeMath")
        rm.operation = "MULTIPLY"
        rm.inputs[1].default_value = d.get("rough", 1.0)
        nt.links.new(sp.outputs["Green"], rm.inputs[0])
        nt.links.new(rm.outputs["Value"], b.inputs["Roughness"])
        if d.get("metal"):
            nt.links.new(sp.outputs["Blue"], b.inputs["Metallic"])
        else:
            b.inputs["Metallic"].default_value = 0.0
        mats[name] = m
    # night glow (render only; the GLB's night nodes keep M_glass, the game draws them with its own glow material)
    g = bpy.data.materials.new("R_night")
    g.use_nodes = True
    nt = g.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    em.inputs["Strength"].default_value = 6.0
    nt.links.new(vc.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    mats["R_night"] = g
    return mats


# ------------------------------------------------------------------------------------------------ objects --

def mesh_data(name, mesh, mats, xf):
    """A Blender mesh from a kit Mesh; `xf` maps a local point to the object's space."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    cl = bm.loops.layers.color.new("Col")
    order = sorted({p.mat for p in mesh.polys})
    idx = {m: i for i, m in enumerate(order)}
    for m in order:
        me.materials.append(mats[m])
    for p in mesh.polys:
        vs = [bm.verts.new(xf(q)) for q in p.pts]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            continue
        f.material_index = idx[p.mat]
        f.smooth = p.smooth
        for lp, uv, c in zip(f.loops, p.uv, p.col):
            lp[uvl].uv = uv
            lp[cl] = (c[0], c[1], c[2], 1.0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.color_attributes.active_color = me.color_attributes["Col"]
    return me


def obj(name, data=None, parent=None):
    o = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    return o


def world_obj(name, mesh, mats, parent=None):
    return obj(name, mesh_data(name, mesh, mats, l2b), parent)


def empty(name, loc, yaw=0.0, parent=None):
    o = obj(name, None, parent)
    o.empty_display_size = 0.3
    o.location = loc
    o.rotation_euler = (0.0, 0.0, yaw)
    return o


def add_letters(kit):
    """3D letters (LOT_SIGN_WORDS only): Blender text -> mesh (extruded), into the kit's meshes as polygons."""
    font = None
    for f in ("C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf"):
        if os.path.exists(f):
            font = bpy.data.fonts.load(f, check_existing=True)
            break
    for L in kit.letters:
        text, at, out, size, depth, surf, target = L
        cu = bpy.data.curves.new("txt", "FONT")
        cu.body = text
        cu.font = font
        cu.size = size / 0.72  # Blender's size is the em; a Hangul glyph is ~0.72 em tall
        cu.extrude = depth / 2
        cu.align_x = "CENTER"
        cu.align_y = "BOTTOM_BASELINE"
        cu.resolution_u = 2
        o = bpy.data.objects.new("txt", cu)
        bpy.context.scene.collection.objects.link(o)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        log("letters", text, sum(1 for f in bm.faces if f.normal.z >= -0.5), "triangles")
        out_v = G.norm(out)
        right = G.norm(G.cross((0, 1, 0), out_v))
        mesh = getattr(kit, target)
        for f in bm.faces:
            if f.normal.z < -0.5:
                continue  # the back faces lie on the board
            pts = []
            for v in f.verts:
                x, y, z = v.co
                p = G.add(at, G.add(G.mul(right, x), G.add((0, y, 0), G.mul(out_v, z + depth / 2))))
                pts.append(p)
            mesh.poly(pts, surf)
        bm.free()
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)


def build_objects(lot, kit, mats):
    objs = []
    lid = lot["id"]
    objs.append(world_obj("lotshell__" + lid, kit.S, mats))
    det = obj("lotdetail__" + lid)
    objs.append(det)
    objs.append(world_obj("lotdetail__%s_mesh" % lid, kit.D, mats, det))
    goods = obj("lotgoods__" + lid, None, det)
    objs.append(goods)
    objs.append(world_obj("lotgoods__%s_mesh" % lid, kit.G, mats, goods))
    inst_tris = 0
    for kind, places in sorted(kit.inst.items()):
        grp = obj("lotinst__%s_%s" % (lid, kind), None, goods)
        objs.append(grp)
        me = mesh_data("kind_" + kind, kit.kinds[kind], mats, lambda p: (p[0], -p[2], p[1]))
        for i, (x, y, z, yaw) in enumerate(places):
            o = obj("lotinst__%s_%s_%d" % (lid, kind, i), me, grp)
            o.location = l2b((x, y, z))
            o.rotation_euler = (0.0, 0.0, YAW + yaw)
            objs.append(o)
        inst_tris += kit.kinds[kind].tris() * len(places)
    for part, g in sorted(kit.night.items()):
        o = world_obj("lotnight__%s_%s" % (lid, part), g, mats)
        objs.append(o)
    leaf_tris = 0
    door_extras = {}
    for d in lot["doors"]:
        e = empty("door__" + d["id"], (d["centre"]["x"], -d["centre"]["z"], 0.0), d["yaw"])
        objs.append(e)
        door_extras[d["id"]] = {}
        for name, mesh, hinge, sign in kit.doors.get(d["id"], []):
            # leaf mesh in the lot's local axes with the hinge at its origin -> child of the door node (same yaw)
            me = mesh_data("door__%s_%s" % (d["id"], name), mesh, mats, lambda p: (p[0], -p[2], p[1]))
            o = obj("door__%s_%s" % (d["id"], name), me)
            bpy.context.view_layer.update()
            o.parent = e
            o.matrix_parent_inverse = Matrix.Identity(4)
            o.matrix_basis = e.matrix_world.inverted() @ (Matrix.Translation(Vector(l2b(hinge))) @ Matrix.Rotation(YAW, 4, "Z"))
            objs.append(o)
            leaf_tris += mesh.tris()
            door_extras[d["id"]][name] = {"axis": "y", "openDeg": 90 * sign, "inward": True}
    for s in lot["seats"]:
        objs.append(empty("seat__" + s["id"], (s["x"], -s["z"], s["seatTop"]), s["yaw"]))
    for s in lot["slots"]:
        if s["where"] == "exterior":
            objs.append(empty(s["node"], (s["x"], -s["z"], s["y"]), s["yaw"]))
        else:
            u = next(u for u in lot["units"] if "interior:" + u["id"] == s["where"])
            o = u["interior"]["origin"]
            objs.append(empty(s["node"], (o["x"] + s["x"], -(o["z"] + s["z"]), s["y"]), s["yaw"]))
    cube = bpy.data.meshes.new("col_unit_cube")
    v = [(x, y, z) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)]
    cube.from_pydata(v, [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    for c in lot["colliders"]:
        b = c["box"]
        h = c["cameraHeight"] if c["camera"] else 1.0
        o = obj("col__" + c["id"], cube)
        o.location = ((b["minX"] + b["maxX"]) / 2, -(b["minZ"] + b["maxZ"]) / 2, h / 2)
        o.scale = (b["maxX"] - b["minX"], b["maxZ"] - b["minZ"], h)
        o.hide_render = True
        o.display_type = "WIRE"
        objs.append(o)
    allmats = set()
    for m in [kit.S, kit.D, kit.G] + list(kit.kinds.values()) + list(kit.night.values()):
        allmats |= {p.mat for p in m.polys}
    report = {
        "shellTriangles": kit.S.tris(),
        "structureTriangles": kit.D.tris() + leaf_tris,
        "goodsMeshTriangles": kit.G.tris(),
        "instancedKinds": {k: {"count": len(v), "triangles": kit.kinds[k].tris()} for k, v in sorted(kit.inst.items())},
        "instancedRenderedTriangles": inst_tris,
        "doorLeafTriangles": leaf_tris,
        "detailRenderedTriangles": kit.D.tris() + kit.G.tris() + inst_tris,
        "nightTriangles": {k: g.tris() for k, g in kit.night.items()},
        "materials": sorted(allmats),
        "drawCalls": {"shell": len({p.mat for p in kit.S.polys}), "detail": len({p.mat for p in kit.D.polys}), "goods": len({p.mat for p in kit.G.polys})},
    }
    return objs, report, door_extras


# ------------------------------------------------------------------------------------------------ checks --

def overlap_check(kit, lot):
    """Numbers, not eyes (owner 2026-11-17: "자동문이 주위의 물체와 겹치잖아 제발 좀 꼼꼼하게 확인해"):
    (1) every corner of every polygon higher than 0.3 m and lower than 2.2 m (shell, structure, goods, every instance, the
        door leaves closed and open) stands inside one of the contract's collider rectangles (1.1 cm tolerance);
    (2) every corner of everything stands inside the footprint (eaves and crowns included);
    (3) the door sweeps (width x width/2 inside the body) hold nothing but the leaves, floor to door head;
    (4) the kit's solid parts (props) never interpenetrate (different groups);
    (5) each seat has >= 0.6 m clear in front of its front edge, floor to 1.8 m;
    (6) the leaves swung open (90 deg) stay inside the body box."""
    problems = []
    rects = [(c["id"], w2rect(c["box"])) for c in lot["colliders"]]
    tol = 0.011
    fp = w2rect(lot["footprint"])
    sweeps = kit.sweeps

    def inside_any(x, z):
        return any(r[0] - tol <= x <= r[1] + tol and r[2] - tol <= z <= r[3] + tol for _, r in rects)

    def corners():
        for m in [kit.S, kit.D, kit.G] + list(kit.night.values()):
            for p in m.polys:
                for q in p.pts:
                    yield m.name, q
        for kind, places in kit.inst.items():
            km = kit.kinds[kind]
            pts = {q for p in km.polys for q in p.pts}
            for (x, y, z, yaw) in places:
                for q in pts:
                    yield "inst:" + kind, G.rot_y(q, yaw, x, y, z)
        for did, leaves in kit.doors.items():
            for name, mesh, hinge, sign in leaves:
                pts = {q for p in mesh.polys for q in p.pts}
                for ang in (0.0, sign * math.pi / 2):
                    for q in pts:
                        yield "door:%s_%s@%d" % (did, name, round(math.degrees(ang))), G.rot_y(q, ang, *hinge)

    seen = {}
    for who, q in corners():
        x, y, z = q
        if not (fp[0] - tol <= x <= fp[1] + tol and fp[2] - tol <= z <= fp[3] + tol):
            seen.setdefault(("FOOTPRINT", who), q)
        if 0.3 < y < 2.2 and not inside_any(x, z):
            seen.setdefault(("OUTSIDE-COLLIDER", who), q)
        for lbl, r, h in sweeps:
            if who.startswith("door:"):
                continue
            if r[0] + tol < x < r[1] - tol and r[2] + tol < z < r[3] - tol and 0.02 < y < h:
                seen.setdefault(("DOOR-SWEEP " + lbl, who), q)
    for (kind, who), q in seen.items():
        problems.append("%s: %s at (%.3f, %.3f, %.3f)" % (kind, who, q[0], q[1], q[2]))
    props = [(lbl, b, k) for m in [kit.S, kit.D, kit.G] for (lbl, b, k) in m.props]
    props += kit.extra_props
    for i in range(len(props)):
        for j in range(i + 1, len(props)):
            a, b = props[i], props[j]
            if a[0].split(":")[0] == b[0].split(":")[0]:
                continue
            if G.box_overlap(a[1], b[1], 0.004):
                problems.append("INTERPENETRATE: %s x %s" % (a[0], b[0]))
    for s in lot["seats"]:
        lx, lz = w2l(s["x"], s["z"])
        fx, fz = G.rot_y((0, 0, 1), 0)[0], 1.0
        # facing in local terms (seat yaw - lot yaw)
        ang = s["yaw"] - YAW
        fdx, fdz = math.sin(ang), math.cos(ang)
        sdx, sdz = fdz, -fdx
        e0 = s["frontEdge"]
        zone = []
        for a in (e0 + 0.01, e0 + 0.6):
            for bb in (-s["length"] / 2, s["length"] / 2):
                zone.append((lx + fdx * a + sdx * bb, lz + fdz * a + sdz * bb))
        zx0, zx1 = min(p[0] for p in zone), max(p[0] for p in zone)
        zz0, zz1 = min(p[1] for p in zone), max(p[1] for p in zone)
        for who, q in corners():
            if zx0 < q[0] < zx1 and zz0 < q[2] < zz1 and 0.05 < q[1] < 1.8:
                problems.append("SEAT-FRONT %s blocked by %s at (%.2f, %.2f, %.2f)" % (s["id"], who, *q))
                break
        for cid, r in rects:
            if cid == s["id"]:
                continue  # the bench's own box (the sitter's feet)
            if r[0] < zx1 - tol and r[1] > zx0 + tol and r[2] < zz1 - tol and r[3] > zz0 + tol:
                problems.append("SEAT-FRONT %s overlaps collider %s" % (s["id"], cid))
    body = lot["body"]
    for did, leaves in kit.doors.items():
        for name, mesh, hinge, sign in leaves:
            for p in mesh.polys:
                for q in p.pts:
                    x, y, z = G.rot_y(q, sign * math.pi / 2, *hinge)
                    if not (body["x0"] - tol <= x <= body["x1"] + tol and body["z0"] - tol <= z <= body["z1"] + tol):
                        problems.append("LEAF-OUT-OF-BODY %s_%s" % (did, name))
                        break
    return {"checked": {"colliders": len(rects), "sweeps": len(sweeps), "props": len(props), "seats": len(lot["seats"])}, "problems": problems}


def w2rect(b):
    a = w2l(b["minX"], b["minZ"])
    c = w2l(b["maxX"], b["maxZ"])
    return (min(a[0], c[0]), max(a[0], c[0]), min(a[1], c[1]), max(a[1], c[1]))


# ------------------------------------------------------------------------------------------------ export --

def export(path, objs, extras):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
              export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
              export_image_format="NONE", export_vertex_color="ACTIVE", export_all_vertex_colors=False,
              export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
              export_skins=False, export_morph=False, export_gpu_instances=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
              export_draco_position_quantization=14, export_draco_normal_quantization=10,
              export_draco_texcoord_quantization=14, export_draco_color_quantization=8, export_draco_generic_quantization=12)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_all_vertex_colors", None)
        bpy.ops.export_scene.gltf(**kw)
    patch_glb(path, extras)


def patch_glb(path, extras):
    data = open(path, "rb").read()
    clen, _ = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen].decode("utf-8"))
    rest = data[20 + clen:]
    for m in js.get("materials", []):
        pbr = m.setdefault("pbrMetallicRoughness", {})
        for k in ("baseColorTexture", "metallicRoughnessTexture"):
            pbr.pop(k, None)
        for k in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            m.pop(k, None)
        m.pop("extensions", None)
        if m["name"] == "M_glass":
            m["alphaMode"] = "BLEND"
            pbr["baseColorFactor"] = [0.03, 0.045, 0.05, 0.3]
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 0.05
        else:
            m.pop("alphaMode", None)
            pbr["baseColorFactor"] = [1, 1, 1, 1]
            pbr["metallicFactor"] = 1.0
            pbr["roughnessFactor"] = 1.0
        m["doubleSided"] = False
    for k in ("textures", "images", "samplers"):
        js.pop(k, None)
    used = js.get("extensionsUsed", [])
    js["extensionsUsed"] = [e for e in used if e not in ("KHR_materials_ior", "KHR_materials_specular", "KHR_materials_transmission", "KHR_texture_transform")]
    if not js["extensionsUsed"]:
        js.pop("extensionsUsed")
    js.setdefault("asset", {})["extras"] = extras
    blob = json.dumps(js, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    blob += b" " * ((4 - len(blob) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(blob) + len(rest)) + struct.pack("<II", len(blob), 0x4E4F534A) + blob + rest
    open(path, "wb").write(out)


def glb_stats(path):
    data = open(path, "rb").read()
    clen, _ = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen].decode("utf-8"))
    return {"bytes": len(data), "materials": [m["name"] for m in js.get("materials", [])], "nodes": len(js.get("nodes", [])),
            "images": len(js.get("images", []))}


def write_manifest(kit, lot, path):
    tiles = tile_meters()
    mats = {}
    for name, d in sorted(kit.mats.items()):
        if name.startswith("PV_"):
            continue
        if d.get("glass"):
            mats[name] = {"kind": "glass"}
            continue
        mats[name] = {"pbr": d["set"], "repeatMeters": [1, 1], "tileMeters": tiles[d["set"]], "vertexColor": True,
                      "roughnessScale": d.get("rough", 1.0), "normalScale": d.get("normal", 1.0), "metal": bool(d.get("metal"))}
    js = {
        "lot": lot["id"],
        "format": "ktx2",
        "note": "Every LM_ material is a shared PBR library set (client/src/village/pbr/pbrLibrary.ts getPbrSet(id, tier, gl) -> "
                "createPbrMaterial(set, { repeatMeters: [1, 1] })): the model's UVs are metres, COLOR_0 multiplies the albedo "
                "(the tint of the neutral sets), roughness = the ORM's G times roughnessScale. The lot has no maps of its own "
                "(letters, clock and numerals are geometry). M_glass is the game's glass; lotnight__ nodes take the game's glow.",
        "materials": mats,
        "pbrSets": sorted({d["set"] for n, d in kit.mats.items() if not d.get("glass") and not n.startswith("PV_")}),
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(js, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ------------------------------------------------------------------------------------------------ renders --

def setup_world(day):
    sc = bpy.context.scene
    w = bpy.data.worlds.get("W") or bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
    except Exception:
        pass
    try:
        sky.sun_elevation = math.radians(38 if day else -12)
        sky.sun_rotation = math.radians(200)
    except Exception:
        pass
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.22 if day else 0.02
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sun = bpy.data.objects.get("Sun")
    if sun is None:
        sun = obj("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.2 if day else 0.04
    sun.data.color = (1.0, 0.95, 0.86) if day else (0.55, 0.65, 1.0)
    sun.data.angle = math.radians(0.8)
    # a mid-morning sun from the south-south-west of the front, 38 degrees up (local: front = +z)
    d = Vector(l2b((5.0, 0, 9.0))) - Vector(l2b((0, 0, 0)))
    d = d.normalized() * math.cos(math.radians(38)) + Vector((0, 0, math.sin(math.radians(38))))
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    for o in bpy.data.objects:
        if o.name.startswith("lotnight__") or o.name.startswith("nightlight_"):
            o.hide_render = day
        if o.name.startswith("dayfill_"):
            o.hide_render = not day


def ground(kit, mats):
    """The render's ground: the kit's preview ground (lawn, paving, the lane), not exported (vrb2 owns the ground)."""
    me = mesh_data("ground", kit.ground, mats, l2b)
    o = obj("ground", me)
    return o


def night_lights(kit):
    for i, L in enumerate(kit.lights):
        kind, x, y, z, col, power = L[:6]
        if kind == "spot":
            ld = bpy.data.lights.new("nightlight_%d" % i, "SPOT")
            ld.spot_size = math.radians(110)
            ld.spot_blend = 0.8
        elif kind == "area":
            ld = bpy.data.lights.new("nightlight_%d" % i, "AREA")
            ld.size = L[6] if len(L) > 6 else 1.0
        else:
            ld = bpy.data.lights.new("nightlight_%d" % i, "POINT")
            ld.shadow_soft_size = 0.08
        ld.energy = power
        ld.color = col
        lo = obj(ld.name, ld)
        lo.location = l2b((x, y, z))
        if kind in ("spot", "area"):
            lo.rotation_euler = (0, 0, 0)  # pointing down
    for i, (x, y, z, size, w) in enumerate(kit.dayfill):
        ld = bpy.data.lights.new("dayfill_%d" % i, "AREA")
        ld.size = size
        ld.energy = w
        ld.color = (1.0, 0.96, 0.9)
        lo = obj(ld.name, ld)
        lo.location = l2b((x, y, z))


def render_all(kit, mats, outdir, viewdef, prefix):
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            pass
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Base Contrast"
    except Exception:
        pass
    try:
        ee = sc.eevee
        ee.taa_render_samples = SAMPLES
        ee.use_raytracing = True
        ee.use_shadows = True
        ee.shadow_resolution_scale = 1.0
    except Exception:
        pass
    cam = obj("Cam", bpy.data.cameras.new("Cam"))
    sc.camera = cam
    ground(kit, mats)
    night_lights(kit)
    for o in bpy.data.objects:
        if o.name.startswith("lotnight__"):
            o.data.materials.clear()
            o.data.materials.append(mats["R_night"])
    views = VIEWS.split(",") if VIEWS else list(viewdef)
    for t in TIMES:
        setup_world(t == "day")
        for v in views:
            p, q, lens = viewdef[v]
            cam.location = l2b(p)
            d = Vector(l2b(q)) - cam.location
            cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
            cam.data.lens = lens
            cam.data.clip_start = 0.05
            sc.render.filepath = os.path.join(outdir, "%s_%s_%s.jpg" % (prefix, v, t))
            bpy.ops.render.render(write_still=True)
            log("render", sc.render.filepath)


# ------------------------------------------------------------------------------------------------ main --

def run(lot_id, kit_mod, viewdef, prefix, tex_dir):
    global LOT, YAW, CX, CZ
    LOT = lot_id
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    with open(LAYOUT, encoding="utf-8") as f:
        L = json.load(f)
    lot = next(l for l in L["lots"] if l["id"] == lot_id)
    CX, CZ = lot["centre"]["x"], lot["centre"]["z"]
    YAW = DOOR_YAW[lot["doorSide"]]
    kit = kit_mod.build(lot, L)
    add_letters(kit)
    mats = make_materials(kit.mats)
    objs, report, door_extras = build_objects(lot, kit, mats)
    report["overlap"] = overlap_check(kit, lot)
    log("shell", report["shellTriangles"], "structure", report["structureTriangles"], "detail rendered", report["detailRenderedTriangles"],
        "materials", len(report["materials"]), report["drawCalls"])
    for p in report["overlap"]["problems"][:150]:
        log(p)
    log("overlap problems:", len(report["overlap"]["problems"]), report["overlap"]["checked"])
    out = arg("--out", os.path.join(LOTS, lot_id + ".glb"))
    manifest = os.path.join(LOTS, tex_dir, "%s_textures.json" % lot_id)
    if "--no-export" not in argv:
        write_manifest(kit, lot, manifest)
        export(out, objs, {"caysonverse": "%s (lots v2 B1 kit)" % lot_id, "textures": "lots/%s/%s_textures.json" % (tex_dir, lot_id),
                           "doors": door_extras, "roofSlabs": kit.roof_slabs})
        report["glb"] = glb_stats(out)
        log("wrote", out, report["glb"])
    if REPORT:
        with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
            f.write("\n")
    if BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    if RENDERS:
        os.makedirs(RENDERS, exist_ok=True)
        render_all(kit, mats, RENDERS, viewdef, prefix)
    log("done")
