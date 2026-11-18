// Framed paintings / prints as sacred props (glTF +Y up, metres; origin bottom centre, back at z = 0, front +Z).
//   node build_framed_art.mjs <spec.json>
// spec: { "out": "<dir>", "items": [ { "name": "lotart__x", "src": "<image>", "crop": [x0,y0,x1,y1 fractions],
//         "frame": [outerW, outerH], "inset": 0.05, "tex": 768, "texPhone": 512, "mat": "oak" | "gilt" } ] }
// Writes <name>.glb (PC, tex px on the long side) and <name>_phone.glb (texPhone px): oak (library set M_pbr_wood_oak) or gilt frame,
// a recessed print, KTX2 ETC1S sRGB (KHR_texture_basisu). The frame's depth stands the print back from the wall.
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRTextureBasisu } from "@gltf-transform/extensions";
import sharp from "sharp";
import { encodeToKTX2 } from "ktx2-encoder";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
mkdirSync(spec.out, { recursive: true });
const ENC = { isUASTC: false, qualityLevel: 255, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true };

/** An axis-aligned box [x0,x1]x[y0,y1]x[z0,z1] with per-face metre UVs (front/back by x,y; sides by the long axes). Returns arrays. */
function box(x0, x1, y0, y1, z0, z1, out) {
  const faces = [
    { n: [0, 0, 1], v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], uv: (p) => [p[0], p[1]] },
    { n: [0, 0, -1], v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], uv: (p) => [p[0], p[1]] },
    { n: [1, 0, 0], v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], uv: (p) => [p[2], p[1]] },
    { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], uv: (p) => [p[2], p[1]] },
    { n: [0, 1, 0], v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], uv: (p) => [p[0], p[2]] },
    { n: [0, -1, 0], v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], uv: (p) => [p[0], p[2]] },
  ];
  for (const f of faces) {
    const b = out.pos.length / 3;
    for (const p of f.v) { out.pos.push(...p); out.nor.push(...f.n); out.uv.push(...f.uv(p)); }
    out.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

/** A picture frame: outer moulding ring (depth d), a stepped inner lip, the opening ow x oh. */
function frameGeometry(W, H, ow, oh, d, pz) {
  const o = { pos: [], nor: [], uv: [], idx: [] };
  const hx = W / 2, ox = ow / 2, ym = H;
  const mx = (W - ow) / 2, my = (H - oh) / 2;
  // outer ring: bottom, top, left, right (the sides run full height)
  box(-hx, hx, 0, my, 0, d, o); box(-hx, hx, H - my, H, 0, d, o);
  box(-hx, -ox, my, H - my, 0, d, o); box(ox, hx, my, H - my, 0, d, o);
  // raised outer bead (a step in front of the ring)
  const bz = d + 0.012, bw = mx * 0.28;
  box(-hx, hx, 0, bw, d, bz, o); box(-hx, hx, H - bw, H, d, bz, o); box(-hx, -hx + bw, bw, H - bw, d, bz, o); box(hx - bw, hx, bw, H - bw, d, bz, o);
  // inner lip (slightly proud of the print)
  const lw = 0.012, lz = pz + 0.008;
  box(-ox, ox, my, my + lw, pz - 0.03, lz, o); box(-ox, ox, H - my - lw, H - my, pz - 0.03, lz, o);
  box(-ox, -ox + lw, my + lw, H - my - lw, pz - 0.03, lz, o); box(ox - lw, ox, my + lw, H - my - lw, pz - 0.03, lz, o);
  return o;
}

async function ktx(buf, w, h) {
  const raw = await sharp(buf).ensureAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer();
  return encodeToKTX2(new Uint8Array(1), { ...ENC, generateMipmap: true, isKTX2File: true, isYFlip: false, imageDecoder: async () => ({ width: w, height: h, data: new Uint8Array(raw) }) });
}

for (const it of spec.items) {
  const [W, H] = it.frame;
  const inset = it.inset ?? 0.05;
  const ow = W - 2 * inset, oh = H - 2 * inset;
  const meta = await sharp(it.src).metadata();
  const [cx0, cy0, cx1, cy1] = it.crop ?? [0, 0, 1, 1];
  const crop = await sharp(it.src).extract({ left: Math.round(meta.width * cx0), top: Math.round(meta.height * cy0), width: Math.round(meta.width * (cx1 - cx0)), height: Math.round(meta.height * (cy1 - cy0)) }).linear(it.gain ?? 1, it.offset ?? 0).sharpen({ sigma: 0.6 }).toBuffer();
  for (const phone of [false, true]) {
    const long = phone ? it.texPhone ?? 512 : it.tex ?? 768;
    const tw = Math.max(4, Math.round(((ow / Math.max(ow, oh)) * long) / 4) * 4), th = Math.max(4, Math.round(((oh / Math.max(ow, oh)) * long) / 4) * 4);
    const doc = new Document();
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    const buf = doc.createBuffer();
    const scene = doc.createScene();
    const root = doc.createNode(it.name + (phone ? "_phone" : ""));
    scene.addChild(root);
    const d = it.depth ?? 0.07;
    const pz = it.printZ ?? d * 0.55 + 0.002;
    const g = frameGeometry(W, H, ow, oh, d, pz);
    const frameMat = it.mat === "gilt"
      ? doc.createMaterial("M_frame_gilt").setBaseColorFactor([0.86, 0.66, 0.30, 1]).setMetallicFactor(0.55).setRoughnessFactor(0.42)
      : doc.createMaterial("M_pbr_wood_oak").setBaseColorFactor([0.42, 0.27, 0.15, 1]).setMetallicFactor(0).setRoughnessFactor(0.55);
    const mk = (geo, mat, name) => {
      const prim = doc.createPrimitive().setMaterial(mat)
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.pos)).setBuffer(buf))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.nor)).setBuffer(buf))
        .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(geo.uv)).setBuffer(buf))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(geo.idx)).setBuffer(buf));
      return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
    };
    root.addChild(mk(g, frameMat, it.name + (phone ? "_phone" : "") + "_frame"));
    // the print: recessed, 0.5 cm behind the lip; baked light is not on it (the room's lamps light it)
    const pr = { pos: [-ow / 2, inset, pz, ow / 2, inset, pz, ow / 2, inset + oh, pz, -ow / 2, inset + oh, pz], nor: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [0, 1, 1, 1, 1, 0, 0, 0], idx: [0, 1, 2, 0, 2, 3] };
    const tex = doc.createTexture(it.name + "_print").setImage(await ktx(crop, tw, th)).setMimeType("image/ktx2");
    const printMat = doc.createMaterial("M_print_" + it.name).setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.62);
    root.addChild(mk(pr, printMat, it.name + (phone ? "_phone" : "") + "_print"));
    const io = new NodeIO().registerExtensions([KHRTextureBasisu]);
    const file = join(spec.out, it.name + (phone ? "_phone" : "") + ".glb");
    await io.write(file, doc);
    console.log(file, tw, th);
  }
}
