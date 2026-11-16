/**
 * scripts/patch-village-crosswalks.mjs — puts the corrected road texture into village.glb (fix/crosswalk-signals).
 *
 *   node scripts/patch-village-crosswalks.mjs <village.glb> --image <T_plaza.webp> [--out <other.glb>] [--dry]
 *
 * Why: the baked road/plaza texture (T_plaza, art/village/tools/make_textures.py plaza()) painted each lane's crossing as
 * a straight band along the lane's own direction, so where an oblique lane met the curved ring road two bands crossed in
 * a V / fan, and the bars ran the wrong way. plaza() now paints ONE zebra per crossing, perpendicular to the road
 * (crosswalk_mask), with the road's edge and centre lines broken only there. art/village/tools/post_crosswalk.py makes the
 * WebP for this script (the shipped image plus the repainted pixels' difference).
 *
 * What it does (idempotent; the village is NOT re-exported or re-baked): replaces the bytes of the image `T_plaza` and
 * nothing else. The light maps, every mesh (Draco bytes), material, other image and the moon patch are left as they
 * are. It then checks the result against the input: every other buffer view byte for byte, the JSON identical but for
 * the buffer-view offsets and the one view's length, and the new image a 2048 x 2048 WebP. Exit 1 if not.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGlb, writeGlb } from "./patch-village-moon.mjs";

const IMAGE_NAME = "T_plaza";

const viewBytes = (json, bin, i) => {
  const v = json.bufferViews[i];
  return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
};

/** Width and height of a WebP file (lossy VP8, lossless VP8L or extended VP8X); throws if it is not one. */
export function webpSize(b) {
  if (b.length < 30 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") throw new Error("not a WebP file");
  const kind = b.toString("latin1", 12, 16);
  if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === "VP8L") {
    const v = b.readUInt32LE(21);
    return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
  }
  if (kind === "VP8X") return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  throw new Error("unknown WebP chunk " + kind);
}

export function patchVillageCrosswalks(input, image) {
  const [w, h] = webpSize(image);
  if (w !== 2048 || h !== 2048) throw new Error(`the image is ${w} x ${h}, T_plaza is 2048 x 2048`);
  const { json, bin } = readGlb(input);
  const img = json.images.find((i) => i.name === IMAGE_NAME);
  if (!img) throw new Error(`no image ${IMAGE_NAME} in the file`);
  const view = img.bufferView;
  // lay the buffer views out again in index order (4-byte aligned), with the image's bytes replaced
  const out = JSON.parse(JSON.stringify(json));
  const parts = [];
  let off = 0;
  out.bufferViews.forEach((v, i) => {
    const bytes = i === view ? image : viewBytes(json, bin, i);
    const pad = (4 - (off % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    off += pad;
    v.byteOffset = off;
    v.byteLength = bytes.length;
    parts.push(Buffer.from(bytes));
    off += bytes.length;
  });
  const newBin = Buffer.concat(parts);
  out.buffers[0].byteLength = newBin.length;
  const result = writeGlb(out, newBin);

  // integrity: re-read the output and compare with the input
  const back = readGlb(result);
  const fail = (m) => {
    throw new Error("integrity check failed: " + m);
  };
  if (back.json.bufferViews.length !== json.bufferViews.length) fail("buffer view count");
  for (let i = 0; i < json.bufferViews.length; i++) {
    if (i === view) {
      if (!viewBytes(back.json, back.bin, i).equals(image)) fail("the image's bytes");
    } else if (!viewBytes(back.json, back.bin, i).equals(viewBytes(json, bin, i))) fail(`buffer view ${i} changed`);
  }
  const strip = (j) => {
    const c = JSON.parse(JSON.stringify(j));
    for (const v of c.bufferViews) {
      delete v.byteOffset;
      delete v.byteLength;
    }
    c.buffers[0].byteLength = 0;
    return JSON.stringify(c);
  };
  if (strip(back.json) !== strip(json)) fail("the JSON differs beyond buffer-view offsets and lengths");
  return { out: result, report: { view, was: viewBytes(json, bin, view).length, now: image.length } };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const file = args[0] && !args[0].startsWith("--") ? args[0] : null;
  const imgIdx = args.indexOf("--image");
  if (!file || imgIdx < 0) {
    console.error("usage: node scripts/patch-village-crosswalks.mjs <village.glb> --image <T_plaza.webp> [--out <other.glb>] [--dry]");
    process.exit(2);
  }
  const outIdx = args.indexOf("--out");
  const target = outIdx >= 0 ? args[outIdx + 1] : file;
  const input = readFileSync(file);
  try {
    const { out, report } = patchVillageCrosswalks(input, readFileSync(args[imgIdx + 1]));
    const same = out.equals(input);
    console.log(`${IMAGE_NAME} (buffer view ${report.view}): ${report.was} B -> ${report.now} B; every other buffer view identical`);
    console.log(`${file}: ${input.length} B -> ${out.length} B${same ? " (already patched: unchanged)" : ""}; check passed`);
    if (!args.includes("--dry") && !(same && target === file)) writeFileSync(target, out);
  } catch (err) {
    console.error(String(err?.stack ?? err));
    process.exit(1);
  }
}
