/**
 * docs/designs/clear-glass/tools/portal_atlas.mjs — the baked rooms (e2e/interior-portal-bake.mjs) as one KTX2 atlas per room for the
 * village's windows and open doors (client/src/village/portal/interiorPortal.ts).
 *
 * Layout (client/src/village/portal/portalAtlas.json): 3 columns × 4 rows of cube faces, the day's six (px nx py / ny pz nz) on rows
 * 0–1, the night's on rows 2–3; each face `face` px square inside a `gutter` px border that continues the cube across the edge (so a
 * filtered or mip-mapped tap at a face's rim reads the neighbouring face, not another tile). Face axes: f the face's direction, u its
 * up, r = f × u; a direction d on face f is at (s, t) = (d·r, d·u) / (d·f), image column (s + 1) / 2, row (1 − t) / 2 (top first).
 * A texel holds sRGB(w / (1 + w)), w = the room's linear light × the exposure it is seen at inside (the shader inverts it).
 *
 *   npm --prefix art/materials/tools ci        (sharp, ktx2-encoder)
 *   node docs/designs/clear-glass/tools/portal_atlas.mjs --in=<bake dir> [--preview=<dir>]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: a } = parseArgs({ options: { in: { type: "string" }, preview: { type: "string" }, only: { type: "string" } } });
if (!a.in) throw new Error("--in=<bake dir>");
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

const LAYOUT = JSON.parse(readFileSync(join(REPO, "client/src/village/portal/portalAtlas.json"), "utf8"));
const { face: F, gutter: G, faces: FACES } = LAYOUT;
const TILE = F + 2 * G;
const W = 3 * TILE, H = 4 * TILE;
const OUT_DIR = join(REPO, "client/public/models/village/portal");
const MANIFEST = join(REPO, "client/src/village/portal/portalBakes.json");
mkdirSync(OUT_DIR, { recursive: true });
if (a.preview) mkdirSync(a.preview, { recursive: true });

const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const AXES = FACES.map((f) => ({ ...f, r: cross(f.f, f.u) }));

/** One key's six faces as float RGB (each × exposure), and a bilinear lookup by direction. */
function cube(dir, id, key, N, exposure) {
  const data = AXES.map((f) => {
    const raw = readFileSync(join(dir, `${id}_${key}_${f.id}.hdrface`));
    if (raw.length !== N * N * 4) throw new Error(`${id} ${key} ${f.id}: ${raw.length} bytes`);
    const px = new Float32Array(N * N * 3);
    for (let i = 0, j = 0; i < raw.length; i += 4, j += 3) {
      const e = raw[i + 3];
      if (!e) continue;
      const s = Math.pow(2, e - 128 - 8) * exposure;
      px[j] = (raw[i] + 0.5) * s;
      px[j + 1] = (raw[i + 1] + 0.5) * s;
      px[j + 2] = (raw[i + 2] + 0.5) * s;
    }
    return px;
  });
  return (d) => {
    let best = 0, bd = -Infinity;
    for (let i = 0; i < 6; i++) {
      const v = dot(d, AXES[i].f);
      if (v > bd) (bd = v), (best = i);
    }
    const f = AXES[best];
    const s = dot(d, f.r) / bd, t = dot(d, f.u) / bd;
    const x = Math.min(N - 1, Math.max(0, ((s + 1) / 2) * N - 0.5));
    const y = Math.min(N - 1, Math.max(0, ((1 - t) / 2) * N - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
    const fx = x - x0, fy = y - y0, px = data[best];
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const p00 = px[(y0 * N + x0) * 3 + c], p10 = px[(y0 * N + x1) * 3 + c], p01 = px[(y1 * N + x0) * 3 + c], p11 = px[(y1 * N + x1) * 3 + c];
      out[c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
    }
    return out;
  };
}

const srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const enc = (w) => Math.round(255 * srgb(Math.max(0, w) / (1 + Math.max(0, w))));

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { rooms: {} };
const SS = 3;
for (const name of readdirSync(a.in).filter((n) => n.endsWith(".json") && n !== "lifts.json")) {
  const meta = JSON.parse(readFileSync(join(a.in, name), "utf8"));
  if (a.only && !a.only.split(",").includes(meta.id)) continue;
  const atlas = Buffer.alloc(W * H * 4, 255);
  meta.keys.forEach((key, ki) => {
    const look = cube(a.in, meta.id, key.id, meta.face, key.exposure);
    AXES.forEach((f, fi) => {
      const tx = (fi % 3) * TILE, ty = (Math.floor(fi / 3) + 2 * ki) * TILE;
      for (let py = 0; py < TILE; py++)
        for (let px = 0; px < TILE; px++) {
          const sum = [0, 0, 0];
          for (let sy = 0; sy < SS; sy++)
            for (let sx = 0; sx < SS; sx++) {
              const s = (2 * (px - G + (sx + 0.5) / SS)) / F - 1;
              const t = 1 - (2 * (py - G + (sy + 0.5) / SS)) / F;
              const d = [f.f[0] + s * f.r[0] + t * f.u[0], f.f[1] + s * f.r[1] + t * f.u[1], f.f[2] + s * f.r[2] + t * f.u[2]];
              const c = look(d);
              sum[0] += c[0];
              sum[1] += c[1];
              sum[2] += c[2];
            }
          const o = ((ty + py) * W + tx + px) * 4;
          for (let c = 0; c < 3; c++) atlas[o + c] = enc(sum[c] / (SS * SS));
        }
    });
  });
  const file = `${meta.id}.ktx2`;
  const ktx = await encodeToKTX2(new Uint8Array(1), {
    isUASTC: false, qualityLevel: 255, compressionLevel: 2,
    isPerceptual: true, isSetKTX2SRGBTransferFunc: true,
    generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({ width: W, height: H, data: new Uint8Array(atlas) }),
  });
  writeFileSync(join(OUT_DIR, file), ktx);
  console.log("wrote", file, ktx.length, "bytes");
  manifest.rooms[meta.id] = { file: `portal/${file}`, keys: meta.keys.map((k) => ({ id: k.id, time: k.time, exposure: +k.exposure.toFixed(4) })) };
  if (a.preview) await sharp(atlas, { raw: { width: W, height: H, channels: 4 } }).png().toFile(join(a.preview, `${meta.id}_atlas.png`));
}
manifest.rooms = Object.fromEntries(Object.entries(manifest.rooms).sort(([x], [y]) => x.localeCompare(y)));
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n");
console.log("wrote", MANIFEST);
