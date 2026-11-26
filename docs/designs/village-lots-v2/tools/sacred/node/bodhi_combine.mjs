// Combine the two 협시보살 lines (owner 2026-11-26: "둘 합쳐서"):
//   the shipped Codex face pack (bodhi_pack.mjs, 11-20: sculpted face, green brows, red lips, urna; blobs d9d0acc2 / c28e73ac)
//   + the 11-19 main-side fixes it was built without:
//       1e9d9abc  the scan's 3D-print pegs under the soles cut flat, the soles lifted onto the 연화대 cushion top (process_statue.py floor_cut .16, floor_lift .09)
//       9462bdd6  the body in the main Buddha's gold (bodhi_gild.mjs: the altar lamps' reflection baked in an emissive chart read through
//                 TEXCOORD_1 by reflected normal, emissive strength 2, roughness .16 / metal .98 in the ORM, base colour factor of the Buddha's leaf)
//       8cc728df  bodhi_gild's tint tuned to the Buddha's robe (TINT 1,.87,.55, GAIN 1.3, normal scale .7)
//   The painted face keeps its own textures; only its gold pixels (not the brows, lips, eyes, lashes) are moved from the deep
//   orange of the pass-14 facial oval to the robe's leaf (FACE_GAIN, linear per channel), in the base colour and in its baked light.
//
//   node bodhi_combine.mjs <in.glb (shipped Codex pack)> <out.glb> pc|phone
// (The finger rework of 1e9d9abc re-decimated the raw scan; the face pack's triangles are indexed against its own cast, so it is not carried over.)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { NodeBasisEncoder, encodeToKTX2 } from "ktx2-encoder";
import sharp from "sharp";

const [, , inPath, outPath, tier] = process.argv;
if (!outPath || !["pc", "phone"].includes(tier)) throw new Error("usage: bodhi_combine.mjs <in.glb> <out.glb> pc|phone");
const phone = tier === "phone";
const CUT = 0.16, LIFT = 0.09;
// bodhi_gild.mjs (8cc728df values)
const VIEW_Y = -.06 / Math.hypot(.06, 1), VIEW_Z = 1 / Math.hypot(.06, 1), STRENGTH = 2;
const TINT = (process.env.GILD_TINT ?? "1,.87,.55").split(",").map(Number), GAIN = Number(process.env.GILD_GAIN ?? 1.3);
const NORMAL_SCALE = Number(process.env.GILD_NORMAL ?? .7), ROUGH = Number(process.env.GILD_ROUGH ?? .16);
// the face's gold: Codex gilt (.94,.529,.074) -> the leaf of the robe (bodhi_gild base factor .77,.532,.116 = 1,.69,.15; B a little
// further, 2.3 not 1.9: the face's turned, darker planes read more saturated than the robe in the in-game frames)
const FACE_GAIN = (process.env.FACE_GAIN ?? "1,1.24,2.3").split(",").map(Number);
const FACE_LIGHT = Number(process.env.FACE_LIGHT ?? 1);
const clip = v => Math.min(1, Math.max(0, v));
const srgb = x => Math.round(255 * clip(x < .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055));
const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
const smooth = (a, b, x) => { const t = clip((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function reflectedDirection([x, y, z]) {
  const facing = y * VIEW_Y + z * VIEW_Z, front = clip((facing + .60) / .60);
  return [2 * x * facing, (2 * y * facing - VIEW_Y) * front, -1 + (2 * z * facing - VIEW_Z + 1) * front];
}
function radiance(y, z) { // bodhi_gild.mjs / buddha_leaf.mjs radiance(), finish = gold
  const x = Math.sqrt(Math.max(0, 1 - y * y - z * z));
  const key = Math.exp(4.1 * (Math.min(1, -.22 * (-.12 * x) + .48 * y + .85 * z) - 1));
  const bounce = Math.exp(3 * (Math.min(1, .84 * x - .30 * y + .30 * z) - 1));
  const side = Math.exp(-132 * (x - .67) ** 2 - 2.7 * (y - .14) ** 2) * (.48 + .52 * clip(z + .22));
  const lintel = Math.exp(-175 * (y - .37) ** 2) * clip((z + .07) / .78);
  const overhead = Math.exp(-138 * (y - .785) ** 2 - 3.8 * (z + .23) ** 2);
  const panel = Math.max(side, lintel, overhead), core = panel ** 3;
  const base = .078 + .215 * key + .088 * bounce, warm = phone ? .045 * (1 - panel) ** 2 : 0;
  return [1.11 * base + .72 * panel + .85 * core + warm, .77 * base + .59 * panel + .89 * core + .55 * warm, .25 * base + .27 * panel + core + .12 * warm];
}

const basis = await new NodeBasisEncoder().init();
function decode(texture) {
  const file = new basis.KTX2File(texture.getImage());
  try {
    if (!file.isValid() || !file.startTranscoding()) throw new Error("bad KTX2 " + texture.getName());
    const width = file.getWidth(), height = file.getHeight(), data = Buffer.alloc(width * height * 4);
    if (!file.transcodeImage(data, 0, 0, 0, basis.transcoder_texture_format.cTFRGBA32.value, 0, -1, -1)) throw new Error("transcode " + texture.getName());
    return { width, height, data };
  } finally { file.close(); file.delete(); }
}
const ENCODE = { // ktx2_glb.mjs settings
  color: { isUASTC: false, qualityLevel: 255, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  data: { isUASTC: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1, uastcLDRQualityLevel: 1 },
};
async function encode(texture, { width, height, data }, kind) {
  const ktx = await encodeToKTX2(new Uint8Array(1), { ...ENCODE[kind], generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({ width, height, data: new Uint8Array(data) }) });
  texture.setImage(ktx).setMimeType("image/ktx2");
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
const prims = root.listMeshes().flatMap(m => m.listPrimitives());
const body = prims.find(p => p.getMaterial().getName() === "Attendant satin gilt");
const face = prims.find(p => p.getMaterial().getName() === "bodhisattva_face_gilt");
if (!body || !face) throw new Error("expected the Codex face pack (Attendant satin gilt + bodhisattva_face_gilt)");

// 1. feet: the pegs below the soles fold flat into the sole plane, then the figure goes up onto the cushion top (y .09)
const report = { tier, clamped: 0, degenerate: 0 };
const seen = new Set();
for (const p of prims) {
  const pos = p.getAttribute("POSITION");
  if (seen.has(pos)) continue; seen.add(pos);
  const a = pos.getArray();
  for (let i = 1; i < a.length; i += 3) { if (a[i] < CUT) { a[i] = CUT; report.clamped++; } a[i] += LIFT - CUT; }
  pos.setArray(a);
}
{ // drop the collapsed peg walls (zero-area triangles)
  const pos = body.getAttribute("POSITION").getArray(), idx = body.getIndices().getArray(), keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]].map(v => 3 * v);
    const u = [0, 1, 2].map(c => pos[j + c] - pos[i + c]), v = [0, 1, 2].map(c => pos[k + c] - pos[i + c]);
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...cr) < 1e-9) { report.degenerate++; continue; }
    keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  body.getIndices().setArray(new (idx.constructor)(keep));
}

// 2. the body in the Buddha's leaf (bodhi_gild.mjs)
const mat = body.getMaterial();
const S = 256, chart = { width: S, height: S, data: Buffer.alloc(S * S * 4) };
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const ry = 2 * ((x + .5) / S - .5) * 1.05, rz = 2 * (.5 - (y + .5) / S) * 1.05, c = radiance(ry, rz);
  for (let k = 0; k < 3; k++) chart.data[4 * (x + y * S) + k] = srgb(c[k] * TINT[k] * GAIN / STRENGTH);
  chart.data[4 * (x + y * S) + 3] = 255;
}
const chartTex = doc.createTexture(tier + "-reflection");
await encode(chartTex, chart, "color");
const orm = mat.getMetallicRoughnessTexture(), o = decode(orm);
for (let i = 0; i < o.data.length; i += 4) { o.data[i + 1] = Math.round(255 * ROUGH); o.data[i + 2] = Math.round(255 * .98); o.data[i + 3] = 255; }
await encode(orm, o, "data");
mat.setBaseColorTexture(null).setBaseColorFactor(phone ? [.92, .674 * .80, .182 * .64, 1] : [.77, .674 * .79, .182 * .64, 1])
  .setEmissiveFactor([1, 1, 1]).setEmissiveTexture(chartTex).setNormalScale(NORMAL_SCALE).setMetallicFactor(1).setRoughnessFactor(1);
mat.getEmissiveTextureInfo().setTexCoord(1);
mat.setExtension("KHR_materials_emissive_strength", doc.createExtension(KHRMaterialsEmissiveStrength).createEmissiveStrength().setEmissiveStrength(STRENGTH));
mat.setName("Attendant gold leaf" + (phone ? "_phone" : ""));
{
  const n = body.getAttribute("NORMAL"), a = [0, 0, 0], uv = new Float32Array(n.getCount() * 2);
  for (let i = 0; i < n.getCount(); i++) {
    n.getElement(i, a); const l = Math.hypot(...a) || 1;
    const [, y, z] = reflectedDirection(a.map(v => v / l));
    uv[2 * i] = clip(.5 + y / 2.1); uv[2 * i + 1] = clip(.5 - z / 2.1);
  }
  body.setAttribute("TEXCOORD_1", doc.createAccessor().setType("VEC2").setArray(uv).setBuffer(root.listBuffers()[0]));
}

// 3. the face: its gold pixels to the robe's leaf, the paint untouched
const fm = face.getMaterial();
const goldMask = (r, g, b) => { // sRGB bytes -> 0..1 "this is gilt, not paint"
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
  if (mx === mn) return 0;
  let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h *= 60; if (h < 0) h += 360;
  return smooth(14, 24, h) * (1 - smooth(52, 64, h)) * smooth(.30, .45, s) * smooth(10, 30, mx);
};
for (const [tex, light] of [[fm.getBaseColorTexture(), 1], [fm.getEmissiveTexture(), FACE_LIGHT]]) {
  if (!tex) continue;
  const im = decode(tex);
  for (let i = 0; i < im.data.length; i += 4) {
    const w = goldMask(im.data[i], im.data[i + 1], im.data[i + 2]);
    if (!w) continue;
    for (let k = 0; k < 3; k++) im.data[i + k] = srgb(linear(im.data[i + k] / 255) * (1 + w * (FACE_GAIN[k] * light - 1)));
  }
  await encode(tex, im, "color");
}

await doc.transform(prune());
await io.write(outPath, doc);
console.log(JSON.stringify({ ...report, out: outPath }));
