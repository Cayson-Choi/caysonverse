/** node .../buddha_proof20.mjs EVIDENCE_DIRECTORY [CANDIDATE_GLB_DIRECTORY] */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  assetPath, baseName, fromGit, sha, parse, materialMaps, raster,
  views, scale, width, height, headY, raw,
} from "./buddha_proof17.mjs";

const [output, candidate = assetPath] = process.argv.slice(2);
if (!output) throw Error("Supply a directory for the comparison");
const baseline = "7e08b6df";
const evidence = {baseline, fullFrame: [width, height], tiers: {}};
const millimetres = ([x, y, z]) => [(x + .004) * 1000, (y - 1.595) * 1000, z * 1000];

// Physical limits read from the approved casting, independent of the sculpt
// weights. The diagonal separates the sidewall from the more anterior lobule.
function inAlarWall(x, y, z) {
  const u = Math.abs(x), s = (u - z + 38.5) * Math.SQRT1_2;
  const upperWing = y > -5 && s > -24;
  // The dark streak at the cheek junction is posterior to the short naris.
  // Its low return may change shading, but its geometry must remain exact.
  const rearReturn = y > -13 && s > 7;
  return u > 14 && u < 58 && y < 33 && z > 39 && z < 85 && s < 33 && (upperWing || rearReturn);
}
const locked = {
  tip(x, y, z) {return Math.abs(x) <= 14 && z > 75 && y >= -22 && y < 30;},
  bridge(x, y, z) {return Math.abs(x) < 21 && z > 57 && y >= 34 && y < 125;},
  naris(x, y, z) {
    const u = Math.abs(x), s = (u - z + 38.5) * Math.SQRT1_2;
    return u > 18 && u < 34 && z > 53 && z < 75 && y > -14 && y <= -5.8 && Math.abs(s) < 7;
  },
};

function audit(before, after) {
  for (const field of ["nodes", "scenes", "scene", "meshes", "accessors", "materials", "textures",
    "samplers", "images", "extensionsUsed", "extensionsRequired"]) {
    assert.deepEqual(after.doc[field], before.doc[field], field + " changed");
  }
  assert.equal(before.doc.meshes[0].primitives.length, 1);
  assert.equal(before.doc.materials.length, 1);
  assert.equal(before.doc.materials[0].name, "Main Buddha gold leaf");
  assert.equal(before.images.length, 4);
  const atlasHashes = {};
  before.images.forEach((bytes, i) => {
    assert.ok(bytes.equals(after.images[i]), before.doc.images[i].name + " changed");
    atlasHashes[before.doc.images[i].name] = sha(bytes);
  });
  assert.equal(before.triangles.size, after.triangles.size);
  for (const [key, face] of before.triangles)
    assert.deepEqual(after.triangles.get(key), face, "Triangle, winding or material changed");

  const p = before.attributes.POSITION;
  const count = p.length / 3;
  const coordinates = [], eligible = new Uint8Array(count);
  const changed = new Set(), counts = {}, rearChanges = {}, locks = {};
  const bounds = {absoluteX: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity]};
  for (const name of Object.keys(locked)) locks[name] = {vertices: 0, changed: 0};
  for (let i = 0; i < count; i++) {
    const xyz = millimetres(p.subarray(3*i, 3*i+3));
    coordinates.push(xyz);
    eligible[i] = before.attributes.TEXCOORD_0[2*i] > .5 && inAlarWall(...xyz);
  }
  for (const [name, a] of Object.entries(before.attributes)) {
    const b = after.attributes[name], lanes = a.length / count;
    counts[name] = 0;
    rearChanges[name] = 0;
    for (let i = 0; i < count; i++) {
      let equal = true;
      for (let k = 0; k < lanes; k++) equal &&= Object.is(a[i*lanes+k], b[i*lanes+k]);
      if (equal) continue;
      assert.ok(eligible[i], `${name} changed outside an ala at vertex ${i}, baseline mm ${coordinates[i]}`);
      if (coordinates[i][1] <= -5) {
        assert.ok(name === "TEXCOORD_0" || name === "TEXCOORD_1", "Lower alar base surface changed");
        rearChanges[name]++;
      }
      changed.add(i);
      counts[name]++;
    }
  }
  for (let i = 0; i < count; i++) {
    if (before.attributes.TEXCOORD_0[i*2] <= .5) continue;
    const xyz = coordinates[i];
    for (const [name, test] of Object.entries(locked)) {
      if (test(...xyz)) {
        locks[name].vertices++;
        if (changed.has(i)) locks[name].changed++;
      }
    }
    if (changed.has(i)) {
      [bounds.absoluteX, bounds.y, bounds.z].forEach((r, k) => {
        const v = k === 0 ? Math.abs(xyz[0]) : xyz[k];
        r[0] = Math.min(r[0], v);
        r[1] = Math.max(r[1], v);
      });
    }
  }
  for (const [name, stats] of Object.entries(locks)) {
    assert.ok(stats.vertices > 0 && !stats.changed, name + " lock failed");
  }
  const allowedCount = eligible.reduce((a,b) => a+b, 0);
  return {eligible, coordinates, stats: {vertices: count, triangles: before.triangles.size,
    alarVerticesChecked: allowedCount, nonAlarVerticesChecked: count-allowedCount,
    nonAlarVerticesChanged: 0, changedVertices: changed.size, changedAttributes: counts, rearReturnChanges: rearChanges,
    changedSourceMm: changed.size ? bounds : null, lockedGroups: locks, atlasHashes}};
}

// Use the same camera, depth test and order as the fixed-light RGB render.
// The support map is a second visibility pass, independent of RGB differences.
// Each visible fragment is classified using barycentric pass-19 coordinates.
// A shared triangle may interpolate an alar change past the last alar vertex.
function surfaceMap(model, input, view) {
  const p = model.attributes.POSITION, [ax, az] = view.axis;
  const inv = 1 / Math.hypot(1, .068), xy = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i+1], z = p[i+2], out = ax*x + az*z;
    xy[i] = scale * (view.origin + 265 * (az*x - ax*z));
    xy[i+1] = scale * (551.5 - 265 * (y - .068*out) * inv);
    xy[i+2] = out + .068*y;
  }
  // Includes the entire face and the surrounding empty space. Changes anywhere
  // outside this rectangle are still discovered by the two full-frame renders.
  const left = view.headX*scale, top = headY*scale, w = 134*scale, h = 164*scale;
  const depths = new Float64Array(w*h).fill(-Infinity);
  const support = new Uint8Array(w*h), landmark = new Uint8Array(w*h);
  const keys = Array.from(model.triangles.keys()).sort((a,b) => a-b);
  for (const key of keys) {
    const {ids} = model.triangles.get(key), [a,b,c] = ids, ai=a*3, bi=b*3, ci=c*3;
    const x0=xy[ai], y0=xy[ai+1], dx=xy[bi]-x0, dy=xy[bi+1]-y0;
    const ex=xy[ci]-x0, ey=xy[ci+1]-y0, det=dx*ey-dy*ex;
    if (Math.abs(det) < 1e-10) continue;
    const xlo = Math.max(left, Math.ceil(Math.min(x0,xy[bi],xy[ci])-.5));
    const xhi = Math.min(left+w-1, Math.floor(Math.max(x0,xy[bi],xy[ci])-.5));
    const ylo = Math.max(top, Math.ceil(Math.min(y0,xy[bi+1],xy[ci+1])-.5));
    const yhi = Math.min(top+h-1, Math.floor(Math.max(y0,xy[bi+1],xy[ci+1])-.5));
    if (xhi < xlo || yhi < ylo) continue;
    const hasWing = ids.some(i => input.eligible[i]);
    const isFace = ids.every(i => model.attributes.TEXCOORD_0[2*i] > .5);
    const [pa,pb,pc] = ids.map(i => input.coordinates[i]);
    for (let y = ylo; y <= yhi; y++) for (let x = xlo; x <= xhi; x++) {
      const fx=x+.5-x0, fy=y+.5-y0, wb=(fx*ey-fy*ex)/det, wc=(dx*fy-dy*fx)/det, wa=1-wb-wc;
      if (wa < 0 || wb < 0 || wc < 0) continue;
      const i = (y-top)*w+x-left, d = wa*xy[ai+2]+wb*xy[bi+2]+wc*xy[ci+2];
      if (d <= depths[i]) continue;
      depths[i] = d;
      support[i] = 0;
      landmark[i] = 0;
      if (!isFace) continue;
      const px=wa*pa[0]+wb*pb[0]+wc*pc[0], py=wa*pa[1]+wb*pb[1]+wc*pc[1], pz=wa*pa[2]+wb*pb[2]+wc*pc[2];
      if (hasWing) support[i] = inAlarWall(px,py,pz) ? 1 : 2;
      if (locked.tip(px,py,pz)) landmark[i] = 1;
      else if (locked.bridge(px,py,pz)) landmark[i] = 2;
      else if (locked.naris(px,py,pz)) landmark[i] = 3;
    }
  }
  return {left,top,w,h,support,landmark};
}

function compare(a,b,ma,mb) {
  const delta = Buffer.alloc(a.length);
  const stats = {changed: 0, wing: 0, sharedBoundary: 0, sharedBoundaryMaximum: 0,
    maximumBoundaryPixel: null,
    outside: 0, outsideTested: 0, protectedPixels: {}};
  const groupNames = ["","tip","bridge","naris"];
  for (const name of groupNames.slice(1)) stats.protectedPixels[name]={tested:0, changed:0, maxChannelDifference:0};
  for (let i=0; i<width*height; i++) {
    const x = i%width-ma.left, y=Math.floor(i/width)-ma.top;
    const j = y*ma.w+x, inHead = x>=0 && y>=0 && x<ma.w && y<ma.h;
    const sa = inHead ? ma.support[j] : 0, sb = inHead ? mb.support[j] : 0;
    const wing = sa===1 || sb===1, boundary = !wing && (sa===2 || sb===2);
    if (!wing && !boundary) stats.outsideTested++;
    const k=3*i, d=Math.max(Math.abs(a[k]-b[k]),Math.abs(a[k+1]-b[k+1]),Math.abs(a[k+2]-b[k+2]));
    // Take the union of the two visible landmark masks. A newly occluded
    // tip, bridge or opening must also pass the original RGB comparison.
    const beforeLandmark=inHead ? ma.landmark[j] : 0, afterLandmark=inHead ? mb.landmark[j] : 0;
    if (beforeLandmark || afterLandmark) {
      const zones = beforeLandmark===afterLandmark ? [beforeLandmark] : [beforeLandmark,afterLandmark];
      for (const zone of zones) {
        if (!zone) continue;
        const record=stats.protectedPixels[groupNames[zone]];
        record.tested++;
        if (d) record.changed++;
        record.maxChannelDifference=Math.max(d,record.maxChannelDifference);
      }
    }
    if (!d) continue;
    stats.changed++;
    if (wing) {stats.wing++; delta.set([255,143,59],k);}
    else if (boundary) {
      stats.sharedBoundary++;
      if (d > stats.sharedBoundaryMaximum) {
        stats.sharedBoundaryMaximum=d;
        stats.maximumBoundaryPixel=[x+ma.left, y+ma.top];
      }
      delta.set([91,196,194],k);
    } else {stats.outside++; delta.set([255,50,160],k);}
  }
  assert.equal(stats.outside,0,"Changed RGB outside bilateral alar surface and its shared edges");
  return {delta,stats};
}

// Continuous front edge of the cast in the calibrated profile cameras.
// Test at 1/32 of a photographic pixel across the upper and lower nose.
function profileEdge(model, side) {
  const p=model.attributes.POSITION, inv=1/Math.hypot(1,.068), rows=32*(139-98);
  const edge=new Float64Array(rows).fill(-Infinity);
  const X=new Float64Array(p.length/3), Y=new Float64Array(X.length);
  for (let i=0; i<X.length; i++) {
    X[i]=265*p[3*i+2]; Y[i]=551.5-265*(p[3*i+1]-.068*side*p[3*i])*inv;
  }
  for (const {ids} of model.triangles.values()) for (let k=0;k<3;k++) {
    const a=ids[k], b=ids[(k+1)%3];
    const lo=Math.max(0,Math.ceil((Math.min(Y[a],Y[b])-98)*32-.5));
    const hi=Math.min(rows,Math.ceil((Math.max(Y[a],Y[b])-98)*32-.5));
    for (let j=lo; j<hi; j++) {
      const y=98+(j+.5)/32, x=X[a]+(y-Y[a])*(X[b]-X[a])/(Y[b]-Y[a]);
      edge[j]=Math.max(edge[j],x);
    }
  }
  assert.ok(edge.every(Number.isFinite));
  return edge;
}

const W=1390, H=1060, columns=[30,484,938], layers=[], labels=[];
function label(x,y,text,size=18,weight=400) {
  labels.push(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}">${text}</text>`);
}
async function panel(image, left, top, box, w, h, diagnostic=false) {
  const input=await sharp(image,{raw}).extract(box).resize(w,h,{fit:"fill",kernel:diagnostic?"nearest":"lanczos3"}).png().toBuffer();
  layers.push({input,left,top});
}
label(30,48,"본존불 19차와 20차  ·  콧방울 변경 영역",34,700);
label(30,82,"두 배포 GLB를 같은 카메라와 고정광으로 그려, RGB 한 채널이라도 바뀐 픽셀을 표시했습니다.",19);
label(30,108,"주황은 콧방울, 청록은 콧방울과 주변을 잇는 삼각형의 보간부, 검정은 동일한 RGB입니다.",18);
const names=["정면","왼쪽을 향한 측면","오른쪽을 향한 측면"];
for (const [row,tier] of ["pc","phone"].entries()) {
  const suffix = tier==="pc" ? "" : "_phone";
  const file=baseName+"buddha"+suffix+".glb", bodhi=baseName+"bodhisattva"+suffix+".glb";
  const before=parse(fromGit(file,baseline)), after=parse(await fs.readFile(path.join(candidate,file)));
  const other=await fs.readFile(path.join(assetPath,bodhi));
  assert.ok(other.equals(fromGit(bodhi,baseline)),"Bodhisattva changed");
  const input=audit(before,after), stats=input.stats;
  stats.sha256={before:before.sha256,after:after.sha256,bodhisattva:sha(other)};
  stats.views={};
  evidence.tiers[tier]=stats;
  const oldMaps=materialMaps(before), newMaps=materialMaps(after);
  for (const [column,view] of views.entries()) {
    const a=raster(before,view,oldMaps), b=raster(after,view,newMaps);
    const {delta,stats:changes}=compare(a,b,surfaceMap(before,input,view),surfaceMap(after,input,view));
    if (column) {
      const original=profileEdge(before,view.axis[0]), current=profileEdge(after,view.axis[0]);
      changes.maximumSilhouetteChangeReferencePx=Math.max(...original.map((v,i)=>Math.abs(v-current[i])));
      assert.equal(changes.maximumSilhouetteChangeReferencePx,0,tier+" "+view.key+" profile moved");
    }
    for (const [zone,record] of Object.entries(changes.protectedPixels)) {
      assert.ok(record.tested>0 && record.changed===0,tier+" "+view.key+" changed fixed "+zone+" pixels");
    }
    stats.views[view.key]=changes;
    const x=columns[column], y=166+row*408;
    label(x,y-14,(row?"휴대폰":"PC")+"  ·  "+names[column],22,700);
    const face={left:view.headX*scale,top:headY*scale,width:134*scale,height:164*scale};
    await panel(b,x,y,face,170,208);
    await panel(delta,x+179,y,face,170,208,true);
    const centers=[196,173.5,222], nose={left:Math.floor((centers[column]-21)*scale),top:117*scale,width:42*scale,height:24*scale};
    await panel(b,x,y+216,nose,170,97);
    await panel(delta,x+179,y+216,nose,170,97,true);
    label(x,y+339,`콧방울 ${changes.wing.toLocaleString("en-US")} px  ·  경계 보간 ${changes.sharedBoundary.toLocaleString("en-US")} px`,17,600);
    label(x,y+364,`나머지 영역 변경 ${changes.outside} px`,17);
  }
}
const results=Object.values(evidence.tiers);
const allViews=results.flatMap(x=>Object.values(x.views));
assert.ok(results.every(t=>t.changedVertices>0) && allViews.every(v=>v.changed>0),"No alar revision");
const total=allViews.reduce((n,v)=>n+v.outsideTested,0);
label(30,981,`콧방울과 경계 삼각형 밖 ${total.toLocaleString("en-US")}픽셀 중 변경 0개`,25,700);
label(30,1014,"각 시점에서 불상 전체 1,152 × 1,710 px를 검사했습니다. 위는 얼굴 전체, 아래는 같은 정면·측면의 코 확대입니다.",17);
label(30,1040,"정면·양쪽 측면의 코끝·콧대·콧구멍 중심 RGB도 모두 일치합니다. 두 기기에서 측면 코 윤곽의 최대 이동은 0 px입니다.",17);
await fs.mkdir(path.join(output,"analysis"),{recursive:true});
await fs.writeFile(path.join(output,"analysis","buddha_proof20.json"),JSON.stringify(evidence,null,2)+"\n");
const paper=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f5f1e9"/><g fill="#302a23" font-family="Malgun Gothic,sans-serif">${labels.join("")}</g></svg>`);
await sharp(paper).composite(layers).png().toFile(path.join(output,"p19-vs-p20-diff.png"));
console.log(JSON.stringify(evidence,null,2));
