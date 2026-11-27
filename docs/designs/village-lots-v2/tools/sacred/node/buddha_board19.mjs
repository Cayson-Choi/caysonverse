/**
 * node buddha_board19.mjs REVIEW_ARCHIVE P19_RENDER OUTPUT_DIR
 * REVIEW_ARCHIVE contains the original face17, face17-work, face18 and face19 folders.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

sharp.concurrency(1);
const [archive, render, output] = process.argv.slice(2);
if (!output) throw Error("Supply review archive, candidate render and output directory");
const previousBoard = await fs.readFile(path.join(archive, "face18", "nose-pairs.png"));
const originalCrops = path.join(archive, "face19");
const originalCollage = path.join(originalCrops, "owner-nose-closeup.png");
const staging = path.join(output, "analysis", "buddha_panels");
const stageBoard = path.join(staging, "nose-pairs.png");
const board18 = fileURLToPath(new URL("./buddha_board18.mjs", import.meta.url));
assert.equal(createHash("sha256").update(previousBoard).digest("hex"),
  "82d2c17676714710bd11fd8b9a28329746e37924db61f967afeada7e78556dd3");

// The original board builder is also the canonical camera-registration sampler.
// It verifies the baseline against all four archived panels before writing a render.
execFileSync(process.execPath, [board18, path.join(archive, "face17", "nose-pairs.png"),
  path.join(archive, "face17-work", "final"), render, staging], {windowsHide:true});
await fs.mkdir(output, {recursive:true});
const rect = (left, top, width, height) => ({left, top, width, height});
const crop = (image, box) => sharp(image).extract(box).png().toBuffer();
const label = (x, y, text, size, weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}">${text}</text>`;
const svg = (width, height, body, paper = "#f5f1e9") => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
  `<rect width="100%" height="100%" fill="${paper}"/><g fill="#302a23" font-family="Malgun Gothic,sans-serif">${body}</g></svg>`);

// Copy the complete archived PC column into the middle column. The other four
// rows, their captions, and the reference samples keep precisely the pass-18 layout.
const {width, height} = await sharp(previousBoard).metadata();
const titleStrip = svg(width, 51, [
  label(24,43,"원본 사진",24,700), label(794,43,"18차",24,700), label(1564,43,"19차",24,700)
].join(""));
const middle = await crop(previousBoard, rect(1564, 146, 756, height-146));
const finalBoard = await sharp(stageBoard).composite([
  {input:titleStrip,left:0,top:53}, {input:middle,left:794,top:146},
]).png().toBuffer();
await fs.writeFile(path.join(output, "nose-pairs.png"), finalBoard);

// Pixel-center fits of the owner's 556×326 and 290×276 native screenshots
// against pass 18. Panel-local source coordinate = origin + step × screenshot pixel.
const ownerViews = [
  {name:"정면", key:"front", panel:rect(1564,149,756,810),
    original:rect(10,50,598,420), previous:rect(628,50,716,420),
    native:[556,326], origin:[122.3565,423.8095], step:[1.00025,1.0015]},
  {name:"측면", key:"side", panel:rect(1606,1011,672,720),
    original:rect(10,490,382,420), previous:rect(412,490,441,420),
    native:[290,276], origin:[72.50175,351.59055], step:[.99945,1.000025]},
];
async function registeredOwner(board, spec) {
  const src = await sharp(board).extract(spec.panel).removeAlpha().raw().toBuffer();
  const [w,h] = spec.native, stride = 3*spec.panel.width, out = Buffer.alloc(3*w*h);
  for (let j=0; j<h; j++) {
    const y = spec.origin[1]+j*spec.step[1], iy = Math.floor(y), fy = y-iy;
    for (let i=0; i<w; i++) {
      const x = spec.origin[0]+i*spec.step[0], ix = Math.floor(x), fx = x-ix;
      const a = iy*stride+3*ix;
      for (let c=0; c<3; c++) {
        const r = a+c;
        out[3*(j*w+i)+c] = Math.round((1-fy)*((1-fx)*src[r]+fx*src[r+3]) +
          fy*((1-fx)*src[r+stride]+fx*src[r+stride+3]));
      }
    }
  }
  return out;
}
const ownerW = 2122, ownerH = 986, columns = [22,644,1384];
const headings = ["원본", "18차", "19차"];
const labels = headings.map((text,i)=>label(columns[i],43,text,30,700));
const layers = [], registration = {};
for (const [row,view] of ownerViews.entries()) {
  const [w,h] = view.native, {width:pw,height:ph} = view.previous;
  const baseline = await registeredOwner(previousBoard,view);
  const targetFile = path.join(originalCrops, "o-p18-"+view.key+".png");
  const target = await sharp(targetFile).removeAlpha().raw().toBuffer();
  assert.equal(baseline.length,target.length);
  const squareError = baseline.reduce((sum,v,i)=>sum+(v-target[i])**2,0)/target.length;
  registration[view.key] = {native:view.native, origin:view.origin, step:view.step,
    rgbRms:Math.sqrt(squareError)};
  assert.ok(squareError<1, "Pass-18 registration failed for "+view.key);
  const pixels = await registeredOwner(finalBoard,view);
  const candidate = await sharp(pixels,{raw:{width:w,height:h,channels:3}})
    .resize(pw,ph,{fit:"fill"}).png().toBuffer();
  const images = [await crop(originalCollage,view.original), await crop(originalCollage,view.previous), candidate];
  const top = row ? 544 : 77;
  labels.push(label(columns[0],top-7,view.name,18));
  images.forEach((input,i)=>layers.push({input,left:columns[i],top}));
}
await sharp(svg(ownerW,ownerH,labels.join(""))).composite(layers).png().toFile(path.join(output,"owner-crops.png"));
await fs.writeFile(path.join(staging,"buddha_owner_registration.json"),JSON.stringify(registration,null,2)+"\n");
console.log(JSON.stringify(registration));
