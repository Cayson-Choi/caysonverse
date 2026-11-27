"""The exterior shell's windows (shared/src/village/generated/exterior_windows.json, the Colmar shells of village_houses.glb) as the
interior scripts need them (window alignment, owner 2026-11-27 "네, 다시 구워"): every window of the shell must look into a window
opening of the room at the same place and size.

Interior local frame: x 0..10.6 (front / back walls: `at` is x), z 0..7.8 (side walls: `at` is z); floor-2 sills are given above the
ground floor, so the room's own sill is sill - 4.0 there. Wall frame s (kit_shell): front s = x, right s = z, back s = 10.6 - x,
left s = 7.8 - z."""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_HERE, "..", "..", "..", ".."))
_FILE = os.path.join(_REPO, "shared", "src", "village", "generated", "exterior_windows.json")
STOREY = 4.0
W, D = 10.6, 7.8


def _table():
    return json.load(open(_FILE, encoding="utf-8"))["houses"]


def openings(house, floor, kinds=("window", "patio")):
    """[(wall, at, width, y0, y1, kind)] of this floor (y in the floor's own frame)"""
    out = []
    for o in _table()[f"house_{house}"]:
        if o["floor"] != floor or o["kind"] not in kinds:
            continue
        y0 = o["sill"] - (floor - 1) * STOREY
        out.append((o["wall"], float(o["at"]), float(o["width"]), round(y0, 3), round(y0 + o["height"], 3), o["kind"]))
    return out


def wall_s(wall, at):
    return {"front": at, "right": at, "back": W - at, "left": D - at}[wall]
