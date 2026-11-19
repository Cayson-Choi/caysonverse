"""Continuous helix, conchal bowl and pendant lobule, modelled in metres."""
from math import cos, exp, pi, sin

import bpy
from buddha_mesh import mat


# Ascending horizontal sections. Lateral width is fitted to the front outline
# while the position and thickness of the lobule are taken from the profile.
# z, centre y, anteroposterior radius, centre x, mediolateral radius.
SECTIONS = [
    (1.451,.169,.002,.168,.002),(1.454,.168,.012,.169,.011),
    (1.464,.167,.024,.170,.019),(1.480,.167,.031,.170,.023),
    (1.502,.168,.032,.169,.024),(1.532,.170,.030,.166,.023),
    (1.561,.171,.029,.164,.022),(1.591,.173,.030,.164,.023),
    (1.617,.175,.034,.166,.025),(1.642,.178,.039,.169,.027),
    (1.671,.182,.044,.173,.028),(1.695,.183,.045,.175,.028),
    (1.712,.182,.041,.175,.027),(1.728,.181,.030,.174,.022),
    (1.737,.180,.015,.172,.014),(1.740,.180,.003,.171,.004)]


def make_ears(phone):
    from buddha_head import profile
    for side in (1, -1):
        vertices, faces = [], []
        rings = 34
        sides = 40
        for row in range(rings+1):
            # Finer cross-sections around the helix and the underside of the lobe.
            v = .5-.5*cos(pi*row/rings)
            z = 1.451 + (1.740-1.451)*v
            cy, ry, cx, rx = profile(SECTIONS,z)
            for i in range(sides):
                angle = 2*pi*i/sides
                around = sin(angle)
                outer = max(0.,cos(angle))
                y = cy + ry*around
                # The ear faces a little forward; its attachment runs behind
                # the cheek. A raised outer rim surrounds a smooth recess.
                x = cx + .30*(y-cy) + rx*cos(angle)
                if outer:
                    u=(y-.180)/.038
                    h=(z-1.668)/.048
                    bowl=exp(-1.45*((u+.095)**2+h*h))
                    rim=exp(-((u*u+h*h-.94)/.41)**2)
                    crus=exp(-((u+.11+.48*h)/.29)**2-((h+.16)/.61)**2)
                    tragus=exp(-((u+.71)/.27)**2-((h+.24)/.29)**2)
                    lobe=exp(-((z-1.483)/.042)**2-((y-.166)/.024)**2)
                    x += outer**1.1*(-.029*bowl+.005*rim+.012*crus+.009*tragus+.003*lobe)
                lobe_weight = exp(-((z-1.499)/.077)**4)
                upper_weight = exp(-((z-1.674)/.045)**2)
                x += .0065*upper_weight - .014*lobe_weight + .005*lobe_weight*cos(angle)
                height = z - .004*lobe_weight - .012*exp(-((z-1.740)/.032)**2)
                vertices.append((side*x,y,height))
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
        modifier=obj.modifiers.new("Keep the helix at game resolution","DECIMATE")
        total=sum(len(f.vertices)-2 for f in mesh.polygons)
        modifier.ratio=(158 if phone else 427)/total
        modifier.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
