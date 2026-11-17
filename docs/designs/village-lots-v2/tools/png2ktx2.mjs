/**
 * B3 (lots v2) — encode a lot's own albedo atlas PNG to KTX2 (ETC1S sRGB, full mips), as B1's b1_paintings.mjs does:
 *   node docs/designs/village-lots-v2/tools/png2ktx2.mjs --png <in.png> --out <out.ktx2>
 * (the gate's word-free goods atlas, gate_goods.py). Build tools: art/materials/tools (npm --prefix art/materials/tools ci).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: a } = parseArgs({ options: { png: { type: "string" }, out: { type: "string" } } });
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
const { data, info } = await sharp(a.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const ktx = await encodeToKTX2(new Uint8Array(1), {
  isUASTC: false, qualityLevel: 255, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true,
  generateMipmap: true, isKTX2File: true, isYFlip: false, imageDecoder: async () => ({ width: info.width, height: info.height, data: new Uint8Array(data) }),
});
writeFileSync(a.out, ktx);
console.log("wrote", a.out, ktx.length, "bytes");
