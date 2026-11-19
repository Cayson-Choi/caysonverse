"""Original sculpt of the central Buddha, in metres with the face toward -Y."""
from bisect import bisect_right
from math import atan2, cos, exp, pi, sin, sqrt
import bpy
from mathutils import Vector
from buddha_ears import make_ears
from buddha_mesh import mat
from buddha_pigment import brow_height, eyelid_height


def surface(name, vertices, faces, material):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat(material))
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def profile(rows, z):
    """Shape-preserving interpolation between sculptor's cross-sections."""
    zs = [row[0] for row in rows]
    i = max(0, min(len(zs)-2, bisect_right(zs, z)-1))
    h = zs[i+1]-zs[i]
    t = max(0., min(1., (z-zs[i])/h))
    def slope(j,c):
        if j in (0,len(zs)-1):
            k=min(j,len(zs)-2)
            return (rows[k+1][c]-rows[k][c])/(zs[k+1]-zs[k])
        a=(rows[j][c]-rows[j-1][c])/(zs[j]-zs[j-1])
        b=(rows[j+1][c]-rows[j][c])/(zs[j+1]-zs[j])
        return 2*a*b/(a+b) if a*b>0 else 0.
    return tuple((1-t)**2*(1+2*t)*rows[i][c]+t*t*(3-2*t)*rows[i+1][c]
                 +t*(1-t)*h*((1-t)*slope(i,c)-t*slope(i+1,c))
                 for c in range(1,len(rows[0])))


def connect(fs,n,rows,offset=0):
    for j in range(rows-1):
        for k in range(n):
            p=offset+j*n
            l=(k+1)%n
            fs.append((p+k,p+l,p+n+l,p+n+k))


def cap(fs,n,length):
    fs.extend((tuple(reversed(range(n))),tuple(range(length-n,length))))


# Front and left profile are registered to a common orthographic camera in
# buddha_measure.mjs. Section rows below use the left-profile image ordinates.
# The nose/philtrum and skull have distinct contours, joined in the same mesh.
HEAD_X = -.008
PIXELS_PER_METRE = 265.
PROFILE_ORIGIN = 576.
GROUND_ROW = 551.5
CAMERA_PITCH = .068


def section_z(image_row):
    return (GROUND_ROW-image_row)*sqrt(1+CAMERA_PITCH**2)/PIXELS_PER_METRE


def depth(image_column):
    return (image_column-PROFILE_ORIGIN)/PIXELS_PER_METRE


# Profile row, frontal skull half-width (px), anterior facial plane and occiput.
# The short underside of the chin turns back toward the narrow neck.
SECTIONS = [
    (171.0, 5, 592, 602), (169.8, 12, 584, 607), (168, 18.5, 579.5, 614),
    (165, 24, 574.5, 622), (162, 28, 571.4, 630), (158, 32, 569.2, 635),
    (154, 34.7, 568.0, 640), (150, 36.8, 567.2, 643), (147, 38.0, 566.8, 645),
    (142, 39.4, 566.2, 648), (136, 40.8, 565.7, 650), (130, 41.8, 565.2, 652),
    (122, 42.3, 564.3, 654), (115, 42.5, 563.1, 657), (108, 42.5, 561.7, 658),
    (103, 42.5, 560.8, 659), (96, 42.6, 559.9, 660), (90, 42.6, 559.8, 660),
    (82, 42.6, 560.3, 659), (75, 42, 561, 658), (65, 39, 565, 652),
    (55, 34, 572, 648), (45, 24, 583, 637), (38, 10, 600, 622)]
SKULL = [(section_z(v), w/PIXELS_PER_METRE, depth(f), depth(b)) for v,w,f,b in SECTIONS]

# Actual profile of the small nasal bulb and the shallow S below it. The bridge
# slopes nearly linearly from the root before flattening into the rounded tip.
PROFILE_EDGE = [
    (171,592),(169.8,584),(168,579.5),(165,573.5),(162,569),(158,566.3),
    (154,565.3),(150,565.55),(148.5,565.2),(147.1,563.6),(145.5,562.4),
    (143.0,561.4),(141.8,562.0),(140.6,560.8),(139.5,560.6),(138,560.9),
    (136.2,559.8),(134.7,557.7),(133.4,554.9),(132.1,553.3),(130.1,551.4),
    (128.1,550.7),(125.2,550.9),(122.5,551.5),(118,553.5),(114,555.6),
    (110,557.7),(106,559.5),(102,560),(96,559.9),(90,559.8),(82,560.3),
    (75,561),(65,565),(55,572),(45,583),(38,600)]
MIDLINE = [(section_z(v),depth(u)) for v,u in PROFILE_EDGE]


def eye_line(x):
    t=max(0., min(1., (abs(x)-.031)/.099))
    return eyelid_height(t, sin(pi*t))


def lip_line(x):
    t=min(1., abs(x)/.0435)
    return 1.553 + .0025*t*t - .00115*exp(-(t/.23)**2)


def relief(x,z):
    a=abs(x)
    def paired(offset,height,width,radius):
        return (exp(-((x-offset)/width)**2)+exp(-((x+offset)/width)**2))*exp(-((z-height)/radius)**2)

    t=max(0.,min(1.,(a-.031)/.099))
    arc=sin(pi*t)
    lid=eye_line(x)
    fold=lid+.006+.015*arc
    brow=brow_height(t,arc)
    socket=arc*(.008*exp(-((z-brow)/.016)**2)-.006*exp(-((z-brow+.014)/.015)**2))
    lids=arc*(.012*exp(-((z-lid-.008)/.013)**2)-.002*exp(-((z-fold)/.005)**2)
              +.003*exp(-((z-lid+.009)/.009)**2))
    return (socket+lids + .015*paired(.089,1.621,.053,.057)
            + .008*paired(.088,1.571,.058,.051)
            + .005*paired(.111,1.690,.039,.023)
            + .024*paired(.025,1.604,.012,.017) - .009*paired(.020,1.590,.0065,.0065)
            + .004*paired(.009,1.569,.008,.013))


def fy(x,z):
    w,front,back=profile(SKULL,z)
    q=min(.99999,abs(x)/w)
    outline=profile(MIDLINE,z)[0]
    bulb=exp(-((z-1.607)/.018)**2)
    muzzle=1/(1+exp(min(80.,(z-1.576)/.0035)))
    chin=1/(1+exp(min(80.,(z-1.517)/.010)))
    spread=.016 + .005*bulb + .005*exp(-((z-1.70)/.034)**2) + .022*muzzle + .047*chin
    # The columella tapers between two shallow, separate narial pockets.
    spread -= .0078*exp(-((z-1.584)/.012)**2)
    # A round section at the bulb becomes a narrow dorsal ridge near the eyes.
    ridge=(front-outline)*exp(-(abs(x)/spread)**(2+.38*bulb))
    center=.5*(front+back)
    return center-(center-front)*(1-q*q)**.50-(ridge+relief(x,z)-relief(0,z))*(1-q*q)**.65

def make_face(phone):
    front=([0,.065,.132,.20,.285,.42,.57,.74,.94,1.18,pi/2] if phone else
           [0,.038,.074,.11,.15,.19,.235,.29,.355,.435,.52,.625,.74,.87,1.01,1.17,1.36,pi/2])
    back=3 if phone else 5
    half=front+[pi/2+pi/2*k/back for k in range(1,back+1)]
    angles=half+[-a for a in reversed(half[1:-1])]
    # Carry each horizontal edge through the measured lips and nasal underside;
    # only the hidden rear of the cranium uses widely spaced sections.
    rows = [171,169.8,168,165,162,158,154,150,147.1,145.5,143,141.8,140.6,138,
            136.2,134.7,133.4,132.1,130.1,128.1,125.2,122.5,118,114,110,106,
            103,100,96,92,86,80,72,59,45,38]
    if not phone:
        rows += [167,160,156,152,148.5,146.4,144,139.5,137,135.4,131.1,126.5,
                 121,116,112,108,104.5,101,98,94,89,83,76]
    zs=sorted(section_z(v) for v in rows)
    vs,fs=[],[]
    for z in zs:
        w,f,b=profile(SKULL,z)
        for a in angles:
            x=w*sin(a)
            height=z
            if cos(a)>.0001:
                # Carry the dense muzzle and eyelid loops along their actual
                # contours so the low LOD keeps a lip seam and a lower lid.
                height+=(lip_line(x)-1.553)*exp(-(x/.053)**4-((z-1.553)/.019)**2)
                height+=(eye_line(x)-1.676)*exp(-((abs(x)-.084)/.062)**4-((z-1.676)/.021)**2)
                y=fy(x,height)
            else:
                y=(f+b)/2-(b-f)/2*cos(a)
            vs.append((x,y,height))
    connect(fs,len(angles),len(zs))
    cap(fs,len(angles),len(vs))
    # Remove surfaces fully hidden inside the hair shell in both game LODs.
    buried=[z>hair_floor(a)+.018 for z in zs for a in angles]
    fs=[f for f in fs if not all(buried[i] for i in f)]
    obj=surface('Oval with integrated eyelids, nose and lips',vs,fs,'skin')
    # Only the front gets the planar pigment island. The nape and underside
    # retain their original gold even where their projected UVs would overlap.
    pigment=mat('skin').copy()
    pigment.name='Face pigment'
    obj.data.materials.append(pigment)
    for polygon in obj.data.polygons:
        _,f,b=profile(SKULL,polygon.center.z)
        if polygon.center.y<(f+b)/2 and len(polygon.vertices)==4:
            polygon.material_index=1
    # Sample the bulb and lash densely, then collapse flat areas between these
    # lines. This spends triangles on the silhouette at both game distances.
    bpy.context.view_layer.objects.active=obj
    simplify=obj.modifiers.new("Retain facial curvature and nasal profile","DECIMATE")
    total=sum(len(f.vertices)-2 for f in obj.data.polygons)
    simplify.ratio=min(1.,(1210 if phone else 3860)/total)
    simplify.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=simplify.name)


def bead(name,center,radii,material,n=12,rings=5):
    x,y,z=center
    rx,ry,rz=radii
    vs=[(x,y,z-rz)]
    for j in range(1,rings):
        a=-pi/2+pi*j/rings
        for k in range(n):
            p=2*pi*k/n
            vs.append((x+rx*cos(a)*cos(p),y+ry*cos(a)*sin(p),z+rz*sin(a)))
    tip=len(vs)
    vs.append((x,y,z+rz))
    fs=[(0,1+(k+1)%n,1+k) for k in range(n)]
    connect(fs,n,rings-1,1)
    fs.extend((tip,tip-n+k,tip-n+(k+1)%n) for k in range(n))
    return surface(name,vs,fs,material)


def make_urna(phone):
    z=1.732
    bead('Urna',(0,fy(0,z)-.001,z),(.0050,.0039,.0059),'pearl',8 if phone else 12,4)


# The cranial vault and ushnisha share a continuous shell. Widths and the
# anterior/posterior limits are measured inside the outer row of curls.
HAIR_SECTIONS = [
    (157,23,589,643),(153,29,581,649),(149,33,577,652),(143,36,572,655),
    (135,40,568,658),(125,42,565,661),(114,44,564,663),(105,45,562,666),
    (95,46.5,562,668),(85,47.5,561,667),(76,47,559,665.5),(68,45,560.5,662.5),
    (60,39.5,564.5,657.5),(54,33.75,569.5,652),(50,30.6,574,648),
    (45,28.3,578.5,645),(38,24.7,582.5,641.2),(32,20.5,587,636.9),
    (27,13.4,594.7,629),(24.8,7,601,623),(23,1.5,610,614.5)]
HAIR = [(section_z(v),w/PIXELS_PER_METRE,(b-f)/(2*PIXELS_PER_METRE),depth(.5*(f+b)))
        for v,w,f,b in HAIR_SECTIONS]


def hair_floor(a):
    p=abs(atan2(sin(a),cos(a)))
    row=[(0,75.0),(.70,76.4),(1.02,83),(1.18,95),(1.36,109),
         (1.45,106),(1.54,96),(1.72,91),(1.90,97),(2.02,118),(2.14,135),
         (2.32,145),(2.53,148.5),(2.76,150),(pi,146)]
    return section_z(profile(row,p)[0])

def hair_pos(a,z):
    w,d,cy=profile(HAIR,z)
    return Vector((w*sin(a),cy-d*cos(a),z))


def make_hair(phone):
    n=20 if phone else 34
    rows=6 if phone else 8
    vs,fs=[],[]
    for j in range(rows):
        u=j/(rows-1)
        for k in range(n):
            a=2*pi*k/n
            fringe=max(0.,cos(a))**3
            low=hair_floor(a)-.003-.0012*fringe*cos(32*a)
            pos=hair_pos(a,low+(1.995-low)*u)
            vs.append(pos)
    connect(fs,n,rows)
    cap(fs,n,len(vs))
    surface('Scalp below curls',vs,fs,'hair')

    # Domed spirals overlap the cap. The tangent frame turns over the upper dome.
    zs=([1.532,1.570,1.608,1.646,1.684,1.722,1.760,1.798,1.833,1.861,
         1.885,1.912,1.941,1.962,1.977,1.987] if phone else
        [1.525,1.553,1.581,1.609,1.637,1.665,1.693,1.721,1.749,1.777,
         1.805,1.833,1.858,1.878,1.896,1.916,1.939,1.958,1.971,1.981,1.988])
    vs,fs=[],[]
    ns=5 if phone else 6
    for j,z in enumerate(zs):
        w,d,cy=profile(HAIR,z)
        count=max(6,round(2*pi*sqrt(w*d)/(.055 if phone else .0357)))
        circum=2*pi*sqrt(w*d)/count
        for k in range(count):
            a=2*pi*(k+.47*(j%2))/count
            if z+.007<hair_floor(a):
                continue
            pos=hair_pos(a,z)
            across=(hair_pos(a+.008,z)-hair_pos(a-.008,z)).normalized()
            along=(hair_pos(a,z+.0004)-hair_pos(a,z-.0004)).normalized()
            normal=across.cross(along).normalized()
            along=normal.cross(across).normalized()
            start=len(vs)
            for r,h,twist in ([(1.,-.001,0)] if phone else [(1.,-.002,0),(.65,.008,.14)]):
                for m in range(ns):
                    p=2*pi*m/ns+twist+.16*(j%2)
                    vs.append(pos+across*(circum*.58*r*cos(p))+along*((.022 if phone else .018)*r*sin(p))+normal*h)
            tip=len(vs)
            vs.append(pos+normal*.011+across*.001+along*.001)
            if not phone:
                connect(fs,ns,2,start)
            last=tip-ns
            fs.extend((last+m,last+(m+1)%ns,tip) for m in range(ns))
    surface('Rows of snail curls',vs,fs,'hair')

    vs=[(0,0,1.876)]
    n=10 if phone else 18
    for j in range(1,4):
        r=j/3
        for k in range(n+1):
            a=pi*k/n
            x=.054*r*cos(a)
            z=1.876+.047*r*sin(a)+.004*(x/.054)**2
            w,d,cy=profile(HAIR,z)
            y=cy-d*sqrt(max(.01,1-(x/w)**2))-.021-.006*r*sin(a)-.003*(1-r*r)
            vs.append((x,y,z))
    w,d,cy=profile(HAIR,1.876)
    vs[0]=(0,cy-d-.024,1.876)
    fs=[(0,1+k,2+k) for k in range(n)]
    for j in range(2):
        for k in range(n):
            p=1+j*(n+1)+k
            fs.append((p,p+n+1,p+n+2,p+1))
    # Turn the edge back into the cap. Seen from the side, a gilt mount
    # rises above the curls and joins the hair even at its narrowest tip.
    perimeter = ([1+j*(n+1) for j in range(3)] + [1+2*(n+1)+k for k in range(1,n+1)]
                 + [1+j*(n+1)+n for j in (1,0)] + [0])
    back = []
    for i in perimeter:
        x,y,z=vs[i]
        back.append(len(vs))
        vs.append((x,y+.035,z))
    for k,a in enumerate(perimeter):
        j=(k+1)%len(perimeter)
        fs.append((a,back[k],back[j],perimeter[j]))
    surface('Gilt crescent',vs,fs,'gold')
    bead('Crown jewel',(0,depth(612.5),1.994),(.025,.023,.006),'gold',12 if phone else 18,4)


def build_head(phone=False):
    existing=set(bpy.context.scene.objects)
    make_face(phone)
    make_ears(phone)
    make_urna(phone)
    make_hair(phone)
    for obj in set(bpy.context.scene.objects)-existing:
        obj.location.x += HEAD_X
