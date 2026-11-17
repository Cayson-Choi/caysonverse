"""B2 (lots v2: 성당 + 교회) — the Blender side of the two walk-in rooms, on B1's b1_blender.py (shared helpers, unchanged):
b1_blender.run_room plus what a sacred room needs (contract 11, design 11.2):

  * the sacred props (sacred.json: statues, crucifix, stained glass, stations, the church cross) are their own GLBs: the room
    GLB carries one empty per placement — `lotstatue__<unit>_<name>`, `lotglass__<unit>_<name>`, `lotprop__<unit>_<name>` —
    at the prop's origin with its yaw, and `asset.extras.sacred` lists them (file, phone file, numeral to show, triangles);
    the renders import the props' PNG-textured masters (art/sacred/build, same meshes as the KTX2 files) at those empties;
  * the coloured light pools under the windows (`lotlight__<unit>_pools`, material M_lightpool: the glass's transmission
    maps projected along the sun, additive, unlit — L5v2 scales it with daylight, L6 may bake it instead);
  * candle flames (`fire__<unit>_candles`, M_fire: B1's flicker hook) and `fire__<unit>_light`;
  * room lights that stay on by day (chandeliers, the altar's spots, candles) for the renders;
  * the numeric room check of b1_blender.room_check plus the sacred props' boxes (statues on their solids, wall pieces
    flat in or on their wall).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import b1_blender as B  # noqa: E402
import b1_geom as G  # noqa: E402

SACRED_SRC = B.arg("--sacred-src", "D:/ClaudeCode/caysonverse-sacred/art/sacred/build")
SACRED_DIR = os.path.join(B.LOTS, "sacred")
# the PNG-textured masters the sacred builder exported before KTX2 (same meshes): name -> path under SACRED_SRC
MASTERS = {
    "lotstatue__lot_chapel_nave_mary": "mary/lotstatue__lot_chapel_nave_mary.glb",
    "lotstatue__lot_chapel_nave_saint_a": "saint_a/lotstatue__lot_chapel_nave_saint_a.glb",
    "lotstatue__lot_chapel_nave_saint_b": "saint_b/lotstatue__lot_chapel_nave_saint_b.glb",
    "lotstatue__lot_chapel_nave_crucifix": "z_crucifix/lotstatue__lot_chapel_nave_crucifix.glb",
    "lotglass__lot_chapel_nave_glass_lancet_virgin": "props/lotglass__lot_chapel_nave_glass_lancet_virgin.glb",
    "lotglass__lot_chapel_nave_glass_lancet_nativity": "props/lotglass__lot_chapel_nave_glass_lancet_nativity.glb",
    "lotglass__lot_chapel_nave_glass_lancet_assumption": "props/lotglass__lot_chapel_nave_glass_lancet_assumption.glb",
    "lotglass__lot_chapel_nave_glass_rose": "props/lotglass__lot_chapel_nave_glass_rose.glb",
    "lotglass__lot_church_nave_glass_church_clear": "props/lotglass__lot_church_nave_glass_church_clear.glb",
    "lotprop__lot_chapel_nave_station": "props/lotprop__lot_chapel_nave_station.glb",
    "lotprop__lot_church_nave_cross": "props/lotprop__lot_church_nave_cross.glb",
}


def sacred_info():
    with open(os.path.join(SACRED_DIR, "sacred.json"), encoding="utf-8") as f:
        return {i["file"][:-4]: i for i in json.load(f)["items"]}


def glb_tris(path):
    import struct
    data = open(path, "rb").read()
    n = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + n])
    t = 0
    for nd in js["nodes"]:
        if "mesh" not in nd:
            continue
        for p in js["meshes"][nd["mesh"]]["primitives"]:
            a = js["accessors"][p["indices"]] if "indices" in p else js["accessors"][p["attributes"]["POSITION"]]
            t += a["count"] // 3
    return t, {nd.get("name"): nd for nd in js["nodes"]}, js


def node_tris(path, name):
    t, nodes, js = glb_tris(path)
    nd = nodes[name]
    return sum((js["accessors"][p["indices"]]["count"] if "indices" in p else js["accessors"][p["attributes"]["POSITION"]]["count"]) // 3
               for p in js["meshes"][nd["mesh"]]["primitives"])


def station_tris(numeral):
    t, nodes, js = glb_tris(os.path.join(SACRED_DIR, "lotprop__lot_chapel_nave_station.glb"))

    def mt(name):
        nd = nodes[name]
        return sum((js["accessors"][p["indices"]]["count"] if "indices" in p else js["accessors"][p["attributes"]["POSITION"]]["count"]) // 3
                   for p in js["meshes"][nd["mesh"]]["primitives"])
    return mt("lotprop__lot_chapel_nave_station") + mt("lotprop__lot_chapel_nave_station_num_%02d" % numeral)


# ------------------------------------------------------------------------------------------------ materials --

def pool_material(name, png):
    """Render twin of M_lightpool: the transmission atlas as emission, added over what is under it."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(png, check_existing=True)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 8.0
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], add.inputs[0])
    nt.links.new(tr.outputs["BSDF"], add.inputs[1])
    nt.links.new(add.outputs["Shader"], out.inputs["Surface"])
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    return m


def write_manifest(kit, unit_id, path):
    plain = {k: v for k, v in kit.mats.items() if not v.get("pool")}
    saved = kit.mats
    kit.mats = plain
    B.write_manifest(kit, {"id": unit_id}, path)
    kit.mats = saved
    with open(path, encoding="utf-8") as f:
        js = json.load(f)
    for name, d in kit.mats.items():
        if d.get("pool"):
            js["materials"][name] = {
                "kind": "lightpool", "maps": {"albedo": d["pool"] + ".ktx2"}, "uv": "atlas (TEXCOORD_0 0..1, no repeat)", "colorSpace": "srgb",
                "note": "HOOK for L5v2 / L6: the sun's coloured light through the stained glass, lying on the floor (the glass's "
                        "transmission maps from tools/sacred/light projected along the room's sun, %s). Draw unlit and additive "
                        "(blending Additive, depthWrite false, polygonOffset -1), colour = map x daylight (about 0.9 at noon, 0 at "
                        "night); L6 may bake it into the floor's lightmap and drop the node." % d.get("sun", "")}
    js["note"] = js["note"] + " B2 rooms: M_lightpool (kind lightpool) is the coloured sunlight under the windows; M_fire the candle flames (B1's hook); the sacred props are separate GLBs placed at the lotstatue__ / lotglass__ / lotprop__ empties (asset.extras.sacred)."
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(js, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ------------------------------------------------------------------------------------------------ checks --

def sacred_check(kit, spec, size, info):
    """Each placed prop's box (from its GLB's accessor bounds, turned by its yaw) between 0.3 and 2.2 m stands on its solid,
    or within 6 cm of / behind a wall; and keeps out of every seat's front strip and the door's pads."""
    problems = []
    tol = 0.011
    solids = [(s["name"], (s["rect"]["x0"], s["rect"]["x1"], s["rect"]["z0"], s["rect"]["z1"])) for s in spec["solids"]]
    for pl in kit.sacred:
        lo, hi = pl["bbox"]
        pts = []
        for x in (lo[0], hi[0]):
            for y in (lo[1], hi[1]):
                for z in (lo[2], hi[2]):
                    pts.append(G.rot_y((x, y, z), pl["yaw"], *pl["at"]))
        for (x, y, z) in pts:
            if not (0.3 < y < 2.2):
                continue
            wall = x < 0.06 or z < 0.06 or x > size["x"] - 0.06 or (z > size["z"] - 0.06)
            if pl.get("in_wall"):
                wall = wall or pl["in_wall"](x, z)
            on = any(r[0] - tol <= x <= r[1] + tol and r[2] - tol <= z <= r[3] + tol for _, r in solids)
            if not (wall or on):
                problems.append("SACRED-LOOSE %s at (%.2f, %.2f, %.2f)" % (pl["node"], x, y, z))
                break
        xs = [p[0] for p in pts]
        zs = [p[2] for p in pts]
        ys = [p[1] for p in pts]
        box = (min(xs), max(xs), min(zs), max(zs))
        for s in spec["seats"]:
            h, f = s["length"] / 2, s["frontEdge"]
            fx = {"in": (s["x"] - h, s["x"] + h, s["z"] + f, s["z"] + f + 0.6), "out": (s["x"] - h, s["x"] + h, s["z"] - f - 0.6, s["z"] - f),
                  "right": (s["x"] + f, s["x"] + f + 0.6, s["z"] - h, s["z"] + h), "left": (s["x"] - f - 0.6, s["x"] - f, s["z"] - h, s["z"] + h)}[s["faces"]]
            if box[0] < fx[1] - tol and box[1] > fx[0] + tol and box[2] < fx[3] - tol and box[3] > fx[2] + tol and min(ys) < 1.8:
                problems.append("SACRED-SEAT-FRONT %s blocks %s" % (pl["node"], s["id"]))
        for (px, pz) in ((spec["doorX"], 0.8), (spec["doorX"], 1.6)):
            if box[0] < px + 0.4 and box[1] > px - 0.4 and box[2] < pz + 0.4 and box[3] > pz - 0.4 and min(ys) < 2.0:
                problems.append("SACRED-DOOR-CLEAR %s" % pl["node"])
    return problems


# ------------------------------------------------------------------------------------------------ renders --

def import_sacred(kit):
    """The renders: each placement's PNG master, PC LOD only, at its empty."""
    made = []
    for pl in kit.sacred:
        src = os.path.join(SACRED_SRC, MASTERS[pl["file"]])
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=src)
        new = [o for o in bpy.data.objects if o not in before]
        root = bpy.data.objects.new("place_" + pl["node"], None)
        bpy.context.scene.collection.objects.link(root)
        x, y, z = pl["at"]
        root.location = B.l2b((x, y, z))
        root.rotation_euler = (0.0, 0.0, pl["yaw"])
        for o in new:
            if o.parent is None:
                o.parent = root
            if o.type == "MESH" and o.name.split(".")[0].endswith("_phone"):
                o.hide_render = True
            nm = o.name.split(".")[0]
            if pl.get("drawOnly") and o.type == "MESH" and nm != pl["drawOnly"]:
                o.hide_render = True
            if "_num_" in nm:
                o.hide_render = not nm.endswith("_num_%02d" % pl.get("numeral", 0))
            if o.type == "MESH" and nm.startswith("lotglass__"):
                o.visible_shadow = bool(getattr(kit, "glass_shadow", True))
                for m in o.data.materials:
                    b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                    if b is not None and "Emission Strength" in b.inputs:
                        b.inputs["Emission Strength"].default_value = pl.get("glow", 2.2)
        made.append(root)
    return made


def room_lights(kit):
    for i, L in enumerate(getattr(kit, "room_lights", [])):
        kind, x, y, z, col, power = L[:6]
        if kind == "spot":
            ld = bpy.data.lights.new("roomlight_%d" % i, "SPOT")
            ld.spot_size = math.radians(L[7] if len(L) > 7 else 35)
            ld.spot_blend = 0.7
            ld.shadow_soft_size = 0.15
        elif kind == "area":
            ld = bpy.data.lights.new("roomlight_%d" % i, "AREA")
            ld.size = L[7] if len(L) > 7 else 1.0
        else:
            ld = bpy.data.lights.new("roomlight_%d" % i, "POINT")
            ld.shadow_soft_size = L[7] if len(L) > 7 else 0.05
            if power < 40:
                ld.use_shadow = False   # candles and lamps: no shadow maps (EEVEE's shadow pool)
        ld.energy = power
        ld.color = col
        lo = B.obj(ld.name, ld)
        lo.location = B.l2b((x, y, z))
        if kind in ("spot", "area") and len(L) > 6 and L[6] is not None:
            d = Vector(B.l2b(L[6])) - lo.location
            lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_room(kit, mats, outdir, viewdef, prefix):
    import_sacred(kit)
    room_lights(kit)
    orig = B.setup_world

    def setup_world(day):
        orig(day)
        sun = bpy.data.objects.get("Sun")
        if sun is not None and day and getattr(kit, "sun_energy", None):
            sun.data.energy = kit.sun_energy
        for o in bpy.data.objects:
            if o.name.startswith("roomlight_"):
                o.data.energy = o.get("e0", o.data.energy) * (1.0 if day else getattr(kit, "night_lamp_scale", 2.2))
            if o.name.startswith("nightfill_"):
                o.hide_render = day
            if o.name.startswith("lotlight__"):
                o.hide_render = not day   # the sun's coloured pools: by day only (the game scales them with daylight)
    for i, (x, y, z, size, w) in enumerate(getattr(kit, "nightfill", [])):
        ld = bpy.data.lights.new("nightfill_%d" % i, "AREA")
        ld.size = size
        ld.energy = w
        ld.color = (1.0, 0.8, 0.58)
        lo = B.obj(ld.name, ld)
        lo.location = B.l2b((x, y, z))
    for o in bpy.data.objects:
        if o.name.startswith("roomlight_"):
            o["e0"] = o.data.energy
    B.setup_world = setup_world
    try:
        B.render_all(kit, mats, outdir, viewdef, prefix)
    finally:
        B.setup_world = orig


# ------------------------------------------------------------------------------------------------ main --

def run_room(unit_id, kit_mod, viewdef, prefix, tex_dir):
    B.LOT, B.YAW = unit_id, 0.0
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    with open(B.LAYOUT, encoding="utf-8") as f:
        L = json.load(f)
    spec = next(i for i in L["interiors"] if i["unit"] == unit_id)
    lot = next(l for l in L["lots"] if l["id"] == spec["lot"])
    unit = next(u for u in lot["units"] if u["id"] == unit_id)
    org, size = unit["interior"]["origin"], unit["interior"]["size"]
    B.CX, B.CZ = org["x"], org["z"]
    info = sacred_info()
    phone = "--phone" in B.argv
    kit = kit_mod.build(spec, unit, L, info, phone=phone)
    B.add_letters(kit)
    plain = {k: v for k, v in kit.mats.items() if not v.get("pool")}
    mats = B.make_materials(plain)
    for name, d in kit.mats.items():
        if d.get("pool"):
            mats[name] = pool_material(name, os.path.join(B.PNG, d["pool"] + ".png"))
    objs = []
    root = B.obj("lotroom__" + unit_id)
    objs.append(root)
    for name, m in (("shell", kit.S), ("furniture", kit.D), ("goods", kit.G)):
        if m.polys:
            objs.append(B.world_obj("lotroom__%s_%s" % (unit_id, name), m, mats, root))
    inst_tris = 0
    for kind, places in sorted(kit.inst.items()):
        grp = B.obj("lotinst__%s_%s" % (unit_id, kind), None, root)
        objs.append(grp)
        me = B.mesh_data("kind_" + kind, kit.kinds[kind], mats, lambda p: (p[0], -p[2], p[1]))
        for i, (x, y, z, yaw) in enumerate(places):
            o = B.obj("lotinst__%s_%s_%d" % (unit_id, kind, i), me, grp)
            o.location = B.l2b((x, y, z))
            o.rotation_euler = (0.0, 0.0, yaw)
            objs.append(o)
        inst_tris += kit.kinds[kind].tris() * len(places)
    for part, g in sorted(kit.night.items()):
        objs.append(B.world_obj("lotnight__%s_%s" % (unit_id, part), g, mats))
    for part, g in sorted(getattr(kit, "fire", {}).items()):
        objs.append(B.world_obj("fire__%s_%s" % (unit_id, part), g, mats, root))
    for part, p in sorted(getattr(kit, "fire_lights", {}).items()):
        objs.append(B.empty("fire__%s_%s" % (unit_id, part), B.l2b(p)))
    pool_tris = 0
    if getattr(kit, "pools", None) is not None and kit.pools.polys:
        objs.append(B.world_obj("lotlight__%s_pools" % unit_id, kit.pools, mats, root))
        pool_tris = kit.pools.tris()
    yaw_of = {"in": 0.0, "out": math.pi, "left": -math.pi / 2, "right": math.pi / 2}
    for s in spec["seats"]:
        objs.append(B.empty("seat__" + s["id"], (B.CX + s["x"], -(B.CZ + s["z"]), s["seatTop"]), yaw_of[s["faces"]]))
    objs.append(B.empty("door__%s_exit" % unit_id, (B.CX + spec["doorX"], -B.CZ, 0.0), math.pi))
    sacred_extras = []
    sacred_tris = {"pc": 0, "phone": 0}
    for pl in kit.sacred:
        objs.append(B.empty(pl["node"], B.l2b(pl["at"]), pl["yaw"]))
        pc = pl["file"] + ".glb"
        ph = pl["file"] + "_phone.glb"
        has_phone = os.path.exists(os.path.join(SACRED_DIR, ph))
        if pl.get("drawOnly"):
            t_pc = t_ph = node_tris(os.path.join(SACRED_DIR, pc), pl["drawOnly"])
        elif pl.get("numeral"):
            t_pc = t_ph = station_tris(pl["numeral"])
        else:
            t_pc = glb_tris(os.path.join(SACRED_DIR, pc))[0]
            t_ph = glb_tris(os.path.join(SACRED_DIR, ph))[0] if has_phone else t_pc
        on_phone = pl.get("phone", True)
        sacred_tris["pc"] += t_pc
        sacred_tris["phone"] += t_ph if on_phone else 0
        e = {"node": pl["node"], "file": "lots/sacred/" + pc, "phoneFile": ("lots/sacred/" + ph) if has_phone else ("lots/sacred/" + pc),
             "phone": on_phone, "triangles": {"pc": t_pc, "phone": t_ph if on_phone else 0}, "what": pl["what"]}
        if pl.get("numeral"):
            e["showOnly"] = "lotprop__lot_chapel_nave_station_num_%02d" % pl["numeral"]
            e["hidePrefix"] = "lotprop__lot_chapel_nave_station_num_"
        if pl.get("drawOnly"):
            e["drawOnly"] = pl["drawOnly"]
            e["note"] = "draw only this node of the file: its saddle bars, cames and stone tracery are merged into this room's own meshes"
        if pl["file"].startswith("lotglass__"):
            e["glass"] = {"emissiveByDaylight": True, "emissiveIntensity": {"day": pl.get("glow", 1.6), "night": 0.15}}
        sacred_extras.append(e)
    cube = bpy.data.meshes.new("col_unit_cube")
    v = [(x, y, z) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)]
    cube.from_pydata(v, [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    for s in spec["solids"]:
        r = s["rect"]
        o = B.obj("col__%s_%s" % (unit_id, s["name"]), cube)
        o.location = (B.CX + (r["x0"] + r["x1"]) / 2, -(B.CZ + (r["z0"] + r["z1"]) / 2), s["height"] / 2)
        o.scale = (r["x1"] - r["x0"], r["z1"] - r["z0"], s["height"])
        o.hide_render = True
        o.display_type = "WIRE"
        objs.append(o)
    allm = set()
    fire_meshes = list(getattr(kit, "fire", {}).values())
    extra = fire_meshes + ([kit.pools] if getattr(kit, "pools", None) is not None else [])
    for m in [kit.S, kit.D, kit.G] + list(kit.kinds.values()) + extra:
        allm |= {p.mat for p in m.polys}
    room_tris = kit.S.tris() + kit.D.tris() + kit.G.tris() + inst_tris + sum(m.tris() for m in fire_meshes) + pool_tris
    phone_skip = getattr(kit, "phone_skip", {})
    report = {"unit": unit_id, "roomTriangles": room_tris, "sacredTriangles": sacred_tris,
              "triangles": room_tris + sacred_tris["pc"],
              "shell": kit.S.tris(), "furniture": kit.D.tris(), "goods": kit.G.tris(), "instanced": inst_tris, "pools": pool_tris,
              "fire": sum(m.tris() for m in fire_meshes),
              "instancedKinds": {k: {"count": len(v), "triangles": kit.kinds[k].tris()} for k, v in sorted(kit.inst.items())},
              "materials": sorted(allm),
              "draws": sum(len({p.mat for p in m.polys}) for m in [kit.S, kit.D, kit.G] + extra) + sum(len({p.mat for p in kit.kinds[k].polys}) for k in kit.inst)
              + sum(1 for pl in kit.sacred if pl.get("phone", True) or not phone),
              "phoneVariant": phone,
              "budget": spec["budget"]}
    skip_tris = sum(phone_skip_tris(kit, k) for k in phone_skip.get("nodes", []))
    report["phoneTriangles"] = room_tris - skip_tris + sacred_tris["phone"]
    report["overlap"] = B.room_check(kit, spec, size)
    report["overlap"]["problems"] += sacred_check(kit, spec, size, info)
    B.log("room", unit_id, "room", room_tris, "+ sacred", sacred_tris, "=", report["triangles"], "/", spec["budget"]["pc"]["triangles"],
          "phone", report["phoneTriangles"], "/", spec["budget"]["phone"]["triangles"], "draws", report["draws"], "materials", len(allm))
    for p in report["overlap"]["problems"][:150]:
        B.log(p)
    B.log("room problems:", len(report["overlap"]["problems"]))
    # L6: the room's light baked into a lightmap atlas (bake_lots.py), by day and by night, before the export
    lightmap = None
    lm_dir = B.arg("--lightmap")
    if lm_dir:
        import bake_lots
        room_lights(kit)
        for i, (x, y, z, fsize, w) in enumerate(getattr(kit, "nightfill", [])):
            ld = bpy.data.lights.new("nightfill_%d" % i, "AREA")
            ld.size = fsize
            ld.energy = w
            ld.color = (1.0, 0.8, 0.58)
            B.obj(ld.name, ld).location = B.l2b((x, y, z))
        for o in bpy.data.objects:
            if o.name.startswith("roomlight_"):
                o["e0"] = o.data.energy
        B.WORLD = getattr(kit, "world_strength", 0.22)
        B.SUN_DIR = getattr(kit, "sun_dir", None)
        B.SUN_ELEV = getattr(kit, "sun_elev", 38)

        def day_night(day):
            B.setup_world(day)
            sun = bpy.data.objects.get("Sun")
            if sun is not None and day and getattr(kit, "sun_energy", None):
                sun.data.energy = kit.sun_energy
            for o in bpy.data.objects:
                if o.name.startswith("roomlight_"):
                    o.data.energy = o.get("e0", o.data.energy) * (1.0 if day else getattr(kit, "night_lamp_scale", 2.2))
                if o.name.startswith("nightfill_"):
                    o.hide_render = day
                if o.name.startswith("lotlight__"):
                    o.hide_render = True   # the coloured sun pools are the game's own additive layer
        fid = unit_id + ("_phone" if phone else "")   # (the phone's file: its own atlas, 512 px)
        lm = bake_lots.bake_room(kit, objs, unit_id, lm_dir, day_night, int(B.arg("--lm-size", "512" if phone else "1024")), int(B.arg("--lm-samples", "96")), fid)
        if lm:
            lightmap = {"day": "lots/%s/%s_lm_day.ktx2" % (tex_dir, fid), "night": "lots/%s/%s_lm_night.ktx2" % (tex_dir, fid),
                        "scale": lm["scale"], "channel": 1, "size": lm["size"],
                        "note": "irradiance = (texel in linear) * scale on TEXCOORD_1 of the lotroom__ shell (bake_lots.py)"}
            for t in ("day", "night"):
                for o in bpy.data.objects:
                    if o.name.startswith(("roomlight_", "nightfill_")):
                        o.hide_render = True
    out = B.arg("--out", os.path.join(B.LOTS, unit_id + ("_phone" if phone else "") + ".glb"))
    if "--no-export" not in B.argv:
        manifest = os.path.join(B.LOTS, tex_dir, "%s_textures.json" % unit_id)
        write_manifest(kit, unit_id, manifest)
        B.export(out, objs, {"caysonverse": "%s (lots v2 B2 room kit%s)" % (unit_id, ", phone LOD" if phone else ""), "lod": "phone" if phone else "pc", "textures": "lots/%s/%s_textures.json" % (tex_dir, unit_id),
                             "origin": org, "size": size, "sacred": sacred_extras, "phone": phone_skip,
                             "triangles": {"room": room_tris, "sacredPc": sacred_tris["pc"], "sacredPhone": sacred_tris["phone"],
                                           "phone": report["phoneTriangles"]}, **({"lightmap": lightmap} if lightmap else {})})
        report["glb"] = B.glb_stats(out)
        B.log("wrote", out, report["glb"])
    if B.REPORT:
        with open(B.REPORT, "w", encoding="utf-8", newline="\n") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
            f.write("\n")
    if B.BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=B.BLEND)
    if B.RENDERS:
        os.makedirs(B.RENDERS, exist_ok=True)
        render_room(kit, mats, B.RENDERS, viewdef, prefix)
    B.log("done")


def phone_skip_tris(kit, node):
    if node == "goods":
        return kit.G.tris()
    if node.startswith("inst:"):
        k = node[5:]
        return kit.kinds[k].tris() * len(kit.inst[k])
    return 0
