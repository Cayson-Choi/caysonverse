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
            # The free hems sag over the kneecap and climb to the inner
            # ankle. Their shallow top return disappears under the shin.
            cx = .316 + front*(1-r)*.030
            x = cx + r*.290*c
            if side > 0:
                # This knee disappears under the hanging sleeve at the hip.
                x -= .074*max(0., min(1., (depth+.27)/.29)) * (.35+.65*max(0,c))
            inner = max(0., -c)
            x -= front*.076*r*(1-r)*inner**2
            belly = 1 - front*.57*inner**1.35
            z = .550 + front*(.025+.031*(1-r))
            z += r*(.149*sn*belly + front*(.098*inner**1.6+.010*c))
            # Ease the two turned edges into the fabric as they roll over
            # the top; keep their overhang on the lower, freely hanging lip.
            top = max(0., sn) * (.70+.30*inner)
            smooth_depth = -.497 + .36*r**2.65
            y = depth + front*r**1.45*(.050*c*c - .018*c + .75*top*(smooth_depth-depth))
            if side < 0:
                z += .006*r*(.45-c)*front
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
    # Left and right cut edges, forward throw and height of the fan. Its
    # pleated half spills towards the bare-arm knee. A single broad leaf on
    # the other side turns back under the ankle above the lotus rim.
    stations = [(0,-.085,.015,-.264,.705),(.16,-.118,.029,-.336,.699),
                (.34,-.165,.054,-.409,.680),(.53,-.227,.089,-.466,.637),
                (.73,-.306,.113,-.503,.566),(.87,-.358,.122,-.540,.500),
                (.93,-.389,.119,-.559,.463),(.965,-.406,.111,-.567,.439),
                (.984,-.412,.104,-.557,.428),(1,-.409,.096,-.531,.433)]
    # Spend the last three rows on the lip itself so its rounded return is
    # present even on the phone. The hidden cut edge doubles back towards
    # the knees after the bearing surface has touched the seat.
    along = ([0,.18,.35,.54,.73,.87,.93,.965,.984,1] if phone else
             [0,.06,.12,.18,.26,.34,.44,.53,.62,.71,.79,.86,.90,.93,.95,.965,.976,.984,1])
    n = 24 if phone else 64
    for t in along:
        left,right,y,z = transition(stations,t)
        points = []
        for k in range(n+1):
            u = 2*k/n-1
            arc = sin(pi*t)
            q = u - .16*arc*(1-u*u)
            # Narrow rolled lips give way to broad shallow valleys. The last
            # crest is the turned margin of the unpleated triangular field.
            crests = ((-.72,.072),(-.32,.082),(.09,.095),(.80+.11*arc,.060))
            ridges = sum(exp(-((q-pos)/width)**2) for pos,width in crests)
            valleys = sum(exp(-((q-pos-.14)/.14)**2) for pos,_ in crests)
            broad = exp(-((q-.46)/.32)**2)
            amount = (.004+.012*t)*ridges - (.002+.004*t)*valleys + (.006+.008*t)*broad
            x = left+(right-left)*(u+1)/2
            # Press the lateral margins into the shins. Across the hem,
            # consecutive tongues turn up by different amounts onto the lap.
            setback = (.028+.112*t*t)*u*u*(1-.22*u)
            hem = t**6 * (.003 + .017*broad + .010*max(0.,u)**2 - .005*ridges)
            tongue = t**5 * (.021*ridges + .018*broad - .006*valleys)
            yy = y + setback - amount*sin(.24+1.24*t) - .017*t - tongue
            zz = z + amount*cos(.24+1.24*t) - .010*u*u*(1-t) + hem
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
    # Two rolled edges of the same gathered cloth run out from the inside
    # ankle. Their spacing opens as they reach the underside of the knee.
    height_weight = (0,.06,.22,.42,.69,.80,.83,.36,.08)
    relief = (0,.003,-.003,.057,-.012,.062,.016,-.004,0)
    turns = [(0,0),(.21,.118),(.34,.255),(.73,.735),(1,1)]
    for row_index,(z,rx,front,back) in enumerate(course):
        row = []
        for j in range(count):
            turn, = transition(turns,j/count)
            a = tau*turn
            sn,cs=sin(a),cos(a)
            across = abs(sn)
            ripple = (.003 + .007*across)*sin(21*a+z*11) * exp(-((z-.465)/.09)**2)
            depth = front if cs>0 else back
            # Pull the front between the knees underneath the outward-flaring hem.
            inset = .065*across**.85 if cs>0 else 0
            raised = 0.
            lift = 0.
            if cs > 0:
                # Leave space behind the central fan for its shallow valleys
                # and the turned triangular end, including the phone mesh.
                inset += .106 * exp(-((z-.505)/.101)**2 - ((sn+.105)/.56)**4)
                x = .55*sn
                gather = exp(-((x-.236)/.180)**4)
                fall = max(0.,min(1.,(x-.084)/.278))
                fall = fall*fall*(3-2*fall)
                lift = height_weight[row_index] * gather * (.065-.166*fall)
                raised = relief[row_index] * gather
            row.append(((rx+ripple)*sn,-.030-(depth-inset+ripple+raised)*cs,z+lift))
        current = s.row(row)
        if previous:
            s.bridge(previous,current,True)
        previous=current
    return s.mesh("Robe resting on the lotus")


def build_lap(phone):
    return [underfold(phone),knee(-1,phone),knee(1,phone),cascade(phone)]
