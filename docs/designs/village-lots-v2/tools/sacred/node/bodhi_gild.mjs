// Dress the attendant bodhisattva in the main Buddha's gold (owner 2026-11-19: "협시보살의 색상을 불상과 같은 색으로"):
//   node bodhi_gild.mjs <in.glb (PNG textures, from process_statue.py)> <out.glb>   then   ktx2_glb.mjs as usual.
// The Buddha's leaf (buddha_leaf.mjs, buddha_mesh.py FINISHES "gold"): linear colour (1.0, .674, .182) x the file's colour factor,
// roughness .16, metal .98, and a reflection of the altar's lamps BAKED into the emissive map (the hall's env map reads black, so a
// polished metal shows only what is baked). Here the chart is one tile of the Buddha's atlas (radiance by reflected direction) and
// every vertex looks it up through TEXCOORD_1, exactly as the Buddha's body does. The ORM keeps its baked occlusion (R).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import sharp from "sharp";

const [, , inPath, outPath] = process.argv;
const VIEW_Y = -.06 / Math.hypot(.06, 1), VIEW_Z = 1 / Math.hypot(.06, 1), STRENGTH = 2;
// tuned against the Buddha in the same in-game frame (mean H/S/V of lit and mid-tone robe pixels, e2e bodhi_buddha view)
const TINT = (process.env.GILD_TINT ?? "1,.87,.55").split(",").map(Number), GAIN = Number(process.env.GILD_GAIN ?? 1.3), NORMAL_SCALE = Number(process.env.GILD_NORMAL ?? .7), ROUGH = Number(process.env.GILD_ROUGH ?? .16);
const clip = v => Math.min(1, Math.max(0, v));
const srgb = x => Math.round(255 * clip(x < .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055));
function reflectedDirection([x, y, z]) {
  const facing = y * VIEW_Y + z * VIEW_Z, front = clip((facing + .60) / .60);
  return [2 * x * facing, (2 * y * facing - VIEW_Y) * front, -1 + (2 * z * facing - VIEW_Z + 1) * front];
}
function radiance(y, z, phone) { // buddha_leaf.mjs radiance(), finish = gold
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
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
const mat = root.listMaterials()[0];
const orm = mat.getMetallicRoughnessTexture();
// chart (256 px; same mapping as the Buddha's atlas tiles)
const S = 256, chart = Buffer.alloc(S * S * 4);
const png = async phone => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ry = 2 * ((x + .5) / S - .5) * 1.05, rz = 2 * (.5 - (y + .5) / S) * 1.05;
    const c = radiance(ry, rz, phone);
    for (let k = 0; k < 3; k++) chart[4 * (x + y * S) + k] = srgb(c[k] * TINT[k] * GAIN / STRENGTH);
    chart[4 * (x + y * S) + 3] = 255;
  }
  return sharp(chart, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
};
// ORM: keep R (baked occlusion), G roughness .151, B metal .98 (linear values stored as-is in a Non-Color map)
const o = await sharp(Buffer.from(orm.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < o.data.length; i += 4) { o.data[i + 1] = Math.round(255 * ROUGH); o.data[i + 2] = Math.round(255 * .98); }
orm.setImage(await sharp(o.data, { raw: o.info }).png().toBuffer()).setMimeType("image/png");
// two emissive charts (the phone has no overhead spotlights: the Buddha's phone chart adds their warm return)
const pcTex = doc.createTexture("pc-reflection").setImage(await png(false)).setMimeType("image/png");
const phTex = doc.createTexture("phone-reflection").setImage(await png(true)).setMimeType("image/png");
const phoneMat = mat.clone(); // one material per LOD (colour factor and chart differ like the Buddha's)
mat.setBaseColorTexture(null).setBaseColorFactor([.77, .674 * .79, .182 * .64, 1]).setEmissiveFactor([1, 1, 1]).setEmissiveTexture(pcTex);
phoneMat.setBaseColorTexture(null).setBaseColorFactor([.92, .674 * .80, .182 * .64, 1]).setEmissiveFactor([1, 1, 1]).setEmissiveTexture(phTex);
for (const m of [mat, phoneMat]) {
  m.setNormalScale(NORMAL_SCALE);
  m.getEmissiveTextureInfo().setTexCoord(1);
  m.setExtension("KHR_materials_emissive_strength", doc.createExtension(KHRMaterialsEmissiveStrength).createEmissiveStrength().setEmissiveStrength(STRENGTH));
}
phoneMat.setName(mat.getName() + "_phone");
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const phone = node.getName().endsWith("_phone");
  for (const p of mesh.listPrimitives()) {
    const n = p.getAttribute("NORMAL"), a = [0, 0, 0], uv = new Float32Array(n.getCount() * 2);
    for (let i = 0; i < n.getCount(); i++) {
      n.getElement(i, a); const l = Math.hypot(...a) || 1;
      const [, y, z] = reflectedDirection(a.map(v => v / l));
      uv[2 * i] = clip(.5 + y / 2.1); uv[2 * i + 1] = clip(.5 - z / 2.1);
    }
    p.setAttribute("TEXCOORD_1", doc.createAccessor().setType("VEC2").setArray(uv).setBuffer(root.listBuffers()[0]));
    p.setMaterial(phone ? phoneMat : mat);
  }
}
await doc.transform(prune());
await io.write(outPath, doc);
console.log("gilded", outPath);
