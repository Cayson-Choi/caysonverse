/** Local sculpt on the two pass-16 casts. Coordinates are metres, +Y up, +Z out. */
import { NodeBasisEncoder } from "ktx2-encoder";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

const axis = -.004;
const codec = new NodeBasisEncoder();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function smooth(lo, hi, x) {
  const t = clamp((x-lo)/(hi-lo), 0, 1);
  return t*t*(3-2*t);
}
const gauss = (x, y = 0) => Math.exp(-x*x-y*y);
const unit = v => v.map(x => x/Math.hypot(...v));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// Keep the two edges of the dorsal column inside the medial canthi.
function support(x,y,z) {
  const width = .027+.025*(1-smooth(1.610,1.637,y));
  const rear = smooth(.058,.064,z);
  const base = Math.max(rear,smooth(1.582,1.592,y));
  return base*(1-smooth(width-.008,width,Math.abs(x-axis)))*smooth(1.574,1.578,y)*(1-smooth(1.668,1.686,y));
}

// The pad is lateral. Its root, rim and aperture are laid out in the side
// plane so their separation in profile survives a frontal UV projection.
function wing(x,y,z) {
  const u = Math.abs(x-axis);
  const s = (z-.062)/(z<.062 ? .0108 : .0200), t = (y-1.5994)/.0164;
  const side = smooth(.010,.025,u);
  const radius = Math.hypot(s,t);
  const dome = gauss(.96*s,.94*t)*side;
  const rim = gauss((radius-1.04)/.26)*smooth(-.48,.61,t-.90*s)*side;
  const a = (z-.0712)/.0120, b = (y-1.5862-.23*(z-.0712))/.0050;
  const opening = .92*Math.exp(-1.10*(a*a+b*b)**1.22)*side;
  return { s,t,side,dome,rim,opening };
}

// Lower outline traced in both profiles, registered by the eyes, chin and lip.
// The angle around the front of an ellipse gives a level tangent at the foot
// and a nearly vertical tangent as it approaches the foremost point.
function lowerOutline(z) {
  const q=clamp((z-.070)/.0265,-.99,.999);
  return 1.5721+.0240*(1-Math.sqrt(1-q*q));
}

function deform([x,y,z]) {
  const mask = support(x,y,z);
  if (!mask) return [x,y,z];
  const u = Math.abs(x-axis), sign = Math.sign(x-axis);
  const pad = wing(x,y,z);
  // Spread the vertical turn *under* the forward ball. Its foremost point
  // stays at the lip-to-tip distance measured on the photographs.
  const under = smooth(.055,.063,z)*(1-smooth(1.585,1.594,y))*(1-smooth(.016,.031,u));
  const upper = gauss((y-1.649)/.028);
  const smallWing = gauss((u-.031)/.010,(y-1.603)/.015);
  const fold = gauss((u-.019)/.0049,(y-1.601)/.014);
  const taper = gauss((u-.038)/.015,(y-1.601)/.025);
  const dx = sign*(.0042*pad.dome-.0012*pad.rim-.0024*pad.opening+.0008*smallWing-.0060*taper);
  const floor = lowerOutline(z)+.0055*(u/.024)**2+.0016*(1-gauss(u/.013));
  const dy = under*(floor-y)+.0007*pad.dome;
  const alarRoot = gauss((u-.042)/.0130,(y-1.604)/.0175);
  // The front return of the aperture folds back into the same lateral hollow.
  // It is one concavity that can be seen from the front and the side.
  const narisFloor = gauss((u-.024)/.0095,(y-1.5898)/.0064)*smooth(.063,.082,z);
  const dz = .0008*gauss(u/.020,(y-1.594)/.005)-.0009*gauss(u/.023,(y-1.588)/.005)
    -.0014*gauss(u/.021,(y-1.611)/.013)
    +.0024*smallWing-.0029*fold-.0068*alarRoot-.0087*narisFloor+.0019*upper*gauss((u-.012)/.008);
  return [x+mask*dx,y+mask*dy,z+mask*dz];
}

function shadingNormal(p,n) {
  const h = .00008;
  const columns = p.map((_,i) => {
    const a = [...p], b = [...p];
    a[i] += h; b[i] -= h;
    const plus = deform(a), minus = deform(b);
    return plus.map((v,k) => (v-minus[k])/(2*h));
  });
  const cofactors = [cross(columns[1],columns[2]),cross(columns[2],columns[0]),cross(columns[0],columns[1])];
  const normal = unit(n.map((_,j) => n.reduce((sum,v,k) => sum+v*cofactors[k][j],0)));
  const [x,y,z] = deform(p), u = x-axis;
  // Remove the old sharp lacquer normal at the leading edge of the lobule.
  const bulb = unit([u/.023,(y-1.5988)/.021,Math.max(.13,(z-.078)/.019)]);
  const weight = .83*support(...p)*gauss(u/.023,(y-1.595)/.018);
  const rounded = unit(normal.map((v,k) => v+weight*(bulb[k]-v)));
  const {s,t,side} = wing(x,y,z);
  const wingNormal = unit([Math.sign(u)*.94,.66*t,.30+.70*s]);
  const wingWeight = .53*side*support(...p)*gauss(s/1.35,(t-.18)/1.20);
  return unit(rounded.map((v,k)=>v+wingWeight*(wingNormal[k]-v)));
}

function tone(position, pigment, fill) {
  const [x,y,z] = position, u = Math.abs(x-axis);
  const {s,t,side,dome,rim,opening} = wing(x,y,z);
  const low = 1-smooth(1.618,1.638,y);
  const blend = support(x,y,z)*low;
  const ball = gauss(u/.020,(y-1.600)/.019);
  const reflected = gauss((s-.09)/.88,(t-.24)/.63)*side;
  const separation = gauss((u-.018)/.0048,(y-1.601)/.013)*smooth(.077,.087,z);
  const lowerTurn = (1-smooth(1.582,1.603,y))*smooth(.054,.078,z);
  // The visible upper arch sweeps back around the lateral pad. Fit the
  // reflection and its crease in profile space, where the owner traced them.
  const v=(y-1.599)/.0165;
  const center=.0640-.0095*smooth(.03,.94,v);
  const h=(z-center)/(z<center ? .012 : .019);
  const collar=gauss((Math.hypot(h,v)-1)/.20)*smooth(-.53,.66,v-.92*h);
  const gilding=gauss((z-.0615)/.013,(y-1.603)/.0108);
  const lateral=smooth(.023,.035,u)*(1-smooth(.047,.054,u))*smooth(1.585,1.595,y)*(1-smooth(1.616,1.626,y));
  const groove = 1-.12*rim-.11*separation;
  const dorsum = .25*support(x,y,z)*smooth(1.615,1.636,y)*gauss(u/.015,(y-1.649)/.034);
  const direct = [235,169,56], light = [106,78,38];
  for (let k=0;k<3;k++) {
    direct[k] += [11,20,19][k]*ball+[10,21,20][k]*reflected-[28,32,17][k]*lowerTurn;
    light[k] += [44,38,25][k]*ball+[40,36,27][k]*reflected+[6,6,3][k]*dome-[36,27,14][k]*lowerTurn;
    direct[k] *= groove;
    light[k] *= groove;
    direct[k] += opening*([73,39,13][k]-direct[k]);
    light[k] += opening*([25,14,5][k]-light[k]);
    pigment[k] += blend*(direct[k]-pigment[k]);
    fill[k] += blend*(light[k]-fill[k]);
    pigment[k] += lateral*([12,22,19][k]*gilding-[39,34,18][k]*collar);
    fill[k] += lateral*([19,22,15][k]*gilding-[26,24,15][k]*collar);
    pigment[k] += dorsum*([236,178,68][k]-pigment[k]);
    fill[k] += dorsum*([128,97,50][k]-fill[k]);
  }
}

async function decoded(model,imageId) {
  const {doc,binary} = model, view = doc.bufferViews[doc.images[imageId].bufferView];
  const basis = await codec.init();
  const file = new basis.KTX2File(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength));
  try {
    const width = file.getWidth(), height = file.getHeight(), data = Buffer.alloc(width*height*4);
    if (!file.startTranscoding() || !file.transcodeImage(data,0,0,0,basis.transcoder_texture_format.cTFRGBA32.value,0,-1,-1))
      throw new Error("Cannot transcode the pass-16 atlas");
    return {width,height,data};
  } finally { file.close(); file.delete(); }
}

function sample(image,u,v) {
  const x = u*image.width-.5, y = v*image.height-.5, i = Math.floor(x), j = Math.floor(y);
  const a = x-i, b = y-j, off = 4*(i+j*image.width);
  return [0,1,2,3].map(k => (1-b)*((1-a)*image.data[off+k]+a*image.data[off+4+k])+
    b*((1-a)*image.data[off+4*image.width+k]+a*image.data[off+4*(image.width+1)+k]));
}

async function makeFinish(model, ids, vertices, lod, addView) {
  const {doc} = model, source = doc.materials[0], mat = structuredClone(source);
  const slots = [mat.pbrMetallicRoughness.baseColorTexture,mat.emissiveTexture];
  const originals = [];
  for (const slot of slots) originals.push(await decoded(model,doc.textures[slot.index].extensions.KHR_texture_basisu.source));
  // A padded, tightly cropped pair of local maps. The four original atlases
  // stay embedded byte for byte, including their mip chains and ETC codebooks.
  const uv = i => vertices[i].uv;
  const bounds = [0,1].map(k => {
    const values = ids.map(i => uv(i)[k]);
    return [Math.min(...values)-.004,Math.max(...values)+.004];
  });
  const offset = bounds.map(b=>b[0]), span = bounds.map(b=>b[1]-b[0]);
  const width = lod === "pc" ? 256 : 128, height = width;
  const maps = originals.map(() => new Uint8Array(width*height*4));
  const at = (i,k) => (uv(i)[k]-offset[k])/span[k]*width-.5;
  for (let j=0;j<height;j++) for (let i=0;i<width;i++) {
    const u=offset[0]+(i+.5)*span[0]/width, v=offset[1]+(j+.5)*span[1]/height;
    for (let k=0;k<maps.length;k++) maps[k].set(sample(originals[k],u,v).map(Math.round),4*(j*width+i));
  }
  const donor = maps.map(p=>p.slice());
  const distance = new Float32Array(width*height);
  for (let t=0;t<ids.length;t+=3) {
    const tri = ids.slice(t,t+3);
    const [a,b,c] = tri.map(i => [at(i,0),at(i,1)]);
    const dx=b[0]-a[0], dy=b[1]-a[1], ex=c[0]-a[0], ey=c[1]-a[1], det=dx*ey-dy*ex;
    if (Math.abs(det)<1e-8) continue;
    for (let j=Math.ceil(Math.min(a[1],b[1],c[1]));j<=Math.max(a[1],b[1],c[1]);j++)
      for (let i=Math.ceil(Math.min(a[0],b[0],c[0]));i<=Math.max(a[0],b[0],c[0]);i++) {
        const fx=i-a[0],fy=j-a[1], q=(fx*ey-fy*ex)/det, r=(dx*fy-dy*fx)/det;
        if (q<0 || r<0 || q+r>1) continue;
        const pos=vertices[tri[0]].moved.map((v,k)=>(1-q-r)*v+q*vertices[tri[1]].moved[k]+r*vertices[tri[2]].moved[k]);
        const atPixel=4*(j*width+i);
        distance[j*width+i]=width;
        const rgb=maps.map(p=>Array.from(p.subarray(atPixel,atPixel+4)));
        tone(pos,...rgb);
        for (let k=0;k<2;k++) maps[k].set(rgb[k].map(v=>Math.round(clamp(v,0,255))),atPixel);
      }
  }
  // Decimation makes the material boundary irregular, particularly on the
  // phone. Ease into the *actual* unchanged edge on each cast. The padding
  // is copied from the source as well, for bilinear and mipmap filtering.
  for (const step of [1,-1]) {
    for (let p=step===1?width+1:distance.length-width-2;
      p>=width+1 && p<distance.length-width-1;p+=step) {
      distance[p]=Math.min(distance[p],1+distance[p-step],1+distance[p-step*width],
        Math.SQRT2+distance[p-step*(width+1)],Math.SQRT2+distance[p-step*(width-1)]);
    }
  }
  for (let p=0;p<distance.length;p++) {
    const t=smooth(1,width*.085,distance[p]);
    for (let k=0;k<2;k++) for (let c=0;c<3;c++) {
      const j=4*p+c;
      maps[k][j]=Math.round(donor[k][j]+t*(maps[k][j]-donor[k][j]));
    }
  }
  for (let k=0;k<2;k++) {
    const bytes = await codec.encode(new Uint8Array(1),{
      isUASTC:true,isPerceptual:true,isSetKTX2SRGBTransferFunc:true,
      needSupercompression:true,enableRDO:false,uastcLDRQualityLevel:2,
      generateMipmap:true,isKTX2File:true,isYFlip:false,
      imageDecoder: async()=>({width,height,data:maps[k]}),
    });
    const bufferView = addView({}, Buffer.from(bytes));
    const source = doc.images.push({name:lod+"-nose-"+["color","fill"][k],bufferView,mimeType:"image/ktx2"})-1;
    const slot = slots[k], sampler = doc.textures[slot.index].sampler;
    slot.index = doc.textures.push({sampler,extensions:{KHR_texture_basisu:{source}}})-1;
    slot.texCoord = 0;
    slot.extensions = {KHR_texture_transform:{offset:offset.map((v,i)=>-v/span[i]),scale:span.map(v=>1/v)}};
  }
  doc.extensionsUsed.push("KHR_texture_transform");
  doc.extensionsRequired.push("KHR_texture_transform");
  mat.name = "Main Buddha nasal gold leaf";
  return doc.materials.push(mat)-1;
}

export async function sculptNasalLobule(model,lod) {
  const {doc,binary} = model, mesh=doc.meshes[0], original=mesh.primitives[0];
  if (mesh.primitives.length!==1 || doc.images.length!==4 || !doc.images.some(im=>im.name===lod+"-photographic-fill"))
    throw new Error("Supply the unmodified pass-16 cast for "+lod);
  const pos=doc.accessors[original.attributes.POSITION], indices=doc.accessors[original.indices];
  const vertexView=doc.bufferViews[pos.bufferView], indexView=doc.bufferViews[indices.bufferView];
  if (vertexView.byteStride!==32 || pos.componentType!==5126 || indices.componentType!==5123)
    throw new Error("Unexpected Buddha mesh layout");
  const spans=new Map();
  function addView(spec,bytes) {
    const v={buffer:0,byteOffset:binary.length,byteLength:bytes.length,...spec};
    spans.set(v,bytes); return doc.bufferViews.push(v)-1;
  }
  function compress(view, bytes, count, stride, mode) {
    const encoded = Buffer.from(MeshoptEncoder.encodeGltfBuffer(bytes,count,stride,mode,0));
    const verify = Buffer.alloc(bytes.length);
    MeshoptDecoder.decodeGltfBuffer(verify,count,stride,encoded,mode);
    if (mode==="ATTRIBUTES" && !verify.equals(bytes)) throw new Error("Nasal vertices failed meshopt round trip");
    view.extensions ??= {};
    const ext = view.extensions.EXT_meshopt_compression ??= {buffer:0,byteOffset:binary.length};
    Object.assign(ext,{count,byteStride:stride,mode});
    spans.set(view,bytes); spans.set(ext,encoded);
  }
  const raw=Buffer.from(binary.subarray(vertexView.byteOffset,vertexView.byteOffset+vertexView.byteLength));
  const vertices=Array.from({length:pos.count},(_,i)=>{
    const base=32*i, read=k=>raw.readFloatLE(base+4*k);
    const p=[read(0),read(1),read(2)], n=[read(3),read(4),read(5)], uv=[read(6),read(7)];
    if (uv[0]<.5 || !support(...p)) return {p,moved:p,uv};
    const moved=deform(p);
    [...moved,...shadingNormal(p,n)].forEach((x,k)=>raw.writeFloatLE(x,base+4*k));
    return {p,moved,uv};
  });
  compress(vertexView,raw,pos.count,32,"ATTRIBUTES");
  const skin=[], nose=[];
  for (let t=0;t<indices.count;t+=3) {
    const tri=[0,1,2].map(k=>binary.readUInt16LE(indexView.byteOffset+2*(t+k)));
    const local=tri.every(i=>{
      const {p:[x,y,z],uv}=vertices[i];
      const limit=y>1.634 ? .018 : .052;
      return uv[0]>.5 && Math.abs(x-axis)<limit && y>1.577 && y<1.682 && (z>.054 || y>1.582);
    });
    (local?nose:skin).push(...tri);
  }
  const material=await makeFinish(model,nose,vertices,lod,addView);
  function indexBytes(list) { return Buffer.from(Uint16Array.from(list).buffer); }
  indices.count=skin.length;
  compress(indexView,indexBytes(skin),skin.length,2,"TRIANGLES");
  const bytes=indexBytes(nose), view=addView({target:34963},bytes);
  compress(doc.bufferViews[view],bytes,nose.length,2,"TRIANGLES");
  mesh.primitives.push({...original,indices:doc.accessors.push({...indices,bufferView:view,count:nose.length})-1,material});
  console.log(lod,vertices.filter(v=>v.p!==v.moved).length,"nasal vertices,",nose.length/3,"local finish triangles");
  return spans;
}
