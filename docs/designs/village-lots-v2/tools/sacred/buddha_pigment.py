"""Hand-painted features for the hall Buddha's frontal UV island, in sculpt metres."""
import numpy as np

# Linear reflectance, roughness and metalness of the leaf on bare skin.
GILT_SKIN = ((.94, .529, .074), .335, .86)


def smooth(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0., 1.)
    return t*t*(3. - 2.*t)


def eyelid_height(t, arc):
    # The outer third of the upper lid settles back down toward the temple.
    return 1.6799 - .0055*arc + .0027*t - .0053*t**3


def brow_height(t, arc):
    return 1.7155 + .023*arc**.94 + .0018*t


def lip_height(t):
    return 1.553 + .0036*t**2 - .00055*(1.-t)**4


def paint_hairline(result, kind, x, z):
    # Continue the last row of cast curls onto the forehead pigment island.
    # The charcoal edge dips at the centre and rejoins the casting at each temple.
    region = (np.abs(x) < .146) & (z > 1.770)
    a, height = np.abs(x[region]), z[region]
    edge = (1.7875 + .0023*np.sin(.5*np.pi*np.minimum(a/.085, 1.))**2
            - .014*(np.maximum(a-.077, 0.)/.071)**2)
    mask = smooth(edge-.0013, edge+.0016, height) * (1.-smooth(.138, .146, a))
    # The scalp has forty curls per turn at this height. Stagger this shallow
    # row by half a curl and taper its relief into the black lacquer between rows.
    angle = np.arcsin(a/.160)
    u = 2.*(np.mod(angle*40./(2.*np.pi)+.5, 1.)-.5)
    v = 2.*(height-edge)/.014 - 1.
    pad = np.maximum(0., 1.-u*u-v*v)
    if kind == "color":
        field = .0018 + .016*pad**1.5
        root = np.stack((field, field*1.09, field*1.16), axis=-1)
    elif kind == "orm":
        root = np.stack((.65+.30*pad, .45-.14*pad, .78-.59*pad), axis=-1)
    else:
        nx = .31*np.sign(x[region])*u*pad*mask
        ny = .44*v*pad*mask
        result[region] = .5 + .5*np.stack((nx, ny, np.sqrt(1.-nx*nx-ny*ny)), axis=-1)
        return
    result[region] += (root-result[region])*mask[:, None]


def face_patch(kind, x, z, phone=False):
    """Return sRGB color or linear ORM/tangent normals, with rows ascending in z."""
    x, z = np.broadcast_arrays(np.asarray(x, dtype=np.float32), np.asarray(z, dtype=np.float32))
    a = np.abs(x)
    result = np.empty((*x.shape, 3), dtype=np.float32)
    if kind == "normal":
        # The integrated lids, alae and lips supply their own smooth normals.
        result[...] = (.5, .5, 1.)
        paint_hairline(result, kind, x, z)
        return result
    if kind not in ("color", "orm"):
        raise ValueError(f"Unknown Buddha face map {kind!r}")
    color = kind == "color"

    def spot(cx, cz, rx, rz):
        return np.exp(-((a-cx)/rx)**2 - ((z-cz)/rz)**2)

    def band(below, above, feather):
        return smooth(below-feather, below+feather, z) * (1.-smooth(above-feather, above+feather, z))

    def lay(mask, rgb, finish):
        target = rgb if color else finish
        for channel, value in enumerate(target):
            result[..., channel] += (value-result[..., channel]) * mask

    # Continuous leaf around the jaw and neck. The high planes are more
    # burnished, so their softbox or door reflections move with the camera.
    leaf, roughness, metallic = GILT_SKIN
    skin = (1., roughness, metallic)
    ink = (1., .76, .18 if phone else .52)
    vermilion = (1., .72, .28 if phone else .55)
    result[...] = leaf if color else skin
    polish = np.maximum.reduce((spot(.0,1.757,.092,.052), spot(.085,1.643,.045,.043),
                                spot(.0,1.656,.011,.055), spot(.0,1.610,.013,.011),
                                spot(.021,1.604,.009,.011), spot(.012,1.571,.015,.008),
                                spot(.0,1.495,.046,.028)))
    lay(polish, (.98,.590,.091), (1.,.30,.89))

    eye_t = np.clip((a-.030)/.104, 0., 1.)
    arc = np.sin(np.pi*eye_t).clip(0., 1.)
    upper = eyelid_height(eye_t, arc)
    lower = upper - .0107*arc**1.18
    # Blend a broad roll of gold over the eye; the soft crease dissolves
    # before the ends so it does not turn into a second lash at game scale.
    fold = upper + .009 + .033*arc
    lid_roll = upper + .007 + .017*arc
    lay(.47*np.exp(-((z-fold)/.0125)**2)*arc**.69, (.62,.33,.052), skin)
    lay(.60*np.exp(-((z-lid_roll)/.014)**2)*arc**2.5, (.98,.64,.12), (1.,.31,.88))
    lay(.23*np.exp(-((z-lower+.007)/.007)**2)*arc, (.708,.389,.014), skin)

    brow_t = np.clip((a-.030)/.103, 0., 1.)
    brow_arc = np.sin(np.pi*brow_t).clip(0., 1.)
    brow = brow_height(brow_t, brow_arc)
    brow_width = .0064*brow_arc**.60
    brow_ends = smooth(.030,.032,a) * (1.-smooth(.131,.133,a))
    brow_mask = band(brow-.44*brow_width, brow+.56*brow_width, .00156)*brow_ends
    lay(.36*np.exp(-((z-brow+.0034)/.0037)**2)*brow_arc, (.483,.320,.040), skin)
    lay(.98*brow_mask, (.048,.106,.021), ink)

    # The half-closed eye shows an amber sclera beside a low umber iris.
    # Keep the bare inner and outer corners warm and the lash thin.
    eye_ends = smooth(.030,.038,a) * (1.-smooth(.122,.134,a))
    opening = band(lower, upper, .0017)*eye_ends
    lay(.88*opening, (.524,.283,.063), ink)
    windows = np.exp(-((eye_t-.228)/.115)**2) + np.exp(-((eye_t-.717)/.122)**2)
    lay(.93*opening*windows, (.880,.603,.222), ink)
    iris = ((eye_t-.47)/.174)**2 + ((z-upper-.0014)/.015)**2
    lay(opening*(1.-smooth(.42,1.36,iris)), (.130,.065,.014), ink)
    lay(.84*opening*(1.-smooth(.13,.65,iris)), (.040,.018,.004), ink)
    lash_width = .0008 + .00225*arc**.71
    lash = band(upper-.50*lash_width, upper+.50*lash_width, .00121)*eye_ends
    lay(lash*(.53+.39*arc), (.129,.054,.010), ink)

    # The tip rolls over one warm, diffuse shadow. The openings face the
    # ground and need no painted outlines in a frontal portrait.
    lay(.26*spot(.018,1.596,.010,.0056), (.64,.32,.052), skin)

    lip_t = np.clip(a/.0435, 0., 1.)
    seam = lip_height(lip_t)
    lip_fall = (1.-lip_t**2)**.72
    peaks = np.exp(-((lip_t-.35)/.25)**2)
    top = seam + (.0093+.0045*peaks)*lip_fall
    bottom = seam - .0161*lip_fall
    lip_ends = 1.-smooth(.0402,.0443,a)
    lips = band(bottom, top, .0023+.0015*lip_t**3) * lip_ends
    lay(.23*spot(.0,1.536,.029,.0045), (.667,.327,.022), skin)
    lay(.28*band(bottom-.0024,top+.0018,.0031)*lip_ends, (.660,.189,.025), skin)
    lay(lips, (.495,.037,.0024), vermilion)
    lay(.50*spot(.019,1.560,.011,.0038)*lips, (.699,.084,.008), vermilion)
    lower_glaze = lips * (1.-smooth(seam-.005,seam+.0014,z))
    lay(lower_glaze, (.556,.050,.0028), vermilion)
    gloss = np.exp(-((x+.003)/.023)**2-((z-1.5455)/.0036)**2)
    gloss *= .84+.16*np.cos(182*x+.50)
    lay(.98*gloss*lower_glaze, (.956,.187,.017), (1.,.57,vermilion[2]))
    meeting = np.exp(-((z-seam)/.0024)**2)*lip_fall*lips
    lay(.83*meeting, (.195,.019,.002), vermilion)
    lay(.33*spot(.0445,1.5545,.0054,.0035), (.535,.266,.017), skin)

    # Two loaded brush strokes descend from the philtrum and turn up clear
    # of the lip corners. A fine wedge of gold remains between their roots.
    whisker_t = np.clip((a-.005)/.061, 0., 1.)
    whisker_z = (1.5695 + .0035*np.exp(-((whisker_t-.23)/.18)**2)
                 - .012*smooth(.25,.82,whisker_t) + .007*smooth(.77,1.,whisker_t))
    load = np.sin(np.pi*whisker_t).clip(0.,1.)**.46
    whisker = np.exp(-((z-whisker_z)/(.0014+.0014*load))**2)*load
    lay(.98*whisker, (.052,.036,.009), ink)
    # Three brush dabs form the short inverted triangle on the chin.
    tuft = spot(.013,1.494,.0028,.0036) + spot(.0,1.488,.0031,.0027)
    lay(.92*tuft, (.086,.054,.012), ink)

    if not color:
        # Satin leaf across the mask of the face. Feather back into the
        # matching leaf at the temples and throat, and preserve the painted ink.
        face = (1.-smooth(.130,.163,a))*smooth(1.446,1.489,z)
        high_planes = np.maximum(spot(.084,1.643,.064,.055),spot(.0,1.636,.033,.066))
        # Slightly more satin down the narrow bridge, where the lamps otherwise
        # join into a single bright stripe. Keep the small highlight on the tip.
        bridge = spot(.0,1.665,.021,.049)
        glabella = spot(.0,1.710,.038,.024)
        # The overhead lamps also catch the forehead and upper cheeks at night.
        forehead = spot(.0,1.752,.086,.048)
        cheek = spot(.079,1.647,.058,.047)
        satin = np.maximum.reduce((bridge, .72*glabella, .84*forehead, .70*cheek))
        bare_leaf = face*(1.-smooth(.39,.56,result[...,1]))
        result[...,1] += (.062+.030*high_planes+.31*satin)*bare_leaf
    elif not phone:
        # Keep the eye ink and vermilion at their accepted desktop density.
        pigment = np.maximum.reduce((lips, opening, lash, brow_mask))
        result *= 1. - pigment[..., None]*np.array((.24,.21,.16), dtype=np.float32)
    paint_hairline(result, kind, x, z)
    if color:
        result = np.where(result <= .0031308, 12.92*result, 1.055*result**(1./2.4)-.055)
    return result.astype(np.float32, copy=False)
