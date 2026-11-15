"""Build the memorial hall INTERIOR authoring scene (케이슨 마을; Blender 5.2, background). 2026-11-13 rebuild: the B-plan hall
15 x 12 m, ceiling 4.5 m, built from scratch to the owner-approved design (design.md): three cubby banks (A, B, E: 368
cubbies with stable ids), the arched niche 기억의 자리, the east oak bank with glass doors, the guide's desk and the
name-search kiosk, the flower stand, the family lounge, the tea corner, the letter table and the sky mailbox, centre and
east benches, the garden window, the sliding glass door, the cove soffit and skylight.

  blender -b --factory-startup -P art/village/tools/build_memorial.py -- [--preview out_dir] [--samples N] [--res WxH] [--engine eevee|cycles]

Environment: CV_LAYOUT = layout.json exported by scripts/export-village-layout.ts (default art/village/layout.json).
Writes art/village/work/memorial_authoring.blend, which bake_memorial.py bakes and exports.

Game coordinates everywhere (x east, z south, y up; vlib.V converts to Blender). Objects:
  cat "lm"        light-mapped meshes (LM_* materials)
  cat "nonlm"     M_lamp, M_skylight, M_glass, M_garden (unlit)
  cat "door"      door__leaf_l / door__leaf_r: sliding glass leaves, their own nodes (M_alu, M_glass; not light-mapped)
  cat "inst"      LED strips under every cubby's top board (GPU instances)
  cat "collider"  col__* boxes (unit cube + location/scale)
  cat "anchor"    anchor__cubby_<id> empties at every cubby's opening centre, local +z out of it
  cat "seat"      seat__<id> empties: x, z, seat height, facing; custom props kind (backless|backed), furn, edge, back, width,
                  group, both, exit_turn, lean (the post step turns them into shared/src/village/generated/memorialSeats.ts)
  cat "helper"    ceil__hall: the ceiling slab for the indoor camera
Lights (bake only): downlights, skylight, cove, LED rows, the niche spot, the brand wash, the lamp, the west sun.
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402
from vlib import MB, V  # noqa: E402

L = U.LAYOUT
INN = L["memorial"]["interior"]
ROOM = INN["room"]
NICHE = INN["niche"]
H = INN["ceilingHeight"]
WORK = os.path.join(U.ROOT, "work")
TEXM = os.path.join(WORK, "tex_m")
DLT = os.path.join(U.DL, "tex")
ATL = json.load(open(os.path.join(TEXM, "atlas_m.json")))
SIGNS = json.load(open(os.path.join(TEXM, "signs_m.json")))
X0, X1, Z0, Z1 = ROOM["minX"], ROOM["maxX"], ROOM["minZ"], ROOM["maxZ"]
CX, CZ = (X0 + X1) / 2, (Z0 + Z1) / 2


def T(n):
    return os.path.join(TEXM, n)


U.MATSPEC.update({
    "LM_floor": dict(tex=T("T_m_floor.png"), tile=2.4, rough=0.38, coat=0.12),
    "LM_plaster": dict(tex=T("T_m_plaster.png"), tile=2.5, rough=0.9, nor=os.path.join(DLT, "white_plaster_02_nor_gl_1k.jpg"),
                       nor_strength=0.25, tint=True),
    "LM_lacquer": dict(tex=T("T_m_lacquer.png"), uv="explicit", rough=0.3, coat=0.3),
    "LM_oak": dict(tex=T("T_m_oak.png"), uv="explicit", rough=0.45, coat=0.15, tint=True),
    "LM_fabric": dict(tex=T("T_m_fabric.png"), tile=0.5, rough=1.0, tint=True),
    "LM_atlas": dict(tex=T("T_m_atlas.png"), uv="explicit", rough=0.5),
    "LM_signs": dict(tex=T("T_m_signs.png"), uv="explicit", rough=0.45),
    "LM_painting": dict(tex=T("T_m_painting.png"), uv="explicit", rough=0.5),
    "M_lamp": dict(kind="emit", color="#FFE2BE", strength=12.0),
    "M_skylight": dict(kind="emit", color="#F4F8FF", strength=6.0),
    "M_garden": dict(kind="emit_tex", tex=T("T_m_garden.png"), strength=1.0),
    "M_glass": dict(color="#F2F6F6", rough=0.02, transmission=1.0, ior=1.45),
    "M_glass_e": dict(color="#F2F6F6", rough=0.02, transmission=1.0, ior=1.45),
    "M_petal": dict(color="#FFFFFF", rough=0.6),
    # the white lacquer cubby interiors (round 6): their own shared light texture (bake_cubby.py); authored like the lacquer
    "M_cubby_in": dict(color="#F3EEE6", rough=0.3, coat=0.3),
    "M_alu": dict(color="#9C9A94", rough=0.4),
})


def acell(name):
    return tuple(ATL["cells"][name])


def P(x, z, y):
    return V(x, z, y)


def setcat(ob, cat, lmw=None):
    ob["cat"] = cat
    if lmw is not None:
        ob["lmw"] = lmw
    return ob


# ------------------------------------------------------------------------------------------- face helpers --

def gface(mb, pts, m, grain=None, tile=1.0, hint=None, uv=None, tint=None):
    """Quad/polygon from GAME points (x, z, y). grain: game-space unit vector the texture's u follows (wood grain);
    the v axis is the face's other in-plane direction. uv: a fixed (u, v) for every corner (atlas cells)."""
    bp = [P(*p) for p in pts]
    h = None if hint is None else V(hint[0], hint[1], hint[2]) - V(0, 0, 0)
    if uv is not None:
        uvs = [uv] * len(bp)
    elif grain is not None:
        g = (V(grain[0], grain[1], grain[2]) - V(0, 0, 0)).normalized()
        n = (bp[1] - bp[0]).cross(bp[2] - bp[1])
        if n.length < 1e-12 and len(bp) > 3:
            n = (bp[2] - bp[1]).cross(bp[3] - bp[2])
        n.normalize()
        g2 = n.cross(g)
        if g2.length < 1e-6:            # grain along the normal: pick any in-plane axis
            g = (bp[1] - bp[0]).normalized()
            g2 = n.cross(g)
        g2.normalize()
        uvs = [(p.dot(g) / tile, p.dot(g2) / tile) for p in bp]
    else:
        uvs = None
    return mb.face(bp, m, uvs, hint=h, tint=tint)


def gbox(mb, x0, x1, z0, z1, y0, y1, m, grain=(1, 0, 0), tile=1.0, faces="all", uv=None, tint=None):
    """Axis box in game coords with per-face grain UVs. faces: 'all' or a set of 'top','bottom','n','s','e','w'."""
    want = {"top", "bottom", "n", "s", "e", "w"} if faces == "all" else set(faces)
    out = []
    if "top" in want:
        out.append(gface(mb, [(x0, z0, y1), (x1, z0, y1), (x1, z1, y1), (x0, z1, y1)], m, grain, tile, (0, 0, 1), uv, tint))
    if "bottom" in want:
        out.append(gface(mb, [(x0, z0, y0), (x1, z0, y0), (x1, z1, y0), (x0, z1, y0)], m, grain, tile, (0, 0, -1), uv, tint))
    if "n" in want:
        out.append(gface(mb, [(x0, z0, y0), (x1, z0, y0), (x1, z0, y1), (x0, z0, y1)], m, grain, tile, (0, -1, 0), uv, tint))
    if "s" in want:
        out.append(gface(mb, [(x0, z1, y0), (x1, z1, y0), (x1, z1, y1), (x0, z1, y1)], m, grain, tile, (0, 1, 0), uv, tint))
    if "w" in want:
        out.append(gface(mb, [(x0, z0, y0), (x0, z1, y0), (x0, z1, y1), (x0, z0, y1)], m, grain, tile, (-1, 0, 0), uv, tint))
    if "e" in want:
        out.append(gface(mb, [(x1, z0, y0), (x1, z1, y0), (x1, z1, y1), (x1, z0, y1)], m, grain, tile, (1, 0, 0), uv, tint))
    return out


def rbox(mb, cx, cz, y0, sx, sz, sy, m, r=0.02, seg=2, yaw=0.0, grain=(1, 0, 0), tile=1.0, uv=None, tint=None,
         bottom=False, squash=None):
    """Rounded (bevelled) box in game coords: centre (cx, cz), bottom y0, sizes, turned by game yaw."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    r = min(r, sx / 2 - 1e-4, sz / 2 - 1e-4, sy / 2 - 1e-4)
    if r > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=r, segments=seg, affect="EDGES", profile=0.5)
    if squash:   # soften a cushion: pull the top face centre up a little (puffy)
        for v in bm.verts:
            if v.co.z > sy / 2 - 1e-4:
                k = (1 - (2 * v.co.x / sx) ** 2) * (1 - (2 * v.co.y / sz) ** 2)
                v.co.z += squash * max(0.0, k)
    c, s = math.cos(yaw), math.sin(yaw)
    out = []
    for f in bm.faces:
        pts = []
        for v in f.verts:
            lx, lz, ly = v.co.x, v.co.y, v.co.z + sy / 2
            gx = cx + lx * c + lz * s
            gz = cz - lx * s + lz * c
            pts.append((gx, gz, y0 + ly))
        n = f.normal
        if not bottom and n.z < -0.99:
            continue
        nx = n.x * c + n.y * s
        nz = -n.x * s + n.y * c
        out.append(gface(mb, pts, m, grain, tile, (nx, nz, n.z), uv, tint))
    bm.free()
    return out


def lathe(mb, cx, cz, y0, profile, m, segs=24, uv=None, grain=None, tile=1.0, tint=None):
    """Surface of revolution in game coords; profile [(r, y)] bottom to top (r 0 at the poles)."""
    rings = []
    for (r, y) in profile:
        rings.append([(cx + r * math.cos(2 * math.pi * i / segs), cz + r * math.sin(2 * math.pi * i / segs), y0 + y)
                      for i in range(segs)])
    for j in range(len(profile) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            a, b, c2, d = rings[j][i], rings[j][i2], rings[j + 1][i2], rings[j + 1][i]
            am = 2 * math.pi * (i + 0.5) / segs
            dr = profile[j + 1][0] - profile[j][0]
            dy = profile[j + 1][1] - profile[j][1]
            hint = (math.cos(am) * dy, math.sin(am) * dy, -dr)
            if profile[j][0] == 0:
                pts = [a, c2, d]
            elif profile[j + 1][0] == 0:
                pts = [a, b, c2]
            else:
                pts = [a, b, c2, d]
            f = gface(mb, pts, m, grain, tile, hint, uv, tint)
            if f is not None:
                f.smooth = True


def disc(mb, cx, cz, y, r, m, segs=24, down=False, uv=None, r_in=0.0):
    hint = (0, 0, -1) if down else (0, 0, 1)
    if r_in <= 0:
        pts = [(cx + r * math.cos(2 * math.pi * i / segs), cz + r * math.sin(2 * math.pi * i / segs), y) for i in range(segs)]
        return gface(mb, pts, m, hint=hint, uv=uv)
    for i in range(segs):
        a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
        pts = [(cx + r_in * math.cos(a0), cz + r_in * math.sin(a0), y), (cx + r * math.cos(a0), cz + r * math.sin(a0), y),
               (cx + r * math.cos(a1), cz + r * math.sin(a1), y), (cx + r_in * math.cos(a1), cz + r_in * math.sin(a1), y)]
        gface(mb, pts, m, hint=hint, uv=uv)



def flower_head(mb, x, z, y, r, mname, uvc, rng, petals=True):
    """A low-poly blossom: a squashed sphere (8 x 5)."""
    segs, rings = 8, 5
    prof = [(r * math.sin(math.pi * k / rings), -r * 0.75 * math.cos(math.pi * k / rings)) for k in range(rings + 1)]
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    lathe(mb, x, z, y, prof, mname, segs=segs, uv=uvc)




# ------------------------------------------------------------------------------------- detailed small props --
# Round 5 (2026-11-15): the flower stand's flowers and the tea corner's espresso machine were blobs and boxes ("장난감 같다").
# These helpers build them as real shapes (stems, leaves, petals; body, group head, portafilter, drip tray, buttons) in game
# coordinates (x, z, y), from reference photos (memorial-build/r5/refs, Wikimedia Commons).

def _v(a):
    return Vector((a[0], a[1], a[2]))


def _basis(d):
    """Two unit vectors perpendicular to d (game coords)."""
    d = _v(d).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    w = d.cross(u).normalized()
    return u, w


def tube(mb, pts, r, m, uv, segs=6, r_end=None, cap=True):
    """A tube along the polyline pts (game coords) of radius r (tapering to r_end)."""
    n = len(pts)
    rings = []
    prev_u = None
    for i, p in enumerate(pts):
        a = _v(pts[max(0, i - 1)])
        b = _v(pts[min(n - 1, i + 1)])
        d = (b - a).normalized()
        u, w = _basis(d)
        if prev_u is not None:
            u2 = prev_u - d * prev_u.dot(d)
            if u2.length > 1e-6:
                u = u2.normalized()
                w = d.cross(u).normalized()
        prev_u = u
        rr = r if r_end is None else r + (r_end - r) * (i / (n - 1))
        c = _v(p)
        rings.append([c + (u * math.cos(2 * math.pi * k / segs) + w * math.sin(2 * math.pi * k / segs)) * rr for k in range(segs)])
    for i in range(n - 1):
        cmid = (_v(pts[i]) + _v(pts[i + 1])) / 2
        for k in range(segs):
            k2 = (k + 1) % segs
            q = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
            hint = Vector((0, 0, 0))
            for x in q:
                hint += x - cmid
            f = gface(mb, [tuple(x) for x in q], m, hint=tuple(hint), uv=uv)
            if f is not None:
                f.smooth = True
    if cap:
        end = _v(pts[-1])
        d = (end - _v(pts[-2])).normalized()
        gface(mb, [tuple(x) for x in rings[-1]], m, hint=tuple(d), uv=uv)


def blade(mb, base, dirv, normal, length, width, m, uv, lift=0.0, curl=0.0, both=True, base_w=0.35, mid=0.45, tint=None):
    """A petal or a leaf: base -> widest point -> tip, cupped up along `normal` (lift at the tip, curl at the edges)."""
    b = _v(base)
    d = _v(dirv).normalized()
    nrm = _v(normal)
    nrm = nrm - d * nrm.dot(d)
    if nrm.length < 1e-6:
        nrm = _basis(d)[0]
    nrm.normalize()
    s = d.cross(nrm).normalized()
    hw = width / 2
    p0l = b - s * hw * base_w
    p0r = b + s * hw * base_w
    cm = b + d * length * mid + nrm * (lift * 0.35)
    p1l = cm - s * hw + nrm * curl
    p1r = cm + s * hw + nrm * curl
    p1c = cm - nrm * curl * 0.3
    tip = b + d * length + nrm * lift
    faces = [[p0l, p0r, p1c], [p0l, p1c, p1l], [p0r, p1r, p1c], [p1l, p1c, tip], [p1c, p1r, tip]]
    for q in faces:
        gface(mb, [tuple(x) for x in q], m, hint=tuple(nrm), uv=uv, tint=tint)
        if both:
            gface(mb, [tuple(x) for x in q[::-1]], m, hint=tuple(-nrm), uv=uv, tint=tint)


# linear petal colours by atlas cell name (make_memorial_textures.py ATLAS)
PETAL_COLOURS = {"flower_white": (0.92, 0.92, 0.90), "chrysanthemum": (0.88, 0.88, 0.84), "flower_pink": (0.92, 0.55, 0.62),
                 "flower_cream": (0.93, 0.88, 0.70), "flower_lav": (0.66, 0.58, 0.88)}
PETALS = []            # the unlit petal mesh being built (flower stand): mum_head writes its petals there when set


def mum_head(mb, c, face, r, petal_uv, rng, rings=((14, 1.0, 0.10), (9, 0.72, 0.45), (6, 0.45, 0.85)), eye=True):
    """A chrysanthemum / daisy head at c facing `face`: rings of (count, length share, upward cup) petals round a domed eye."""
    c = _v(c)
    f = _v(face).normalized()
    u, w = _basis(f)
    for (count, share, cup) in rings:
        off = rng.random() * 6.28
        for k in range(count):
            a = off + 2 * math.pi * k / count
            rad = u * math.cos(a) + w * math.sin(a)
            dirv = (rad + f * cup).normalized()
            L = r * share * (0.9 + 0.2 * rng.random())
            # petals are not light-mapped (hundreds of tiny islands bled dark texels into them): an unlit petal material with the
            # shading in the vertex colour — the inner rings a little deeper, petals facing up brighter, a touch of variation
            pc = PETAL_COLOURS.get(petal_uv, (0.9, 0.9, 0.88))
            up = max(0.0, dirv.z)
            sh = (0.70 + 0.16 * up + 0.08 * rng.random()) * (1.0 if share >= 0.99 else 0.92 if share > 0.6 else 0.85)
            blade(PETALS[-1] if PETALS else mb, tuple(c + rad * r * 0.16 + f * 0.004), tuple(dirv), tuple(f), L, L * 0.34, "M_petal", (0.5, 0.5), lift=L * 0.12,
                  curl=L * 0.06, both=False, base_w=0.5, mid=0.55, tint=(pc[0] * sh, pc[1] * sh, pc[2] * sh, 1.0))
    if eye:
        er = r * 0.2
        prof = [(er, 0.0), (er * 0.9, er * 0.35), (er * 0.55, er * 0.6), (0.0, er * 0.7)]
        segs = 8
        ring_pts = []
        for (rr, hh) in prof:
            ring_pts.append([c + (u * math.cos(2 * math.pi * k / segs) + w * math.sin(2 * math.pi * k / segs)) * rr + f * hh
                             for k in range(segs)])
        for j in range(len(prof) - 1):
            for k in range(segs):
                k2 = (k + 1) % segs
                q = [ring_pts[j][k], ring_pts[j][k2], ring_pts[j + 1][k2], ring_pts[j + 1][k]]
                if prof[j + 1][0] == 0:
                    q = q[:3]
                hv = f + (q[0] - c).normalized() * 0.5
                fc = gface(mb, [tuple(x) for x in q], "LM_atlas", hint=tuple(hv), uv=acell("flower_eye"))
                if fc is not None:
                    fc.smooth = True


def mum_stem(mb, root, top, rng, leaves=3):
    """A green stem from root up to the head at top (a gentle bow), with lobed leaves along it."""
    r0, t = _v(root), _v(top)
    bow = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.025
    pts = [tuple(r0 + (t - r0) * (k / 4) + bow * math.sin(math.pi * k / 4)) for k in range(5)]
    tube(mb, pts, 0.0045, "LM_atlas", acell("stem_green"), segs=4, r_end=0.0035, cap=False)
    for j in range(leaves):
        k = 0.3 + 0.45 * j / max(1, leaves - 1)
        at = r0 + (t - r0) * k + bow * math.sin(math.pi * k)
        a = rng.random() * 6.28
        out = Vector((math.cos(a), math.sin(a), 0.0))
        dirv = (out + Vector((0, 0, 0.45))).normalized()
        L = rng.uniform(0.06, 0.085)
        blade(mb, tuple(at), tuple(dirv), (0, 0, 1), L, L * 0.55, "LM_atlas", acell("leaf_mum"), lift=-L * 0.25, curl=L * 0.08,
              base_w=0.15, mid=0.4)


def bucket(mb, cx, cz, y0, r_bot, r_top, h):
    """A galvanised florist's bucket: tapered wall (inside and out), rolled rim, two side ears, dark water inside."""
    lathe(mb, cx, cz, y0, [(0.0, 0.0), (r_bot, 0.0), (r_bot + 0.004, 0.01), (r_top, h - 0.012), (r_top + 0.006, h - 0.006),
                           (r_top + 0.004, h), (r_top - 0.004, h)], "LM_atlas", segs=12, uv=acell("galv"))
    lathe(mb, cx, cz, y0 + 0.02, [(r_top - 0.004, h - 0.02), (r_bot - 0.004, 0.0), (0.0, 0.0)], "LM_atlas", segs=12, uv=acell("galv"))
    disc(mb, cx, cz, y0 + h * 0.55, r_bot + (r_top - r_bot) * 0.55 - 0.004, "LM_atlas", segs=12, uv=acell("water"))
    for sgn in (-1, 1):
        rb(mb, cx + sgn * (r_top + 0.002) - 0.006, cx + sgn * (r_top + 0.002) + 0.006, cz - 0.012, cz + 0.012, y0 + h - 0.05,
           y0 + h - 0.025, "LM_atlas", r=0.003, uv=acell("galv"))


def mum_bunch(mb, cx, cz, y_water, r_mouth, n, petal_uv, rng, height=0.42, spread=1.0, head=0.05):
    """n stems in a bucket: heads domed over the mouth (taller in the middle), facing up and out toward the room (-z)."""
    for i in range(n):
        a = 2.4 * i + rng.random() * 0.4
        rr = r_mouth * 0.75 * math.sqrt((i + 0.5) / n)
        root = (cx + rr * 0.3 * math.cos(a), cz + rr * 0.3 * math.sin(a), y_water - 0.02)
        lean = 0.10 * spread + 0.6 * rr
        top = (cx + math.cos(a) * lean, cz + math.sin(a) * lean - 0.03,
               y_water + height * (1.0 - 0.25 * rr / r_mouth) + rng.uniform(-0.03, 0.03))
        mum_stem(mb, root, top, rng, leaves=2 if i % 2 else 3)
        face = (math.cos(a) * 0.45, math.sin(a) * 0.45 - 0.35, 1.0)
        mum_head(mb, top, face, head * rng.uniform(0.85, 1.15), petal_uv, rng)
    for i in range(3):   # a few buds
        a = rng.random() * 6.28
        top = (cx + math.cos(a) * r_mouth * 0.6, cz + math.sin(a) * r_mouth * 0.6, y_water + height * 0.8)
        mum_stem(mb, (cx, cz, y_water - 0.02), top, rng, leaves=1)
        lathe(mb, top[0], top[1], top[2] - 0.008, [(0.0, 0.0), (0.011, 0.006), (0.012, 0.016), (0.0, 0.024)], "LM_atlas", segs=8,
              uv=acell("leaf_mum"))


def espresso_machine(mb, x0, x1, zf, zb, y0):
    """A single-group espresso machine on the counter, its front toward -z (the room): stainless body with a black cup-warmer
    top and rail, front panel with four buttons and a green power light, pressure gauge, group head, portafilter with a black
    handle, drip tray with a slotted grate and two cups, steam wand, hot-water tap and their knobs, rubber feet."""
    cx = (x0 + x1) / 2
    st, stb, blk = acell("steel"), acell("steel_bright"), acell("black")
    h = 0.40
    for fx_ in (x0 + 0.03, x1 - 0.03):
        for fz in (zf + 0.04, zb - 0.04):
            lathe(mb, fx_, fz, y0, [(0.0, 0.0), (0.014, 0.0), (0.012, 0.018), (0.0, 0.018)], "LM_atlas", segs=8, uv=blk)
    yb = y0 + 0.018
    rb(mb, x0, x1, zf + 0.06, zb, yb, yb + h, "LM_atlas", r=0.012, uv=blk)                              # black housing
    rb(mb, x0 + 0.005, x1 - 0.005, zf, zf + 0.07, yb + 0.20, yb + h, "LM_atlas", r=0.01, uv=blk)        # upper front panel
    rb(mb, x0 + 0.01, x1 - 0.01, zf - 0.004, zf + 0.01, yb + 0.20, yb + 0.225, "LM_atlas", r=0.004, uv=stb)  # stainless strip
    rb(mb, x0, x0 + 0.03, zf, zf + 0.07, yb, yb + 0.20, "LM_atlas", r=0.006, uv=stb)                   # side posts
    rb(mb, x1 - 0.03, x1, zf, zf + 0.07, yb, yb + 0.20, "LM_atlas", r=0.006, uv=stb)
    gbox(mb, x0 + 0.03, x1 - 0.03, zf + 0.055, zf + 0.06, yb, yb + 0.20, "LM_atlas", uv=st, faces={"n"})   # brew bay back
    rb(mb, x0 + 0.01, x1 - 0.01, zf + 0.01, zb - 0.01, yb + h, yb + h + 0.012, "LM_atlas", r=0.004, uv=blk)
    for (a0, a1, b0, b1) in ((x0 + 0.02, x1 - 0.02, zf + 0.02, zf + 0.03), (x0 + 0.02, x1 - 0.02, zb - 0.03, zb - 0.02),
                             (x0 + 0.02, x0 + 0.03, zf + 0.02, zb - 0.02), (x1 - 0.03, x1 - 0.02, zf + 0.02, zb - 0.02)):
        rb(mb, a0, a1, b0, b1, yb + h + 0.012, yb + h + 0.04, "LM_atlas", r=0.004, uv=stb)
    for k in range(3):   # cups warming on top, upside down
        ccx = x0 + 0.09 + k * 0.11
        lathe(mb, ccx, zf + 0.19, yb + h + 0.012, [(0.0, 0.055), (0.028, 0.055), (0.032, 0.03), (0.022, 0.0), (0.0, 0.0)],
              "LM_atlas", segs=14, uv=acell("porcelain"))
    for k in range(4):   # control strip: four buttons with white marks, the power light, a black badge
        bx = cx - 0.075 + k * 0.05
        rb(mb, bx - 0.016, bx + 0.016, zf - 0.008, zf + 0.002, yb + 0.33, yb + 0.358, "LM_atlas", r=0.005, uv=stb)
        rb(mb, bx - 0.006, bx + 0.006, zf - 0.010, zf - 0.007, yb + 0.341, yb + 0.347, "LM_atlas", r=0.001, seg=1, uv=blk)
    rb(mb, x1 - 0.065, x1 - 0.05, zf - 0.006, zf + 0.002, yb + 0.365, yb + 0.375, "LM_atlas", r=0.003, uv=acell("led_green"))
    rb(mb, cx - 0.05, cx + 0.05, zf - 0.004, zf + 0.002, yb + 0.375, yb + 0.39, "LM_atlas", r=0.002, seg=1, uv=stb)
    gx, gy = x0 + 0.065, yb + 0.265     # pressure gauge
    for (rr, dz, cell_) in ((0.028, -0.004, "steel_bright"), (0.022, -0.006, "gauge_face")):
        pts = [(gx + rr * math.cos(2 * math.pi * k / 16), zf + dz, gy + rr * math.sin(2 * math.pi * k / 16)) for k in range(16)]
        gface(mb, pts, "LM_atlas", hint=(0, -1, 0), uv=acell(cell_))
    gface(mb, [(gx - 0.002, zf - 0.007, gy), (gx + 0.002, zf - 0.007, gy), (gx + 0.014, zf - 0.007, gy + 0.012)], "LM_atlas",
          hint=(0, -1, 0), uv=acell("mail_red"))
    gy0 = yb + 0.20     # group head, portafilter basket and handle, spouts
    lathe(mb, cx, zf + 0.03, gy0 - 0.045, [(0.0, 0.0), (0.035, 0.0), (0.038, 0.012), (0.034, 0.03), (0.04, 0.045), (0.0, 0.045)],
          "LM_atlas", segs=20, uv=stb)
    lathe(mb, cx, zf + 0.03, gy0 - 0.09, [(0.0, 0.0), (0.03, 0.002), (0.036, 0.03), (0.04, 0.045), (0.0, 0.045)], "LM_atlas", segs=20,
          uv=st)
    tube(mb, [(cx, zf + 0.0, gy0 - 0.07), (cx - 0.02, zf - 0.07, gy0 - 0.075), (cx - 0.03, zf - 0.15, gy0 - 0.085)], 0.011, "LM_atlas",
         blk, segs=8, r_end=0.013)
    for sgn in (-1, 1):
        tube(mb, [(cx + sgn * 0.012, zf + 0.03, gy0 - 0.09), (cx + sgn * 0.016, zf + 0.03, gy0 - 0.11)], 0.005, "LM_atlas", st, segs=6)
    ty = yb + 0.035     # drip tray with a slotted grate, two espresso cups on it
    rb(mb, x0 + 0.03, x1 - 0.03, zf - 0.05, zf + 0.055, yb, ty, "LM_atlas", r=0.006, uv=stb)
    nslot = 9
    for k in range(nslot):
        sx0 = x0 + 0.045 + k * (x1 - x0 - 0.09) / nslot
        gbox(mb, sx0, sx0 + 0.012, zf - 0.04, zf + 0.045, ty + 0.0005, ty + 0.001, "LM_atlas", uv=blk, faces={"top"})
    for sgn in (-1, 1):
        ccx = cx + sgn * 0.022
        lathe(mb, ccx, zf + 0.03, ty, [(0.0, 0.0), (0.018, 0.0), (0.024, 0.04), (0.022, 0.042), (0.019, 0.006), (0.0, 0.006)],
              "LM_atlas", segs=14, uv=acell("porcelain"))
        disc(mb, ccx, zf + 0.03, ty + 0.03, 0.02, "LM_atlas", segs=12, uv=acell("coffee"))
    tube(mb, [(x1 - 0.05, zf - 0.005, yb + 0.25), (x1 - 0.05, zf - 0.04, yb + 0.24), (x1 - 0.045, zf - 0.05, yb + 0.15),
              (x1 - 0.04, zf - 0.05, yb + 0.08)], 0.0055, "LM_atlas", stb, segs=6)
    tube(mb, [(x0 + 0.05, zf - 0.005, yb + 0.22), (x0 + 0.05, zf - 0.035, yb + 0.21), (x0 + 0.052, zf - 0.04, yb + 0.15)], 0.006,
         "LM_atlas", stb, segs=6)
    for kx in (x0 + 0.05, x1 - 0.05):
        tube(mb, [(kx, zf - 0.0, yb + 0.322), (kx, zf - 0.03, yb + 0.322)], 0.012, "LM_atlas", stb, segs=10)


def cup_tray(mb, x0, x1, z0, z1, y0, rng):
    """A birch serving tray with a raised rim: three cups on saucers (handles), a sugar jar with a lid, two spoons."""
    rb(mb, x0, x1, z0, z1, y0, y0 + 0.012, "LM_atlas", r=0.01, uv=acell("birch"))
    for (a0, a1, b0, b1) in ((x0, x1, z0, z0 + 0.012), (x0, x1, z1 - 0.012, z1), (x0, x0 + 0.012, z0, z1), (x1 - 0.012, x1, z0, z1)):
        rb(mb, a0, a1, b0, b1, y0 + 0.012, y0 + 0.03, "LM_atlas", r=0.004, uv=acell("birch"))
    ty = y0 + 0.012
    for k in range(3):
        cx = x0 + 0.07 + k * 0.1
        cz = (z0 + z1) / 2 + (0.03 if k == 1 else -0.02)
        lathe(mb, cx, cz, ty, [(0.0, 0.0), (0.045, 0.0), (0.05, 0.008), (0.0, 0.006)], "LM_atlas", segs=16, uv=acell("porcelain"))
        lathe(mb, cx, cz, ty + 0.006, [(0.0, 0.0), (0.026, 0.0), (0.034, 0.055), (0.031, 0.056), (0.024, 0.008), (0.0, 0.008)],
              "LM_atlas", segs=16, uv=acell("porcelain"))
        tube(mb, [(cx + 0.032, cz, ty + 0.045), (cx + 0.05, cz, ty + 0.042), (cx + 0.052, cz, ty + 0.025), (cx + 0.03, cz, ty + 0.018)],
             0.004, "LM_atlas", acell("porcelain"), segs=5, cap=False)
    jx = x1 - 0.06
    jz = (z0 + z1) / 2
    lathe(mb, jx, jz, ty, [(0.0, 0.0), (0.032, 0.0), (0.034, 0.07), (0.028, 0.075), (0.03, 0.08), (0.008, 0.088), (0.006, 0.098),
                           (0.0, 0.098)], "LM_atlas", segs=16, uv=acell("vase_glass"))
    for k in range(2):
        tube(mb, [(x0 + 0.05 + k * 0.05, z0 + 0.03, ty + 0.002), (x0 + 0.1 + k * 0.05, z0 + 0.045, ty + 0.004)], 0.003, "LM_atlas",
             acell("steel_bright"), segs=4)

# ----------------------------------------------------------------------------------------------- registry --
# Everything below is authored in GAME coordinates (x east, z south, y up). Furniture registers its collider and its
# seats here; main() turns the registry into col__* boxes and seat__* empties.

COLS = []       # (name, minX, maxX, minZ, maxZ, height)
SEATS = []      # dicts, see seat()
LIGHTS = []     # extra bake lights (name, kind, pos(x,z,y), props)


def col(name, x0, x1, z0, z1, h):
    COLS.append((name, round(min(x0, x1), 3), round(max(x0, x1), 3), round(min(z0, z1), 3), round(max(z0, z1), 3), h))


def seat(sid, furn, kind, x, z, y, yaw, edge, back=0.0, width=1.0, group=None, both=False, exit_turn=0.0, lean=0.0):
    """A seat marker. (x, z, y): the middle of the seat surface at its front edge's line... see benchSeats.ts:
    x, z = the seat's centre on the surface, y = surface height; yaw = the way a sitter faces (game yaw);
    edge = distance from (x, z) forward to the seat's front edge; back = distance from (x, z) backward to the
    backrest's face (backed seats; 0 for backless); width = along the seat; both = a backless seat that can be
    sat from either side (the generator makes both facings, one exclusive group); exit_turn = which way a sitter
    gets up relative to the facing (0 ahead, pi behind); lean = how far the sitter leans back (rad)."""
    SEATS.append(dict(id=sid, furn=furn, kind=kind, x=x, z=z, y=y, yaw=yaw, edge=edge, back=back, width=width,
                      group=group or sid, both=both, exit_turn=exit_turn, lean=lean))


def rb(mb, x0, x1, z0, z1, y0, y1, m, r=0.02, **kw):
    """Rounded box between corners (game coords)."""
    return rbox(mb, (x0 + x1) / 2, (z0 + z1) / 2, y0, abs(x1 - x0), abs(z1 - z0), y1 - y0, m, r=r, **kw)


def grain_x(kw):
    return kw


# Tints (linear, multiplied into the albedo: LM_fabric, LM_plaster, LM_oak carry the vertex colour)
SAGE = (0.50, 0.60, 0.52, 1.0)
WALNUT = (0.44, 0.34, 0.30, 1.0)
SOFA = (0.70, 0.68, 0.64, 1.0)
CREAM = (0.98, 0.93, 0.84, 1.0)
CLAY = (0.89, 0.59, 0.45, 1.0)
SAGE_CUSH = (0.57, 0.66, 0.55, 1.0)
RUG_C = (0.89, 0.83, 0.74, 1.0)
RUG_DARK = (0.50, 0.55, 0.52, 1.0)


def sign_uv(name):
    u0, v0, u1, v1 = SIGNS["regions"][name]
    return u0, v0, u1, v1


def plaque(mb, name, a, b, y0, y1, hint, lift=0.0):
    """A printed sign on a vertical plane from ground point a (left, seen from the front) to b (right), heights y0..y1."""
    u0, v0, u1, v1 = sign_uv(name)
    pts = [(a[0], a[1], y0), (b[0], b[1], y0), (b[0], b[1], y1), (a[0], a[1], y1)]
    return mb.face([P(*q) for q in pts], "LM_signs",
                                                                                 [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
                                                                                 hint=V(hint[0], hint[1], hint[2]) - V(0, 0, 0))


# ----------------------------------------------------------------------------------------------- shell --

WIN_Z = (-0.6, 5.2)                                # the garden window (west wall)
SILL, HEAD = 0.7, 3.0
DOOR = (298.9, 301.1, 2.7)                         # south wall door: x range, height
NICHE_C = (NICHE["minX"] + NICHE["maxX"]) / 2
SKY = (NICHE_C - 1.0, NICHE_C + 1.0, -5.2, -2.6)   # skylight opening x0, x1, z0, z1 (2 x 2.6 m, in front of the niche)
SKY_UP = 0.18
SOFF = dict(w=0.35, drop=0.30)                     # the cove soffit all round
DOWNLIGHTS = [(296.0, -3.0), (304.0, -3.0), (304.0, 0.0), (296.0, 0.0), (300.0, 2.0), (300.0, 4.4), (304.6, 4.0),
              (294.3, 3.2), (296.6, 3.2), (294.6, -1.2), (302.6, 5.0), (297.6, 5.0)]
BANK_TOP = None  # set in banks()


def shell(c, fx):
    mb = MB()
    gface(mb, [(X0, Z0, 0), (X1, Z0, 0), (X1, Z1, 0), (X0, Z1, 0)], "LM_floor", hint=(0, 0, 1))
    setcat(mb.finish("hall_floor", c), "lm", 0.62)

    # ---- ceiling with the skylight opening
    mb = MB()
    sx0, sx1, sz0, sz1 = SKY
    for (a, b, d, e) in ((X0, sx0, Z0, Z1), (sx1, X1, Z0, Z1), (sx0, sx1, Z0, sz0), (sx0, sx1, sz1, Z1)):
        gface(mb, [(a, d, H), (b, d, H), (b, e, H), (a, e, H)], "LM_plaster", hint=(0, 0, -1))
    for (pa, pb, hint) in (((sx0, sz0), (sx0, sz1), (1, 0, 0)), ((sx1, sz0), (sx1, sz1), (-1, 0, 0)),
                           ((sx0, sz0), (sx1, sz0), (0, 1, 0)), ((sx0, sz1), (sx1, sz1), (0, -1, 0))):
        gface(mb, [(pa[0], pa[1], H), (pb[0], pb[1], H), (pb[0], pb[1], H + SKY_UP), (pa[0], pa[1], H + SKY_UP)],
              "LM_plaster", hint=hint)
    setcat(mb.finish("hall_ceiling", c), "lm", 0.5)

    # ---- cove soffit: a drop band all round, an emissive slit on its inner face
    mb = MB()
    w, dr = SOFF["w"], SOFF["drop"]
    yb = H - dr
    zn = Z0 + 0.39 + w         # north: in front of the banks' plane
    xe = X1 - 0.39 - w
    xw = X0 + w
    zs = Z1 - w
    for (a, b, d, e) in ((X0, X1, Z0 + 0.39, zn), (X0, xw, zn, zs), (xe, X1, zn, zs), (X0, X1, zs, Z1)):
        gface(mb, [(a, d, yb), (b, d, yb), (b, e, yb), (a, e, yb)], "LM_plaster", hint=(0, 0, -1))
    # inner vertical faces (facing the room)
    gface(mb, [(X0, zn, yb), (X1, zn, yb), (X1, zn, H), (X0, zn, H)], "LM_plaster", hint=(0, 1, 0))
    gface(mb, [(X0, zs, yb), (X1, zs, yb), (X1, zs, H), (X0, zs, H)], "LM_plaster", hint=(0, -1, 0))
    gface(mb, [(xw, zn, yb), (xw, zs, yb), (xw, zs, H), (xw, zn, H)], "LM_plaster", hint=(1, 0, 0))
    gface(mb, [(xe, zn, yb), (xe, zs, yb), (xe, zs, H), (xe, zn, H)], "LM_plaster", hint=(-1, 0, 0))
    setcat(mb.finish("hall_soffit", c), "lm", 0.7)
    mb = MB()
    t0, t1 = H - 0.075, H - 0.055
    for (pa, pb, hint) in (((X0, zn - 0.004), (X1, zn - 0.004), (0, 1, 0)), ((X0, zs + 0.004), (X1, zs + 0.004), (0, -1, 0))):
        gface(mb, [(pa[0], pa[1], t0), (pb[0], pb[1], t0), (pb[0], pb[1], t1), (pa[0], pa[1], t1)], "M_lamp", hint=hint, uv=(0.5, 0.5))
    for (xx, hint) in ((xw + 0.004, (1, 0, 0)), (xe - 0.004, (-1, 0, 0))):
        gface(mb, [(xx, zn, t0), (xx, zs, t0), (xx, zs, t1), (xx, zn, t1)], "M_lamp", hint=hint, uv=(0.5, 0.5))
    o = mb.finish("cove_slits", fx, auto=False)
    setcat(o, "nonlm")
    # cove bake lights: long area lights on the four inner faces, facing into the room
    for name, ctr, size, rot in (("north", (CX, zn + 0.02, H - 0.1), X1 - X0, 0.0), ("south", (CX, zs - 0.02, H - 0.1), X1 - X0, math.pi),
                                 ("west", (xw + 0.02, CZ, H - 0.1), zs - zn, -math.pi / 2), ("east", (xe - 0.02, CZ, H - 0.1), zs - zn, math.pi / 2)):
        ld = bpy.data.lights.new(f"cove_{name}", "AREA")
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = size, 0.06
        ld.energy = 11.0 * size
        ld.color = (1.0, 0.88, 0.70)
        lo = bpy.data.objects.new(f"cove_{name}", ld)
        lo.location = V(*ctr[:2], ctr[2])
        lo["bakelight"] = True
        lo["cove"] = name
        c.objects.link(lo)
        # aim: area lights emit along their -Z; point the light's -Z at "into the room and a little down"
        into = {"north": (0, 1), "south": (0, -1), "west": (1, 0), "east": (-1, 0)}[name]
        d = V(into[0], into[1], 0) - V(0, 0, 0) + Vector((0, 0, -0.55))
        lo.rotation_mode = "QUATERNION"
        lo.rotation_quaternion = d.normalized().to_track_quat("-Z", "Y")

    # ---- the walls
    mb = MB()
    # west wall with the garden window
    z0w, z1w = WIN_Z
    xo = X0 - 0.30
    gface(mb, [(X0, Z0, 0), (X0, z0w, 0), (X0, z0w, H), (X0, Z0, H)], "LM_plaster", hint=(1, 0, 0))
    gface(mb, [(X0, z1w, 0), (X0, Z1, 0), (X0, Z1, H), (X0, z1w, H)], "LM_plaster", hint=(1, 0, 0))
    gface(mb, [(X0, z0w, 0), (X0, z1w, 0), (X0, z1w, SILL), (X0, z0w, SILL)], "LM_plaster", hint=(1, 0, 0))
    gface(mb, [(X0, z0w, HEAD), (X0, z1w, HEAD), (X0, z1w, H), (X0, z0w, H)], "LM_plaster", hint=(1, 0, 0))
    gface(mb, [(xo, z0w, HEAD), (X0, z0w, HEAD), (X0, z1w, HEAD), (xo, z1w, HEAD)], "LM_plaster", hint=(0, 0, -1))
    gface(mb, [(xo, z0w, SILL), (X0, z0w, SILL), (X0, z1w, SILL), (xo, z1w, SILL)], "LM_plaster", hint=(0, 0, 1))
    gface(mb, [(xo, z0w, SILL), (X0, z0w, SILL), (X0, z0w, HEAD), (xo, z0w, HEAD)], "LM_plaster", hint=(0, 1, 0))
    gface(mb, [(xo, z1w, SILL), (X0, z1w, SILL), (X0, z1w, HEAD), (xo, z1w, HEAD)], "LM_plaster", hint=(0, -1, 0))
    # south wall with the door opening (0.14 reveal)
    d0, d1, dh = DOOR
    for (a, b, y0, y1) in ((X0, d0, 0, H), (d1, X1, 0, H), (d0, d1, dh, H)):
        gface(mb, [(a, Z1, y0), (b, Z1, y0), (b, Z1, y1), (a, Z1, y1)], "LM_plaster", hint=(0, -1, 0))
    zr = Z1 + 0.14
    gface(mb, [(d0, Z1, 0), (d0, zr, 0), (d0, zr, dh), (d0, Z1, dh)], "LM_plaster", hint=(1, 0, 0))
    gface(mb, [(d1, Z1, 0), (d1, zr, 0), (d1, zr, dh), (d1, Z1, dh)], "LM_plaster", hint=(-1, 0, 0))
    gface(mb, [(d0, Z1, dh), (d1, Z1, dh), (d1, zr, dh), (d0, zr, dh)], "LM_plaster", hint=(0, 0, -1))
    # east wall: what the east bank does not cover (south of it), the brand wall is a panel in front
    ew = [w for w in INN["cubbyWalls"] if w["bank"] == "E"][0]["footprint"]
    gface(mb, [(X1, ew["maxZ"], 0), (X1, Z1, 0), (X1, Z1, H), (X1, ew["maxZ"], H)], "LM_plaster", hint=(-1, 0, 0))
    # north wall: the niche's pocket and the end fillers (the banks hide the rest)
    wa = mb.finish("hall_walls", c)
    setcat(wa, "lm", 0.62)

    # ---- skirting (oak, 8 cm) and the window sill
    mb = MB()
    sk, st = 0.08, 0.012
    gbox(mb, X0, X0 + st, zn, Z1, 0, sk, "LM_oak", grain=(0, 1, 0), faces={"top", "e", "n", "s"})
    gbox(mb, X0, d0, Z1 - st, Z1, 0, sk, "LM_oak", faces={"top", "n", "w", "e"})
    gbox(mb, d1, X1, Z1 - st, Z1, 0, sk, "LM_oak", faces={"top", "n", "w", "e"})
    gbox(mb, X1 - st, X1, ew["maxZ"], Z1, 0, sk, "LM_oak", grain=(0, 1, 0), faces={"top", "w", "n", "s"})
    gbox(mb, X0 - 0.2, X0 + 0.11, z0w - 0.03, z1w + 0.03, SILL - 0.035, SILL + 0.005, "LM_oak", grain=(0, 1, 0),
         faces={"top", "e", "n", "s", "bottom"})
    setcat(mb.finish("hall_trim", c), "lm", 1.6)

    # ---- window frame (aluminium) and glass
    mb = MB()
    fr = acell("alu")
    xf0, xf1 = X0 - 0.14, X0 - 0.08
    npost = 5
    for i in range(npost):
        zc = z0w + 0.03 + i * (z1w - z0w - 0.06) / (npost - 1)
        gbox(mb, xf0, xf1, zc - 0.03, zc + 0.03, SILL, HEAD, "LM_atlas", uv=fr, faces={"e", "n", "s"})
    gbox(mb, xf0, xf1, z0w, z1w, SILL, SILL + 0.05, "LM_atlas", uv=fr, faces={"top", "e"})
    gbox(mb, xf0, xf1, z0w, z1w, HEAD - 0.05, HEAD, "LM_atlas", uv=fr, faces={"bottom", "e"})
    gbox(mb, xf0, xf1, z0w, z1w, 2.23, 2.27, "LM_atlas", uv=fr, faces={"top", "bottom", "e"})
    setcat(mb.finish("hall_window_frames", c), "lm", 1.4)
    mb = MB()
    gface(mb, [(X0 - 0.11, z0w, SILL), (X0 - 0.11, z1w, SILL), (X0 - 0.11, z1w, HEAD), (X0 - 0.11, z0w, HEAD)], "M_glass",
          hint=(1, 0, 0), uv=(0.5, 0.5))
    gl = mb.finish("hall_window_glass", fx, auto=False)
    setcat(gl, "nonlm")
    gl["glass"] = True


def door(c, fx):
    """South door: a fixed aluminium frame, a sensor housing, a floor mat, and two sliding glass leaves (their own
    nodes door__leaf_l / door__leaf_r, closed pose: the game slides them along x)."""
    d0, d1, dh = DOOR
    zf = Z1 + 0.14
    fr = acell("alu")
    mb = MB()
    t = 0.06
    gbox(mb, d0, d0 + t, zf - 0.14, zf, 0, dh, "LM_atlas", uv=fr, faces={"n", "e", "s"})
    gbox(mb, d1 - t, d1, zf - 0.14, zf, 0, dh, "LM_atlas", uv=fr, faces={"n", "w", "s"})
    gbox(mb, d0, d1, zf - 0.14, zf, dh - 0.1, dh, "LM_atlas", uv=fr, faces={"n", "bottom", "s"})
    gbox(mb, d0 + t, d1 - t, zf - 0.14, zf, 0, 0.012, "LM_atlas", uv=acell("steel"), faces={"top"})   # threshold
    gbox(mb, NICHE_C * 0 + 299.55, 300.45, Z1 - 0.15, Z1 - 0.02, dh - 0.22, dh - 0.1, "LM_atlas", uv=acell("black"),
         faces={"n", "w", "e", "bottom", "top"})     # sensor housing
    # entrance mat inside
    rb(mb, 298.95, 301.05, 5.0, 5.9, 0.0, 0.012, "LM_fabric", r=0.004, seg=1, tint=RUG_DARK)
    setcat(mb.finish("hall_door_frame", c), "lm", 1.3)
    # the leaves
    mid = (d0 + d1) / 2
    for side, (a, b) in (("l", (d0 + t, mid - 0.004)), ("r", (mid + 0.004, d1 - t))):
        mb = MB()
        zl = Z1 - 0.02
        th = 0.045
        z0_, z1_ = zl - th / 2, zl + th / 2
        st = 0.075
        for (xa, xb, ya, yb) in ((a, a + st, 0.012, dh - 0.1), (b - st, b, 0.012, dh - 0.1), (a, b, 0.012, 0.16), (a, b, dh - 0.26, dh - 0.1)):
            gbox(mb, xa, xb, z0_, z1_, ya, yb, "M_alu", uv=(0.5, 0.5))
        # long pull handle on the meeting stile
        hx = (mid - 0.06) if side == "l" else (mid + 0.06)
        gbox(mb, hx - 0.012, hx + 0.012, z0_ - 0.07, z0_, 0.75, 1.65, "M_alu", uv=(0.5, 0.5))
        gface(mb, [(a + st, zl, 0.16), (b - st, zl, 0.16), (b - st, zl, dh - 0.26), (a + st, zl, dh - 0.26)], "M_glass",
              hint=(0, -1, 0), uv=(0.5, 0.5))
        o = mb.finish(f"door__leaf_{side}", fx, auto=False)
        setcat(o, "door")
        o["leaf"] = side


def door_daylight(fx):
    """What the glass door shows: a bright, soft card outside (the village is a different scene far away). It follows
    M_skylight, so it is dark blue at night."""
    mb = MB()
    zc = Z1 + 0.9
    gface(mb, [(297.0, zc, 0.0), (303.0, zc, 0.0), (303.0, zc, 3.6), (297.0, zc, 3.6)], "M_skylight", hint=(0, -1, 0), uv=(0.5, 0.5))
    o = mb.finish("door_daylight", fx, auto=False)
    setcat(o, "nonlm")
    o["garden"] = True      # not in the light-map bake (the door stands open there)


def ceiling_fixtures(c, fx):
    mb = MB()
    trim = acell("trim_white")
    for (x, z) in DOWNLIGHTS:
        disc(mb, x, z, H - 0.003, 0.095, "LM_atlas", segs=24, down=True, uv=trim, r_in=0.072)
    o = mb.finish("downlight_trims", c)
    setcat(o, "lm", 1.6)
    mb = MB()
    for (x, z) in DOWNLIGHTS:
        disc(mb, x, z, H - 0.004, 0.072, "M_lamp", segs=24, down=True, uv=(0.5, 0.5))
    sx0, sx1, sz0, sz1 = SKY
    gface(mb, [(sx0, sz0, H + SKY_UP), (sx1, sz0, H + SKY_UP), (sx1, sz1, H + SKY_UP), (sx0, sz1, H + SKY_UP)], "M_skylight",
          hint=(0, 0, -1), uv=(0.5, 0.5))
    o = mb.finish("ceiling_emitters", fx, auto=False)
    setcat(o, "nonlm")
    for i, (x, z) in enumerate(DOWNLIGHTS):
        ld = bpy.data.lights.new(f"dl_{i}", "SPOT")
        ld.energy = 72.0
        ld.color = (1.0, 0.93, 0.86)
        ld.spot_size = math.radians(95)
        ld.spot_blend = 0.75
        ld.shadow_soft_size = 0.06
        lo = bpy.data.objects.new(f"dl_{i}", ld)
        lo.location = P(x, z, H - 0.02)
        lo["bakelight"] = True
        lo["kind"] = "downlight"
        c.objects.link(lo)
    ld = bpy.data.lights.new("skylight", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = sx1 - sx0, sz1 - sz0
    ld.energy = 220.0
    ld.color = (0.95, 0.97, 1.0)
    lo = bpy.data.objects.new("skylight", ld)
    lo.location = P((sx0 + sx1) / 2, (sz0 + sz1) / 2, H + SKY_UP - 0.01)
    lo["bakelight"] = True
    lo["kind"] = "skylight"
    c.objects.link(lo)
    # sun through the west window (day only): a low afternoon sun from the west-south-west
    ls = bpy.data.lights.new("sun_day", "SUN")
    ls.energy = 2.0
    ls.color = (1.0, 0.92, 0.80)
    ls.angle = math.radians(2.0)
    lo = bpy.data.objects.new("sun_day", ls)
    az, el = math.radians(258.0), math.radians(30.0)
    d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))).normalized()
    lo.rotation_mode = "QUATERNION"
    lo.rotation_quaternion = (-d).to_track_quat("-Z", "Y")
    lo["bakelight"] = True
    lo["kind"] = "sun"
    c.objects.link(lo)


def slats(c):
    """Oak louvres over the family lounge (hung 0.5 m under the ceiling)."""
    mb = MB()
    for i in range(24):
        x = X0 + 0.45 + i * 0.17
        rb(mb, x, x + 0.06, 1.2, 5.55, H - 0.62, H - 0.5, "LM_oak", r=0.006, seg=1, grain=(0, 1, 0))
    for zz in (1.3, 3.4, 5.45):
        rb(mb, X0 + 0.3, X0 + 0.45 + 23 * 0.17 + 0.1, zz, zz + 0.05, H - 0.5, H, "LM_oak", r=0.004, seg=1, uv=None, tint=WALNUT)
    setcat(mb.finish("lounge_slats", c), "lm", 1.0)


# ------------------------------------------------------------------------------------------ cubby banks --

def cubby_unit(c, fx, inst_c, w):
    """One bank (layout.json cubbyWalls): frame strips, per-cubby interiors, plinth, bulkhead, end panel, cornice and
    zone plaque; LED strips as instances; one area light per LED row for the bake; glass doors for the east bank."""
    rows, cols, cell, fr, depth, ud, pl = w["rows"], w["cols"], w["cell"], w["frame"], w["depth"], w["unitDepth"], w["plinth"]
    sx, sz = w["start"]["x"], w["start"]["z"]
    ax, az = w["along"]["x"], w["along"]["z"]
    yaw = w["yaw"]
    bank = w["bank"]
    fx_, fz_ = math.sin(yaw), math.cos(yaw)
    pitch = cell + fr
    run = cols * pitch + fr
    top = pl + rows * pitch + fr
    m = "LM_lacquer" if w["finish"] == "lacquer" else "LM_oak"
    A = (ax, az, 0)
    UP = (0, 0, 1)

    def p(u, d, y):
        return (sx + ax * u - fx_ * d, sz + az * u - fz_ * d, y)

    def hint_along(sign):
        return (ax * sign, az * sign, 0)

    out_n = (fx_, fz_, 0)
    mb = MB()
    # The front frame as ONE welded grid (round 6 review: dark dotted seams on bank A's dividers). The row strips are split
    # at every column line so the dividers share their corners: smart_project then unwraps the whole front as one planar
    # island, with no island edges (and no bleeding margins) along the dividers.
    us = [c_ * pitch for c_ in range(cols + 1)]
    for r in range(rows + 1):
        y0 = pl + r * pitch
        if w["finish"] != "lacquer" or r in (0, rows):
            # whole row strips for the oak bank (E: its seams sit behind the glass doors' frames) and for the bottom and top
            # strips (their own long islands): the 60k triangle budget
            gface(mb, [p(0, 0, y0), p(run, 0, y0), p(run, 0, y0 + fr), p(0, 0, y0 + fr)], m, A, 1.0, out_n)
            continue
        for c_ in range(cols + 1):
            ua = us[c_]
            gface(mb, [p(ua, 0, y0), p(ua + fr, 0, y0), p(ua + fr, 0, y0 + fr), p(ua, 0, y0 + fr)], m, A, 1.0, out_n)
            if c_ < cols:
                gface(mb, [p(ua + fr, 0, y0), p(us[c_ + 1], 0, y0), p(us[c_ + 1], 0, y0 + fr), p(ua + fr, 0, y0 + fr)], m, A, 1.0, out_n)
    for col_ in range(cols + 1):
        u0 = us[col_]
        for r in range(rows):
            y0 = pl + fr + r * pitch
            gface(mb, [p(u0, 0, y0), p(u0 + fr, 0, y0), p(u0 + fr, 0, pl + (r + 1) * pitch), p(u0, 0, pl + (r + 1) * pitch)], m, UP, 1.0, out_n)
    # The cubby interiors. White lacquer banks (A, B): their own object with ONE shared light texture (bake_cubby.py bakes a
    # representative cubby, day and night, into T_m_cubby_in.png; every cubby maps its five faces onto the same cross layout)
    # instead of 368 x 5 tiny islands in the hall's light map, which showed brown blotches and blur in the close-up.
    shared = w["finish"] == "lacquer"
    mbi = MB() if shared else mb
    probe_rc = (3, cols // 2) if bank == "A" else None
    for r in range(rows):
        y0 = pl + fr + r * pitch
        y1 = y0 + cell
        for col_ in range(cols):
            u0 = fr + col_ * pitch
            u1 = u0 + cell
            if shared:
                cubby_interior(mbi, p, u0, u1, y0, y1, depth, out_n, hint_along)
                if probe_rc == (r, col_):
                    mbp = MB()
                    cubby_interior(mbp, p, u0, u1, y0, y1, depth, out_n, hint_along)
                    po = mbp.finish("cubby_probe", c, auto=False)
                    setcat(po, "probe")
                    po.hide_render = True
                continue
            gface(mb, [p(u0, 0, y0), p(u1, 0, y0), p(u1, depth, y0), p(u0, depth, y0)], m, A, 1.0, UP)
            gface(mb, [p(u0, 0, y1), p(u1, 0, y1), p(u1, depth, y1), p(u0, depth, y1)], m, A, 1.0, (0, 0, -1))
            gface(mb, [p(u0, 0, y0), p(u0, depth, y0), p(u0, depth, y1), p(u0, 0, y1)], m, UP, 1.0, hint_along(1))
            gface(mb, [p(u1, 0, y0), p(u1, depth, y0), p(u1, depth, y1), p(u1, 0, y1)], m, UP, 1.0, hint_along(-1))
            gface(mb, [p(u0, depth, y0), p(u1, depth, y0), p(u1, depth, y1), p(u0, depth, y1)], m, A, 1.0, out_n)
    if shared:
        io = mbi.finish(f"cubby_in_{bank}", c, auto=False)
        setcat(io, "nonlm")
        io["cubby_in"] = True
    kick = 0.03
    gface(mb, [p(0, kick, 0), p(run, kick, 0), p(run, kick, pl), p(0, kick, pl)], m, A, 1.0, out_n)
    gface(mb, [p(0, 0, pl), p(run, 0, pl), p(run, kick, pl), p(0, kick, pl)], m, A, 1.0, (0, 0, -1))
    # visible end panels: the east bank's south end; banks A/B's ends facing the niche; B's end by the corner is hidden
    if bank == "E":
        gface(mb, [p(run, 0, 0), p(run, ud, 0), p(run, ud, top), p(run, 0, top)], m, UP, 1.0, hint_along(1))
    if bank == "A":
        gface(mb, [p(run, 0, 0), p(run, ud, 0), p(run, ud, top), p(run, 0, top)], m, UP, 1.0, hint_along(1))
    if bank == "B":
        gface(mb, [p(0, 0, 0), p(0, ud, 0), p(0, ud, top), p(0, 0, top)], m, UP, 1.0, hint_along(-1))
    # cornice (oak) along the top
    gbox_p = lambda u0, u1, d0, d1, y0, y1: gface_box(mb, p, u0, u1, d0, d1, y0, y1, "LM_oak", out_n, A)
    gbox_p(-0.02, run + 0.02, -0.025, ud, top, top + 0.06)
    unit = mb.finish(f"cubby_{bank}", c, auto=False)
    setcat(unit, "lm", 1.9)

    # bulkhead from the cornice to the ceiling, flush with the opening plane; fillers at the room's ends
    mb = MB()
    if bank == "A":
        gface(mb, [(X0, sz, top + 0.06), (sx + run, sz, top + 0.06), (sx + run, sz, H), (X0, sz, H)], "LM_plaster", hint=out_n)
        gface(mb, [(X0, sz, 0), (sx, sz, 0), (sx, sz, top + 0.06), (X0, sz, top + 0.06)], "LM_lacquer", grain=UP, hint=out_n)
    elif bank == "B":
        gface(mb, [(sx, sz, top + 0.06), (X1, sz, top + 0.06), (X1, sz, H), (sx, sz, H)], "LM_plaster", hint=out_n)
    else:
        gface(mb, [p(0, 0, top + 0.06), p(run, 0, top + 0.06), p(run, 0, H), p(0, 0, H)], "LM_plaster", hint=out_n)
        gface(mb, [p(run, 0, top + 0.06), p(run, ud, top + 0.06), p(run, ud, H), p(run, 0, H)], "LM_plaster", hint=hint_along(1))
    bh = mb.finish(f"bulkhead_{bank}", c)
    setcat(bh, "lm", 0.7)

    # zone plaque on the bulkhead (above the cornice)
    mb = MB()
    mid_u = run / 2
    if bank in ("A", "B"):
        a = (sx + mid_u - 0.26, sz - 0.004)
        b = (sx + mid_u + 0.26, sz - 0.004)
        a = (a[0], sz + 0.004)
        b = (b[0], sz + 0.004)
        plaque(mb, "zone_a" if bank == "A" else "zone_b", a, b, top + 0.14, top + 0.14 + 0.16, (0, 1, 0))
    else:
        a = (sx - 0.004, sz + mid_u - 0.26)
        b = (sx - 0.004, sz + mid_u + 0.26)
        plaque(mb, "zone_e", a, b, top + 0.14, top + 0.30, (-1, 0, 0))
    setcat(mb.finish(f"plaque_{bank}", c), "lm", 1.2)

    # LED strips: one mesh along local x, linked duplicates under inst__led_<bank>
    me = bpy.data.meshes.get("led_strip")
    if me is None:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(cell * 0.9, 0.012, 0.006), verts=bm.verts)
        me = bpy.data.meshes.new("led_strip")
        bm.to_mesh(me)
        bm.free()
        uv = me.uv_layers.new(name="UVMap")
        for d_ in uv.data:
            d_.uv = (0.5, 0.5)
        me.materials.append(U.mat("M_lamp"))
    root = bpy.data.objects.new(f"inst__led_{bank}", None)
    root["cat"] = "inst_root"
    inst_c.objects.link(root)
    rot = math.atan2(-az, ax)
    for r in range(rows):
        y1 = pl + fr + r * pitch + cell
        for col_ in range(cols):
            u = fr + col_ * pitch + cell / 2
            ob = bpy.data.objects.new(f"led_{bank}_{r}_{col_}", me)
            gx, gz, gy = p(u, 0.035, y1 - 0.003)
            ob.location = V(gx, gz, gy)
            ob.rotation_euler = (0, 0, rot)
            ob.parent = root
            ob["cat"] = "inst"
            inst_c.objects.link(ob)
    for r in range(rows):
        y1 = pl + fr + r * pitch + cell
        ld = bpy.data.lights.new(f"ledrow_{bank}_{r}", "AREA")
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = run - 2 * fr, 0.012
        ld.energy = 1.1 * run
        ld.color = (1.0, 0.86, 0.70)
        lo = bpy.data.objects.new(ld.name, ld)
        gx, gz, gy = p(run / 2, 0.035, y1 - 0.007)
        lo.location = V(gx, gz, gy)
        lo.rotation_euler = (0, 0, rot)
        lo["bakelight"] = True
        lo["kind"] = "led"
        c.objects.link(lo)

    # glass doors with brass handles (east bank): one pane per cubby, 4 mm in front of the opening
    if bank == "E":
        mbg = MB()
        mbh = MB()
        mbf = MB()      # the door frames: flat aluminium, not light-mapped (576 hair-thin boxes would get black islands)
        for r in range(rows):
            y0 = pl + fr + r * pitch
            for col_ in range(cols):
                u0 = fr + col_ * pitch
                u1 = u0 + cell
                gface(mbg, [p(u0 + 0.004, -0.006, y0 + 0.004), p(u1 - 0.004, -0.006, y0 + 0.004), p(u1 - 0.004, -0.006, y0 + cell - 0.004),
                            p(u0 + 0.004, -0.006, y0 + cell - 0.004)], "M_glass_e", hint=out_n, uv=(0.5, 0.5))
                # round 5 (reference fourpaws_hall_store01_glassdoor): a thin 9 mm light frame and a small brass pull
                hu = u1 - 0.035
                fw = 0.009
                for (fa, fb, fc, fd) in ((u0, u1, y0, y0 + fw), (u0, u1, y0 + cell - fw, y0 + cell),
                                         (u0, u0 + fw, y0, y0 + cell), (u1 - fw, u1, y0, y0 + cell)):
                    gface_box(mbf, p, fa, fb, -0.012, -0.002, fc, fd, "M_alu", out_n, A, uv=(0.5, 0.5))
                gface_box(mbh, p, hu - 0.005, hu + 0.005, -0.02, -0.004, y0 + cell / 2 - 0.022, y0 + cell / 2 + 0.022, "LM_atlas",
                          out_n, A, uv=acell("brass"))
        go = mbg.finish("east_glass", fx, auto=False)
        setcat(go, "nonlm")
        go["glass"] = True
        fo = mbf.finish("east_frames", fx, auto=False)
        setcat(fo, "nonlm")
        ho = mbh.finish("east_handles", c, auto=False)
        setcat(ho, "lm", 1.4)
    return unit


# The shared cubby-interior texture (T_m_cubby_in.png, bake_cubby.py): a cross layout of the five faces of one cubby in
# the DAY half (u 0..0.5) of the texture; the night bake fills the same layout in the right half, and the game blends
# the two (hallNight.ts patchHallCubbyMaterial). Padded so mip levels never mix the halves.
CUBBY_U0, CUBBY_US = 0.01, 0.48
CUBBY_V0, CUBBY_VS = 0.02, 0.96


def cubby_uv(face, s, t, r):
    """(s across the cubby along the run, t into it 0 front .. 1 back, r up 0..1) -> the shared texture's (u, v)."""
    if face == "floor":
        u, v = 0.25 + 0.5 * s, 0.25 * t
    elif face == "ceil":
        u, v = 0.25 + 0.5 * s, 1 - 0.25 * t
    elif face == "left":
        u, v = 0.25 * t, 0.25 + 0.5 * r
    elif face == "right":
        u, v = 1 - 0.25 * t, 0.25 + 0.5 * r
    else:
        u, v = 0.25 + 0.5 * s, 0.25 + 0.5 * r
    return (CUBBY_U0 + u * CUBBY_US, CUBBY_V0 + v * CUBBY_VS)


def cubby_interior(mb, p, u0, u1, y0, y1, depth, out_n, hint_along, m="M_cubby_in"):
    """The five inner faces of one cubby (floor, ceiling, both sides, back) with the shared cross UVs."""
    cu, cy = u1 - u0, y1 - y0

    def f(face, corners, hint):
        pts = [V(*p(*q)) for q in corners]
        uvs = [cubby_uv(face, (q[0] - u0) / cu, q[1] / depth, (q[2] - y0) / cy) for q in corners]
        h = V(hint[0], hint[1], hint[2]) - V(0, 0, 0)
        mb.face(pts, m, uvs, hint=h)

    f("floor", [(u0, 0, y0), (u1, 0, y0), (u1, depth, y0), (u0, depth, y0)], (0, 0, 1))
    f("ceil", [(u0, 0, y1), (u1, 0, y1), (u1, depth, y1), (u0, depth, y1)], (0, 0, -1))
    f("left", [(u0, 0, y0), (u0, depth, y0), (u0, depth, y1), (u0, 0, y1)], hint_along(1))
    f("right", [(u1, 0, y0), (u1, depth, y0), (u1, depth, y1), (u1, 0, y1)], hint_along(-1))
    f("back", [(u0, depth, y0), (u1, depth, y0), (u1, depth, y1), (u0, depth, y1)], out_n)


def gface_box(mb, p, u0, u1, d0, d1, y0, y1, m, out_n, A, uv=None):
    """A box in a bank's frame (u along the run, d behind the opening plane, y up): five faces (no back) turned to the room."""
    def face(pts, hint):
        return gface(mb, [p(*q) for q in pts], m, grain=None if uv is not None else A, hint=hint, uv=uv)
    # front (toward the room): d = d0 plane (smaller d is nearer the room)
    face([(u0, d0, y0), (u1, d0, y0), (u1, d0, y1), (u0, d0, y1)], out_n)
    face([(u0, d0, y1), (u1, d0, y1), (u1, d1, y1), (u0, d1, y1)], (0, 0, 1))
    face([(u0, d0, y0), (u1, d0, y0), (u1, d1, y0), (u0, d1, y0)], (0, 0, -1))
    ax_, az_ = A[0], A[1]
    face([(u0, d0, y0), (u0, d1, y0), (u0, d1, y1), (u0, d0, y1)], (-ax_, -az_, 0))
    face([(u1, d0, y0), (u1, d1, y0), (u1, d1, y1), (u1, d0, y1)], (ax_, az_, 0))


def anchors(c):
    for a in INN["cubbyAnchors"]:
        e = bpy.data.objects.new(a["node"], None)
        e.empty_display_type = "SINGLE_ARROW"
        e.empty_display_size = 0.1
        e.location = V(a["x"], a["z"], a["y"])
        e.rotation_euler = (0, 0, a["yaw"])
        e["cat"] = "anchor"
        c.objects.link(e)


# ------------------------------------------------------------------------------------------------ niche --

def arc_pts(cx, y0, r, n=24):
    return [(cx - r * math.cos(math.pi * i / n), y0 + r * math.sin(math.pi * i / n)) for i in range(n + 1)]


def niche(c, fx, cols_):
    """기억의 자리: an arched alcove between banks A and B. Spandrel with the arch cut out, the arch's soffit, an oak
    slat back wall, a walnut altar with a big framed picture, white chrysanthemums, LED candles, vases, a kneeling step."""
    x0, x1 = NICHE["minX"], NICHE["maxX"]
    zf, zb = NICHE["frontZ"], NICHE["backZ"]
    spring, r = NICHE["spring"], NICHE["radius"]
    top = BANK_TOP
    mb = MB()
    pts = arc_pts(NICHE_C, spring, r, 28)       # left end -> right end (over the top)
    outline = [(x0, spring)] + pts + [(x1, spring), (x1, top), (x0, top)]
    gface(mb, [(x, zf, y) for (x, y) in outline], "LM_lacquer", grain=(1, 0, 0), hint=(0, 1, 0))
    # the arch's soffit (inside of the vault), facing down/in
    for i in range(len(pts) - 1):
        (xa, ya), (xb, yb) = pts[i], pts[i + 1]
        mx, my = (xa + xb) / 2, (ya + yb) / 2
        hint = (NICHE_C - mx, 0, spring - my)
        gface(mb, [(xa, zf, ya), (xb, zf, yb), (xb, zb, yb), (xa, zb, ya)], "LM_lacquer", grain=(1, 0, 0), hint=hint)
    # the niche's back wall above the oak slats' top: plaster; side returns of the pocket come from the banks' end panels
    gface(mb, [(x0, zb, 0), (x1, zb, 0), (x1, zb, spring), (x0, zb, spring)], "LM_oak", grain=(0, 0, 1), hint=(0, 1, 0), tint=(0.78, 0.68, 0.6, 1))
    gface(mb, [(x, zb, y) for (x, y) in [(x0, spring)] + pts + [(x1, spring)]], "LM_plaster", hint=(0, 1, 0))
    # floor of the pocket (oak) and a lower return at the niche cornice
    gface(mb, [(x0, zb, 0.004), (x1, zb, 0.004), (x1, zf, 0.004), (x0, zf, 0.004)], "LM_oak", grain=(1, 0, 0), hint=(0, 0, 1), tint=(0.85, 0.8, 0.75, 1))
    # niche plaque
    # cornice across the niche (like the banks') and the bulkhead above it with the sign
    gface_box(mb, lambda u, d, y: (x0 + u, zf - d, y), 0.0 - 0.02, (x1 - x0) + 0.02, -0.025, 0.39, BANK_TOP, BANK_TOP + 0.06, "LM_oak", (0, 1, 0),
              (1, 0, 0))
    gface(mb, [(x0, zf, BANK_TOP + 0.06), (x1, zf, BANK_TOP + 0.06), (x1, zf, H), (x0, zf, H)], "LM_plaster", hint=(0, 1, 0))
    plaque(mb, "niche", (NICHE_C - 0.5, zf + 0.004), (NICHE_C + 0.5, zf + 0.004), BANK_TOP + 0.24, BANK_TOP + 0.24 + 1.0 * 200 / 1024, (0, 1, 0))
    o = mb.finish("niche_arch", c)
    setcat(o, "lm", 1.1)
    # vertical oak slats on the back wall
    mb = MB()
    n = 16
    for i in range(n):
        xs = x0 + 0.09 + i * (x1 - x0 - 0.18) / (n - 1)
        rb(mb, xs - 0.025, xs + 0.025, zb + 0.0, zb + 0.07, 0.0, spring + 0.45, "LM_oak", r=0.006, seg=1, grain=(0, 0, 1), tint=(0.72, 0.62, 0.52, 1))
    o = mb.finish("niche_slats", c)
    setcat(o, "lm", 1.2)
    # plaque over the arch
    mb = MB()
    setcat(mb.finish("niche_sign_pad", c), "lm", 1.0) if len(mb.bm.faces) else None

    # ---- altar
    mb = MB()
    ac = NICHE_C
    z_a0, z_a1 = zb + 0.12, zb + 0.62        # console depth: -5.88 .. -5.38
    rb(mb, ac - 1.0, ac + 1.0, z_a0, z_a1, 0.0, 0.78, "LM_oak", r=0.012, grain=(1, 0, 0), tint=WALNUT)
    rb(mb, ac - 1.04, ac + 1.04, z_a0 - 0.04, z_a1 + 0.04, 0.78, 0.82, "LM_oak", r=0.008, grain=(1, 0, 0), tint=(0.8, 0.7, 0.62, 1))
    # big frame with the picture
    fz = zb + 0.38
    rb(mb, ac - 0.36, ac + 0.36, fz, fz + 0.045, 0.84, 1.74, "LM_oak", r=0.012, grain=(0, 0, 1), tint=WALNUT)
    gface(mb, [(ac - 0.30, fz - 0.002, 0.90), (ac + 0.30, fz - 0.002, 0.90), (ac + 0.30, fz - 0.002, 1.68), (ac - 0.30, fz - 0.002, 1.68)],
          "LM_atlas", hint=(0, 1, 0), uv=acell("photo_warm"))
    # easel foot
    gbox(mb, ac - 0.03, ac + 0.03, fz + 0.045, fz + 0.2, 0.82, 0.86, "LM_atlas", uv=acell("walnut"))
    # white chrysanthemums on a tray
    rng = random.Random(11)
    rb(mb, ac - 0.62, ac + 0.62, z_a1 - 0.2, z_a1 - 0.02, 0.82, 0.845, "LM_atlas", r=0.01, uv=acell("porcelain"))
    for k in range(13):
        flower_head(mb, ac - 0.55 + k * 0.092 + rng.uniform(-0.01, 0.01), z_a1 - 0.11 + rng.uniform(-0.03, 0.03), 0.87,
                    rng.uniform(0.036, 0.048), "LM_atlas", acell("chrysanthemum"), rng)
    # vases with white lilies
    for s in (-1, 1):
        vx = ac + s * 0.8
        lathe(mb, vx, z_a0 + 0.2, 0.82, [(0.0, 0.0), (0.055, 0.0), (0.065, 0.04), (0.06, 0.22), (0.05, 0.26), (0.0, 0.26)], "LM_atlas",
              segs=18, uv=acell("vase_glass"))
        for k in range(7):
            a = k * 0.9
            flower_head(mb, vx + 0.05 * math.cos(a), z_a0 + 0.2 + 0.05 * math.sin(a), 1.1 + 0.06 * (k % 3), 0.04, "LM_atlas", acell("flower_white"), rng)
    # LED candles with flames
    flames = MB()
    for (cx_, cz_, hh) in ((ac - 0.42, z_a0 + 0.34, 0.1), (ac - 0.3, z_a0 + 0.38, 0.14), (ac + 0.3, z_a0 + 0.38, 0.14), (ac + 0.42, z_a0 + 0.34, 0.1)):
        lathe(mb, cx_, cz_, 0.82, [(0.0, 0.0), (0.03, 0.0), (0.03, hh), (0.025, hh + 0.004), (0.0, hh)], "LM_atlas", segs=14, uv=acell("paper"))
        lathe(flames, cx_, cz_, 0.82 + hh, [(0.0, 0.0), (0.006, 0.006), (0.007, 0.014), (0.0, 0.03)], "M_lamp", segs=8, uv=(0.5, 0.5))
    # kneeling step
    rb(mb, ac - 0.7, ac + 0.7, z_a1 + 0.35, z_a1 + 0.7, 0.0, 0.1, "LM_oak", r=0.012, grain=(1, 0, 0))
    o = mb.finish("altar", c)
    setcat(o, "lm", 1.7)
    f = flames.finish("altar_flames", fx, auto=False)
    setcat(f, "nonlm")
    col("niche", x0, x1, zb, z_a1 + 0.05, H)
    # light: a warm spot on the altar and the picture
    ld = bpy.data.lights.new("niche_spot", "SPOT")
    ld.energy = 110.0
    ld.color = (1.0, 0.86, 0.68)
    ld.spot_size = math.radians(75)
    ld.spot_blend = 0.6
    ld.shadow_soft_size = 0.08
    lo = bpy.data.objects.new("niche_spot", ld)
    lo.location = P(ac, zf + 0.6, 3.4)
    lo.rotation_mode = "QUATERNION"
    lo.rotation_quaternion = (P(ac, zb + 0.4, 1.0) - P(ac, zf + 0.6, 3.4)).to_track_quat("-Z", "Y")
    lo["bakelight"] = True
    lo["kind"] = "niche"
    c.objects.link(lo)


# --------------------------------------------------------------------------------------------- furniture --

def bench(c, name, cx, cz, length, along="x", seat_ids=None):
    """Oak bench, seat top 0.45, 0.42 deep, two slab legs. along = the run direction (x or z); seats from either side."""
    mb = MB()
    if along == "x":
        rb(mb, cx - length / 2, cx + length / 2, cz - 0.21, cz + 0.21, 0.40, 0.45, "LM_oak", r=0.012, grain=(1, 0, 0))
        for s in (-1, 1):
            rb(mb, cx + s * (length / 2 - 0.22) - 0.035, cx + s * (length / 2 - 0.22) + 0.035, cz - 0.18, cz + 0.18, 0.0, 0.40, "LM_oak",
               r=0.008, grain=(0, 0, 1), tint=WALNUT)
        rb(mb, cx - length / 2 + 0.25, cx + length / 2 - 0.25, cz - 0.03, cz + 0.03, 0.12, 0.17, "LM_oak", r=0.006, seg=1, tint=WALNUT)
        col(f"col__{name}", cx - length / 2, cx + length / 2, cz - 0.21, cz + 0.21, 0.45)
        off = benchSeatOffsets(length)
        for k, d in enumerate(off):
            # facing north (yaw pi) is "the front"; a sitter can come from either side
            seat(f"{name}_s{k}", "bench", "backless", cx + d, cz, 0.45, math.pi, 0.21, width=1.0, both=True)
    else:
        rb(mb, cx - 0.21, cx + 0.21, cz - length / 2, cz + length / 2, 0.40, 0.45, "LM_oak", r=0.012, grain=(0, 1, 0))
        for s in (-1, 1):
            rb(mb, cx - 0.18, cx + 0.18, cz + s * (length / 2 - 0.22) - 0.035, cz + s * (length / 2 - 0.22) + 0.035, 0.0, 0.40, "LM_oak",
               r=0.008, grain=(0, 0, 1), tint=WALNUT)
        rb(mb, cx - 0.03, cx + 0.03, cz - length / 2 + 0.25, cz + length / 2 - 0.25, 0.12, 0.17, "LM_oak", r=0.006, seg=1, tint=WALNUT)
        col(f"col__{name}", cx - 0.21, cx + 0.21, cz - length / 2, cz + length / 2, 0.45)
        for k, d in enumerate(benchSeatOffsets(length)):
            seat(f"{name}_s{k}", "bench", "backless", cx, cz + d, 0.45, math.pi / 2, 0.21, width=1.0, both=True)
    o = mb.finish(name, c)
    setcat(o, "lm", 1.6)


def benchSeatOffsets(length):
    d = round(min(0.6, length / 2 - 0.35), 3)
    return [-d, d]


def chair_basic(mb, cx, cz, facing, sid, seat_tint=CREAM, backed=True, exit_turn=0.0):
    """A dining-style chair: seat 0.46, oak legs, a backrest on the side away from `facing` ((dx, dz) unit)."""
    dx, dz = facing
    s = 0.23
    rb(mb, cx - s, cx + s, cz - s, cz + s, 0.42, 0.47, "LM_fabric", r=0.015, tint=seat_tint)
    for (a, b) in ((-0.19, -0.19), (0.19, -0.19), (-0.19, 0.19), (0.19, 0.19)):
        gbox(mb, cx + a - 0.02, cx + a + 0.02, cz + b - 0.02, cz + b + 0.02, 0, 0.42, "LM_oak", grain=(0, 0, 1))
    bx, bz = cx - dx * 0.21, cz - dz * 0.21
    if dx == 0:
        rb(mb, cx - 0.22, cx + 0.22, bz - 0.02, bz + 0.02, 0.5, 0.92, "LM_oak", r=0.01, grain=(1, 0, 0))
        back_face = (cz - dz * 0.23)            # z of the backrest's front face... (the seat's rear edge)
    else:
        rb(mb, bx - 0.02, bx + 0.02, cz - 0.22, cz + 0.22, 0.5, 0.92, "LM_oak", r=0.01, grain=(0, 1, 0))
    yaw = math.atan2(dx, dz)
    seat(sid, "chair", "backed", cx, cz, 0.47, yaw, 0.23, back=0.23 - 0.0, width=0.46, exit_turn=exit_turn, lean=0.1)
    col(f"col__{sid}", cx - s, cx + s, cz - s, cz + s, 0.5)


def sofa_cushion_box(mb, x0, x1, z0, z1, y0, y1, tint, r=0.045):
    rb(mb, x0, x1, z0, z1, y0, y1, "LM_fabric", r=r, seg=3, squash=0.012, tint=tint)


def lounge(c, cols_):
    """Family lounge (south-west): an L-shaped fabric sofa (a 3.85 m run against the south wall, a 2 m return under the
    window), two armchairs round a low oak table, a rug, a framed picture on a sage wall, a floor lamp, plants."""
    leg = acell("walnut")
    mb = MB()
    seatH = 0.43
    # --- long run (back at the south wall, sitters face north): x 292.7..296.55, z 5.0..5.95
    xs0, xs1 = X0 + 0.2, 296.55
    zb0, zb1 = 5.73, 5.95            # backrest (0.22 thick), its front face at z = 5.73
    zs_front = 5.11                  # the seat cushions' front edge
    rb(mb, xs0, xs1, zs_front, zb1, 0.10, 0.30, "LM_fabric", r=0.03, tint=SOFA)                                  # base
    rb(mb, xs0, xs1, zb0, zb1, 0.30, 0.86, "LM_fabric", r=0.07, seg=3, tint=SOFA)                                 # back
    for (a, b) in ((xs0, xs0 + 0.2), (xs1 - 0.2, xs1)):
        rb(mb, a, b, zs_front, zb1, 0.30, 0.62, "LM_fabric", r=0.06, seg=3, tint=SOFA)                          # arms
    nseat = 2
    sx0 = xs0 + 0.2
    sx1 = xs1 - 0.2
    cw = (sx1 - sx0) / nseat
    # the corner cell (x 292.9..293.54) belongs to the short return's front end: a cushion, no seat. The three seats share the rest.
    corner_x1 = xs0 + 0.2 + 0.64
    sofa_cushion_box(mb, sx0 + 0.008, corner_x1 - 0.008, zs_front + 0.0, zb0, 0.30, seatH, SOFA)
    sofa_cushion_box(mb, sx0 + 0.03, corner_x1 - 0.03, zb0 - 0.17, zb0 + 0.005, 0.40, 0.76, SOFA, r=0.06)
    cw = (sx1 - corner_x1) / nseat
    sofa_dz = 0.07                    # sitters sit back into the cushion: the seat point is this far behind the cushion's middle
    for i in range(nseat):
        cx0 = corner_x1 + i * cw
        sofa_cushion_box(mb, cx0 + 0.008, cx0 + cw - 0.008, zs_front + 0.0, zb0, 0.30, seatH, SOFA)
        sofa_cushion_box(mb, cx0 + 0.03, cx0 + cw - 0.03, zb0 - 0.17, zb0 + 0.005, 0.40, 0.76, SOFA, r=0.06)
        seat(f"sofa_a{i}", "sofa", "backed", cx0 + cw / 2, (zs_front + zb0) / 2 + sofa_dz, seatH, math.pi, (zb0 - zs_front) / 2 + sofa_dz,
             back=(zb0 - zs_front) / 2 - sofa_dz, width=cw, lean=0.26)
    # --- short return (back at the west wall, sitters face east): x 292.7..293.54, z 3.1..5.11
    xr_b0, xr_b1 = xs0, xs0 + 0.22     # backrest x 292.7..292.92
    xr_f = xr_b1 + 0.62               # seat front edge x = 293.54
    zr0 = 3.1
    rb(mb, xs0, xr_f, zr0, zs_front, 0.10, 0.30, "LM_fabric", r=0.03, tint=SOFA)
    rb(mb, xr_b0, xr_b1, zr0, zs_front + 0.0, 0.30, 0.86, "LM_fabric", r=0.07, seg=3, tint=SOFA)
    rb(mb, xr_b1, xr_f, zr0, zr0 + 0.2, 0.30, 0.62, "LM_fabric", r=0.06, seg=3, tint=SOFA)                    # the north arm
    sofa_cushion_box(mb, xr_b1, xr_f, zr0 + 0.2, zs_front, 0.30, seatH, SOFA)
    sofa_cushion_box(mb, xr_b1 - 0.005, xr_b1 + 0.17, zr0 + 0.25, zs_front - 0.06, 0.40, 0.76, SOFA, r=0.06)
    seat("sofa_b0", "sofa", "backed", (xr_b1 + xr_f) / 2 - 0.07, 3.9, seatH, math.pi / 2,
         (xr_f - xr_b1) / 2 + 0.07, back=(xr_f - xr_b1) / 2 - 0.07, width=1.15, lean=0.26)
    # throw pillows / blanket
    rb(mb, 293.1, 293.5, 5.55, 5.7, 0.43, 0.82, "LM_fabric", r=0.07, seg=3, tint=SAGE_CUSH, yaw=0.15)
    rb(mb, 295.55, 295.95, 5.55, 5.7, 0.43, 0.82, "LM_fabric", r=0.07, seg=3, tint=CLAY, yaw=-0.15)
    rb(mb, 293.0, 293.4, 3.6, 3.75, 0.43, 0.8, "LM_fabric", r=0.07, seg=3, tint=CLAY, yaw=1.45)
    rb(mb, 294.2, 295.2, 5.15, 5.55, 0.43, 0.46, "LM_fabric", r=0.02, seg=2, tint=SAGE_CUSH, yaw=0.2)    # folded blanket
    # legs
    for (x, z) in ((xs0 + 0.08, zs_front + 0.08), (xs1 - 0.08, zs_front + 0.08), (xs0 + 0.08, zb1 - 0.08), (xs1 - 0.08, zb1 - 0.08),
                   (xs0 + 0.08, zr0 + 0.08), (xr_f - 0.08, zr0 + 0.08)):
        gbox(mb, x - 0.025, x + 0.025, z - 0.025, z + 0.025, 0, 0.10, "LM_atlas", uv=leg, faces={"n", "s", "e", "w"})
    # rug
    rb(mb, 293.2, 297.4, 2.7, 5.1, 0.0, 0.012, "LM_fabric", r=0.004, seg=1, tint=RUG_C)
    o = mb.finish("lounge_sofa", c)
    setcat(o, "lm", 1.25)
    col("col__sofa_long", xs0, xs1, zs_front - 0.02, zb1, 0.8)
    col("col__sofa_short", xs0, xr_f, zr0, zs_front, 0.8)

    # --- coffee table (round, oak) at (294.95, 4.05)
    tx, tz = 295.2, 3.75
    mb = MB()
    lathe(mb, tx, tz, 0.0, [(0.0, 0.0), (0.16, 0.0), (0.16, 0.012), (0.05, 0.03), (0.05, 0.34), (0.31, 0.34), (0.315, 0.355), (0.31, 0.37), (0.0, 0.37)],
          "LM_oak", segs=40, grain=(1, 0, 0))
    rb(mb, tx - 0.16, tx - 0.03, tz - 0.12, tz + 0.04, 0.37, 0.46, "LM_atlas", r=0.01, uv=acell("white"), yaw=0.3)               # tissue box
    for k, (a, b) in enumerate(((0.15, 0.05), (0.1, -0.15))):
        lathe(mb, tx + a, tz + b, 0.37, [(0.0, 0.0), (0.04, 0.0), (0.04, 0.09), (0.0, 0.09)], "LM_atlas", segs=14, uv=acell("porcelain"))
    setcat(mb.finish("lounge_table", c), "lm", 1.4)
    col("col__coffee_table", tx - 0.32, tx + 0.32, tz - 0.32, tz + 0.32, 0.4)

    # --- two lounge armchairs flanking the table, facing south (toward the sofa): back at the north
    mb = MB()
    for k, ax_c in enumerate((294.0, 296.2)):
        x0_, x1_ = ax_c - 0.42, ax_c + 0.42
        zb_0, zb_1 = 1.6, 1.8          # backrest z 1.6..1.8 (front face at 1.8)
        zf_ = 2.38                     # seat front edge
        rb(mb, x0_, x1_, zb_0, zf_, 0.12, 0.30, "LM_fabric", r=0.03, tint=CREAM)
        rb(mb, x0_, x1_, zb_0, zb_1, 0.30, 0.92, "LM_fabric", r=0.08, seg=3, tint=CREAM)
        for (a, b) in ((x0_, x0_ + 0.14), (x1_ - 0.14, x1_)):
            rb(mb, a, b, zb_0, zf_, 0.30, 0.62, "LM_fabric", r=0.05, seg=3, tint=CREAM)
        sofa_cushion_box(mb, x0_ + 0.14, x1_ - 0.14, zb_1, zf_, 0.30, 0.43, CREAM, r=0.045)
        sofa_cushion_box(mb, x0_ + 0.17, x1_ - 0.17, zb_1 - 0.13, zb_1 + 0.005, 0.42, 0.78, CREAM, r=0.06)
        for (a, b) in ((x0_ + 0.07, zb_0 + 0.07), (x1_ - 0.07, zb_0 + 0.07), (x0_ + 0.07, zf_ - 0.07), (x1_ - 0.07, zf_ - 0.07)):
            gbox(mb, a - 0.022, a + 0.022, b - 0.022, b + 0.022, 0, 0.12, "LM_atlas", uv=leg, faces={"n", "s", "e", "w"})
        seat(f"armchair_{k}", "armchair", "backed", ax_c, (zb_1 + zf_) / 2 - 0.06, 0.43, 0.0, (zf_ - zb_1) / 2 + 0.06, back=(zf_ - zb_1) / 2 - 0.06,
             width=0.62, lean=0.26)
        col(f"col__armchair_{k}", x0_, x1_, zb_0, zf_, 0.9)
    setcat(mb.finish("lounge_chairs", c), "lm", 1.3)

    # --- sage wall behind the sofa, a framed picture, a floor lamp
    mb = MB()
    gface(mb, [(X0, Z1 - 0.004, 0), (296.6, Z1 - 0.004, 0), (296.6, Z1 - 0.004, 2.9), (X0, Z1 - 0.004, 2.9)], "LM_plaster", hint=(0, -1, 0), tint=SAGE)
    rb(mb, 293.9, 295.5, 5.93, 5.98, 1.3, 2.35, "LM_oak", r=0.008, seg=1, grain=(1, 0, 0), tint=WALNUT)
    setcat(mb.finish("lounge_wall", c), "lm", 1.0)
    mb = MB()
    mb.face([P(294.0, 5.925, 1.4), P(295.4, 5.925, 1.4), P(295.4, 5.925, 2.25), P(294.0, 5.925, 2.25)], "LM_painting",
            [(0, 0), (1, 0), (1, 1), (0, 1)], hint=V(0, -1, 0) - V(0, 0, 0))
    setcat(mb.finish("lounge_picture", c), "lm", 1.2)
    # floor lamp by the sofa's end
    mb = MB()
    lx, lz = 297.1, 3.6
    lathe(mb, lx, lz, 0.0, [(0.0, 0.0), (0.16, 0.0), (0.16, 0.02), (0.02, 0.03), (0.02, 1.35)], "LM_atlas", segs=20, uv=acell("brass"))
    lathe(mb, lx, lz, 1.3, [(0.0, 0.0), (0.18, 0.0), (0.21, 0.28), (0.0, 0.28)], "LM_atlas", segs=24, uv=acell("lamp_shade"))
    setcat(mb.finish("floor_lamp", c), "lm", 1.2)
    col("col__lamp", lx - 0.17, lx + 0.17, lz - 0.17, lz + 0.17, 1.6)
    ld = bpy.data.lights.new("lamp_pt", "POINT")
    ld.energy = 40.0
    ld.color = (1.0, 0.84, 0.62)
    ld.shadow_soft_size = 0.1
    lo = bpy.data.objects.new("lamp_pt", ld)
    lo.location = P(lx, lz, 1.4)
    lo["bakelight"] = True
    lo["kind"] = "lamp"
    c.objects.link(lo)


def plant(c, cols_, px, pz, name, seed=21, h=1.9, leaves=44):
    """A fiddle-leaf fig in a white ceramic planter."""
    rng = random.Random(seed)
    mb = MB()
    lathe(mb, px, pz, 0.0, [(0.0, 0.0), (0.2, 0.0), (0.23, 0.04), (0.26, 0.5), (0.24, 0.5), (0.22, 0.46), (0.0, 0.46)], "LM_atlas", segs=24,
          uv=acell("pot_white"))
    disc(mb, px, pz, 0.455, 0.22, "LM_atlas", segs=18, uv=acell("soil"))
    path = [V(px, pz, 0.45), V(px + 0.03, pz - 0.02, 1.0), V(px + 0.05, pz - 0.01, 1.5), V(px + 0.04, pz + 0.02, h)]
    for f in mb.tube(path, [0.022, 0.018, 0.014, 0.01], "LM_atlas", segs=6):
        if f is not None:
            for lp in f.loops:
                lp[mb.uv].uv = acell("stem")
    for k in range(leaves):
        t = 0.25 + 0.75 * (k / (leaves - 1)) ** 0.8
        y = 0.75 + (h - 0.7) * t
        ang = k * 2.4 + rng.uniform(-0.3, 0.3)
        out = 0.12 + 0.18 * (1 - abs(t - 0.55)) + rng.uniform(-0.04, 0.04)
        base = (px + 0.04 * t + 0.03 * math.cos(ang), pz + 0.03 * math.sin(ang), y)
        dx, dz = math.cos(ang), math.sin(ang)
        tilt = rng.uniform(0.15, 0.55)
        length = rng.uniform(0.2, 0.3)
        width = length * 0.62
        uvc = acell("leaf" if k % 3 else "leaf2")
        pts_l, pts_r, mid = [], [], []
        for j in range(6):
            s = j / 5
            ww = width * 0.5 * math.sin(math.pi * min(1.0, s * 1.05)) ** 0.8
            cx_ = base[0] + dx * (out * 0.3 + s * length) * math.cos(tilt)
            cz_ = base[1] + dz * (out * 0.3 + s * length) * math.cos(tilt)
            cy_ = base[2] + (s * length) * math.sin(tilt) - 0.06 * s * s
            mid.append((cx_, cz_, cy_))
            qx, qz = -dz, dx
            pts_l.append((cx_ + qx * ww, cz_ + qz * ww, cy_ + 0.012 * s))
            pts_r.append((cx_ - qx * ww, cz_ - qz * ww, cy_ + 0.012 * s))
        for j in range(5):
            for side in (pts_l, pts_r):
                quad = [mid[j], mid[j + 1], side[j + 1], side[j]]
                gface(mb, quad, "LM_atlas", uv=uvc, hint=(0, 0, 1))
                gface(mb, [(q[0], q[1], q[2] - 0.002) for q in quad], "LM_atlas", uv=uvc, hint=(0, 0, -1))
    o = mb.finish(name, c, auto=False)
    setcat(o, "lm", 1.0)
    col(f"col__{name}", px - 0.27, px + 0.27, pz - 0.27, pz + 0.27, 2.0)


def reception(c, fx, cols_):
    """Guide's desk (south-east), the sage brand wall, the name-search kiosk, consultation chairs, the flower stand."""
    mb = MB()
    # customer-side counter: x 304.9..305.4, z 2.3..5.4, 1.0 m (fluted oak front), porcelain-white top
    rb(mb, 304.95, 305.4, 2.3, 5.4, 0.0, 0.98, "LM_oak", r=0.01, grain=(0, 1, 0))
    for i in range(40):
        z = 2.32 + i * 0.077
        rb(mb, 304.9, 304.95, z, z + 0.05, 0.05, 0.96, "LM_oak", r=0.004, seg=1, grain=(0, 0, 1), tint=WALNUT)
    rb(mb, 304.88, 305.48, 2.26, 5.44, 0.98, 1.02, "LM_atlas", r=0.008, uv=acell("porcelain"))
    # the return (north end) and the staff desk along the east wall
    rb(mb, 305.4, 307.4, 2.3, 2.8, 0.0, 0.74, "LM_oak", r=0.01, grain=(1, 0, 0))
    rb(mb, 305.4, 307.4, 2.26, 2.84, 0.74, 0.77, "LM_atlas", r=0.008, uv=acell("porcelain"))
    # staff monitor
    rb(mb, 306.3, 306.8, 2.45, 2.65, 0.77, 0.79, "LM_atlas", r=0.008, uv=acell("black"))
    rb(mb, 306.5, 306.6, 2.5, 2.6, 0.79, 1.0, "LM_atlas", r=0.006, uv=acell("black"))
    rb(mb, 306.25, 306.85, 2.5, 2.55, 0.99, 1.33, "LM_atlas", r=0.008, uv=acell("black"))
    # guest book and a small vase of flowers on the counter
    rb(mb, 305.05, 305.3, 3.95, 4.3, 1.02, 1.035, "LM_atlas", r=0.003, seg=1, uv=acell("book_cover"), yaw=0.1)
    rb(mb, 305.07, 305.28, 3.97, 4.28, 1.035, 1.045, "LM_atlas", r=0.002, seg=1, uv=acell("paper"), yaw=0.1)
    rng = random.Random(5)
    lathe(mb, 305.15, 2.7, 1.02, [(0.0, 0.0), (0.05, 0.0), (0.06, 0.03), (0.055, 0.18), (0.0, 0.18)], "LM_atlas", segs=16, uv=acell("vase_glass"))
    for k in range(6):
        a = k * 1.1
        flower_head(mb, 305.15 + 0.04 * math.cos(a), 2.7 + 0.04 * math.sin(a), 1.2 + 0.03 * (k % 3), 0.04, "LM_atlas",
                    acell(["flower_pink", "flower_white", "flower_cream"][k % 3]), rng)
    setcat(mb.finish("reception_desk", c), "lm", 1.6)
    col("col__desk_front", 304.88, 305.48, 2.26, 5.44, 1.02)
    col("col__desk_return", 305.4, 307.4, 2.26, 2.84, 1.0)

    # brand wall: a sage panel on the east wall behind the desk with brass bars and the sign
    mb = MB()
    gface(mb, [(X1 - 0.012, 2.3, 0.0), (X1 - 0.012, 5.85, 0.0), (X1 - 0.012, 5.85, 3.9), (X1 - 0.012, 2.3, 3.9)], "LM_plaster", hint=(-1, 0, 0), tint=SAGE)
    for z in (2.4, 5.75):
        rb(mb, X1 - 0.06, X1 - 0.012, z - 0.03, z + 0.03, 1.4, 3.2, "LM_atlas", r=0.006, seg=1, uv=acell("gold"))
    plaque(mb, "brand", (X1 - 0.016, 2.75), (X1 - 0.016, 5.4), 2.05, 2.05 + 2.65 * 380 / 1536, (-1, 0, 0))
    setcat(mb.finish("brand_wall", c), "lm", 1.5)
    ld = bpy.data.lights.new("brand_wash", "AREA")
    ld.size, ld.size_y = 2.4, 0.3
    ld.shape = "RECTANGLE"
    ld.energy = 38.0
    ld.color = (1.0, 0.9, 0.75)
    lo = bpy.data.objects.new("brand_wash", ld)
    lo.location = P(X1 - 0.8, 4.05, H - 0.4)
    lo.rotation_mode = "QUATERNION"
    lo.rotation_quaternion = (P(X1, 4.05, 2.4) - P(X1 - 0.8, 4.05, H - 0.4)).to_track_quat("-Z", "Y")
    lo["bakelight"] = True
    lo["kind"] = "brand"
    c.objects.link(lo)

    # name-search kiosk: oak pillar with a tilted screen, facing south (toward the door)
    mb = MB()
    kx, kz = 303.4, 2.75
    rb(mb, kx - 0.2, kx + 0.2, kz - 0.15, kz + 0.15, 0.0, 0.1, "LM_oak", r=0.01, tint=WALNUT)
    rb(mb, kx - 0.07, kx + 0.07, kz - 0.05, kz + 0.05, 0.1, 1.05, "LM_oak", r=0.01, grain=(0, 0, 1), tint=WALNUT)
    # the screen: a black slab tilted 20 degrees back, the sign texture on its face
    tilt = math.radians(20)
    ctr = (kx, kz + 0.02)
    hw, hh, th = 0.3, 0.2, 0.025
    def sp(u, v, d):   # u along x, v up the slab, d out of the face (south = +z)
        z_ = ctr[1] + d * math.cos(tilt) + (-v) * math.sin(tilt) * 0.0
        y_ = 1.2 + v * math.cos(tilt) - d * (-math.sin(tilt)) * 0.0
        return (kx + u, ctr[1] + d * math.cos(tilt) - v * math.sin(tilt) * -1.0 * -1.0, 1.2 + v * math.cos(tilt) + d * math.sin(tilt) * 1.0)
    # slab: back face and sides are black; face: kiosk sign. The face normal leans up and toward +z.
    # corners of the face (d = +th/2), v = -hh..hh
    def corner(u, v, d):
        # slab plane spanned by x and the tilted up vector t = (0, +sin(tilt)*-1?, cos): leaning back means the top is farther from the viewer (north, -z)
        zc = ctr[1] - v * math.sin(tilt) + d * math.cos(tilt)
        yc = 1.2 + v * math.cos(tilt) + d * math.sin(tilt)
        return (kx + u, zc, yc)
    f = [corner(-hw, -hh, th / 2), corner(hw, -hh, th / 2), corner(hw, hh, th / 2), corner(-hw, hh, th / 2)]
    n_face = (0, math.cos(tilt), math.sin(tilt))
    u0, v0, u1, v1 = sign_uv("kiosk")
    mb.face([P(*q) for q in f], "LM_signs", [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], hint=V(n_face[0], n_face[1], n_face[2]) - V(0, 0, 0))
    b = [corner(-hw, -hh, -th / 2), corner(hw, -hh, -th / 2), corner(hw, hh, -th / 2), corner(-hw, hh, -th / 2)]
    mb.face([P(*q) for q in b], "LM_atlas", hint=V(0, -n_face[1], -n_face[2]) - V(0, 0, 0), uvs=[acell("black")] * 4)
    for (i, j) in ((0, 1), (1, 2), (2, 3), (3, 0)):
        qd = [f[i], f[j], b[j], b[i]]
        cxx = sum(q[0] for q in qd) / 4 - kx
        czz = sum(q[1] for q in qd) / 4 - ctr[1]
        cyy = sum(q[2] for q in qd) / 4 - 1.2
        mb.face([P(*q) for q in qd], "LM_atlas", hint=V(cxx, czz, cyy) - V(0, 0, 0), uvs=[acell("black")] * 4)
    setcat(mb.finish("kiosk", c), "lm", 1.8)
    col("col__kiosk", kx - 0.3, kx + 0.3, kz - 0.18, kz + 0.2, 1.4)

    # consultation chairs (facing east toward the counter). The counter leaves no room in front of them, so they are sat on
    # from a side: 1.65 m apart, a walkable gap between them (review 2026-11-15: at 1.15 m the second chair could not be
    # reached from anywhere).
    mb = MB()
    for k, z in enumerate((3.3, 4.95)):
        chair_basic(mb, 304.2, z, (1, 0), f"consult_{k}", seat_tint=SAGE_CUSH, exit_turn=math.pi)
    setcat(mb.finish("consult_chairs", c), "lm", 1.4)

    # flower stand on the south wall east of the door: free white chrysanthemums for 헌화. Round 5: real flowers (stems, lobed
    # leaves, layered petals round a yellow eye) in galvanised florist's buckets on a two-step oak stand with a lip.
    mb = MB()
    rb(mb, 301.9, 303.7, 5.45, 5.95, 0.0, 0.45, "LM_oak", r=0.01, grain=(1, 0, 0))
    rb(mb, 301.9, 303.7, 5.7, 5.95, 0.45, 0.8, "LM_oak", r=0.01, grain=(1, 0, 0))
    rb(mb, 301.9, 303.7, 5.44, 5.47, 0.45, 0.49, "LM_oak", r=0.004, seg=1, grain=(1, 0, 0))     # front lips
    rb(mb, 301.9, 303.7, 5.69, 5.72, 0.8, 0.84, "LM_oak", r=0.004, seg=1, grain=(1, 0, 0))
    rng = random.Random(9)
    PETALS.append(MB())
    for k2 in range(3):
        bx2 = 302.2 + k2 * 0.6
        bucket(mb, bx2, 5.58, 0.45, 0.09, 0.12, 0.24)
        mum_bunch(mb, bx2, 5.58, 0.45 + 0.13, 0.12, 8, "flower_white" if k2 != 1 else "chrysanthemum", rng, height=0.30, head=0.048)
        bucket(mb, bx2, 5.83, 0.8, 0.075, 0.1, 0.2)
        mum_bunch(mb, bx2, 5.83, 0.8 + 0.11, 0.1, 6, ["flower_pink", "flower_cream", "flower_lav"][k2], rng, height=0.26,
                  head=0.042)
    # wall map board and the lettering
    rb(mb, 301.9, 303.7, 5.945, 5.98, 1.35, 2.45, "LM_plaster", r=0.005, seg=1, tint=SAGE)
    plaque(mb, "map", (302.8 + 0.7, 5.94), (302.8 - 0.7, 5.94), 1.5, 1.5 + 1.4 * 560 / 1280, (0, -1, 0))
    plaque(mb, "flowers", (302.8 + 0.3, 5.43), (302.8 - 0.3, 5.43), 0.5, 0.5 + 0.6 * 140 / 768, (0, -1, 0))
    setcat(mb.finish("flower_stand", c), "lm", 1.5)
    setcat(PETALS.pop().finish("flower_petals", fx), "nonlm")
    col("col__flower_stand", 301.9, 303.7, 5.4, 5.97, 0.9)


def tea_corner(c):
    """Tea corner on the south wall west of the door: oak counter, coffee machine, water dispenser, cups, shelves, blankets."""
    mb = MB()
    x0, x1 = 296.7, 298.5
    rb(mb, x0, x1, 5.4, 5.95, 0.0, 0.88, "LM_oak", r=0.008, grain=(1, 0, 0))
    rb(mb, x0 - 0.02, x1 + 0.02, 5.38, 5.97, 0.88, 0.92, "LM_atlas", r=0.006, uv=acell("porcelain"))
    espresso_machine(mb, x0 + 0.1, x0 + 0.5, 5.52, 5.9, 0.92)                                      # coffee machine (round 5)
    rb(mb, x1 - 0.42, x1 - 0.07, 5.55, 5.9, 0.92, 1.4, "LM_atlas", r=0.02, uv=acell("white"))         # water dispenser
    lathe(mb, x1 - 0.245, 5.725, 1.4, [(0.0, 0.0), (0.1, 0.0), (0.1, 0.3), (0.0, 0.3)], "LM_atlas", segs=20, uv=acell("vase_glass"))
    cup_tray(mb, x0 + 0.62, x0 + 1.04, 5.5, 5.78, 0.92, random.Random(4))                          # cups on a tray (round 5)
    for k in range(3):
        rb(mb, x0, x1, 5.82, 5.95, 1.55 + k * 0.36, 1.58 + k * 0.36, "LM_oak", r=0.004, seg=1, grain=(1, 0, 0))
    for k in range(5):
        lathe(mb, x0 + 0.2 + k * 0.32, 5.88, 1.58, [(0.0, 0.0), (0.045, 0.0), (0.045, 0.1), (0.0, 0.1)], "LM_atlas", segs=12,
              uv=acell("porcelain" if k % 2 else "cushion_sage"))
    rb(mb, x0 + 0.35, x0 + 0.75, 5.85, 5.95, 1.94, 2.1, "LM_fabric", r=0.02, tint=CREAM)
    rb(mb, x0 + 0.85, x0 + 1.25, 5.85, 5.95, 1.94, 2.05, "LM_fabric", r=0.02, tint=CLAY)
    # sage wall panel and the lettering
    gface(mb, [(x0 - 0.05, Z1 - 0.004, 0), (x1 + 0.05, Z1 - 0.004, 0), (x1 + 0.05, Z1 - 0.004, 2.9), (x0 - 0.05, Z1 - 0.004, 2.9)], "LM_plaster",
          hint=(0, -1, 0), tint=SAGE)
    plaque(mb, "tea", (x1 - 0.2, Z1 - 0.01), (x0 + 0.2, Z1 - 0.01), 2.45, 2.45 + 1.4 * 160 / 1024, (0, -1, 0))
    setcat(mb.finish("tea_corner", c), "lm", 1.5)
    col("col__tea_counter", x0, x1, 5.38, 5.97, 1.0)


def letter_corner(c, fx):
    """Letter table (2 m) with four chairs and the 하늘 우체통 (red post box) in the north-west."""
    mb = MB()
    tx0, tx1, tz0, tz1 = 293.4, 295.4, -3.35, -2.55
    rb(mb, tx0, tx1, tz0, tz1, 0.72, 0.76, "LM_oak", r=0.01, grain=(1, 0, 0))
    for (a, b) in ((tx0 + 0.1, tz0 + 0.1), (tx1 - 0.1, tz0 + 0.1), (tx0 + 0.1, tz1 - 0.1), (tx1 - 0.1, tz1 - 0.1)):
        rb(mb, a - 0.03, a + 0.03, b - 0.03, b + 0.03, 0.0, 0.72, "LM_oak", r=0.006, seg=1, grain=(0, 0, 1), tint=WALNUT)
    for k in range(3):
        rb(mb, 293.6 + k * 0.55, 293.9 + k * 0.55, -3.0, -2.8, 0.76, 0.765, "LM_atlas", r=0.002, seg=1, uv=acell("paper"), yaw=0.1 * k)
    lathe(mb, 294.9, -2.95, 0.76, [(0.0, 0.0), (0.04, 0.0), (0.04, 0.09), (0.0, 0.09)], "LM_atlas", segs=12, uv=acell("porcelain"))
    chairs = MB()
    # chairs on the south side face north (the table); on the north side face south. They are got up from behind.
    for k, x in enumerate((293.75, 295.05)):
        chair_basic(chairs, x, -2.15, (0, -1), f"letter_s{k}", exit_turn=math.pi)
        chair_basic(chairs, x, -3.75, (0, 1), f"letter_n{k}", exit_turn=math.pi)
    setcat(chairs.finish("letter_chairs", c), "lm", 1.4)
    col("col__letter_table", tx0, tx1, tz0, tz1, 0.8)
    setcat(mb.finish("letter_table", c), "lm", 1.5)
    # post box
    mb = MB()
    bx0, bx1, bz0, bz1 = 296.3, 296.7, -3.5, -3.2
    rb(mb, bx0, bx1, bz0, bz1, 0.0, 1.1, "LM_atlas", r=0.04, seg=3, uv=acell("mail_red"))
    rb(mb, bx0 - 0.02, bx1 + 0.02, bz0 - 0.02, bz1 + 0.02, 1.1, 1.16, "LM_atlas", r=0.025, seg=2, uv=acell("mail_red"))
    rb(mb, bx0 + 0.07, bx1 - 0.07, bz1 - 0.005, bz1 + 0.02, 0.88, 0.92, "LM_atlas", r=0.004, seg=1, uv=acell("black"))     # slot
    plaque(mb, "mailbox", (bx0 + 0.06, bz1 + 0.025), (bx1 - 0.06, bz1 + 0.025), 0.6, 0.6 + 0.28 * 120 / 384, (0, 1, 0))
    setcat(mb.finish("sky_mailbox", c), "lm", 1.5)
    col("col__mailbox", bx0, bx1, bz0, bz1, 1.2)
    # sign on the wall "편지 쓰는 자리" is on the cubby plinth side: skipped (the table is self-explanatory)


def aisle_rug(c):
    mb = MB()
    rb(mb, NICHE_C - 0.6, NICHE_C + 0.6, -4.5, 4.9, 0.0, 0.01, "LM_fabric", r=0.003, seg=1, tint=RUG_C)
    # a darker border (two thin strips)
    for s in (-1, 1):
        rb(mb, NICHE_C + s * 0.56 - 0.02, NICHE_C + s * 0.56 + 0.02, -4.5, 4.9, 0.01, 0.012, "LM_fabric", r=0.001, seg=1, tint=RUG_DARK)
    setcat(mb.finish("aisle_rug", c), "lm", 0.8)


# ----------------------------------------------------------------------------------------- outside & misc --

GARDEN = dict(x=291.0, z0=-14.0, z1=14.0, y0=-1.5, y1=7.5)


def garden_card(fx):
    g = GARDEN
    mb = MB()
    f = gface(mb, [(g["x"], g["z1"], g["y0"]), (g["x"], g["z0"], g["y0"]), (g["x"], g["z0"], g["y1"]), (g["x"], g["z1"], g["y1"])],
              "M_garden", hint=(1, 0, 0))
    for lp in f.loops:
        co = lp.vert.co
        gz = -co.y
        lp[mb.uv].uv = ((g["z1"] - gz) / (g["z1"] - g["z0"]), (co.z - g["y0"]) / (g["y1"] - g["y0"]))
    f[mb.explicit] = 1
    o = mb.finish("garden_card", fx, auto=False)
    setcat(o, "nonlm")
    o["garden"] = True


def helpers(c, cols_):
    for side, wbox in zip(("n", "s", "e", "w"), INN["walls"]):
        col(f"col__hall_wall_{side}", wbox["minX"], wbox["maxX"], wbox["minZ"], wbox["maxZ"], 3.5)
    ban = {w["bank"]: w["footprint"] for w in INN["cubbyWalls"]}
    col("col__cubby_a", X0, ban["A"]["maxX"], Z0, ban["A"]["maxZ"], H)
    col("col__cubby_b", ban["B"]["minX"], X1, Z0, ban["B"]["maxZ"], H)
    col("col__cubby_e", ban["E"]["minX"], ban["E"]["maxX"], ban["E"]["minZ"], ban["E"]["maxZ"], H)
    e = bpy.data.objects.new("ceil__hall", None)
    e.empty_display_type = "CUBE"
    e.empty_display_size = 0.5
    e.location = V(CX, CZ, H + 0.05)
    e.scale = ((X1 - X0) / 1.0, (Z1 - Z0) / 1.0, 0.1)
    e["cat"] = "helper"
    c.objects.link(e)


def emit_registry(cols_c, seat_c):
    for (name, x0, x1, z0, z1, h) in COLS:
        U.collider(cols_c, name if name.startswith("col__") else f"col__{name}", x0, x1, z0, z1, h)
    for s in SEATS:
        e = bpy.data.objects.new(f"seat__{s['id']}", None)
        e.empty_display_type = "ARROWS"
        e.empty_display_size = 0.2
        e.location = V(s["x"], s["z"], s["y"])
        e.rotation_euler = (0, 0, s["yaw"])
        e["cat"] = "seat"
        for k, v in s.items():
            e[k] = v if not isinstance(v, bool) else int(v)
        seat_c.objects.link(e)


def world(scene, strength=1.0):
    w = bpy.data.worlds.new("HallWorld")
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(U.DL, "hdri", "kloppenheim_06_puresky_2k.hdr"), check_existing=True)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])


def setup_render(scene, w=1920, h=1080, samples=256):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:
        print("GPU setup failed:", e)
    c = scene.cycles
    c.samples = samples
    c.use_adaptive_sampling = True
    c.use_denoising = True
    c.max_bounces = 8
    c.diffuse_bounces = 4
    c.glossy_bounces = 3
    c.transmission_bounces = 4
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.sample_clamp_indirect = 6.0
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass


def camera(scene, name, eye, target, lens):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = 36.0
    cd.clip_start = 0.05
    cd.clip_end = 200.0
    cam = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(cam)
    cam.location = V(*eye)
    d = V(*target) - V(*eye)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return cam




def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for x in a:
        if x.startswith(name + "="):
            return cast(x.split("=", 1)[1])
    return cast(a[a.index(name) + 1]) if name in a else default


CAMS = {
    "entrance": ((299.0, 5.6, 1.7), (303.5, -1.0, 1.2), 19.0),
    "wide": ((300.0, 5.7, 1.9), (300.0, -6.0, 1.6), 17.0),
    "lounge": ((299.0, 0.8, 2.0), (294.2, 4.5, 0.7), 20.0),
    "niche": ((299.9, -1.5, 1.6), (299.9, -6.0, 1.5), 28.0),
    "desk": ((300.5, 0.5, 1.8), (306.3, 4.0, 1.2), 22.0),
    "east": ((299.0, 4.0, 1.7), (307.3, -2.0, 1.6), 22.0),
    "letters": ((298.5, 1.2, 1.9), (294.4, -3.2, 1.0), 24.0),
    "plan": ((300.0, 0.01, 40.0), (300.0, 0.0, 0.0), 50.0),
    # round 5 close-ups: the flower stand, the espresso machine and tray, the east bank's glass doors
    "flowers": ((302.5, 4.2, 1.35), (302.8, 5.7, 0.75), 35.0),
    "coffee": ((297.2, 4.6, 1.35), (297.2, 5.7, 1.05), 40.0),
    "edoors": ((305.6, -1.0, 1.5), (307.2, -1.5, 1.4), 30.0),
}


def main():
    global BANK_TOP
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    root = U.coll("memorial_hall")
    c = U.coll("hall_lm", root)
    fx = U.coll("hall_fx", root)
    inst_c = U.coll("hall_inst", root)
    cols_c = U.coll("hall_colliders", root)
    anc = U.coll("hall_anchors", root)
    seat_c = U.coll("hall_seats", root)
    w0 = INN["cubbyWalls"][0]
    BANK_TOP = w0["plinth"] + w0["rows"] * (w0["cell"] + w0["frame"]) + w0["frame"]
    shell(c, fx)
    door(c, fx)
    door_daylight(fx)
    ceiling_fixtures(c, fx)
    slats(c)
    for w in INN["cubbyWalls"]:
        cubby_unit(c, fx, inst_c, w)
    niche(c, fx, cols_c)
    # centre benches (4 x 2.2 m facing the niche), the east bench
    for name, cx_, cz_ in (("bench_w1", NICHE_C - 1.75, -2.7), ("bench_e1", NICHE_C + 1.75, -2.7),
                           ("bench_w2", NICHE_C - 1.75, -0.6), ("bench_e2", NICHE_C + 1.75, -0.6)):
        bench(c, name, cx_, cz_, 2.2, "x")
    bench(c, "bench_east", 304.85, -1.8, 2.2, "z")   # review 2026-11-14: 2.05 m clear to bank E (was 1.3 m)
    aisle_rug(c)
    lounge(c, cols_c)
    reception(c, fx, cols_c)
    tea_corner(c)
    letter_corner(c, fx)
    plant(c, cols_c, 292.95, 2.4, "plant_w", seed=21)
    plant(c, cols_c, 305.9, 1.3, "plant_e", seed=23, h=1.6, leaves=38)
    garden_card(fx)
    helpers(anc, cols_c)
    anchors(anc)
    emit_registry(cols_c, seat_c)
    world(scene, arg("--sky", 1.0, float))
    setup_render(scene, samples=arg("--samples", 256, int))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "memorial_authoring.blend"))
    print("SAVED", os.path.join(WORK, "memorial_authoring.blend"), "colliders", len(COLS), "seats", len(SEATS))
    prev = arg("--preview")
    if prev:
        prev = os.path.abspath(prev)
        os.makedirs(prev, exist_ok=True)
        res = arg("--res", "1280x720")
        scene.render.resolution_x, scene.render.resolution_y = (int(v) for v in res.split("x"))
        if arg("--engine", "eevee") == "eevee":
            for k in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
                try:
                    scene.render.engine = k
                    break
                except TypeError:
                    continue
        for o in bpy.data.objects:
            if o.get("cat") == "collider":
                o.hide_render = True
        only = arg("--cams")
        for name, (eye, tgt, lens) in CAMS.items():
            if only and name not in only.split(","):
                continue
            cam = camera(scene, "cam_" + name, eye, tgt, lens)
            if name == "plan":
                cam.data.type = "ORTHO"
                cam.data.ortho_scale = 17.0
                cam.location = V(300.0, 0.0, 30.0)
                cam.rotation_euler = (0, 0, 0)
                for o in bpy.data.objects:
                    if o.name in ("hall_ceiling", "hall_soffit", "lounge_slats", "ceiling_emitters", "downlight_trims", "cove_slits"):
                        o.hide_render = True
            scene.camera = cam
            scene.render.filepath = os.path.join(prev, f"authoring_{name}.png")
            bpy.ops.render.render(write_still=True)
            print("PREVIEW", scene.render.filepath, flush=True)


if __name__ == "__main__":
    main()
