"""Bake the continuous pinna relief into the tangent space of each reduced ear."""
import numpy as np

from buddha_ears import EAR_Y, FOOT_CURVE, OUTLINE, TILT, YU, ZV, cartilage, ear_row
from buddha_pigment import GILT_SKIN


def ear_chart_uv(x,y,z):
    # Opposite pinnae have separate tangent bases after mesh reduction.
    u = 92+(y-EAR_Y)/YU
    v = ear_row(z)
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
    from buddha_head import profile
    h,w = patch.shape[:2]
    s = (np.arange(w)+.5)/w
    t = ((np.arange(h)+.5)/h)[:,None]
    u = (40+(np.mod(s,.5)-.025)*112/.45)[None,:]
    v = 340-(t-.035)*326/.93
    left,right,cx,rx = np.array([profile(OUTLINE,float(z)) for z in v[:,0]]).T[:,:,None]
    across = np.clip((2*u-left-right)/np.maximum(1.,right-left),-1,1)
    roundness = np.sqrt(1-across**2)
    relief,(bowl,concha,folds) = cartilage(u,v)
    tilt = TILT*(u-(left+right)/2)
    # Feather the tint off the rim and at the boundary with ordinary skin.
    mask = np.clip(roundness*3.2,0,1)
    # Warmth collects under the two cartilage rolls, especially in the
    # deep concha. The crest and uninterrupted pendant keep the skin finish.
    recess = mask*np.clip(.60*bowl+.86*concha,0,.88)*(1-.88*np.clip(folds/.013,0,1))
    rim = np.exp(-((v-25)/16)**2-((u-94)/41)**4)*mask
    if kind == "color":
        skin = np.array(GILT_SKIN[0])
        leaf = skin*(1.-recess[...,None]*np.array([.61,.82,.85]))
        leaf += rim[...,None]*np.array([.04,.12,.055])
        patch[:,:,:3] = np.where(leaf<=.0031308,12.92*leaf,1.055*leaf**(1/2.4)-.055)
        return
    if kind == "orm":
        patch[:,:,0] = .995-.33*recess
        patch[:,:,1] = GILT_SKIN[1]+.085*recess
        patch[:,:,2] = GILT_SKIN[2]-.15*rim
        return

    # Transfer the normal of the continuous shell. Subtracting the low-poly
    # tangent frame per texel prevents its planar concha from showing through.
    height = cx+tilt+roundness*(rx+relief)
    dxdu = np.gradient(height,axis=1)/(112/(.45*w)*YU)
    vertical_pitch = ZV+2*FOOT_CURVE*np.maximum(0.,v-250)
    dxdv = np.gradient(height,axis=0)/(-326/(.93*h)*vertical_pitch)
    normal = unit(np.stack((np.broadcast_to(np.where(s<.5,1.,-1.),height.shape),-dxdu,dxdv),axis=-1))
    # The soft lateral shading runs across the lobe. Feather at its edge and
    # ends so that the smoothly shaded return carries the grazing reflection.
    blend = np.clip(roundness*3.4-.8,0,1)*np.clip((333-v)/18,0,1)*np.clip((v-19)/13,0,1)
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
