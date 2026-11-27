/**
 * e2e/ext-sheet.mjs — contact sheet of shots (the exteriors audit): node e2e/ext-sheet.mjs <dir> <filterRegex> <out.jpg> [cols=3] [w=640]
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const [dir, filter, out, colsArg = "3", wArg = "640"] = process.argv.slice(2);
const cols = Number(colsArg), W = Number(wArg);
const files = readdirSync(dir).filter((f) => f.endsWith(".png") && new RegExp(filter).test(f)).sort();
if (!files.length) throw new Error("no files");
const meta = await sharp(join(dir, files[0])).metadata();
const H = Math.round((W * meta.height) / meta.width);
const rows = Math.ceil(files.length / cols);
const tiles = await Promise.all(
  files.map(async (f, i) => {
    const label = f.replace(/\.png$/, "");
    const svg = Buffer.from(`<svg width="${W}" height="22"><rect width="${W}" height="22" fill="black" opacity="0.6"/><text x="6" y="16" font-size="14" font-family="sans-serif" fill="white">${label}</text></svg>`);
    const img = await sharp(join(dir, f)).resize(W, H).composite([{ input: svg, top: 0, left: 0 }]).toBuffer();
    return { input: img, left: (i % cols) * W, top: Math.floor(i / cols) * H };
  }),
);
await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: "#222" } }).composite(tiles).jpeg({ quality: 82 }).toFile(out);
console.log(out, files.length);
