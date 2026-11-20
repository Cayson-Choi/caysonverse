"""Continuous helix, conchal bowl and pendant lobule, modelled in metres."""
from math import cos, exp, pi, sin

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree
from buddha_mesh import mat


# Ascending horizontal sections. Lateral width is fitted to the front outline
# while the position and thickness of the lobule are taken from the profile.
# z, centre y, anteroposterior radius, centre x, mediolateral radius.
SECTIONS = [
    (1.471,.176,.002,.155,.002),(1.476,.176,.014,.154,.015),
    (1.487,.176,.025,.153,.026),(1.502,.176,.031,.153,.031),
    (1.516,.176,.032,.154,.030),(1.541,.176,.030,.156,.026),
    (1.568,.176,.029,.160,.025),(1.597,.177,.031,.165,.028),
    (1.620,.179,.033,.172,.031),(1.645,.181,.037,.177,.031),
    (1.674,.182,.042,.180,.030),(1.699,.182,.044,.177,.029),
    (1.716,.180,.040,.172,.025),(1.730,.179,.031,.168,.022),
    (1.739,.178,.016,.162,.014),(1.742,.178,.002,.159,.003)]


def pinna(section, angle, z):
    cy, ry, cx, rx = section
    outer = cos(angle)
    y = cy + ry*sin(angle)
    # Turn the open bowl towards the viewer. Below it the lobe hangs nearly
    # vertically and its pendant tip rounds back towards the cheek.
    x = cx + .25*(y-cy) + rx*outer
    if outer > 0.:
        u = (y-.180)/.037
        h = (z-1.681)/.054
        # The helix curls under at its anterior root and tapers as it runs
        # down the posterior edge. The antihelix bends around the concha.
        bowl = exp(-1.28*((u+.14)**2+(.97*h+.05)**2))
        rim = exp(-((u*u+(h-.01)**2-.82)/.36)**2)
        rim *= 1.-.88*exp(-((h+.93)/.48)**2)
        arch = .29-.71*(h-.04)**2
        antihelix = exp(-((u-arch)/.30)**2-((h+.05)/.68)**4)
        root = -.66-.31*sin(3.4*(h+.04))
        crus = exp(-((u-root)/.25)**2-((h+.11)/.43)**4)
        tragus = exp(-((u+.69)/.28)**2-((h+.43)/.25)**2)
        canal = exp(-((u+.27)/.31)**2-((h+.39)/.33)**2)
        shaft = exp(-((z-1.566)/.067)**4-((y-.177)/.014)**2)
        x += outer**1.05*(-.023*bowl+.012*rim+.019*antihelix+
                          .014*crus+.011*tragus-.004*canal-.003*shaft)
    return x,y,z


def make_ears(phone):
    from buddha_head import profile
    for side in (1, -1):
        vertices, faces = [], []
        rings = 64
        sides = 64
        for row in range(rings+1):
            # Finer cross-sections around the helix and the underside of the lobe.
            v = .5-.5*cos(pi*row/rings)
            z = SECTIONS[0][0] + (SECTIONS[-1][0]-SECTIONS[0][0])*v
            section = profile(SECTIONS,z)
            for i in range(sides):
                angle = 2*pi*i/sides
                x,y,_ = pinna(section,angle,z)
                vertices.append((side*x,y,z))
        for r in range(rings):
            for i in range(sides):
                a=r*sides+i
                b=r*sides+(i+1)%sides
                faces.append((a,b,b+sides,a+sides))
        faces.extend((tuple(reversed(range(sides))),tuple(range(rings*sides,(rings+1)*sides))))
        if side<0:
            faces = [face[::-1] for face in faces]
        mesh=bpy.data.meshes.new("Rounded lobe and conchal folds")
        mesh.from_pydata(vertices,[],faces)
        mesh.update()
        mesh.materials.append(mat("skin"))
        mesh.polygons.foreach_set("use_smooth", [True]*len(mesh.polygons))
        obj=bpy.data.objects.new(mesh.name,mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active=obj
        # Transfer the dense casting's normals after reduction. Otherwise the
        # phone's long triangles turn the soft inner fold into a flat notch.
        field = KDTree(len(mesh.vertices))
        normals = []
        for vertex in mesh.vertices:
            field.insert(vertex.co, vertex.index)
            normals.append(vertex.normal.copy())
        field.balance()
        modifier=obj.modifiers.new("Keep the helix at game resolution","DECIMATE")
        total=sum(len(f.vertices)-2 for f in mesh.polygons)
        modifier.ratio=(158 if phone else 427)/total
        modifier.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        blended = []
        for vertex in obj.data.vertices:
            normal = Vector((0,0,0))
            for _, index, distance in field.find_n(vertex.co, 6):
                normal += normals[index] / (.0015+distance)**2
            blended.append(normal.normalized())
        obj.data.normals_split_custom_set_from_vertices(blended)
