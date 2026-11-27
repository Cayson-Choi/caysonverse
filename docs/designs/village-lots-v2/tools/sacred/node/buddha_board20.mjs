/** node buddha_board20.mjs REVIEW_ARCHIVE CANDIDATE_RENDER OUTPUT_DIR */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

sharp.concurrency(1);
const [archive, render, output] = process.argv.slice(2);
if (!output) throw Error("Supply the review archive, model render and output directory");
const ownerFiles = path.join(archive, "face20");
const previous = await fs.readFile(path.join(ownerFiles, "p19-owner-crops.png"));
const circled = await fs.readFile(path.join(ownerFiles, "owner-circled-p19.png"));
const hash = input => createHash("sha256").update(input).digest("hex");
assert.equal(hash(previous), "1a3686e752628dcd8dce79fd96b6865c07c82bd7107c2c5658802ce464eba9e8");
assert.equal(hash(circled), "5c2c563586f2b7e101bdf93c734a8f756953999a08322c406dd484ec60d3a3d5");
const manifest = JSON.parse((await fs.readFile(path.join(render, "render.json"), "utf8")).replace(/^\uFEFF/, ""));
assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
const stage = path.join(archive, "face20-work", "buddha_board20", manifest.sha256);
const sampler = fileURLToPath(new URL("./buddha_board19.mjs", import.meta.url));
execFileSync(process.execPath, [sampler, archive, render, stage], {windowsHide: true});
const candidate = path.join(stage, "owner-crops.png");

const box = (left, top, width, height) => ({left, top, width, height});
const crop = (input, rect) => sharp(input).extract(rect).png().toBuffer();
const paper = "#f5f1e9";
function labels(width, height, entries) {
  const text = entries.map(([x, y, title, size]) =>
    `<text x="${x}" y="${y}" font-size="${size}">${title}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" fill="${paper}"/>` +
    `<g font-family="Malgun Gothic,sans-serif" font-weight="700" fill="#302a23">${text}</g></svg>`);
}

// Preserve the screenshot's actual reference pixels, layout and display scale.
const ownerLayers = [];
for (const [top, width] of [[77, 716], [544, 441]]) {
  const cell = box(1384, top, width, 420);
  ownerLayers.push({input: await crop(previous, cell), left: 644, top},
    {input: await crop(candidate, cell), left: 1384, top});
}
for (const [left, title] of [[644, "19차"], [1384, "20차"]]) {
  ownerLayers.push({input: labels(120, 55, [[0, 43, title, 30]]), left, top: 0});
}
await fs.mkdir(output, {recursive: true});
await sharp(previous).composite(ownerLayers).png().toFile(path.join(output, "owner-crops.png"));

// Pixel-center bilinear resampling. The screenshot's first sample falls 0.024
// of a source pixel outside the left edge, where the browser clamps to the edge.
async function sample(input, sourceBox, width, height, origin, step) {
  const {data, info} = await sharp(input).extract(sourceBox).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const out = Buffer.alloc(3 * width * height);
  for (let y = 0; y < height; y++) {
    const v = Math.max(0, Math.min(info.height - 1, origin[1] + y * step[1]));
    const iy = Math.floor(v), fy = v - iy, nextY = Math.min(iy + 1, info.height - 1);
    for (let x = 0; x < width; x++) {
      const u = Math.max(0, Math.min(info.width - 1, origin[0] + x * step[0]));
      const ix = Math.floor(u), fx = u - ix, nextX = Math.min(ix + 1, info.width - 1);
      for (let c = 0; c < 3; c++) {
        const a = data[3 * (iy * info.width + ix) + c], b = data[3 * (iy * info.width + nextX) + c];
        const d = data[3 * (nextY * info.width + ix) + c], e = data[3 * (nextY * info.width + nextX) + c];
        out[3 * (y * width + x) + c] = Math.round((1 - fy) * ((1 - fx) * a + fx * b) + fy * ((1 - fx) * d + fx * e));
      }
    }
  }
  return sharp(out, {raw: {width, height, channels: 3}}).png().toBuffer();
}

// The attached 557×286 screenshot shows 486×259 pixels from the actual P19
// panel at (32,0). Margins, the adjacent panel and app chrome surround it.
// This transform was fit to the unmarked RGB samples of the supplied screenshot.
const front = box(1384, 77, 716, 420);
const screenshotCrop = (input, sourceBox = front) => sample(input, sourceBox, 486, 259,
  [-0.02404, 39.52533], [1.47353103, 1.47151103]);
const previousClose = await screenshotCrop(previous);
const target = await sharp(circled).extract(box(32, 0, 486, 259)).removeAlpha().raw().toBuffer();
const old = await sharp(previousClose).removeAlpha().raw().toBuffer();
let squaredError = 0, count = 0;
for (let y = 3; y < 256; y++) {
  for (let x = 3; x < 483; x++) {
    const p = 3 * (y * 486 + x);
    // Gold in this capture is brighter in green than red ink. Exclude an
    // additional 3 px around ink to reject anti-aliased boundary samples.
    let ink = false;
    for (let dy = -3; dy <= 3 && !ink; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (target[p + 3 * (dy * 486 + dx) + 1] < 60) { ink = true; break; }
      }
    }
    if (ink) continue;
    for (let c = 0; c < 3; c++) squaredError += (old[p + c] - target[p + c]) ** 2;
    count++;
  }
}
const rms = Math.sqrt(squaredError / (3 * count));
assert.ok(count > 100000 && rms < 0.9, `P19 screenshot registration RMS ${rms} over ${count} pixels`);

// The reference and game panels on nose-pairs share the registered 18:1
// camera grid. Apply the same camera, crop and two display resamplings to the
// reference that board19 uses for the candidate's front panel.
const refNative = await sample(path.join(archive, "face19", "nose-pairs.png"), box(24, 149, 756, 810),
  556, 326, [122.3565, 423.8095], [1.00025, 1.0015]);
const refFront = await sharp(refNative).resize(716, 420, {fit: "fill"}).png().toBuffer();
const referenceClose = await screenshotCrop(refFront, box(0, 0, 716, 420));
const candidateClose = await screenshotCrop(candidate);
await sharp(labels(1008, 316, [[12, 35, "원본", 24], [510, 35, "20차", 24]]))
  .composite([{input: referenceClose, left: 12, top: 45}, {input: candidateClose, left: 510, top: 45}])
  .png().toFile(path.join(output, "alae-closeup.png"));
console.log(JSON.stringify({ownerImageRegion: [32, 0, 486, 259], testedPixels: count, pass19RegistrationRgbRms: rms}));
