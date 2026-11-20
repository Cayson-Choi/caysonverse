/**
 * 케이슨 카페 — the café's own atlas (owner 2026-11-21: "카페 안이 너무 허접하잖아 … 추모관 수준으로 아주 사실적이고 디테일하게"): marble
 * (the counter's long top, the bistro tables' rounds, the upstairs sideboard's green), the two chalkboard menus, the enamel sign's ground, the
 * espresso machine's gauge, latte art, the pastries (croissant lamination, a glazed strawberry tart and its fluted crust, an opéra's cut
 * face, chocolate / berry / lemon tops, bread crust), coffee beans, jar labels, book spines, a clock face, four framed prints, and two
 * neutral cells (glaze, matte) that COLOR_0 tints (cups, saucers, macarons, jars).
 * Drawn procedurally in headless Chromium (cafe_art_draw.js, seeded), packed with sharp:
 *
 *   node docs/designs/village-lots-v2/tools/cafe_art.mjs --out client/public/models/village/lots/cafe --png <dir for the PNG twins>
 *
 * Writes lot_cafe_room_art.ktx2 (2048², UASTC sRGB: the chalk letters stay crisp), _normal (1024², from the height field) and _orm
 * (1024², G = roughness); the PNG twins in --png (the Blender renders and the bake); cafe_art_atlas.json beside this script (pixel rects,
 * top-left origin: cafe_room_kit.py maps its geometry with them). Build tools: npm --prefix art/materials/tools ci.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: a } = parseArgs({ options: { out: { type: "string" }, png: { type: "string" }, "no-ktx": { type: "boolean" } } });
const HERE = import.meta.dirname;
const REPO = resolve(HERE, "..", "..", "..", "..");
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
const { chromium } = await import(pathToFileURL(join(REPO, "node_modules", "playwright", "index.mjs")).href);

const AW = 2048, AH = 2048;
const C = (name, x, y, w, h) => ({ name, x, y, w, h });
const CELLS = [
  C("marble_long", 0, 0, 2048, 384),
  C("marble_round", 0, 384, 512, 512),
  C("chalk_coffee", 512, 384, 1024, 512),
  C("sign", 1536, 384, 512, 128),
  C("gauge", 1536, 512, 128, 128),
  C("latte", 1664, 512, 128, 128),
  C("glaze", 1792, 512, 128, 128),
  C("matte", 1920, 512, 128, 128),
  C("tart_fruit", 1536, 640, 256, 256),
  C("tart_crust", 1792, 640, 256, 128),
  C("cake_side", 1792, 768, 256, 128),
  C("chalk_pastry", 0, 896, 1024, 512),
  C("cake_choc", 1024, 896, 256, 256),
  C("cake_berry", 1280, 896, 256, 256),
  C("cake_lemon", 1536, 896, 256, 256),
  C("beans", 1792, 896, 256, 256),
  C("croissant", 1024, 1152, 256, 128),
  C("bread", 1280, 1152, 256, 128),
  C("clock", 1792, 1152, 256, 256),
  C("labels", 1024, 1280, 768, 128),
  C("print_street", 0, 1408, 384, 512),
  C("print_lemons", 384, 1408, 384, 512),
  C("print_poster", 768, 1408, 384, 512),
  C("print_macarons", 1152, 1408, 384, 512),
  C("spines", 1536, 1408, 512, 256),
  C("marble_green", 1536, 1664, 512, 384),
];

const outDir = resolve(a.out ?? join(REPO, "client", "public", "models", "village", "lots", "cafe"));
const pngDir = resolve(a.png ?? join(REPO, "art", "work", "cafe_art"));
mkdirSync(outDir, { recursive: true });
mkdirSync(join(pngDir, "cells"), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
await page.addScriptTag({ content: readFileSync(join(HERE, "cafe_art_draw.js"), "utf8") });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.error("[page error]", e.message));
const dec = (url) => Buffer.from(url.split(",")[1], "base64");
const L = { colour: [], height: [], rough: [] };
for (const [k, c] of CELLS.entries()) {
  const r = await page.evaluate(([n, w, h, s]) => window.drawCell(n, w, h, s), [c.name, c.w, c.h, 2000 + k * 31]);
  console.log("cell", c.name, `${c.w}x${c.h}`, r.ms, "ms");
  for (const t of ["colour", "height", "rough"]) {
    const buf = dec(r[t]);
    writeFileSync(join(pngDir, "cells", `${c.name}_${t}.png`), buf);
    L[t].push({ input: buf, left: c.x, top: c.y });
  }
}
await browser.close();

const bg = (r, g, b) => ({ create: { width: AW, height: AH, channels: 4, background: { r, g, b, alpha: 1 } } });
const colour = await sharp(bg(250, 248, 242)).composite(L.colour).png().toBuffer();
const height = await sharp(bg(128, 128, 128)).composite(L.height).raw().toBuffer({ resolveWithObject: true });
const rough = await sharp(bg(200, 200, 200)).composite(L.rough).raw().toBuffer({ resolveWithObject: true });
const H = height.data, N = Buffer.alloc(AW * AH * 4);
const K = 3.0;
const hAt = (x, y) => H[(Math.min(AH - 1, Math.max(0, y)) * AW + Math.min(AW - 1, Math.max(0, x))) * 4] / 255;
for (let y = 0; y < AH; y++)
  for (let x = 0; x < AW; x++) {
    const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * K;
    const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * K;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * AW + x) * 4;
    N[i] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
    N[i + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255);
    N[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    N[i + 3] = 255;
  }
const normal = await sharp(N, { raw: { width: AW, height: AH, channels: 4 } }).resize(AW / 2, AH / 2, { kernel: "lanczos3" }).png().toBuffer();
const R = rough.data, O = Buffer.alloc(AW * AH * 4);
for (let i = 0; i < AW * AH; i++) {
  O[i * 4] = 255;
  O[i * 4 + 1] = R[i * 4];
  O[i * 4 + 2] = 0;
  O[i * 4 + 3] = 255;
}
const orm = await sharp(O, { raw: { width: AW, height: AH, channels: 4 } }).resize(AW / 2, AH / 2).png().toBuffer();
const base = "lot_cafe_room_art";
writeFileSync(join(pngDir, `${base}.png`), colour);
writeFileSync(join(pngDir, `${base}_normal.png`), normal);
writeFileSync(join(pngDir, `${base}_orm.png`), orm);
const enc = async (png, out, srgb) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ktx = await encodeToKTX2(new Uint8Array(1), {
    isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true, enableRDO: false,
    isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb, isNormalMap: !srgb && out.includes("normal"),
    generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({ width: info.width, height: info.height, data: new Uint8Array(data) }),
  });
  writeFileSync(join(outDir, out), ktx);
  console.log("wrote", out, `${info.width}x${info.height}`, ktx.length, "bytes");
};
if (!a["no-ktx"]) {
  await enc(colour, `${base}.ktx2`, true);
  await enc(normal, `${base}_normal.ktx2`, false);
  await enc(orm, `${base}_orm.ktx2`, false);
}
writeFileSync(join(HERE, "cafe_art_atlas.json"), JSON.stringify({
  size: [AW, AH],
  note: "cafe_art.mjs: pixel rects, top-left origin (M_cafe_art). glaze / matte: plain white for COLOR_0 tints (glossy / matte).",
  cells: Object.fromEntries(CELLS.map((c) => [c.name, { x: c.x, y: c.y, w: c.w, h: c.h }])),
}, null, 1) + "\n");
console.log("done");
