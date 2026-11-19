"""Hand-painted features for the hall Buddha's frontal UV island, in sculpt metres."""
import numpy as np


def smooth(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0., 1.)
    return t*t*(3. - 2.*t)


def eyelid_height(t, arc):
    return 1.670 + .0008*t - .0016*arc


def brow_height(t, arc):
    return 1.705 + .020*arc**.89 + .0018*t


def face_patch(kind, x, z):
    """Return sRGB color or linear ORM/tangent normals, with rows ascending in z."""
    x, z = np.broadcast_arrays(np.asarray(x, dtype=np.float32), np.asarray(z, dtype=np.float32))
    a = np.abs(x)

    def spot(cx, cz, rx, rz):
        return np.exp(-((a - cx)/rx)**2 - ((z - cz)/rz)**2)

    def band(below, above, feather):
        return smooth(below-feather, below+feather, z) * (1.-smooth(above-feather, above+feather, z))

    # Width changes sharply at the chin. Follow the curved jaw so that
    # underpainting meets the nape's unpainted leaf evenly in both profiles.
    half_width = np.interp(z, (1.430,1.442,1.454,1.474,1.494,1.518,1.545,1.580,1.644,1.749),
                           (.031,.062,.085,.105,.122,.135,.146,.151,.157,.161))
    lateral = a / half_width
    face = (1.-smooth(.75, .97, lateral)) * smooth(1.440, 1.483, z) * (1.-smooth(1.780, 1.811, z))
    eye_t = np.clip((a-.031)/.099, 0., 1.)
    arc = np.sin(np.pi * eye_t).clip(0., 1.)
    upper = eyelid_height(eye_t, arc)
    lower = upper - .0090*arc**1.63
    fold = upper + .005 + .013*arc
    brow_t = np.clip((a-.030)/.102, 0., 1.)
    brow_arc = np.sin(np.pi*brow_t).clip(0., 1.)
    brow = brow_height(brow_t, brow_arc)
    lip_t = np.clip(a/.0435, 0., 1.)
    seam = 1.548 + .0029*lip_t**2 - .0014*np.exp(-(lip_t/.23)**2)
    lip_fall = (1.-lip_t**2)**.83
    peaks = np.exp(-((lip_t-.35)/.21)**2)
    lip_top = seam + (.0063 + .0041*peaks)*lip_fall
    lip_bottom = seam - .0106*lip_fall

    result = np.empty((*x.shape, 3), dtype=np.float32)
    if kind == "normal":
        # Fine relief between the sculpted lids and in the lip cleft. Higher
        # frequencies would sparkle on the narrower mip levels.
        result[..., 0] = .5
        roll = (z-fold)/.0034
        cleft = (z-seam)/.0026
        slope = .045*roll*np.exp(-roll**2)*arc + .042*cleft*np.exp(-cleft**2)*lip_fall
        result[..., 1] = .5 - slope
        result[..., 2] = np.sqrt(1.-(2.*slope)**2)*.5 + .5
        return result

    if kind not in ("color", "orm"):
        raise ValueError(f"Unknown Buddha face map {kind!r}")
    color = kind == "color"

    def lay(mask, rgb, orm):
        target = rgb if color else orm
        for channel, value in enumerate(target):
            result[..., channel] += (value-result[..., channel]) * mask

    # The forehead and cheeks are satin gilding. Feather it into the original
    # bright leaf around the ears, under the jaw and behind the hairline.
    result[...] = (.96, .611, .031) if color else (1., .39, .84)
    lay(face, (.925, .472, .018), (.994, .516, .625))
    satin = (.55*spot(.008,1.600,.025,.043) + .53*spot(0.,1.487,.055,.027))*face
    lay(satin, (.94,.458,.021), (.992,.55,.625))
    under_brow = np.exp(-((z-fold-.006)/.014)**2)*arc
    socket = np.exp(-((z-brow+.009)/.0105)**2)*brow_arc
    under_eye = np.exp(-((z-lower+.006)/.010)**2)*arc
    recess = (.26*under_brow + .33*socket + .21*under_eye + .23*spot(.024,1.627,.010,.041)
              + .22*spot(.030,1.596,.009,.023) + .30*spot(.019,1.579,.009,.005)
              + .29*spot(.007,1.531,.036,.008) + .12*spot(.066,1.513,.040,.026))
    lay(recess*face, (.29, .103, .012), (.69, .55, .55))
    cheek = .17*spot(.084,1.626,.041,.034)*face
    lay(cheek, (.99, .530, .033), (1., .505, .65))

    brow_width = .0052*brow_arc**.73 * (1.+.14*(brow_t-.5))
    brow_mask = band(brow-.43*brow_width, brow+.57*brow_width, .00048)
    brow_mask *= smooth(.030,.0314,a) * (1.-smooth(.1306,.132,a))
    lay(brow_mask*.98, (.052, .115, .044), (.98, .61, .13))

    # A soft curved fold lies above the sliver of exposed eye. Both painted
    # corners darken and taper under the upper lid.
    lay(.29*np.exp(-((z-fold)/.0027)**2)*arc, (.39,.176,.029), (.89,.54,.54))
    lid_light = np.exp(-((z-upper-.0073)/.0062)**2) * arc**1.6
    lay(.17*lid_light, (.99,.58,.044), (1.,.50,.66))
    eye_ends = smooth(.031,.0325,a) * (1.-smooth(.1285,.130,a))
    opening = band(lower, upper, .00053)*eye_ends
    lay(opening, (.122,.063,.017), (.92,.58,.10))
    # Only the short windows on either side of the iris catch light. The
    # shaded corners continue into the tapered brown stroke on each side.
    window = smooth(.16,.305,eye_t) * (1.-smooth(.667,.835,eye_t))
    lay(opening*window, (.77,.56,.27), (.97,.54,.08))
    iris_radius = np.sqrt(((eye_t-.482)/.192)**2 + ((z-upper-.0018)/.0124)**2)
    lay(opening*(1.-smooth(.87,1.09,iris_radius)), (.042,.020,.007), (.93,.56,.045))
    lay(opening*(1.-smooth(.48,.69,iris_radius)), (.012,.007,.003), (.93,.55,.04))
    contour = band(lower-.0008*arc, lower+.00045*arc,.00046)*arc
    lay(contour*.65, (.20,.088,.026), (.90,.57,.16))
    lash_width = .0009 + .0026*arc**.7
    lash = band(upper-.45*lash_width, upper+.55*lash_width,.00048)*eye_ends
    lay(lash*(.75+.24*arc), (.040,.020,.007), (.93,.60,.13))

    # The short, oblique nostril strokes lie slightly below each ala.
    nostril_t = np.clip((a-.012)/.013, 0., 1.)
    nostril_z = 1.581 + .0023*nostril_t + .0012*np.sin(np.pi*nostril_t)
    nostril = np.exp(-((z-nostril_z)/.00185)**2) * np.sin(np.pi*nostril_t).clip(0., 1.)**.8
    lay(.78*nostril, (.195,.084,.022), (.84,.62,.34))

    lip_ends = 1.-smooth(.0422,.0436,a)
    lips = band(lip_bottom, lip_top, .00084+.0005*lip_t**4)*lip_ends*(1.-.27*lip_t**5)
    lay(lips, (.409,.041,.015), (.97,.53,.17))
    lower_glaze = (1.-smooth(seam-.003,seam+.001,z)) * lips
    lay(lower_glaze*.79, (.535,.075,.024), (.98,.50,.17))
    lay(.47*spot(0.,1.542,.024,.0032)*lower_glaze, (.65,.116,.042), (.99,.48,.18))
    meeting = np.exp(-((z-seam)/.00118)**2)*lip_fall*lips
    lay(meeting*.80, (.184,.029,.018), (.86,.60,.10))

    whisker_t = np.clip((a-.012)/.045, 0., 1.)
    whisker_z = (1.5685 - .018*whisker_t + .002*whisker_t**2
                 - .0017*np.sin(np.pi*whisker_t)**2 + .0016*np.exp(-((whisker_t-.90)/.095)**2))
    whisker = np.exp(-((z-whisker_z)/.00152)**2)*np.sin(np.pi*whisker_t).clip(0.,1.)**.42
    lay(.95*whisker, (.089,.109,.036), (.98,.61,.16))
    stipple = (.90*spot(.057,1.553,.0024,.0023) + .75*spot(.060,1.548,.0018,.0018)
               + .96*spot(.0124,1.486,.0030,.0033) + .73*spot(0.,1.479,.0023,.0020))
    lay(stipple, (.074,.091,.030), (.96,.61,.14))

    if color:
        result = np.where(result <= .0031308, 12.92*result, 1.055*result**(1./2.4)-.055)
    return result.astype(np.float32, copy=False)
