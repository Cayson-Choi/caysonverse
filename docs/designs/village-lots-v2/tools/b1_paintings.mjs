/**
 * B1 — the reading room's paintings atlas (lot own map, KTX2 ETC1S sRGB with mips, 1024 x 1024): five public-domain
 * landscape paintings from Wikimedia Commons (PD-Art; sources and credits in shots/lot_library/SOURCES_lot_library.md),
 * cropped into the cells library_room_dress.py maps (PAINTING_CELLS there must match).
 *   node docs/designs/village-lots-v2/tools/b1_paintings.mjs --src <dir with pd_*.jpg> --out <atlas.ktx2> --png <atlas.png>
 * Layout (pixels, top-left origin): the overmantel (Constable, The Hay Wain) 0,0 .. 1024,706; four small landscapes in the
 * strip below, 256 x 192 each at y 716: Constable Wivenhoe Park, Hobbema Avenue at Middelharnis, Corot Souvenir de
 * Mortefontaine, Ruisdael Windmill at Wijk bij Duurstede.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: a } = parseArgs({ options: { src: { type: "string" }, out: { type: "string" }, png: { type: "string" } } });
const REPO = resolve(import.meta.dirname, "..", "..", "..", "..");
const TOOLS = join(REPO, "art", "materials", "tools", "node_modules");
const tool = async (name) => {
  const dir = join(TOOLS, name);
  if (!existsSync(dir)) throw new Error(`missing ${name}: npm --prefix art/materials/tools ci`);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const exp = pkg.exports?.["."] ?? pkg.exports;
  let entry = typeof exp === "string" ? exp : exp?.node?.import ?? exp?.import?.default ?? exp?.import ?? exp?.default?.import ?? exp?.default;
  if (typeof entry !== "string") entry = pkg.module ?? pkg.main ?? "index.js";
  return import(pathToFileURL(join(dir, entry)).href);
};
const sharp = (await tool("sharp")).default;
const { encodeToKTX2 } = await tool("ktx2-encoder");

const S = 1024;
const CELLS = [
  ["pd_haywain", 0, 0, 1024, 706],
  ["pd_wivenhoe", 0, 716, 256, 192],
  ["pd_hobbema", 256, 716, 256, 192],
  ["pd_corot", 512, 716, 256, 192],
  ["pd_ruisdael", 768, 716, 256, 192],
];
const layers = [];
for (const [key, x, y, w, h] of CELLS) {
  const buf = await sharp(join(a.src, `${key}.jpg`)).resize(w, h, { fit: "cover", position: "centre" }).modulate({ brightness: 1.04, saturation: 1.05 }).toBuffer();
  layers.push({ input: buf, left: x, top: y });
}
const atlas = sharp({ create: { width: S, height: S, channels: 4, background: { r: 40, g: 30, b: 20, alpha: 1 } } }).composite(layers);
const png = await atlas.png().toBuffer();
writeFileSync(a.png, png);
const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const ktx = await encodeToKTX2(new Uint8Array(1), {
  isUASTC: false, qualityLevel: 255, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true,
  generateMipmap: true, isKTX2File: true, isYFlip: false, imageDecoder: async () => ({ width: S, height: S, data: new Uint8Array(data) }),
});
writeFileSync(a.out, ktx);
console.log("wrote", a.out, ktx.length, "bytes");
