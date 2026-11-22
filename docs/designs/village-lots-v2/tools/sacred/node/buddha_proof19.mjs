/** node buddha_proof19.mjs OUTPUT_DIR [CANDIDATE_GLB_DIR] */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  assetPath, baseName, fromGit, sha, parse, inAnatomicalRegion, materialMaps,
  raster, inNose, nosePixels, views, scale, width, height, headY, raw,
} from "./buddha_proof17.mjs";

const [output, candidate=assetPath] = process.argv.slice(2);
if (!output) throw Error("Supply a directory for the evidence");
const revision = "9aafa326";
const report = {baseline:revision,fullFrame:[width,height],tiers:{}};
const layers = [], text = [];
const label = (x,y,v,sz=18,bold=400) => text.push(
  `<text x="${x}" y="${y}" font-size="${sz}" font-weight="${bold}">${v}</text>`);
const W=1470, H=1030, margin=27, spacing=475, portraitWidth=225, portraitHeight=275;
label(margin,46,"본존불 18차 · 19차 차이",33,700);
label(margin,82,"같은 카메라와 고정광으로 두 게임 모델의 RGB를 비교했습니다. 주황색은 달라진 픽셀, 청록선은 18차 검증에 사용한 코 경계입니다.");

function audit(a,b) {
  for (const key of ["nodes","scenes","scene","meshes","materials","textures","samplers","images"])
    assert.deepEqual(b.doc[key],a.doc[key],key);
  for (const [index,image] of a.images.entries()) assert.ok(image.equals(b.images[index]),"Changed photographic atlas");
  assert.equal(a.doc.materials.length,1);
  assert.equal(a.doc.meshes[0].primitives.length,1);
  assert.equal(a.doc.materials[0].name,"Main Buddha gold leaf");
  assert.equal(b.triangles.size,a.triangles.size);
  for (const key of a.triangles.keys()) assert.ok(b.triangles.has(key),"Triangle or winding changed");
  const count = a.attributes.POSITION.length/3, points=new Set(), changes={};
  let minY=Infinity, maxY=-Infinity;
  for (const [name, before] of Object.entries(a.attributes)) {
    const after=b.attributes[name], lanes=before.length/count;
    assert.equal(after.length,before.length,name);
    let n=0;
    for (let i=0;i<count;i++) {
      let changed=false;
      for (let k=0;k<lanes;k++) if (!Object.is(before[i*lanes+k],after[i*lanes+k])) changed=true;
      if (!changed) continue;
      const y=a.attributes.POSITION[3*i+1];
      assert.ok(inAnatomicalRegion(a.attributes,i) && y<=1.640,
        name+" changed outside the lower nose at vertex "+i);
      minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      points.add(i); n++;
    }
    changes[name]=n;
  }
  return {vertices:count,triangles:a.triangles.size,material:a.doc.materials[0].name,
    changedAttributes:changes,changedVertices:points.size,lockedVerticesChanged:0,
    changedSourceYMetres:[minY,maxY],imageHashes:Object.fromEntries(a.doc.images.map((im,i)=>[im.name,sha(a.images[i])]))};
}

// At each horizontal cut, the foremost point of a projected triangle is on its
// edge. Intersect all actual edges to measure the profile without shading or masks.
const sampling=32, topY=98, endY=140, profileRows=(endY-topY)*sampling;
function profile(model, side) {
  const p=model.attributes.POSITION, inv=1/Math.hypot(1,.068);
  const x=new Float64Array(p.length/3), y=new Float64Array(x.length);
  for (let i=0;i<x.length;i++) {
    x[i]=265*p[3*i+2];
    y[i]=551.5-265*(p[3*i+1]-.068*side*p[3*i])*inv;
  }
  const edge=new Float64Array(profileRows).fill(-Infinity);
  for (const {ids} of model.triangles.values()) for (let i=0;i<3;i++) {
    const a=ids[i], b=ids[(i+1)%3];
    const start=Math.max(0,Math.ceil((Math.min(y[a],y[b])-topY)*sampling-.5));
    const end=Math.min(profileRows,Math.ceil((Math.max(y[a],y[b])-topY)*sampling-.5));
    for (let j=start;j<end;j++) {
      const at=topY+(j+.5)/sampling;
      const xx=x[a]+(at-y[a])*(x[b]-x[a])/(y[b]-y[a]);
      edge[j]=Math.max(edge[j],xx);
    }
  }
  assert.ok(edge.every(Number.isFinite));
  return edge;
}
function profileStats(old,next,side) {
  const a=profile(old,side), b=profile(next,side);
  let max=0, top=Infinity, bottom=-Infinity, peak=NaN, upperMax=0;
  for (let i=0;i<profileRows;i++) {
    const delta=Math.abs(a[i]-b[i]), y=topY+(i+.5)/sampling;
    if (y<119) upperMax=Math.max(upperMax,delta);
    if (delta<=1e-8) continue;
    top=Math.min(top,y); bottom=Math.max(bottom,y);
    if (delta>max) {max=delta; peak=y;}
  }
  return {samplingPerReferencePx:sampling,checkedY:[topY,endY],changedY:max?[top,bottom]:[],
    maxHorizontalDisplacementReferencePx:max,upperMaxBeforeY119:upperMax,peakY:max?peak:null};
}

await fs.mkdir(path.join(output,"analysis"),{recursive:true});
for (const [row,tier] of ["pc","phone"].entries()) {
  const suffix=tier==="pc"?"":"_phone", file=baseName+"buddha"+suffix+".glb";
  const a=parse(fromGit(file,revision)), b=parse(await fs.readFile(path.join(candidate,file)));
  const bodhi=baseName+"bodhisattva"+suffix+".glb", other=await fs.readFile(path.join(assetPath,bodhi));
  assert.ok(other.equals(fromGit(bodhi,revision)),"Bodhisattva model changed");
  const result=audit(a,b);
  result.sha256={before:a.sha256,after:b.sha256,bodhisattva:sha(other)};
  report.tiers[tier]=result;
  const am=materialMaps(a), bm=materialMaps(b); result.views={};
  for (const [col,view] of views.entries()) {
    const aa=raster(a,view,am), bb=raster(b,view,bm), delta=Buffer.alloc(aa.length);
    const stats={changed:0,outside:0,outsideTested:width*height-nosePixels(view),outsideSamples:[],
      upperBeforeY120:{changed:0,maxChannelDifference:0}};
    if (view.key==="front") stats.bridge={originalPhotoBounds:[190,98,202,120],changed:0,maxChannelDifference:0};
    for (let i=0;i<width*height;i++) {
      const k=3*i;
      if (aa[k]===bb[k] && aa[k+1]===bb[k+1] && aa[k+2]===bb[k+2]) continue;
      const x=i%width,y=Math.floor(i/width),inside=inNose(x,y,view);
      const xx=(x+.5)/scale, yy=(y+.5)/scale;
      if (yy<120) {
        const magnitude=Math.max(...[0,1,2].map(c=>Math.abs(aa[k+c]-bb[k+c])));
        stats.upperBeforeY120.changed++;
        stats.upperBeforeY120.maxChannelDifference=Math.max(stats.upperBeforeY120.maxChannelDifference,magnitude);
        if (stats.bridge && xx>=190 && xx<202 && yy>=98) {
          stats.bridge.changed++;
          stats.bridge.maxChannelDifference=Math.max(stats.bridge.maxChannelDifference,magnitude);
        }
      }
      stats.changed++;
      if (!inside) {
        stats.outside++;
        if (stats.outsideSamples.length<12) stats.outsideSamples.push([x,y]);
      }
      delta.set(inside?[255,131,58]:[255,45,135],k);
    }
    if (col) stats.profile=profileStats(a,b,view.axis[0]);
    result.views[view.key]=stats;
    const x=margin+col*spacing,y=135+row*380;
    label(x,y-12,(row?"휴대폰":"PC")+"  ·  "+view.label,21,700);
    const box={left:view.headX*scale,top:headY*scale,width:134*scale,height:164*scale};
    for (const [i,im] of [bb,delta].entries()) {
      const input=await sharp(im,{raw}).extract(box).resize(portraitWidth,portraitHeight,{kernel:i?"nearest":"lanczos3"})
        .png().toBuffer();
      layers.push({input,left:x+i*(portraitWidth+6),top:y});
    }
    const poly=view.mask.map(([s,t])=>(x+s*portraitWidth/134)+","+(y+t*portraitHeight/164)).join(" ");
    text.push(`<polygon points="${poly}" fill="none" stroke="#147778" stroke-width="1.5"/>`);
    label(x,y+portraitHeight+27,`변경 ${stats.changed.toLocaleString("en-US")} px   ·   코 밖 ${stats.outside} px`,18,600);
    if (col) label(x,y+portraitHeight+51,"외곽 최대 수평 이동 "+stats.profile.maxHorizontalDisplacementReferencePx.toFixed(2)+" px",16);
  }
}
const tiers=Object.values(report.tiers);
const outside=tiers.flatMap(t=>Object.values(t.views)).reduce((sum,v)=>sum+v.outside,0);
const tested=tiers.flatMap(t=>Object.values(t.views)).reduce((sum,v)=>sum+v.outsideTested,0);
label(margin,909,"코 밖 "+tested.toLocaleString("en-US")+"픽셀 중 변경 "+outside+"개",27,700);
label(margin,947,"각 검사는 불상 전체 "+width+" × "+height+" px를 비교했습니다. 위에는 머리 부분을 확대했습니다.",18);
label(margin,979,"PC와 휴대폰에서 코 밖 정점 및 두 협시보살 GLB도 18차와 일치합니다. 측면 이동은 원본 사진의 픽셀 단위입니다.",18);
await fs.writeFile(path.join(output,"analysis","buddha_final_proof.json"),JSON.stringify(report,null,2)+"\n");
const overlay=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g fill="#302a23" font-family="Malgun Gothic,sans-serif">${text.join("")}</g></svg>`);
await sharp({create:{width:W,height:H,channels:3,background:"#f5f1e9"}})
  .composite([...layers,{input:overlay,top:0,left:0}]).png().toFile(path.join(output,"p18-vs-p19-diff.png"));
assert.equal(outside,0,"RGB changed outside fixed nose boundaries");
assert.ok(tiers.every(t=>Object.values(t.views).every(v=>v.changed>0)),"No lower-nose revision in a required view");
console.log(JSON.stringify(report,null,2));
