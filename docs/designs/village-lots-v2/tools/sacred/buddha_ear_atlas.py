"""Bake the continuous pinna relief into the tangent space of each reduced ear."""
import numpy as np

from buddha_ears import EAR_Y, EAR_Z, TILT, YU, ZV, relief, section
from buddha_pigment import GILT_SKIN


def ear_chart_uv(x,y,z):
    u = 92+(y-EAR_Y)/YU
    v = 17+(EAR_Z-z)/ZV
    return (.025+.45*(u-40)/112 + (.5 if x<0 else 0),
            .035+.93*(340-v)/326)


def ear_tangent_basis(mesh, atlas):
    triangles = []
    for p in mesh.polygons:
        if mesh.materials[p.material_index].name != "Auricular relief":
            continue
        coords, vertices, normals = [], [], []
        for k in p.loop_indices:
            u,v = atlas.data[k].uv
            coords.append((8*u-3,2*v-1))
            vertices.append(mesh.vertices[mesh.loops[k].vertex_index].co)
            normals.append(mesh.corner_normals[k].vector)
        ab,ac = vertices[1]-vertices[0], vertices[2]-vertices[0]
        uv1,uv2 = np.array(coords[1:])-coords[0]
        det = uv1[0]*uv2[1]-uv1[1]*uv2[0]
        if abs(det)<1.e-9:
            continue
        du,dv = (ab*uv2[1]-ac*uv1[1])/det, (ac*uv1[0]-ab*uv2[0])/det
        frames = []
        for n in normals:
            t = (du-n*n.dot(du)).normalized()
            b = n.cross(t)
            frames.append((tuple(t),tuple(b if b.dot(dv)>0 else -b),tuple(n)))
        triangles.append((np.array(coords),np.array(frames)))
    return triangles


def unit(array):
    return array / np.maximum(1e-8,np.linalg.norm(array,axis=-1,keepdims=True))


def ear_finish_patch(patch,kind,triangles):
    """Bake the high-resolution pinna in the exported low-LOD tangent frames."""
    h,w = patch.shape[:2]
    s = (np.arange(w)+.5)/w
    t = (np.arange(h)[:,None]+.5)/h
    u = (40+(np.mod(s,.5)-.025)*112/.45)[None,:]
    v = 340-(t-.035)*326/.93
    lo,hi,axis,radius = section(v)[:,:,None]
    across = (2*u-lo-hi)/np.maximum(.1,hi-lo)
    lateral = np.sqrt(1-np.clip(across,-1,1)**2)
    sculpt,(bowl,concha,raised,pendant) = relief(u,v)
    edge = np.clip(lateral*3,0,1)
    recess = edge*np.clip(.47*bowl+.64*concha+.15*pendant,0,.85)*(1-.8*np.clip(raised/.014,0,1))
    rim = edge*np.exp(-((v-28)/14)**2-((u-93)/31)**4)
    if kind=="color":
        gold = np.array(GILT_SKIN[0])*(1-recess[...,None]*[.48,.65,.70])
        gold += rim[...,None]*[.024,.042,.019]
        patch[:,:,:3] = np.where(gold<=.0031308,12.92*gold,1.055*gold**(1/2.4)-.055)
        return
    if kind=="orm":
        patch[:,:,0] = .995-.31*recess
        patch[:,:,1] = GILT_SKIN[1]+.065*recess
        patch[:,:,2] = GILT_SKIN[2]-.10*rim
        return

    height = axis+TILT*(u-(hi+lo)/2)+lateral*(radius+sculpt)
    # dv/dz is negative. The atlas row order here is Blender UV order.
    slope_y = np.gradient(height,axis=1)/(112*YU/(.45*w))
    slope_z = np.gradient(height,axis=0)/(326*ZV/(.93*h))
    nx = np.broadcast_to(np.where(s<.5,1.,-1.),height.shape)
    normal = unit(np.stack((nx,-slope_y,-slope_z),axis=-1))
    mix = np.clip(lateral*4-.95,0,1)*np.clip((335-v)/13,0,1)*np.clip((v-18)/11,0,1)
    patch[:,:,:3] = (.5,.5,1.)
    covered = np.zeros((h,w),dtype=bool)
    for coords,frames in triangles:
        points = coords*[w,h]-.5
        x,y = np.maximum(0,np.floor(points.min(axis=0)).astype(int))
        X,Y = np.minimum([w,h],np.ceil(points.max(axis=0)).astype(int)+1)
        if x>=X or y>=Y:
            continue
        a,b,c = points
        ab,ac = b-a,c-a
        det = ab[0]*ac[1]-ab[1]*ac[0]
        if abs(det)<1.e-8:
            continue
        yy,xx = np.mgrid[y:Y,x:X]
        px,py = xx-a[0],yy-a[1]
        wb = (px*ac[1]-py*ac[0])/det
        wc = (ab[0]*py-ab[1]*px)/det
        wa = 1-wb-wc
        valid = (wa>=0)&(wb>=0)&(wc>=0)
        weights = np.stack((wa[valid],wb[valid],wc[valid]),axis=-1)
        basis = unit(np.einsum("pi,ijk->pjk",weights,frames))
        local = np.einsum("pij,pj->pi",basis,normal[y:Y,x:X][valid])
        weight = mix[y:Y,x:X][valid,None]
        patch[y:Y,x:X,:3][valid] = .5+.5*unit(weight*local+(1.-weight)*[0,0,1])
        covered[y:Y,x:X] |= valid
    for _ in range(3):
        old = covered.copy()
        for axis,shift in ((0,-1),(0,1),(1,-1),(1,1)):
            fill = np.roll(old,shift,axis)&~covered
            patch[fill] = np.roll(patch,shift,axis)[fill]
            covered |= fill
