"""Carve the two cloth-covered knees and the pleated end reaching the lotus seat."""
from math import cos, exp, pi, sin, tau

import bpy

from buddha_mesh import mat


class Carving:
    def __init__(self):
        self.points = []
        self.faces = []

    def row(self, coords):
        first = len(self.points)
        self.points.extend(coords)
        return list(range(first, len(self.points)))

    def bridge(self, a, b, loop=False):
        for i in range(len(a) if loop else len(a)-1):
            j = (i+1) % len(a)
            self.faces.append((a[i], a[j], b[j], b[i]))

    def mesh(self, name):
        data = bpy.data.meshes.new(name)
        data.from_pydata(self.points, [], self.faces)
        data.materials.append(mat("gold"))
        data.update()
        data.polygons.foreach_set("use_smooth", [True] * len(data.polygons))
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        return obj


def knee(side, phone):
    # The fabric wraps all the way around the front of each rounded knee.
    # Closed courses run from the rear to the front. The second rolled edge
    # converges with the first at the gathered ankle and opens over the shin.
    surface = Carving()
    sections = [
        # radius in the front elevation, distance along the front-to-back axis
        (.030, .225), (.43, .215), (.78, .155), (.96, .046),
        (1., -.080), (.985, -.161), (.952, -.229),
        (.920, -.285), (.900, -.306), (.878, -.298), (.849, -.276),
        (.824, -.315), (.775, -.361), (.737, -.390), (.713, -.399),
        (.694, -.387), (.665, -.358), (.626, -.401), (.56, -.443),
        (.43, -.470), (.24, -.488), (.035, -.497),
    ]
    if phone:
        sections = [sections[i] for i in (0,2,4,6,8,10,12,14,16,18,20,21)]
    count = 36 if phone else 64
    previous = None
    for r, depth in sections:
        front = max(0., min(1., (-depth-.12)/.29))
        row = []
        for j in range(count):
            angle = tau*j/count
            c, sn = cos(angle), sin(angle)
            # Both low points hang well below the corner that returns under
            # the crossed ankle. The taper is strongest near that inner end.
            cx = .316 + front*(1-r)*.067
            x = cx + r*.290*c
            if side > 0:
                # This knee disappears under the hanging sleeve at the hip.
                x -= .074*max(0., min(1., (depth+.27)/.29)) * (.35+.65*max(0,c))
            belly = 1 + front*.33*c
            z = .550 + front*.089*(1-r) + r*(.148*sn*belly + front*.054*c)
            # A broad rounded pad catches light inside the two turned hems.
            # The bands thin out over the hidden top at the returning ankle.
            y = depth + front*(.054*c*c - .018*c)
            if side < 0:
                z += .013*r*(.45-c)*front
            row.append((side*x,y,z))
        current = surface.row(row)
        if previous is not None:
            surface.bridge(previous,current,True)
        else:
            surface.faces.append(tuple(reversed(current)))
        previous=current
    surface.faces.append(tuple(previous))
    if side < 0:
        surface.faces = [tuple(reversed(f)) for f in surface.faces]
    obj = surface.mesh("Folded knee " + ("left" if side>0 else "right"))
    bpy.context.view_layer.objects.active = obj
    reduction = obj.modifiers.new("Keep knee fold crests", "DECIMATE")
    reduction.ratio = (260 if phone else 1168) / sum(len(face.vertices)-2 for face in obj.data.polygons)
    bpy.ops.object.modifier_apply(modifier=reduction.name)
    return obj


def transition(table, t):
    for a,b in zip(table,table[1:]):
        if t <= b[0]:
            v = (t-a[0])/(b[0]-a[0])
            return [x+(y-x)*v for x,y in zip(a[1:],b[1:])]
    return table[-1][1:]


def cascade(phone):
    s = Carving()
    rows = []
    # Root underneath the crossed feet, crest above the knees, final return on
    # the lotus. The extra width below is distributed into diverging flutes.
    stations = [(0,-.043,.073,-.255,.722),(.18,-.046,.100,-.335,.716),
                (.38,-.052,.137,-.409,.691),(.58,-.051,.182,-.474,.632),
                (.79,-.041,.233,-.529,.539),(.93,-.030,.277,-.565,.460),
                (1,-.025,.299,-.583,.418)]
    n,m = (24,8) if phone else (64,16)
    for j in range(m+1):
        t = j/m
        center,width,y,z = transition(stations,t)
        points = []
        for k in range(n+1):
            u = 2*k/n-1
            # The loose panel opens into a broad central turnover. Three
            # closer gathers enter from the outer ankle. Their crests fan
            # outward as the edge falls onto the lotus.
            arc = sin(pi*t)
            q = u + .18*arc*(1-u*u)
            crests = ((-.82-.06*t, .064), (-.56-.10*t, .074),
                      (-.29-.10*t, .072), (.04-.16*t, .066),
                      (.48+.14*arc, .096), (.88+.02*t, .082))
            ridge = sum(exp(-((q-pos)/width)**2) for pos,width in crests)
            valley = sum(exp(-((q-pos-.078)/(width*.78))**2) for pos,width in crests)
            broad = exp(-((q-.23-.10*arc)/(.15+.08*t))**2)
            amount = (.007+.021*t)*ridge - (.003+.007*t)*valley + (.014+.020*t)*broad
            x = center+width*u - .058*arc*(1-u*u)
            yy = y + (.020+.070*t*t)*u*u - amount*sin(.17+1.40*t)
            zz = z + amount*cos(.17+1.40*t) - .015*u*u*(1-t)
            zz += .012*t**5*broad
            points.append((x,yy,zz))
        rows.append(s.row(points))
    for a,b in zip(rows,rows[1:]):
        s.bridge(a,b)
    rim = rows[0]+[r[-1] for r in rows[1:]]+list(reversed(rows[-1][:-1]))+[r[0] for r in reversed(rows[1:-1])]
    inside = s.row((s.points[i][0],s.points[i][1]+.005,s.points[i][2]-.005) for i in rim)
    s.bridge(rim,inside,True)
    # The face winding of the top sheet is toward the body. Turn it out.
    s.faces = [tuple(reversed(f)) for f in s.faces]
    return s.mesh("Gathered end of the robe")


def underfold(phone):
    # The underside of the robe rests on the lotus under both knees. The front
    # is fullest under the central cascade, and the back tapers into the mantle.
    s = Carving()
    previous = []
    course = [(.421,.555,.520,.355),(.430,.564,.528,.367),(.456,.565,.529,.365),
              (.487,.562,.525,.358),(.519,.554,.508,.343),(.552,.532,.478,.331),
              (.595,.463,.441,.305),(.636,.371,.391,.283),(.657,.291,.318,.258)]
    count = 32 if phone else 72
    for z,rx,front,back in course:
        row = []
        for j in range(count):
            a = tau*j/count
            sn,cs=sin(a),cos(a)
            across = abs(sn)
            ripple = (.003 + .007*across)*sin(21*a+z*11) * exp(-((z-.465)/.09)**2)
            depth = front if cs>0 else back
            # Pull the front between the knees underneath the outward-flaring hem.
            inset = .065*across**.85 if cs>0 else 0
            row.append(((rx+ripple)*sn,-.030-(depth-inset+ripple)*cs,z))
        current = s.row(row)
        if previous:
            s.bridge(previous,current,True)
        previous=current
    return s.mesh("Robe resting on the lotus")


def build_lap(phone):
    return [underfold(phone),knee(-1,phone),knee(1,phone),cascade(phone)]
