"""Hand-painted features for the hall Buddha's frontal UV island, in sculpt metres."""
import numpy as np


def smooth(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0., 1.)
    return t*t*(3. - 2.*t)


def eyelid_height(t, arc):
    # The outer third of the upper lid settles back down toward the temple.
    return 1.6825 - .0055*arc + .0027*t - .0053*t**3


def brow_height(t, arc):
    return 1.7155 + .023*arc**.94 + .0018*t


def lip_height(t):
    return 1.553 + .0036*t**2 - .00055*(1.-t)**4


def face_patch(kind, x, z, phone=False):
    """Return sRGB color or linear ORM/tangent normals, with rows ascending in z."""
    x, z = np.broadcast_arrays(np.asarray(x, dtype=np.float32), np.asarray(z, dtype=np.float32))
    a = np.abs(x)
    result = np.empty((*x.shape, 3), dtype=np.float32)
    if kind == "normal":
        # The integrated lids, alae and lips supply their own smooth normals.
        result[...] = (.5, .5, 1.)
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

    # Match the leaf at the nape and under the jaw. Across the visible oval a
    # satin lacquer spreads the hall's bright door and lamp reflections.
    half_width = np.interp(z, (1.430,1.442,1.454,1.474,1.494,1.518,1.545,1.580,1.644,1.749),
                           (.031,.062,.085,.105,.122,.135,.146,.151,.157,.161))
    lateral = 1.-smooth(.78, .99, a/half_width)
    face = lateral*smooth(1.435, 1.466, z) if color else lateral
    # The desktop room reflects the lamps much more strongly in its shadows.
    # Tinted metallic reflections retain the colour of the lacquer and ink.
    skin = (1., .72 if phone else .69, .42 if phone else .715)
    ink = (1., .76, .18 if phone else .52)
    vermilion = (1., .72, .28 if phone else .55)
    result[...] = (.96, .611, .031) if color else (1., .39, .84)
    leaf = (.933,.550,.064) if phone else (.815,.496,.028)
    gold_light = (.998,.746,.208) if phone else (.979,.594,.074)
    lay(face, leaf, skin)
    planes = (.62*spot(.0,1.757,.079,.048) + .69*spot(.080,1.628,.047,.046)
              + .62*spot(.0,1.645,.014,.052) + .43*spot(.0,1.498,.047,.023))
    lay(planes*face, gold_light, skin)

    eye_t = np.clip((a-.030)/.104, 0., 1.)
    arc = np.sin(np.pi*eye_t).clip(0., 1.)
    upper = eyelid_height(eye_t, arc)
    lower = upper - .0107*arc**1.18
    # Blend a broad roll of gold over the eye; the soft crease dissolves
    # before the ends so it does not turn into a second lash at game scale.
    fold = upper + .009 + .033*arc
    lid_roll = upper + .007 + .017*arc
    lay(.79*np.exp(-((z-fold)/.0125)**2)*arc**.69, (.547,.280,.019), skin)
    lid_light = (.997,.780,.221) if phone else (.994,.716,.137)
    lay(.94*np.exp(-((z-lid_roll)/.014)**2)*arc**2.5, lid_light, skin)
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
    nasal_light = (.998,.762,.223) if phone else (.993,.738,.152)
    lay(.68*spot(.0,1.641,.012,.049), nasal_light, skin)
    lay(.88*spot(.0,1.605,.015,.010), nasal_light, skin)
    lay(.68*spot(.022,1.598,.009,.009), nasal_light, skin)
    lay(.35*spot(.009,1.585,.020,.0056), (.593,.319,.024), skin)

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

    whisker_t = np.clip((a-.009)/.052, 0., 1.)
    whisker_z = (1.571 + .0019*np.exp(-((whisker_t-.19)/.18)**2)
                 - .0145*smooth(.16,.84,whisker_t) + .0014*np.exp(-((whisker_t-.87)/.11)**2))
    whisker = np.exp(-((z-whisker_z)/.00215)**2)*np.sin(np.pi*whisker_t).clip(0.,1.)**.54
    lay(.80*whisker, (.121,.119,.034), ink)
    lay(.64*spot(.0,1.487,.0027,.0026), (.177,.122,.029), ink)

    if color:
        if not phone:
            # Reserve headroom for the warm desktop night lamps. Excess light
            # in the red channel otherwise pushes gold and vermilion to peach.
            result *= 1. - face[..., None]*np.array((.24,.21,.16), dtype=np.float32)
        result = np.where(result <= .0031308, 12.92*result, 1.055*result**(1./2.4)-.055)
    return result.astype(np.float32, copy=False)
