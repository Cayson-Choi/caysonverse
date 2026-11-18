"""Original seated figure for the Caysonverse Buddha. Dimensions and stations are metres.

Blender coordinates: Z is up, -Y faces the worshipper. The right arm shares
its shoulder boundary with the torso. The robe is cut as a separate, thick
folded surface that passes over the opposite shoulder and around the hips.
"""
from bisect import bisect_right
from math import atan2, cos, exp, pi, sin

import bmesh
import bpy
from mathutils import Vector

from buddha_mesh import mat


TAU = 2 * pi


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(x, hi))


def mix(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def interpolate(stations, x):
    """Shape-preserving cubic interpolation with horizontal extrema."""
    if x <= stations[0][0]:
        return stations[0][1:]
    if x >= stations[-1][0]:
        return stations[-1][1:]
    i = bisect_right([p[0] for p in stations], x) - 1
    a, b = stations[i:i + 2]
    p = stations[max(0, i - 1)]
    q = stations[min(len(stations) - 1, i + 2)]
    width = b[0] - a[0]
    t = (x - a[0]) / width

    def slope(l, c, r, k):
        if l is c or r is c:
            return (r[k] - l[k]) / (r[0] - l[0])
        m0 = (c[k] - l[k]) / (c[0] - l[0])
        m1 = (r[k] - c[k]) / (r[0] - c[0])
        if m0 * m1 <= 0:
            return 0
        return 2 * m0 * m1 / (m0 + m1)

    return tuple(a[k] * (1 - smooth(t)) + b[k] * smooth(t)
                 + width * t * (1 - t) * ((1 - t) * slope(p, a, b, k)
                 - t * slope(a, b, q, k)) for k in range(1, len(a)))


class Surface:
    def __init__(self):
        self.points = []
        self.faces = []

    def pt(self, xyz):
        self.points.append(tuple(xyz))
        return len(self.points) - 1

    def ring(self, points):
        return [self.pt(p) for p in points]

    def strip(self, a, b, wrap=True):
        for i in range(len(a) if wrap else len(a) - 1):
            j = (i + 1) % len(a)
            self.faces.append((a[i], a[j], b[j], b[i]))

    def cap(self, ring):
        center = sum((Vector(self.points[i]) for i in ring), Vector()) / len(ring)
        idx = self.pt(center)
        for i in range(len(ring)):
            self.faces.append((idx, ring[i], ring[(i + 1) % len(ring)]))

    def finish(self, name, material):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.points, [], self.faces)
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat(material))
        for f in mesh.polygons:
            f.use_smooth = True
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj


# Torso cross sections. Front/back depths are independent, so that the upper
# chest projects gently and the seated lumbar curve collects at the waist.
CHEST = [
    (.68, .198, .140, .172, .015), (.78, .223, .153, .179, .020),
    (.89, .227, .156, .164, .024), (1.00, .244, .171, .161, .024),
    (1.105, .269, .187, .169, .020), (1.17, .283, .197, .174, .015),
    (1.235, .302, .192, .178, .017), (1.307, .317, .172, .173, .023),
    (1.354, .313, .154, .157, .025), (1.389, .272, .137, .142, .026),
    (1.415, .207, .119, .127, .024), (1.439, .139, .102, .109, .022),
    (1.46, .110, .097, .101, .022), (1.49, .106, .097, .104, .022),
    (1.525, .112, .104, .108, .022)
]


def chest_point(z, theta):
    rx, front, back, y0 = interpolate(CHEST, z)
    sn, cs = sin(theta), cos(theta)
    # A small continuous sternum transition; no anatomical muscle grooves.
    hollow = .009 * exp(-(sn / .21) ** 2 - ((z - 1.20) / .085) ** 2)
    return Vector((rx * sn, y0 - (front if cs >= 0 else back) * cs
                   + hollow * max(0.0, cs), z))


def torso_and_arm(phone):
    surf = Surface()
    n = 24 if phone else 40
    zrows = [s[0] for s in CHEST]
    rows = [surf.ring(chest_point(z, TAU * j / n) for j in range(n)) for z in zrows]
    l, r = round(n * .625), round(n * .875)
    low, high = 4, 10
    for k in range(len(rows) - 1):
        for j in range(n):
            if low <= k < high and l <= j < r:
                continue
            b = (j + 1) % n
            surf.faces.append((rows[k][j], rows[k][b], rows[k + 1][b], rows[k + 1][j]))
    surf.cap(rows[0])
    surf.cap(rows[-1])

    # An actual armhole bounded by the round of the pectoral and the back.
    opening = (rows[low][l:r + 1] + [rows[k][r] for k in range(low + 1, high + 1)]
               + list(reversed(rows[high][l:r])) + [rows[k][l] for k in range(high - 1, low, -1)])
    phases = [atan2(-(surf.points[i][1] - .022) / .13,
                    (surf.points[i][2] - 1.257) / .154) for i in opening]
    # The broad shoulder turns down into a soft elbow and a lifted forearm.
    # Palm stations continue the same mesh all the way to the finger webs.
    arm = [
        (-.281, .025, 1.265, .135, .135), (-.309, .027, 1.223, .119, .113),
        (-.322, .026, 1.158, .093, .098), (-.331, .022, 1.065, .084, .087),
        (-.340, .013, .970, .082, .082), (-.347, -.008, .901, .080, .082),
        (-.348, -.041, .867, .077, .079), (-.349, -.084, .872, .081, .079),
        (-.347, -.131, .908, .083, .082), (-.340, -.191, .968, .078, .073),
        (-.331, -.249, 1.030, .069, .062), (-.321, -.300, 1.096, .061, .053),
        (-.314, -.327, 1.143, .057, .047), (-.310, -.339, 1.176, .065, .047),
        (-.306, -.346, 1.212, .078, .048), (-.305, -.350, 1.249, .081, .042),
        (-.307, -.348, 1.278, .077, .032), (-.307, -.344, 1.298, .067, .024),
        (-.307, -.341, 1.307, .050, .017)
    ]
    prev = opening
    palm = Surface()
    palm_ring = None
    centers = [Vector(p[:3]) for p in arm]
    for k, (x, y, z, width, depth) in enumerate(arm):
        c = centers[k]
        before = centers[k - 1] if k > 0 else Vector((-.244, .025, 1.29))
        after = centers[min(k + 1, len(arm) - 1)]
        axis = (after - before).normalized()
        u = (Vector((-1, 0, 0)) - axis * -axis.x).normalized()
        v = u.cross(axis).normalized()
        pts = []
        for p in phases:
            a, b = cos(p), sin(p)
            pt = c + width * a * u + depth * b * v
            if k >= 13 and b < 0:
                pt.y -= .009 * (abs(a) ** 1.1) * (-b)
            pts.append(pt)
        if k <= 12:
            ring = surf.ring(pts)
            surf.strip(prev, ring)
            prev = ring
        if k >= 11:
            # The overlap is inset on the forearm and emerges at the wrist.
            scale = .93 if k == 11 else (1.013 if k == 12 else 1)
            ring = palm.ring(c + scale * (pt - c) for pt in pts)
            if palm_ring is None:
                palm.cap(ring)
            else:
                palm.strip(palm_ring, ring)
            palm_ring = ring
    surf.cap(prev)
    palm.cap(palm_ring)
    return surf.finish("Breast and bare shoulder", "skin"), palm


def sweep(surf, stations, sides, samples, preferred=(1, 0, 0), pads=False):
    """Closed, varying elliptical sweep, parallel-transported round the bends."""
    data = [(i, *s) for i, s in enumerate(stations)]
    chain = [interpolate(data, (len(data) - 1) * i / (samples - 1)) for i in range(samples)]
    cs = [Vector(s[:3]) for s in chain]
    ref = Vector(preferred)
    prior = None
    for k, s in enumerate(chain):
        axis = (cs[min(len(cs) - 1, k + 1)] - cs[max(0, k - 1)]).normalized()
        u = ref - axis * ref.dot(axis)
        if u.length < .01:
            u = axis.cross(Vector((0, 0, 1)))
        u.normalize()
        ref = u
        v = axis.cross(u).normalized()
        pts = []
        for j in range(sides):
            a = TAU * j / sides
            # A broad pad and gently flatter nail face on the distal phalanx.
            b = sin(a)
            if pads and k >= samples * .61 and b > 0:
                b = mix(b, min(b, .88), .5)
            pts.append(cs[k] + u * (s[3] * cos(a)) + v * (s[4] * b))
        ring = surf.ring(pts)
        if prior is None:
            surf.cap(ring)
        else:
            surf.strip(prior, ring)
        prior = ring
    surf.cap(prior)


def hands(phone, s):
    # Little, ring and index fingers. The third finger curls forward, meeting
    # the thumb at the pad and leaving a through-hole visible in profile.
    fingers = [
        [(-.359, -.343, 1.257, .019, .022), (-.367, -.344, 1.306, .018, .020),
         (-.366, -.342, 1.350, .015, .017), (-.362, -.350, 1.387, .013, .015),
         (-.360, -.352, 1.396, .006, .006), (-.359, -.353, 1.398, .002, .002)],
        [(-.331, -.340, 1.272, .022, .024), (-.333, -.336, 1.326, .020, .021),
         (-.332, -.325, 1.380, .017, .018), (-.325, -.331, 1.431, .015, .016),
         (-.323, -.333, 1.440, .008, .007), (-.322, -.334, 1.443, .002, .002)],
        [(-.252, -.341, 1.271, .022, .024), (-.248, -.341, 1.327, .020, .022),
         (-.249, -.328, 1.389, .018, .019), (-.252, -.322, 1.446, .016, .017),
         (-.254, -.324, 1.460, .008, .009), (-.255, -.325, 1.463, .002, .002)],
        [(-.296, -.342, 1.272, .022, .024), (-.295, -.345, 1.325, .020, .022),
         (-.289, -.365, 1.349, .0185, .019), (-.280, -.391, 1.339, .017, .018),
         (-.273, -.406, 1.320, .015, .016), (-.270, -.408, 1.315, .007, .008)],
        [(-.295, -.334, 1.169, .011, .012), (-.280, -.348, 1.189, .032, .024),
         (-.255, -.359, 1.220, .032, .028),
         (-.234, -.372, 1.253, .024, .026), (-.233, -.394, 1.286, .021, .020),
         (-.252, -.412, 1.309, .017, .017), (-.270, -.410, 1.315, .013, .013),
         (-.275, -.407, 1.318, .005, .006)]
    ]
    for f in fingers:
        sweep(s, f, 8 if phone else 12, 8 if phone else 13, pads=True)

    # Open, supinated left hand. The heel of the palm continues into the cuff.
    left = [(.239, -.213, .765, .048, .041), (.196, -.258, .755, .048, .043),
            (.141, -.287, .745, .059, .042), (.097, -.296, .741, .062, .039),
            (.062, -.298, .741, .052, .031), (.037, -.299, .742, .041, .020)]
    sweep(s, left, 10 if phone else 18, 9 if phone else 13, preferred=(0, -1, 0))
    for k, (y, reach) in enumerate([(-.337, -.047), (-.314, -.062), (-.289, -.056), (-.264, -.032)]):
        r = [.015, .016, .015, .013][k]
        f = [(.075, y, .739, r * 1.1, r * 1.25), (.040, y, .735, r, r),
             (.005, y - .002, .739, r, r * .86), (reach + .008, y - .005, .753, r * .86, r * .76),
             (reach, y - .004, .756, r * .27, r * .30)]
        sweep(s, f, 7 if phone else 10, 7 if phone else 10, preferred=(0, 1, 0), pads=True)
    thumb = [(.131, -.317, .750, .024, .026), (.105, -.340, .766, .023, .023),
             (.078, -.346, .776, .020, .020), (.045, -.347, .779, .016, .016),
             (.015, -.345, .783, .014, .014), (.007, -.341, .788, .005, .006)]
    sweep(s, thumb, 8 if phone else 12, 8 if phone else 11, preferred=(0, 1, 0))
    hand = s.finish("Hands and finger pads", "skin")
    # Weld the finger webs into the hand-carved palm, retaining the actual
    # space between opposed pads. Only these small hand surfaces are remeshed.
    bpy.context.view_layer.objects.active = hand
    hand.data.remesh_voxel_size = .0025 if phone else .0018
    bpy.ops.object.voxel_remesh()
    smoothing = hand.modifiers.new("Finger webs", "SMOOTH")
    smoothing.factor = .87
    smoothing.iterations = 8 if phone else 12
    bpy.ops.object.modifier_apply(modifier=smoothing.name)
    for poly in hand.data.polygons:
        poly.use_smooth = True
    return hand


# A wave section through hanging cloth: a wide sloping face rolls into a
# rounded, protruding lip and returns sharply into its own shadow.
PLEAT = [(0, .0, .0), (.17, -.17, -.04), (.44, .04, .0), (.70, .64, .10),
         (.82, 1., .08), (.93, .29, -.22), (1., .0, .0)]


def fold_profile(cycles):
    return interpolate(PLEAT, cycles % 1)


# Heights of the six hanging arcs. Read columns from the hem toward the neck,
# and rows clockwise from the sternum across the draped arm to the bare flank.
# On the outer arm the arcs are slung between two high points. On the back
# their rear attachment rises almost vertically in a long cascade.
COURSES = [
    (0.00, .740,.787,.846,.912,.973,1.039,1.111),
    (.065, .754,.812,.869,.931,.996,1.070,1.141),
    (.124, .800,.866,.943,1.035,1.117,1.194,1.251),
    (.175, .775,.869,.984,1.109,1.235,1.339,1.403),
    (.207, .615,.771,.923,1.080,1.232,1.362,1.428),
    (.247, .459,.574,.705,.835,.988,1.193,1.438),
    (.288, .441,.518,.624,.768,.960,1.244,1.434),
    (.330, .439,.562,.735,.951,1.157,1.337,1.410),
    (.362, .449,.727,.930,1.105,1.221,1.302,1.348),
    (.403, .447,.633,.816,.974,1.093,1.202,1.287),
    (.500, .441,.544,.665,.797,.944,1.080,1.178),
    (.586, .447,.545,.665,.799,.933,1.044,1.114),
    (.674, .478,.604,.718,.826,.919,1.008,1.095),
    (.750, .663,.743,.815,.892,.962,1.032,1.082),
    (.835, .770,.815,.865,.921,.979,1.035,1.086),
    (.904, .752,.804,.853,.909,.968,1.031,1.102),
    (.955, .733,.779,.836,.900,.964,1.029,1.108),
    (1.00, .740,.787,.846,.912,.973,1.039,1.111)
]


def cloth_base(phi, t):
    q = phi / TAU % 1
    heights = interpolate(COURSES, q)
    z = interpolate(list(enumerate(heights)), t * 6)[0]
    sn, cs = sin(phi), cos(phi)
    shoulder = max(sn, 0)
    if z >= .715:
        p = chest_point(z, phi)
        rx = p.x
        ry = p.y - .022
    else:
        width, front_depth, back_depth = interpolate([
            (.42, .556, .446, .424), (.50, .562, .425, .422),
            (.59, .549, .372, .394), (.67, .446, .250, .315),
            (.715, .218, .149, .176)], z)
        rx = width * sn
        ry = -(front_depth if cs > 0 else back_depth) * cs
    sleeve = interpolate([(.42, .025), (.57, .018), (.68, .043), (.78, .126),
                          (.93, .128), (1.10, .096), (1.23, .060), (1.32, .034),
                          (1.38, .016), (1.45, .0)], z)[0]
    rx += sleeve * shoulder ** 2.3
    ry -= .046 * shoulder ** 3 * exp(-((z - .95) / .20) ** 2)
    # The back of the throw fans out onto the cushion. Keep it in front
    # of the seat surface at its hem so the long folds terminate visibly.
    rear = max(-cs, 0)
    ry += rear * (.027 + .032 * shoulder) * max(0, 1 - t * 2.2)
    return Vector((rx + .009 * sn, .022 + ry - .009 * cs, z))


def cloth(phi, t):
    p = cloth_base(phi, t)
    dt = cloth_base(phi, min(1, t + .003)) - cloth_base(phi, max(0, t - .003))
    da = cloth_base(phi + .002, t) - cloth_base(phi - .002, t)
    normal = da.cross(dt).normalized()
    shoulder = max(sin(phi), 0)
    crest, tuck = fold_profile(6 * t + .045 * sin(phi * 2) * sin(pi * t))
    depth = .019 + .022 * shoulder ** 2 + .014 * max(-cos(phi), 0)
    # Narrow fluting travels over the crown of the shoulder and spreads
    # down its front and rear. The broad lower courses continue underneath.
    crown = smooth((t - .60) / .35) * shoulder ** 3
    fluting, _ = fold_profile(6 * t + .14 * cos(phi) + .5)
    depth *= 1 - .15 * crown
    edge = .006 * exp(-((1 - t) / .012) ** 2)
    return p + normal * (depth * crest + .011 * crown * fluting + edge) + dt.normalized() * (.55 * depth * tuck)


def mantle(phone):
    s = Surface()
    n, m = (52, 40) if phone else (96, 74)
    rows = [s.ring(cloth(TAU * j / n, k / m) for j in range(n)) for k in range(m + 1)]
    for a, b in zip(rows, rows[1:]):
        s.strip(a, b)
    # A sewn, rounded selvedge rolls over a real return on the inside.
    for end, sign in [(0, 1), (-1, -1)]:
        ring = rows[end]
        for inset, dz in [(.004, .003), (.011, .004), (.017, .0), (.020, -.010)]:
            pts = []
            for j in range(n):
                a = TAU * j / n
                p = Vector(s.points[rows[end][j]])
                pts.append(p + Vector((-inset * sin(a), inset * cos(a), -sign * dz)))
            new = s.ring(pts)
            s.strip(ring, new)
            ring = new
    return s.finish("Mantle with hanging concentric folds", "gold")


def shoulder_throw(phone):
    # A second long strip of the kasaya crosses the acromion. Its gathers run
    # *along* the cloth, turning continuously from the chest onto the back.
    path = [
        (0, .61,1.02,.10,.16), (.14,.62,1.06,.36,.37),
        (.28,.67,1.13,.64,.62), (.39,.79,1.19,.87,.78),
        (.46,1.04,1.32,.978,.868), (.50,1.57,1.57,.994,.891),
        (.54,2.11,1.82,.976,.868), (.63,2.27,1.96,.858,.78),
        (.76,2.39,2.04,.621,.53), (.90,2.48,2.09,.336,.245),
        (1,2.47,2.13,.095,.03)]
    s = Surface()
    count, lanes = (30, 17) if phone else (60, 32)
    rows = []
    for i in range(count + 1):
        length = i / count
        a0, a1, t0, t1 = interpolate(path, length)
        pts = []
        for j in range(lanes + 1):
            v = j / lanes
            phi = mix(a0, a1, v)
            t = mix(t0, t1, v)
            t += .014 * sin(pi * v) * sin(TAU * length)
            p = cloth_base(phi, t)
            dt = cloth_base(phi, t + .001) - cloth_base(phi, t - .001)
            da = cloth_base(phi + .001, t) - cloth_base(phi - .001, t)
            normal = da.cross(dt).normalized()
            folded, tuck = fold_profile(3.1 * v + .112 * sin(pi * length) + .13)
            fray = min(smooth(length / .12), smooth((1 - length) / .12))
            raised = .012 + fray * (.016 + .014 * folded)
            # Both short ends taper and turn back towards the mantle below.
            pts.append(p + normal * raised + dt.normalized() * (.006 * tuck))
        rows.append(s.ring(pts))
    for a,b in zip(rows,rows[1:]):
        s.strip(a,b,False)
    border = (rows[0] + [row[-1] for row in rows[1:]] + list(reversed(rows[-1][:-1]))
              + [row[0] for row in reversed(rows[1:-1])])
    # Hidden return of the selvage. Cap behind the entire folded panel using
    # a parallel grid, avoiding planar triangles cutting across its long arch.
    inner_rows = []
    for row in rows:
        inner_rows.append(s.ring((x * .952, .022 + (y - .022) * .952, z - .005)
                                 for x,y,z in [s.points[idx] for idx in row]))
    for a,b in zip(inner_rows,inner_rows[1:]):
        s.strip(a,b,False)
    inner_border = (inner_rows[0] + [row[-1] for row in inner_rows[1:]]
                    + list(reversed(inner_rows[-1][:-1])) + [row[0] for row in reversed(inner_rows[1:-1])])
    s.strip(border, inner_border)
    return s.finish("Long shoulder pleats", "gold")


def sleeve_cuff(phone):
    s = Surface()
    n, m = (16, 17) if phone else (36, 28)
    stations = [(0, .156, -.278, .755, .060, .054), (.15, .194, -.252, .763, .069, .061),
                (.40, .264, -.195, .788, .079, .074), (.64, .326, -.117, .835, .085, .086),
                (.85, .340, -.056, .904, .077, .082), (1, .327, -.019, .972, .069, .068)]
    rows = []
    for i in range(m + 1):
        t = i / m
        x, y, z, width, depth = interpolate(stations, t)
        p = Vector((x, y, z))
        tangent = (Vector(interpolate(stations, min(1, t + .005))[:3])
                   - Vector(interpolate(stations, max(0, t - .005))[:3])).normalized()
        normal = tangent.cross(Vector((0, 0, 1))).normalized()
        binormal = tangent.cross(normal)
        pts = []
        for j in range(n):
            a = TAU * j / n
            crest, tuck = fold_profile(3.6 * t + .38 * sin(a - 1.2))
            edge = .008 * exp(-(t / .035) ** 2)
            o = .011 * crest + edge
            pts.append(p + normal * (cos(a) * (width + o)) + binormal * (sin(a) * (depth + o))
                       + tangent * (.012 * tuck + .016 * cos(a) * (1 - t) ** 4))
        rows.append(s.ring(pts))
    for a, b in zip(rows, rows[1:]):
        s.strip(a, b)
    center = sum((Vector(s.points[i]) for i in rows[0]), Vector()) / n
    inner = s.ring(center + .80 * (Vector(s.points[i]) - center) for i in rows[0])
    s.strip(rows[0], inner)
    deep = s.ring(Vector(s.points[i]) + Vector((.028, .022, .008)) for i in inner)
    s.strip(inner, deep)
    s.cap(deep)
    s.cap(rows[-1])
    return s.finish("Turned cuff on the resting forearm", "gold")


def feet(phone):
    s = Surface()
    for side in [1, -1]:
        # A raised instep descends into the five gently splayed toe pads.
        front = -.280 if side > 0 else -.197
        h = .0 if side > 0 else .006
        sections = [
            (.045, front + .068, .669 + h, .046, .043),
            (.100, front + .038, .674 + h, .051, .046),
            (.167, front + .009, .681 + h, .056, .045),
            (.236, front, .683 + h, .062, .036),
            (.310, front + .004, .689 + h, .069, .030),
            (.365, front + .006, .691 + h, .063, .023),
            (.393, front + .010, .691 + h, .041, .016)]
        sweep(s, [(side * x, y, z, w, d) for x, y, z, w, d in sections],
              9 if phone else 16, 10 if phone else 15, preferred=(0, -1, 0))
        for i in range(5):
            q = i / 4
            y = front - .044 + .110 * q
            reach = .430 - .052 * q ** 1.25
            radius = .018 - .008 * q
            x0 = .352 - .020 * q
            z = .692 + h - .003 * q
            f = [(side * x0, y, z, radius, radius),
                 (side * (x0 + .030), y, z + .004, radius * 1.05, radius),
                 (side * (reach - .009), y + .002, z + .003, radius * .88, radius * .78),
                 (side * reach, y + .002, z, radius * .28, radius * .25)]
            sweep(s, f, 6 if phone else 8, 5 if phone else 7, preferred=(0, 1, 0), pads=True)
    return s.finish("Bare crossed feet", "skin")


def join_wrist(body, hand):
    # A pair of trimmed loops reconnects the remeshed finger webs to the
    # original arm surface without leaving overlapping skin at the wrist.
    center = Vector((-.315, -.320, 1.132))
    axis = Vector((.2, -.45, .86)).normalized()
    bm = bmesh.new()
    boundary = []
    for source, along, remove_end in [(body, -.008, True), (hand, .008, False)]:
        local = bmesh.new()
        local.from_mesh(source.data)
        def near(v):
            x, y, z = v.co
            return x < -.19 and y < -.235 and 1.02 < z < 1.22
        vertices = [v for v in local.verts if near(v)]
        edges = {e for v in vertices for e in v.link_edges}
        faces = {f for e in edges for f in e.link_faces}
        cut = center + along * axis
        bmesh.ops.bisect_plane(local, geom=vertices + list(edges) + list(faces),
                                plane_co=cut, plane_no=axis, dist=.000002,
                                clear_outer=remove_end, clear_inner=not remove_end)
        # Retain the main skin component(s). The only newly open ring lies
        # in the cutting plane, within the short extent of the wrist.
        ids = [v for v in local.verts if any(e.is_boundary for e in v.link_edges)
               and abs((v.co - cut).dot(axis)) < .00003 and near(v)]
        copy = {v: bm.verts.new(v.co) for v in local.verts}
        for f in local.faces:
            polygon = bm.faces.new([copy[v] for v in f.verts])
            polygon.smooth = True
        idset = set(ids)
        boundary.extend(bm.edges.get((copy[e.verts[0]], copy[e.verts[1]]))
                        for e in local.edges if e.is_boundary and all(v in idset for v in e.verts))
        local.free()
    bridge = bmesh.ops.bridge_loops(bm, edges=boundary)
    if not bridge['faces']:
        raise RuntimeError("Wrist loops did not meet")
    for f in bridge['faces']:
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(body.data)
    bm.free()
    bpy.data.objects.remove(hand, do_unlink=True)


def build_body(phone):
    from buddha_lap import build_lap
    torso, palm = torso_and_arm(phone)
    objects = [torso, hands(phone, palm), mantle(phone), shoulder_throw(phone), sleeve_cuff(phone), feet(phone)]
    # Each error-based reduction operates within one carving. Reserve more
    # faces for the finger pads and for lips that silhouette against the back.
    limits = (490, 1030, 1280, 305, 210, 300) if phone else (1360, 3270, 5820, 1170, 790, 970)
    for obj, limit in zip(objects, limits):
        count = sum(len(f.vertices) - 2 for f in obj.data.polygons)
        if count > limit:
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new("Preserve curved profile", "DECIMATE")
            mod.ratio = limit / count
            bpy.ops.object.modifier_apply(modifier=mod.name)
    join_wrist(objects[0], objects[1])
    return [objects[0], *objects[2:], *build_lap(phone)]
