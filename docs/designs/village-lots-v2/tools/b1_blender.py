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
SUN_DIR = None   # a kit may set the sun's compass direction (local) for its renders: rooms light through their windows
SUN_ELEV = 38
WORLD = 0.22
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
        if d.get("own"):
            # a lot's own map (KTX2 in the game; its PNG twin for the render): atlas UVs, no metre repeat
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = bpy.data.images.load(os.path.join(PNG, d["own"] + ".png"), check_existing=True)
            t.interpolation = "Cubic"
            nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
            b.inputs["Roughness"].default_value = 0.45
            mats[name] = m
            continue
        if d.get("fire"):
            # soft flame cards: vertex RGB = the emissive colour, vertex alpha = the soft edge
            for n in list(nt.nodes):
                if n.name != vc.name:
                    nt.nodes.remove(n)
            outn = nt.nodes.new("ShaderNodeOutputMaterial")
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Strength"].default_value = 7.0
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            mix = nt.nodes.new("ShaderNodeMixShader")
            nt.links.new(vc.outputs["Color"], em.inputs["Color"])
            nt.links.new(vc.outputs["Alpha"], mix.inputs["Fac"])
            nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
            nt.links.new(em.outputs["Emission"], mix.inputs[2])
            nt.links.new(mix.outputs["Shader"], outn.inputs["Surface"])
            try:
                m.surface_render_method = "BLENDED"
            except Exception:
                pass
            mats[name] = m
            continue
        if d.get("screen"):
            b.inputs["Base Color"].default_value = (0, 0, 0, 1)
            nt.links.new(vc.outputs["Color"], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = 1.6
            mats[name] = m
            continue
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
    cl = bm.loops.layers.float_color.new("Col")  # linear floats (a byte layer would treat the tints as sRGB)
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
            lp[cl] = (c[0], c[1], c[2], c[3] if len(c) > 3 else 1.0)
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
              export_image_format="NONE", export_vertex_color="NAME", export_vertex_color_name="Col", export_all_vertex_colors=False,
              export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
              export_skins=False, export_morph=False, export_gpu_instances=True,
              export_draco_mesh_compression_enable=("--no-draco" not in argv), export_draco_mesh_compression_level=10,
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
        if m["name"] == "M_fire":
            m["alphaMode"] = "BLEND"
            pbr["baseColorFactor"] = [0, 0, 0, 1]
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 1.0
            m["emissiveFactor"] = [1.0, 1.0, 1.0]
            m["doubleSided"] = True
            continue
        if m["name"] == "M_screen":
            m.pop("alphaMode", None)
            pbr["baseColorFactor"] = [0, 0, 0, 1]
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 1.0
            m["emissiveFactor"] = [1.0, 1.0, 1.0]
            m["doubleSided"] = False
            continue
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
        if d.get("screen"):
            mats[name] = {"kind": "screen", "note": "the garden-and-sky view behind interior windows: unlit, COLOR_0 is the colour"}
            continue
        if d.get("own"):
            mats[name] = {"kind": "own", "maps": {"albedo": d["own"] + ".ktx2"}, "uv": "atlas (TEXCOORD_0 0..1, no repeat)", "colorSpace": "srgb",
                          "note": d.get("note", "")}
            continue
        if d.get("fire"):
            mats[name] = {"kind": "fire", "note": "HOOK for L5v2: the fire__ nodes' flame cards. Draw additive (blending Additive, depthWrite "
                          "false, double-sided), unlit; COLOR_0.rgb = emissive colour, COLOR_0.a = soft edge (0 at the rim); TEXCOORD_0.x = across "
                          "the card (-1..1), TEXCOORD_0.y = height up the flame (0..1): flicker by scrolling a noise texture up y and scaling "
                          "alpha/brightness with it (time uniform), 0.6–1.2 Hz with a faster 7 Hz jitter. The node fire__<unit>_light marks "
                          "a warm point light (2200 K, ~180 cd, range 6 m) to flicker in step; L6 bakes its steady part into the hearth and floor."}
            continue
        mats[name] = {"pbr": d["set"], "repeatMeters": [1, 1], "tileMeters": tiles[d["set"]], "vertexColor": True,
                      "roughnessScale": d.get("rough", 1.0), "normalScale": d.get("normal", 1.0), "metal": bool(d.get("metal"))}
        if d.get("gain"):
            mats[name]["albedoGain"] = list(d["gain"])  # linear RGB multiplier on the set's albedo (the game's material colour)
    js = {
        "lot": lot["id"],
        "format": "ktx2",
        "note": "Every LM_ material is a shared PBR library set (client/src/village/pbr/pbrLibrary.ts getPbrSet(id, tier, gl) -> "
                "createPbrMaterial(set, { repeatMeters: [1, 1] })): the model's UVs are metres, COLOR_0 multiplies the albedo "
                "(the tint of the neutral sets), roughness = the ORM's G times roughnessScale. The lot has no maps of its own "
                "(letters, clock and numerals are geometry). M_glass is the game's glass; lotnight__ nodes take the game's glow.",
        "materials": mats,
        "pbrSets": sorted({d["set"] for n, d in kit.mats.items() if "set" in d and not n.startswith("PV_")}),
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
    bg.inputs["Strength"].default_value = (WORLD if day else 0.06)
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sun = bpy.data.objects.get("Sun")
    if sun is None:
        sun = obj("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.2 if day else 0.25
    sun.data.color = (1.0, 0.95, 0.86) if day else (0.55, 0.65, 1.0)
    sun.data.angle = math.radians(0.8)
    # a mid-morning sun from the south-south-west of the front, 38 degrees up (local: front = +z)
    sd = SUN_DIR or (5.0, 0, 9.0)
    elev = math.radians(SUN_ELEV)
    d = Vector(l2b(sd)) - Vector(l2b((0, 0, 0)))
    d = d.normalized() * math.cos(elev) + Vector((0, 0, math.sin(elev)))
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
        sc.view_settings.look = getattr(kit, "look", "AgX - Base Contrast")
        sc.view_settings.exposure = getattr(kit, "exposure", 0.0)
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
    global SUN_DIR, SUN_ELEV, WORLD
    WORLD = getattr(kit, "world_strength", 0.22)
    SUN_DIR = getattr(kit, "sun_dir", None)
    SUN_ELEV = getattr(kit, "sun_elev", 38)
    cam = obj("Cam", bpy.data.cameras.new("Cam"))
    sc.camera = cam
    haze = getattr(kit, "haze", None)
    if haze:
        # render-only: a faint warm haze in the room so the daylight through the windows shows as shafts
        (x0, x1, y0, y1, z0, z1, dens) = haze
        me = bpy.data.meshes.new("haze")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(me)
        bm.free()
        ho = obj("haze", me)
        ho.location = l2b(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
        ho.scale = (x1 - x0, z1 - z0, y1 - y0)
        hm = bpy.data.materials.new("haze")
        hm.use_nodes = True
        nt = hm.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        outn = nt.nodes.new("ShaderNodeOutputMaterial")
        vol = nt.nodes.new("ShaderNodeVolumePrincipled")
        vol.inputs["Density"].default_value = dens
        vol.inputs["Color"].default_value = (1.0, 0.93, 0.82, 1)
        nt.links.new(vol.outputs["Volume"], outn.inputs["Volume"])
        me.materials.append(hm)
        try:
            sc.eevee.volumetric_tile_size = "4"
            sc.eevee.use_volumetric_shadows = True
        except Exception:
            pass
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
                           "doors": door_extras, "roofSlabs": kit.roof_slabs,
                           "vegetation": [dict(v, x=round(l2w(v["lx"], v["lz"])[0], 2), z=round(l2w(v["lx"], v["lz"])[1], 2)) for v in getattr(kit, "vegetation", [])]})
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


# ------------------------------------------------------------------------------------------------ walk-in rooms (design 11) --

def room_check(kit, spec, size):
    """The room's numbers: (1) every corner between 0.3 and 2.2 m high inside the room stands in a solid's rectangle or a
    seat's box (or outside the room's floor: walls, window reveals, the bay alcove), 1.1 cm tolerance; (2) every seat keeps
    its 0.6 m front strip clear (0.05 .. 1.8 m) of anything but the floor; (3) the exit pad and the arrival spot are clear."""
    problems = []
    tol = 0.011
    solids = [(s["name"], (s["rect"]["x0"], s["rect"]["x1"], s["rect"]["z0"], s["rect"]["z1"]), s["height"]) for s in spec["solids"]]
    seats = []
    for s in spec["seats"]:
        h, f, b = s["length"] / 2, s["frontEdge"], s["backDepth"]
        x, z = s["x"], s["z"]
        box = {"in": (x - h, x + h, z - b, z + f), "out": (x - h, x + h, z - f, z + b), "right": (x - b, x + f, z - h, z + h), "left": (x - f, x + b, z - h, z + h)}[s["faces"]]
        c = 0.6
        front = {"in": (x - h, x + h, z + f, z + f + c), "out": (x - h, x + h, z - f - c, z - f), "right": (x + f, x + f + c, z - h, z + h), "left": (x - f - c, x - f, z - h, z + h)}[s["faces"]]
        # a built-in seat that starts within 0.3 m of a wall reaches back to it (window seats: the platform runs into the bay)
        box = (box[0] if box[0] > 0.3 else -1.0, box[1] if box[1] < size["x"] - 0.3 else size["x"] + 1.0,
               box[2] if box[2] > 0.3 else -1.0, box[3] if box[3] < size["z"] - 0.3 else size["z"] + 1.0)
        seats.append((s["id"], box, front, s["kind"]))
    zones = [r for _, r, _ in solids] + [b for _, b, _, _ in seats]

    def inside(x, z):
        # walls and what is fixed flat on them (wainscot, boards, frames: within 6 cm of the wall face) and beyond (reveals)
        if x < 0.06 or z < 0.06 or x > size["x"] - 0.06 or z > size["z"] - 0.06:
            return True
        return any(r[0] - tol <= x <= r[1] + tol and r[2] - tol <= z <= r[3] + tol for r in zones)

    def corners():
        for m in [kit.S, kit.D, kit.G]:
            for p in m.polys:
                for q in p.pts:
                    yield m.name, q
        for kind, places in kit.inst.items():
            pts = {q for p in kit.kinds[kind].polys for q in p.pts}
            for (x, y, z, yaw) in places:
                for q in pts:
                    yield "inst:" + kind, G.rot_y(q, yaw, x, y, z)

    seen = {}
    for who, q in corners():
        x, y, z = q
        if 0.3 < y < 2.2 and not inside(x, z):
            seen.setdefault(("LOOSE", who), q)
        for sid, box, front, kind in seats:
            if kind == "floor":
                continue
            if front[0] + tol < x < front[1] - tol and front[2] + tol < z < front[3] - tol and 0.05 < y < 1.8:
                seen.setdefault(("SEAT-FRONT " + sid, who), q)
        for (px, pz) in ((spec["doorX"], 0.8), (spec["doorX"], 1.6)):
            if abs(x - px) < 0.4 and abs(z - pz) < 0.4 and 0.05 < y < 2.0:
                seen.setdefault(("DOOR-CLEAR", who), q)
    for (k, who), q in seen.items():
        problems.append("%s: %s at (%.3f, %.3f, %.3f)" % (k, who, *q))
    return {"checked": {"solids": len(solids), "seats": len(seats)}, "problems": problems}


def run_room(unit_id, kit_mod, viewdef, prefix, tex_dir):
    """Build a lot's walk-in room (its own GLB `<unit>.glb`, frame at the unit's interior origin): `lotroom__<unit>` with the
    shell / furniture / goods meshes and instanced kinds, `col__<unit>_<solid>`, `seat__<seat id>`, `door__<unit>_exit`."""
    global LOT, YAW, CX, CZ
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    with open(LAYOUT, encoding="utf-8") as f:
        L = json.load(f)
    spec = next(i for i in L["interiors"] if i["unit"] == unit_id)
    lot = next(l for l in L["lots"] if l["id"] == spec["lot"])
    unit = next(u for u in lot["units"] if u["id"] == unit_id)
    org, size = unit["interior"]["origin"], unit["interior"]["size"]
    LOT, YAW, CX, CZ = unit_id, 0.0, org["x"], org["z"]
    kit = kit_mod.build(spec, unit, L)
    add_letters(kit)
    mats = make_materials(kit.mats)
    objs = []
    root = obj("lotroom__" + unit_id)
    objs.append(root)
    for name, m in (("shell", kit.S), ("furniture", kit.D), ("goods", kit.G)):
        if m.polys:
            objs.append(world_obj("lotroom__%s_%s" % (unit_id, name), m, mats, root))
    inst_tris = 0
    for kind, places in sorted(kit.inst.items()):
        grp = obj("lotinst__%s_%s" % (unit_id, kind), None, root)
        objs.append(grp)
        me = mesh_data("kind_" + kind, kit.kinds[kind], mats, lambda p: (p[0], -p[2], p[1]))
        for i, (x, y, z, yaw) in enumerate(places):
            o = obj("lotinst__%s_%s_%d" % (unit_id, kind, i), me, grp)
            o.location = l2b((x, y, z))
            o.rotation_euler = (0.0, 0.0, yaw)
            objs.append(o)
        inst_tris += kit.kinds[kind].tris() * len(places)
    for part, g in sorted(kit.night.items()):
        objs.append(world_obj("lotnight__%s_%s" % (unit_id, part), g, mats))
    for part, g in sorted(getattr(kit, "fire", {}).items()):
        objs.append(world_obj("fire__%s_%s" % (unit_id, part), g, mats, root))
    for part, p in sorted(getattr(kit, "fire_lights", {}).items()):
        objs.append(empty("fire__%s_%s" % (unit_id, part), l2b(p)))
    yaw_of = {"in": 0.0, "out": math.pi, "left": -math.pi / 2, "right": math.pi / 2}
    for s in spec["seats"]:
        objs.append(empty("seat__" + s["id"], (CX + s["x"], -(CZ + s["z"]), s["seatTop"]), yaw_of[s["faces"]]))
    objs.append(empty("door__%s_exit" % unit_id, (CX + spec["doorX"], -CZ, 0.0), math.pi))
    cube = bpy.data.meshes.new("col_unit_cube")
    v = [(x, y, z) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)]
    cube.from_pydata(v, [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    for s in spec["solids"]:
        r = s["rect"]
        o = obj("col__%s_%s" % (unit_id, s["name"]), cube)
        o.location = (CX + (r["x0"] + r["x1"]) / 2, -(CZ + (r["z0"] + r["z1"]) / 2), s["height"] / 2)
        o.scale = (r["x1"] - r["x0"], r["z1"] - r["z0"], s["height"])
        o.hide_render = True
        o.display_type = "WIRE"
        objs.append(o)
    allm = set()
    fire_meshes = list(getattr(kit, "fire", {}).values())
    for m in [kit.S, kit.D, kit.G] + list(kit.kinds.values()) + fire_meshes:
        allm |= {p.mat for p in m.polys}
    report = {"unit": unit_id, "triangles": kit.S.tris() + kit.D.tris() + kit.G.tris() + inst_tris + sum(m.tris() for m in fire_meshes),
              "shell": kit.S.tris(), "furniture": kit.D.tris(), "goods": kit.G.tris(), "instanced": inst_tris,
              "instancedKinds": {k: {"count": len(v), "triangles": kit.kinds[k].tris()} for k, v in sorted(kit.inst.items())},
              "materials": sorted(allm), "draws": sum(len({p.mat for p in m.polys}) for m in [kit.S, kit.D, kit.G]) + sum(len({p.mat for p in kit.kinds[k].polys}) for k in kit.inst),
              "budget": spec["budget"]}
    report["overlap"] = room_check(kit, spec, size)
    log("room", unit_id, "triangles", report["triangles"], "/", spec["budget"]["pc"]["triangles"], "draws", report["draws"], "materials", len(allm))
    for p in report["overlap"]["problems"][:150]:
        log(p)
    log("room problems:", len(report["overlap"]["problems"]))
    # L6: the room's light baked into a lightmap atlas (bake_lots.py), by day and by night, before the export
    lightmap = None
    if arg("--lightmap"):
        import bake_lots
        global WORLD, SUN_DIR, SUN_ELEV
        WORLD = getattr(kit, "world_strength", 0.22)
        SUN_DIR = getattr(kit, "sun_dir", None)
        SUN_ELEV = getattr(kit, "sun_elev", 38)
        night_lights(kit)
        lm = bake_lots.bake_room(kit, objs, unit_id, arg("--lightmap"), setup_world, int(arg("--lm-size", "1024")), int(arg("--lm-samples", "96")))
        if lm:
            lightmap = {"day": "lots/%s/%s_lm_day.ktx2" % (tex_dir, unit_id), "night": "lots/%s/%s_lm_night.ktx2" % (tex_dir, unit_id),
                        "scale": lm["scale"], "channel": 1, "size": lm["size"],
                        "note": "irradiance = (texel in linear) * scale on TEXCOORD_1 of the lotroom__ shell (bake_lots.py)"}
    out = arg("--out", os.path.join(LOTS, unit_id + ".glb"))
    if "--no-export" not in argv:
        manifest = os.path.join(LOTS, tex_dir, "%s_textures.json" % unit_id)
        write_manifest(kit, {"id": unit_id}, manifest)
        export(out, objs, {"caysonverse": "%s (lots v2 B1 room kit)" % unit_id, "textures": "lots/%s/%s_textures.json" % (tex_dir, unit_id),
                           "origin": org, "size": size, **({"lightmap": lightmap} if lightmap else {})})
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
