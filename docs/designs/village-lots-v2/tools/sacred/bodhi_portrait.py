"""Facial sections and gilt planes used to register the standing attendants."""
from math import exp, pi, sin

import numpy as np

from buddha_head import (MIDLINE, PIXELS_PER_METRE, SECTIONS, SKULL, depth, eye_line,
                         face_section_z, lip_line, profile)
from buddha_pigment import BROW_INNER, BROW_SPAN, EYE_INNER, EYE_SPAN, FACE_AXIS, brow_height, smooth


FACE_PLANES = {
    171:(3,594.5), 169.8:(9.5,590), 168:(16.3,584.6), 165:(23.0,576.7),
    162:(26.7,571.8), 158:(29.7,569.4), 154:(32.3,568.5), 150:(34.4,568),
    147:(35.7,567.3), 142:(37.25,566.2), 136:(38.5,565.7), 130:(39.35,565.2),
    122:(40.0,565), 115:(41.1,565.2), 108:(42.0,564.5),
    103:(42.5,563.2), 96:(42.6,561)}
FACE = []
for row,width,front,back in SECTIONS:
    width,front=FACE_PLANES.get(row,(width,front))
    FACE.append((face_section_z(row),width/PIXELS_PER_METRE,depth(front),depth(back)))


def lower_cheek_weight(z):
    # Fade out below the orbital rim so the lower lid retains its cast relief.
    t=max(0.,min(1.,(1.667-z)/.036))
    return t*t*(3-2*t)


def relief(x,z):
    a=abs(x)
    def paired(offset,height,width,radius):
        return (exp(-((x-offset)/width)**2)+exp(-((x+offset)/width)**2))*exp(-((z-height)/radius)**2)

    t=max(0.,min(1.,(a-EYE_INNER)/EYE_SPAN))
    arc=sin(pi*t)
    lid=eye_line(x)
    brow_t=max(0.,min(1.,(a-BROW_INNER)/BROW_SPAN))
    brow_arc=sin(pi*brow_t)
    brow=brow_height(brow_t,brow_arc)
    # A continuous padded lid under the arc of the brow. The fold is a change
    # in curvature and the lash sits over a softly turned lower lid.
    brow_plane=(.0038*paired(.082,brow,.046,.010)
                +.0036*paired(.078,brow-.010,.049,.015))
    brow_root=.026+.039*max(0.,min(1.,(z-1.680)/.053))**1.5
    inner_fold=.0038*paired(brow_root,1.705,.015,.026)
    dome=lid+.012+.007*arc
    lids=(.013*paired(.081,dome,.042,.026)
          + .0018*paired(.078,lid-.009,.045,.015)
          - .0067*paired(.065,1.693,.058,.039)
          - .0030*paired(.038,lid,.008,.0065))
    # Carry the soft pad forward below the zygoma, over the mandibular
    # corner. The overlapping broad rolls give one convex cheek in profile.
    lower_pad=(.027*paired(.090,1.624,.077,.081)
               + .0155*paired(.087,1.531,.083,.065))
    orbital_pad=(.023*paired(.094,1.627,.063,.072)
                 + .0080*paired(.098,1.601,.066,.060))
    cheeks=orbital_pad+lower_cheek_weight(z)*(lower_pad-orbital_pad)
    # The broad alae join the ball and the cheek over a continuous roll.
    # Only the underside turns in appreciably, under the fleshy outer rim.
    wings=(.0158*paired(.034,1.604,.019,.0175)
           - .0009*paired(.045,1.602,.010,.016)
           - .0012*paired(.023,1.618,.011,.014)
           - .0026*paired(.023,1.587,.013,.0078))
    seam=lip_line(x)
    mouth=(.0040*paired(.018,seam+.006,.018,.0060)
           + .0055*paired(.014,seam-.008,.023,.0075)
           - .0043*paired(.044,seam,.0078,.0055))
    return (brow_plane - inner_fold + lids + cheeks + wings + mouth
            + .0011*paired(.011,1.572,.009,.012)
            + .003*paired(.030,1.493,.032,.025))


def fy(x,z):
    w,front,back=profile(FACE,z)
    # The orbital section keeps its original depth. Beneath the zygoma the
    # whole cheek follows one ellipse all the way around to the ear.
    skull_width=profile(SKULL,z)[0]
    outer=max(0.,min(1.,(abs(x)/w-.63)/.37))
    section_width=w+(1-lower_cheek_weight(z))*(max(w,skull_width)-w)*(1-outer*outer*(3-2*outer))
    q=min(.99999,abs(x)/section_width)
    x-=FACE_AXIS
    outline=profile(MIDLINE,z)[0]
    bulb=exp(-((z-1.599)/.026)**2)
    muzzle=1/(1+exp(min(80.,(z-1.576)/.0085)))
    chin=1/(1+exp(min(80.,(z-1.517)/.010)))
    spread=(.0235 + .0175*bulb + .0052*exp(-((z-1.650)/.047)**4)
            - .0095*exp(-((z-1.579)/.010)**2)
            + .0050*exp(-((z-1.71)/.039)**2) + .020*muzzle + .046*chin)
    # Broaden the dorsal column out to the inner orbital planes. The blend
    # starts above the alae so their section and the tip retain their profile.
    rise=max(0.,min(1.,(z-1.617)/.025))
    bridge=rise*rise*(3-2*rise)*exp(-((z-1.667)/.054)**4)
    spread+=.0092*bridge
    ball=.16*exp(-((z-1.605)/.019)**2)
    section=exp(-(abs(x)/spread)**(2+.10*exp(-((z-1.655)/.053)**4)))
    ridge=(front-outline)*((1-ball)*section+ball*exp(-(x/.020)**2))
    center=.5*(front+back)
    # Constrain only the midline to the measured sagittal profile. Spreading
    # the lip's correction across a whole section cuts a shelf into both cheeks.
    # Carry the centre correction across the ball. A narrow correction at
    # these heights would leave the middle indented between two high points.
    axial_correction=relief(0,z)*exp(-(x/(.023+.018*bulb))**2)
    lip_seam=.0019*exp(-(x/.038)**4-((z-lip_line(x))/.0029)**2)
    y=center-(center-front)*(1-q*q)**.50-(ridge+relief(x,z)-axial_correction-lip_seam)*(1-q*q)**.65
    return y


def bare_leaf_planes(x, z, spot, lay):
    """Lay the altar portrait's satin gold on the brow, cheeks, bridge and chin."""
    mask = (1.-smooth(.130,.161,np.abs(x)))*smooth(1.445,1.481,z)
    lay(mask, (.935,.431,.020), (1.,.59,.87))
    polish = np.maximum.reduce((spot(.0,1.755,.100,.051), spot(.072,1.646,.063,.048),
                                spot(.0,1.658,.032,.060), spot(.0,1.612,.021,.015),
                                spot(.033,1.608,.015,.015),spot(.0,1.512,.050,.032)))
    lay(polish, (.980,.520,.054), (1.,.58,.87))
    lay(.56*spot(.0,1.505,.061,.027), (.800,.393,.040), (1.,.66,.85))
    return mask
