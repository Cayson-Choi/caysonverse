/**
 * B2 — the coloured light pools' maps (lot own maps, KTX2 ETC1S sRGB with mips): the stained glass's transmission maps
 * (tools/sacred/light/*_transmit.png, made from the same CC0 Met glass as the windows) softened like sunlight's penumbra
 * and packed for the rooms' M_lightpool (b2_room.light_pool maps the cells).
 *   node docs/designs/village-lots-v2/tools/b2_lightpools.mjs --png <dir for the render twins>
 * Writes client/public/models/village/lots/chapel/lot_chapel_nave_lightpools.ktx2 (1024 x 1024: cells 256 x 665 at x 0 / 256 /
 * 512 = virgin, nativity, assumption) and lots/church/lot_church_nave_lightpools.ktx2 (512 x 512: the plain leaded lancet,
 * 196 x 510 at x 0), plus PNG twins in --png.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: a } = parseArgs({ options: { png: { type: "string" } } });
const REPO = resolve(import.meta.dirname, "..", "..", "..", "..");
const LIGHT = join(REPO, "docs", "designs", "village-lots-v2", "tools", "sacred", "light");
const LOTS = join(REPO, "client", "public", "models", "village", "lots");
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

async function cell(name, w, h) {
  // soften (the sun's penumbra over ~3 m), lift the colours a little toward sunlight, keep black outside the lancet
  return sharp(join(LIGHT, `${name}_transmit.png`)).resize(w, h, { fit: "fill" }).blur(2.2).modulate({ brightness: 1.15, saturation: 1.12 }).toBuffer();
}

async function atlas(out, pngName, S, cells) {
  const layers = [];
  for (const [name, x, y, w, h] of cells) layers.push({ input: await cell(name, w, h), left: x, top: y });
  const png = await sharp({ create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).composite(layers).png().toBuffer();
  if (a.png) writeFileSync(join(a.png, `${pngName}.png`), png);
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ktx = await encodeToKTX2(new Uint8Array(1), {
    isUASTC: false, qualityLevel: 255, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true,
    generateMipmap: true, isKTX2File: true, isYFlip: false, imageDecoder: async () => ({ width: S, height: S, data: new Uint8Array(data) }),
  });
  mkdirSync(join(LOTS, out.split("/")[0]), { recursive: true });
  writeFileSync(join(LOTS, out), ktx);
  console.log("wrote", out, ktx.length, "bytes");
}

await atlas("chapel/lot_chapel_nave_lightpools.ktx2", "lot_chapel_nave_lightpools", 1024, [
  ["glass_lancet_virgin", 0, 0, 256, 665],
  ["glass_lancet_nativity", 256, 0, 256, 665],
  ["glass_lancet_assumption", 512, 0, 256, 665],
]);
await atlas("church/lot_church_nave_lightpools.ktx2", "lot_church_nave_lightpools", 512, [["glass_church_clear", 0, 0, 196, 510]]);
