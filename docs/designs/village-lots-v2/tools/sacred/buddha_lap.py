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
    surface = Carving()
    rows = []
    segments = 12 if phone else 29
    for j in range(1, segments):
        u = (1 - cos(pi*j/segments))/2
        span = sin(pi*u)
        bend = (2*u - (1.08 if side > 0 else .92))**2
        upper = min(1.05, .16 + 1.05*bend)
        lower = -.68 + 1.02*bend
        # Sections follow the lip instead of cutting its arc with a rectangular grid.
        # The two swags rise at the ankle and outside the knee, dipping in between.
        section = [(1.57,0),(1.57*.82+(upper+.19)*.18,.002),((1.76+upper)*.5,.001),
                   (upper+.19,-.003),(upper+.07,.013),(upper,.032),
                   (upper-.08,.027),(upper-.17,-.010),
                   (lower+.20,-.003),(lower+.065,.014),(lower,.029),
                   (lower-.095,.014),(lower-.18,-.004),
                   (-1.29,0),(-1.57,0),(-1.9,0),(-2.38,0),(-2.88,0),
                   (-3.36,0),(-3.84,0),(-4.34,0)]
        if phone:
            section = [section[k] for k in (0,2,3,5,7,8,10,12,14,16,18,20)]
        x = side*(-.052 + .643*u)
        yc = -.13 - .091*span + .06*u
        zc = .543 + .015*u
        rz = .138*span**.40
        points = []
        for angle, roll in section:
            c, s = cos(angle), sin(angle)
            ry = (.288 if c>=0 else .461)*span**.60
            # Gilded cloth has breadth across the top and a rounded outer knee.
            y = yc - (ry + roll*span**.45)*c
            z = max(.423, zc + (rz + .62*roll)*s)
            points.append((x,y,z))
        rows.append(surface.row(points))
    for a,b in zip(rows,rows[1:]):
        surface.bridge(a,b,True)
    for row, point in ((rows[0],(-.052*side,-.13,.543)),(rows[-1],(.591*side,-.07,.558))):
        tip = surface.row([point])[0]
        for j in range(len(row)):
            face = (tip,row[j],row[(j+1)%len(row)])
            surface.faces.append(tuple(reversed(face)) if row is rows[0] else face)
    # The cross sections progress from the upper surface down the front of the knee.
    if side < 0:
        surface.faces = [tuple(reversed(f)) for f in surface.faces]
    return surface.mesh("Folded knee " + ("left" if side>0 else "right"))


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
            # Vary pleat width across the fabric: the centre is an open turnover
            # between tightly gathered channels, not an evenly crimped fringe.
            phase = 2.57*u + .36*sin(pi*t)*(1-u*u) - .32*sin(pi*u) + .24*t*u*sin(1.5*pi*u)
            ridge = (.5+.5*cos(tau*phase))**1.65
            turn = (.5+.5*cos(tau*(phase-.19)))**2
            amount = (.009+.027*t)*ridge - (.004+.007*t)*turn
            x = center+width*u + .010*t*sin(tau*phase) - .031*t*(1-u*u)*sin(pi*t)
            yy = y + (.018+.070*t*t)*u*u - amount*sin(.17+1.40*t)
            zz = z + amount*cos(.17+1.40*t) - .015*u*u*(1-t)
            zz += .012*t**5 * (.5+.5*cos(tau*phase))
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
