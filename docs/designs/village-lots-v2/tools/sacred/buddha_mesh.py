"""Shared finishes and the two-tier lotus for the original hall Buddha (Blender, metres)."""
import math

import bpy

TAU = math.tau
# Linear RGB, roughness and metallic. Face and hands are gilded gesso, cloth is burnished.
FINISHES = {
    "gold": ((1.0, .674, .182), .151, .98),
    "skin": ((.96, .611, .031), .39, .84),
    "hair": ((.0055, .0065, .0090), .68, 0.),
    "green": ((.045, .109, .050), .57, .16),
    "lips": ((.52, .041, .023), .38, .2),
    "cloth": ((1.0, .674, .182), .235, .98),
    "pearl": ((.99, .83, .52), .22, .28),
    "crease": ((.24, .095, .022), .39, .53),
}


def mat(key):
    material = bpy.data.materials.get(key)
    if material is None:
        color, rough, metal = FINISHES[key]
        material = bpy.data.materials.new(key)
        material.diffuse_color = (*color, 1)
        material.use_nodes = True
        shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        shader.inputs["Base Color"].default_value = (*color, 1)
        shader.inputs["Roughness"].default_value = rough
        shader.inputs["Metallic"].default_value = metal
    return material


class SeatMesh:
    def __init__(self):
        self.vertices = []
        self.faces = []

    def point(self, radius, angle, z):
        self.vertices.append((radius * math.cos(angle), -.025 + .924 * radius * math.sin(angle), z))
        return len(self.vertices) - 1

    def bridge(self, row, previous, loop=False):
        for i in range(len(row) if loop else len(row) - 1):
            j = (i + 1) % len(row)
            self.faces.append((previous[i], previous[j], row[j], row[i]))

    def lathe(self, profile, count):
        previous = []
        for radius, z in profile:
            if radius == 0:
                current = [self.point(0, 0, z)]
            else:
                current = [self.point(radius, TAU * i / count, z) for i in range(count)]
            if previous:
                if len(previous) == 1:
                    self.faces.extend((previous[0], current[(i+1) % count], current[i]) for i in range(count))
                elif len(current) == 1:
                    self.faces.extend((previous[i], previous[(i+1) % count], current[0]) for i in range(count))
                else:
                    self.bridge(current, previous, True)
            previous = current

    def finish(self):
        mesh = bpy.data.meshes.new("Lotus carving")
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.materials.append(mat("gold"))
        mesh.update()
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.collection.objects.link(obj)


def tier_petal(mesh, angle, count, upper, inner, phone):
    # A repoussé shield: its rounded face turns back into the collar at the lip.
    # Concentric loops follow the marginal chasing, so highlights wrap around each leaf.
    segments = (12 if phone else 26) if not inner else (8 if phone else 16)
    rings = [(0,.037),(.54,.032),(.74,.021),(.81,.018),(.90,.026),(.965,.022),(1,.008),(.99,-.009)]
    if inner or phone:
        rings = [(0,.034),(.70,.022),(.88,.026),(1,.009),(.99,-.009)]
    height = .172 if upper else .16
    zroot = .199 if upper else .218
    if inner:
        height += .024
    previous = []
    for fraction, depth in rings:
        current = []
        for k in range(segments if fraction else 1):
            phi = TAU*k/segments
            u = fraction*math.copysign(abs(math.cos(phi))**.88, math.cos(phi))
            w = fraction*math.copysign(abs(math.sin(phi))**.83, math.sin(phi))
            # A slight central cleft at the outer end, deeper on the inverted leaves.
            v = .5 + .50*w - (.063 if upper else .18)*max(w,0)**3*math.exp(-(u/.22)**2)
            # Width is broad even near the seat's waist; under-course leaves fill
            # the spaces between the rounded, slightly overlapping front shields.
            a = angle + (math.pi/count)*u*(1.025 + .025*w)
            r = .539 + (.100 if upper else .110)*math.sin(v*1.47) + depth
            if not upper:
                # The pair of lobes on the inverted row has a short central furrow.
                r -= .012 * math.exp(-(u/.18)**2) * max(0, w+.28)**1.7
            if inner:
                r -= .018
            z = zroot + (height*v if upper else -height*v)
            current.append(mesh.point(r, a, z))
        if previous:
            for j in range(segments):
                h = (j+1)%segments
                face = ((previous[0],current[j],current[h]) if len(previous)==1
                        else (previous[j],current[j],current[h],previous[h]))
                mesh.faces.append(face if upper else tuple(reversed(face)))
        previous = current



def underside(mesh, phone):
    # The lowest bearing ring remains flat. The twelve convex lobes sit inside the recess.
    n = 4 if phone else 10
    for i in range(12):
        previous = []
        for v in (0, .28, .63, .86, 1):
            current = []
            for j in range(n+1):
                u = 2*j/n - 1
                edge = abs(u)
                r = .143 + .359*v - .069*edge**3*v**2 - .012*math.exp(-(u/.19)**2)*v**3
                a = TAU * i/12 + u*.237*(.71 + .28*math.sin(v*2))
                belly = math.sin(math.pi*v)**.7 * (1-edge**2)**.7
                z = .023 - .016*belly - .005*math.exp(-((edge-.76)/.12)**2)*math.sin(math.pi*v)
                current.append(mesh.point(r, a, z))
            if previous:
                mesh.bridge(current, previous)
            previous = current


def build_lotus(phone):
    mesh = SeatMesh()
    # A turned foot, a waist between the leaf courses and a small bead under the cushion.
    profile = [(0,.022),(.16,.022),(.166,.006),(.177,.006),(.186,.022),
               (.50,.025),(.526,.020),(.535,.009),(.546,.009),(.555,.026),
               (.598,.028),(.607,.011),(.622,0),(.653,0),(.665,.005),
               (.666,.035),(.661,.042),(.633,.047),(.610,.073),
               (.561,.177),(.539,.192),(.546,.199),(.555,.205),(.550,.216),
               (.541,.221),(.566,.254),(.627,.351),(.63,.369),
               (.641,.374),(.649,.382),(.648,.389),(.642,.394),
               (.606,.398),(.586,.414),(.550,.425),(0,.425)]
    if phone:
        profile = [p for i,p in enumerate(profile) if i not in (2,4,7,9,10,14,16,18,20,23,25,27,32)]
    mesh.lathe(profile, 44 if phone else 84)
    for upper, count in ((False, 20), (True, 18)):
        for inner in (True, False):
            for i in range(count):
                a = TAU / count * (i + (.50 if inner else 0) + (.25 if upper else 0)) - math.pi/2
                tier_petal(mesh, a, count, upper, inner, phone)
    underside(mesh, phone)
    mesh.finish()
