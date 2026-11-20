"""The two cast pinnae, traced in profile with a pierced pendant lobule."""
from math import cos, exp, pi, sqrt

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree
from buddha_mesh import mat


# The drawing faces left: u increases toward the nape and v toward the jaw.
# v, anterior and posterior outlines, mid-thickness x and half-thickness (metres).
OUTLINE = [
    (17, 90, 90, .163, .000), (21, 72, 106, .166, .014),
    (33, 58, 122, .169, .023), (52, 50, 134, .171, .028),
    (76, 48, 141, .171, .030), (95, 51, 144, .170, .030),
    (113, 53, 144, .169, .031), (138, 54, 142, .168, .031),
    (165, 55, 138, .165, .030), (202, 54, 132, .162, .027),
    (239, 53, 127, .158, .025), (269, 52, 127, .155, .026),
    (292, 52, 128, .154, .029), (311, 56, 124, .153, .030),
    (326, 66, 115, .153, .024), (334, 80, 102, .154, .014),
    (337, 91, 91, .154, .000),
]
YU, ZV = .000923, .000842
# Cartilage crests in the same drawing. The helix rolls from its anterior root
# over the crown and feathers down the posterior margin into the pendant.
HELIX = [(78,121),(77,113),(68,107),(59,97),(55,83),(56,64),(62,48),
         (73,35),(88,29),(102,31),(116,40),(126,54),(132,74),(135,96),
         (135,118),(132,142),(128,160)]
ANTIHELIX = [(81,143),(88,140),(95,132),(99,121),(98,109),(92,98),
             (83,91),(77,84),(77,76),(82,70),(91,69),(101,72),(112,84)]
SUPERIOR_CRUS = [(78,85),(76,76),(79,66),(85,58),(92,55)]
TRAGUS = [(61,116),(65,120),(68,126),(67,133)]

# Both mouths taper at the ends. Narrowing the medial opening makes a real,
# shaded piercing through the lobe, with a rolled edge on the lateral surface.
SLIT_V, SLIT_LENGTH = 235., 52.


def slit_axis(v):
    return 87.5 + .08*(v-SLIT_V)


def relief(u, v, lines):
    # A broad depression beneath the helix blends into the deeper auditory
    # concha. The anterior root separates its aperture from the upper fossa.
    bowl = -.018*exp(-((u-95)/34)**2-((v-79)/36)**2)
    canal = -.017*exp(-((u-80)/12)**2-((v-128)/14)**2)
    bank = -.005*exp(-((u-slit_axis(v))/8.)**2-((v-SLIT_V)/60)**4)
    height = bowl + canal + bank
    for segments, amplitude, width in lines:
        best = 1.e8
        fade = 0.
        for ax,ay,dx,dy,length2,start,end in segments:
            q = min(1., max(0., ((u-ax)*dx+(v-ay)*dy)/length2))
            d2 = (u-ax-q*dx)**2+(v-ay-q*dy)**2
            if d2 < best:
                best = d2
                fade = start+q*(end-start)
        height += amplitude*fade*exp(-best/(width*width))
    return height


def cartilage():
    result = []
    for path, amplitude, width in [(HELIX,.014,8.7),(ANTIHELIX,.012,8.9),
                                   (SUPERIOR_CRUS,.003,5.8),(TRAGUS,.010,6.8)]:
        segments = []
        for i, ((x,y),(bx,by)) in enumerate(zip(path,path[1:])):
            dx,dy = bx-x, by-y
            start = min(1.,(i+0.7)/2.,(len(path)-i-.4)/2.)
            end = min(1.,(i+1.7)/2.,(len(path)-i-1.4)/2.)
            segments.append((x,y,dx,dy,dx*dx+dy*dy,start,end))
        result.append((segments,amplitude,width))
    return result


def make_ears(phone):
    from buddha_head import profile
    lines = cartilage()

    # Resolve every horizontal section of the sculpture before reducing it for
    # the two devices. The frontmost ear outline and the lip of the piercing
    # are then sampled independently of the winding of the cartilage ridges.
    vertices, faces = [], []
    bands = 24
    rows = sorted(set([v for v,*_ in OUTLINE]+[SLIT_V-SLIT_LENGTH,SLIT_V+SLIT_LENGTH]+
                      [17+320*(.5-.5*cos(pi*i/156)) for i in range(157)]))
    previous = None
    for v in rows:
        left,right,cx,rx = profile(OUTLINE,v)
        if right-left < .001:
            tip = len(vertices)
            vertices.append((cx,.176+YU*(left-92),1.748-ZV*(v-17)))
            if previous is None:
                previous = [tip]*(4*bands+2)
            else:
                for a,b in zip(previous,previous[1:]+previous[:1]):
                    if a!=b:
                        faces.append((a,b,tip))
            continue
        # Tuck the medial root under the temple. The gently convex back rolls
        # under the outer rim; the return is thicker through the attachment.
        attach = .021*exp(-((v-112)/64)**4)
        axis = min(right,max(left,slit_axis(v)))
        spread = 1.7*sqrt(max(0.,1.-((v-SLIT_V)/SLIT_LENGTH)**2))
        us = []
        for a,b in ((left,axis-spread),(axis+spread,right)):
            us.extend(a+(b-a)*(.5-.5*cos(pi*k/bands)) for k in range(bands+1))
        thickness = [sqrt(max(0.,1.-((2*u-left-right)/(right-left))**2)) for u in us]
        detail = [relief(u,v,lines) for u in us]
        tilt = [.00018*(u-(left+right)/2) for u in us]
        # The traced front envelope is cx+rx. Broadening an inner fold should
        # not create a second outward point in the silhouette at the tragus.
        level = max(rx+h+(t-rx)/w for h,t,w in zip(detail,tilt,thickness) if w>.01)
        row = []
        by_point = {}
        def point(x,u):
            key = round(u,6),round(x,7)
            if key not in by_point:
                by_point[key] = len(vertices)
                vertices.append((x,.176+YU*(u-92),1.748-ZV*(v-17)))
            return by_point[key]
        for u,w,h,t in zip(us,thickness,detail,tilt):
            row.append(point(cx+t+w*(rx+h-level),u))
        # Coincident slit ends on either surface share one vertex. The outer
        # silhouette is similarly shared where the lateral/medial sheets meet.
        for index in reversed(range(1,len(us)-1)):
            row.append(point(cx+tilt[index]-thickness[index]*(rx+attach),us[index]))
        for i,(a,b) in enumerate(zip(previous,previous[1:]+previous[:1])):
            j = (i+1)%len(row)
            # The paired bank samples are separated only within the aperture.
            if i in (bands,3*bands+1):
                continue
            face = tuple(dict.fromkeys((a,b,row[j],row[i])))
            if len(face)>2:
                faces.append(face)
        if spread or len(set(previous))==len(previous):
            left_bank, right_bank = bands,bands+1
            rear_left,rear_right = 3*bands+2,3*bands+1
            for f in [(previous[left_bank],row[left_bank],row[rear_left],previous[rear_left]),
                      (previous[right_bank],previous[rear_right],row[rear_right],row[right_bank])]:
                if len(set(f))>2:
                    faces.append(tuple(dict.fromkeys(reversed(f))))
        previous = row

    # In this drawing v runs downward, so the lateral skin follows the
    # opposite winding from a surface swept from the bottom up.
    for side in (1,-1):
        mesh = bpy.data.meshes.new("Cast ear with a pierced lobe")
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
        decimate = obj.modifiers.new("Preserve the rolled rim and pierced pendant","DECIMATE")
        count = sum(len(p.vertices)-2 for p in mesh.polygons)
        decimate.ratio = (158 if phone else 427)/count
        decimate.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        smooth = []
        for vert in obj.data.vertices:
            normal = Vector((0.,0.,0.))
            for _,index,distance in tree.find_n(vert.co,5):
                normal += normals[index]/(.0007+distance)**2
            smooth.append(normal.normalized())
        obj.data.normals_split_custom_set_from_vertices(smooth)
        # Give only the lateral surface its spatial normals and recess finish.
        ear_finish = bpy.data.materials.get("Auricular relief")
        if ear_finish is None:
            ear_finish = mat("skin").copy()
            ear_finish.name = "Auricular relief"
        obj.data.materials.append(ear_finish)
        for polygon in obj.data.polygons:
            if side*polygon.normal.x > .12:
                polygon.material_index = 1
