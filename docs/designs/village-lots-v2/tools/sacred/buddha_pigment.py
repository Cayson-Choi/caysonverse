"""Hand-painted features for the hall Buddha's frontal UV island, in sculpt metres."""
import numpy as np

# Linear reflectance, roughness and metalness of the leaf on bare skin.
GILT_SKIN = ((.94, .529, .074), .335, .86)

# The pigment and relief share the same small offset inside the facial oval.
# The centre of the lips and the urna sit just to the right of the crown.
FACE_AXIS = .0040
EYE_INNER, EYE_SPAN = .0320, .1055
BROW_INNER, BROW_SPAN = .030, .108
LIP_RADIUS = .0465


def smooth(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0., 1.)
    return t*t*(3. - 2.*t)


def eyelid_height(t, arc):
    # Upper lash in the frontal projection, from the tear duct to the temple.
    return 1.6816 + .0002*t - .0015*arc - .0027*t**6 - .0020*(1.-t)**8


def brow_height(t, arc):
    return 1.7190 + .0204*arc*(.85+.30*t) - .0062*t*t


def lip_height(t):
    return 1.5522 + .0042*t**2 - .0010*(1.-t)**3


def paint_hairline(result, kind, x, z):
    # Continue the last row of cast curls onto the forehead pigment island.
    # The charcoal edge dips at the centre and rejoins the casting at each temple.
    region = (np.abs(x) < .146) & (z > 1.770)
    a, height = np.abs(x[region]), z[region]
    angle = np.arcsin(a/.160)
    u = 2.*(np.mod(angle*40./(2.*np.pi)+.5, 1.)-.5)
    edge = (1.7944 - .0029*(1.-u*u)**2 + .0023*np.sin(.5*np.pi*np.minimum(a/.085, 1.))**2
            - .014*(np.maximum(a-.077, 0.)/.071)**2)
    mask = smooth(edge-.0013, edge+.0016, height) * (1.-smooth(.138, .146, a))
    # The scalp has forty curls per turn at this height. Stagger this shallow
    # row by half a curl and taper its relief into the black lacquer between rows.
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
    result = np.empty((*x.shape, 3), dtype=np.float32)
    if kind == "normal":
        # The integrated lids, alae and lips supply their own smooth normals.
        result[...] = (.5, .5, 1.)
        paint_hairline(result, kind, x, z)
        return result
    if kind not in ("color", "orm"):
        raise ValueError(f"Unknown Buddha face map {kind!r}")
    color = kind == "color"
    scalp_x = x
    x = x-FACE_AXIS
    a = np.abs(x)

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
    ink = (1., .71, .68)
    vermilion = (1., .66, .91)
    result[...] = leaf if color else skin
    mask = (1.-smooth(.130,.161,a))*smooth(1.445,1.481,z)
    lay(mask, (.935,.431,.020), (1.,.59,.87))
    polish = np.maximum.reduce((spot(.0,1.755,.100,.051), spot(.072,1.646,.063,.048),
                                spot(.0,1.658,.014,.060), spot(.0,1.615,.015,.014),
                                spot(.025,1.616,.010,.012),spot(.0,1.512,.050,.032)))
    lay(polish, (.980,.520,.054), (1.,.58,.87))

    eye_t = np.clip((a-EYE_INNER)/EYE_SPAN, 0., 1.)
    arc = np.sin(np.pi*eye_t).clip(0., 1.)
    upper = eyelid_height(eye_t, arc)
    lower = upper - .0104*arc**.86
    # Blend a broad roll of gold over the eye; the soft crease dissolves
    # before the ends so it does not turn into a second lash at game scale.
    fold = upper + .017 + .031*arc
    lid_roll = upper + .007 + .016*arc
    lay(.89*np.exp(-((z-fold)/.0153)**2)*arc**.56, (.49,.175,.007), (1.,.56,.72))
    lay(.82*np.exp(-((z-lid_roll)/.0160)**2)*arc**1.47, (1.,.604,.097), (1.,.54,.72))
    lay(.63*np.exp(-((z-lower+.003)/.0086)**2)*arc, (.50,.230,.017), (1.,.54,.68))
    # The warm hollow turns inward under the brow and continues along the
    # side plane of the bridge. There is no second drawn contour here.
    orbit_x=.022+.046*smooth(1.676,1.730,z)**1.64
    orbit=np.exp(-((a-orbit_x)/.0145)**2-((z-1.699)/.036)**4)
    lay(.77*orbit, (.555,.183,.006), (1.,.64,.87))
    lay(.32*spot(.062,1.647,.038,.021), (.995,.63,.108), (1.,.61,.88))

    brow_t = np.clip((a-BROW_INNER)/BROW_SPAN, 0., 1.)
    brow_arc = np.sin(np.pi*brow_t).clip(0., 1.)
    brow = brow_height(brow_t, brow_arc)
    brow_width = .0071*brow_arc**.60
    brow_ends = smooth(BROW_INNER,BROW_INNER+.002,a) * (1.-smooth(.135,.138,a))
    brow_mask = band(brow-.44*brow_width, brow+.56*brow_width, .00156)*brow_ends
    lay(.36*np.exp(-((z-brow+.0034)/.0037)**2)*brow_arc, (.483,.320,.040), skin)
    lay(.96*brow_mask, (.142,.194,.043), ink)
    brow_rim = np.exp(-((z-brow-.58*brow_width)/.0028)**2)*brow_arc
    lay(.65*brow_rim, (.93,.652,.209), (1.,.53,.63))

    # The half-closed eye shows an amber sclera beside a low umber iris.
    # Keep the bare inner and outer corners warm and the lash thin.
    eye_ends = smooth(.031,.035,a) * (1.-smooth(.127,.1375,a))
    opening = band(lower, upper, .0025)*eye_ends
    lay(opening, (.37,.143,.025), ink)
    windows = np.exp(-((eye_t-.237)/.064)**2) + np.exp(-((eye_t-.633)/.061)**2)
    lay(opening*windows, (.92,.610,.240), ink)
    iris = ((eye_t-.47)/.166)**2 + ((z-upper+.0004)/.013)**2
    lay(opening*(1.-smooth(.60,1.34,iris)), (.067,.018,.0015), ink)
    lower_rim=np.exp(-((z-lower)/.0037)**2)*arc**1.4
    lay(.34*lower_rim,(.62,.264,.027),ink)
    lash_width = .0024 + .0015*arc**.60
    lash = band(upper-.53*lash_width, upper+.47*lash_width, .0017 if phone else .0015)*eye_ends
    lay(lash*(.77+.19*arc), (.110,.040,.005), ink)
    wash=np.exp(-((z-upper)/.0042)**2)*smooth(.108,.124,a)*(1.-smooth(.123,.140,a))
    lay(.50*wash, (.345,.139,.016), (1.,.66,.79))

    # A warm return around each wing and a tiny occluded aperture tucked
    # beneath it. Leave the strip of gold across the columella unbroken.
    bridge_side = spot(.024,1.675,.014,.052)
    lay(.46*bridge_side, (.58,.245,.015), (1.,.55,.69))
    lay(.60*spot(.0,1.649,.012,.034), (1.,.626,.182), (1.,.63,.89))
    lay(.57*spot(.0,1.643,.010,.024), (1.,.666,.238), (1.,.64,.89))
    # The wings turn away on either side of the bridge before their outer
    # rims catch the light. Their high point sits above the tucked apertures.
    flank=spot(.024,1.633,.012,.022)
    lay(.78*flank, (.637,.258,.011), (1.,.67,.89))
    lay(.77*spot(.0,1.606,.021,.015), (.800,.325,.022), (1.,.65,.88))
    lay(.74*spot(.029,1.618,.008,.0095), (.99,.579,.085), (1.,.65,.88))
    lay(.58*spot(.0,1.591,.031,.010), (.54,.219,.014), (1.,.56,.68))
    aperture = np.exp(-((a-.0178)/.0085)**2-((z-1.5905-.112*(a-.0178))/.0044)**2)
    lay(.84*aperture, (.257,.077,.005), (1.,.63,.50))
    lay(.65*spot(.0,1.590,.009,.009), (.92,.459,.024), (1.,.64,.83))
    lay(.81*spot(.0,1.575,.016,.009), (.600,.222,.013), (1.,.64,.86))

    lip_t = np.clip(a/LIP_RADIUS, 0., 1.)
    seam = lip_height(lip_t)
    lip_fall = (1.-lip_t**2.8)**.87
    peaks = np.exp(-((lip_t-.38)/.29)**2)
    top = seam + (.0083+.0048*peaks)*lip_fall
    bottom = seam - .0184*lip_fall
    lip_ends = 1.-smooth(.0425,.0470,a)
    lips = band(bottom, top, .0033+.0018*lip_t**3) * lip_ends
    lay(.62*spot(.0,1.530,.037,.0085), (.585,.190,.005), (1.,.58,.73))
    lay(.70*band(bottom-.0053,top+.0018,.0052)*lip_ends, (.802,.136,.004), (1.,.64,.84))
    lay(lips, (.793,.026,.0012), vermilion)
    lay(.44*spot(.018,1.560,.014,.0048)*lips, (.865,.053,.003), vermilion)
    lower_glaze = lips * (1.-smooth(seam-.005,seam+.0014,z))
    lay(lower_glaze, (.789,.035,.0018), vermilion)
    gloss_z = seam-.0097+.0048*lip_t**1.5
    gloss = np.exp(-(x/.030)**2-((z-gloss_z)/.0032)**2)
    gloss *= .89+.11*np.cos(182*x+.50)
    lay(.98*gloss*lower_glaze, (.998,.213,.033), (1.,.60,.87))
    meeting = np.exp(-((z-seam)/.0024)**2)*lip_fall*lips
    lay(.52*meeting, (.417,.018,.0014), vermilion)
    lay(.33*spot(.0445,1.5545,.0054,.0035), (.535,.266,.017), skin)

    # Two loaded brush strokes descend from the philtrum and turn up clear
    # of the lip corners. A fine wedge of gold remains between their roots.
    whisker_t = np.clip((a-.007)/.056, 0., 1.)
    whisker_z = (1.5760 - .0205*smooth(.00,.71,whisker_t)
                 + .0031*smooth(.73,1.,whisker_t))
    load = np.sin(np.pi*whisker_t).clip(0.,1.)**.38
    whisker = np.exp(-((z-whisker_z)/(.0019+.0014*load))**2)*load
    # A dry brush splits into a pair of short tapered hairs at the corner.
    end=smooth(.043,.055,a)*(1.-smooth(.060,.065,a))
    strokes=(np.exp(-((z-whisker_z-.0037)/.0023)**2)
             + .76*np.exp(-((z-whisker_z+.0032)/.0019)**2))*end
    lay(.79*np.maximum(whisker*(1.-.28*smooth(.031,.050,a)),.70*strokes),
        (.165,.106,.018), ink)
    # Three brush dabs form the short inverted triangle on the chin.
    tuft = spot(.013,1.487,.0025,.0035) + spot(.0,1.479,.0024,.0027)
    lay(.92*tuft, (.086,.054,.012), ink)
    # A shallow contact shadow seats the rounded forehead bead.
    lay(.44*spot(.000,1.718,.007,.0050), (.565,.257,.024), (1.,.63,.84))

    if not color:
        satin = np.maximum(spot(.0,1.687,.045,.075), spot(.08,1.695,.072,.094))
        bare = mask*(1.-np.maximum.reduce((opening,lash,brow_mask,lips)))
        result[...,1] += .12*satin*bare
        lamp = np.maximum(spot(.0,1.747,.094,.048), spot(.0,1.653,.029,.059))
        result[...,1] += .080*lamp*bare
        result[...,2] += (.94-result[...,2])*.67*lamp*bare
    paint_hairline(result, kind, scalp_x, z)
    if color:
        result = np.where(result <= .0031308, 12.92*result, 1.055*result**(1./2.4)-.055)
    return result.astype(np.float32, copy=False)
