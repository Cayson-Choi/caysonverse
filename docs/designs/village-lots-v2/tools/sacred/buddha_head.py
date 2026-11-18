"""Original sculpt of the central Buddha, in metres with the face toward -Y."""
from bisect import bisect_right
from math import atan2, cos, exp, pi, sin, sqrt
import bpy
from mathutils import Vector
from buddha_mesh import mat


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


# z, half width, forehead/chin and rear profile.
SKULL=[
    (1.439,.030,-.030,.082),(1.451,.065,-.080,.107),
    (1.468,.099,-.127,.139),(1.491,.121,-.146,.154),
    (1.518,.139,-.150,.167),(1.546,.149,-.149,.176),
    (1.578,.154,-.153,.184),(1.613,.159,-.163,.188),
    (1.646,.162,-.169,.192),(1.680,.162,-.166,.195),
    (1.712,.165,-.170,.200),(1.749,.166,-.173,.201),
    (1.790,.163,-.170,.198),(1.822,.153,-.158,.190),
    (1.855,.131,-.132,.165),(1.888,.081,-.078,.124),(1.901,.013,-.008,.047)]


def relief(x,z):
    a=abs(x)
    def g(u,v,w,h):
        return exp(-((a-u)/w)**2-((z-v)/h)**2)
    lid=1.685+.007*(a-.078)/.055
    return (.017*g(0,1.669,.020,.064)+.022*g(0,1.632,.021,.040)
            +.025*g(0,1.612,.024,.019)+.024*g(.021,1.610,.012,.014)+.009*g(0,1.600,.009,.014)
            +.010*g(.080,1.650,.049,.040)+.010*g(.107,1.645,.034,.052)
            -.008*g(.074,1.699,.054,.031)+.016*g(.079,lid+.008,.044,.015)
            +.007*g(.071,lid-.009,.044,.012)+.012*g(.076,1.720,.060,.017)
            +.008*g(.016,1.702,.017,.031)+.010*g(0,1.570,.066,.034)
            +.006*g(.010,1.586,.006,.016)+.008*g(0,1.556,.045,.011)+.014*g(0,1.506,.059,.025))


def fy(x,z):
    w,f,b=profile(SKULL,z)
    q=min(.99999,abs(x)/w)
    c=.5*(f+b)
    return c-(c-f)*(1-q*q)**.42-relief(x,z)*(1-q*q)**.65


def make_face(phone):
    front=([0,.08,.155,.26,.40,.58,.80,1.03,1.29,pi/2] if phone else
           [0,.045,.085,.13,.175,.225,.285,.355,.435,.52,.615,.72,.84,.965,1.10,1.245,1.40,pi/2])
    back=4 if phone else 7
    half=front+[pi/2+pi/2*k/back for k in range(1,back+1)]
    angles=half+[-a for a in reversed(half[1:-1])]
    zs=[1.439,1.455,1.478,1.505,1.530,1.550,1.564,1.581,1.597,1.604,1.612,1.622,
        1.638,1.658,1.678,1.688,1.704,1.722,1.747,1.777,1.811,1.850,1.885,1.901]
    if not phone:
        zs=sorted(zs+[1.467,1.492,1.518,1.541,1.556,1.573,1.588,1.600,1.608,
                      1.617,1.630,1.648,1.669,1.683,1.696,1.713,1.734,1.762])
    vs,fs=[],[]
    for z in zs:
        w,f,b=profile(SKULL,z)
        for a in angles:
            x=w*sin(a)
            y=fy(x,z) if cos(a)>.0001 else (f+b)/2-(b-f)/2*cos(a)
            vs.append((x,y,z))
    connect(fs,len(angles),len(zs))
    cap(fs,len(angles),len(vs))
    # Remove surfaces fully hidden inside the hair shell in both game LODs.
    buried=[z>hair_floor(a)+.018 for z in zs for a in angles]
    fs=[f for f in fs if not all(buried[i] for i in f)]
    surface('Oval with integrated eyelids, nose and chin',vs,fs,'skin')


def ribbon(name,side,fn,material,n,offset=.0018):
    vs,fs=[],[]
    for i in range(n+1):
        x,z,above,below=fn(i/n)
        for dz in (-below,above):
            vs.append((side*x,fy(x,z+dz)-offset,z+dz))
    for i in range(n):
        f=(2*i,2*i+2,2*i+3,2*i+1)
        fs.append(f if side>0 else tuple(reversed(f)))
    surface(name,vs,fs,material)


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


def make_features(phone):
    n=7 if phone else 14
    for s in [-1,1]:
        def brow(t):
            b=sin(pi*t)**.69
            return (.023+.109*t,1.717+.020*sin(pi*t)**.94+.004*t,.0061*b,.0033*b)
        ribbon('Malachite brow',s,brow,'green',n,.0026)
        def lid(t):
            b=sin(pi*t)
            return (.032+.102*t,1.682+.004*t-.003*b,.0013*b,.0035*b*b)
        ribbon('Closed eyelid crease',s,lid,'crease',n,.0027)
        ribbon('Painted moustache',s,lambda t:(.013+.051*t,1.578-.010*t+.0008*sin(2*pi*t),
                                                .0022*sin(pi*t)**.65,.0015*sin(pi*t)**.65),'green',n)
        for x,z,rx,rz in [(.061,1.564,.0021,.0023),(.012,1.499,.0024,.003)]:
            bead('Brush stipple',(s*x,fy(x,z)-.001,z),(rx,.0017,rz),'green',5,3)
        ribbon('Nostril',s,lambda t:(.013+.013*t,1.603+.0014*sin(pi*t),.0013*sin(pi*t),
                                     .0012*sin(pi*t)),'crease',5,.0033)
    bead('Urna',(0,fy(0,1.731)-.0018,1.731),(.0061,.005,.0072),'pearl',8 if phone else 12,4)
    for upper in (True,False):
        vs,fs=[],[]
        nr=2 if phone else 4
        for j in range(nr):
            u=j/(nr-1)
            for k in range(2*n+1):
                v=k/n-1
                x=.048*v
                fall=max(0,1-v*v)
                seam=1.562+.0026*v*v-.001*cos(2*pi*v)
                h=(.010+.006*exp(-((abs(v)-.35)/.23)**2))*fall**.85 if upper else -.0125*fall**.88
                z=seam+u*h
                lift=(.002+.006*sin(pi*u)**.65+.003*(1-u))*fall
                vs.append((x,fy(x,z)-lift-.0014,z))
        w=2*n+1
        for j in range(nr-1):
            for k in range(w-1):
                a=j*w+k
                f=(a,a+1,a+1+w,a+w)
                fs.append(f if upper else tuple(reversed(f)))
        surface('Vermilion lip',vs,fs,'lips')
    ribbon('Smile',1,lambda t:(.092*(t-.5),1.562+.0026*(2*t-1)**2-.001*cos(2*pi*(2*t-1)),
                                .0006*sin(pi*t),.0008*sin(pi*t)),'crease',n*2,.0087)


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
    make_features(phone)
    make_hair(phone)
