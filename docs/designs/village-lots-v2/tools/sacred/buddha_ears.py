"""Model both auricles in a local plane facing slightly forward, in millimetres."""
from math import cos, exp, pi, sin

import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

from buddha_mesh import mat


# From the round lobule, around the posterior helix and back past the root.
# Coordinates run from anterior to posterior, and from jaw to brow.
OUTLINE = [
    (-8, 0), (8, 1), (19, 8), (25, 21), (26, 40), (22, 68),
    (21, 94), (25, 120), (33, 150), (41, 183), (42, 210),
    (36, 231), (23, 247), (6, 254), (-11, 252), (-26, 242),
    (-35, 226), (-38, 208), (-34, 190), (-31, 182), (-36, 173),
    (-36, 160), (-29, 147), (-26, 128), (-25, 102), (-26, 76),
    (-31, 45), (-31, 25), (-26, 11), (-18, 4),
]


def curve(points, closed=False):
    """Interpolate the outline and the landmarks before triangulating the carving."""
    points = [Vector(p) for p in points]
    result = []
    count = len(points)
    for i in range(count if closed else count - 1):
        a = points[(i-1) % count] if closed or i else points[0]
        b, c = points[i], points[(i+1) % count]
        d = points[(i+2) % count] if closed else points[min(i+2, count-1)]
        result.extend((b, (9*(b+c)-a-d)/16))
    if not closed:
        result.append(points[-1])
    return result


def blend(low, high, z):
    t = min(1., max(0., (z-low)/(high-low)))
    return t*t*(3-2*t)


def fill_relief(coords, depths, outline, slit):
    """Fair the skin between landmarks with a thin-plate spline in the ear plane."""
    samples, indices = np.unique(np.asarray(coords), axis=0, return_index=True)
    def kernel(a, b):
        squared = np.sum((a[:, None]-b)**2, axis=-1)
        return .5*squared*np.log(np.maximum(squared, 1e-12))

    poly = np.column_stack((np.ones(len(samples)), samples))
    bending = kernel(samples, samples) + 8*np.eye(len(samples))
    system = np.block([[bending, poly], [poly.T, np.zeros((3, 3))]])
    weights = np.linalg.solve(system, np.r_[np.asarray(depths)[indices], 0, 0, 0])
    grid = [Vector((u + 2.5*(row % 2), z))
            for row, z in enumerate(range(5, 254, 5)) for u in range(-38, 44, 5)]
    def inside(p, loop):
        hits = 0
        for i, a in enumerate(loop):
            b = loop[i-1]
            if (a.y > p.y) != (b.y > p.y):
                hits += p.x < a.x + (b.x-a.x)*(p.y-a.y)/(b.y-a.y)
        return hits % 2

    grid = [p for p in grid if inside(p, outline) and not inside(p, slit)]
    xy = np.asarray(grid)
    values = kernel(xy, samples) @ weights[:-3] + weights[-3] + xy @ weights[-2:]
    return grid, values


def make_ears(phone):
    # CDT keeps triangles aligned along the hand-drawn crests and valleys.
    # The front and back share their outline and the wall of the piercing.
    for side in (1, -1):
        vertices, faces = [], []
        def point(u, z, depth):
            x = 153 + 23*blend(24, 197, z) + .48*u + .877*depth
            x += 3.5*blend(0, 17, z)*(1-blend(31, 68, z))*blend(-15, 15, u)
            x += 4*blend(176, 236, z)*(1-blend(5, 40, u))
            y = 34 + 12*blend(120, 208, z) + (1+.075*blend(140, 209, z))*u - .48*depth
            height = 1456 + z + 16*blend(145, 248, z)
            # The underside of the upper fold passes just outside the curls.
            # Keep the concha continuous where a curl meets the back of it.
            x += 3.5*exp(-((y-33)/21)**2-((height-1699)/19)**2)*blend(-18, -5, depth)
            vertices.append((side*x*.001, y*.001, height*.001))
            return len(vertices)-1

        outline = curve(OUTLINE, closed=True)
        inward = []
        for i in range(len(outline)):
            tangent = (outline[(i+1) % len(outline)]-outline[i-1]).normalized()
            inward.append(Vector((-tangent.y, tangent.x)))
        boundary = [point(*p, 0) for p in outline]

        # The slit broadens slightly at the weight-bearing bottom. Both lips
        # turn into the tunnel. Its axis continues behind the inclined ear.
        slit = []
        for k in range(20):
            a = 2*pi*k/20
            slit.append(Vector((.8 + 2.0*sin(a) + (5.1-1.4*sin(a))*cos(a),
                                68 + 36*sin(a))))
        hole_rings = []
        for back in (False, True):
            coords, ids, depths_at_coords, edges, borders = [], [], [], [], []
            def path(points, depths, closed=False, shared=None):
                start = len(coords)
                for k, (p, depth) in enumerate(zip(points, depths)):
                    coords.append(Vector(p))
                    depths_at_coords.append(depth)
                    ids.append(point(*p, depth) if shared is None else shared[k])
                    if k:
                        edges.append((start+k-1, start+k))
                if closed:
                    edges.append((len(coords)-1, start))
                return list(range(start, len(coords)))

            borders.append(path(outline, [0]*len(outline), True, boundary))
            hole_depths = [-11 if back else 8 for p in slit]
            borders.append(path(slit, hole_depths, True))
            hole_rings.append([ids[j] for j in borders[1]])
            # A rounded lip, shallow scapha and fleshy lobe all flow into
            # the same perimeter. The conchal edge is open at the tragus.
            for band in ((0,) if back else (0,1)):
                inset, depths = [], []
                for p, normal in zip(outline, inward):
                    u, z = p
                    upper = blend(125, 185, z)
                    anterior = 1-blend(-30, -10, u)
                    if back:
                        width = 5
                        depth = -9 - anterior*(12 + 26*(1-blend(30, 105, z)))*blend(4, 29, z)
                    elif band == 0:
                        width = 4.0 + 1.1*upper
                        depth = 7.3 + 2.7*upper - 3*anterior
                    else:
                        width = 11.0 + 2.4*upper
                        depth = 12.0 - 14.0*upper - 2.5*anterior
                    inset.append(p + width*normal)
                    depths.append(depth)
                path(inset, depths, True)

            # A pierced surface needs a small rolled bevel on *both* sides
            # to catch the light, even when the head occludes the exit.
            lip = [Vector((.8+(p.x-.8)*1.63, 68+(p.y-68)*1.11)) for p in slit]
            path(lip, [-13 if back else 12 for p in lip], True)

            # u, height and outward relief of each anatomical landmark.
            if back:
                strokes = [
                    [(-12,17,-66),(-14,26,-58),(-14,36,-46),(-14,64,-39),(-13,100,-31),(-11,134,-27),
                     (-8,173,-30),(-5,203,-30),(2,231,-24)],
                    [(13,42,-16),(13,76,-15),(12,116,-18),(19,167,-19),(27,201,-15)],
                ]
            else:
                strokes = [
                    # Antihelix sweeps up the back of the bowl and forks
                    # into a short transverse crus and the longer upper crus.
                    [(-13,143,8),(-4,147,10),(7,158,11),(12,175,12),
                     (12,189,11),(7,201,10),(-3,206,8),(-14,204,4)],
                    [(12,189,11),(16,202,8),(18,217,6),(14,229,3)],
                    [(1,213,1),(6,220,-2),(8,230,0)],
                    [(21,157,3),(25,177,1),(27,197,-2),(25,216,-1)],
                    # Bowl floor and the anterior helix root, which turns
                    # back into the bowl above the small, projecting tragus.
                    [(-16,154,0),(-11,160,-5),(-8,172,-8),(-9,180,-6)],
                    [(-20,195,3),(-13,191,5),(-8,187,3),(-5,183,0)],
                    [(-19,157,3),(-18,163,8),(-17,168,11),(-17,172,10),(-16,176,5)],
                    [(-9,124,11),(-3,132,9),(6,136,7),(11,140,6)],
                ]
            for stroke in strokes:
                samples = curve(stroke)
                path([p.xy for p in samples], [p.z*(1 if back else .80) for p in samples])

            if not back:
                samples, values = fill_relief(coords, depths_at_coords, outline, slit)
                for p, depth in zip(samples, values):
                    coords.append(p)
                    ids.append(point(*p, depth))
            _, _, triangles, origins, _, regions = delaunay_2d_cdt(coords, edges, borders, 0, 1e-5)
            for tri, owners in zip(triangles, regions):
                if 0 not in owners or 1 in owners:
                    continue
                if any(not origins[k] for k in tri):
                    raise ValueError("Intersecting ear carving contours")
                face = tuple(ids[origins[k][0]] for k in tri)
                faces.append(face[::-1] if back else face)

        front, back = hole_rings
        for i in range(len(slit)):
            j = (i+1) % len(slit)
            faces.append((front[i], front[j], back[j], back[i]))
        if side < 0:
            faces = [f[::-1] for f in faces]
        mesh = bpy.data.meshes.new("Carved auricle and pierced lobule")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        mesh.materials.append(mat("skin"))
        mesh.polygons.foreach_set("use_smooth", [True]*len(mesh.polygons))
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        rounding = obj.modifiers.new("Round the cartilage and the lips of the slit", "SUBSURF")
        rounding.levels = 1
        bpy.ops.object.modifier_apply(modifier=rounding.name)
        # Keep the cast surface's smooth reflections on the lower resolution
        # game shell, including the change of normal across the helix lip.
        sculpt = obj.copy()
        sculpt.data = obj.data.copy()
        bpy.context.collection.objects.link(sculpt)
        modifier = obj.modifiers.new("Retain the rim and piercing at game scale", "DECIMATE")
        total = sum(len(p.vertices)-2 for p in obj.data.polygons)
        modifier.ratio = min(1., (217 if phone else 640)/total)
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        shading = obj.modifiers.new("Normals from the rounded carving", "DATA_TRANSFER")
        shading.object = sculpt
        shading.use_loop_data = True
        shading.data_types_loops = {"CUSTOM_NORMAL"}
        shading.loop_mapping = "POLYINTERP_NEAREST"
        bpy.ops.object.modifier_apply(modifier=shading.name)
        bpy.data.objects.remove(sculpt, do_unlink=True)
