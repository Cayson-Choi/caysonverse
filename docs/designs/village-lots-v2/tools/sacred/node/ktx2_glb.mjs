// GLB (PNG textures, from Blender) -> GLB with KTX2 (KHR_texture_basisu) textures, the repo's encoder settings
// (scripts/build-materials.mjs on feat/pbr-library): base colour / emissive ETC1S sRGB, normal / ORM UASTC + Zstd.
//   node art/sacred/tools/ktx2_glb.mjs <in.glb> <out.glb> [maxColour] [all|pc|phone] [maxNormalOrm]
// Prints a JSON line: triangles per mesh node, textures with size and the GPU MB they cost (1 byte/texel + mips).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import sharp from "sharp";
import { encodeToKTX2 } from "ktx2-encoder";
import { prune } from "@gltf-transform/functions";
import { writeFileSync } from "node:fs";

const [, , inPath, outPath, maxArg, modeArg, maxDataArg] = process.argv;
const MODE = modeArg || "all"; // "pc": drop *_phone nodes, "phone": keep only *_phone nodes
const MAX = Number(maxArg || 4096);
const MAX_DATA = Number(maxDataArg || MAX); // normal / ORM may be smaller than the colour map
const ENCODE = {
  color: { isUASTC: false, qualityLevel: 255, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  data: { isUASTC: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1, uastcLDRQualityLevel: 1 },
};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
for (const n of root.listNodes()) {
  const ph = n.getName().endsWith("_phone");
  if ((MODE === "pc" && ph) || (MODE === "phone" && !ph && n.getMesh())) n.dispose();
}
await doc.transform(prune());
const kindOf = new Map();
for (const m of root.listMaterials()) {
  for (const [t, k] of [
    [m.getBaseColorTexture(), "color"], [m.getEmissiveTexture(), "color"],
    [m.getNormalTexture(), "data"], [m.getMetallicRoughnessTexture(), "data"], [m.getOcclusionTexture(), "data"],
  ]) if (t) kindOf.set(t, kindOf.get(t) === "color" ? "color" : k);
}
doc.createExtension(KHRTextureBasisu).setRequired(true);
const report = { file: outPath, textures: [], meshes: [], gpuMB: 0 };
for (const tex of root.listTextures()) {
  const kind = kindOf.get(tex) || "color";
  let img = sharp(Buffer.from(tex.getImage())).ensureAlpha();
  const meta = await img.metadata();
  let w = meta.width, h = meta.height;
  const s = Math.min(1, (kind === "color" ? MAX : MAX_DATA) / Math.max(w, h));
  w = Math.max(4, Math.round((w * s) / 4) * 4); h = Math.max(4, Math.round((h * s) / 4) * 4);
  const raw = await img.resize(w, h, { fit: "fill" }).raw().toBuffer();
  const ktx = await encodeToKTX2(new Uint8Array(1), {
    ...ENCODE[kind], generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({ width: w, height: h, data: new Uint8Array(raw) }),
  });
  tex.setImage(ktx).setMimeType("image/ktx2");
  if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(png|jpe?g)$/i, ".ktx2"));
  const mb = (w * h * 4) / 3 / 1048576;
  report.gpuMB += mb;
  report.textures.push({ name: tex.getName(), kind, w, h, kb: Math.round(ktx.length / 1024), gpuMB: +mb.toFixed(2) });
}
for (const n of root.listNodes()) {
  const mesh = n.getMesh(); if (!mesh) continue;
  let tris = 0;
  for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
  report.meshes.push({ node: n.getName(), tris });
}
report.gpuMB = +report.gpuMB.toFixed(2);
await io.write(outPath, doc);
const { statSync } = await import("node:fs");
report.bytes = statSync(outPath).size;
console.log("REPORT " + JSON.stringify(report));
