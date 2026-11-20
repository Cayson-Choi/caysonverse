"""Continuous cast pinnae with a rolled helix and a solid pendant lobe."""
from math import ceil, cos, hypot, pi, sqrt

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

from buddha_mesh import mat


# In the registered profile u increases toward the nape and v toward the jaw.
# Each section gives v, anterior/posterior u, lateral centre and radius (metres).
OUTLINE = [
    (13, 94, 94, .161, .000), (18, 75, 113, .164, .013),
    (31, 59, 131, .167, .023), (52, 50, 140, .169, .028),
    (76, 47, 145, .169, .030), (95, 47, 147, .168, .031),
    (113, 48, 147, .167, .031), (138, 50, 145, .165, .031),
    (165, 51, 141, .161, .031), (202, 50, 136, .155, .030),
    (239, 49, 132, .149, .029), (269, 48, 131, .145, .030),
    (292, 48, 131, .145, .031), (311, 52, 127, .147, .030),
    (326, 63, 117, .148, .024), (334, 77, 103, .147, .014),
    (337, 90, 90, .147, .000),
]
YU, ZV = .000923, .000879
EAR_Y, EAR_Z = .175, 1.751
TILT = .00031
FOOT_CURVE = .009/87**2


def ear_height(v):
    return EAR_Z-ZV*(v-17)-FOOT_CURVE*np.maximum(0.,v-250)**2


def ear_row(z):
    delta = ear_height(250)-z
    if delta<=0:
        return 17+(EAR_Z-z)/ZV
    return 250+2*delta/(ZV+sqrt(ZV**2+4*FOOT_CURVE*delta))


def cartilage(u, v):
    """Roll the helix around one broad fossa and a small, soft concha."""
    fossa = np.exp(-((u-92)/31)**2-((v-67)/36)**2)
    concha = np.exp(-((u-79-.055*(v-121))/15)**2-((v-121)/22)**2)
    # Two rounded sweeps give the inner ear its shape. The short anterior
    # return of the helix reaches over the concha and melts into the cheek.
    helix = [(68,132),(73,128),(75,120),(71,112),(63,104),(56,93),
             (54,78),(56,61),(62,46),(73,32),(85,24),(97,23),
             (110,31),(122,42),(131,56),(137,76),(139,99),
             (137,122),(133,146),(129,161)]
    antihelix = [(74,146),(83,145),(91,139),(96,129),(98,117),
                 (96,106),(91,96),(84,89),(76,85),(71,88)]
    crests = np.zeros(np.broadcast_shapes(u.shape, v.shape))
    # Integrate a Gaussian brush along the arcs. Its gradient stays smooth at
    # the ends of each fold as well as where the individual segments meet.
    for path, amplitude, width in [(helix,.013,12.0),(antihelix,.010,10.)]:
        for i, ((x,y),(bx,by)) in enumerate(zip(path,path[1:])):
            dx,dy = bx-x,by-y
            length = hypot(dx,dy)
            steps = ceil(length/(width*.5))
            for j in range(steps):
                q = (j+.5)/steps
                d2 = (u-x-q*dx)**2+(v-y-q*dy)**2
                fade = min(1.,(i+q)/1.4,(len(path)-1-i-q)/1.4)
                crests += amplitude*length/(steps*width*sqrt(pi))*fade*np.exp(-d2/width**2)
    # The pendant retains a shallow, wide thumb-shaped hollow in its upper
    # half. It runs out before the rounded foot, which is solid throughout.
    hollow = .0029*np.exp(-((u-87)/25)**2-((v-223)/52)**2)
    return crests-.014*fossa-.016*concha-hollow, (fossa,concha,crests)


def make_ears(phone):
    from buddha_head import profile

    top, foot = OUTLINE[0][0], OUTLINE[-1][0]
    rows = sorted(set([v for v,*_ in OUTLINE]+
                      [top+(foot-top)*(.5-.5*cos(pi*i/112)) for i in range(113)]))
    v = np.asarray(rows[1:-1])[:,None]
    left,right,cx,rx = np.array([profile(OUTLINE,t) for t in rows[1:-1]]).T[:,:,None]
    # Each ring closes around the posterior edge. The medial return nestles
    # into the head down to the jaw, underneath the visible pendant.
    angle = np.linspace(0,2*pi,80,endpoint=False)[None,:]
    u = .5*(right+left)-.5*(right-left)*np.cos(angle)
    radial = np.sin(angle)
    attach = (.022*np.exp(-((v-115)/89)**4)
              +.043*np.exp(-((v-249)/83)**4)*np.clip((321-v)/47,0,1)**2)
    sculpt,_ = cartilage(u,v)
    # The game mesh carries the bowl and its silhouette. The tangent map
    # supplies the fine return of the helix where it crosses the bowl.
    detail = np.exp(-((u-80)/35)**4-((v-123)/42)**4)
    sculpt *= 1.-.45*detail
    x = cx+TILT*(u-.5*(left+right))+radial*(rx+np.where(radial>0,sculpt,attach))
    y = EAR_Y+YU*(u-92)
    z = np.broadcast_to(ear_height(v),x.shape)
    vertices = np.stack((x,y,z),axis=-1).reshape(-1,3).tolist()
    count,columns = x.shape
    first,last = len(vertices),len(vertices)+1
    for t in [rows[0],rows[-1]]:
        edge,_,center,_ = profile(OUTLINE,t)
        vertices.append((center,EAR_Y+YU*(edge-92),ear_height(t)))
    faces = []
    for k in range(columns):
        j = (k+1)%columns
        faces.append((first,j,k))
        for i in range(count-1):
            upper = i*columns
            lower = upper+columns
            faces.append((upper+k,upper+j,lower+j,lower+k))
        faces.append(((count-1)*columns+k,(count-1)*columns+j,last))

    for side in (1,-1):
        mesh = bpy.data.meshes.new("Cast ear with a solid pendant lobe")
        mesh.from_pydata([(side*x,y,z) for x,y,z in vertices],[],
                         [f[::-1] for f in faces] if side>0 else faces)
        mesh.materials.append(mat("skin"))
        mesh.update()
        mesh.polygons.foreach_set("use_smooth",[True]*len(mesh.polygons))
        obj = bpy.data.objects.new(mesh.name,mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        tree = KDTree(len(mesh.vertices))
        normals = []
        for vert in mesh.vertices:
            tree.insert(vert.co,vert.index)
            normals.append(vert.normal.copy())
        tree.balance()
        decimate = obj.modifiers.new("Retain the rounded helix and lobe","DECIMATE")
        count = sum(len(p.vertices)-2 for p in mesh.polygons)
        decimate.ratio = (140 if phone else 425)/count
        decimate.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        smooth = []
        for vert in obj.data.vertices:
            normal = Vector((0.,0.,0.))
            for _,index,distance in tree.find_n(vert.co,5):
                normal += normals[index]/(.0007+distance)**2
            smooth.append(normal.normalized())
        obj.data.normals_split_custom_set_from_vertices(smooth)
        ear_finish = bpy.data.materials.get("Auricular relief")
        if ear_finish is None:
            ear_finish = mat("skin").copy()
            ear_finish.name = "Auricular relief"
        obj.data.materials.append(ear_finish)
        for polygon in obj.data.polygons:
            x,y,z = polygon.center
            u = 92+(y-EAR_Y)/YU
            lo,hi,mid,_ = profile(OUTLINE,ear_row(z))
            # The chart covers the entire lateral surface, including the
            # steep inner face of the helix which folds back over the bowl.
            if side*x >= mid+TILT*(u-.5*(lo+hi)):
                polygon.material_index = 1
