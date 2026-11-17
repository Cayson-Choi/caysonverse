"""케이슨랜드 정문 (lot_gate) — the L4 gate (feat/lot-mart-gate 75ab7df) rebuilt for lots v2 (B3 polish): gate_kit.py on
gate_base.py (KTX2 PBR library sets, metre UVs, no grime, no ticket-price boards), through B1's Blender side (b1_blender.run:
nodes, colliders, seats, slots, export, KTX2 manifest, renders). Blender 5.3, background:

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_gate.py -- --layout <lots.json> --png <decoded PBR
      pngs + lot_gate_goods.png> [--out client/public/models/village/lots/lot_gate.glb] [--report <json>] [--renders <dir>] ...

Positions, colliders, seats and slot names are the contract's (unchanged since 75ab7df). The gate is closed until B11 opens
the park (door phase 4): its two leaves are hinged at the towers' faces for the game's door hook, and the overlap check leaves
their swing and the park side beyond the gate line (local z < -6, outside the walk bounds) to B11.
"""
import json
import math
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import b1_blender as B  # noqa: E402
import b1_parts as P  # noqa: E402
import gate_base as GB  # noqa: E402
import gate_kit  # noqa: E402
from b1_geom import Mesh, S  # noqa: E402

VIEWDEF = {
    # name: (camera local (x, y, z), target local, lens mm) — z out (north, toward the bridge), y up
    "street": ((3.0, 1.7, 17.0), (0.0, 6.5, -4.5), 20),
    "far": ((-8.0, 1.7, 28.0), (0.0, 6.5, -4.5), 26),
    "plaza": ((-8.0, 1.6, 5.5), (0.0, 4.5, -4.0), 20),
    "fountain": ((3.2, 1.6, 5.2), (0.0, 1.0, 0.8), 24),
    "leaves": ((0.8, 1.6, -2.0), (0.0, 1.6, -6.5), 22),
    "wing": ((4.2, 1.6, 0.4), (7.0, 2.4, -3.4), 22),
    "booth": ((6.9, 1.6, -1.6), (6.9, 2.4, -3.8), 28),
    "marquee": ((0.0, 3.0, 8.0), (0.0, 10.4, -4.0), 30),
    "corner": ((12.5, 1.7, 4.0), (8.0, 4.5, -4.0), 22),
}

MATS = {
    "LM_martgate_steel": {"set": "plaster_painted", "rough": 0.45, "normal": 0.4},  # fresh glossy paint on steel (steel_painted is a dark set)
    "LM_martgate_metal": {"set": "aluminium_brushed", "metal": True, "rough": 0.6},
    "LM_martgate_oak": {"set": "wood_oak", "rough": 0.85},
    "LM_martgate_render": {"set": "stucco_white", "rough": 0.95},
    "LM_martgate_granite": {"set": "granite_flamed"},
    "LM_martgate_stone": {"set": "stone_ashlar"},
    "M_glass": {"glass": True},
    "M_lamp": {"lamp": True},
    "M_sign_emit": {"emit": True},
    "M_martgate_goods": {"own": "lot_gate_goods", "note": "word-free goods atlas (flag, flower-bed foliage, soil, the park's picture map): gate_goods.py"},
}
PREVIEW = {"PV_grass": {"set": "grass"}, "PV_pave": {"set": "plaza_granite"}}


def letter_size(text, size, maxw):
    """Blender text: a Hangul glyph is ~1 em wide and 0.72 em tall: fit the line in `maxw` metres."""
    if not maxw:
        return size
    em = sum(0.32 if ch == " " else 1.0 for ch in text)
    return min(size, maxw / em * 0.72)


def build(lot, layout):
    cx, cz = lot["centre"]["x"], lot["centre"]["z"]
    seats = [{"id": s["id"], "lx": round(cx - s["x"], 4), "lz": round(cz - s["z"], 4), "length": s["length"], "seatTop": s["seatTop"], "faces": "out"} for s in lot["seats"]]
    k = gate_kit.build({"seats_local": seats})
    kit = P.Kit(lot)
    kit.S, kit.D, kit.G = k.S, k.D, k.Gd
    if getattr(k, "backdrop_mesh", None) is not None:
        kit.D.extend(k.backdrop_mesh)
    kit.kinds = {kind: k.kinds[kind] for kind in k.inst}
    kit.inst = {kind: [tuple(p[:4]) for p in places] for kind, places in k.inst.items()}
    kit.night = k.night
    kit.mats = dict(MATS)
    kit.mats.update(PREVIEW)
    # letters: L4's (text, where, x, y, z, yaw, size, depth, col, glow, gcol) -> B1's Blender text (malgun gothic bold)
    for (text, where, x, y, z, yaw, size, depth, col, glow, gcol) in k.letters:
        out = (math.sin(yaw), 0.0, math.cos(yaw))
        sz = letter_size(text, size, getattr(gate_kit.GateKit, "MAXW", {}).get(text))
        target = {"shell": "S", "goods": "G"}.get(where, "D")
        kit.letters.append((text, (x, y, z), out, sz, depth, S("LM_martgate_render", col), target))
        if glow:
            gm = k.night.setdefault(glow, GB.Mesh(glow))
            setattr(kit, "glow_" + glow, gm)
            kit.letters.append((text, (x + out[0] * 0.004, y, z + out[2] * 0.004), out, sz, depth * 0.3, S("M_sign_emit", gcol), "glow_" + glow))
    # the closed gate's leaves, split at the middle and hinged at the towers' faces (x -+3, z -5.8): door__lot_gate_main_l / _r
    d = k.doors.get("lot_gate_main")
    if d is not None:
        L, R = Mesh("leaf_l"), Mesh("leaf_r")
        for p in d.polys:
            cxp = sum(q[0] for q in p.pts) / len(p.pts)
            (L if cxp < -0.15 else R).polys.append(p)
        leaves = []
        for name, m, hx, sgn in (("l", L, -3.0, 1), ("r", R, 3.0, -1)):
            hinge = (hx, 0.0, -5.8)
            loc = m.transformed(lambda q, h=hinge: (q[0] - h[0], q[1], q[2] - h[2]))
            leaves.append((name, loc, hinge, sgn))
        kit.doors["lot_gate_main"] = leaves
    kit.sweeps = []
    for Lt in k.lights:
        kit.lights.append(("point", Lt[1], Lt[2], Lt[3], Lt[4], Lt[5] * 0.6))
    g = kit.ground
    g.poly([(-40, -0.02, -40), (-40, -0.02, 40), (40, -0.02, 40), (40, -0.02, -40)][::-1], S("PV_grass"))
    g.poly([(-10, 0.0, -6), (-10, 0.0, 6), (10, 0.0, 6), (10, 0.0, -6)][::-1], S("PV_pave"))
    kit.look = "AgX - Base Contrast"
    return kit


# ------------------------------------------------------------------------------------------------ B1 side hooks --

_make = B.make_materials


def make_materials(matdefs):
    base = {k: v for k, v in matdefs.items() if not (v.get("lamp") or v.get("emit"))}
    mats = _make(base)
    l = bpy.data.materials.new("M_lamp")
    l.use_nodes = True
    b = next(n for n in l.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.95, 0.93, 0.88, 1)
    b.inputs["Roughness"].default_value = 0.15
    b.inputs["Emission Color"].default_value = (1.0, 0.95, 0.88, 1)
    b.inputs["Emission Strength"].default_value = 0.3
    mats["M_lamp"] = l
    e = bpy.data.materials.new("M_sign_emit")
    e.use_nodes = True
    nt = e.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(ca.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 4.0
    mats["M_sign_emit"] = e
    return mats


B.make_materials = make_materials

_write_manifest = B.write_manifest


def write_manifest(kit, lot, path):
    lamp = {k: v for k, v in kit.mats.items() if v.get("lamp") or v.get("emit")}
    for k in lamp:
        kit.mats.pop(k)
    _write_manifest(kit, lot, path)
    kit.mats.update(lamp)
    js = json.load(open(path, encoding="utf-8"))
    js["materials"]["M_lamp"] = {"kind": "lamp", "note": "bulb / lantern glass: pale, a faint warm emission by day; lotnight__ nodes carry the night glow"}
    js["materials"]["M_sign_emit"] = {"kind": "emit", "note": "glowing faces (marquee letters, uplights): unlit, COLOR_0 is the colour"}
    js["note"] = js["note"] + " Lots v2 B3: the 75ab7df gate on the library's KTX2 sets; M_martgate_goods is the gate's own word-free atlas."
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(js, f, indent=2, ensure_ascii=False)
        f.write("\n")


B.write_manifest = write_manifest

_patch = B.patch_glb


def patch_glb(path, extras):
    _patch(path, extras)
    data = open(path, "rb").read()
    clen, _ = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen].decode("utf-8"))
    rest = data[20 + clen:]
    for m in js.get("materials", []):
        pbr = m.setdefault("pbrMetallicRoughness", {})
        if m["name"] == "M_lamp":
            pbr.update({"baseColorFactor": [0.95, 0.93, 0.88, 1], "metallicFactor": 0.0, "roughnessFactor": 0.15})
            m["emissiveFactor"] = [0.3, 0.28, 0.26]
        if m["name"] == "M_sign_emit":
            pbr.update({"baseColorFactor": [0, 0, 0, 1], "metallicFactor": 0.0, "roughnessFactor": 1.0})
            m["emissiveFactor"] = [1.0, 1.0, 1.0]
    js["asset"]["extras"]["caysonverse"] = "lot_gate (lots v2 B3 polish of L4 75ab7df)"
    blob = json.dumps(js, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    blob += b" " * ((4 - len(blob) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(blob) + len(rest)) + struct.pack("<II", len(blob), 0x4E4F534A) + blob + rest
    open(path, "wb").write(out)


B.patch_glb = patch_glb

def seat_boxes(lot):
    """L5 lotSeatFurnitureBoxes: length x 2 front edges round each backless bench (world AABBs)."""
    out = []
    for s in lot["seats"]:
        half, d = s["length"] / 2, s["frontEdge"]
        ca, sa = abs(math.cos(s["yaw"])), abs(math.sin(s["yaw"]))
        hx, hz = half * ca + d * sa, half * sa + d * ca
        out.append({"id": s["id"], "box": {"minX": s["x"] - hx, "maxX": s["x"] + hx, "minZ": s["z"] - hz, "maxZ": s["z"] + hz}, "camera": False, "cameraHeight": 0})
    return out


_overlap = B.overlap_check
AT = re.compile(r"at \(([-0-9.]+), ([-0-9.]+), ([-0-9.]+)\)")


def overlap_check(kit, lot):
    lot2 = dict(lot)
    lot2["colliders"] = list(lot["colliders"]) + seat_boxes(lot)
    rep = _overlap(kit, lot2)
    keep, park = [], 0
    for p in rep["problems"]:
        m = AT.search(p)
        if p.startswith("LEAF-OUT-OF-BODY"):
            park += 1
            continue
        if m and float(m.group(3)) < -5.99 and (p.startswith("FOOTPRINT") or p.startswith("OUTSIDE-COLLIDER")):
            park += 1
            continue
        keep.append(p)
    rep["problems"] = keep
    rep["leftToB11"] = park
    return rep


B.overlap_check = overlap_check

if __name__ == "__main__":
    B.run("lot_gate", sys.modules[__name__], VIEWDEF, "gate", "martgate")
