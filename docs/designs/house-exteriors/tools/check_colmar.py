"""The Colmar dress's own clipping check (2026-11-17), plain Python: builds the ten houses (house_kit STYLE "colmar" +
porch_kit) and proves that the body's fittings do not cut into each other (shutters, window boxes, sills, the door's jambs
and lintel, the arch, signs, hanging baskets, down pipes): no two of different kinds overlap by more than 2 mm on every
axis, a sill and its own window box or shutters may touch (they are fixed together). check_porch.py covers the porches
against these fittings and the door's swing.

  python docs/designs/house-exteriors/tools/check_colmar.py [--out <report.json>]
Exit 1 on any clip.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import house_kit as K  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
CLIP = 0.002
# pairs that are fixed to each other by design (a box hangs under its sill, shutters fold beside their sill's ends)
TOUCH = {frozenset(("sill", "flowerbox")), frozenset(("sill", "shutter")), frozenset(("door_jamb", "door_lintel")),
         frozenset(("door_lintel", "door_arch"))}


def overlap(a, b):
    return all(min(a[2 * i + 1], b[2 * i + 1]) - max(a[2 * i], b[2 * i]) > CLIP for i in range(3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    a = ap.parse_args()
    K.load_tex(os.path.join(REPO, "client", "public", "models", "village", "houses", "house_textures.json"))
    win = json.load(open(os.path.join(REPO, "shared", "src", "village", "generated", "exterior_windows.json")))["houses"]
    fails = []
    report = {}
    for n in range(1, 11):
        hid = "house_%d" % n
        H = K.build_house(hid, "white", win[hid], 1000 + n)
        S = H.solids
        bad = []
        for i in range(len(S)):
            for j in range(i + 1, len(S)):
                if S[i]["name"] == S[j]["name"] or frozenset((S[i]["name"], S[j]["name"])) in TOUCH:
                    continue
                if overlap(S[i]["box"], S[j]["box"]):
                    bad.append("%s %s x %s %s" % (S[i]["name"], [round(v, 3) for v in S[i]["box"]], S[j]["name"],
                                                  [round(v, 3) for v in S[j]["box"]]))
        report[hid] = {"solids": len(S), "clips": bad}
        print(hid, "solids", len(S), "PASS" if not bad else "FAIL %d" % len(bad))
        for b in bad:
            print("   ", b)
        fails += bad
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="\n") as f:
            json.dump(report, f, indent=1)
    print("clips", len(fails), "PASS" if not fails else "FAIL")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
