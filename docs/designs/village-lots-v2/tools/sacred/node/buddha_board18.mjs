/** node .../buddha_board18.mjs PASS17_BOARD PASS17_FRAMES PASS18_FRAMES OUTPUT_DIR */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [board, beforeDir, afterDir, output] = process.argv.slice(2);
if (!output) throw Error("Supply the pass-17 comparison, both render directories and output directory");
sharp.concurrency(1);
const sha = b => createHash("sha256").update(b).digest("hex");
const oldBoard = await fs.readFile(board);
assert.equal(sha(oldBoard),"893eee410424032ee5eba2b3c41e4506dbc67a7be5884893a1f0316371b6fec1",
  "Expected the owner's pass-17 comparison image");
const manifest = async dir => JSON.parse((await fs.readFile(path.join(dir,"render.json"),"utf8")).replace(/^\uFEFF/,""));
const before = await manifest(beforeDir), after = await manifest(afterDir);
assert.equal(before.sha256,"fc60b8967c5ad827e18a151262c6a5ac2dcb308c49b9e1f441c4b12541b98674");
assert.equal(after.sha256,sha(await fs.readFile(after.model)),"Candidate render belongs to another model");
assert.deepEqual(after.frames,before.frames);
assert.equal(before.scale,8);
assert.equal(after.scale,before.scale);

// Fixed 17th-pass pupil/chin registration in the original photograph pixel system.
const registration = {
  front:{ref:[196.12011419126338,108.89939538181166],model:[195.82814395942916,108.65280539188187],scale:.9919544340073664},
  left:{ref:[569.0622755548725,108.07777330914251],model:[568.6474687480413,109.46649657778491],scale:.993294419715006},
  right:{ref:[1363.272280361039,107.7625766375115],model:[1363.8002335203992,109.5742462606064],scale:.9920241018349292},
};
const paper="#f5f1e9", background=[169,156,152], pad=24, gap=14;
const oldWidth=672, oldHeight=720;
const frontWidth=756, frontHeight=810; // 18 display px per reference px. Profiles retain 16:1.
const pageWidth=2*pad+3*frontWidth+2*gap;
const rows=[
  {view:"front", name:"정면", box:[175,97,42,45], oldY:149, w:frontWidth,h:frontHeight},
  {view:"left", name:"왼쪽을 향한 측면", box:[544,97,42,45], oldY:921, w:oldWidth,h:oldHeight},
  {view:"right", name:"오른쪽을 향한 측면", box:[1349,97,42,45], oldY:1693, w:oldWidth,h:oldHeight},
];
const ownerScale=[1.000133,1.000399];
const ownerBox=[546+(1156.134-1133+.5-.5*ownerScale[0])/8,
  88+(848.223-708+.5-.5*ownerScale[1])/8,150*ownerScale[0]/8,248*ownerScale[1]/8];

async function source(dir,view) {
  const {info,data}=await sharp(path.join(dir,view+".png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {size,topLeft}=before.frames[view];
  assert.deepEqual([info.width,info.height,info.channels],[size[0]*8,size[1]*8,4]);
  return {info,data,topLeft};
}

function registeredCrop(frame,view,box,width,height) {
  const reg=registration[view], {topLeft,info,data}=frame, rgb=Buffer.alloc(3*width*height);
  function toRender(value,axis) {
    return ((value-reg.ref[axis])/reg.scale+reg.model[axis]-topLeft[axis])*8-.5;
  }
  for (let j=0;j<height;j++) {
    const y=toRender(box[1]+(j+.5)*box[3]/height,1), iy=Math.floor(y), b=y-iy;
    for (let i=0;i<width;i++) {
      const x=toRender(box[0]+(i+.5)*box[2]/width,0), ix=Math.floor(x), a=x-ix;
      assert.ok(ix>=0 && iy>=0 && ix+1<info.width && iy+1<info.height);
      const offset=4*(iy*info.width+ix);
      const at=[offset,offset+4,offset+4*info.width,offset+4*info.width+4];
      const weights=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b];
      for (let c=0;c<3;c++) {
        let sum=0;
        for (let k=0;k<4;k++) {
          const alpha=data[at[k]+3]/255;
          sum+=weights[k]*(alpha*data[at[k]+c]+(1-alpha)*background[c]);
        }
        rgb[3*(j*width+i)+c]=Math.round(sum);
      }
    }
  }
  return rgb;
}

const layers=[],labels=[];
function label(x,y,value,size=20,weight=400) {
  labels.push(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}">${value}</text>`);
}
function cellLeft(i,w) {return pad+i*(frontWidth+gap)+Math.floor((frontWidth-w)/2);}
function oldCell(column,top,w=oldWidth,h=oldHeight) {
  return sharp(oldBoard).extract({left:24+column*(oldWidth+14)+Math.floor((oldWidth-w)/2),top,width:w,height:h});
}
function nativeCrop(frame,view,box,w,h) {
  return sharp(registeredCrop(frame,view,box,w,h),{raw:{width:w,height:h,channels:3}});
}
label(pad,48,"본존불 코 비교",34,700);
["원본 사진","17차","18차"].forEach((title,i)=>label(cellLeft(i,frontWidth),96,title,24,700));
let top=112;
for (const {view,name,box,oldY,w,h} of rows) {
  label(pad,top+26,name+"  ·  원본 1px당 "+(w/42)+"px",19);
  top+=37;
  const old=await source(beforeDir,view), current=await source(afterDir,view);
  const expected=await oldCell(2,oldY).removeAlpha().raw().toBuffer();
  const reproduced=registeredCrop(old,view,box,oldWidth,oldHeight);
  assert.ok(reproduced.equals(expected),"Pass-17 camera or registered crop changed in "+view);
  for (const [i,original] of [0,2].entries()) {
    const input=await oldCell(original,oldY).resize(w,h,{fit:"fill"}).png().toBuffer();
    layers.push({input,left:cellLeft(i,w),top});
  }
  // All columns start with the same 16:1 sample grid, including the enlarged front row.
  const input=await nativeCrop(current,view,box,oldWidth,oldHeight).resize(w,h,{fit:"fill"}).png().toBuffer();
  layers.push({input,left:cellLeft(2,w),top});
  top+=h+15;
}
label(pad,top+31,"소유자 확대 크롭  ·  첨부한 측면 사진과 동일한 프레이밍",20,600);
top+=47;
for (const [i,[column,w]] of [[0,349],[2,362]].entries()) {
  const input=await oldCell(column,2475,w,600).png().toBuffer();
  layers.push({input,left:cellLeft(i,w),top});
}
const ownerCrop=async dir=>nativeCrop(await source(dir,"left"),"left",ownerBox,150,248)
  .resize(362,600,{fit:"fill"}).removeAlpha().raw().toBuffer();
assert.ok((await ownerCrop(beforeDir)).equals(await oldCell(2,2475,362,600).removeAlpha().raw().toBuffer()),
  "Pass-17 owner crop did not reproduce");
layers.push({input:await sharp(await ownerCrop(afterDir),{raw:{width:362,height:600,channels:3}}).png().toBuffer(),
  left:cellLeft(2,362),top});
const H=top+600+pad;
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${H}"><rect width="100%" height="100%" fill="${paper}"/><g fill="#302a23" font-family="Malgun Gothic,sans-serif">${labels.join("")}</g></svg>`);
await fs.mkdir(output,{recursive:true});
await sharp(svg).composite(layers).png().toFile(path.join(output,"nose-pairs.png"));
console.log("All four pass-17 panels reproduced pixel-for-pixel.",after.sha256,pageWidth,H);
