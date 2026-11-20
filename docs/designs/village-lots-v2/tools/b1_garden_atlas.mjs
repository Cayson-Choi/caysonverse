/** Lay out a full garden sphere with extra texels at seated/standing eye level.
 * node docs/designs/village-lots-v2/tools/b1_garden_atlas.mjs <source equirectangular image> <output PNG>
 * The two 180-degree horizon strips lie above the two equal-area polar caps.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const requireArt = createRequire(new URL("../../../../art/materials/tools/package.json", import.meta.url));
const sharp = requireArt("sharp");
const chart = JSON.parse(readFileSync(new URL("../../../../client/src/village/lots/gardenChart.json", import.meta.url), "utf8"));
const [source, dest] = process.argv.slice(2);
const { width, height, horizonTileHeight, gutter, bottomLatitude, topLatitude, blendDegrees } = chart;
const { width: sourceWidth, height: sourceHeight } = await sharp(source).metadata();
if (sourceWidth !== sourceHeight * 2 || sourceWidth < 4096) throw Error("Expected a full equirectangular garden photograph of at least 4K.");
const atlas = Buffer.alloc(width * height * 3);
const radians = Math.PI / 180;
sharp.concurrency(2);

// Resample longitude with Lanczos. Each row averages the source latitudes that reach it.
// Horizontally wrapping the original pixels into the gutters keeps both 180-degree joins seamless.
async function bandSource(columns) {
  return sharp(source).removeAlpha().toColourspace("srgb")
    .resize(columns, sourceHeight, { fit: "fill" }).raw().toBuffer();
}
function tile(input, columns, sourceX, x, y, tileWidth, tileHeight, top, bottom, polar) {
  const innerHeight = tileHeight - 2 * gutter;
  function sourceY(t) {
    const angle = polar
      ? Math.asin((1 - t) * Math.sin(top * radians) + t * Math.sin(bottom * radians)) / radians
      : top + (bottom - top) * t;
    return Math.max(0, Math.min(sourceHeight, (90 - angle) * sourceHeight / 180));
  }
  const sums = new Float32Array(columns * 3);
  for (let j = 0; j < innerHeight; j++) {
    const a = sourceY(j / innerHeight), b = sourceY((j + 1) / innerHeight);
    sums.fill(0);
    for (let sy = Math.floor(a); sy < Math.ceil(b); sy++) {
      const weight = (Math.min(sy + 1, b) - Math.max(sy, a)) / (b - a);
      const offset = sy * columns * 3;
      for (let i = 0; i < sums.length; i++) sums[i] += input[offset + i] * weight;
    }
    const outY = y + gutter + j;
    for (let px = 0; px < tileWidth; px++) {
      const sample = (columns + sourceX + px - gutter) % columns * 3;
      const offset = (outY * width + x + px) * 3;
      for (let c = 0; c < 3; c++) atlas[offset + c] = Math.round(sums[sample + c]);
    }
  }
  for (let j = 0; j < gutter; j++) {
    const row = (r) => ((y + r) * width + x) * 3;
    atlas.copy(atlas, row(j), row(gutter), row(gutter) + tileWidth * 3);
    const last = tileHeight - gutter - 1;
    atlas.copy(atlas, row(tileHeight - j - 1), row(last), row(last) + tileWidth * 3);
  }
}
const segment = width - 2 * gutter;
const horizon = await bandSource(2 * segment);
for (let i = 0; i < 2; i++)
  tile(horizon, 2 * segment, i * segment, 0, i * horizonTileHeight, width, horizonTileHeight, topLatitude, bottomLatitude, false);
const capWidth = width / 2, capY = 2 * horizonTileHeight, capHeight = height - capY;
const caps = await bandSource(capWidth - 2 * gutter);
tile(caps, capWidth - 2 * gutter, 0, 0, capY, capWidth, capHeight, 90, topLatitude - blendDegrees, true);
tile(caps, capWidth - 2 * gutter, 0, capWidth, capY, capWidth, capHeight, bottomLatitude + blendDegrees, -90, true);
await sharp(atlas, { raw: { width, height, channels: 3 } }).png().toFile(dest);
