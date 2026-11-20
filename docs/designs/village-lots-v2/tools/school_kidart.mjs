/**
 * 케이슨 마을 학교 교실 — the classroom's own atlas (owner 2026-11-20: "학교에 걸린 그림액자도 너무 허접해 진짜 학생들이 그린 그림같은
 * 걸 걸어두라고"): sixteen children's drawings (crayon, coloured pencil, felt-tip, watercolour, pencil on real paper, each signed
 * with a made-up first name in a child's hand), the chalkboard with the teacher's chalk, the ㄱㄴㄷ cards, bin labels, the clock
 * face, the timetable, cork, an open exercise book, masking tape, a paper back, page edges and picture-book spines.
 * Drawn procedurally in headless Chromium (school_kidart_draw.js, seeded: the same every run), packed with sharp:
 *
 *   node docs/designs/village-lots-v2/tools/school_kidart.mjs --out client/public/models/village/lots/school \
 *        --png <dir for the PNG twins and the per-cell previews> [--only family,cat] [--no-ktx]
 *
 * Writes two atlases (the KTX2 encoder takes ~12 Mpix an image at most): lot_school_class_art.ktx2 (the drawings, albedo
 * 4096 x 2896, ETC1S sRGB) and lot_school_class_print.ktx2 (everything else, 2048 x 2048, UASTC sRGB), each with a _normal (half size, UASTC
 * linear, from the height field: paper tooth, crinkles, crayon wax) and an _orm (half size: G roughness — wax 0.6, paper 0.9,
 * laminated print 0.35–0.5); their PNG twins in --png (Blender renders), and school_art_atlas.json beside this script (the cells,
 * pixel rects, top-left origin: school_room_dress.py maps its geometry with them).
 * Build tools: npm --prefix art/materials/tools ci (sharp, ktx2-encoder, playwright's Chromium).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: a } = parseArgs({ options: { out: { type: "string" }, png: { type: "string" }, only: { type: "string" }, "no-ktx": { type: "boolean" } } });
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

// two atlases (the KTX2 encoder takes at most ~12 Mpix an image): `art` — the sixteen drawings, 1024 x 724 px a sheet (4096 x 2896);
// `print` — the teacher's and the classroom's printed things (2048 x 2048)
const ATLASES = { art: { w: 4096, h: 2896 }, print: { w: 2048, h: 2048 } };
const DW = 1024, DH = 724; // a drawing: landscape (8절 도화지, 39 x 27.5 cm in the room) at ~2.6 px/mm
const DRAWINGS = ["family", "rainbow", "cat", "dog", "flowers", "fountain", "bus", "coaster", "appletree", "lake", "me", "butterfly", "night", "handprints", "dino", "spring"];
const SPINE_W = 40, SPINE_H = 340, SPINES = 24;
const CELLS = [
  ...DRAWINGS.map((n, k) => ({ name: n, atlas: "art", x: (k % 4) * DW, y: Math.floor(k / 4) * DH, w: DW, h: DH, kind: "drawing" })),
  { name: "chalkboard", atlas: "print", x: 0, y: 0, w: 2048, h: 688 },
  { name: "cork", atlas: "print", x: 0, y: 1016, w: 1024, h: 600 },
  { name: "clock", atlas: "print", x: 1536, y: 1016, w: 512, h: 512 },
  { name: "timetable", atlas: "print", x: 1024, y: 1016, w: 512, h: 688 },
  { name: "pages", atlas: "print", x: 1536, y: 1528, w: 512, h: 120 },
  { name: "hangul", atlas: "print", x: 0, y: 688, w: 2048, h: 200 },
  { name: "labels", atlas: "print", x: 0, y: 888, w: 2048, h: 128 },
  { name: "exercise", atlas: "print", x: 0, y: 1616, w: 512, h: 360 },
  { name: "paperback", atlas: "print", x: 512, y: 1616, w: 512, h: 360 },
  { name: "tape", atlas: "print", x: 1536, y: 1648, w: 256, h: 56 },
  { name: `spines:${SPINE_W}:${SPINE_H}`, atlas: "print", x: 1024, y: 1704, w: SPINE_W * SPINES, h: SPINE_H, key: "spines" },
];
// (print: 1792..2048 x 1648..1704 stays blank paper — the book covers' COLOR_0 tint goes over it)

const outDir = resolve(a.out ?? join(REPO, "client", "public", "models", "village", "lots", "school"));
const pngDir = resolve(a.png ?? join(REPO, "art", "work", "school_art"));
mkdirSync(outDir, { recursive: true });
mkdirSync(join(pngDir, "cells"), { recursive: true });
const only = a.only ? new Set(a.only.split(",")) : null;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
await page.addScriptTag({ content: readFileSync(join(HERE, "school_kidart_draw.js"), "utf8") });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.error("[page error]", e.message));

const dec = (url) => Buffer.from(url.split(",")[1], "base64");
const layers = Object.fromEntries(Object.keys(ATLASES).map((k) => [k, { colour: [], height: [], rough: [] }]));
for (const [k, c] of CELLS.entries()) {
  const key = c.key ?? c.name;
  const cellFile = (t) => join(pngDir, "cells", `${key}_${t}.png`);
  const L = layers[c.atlas];
  if (only && !only.has(key) && existsSync(cellFile("colour"))) {
    for (const t of ["colour", "height", "rough"]) L[t].push({ input: readFileSync(cellFile(t)), left: c.x, top: c.y });
    continue;
  }
  const r = await page.evaluate(([n, w, h, s]) => window.drawCell(n, w, h, s), [c.name, c.w, c.h, 1000 + k * 17]);
  console.log("cell", key, `${c.w}x${c.h}`, r.ms, "ms");
  for (const t of ["colour", "height", "rough"]) {
    const buf = dec(r[t]);
    writeFileSync(cellFile(t), buf);
    L[t].push({ input: buf, left: c.x, top: c.y });
  }
}
await browser.close();

const enc = async (png, out, srgb, etc1s = false) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ktx = await encodeToKTX2(new Uint8Array(1), {
    ...(etc1s ? { isUASTC: false, qualityLevel: 255, compressionLevel: 2 } : { isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true, enableRDO: false }),
    isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb, isNormalMap: !srgb && out.includes("normal"),
    generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({ width: info.width, height: info.height, data: new Uint8Array(data) }),
  });
  writeFileSync(join(outDir, out), ktx);
  console.log("wrote", out, `${info.width}x${info.height}`, ktx.length, "bytes");
};
for (const [name, { w: AW, h: AH }] of Object.entries(ATLASES)) {
  const L = layers[name];
  const bg = (r, g, b) => ({ create: { width: AW, height: AH, channels: 4, background: { r, g, b, alpha: 1 } } });
  const colour = await sharp(bg(246, 242, 232)).composite(L.colour).png().toBuffer();
  const height = await sharp(bg(128, 128, 128)).composite(L.height).raw().toBuffer({ resolveWithObject: true });
  const rough = await sharp(bg(230, 230, 230)).composite(L.rough).raw().toBuffer({ resolveWithObject: true });
  // the normal map from the height field (central differences at full size, then halved), tangent space, +y up in the image
  const H = height.data, N = Buffer.alloc(AW * AH * 4);
  const K = 3.2; // slope gain: the paper's tooth and the wax read at a glance, crinkles softly
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
  const base = `lot_school_class_${name}`;
  writeFileSync(join(pngDir, `${base}.png`), colour);
  writeFileSync(join(pngDir, `${base}_normal.png`), normal);
  writeFileSync(join(pngDir, `${base}_orm.png`), orm);
  if (!a["no-ktx"]) {
    // the drawings' albedo as ETC1S: 2.3 MB instead of UASTC's 13 MB (the crayon grain does not compress), side by side in the room
    // at a metre the same (tmpshots/school-real/build/cmp_uastc_etc1s.png); the print atlas's small letters keep UASTC
    await enc(colour, `${base}.ktx2`, true, name === "art");
    await enc(normal, `${base}_normal.ktx2`, false);
    await enc(orm, `${base}_orm.ktx2`, false);
  }
}
writeFileSync(join(HERE, "school_art_atlas.json"), JSON.stringify({
  atlases: ATLASES,
  note: "school_kidart.mjs: pixel rects, top-left origin, per atlas (art: the drawings, M_school_art; print: everything else, M_school_print). The drawings are 8절 landscape. spines: 24 cells left to right. blank: plain paper for the book covers' tint.",
  cells: Object.fromEntries(CELLS.map((c) => [c.key ?? c.name, { atlas: c.atlas, x: c.x, y: c.y, w: c.w, h: c.h }])),
  blank: { atlas: "print", x: 1796, y: 1652, w: 248, h: 48 },
  drawings: DRAWINGS,
  spine: { w: SPINE_W, h: SPINE_H, count: SPINES },
}, null, 2) + "\n");
console.log("done");
