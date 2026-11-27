"""Register a new gilt face to the original standing attendant's scan.

Blender -b -P bodhi_face.py -- directory-with-original-pair output-directory
The cut lists index the original glTF triangles, before Blender splits UV seams.
"""
from collections import Counter
from functools import lru_cache
from math import ceil, exp, pi, sin, sqrt
from pathlib import Path
import json
import struct
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import delaunay_2d_cdt

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bodhi_portrait import FACE, bare_leaf_planes, fy
from buddha_head import bead, profile
from buddha_pigment import (BROW_INNER, BROW_SPAN, EYE_INNER, EYE_SPAN, FACE_AXIS,
                            GILT_SKIN, LIP_RADIUS, brow_height, eyelid_height,
                            lip_height, smooth)


# Keep the scan's cant, high cheekbones, pierced ears and small chin. The two
# measured eyes share a slightly tilted axis under the original crown.
AXIS = -.047
EYE_Z = 1.937
XS, ZS = .83, .80
X_RANGE = (-.21, .12)
Z_RANGE = (1.71, 2.085)


def registered(x, z):
    u = (x-AXIS)/XS
    lift = .0046 * (1-np.exp(-(u/.029)**2)) * np.exp(-((z-1.835)/.022)**2)
    v = 1.680+(z-EYE_Z+.014*(x-AXIS)-lift)/ZS
    return u, v


# Registered height, cheek bed, bridge projection, bridge radius and alar
# cushion (metres). The root and upper lip end on the seated Buddha's cast.
# The dorsum inclines evenly, then rolls over a short tip into the philtrum.
NOSE = [
    (1.566, .040, .040, .019, .0000), (1.573, .040, .043, .018, .0004),
    (1.580, .039, .050, .017, .0020), (1.588, .038, .063, .019, .0095),
    (1.596, .038, .069, .022, .0150), (1.602, .038, .071, .024, .0165),
    (1.609, .037, .070, .026, .0140), (1.619, .036, .066, .029, .0070),
    (1.637, .034, .060, .032, .0014), (1.659, .032, .053, .032, .0000),
    (1.680, .032, .047, .030, .0000), (1.696, .034, .046, .030, .0000),
    (1.706, .035, .047, .030, .0000)]


@lru_cache(maxsize=65536)
def relief_depth(x, z):
    u, v = registered(x, z)
    a = abs(u)
    cast = -.74*fy(u+FACE_AXIS, v)
    if NOSE[0][0] < v < NOSE[-1][0] and a < .076:
        # The alar rims turn up from the septum toward the cheeks. Match their
        # bed to the existing curved cheek section before the shoulder ends.
        rise = .006*smooth(.010,.041,a)*exp(-((v-1.590)/.030)**2)
        bed, ridge, radius, wing = profile(NOSE, v-rise)
        bridge = (ridge-bed)*exp(-(u/radius)**2)
        ala = wing*exp(-((a-.034)/.014)**2)
        cheek_u = .5*(a+.055+sqrt((a-.055)**2+.008**2))
        cheek_bed = -.74*fy((cheek_u if u>=0 else -cheek_u)+FACE_AXIS, v)
        bed += smooth(.029,.062,a)*(cheek_bed-bed)
        # End the wing on a narrow, rounded foot at either side of the septum.
        sill = .0038*exp(-((a-.024)/.010)**2-((v-1.587)/.006)**2)
        blend = (1-smooth(.043,.076,a))*smooth(1.566,1.582,v)*(1-smooth(1.679,1.706,v))
        cast += blend*(bed+bridge+ala-sill-cast)

    # An oblique malar plane runs into the much softer pad over the mandible.
    # Its hollow is lateral to the mouth and dies away ahead of the ear.
    cheek = .0085*exp(-((a-.088)/.036)**2-((v-1.625-.19*(a-.088))/.039)**2)
    hollow = .0030*exp(-((a-.082)/.029)**2-((v-1.572-.30*(a-.082))/.036)**2)
    jaw = .0055*exp(-((a-.073)/.041)**2-((v-1.526-.36*(a-.073))/.035)**2)
    chin = .0048*exp(-(u/.049)**2-((v-1.502)/.028)**2)
    cast += cheek-hollow+jaw+chin

    # Philtral columns fan into the peaks of the existing vermilion. Shape
    # both lip rolls around its painted seam without moving the mouth outline.
    column_x = .009+.005*(1-smooth(1.559,1.577,v))
    philtrum = (.0023*exp(-((a-column_x)/.0065)**2)-.0011*exp(-(u/.006)**2))
    cast += philtrum*exp(-((v-1.568)/.010)**2)
    t = min(1.,a/LIP_RADIUS)
    seam = lip_height(t)
    lip = (1-t*t)**2
    cast += lip*(.0032*exp(-((v-seam-.0055)/.0047)**2)
                 + .0056*exp(-((v-seam+.0064)/.0058)**2))
    return .041+cast-.045*(x-AXIS)


def original(path):
    raw = path.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    desc = json.loads(raw[20:20+length])
    binary = raw[28+length:]
    primitive = desc['meshes'][0]['primitives'][0]

    def array(index, columns):
        accessor = desc['accessors'][index]
        view = desc['bufferViews'][accessor['bufferView']]
        dtype = np.dtype({5126:'<f4', 5123:'<u2', 5125:'<u4'}[accessor['componentType']])
        return np.ndarray((accessor['count'], columns), dtype=dtype, buffer=binary,
                          offset=view.get('byteOffset', 0)+accessor.get('byteOffset', 0),
                          strides=(view.get('byteStride', columns*dtype.itemsize), dtype.itemsize))

    # Work in scan X, elevation and anterior depth until constructing Blender metres.
    vertices = array(primitive['attributes']['POSITION'], 3).astype(float)
    normals = array(primitive['attributes']['NORMAL'], 3).astype(float)
    triangles = array(primitive['indices'], 1).reshape(-1, 3)
    return vertices, normals, triangles


def boundary_segments(polys):
    # glTF duplicates positions across islands. The cut is geometric.
    segments = Counter()
    for poly in polys:
        for a, b in zip(poly, np.roll(poly, -1, axis=0)):
            segments[tuple(sorted((tuple(a), tuple(b))))] += 1
    return np.array([k for k, count in segments.items() if count == 1])


def edge_distance(x, z, segments):
    best = np.full(np.broadcast_shapes(np.shape(x), np.shape(z)), .2)
    for a, b in segments:
        dx, dz = b[:2]-a[:2]
        l2 = dx*dx+dz*dz
        if l2 < 1e-13:
            continue
        t = np.clip(((x-a[0])*dx+(z-a[1])*dz)/l2, 0., 1.)
        best = np.minimum(best, (x-a[0]-t*dx)**2+(z-a[1]-t*dz)**2)
    return np.sqrt(best)


def sampling_sites(phone):
    # A sparse triangular field carries the cheeks. Dedicated strips across
    # both lids, both vermilion rolls and the alae survive in the phone LOD.
    step = .0140 if phone else .0092
    points = []
    for i,z in enumerate(np.arange(1.75, 2.066, step*.86)):
        points += [(x,z) for x in np.arange(AXIS-.15+(i%2)*step*.5, AXIS+.15, step)]
    def source(u,v):
        x = AXIS+XS*u
        level = EYE_Z+ZS*(v-1.680)-.014*(x-AXIS)
        _, test = registered(x,level)
        return x, level+ZS*(v-test)
    for s in (-1,1):
        for t in np.linspace(0,1,13 if phone else 22):
            a = sin(pi*t)
            u = EYE_INNER+EYE_SPAN*t
            lid = eyelid_height(t,a)
            brow = brow_height(t,a)
            points += [source(s*u,lid+offset) for offset in (-.010*a, 0., .008+.006*a, .017+.016*a)]
            points += [source(s*u,brow+offset) for offset in (-.007,.003)]
    for u in np.linspace(-LIP_RADIUS, LIP_RADIUS, 17 if phone else 29):
        t = abs(u)/LIP_RADIUS
        for delta in (-.012*(1-t*t), 0., .0065*(1-t*t)):
            points.append(source(u, lip_height(t)+delta))
    for v in (1.558,1.568,1.577,1.583,1.589,1.596,1.602,1.609,1.619,1.635,1.656,1.680):
        for u in ([-.050,-.034,-.024,-.012,0,.012,.024,.034,.050] if phone else
                  np.linspace(-.054,.054,17)):
            points.append(source(u,v))
    return np.array(points)


def sculpt(path, phone):
    vs, ns, tris = original(path)
    center = vs[tris].mean(axis=1)
    x, z, depth = center.T
    radius = abs(x-AXIS)
    roof = 2.049-.016*(radius/.114)**3
    possible = np.flatnonzero((z>1.745)&(z<roof)&(radius<.139)&(depth>-.041))
    # This is a hollow casting. The inside wall of the head is only a few
    # centimetres behind the eyes, and has its own (inward-facing) triangles.
    tree = BVHTree.FromPolygons(vs.tolist(),tris.tolist(),all_triangles=True)
    cut = [i for i in possible
           if tree.ray_cast((x[i],z[i],.5),(0,0,-1))[2]==i]
    segments = boundary_segments(vs[tris[cut]])
    # The high-resolution scan has a small undercut beneath the original
    # upper lip. All three of its edges are inside the patch. Include it and
    # unfold its projected control triangle before laying on the new lip.
    rim_edges = {tuple(sorted((tuple(a),tuple(b)))) for a,b in segments}
    for i in sorted(set(possible)-set(cut)):
        corners = vs[tris[i]]
        edges = list(zip(corners,np.roll(corners,-1,axis=0)))
        if not all(tuple(sorted((tuple(a),tuple(b)))) in rim_edges for a,b in edges):
            continue
        cut.append(i)
        p = np.argmax([np.linalg.norm(a[:2]-b[:2]) for a,b in edges])
        a,b = edges[p]
        c = corners[(p+2)%3]
        tangent = b[:2]-a[:2]
        outward = np.array([-tangent[1],tangent[0]]) / np.linalg.norm(tangent)
        projection = (c[:2]-a[:2])@outward
        if projection<.001:
            vs[(vs==c).all(axis=1),:2] += (.001-projection)*outward
    segments = boundary_segments(vs[tris[cut]])
    candidates = sampling_sites(phone)
    sites, norms, lookup, faces = [], [], {}, []

    def index(pos, normal):
        key = tuple(np.round(pos, 7))
        if key not in lookup:
            lookup[key] = len(sites)
            sites.append(pos)
            norms.append(normal)
        return lookup[key]

    for tri in tris[cut]:
        src = vs[tri]
        normal = ns[tri]
        xy = src[:,:2]
        # Add the same rim subdivisions to both neighbours, including the
        # boundary. Each new boundary point remains collinear with its scan edge.
        bary = [np.eye(3)[i] for i in range(3)]
        for i in range(3):
            k = (i+1)%3
            length = np.linalg.norm(src[k]-src[i])
            count = ceil(length/(.017 if phone else .013))
            for j in range(1, count):
                b = np.zeros(3)
                b[i], b[k] = 1-j/count, j/count
                bary.append(b)
        basis = xy[1:]-xy[0]
        inside = candidates[((candidates>=xy.min(0))&(candidates<=xy.max(0))).all(axis=1)]
        if abs(np.linalg.det(basis))>1e-8 and len(inside):
            weights = (inside-xy[0]) @ np.linalg.inv(basis)
            weights = np.column_stack((1-weights.sum(1),weights))
            # Avoid a thin triangle where a landmark comes within a fraction
            # of a millimetre of the edge or a regular lattice sample.
            altitudes = abs(np.linalg.det(basis))/np.linalg.norm(xy[[2,0,1]]-xy[[1,2,0]],axis=1)
            for b in weights[(weights*altitudes>.0008).all(axis=1)]:
                if np.linalg.norm((b-np.asarray(bary))@xy, axis=1).min()>.0014:
                    bary.append(b)
        bary = np.array(bary)
        # Triangulate in this triangle's own plane, also on the chin's steep
        # underside. Use a rigid basis so the Delaunay metric stays in metres.
        e1 = src[1]-src[0]
        e1 /= np.linalg.norm(e1)
        up = np.cross(e1,src[2]-src[0])
        up /= np.linalg.norm(up)
        plane = np.stack((e1,np.cross(up,e1)),axis=1)
        flat = (bary@src-src[0])@plane
        _,_,parts,origins,_,_ = delaunay_2d_cdt([Vector(v) for v in flat],[],[],0,1e-7)
        idx = [index(b@src,b@normal) for b in bary]
        for p in parts:
            local = [origins[i][0] for i in p]
            a,b,c = bary[local,1:]
            # Floating-point projections can produce empty slivers joining
            # three collinear edge samples in the CDT's convex hull.
            if np.linalg.det(np.array([b-a,c-a]))>2e-6:
                faces.append(tuple(idx[i] for i in local))

    pts = np.array(sites)
    x,z,d = pts.T.copy()
    rim = edge_distance(x,z,segments)
    u,v = registered(x,z)
    widths = np.array([profile(FACE,h)[0] for h in v])
    mix = smooth(.0002,.023,rim)*(1.-smooth(.86,.985,np.abs(u+FACE_AXIS)/widths))
    target = np.array([relief_depth(float(a),float(b)) for a,b in zip(x,z)])
    pts[:,2] += mix*(target-d)
    mesh = bpy.data.meshes.new('Registered attendant face')
    mesh.from_pydata([(p[0],-p[2],p[1]) for p in pts],[],faces)
    mesh.validate()
    mesh.update()
    mesh.polygons.foreach_set('use_smooth',[True]*len(mesh.polygons))
    obj = bpy.data.objects.new('Attendant face',mesh)
    bpy.context.collection.objects.link(obj)
    # Average normals from the continuous cast even on the smaller phone
    # triangles. Follow the mesh through the blend and the original normals
    # on the exact perimeter where the untouched scan meets this patch.
    normals = []
    for i,(a,b) in enumerate(zip(x,z)):
        source = Vector((norms[i][0],-norms[i][2],norms[i][1])).normalized()
        nasal = exp(-(u[i]/.048)**4-((v[i]-1.601)/.036)**4)
        lip = exp(-(u[i]/.055)**4-((v[i]-1.550)/.028)**4)
        epsilon = .0019+.0018*nasal+.0035*lip
        dx = (relief_depth(a+epsilon,b)-relief_depth(a-epsilon,b))/(2*epsilon)
        dz = (relief_depth(a,b+epsilon)-relief_depth(a,b-epsilon))/(2*epsilon)
        # Filter across as well as along the lip rolls. The mobile mesh also
        # receives the rounded highlight of the cast at the mouth corners.
        if lip>.001:
            q = .0040
            nw,ne = relief_depth(a-q,b+q),relief_depth(a+q,b+q)
            sw,se = relief_depth(a-q,b-q),relief_depth(a+q,b-q)
            dx += .62*lip*((ne+se-nw-sw)/(4*q)-dx)
            dz += .62*lip*((ne+nw-se-sw)/(4*q)-dz)
            dx *= 1-.27*lip
            dz *= 1-.40*lip
        cheek_wall = exp(-((abs(u[i])-.061)/.032)**4-((v[i]-1.634)/.048)**4)
        dx *= 1-.43*cheek_wall
        dz *= 1-.36*cheek_wall
        # Roll the metal over the full width of the dorsum. Steep lateral
        # normals on either side of a narrow spine reflect two separate bands.
        dorsum = exp(-(u[i]/.047)**4-((v[i]-1.655)/.046)**4)
        dx *= 1-.37*dorsum
        dz *= 1-.23*dorsum
        # Gilding rounds the underside over the septum. Preserve the downward
        # turn without reflecting one dark band across the entire nasal base.
        dz -= .38*max(0.,dz)*nasal*exp(-((v[i]-1.586)/.015)**2)
        analytic = Vector((-dx,-1,-dz)).normalized()
        cast = mesh.vertices[i].normal.copy()
        cast = source.lerp(cast, float(smooth(0,.012,rim[i])))
        normals.append(cast.lerp(analytic,float(smooth(.70,.97,mix[i]))).normalized())
    mesh.normals_split_custom_set_from_vertices(normals)
    uv = mesh.uv_layers.new(name='Face portrait')
    for loop in mesh.loops:
        a,b = pts[loop.vertex_index,:2]
        uv.data[loop.index].uv = ((a-X_RANGE[0])/(X_RANGE[1]-X_RANGE[0]),
                                  (b-Z_RANGE[0])/(Z_RANGE[1]-Z_RANGE[0]))
    return obj, [int(i) for i in cut], segments


def painted_leaf(size, segments, phone):
    """Mineral colours on satin leaf, registered to the sculpt in metres."""
    x = X_RANGE[0]+(np.arange(size)[None,:]+.5)/size*(X_RANGE[1]-X_RANGE[0])
    z = Z_RANGE[0]+(np.arange(size)[:,None]+.5)/size*(Z_RANGE[1]-Z_RANGE[0])
    u,v = registered(x,z)
    a = abs(u)
    leaf = np.array(GILT_SKIN[0])
    color = np.broadcast_to(leaf,(size,size,3)).copy()
    orm = np.broadcast_to((1.,.51,.68),color.shape).copy()
    fade = smooth(.001,.016,edge_distance(x,z,segments))

    def glaze(mask, pigment, finish):
        mask = (fade*mask)[...,None]
        color[:] += (pigment-color)*mask
        orm[:] += (finish-orm)*mask

    def spot(cx,cz,rx,rz):
        return np.exp(-((a-cx)/rx)**2-((v-cz)/rz)**2)

    def band(lo,hi,soft):
        return smooth(lo-soft,lo+soft,v)*(1-smooth(hi-soft,hi+soft,v))

    # The cheek high points, the lids and the brow root are gilt. Restrict
    # patination to turns that remain occluded in both altar lighting states.
    glaze(1., leaf, (1.,.58,GILT_SKIN[2]))
    bare_leaf_planes(u, v, spot, glaze)
    satin = np.maximum(spot(.0,1.687,.045,.075),spot(.08,1.695,.072,.094))
    lamp = spot(.0,1.747,.094,.048)
    orm[...,1] += fade*(.12*satin+.08*lamp)
    orm[...,2] += fade*(.94-orm[...,2])*.67*lamp
    # The seated cast's calibrated base factor applies to bare leaf, easing
    # back to the scan at the perimeter and leaving the mineral paints intact.
    base = np.array((.92,.80,.64) if phone else (.77,.79,.64))
    color *= 1.+fade[...,None]*(base-1.)
    glaze(.30*spot(.0,1.532,.042,.008), (.52,.218,.023), (.96,.64,.81))
    t = np.clip((a-EYE_INNER)/EYE_SPAN,0.,1.)
    arc = np.sin(pi*t).clip(0,1)
    lid = eyelid_height(t,arc)
    lower = lid-.0128*arc**.75
    eye = smooth(EYE_INNER-.001,EYE_INNER+.003,a)*(1-smooth(.131,.138,a))
    crease = np.exp(-((v-lid-.015-.024*arc)/.0065)**2)*arc**.70
    glaze(.63*crease, (.51,.244,.055), (.78,.64,.58))
    roll = np.exp(-((v-lid-.009-.011*arc)/.013)**2)*arc
    glaze(.68*roll, (1.,.69,.25), (.99,.49,.69))
    glaze(.35*spot(.050,1.697,.018,.026), (.59,.274,.047), (.84,.60,.60))
    opening = band(lower,lid,.0013)*eye
    glaze(opening, (.46,.271,.106), (.88,.67,.24))
    iris = ((t-.46)/.175)**2+((v-lid+.002)/.0145)**2
    glaze(opening*(1-smooth(.69,1.20,iris)), (.035,.019,.009), (.84,.66,.15))
    lash_width = .0019+.0016*arc**.6
    glaze(band(lid-.48*lash_width,lid+.52*lash_width,.0011)*eye,
          (.025,.014,.008), (.83,.64,.15))
    lower_rim = np.exp(-((v-lower+.0032)/.0038)**2)*arc
    glaze(.47*lower_rim, (.97,.66,.22), (.93,.52,.64))

    t = np.clip((a-BROW_INNER)/BROW_SPAN,0,1)
    arc = np.sin(pi*t).clip(0,1)
    brow = brow_height(t,arc)
    width = (.0093+.002*t)*arc**.60
    ends = smooth(.029,.035,a)*(1-smooth(.132,.139,a))
    glaze(.33*np.exp(-((v-brow+.007)/.009)**2)*arc, (.58,.28,.049), (.88,.62,.58))
    brush = band(brow-.49*width,brow+.51*width,.00145)*ends
    glaze(brush,(.025,.085,.045),(.90,.70,.16))
    glaze(.76*brush*smooth(brow-.30*width-.0001,brow+.26*width+.0001,v),
          (.065,.21,.101), (.94,.68,.17))

    # Carry the cheek's satin leaf across the shaft. Relief and the altar
    # light describe its round crown and leave room for a shadow under each wing.
    shaft = np.exp(-(u/.042)**4-((v-1.651)/.049)**4)
    glaze(.83*shaft, base*(.96,.49,.044), (1.,.63,.87))
    glaze(.31*spot(.034,1.608,.014,.013), base*(.98,.55,.082), (1.,.61,.84))
    underside = 1.581+.008*smooth(.008,.034,a)
    foot = np.exp(-((v-underside)/.0075)**2)*(1-smooth(.032,.046,a))
    glaze(.53*foot, base*(.60,.26,.020), (.96,.68,.78))
    nostril = 1.588+.0034*smooth(.015,.038,a)
    aperture = np.exp(-((a-.0235)/.0105)**2-((v-nostril)/.0048)**2)
    glaze(.83*aperture, base*(.25,.094,.008), (.88,.65,.62))

    t = np.clip(a/LIP_RADIUS,0,1)
    seam = lip_height(t)
    fall = (1-t**2.7)**.83
    top = seam+(.0060+.0040*np.exp(-((t-.39)/.23)**2))*fall
    bottom = seam-.0121*fall
    ends = 1-smooth(.040,.0425,a)
    lips = band(bottom,top,.00145)*ends
    glaze(.56*band(bottom-.0025,top+.0018,.0035)*ends,
          (.63,.173,.034), (.89,.60,.50))
    glaze(lips,(.45,.034,.023), (.94,.60,.18))
    glaze(.84*lips*(1-smooth(seam-.006,seam,v)), (.64,.070,.044), (.98,.49,.21))
    glaze(.49*spot(.007,1.5423,.027,.0034)*lips, (.90,.184,.096), (1.,.48,.25))
    glaze(.76*np.exp(-((v-seam)/.0020)**2)*lips, (.21,.014,.010), (.79,.66,.16))
    glaze(.36*spot(.0,1.724,.011,.006), (.50,.23,.039), (.83,.59,.63))
    return color, orm


def finish(obj, output, tier, segments):
    material = bpy.data.materials.new('bodhisattva_face_gilt')
    material.use_nodes = True
    obj.data.materials.append(material)
    tree = material.node_tree
    shader = next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
    size = 512 if tier=='phone' else 768
    color,orm = painted_leaf(size,segments,tier=='phone')
    color = np.where(color<=.0031308,12.92*color,1.055*color**(1/2.4)-.055)
    for kind,rgb in [('color',color),('orm',orm)]:
        if kind=='orm':
            rgb = rgb.reshape(size//2,2,size//2,2,3).mean(axis=(1,3))
        h,w = rgb.shape[:2]
        name = tier+'-face-'+kind
        image = bpy.data.images.new(name,w,h,alpha=False)
        image.colorspace_settings.name = 'sRGB' if kind=='color' else 'Non-Color'
        rgba = np.ones((h,w,4),dtype=np.float32)
        rgba[:,:,:3] = rgb
        image.pixels.foreach_set(rgba.ravel())
        image.filepath_raw = str(output/(name+'.png'))
        image.file_format = 'PNG'
        image.save()
        node = tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        if kind=='color':
            tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
        else:
            split = tree.nodes.new('ShaderNodeSeparateColor')
            tree.links.new(node.outputs['Color'],split.inputs[0])
            tree.links.new(split.outputs['Green'],shader.inputs['Roughness'])
            tree.links.new(split.outputs['Blue'],shader.inputs['Metallic'])
            group = bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
            group.interface.new_socket('Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
            target = tree.nodes.new('ShaderNodeGroup')
            target.node_tree = group
            tree.links.new(split.outputs['Red'],target.inputs['Occlusion'])


def build(path, output, tier):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    phone = tier=='phone'
    obj, cut, segments = sculpt(path,phone)
    finish(obj,output,tier,segments)
    z = EYE_Z+ZS*(1.730-1.680)
    depth = relief_depth(AXIS,z)
    jewel = bead('Forehead urna',(AXIS,-depth-.0002,z),(.0063,.0047,.0066),
                 'urna',10 if phone else 14,5)
    material = jewel.data.materials[0]
    material.name = 'bodhisattva_urna_gilt'
    shader = next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (.99,.78,.37,1)
    shader.inputs['Roughness'].default_value = .34
    shader.inputs['Metallic'].default_value = .64
    (output/(tier+'-cut.json')).write_text(json.dumps(cut),encoding='utf-8')
    bpy.ops.export_scene.gltf(filepath=str(output/(tier+'-face.glb')),
                              export_format='GLB',export_yup=True,export_cameras=False)
    print(tier,len(cut),'scan triangles replaced by',len(obj.data.polygons),'plus urna')


if __name__=='__main__':
    source,output = [Path(p).resolve() for p in sys.argv[sys.argv.index('--')+1:]]
    output.mkdir(parents=True,exist_ok=True)
    for tier,suffix in [('phone','_phone'),('pc','')]:
        build(source/('lotstatue__lot_temple_hall_bodhisattva'+suffix+'.glb'),output,tier)
