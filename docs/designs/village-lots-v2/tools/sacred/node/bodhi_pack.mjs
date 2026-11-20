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
const srgb = x => Math.round(255*(1.055*Math.max(.0031308,x)**(1/2.4)-.055));
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

function garmentMasks(primitive, cut, size) {
  const indices = primitive.getIndices().getArray();
  const pos = primitive.getAttribute("POSITION").getArray();
  const uv = primitive.getAttribute("TEXCOORD_0").getArray();
  const cutPositions = new Map();
  for (const t of cut) for (const index of indices.subarray(t*3,t*3+3)) {
    const p = pos.subarray(3*index,3*index+3);
    cutPositions.set(p.join(","),p);
  }
  const seamPositions = new Map();
  for (let i=0; i<indices.length; i++) {
    if (cut.has(Math.floor(i/3))) continue;
    const p = pos.subarray(3*indices[i],3*indices[i]+3);
    const key = p.join(",");
    if (cutPositions.has(key)) seamPositions.set(key,p);
  }
  assert(seamPositions.size >= 8, "The face cut does not meet the surrounding scan");
  const border = [...seamPositions.values()];
  const weights = new Float32Array(pos.length);
  for (let i=0; i<pos.length/3; i++) {
    const [x,y,z] = pos.subarray(i*3,i*3+3);
    // The old scan wears a tied garment from the waist to the ankles.
    // Keep exposed arms and feet closer to the finish of the face.
    weights[3*i] = smooth(.05,.18,y)*(1-smooth(1.13,1.28,y))*(1-smooth(.29,.37,Math.abs(x+.04)));
    if (y<1.66) continue;
    let d2 = Infinity;
    for (const p of border) d2 = Math.min(d2,(x-p[0])**2+(y-p[1])**2+(z-p[2])**2);
    weights[3*i+1] = 1-smooth(.002,.020,Math.sqrt(d2));
    const lateral=Math.abs(x+.047), hairline=2.052-.065*clamp((lateral/.138)**3);
    const ear=smooth(.099,.131,lateral)*(1-smooth(-.035,.009,z))*smooth(1.728,1.76,y);
    weights[3*i+2] = Math.max(ear,smooth(hairline-.006,hairline+.008,y));
  }

  // Paint the labels into the original UV unwrap, including a four-texel
  // gutter on its numerous small scan islands, for stable oblique mip levels.
  const cloth = new Float32Array(size*size), seam = new Float32Array(size*size), crown = new Float32Array(size*size);
  const distance = new Float32Array(size*size).fill(5);
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
    }
  }
  return {cloth,seam,crown};
}

async function dressScan(primitive, cut, size) {
  const material=primitive.getMaterial(), colorMap=material.getBaseColorTexture();
  const ormMap=material.getMetallicRoughnessTexture(), normalMap=material.getNormalTexture();
  const color=await readPixels(colorMap,size), orm=await readPixels(ormMap,size);
  const {cloth,seam,crown}=garmentMasks(primitive,cut,size);
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
  const {normalMap,normalBytes}=await dressScan(scan,cut,phone?512:1024);
  model.getRoot().listExtensionsUsed().find(ext=>ext.extensionName==="KHR_texture_basisu").dispose();
  scan.getIndices().setArray(indices.filter((_,i)=>!cut.has(Math.floor(i/3))));

  // The hall looks up mesh nodes by their original name, so keep all
  // primitives together under the shipped node, including the forehead jewel.
  const parts=donor.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
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
