"""Original sculpt of the central Buddha, in metres with the face toward -Y."""
from bisect import bisect_right
from math import atan2, cos, exp, pi, sin, sqrt
import bpy
from mathutils import Vector
from buddha_ears import make_ears
from buddha_mesh import mat
from buddha_pigment import brow_height, eyelid_height, lip_height


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
    (171.0, 4, 592, 602), (169.8, 9.4, 584, 607), (168, 15.7, 579.5, 614),
    (165, 21.5, 574.5, 622), (162, 25.7, 571.4, 630), (158, 30.0, 569.2, 635),
    (154, 33.0, 568.0, 640), (150, 35.4, 567.2, 643), (147, 36.8, 566.8, 645),
    (142, 38.8, 566.2, 648), (136, 40.5, 565.7, 650), (130, 41.6, 565.2, 652),
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
    (136.2,559.8),(134.7,558.6),(133.4,556.3),(132.1,554.4),(130.1,552.2),
    (128.1,550.9),(126.5,550.6),(125.2,550.7),(122.5,551.6),(118,553.3),
    (114,554.9),(110,556.5),(106,557.9),(102,558.9),(96,559.5),
    (92,559.7),(90,559.8),(82,560.3),
    (75,561),(65,565),(55,572),(45,583),(38,600)]
MIDLINE = [(section_z(v),depth(u)) for v,u in PROFILE_EDGE]


def eye_line(x):
    t=max(0., min(1., (abs(x)-.030)/.104))
    return eyelid_height(t, sin(pi*t))


def lip_line(x):
    return lip_height(min(1., abs(x)/.0435))


def relief(x,z):
    a=abs(x)
    def paired(offset,height,width,radius):
        return (exp(-((x-offset)/width)**2)+exp(-((x+offset)/width)**2))*exp(-((z-height)/radius)**2)

    t=max(0.,min(1.,(a-.030)/.104))
    arc=sin(pi*t)
    lid=eye_line(x)
    brow_t=max(0.,min(1.,(a-.030)/.103))
    brow_arc=sin(pi*brow_t)
    brow=brow_height(brow_t,brow_arc)
    # A continuous padded lid under the arc of the brow. The fold is a change
    # in curvature and the lash sits over a softly turned lower lid.
    brow_plane=brow_arc*(.0065*exp(-((z-brow)/.019)**2)
                         - .0017*exp(-((z-brow+.016)/.014)**2))
    dome=lid+.008+.007*arc
    lids=arc*(.021*exp(-((z-dome)/.020)**2)
              + .004*exp(-((z-lid+.009)/.012)**2))
    cheeks=(.042*paired(.117,1.623,.067,.056)
            + .005*paired(.081,1.584,.062,.048))
    # The wing descends into the underside of the tip. Its shallow return
    # sits below the widest part so the nostrils recede in a frontal view.
    wings=(.014*paired(.021,1.599,.014,.017)
           + .009*paired(.023,1.607,.010,.011))
    seam=lip_line(x)
    mouth=(.0030*paired(.018,seam+.005,.019,.0058)
           + .0039*paired(.014,seam-.006,.022,.0068)
           - .0013*paired(.044,seam,.009,.0075))
    return (brow_plane + lids + cheeks + wings + mouth
            + .0014*paired(.010,1.571,.012,.014)
            + .004*paired(.038,1.485,.035,.026))


def fy(x,z):
    w,front,back=profile(SKULL,z)
    q=min(.99999,abs(x)/w)
    outline=profile(MIDLINE,z)[0]
    bulb=exp(-((z-1.610)/.015)**2)
    muzzle=1/(1+exp(min(80.,(z-1.576)/.0085)))
    chin=1/(1+exp(min(80.,(z-1.517)/.010)))
    spread=.0162 + .0035*bulb + .007*exp(-((z-1.71)/.035)**2) + .022*muzzle + .047*chin
    # Ease the cross section continuously from the bridge to the rounded tip
    # and over the columella, preserving the measured midline at every height.
    bridge=exp(-((z-1.655)/.053)**4)
    ridge=(front-outline)*exp(-(abs(x)/spread)**(2+.82*bridge+.55*bulb))
    center=.5*(front+back)
    # Constrain only the midline to the measured sagittal profile. Spreading
    # the lip's correction across a whole section cuts a shelf into both cheeks.
    axial_correction=relief(0,z)*exp(-(x/.023)**2)
    return center-(center-front)*(1-q*q)**.50-(ridge+relief(x,z)-axial_correction)*(1-q*q)**.65


def soften_face_normals(mesh):
    # Both LODs shade from the same continuous sculpt. Decimation leaves large
    # triangles on the cheeks, whose averaged triangle normals otherwise imprint
    # angular transitions into the lacquer. Ease into the mesh normals at the jaw.
    normals=[]
    radius=.0038
    for vertex in mesh.vertices:
        x,y,z=vertex.co
        width,front,back=profile(SKULL,z)
        weight=max(0.,min(1.,(width-abs(x)-.009)/.022,(z-1.451)/.028))
        if y>=(front+back)*.5 or not weight:
            normals.append((0.,0.,0.))
            continue
        dx=(fy(x+radius,z)-fy(x-radius,z))/(2*radius)
        dz=(fy(x,z+radius)-fy(x,z-radius))/(2*radius)
        # Gently round the steep normals at the sides and underside of the nose,
        # much as the broad bevel of the gilded ground rounds the edge of the cast.
        nose=exp(-(x/.041)**4-((z-1.626)/.071)**4)
        bulb=exp(-(x/.036)**4-((z-1.602)/.023)**4)
        cheek=exp(-((abs(x)-.088)/.047)**4-((z-1.631)/.044)**4)
        dx *= 1-.40*nose-.12*bulb-.32*cheek
        dz = dz*(1-.47*nose-.18*bulb-.28*cheek) + .12*cheek
        lacquer=Vector((dx,-1.,dz)).normalized()
        weight=weight*weight*(3-2*weight)
        normals.append(vertex.normal.lerp(lacquer,weight).normalized())
    mesh.normals_split_custom_set_from_vertices(normals)


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
    soften_face_normals(obj.data)


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
    z=1.725
    bead('Urna',(0,fy(0,z),z),(.0062,.0046,.0073),'urna',8 if phone else 12,4)


# The cranial vault and ushnisha share a continuous shell. Widths and the
# anterior/posterior limits are measured inside the outer row of curls.
HAIR_SECTIONS = [
    (157,23,589,643),(153,29,581,649),(149,33,577,652),(143,36,572,655),
    (135,40,568,658),(125,42,565,661),(114,44,564,663),(105,45,562,666),
    (95,46.5,562,668),(85,47.5,561,667),(76,47,559,665.5),(68,45,560.5,662.5),
    (60,39.5,564.5,657.5),(54,34.1,569.5,652),(50,30.9,574,648),
    (45,28.2,578.5,645),(38,24.2,582.5,641.2),(32,19.3,587,636.9),
    (28,13.4,594.7,629),(25.5,7,601,623),(24.3,1.5,610,614.5)]
HAIR = [(section_z(v),w/PIXELS_PER_METRE,(b-f)/(2*PIXELS_PER_METRE),depth(.5*(f+b)))
        for v,w,f,b in HAIR_SECTIONS]


def hair_floor(a):
    p=abs(atan2(sin(a),cos(a)))
    # Measured forehead and temples in the pitched frontal photograph.
    row=[(0,77),(.42,77.8),(.65,78.5),(.82,79.6),(.96,80.7),
         (1.08,82.2),(1.19,84.9),(1.30,89.6),(1.41,97.8),(1.49,111),
         (1.56,108),(1.65,95),(1.73,91),(1.90,97),(2.02,118),(2.14,135),
         (2.32,145),(2.53,148.5),(2.76,150),(pi,146)]
    z=section_z(profile(row,p)[0])
    _,f,b=profile(SKULL,z)
    y=(f+b)/2-(b-f)/2*cos(a)
    front=max(0.,cos(a))
    return z-CAMERA_PITCH*y*front-.0009*front*cos(40*a)

def hair_pos(a,z):
    w,d,cy=profile(HAIR,z)
    return Vector((w*sin(a),cy-d*cos(a),z))


def hair_normal(a,z):
    tangent=hair_pos(a+.004,z)-hair_pos(a-.004,z)
    rise=hair_pos(a,z+.0003)-hair_pos(a,z-.0003)
    return tangent.cross(rise).normalized()


def scalloped_scalp(phone):
    # A continuous casting. Each band maps a row of small whorls around
    # the vault; both LODs therefore show the same spacing at the hairline.
    # Row heights tighten where the meridian turns towards the crown.
    front=hair_floor(0)
    levels=[front+k*.025 for k in range(-12,2)]
    levels += [1.850,1.870,1.887,1.904,1.921,1.938,1.953,1.966,1.976,1.984,1.991,1.9945]
    vs,fs,coords,normals=[],[],[],[]
    sectors=8
    # The rear quarters have no forehead arc and need fewer longitudinal cuts.
    divisions=[(3 if phone else 10) if 2<=s<6 else (4 if phone else 12) for s in range(sectors)]
    vertical=1 if phone else 2
    for j,(low,high) in enumerate(zip(levels,levels[1:])):
        w,d,_=profile(HAIR,(low+high)/2)
        repeats=max(1,min(5,round(2*pi*sqrt(w*d)/(.0275*sectors))))
        phase=.5*(j%2)
        for sector in range(sectors):
            across=divisions[sector]
            rings=[]
            for m in range(vertical+1):
                ring=[]
                t=m/vertical
                for k in range(across+1):
                    a=2*pi*(sector+k/across)/sectors
                    floor=hair_floor(a)
                    # Bend the frontal rows with the measured temple arch.
                    wrap=abs(atan2(sin(a),cos(a)))
                    dip=(hair_floor(min(wrap,1.15))-front)*max(0.,cos(a))**.6
                    def bent(level):
                        return level+dip*exp(-((level-front)/.083)**2)
                    bottom,top=bent(low),bent(high)
                    z=max(floor,bottom+(top-bottom)*t)
                    row_v=min(1.,(z-bottom)/(top-bottom))
                    column=repeats*k/across+phase
                    relief=sin(pi*row_v)**2*sin(pi*column)**2
                    at_edge=max(0.,min(1.,(z-floor)/.008))
                    n=hair_normal(a,z)
                    finish=max(0.,min(1.,(1.992-z)/.014))
                    pos=hair_pos(a,z)+n*(.0045+.004*relief)*at_edge*finish
                    # The dark edge is seated directly against the facial
                    # ellipse, where the original casting turns into the temple.
                    blend=max(0.,min(1.,(z-floor)/.035))
                    blend=blend*blend*(3-2*blend)
                    attach=max(0.,min(1.,(1.84-wrap)/.24))*(1-blend)
                    sw,sf,sb=profile(SKULL,z)
                    skin=Vector((sw*sin(a),(sf+sb)/2-(sb-sf)/2*cos(a),z))
                    ring.append(len(vs))
                    vs.append(pos.lerp(skin+n*.0008,attach))
                    normals.append(n)
                    coords.append(((column/6)*.92+.04,row_v*.92+.04))
                rings.append(ring)
            for lower,upper in zip(rings,rings[1:]):
                for k in range(across):
                    corners=[lower[k],lower[k+1]]
                    if vs[upper[k+1]]!=vs[lower[k+1]]:
                        corners.append(upper[k+1])
                    if vs[upper[k]]!=vs[lower[k]]:
                        corners.append(upper[k])
                    if len(corners)>2:
                        fs.append(corners)
    # Turn the lower edge inward to meet the temple and forehead. It follows
    # a single curve even from below; no loose polygon tips hang onto the skin.
    start=len(vs)
    angles=[2*pi*(s+k/steps)/sectors for s,steps in enumerate(divisions) for k in range(steps)]
    for inset in (.004,0):
        for a in angles:
            z=hair_floor(a)
            pos=hair_pos(a,z)
            normal=hair_normal(a,z)
            wrap=abs(atan2(sin(a),cos(a)))
            attach=max(0.,min(1.,(1.84-wrap)/.24))
            sw,sf,sb=profile(SKULL,z)
            skin=Vector((sw*sin(a),(sf+sb)/2-(sb-sf)/2*cos(a),z))
            vs.append(pos.lerp(skin+normal*.0008,attach)-normal*inset)
            normals.append(normal)
            coords.append((.04,.04))
    connect(fs,len(angles),2,start)
    scalp=surface('Cast scalp with rows of snail curls',vs,fs,'hair')
    scalp.data.normals_split_custom_set_from_vertices(normals)
    lattice=scalp.data.uv_layers.new(name='Curl lattice')
    for loop in scalp.data.loops:
        lattice.data[loop.index].uv=coords[loop.vertex_index]


def make_hair(phone):
    scalloped_scalp(phone)

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
    bead('Crown jewel',(0,depth(612.5),1.994),(.019,.017,.006),'gold',12 if phone else 18,4)


def build_head(phone=False):
    existing=set(bpy.context.scene.objects)
    make_face(phone)
    make_ears(phone)
    make_urna(phone)
    make_hair(phone)
    for obj in set(bpy.context.scene.objects)-existing:
        obj.location.x += HEAD_X
