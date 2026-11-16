"""Numeric check of the exported GLB against art/lake/layout.json (lakeLayout): col__lake_* boxes, seat__lake_* markers,
spot__* markers, rotation/parent rules, and chair/stand placement against the seats.  python check_lake_structures.py <glb> <layout.json>"""
import json, math, struct, sys

def read_gltf(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    return json.loads(b[20:20 + n])

def main(glb, lay):
    g = read_gltf(glb)
    L = json.load(open(lay, encoding="utf-8"))
    nodes = {n["name"]: n for n in g["nodes"] if "name" in n}
    child = {c for n in g["nodes"] for c in n.get("children", [])}
    bad = []
    def chk(c, msg):
        if not c: bad.append(msg)
    for c in L["colliders"]:
        n = nodes.get(c["node"])
        if not n: bad.append("missing " + c["node"]); continue
        chk("rotation" not in n or all(abs(v) < 1e-6 for v in n["rotation"][:3]), c["node"] + " rotated")
        t, s = n["translation"], n["scale"]
        box = (t[0] - s[0] / 2, t[0] + s[0] / 2, t[2] - s[2] / 2, t[2] + s[2] / 2)  # gltf z = game z
        want = (c["minX"], c["maxX"], c["minZ"], c["maxZ"])
        d = max(abs(a - b) for a, b in zip(box, want))
        chk(d < 0.005, f'{c["node"]} off by {d:.4f}')
    nsum = 0
    for s in L["seats"]:
        n = nodes.get(s["node"])
        if not n: bad.append("missing " + s["node"]); continue
        t = n["translation"]; ex = n.get("extras", {})
        chk(abs(t[0] - s["x"]) < 1e-3 and abs(t[2] - s["z"]) < 1e-3 and abs(t[1] - s["seatY"]) < 1e-3, f'{s["node"]} position')
        chk(abs(ex.get("standX", 0) - s["standX"]) < 1e-3 and abs(ex.get("standZ", 0) - s["standZ"]) < 1e-3, f'{s["node"]} stand')
        chk(ex.get("approach") == s["approach"] and ex.get("backed") == s["backed"], f'{s["node"]} approach')
        chk(abs(ex.get("yaw", 9) - s["yaw"]) < 1e-3, f'{s["node"]} yaw')
        chk(s["node"] not in child, f'{s["node"]} has parent')
        nsum += 1
    for sp in L["spots"]:
        n = nodes.get(sp["node"])
        if not n: bad.append("missing " + sp["node"]); continue
        t = n["translation"]
        chk(abs(t[0] - sp["anchor"]["x"]) < 1e-3 and abs(t[2] - sp["anchor"]["z"]) < 1e-3, sp["node"] + " position")
        ex = n.get("extras", {})
        chk(abs(ex.get("floatX", 0) - sp["float"]["x"]) < 1e-3 and abs(ex.get("floatZ", 0) - sp["float"]["z"]) < 1e-3, sp["node"] + " float")
    # chairs: the chair's seat root (centre + frontEdge 0.21 + SIT_ROOT_AHEAD) must equal the seat marker, i.e. chair centre = anchor - 0.55 f
    sx = {s["spot"]: s for s in L["seats"] if s.get("spot")}
    for sp in L["spots"]:
        n = nodes.get("chair_" + sp["id"])
        if not n: bad.append("missing chair_" + sp["id"]); continue
        t = n["translation"]
        f = (math.sin(sp["yaw"]), math.cos(sp["yaw"]))
        want = (sp["anchor"]["x"] - round(f[0], 4) * 0.55, sp["anchor"]["z"] - round(f[1], 4) * 0.55)
        chk(abs(t[0] - want[0]) < 0.01 and abs(t[2] - want[1]) < 0.01, "chair_" + sp["id"] + " placement")
        stand = sx[sp["id"]]
        # the seat root lies 0.21 + rootAhead in front of the chair centre along the facing: just require it in front, < 1 m
        dd = (stand["x"] - t[0]) * f[0] + (stand["z"] - t[2]) * f[1]
        chk(0.2 < dd < 0.8, "chair_" + sp["id"] + f" seat root {dd:.2f} m ahead")
    print(f'colliders {len(L["colliders"])}, seats {nsum}, spots {len(L["spots"])}, chairs 30 checked')
    print("FAIL" if bad else "PASS")
    for b in bad: print(" -", b)
    return 1 if bad else 0

sys.exit(main(*sys.argv[1:3]))
