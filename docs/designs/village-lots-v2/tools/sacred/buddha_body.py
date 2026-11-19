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
    # Little, ring and index rise from the web in steps. The index leans
    # forward in profile while the middle curls down to the rising thumb pad.
    fingers = [
        [(-.359, -.343, 1.257, .019, .022), (-.367, -.344, 1.306, .018, .020),
         (-.366, -.342, 1.350, .015, .017), (-.362, -.350, 1.387, .013, .015),
         (-.360, -.352, 1.396, .006, .006), (-.359, -.353, 1.398, .002, .002)],
        [(-.331, -.340, 1.272, .022, .024), (-.333, -.336, 1.326, .020, .021),
         (-.332, -.330, 1.374, .018, .019), (-.326, -.335, 1.420, .016, .017),
         (-.324, -.337, 1.433, .010, .010), (-.323, -.338, 1.437, .002, .002)],
        [(-.252, -.341, 1.271, .023, .025), (-.248, -.344, 1.332, .021, .023),
         (-.249, -.354, 1.397, .020, .021), (-.251, -.368, 1.461, .017, .018),
         (-.252, -.370, 1.474, .011, .012), (-.252, -.371, 1.479, .002, .002)],
        [(-.298, -.342, 1.272, .022, .024), (-.299, -.347, 1.320, .021, .022),
         (-.295, -.366, 1.353, .019, .020), (-.289, -.389, 1.357, .018, .019),
         (-.279, -.409, 1.345, .016, .017), (-.271, -.416, 1.334, .013, .014),
         (-.266, -.418, 1.327, .006, .007)],
        [(-.295, -.334, 1.169, .011, .012), (-.280, -.348, 1.189, .032, .024),
         (-.255, -.359, 1.220, .032, .028),
         (-.232, -.372, 1.253, .025, .026), (-.228, -.393, 1.286, .021, .022),
         (-.243, -.410, 1.310, .018, .019), (-.262, -.418, 1.323, .016, .017),
         (-.270, -.416, 1.332, .012, .013), (-.275, -.414, 1.338, .005, .006)]
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


# Each column follows a fold from the breast around the left arm and back.
# The low point of each swag moves towards the elbow as the fabric opens.
DRAPE = [
    # turn     hem    first  second  third  fourth   neckline
    (.000,    .674,  .775,  .859,   .947,  1.015,    1.064),
    (.046,    .674,  .779,  .864,   .959,  1.038,    1.087),
    (.096,    .683,  .802,  .897,  1.009,  1.115,    1.218),
    (.145,    .691,  .819,  .920,  1.048,  1.196,    1.407),
    (.183,    .626,  .745,  .848,   .969,  1.140,    1.446),
    (.220,    .497,  .609,  .731,   .866,  1.059,    1.451),
    (.255,    .430,  .521,  .646,   .804,  1.084,    1.453),
    (.282,    .427,  .507,  .652,   .860,  1.218,    1.453),
    (.306,    .427,  .542,  .785,  1.082,  1.349,    1.451),
    (.337,    .428,  .893, 1.186,  1.331,  1.409,    1.448),
    (.361,    .429, 1.274, 1.350,  1.395,  1.425,    1.443),
    (.390,    .430, 1.009, 1.173,  1.282,  1.359,    1.404),
    (.428,    .431,  .684,  .882,  1.060,  1.176,    1.270),
    (.495,    .431,  .553,  .733,   .900,  1.045,    1.157),
    (.592,    .433,  .546,  .710,   .862,   .997,    1.091),
    (.680,    .465,  .574,  .715,   .859,   .986,    1.085),
    (.758,    .626,  .693,  .798,   .902,   .995,    1.080),
    (.838,    .690,  .797,  .876,   .952,  1.018,    1.081),
    (.918,    .683,  .787,  .866,   .945,  1.012,    1.071),
    (1.00,    .674,  .775,  .859,   .947,  1.015,    1.064),
]

# Horizontal sections of the hanging cloth clear the resting arm and spread
# onto the lap. A single continuous profile also turns over the shoulder.
CLOTH_SECTIONS = [
    # height, left reach, right reach, front depth, back depth, centre Y
    (.400, .561, .553, .420, .402, .015),
    (.460, .569, .556, .421, .412, .016),
    (.550, .551, .525, .385, .397, .018),
    (.640, .499, .439, .299, .348, .019),
    (.720, .433, .295, .201, .274, .020),
    (.800, .388, .233, .170, .222, .021),
    (.900, .371, .238, .168, .203, .022),
    (1.00, .366, .255, .184, .193, .023),
    (1.10, .357, .279, .200, .193, .021),
    (1.18, .353, .295, .209, .196, .017),
    (1.26, .352, .319, .198, .195, .019),
    (1.31, .342, .327, .185, .188, .024),
    (1.35, .321, .325, .171, .174, .025),
    (1.38, .291, .296, .153, .158, .025),
    (1.41, .237, .234, .134, .142, .024),
    (1.44, .153, .150, .115, .122, .022),
    (1.46, .118, .117, .106, .109, .022),
    (1.48, .115, .115, .105, .109, .022),
]


def cloth_section(z, phi):
    left, right, front, back, center = interpolate(CLOTH_SECTIONS, z)
    sn, cs = sin(phi), cos(phi)
    width = mix(right, left, smooth((sn + .45) / .95))
    depth = front if cs >= 0 else back
    return Vector((width * sn, center - depth * cs, z))


def mantle(phone):
    surf = Surface()
    # Keep the edge loops on the actual ridges and in their troughs at both
    # LODs. A broad convex face returns underneath each rounded lip.
    profile = [(0, 1.), (.11, .80), (.30, .29), (.54, -.06),
               (.73, -.12), (.84, .12), (.94, .78)]
    if phone:
        profile = [profile[i] for i in (0, 2, 4, 5)]
    n = 39 if phone else 87
    courses = len(DRAPE[0]) - 2
    # Extra rows follow a narrow fold just outside the neckline. It rolls
    # over the shoulder and flattens out as it reaches the sternum.
    samples = [(k, t, r) for k in range(courses) for t, r in profile]
    samples = [entry for entry in samples if entry[0] < courses - 1 or entry[1] < .73]
    samples.extend((courses - 1, t, r) for t, r in
                   ((.73, -.1), (.82, .0), (.875, .9), (.91, .75), (.956, .0), (1., 1.)))
    if not phone:
        # The first course fans from the lotus to the back shoulder. Retain
        # its curved silhouette even where one face of the fold is very wide.
        samples.extend((0, t, r) for t, r in ((.20, .56), (.42, .07), (.64, -.11)))
        samples.sort()
    rows = [[] for _ in samples]
    normals = [[], []]
    # Repeat the end stations so that even the tangent at the centre-front
    # seam is shared between its two sides.
    periodic = [(DRAPE[-2][0] - 1, *DRAPE[-2][1:]), *DRAPE,
                (DRAPE[1][0] + 1, *DRAPE[1][1:])]
    meridians = [(0, 0), (.11, .091), (.25, .183), (.40, .275), (.54, .349),
                 (.64, .406), (.74, .492), (.83, .615), (.93, .847), (1, 1)]
    for j in range(n):
        turn, = interpolate(meridians, j / n)
        phi = TAU * turn
        heights = interpolate(periodic, turn)
        sleeve = max(0, sin(phi))
        back = max(0, -cos(phi))
        depth = .009 + .018 * sleeve + .015 * back
        # Where the cloth gathers behind the shoulder the spacing shrinks.
        # Reduce the relief there so neighbouring ridges stay separate.
        gather = exp(-((turn - .36) / .047) ** 2)
        depth *= 1 - .63 * gather
        for i, (row, (course, t, relief)) in enumerate(zip(rows, samples)):
            z = mix(heights[course], heights[course + 1], t)
            p = cloth_section(z, phi)
            dz = cloth_section(z + .001, phi) - cloth_section(z - .001, phi)
            da = cloth_section(z, phi + .002) - cloth_section(z, phi - .002)
            normal = da.cross(dz).normalized()
            # The lower folds die into the tie at the bare flank. The top
            # course retains the roll of its narrow woven selvedge.
            flank = max(0, -sin(phi)) * max(0, cos(phi))
            weight = (1 - .76 * flank) * (.84 + .16 * sin(pi * (course+t)/courses))
            if course == courses - 1 and .73 <= t < 1:
                # Away from the shoulder this becomes the smooth face of the hem.
                plain = smooth((t - .73) / .27)
                relief = mix(plain, relief, sleeve ** 2)
            # At the anterior shoulder the gathered cloth runs lengthwise.
            # The waist and elbow swags fade into these continuous pleats.
            seam = .149 + .028 * ((z - 1.12) / .36) ** 2
            d = turn - seam
            ends = smooth((z - .69) / .15) * (1 - smooth((z - 1.405) / .046))
            if course == courses - 1:
                ends *= 1 - smooth((t - .84) / .16)
            waist = depth * weight * relief * (1 - .90 * ends * exp(-(d / .053) ** 4))
            long_fold = (.017 * exp(-((d + .012) / .017) ** 2)
                         - .003 * exp(-((d - .008) / .010) ** 2)
                         + .014 * exp(-((d - .029) / .014) ** 2))
            row.append(surf.pt(p + normal * (waist + ends * long_fold)))
            if i == 0 or i == len(rows) - 1:
                normals[int(i > 0)].append((normal, dz.normalized()))
    for a, b in zip(rows, rows[1:]):
        surf.strip(a, b)
    # Round the hems back towards the supporting surface with two loops.
    for edge, directions, sign in ((rows[0], normals[0], -1), (rows[-1], normals[1], 1)):
        previous = edge
        for inset, along in ((.005, .0035), (.019, .001)):
            ring = surf.ring(Vector(surf.points[idx]) - inset * normal + sign * along * tangent
                             for idx, (normal, tangent) in zip(edge, directions))
            surf.strip(previous, ring)
            previous = ring
    return surf.finish("Kasaya over left shoulder and waist", "cloth")


def sleeve_cuff(phone):
    s = Surface()
    n = 14 if phone else 24
    stations = [(0, .150, -.280, .755, .059, .053), (.2, .204, -.244, .767, .067, .060),
                (.45, .271, -.183, .795, .079, .070), (.67, .317, -.115, .834, .082, .080),
                (.84, .327, -.056, .884, .072, .073), (1, .304, -.007, .951, .057, .059)]
    # The loops trace two turned folds from the inside wrist towards the
    # elbow. Sampling their actual crests keeps the reflected strips continuous.
    rolls = [(0, .006), (.032, .008), (.072, -.001), (.15, -.002),
             (.25, .005), (.32, .012), (.355, .008), (.40, -.003),
             (.49, -.003), (.60, .004), (.69, .014), (.73, .010),
             (.78, -.002), (.87, -.002), (1, 0)]
    if phone:
        rolls = [rolls[k] for k in (0,2,5,7,10,12,14)]
    rows = []
    for u, relief in rolls:
        pts = []
        for j in range(n):
            a = TAU * j / n
            t = u + .14 * sin(a - .6) * sin(pi * u)
            x, y, z, width, depth = interpolate(stations, t)
            tangent = (Vector(interpolate(stations, min(1, t + .004))[:3])
                       - Vector(interpolate(stations, max(0, t - .004))[:3])).normalized()
            normal = tangent.cross(Vector((0, 0, 1))).normalized()
            binormal = tangent.cross(normal)
            pts.append(Vector((x, y, z)) + normal * (cos(a) * (width + relief))
                       + binormal * (sin(a) * (depth + relief)))
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
    return s.finish("Turned cuff on the resting forearm", "cloth")


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
    objects = [torso, hands(phone, palm), mantle(phone), sleeve_cuff(phone), feet(phone)]
    # Each error-based reduction operates within one carving. Reserve more
    # faces for the finger pads and for lips that silhouette against the back.
    limits = (490, 1030, 1585, 210, 300) if phone else (1360, 3270, 6990, 790, 970)
    for obj, limit in zip(objects, limits):
        count = sum(len(f.vertices) - 2 for f in obj.data.polygons)
        if count > limit:
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new("Preserve curved profile", "DECIMATE")
            mod.ratio = limit / count
            bpy.ops.object.modifier_apply(modifier=mod.name)
    join_wrist(objects[0], objects[1])
    return [objects[0], *objects[2:], *build_lap(phone)]
