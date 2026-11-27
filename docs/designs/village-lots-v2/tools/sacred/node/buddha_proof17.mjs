/**
 * From the repo root: node .../buddha_proof17.mjs OUTPUT_DIR [CANDIDATE_GLB_DIR]
 * Deterministic, single-threaded full-statue diagnostic for the two shipping LODs.
 * Raster both independent GLBs before consulting the fixed 2D nose outlines.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NodeBasisEncoder } from "ktx2-encoder";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

const revision = "2d9bb4ef";
const assetPath = "client/public/models/village/lots/sacred";
const fromGit = (filename, ref = revision) => execFileSync("git", ["show", ref + ":" + assetPath + "/" + filename], {
  maxBuffer: 16 * 1024 * 1024, windowsHide: true,
});
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const baseName = "lotstatue__lot_temple_hall_";
sharp.concurrency(1);
await MeshoptDecoder.ready;
const basis = await new NodeBasisEncoder().init();

// Coordinates in the pass-16 head crop, using the pass-16 camera registration.
// Left/right silhouettes include a small background margin for the proposed tip.
const frontMask = [[61,88],[73,88],[75,97],[76,106],[81,110],[85,116],
  [84,122],[78,125],[71,126],[67,128],[61,126],[54,125],[49,122],[49,115],
  [53,110],[58,106],[59,97]];
const leftMask = [[16,88],[29,88],[28,91],[26,96],[25,101],[26,106],
  [29,112],[30,120],[27,125],[22,126],[18,128],[12,127],[5,125],[4,118],
  [6,110],[11,101],[15,93]];
const views = [
  {key:"front", label:"정면", axis:[0,1], origin:197, headX:129, mask:frontMask},
  {key:"left", label:"왼쪽을 향한 측면", axis:[1,0], origin:192, headX:157, mask:leftMask},
  {key:"right", label:"오른쪽을 향한 측면", axis:[-1,0], origin:203.5, headX:107,
    mask:leftMask.map(([x,y])=>[131.5-x,y])},
];
const scale = 3, width = 384*scale, height = 570*scale, headY = 11;
const raw = {width,height,channels:3};

function parse(bytes) {
  assert.equal(bytes.toString("ascii",0,4),"glTF");
  const len = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20,20+len));
  const binary = bytes.subarray(28+len);
  const part = view => binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  for (const view of doc.bufferViews) {
    const ex = view.extensions?.EXT_meshopt_compression;
    if (!ex) continue;
    const decoded = Buffer.alloc(ex.count*ex.byteStride);
    MeshoptDecoder.decodeGltfBuffer(decoded, ex.count, ex.byteStride, part(ex), ex.mode, ex.filter);
    const fallback = part(view);
    if (ex.mode === "ATTRIBUTES") assert.ok(fallback.equals(decoded), "Meshopt/fallback attribute mismatch");
    else {
      assert.equal(ex.mode, "TRIANGLES");
      for (let i=0; i<ex.count; i+=3) {
        const tri = [0,1,2].map(c=>fallback.readUIntLE((i+c)*ex.byteStride,ex.byteStride));
        const rotated = [0,1,2].map(c=>decoded.readUIntLE((i+c)*ex.byteStride,ex.byteStride));
        assert.ok([0,1,2].some(k=>rotated.every((v,j)=>v===tri[(j+k)%3])), "Meshopt/fallback triangle mismatch");
      }
    }
  }
  function read(id) {
    const a = doc.accessors[id], v = doc.bufferViews[a.bufferView], b = part(v);
    assert.ok(!a.sparse);
    const lanes = {VEC3:3,VEC2:2,SCALAR:1}[a.type];
    const float = a.componentType===5126, size = {5123:2,5125:4,5126:4}[a.componentType];
    assert.ok(size && lanes);
    const arr = float ? new Float32Array(a.count*lanes) : new Uint32Array(a.count*lanes);
    for (let i=0; i<a.count; i++) for (let j=0; j<lanes; j++) {
      const at = (a.byteOffset || 0) + i*(v.byteStride || size*lanes) + j*size;
      arr[i*lanes+j] = float ? b.readFloatLE(at) : b.readUIntLE(at,size);
    }
    return arr;
  }
  assert.equal(doc.nodes.length,1); assert.equal(doc.meshes.length,1);
  assert.deepEqual(doc.nodes[0],{name:doc.meshes[0].name,mesh:0});
  const primitives = doc.meshes[0].primitives, p = primitives[0];
  assert.deepEqual(Object.keys(p.attributes).sort(),["NORMAL","POSITION","TEXCOORD_0","TEXCOORD_1"]);
  assert.ok(doc.accessors[p.attributes.TEXCOORD_1].normalized);
  const attributes = Object.fromEntries(Object.entries(p.attributes).map(([k,id])=>[k,read(id)]));
  const images = doc.images.map(im=>part(doc.bufferViews[im.bufferView]));
  const triangles = new Map();
  for (const prim of primitives) {
    assert.equal(prim.mode,4);
    assert.deepEqual(prim.attributes,p.attributes,"Expected shared Buddha vertex attributes");
    const indices = read(prim.indices), count = attributes.POSITION.length/3;
    for (let i=0;i<indices.length;i+=3) {
      const a=indices[i], b=indices[i+1], c=indices[i+2];
      assert.ok(a<count && b<count && c<count);
      // Retain winding. Canonical order also makes depth ties independent of the
      // split into material primitives, and preserves byte-identical diagnostic shading.
      const ids = a<=b && a<=c ? [a,b,c] : b<=c ? [b,c,a] : [c,a,b];
      const key=(ids[0]*count+ids[1])*count+ids[2];
      assert.ok(!triangles.has(key),"Duplicated triangle");
      triangles.set(key,{ids,material:prim.material});
    }
  }
  return {doc,attributes,triangles,images,sha256:sha(bytes)};
}

function inAnatomicalRegion(attributes,i) {
  const x=attributes.POSITION[3*i]+.004, y=attributes.POSITION[3*i+1];
  const u=attributes.TEXCOORD_0[2*i], maxX=y<=1.636 ? .060 : .032;
  return u>.5 && y>=1.565 && y<=1.724 && Math.abs(x)<=maxX;
}

function audit(before, after) {
  for (const key of ["nodes","scenes","scene"]) assert.deepEqual(before.doc[key],after.doc[key],key+" changed");
  for (const key of ["materials","textures","samplers"]) {
    assert.deepEqual(before.doc[key],after.doc[key].slice(0,before.doc[key].length),key+" changed");
  }
  assert.deepEqual(before.images.map(sha), after.images.slice(0,before.images.length).map(sha), "Original KTX2 maps changed");
  assert.equal(before.triangles.size,after.triangles.size,"Triangle count changed");
  let materialChanges=0;
  for (const [key,triangle] of before.triangles) {
    const next=after.triangles.get(key);
    assert.ok(next,"Triangle removed or winding reversed");
    if (next.material===triangle.material) continue;
    assert.ok(triangle.ids.every(i=>inAnatomicalRegion(before.attributes,i)),"New material on a non-nasal triangle");
    materialChanges++;
  }
  const counts = {}, affected = new Set(), protectedChanged = new Set();
  const a = before.attributes, b = after.attributes, count = a.POSITION.length/3;
  for (const k of Object.keys(a)) {
    assert.equal(a[k].length,b[k].length);
    const lanes = a[k].length/count;
    counts[k]=0;
    for (let i=0;i<count;i++) {
      let diff=false;
      for (let j=0;j<lanes;j++) if (!Object.is(a[k][lanes*i+j],b[k][lanes*i+j])) diff=true;
      if (!diff) continue;
      if (!inAnatomicalRegion(a,i)) protectedChanged.add(i);
      counts[k]++; affected.add(i);
    }
  }
  assert.equal(protectedChanged.size,0,"Changed vertices outside the frontal nasal region");
  return {vertices:count,changedVertices:affected.size,lockedVerticesChanged:protectedChanged.size,
    triangles:before.triangles.size,noseTrianglesWithNewMaterial:materialChanges,
    changedAttributes:counts,unchangedTextureHashes:before.images.map(sha)};
}

function decode(bytes) {
  const k = new basis.KTX2File(bytes);
  try {
    assert.ok(k.isValid() && k.startTranscoding());
    const w=k.getWidth(), h=k.getHeight();
    const pixels = Buffer.alloc(4*w*h);
    assert.ok(k.transcodeImage(pixels,0,0,0,basis.transcoder_texture_format.cTFRGBA32.value,0,-1,-1));
    return {pixels,w,h};
  } finally { k.close(); k.delete(); }
}

function address(x,size,wrap) {
  if (wrap===33071) return Math.max(0,Math.min(size-1,x));
  if (wrap===33648) {
    x=((x%(2*size))+2*size)%(2*size);
    return x>=size ? 2*size-x-1 : x;
  }
  return ((x%size)+size)%size;
}

function sample(tex,u,v,sampleRgb) {
  const x=(tex.offset[0]+tex.scale[0]*u)*tex.w-.5;
  const y=(tex.offset[1]+tex.scale[1]*v)*tex.h-.5;
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
  const x1=address(ix,tex.w,tex.wrapS), x2=address(ix+1,tex.w,tex.wrapS);
  const y1=address(iy,tex.h,tex.wrapT)*tex.w, y2=address(iy+1,tex.h,tex.wrapT)*tex.w;
  for (let j=0;j<3;j++) sampleRgb[j]=
    (1-fy)*((1-fx)*tex.pixels[4*(x1+y1)+j]+fx*tex.pixels[4*(x2+y1)+j])+
    fy*((1-fx)*tex.pixels[4*(x1+y2)+j]+fx*tex.pixels[4*(x2+y2)+j]);
}

function materialMaps(model) {
  const {doc,images}=model;
  const decoded=new Map();
  function read(slot) {
    const texture=doc.textures[slot.index], source=texture.extensions.KHR_texture_basisu.source;
    const sampler=doc.samplers[texture.sampler] || {};
    if (!decoded.has(source)) decoded.set(source,decode(images[source]));
    const tx=slot.extensions?.KHR_texture_transform || {};
    assert.ok(!tx.rotation);
    const coord=tx.texCoord ?? slot.texCoord ?? 0;
    assert.ok(coord===0 || coord===1);
    return {...decoded.get(source),coord,offset:tx.offset || [0,0],scale:tx.scale || [1,1],
      wrapS:sampler.wrapS || 10497,wrapT:sampler.wrapT || 10497};
  }
  return doc.materials.map(m=>({base:read(m.pbrMetallicRoughness.baseColorTexture),
    fill:read(m.emissiveTexture),baseFactor:m.pbrMetallicRoughness.baseColorFactor || [1,1,1,1],
    glowFactor:m.emissiveFactor || [0,0,0],strength:m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1}));
}

function raster(model,view,materials) {
  const {POSITION:p,NORMAL:n,TEXCOORD_0:uv,TEXCOORD_1:uv1}=model.attributes;
  const [ax,az]=view.axis, t=.068, inv=1/Math.hypot(1,t);
  const xy = new Float64Array(p.length), depth = new Float64Array(width*height).fill(-Infinity);
  const rgb = Buffer.alloc(width*height*3,143);
  const baseRgb=new Float64Array(3), fillRgb=new Float64Array(3);
  for (let i=0; i<p.length; i+=3) {
    const x=p[i], y=p[i+1], z=p[i+2], out=ax*x+az*z;
    xy[i]=scale*(view.origin+265*(az*x-ax*z));
    xy[i+1]=scale*(551.5-265*(y-t*out)*inv);
    xy[i+2]=out+t*y;
  }
  const keys=Array.from(model.triangles.keys()).sort((a,b)=>a-b);
  for (const key of keys) {
    const tri=model.triangles.get(key), maps=materials[tri.material];
    const [a,b,c]=tri.ids, ai=3*a, bi=3*b, ci=3*c;
    const x0=xy[ai],y0=xy[ai+1], dx=xy[bi]-x0,dy=xy[bi+1]-y0,ex=xy[ci]-x0,ey=xy[ci+1]-y0;
    const det=dx*ey-dy*ex;
    if (Math.abs(det)<1e-10) continue;
    const left=Math.max(0,Math.ceil(Math.min(x0,xy[bi],xy[ci])-.5));
    const right=Math.min(width-1,Math.floor(Math.max(x0,xy[bi],xy[ci])-.5));
    const top=Math.max(0,Math.ceil(Math.min(y0,xy[bi+1],xy[ci+1])-.5));
    const bottom=Math.min(height-1,Math.floor(Math.max(y0,xy[bi+1],xy[ci+1])-.5));
    for (let y=top;y<=bottom;y++) for (let x=left;x<=right;x++) {
      const fx=x+.5-x0,fy=y+.5-y0, wb=(fx*ey-fy*ex)/det, wc=(dx*fy-dy*fx)/det, wa=1-wb-wc;
      if (wa<0 || wb<0 || wc<0) continue;
      const d=wa*xy[ai+2]+wb*xy[bi+2]+wc*xy[ci+2], i=y*width+x;
      if (d<=depth[i]) continue;
      depth[i]=d;
      const nx=wa*n[ai]+wb*n[bi]+wc*n[ci], ny=wa*n[ai+1]+wb*n[bi+1]+wc*n[ci+1];
      const nz=wa*n[ai+2]+wb*n[bi+2]+wc*n[ci+2], norm=Math.sqrt(nx*nx+ny*ny+nz*nz);
      const diffuse=Math.max(0,(-.34*nx+.62*ny+.707*nz)/norm);
      const u=wa*uv[2*a]+wb*uv[2*b]+wc*uv[2*c], v=wa*uv[2*a+1]+wb*uv[2*b+1]+wc*uv[2*c+1];
      const s=(wa*uv1[2*a]+wb*uv1[2*b]+wc*uv1[2*c])/65535;
      const t2=(wa*uv1[2*a+1]+wb*uv1[2*b+1]+wc*uv1[2*c+1])/65535;
      sample(maps.base,maps.base.coord?s:u,maps.base.coord?t2:v,baseRgb);
      sample(maps.fill,maps.fill.coord?s:u,maps.fill.coord?t2:v,fillRgb);
      for (let j=0;j<3;j++) rgb[3*i+j]=Math.min(255,Math.round(
        maps.baseFactor[j]*baseRgb[j]*(.49+.41*diffuse)+.24*maps.strength*maps.glowFactor[j]*fillRgb[j]));
    }
  }
  return rgb;
}

function inNose(x,y,view) {
  const localX=(x+.5)/scale-view.headX, localY=(y+.5)/scale-headY;
  let inside=false;
  for (let i=0,j=view.mask.length-1;i<view.mask.length;j=i++) {
    const a=view.mask[i], b=view.mask[j];
    if ((a[1]>localY)!==(b[1]>localY) && localX<(b[0]-a[0])*(localY-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}

function nosePixels(view) {
  const xx=view.mask.map(([x])=>(x+view.headX)*scale);
  const yy=view.mask.map(([,y])=>(y+headY)*scale);
  let count=0;
  for (let y=Math.floor(Math.min(...yy));y<=Math.ceil(Math.max(...yy));y++) {
    for (let x=Math.floor(Math.min(...xx));x<=Math.ceil(Math.max(...xx));x++) count+=Number(inNose(x,y,view));
  }
  return count;
}

export { assetPath, baseName, fromGit, sha, parse, inAnatomicalRegion, materialMaps, raster,
  inNose, nosePixels, views, scale, width, height, headY, raw };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [output, candidate = assetPath] = process.argv.slice(2);
  if (!output) throw Error("Supply a directory for the proof image");
  const cell=219, cellH=Math.round(164*cell/134), gutter=14, margin=25;
  const card=2*cell+6, W=2*margin+card*3+gutter*2, H=163+2*(cellH+100);
  const elements=[], layers=[];
  function label(x,y,content,size=17,weight=400,color="#30383C") {
    elements.push(`<text x="${x}" y="${y}" fill="${color}" font-family="Malgun Gothic, sans-serif" font-size="${size}" font-weight="${weight}">${content}</text>`);
  }
  label(margin,44,"16차와 17차의 변경 영역",33,700);
  label(margin,79,"각 GLB의 색상·발광 텍스처와 정점 법선을 같은 고정광으로 렌더해, RGB 한 채널이라도 다른 픽셀을 셌습니다.",18);
  label(margin,109,"왼쪽은 17차 진단 렌더와 사전 지정한 코 경계입니다. 오른쪽의 주황색은 바뀐 픽셀, 검정은 동일한 픽셀입니다.",16);
  const report={base:revision,fullFrame:[width,height],tiers:{}};
  let totalOutside=0;
  for (const [row,tier] of ["pc","phone"].entries()) {
    const suffix=tier==="pc"?"":"_phone", filename=baseName+"buddha"+suffix+".glb";
    const before=parse(fromGit(filename)), after=parse(await fs.readFile(path.join(candidate,filename)));
    const result=audit(before,after);
    const bodhi=baseName+"bodhisattva"+suffix+".glb";
    const bodhiBytes=await fs.readFile(path.join(assetPath,bodhi));
    assert.ok(bodhiBytes.equals(fromGit(bodhi)), "Bodhisattva changed");
    const beforeMaps=materialMaps(before), afterMaps=materialMaps(after);
    result.sha256={before:before.sha256,after:after.sha256,bodhisattva:sha(bodhiBytes)};
    result.views={};
    for (const [col,view] of views.entries()) {
      const a=raster(before,view,beforeMaps), b=raster(after,view,afterMaps), diff=Buffer.alloc(a.length);
      let changed=0, outside=0;
      for (let i=0;i<width*height;i++) {
        const k=3*i;
        if (a[k]===b[k] && a[k+1]===b[k+1] && a[k+2]===b[k+2]) continue;
        changed++;
        if (!inNose(i%width,Math.floor(i/width),view)) outside++;
        diff[k]=255;diff[k+1]=122;diff[k+2]=54;
      }
      const stats={changed,outside,outsideTested:width*height-nosePixels(view),identical:width*height-changed};
      result.views[view.key]=stats;
      assert.ok(changed, tier+" "+view.key+" shows no nasal revision");
      totalOutside+=outside;
      console.log(tier,view.key,stats);
      const x=margin+col*(card+gutter), y=167+row*(cellH+100);
      label(x,y-9,(row?"폰":"PC")+"   ·   "+view.label,21,700);
      const crop={left:view.headX*scale,top:headY*scale,width:134*scale,height:164*scale};
      const portrait=await sharp(b,{raw}).extract(crop).resize(cell,cellH).png().toBuffer();
      const changes=await sharp(diff,{raw}).extract(crop).resize(cell,cellH,{kernel:"nearest"}).png().toBuffer();
      layers.push({input:portrait,left:x,top:y},{input:changes,left:x+cell+6,top:y});
      const poly=view.mask.map(([px,py])=>(x+px*cell/134)+","+(y+py*cellH/164)).join(" ");
      elements.push(`<polygon points="${poly}" fill="none" stroke="#135e6b" stroke-width="1.5"/>`);
      label(x,y+cellH+27,`변경 ${changed.toLocaleString("en-US")} px   ·   코 밖 ${outside.toLocaleString("en-US")} px`,18,600);
    }
    report.tiers[tier]=result;
  }
  label(margin,H-15,`각 화면 ${width} × ${height} px 전체를 검사했습니다. 그림은 머리 부분을 확대한 것입니다.`,16);
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${elements.join("")}</svg>`);
  console.log(JSON.stringify(report,null,2));
  assert.equal(totalOutside,0,"RGB changes outside fixed nose outlines");
  await fs.mkdir(output,{recursive:true});
  await sharp({create:{width:W,height:H,channels:3,background:"#f5f3ec"}})
    .composite([...layers,{input:svg,left:0,top:0}]).png().toFile(path.join(output,"p16-vs-p17-diff.png"));
}
