/**
 * Finish the standing attendants from the shipped scan at 2e31a933.
 * To reproduce, extract the two originals from this archive into <original>:
 * git archive -o original.zip 2e31a933:client/public/models/village/lots/sacred "lotstatue__lot_temple_hall_bodhisattva*.glb"
 * From the sacred tools directory, with its node/package-lock.json installed:
 * blender -b -P bodhi_face.py -- <original> <faces>
 * node node/bodhi_pack.mjs <original> <faces> <work> <destination> [pc|phone]
 * The face builder writes a list of original triangle ordinals for each LOD.
 * Everything outside that patch retains the scan's positions, normals and UVs.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { copyToDocument, prune, unpartition } from "@gltf-transform/functions";
import { NodeBasisEncoder } from "ktx2-encoder";
import sharp from "sharp";
import { portraitLeaf } from "./buddha_leaf.mjs";

const [original, faceDir, work, destination, tier, ...extra] = process.argv.slice(2);
if (!destination || extra.length || (tier && !["pc","phone"].includes(tier))) {
  throw new Error("Expected original directory, face directory, work directory, destination and optionally pc or phone");
}
const here = path.dirname(fileURLToPath(import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const basis = await new NodeBasisEncoder().init();
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const mix = (a, b, t) => a+(b-a)*t;
const srgb = x => Math.round(255*(x<=.0031308 ? 12.92*x : 1.055*x**(1/2.4)-.055));
const gilt = [.94,.529,.074]; // Same linear leaf colour as the pass-14 facial oval.

async function readPixels(texture, size) {
  const file = new basis.KTX2File(texture.getImage());
  try {
    assert(file.isValid() && file.startTranscoding(), "Invalid source KTX2");
    const width = file.getWidth(), height = file.getHeight();
    const pixels = Buffer.alloc(width*height*4);
    assert(file.transcodeImage(pixels, 0, 0, 0, basis.transcoder_texture_format.cTFRGBA32.value, 0, -1, -1));
    return await sharp(pixels,{raw:{width,height,channels:4}})
      .resize(size,size,{fit:"fill",kernel:"mks2021"}).raw().toBuffer();
  } finally {
    file.close();
    file.delete();
  }
}

async function setPixels(texture, pixels, size) {
  const image = await sharp(pixels,{raw:{width:size,height:size,channels:4}}).png().toBuffer();
  texture.setImage(image).setMimeType("image/png");
}

function altarLight(x, height, normal, color, phone) {
  const px=x+.047, faceX=px/.83;
  const lift=.0046*(1-Math.exp(-((faceX/.029)**2)))*Math.exp(-(((height-1.835)/.022)**2));
  return portraitLeaf(normal,faceX,1.680+(height-1.937+.014*px-lift)/.80,color,phone);
}

function cutBorder(primitive, cut) {
  const indices=primitive.getIndices().getArray(), pos=primitive.getAttribute("POSITION");
  const edges=new Map();
  for (const t of cut) {
    const tri=Array.from(indices.subarray(t*3,t*3+3), i=>pos.getElement(i,[]));
    for (let side=0; side<3; side++) {
      const a=tri[side], b=tri[(side+1)%3], key=[a.join(","),b.join(",")].sort().join("/");
      if (edges.has(key)) edges.delete(key);
      else edges.set(key,[a,b]);
    }
  }
  assert(edges.size>=8, "Missing perimeter of the original face");
  const segments=[...edges.values()].map(([a,b])=>{
    const dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2];
    return [...a,dx,dy,dz,1/(dx*dx+dy*dy+dz*dz)];
  });
  return (x,y,z)=>{
    let best=Infinity;
    for (const [ax,ay,az,dx,dy,dz,inv] of segments) {
      const t=clamp(((x-ax)*dx+(y-ay)*dy+(z-az)*dz)*inv);
      best=Math.min(best,(x-ax-t*dx)**2+(y-ay-t*dy)**2+(z-az-t*dz)**2);
    }
    return Math.sqrt(best);
  };
}

const rimLight = .62;

async function lightPortrait(model, part, lod, rimDistance) {
  // Bake the same broad altar reflection as the seated Buddha on the actual
  // attendant normals. Carry the same light across the perimeter to the scan,
  // then let the varnish and the pigment absorb it where the metal is painted.
  const phone = lod === "phone", size = phone ? 256 : 384;
  const material = part.getMaterial(), buffer = Buffer.alloc(size*size*4);
  const maps = [material.getBaseColorTexture(), material.getMetallicRoughnessTexture()];
  const [albedo,orm] = await Promise.all(maps.map(texture =>
    sharp(texture.getImage()).resize(size,size).ensureAlpha().raw().toBuffer()));
  const uv = part.getAttribute("TEXCOORD_0"), pos = part.getAttribute("POSITION");
  const norm = part.getAttribute("NORMAL"), indices = part.getIndices().getArray();
  const base = phone ? [.92,.80,.64] : [.77,.79,.64];
  const linear = x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4;
  const distance = Array.from({length:pos.getCount()},(_,i)=>rimDistance(...pos.getElement(i,[])));
  for (let t=0; t<indices.length; t+=3) {
    const ids = indices.subarray(t,t+3);
    const [a,b,c] = Array.from(ids,i => uv.getElement(i,[]).map(v => size*v-.5));
    const points = Array.from(ids,i => pos.getElement(i,[]));
    const normals = Array.from(ids,i => norm.getElement(i,[]));
    const dx=b[0]-a[0], dy=b[1]-a[1], ex=c[0]-a[0], ey=c[1]-a[1], det=dx*ey-dy*ex;
    if (Math.abs(det)<1e-8) continue;
    const x0=Math.max(0,Math.ceil(Math.min(a[0],b[0],c[0]))), x1=Math.min(size-1,Math.floor(Math.max(a[0],b[0],c[0])));
    const y0=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1]))), y1=Math.min(size-1,Math.floor(Math.max(a[1],b[1],c[1])));
    for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++) {
      const fx=x-a[0], fy=y-a[1], u=(fx*ey-fy*ex)/det, v=(dx*fy-dy*fx)/det, w=1-u-v;
      if (Math.min(u,v,w)<0) continue;
      const at=4*(y*size+x), bare=smooth(.34,.59,orm[at+2]/255);
      buffer[at+3]=255;
      if (!bare) continue;
      const interpolate=(corners,k) => w*corners[0][k]+u*corners[1][k]+v*corners[2][k];
      const n=[0,1,2].map(k => interpolate(normals,k));
      const inside=smooth(0,.060,w*distance[ids[0]]+u*distance[ids[1]]+v*distance[ids[2]]);
      const rgb=[0,1,2].map(k=>mix(gilt[k],linear(albedo[at+k]/255)/base[k],inside));
      const light=altarLight(interpolate(points,0),interpolate(points,1),n,rgb,phone);
      for (let k=0; k<3; k++) buffer[at+k]=srgb(Math.min(1,light[k]*bare*mix(rimLight,1,inside)));
    }
  }
  // The face UV stops at the join. Pad its colour beyond that edge so an
  // oblique mip sample sees the same light as the neighbouring scan island.
  for (let pass=0;pass<4;pass++) {
    const previous=Buffer.from(buffer);
    for (let y=1;y<size-1;y++) for (let x=1;x<size-1;x++) {
      const at=4*(y*size+x);
      if (previous[at+3]) continue;
      const adjacent=[at-4,at+4,at-4*size,at+4*size].find(i=>previous[i+3]);
      if (adjacent!==undefined) previous.copy(buffer,at,adjacent,adjacent+4);
    }
  }
  for (let i=3;i<buffer.length;i+=4) buffer[i]=255;
  const fill=model.createTexture(lod+"-face-altar");
  await setPixels(fill,buffer,size);
  material.setEmissiveTexture(fill).setEmissiveFactor([1,1,1]);
}

function garmentMasks(primitive, cut, size, rimDistance) {
  const indices = primitive.getIndices().getArray();
  const pos = primitive.getAttribute("POSITION").getArray();
  const uv = primitive.getAttribute("TEXCOORD_0").getArray();
  const weights = new Float32Array(pos.length);
  const bounce = new Float32Array(pos.length), normals=primitive.getAttribute("NORMAL");
  for (let i=0; i<pos.length/3; i++) {
    const [x,y,z] = pos.subarray(i*3,i*3+3);
    // The old scan wears a tied garment from the waist to the ankles.
    // Keep exposed arms and feet closer to the finish of the face.
    weights[3*i] = smooth(.05,.18,y)*(1-smooth(1.13,1.28,y))*(1-smooth(.29,.37,Math.abs(x+.04)));
    if (y<1.58) continue;
    const distance=rimDistance(x,y,z);
    weights[3*i+1] = 1-smooth(.002,.020,distance);
    const lateral=Math.abs(x+.047), hairline=2.052-.065*clamp((lateral/.138)**3);
    const ear=smooth(.099,.131,lateral)*(1-smooth(-.035,.009,z))*smooth(1.728,1.76,y);
    weights[3*i+2] = Math.max(ear,smooth(hairline-.006,hairline+.008,y));
    const gain=rimLight*(1-smooth(0,.14,distance));
    if (gain>0) {
      const light=altarLight(x,y,normals.getElement(i,[]),gilt,size===512);
      for (let k=0;k<3;k++) bounce[3*i+k]=light[k]*gain;
    }
  }

  // Paint the labels into the original UV unwrap, including a four-texel
  // gutter on its numerous small scan islands, for stable oblique mip levels.
  const cloth = new Float32Array(size*size), seam = new Float32Array(size*size), crown = new Float32Array(size*size);
  const distance = new Float32Array(size*size).fill(5);
  const headFill = Buffer.alloc(size*size*4);
  for (let i=3;i<headFill.length;i+=4) headFill[i]=255;
  for (let i=0; i<indices.length; i+=3) {
    if (cut.has(i/3)) continue;
    const ids = indices.subarray(i,i+3);
    const [a,b,c] = Array.from(ids,id => [uv[2*id]*size-.5,uv[2*id+1]*size-.5]);
    const dx=b[0]-a[0],dy=b[1]-a[1],ex=c[0]-a[0],ey=c[1]-a[1],det=dx*ey-dy*ex;
    if (Math.abs(det)<1e-8) continue;
    const altitude = [Math.hypot(b[0]-c[0],b[1]-c[1]),Math.hypot(ex,ey),Math.hypot(dx,dy)]
      .map(length=>Math.abs(det)/length);
    const x0=Math.max(0,Math.ceil(Math.min(a[0],b[0],c[0])-4)), x1=Math.min(size-1,Math.floor(Math.max(a[0],b[0],c[0])+4));
    const y0=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1])-4)), y1=Math.min(size-1,Math.floor(Math.max(a[1],b[1],c[1])+4));
    for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++) {
      const u=((x-a[0])*ey-(y-a[1])*ex)/det, v=(dx*(y-a[1])-dy*(x-a[0]))/det, w=1-u-v;
      const d=Math.max(-w*altitude[0],-u*altitude[1],-v*altitude[2],0), pixel=y*size+x;
      if (d>4 || d>=distance[pixel]) continue;
      distance[pixel]=d;
      const denom=Math.max(0,w)+Math.max(0,u)+Math.max(0,v);
      const w0=Math.max(0,w)/denom, w1=Math.max(0,u)/denom, w2=Math.max(0,v)/denom;
      cloth[pixel]=w0*weights[3*ids[0]]+w1*weights[3*ids[1]]+w2*weights[3*ids[2]];
      seam[pixel]=w0*weights[3*ids[0]+1]+w1*weights[3*ids[1]+1]+w2*weights[3*ids[2]+1];
      crown[pixel]=w0*weights[3*ids[0]+2]+w1*weights[3*ids[1]+2]+w2*weights[3*ids[2]+2];
      for (let k=0;k<3;k++) {
        headFill[4*pixel+k]=srgb(w0*bounce[3*ids[0]+k]+w1*bounce[3*ids[1]+k]+w2*bounce[3*ids[2]+k]);
      }
    }
  }
  return {cloth,seam,crown,headFill};
}

async function dressScan(model, primitive, cut, size, rimDistance) {
  const material=primitive.getMaterial(), colorMap=material.getBaseColorTexture();
  const ormMap=material.getMetallicRoughnessTexture(), normalMap=material.getNormalTexture();
  const color=await readPixels(colorMap,size), orm=await readPixels(ormMap,size);
  const {cloth,seam,crown,headFill}=garmentMasks(primitive,cut,size,rimDistance);
  for (let p=0;p<size*size;p++) {
    const i=4*p, cavity=clamp((1-orm[i]/255)/.75), silk=cloth[p], edge=seam[p];
    // The high-resolution scan contributes its occlusion, fine patina and
    // fold normals. Give the garment a broader highlight and warm troughs.
    const patina=clamp((color[i]-132)/40);
    const ornament=crown[p]*(1-edge);
    const light=mix(1-(.22+.17*silk)*cavity-.045*(1-patina),1,edge)*(1-ornament*(.12+.24*cavity));
    color[i]=srgb(gilt[0]*light);
    color[i+1]=srgb(gilt[1]*light*mix(1-.12*cavity,1,edge));
    color[i+2]=srgb(gilt[2]*light*mix(1-.17*cavity,1,edge));
    color[i+3]=255;
    orm[i]=Math.round(255*mix(1-.61*cavity,1,edge));
    orm[i+1]=Math.round(255*mix(mix(.51+.084*silk+.045*cavity,.51,edge),.31+.13*cavity,ornament));
    orm[i+2]=Math.round(255*mix(mix(.68-.06*silk-.04*cavity,.68,edge),.74,ornament));
    orm[i+3]=255;
  }
  material.setName("Attendant satin gilt");
  const fill=model.createTexture((size===512?"phone":"pc")+"-head-altar");
  await setPixels(fill,headFill,size);
  material.setEmissiveTexture(fill).setEmissiveFactor([1,1,1]);
  const normalBytes=normalMap.getImage(), normalSize=size===1024?2048:512;
  await Promise.all([[colorMap,color],[ormMap,orm]].map(([t,p])=>setPixels(t,p,size)));
  // The original high-resolution normal carries the engraved hair, diadem
  // and pierced ear folds. Preserve its shipping KTX2 verbatim.
  await setPixels(normalMap,await readPixels(normalMap,normalSize),normalSize);
  return {normalMap,normalBytes};
}

mkdirSync(work,{recursive:true});
const packed = [];
for (const lod of tier?[tier]:["pc","phone"]) {
  const phone=lod==="phone", name="lotstatue__lot_temple_hall_bodhisattva"+(phone?"_phone":"")+".glb";
  const source=readFileSync(path.join(original,name));
  // The triangle ordinals are specific to this scan export.
  const expected=phone?"ba602cc4214aa67d8af619ff65006c65fbbb1eaf40b57f50216822441fb9ccd6":"77d5908b462b61681ebc4cfd243a0372f39dc33a030dc8ce1b95b1b4495672e3";
  assert.equal(createHash("sha256").update(source).digest("hex"),expected,"Extract the original pair from 2e31a933");
  const model=await io.readBinary(source), donor=await io.read(path.join(faceDir,lod+"-face.glb"));
  const mesh=model.getRoot().listMeshes()[0], [scan]=mesh.listPrimitives(), indices=scan.getIndices().getArray();
  assert.equal(indices.length/3,phone?4500:13000,"Expected the original cast");
  const cut=new Set(JSON.parse(readFileSync(path.join(faceDir,lod+"-cut.json"),"utf8")));
  assert(cut.size>0 && [...cut].every(t=>Number.isInteger(t) && t>=0 && 3*t<indices.length));
  const rimDistance=cutBorder(scan,cut);
  const {normalMap,normalBytes}=await dressScan(model,scan,cut,phone?512:1024,rimDistance);
  model.getRoot().listExtensionsUsed().find(ext=>ext.extensionName==="KHR_texture_basisu").dispose();
  scan.getIndices().setArray(indices.filter((_,i)=>!cut.has(Math.floor(i/3))));

  // The hall looks up mesh nodes by their original name, so keep all
  // primitives together under the shipped node, including the forehead jewel.
  const parts=donor.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
  const face=parts.find(part=>part.getMaterial().getName()==="bodhisattva_face_gilt");
  assert(face, "Missing painted face");
  await lightPortrait(donor,face,lod,rimDistance);
  for (const node of donor.getRoot().listNodes().filter(n=>n.getMesh())) {
    const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    assert(node.getWorldMatrix().every((n,i)=>Math.abs(n-identity[i])<1e-6),"Apply face transforms before packing");
  }
  const imported=copyToDocument(model,donor,parts);
  for (const part of parts) mesh.addPrimitive(imported.get(part));
  await model.transform(unpartition(),prune());
  const preview=path.join(work,lod+"-preview.glb"), compressed=path.join(work,lod+"-packed.glb");
  await io.write(preview,model);
  // Only the new charts need encoding. Put the original normal back
  // after compression rather than transcoding the engraving a second time.
  const newCharts=path.join(work,lod+"-charts.glb");
  const normalName=normalMap.getName();
  scan.getMaterial().setNormalTexture(null);
  normalMap.dispose();
  await io.write(newCharts,model);
  execFileSync(process.execPath,[path.join(here,"ktx2_glb.mjs"),newCharts,compressed,phone?"512":"1024","all",phone?"512":"1024"],{stdio:"inherit"});
  const finished=await io.read(compressed);
  const normal=finished.createTexture(normalName).setImage(normalBytes).setMimeType("image/ktx2");
  finished.getRoot().listMeshes()[0].listPrimitives()[0].getMaterial().setNormalTexture(normal);
  await io.write(compressed,finished);
  packed.push([path.join(destination,name),readFileSync(compressed)]);
}
for (const [filename,bytes] of packed) writeFileSync(filename,bytes);
