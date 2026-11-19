"""Original sculpt of the central Buddha, in metres with the face toward -Y."""
from bisect import bisect_right
from math import atan2, cos, exp, pi, sin, sqrt, tanh
import bpy
from mathutils import Vector
from buddha_ears import make_ears
from buddha_mesh import mat
from buddha_pigment import (BROW_INNER, BROW_SPAN, EYE_INNER, EYE_SPAN, FACE_AXIS,
                            LIP_RADIUS, brow_height, eyelid_height, lip_height)


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


def face_section_z(image_row):
    # The underside of the nasal bulb turns into a short philtrum. Below the
    # mouth the jaw rises gently into the throat without lifting the lip seam.
    t=max(0.,min(1.,(image_row-137.)/34.))
    nose_base=.0050*exp(-((image_row-133.8)/4.9)**2)
    chin=max(0., min(1., (image_row-153.)/18.))
    return section_z(image_row)+nose_base+.0070*t*t*(3-2*t)-.0066*chin*chin*(3-2*chin)


# Profile row, frontal skull half-width (px), anterior facial plane and occiput.
# The short underside of the chin turns back toward the narrow neck.
SECTIONS = [
    (171.0, 3, 592, 602), (169.8, 7.7, 584, 607), (168, 13.3, 579.5, 613),
    (165, 19.8, 574.5, 620), (162, 24.0, 571.4, 627), (158, 27.4, 569.2, 632),
    (154, 30.3, 568.0, 637), (150, 32.7, 567.2, 641), (147, 34.5, 566.8, 644),
    (142, 37.4, 566.2, 648), (136, 40.0, 565.7, 650), (130, 41.9, 565.2, 652),
    (122, 43.3, 564.3, 654), (115, 43.6, 563.1, 657), (108, 43.2, 561.7, 658),
    (103, 42.5, 560.8, 659), (96, 42.6, 559.9, 660), (90, 42.6, 559.8, 660),
    (82, 42.6, 560.3, 659), (75, 42, 561, 658), (65, 39, 565, 652),
    (55, 34, 572, 648), (45, 24, 583, 637), (38, 10, 600, 622)]
SKULL = [(face_section_z(v), w/PIXELS_PER_METRE, depth(f), depth(b)) for v,w,f,b in SECTIONS]

# Only the facial oval follows these measured jaw widths and orbital depths.
# The curl casting remains seated on the established skull sections.
FACE_PLANES = {
    171:(3,594.5), 169.8:(8.6,590), 168:(14.8,584.6), 165:(21.2,576.7),
    162:(25,571.8), 158:(28.2,569.4), 154:(30.8,568.5), 150:(33.1,568),
    147:(34.7,567.3), 122:(43.3,565), 115:(43.6,565.2), 108:(43.2,564.5),
    103:(42.5,563.2), 96:(42.6,561)}
FACE = []
for row,width,front,back in SECTIONS:
    width,front=FACE_PLANES.get(row,(width,front))
    FACE.append((face_section_z(row),width/PIXELS_PER_METRE,depth(front),depth(back)))

# Midpoints of the two reflected profile silhouettes. The root has a short
# saddle at eye level and the lobule turns back under the end of the bridge.
PROFILE_EDGE = [
    (171,594.5),(169.5,592.0),(168.5,587.4),(166.5,580.6),(163.5,573.1),
    (161.5,569.1),(158.5,567.35),(156.5,567.10),(154.5,567.10),(150.5,567.40),(149.5,567.2),
    (147.5,564.8),(145.5,563.4),(143.5,563.1),(142.5,562.5),(141.5,561.4),
    (140.0,561.1),(138.5,561.3),(136.5,561.8),(135.5,561.2),
    (134.5,558.0),(133.5,554.76),(132.5,553.59),(131.5,552.42),(130.5,551.91),
    (128.5,551.66),(126.5,551.91),(124.5,552.38),(122.5,553.13),(118.5,554.85),
    (114.5,556.76),(111.5,558.01),(108.5,559.32),(105.5,559.94),(102.5,559.56),
    (99.5,559.25),(96.5,559.3),
    (92,559.7),(90,559.8),(82,560.3),
    (75,561),(65,565),(55,572),(45,583),(38,600)]
MIDLINE = [(section_z(v),depth(u)) for v,u in PROFILE_EDGE]

# Posterior half-sections approaching the existing neck. At 1.525 m the
# neck's top ring is .112 m wide on either side of its axis, centred at
# y=.174 m and reaching y=.282 m behind. The head overlaps it below that rim.
# Height, half-width and posterior extent, all in metres.
NAPE = [(1.438,.081,.253),(1.475,.098,.268),(1.492,.106,.275),
        (1.506,.112,.280),(1.525,.118,.286),(1.550,.125,.291),
        (1.585,.139,.297),(1.640,.155,.305),(1.680,.161,.308)]


def eye_line(x):
    t=max(0., min(1., (abs(x)-EYE_INNER)/EYE_SPAN))
    return eyelid_height(t, sin(pi*t))


def lip_line(x):
    return lip_height(min(1., abs(x)/LIP_RADIUS))


def relief(x,z):
    a=abs(x)
    def paired(offset,height,width,radius):
        return (exp(-((x-offset)/width)**2)+exp(-((x+offset)/width)**2))*exp(-((z-height)/radius)**2)

    t=max(0.,min(1.,(a-EYE_INNER)/EYE_SPAN))
    arc=sin(pi*t)
    lid=eye_line(x)
    brow_t=max(0.,min(1.,(a-BROW_INNER)/BROW_SPAN))
    brow_arc=sin(pi*brow_t)
    brow=brow_height(brow_t,brow_arc)
    # A continuous padded lid under the arc of the brow. The fold is a change
    # in curvature and the lash sits over a softly turned lower lid.
    brow_plane=(.0038*paired(.082,brow,.046,.010)
                +.0036*paired(.078,brow-.010,.049,.015))
    brow_root=.026+.039*max(0.,min(1.,(z-1.680)/.053))**1.5
    inner_fold=.0038*paired(brow_root,1.705,.015,.026)
    dome=lid+.012+.007*arc
    lids=(.013*paired(.081,dome,.042,.026)
          + .0018*paired(.078,lid-.009,.045,.015)
          - .0067*paired(.065,1.693,.058,.039)
          - .0030*paired(.038,lid,.008,.0065))
    cheeks=(.023*paired(.096,1.627,.077,.072)
            + .0080*paired(.099,1.601,.078,.060))
    # The lobes round over the alar crease on the cheek and return underneath
    # into the nostril. Their low edge sits above the rounded columella.
    wings=(.0110*paired(.030,1.604,.017,.017)
           - .0120*paired(.037,1.609,.027,.030)
           - .0025*paired(.020,1.613,.008,.016)
           - .0024*paired(.031,1.628,.015,.009)
           - .0048*paired(.021,1.590,.0092,.0065))
    seam=lip_line(x)
    mouth=(.0040*paired(.018,seam+.006,.018,.0060)
           + .0055*paired(.014,seam-.008,.023,.0075)
           - .0043*paired(.044,seam,.0078,.0055))
    return (brow_plane - inner_fold + lids + cheeks + wings + mouth
            + .0024*paired(.010,1.573,.0070,.012)
            + .003*paired(.030,1.493,.032,.025))


def fy(x,z):
    w,front,back=profile(FACE,z)
    q=min(.99999,abs(x)/w)
    x-=FACE_AXIS
    outline=profile(MIDLINE,z)[0]
    bulb=exp(-((z-1.600)/.025)**2)
    muzzle=1/(1+exp(min(80.,(z-1.576)/.0085)))
    chin=1/(1+exp(min(80.,(z-1.517)/.010)))
    spread=(.0235 + .0102*bulb - .0076*exp(-((z-1.580)/.009)**2)
            + .0050*exp(-((z-1.71)/.039)**2) + .020*muzzle + .046*chin)
    # Ease the cross section continuously from the bridge to the rounded tip
    # and over the columella, preserving the measured midline at every height.
    bridge=exp(-((z-1.655)/.053)**4)
    ridge=(front-outline)*exp(-(abs(x)/spread)**(2+.19*bridge+.10*bulb))
    center=.5*(front+back)
    # Constrain only the midline to the measured sagittal profile. Spreading
    # the lip's correction across a whole section cuts a shelf into both cheeks.
    axial_correction=relief(0,z)*exp(-(x/.023)**2)
    lip_seam=.0019*exp(-(x/.038)**4-((z-lip_line(x))/.0029)**2)
    return center-(center-front)*(1-q*q)**.50-(ridge+relief(x,z)-axial_correction-lip_seam)*(1-q*q)**.65


def soften_face_normals(mesh):
    # Both LODs shade from the same continuous sculpt. Decimation leaves large
    # triangles on the cheeks, whose averaged triangle normals otherwise imprint
    # angular transitions into the lacquer. Ease into the mesh normals at the jaw.
    normals=[]
    for vertex in mesh.vertices:
        x,y,z=vertex.co
        width,front,back=profile(FACE,z)
        weight=max(0.,min(1.,(width-abs(x)-.009)/.022,(z-1.445)/.020))
        if y>=(front+back)*.5 or not weight:
            normals.append((0.,0.,0.))
            continue
        local_x=x-FACE_AXIS
        # Filter the very narrow meeting edge of the lips across both rolls.
        # A triangle bridging different rolls otherwise catches an isolated glint.
        lip=exp(-(local_x/.043)**4-((z-1.553)/.016)**4)
        tip=exp(-(local_x/.049)**4-((z-1.607)/.031)**4)
        radius=.0022+.0036*lip+.0034*tip
        dx=(fy(x+radius,z)-fy(x-radius,z))/(2*radius)
        dz=(fy(x,z+radius)-fy(x,z-radius))/(2*radius)
        # Gently round the steep normals at the sides and underside of the nose,
        # much as the broad bevel of the gilded ground rounds the edge of the cast.
        nose=exp(-(local_x/.043)**4-((z-1.650)/.075)**4)
        cheek=exp(-((abs(local_x)-.089)/.057)**4-((z-1.640)/.055)**4)
        ala=exp(-((abs(local_x)-.028)/.014)**2-((z-1.608)/.019)**2)
        dx *= 1-.28*nose-.41*cheek-.21*ala
        dz *= 1-.26*nose-.41*cheek-.20*ala
        # Turn the leaf around the broad tip and each smaller wing. Across the
        # base the sagittal profile alone would reflect one horizontal strip.
        lateral=abs(local_x)
        wing=.89*exp(-((lateral-.031)/.015)**4-((z-1.605)/.019)**4)
        wing_slope=.35*(lateral-.031)/.016 * (1 if local_x>=0 else -1)
        dx+=wing*(wing_slope-dx)
        dz+=wing*(.32*tanh((z-1.605)/.015)-dz)
        dorsum=.90*exp(-(local_x/.023)**4-((z-1.626)/.042)**6)
        dx+=dorsum*(.40*local_x/.026-dx)
        dz+=dorsum*(.51*tanh((z-1.603)/.013)-dz)
        # At grazing incidence the ala turns sideways before it rolls under.
        # A continuous lateral normal keeps the bridge reflection off its rim.
        outer=max(0.,min(1.,(lateral-.030)/.011))
        flank=.94*outer*outer*(3-2*outer)*exp(-((lateral-.038)/.014)**4-((z-1.612)/.018)**4)
        turn=(.84+.38*tanh((lateral-.035)/.011))*(1 if local_x>=0 else -1)
        dx+=flank*(turn-dx)
        dz+=flank*(.23*tanh((z-1.610)/.012)-dz)
        columella=exp(-(local_x/.012)**2-((z-1.590)/.013)**2)
        dz-=.34*min(0.,dz)*columella
        under_lip=exp(-(local_x/.055)**4-((z-1.530)/.024)**2)
        dz*=1-.45*under_lip
        # The lower bevel turns under the goatee over a continuous arc. Its
        # normals receive doorway light even when seen from the player's floor.
        chin_roll=exp(-(x/.120)**4-((z-1.475)/.032)**2)
        dz -= .47*min(0.,dz)*chin_roll
        lacquer=Vector((dx,-1.,dz)).normalized()
        weight=weight*weight*(3-2*weight)
        normals.append(vertex.normal.lerp(lacquer,weight).normalized())
    mesh.normals_split_custom_set_from_vertices(normals)


def make_face(phone):
    front=([0,.034,.068,.100,.135,.175,.215,.26,.33,.43,.55,.68,.82,1.00,1.24,pi/2] if phone else
           [0,.023,.047,.071,.093,.115,.139,.163,.19,.22,.25,.29,.34,.40,
            .47,.55,.64,.74,.85,.97,1.09,1.22,1.38,pi/2])
    back=6 if phone else 9
    half=front+[pi/2+pi/2*k/back for k in range(1,back+1)]
    angles=half+[-a for a in reversed(half[1:-1])]
    # Carry each horizontal edge through the measured lips and nasal underside;
    # only the hidden rear of the cranium uses widely spaced sections.
    rows = [171,169.8,168,165,162,158,154,150,147.1,145.5,143,141.8,140.6,138,
            136.2,134.7,133.4,132.1,130.1,128.1,125.2,122.5,118,114,110,106,
            103,100,96,92,86,80,72,59,45,38,135.4,131.1,126.5,121,112,108]
    if not phone:
        rows += [167,160,156,152,148.5,146.4,144,139.5,137,134.1,132.7,129.2,127.4,
                 124,119.5,116,113,111,109,107,105,104,101,98,94,89,83,76]
    # Retain an explicit ring at the contact line and along its two bevels.
    # The contour offsets below carry these samples through the cupid's bow.
    zs=sorted([face_section_z(v) for v in rows] + [1.5498,1.553,1.5561])
    vs,fs=[],[]
    for z in zs:
        w,f,b=profile(FACE,z)
        nape_width,nape_back=profile(NAPE,z)
        to_vault=max(0.,min(1.,(z-1.57)/.10))
        nape_weight=1-to_vault*to_vault*(3-2*to_vault)
        for a in angles:
            x=w*sin(a)
            height=z
            if cos(a)>.0001:
                # Carry the dense muzzle and eyelid loops along their actual
                # contours so the low LOD keeps a lip seam and a lower lid.
                local_x=x-FACE_AXIS
                height+=(lip_line(local_x)-1.553)*exp(-(local_x/.054)**4-((z-1.553)/.019)**2)
                height+=(eye_line(local_x)-1.680)*exp(-((abs(local_x)-.084)/.062)**4-((z-1.680)/.021)**2)
                y=fy(x,height)
            else:
                y=(f+b)/2-(b-f)/2*cos(a)
                rear=max(0.,min(1.,-cos(a)/.43))
                blend=nape_weight*rear*rear*(3-2*rear)
                x+=blend*(nape_width*sin(a)-x)
                y+=blend*(.174-(nape_back-.174)*cos(a)-y)
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
        _,f,b=profile(FACE,polygon.center.z)
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
    z=1.728
    # Preserve the mount on the forehead when refining the orbital plane below.
    bead('Urna',(FACE_AXIS,-.061910428,z),(.0067,.0044,.0070),'urna',8 if phone else 12,4)


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
    # Keep the forehead band, then turn the short temple curl up around the
    # helix. The last occipital row ends level with the top of the ear.
    row=[(0,76.3),(.42,76.7),(.65,77.4),(.82,78.3),(.96,79.5),
         (1.08,81.1),(1.19,83.7),(1.30,88.6),(1.41,99.4),(1.47,108.6),
         (1.50,109.6),(1.54,109.5),(1.57,108.2),(1.61,101.7),(1.67,95.0),(1.78,90.4),(1.88,89.8),
         (2.03,91.2),(2.24,93.0),(2.52,94.0),(2.84,94.5),(pi,94.6)]
    z=section_z(profile(row,p)[0])
    _,f,b=profile(SKULL,z)
    y=(f+b)/2-(b-f)/2*cos(a)
    front=max(0.,cos(a))
    return z-CAMERA_PITCH*y*front

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
    columns=[[k/steps for k in range(steps+1)] for steps in divisions]
    # A few extra meridians describe the rounded terminal curl in front of
    # each ear, including on the phone where one quad used to span its tip.
    temple=[.88,.95] if phone else [.96]
    columns[1]=sorted(columns[1]+temple)
    columns[6]=sorted(columns[6]+[1-u for u in temple])
    vertical=1 if phone else 2
    for j,(low,high) in enumerate(zip(levels,levels[1:])):
        w,d,_=profile(HAIR,(low+high)/2)
        repeats=max(1,min(5,round(2*pi*sqrt(w*d)/(.0275*sectors))))
        phase=.5*(j%2)
        for sector in range(sectors):
            samples=columns[sector]
            rings=[]
            for m in range(vertical+1):
                ring=[]
                t=m/vertical
                for u in samples:
                    a=2*pi*(sector+u)/sectors
                    floor=hair_floor(a)
                    # Bend the frontal rows with the measured temple arch.
                    wrap=abs(atan2(sin(a),cos(a)))
                    dip=(hair_floor(min(wrap,1.15))-front)*max(0.,cos(a))**.6
                    # Behind the helix a full row follows the lower edge, so
                    # its curls roll back into the gold instead of being sliced.
                    occipital=max(0.,min(1.,(wrap-1.59)/.22))
                    occipital=occipital*occipital*(3-2*occipital)
                    rear_row=front-.075
                    def bent(level):
                        return (level+dip*exp(-((level-front)/.083)**2)
                                +occipital*(floor-rear_row)*exp(-((level-rear_row)/.048)**2))
                    bottom,top=bent(low),bent(high)
                    z=max(floor,bottom+(top-bottom)*t)
                    row_v=min(1.,(z-bottom)/(top-bottom))
                    column=repeats*u+phase
                    relief=sin(pi*row_v)**2*sin(pi*column)**2
                    at_edge=max(0.,min(1.,(z-floor)/.008))
                    n=hair_normal(a,z)
                    finish=max(0.,min(1.,(1.992-z)/.014))
                    pos=hair_pos(a,z)+n*(.0045+.004*relief)*at_edge*finish
                    # The dark edge is seated directly against the facial
                    # ellipse, where the original casting turns into the temple.
                    blend=max(0.,min(1.,(z-floor)/.035))
                    blend=blend*blend*(3-2*blend)
                    sw,sf,sb=profile(SKULL,z)
                    skin=Vector((sw*sin(a),(sf+sb)/2-(sb-sf)/2*cos(a),z))
                    ring.append(len(vs))
                    vs.append(pos.lerp(skin+n*.0008,1-blend))
                    normals.append(n)
                    coords.append(((column/6)*.92+.04,row_v*.92+.04))
                rings.append(ring)
            for lower,upper in zip(rings,rings[1:]):
                for k in range(len(samples)-1):
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
    angles=[2*pi*(s+u)/sectors for s,samples in enumerate(columns) for u in samples[:-1]]
    for inset in (.004,0):
        for a in angles:
            z=hair_floor(a)
            normal=hair_normal(a,z)
            sw,sf,sb=profile(SKULL,z)
            skin=Vector((sw*sin(a),(sf+sb)/2-(sb-sf)/2*cos(a),z))
            vs.append(skin+normal*(.0008-inset))
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
