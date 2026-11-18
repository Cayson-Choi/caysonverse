"""Original sculpt of the central Buddha, in metres with the face toward -Y."""
from bisect import bisect_right
from math import atan2, cos, exp, pi, sin, sqrt
import bpy
from mathutils import Vector
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


# z, half width, front and rear. The hairline is at 1.787 m. In the
# front elevation 86 parts of cheek width span 93 parts of exposed face.
SKULL=[
    (1.430,.031,-.041,.080),(1.442,.062,-.089,.106),
    (1.454,.085,-.127,.128),(1.474,.105,-.152,.146),
    (1.494,.122,-.161,.155),(1.518,.135,-.159,.166),
    (1.545,.146,-.160,.176),(1.580,.151,-.163,.183),
    (1.614,.155,-.169,.188),(1.644,.157,-.176,.192),
    (1.669,.158,-.178,.195),(1.707,.158,-.183,.198),
    (1.749,.161,-.184,.201),
    (1.790,.163,-.170,.198),(1.822,.153,-.158,.190),
    (1.855,.131,-.132,.165),(1.888,.081,-.078,.124),(1.901,.013,-.008,.047)]


def eye_line(x):
    t=max(0., min(1., (abs(x)-.031)/.099))
    return eyelid_height(t, sin(pi*t))


def lip_line(x):
    t=min(1., abs(x)/.0435)
    return 1.548 + .0029*t*t - .0014*exp(-(t/.23)**2)


# Depth of the dorsal ridge above the central facial plane. The short
# return beneath the tip leads directly into the projecting philtrum.
NOSE = [(1.551,0.),(1.564,.005),(1.573,.009),(1.577,.012),
        (1.580,.020),(1.583,.031),(1.587,.041),(1.593,.0465),
        (1.598,.0465),(1.607,.042),(1.630,.030),
        (1.654,.019),(1.678,.011),(1.702,.008),(1.720,.003),(1.745,0.)]


def relief(x,z):
    a=abs(x)
    def g(u,v,w,h):
        across=exp(-((x-u)/w)**2)
        if u:
            across+=exp(-((x+u)/w)**2)
        return across*exp(-((z-v)/h)**2)
    tip=exp(-((z-1.589)/.013)**2)
    # The columella drops below the two alae. Stagger their lower profiles
    # so a side light resolves two nares and a rounded tip between them.
    midline=.006*exp(-(a/.012)**2-((z-1.582)/.020)**2)
    ridge=profile(NOSE,z+midline)[0]*exp(-(a/(.019+.004*tip+.005*exp(-((z-1.69)/.05)**2)))**2)
    t=max(0.,min(1.,(a-.031)/.099))
    arc=sin(pi*t)
    lid=eye_line(x)
    fold=lid+.006+.019*arc
    brow=brow_height(t,arc)
    orbit=exp(-((a-.078)/.053)**4)
    # A raised brow overhangs the socket. The domed upper lid rolls
    # forward into the lash, then the lower lid turns up to meet it.
    socket=orbit*(.016*exp(-((z-brow)/.012)**2)
                  -.014*exp(-((z-brow+.012)/.012)**2))
    lids=arc*(.019*exp(-((z-lid-.009)/.013)**2)
              -.004*exp(-((z-fold)/.004)**2)
              -.003*exp(-((z-lid+.003)/.004)**2)
              +.007*exp(-((z-lid+.011)/.007)**2))
    seam=lip_line(x)
    lip_width=exp(-(a/.039)**4)
    return (ridge + .020*g(.022,1.593,.011,.015) + socket + lids
            + .018*g(.125,1.670,.032,.029)
            + .023*g(.083,1.616,.063,.059) + .012*g(.089,1.566,.062,.061)
            + .016*g(0,1.565,.043,.027) + .003*g(.009,1.569,.007,.012)
            + lip_width*(.012*exp(-((z-seam-.0045)/.0050)**2)
                         + .013*exp(-((z-seam+.0048)/.0053)**2))
            + .010*g(0,1.488,.069,.031))


def fy(x,z):
    w,f,b=profile(SKULL,z)
    q=min(.99999,abs(x)/w)
    c=.5*(f+b)
    return c-(c-f)*(1-q*q)**.54-relief(x,z)*(1-q*q)**.65


def make_face(phone):
    front=([0,.065,.132,.20,.285,.42,.57,.74,.94,1.18,pi/2] if phone else
           [0,.038,.074,.11,.15,.19,.235,.29,.355,.435,.52,.625,.74,.87,1.01,1.17,1.36,pi/2])
    back=3 if phone else 5
    half=front+[pi/2+pi/2*k/back for k in range(1,back+1)]
    angles=half+[-a for a in reversed(half[1:-1])]
    zs=[1.430,1.443,1.457,1.474,1.490,1.513,1.531,1.543,1.548,1.553,1.563,1.577,
        1.581,1.584,1.588,1.593,1.605,1.627,1.647,1.660,1.669,1.681,1.696,1.716,1.739,1.768,1.798,1.832,1.88,1.901]
    if not phone:
        zs=sorted(zs+[1.437,1.451,1.466,1.502,1.524,1.538,1.558,1.569,1.574,1.590,
                      1.599,1.615,1.637,1.654,1.665,1.675,1.689,1.707,1.726,1.752,1.781])
    vs,fs=[],[]
    for z in zs:
        w,f,b=profile(SKULL,z)
        for a in angles:
            x=w*sin(a)
            height=z
            if cos(a)>.0001:
                # Carry the dense muzzle and eyelid loops along their actual
                # contours so the low LOD keeps a lip seam and a lower lid.
                height+=(lip_line(x)-1.548)*exp(-(x/.053)**4-((z-1.548)/.019)**2)
                height+=(eye_line(x)-1.669)*exp(-((abs(x)-.084)/.062)**4-((z-1.669)/.021)**2)
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
    z=1.718
    bead('Urna',(0,fy(0,z)-.001,z),(.0050,.0039,.0059),'pearl',8 if phone else 12,4)


EAR=[(1.466,.159,.007,.043,.008),(1.473,.160,.020,.043,.021),
     (1.490,.161,.026,.042,.030),(1.512,.160,.025,.040,.031),
     (1.539,.160,.018,.040,.029),(1.569,.158,.017,.043,.029),
     (1.598,.159,.021,.044,.034),(1.627,.160,.028,.044,.041),
     (1.659,.161,.031,.046,.047),(1.685,.161,.030,.048,.050),
     (1.707,.162,.022,.050,.043),(1.722,.161,.013,.050,.028),(1.728,.160,.003,.052,.007)]


def make_ears(phone):
    n=8 if phone else 15
    zs=[row[0] for row in EAR]
    if not phone:
        zs=sorted(zs+[1.642,1.670,1.695])
    for s in (-1,1):
        vs,fs=[],[]
        for z in zs:
            cx,rx,cy,ry=profile(EAR,z)
            for k in range(n):
                a=2*pi*k/n
                y=cy+ry*sin(a)
                bowl=.032*exp(-((y-.044)/.027)**2-((z-1.662)/.041)**2)
                ridge=.014*exp(-((y-.049-.012*sin((z-1.630)*45))/.009)**2-((z-1.654)/.031)**2)
                tragus=.011*exp(-((y-.020)/.012)**2-((z-1.639)/.012)**2)
                x=cx+rx*cos(a)+max(0,cos(a))**1.4*(-bowl+ridge+tragus)
                vs.append((s*x,y,z))
        connect(fs,n,len(zs))
        cap(fs,n,len(vs))
        if s<0:
            fs=[tuple(reversed(f)) for f in fs]
        surface('Long carved earlobe',vs,fs,'skin')
        if phone:
            continue
        # Inner helical ridge turns in toward the concha and fades into the bowl.
        vs,fs=[],[]
        path=[(.023,1.674,.002),(.026,1.685,.005),(.034,1.693,.006),
              (.046,1.696,.0065),(.057,1.692,.006),(.064,1.684,.006),
              (.067,1.669,.005),(.061,1.654,.005),(.055,1.648,.002)]
        ns=6
        for j,(y,z,r) in enumerate(path):
            cx,rx,cy,ry=profile(EAR,z)
            cs=sqrt(max(0,1-((y-cy)/ry)**2))
            bowl=.032*exp(-((y-.044)/.027)**2-((z-1.662)/.041)**2)
            ridge=.014*exp(-((y-.049-.012*sin((z-1.630)*45))/.009)**2-((z-1.654)/.031)**2)
            x=cx+rx*cs+cs**1.4*(-bowl+ridge)-.001
            lo=path[max(0,j-1)]
            hi=path[min(len(path)-1,j+1)]
            d=Vector((0,hi[1]-lo[1],lo[0]-hi[0])).normalized()
            for i in range(ns):
                a=2*pi*i/ns
                vs.append((s*(x+r*cos(a)),y+d.y*r*sin(a),z+d.z*r*sin(a)))
        connect(fs,ns,len(path))
        if s>0:
            fs=[tuple(reversed(f)) for f in fs]
        surface('Inner helix',vs,fs,'skin')


# Nape, rounded cap and the narrower ushnisha, in a single profile.
HAIR=[(1.488,.082,.087,.065),(1.515,.117,.124,.057),(1.547,.143,.148,.044),
      (1.583,.157,.162,.036),(1.631,.163,.174,.030),(1.690,.172,.181,.025),
      (1.750,.177,.188,.022),(1.790,.177,.188,.020),(1.813,.175,.184,.020),
      (1.846,.166,.173,.021),(1.870,.151,.157,.021),(1.890,.129,.136,.023),
      (1.904,.117,.124,.023),(1.930,.111,.116,.024),(1.951,.100,.104,.024),
      (1.967,.085,.091,.024),(1.979,.064,.069,.024),(1.989,.033,.037,.024),(1.991,.006,.007,.024)]


def hair_floor(a):
    p=abs(atan2(sin(a),cos(a)))
    row=[(0,1.799),(.71,1.796),(1.05,1.782),(1.22,1.750),(1.32,1.688),
         (1.40,1.668),(1.47,1.715),(1.57,1.732),(1.72,1.735),(1.84,1.717),(1.94,1.679),
         (2.07,1.560),(2.16,1.544),(2.32,1.530),(2.75,1.521),(pi,1.518)]
    return profile(row,p)[0]


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
            low=hair_floor(a)-.007-fringe*(.005+.0012*cos(32*a))
            pos=hair_pos(a,low+(1.991-low)*u)
            # The lower cap forms a continuous rounded hairline between the curls.
            pos+=Vector((sin(a),-cos(a),0))*(.009*fringe*(1-u)**4)
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
            for r,h,twist in ([(1.,-.001,0)] if phone else [(1.,-.001,0),(.61,.0085,.19)]):
                for m in range(ns):
                    p=2*pi*m/ns+twist+.16*(j%2)
                    vs.append(pos+across*(circum*.58*r*cos(p))+along*((.022 if phone else .018)*r*sin(p))+normal*h)
            tip=len(vs)
            vs.append(pos+normal*.012+across*.0016+along*.0018)
            if not phone:
                connect(fs,ns,2,start)
            last=tip-ns
            fs.extend((last+m,last+(m+1)%ns,tip) for m in range(ns))
    surface('Rows of snail curls',vs,fs,'hair')

    vs=[(0,0,1.879)]
    n=10 if phone else 18
    for j in range(1,4):
        r=j/3
        for k in range(n+1):
            a=pi*k/n
            x=.054*r*cos(a)
            z=1.879+.047*r*sin(a)+.004*(x/.054)**2
            w,d,cy=profile(HAIR,z)
            y=cy-d*sqrt(max(.01,1-(x/w)**2))-.020-.010*(1-r*r)
            vs.append((x,y,z))
    w,d,cy=profile(HAIR,1.879)
    vs[0]=(0,cy-d-.030,1.879)
    fs=[(0,1+k,2+k) for k in range(n)]
    for j in range(2):
        for k in range(n):
            p=1+j*(n+1)+k
            fs.append((p,p+n+1,p+n+2,p+1))
    surface('Gilt crescent',vs,fs,'gold')
    bead('Crown jewel',(0,.024,1.990),(.038,.037,.010),'gold',12 if phone else 18,4)


def build_head(phone=False):
    make_face(phone)
    make_ears(phone)
    make_urna(phone)
    make_hair(phone)
