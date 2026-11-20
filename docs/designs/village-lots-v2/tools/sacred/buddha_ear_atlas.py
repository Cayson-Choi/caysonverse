"""Bake the continuous pinna relief into the tangent space of each reduced ear."""
import numpy as np

from buddha_ears import OUTLINE, YU, ZV, cartilage
from buddha_pigment import GILT_SKIN


def ear_chart_uv(x,y,z):
    # Opposite pinnae have separate tangent bases after mesh reduction.
    u = 92+(y-.176)/YU
    v = 17+(1.748-z)/ZV
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


def rolled_cartilage(u,v):
    bowl = np.exp(-((u-95)/34)**2-((v-79)/36)**2)
    concha = np.exp(-((u-80)/13)**2-((v-128)/15)**2)
    folds = np.zeros((len(v),u.size))
    for segments, amplitude, width in cartilage():
        best = np.full_like(folds,1.e9)
        strength = np.zeros_like(folds)
        for x,y,dx,dy,length2,start,end in segments:
            q = np.clip(((u-x)*dx+(v-y)*dy)/length2,0,1)
            distance = (u-x-q*dx)**2+(v-y-q*dy)**2
            strength = np.where(distance<best,start+q*(end-start),strength)
            best = np.minimum(best,distance)
        folds += amplitude*strength*np.exp(-best/width**2)
    return folds-.019*bowl-.021*concha, (bowl,concha,folds)


def ear_finish_patch(patch,kind,triangles):
    from buddha_head import profile
    h,w = patch.shape[:2]
    s = (np.arange(w)+.5)/w
    t = ((np.arange(h)+.5)/h)[:,None]
    u = (40+(np.mod(s,.5)-.025)*112/.45)[None,:]
    v = 340-(t-.035)*326/.93
    left,right,cx,rx = np.array([profile(OUTLINE,float(z)) for z in v[:,0]]).T[:,:,None]
    across = np.clip((2*u-left-right)/np.maximum(1.,right-left),-1,1)
    roundness = np.sqrt(1-across**2)
    relief,(bowl,concha,folds) = rolled_cartilage(u,v)
    tilt = .00018*(u-(left+right)/2)
    # Feather the tint off the rim and at the boundary with ordinary skin.
    mask = np.clip(roundness*3.2,0,1)
    recess = mask*np.clip(.72*bowl+.83*concha,0,.90)*(1-.85*np.clip(folds/.012,0,1))
    if kind == "color":
        skin = np.array(GILT_SKIN[0])
        leaf = skin*(.975-recess[...,None]*np.array([.58,.74,.87]))
        patch[:,:,:3] = np.where(leaf<=.0031308,12.92*leaf,1.055*leaf**(1/2.4)-.055)
        return
    if kind == "orm":
        patch[:,:,0] = .995-.40*recess
        patch[:,:,1] = GILT_SKIN[1]+.10*recess
        patch[:,:,2] = GILT_SKIN[2]
        return

    # Transfer the normal of the continuous shell. Subtracting the low-poly
    # tangent frame per texel prevents its planar concha from showing through.
    # The lateral envelope controls the mesh silhouette. Its row-wise maximum
    # switches between crests, so use the continuous relief for surface light.
    height = cx+tilt+roundness*(rx+relief)
    dxdu = np.gradient(height,axis=1)/(112/(.45*w)*YU)
    dxdv = np.gradient(height,axis=0)/(-326/(.93*h)*ZV)
    normal = unit(np.stack((np.broadcast_to(np.where(s<.5,1.,-1.),height.shape),-dxdu,dxdv),axis=-1))
    # Leave the silhouette, piercing and lower pendant to their smooth casting.
    blend = np.clip(roundness*3.4-.8,0,1)*np.clip((185-v)/28,0,1)
    patch[:,:,:3] = (.5,.5,1.)
    covered = np.zeros((h,w),bool)
    for coords,frames in triangles:
        pts = coords*[w,h]-.5
        lo = np.maximum(0,np.floor(np.min(pts,axis=0)).astype(int))
        hi = np.minimum([w,h],np.ceil(np.max(pts,axis=0)).astype(int)+1)
        x,y = lo
        X,Y = hi
        if x>=X or y>=Y:
            continue
        a,b,c = pts
        ab,ac = b-a,c-a
        det = ab[0]*ac[1]-ab[1]*ac[0]
        if abs(det)<1.e-8:
            continue
        yy,xx = np.mgrid[y:Y,x:X]
        px,py = xx-a[0],yy-a[1]
        wb = (px*ac[1]-py*ac[0])/det
        wc = (ab[0]*py-ab[1]*px)/det
        wa = 1.-wb-wc
        valid = (wa>=0)&(wb>=0)&(wc>=0)
        if not np.any(valid):
            continue
        weights = np.stack((wa[valid],wb[valid],wc[valid]),axis=-1)
        basis = unit(np.einsum("pi,ijk->pjk",weights,frames))
        actual = normal[y:Y,x:X][valid]
        local = np.einsum("pij,pj->pi",basis,actual)
        amount = blend[y:Y,x:X][valid,None]
        local = unit(amount*local+(1.-amount)*np.array([0.,0.,1.]))
        patch[y:Y,x:X,:3][valid] = .5+.5*local
        covered[y:Y,x:X] |= valid
    # Carry border samples across a two-texel gutter for atlas filtering.
    for _ in range(2):
        old = covered.copy()
        for axis,shift in ((0,-1),(0,1),(1,-1),(1,1)):
            fill = np.roll(old,shift,axis)&~covered
            patch[fill] = np.roll(patch,shift,axis)[fill]
            covered |= fill
