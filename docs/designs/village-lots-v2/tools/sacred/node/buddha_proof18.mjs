/** From root: node .../buddha_proof18.mjs OUTPUT [CANDIDATE_GLB_DIR] [EVIDENCE_JSON] */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  assetPath, baseName, fromGit, sha, parse, inAnatomicalRegion, materialMaps, raster,
  inNose, nosePixels, views, scale, width, height, headY, raw,
} from "./buddha_proof17.mjs";

const revision = "d310359b";
const [output, candidate = assetPath, evidenceFile] = process.argv.slice(2);
if (!output) throw Error("Supply a directory for the comparison");
const auditSize = width * height;

// The previous review traced the two alar edges at x = 185.1 and 206.6
// on its unregistered 265 px/metre grid. Intersect the old surface with
// each vertical plane and transport those exact barycentric points onto
// the new triangles. Include the full height of both wings.
function alarMargins(before,after) {
  const {POSITION:p,TEXCOORD_0:uv}=before.attributes, q=after.attributes.POSITION;
  return [185.1,206.6].map(cut=>{
    const x=(cut-197)/265;
    let samples=0, maxHorizontalShift=0;
    for (const {ids} of before.triangles.values()) {
      if (ids.some(i=>uv[2*i]<=.5)) continue;
      for (let j=0; j<3; j++) {
        const a=3*ids[j], b=3*ids[(j+1)%3];
        if ((p[a]>x)===(p[b]>x)) continue;
        const t=(x-p[a])/(p[b]-p[a]);
        const y=p[a+1]+t*(p[b+1]-p[a+1]), z=p[a+2]+t*(p[b+2]-p[a+2]);
        if (y<1.573 || y>1.636 || z<.035) continue;
        const dx=(1-t)*(q[a]-p[a])+t*(q[b]-p[b]);
        maxHorizontalShift=Math.max(maxHorizontalShift,Math.abs(dx)*265);
        samples++;
      }
    }
    assert.ok(samples);
    return {oldX:cut,intersectedEdges:samples,maxHorizontalShiftPx:maxHorizontalShift};
  });
}

function audit(before, after) {
  const a = before.doc, b = after.doc;
  for (const key of ["nodes", "scenes", "scene"]) assert.deepEqual(b[key], a[key], key);
  const face = a.meshes[0].primitives[0].material;
  const skin = a.materials[face];
  // Includes normal, roughness/metalness, AO, base colour and emissive factors.
  assert.deepEqual(b.materials[face], skin);
  const imageHashes = {};
  for (const slot of [skin.pbrMetallicRoughness.baseColorTexture, skin.emissiveTexture,
    skin.normalTexture, skin.occlusionTexture, skin.pbrMetallicRoughness.metallicRoughnessTexture]) {
    const index = slot.index, texture = a.textures[index];
    assert.deepEqual(b.textures[index], texture);
    assert.deepEqual(b.samplers[texture.sampler], a.samplers[texture.sampler]);
    const source = texture.extensions.KHR_texture_basisu.source;
    assert.ok(after.images[source].equals(before.images[source]), a.images[source].name);
    imageHashes[a.images[source].name] = sha(after.images[source]);
  }
  assert.equal(after.triangles.size, before.triangles.size);
  let reassigned = 0;
  for (const [key, tri] of before.triangles) {
    const now = after.triangles.get(key);
    assert.ok(now, "Missing triangle or changed winding");
    assert.equal(now.material, face, "The nose and face must use one gilt material");
    if (tri.material === face) continue;
    assert.ok(tri.ids.every(i => inAnatomicalRegion(before.attributes, i)));
    reassigned++;
  }
  const count = before.attributes.POSITION.length / 3;
  const changedAttributes = {};
  const changed = new Set();
  for (const [attr, oldArray] of Object.entries(before.attributes)) {
    const newArray = after.attributes[attr], lanes = oldArray.length / count;
    assert.equal(oldArray.length, newArray.length, attr);
    let edits = 0;
    for (let i = 0; i < count; i++) {
      let diff = false;
      for (let k = 0; k < lanes; k++) {
        if (!Object.is(newArray[lanes*i+k], oldArray[lanes*i+k])) diff = true;
      }
      if (!diff) continue;
      assert.ok(inAnatomicalRegion(before.attributes, i), attr+" changed outside the nose");
      edits++;
      changed.add(i);
    }
    changedAttributes[attr] = edits;
  }
  return {vertices:count, triangles:after.triangles.size, sameFaceMaterial:skin.name,
    imageHashes, reassignedNoseTriangles:reassigned, changedVertices:changed.size,
    changedVerticesOutsideNose:0, changedAttributes,alarMargins:alarMargins(before,after),
    vertexColourPresent:Object.hasOwn(after.attributes, "COLOR_0")};
}

// An independent orthographic coverage test at 1/16 reference pixel. Union
// every projected triangle, with no dependency on normals, textures or lighting.
const sampling = 16;
const profileCrop = {left:0, top:85, width:35, height:46};
const profileWidth = sampling*profileCrop.width, profileHeight = sampling*profileCrop.height;
function coverage(model, view) {
  const xLeft = view.headX + (view.key === "left" ? profileCrop.left : 131.5-profileCrop.width);
  const yTop = headY + profileCrop.top;
  const p = model.attributes.POSITION;
  const xs = new Float64Array(p.length/3), ys = new Float64Array(xs.length);
  const tilt = .068, inv = 1/Math.hypot(1, tilt), side = view.axis[0];
  for (let i=0; i<xs.length; i++) {
    const x=p[3*i], y=p[3*i+1], z=p[3*i+2];
    xs[i] = sampling*(view.origin-265*side*z-xLeft);
    ys[i] = sampling*(551.5-265*(y-tilt*side*x)*inv-yTop);
  }
  const mask = new Uint8Array(profileWidth*profileHeight);
  for (const {ids} of model.triangles.values()) {
    const [a,b,c] = ids;
    if (Math.max(xs[a],xs[b],xs[c])<0 || Math.min(xs[a],xs[b],xs[c])>=profileWidth) continue;
    const start = Math.max(0, Math.ceil(Math.min(ys[a],ys[b],ys[c])-.5));
    const end = Math.min(profileHeight, Math.ceil(Math.max(ys[a],ys[b],ys[c])-.5));
    for (let row=start; row<end; row++) {
      const y = row+.5;
      let min = Infinity, max = -Infinity;
      for (let j=0; j<3; j++) {
        const v=ids[j], w=ids[(j+1)%3];
        if ((ys[v]>y)===(ys[w]>y)) continue;
        const x = xs[v]+(y-ys[v])*(xs[w]-xs[v])/(ys[w]-ys[v]);
        min=Math.min(min,x); max=Math.max(max,x);
      }
      const left=Math.max(0,Math.ceil(min-.5)), right=Math.min(profileWidth,Math.ceil(max-.5));
      if (left<right) mask.fill(1,row*profileWidth+left,row*profileWidth+right);
    }
  }
  return mask;
}

function boundary(mask) {
  const contour=[];
  for (let y=1; y<profileHeight-1; y++) for (let x=1; x<profileWidth-1; x++) {
    const i=y*profileWidth+x;
    if (mask[i] && (!mask[i-1] || !mask[i+1] || !mask[i-profileWidth] || !mask[i+profileWidth]))
      contour.push([x,y]);
  }
  assert.ok(contour.length>profileHeight, "Expected the full bridge, tip and underside");
  return contour;
}

function directedDistance(a,b) {
  let maxSquared=0;
  for (const [x,y] of a) {
    let minSquared=Infinity;
    for (const [s,t] of b) {
      minSquared=Math.min(minSquared,(s-x)**2+(t-y)**2);
      if (minSquared<=maxSquared) break;
    }
    maxSquared=Math.max(maxSquared,minSquared);
  }
  return Math.sqrt(maxSquared)/sampling;
}

async function profileProof(before,after,view) {
  const a=coverage(before,view), b=coverage(after,view);
  const aEdge=boundary(a), bEdge=boundary(b);
  const xor=a.reduce((n,p,i)=>n+Number(p!==b[i]),0);
  const delta=xor ? Math.max(directedDistance(aEdge,bEdge), directedDistance(bEdge,aEdge)) : 0;
  const overlay=Buffer.alloc(3*a.length);
  for (let i=0;i<a.length;i++) {
    const shade=b[i]?42:22;
    overlay.fill(shade,3*i,3*i+3);
  }
  const aSet=new Set(aEdge.map(([x,y])=>y*profileWidth+x));
  const bSet=new Set(bEdge.map(([x,y])=>y*profileWidth+x));
  for (const i of new Set([...aSet,...bSet])) {
    const rgb=aSet.has(i) && bSet.has(i) ? [140,235,210] : aSet.has(i) ? [238,103,146] : [255,179,72];
    // A three-sample line stays legible when the 16× overlay is downsampled.
    for (const j of [i-1,i,i+1,i-profileWidth,i+profileWidth]) overlay.set(rgb,3*j);
  }
  const image=await sharp(overlay,{raw:{width:profileWidth,height:profileHeight,channels:3}})
    .resize(146,192,{fit:"fill"}).png().toBuffer();
  return {image,stats:{sampling,coveredSubpixelsChanged:xor,oldContourSamples:aEdge.length,
    newContourSamples:bEdge.length,maxDisplacementReferencePx:delta}};
}

const margin=28, card=460, gap=16, portraitWidth=226, portraitHeight=277;
const W=margin*2+3*card+gap*2, H=1150;
const labels=[], layers=[];
function label(x,y,value,size=18,weight=400) {
  labels.push(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}">${value}</text>`);
}
label(margin,48,"본존불 17차 · 18차 변경 영역",34,700);
label(margin,85,"두 GLB를 같은 고정광으로 렌더했습니다. 청록선은 사전에 지정한 코 영역, 주황색은 RGB 값이 달라진 픽셀입니다.");
const report={baseline:revision,fullFrame:[width,height],tiers:{}};
for (const [row,tier] of ["pc","phone"].entries()) {
  const suffix=tier==="pc"?"":"_phone", filename=baseName+"buddha"+suffix+".glb";
  const before=parse(fromGit(filename,revision));
  const after=parse(await fs.readFile(path.join(candidate,filename)));
  const bodhi=baseName+"bodhisattva"+suffix+".glb";
  const bodhiBytes=await fs.readFile(path.join(assetPath,bodhi));
  assert.ok(bodhiBytes.equals(fromGit(bodhi,revision)), "Bodhisattva changed");
  const result=audit(before,after);
  result.sha256={before:before.sha256,after:after.sha256,bodhisattva:sha(bodhiBytes)};
  result.views={};
  report.tiers[tier]=result;
  const beforeMaps=materialMaps(before), afterMaps=materialMaps(after);
  for (const [col,view] of views.entries()) {
    const a=raster(before,view,beforeMaps), b=raster(after,view,afterMaps);
    const diff=Buffer.alloc(b.length);
    let changed=0, outside=0;
    const outsideSamples=[];
    for (let i=0; i<auditSize; i++) {
      const k=3*i;
      if (a[k]===b[k] && a[k+1]===b[k+1] && a[k+2]===b[k+2]) continue;
      changed++;
      const x=i%width, y=Math.floor(i/width), inside=inNose(x,y,view);
      if (!inside) {
        outside++;
        if (outsideSamples.length<10) outsideSamples.push({x,y,old:[...a.subarray(k,k+3)],new:[...b.subarray(k,k+3)]});
      }
      diff.set(inside?[255,131,58]:[255,45,135],k);
    }
    assert.ok(changed, tier+" "+view.key+" shows no nasal revision");
    const stats={changed,outside,outsideTested:auditSize-nosePixels(view),outsideSamples};
    result.views[view.key]=stats;
    const x=margin+col*(card+gap), y=134+row*355;
    label(x,y-10,(row?"폰":"PC")+"  ·  "+view.label,22,700);
    const crop={left:view.headX*scale,top:headY*scale,width:134*scale,height:164*scale};
    for (const [i,buffer] of [b,diff].entries()) {
      const kernel=i?"nearest":"lanczos3";
      const input=await sharp(buffer,{raw}).extract(crop).resize(portraitWidth,portraitHeight,{kernel}).png().toBuffer();
      layers.push({input,top:y,left:x+i*(portraitWidth+6)});
    }
    const polygon=view.mask.map(([s,t])=>(x+s*portraitWidth/134)+","+(y+t*portraitHeight/164)).join(" ");
    labels.push(`<polygon points="${polygon}" fill="none" stroke="#127778" stroke-width="1.6"/>`);
    label(x,y+portraitHeight+27,`변경 ${changed.toLocaleString("en-US")} px   ·   코 밖 ${outside} px`,18,600);
    if (col>0) {
      const {stats:profile,image}=await profileProof(before,after,view);
      stats.profile=profile;
      const cx=margin+((col-1)+2*row)*350;
      layers.push({input:image,left:cx,top:903});
      label(cx+155,965,(row?"폰":"PC")+"  ·  "+(col===1?"좌측면":"우측면"),19,700);
      label(cx+155,997,`최대 ${profile.maxDisplacementReferencePx.toFixed(2)} px`,17);
    }
  }
}
label(margin,856,"측면 윤곽 중첩",26,700);
label(margin,886,"원본 1px를 16등분해 양쪽 윤곽을 겹쳤습니다. 일치는 민트색, 17차만 있는 곳은 분홍색, 18차만 있는 곳은 주황색입니다.",17);
label(margin,H-20,`각 RGB 검사는 불상 전체 ${width} × ${height} px를 비교했습니다. 위에는 머리를 확대해 표시했습니다.`,16);
console.log(JSON.stringify(report,null,2));
if (evidenceFile) await fs.writeFile(evidenceFile,JSON.stringify(report,null,2)+"\n");
for (const [tier,result] of Object.entries(report.tiers)) {
  for (const [view,stats] of Object.entries(result.views)) {
    assert.equal(stats.outside,0,tier+" "+view+" RGB outside fixed outline");
    if (stats.profile) assert.ok(stats.profile.maxDisplacementReferencePx<=.5,tier+" "+view+" exceeds 0.5 px");
  }
}
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g fill="#292e2d" font-family="Malgun Gothic,sans-serif">${labels.join("")}</g></svg>`);
await fs.mkdir(output,{recursive:true});
await sharp({create:{width:W,height:H,channels:3,background:"#f5f1e9"}})
  .composite([...layers,{input:svg,left:0,top:0}]).png().toFile(path.join(output,"p17-vs-p18-diff.png"));
