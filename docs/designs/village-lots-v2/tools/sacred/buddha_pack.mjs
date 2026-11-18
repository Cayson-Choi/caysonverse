/** Finish the original hall Buddha after the Blender build.
 * node buddha_pack.mjs <build-directory> <sacred-GLB-directory> [--preserve-from <prior-GLB-directory>]
 * For a face revision, pass the shipped pair's directory to --preserve-from.
 * It can also be the destination. Both LODs are built before either file is replaced.
 * Uses the locked KTX2 settings from sacred/node. The room loader needs the meshopt
 * extension's core fallback. Both paths carry the same faces and vertex attributes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { preserveSurroundingStatue } from "./buddha_preserve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [work, destination, flag, seedDirectory, ...extra] = process.argv.slice(2);
if (!work || !destination || (flag && (flag !== "--preserve-from" || !seedDirectory)) || extra.length) {
  throw new Error("Expected build directory, sacred GLB directory and optional --preserve-from <directory>");
}
const align = (n) => Math.ceil(n / 4) * 4;
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);

function compressGeometry(file) {
  const input = readFileSync(file);
  const jsonLength = input.readUInt32LE(12);
  const doc = JSON.parse(input.toString("utf8", 20, 20 + jsonLength));
  const original = input.subarray(28 + jsonLength);
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

const packed = new Map();
for (const lod of ["pc", "phone"]) {
  const name = "lotstatue__lot_temple_hall_buddha" + (lod === "phone" ? "_phone" : "");
  let model = path.resolve(work, lod + ".glb");
  if (seedDirectory) {
    const graft = path.join(work, lod + "-face.glb");
    await preserveSurroundingStatue(path.join(seedDirectory, name + ".glb"), model, graft);
    model = graft;
  }
  const ktx = path.join(work, lod + "-ktx.glb");
  execFileSync(process.execPath, [path.join(here, "node", "ktx2_glb.mjs"),
    model, ktx, "2048", "all", "2048"], {stdio: "inherit"});
  packed.set(path.join(destination, name + ".glb"), compressGeometry(ktx));
}
for (const [file, bytes] of packed) writeFileSync(file, bytes);
