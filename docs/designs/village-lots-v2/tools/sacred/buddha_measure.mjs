/** Fixed orthographic registration for the owner's 1536 × 1024 turnaround.
 * node buddha_measure.mjs prepare <reference.webp> <calibration-dir>
 * node buddha_measure.mjs measure <model.glb> <calibration-dir> <result-dir>
 * The GLB geometry is rasterized at the reference pixel centres, without fitting
 * its bounds or independently scaling its head. All derived imagery stays local.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

const require = createRequire(new URL("./node/package.json", import.meta.url));
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const W = 384, H = 570;
const calibration = {
  pixelsPerMetre: 265, groundRow: 551.5, pitchTangent: 0.068, width: W, height: H,
  front: { originX: 197, sourceX: 0, headBox: [134, 14, 254, 172],
    alignmentPoints: {crown:[194,22],chin:[195.5,170.5],robeShoulder:[243,171],knee:[78,375],footRim:[197,562]} },
  left: { originX: 192, sourceX: 384, headBox: [120, 14, 301, 169],
    alignmentPoints: {crown:[228,22],chin:[209,168.5],robeShoulder:[243,171],knee:[90,374],footRim:[185,562]} },
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function prepare(file, output) {
  await fs.mkdir(output, { recursive: true });
  const input = await fs.readFile(file);
  const info = await sharp(input).metadata();
  if (info.width !== 1536 || info.height !== 1024) throw Error("Unexpected reference sheet dimensions");
  await fs.writeFile(path.join(output, "calibration.json"), JSON.stringify({ ...calibration, referenceSha256: sha(input) }, null, 2));
  for (const [index, name] of ["front", "left", "back", "right", "top", "bottom"].entries()) {
    const panel = index < 4 ? { left: 384 * index, top: 0, width: W, height: H }
      : { left: (index-4)*768, top: 575, width: 768, height: 449 };
    const image = await sharp(input).extract(panel).removeAlpha().raw().toBuffer();
    await sharp(image, { raw: { width: panel.width, height: panel.height, channels: 3 } })
      .png().toFile(path.join(output, name + ".png"));
    if (!(name in calibration)) continue;
    // The backdrop and its shadow are desaturated rose-grey. The gilt has
    // strong red-blue separation or bright speculars. Only the crown has
    // neutral charcoal. Exclude the white panel dividers on either edge.
    const mask = Buffer.alloc(W*H);
    for (let y = 0; y < H; y++) for (let x = 4; x < W-4; x++) {
      const i = y*W+x;
      const r = image[i*3], b = image[i*3+2];
      const inHair = y < 157 && x > 130 && x < 294;
      mask[i] = +(r-b > 49 || r > 222 || (inHair && r < 126));
    }
    // Discard isolated compression specks. Enclosed negative spaces in the
    // hand and around the torso remain open.
    const seen = Buffer.alloc(mask.length);
    let largest = [];
    for (let p = 0; p < mask.length; p++) if (mask[p] && !seen[p]) {
      const queue = [p];
      seen[p] = 1;
      for (let j = 0; j < queue.length; j++) for (const q of [queue[j]-1,queue[j]+1,queue[j]-W,queue[j]+W]) {
        if (mask[q] && !seen[q]) { seen[q] = 1; queue.push(q); }
      }
      if (queue.length > largest.length) largest = queue;
    }
    mask.fill(0);
    for (const i of largest) mask[i] = 255;
    // Reflections between dark curls can have the same RGB as the backdrop.
    // Fill only enclosed head holes above the ears. Preserve gaps between
    // fingers, arms and torso, which are genuine background.
    for (let y = 22; y < 95; y++) {
      const row = mask.subarray(y*W,(y+1)*W);
      const a = row.indexOf(255), b = row.lastIndexOf(255);
      if (a >= 0) row.fill(255,a,b+1);
    }
    await sharp(mask, {raw:{width:W,height:H,channels:1}}).png().toFile(path.join(output, name+"-mask.png"));
  }
}

function raster(vertices, indexes, view) {
  const mask = Buffer.alloc(W*H);
  const u = [], v = [];
  const { pitchTangent: t, pixelsPerMetre: scale, groundRow } = calibration;
  for (const [x, z, depth] of vertices) {
    const y = -depth; // glTF Y-up to Blender Z-up
    u.push(calibration[view].originX + scale*(view === "front" ? x : y));
    v.push(groundRow-scale*(z+t*(view === "front" ? y : -x))/Math.hypot(1,t));
  }
  for (let k = 0; k < indexes.length; k += 3) {
    const tri = [indexes[k], indexes[k+1], indexes[k+2]];
    const ys = tri.map(i => v[i]);
    const first = Math.max(0, Math.ceil(Math.min(...ys)-0.5));
    const end = Math.min(H, Math.ceil(Math.max(...ys)-0.5));
    for (let row = first; row < end; row++) {
      const y = row + .5, crossings = [];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e+1)%3];
        if ((v[a] > y) !== (v[b] > y)) crossings.push(u[a]+(y-v[a])*(u[b]-u[a])/(v[b]-v[a]));
      }
      if (crossings.length !== 2) continue;
      const left = Math.max(0, Math.ceil(Math.min(...crossings)-.5));
      const right = Math.min(W, Math.ceil(Math.max(...crossings)-.5));
      if (left < right) mask.fill(1,row*W+left,row*W+right);
    }
  }
  return mask;
}

async function measure(file, refs, out) {
  await fs.mkdir(out, {recursive:true});
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"meshopt.decoder":MeshoptDecoder});
  const doc = await io.read(file);
  const vertices = [], indexes = [];
  for (const n of doc.getRoot().listNodes()) for (const p of n.getMesh()?.listPrimitives() ?? []) {
    const pos = p.getAttribute("POSITION");
    if (p.getMode() !== 4 || !p.getIndices() || !pos) throw Error("Expected indexed triangles");
    const matrix = n.getWorldMatrix(), offset = vertices.length;
    for (let i = 0; i < pos.getCount(); i++) {
      const [x,y,z] = pos.getElement(i,[]);
      vertices.push([0,1,2].map(c => matrix[c]*x+matrix[4+c]*y+matrix[8+c]*z+matrix[12+c]));
    }
    for (const i of p.getIndices().getArray()) indexes.push(i+offset);
  }
  if (!indexes.length) throw Error("No geometry");
  const results = { model: path.basename(file), modelSha256:sha(await fs.readFile(file)), triangles:indexes.length/3 };
  for (const view of ["front","left"]) {
    const ref = await sharp(path.join(refs,view+"-mask.png")).greyscale().raw().toBuffer();
    const model = raster(vertices,indexes,view);
    const diff = Buffer.alloc(W*H*3);
    for (let i=0; i<model.length; i++) {
      const a = +!!ref[i], b = model[i];
      const color = a && b ? [182,181,172] : a ? [35,169,205] : b ? [230,83,67] : [28,28,31];
      for (let c=0; c<3; c++) diff[i*3+c] = color[c];
    }
    await sharp(diff,{raw:{width:W,height:H,channels:3}}).png().toFile(path.join(out,view+"-difference.png"));
    await sharp(model.map(v=>v*255),{raw:{width:W,height:H,channels:1}}).png().toFile(path.join(out,view+"-mask.png"));
    results[view] = {};
    for (const [scope,box] of [["whole",[0,0,W,H]], ["head",calibration[view].headBox]]) {
      let intersection=0, union=0, refArea=0, modelArea=0;
      for (let y=box[1]; y<box[3]; y++) for (let x=box[0]; x<box[2]; x++) {
        // In the profile the raised gold fingertip enters the rectangular
        // crop at the lower left, below the head. Exclude it in both images.
        if (scope === "head" && view === "left" && y >= 157 && x < 145) continue;
        const i=y*W+x, a=+!!ref[i], b=model[i];
        intersection += a & b; union += a | b; refArea += a; modelArea += b;
      }
      results[view][scope] = { iou:intersection/union,intersection,union,refArea,modelArea,box };
    }
  }
  await fs.writeFile(path.join(out,"iou.json"),JSON.stringify(results,null,2)+"\n");
  console.log(JSON.stringify(results));
}

const [action,...args] = process.argv.slice(2);
if (action === "prepare" && args.length === 2) await prepare(...args);
else if (action === "measure" && args.length === 3) await measure(...args);
else throw Error("See usage at the top of buddha_measure.mjs");
