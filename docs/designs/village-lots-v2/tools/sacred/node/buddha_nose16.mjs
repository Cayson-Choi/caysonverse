// Local changes in metres on the registered pass-13 frontal pigment island.
// glTF axes are +Y up, +Z forward. The pigment follows the sculpt because the
// original vertex UVs, including the roots of the two alae, travel with it.
const AXIS = -.004;

function smooth(lo, hi, value) {
  const t = Math.max(0, Math.min(1, (value-lo)/(hi-lo)));
  return t*t*(3-2*t);
}

// Piecewise cubic offsets along the sagittal section. A horizontal tangent
// at a shape reversal preserves the round bulb and the turn under its foot.
function section(rows, y) {
  if (y <= rows[0][0]) return rows[0][1];
  const i = rows.findIndex(([h]) => h >= y) - 1;
  if (i < 0) return rows.at(-1)[1];
  const slope = j => {
    if (j === 0 || j === rows.length-1) return 0;
    const a = (rows[j][1]-rows[j-1][1])/(rows[j][0]-rows[j-1][0]);
    const b = (rows[j+1][1]-rows[j][1])/(rows[j+1][0]-rows[j][0]);
    return a*b > 0 ? 2*a*b/(a+b) : 0;
  };
  const h = rows[i+1][0]-rows[i][0], t = (y-rows[i][0])/h;
  return (1-t)**2*((1+2*t)*rows[i][1]+h*t*slope(i)) +
    t*t*((3-2*t)*rows[i+1][1]+h*(t-1)*slope(i+1));
}

const FORWARD = [
  [1.570,0], [1.578,-.0013], [1.585,.0024], [1.596,.0044],
  [1.604,.0043], [1.622,.0024], [1.650,.0019], [1.680,.0020],
  [1.690,.0017], [1.703,.0009], [1.719,0],
];
const HEIGHT = [
  [1.570,0], [1.579,.0028], [1.585,.0007], [1.594,-.0032],
  [1.605,-.0036], [1.626,-.0022], [1.671,0],
];

function point(x, y, z) {
  const u = x - AXIS;
  const bulb = Math.exp(-(((y-1.603)/.025)**4));
  const width = .032+.025*bulb;
  const edge = 1-smooth(.70*width,width,Math.abs(u));
  const mask = edge*smooth(1.570,1.581,y)*(1-smooth(1.705,1.719,y));
  const shrink = (.035+.125*bulb)*mask;
  const bridge = .0160+.0040*bulb;
  const central = Math.exp(-((u/bridge)**2));
  const columella = .0026*smooth(1.570,1.578,y)*Math.exp(-((u/.0165)**2+((y-1.585)/.006)**2));
  const height = (section(HEIGHT,y)*Math.exp(-((u/.044)**4))-columella)*edge;
  const under = .0020*smooth(1.570,1.578,y)*Math.exp(-((u/.018)**2+((y-1.588)/.0060)**2));
  const forward = (section(FORWARD,y)*central+under)*edge;
  const lateral = Math.abs(u);
  const wing = Math.exp(-(((lateral-.0345)/.0080)**2+((y-1.6015)/.0120)**2));
  const rise = .0028*wing*mask*smooth(.018,.027,lateral);
  return [x-u*shrink+Math.sign(u)*rise, y+height, z+forward];
}

function blendNormal(normal, target, weight) {
  const sourceLength = Math.hypot(...normal), targetLength = Math.hypot(...target);
  for (let k=0; k<3; k++) normal[k] = normal[k]/sourceLength*(1-weight)+target[k]/targetLength*weight;
}

export function sculptNose(primitive) {
  const p = primitive.getAttribute("POSITION"), n = primitive.getAttribute("NORMAL");
  const uv = primitive.getAttribute("TEXCOORD_0");
  const positions = p.getArray(), normals = n.getArray(), uvs = uv.getArray();
  let changed = 0;
  for (let i=0; i<p.getCount(); i++) {
    if (uvs[2*i] < .5) continue;
    const j = 3*i, x = positions[j], y = positions[j+1], z = positions[j+2];
    if (Math.abs(x-AXIS) >= .057 || y <= 1.570 || y >= 1.719) continue;
    const moved = point(x,y,z);
    if (Math.max(Math.abs(moved[0]-x),Math.abs(moved[1]-y),Math.abs(moved[2]-z)) < 1e-9) continue;
    // Inverse-transpose of the local warp. Carry the pass-13 lacquer normals
    // around the narrower alae; averaging the decimated mesh would also
    // introduce triangular glints outside the tip on the phone.
    const h = .0001;
    const xp = point(x+h,y,z), xm = point(x-h,y,z);
    const yp = point(x,y+h,z), ym = point(x,y-h,z);
    const [a,c,e] = xp.map((v,k) => (v-xm[k])/(2*h));
    const [b,d,f] = yp.map((v,k) => (v-ym[k])/(2*h));
    const [nx,ny,nz] = normals.subarray(j,j+3);
    const normal = [d*nx-c*ny+(c*f-e*d)*nz,
      -b*nx+a*ny+(e*b-a*f)*nz, (a*d-b*c)*nz];
    // The lateral alar pad faces both side cameras. The broad frontal ball
    // turns under earlier than either of the two tucked lateral pads.
    const lateral = Math.abs(x-AXIS);
    const front = (moved[2]-.074)/.0120, up = (moved[1]-1.598)/.0125;
    const radius = front*front+up*up;
    const side = smooth(.020,.031,lateral)*(1-smooth(.045,.054,lateral));
    blendNormal(normal,[Math.sign(x-AXIS)*.75, .11+.85*up, .54+.82*front],
      .22*side*(1-smooth(.72,2.45,radius)));
    const bulbX = (moved[0]-AXIS)/.021, bulbY = (moved[1]-1.600)/.019;
    const tilt = (moved[1]-1.609)/.019;
    blendNormal(normal,[.66*bulbX, .92*tilt-.08, .96-.27*Math.max(0,-tilt)],
      .83*(1-smooth(.58,1.75,bulbX*bulbX+bulbY*bulbY)));
    const length = Math.hypot(...normal);
    normals.set(normal.map(v=>v/length),j);
    positions.set(moved,j);
    changed++;
  }
  if (!changed) throw new Error("Missing registered Buddha nose in donor primitive");
  return changed;
}
