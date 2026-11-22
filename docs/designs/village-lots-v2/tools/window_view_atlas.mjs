/**
 * Lay the village's baked cube faces (e2e/window-view-bake.mjs) into the window chart and encode them for the rooms.
 *   node docs/designs/village-lots-v2/tools/window_view_atlas.mjs --in=<bake dir> [--preview=<dir>]
 *
 * In: <unit>.json (the bake's frame and keys) and <unit>_<key>_<face>.hdrface (RGBE, N x N, rows top first: the scene's linear
 * light before exposure). Out:
 *  - client/public/models/village/lots/windowview/<unit>_<key>.ktx2 — the chart of client/src/village/lots/gardenChart.json
 *    (two 180° eye-level strips over two equal-area polar caps, as the garden photo had), ETC1S sRGB with mips. A texel stores
 *    y = v / (1 + v) with v = light x the bake's exposure (`k`): the tone-mapped look's range in 8 bits, undone in the shader.
 *  - client/src/village/lots/windowViews.json — per room: its frame (room → village), the bake's eye, and per key the file,
 *    the clock's night / golden weights it was baked at and `k`.
 * With --preview, a plain equirectangular PNG per key (y as an sRGB picture) for checking by eye.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: a } = parseArgs({ options: { in: { type: "string" }, preview: { type: "string" } } });
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

const chart = JSON.parse(readFileSync(join(REPO, "client/src/village/lots/gardenChart.json"), "utf8"));
const OUT_DIR = join(REPO, "client/public/models/village/lots/windowview");
const VIEWS = join(REPO, "client/src/village/lots/windowViews.json");
mkdirSync(OUT_DIR, { recursive: true });
if (a.preview) mkdirSync(a.preview, { recursive: true });

const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

/** One key's six faces as float RGB, and a bilinear lookup by direction (village axes). */
function cube(dir, unit, key, faces, N) {
  const data = faces.map((f) => {
    const raw = readFileSync(join(dir, `${unit}_${key}_${f.id}.hdrface`));
    if (raw.length !== N * N * 4) throw new Error(`${unit} ${key} ${f.id}: ${raw.length} bytes`);
    const px = new Float32Array(N * N * 3);
    for (let i = 0, j = 0; i < raw.length; i += 4, j += 3) {
      const e = raw[i + 3];
      if (!e) continue;
      const s = Math.pow(2, e - 128 - 8);
      px[j] = (raw[i] + 0.5) * s;
      px[j + 1] = (raw[i + 1] + 0.5) * s;
      px[j + 2] = (raw[i + 2] + 0.5) * s;
    }
    return { F: f.f, U: f.u, R: cross(f.f, f.u), px };
  });
  const out = [0, 0, 0];
  return (d) => {
    let best = data[0], bd = -2;
    for (const f of data) {
      const k = dot(d, f.F);
      if (k > bd) (bd = k), (best = f);
    }
    const x = dot(d, best.R) / bd, y = dot(d, best.U) / bd;
    const cx = Math.min(N - 1, Math.max(0, ((x + 1) / 2) * N - 0.5));
    const cy = Math.min(N - 1, Math.max(0, ((1 - y) / 2) * N - 0.5));
    const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
    const fx = cx - x0, fy = cy - y0;
    for (let c = 0; c < 3; c++) {
      const p = best.px;
      const top = p[(y0 * N + x0) * 3 + c] * (1 - fx) + p[(y0 * N + x1) * 3 + c] * fx;
      const bot = p[(y1 * N + x0) * 3 + c] * (1 - fx) + p[(y1 * N + x1) * 3 + c] * fx;
      out[c] = top * (1 - fy) + bot * fy;
    }
    return out;
  };
}

/** Longitude (0..1, the shader's atan(x, z) / 2π + 0.5) and latitude (°) → unit direction. */
function direction(lon, latDeg) {
  const t = (lon - 0.5) * 2 * Math.PI, l = (latDeg * Math.PI) / 180;
  return [Math.cos(l) * Math.sin(t), Math.sin(l), Math.cos(l) * Math.cos(t)];
}

const { width: W, height: H, horizonTileHeight: HT, gutter: G, bottomLatitude: BOT, topLatitude: TOP, blendDegrees: BL } = chart;
const R = Math.PI / 180;
const northLimit = Math.sin((TOP - BL) * R), southLimit = Math.sin((BOT + BL) * R);
const SS = 3; // supersamples per texel side

/** The chart's direction at atlas pixel coordinates (continuous, so the gutters carry on past each tile's edge). */
function chartDirection(px, py) {
  if (py < 2 * HT) {
    const half = py < HT ? 0 : 1;
    const lx = (px - G) / (W - 2 * G), ly = (py - half * HT - G) / (HT - 2 * G);
    const lon = (((half + lx) / 2) % 1 + 1) % 1;
    return direction(lon, TOP - ly * (TOP - BOT));
  }
  const north = px < W / 2;
  const cw = W / 2, ch = H - 2 * HT;
  const lx = (px - (north ? 0 : cw) - G) / (cw - 2 * G), ly = (py - 2 * HT - G) / (ch - 2 * G);
  const upper = north ? 1 : southLimit, lower = north ? northLimit : -1;
  const y = Math.max(-1, Math.min(1, upper + ly * (lower - upper)));
  return direction(((lx % 1) + 1) % 1, Math.asin(y) / R);
}

const srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const enc = (L, k) => {
  const v = Math.max(0, L) * k;
  return Math.round(255 * srgb(v / (1 + v)));
};

const views = existsSync(VIEWS) ? JSON.parse(readFileSync(VIEWS, "utf8")) : { rooms: {} };
for (const name of readdirSync(a.in).filter((n) => n.endsWith(".json"))) {
  const meta = JSON.parse(readFileSync(join(a.in, name), "utf8"));
  const entry = { m: meta.m, t: meta.t, eyeRoom: meta.eyeRoom, eyeVillage: meta.eyeVillage, keys: [] };
  for (const key of meta.keys) {
    const look = cube(a.in, meta.unit, key.id, meta.faces, meta.face);
    const k = key.exposure;
    const atlas = Buffer.alloc(W * H * 4, 255);
    for (let py = 0; py < H; py++)
      for (let px = 0; px < W; px++) {
        // the gutters' vertical overrun stays inside the strip's latitudes (the shader clamps there)
        const sum = [0, 0, 0];
        for (let sy = 0; sy < SS; sy++)
          for (let sx = 0; sx < SS; sx++) {
            const c = look(chartDirection(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS));
            sum[0] += c[0];
            sum[1] += c[1];
            sum[2] += c[2];
          }
        const o = (py * W + px) * 4;
        for (let c = 0; c < 3; c++) atlas[o + c] = enc(sum[c] / (SS * SS), k);
      }
    const file = `${meta.unit}_${key.id}.ktx2`;
    const ktx = await encodeToKTX2(new Uint8Array(1), {
      isUASTC: false, qualityLevel: 255, compressionLevel: 2,
      isPerceptual: true, isSetKTX2SRGBTransferFunc: true,
      generateMipmap: true, isKTX2File: true, isYFlip: false,
      imageDecoder: async () => ({ width: W, height: H, data: new Uint8Array(atlas) }),
    });
    writeFileSync(join(OUT_DIR, file), ktx);
    console.log("wrote", file, ktx.length, "bytes");
    entry.keys.push({ id: key.id, file: `lots/windowview/${file}`, time: key.time, night: +key.night.toFixed(4), golden: +key.golden.toFixed(4), k: +k.toFixed(5) });
    if (a.preview) {
      const PW = 2048, PH = 1024, img = Buffer.alloc(PW * PH * 3);
      for (let y = 0; y < PH; y++)
        for (let x = 0; x < PW; x++) {
          const c = look(direction((x + 0.5) / PW, 90 - ((y + 0.5) / PH) * 180));
          for (let ch = 0; ch < 3; ch++) img[(y * PW + x) * 3 + ch] = enc(c[ch], k);
        }
      await sharp(img, { raw: { width: PW, height: PH, channels: 3 } }).png().toFile(join(a.preview, `${meta.unit}_${key.id}_equirect.png`));
    }
  }
  views.rooms[meta.unit] = entry;
}
writeFileSync(VIEWS, JSON.stringify(views, null, 1) + "\n");
console.log("wrote", VIEWS);
