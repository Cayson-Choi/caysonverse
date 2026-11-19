"""Hand-painted features for the hall Buddha's frontal UV island, in sculpt metres."""
import numpy as np

# Linear reflectance, roughness and metalness of the leaf on bare skin.
GILT_SKIN = ((.94, .529, .074), .335, .86)

# The pigment and relief share the same small offset inside the facial oval.
# The centre of the lips and the urna sit just to the right of the crown.
FACE_AXIS = .0040
EYE_INNER, EYE_SPAN = .0320, .1055
BROW_INNER, BROW_SPAN = .030, .108
LIP_RADIUS = .0415


def smooth(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0., 1.)
    return t*t*(3. - 2.*t)


def eyelid_height(t, arc):
    # Upper lash in the frontal projection, from the tear duct to the temple.
    return 1.6815 - .0012*arc + .0038*t**3 - .0065*(1.-t)**11


def brow_height(t, arc):
    return 1.7170 + .0185*arc*(.83+.39*t) - .0070*t**3


def lip_height(t):
    return 1.5494 + .0025*(4.*t*(1.-t))**2 - .0005*t**8


def paint_hairline(result, kind, x, z):
    # Continue the last row of cast curls onto the forehead pigment island.
    # The charcoal edge dips at the centre and rejoins the casting at each temple.
    region = (np.abs(x) < .146) & (z > 1.770)
    a, height = np.abs(x[region]), z[region]
    angle = np.arcsin(a/.160)
    u = 2.*(np.mod(angle*48./(2.*np.pi)+.5, 1.)-.5)
    edge = (1.7950 - .0017*(1.-u*u)**2 + .0019*np.sin(.5*np.pi*np.minimum(a/.085, 1.))**2
            - .014*(np.maximum(a-.077, 0.)/.071)**2)
    mask = smooth(edge-.0013, edge+.0016, height) * (1.-smooth(.138, .146, a))
    # The brow has six curls per 45 degree sector. Stagger this shallow
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


def face_patch(kind, x, z, phone=False, half_width=None):
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
    lay(.57*orbit, (.619,.262,.016), (1.,.64,.87))
    lay(.32*spot(.062,1.647,.038,.021), (.995,.63,.108), (1.,.61,.88))
    # The cast turns away under the inner cleft before the golden cheek.
    canthus_hollow = spot(.044,1.676,.020,.009)
    lay(.63*canthus_hollow, (.48,.195,.016), (1.,.67,.78))
    inner_fold = np.exp(-((z-upper-.0021)/.0036)**2-((a-.051)/.015)**4)
    lay(.61*inner_fold, (.332,.156,.027), (1.,.66,.75))

    brow_t = np.clip((a-BROW_INNER)/BROW_SPAN, 0., 1.)
    brow_arc = np.sin(np.pi*brow_t).clip(0., 1.)
    brow = brow_height(brow_t, brow_arc)
    # The brush carries most of its paint beyond the crown of the arch.
    # The lower edge and the fine tail retain the darker first stroke.
    brow_width = .0110*brow_arc**1.1*(.64+.71*brow_t)
    brow_ends = smooth(BROW_INNER,BROW_INNER+.0018,a) * (1.-smooth(.135,.138,a))
    brow_floor = brow-.48*brow_width
    brow_roof = brow+.52*brow_width
    brow_mask = band(brow_floor, brow_roof, .0015)*brow_ends
    lay(.39*np.exp(-((z-brow_floor+.0026)/.0029)**2)*brow_arc, (.945,.545,.103), skin)
    lay((.54+.42*brow_arc)*brow_mask, (.065,.128,.062), ink)
    green = smooth(brow_floor-.0010,brow+.14*brow_width,z)*brow_arc**.85
    lay(green*brow_mask, (.112,.339,.163), ink)
    brow_rim = np.exp(-((z-brow_roof-.0020)/.0026)**2)*brow_arc
    lay(.62*brow_rim, (.96,.680,.200), (1.,.53,.63))

    # A pointed dark canthus turns up into a narrow, warm scleral window.
    # The lash runs nearly level from that window across the low iris.
    eye_ends = smooth(.0320,.0400,a) * (1.-smooth(.119,.1365,a))
    opening = band(lower, upper, .0016)*eye_ends
    lay(opening, (.290,.113,.019), ink)
    windows = np.exp(-((eye_t-.184)/.040)**2) + np.exp(-((eye_t-.643)/.059)**2)
    lay(opening*windows, (.68,.431,.136), ink)
    iris = ((eye_t-.452)/.182)**2 + ((z-upper+.0006)/.013)**2
    lay(opening*(1.-smooth(.68,1.24,iris)), (.029,.009,.002), ink)
    lower_rim=np.exp(-((z-lower)/.0037)**2)*arc**1.4
    lay(.34*lower_rim,(.62,.264,.027),ink)
    canthus = np.exp(-((eye_t-.105)/.055)**2)
    lash_width = .0017 + .0013*arc**.60 + .0020*canthus
    lash = band(upper-.60*lash_width, upper+.40*lash_width, .0016 if phone else .0013)*eye_ends
    lay(lash*(.80+.18*np.maximum(canthus,arc)), (.030,.009,.0015), ink)
    # The inner mark is a small drop set into the open slit, tapering on both
    # sides to expose the fine gold rim next to the glint.
    duct = np.exp(-((a-.0426)/.0039)**2-((z-upper+.0017)/.0025)**2)
    lay(.83*duct, (.010,.003,.0007), ink)
    wash=np.exp(-((z-upper)/.0038)**2)*smooth(.106,.120,a)*(1.-smooth(.122,.138,a))
    lay(.52*wash, (.485,.237,.031), (1.,.66,.79))

    # A warm return around each wing and a tiny occluded aperture tucked
    # beneath it. Leave the strip of gold across the columella unbroken.
    bridge_side = spot(.024,1.675,.014,.052)
    lay(.34*bridge_side, (.66,.310,.028), (1.,.62,.78))
    lay(.71*spot(.0,1.666,.018,.049), (1.,.702,.296), (1.,.70,.81))
    lay(.68*spot(.0,1.631,.018,.021), (1.,.740,.320), (1.,.71,.80))
    # The source has a warm shadow on the left of the bridge through the
    # inner orbit. Keep the soft, pale reflection to the right of its edge.
    bridge_return = np.exp(-((x+.015)/.0095)**2-((z-1.672)/.030)**2)
    lay(.42*bridge_return, (.560,.242,.025), (1.,.68,.78))
    # The wings turn away on either side of the bridge before their outer
    # rims catch the light. Their high point sits above the tucked apertures.
    flank=spot(.023,1.634,.011,.020)
    lay(.50*flank, (.689,.313,.023), (1.,.68,.85))
    lay(.71*spot(.0,1.605,.026,.015), (.834,.351,.022), (1.,.69,.83))
    lay(.71*spot(.029,1.618,.012,.014), (.929,.484,.056), (1.,.69,.83))
    lay(.50*spot(.025,1.610,.015,.010), (.67,.300,.022), (1.,.70,.79))
    # Each alar groove follows an arc, reaching furthest into the cheek at
    # mid-height. A soft roll inside it separates the bulb from the cheek.
    wing_t = (z-1.611)/.016
    groove_x = .0338-.0065*wing_t**2
    groove = np.exp(-((a-groove_x)/.0071)**2-wing_t**2)
    lay(.38*groove, (.545,.251,.027), (1.,.70,.78))
    flank_shade = np.exp(-((x+.027)/.018)**2-((z-1.625)/.017)**2)
    lay(.66*flank_shade, (.460,.200,.018), (1.,.70,.79))
    alar_return = spot(.029,1.606,.016,.011)
    lay(.42*alar_return, (.609,.254,.016), (1.,.69,.82))
    wing_glint = spot(.027,1.614,.010,.009)
    lay(.37*wing_glint, (.95,.553,.091), (1.,.69,.81))
    # Each short nostril turns upwards with the contour of its rounded ala.
    # The two occlusions fade separately over the bottom of the central ball.
    nostril_z = 1.5887 + .0064*smooth(.016,.035,a)
    lay(.72*spot(.014,1.589,.030,.013), (.50,.199,.011), (1.,.65,.77))
    aperture = np.exp(-((a-.0193)/.0101)**2-((z-nostril_z)/.0051)**2)
    lay((.95-.20*smooth(-.010,.010,x))*aperture, (.198,.056,.003), (1.,.63,.50))
    lay(.28*spot(.0,1.590,.010,.009), (.81,.348,.018), (1.,.67,.81))
    right_return = np.exp(-((x-.030)/.012)**2-((z-1.590)/.011)**2)
    lay(.36*right_return, (.895,.492,.061), (1.,.68,.81))
    # Follow the opening around the lateral wall below the rounded wing.
    # Its outer end is visible just behind the tip in profile.
    lateral_opening=spot(.0335,1.590,.005,.0038)
    lay(.12*lateral_opening, (.260,.087,.009), (1.,.68,.65))
    lateral_ala=spot(.0365,1.610,.011,.013)
    lay(.34*lateral_ala, (.969,.551,.097), (1.,.70,.82))
    lay(.81*spot(.0,1.575,.016,.009), (.600,.222,.013), (1.,.64,.86))

    lip_t = np.clip(a/LIP_RADIUS, 0., 1.)
    seam = lip_height(lip_t)
    lip_fall = (1.-lip_t**3.25)**1.04
    peaks = np.exp(-((lip_t-.385)/.245)**2)
    top = seam + (.0077+.0045*peaks)*lip_fall
    # The bottom bevel spans the centre in a smooth arc below the upper bow.
    bottom = seam + (1.5345-seam)*lip_fall
    lip_ends = 1.-smooth(LIP_RADIUS-.0035,LIP_RADIUS+.0005,a)
    lips = band(bottom, top, .0021+.0007*lip_t**3) * lip_ends
    lay(.62*spot(.0,1.530,.037,.0085), (.585,.190,.005), (1.,.58,.73))
    lay(.70*band(bottom-.0053,top+.0018,.0052)*lip_ends, (.802,.136,.004), (1.,.64,.84))
    lay(lips, (.793,.026,.0012), vermilion)
    lay(.44*spot(.018,1.560,.014,.0048)*lips, (.865,.053,.003), vermilion)
    lower_glaze = lips * (1.-smooth(seam-.005,seam+.0014,z))
    lay(lower_glaze, (.789,.035,.0018), vermilion)
    gloss_z = 1.5417 + .0034*(1.-np.exp(-(x/.014)**2))
    gloss = np.exp(-((x+.0018)/.027)**4-((z-gloss_z)/.0026)**2)
    gloss *= .46 + .51*np.exp(-((a-.020)/.008)**2)
    lay(.98*gloss*lower_glaze, (.998,.232,.034), (1.,.60,.87))
    meeting = np.exp(-((z-seam)/.0024)**2)*lips
    lay(.68*meeting, (.345,.012,.0015), vermilion)
    lay(.72*spot(LIP_RADIUS-.002,1.551,.0046,.0033), (.284,.072,.009), ink)

    # The teal strokes narrow to a fine, rising flick beyond each lip corner.
    whisker_z = (1.5638 + .0045*smooth(.008,.024,a)
                 - .0156*smooth(.024,.053,a) + .0025*smooth(.051,.0565,a))
    load = np.exp(-((a-.024)/.016)**2)
    taper = smooth(.042,.0565,a)
    width = .0016 + .0037*load - .0008*taper
    whisker = band(whisker_z-width,whisker_z+width,.0022-.0014*taper)
    whisker *= smooth(.007,.018,a)*(1.-smooth(.0545,.0575,a))
    patina = smooth(.011,.023,a)*(1.-smooth(.037,.052,a))
    lay(.88*whisker, (.097,.132,.058), ink)
    lay(.93*patina*whisker, (.151,.308,.133), ink)
    # Two short dabs and a fainter, lower centre dab form the shallow chin V.
    tuft_z = 1.4823 + .0019*smooth(.009,.015,a)
    tuft = np.exp(-((z-tuft_z)/.0044)**2-((a-.0126)/.0036)**2)
    tuft += .71*spot(.000,1.4763,.0040,.0035)
    lay(.87*tuft, (.091,.079,.032), ink)
    # A shallow contact shadow seats the rounded forehead bead.
    lay(.39*spot(.000,1.722,.0084,.0052), (.565,.257,.024), (1.,.63,.84))

    if not color:
        satin = np.maximum(spot(.0,1.687,.045,.075), spot(.08,1.695,.072,.094))
        bare = mask*(1.-np.maximum.reduce((opening,lash,brow_mask,lips)))
        result[...,1] += .12*satin*bare
        lamp = np.maximum(spot(.0,1.747,.094,.048), spot(.0,1.653,.029,.059))
        result[...,1] += .080*lamp*bare
        result[...,2] += (.94-result[...,2])*.67*lamp*bare
    if half_width is not None:
        # The cheek's planar island ends at a narrower section on each step
        # under the jaw. Burnish its outer edge into the adjoining bare leaf.
        jaw_rim = smooth(.76,.965,np.abs(scalp_x)/half_width)*(1.-smooth(1.66,1.71,z))
        lay(jaw_rim, leaf, skin)
    paint_hairline(result, kind, scalp_x, z)
    if color:
        result = np.where(result <= .0031308, 12.92*result, 1.055*result**(1./2.4)-.055)
    return result.astype(np.float32, copy=False)
