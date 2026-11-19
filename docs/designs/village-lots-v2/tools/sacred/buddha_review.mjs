/** node buddha_review.mjs <reference-dir> <studio-dir> <IoU-dir> <sheet-dir> [landmark-readings.json]
 * All samples, photographs and contact sheets are written outside the repo.
 * Coordinates are in reference-panel pixels. The optional readings file has
 * {front:{brow:[x,y],eye:[x,y],nose:[x,y],mouth:[x,y],chin:[x,y]},left:{...}}.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [refs,studio,metrics,out,readings] = process.argv.slice(2);
if (!out) throw Error("Expected reference, studio, IoU and output directories");
const reg = JSON.parse(await fs.readFile(path.join(refs,"calibration.json")));
const iou = JSON.parse(await fs.readFile(path.join(metrics,"iou.json")));
const notes = readings ? JSON.parse(await fs.readFile(readings)) : null;
const round = n => Math.round(n*1000)/1000;
const background = "#a79b97", page = "#f7f4ee", ink = "#302b28";
const labels = ["정면","왼쪽을 향한 측면","뒷면","오른쪽을 향한 측면","윗면","밑면"];
const views = ["front","left","back","right","top","bottom"];
const target = {
  front:{brow:[195.25,92.5],eye:[195.25,109],nose:[195.5,127],mouth:[195.5,142.25],chin:[195.5,170.5]},
  left:{brow:[183.5,92.25],eye:[185,107.5],nose:[167.5,127],mouth:[177,140.5],chin:[209,168.5]},
};
const boxes = { front:[128,12,134,165], left:[148,12,150,165] };
const file = (directory,view) => path.join(directory,view+".png");
const svg = (w,h,items) => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+items+'</svg>');
const txt = (x,y,value,size=18,weight=400) => '<text x="'+x+'" y="'+y+'" fill="'+ink+'" font-family="Malgun Gothic, Arial, sans-serif" font-size="'+size+'" font-weight="'+weight+'">'+value+'</text>';
const layer = (input,left,top) => ({input,left,top});
const image = (w,h,color=page) => sharp({create:{width:w,height:h,channels:3,background:color}});
await fs.mkdir(out,{recursive:true});

async function head(view) {
  const [x,y,w,h] = boxes[view], zoom = 3, width=w*zoom, height=h*zoom;
  async function crop(directory,isModel) {
    const source = sharp(file(directory,view));
    const size = await source.metadata(), factor = size.width/reg.width;
    if (Math.abs(size.height/reg.height-factor) > .00001) throw Error("Invalid registered portrait");
    const plate = source.extract({left:x*factor,top:y*factor,width:w*factor,height:h*factor}).resize(width,height);
    return (isModel ? plate.flatten({background}) : plate).removeAlpha().raw().toBuffer();
  }
  const reference = await crop(refs,false), current = await crop(studio,true);
  const blended = Buffer.alloc(reference.length);
  for (let i=0; i<blended.length; i++) blended[i] = Math.round(.5*reference[i]+.5*current[i]);
  const encode = (buffer) => sharp(buffer,{raw:{width,height,channels:3}}).png().toBuffer();
  const margin=16, gap=12, fullWidth=3*width+2*gap+2*margin, fullHeight=height+99;
  let caption=txt(margin,35,view==="front"?"얼굴 정면 비교":"얼굴 측면 비교",26,600);
  const images=[];
  for (const [n,data] of [reference,blended,current].entries()) {
    const left=margin+n*(width+gap);
    caption+=txt(left,70,["기준 사진","기준 사진 50% + 모델 50%","게임 모델"][n],17);
    images.push(layer(await encode(data),left,82));
  }
  await image(fullWidth,fullHeight).composite([...images,layer(svg(fullWidth,fullHeight,caption),0,0)]).png()
    .toFile(path.join(out,"head-"+(view==="front"?"front":"profile")+"-overlay.png"));

  // Parallel plates, with ticks in the same pixel coordinate system, for
  // independent manual identification of chin, highlights and pigment lines.
  let axes="";
  for (let i=x+2; i<x+w; i++) if (i%10===0) {
    const u=(i-x)*zoom;
    axes+='<path d="M'+u+' 19v'+(height-19)+'" stroke="white" opacity=".17"/>'+txt(u+2,12,i,9);
  }
  for (let j=y+2; j<y+h; j++) if (j%10===0) {
    const v=(j-y)*zoom;
    axes+='<path d="M17 '+v+'h'+(width-17)+'" stroke="white" opacity=".17"/>'+txt(1,v-1,j,9);
  }
  const guide=svg(width,height,axes);
  await image(2*width+gap,height).composite([
    layer(await encode(reference),0,0),layer(guide,0,0),
    layer(await encode(current),width+gap,0),layer(guide,width+gap,0)]).png().toFile(path.join(metrics,view+"-reading-grid.png"));
}

async function sheet() {
  const pw=335, ph=445, margin=22, gap=10, header=98, dh=ph+51;
  const W=6*pw+2*margin+5*gap, H=header+2*dh;
  let caption=txt(margin,42,"본존불 여섯 방향 비교",30,600);
  caption+=txt(margin,74,"각 방향에서 기준 사진과 PC용 게임 모델의 직교 렌더를 비교했습니다.",17);
  const layers=[];
  for (const [i,view] of views.entries()) for (const [k,dir] of [refs,studio].entries()) {
    const source=sharp(file(dir,view)), {width,height}=await source.metadata();
    const position=i<4 ? [4/384,0,376/384,1] : [100/768,0,568/768,1];
    const rect={left:Math.round(position[0]*width),top:0,width:Math.round(position[2]*width),height};
    const card=await source.extract(rect).flatten({background}).resize(pw,ph,{fit:"contain",background}).png().toBuffer();
    const x=margin+((i%3)*2+k)*(pw+gap), y=header+Math.floor(i/3)*dh;
    caption+=txt(x,y+17,labels[i]+"  ·  "+(k?"게임 모델":"기준 사진"),17,k?600:400);
    layers.push(layer(card,x,y+27));
  }
  await image(W,H).composite([...layers,layer(svg(W,H,caption),0,0)]).png().toFile(path.join(out,"six-view-comparison.png"));
}

async function aspect(directory,view,chin) {
  const pixels=await sharp(path.join(directory,view+"-mask.png")).greyscale().raw().toBuffer();
  const [x0,y0,x1,y1]=reg[view].headBox;
  let crown=Infinity, lo=Infinity, hi=-Infinity;
  // Both infra-aural margins and the broadest part of the cranium sit
  // above row 153. Lower rows can include a fingertip or the robe on the
  // shoulder, which would inflate the anatomical width or depth.
  for (let y=y0;y<Math.min(y1,153);y++) for(let x=x0;x<x1;x++) {
    if (pixels[y*reg.width+x] < 128) continue;
    crown=Math.min(crown,y); lo=Math.min(lo,x); hi=Math.max(hi,x);
  }
  return {crownRow:crown,chinRow:chin,heightPx:chin-crown,widthPx:hi-lo+1,
    heightToWidth:round((chin-crown)/(hi-lo+1)),widthToHeight:round((hi-lo+1)/(chin-crown))};
}

const landmarks = {modelSha256:iou.modelSha256,units:"panel pixels, x-right/y-down; offsets normalized by reference crown-to-chin height",
  precision:"Visual readings from registered images. Typical point reading uncertainty about 1 reference pixel and about 1.5 pixels at the chin-to-neck transition. Ratio widths use the unscaled masks.",
  definitions:{brow:"midpoint of bilateral brow crests in front, visible crest in profile",
    eye:"midpoint of lashes in front, visible lash midpoint in profile",nose:"anterior tip of the nose",
    mouth:"lip seam at front centre or anterior profile",chin:"inferior chin where it meets neck",
    ratio:"crown-to-chin height / whole head width including the ears"},views:{}};
const renderedIou={modelSha256:iou.modelSha256,method:"Blender Cycles film alpha, box averaged to 384 x 570, threshold 0.5, compared with background-colour reference mask",views:{}};
for (const view of ["front","left"]) {
  await head(view);
  const source=sharp(file(studio,view)), info=await source.metadata();
  if (info.width!==2*reg.width || info.height!==2*reg.height || !info.hasAlpha) throw Error("Expected a double-resolution RGBA studio render");
  const alpha=await source.extractChannel("alpha").raw().toBuffer();
  const mask=await sharp(path.join(refs,view+"-mask.png")).greyscale().raw().toBuffer();
  const result={};
  for (const [scope,roi] of [["whole",[0,0,reg.width,reg.height]],["head",reg[view].headBox]]) {
    let intersection=0, union=0;
    for (let y=roi[1];y<roi[3];y++) for(let x=roi[0];x<roi[2];x++) {
      if (scope==="head" && view==="left" && y>=157 && x<145) continue;
      const i=y*reg.width+x, j=2*y*info.width+2*x;
      const model=alpha[j]+alpha[j+1]+alpha[j+info.width]+alpha[j+info.width+1]>=510;
      const reference=mask[i]>=128;
      intersection+=Number(model && reference); union+=Number(model || reference);
    }
    result[scope]={iou:intersection/union,intersection,union};
  }
  renderedIou.views[view]=result;
  if (!notes) continue;
  const reference=await aspect(refs,view,target[view].chin[1]);
  const model=await aspect(metrics,view,notes[view].chin[1]);
  const ratioDeviation=100*(model.heightPx/model.widthPx-reference.heightPx/reference.widthPx)/(reference.heightPx/reference.widthPx);
  const widthHeightDeviation=(model.widthPx/model.heightPx)/(reference.widthPx/reference.heightPx)-1;
  const record={reference,model,heightToWidthRelativeDeviationPct:round(ratioDeviation),
    widthToHeightRelativeDeviationPct:round(100*widthHeightDeviation),
    widthDeviationPctHeadHeight:round(100*(model.widthPx-reference.widthPx)/reference.heightPx),
    heightDeviationPctHeadHeight:round(100*(model.heightPx-reference.heightPx)/reference.heightPx),points:{}};
  for (const [key,[x,y]] of Object.entries(target[view])) {
    const [mx,my]=notes[view][key];
    record.points[key]={ref:[x,y],model:[mx,my],dxPct:round(100*(mx-x)/reference.heightPx),
      dyPct:round(100*(my-y)/reference.heightPx),distancePct:round(100*Math.hypot(mx-x,my-y)/reference.heightPx)};
  }
  landmarks.views[view]=record;
}
await fs.writeFile(path.join(metrics,"render-iou.json"),JSON.stringify(renderedIou,null,2)+"\n");
if (notes) await fs.writeFile(path.join(out,"landmarks.json"),JSON.stringify(landmarks,null,2)+"\n");
if ((await fs.readdir(studio)).includes("bottom.png")) await sheet();
