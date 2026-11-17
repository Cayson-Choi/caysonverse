#!/usr/bin/env node
/**
 * M1 PBR material library builder (케이슨 마을 실사화, art-director PLAN.md section 3 / M1).
 *
 *   npm --prefix art/materials/tools ci            # once: sharp + ktx2-encoder (wasm Basis encoder) + fflate
 *   node scripts/build-materials.mjs                # download what is missing, build every set, both tiers
 *   node scripts/build-materials.mjs --only grass,asphalt --tiers 1k --offline
 *
 * For every set in art/materials/materials.json it:
 *  1. downloads the CC0 source once into art/materials/src/<provider>_<asset>/ (Poly Haven: 2K diffuse JPG,
 *     OpenGL normal PNG, packed ARM JPG via https://api.polyhaven.com; ambientCG: the 2K-JPG zip via
 *     https://ambientcg.com/get). art/ is git-ignored, so sources never reach the public repo; the URL, md5 and
 *     license are recorded in the generated manifest and docs/licenses.md.
 *  2. builds three maps per tier: albedo (sRGB), normal (OpenGL +Y, renormalised after every resample) and ORM
 *     (R = ambient occlusion, G = roughness, B = metalness: three.js reads aoMap.r, roughnessMap.g, metalnessMap.b,
 *     so ONE texture serves all three slots). Optional per-set processing (desaturate, recolour, derive a normal /
 *     roughness / AO from the albedo) comes from the manifest.
 *  3. makes every map tileable: it measures the wrap seam (mean |difference| across the wrap edge vs between
 *     neighbouring texels inside) and, when a seam stands out, cross-fades the borders with a half-offset copy.
 *  4. encodes KTX2 (Basis Universal) with a full mip chain: albedo ETC1S (sRGB), normal and ORM UASTC + RDO + Zstd
 *     (linear). Tiers: "2k" (PC, 화려하게) and "1k" (phone, 가볍게).
 *  5. writes client/public/textures/pbr/<tier>/<id>_<map>.ktx2, copies the Basis transcoder that matches the
 *     installed three into client/public/textures/pbr/basis/, and writes the typed manifest
 *     client/src/village/pbr/pbrManifest.generated.ts (sizes, hashes for cache-busting, tile size, colour spaces)
 *     plus art/materials/build-report.json (seam metrics, mean colours, timings).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAT_DIR = join(ROOT, "art", "materials");
const SRC_DIR = join(MAT_DIR, "src");
const TOOLS = join(MAT_DIR, "tools", "node_modules");
const OUT_DIR = join(ROOT, "client", "public", "textures", "pbr");
const GEN_TS = join(ROOT, "client", "src", "village", "pbr", "pbrManifest.generated.ts");
const UA = { "User-Agent": "caysonverse-material-build/1.0" };

const TIERS = { "2k": 2048, "1k": 1024 };

// ───────────────────────── args ─────────────────────────
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ONLY = arg("only")?.split(",").filter(Boolean);
const TIER_LIST = (arg("tiers") ?? "2k,1k").split(",").filter((t) => t in TIERS);
const OFFLINE = argv.includes("--offline");
const MANIFEST_ONLY = argv.includes("--manifest-only");
const CHECK_SEAMS = argv.includes("--check-seams"); // print the seam metrics at 1K, write nothing

const tool = async (name, sub = "") => {
  const pkgDir = join(TOOLS, name);
  if (!existsSync(pkgDir)) throw new Error(`missing build tool ${name}: run  npm --prefix art/materials/tools ci`);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  let entry;
  const exp = pkg.exports?.[sub ? `./${sub}` : "."] ?? pkg.exports;
  if (typeof exp === "string") entry = exp;
  else if (exp) entry = exp.node?.import ?? exp.import?.default ?? exp.import ?? exp.default?.import ?? exp.default;
  if (typeof entry !== "string") entry = pkg.module ?? pkg.main ?? "index.js";
  return import(pathToFileURL(join(pkgDir, entry)).href);
};

// ───────────────────────── download ─────────────────────────
async function fetchBuf(url) {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
const md5 = (buf) => createHash("md5").update(buf).digest("hex");

/** Returns { files: {albedo, normal, arm?|rough?, ao?, metal?}, sourceFiles: [{url, md5, bytes}], page } */
async function ensureSource(set) {
  const { provider, asset } = set.source;
  const dir = join(SRC_DIR, `${provider}_${asset}`);
  const meta = join(dir, "source.json");
  if (existsSync(meta)) return JSON.parse(readFileSync(meta, "utf8"));
  if (OFFLINE) throw new Error(`${set.id}: source not downloaded and --offline given`);
  mkdirSync(dir, { recursive: true });
  const out = { provider, asset, files: {}, sourceFiles: [], license: "CC0 1.0 Universal" };
  if (provider === "polyhaven") {
    out.page = `https://polyhaven.com/a/${asset}`;
    const files = JSON.parse((await fetchBuf(`https://api.polyhaven.com/files/${asset}`)).toString("utf8"));
    const info = JSON.parse((await fetchBuf(`https://api.polyhaven.com/info/${asset}`)).toString("utf8"));
    out.dimensionsMm = info.dimensions ?? null;
    out.authors = Object.keys(info.authors ?? {});
    const pick = [
      ["albedo", "Diffuse", "jpg"],
      ["normal", "nor_gl", "png"],
      ["arm", "arm", "jpg"],
    ];
    for (const [key, map, fmt] of pick) {
      const f = files[map]?.["2k"]?.[fmt];
      if (!f) throw new Error(`${asset}: no 2k ${fmt} for ${map}`);
      const buf = await fetchBuf(f.url);
      if (md5(buf) !== f.md5) throw new Error(`${asset}: md5 mismatch for ${map}`);
      const name = f.url.split("/").pop();
      writeFileSync(join(dir, name), buf);
      out.files[key] = name;
      out.sourceFiles.push({ url: f.url, md5: f.md5, bytes: buf.length });
    }
  } else if (provider === "ambientcg") {
    out.page = `https://ambientcg.com/view?id=${asset}`;
    const url = `https://ambientcg.com/get?file=${asset}_2K-JPG.zip`;
    const zip = await fetchBuf(url);
    out.sourceFiles.push({ url, md5: md5(zip), bytes: zip.length });
    const { unzipSync } = await tool("fflate");
    const entries = unzipSync(new Uint8Array(zip));
    const want = {
      albedo: /_Color\.jpg$/i,
      normal: /_NormalGL\.jpg$/i,
      rough: /_Roughness\.jpg$/i,
      ao: /_AmbientOcclusion\.jpg$/i,
      metal: /_Metalness\.jpg$/i,
    };
    for (const [name, data] of Object.entries(entries)) {
      for (const [key, re] of Object.entries(want)) {
        if (re.test(name) && !name.includes("/")) {
          writeFileSync(join(dir, name), data);
          out.files[key] = name;
        }
      }
    }
    for (const key of ["albedo", "normal", "rough"])
      if (!out.files[key]) throw new Error(`${asset}: zip has no ${key} map (${Object.keys(entries).join(", ")})`);
  } else {
    throw new Error(`unknown provider ${provider}`);
  }
  writeFileSync(meta, JSON.stringify(out, null, 2));
  return out;
}

// ───────────────────────── raster helpers (Float32, 0..1) ─────────────────────────
let sharp;
async function loadImage(path, size, channels) {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .resize(size, size, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = size * size;
  const out = new Float32Array(n * channels);
  const c = info.channels;
  for (let i = 0; i < n; i++) for (let k = 0; k < channels; k++) out[i * channels + k] = data[i * c + Math.min(k, c - 1)] / 255;
  return out;
}
const lumaAt = (img, i) => 0.2126 * img[i * 3] + 0.7152 * img[i * 3 + 1] + 0.0722 * img[i * 3 + 2];

function processAlbedo(img, n, opt = {}) {
  const lift = opt.lift ?? 0;
  const contrast = opt.contrast ?? 1;
  const sat = opt.saturation ?? 1;
  let meanL = 0;
  for (let i = 0; i < n; i++) meanL += lumaAt(img, i);
  meanL /= n;
  for (let i = 0; i < n; i++) {
    const l = lumaAt(img, i);
    for (let k = 0; k < 3; k++) {
      let v = img[i * 3 + k];
      v = l + (v - l) * sat;
      v = meanL + (v - meanL) * contrast + lift;
      img[i * 3 + k] = v;
    }
  }
  if (opt.recolor) {
    // keep the texture's light/dark variation, move its mean colour to `recolor` (sRGB 0..1)
    let m = 0;
    for (let i = 0; i < n; i++) m += lumaAt(img, i);
    m /= n;
    for (let i = 0; i < n; i++) {
      const l = lumaAt(img, i) / m;
      for (let k = 0; k < 3; k++) img[i * 3 + k] = opt.recolor[k] * l;
    }
  }
  for (let i = 0; i < img.length; i++) img[i] = Math.min(1, Math.max(0, img[i]));
}

function heightFromAlbedo(img, size, blurPasses) {
  const n = size * size;
  let h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = lumaAt(img, i);
  for (let p = 0; p < blurPasses; p++) {
    const t = new Float32Array(n);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        t[y * size + x] = s / 9;
      }
    h = t;
  }
  return h;
}

function normalFromHeight(h, size, strength) {
  const out = new Float32Array(size * size * 3);
  // strength is in "height units per texel at 2K"; keep the slope the same at 1K
  const s = strength * (size / 2048) * 8;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = (xx, yy) => h[((yy + size) % size) * size + ((xx + size) % size)];
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
      const dRow = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
      // OpenGL convention: +Y (green) points toward the top of the image (v up); image rows grow downward.
      let nx = -dx * s;
      let ny = dRow * s;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 3;
      out[i] = (nx / l) * 0.5 + 0.5;
      out[i + 1] = (ny / l) * 0.5 + 0.5;
      out[i + 2] = (nz / l) * 0.5 + 0.5;
    }
  return out;
}

function renormalize(nrm, n) {
  for (let i = 0; i < n; i++) {
    let x = nrm[i * 3] * 2 - 1;
    let y = nrm[i * 3 + 1] * 2 - 1;
    let z = Math.max(0, nrm[i * 3 + 2] * 2 - 1);
    const l = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = (x / l) * 0.5 + 0.5;
    nrm[i * 3 + 1] = (y / l) * 0.5 + 0.5;
    nrm[i * 3 + 2] = (z / l) * 0.5 + 0.5;
  }
}

/**
 * Wrap-seam ratio per axis: the mean |difference| between the last and the first column (x) / row (y), divided by the
 * 99.5th percentile of the same measure between every pair of neighbouring columns / rows inside the image. A real seam
 * stands out above everything inside (ratio well over 1); a plank or tile joint that happens to sit on the edge is just
 * as strong as the joints inside, so it stays near 1 and is left alone (blending it would ghost a double joint).
 */
function seamRatio(img, size, ch) {
  const L = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) L[i] = ch === 3 ? 0.2126 * img[i * 3] + 0.7152 * img[i * 3 + 1] + 0.0722 * img[i * 3 + 2] : img[i * ch];
  const line = (axis, a, b) => {
    let d = 0;
    for (let k = 0; k < size; k++) d += axis === "x" ? Math.abs(L[k * size + a] - L[k * size + b]) : Math.abs(L[a * size + k] - L[b * size + k]);
    return d / size;
  };
  const out = {};
  for (const axis of ["x", "y"]) {
    const inner = [];
    for (let a = 0; a < size - 1; a++) inner.push(line(axis, a, a + 1));
    inner.sort((p, q) => p - q);
    const p995 = inner[Math.floor(inner.length * 0.995)] || 1e-6;
    out[axis] = line(axis, size - 1, 0) / p995;
  }
  return out;
}

/** Cross-fade the border band with a half-offset copy (whose wrap edge is the image's continuous middle). */
function makeTileable(img, size, ch, axis, band) {
  const half = size >> 1;
  const src = img.slice();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = axis === "x" ? Math.min(x, size - 1 - x) : Math.min(y, size - 1 - y);
      if (d >= band) continue;
      const w = 0.5 * (1 + Math.cos((Math.PI * d) / band)); // 1 at the edge -> 0 at the band's inner end
      const sx = axis === "x" ? (x + half) % size : x;
      const sy = axis === "y" ? (y + half) % size : y;
      for (let k = 0; k < ch; k++) {
        const i = (y * size + x) * ch + k;
        img[i] = src[i] * (1 - w) + src[(sy * size + sx) * ch + k] * w;
      }
    }
}

function toRGBA8(img, n, ch) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(Math.min(1, Math.max(0, img[i * ch + Math.min(k, ch - 1)])) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

const meanRGB = (img, n, ch) => {
  const m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) m[k] += img[i * ch + Math.min(k, ch - 1)];
  return m.map((v) => +(v / n).toFixed(4));
};

// ───────────────────────── build one set at one size ─────────────────────────
const SEAM_LIMIT = 1.5;

async function buildMaps(set, src, size) {
  const dir = join(SRC_DIR, `${src.provider}_${src.asset}`);
  const f = (k) => join(dir, src.files[k]);
  const n = size * size;
  const proc = set.process ?? {};
  const report = { seams: {}, fixed: [] };

  const albedo = await loadImage(f("albedo"), size, 3);
  processAlbedo(albedo, n, proc.albedo);

  let normal;
  if (proc.deriveNormalFromAlbedo) {
    const h = heightFromAlbedo(albedo, size, Math.max(0, Math.round((proc.deriveNormalFromAlbedo.blur ?? 0.5) * 2)));
    normal = normalFromHeight(h, size, proc.deriveNormalFromAlbedo.strength ?? 1);
  } else {
    normal = await loadImage(f("normal"), size, 3);
    renormalize(normal, n);
  }

  const orm = new Float32Array(n * 3);
  if (src.files.arm) {
    const arm = await loadImage(f("arm"), size, 3);
    orm.set(arm);
  } else {
    const rough = await loadImage(f("rough"), size, 1);
    const ao = src.files.ao ? await loadImage(f("ao"), size, 1) : null;
    const metal = src.files.metal ? await loadImage(f("metal"), size, 1) : null;
    for (let i = 0; i < n; i++) {
      orm[i * 3] = ao ? ao[i] : 1;
      orm[i * 3 + 1] = rough[i];
      orm[i * 3 + 2] = metal ? metal[i] : 0;
    }
  }
  if (proc.deriveRoughnessFromAlbedo || proc.deriveAoFromAlbedo) {
    let mean = 0, sq = 0;
    for (let i = 0; i < n; i++) {
      const l = lumaAt(albedo, i);
      mean += l;
      sq += l * l;
    }
    mean /= n;
    const sd = Math.sqrt(Math.max(1e-6, sq / n - mean * mean));
    for (let i = 0; i < n; i++) {
      const z = (lumaAt(albedo, i) - mean) / sd; // ~N(0,1)
      if (proc.deriveRoughnessFromAlbedo) {
        const r = proc.deriveRoughnessFromAlbedo;
        orm[i * 3 + 1] = r.base + Math.max(-1, Math.min(1, z / 2)) * (r.range / 2);
      }
      if (proc.deriveAoFromAlbedo) {
        orm[i * 3] = 1 - proc.deriveAoFromAlbedo.strength * Math.max(0, Math.min(1, -z / 2.5));
      }
    }
  }

  // ORM corrections from the manifest: a roughness remap (r * scale + offset) and a fixed metalness (paint is a dielectric)
  if (proc.roughness || proc.metalness !== undefined) {
    for (let i = 0; i < n; i++) {
      if (proc.roughness) orm[i * 3 + 1] = Math.min(1, Math.max(0.04, orm[i * 3 + 1] * (proc.roughness.scale ?? 1) + (proc.roughness.offset ?? 0)));
      if (proc.metalness !== undefined) orm[i * 3 + 2] = proc.metalness;
    }
  }

  // tileability: measure on the albedo, fix every map on the same axis so they stay registered
  const s0 = seamRatio(albedo, size, 3);
  report.seams.before = { x: +s0.x.toFixed(2), y: +s0.y.toFixed(2) };
  const band = Math.round(size / 16);
  for (const axis of ["x", "y"]) {
    // an atlas (process.atlas: dancheong_wood, lots v2 B3) is laid out in regions, never wrapped: leave its edges alone
    if (s0[axis] > SEAM_LIMIT && !proc.atlas) {
      makeTileable(albedo, size, 3, axis, band);
      makeTileable(normal, size, 3, axis, band);
      makeTileable(orm, size, 3, axis, band);
      report.fixed.push(axis);
    }
  }
  if (report.fixed.length) renormalize(normal, n);
  const s1 = seamRatio(albedo, size, 3);
  report.seams.after = { x: +s1.x.toFixed(2), y: +s1.y.toFixed(2) };
  report.meanAlbedo = meanRGB(albedo, n, 3);
  report.meanOrm = meanRGB(orm, n, 3);
  return { albedo: toRGBA8(albedo, n, 3), normal: toRGBA8(normal, n, 3), orm: toRGBA8(orm, n, 3), report };
}

// ───────────────────────── KTX2 encode ─────────────────────────
let encodeToKTX2;
const ENCODE = {
  // ETC1S keeps colour well (mean exact, ~7% less micro-contrast) at a fifth of UASTC's size.
  albedo: { isUASTC: false, qualityLevel: 255, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  // Normals and ORM MUST be UASTC: ETC1S turned asphalt relief into 4x4 mush (PSNR 26 vs 34 dB) and erased the
  // roughness speckle that makes highlights glint. RDO lambda 1 + Zstd: -40% on structured maps (pavers 1064 -> 636 KB,
  // PSNR 43.6 -> 39.9 dB, no visible change); lambda 2 started to show 4x4 blocks along joints, so 1 it is.
  normal: { isUASTC: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1, uastcLDRQualityLevel: 1 },
  orm: { isUASTC: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1, uastcLDRQualityLevel: 1 },
};

/**
 * Which maps are written at which size (repo/download budget: UASTC is ~1 byte/texel before Zstd): albedo at 2K and 1K;
 * normal and ORM at 1K, plus a 2K normal only where the manifest asks (`normal2k`: the paving the player looks down at
 * all the time). The PC tier falls back to the 1K file where there is no 2K one (client pbrFileTier).
 */
function wantMap(set, tier, kind) {
  if (kind === "albedo") return true;
  if (kind === "orm") return tier === "1k";
  return tier === "1k" || !!set.normal2k;
}
async function encode(rgba, size, kind) {
  const raster = { width: size, height: size, data: rgba };
  return encodeToKTX2(new Uint8Array(1), {
    ...ENCODE[kind],
    generateMipmap: true,
    isKTX2File: true,
    isYFlip: false,
    imageDecoder: async () => raster,
  });
}

// ───────────────────────── main ─────────────────────────
async function main() {
  const manifest = JSON.parse(readFileSync(join(MAT_DIR, "materials.json"), "utf8"));
  const sets = manifest.sets.filter((s) => !ONLY || ONLY.includes(s.id));
  if (!sets.length) throw new Error("no sets selected");
  const reportPath = join(MAT_DIR, "build-report.json");
  const prevReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : { sets: {} };

  if (!MANIFEST_ONLY) {
    sharp = (await tool("sharp")).default;
    sharp.concurrency(2);
    ({ encodeToKTX2 } = await tool("ktx2-encoder"));
  }

  for (const set of sets) {
    const t0 = Date.now();
    const src = await ensureSource(set);
    const rep = (prevReport.sets[set.id] = { ...(prevReport.sets[set.id] ?? {}), source: src });
    if (MANIFEST_ONLY) continue;
    if (CHECK_SEAMS) {
      const m = await buildMaps(set, src, 1024);
      console.log(`${set.id.padEnd(18)} seam ${JSON.stringify(m.report.seams.before)}${m.report.fixed.length ? " -> fix " + m.report.fixed.join("") : ""}`);
      continue;
    }
    for (const tier of TIER_LIST) {
      const size = TIERS[tier];
      const maps = await buildMaps(set, src, size);
      mkdirSync(join(OUT_DIR, tier), { recursive: true });
      const files = {};
      for (const kind of ["albedo", "normal", "orm"]) {
        if (!wantMap(set, tier, kind)) continue;
        const ktx = await encode(maps[kind], size, kind);
        const file = join(OUT_DIR, tier, `${set.id}_${kind}.ktx2`);
        writeFileSync(file, ktx);
        files[kind] = ktx.length;
      }
      rep[tier] = { ...maps.report, bytes: files };
      console.log(
        `${set.id.padEnd(18)} ${tier}  albedo ${(files.albedo / 1024).toFixed(0)} KB  normal ${(files.normal / 1024).toFixed(0)} KB  orm ${(files.orm / 1024).toFixed(0)} KB  seam ${JSON.stringify(maps.report.seams.before)}${maps.report.fixed.length ? " fixed " + maps.report.fixed.join("") : ""}`,
      );
    }
    rep.seconds = Math.round((Date.now() - t0) / 1000);
  }
  if (CHECK_SEAMS) return;
  // merge into the report on disk as it is NOW (another build process may have finished other sets meanwhile)
  const latest = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : { sets: {} };
  for (const set of sets) latest.sets[set.id] = prevReport.sets[set.id];
  writeFileSync(reportPath, JSON.stringify(latest, null, 2));

  // the transcoder that matches the installed three (KTX2Loader.setTranscoderPath("/textures/pbr/basis/"))
  const basisSrc = join(ROOT, "node_modules", "three", "examples", "jsm", "libs", "basis");
  mkdirSync(join(OUT_DIR, "basis"), { recursive: true });
  for (const name of ["basis_transcoder.js", "basis_transcoder.wasm"]) copyFileSync(join(basisSrc, name), join(OUT_DIR, "basis", name));

  writeGenerated(manifest, latest);
}

function writeGenerated(manifest, report) {
  const entries = [];
  for (const set of manifest.sets) {
    const src = report.sets[set.id]?.source;
    const tiers = {};
    for (const tier of Object.keys(TIERS)) {
      const t = {};
      for (const kind of ["albedo", "normal", "orm"]) {
        const p = join(OUT_DIR, tier, `${set.id}_${kind}.ktx2`);
        if (!wantMap(set, tier, kind) || !existsSync(p)) continue;
        const buf = readFileSync(p);
        t[kind] = { bytes: buf.length, hash: md5(buf).slice(0, 10) };
      }
      if (Object.keys(t).length) tiers[tier] = t;
    }
    entries.push({
      id: set.id,
      label: set.label,
      group: set.group,
      use: set.use,
      tileMeters: set.tileMeters,
      tileEstimated: !!set.tileEstimated,
      density: set.density,
      source: src ? { provider: src.provider, asset: src.asset, page: src.page, license: src.license } : null,
      meanAlbedo: report.sets[set.id]?.["2k"]?.meanAlbedo ?? null,
      meanOrm: report.sets[set.id]?.["2k"]?.meanOrm ?? null,
      tiers,
    });
  }
  const body = `// GENERATED by scripts/build-materials.mjs from art/materials/materials.json — do not edit by hand.
// One entry per PBR set: files live at /textures/pbr/<tier>/<id>_<map>.ktx2 (albedo sRGB ETC1S; normal and ORM linear UASTC).
import type { PbrSetInfo } from "./pbrTypes";

export const PBR_SETS: readonly PbrSetInfo[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  mkdirSync(dirname(GEN_TS), { recursive: true });
  writeFileSync(GEN_TS, body);
  let total = { "2k": 0, "1k": 0 };
  for (const e of entries) for (const [t, m] of Object.entries(e.tiers)) for (const v of Object.values(m)) total[t] += v.bytes;
  writeReadmeTable(entries);
  console.log(`manifest: ${entries.length} sets; payload 2k ${(total["2k"] / 1048576).toFixed(1)} MB, 1k ${(total["1k"] / 1048576).toFixed(1)} MB`);
}

/** Rewrites the set table of art/materials/README.md between its markers (sizes, densities, sources). */
function writeReadmeTable(entries) {
  const readme = join(MAT_DIR, "README.md");
  if (!existsSync(readme)) return;
  const kb = (n) => (n ? `${Math.round(n / 1024)}` : "-");
  const rows = entries.map((e) => {
    const t1 = e.tiers["1k"] ?? {};
    const t2 = e.tiers["2k"] ?? {};
    const pxm = (px) => Math.round(px / e.tileMeters);
    const dens = `${pxm(2048)} / ${pxm(1024)}${e.density ? ` (목표 ${e.density})` : ""}`;
    const src = e.source ? `[${e.source.provider} ${e.source.asset}](${e.source.page})` : "-";
    return `| \`${e.id}\` | ${e.label} | ${e.use} | ${e.tileMeters}${e.tileEstimated ? " (추정)" : ""} | ${dens} | ${kb(t2.albedo?.bytes)} / ${kb(t2.normal?.bytes)} | ${kb(t1.albedo?.bytes)} / ${kb(t1.normal?.bytes)} / ${kb(t1.orm?.bytes)} | ${src} |`;
  });
  const table = [
    "| id | 이름 | 쓰는 곳 | 타일 크기 (m) | px/m PC / 폰 | 2K 파일 KB (albedo / normal) | 1K 파일 KB (albedo / normal / ORM) | 출처 (CC0) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
  const text = readFileSync(readme, "utf8");
  const a = text.indexOf("<!-- sets:start -->");
  const b = text.indexOf("<!-- sets:end -->");
  if (a < 0 || b < 0) return;
  writeFileSync(readme, text.slice(0, a) + "<!-- sets:start -->\n" + table + "\n" + text.slice(b));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
