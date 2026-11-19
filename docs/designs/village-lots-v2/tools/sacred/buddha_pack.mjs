/** Finish the original hall Buddha after the Blender build.
 * node buddha_pack.mjs <build-directory> <sacred-GLB-directory> [--preserve-from|--face-oval-only-from|--face-and-scalp-from|--portrait-from|--scalp-only-from|--preserve-ears-from|--preserve-head-from|--textures-only-from <prior-GLB-directory>]
 * For a face revision, pass the shipped pair's directory to --preserve-from.
 * For a registered face with an approved urna, --face-oval-only-from keeps the original jewel and its baked shading.
 * For a hairline revision, --face-and-scalp-from also replaces the cast curls over the facial oval.
 * For a portrait revision, --portrait-from replaces the facial oval, urna, ears and curls together.
 * For a curl-only revision, --scalp-only-from retains the shipped facial oval and all KTX2 atlases.
 * For an ear revision, --preserve-ears-from keeps the shipped face, body and KTX2 textures.
 * For a full head revision, --preserve-head-from retains the body and ears around the new throat, face and hair.
 * For a finish revision, --textures-only-from puts the new atlases on the exact shipped geometry, including its meshopt fallback.
 * It can also be the destination. Both LODs are built before either file is replaced.
 * Uses the locked KTX2 settings from sacred/node. The room loader needs the meshopt
 * extension's core fallback. Both paths carry the same faces and vertex attributes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { dressBuddhaLeaf } from "./node/buddha_leaf.mjs";
import { preserveSurroundingStatue } from "./buddha_preserve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [work, destination, flag, seedDirectory, ...extra] = process.argv.slice(2);
const regions = new Map([["--preserve-from", "face"], ["--face-oval-only-from", "oval"], ["--face-and-scalp-from", "oval-and-scalp"],
  ["--scalp-only-from", "scalp"], ["--preserve-ears-from", "ears"], ["--preserve-head-from", "head"],
  ["--portrait-from", "portrait"]]);
const texturesOnly = flag === "--textures-only-from";
if (!work || !destination || (flag && ((!texturesOnly && !regions.has(flag)) || !seedDirectory)) || extra.length) {
  throw new Error("Expected build directory, sacred GLB directory and an optional preservation flag and source directory");
}
const align = (n) => Math.ceil(n / 4) * 4;
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);

function readGlb(file) {
  const input = Buffer.isBuffer(file) ? file : readFileSync(file);
  const jsonLength = input.readUInt32LE(12);
  const doc = JSON.parse(input.toString("utf8", 20, 20 + jsonLength));
  return { doc, binary: input.subarray(28 + jsonLength) };
}

function compressGeometry(file) {
  const { doc, binary: original } = readGlb(file);
  const chunks = [original];
  let offset = original.length;
  const extension = "EXT_meshopt_compression";
  for (const [index, view] of doc.bufferViews.entries()) {
    const attr = doc.accessors.find((a) => a.bufferView === index);
    if (!attr) continue;
    const count = attr.count;
    const mode = view.target === 34963 ? "TRIANGLES" : "ATTRIBUTES";
    const stride = mode === "TRIANGLES" ? ({5123: 2, 5125: 4})[attr.componentType] : view.byteStride;
    const used = count * stride;
    // An odd number of 16-bit indices can leave two trailing alignment bytes.
    if (!stride || used > view.byteLength || view.byteLength - used > 3) throw new Error("Unexpected view layout");
    view.byteLength = used;
    const start = view.byteOffset || 0;
    const raw = original.subarray(start, start + view.byteLength);
    const encoded = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode, 0);
    const decoded = Buffer.alloc(raw.length);
    MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, encoded, mode);
    if (mode === "ATTRIBUTES") {
      if (!decoded.equals(raw)) throw new Error("Vertex data did not round-trip");
    } else {
      for (let i = 0; i < count; i += 3) {
        const a = [0, 1, 2].map((j) => raw.readUIntLE((i+j)*stride, stride));
        const b = [0, 1, 2].map((j) => decoded.readUIntLE((i+j)*stride, stride));
        if (![0, 1, 2].some((s) => b.every((v, j) => v === a[(s+j)%3]))) throw new Error("Triangle winding changed");
      }
    }
    view.extensions ??= {};
    view.extensions[extension] = {buffer: 0, byteOffset: offset, byteLength: encoded.length,
      byteStride: stride, count, mode};
    chunks.push(encoded, Buffer.alloc(align(encoded.length) - encoded.length));
    offset += align(encoded.length);
  }
  (doc.extensionsUsed ??= []).push(extension);
  return encodeGlb(doc, chunks, offset);
}

function encodeGlb(doc, chunks, offset) {
  doc.buffers[0].byteLength = offset;
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPadded = Buffer.alloc(align(json.length), 32);
  json.copy(jsonPadded);
  const header = Buffer.alloc(20);
  header.write("glTF"); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonPadded.length + offset, 8);
  header.writeUInt32LE(jsonPadded.length, 12); header.write("JSON", 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(offset, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonPadded, binaryHeader, ...chunks]);
}

function coreAtlases(shipped, finish) {
  const replacements = new Map();
  for (const image of finish.doc.images) {
    const original = shipped.doc.images.find(im => im.name === image.name);
    if (image.mimeType !== "image/ktx2" || original?.mimeType !== image.mimeType) {
      throw new Error("Missing matching KTX2 atlas: " + image.name);
    }
    const view = finish.doc.bufferViews[image.bufferView];
    const start = view.byteOffset || 0;
    replacements.set(shipped.doc.bufferViews[original.bufferView], finish.binary.subarray(start, start + view.byteLength));
  }
  return replacements;
}

function writeSpans({doc, binary}, replacements) {
  // Move complete fallback and compressed views as opaque blocks. A Blender
  // rebuild may choose different decimation edges even with the same sculpt.
  const spans = [...doc.bufferViews];
  for (const view of doc.bufferViews) {
    const encoded = view.extensions?.EXT_meshopt_compression;
    if (encoded) spans.push(encoded);
  }
  spans.sort((a, b) => (a.byteOffset || 0) - (b.byteOffset || 0));
  const chunks = [];
  let offset = 0;
  for (const span of spans) {
    const start = span.byteOffset || 0;
    const bytes = replacements.get(span) ?? binary.subarray(start, start + span.byteLength);
    span.byteOffset = offset;
    span.byteLength = bytes.length;
    chunks.push(bytes, Buffer.alloc(align(bytes.length) - bytes.length));
    offset += align(bytes.length);
  }
  return encodeGlb(doc, chunks, offset);
}

const packed = new Map();
for (const lod of ["pc", "phone"]) {
  const name = "lotstatue__lot_temple_hall_buddha" + (lod === "phone" ? "_phone" : "");
  let model = path.resolve(work, lod + ".glb");
  if (regions.has(flag)) {
    const region = regions.get(flag);
    const graft = path.join(work, lod + "-" + region + ".glb");
    await preserveSurroundingStatue(path.join(seedDirectory, name + ".glb"), model, graft, region);
    model = graft;
  }
  const keepPaint = flag === "--preserve-ears-from" || flag === "--scalp-only-from";
  if (!keepPaint) {
    const ktx = path.join(work, lod + "-ktx.glb");
    execFileSync(process.execPath, [path.join(here, "node", "ktx2_glb.mjs"),
      model, ktx, "2048", "all", "2048"], {stdio: "inherit"});
    model = ktx;
  }
  const source = texturesOnly ? path.join(seedDirectory, name + ".glb") : compressGeometry(model);
  const statue = readGlb(source);
  const replacements = texturesOnly ? coreAtlases(statue, readGlb(model)) : new Map();
  // Geometry-only grafts can also use casts that predate the photographic finish.
  if (!keepPaint || statue.doc.images.some(image => image.name === lod+"-photographic-fill")) {
    const prior = keepPaint || flag === "--portrait-from" ? readGlb(path.join(seedDirectory, name + ".glb")) : null;
    await dressBuddhaLeaf(statue, lod, path.join(work,lod+"-color.png"), replacements,
      keepPaint ? prior : null, flag === "--portrait-from" ? prior : null);
  }
  packed.set(path.join(destination, name + ".glb"), writeSpans(statue, replacements));
}
for (const [file, bytes] of packed) writeFileSync(file, bytes);
