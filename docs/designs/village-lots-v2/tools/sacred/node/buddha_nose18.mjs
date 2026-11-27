import assert from "node:assert/strict";
import { MeshoptEncoder } from "meshoptimizer";

// Metres in the shipped glTF frame: +Y up, +Z forward.
const axis = -.004;
function smooth(lo, hi, value) {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2*t);
}
function unit(vector) {
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
}
const mix = (a, b, t) => a.map((x, k) => x + t * (b[k] - x));

// The opening sits behind the lobule. Turn its short wall sideways, keeping its
// extent in Y/Z and fading the displacement out before the wing and septum.
function socketShift(x, y, z) {
  const offset = Math.abs(x - axis) - .0235;
  const mask = (1 - smooth(.0045, .0135, Math.abs(offset))) * (1 - smooth(.0022, .010, Math.abs(y - 1.587)))
    * smooth(.052, .060, z) * (1 - smooth(.078, .091, z));
  return -Math.sign(x - axis) * (.86 * offset * mask + .0018 * aperture(x, y, z));
}

function aperture(x, y, z) {
  const u = Math.abs(x - axis);
  const a = (z - .0712) / .012, b = (y - 1.5862 - .23*(z - .0712)) / .0052;
  const radiusSquared = a*a + b*b;
  return (1 - smooth(.65, 2.1, radiusSquared)) * smooth(.010, .017, u) * (1 - smooth(.034, .041, u));
}

// Fit a local tangent plane across the alar root. Using a continuous metric
// neighbourhood gives the same broad blend on both decimations.
function alarPlane([x,y,z], neighbours) {
  let mass=0, sx=0, sy=0, sz=0, xx=0, xy=0, xz=0, yy=0, yz=0;
  for (const [ax,ay,az] of neighbours) {
    const dx=ax-x, dy=ay-y, dz=az-z;
    if (Math.sign(ax-axis)!==Math.sign(x-axis)) continue;
    const radius=(dx/.013)**2+(dy/.012)**2;
    if (radius>10) continue;
    const w=Math.exp(-radius);
    mass+=w; sx+=w*dx; sy+=w*dy; sz+=w*dz;
    xx+=w*dx*dx; xy+=w*dx*dy; xz+=w*dx*dz;
    yy+=w*dy*dy; yz+=w*dy*dz;
  }
  xx-=sx*sx/mass; xy-=sx*sy/mass; xz-=sx*sz/mass;
  yy-=sy*sy/mass; yz-=sy*sz/mass;
  const det=xx*yy-xy*xy;
  assert.ok(det>1e-12);
  const a=(xz*yy-yz*xy)/det, b=(yz*xx-xz*xy)/det;
  return {dz:(sz-a*sx-b*sy)/mass,normal:unit([-a,-b,1])};
}

function replaceCompressedView(parts, view, bytes, count) {
  const ext = view.extensions.EXT_meshopt_compression;
  ext.count = count;
  const encoded = MeshoptEncoder.encodeGltfBuffer(bytes, count, ext.byteStride, ext.mode, 0);
  parts.set(view, bytes);
  parts.set(ext, Buffer.from(encoded));
}

function refineSurface(doc, binary, skin, parts) {
  const position = doc.accessors[skin.attributes.POSITION], view = doc.bufferViews[position.bufferView];
  assert.equal(view.byteStride,32);
  const data = Buffer.from(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength));
  const uvView=doc.bufferViews[doc.accessors[skin.attributes.TEXCOORD_1].bufferView];
  assert.equal(uvView.byteStride,4);
  const fillUv=Buffer.from(binary.subarray(uvView.byteOffset,uvView.byteOffset+uvView.byteLength));
  const points=[];
  for (let i=0; i<position.count; i++) {
    const row=Array.from({length:8},(_,k)=>data.readFloatLE(32*i+4*k));
    const [x,y,z] = row;
    if (row[6]>.5 && Math.abs(x-axis)<.085 && y>1.577 && y<1.665 && z>.023)
      points.push({i,p:row.slice(0,3),n:row.slice(3,6)});
  }
  const neighbours=points.filter(({p})=>p[1]>1.586).map(v=>v.p);
  for (const {i,p,n} of points) {
    const [x,y,z]=p, u=Math.abs(x-axis);
    const shift=socketShift(x,y,z);
    let normal=n, depth=z;
    if (shift) {
      const h=.00008;
      const [dx,dy,dz] = p.map((_,k)=>{
        const a=[...p], b=[...p]; a[k]+=h; b[k]-=h;
        return (socketShift(...a)-socketShift(...b))/(2*h);
      });
      // Inverse transpose of the purely lateral deformation.
      const nx=n[0]/(1+dx);
      normal=unit([nx,n[1]-dy*nx,n[2]-dz*nx]);
    }
    const extent=.050-.015*smooth(1.613,1.628,y);
    const root=smooth(.012,.022,u)*(1-smooth(extent-.009,extent,u))
      *smooth(1.588,1.599,y)*(1-smooth(1.620,1.636,y));
    if (root) {
      const plane=alarPlane(p,neighbours);
      depth+=.72*root*plane.dz;
      normal=unit(mix(normal,plane.normal,.92*root));
    }
    const shelf=smooth(.008,.016,u)*(1-smooth(.035,.045,u))*smooth(.050,.060,z)
      *(1-smooth(.083,.092,z))*smooth(1.575,1.581,y)*(1-smooth(1.601,1.614,y));
    if (shelf) {
      const turn=unit([Math.sign(x-axis)*.64,.53,.63]);
      normal=unit(mix(normal,turn,.66*shelf));
      // Register the spatial lighting chart in the side plane. The shallow
      // diagonal in the original gilt follows the rolled edge of the wing.
      const sign=Math.sign(x-axis), core=sign>0 ? .021 : .015;
      const side=core-1.55*(z-.0712)+.024*(1-smooth(1.578,1.587,y));
      const target=[.75+sign*side/.72,.580-4.4*(y-1.5862-.21*(z-.0712))];
      const old=[0,1].map(k=>fillUv.readUInt16LE(4*i+2*k)/65535);
      const lowerLight=shelf*(1-smooth(1.586,1.596,y))*(1-smooth(.078,.090,z));
      mix(old,target,.82*lowerLight).forEach((v,k)=>fillUv.writeUInt16LE(Math.round(v*65535),4*i+2*k));
    }
    const recess=aperture(x,y,z);
    if (recess) {
      // The inward return of the tucked opening faces the underside, so the
      // frontal light falls across the lip before it can enter the recess.
      normal=unit(mix(normal,unit([Math.sign(x-axis)*.30,-.86,-.65]),.98*recess));
    }
    if (!root && !shift && !shelf) continue;
    [x+shift,y,depth,...normal].forEach((v,k)=>data.writeFloatLE(v,32*i+4*k));
  }
  replaceCompressedView(parts, view, data, position.count);
  replaceCompressedView(parts, uvView, fillUv, position.count);
}

/** Restore the continuous cast and its original gold-leaf finish from the two pass-17 primitives. */
export function refineNasalFront({doc, binary}, lod) {
  const mesh = doc.meshes[0];
  const [skin, nose] = mesh.primitives;
  assert.equal(mesh.primitives.length, 2);
  assert.deepEqual(nose.attributes, skin.attributes);
  assert.equal(doc.materials[nose.material].name, "Main Buddha nasal gold leaf");
  assert.equal(doc.materials[skin.material].name, "Main Buddha gold leaf");
  assert.deepEqual(doc.images.slice(4).map(im => im.name), [lod+"-nose-color",lod+"-nose-fill"]);
  const parts = new Map();
  refineSurface(doc,binary,skin,parts);
  const read = v => binary.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  const index = doc.accessors[skin.indices], noseIndex = doc.accessors[nose.indices];
  assert.equal(index.componentType, 5123);
  assert.equal(noseIndex.componentType, 5123);
  const indexView = doc.bufferViews[index.bufferView];
  const joined = Buffer.concat([read(indexView), read(doc.bufferViews[noseIndex.bufferView])]);
  index.count += noseIndex.count;
  replaceCompressedView(parts, indexView, joined, index.count);

  // Pass 17 appended a separate draw call and two cropped maps. The surviving
  // primitive uses the original four atlas payloads, including every mip.
  assert.equal(nose.indices, doc.accessors.length - 1);
  assert.deepEqual([...doc.images.slice(4).map(im => im.bufferView), noseIndex.bufferView], [7,8,9]);
  mesh.primitives.pop();
  doc.accessors.pop();
  doc.bufferViews.length = 7;
  doc.images.length = doc.textures.length = 4;
  doc.materials.length = 1;
  for (const key of ["extensionsUsed","extensionsRequired"])
    doc[key] = doc[key].filter(name => name !== "KHR_texture_transform");
  return parts;
}
