"""B1 (lots v2) — walk-in room parts shared by school_room_kit.py and library_room_kit.py (pure python on b1_geom / b1_parts):
the room box in the interior frame (design 11: x across from the left wall as one comes in, z in from the door wall's inner
face, y up from the floor), walls with window and door openings seen from inside, a window with its reveal, frame, glazing
bars, inner sill and the panoramic garden seen through the glass, wainscot, skirting, ceiling beams,
pendant lamps, and a few furniture kinds.
"""
import math

import b1_geom as G
import b1_parts as P
from b1_geom import Mesh, S

GARDEN = S("M_garden")
# The windows show the real village, baked from the running game at the room's place (e2e/window-view-bake.mjs,
# window_view_atlas.mjs): each room names its own day panorama (the evening and night ones come from windowViews.json).
def garden_map(unit):
    return {"garden": "../windowview/%s_day.ktx2" % unit}


def fiddle_leaf(m, stem, angle, length, width, rise, leaf):
    """A rubber-plant leaf and petiole. Closed edges and a folded midrib catch light on either side."""
    along = (math.cos(angle), 0, math.sin(angle))
    across = (-along[2], 0, along[0])
    base = G.add(G.add(stem, G.mul(along, length * 0.18)), (0, length * 0.14, 0))
    m.member(stem, base, G.prof_round(0.005, 4), leaf)
    tip = G.add(G.add(base, G.mul(along, length)), (0, rise, 0))
    rings = []
    for t, fullness in ((0.34, 0.82), (0.70, 1.0)):
        middle = G.add(G.lerp(base, tip, t), (0, length * 0.15 * math.sin(math.pi * t), 0))
        edge = G.add(middle, (0, -width * 0.23, 0))
        rings.append((G.sub(edge, G.mul(across, width * fullness)), middle,
                      G.add(edge, G.mul(across, width * fullness)), G.add(middle, (0, -0.008, 0))))
    a, b = rings
    for i in range(4):
        j = (i + 1) % 4
        m.poly([a[i], a[j], b[j], b[i]], leaf)
        m.poly([base, a[j], a[i]], leaf)
        m.poly([tip, b[i], b[j]], leaf)


def walls(X, Z):
    """Facade frames of the four walls seen from INSIDE (W = into the room, U = the viewer's right)."""
    return {
        "door": P.F((0.0, 0.0, 0.0), (1, 0, 0), (0, 0, 1)),          # z = 0, u = x
        "back": P.F((X, 0.0, Z), (-1, 0, 0), (0, 0, -1)),            # z = Z, u = X - x
        "left": P.F((0.0, 0.0, Z), (0, 0, -1), (1, 0, 0)),           # x = 0, u = Z - z
        "right": P.F((X, 0.0, 0.0), (0, 0, 1), (-1, 0, 0)),          # x = X, u = z
    }


def box_room(kit, X, Z, H, wall_s, floor_s, ceil_s, holes):
    """Floor, ceiling and the four walls (with `holes[wall]` = [(u0, u1, v0, v1)]) of an X x Z room, H high."""
    m = kit.S
    m.poly([(0, 0, 0), (0, 0, Z), (X, 0, Z), (X, 0, 0)], floor_s)
    m.poly([(0, H, 0), (X, H, 0), (X, H, Z), (0, H, Z)], ceil_s)
    W = walls(X, Z)
    span = {"door": X, "back": X, "left": Z, "right": Z}
    for k, f in W.items():
        P.wall(m, f, 0.0, span[k], 0.0, H, holes.get(k, []), wall_s)
    return W


def window(kit, f, uc, sill, w, h, frame_s, sill_s, wall_s, cols=2, rows=3, arch=False, depth=0.35):
    """The outside view is sampled on the glazed aperture along the camera ray."""
    P.sash_window(kit, f, uc, sill, w, h, frame_s, sill_s, wall_s, wall_s, cols=cols, rows=rows, depth=depth, arch=arch,
                  room=False, glow=None, lights=False, sill_out=0.05, glass=GARDEN)


def wainscot(m, f, u0, u1, h, panel_s, rail_s, skip=()):
    """Painted panelling to dado height on a wall stretch (flat on the wall, 3 cm): rail, panels with raised fields, skirting."""
    f.box(m, u0, u1, 0.0, 0.14, 0.0, 0.03, rail_s, skip=("-w",))
    f.box(m, u0, u1, h - 0.06, h, 0.0, 0.045, rail_s, skip=("-w",))
    f.box(m, u0, u1, 0.14, h - 0.06, 0.0, 0.012, panel_s, skip=("-w", "-v", "+v", "-u", "+u"))
    n = max(1, int(round((u1 - u0) / 0.75)))
    for k in range(n):
        a = u0 + (u1 - u0) * k / n + 0.08
        b = u0 + (u1 - u0) * (k + 1) / n - 0.08
        f.box(m, a, b, 0.26, h - 0.16, 0.012, 0.028, panel_s, skip=("-w",))


def beams(m, X, Z, H, s, step=2.2, along="z", depth=0.24, width=0.18):
    """Exposed oak ceiling beams across the room."""
    if along == "z":
        x = step / 2
        while x < X:
            m.box(x - width / 2, x + width / 2, H - depth, H, 0.0, Z, s, skip=("+y", "-z", "+z"))
            x += step
    else:
        z = step / 2
        while z < Z:
            m.box(0.0, X, H - depth, H, z - width / 2, z + width / 2, s, skip=("+y", "-x", "+x"))
            z += step


def pendant(kit, m, x, z, H, drop, shade_s, metal_s, kind="globe", glow="pendants"):
    """A ceiling pendant: rose, rod, an opal globe (school) or a brass lantern-shade (library); glows at night."""
    y = H - drop
    m.lathe([(0.07, 0.0), (0.06, 0.03), (0.0, 0.04)], 8, metal_s, x, z, H - 0.04)
    m.member((x, H - 0.04, z), (x, y + 0.2, z), G.prof_round(0.008, 4), metal_s)
    if kind == "globe":
        m.sphere(x, y, z, 0.2, shade_s, n=12, rings=7)
        m.lathe([(0.05, 0.0), (0.05, 0.06), (0.0, 0.07)], 8, metal_s, x, z, y + 0.18)
    else:
        m.lathe([(0.0, 0.0), (0.26, 0.02), (0.24, 0.1), (0.12, 0.26), (0.04, 0.32), (0.0, 0.33)], 12, shade_s, x, z, y - 0.12)
    kit.glow(glow).sphere(x, y - 0.02, z, 0.12, P.GLASS.t(P.LAMP), n=6, rings=4)
    kit.lights.append(("point", x, y - 0.1, z, (1.0, 0.86, 0.66), 60.0))
    kit.dayfill.append((x, H - 0.3, z, 2.0, 70.0))


def chair_kind(name, wood_s, frame_s, seat_col=None, w=0.42, back=0.85):
    """A sturdy wooden chair facing +z: seat top 0.45, the seat's front edge at z +0.22, the back at -0.21 (inside the seat's
    contract box), four turned legs, stretchers, a curved back with two rails."""
    m = Mesh(name)
    h = w / 2
    for x in (-h + 0.03, h - 0.03):
        for z in (-0.18, 0.18):
            m.member((x, 0.0, z), (x, 0.43, z), G.prof_round(0.022, 6), frame_s)
        m.member((x, 0.43, -0.18), (x, back, -0.2), G.prof_box(0.035, 0.035), frame_s)
        m.member((x, 0.15, -0.18), (x, 0.15, 0.18), G.prof_round(0.012, 5), frame_s)
    m.member((-h + 0.03, 0.18, 0.0), (h - 0.03, 0.18, 0.0), G.prof_round(0.012, 5), frame_s)
    m.cbox(-h, h, 0.42, 0.45, -0.205, 0.22, wood_s.u((1, 0, 0)), c=0.012)
    for y in (back - 0.12, back - 0.32):
        m.cbox(-h + 0.01, h - 0.01, y, y + 0.09, -0.215, -0.19, wood_s.u((1, 0, 0)), c=0.008)
    return m
