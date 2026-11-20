"""Reference-traced pinnae, with an unbroken lobe and curls seated at the ear root."""
from math import cos, pi, sin

import bpy
import numpy as np

from buddha_mesh import mat
from buddha_pigment import smooth


# Drawing coordinates on the lateral ear. U increases toward the nape and V
# toward the jaw. Columns are V, anterior/posterior edges, shell axis and
# lateral half-thickness. The medial attachment is independent of the latter.
OUTLINE = [
    (17, 93, 93, .157, 0), (18, 85, 101, .157, .006),
    (21, 76, 110, .157990, .011), (29, 63, 122, .159414, .017),
    (42, 54, 133, .161695, .020), (60, 49, 140, .168394, .022),
    (84, 47, 145, .172, .0225), (106, 49, 146, .171, .022),
    (130, 51, 144, .167, .022), (151, 52, 140, .163, .022),
    (178, 53, 136, .159, .022), (215, 52.5, 131, .154, .020),
    (249, 52, 129, .150, .019), (273, 51, 130, .148, .020),
    (293, 52, 130, .148, .023), (307, 55, 128, .149, .024),
    (320, 61, 122, .149, .023), (330, 71, 112, .149, .0175),
    (336, 82, 101, .149, .009), (337.5, 91.5, 91.5, .149, 0),
]
YU, ZV = .000923, .000875
EAR_Y, EAR_Z = .1755, 1.746
TILT = .00026


def relief(u, v):
    """Lateral displacement from the smooth shell, in metres."""
    # Three soft sweeps on the same continuous surface. The rolled helix
    # returns over the concha at its anterior end. The inner sweep ends in a
    # rounded antitragus, with the smaller tragus on the facing bank.
    helix = [(77,119),(73,111),(64,104),(57,96),(52,83),(53,65),
             (57,50),(65,39),(78,30),(93,26),(107,30),(120,40),
             (130,54),(137,76),(139,99),(137,124),(133,148),(129,166)]
    inner = [(75,76),(83,73),(93,76),(101,85),(106,97),
             (107,110),(104,124),(98,136),(89,145),(79,147),(73,143)]
    tragus = [(61,113),(66,116),(70,123),(70,130),(67,134)]
    u,v = np.broadcast_arrays(u,v)
    raised = np.zeros_like(u,dtype=float)
    for path, amplitude, width in [(helix,.019,12.5),(inner,.009,10.7),(tragus,.009,8.8)]:
        # The overlap of short brush samples forms a smooth rolled edge at
        # bends. It also avoids the cusps of a nearest-line distance field.
        p = np.array(path)
        for a,b in zip(p,p[1:]):
            dx,dy = b-a
            length = np.hypot(dx,dy)
            n = int(np.ceil(length/(.6*width)))
            for j in range(n):
                x,y = a+(b-a)*((j+.5)/n)
                raised += amplitude*length/(n*width*np.sqrt(pi))*np.exp(
                    -((u-x)**2+(v-y)**2)/width**2)
    bowl = np.exp(-((u-93)/34)**2-((v-63)/34)**2)
    concha = np.exp(-((u-81)/15.8)**2-((v-121)/25)**2)
    # This indentation is blind and tapers at both ends. A thin moving axis
    # follows the weight of the lobe, widening as the surface turns into the drop.
    pendant = np.exp(-((u-(88+.045*(v-215)))/15.5)**2-((v-219)/58)**4)
    return raised-.014*bowl-.019*concha-.007*pendant, (bowl,concha,raised,pendant)


def section(v):
    from buddha_head import profile
    return np.array([profile(OUTLINE,float(t)) for t in np.asarray(v).ravel()]).T


def shell(rows, angles):
    """Parameterization of the whole casting, including the medial return."""
    v = np.asarray(rows)[:,None]
    a = np.asarray(angles)
    lo,hi,axis,radius = section(v)[:,:,None]
    radial = np.sin(a)
    u = (hi+lo)/2-(hi-lo)/2*np.cos(a)
    tilt = TILT*(u-(hi+lo)/2)
    foot = np.clip((297-v)/53,0,1)
    attach = (.015*np.exp(-((v-89)/72)**4)+
              .033*np.exp(-((v-213)/90)**4)*foot**2*(3-2*foot))
    sculpt,_ = relief(u,v)
    x = axis+tilt+radial*(radius+np.where(radial>0,sculpt,attach))
    y = EAR_Y+YU*(u-92)
    z = np.broadcast_to(EAR_Z-ZV*(v-17),x.shape)
    return np.stack((x,y,z),axis=-1)


def make_ears(phone):
    # At each section keep all four silhouette extrema, then subdivide the
    # cross-section where its actual profile deviates most from each chord.
    # The foot samples follow its round end all the way to its tangent point.
    sections = ([(20,5),(31,5),(52,6),(77,6),(103,7),(128,7),
                 (150,6),(196,5),(249,5),(286,5),(311,5),(327,5),(335,4)]
                if phone else
                [(19,6),(23,7),(30,8),(40,9),(52,10),(66,12),(80,13),
                 (94,13),(109,13),(124,13),(139,12),(155,10),(178,9),
                 (208,7),(241,7),(264,8),(282,8),(298,8),(310,8),
                 (320,8),(328,8),(333,7),(336,6)])
    sampling = 240
    angles = 2*pi*np.arange(sampling)/sampling
    rows = np.array([v for v,_ in sections])
    points = shell(rows,angles)
    da = shell(rows,angles+.002)-shell(rows,angles-.002)
    dv = shell(rows+.05,angles)-shell(rows-.05,angles)
    # Circular sweep is +X counter-clockwise around the vertical section.
    gradient = np.cross(dv,da)
    gradient /= np.maximum(1.e-12,np.linalg.norm(gradient,axis=-1,keepdims=True))
    vertices,normals,faces,lateral = [],[],[],[]
    rings = []
    for row,((v,count),ring) in enumerate(zip(sections,points)):
        chosen = sorted({0,sampling//2,int(np.argmin(ring[:,0])),int(np.argmax(ring[:,0]))})
        while len(chosen)<count:
            error,k = -1.,0
            for a,b in zip(chosen,chosen[1:]+[sampling]):
                if b==a+1:
                    continue
                x,y = ring[a,:2],ring[b%sampling,:2]
                segment = y-x
                interior = ring[a+1:b,:2]
                t = np.clip((interior-x)@segment/max(1e-12,segment@segment),0,1)
                delta = interior-(x+t[:,None]*segment)
                deviation = (delta**2).sum(axis=1)
                at = np.argmax(deviation)
                if deviation[at]>error:
                    k,error = a+1+at,deviation[at]
            chosen.append(k)
            chosen.sort()
        ring_indices = []
        for k in chosen:
            ring_indices.append((k,len(vertices)))
            lateral.append(k<=sampling//2)
            vertices.append(tuple(ring[k]))
            normals.append(tuple(gradient[row,k]))
        rings.append(ring_indices)
    # Connect corresponding meridians around a closed section. A different
    # number of samples per row spends geometry on the upper cast and foot.
    for upper,lower in zip(rings,rings[1:]):
        upper = upper+[(sampling,upper[0][1])]
        lower = lower+[(sampling,lower[0][1])]
        i=j=0
        while i<len(upper)-1 or j<len(lower)-1:
            a = upper[i][1]
            b = lower[j][1]
            if j==len(lower)-1 or (i<len(upper)-1 and upper[i+1][0]<lower[j+1][0]):
                i+=1
                faces.append((a,b,upper[i][1]))
            else:
                j+=1
                faces.append((a,b,lower[j][1]))
    for ring,endpoint,up in [(rings[0],OUTLINE[0],True),(rings[-1],OUTLINE[-1],False)]:
        v,edge,_,axis,_ = endpoint
        tip = len(vertices)
        lateral.append(True)
        vertices.append((axis,EAR_Y+YU*(edge-92),EAR_Z-ZV*(v-17)))
        normals.append((0,0,1 if up else -1))
        for (_,a),(_,b) in zip(ring,ring[1:]+ring[:1]):
            faces.append((tip,a,b) if up else (tip,b,a))
    finish = bpy.data.materials.get("Auricular relief")
    if finish is None:
        finish = mat("skin").copy()
        finish.name = "Auricular relief"
    from buddha_head import surface
    for side in (1,-1):
        obj = surface("Rounded pinna and pendant",[(side*x,y,z) for x,y,z in vertices],
                      faces if side>0 else [f[::-1] for f in faces],"skin")
        obj.data.materials.append(finish)
        obj.data.normals_split_custom_set_from_vertices([(side*x,y,z) for x,y,z in normals])
        for p in obj.data.polygons:
            if all(lateral[k] for k in p.vertices):
                p.material_index = 1


def make_ear_curls(phone):
    """A continuous folded hem of whorls from the sideburn onto the helix."""
    from buddha_head import surface

    # z, x centre, y centre, lateral and longitudinal radii. The entire
    # medial edge is buried in the skull and the previous row of curls.
    # The bottom of this casting is round from both registered directions.
    rows = [
        (1.6585,.159,.117,0,0),
        (1.6615,.159,.117,.005,.0085), (1.6675,.159,.1175,.0085,.014),
        (1.681,.161,.120,.0115,.020), (1.693,.163,.125,.014,.023),
        (1.705,.165,.131,.015,.026), (1.717,.166,.141,.016,.026),
        (1.729,.167,.150,.017,.027), (1.741,.167,.160,.016,.026),
        (1.753,.164,.166,.014,.024),
    ]
    if phone:
        rows = [rows[i] for i in (0,2,3,5,7,9)]
    steps = 3 if phone else 6
    # The first part of each sweep faces forward, so the front view sees a
    # rounded shell continuous with the temporal hairline, including the tip.
    angles = np.linspace(-2.35,2.35,steps+1)
    for side in (1,-1):
        vertices = [(side*rows[0][1],rows[0][2],rows[0][0])]
        faces,coords = [],[]
        swatch_y = [rows[0][2]]
        previous = []
        for ir,(z,x,cy,rx,ry) in enumerate(rows[1:],1):
            current = []
            # Place the top whorls in front of the gold rim. Their side
            # projection stays anterior to the bowl while the frontal view
            # sees the pinna emerge from behind the temple as it flares.
            crown = smooth(1.696,1.732,z)*(1-smooth(1.741,1.760,z))
            for a in angles:
                y = cy+ry*sin(a)
                current.append(len(vertices))
                swatch_y.append(y)
                vertices.append((side*(x+rx*cos(a)+.013*crown),y-.025*crown,z))
            strip = ([(0,current[j+1],current[j]) for j in range(steps)] if ir==1
                     else [(previous[j],previous[j+1],current[j+1],current[j]) for j in range(steps)])
            band = max(0,int(np.floor(((z+rows[ir-1][0])/2-1.657)/.024)))
            for indices in strip:
                indices = indices if side>0 else indices[::-1]
                faces.append(indices)
                for k in indices:
                    zz = vertices[k][2]
                    u = (swatch_y[k]-.070)/.026+.3*(band%2)
                    v = np.clip((zz-1.657)/.024-band,0,1)
                    coords.append((.04+.92*u/7,.04+.92*v))
            previous = current
        obj = surface("Lacquered whorls at the helix",vertices,faces,"hair")
        layer = obj.data.uv_layers.new(name="Curl lattice")
        for loop in obj.data.loops:
            layer.data[loop.index].uv = coords[loop.index]
