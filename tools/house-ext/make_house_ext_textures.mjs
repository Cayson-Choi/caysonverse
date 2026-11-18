// Builds the second-pass house exterior maps (2026-11-18) from CC0 Poly Haven 2K sets into client/public/models/village/houses/.
//   node tools/house-ext/make_house_ext_textures.mjs <srcDir> <origDir>
// srcDir holds <asset>_{diff,nor_gl,rough}.jpg for dark_wood, mossy_sandstone, clay_roof_tiles_03 (Poly Haven, CC0 1.0);
// origDir holds the first-pass house_{wood,...}_*.webp (the painted-board half of the wood sheet is kept from it).
// Brand-new look: the stone's lichen/moss blotches are high-passed away and the grain recoloured; nothing weathered is shipped.
import sharp from "sharp";
import { join } from "node:path";

const [, , SRC, ORIG] = process.argv;
const OUT = join(import.meta.dirname, "..", "..", "client", "public", "models", "village", "houses");
const raw = async (img) => {
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: Float32Array.from(data), w: info.width, h: info.height, c: info.channels };
};
const toImg = (r) => sharp(Buffer.from(Uint8Array.from(r.data, (v) => Math.max(0, Math.min(255, Math.round(v))))), { raw: { width: r.w, height: r.h, channels: r.c } });
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const meanLin = (r) => { let s = 0; for (let i = 0; i < r.data.length; i += 3) s += 0.2126 * lin(r.data[i]) + 0.7152 * lin(r.data[i + 1]) + 0.0722 * lin(r.data[i + 2]); return s / (r.data.length / 3); };
const save = async (img, name, q = 88) => img.webp({ quality: q }).toFile(join(OUT, name));
const saveNormal = async (img, name) => { const png = await img.png().toBuffer(); await save(sharp(png), `${name}.webp`, 92); await save(sharp(png).resize(512), `${name}_512.webp`, 90); };
const report = {};

// ── timber: dark_wood's oiled-oak grain as the oak half of the wood sheet; the painted-board half stays ──
{
  const half = async (file, kind) => sharp(join(SRC, `dark_wood_${file}.jpg`)).extract({ left: 0, top: 512, width: 2048, height: 1024 }).resize(1024, 512, { kernel: "lanczos3" }).toColourspace(kind === "d" ? "srgb" : "srgb");
  const compose = async (origName, top) => {
    const bottom = await sharp(join(ORIG, origName)).extract({ left: 0, top: 512, width: 1024, height: 512 }).toBuffer();
    return sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#808080" } }).composite([{ input: await top.png().toBuffer(), left: 0, top: 0 }, { input: bottom, left: 0, top: 512 }]);
  };
  // slightly deeper, less red than the raw mahogany: a clear-oiled oak beam
  let d = await raw(await half("diff"));
  for (let i = 0; i < d.data.length; i += 3) {
    const l = 0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2];
    for (let k = 0; k < 3; k++) d.data[i + k] = (l + (d.data[i + k] - l) * 0.6) * 1.0;
  }
  const albedo = await compose("house_wood_albedo.webp", toImg(d));
  await save(albedo, "house_wood_albedo.webp");
  report.LM_wood = { mean: meanLin(await raw(albedo.clone())) };
  await saveNormal(await compose("house_wood_normal.webp", await half("nor_gl")), "house_wood_normal");
  await save(await compose("house_wood_rough.webp", await half("rough")), "house_wood_rough.webp", 85);
}

// ── sandstone: the grain of the inside of ONE block (no mortar, no lichen), made seamless by a half-shift blend, tiled 2 x 4 into 1 m ──
{
  const crop = { left: 90, top: 755, width: 400, height: 170 };
  const W = 512;
  const H = 256;
  const seamless = (r, isNormal) => {
    // r is W x H x 3 floats. out = A*m + roll(A, W/2, H/2)*(1-m), m = a cosine window that is 0 on every edge
    const out = { data: new Float32Array(W * H * 3), w: W, h: H, c: 3 };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const m = Math.sin((Math.PI * x) / W) ** 2 * Math.sin((Math.PI * y) / H) ** 2;
        const i = (y * W + x) * 3;
        const j = (((y + H / 2) % H) * W + ((x + W / 2) % W)) * 3;
        for (let k = 0; k < 3; k++) out.data[i + k] = isNormal ? (r.data[i + k] / 255 * 2 - 1) * m + (r.data[j + k] / 255 * 2 - 1) * (1 - m) : r.data[i + k] * m + r.data[j + k] * (1 - m);
        if (isNormal) {
          const l = Math.hypot(out.data[i], out.data[i + 1], out.data[i + 2]) || 1;
          for (let k = 0; k < 3; k++) out.data[i + k] = (out.data[i + k] / l * 0.5 + 0.5) * 255;
        }
      }
    }
    return out;
  };
  const make = async (file, post, isNormal) => {
    const c = sharp(join(SRC, `mossy_sandstone_${file}.jpg`)).extract(crop).resize(W, H, { kernel: "lanczos3" }).toColourspace("srgb").removeAlpha();
    const r = await raw(c);
    const res = seamless(await post(r), isNormal);
    const tileBuf = await toImg(res).png().toBuffer();
    const comp = [];
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 2; tx++) comp.push({ input: tileBuf, left: tx * W, top: ty * H });
    return sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#000" } }).composite(comp);
  };
  const albedo = await make("diff", async (r) => {
    // luminance, with the broad lichen blotches taken out (a large blur subtracted), then a warm Vosges-sandstone tint
    const lum = new Float32Array(r.w * r.h);
    for (let i = 0; i < lum.length; i++) lum[i] = 0.3 * r.data[i * 3] + 0.59 * r.data[i * 3 + 1] + 0.11 * r.data[i * 3 + 2];
    const blurBuf = await sharp(Buffer.from(Uint8Array.from(lum, (v) => Math.round(v))), { raw: { width: r.w, height: r.h, channels: 1 } }).blur(14).raw().toBuffer();
    const out = { data: new Float32Array(r.w * r.h * 3), w: r.w, h: r.h, c: 3 };
    for (let i = 0; i < lum.length; i++) {
      const v = 166 + (lum[i] - blurBuf[i]) * 1.5;
      out.data[i * 3] = v * 1.035;
      out.data[i * 3 + 1] = v * 1.0;
      out.data[i * 3 + 2] = v * 0.945;
    }
    return out;
  }, false);
  await save(albedo, "house_sandstone_albedo.webp");
  report.LM_stone = { mean: meanLin(await raw(albedo.clone())) };
  await saveNormal(await make("nor_gl", async (r) => r, true), "house_sandstone_normal");
  await save(await make("rough", async (r) => r, false), "house_sandstone_rough.webp", 85);
}

// ── roof: clay_roof_tiles_03 (a plain "beaver-tail" tile roof with the stamped diamond), cleaned and a touch brighter ──
{
  const base = (f) => sharp(join(SRC, `clay_roof_tiles_03_${f}.jpg`)).resize(1024, 1024, { kernel: "lanczos3" });
  const d = await raw(base("diff"));
  for (let i = 0; i < d.data.length; i += 3) {
    const l = 0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2];
    // a fresh, clean glaze: pull the dull brown specks toward the red, lift the whole by ~12 %
    for (let k = 0; k < 3; k++) d.data[i + k] = Math.min(255, (l + (d.data[i + k] - l) * 1.1) * 1.12);
  }
  const albedo = toImg(d);
  await save(albedo, "house_tile_albedo.webp");
  report.LM_roof = { mean: meanLin(await raw(albedo.clone())) };
  await saveNormal(base("nor_gl"), "house_tile_normal");
  await save(base("rough"), "house_tile_rough.webp", 85);
}
console.log(JSON.stringify(report));
