"""Fit the fountain crescent's light probe (client/src/village/villageModelPrep.ts MOON_PROBE) to a bake (system Python:
numpy, PIL; node for the GLB).

  python art/village/tools/fit_moon_probe.py <village.glb with a light-mapped crescent> <village_lm.webp> \
        <village_lm_night.webp> [--repo <caysonverse checkout with scripts/patch-village-moon.mjs>]

The game draws the crescent (node fountain_moon, unlit M_moon) with the bake's own light on it as a smooth function of
its normal instead of light-map texels (on the shared 2048 map it got 3.5 texels per metre, in 11 UV islands: stepped
bands along its edges). This reads that light where it was baked: every texel centre inside the old crescent's UV1
triangles (a GLB from before scripts/patch-village-moon.mjs, e.g. `git show 2c416d8:client/public/models/village/village.glb`;
since fix/fix-moon-smooth the bake leaves the crescent out of the light map), then fits
  day   = SH9(n)                          (the day map, linear, as stored: L / 2)
  night = SH9(n) + gain * colour * U(p, n) (U: the fountain's eight lights, cos / d^2, the upper bowl's shadow;
                                            gain 50 / 8 pi^2, the bake's 50 W in the map's units)
by robust least squares (Huber) with a ridge on the l = 2 band, SH9 basis 1, y, z, x, xy, yz, 3z^2 - 1, xz, x^2 - y^2 in
game axes. Prints the arrays for MOON_PROBE. Re-fit when bake_village.py's sun, sky or NIGHT change. (2c416d8: 584
texels, rms 0.065 by day, mostly the seams, 0.014 at night.)
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
UPLIGHT = dict(count=8, radius=1.9, height=1.0, phase=0.2, bowl_r=1.62, bowl_y=1.6, soft=0.12, colour=(0.70, 0.86, 1.0))
GAIN = 50 / (8 * np.pi ** 2)

DUMP_JS = r"""
const [repo, file] = process.argv.slice(1);
const { readFileSync } = await import("node:fs");
const { pathToFileURL } = await import("node:url");
const M = await import(pathToFileURL(repo + "/scripts/patch-village-moon.mjs").href);
await M.draco();
const { json, bin } = M.readGlb(readFileSync(file));
const a = M.MOON_ATLAS;
const inMoon = (u, v) => u >= a.x / a.size - 1e-3 && u <= (a.x + a.w) / a.size + 1e-3 && v >= a.y / a.size - 1e-3 && v <= (a.y + a.h) / a.size + 1e-3;
const tris = [];
for (const mesh of json.meshes) for (const prim of mesh.primitives) {
  if (json.materials[prim.material]?.name !== "LM_atlas") continue;
  const d = M.decodeDraco(json, bin, prim);
  const P = d.attrs.POSITION.values, T = d.attrs.TEXCOORD_0.values, L = d.attrs.TEXCOORD_1.values;
  for (let f = 0; f < d.nf; f++) {
    const c = [0, 1, 2].map((k) => d.faces[f * 3 + k]);
    if (!c.every((i) => P[i * 3 + 1] > M.MOON.baseY - 0.01 && Math.hypot(P[i * 3] - M.MOON.centre[0], P[i * 3 + 2] - M.MOON.centre[1]) < M.MOON.height * 0.58 && inMoon(T[i * 2], T[i * 2 + 1]))) continue;
    tris.push({ p: c.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]), uv1: c.map((i) => [L[i * 2], L[i * 2 + 1]]) });
  }
}
process.stdout.write(JSON.stringify(tris));
"""


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def sh9(n):
    x, y, z = n[:, 0], n[:, 1], n[:, 2]
    return np.stack([np.ones_like(x), y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y], axis=1)


def uplight(p, n):
    u = UPLIGHT
    tot = np.zeros(len(p))
    for k in range(u["count"]):
        a = 2 * np.pi * k / u["count"] + u["phase"]
        lp = np.array([u["radius"] * np.cos(a), u["height"], u["radius"] * np.sin(a)])
        tl = lp - p
        d2 = (tl ** 2).sum(1)
        t = (u["bowl_y"] - lp[1]) / np.maximum(p[:, 1] - lp[1], 1e-3)
        r = np.linalg.norm(lp[[0, 2]] + (p[:, [0, 2]] - lp[[0, 2]]) * t[:, None], axis=1)
        x = np.clip((r - (u["bowl_r"] - u["soft"])) / (2 * u["soft"]), 0, 1)
        tot += np.maximum((n * tl).sum(1) / np.sqrt(d2), 0) / d2 * x * x * (3 - 2 * x)
    return tot


def fit(F, Y, c, lam=5.0, it=10):
    R = np.diag([0, 0, 0, 0] + [lam] * 5)
    w = np.ones(len(F))
    for _ in range(it):
        Fw = F * w[:, None]
        co = np.linalg.solve(F.T @ Fw + R, Fw.T @ Y)
        r = np.abs(Y - F @ co).max(1)
        w = np.where(r < c, 1.0, c / r)
    return co


def main(argv):
    glb, day_p, night_p = argv[:3]
    repo = argv[argv.index("--repo") + 1] if "--repo" in argv else os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
    out = subprocess.run(["node", "--input-type=module", "-e", DUMP_JS, repo, glb], capture_output=True, check=True, text=True)
    tris = json.loads(out.stdout)
    if not tris:
        sys.exit("no light-mapped crescent in that GLB (patched already? use one from before fix/fix-moon-smooth)")
    maps = [srgb_to_lin(np.asarray(Image.open(f).convert("RGB"), dtype=np.float64)) for f in (day_p, night_p)]
    H, W = maps[0].shape[:2]
    rows = []
    for t in tris:
        P = np.array(t["p"])
        U = np.array(t["uv1"]) * [W, H]                      # flipY false: v runs down the rows
        n = np.cross(P[1] - P[0], P[2] - P[0])
        if np.linalg.norm(n) < 1e-12:
            continue
        n /= np.linalg.norm(n)
        det = (U[1, 0] - U[0, 0]) * (U[2, 1] - U[0, 1]) - (U[2, 0] - U[0, 0]) * (U[1, 1] - U[0, 1])
        if abs(det) < 1e-12:
            continue
        (x0, y0), (x1, y1) = np.floor(U.min(0)).astype(int), np.ceil(U.max(0)).astype(int)
        for py in range(max(y0, 0), min(y1, H - 1) + 1):
            for px in range(max(x0, 0), min(x1, W - 1) + 1):
                cx, cy = px + 0.5, py + 0.5
                l1 = ((U[1, 0] - cx) * (U[2, 1] - cy) - (U[2, 0] - cx) * (U[1, 1] - cy)) / det
                l2 = ((U[2, 0] - cx) * (U[0, 1] - cy) - (U[0, 0] - cx) * (U[2, 1] - cy)) / det
                if min(l1, l2, 1 - l1 - l2) < 0:
                    continue
                p = l1 * P[0] + l2 * P[1] + (1 - l1 - l2) * P[2]
                rows.append([*p, *n, *maps[0][py, px], *maps[1][py, px]])
    A = np.array(rows)
    pos, nrm, day, night = A[:, 0:3], A[:, 3:6], A[:, 6:9], A[:, 9:12]
    F = sh9(nrm)
    cd = fit(F, day, 0.05)
    rest = night - GAIN * uplight(pos, nrm)[:, None] * np.array(UPLIGHT["colour"])
    cn = fit(F, rest, 0.02)
    print(f"{len(tris)} triangles, {len(A)} texels")
    for name, co, Y in (("day", cd, day), ("night", cn, rest)):
        print(f"{name}: rms {np.sqrt(((Y - F @ co) ** 2).mean(0)).round(4).tolist()}")
        print(f"  {name}: {json.dumps(co.round(4).tolist())},")
    print(f"  uplight gain: {GAIN:.4f}")


if __name__ == "__main__":
    main(sys.argv[1:])
