/** Reflected altar panels stored in one small sRGB atlas. +Y is up, +Z is the front of the cast. */
import sharp from "sharp";
import { encodeToKTX2 } from "ktx2-encoder";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

const VIEW_Y = -.06 / Math.hypot(.06, 1);
const VIEW_Z = 1 / Math.hypot(.06, 1);
const STRENGTH = 2;
// The left-hand swatches are the FINISHES in buddha_mesh.py, in atlas order.
const CHART_FOR_SWATCH = [2,0,3,3,3,1,0,3];
const clip = value => Math.min(1, Math.max(0, value));
const srgb = x => Math.round(255 * clip(x < .0031308 ? 12.92*x : 1.055*x**(1/2.4)-.055));
const linear = x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4;

function reflectedDirection([x,y,z]) {
  const facing = y*VIEW_Y + z*VIEW_Z;
  // The rear of the cast sees a softer return. Roll it into the dark end
  // of the chart continuously as a normal turns away from the altar doors.
  const front = clip((facing+.60)/.60);
  return [2*x*facing, (2*y*facing - VIEW_Y)*front, -1+(2*z*facing - VIEW_Z+1)*front];
}

function radiance(y, z, finish, phone, faceX) {
  if (finish === 3) return [0,0,0];
  // The two side panels match. Their reflection varies with signed Y and Z,
  // allowing smooth interpolation on the mesh without an azimuth seam.
  const x = Math.sqrt(Math.max(0, 1-y*y-z*z));
  const key = Math.exp(4.1*(Math.min(1, -.22*(faceX ?? -.12*x)+.48*y+.85*z)-1));
  const bounce = Math.exp(3*(Math.min(1, .84*x-.30*y+.30*z)-1));
  if (finish === 0) {
    const silk = .10+.72*key+.16*bounce+(phone ? .045 : 0);
    // The phone has no overhead spotlights. Add their warm return to the
    // turned cheek and jaw, fading out where the forehead reflects the key.
    const shadow = phone ? clip((.77-key)/.72) : 0;
    return [silk*.82+.18*shadow, silk*.56+.075*shadow, silk*.135+.008*shadow];
  }
  const side = Math.exp(-132*(x-.67)**2 - 2.7*(y-.14)**2) * (.48+.52*clip(z+.22));
  const lintel = Math.exp(-175*(y-.37)**2) * clip((z+.07)/.78);
  const overhead = Math.exp(-138*(y-.785)**2 - 3.8*(z+.23)**2);
  const panel = Math.max(side, lintel, overhead), core = panel**3;
  const base = .078+.215*key+.088*bounce;
  const warm = phone ? .045*(1-panel)**2 : 0;
  return [1.11*base+.72*panel+.85*core+warm, .77*base+.59*panel+.89*core+.55*warm, .25*base+.27*panel+core+.12*warm];
}

function elements({doc, binary}, id) {
  const a = doc.accessors[id], view = doc.bufferViews[a.bufferView];
  const width = {SCALAR:1, VEC2:2, VEC3:3}[a.type];
  const bytes = {5123:2, 5125:4, 5126:4}[a.componentType];
  if (!width || !bytes || a.sparse) throw new Error("Unexpected Buddha accessor");
  const stride = view.byteStride || width*bytes;
  const offset = (view.byteOffset || 0) + (a.byteOffset || 0);
  return Array.from({length:a.count}, (_,i) => Array.from({length:width}, (_,c) => {
    const at = offset+i*stride+c*bytes;
    return a.componentType === 5126 ? binary.readFloatLE(at) : binary.readUIntLE(at, bytes);
  }));
}

function atlasSwatch(u, v) {
  return Math.floor(8*u) + 4*Math.floor(2*(1-v));
}

// An ear graft retains its source finish. Read the shipped chart assignments
// before rebuilding the vertex buffer (earlier casts have a polished urna).
function shippedCharts(model) {
  const attributes = model.doc.meshes[0].primitives[0].attributes;
  const paint = elements(model, attributes.TEXCOORD_0);
  const fill = elements(model, attributes.TEXCOORD_1);
  const charts = [...CHART_FOR_SWATCH];
  for (let i=0; i<paint.length; i++) {
    const [u,v] = paint[i];
    if (u >= .5) continue;
    const [s,t] = fill[i];
    charts[atlasSwatch(u,v)] = Math.floor(4*s/65535) + 2*Math.floor(2*t/65535);
  }
  return charts;
}

function secondUv(uvs, normals, charts) {
  const bytes = Buffer.alloc(uvs.length*4);
  for (const [i, [u,v]] of uvs.entries()) {
    let s = u, t = v;
    if (u < .5) {
      const tile = charts[atlasSwatch(u,v)];
      if (tile === undefined) throw new Error("Unknown gilt atlas swatch");
      const [,y,z] = reflectedDirection(normals[i]);
      // Five percent padding around the lookup keeps each finish inside its
      // quadrant on the lower mip levels. The spatial face island stays at right.
      s = ((tile%2)+.5+y/2.1)/4;
      t = (Math.floor(tile/2)+.5-z/2.1)/2;
    }
    bytes.writeUInt16LE(Math.round(65535*clip(s)), 4*i);
    bytes.writeUInt16LE(Math.round(65535*clip(t)), 4*i+2);
  }
  return bytes;
}

async function emissiveAtlas(lod, pigmentFile, normals, uvs, indices) {
  const phone = lod === "phone", w = phone ? 512 : 1024, h = w/2, side = h/2;
  const pigment = await sharp(pigmentFile).resize(w,h,{fit:"fill"}).removeAlpha().raw().toBuffer();
  const pixels = Buffer.alloc(w*h*4);
  function write(x,y,rgb) {
    const at = 4*(x+y*w);
    for (let c=0; c<3; c++) pixels[at+c] = srgb(rgb[c]/STRENGTH);
  }
  for (let y=0; y<h; y++) for (let x=0; x<w/2; x++) {
    const finish = Math.floor(x/side)+2*Math.floor(y/side);
    const ry = 2*((x%side+.5)/side-.5)*1.05, rz = 2*(.5-(y%side+.5)/side)*1.05;
    write(x,y,radiance(ry,rz,finish,phone));
  }
  const covered = new Uint8Array(w*h);
  // Rasterize the face at texel centres using its authored split normals. The
  // albedo masks the original pigment, including the roots, brows and lash.
  for (let i=0; i<indices.length; i+=3) {
    const ids = indices.slice(i,i+3);
    if (ids.some(k => uvs[k][0] < .5)) continue;
    const [a,b,c] = ids.map(k => [uvs[k][0]*w-.5, uvs[k][1]*h-.5]);
    const dx=b[0]-a[0], dy=b[1]-a[1], ex=c[0]-a[0], ey=c[1]-a[1], det=dx*ey-dy*ex;
    if (Math.abs(det) < 1e-6) continue;
    const x0 = Math.max(w/2, Math.ceil(Math.min(a[0],b[0],c[0])));
    const x1 = Math.min(w-1, Math.floor(Math.max(a[0],b[0],c[0])));
    const y0 = Math.max(0, Math.ceil(Math.min(a[1],b[1],c[1])));
    const y1 = Math.min(h-1, Math.floor(Math.max(a[1],b[1],c[1])));
    for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++) {
      const fx=x-a[0], fy=y-a[1], u=(fx*ey-fy*ex)/det, v=(dx*fy-dy*fx)/det;
      if (u<0 || v<0 || u+v>1) continue;
      const n = [0,1,2].map(j => (1-u-v)*normals[ids[0]][j]+u*normals[ids[1]][j]+v*normals[ids[2]][j]);
      const length = Math.hypot(...n);
      const [rx,ry,rz] = reflectedDirection(n.map(k => k/length));
      const p = y*w+x, rgb = [0,1,2].map(j => linear(pigment[3*p+j]/255));
      const gold = [.94,.529,.074];
      const gilded = clip((rgb[0]-.12)/.78)*(.70+.30*clip(rgb[1]/gold[1]));
      // Bare satin leaf has a broad return from the gilded altar below the
      // eyes. The reflected panels on the robes use their original chart.
      const faceX = ((x+.5)/w-.75)*.72-.004;
      const height = 1.820-.400*(y+.5)/h;
      const cheek = Math.exp(-(((Math.abs(faceX)-.083)/.081)**2+((height-1.610)/.076)**2));
      const muzzle = Math.exp(-(((Math.abs(faceX)-.061)/.036)**2+((height-1.586)/.043)**2));
      const temple = Math.exp(-(((Math.abs(faceX)-.102)/.053)**2+((height-1.754)/.037)**2));
      const lowerFace = Math.exp(-((faceX/.113)**4+((height-1.510)/.057)**2));
      const septum = Math.exp(-((faceX/.008)**2+((height-1.590)/.009)**2));
      const response = radiance(ry,rz,0,phone,rx);
      // A broad, pale tent reflection crosses the nasal bridge and the
      // upper face of its bulb. It falls off before the two gilded wings.
      const noseLight = Math.exp(-(((faceX-.0017)/.0148)**2+((height-1.650)/.033)**4));
      response[1] += .083*noseLight;
      response[2] += .115*noseLight;
      // The round outer wing sits behind the frontal bulb and picks up a
      // broader side light above the short aperture.
      const ala = Math.exp(-(((Math.abs(faceX)-.035)/.015)**2+((height-1.612)/.017)**2));
      response[0] += .075*ala;
      response[1] += .061*ala;
      response[2] += .030*ala;
      // Vermilion takes a broad diffuse return from the doorway. Its moving
      // specular comes from the two modelled lip rolls in the PBR pass.
      const vermilion = clip((rgb[0]-3*rgb[1])/.35)
        * Math.exp(-((faceX/.047)**8+((height-1.552)/.021)**8));
      const lipLight = [.41,.20,.045];
      for (let j=0; j<3; j++) response[j] += .88*vermilion*(lipLight[j]-response[j]);
      // The photographic left cheek is in softer light. Ease the reflected
      // return across the face, keeping the nose and opposite cheek modelled.
      const cheekFill = cheek*(.50+.28*Math.tanh(faceX/.043));
      const reflected = [response[0]+.266*cheekFill+.085*muzzle+.185*temple+.133*lowerFace+.12*septum,
        response[1]+.104*cheekFill+.066*muzzle+.085*temple+.027*lowerFace+.062*septum,
        response[2]*(1.-.26*cheek-.49*lowerFace)];
      // Where the lower cheek turns into the side of the head, transition to
      // the adjacent bare-leaf chart using the horizontal turn of the normal.
      const toSide = clip((.60 - n[2]/Math.max(.001,Math.hypot(n[0],n[2])))/.52);
      const jawRim = toSide*toSide*(3-2*toSide)*clip((1.71-height)/.05)
        * clip((Math.abs(faceX)-.030)/.025);
      const bareLeaf = radiance(ry,rz,0,phone);
      write(x,y,reflected.map((k,j) => (1-jawRim)*k*gilded*clip(rgb[j]/gold[j])+jawRim*bareLeaf[j]));
      covered[p] = 1;
    }
  }
  for (let pass=0; pass<4; pass++) {
    const prior = covered.slice();
    for (let y=1; y<h-1; y++) for (let x=w/2+1; x<w-1; x++) {
      const p = y*w+x;
      if (prior[p]) continue;
      const adjacent = [p-1,p+1,p-w,p+w].find(i => prior[i]);
      if (adjacent !== undefined) {
        pixels.copy(pixels,4*p,4*adjacent,4*adjacent+4);
        covered[p] = 1;
      }
    }
  }
  for (let i=3; i<pixels.length; i+=4) pixels[i] = 255;
  return Buffer.from(await encodeToKTX2(new Uint8Array(1), {
    isUASTC:false, qualityLevel:255, compressionLevel:2, isPerceptual:true, isSetKTX2SRGBTransferFunc:true,
    generateMipmap:true, isKTX2File:true, isYFlip:false,
    imageDecoder:async () => ({width:w,height:h,data:new Uint8Array(pixels)}),
  }));
}

// Returns replacement byte spans for the packed buffer. Retain an existing
// emissive image when the ear graft promises to keep the shipped pigment.
export async function dressBuddhaLeaf(model, lod, pigmentFile, replacements, priorFinish) {
  const {doc} = model, primitive = doc.meshes[0].primitives[0], material = doc.materials[primitive.material];
  const normals = elements(model, primitive.attributes.NORMAL), uv = elements(model, primitive.attributes.TEXCOORD_0);
  const bytes = secondUv(uv,normals,priorFinish ? shippedCharts(priorFinish) : CHART_FOR_SWATCH);
  await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
  const packed = Buffer.from(MeshoptEncoder.encodeGltfBuffer(bytes, uv.length, 4, "ATTRIBUTES", 0));
  const check = Buffer.alloc(bytes.length);
  MeshoptDecoder.decodeGltfBuffer(check, uv.length, 4, packed, "ATTRIBUTES");
  if (!check.equals(bytes)) throw new Error("Buddha second UV did not round-trip");
  // Existing slots must be reused when the shipped model is the input again.
  function newView(fields) {
    return doc.bufferViews.push({buffer:0,byteOffset:model.binary.length,...fields})-1;
  }
  let uvId = primitive.attributes.TEXCOORD_1;
  if (uvId === undefined) {
    uvId = doc.accessors.push({bufferView:newView({byteStride:4,target:34962}),componentType:5123,type:"VEC2",normalized:true})-1;
    primitive.attributes.TEXCOORD_1 = uvId;
  }
  const accessor = doc.accessors[uvId], view = doc.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5123 || !accessor.normalized || accessor.type !== "VEC2" || view.byteStride !== 4) {
    throw new Error("Unexpected photographic UV layout");
  }
  accessor.count = uv.length;
  view.extensions ??= {};
  view.extensions.EXT_meshopt_compression ??= {buffer:0,byteOffset:model.binary.length,byteStride:4,mode:"ATTRIBUTES"};
  view.extensions.EXT_meshopt_compression.count = uv.length;
  replacements.set(view, bytes);
  replacements.set(view.extensions.EXT_meshopt_compression, packed);

  const name = lod+"-photographic-fill";
  let image = doc.images.find(im => im.name === name);
  if (!image) {
    image = {bufferView:newView({}),name,mimeType:"image/ktx2"};
    const source = doc.images.push(image)-1;
    const sampler = doc.textures[material.pbrMetallicRoughness.baseColorTexture.index].sampler;
    const index = doc.textures.push({sampler,extensions:{KHR_texture_basisu:{source}}})-1;
    material.emissiveTexture = {index,texCoord:1};
  } else if (priorFinish) {
    return;
  }
  const indices = elements(model, primitive.indices).flat();
  replacements.set(doc.bufferViews[image.bufferView], await emissiveAtlas(lod,pigmentFile,normals,uv,indices));
  material.name = "Main Buddha gold leaf";
  material.emissiveFactor = [1,1,1];
  material.pbrMetallicRoughness.baseColorFactor = lod === "phone" ? [.92,.80,.64,1] : [.77,.79,.64,1];
  material.extensions ??= {};
  material.extensions.KHR_materials_emissive_strength = {emissiveStrength:STRENGTH};
  if (!doc.extensionsUsed.includes("KHR_materials_emissive_strength")) doc.extensionsUsed.push("KHR_materials_emissive_strength");
}
