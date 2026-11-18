"""Adds framed-art anchors (sacred entries) to the baked room GLBs without touching their meshes or lightmaps.

  python -I docs/designs/village-lots-v2/tools/patch_room_art.py <room.glb> <spec.json>

spec.json: {"items": [{"node": "...", "file": "lots/sacred/x.glb", "phoneFile": "lots/sacred/x_phone.glb", "phone": true,
            "at": [x, y, z] (room frame; the room origin is added), "yaw": radians, "what": "..."}]}
Running it twice replaces the entries of the same node name (idempotent). The room GLB's JSON chunk is rewritten (4-byte
aligned) and the binary chunk is copied as is.
"""
import json, math, struct, sys

path, spec_path = sys.argv[1], sys.argv[2]
spec = json.load(open(spec_path, encoding="utf-8"))
b = open(path, "rb").read()
jl = struct.unpack("<I", b[12:16])[0]
j = json.loads(b[20:20 + jl].decode("utf-8"))
rest = b[20 + jl:]
ox, oz = j["asset"]["extras"]["origin"]["x"], j["asset"]["extras"]["origin"]["z"]
names = {n["name"] for n in j["nodes"]}
sacred = [e for e in j["asset"]["extras"]["sacred"] if e["node"] not in {i["node"] for i in spec["items"]}]
scene = j["scenes"][0]["nodes"]
for it in spec["items"]:
    x, y, z = it["at"]
    q = [0, math.sin(it["yaw"] / 2), 0, math.cos(it["yaw"] / 2)]
    node = {"name": it["node"], "translation": [round(x + ox, 5), round(y, 5), round(z + oz, 5)], "rotation": [round(v, 7) for v in q]}
    if it["node"] in names:
        idx = next(i for i, n in enumerate(j["nodes"]) if n["name"] == it["node"])
        j["nodes"][idx] = node
    else:
        j["nodes"].append(node)
        scene.append(len(j["nodes"]) - 1)
    e = {"node": it["node"], "file": it["file"], "phone": it.get("phone", True), "what": it["what"]}
    if it.get("phoneFile"): e["phoneFile"] = it["phoneFile"]
    sacred.append(e)
# the stained glass is lit by day by its own glow (emissive): a spec "glassDay": {"node substring": day intensity} sets it (the
# washed-out glass was 2.0 over a 1.0 white point: the colours clipped to cream)
for e in sacred:
    for key, v in spec.get("glassDay", {}).items():
        if e.get("glass") and key in e["node"]:
            e["glass"]["emissiveIntensity"]["day"] = v
j["asset"]["extras"]["sacred"] = sacred
js = json.dumps(j, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
js += b" " * (-len(js) % 4)
out = b[:12] + struct.pack("<I", len(js)) + b"JSON" + js + rest
out = out[:8] + struct.pack("<I", len(out)) + out[12:]
open(path, "wb").write(out)
print(path, "sacred entries:", len(sacred), "nodes:", len(j["nodes"]))
