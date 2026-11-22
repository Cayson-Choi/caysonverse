/**
 * node /path/to/buddha_unpack.mjs MODEL.glb OUTPUT_DIR
 *
 * Prepare a model-only Blender import: decode KTX2 atlases to PNG and use the
 * uncompressed mesh buffer already retained by the Buddha packer. Dependencies
 * resolve next to this script, so the caller may run it from any directory.
 * Protected reference images are never read or copied by this utility.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NodeBasisEncoder } from "ktx2-encoder";

const args = process.argv.slice(2);
if (args.length !== 2 || args.includes("--help")) {
  console.log("Usage: node buddha_unpack.mjs MODEL.glb OUTPUT_DIR");
  process.exit(args.includes("--help") ? 0 : 1);
}
const [file, output] = args.map(value => path.resolve(value));
const raw = await fs.readFile(file);
if (raw.readUInt32LE(0) !== 0x46546c67 || raw.readUInt32LE(4) !== 2) {
  throw new Error("Expected a glTF 2.0 GLB.");
}
const jsonLength = raw.readUInt32LE(12);
if (raw.readUInt32LE(16) !== 0x4e4f534a || raw.readUInt32LE(24 + jsonLength) !== 0x004e4942) {
  throw new Error("Expected GLB JSON followed by a binary chunk.");
}
const gltf = JSON.parse(raw.subarray(20, 20 + jsonLength));
const binary = raw.subarray(28 + jsonLength, 28 + jsonLength + raw.readUInt32LE(20 + jsonLength));
if (gltf.buffers.length !== 1) throw new Error("Expected one packed buffer with uncompressed fallback data.");
for (const view of gltf.bufferViews) {
  if (view.extensions?.EXT_meshopt_compression &&
      (view.buffer !== 0 || (view.byteOffset || 0) + view.byteLength > binary.length)) {
    throw new Error("Meshopt buffer has no accessible uncompressed fallback.");
  }
}
await fs.mkdir(output, { recursive: true });
const basis = await new NodeBasisEncoder().init();
for (const [index, image] of (gltf.images || []).entries()) {
  if (image.bufferView === undefined) throw new Error("Expected embedded image data.");
  const view = gltf.bufferViews[image.bufferView];
  const start = view.byteOffset || 0;
  const source = binary.subarray(start, start + view.byteLength);
  const imageName = path.basename(image.name || `image-${index}`);
  if (image.mimeType === "image/ktx2") {
    const texture = new basis.KTX2File(source);
    try {
      if (!(texture.isValid() && texture.startTranscoding())) throw new Error(`Invalid KTX2: ${imageName}`);
      const width = texture.getWidth(), height = texture.getHeight();
      const pixels = Buffer.alloc(4 * width * height);
      if (!texture.transcodeImage(pixels, 0, 0, 0, basis.transcoder_texture_format.cTFRGBA32.value, 0, -1, -1)) {
        throw new Error(`KTX2 transcode failed: ${imageName}`);
      }
      image.uri = `${imageName}.png`;
      await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(path.join(output, image.uri));
      image.mimeType = "image/png";
      console.log(imageName, width, height);
    } finally {
      texture.close();
      texture.delete();
    }
  } else {
    const extension = { "image/png": "png", "image/jpeg": "jpg" }[image.mimeType];
    if (!extension) throw new Error(`Unsupported image type: ${image.mimeType}`);
    image.uri = `${imageName}.${extension}`;
    await fs.writeFile(path.join(output, image.uri), source);
  }
  delete image.bufferView;
}
for (const texture of gltf.textures || []) {
  if (!texture.extensions?.KHR_texture_basisu) continue;
  texture.source = texture.extensions.KHR_texture_basisu.source;
  delete texture.extensions.KHR_texture_basisu;
  if (!Object.keys(texture.extensions).length) delete texture.extensions;
}
for (const view of gltf.bufferViews) {
  if (!view.extensions?.EXT_meshopt_compression) continue;
  delete view.extensions.EXT_meshopt_compression;
  if (!Object.keys(view.extensions).length) delete view.extensions;
}
for (const key of ["extensionsUsed", "extensionsRequired"]) {
  if (!gltf[key]) continue;
  gltf[key] = gltf[key].filter(extension => !["KHR_texture_basisu", "EXT_meshopt_compression"].includes(extension));
  if (!gltf[key].length) delete gltf[key];
}
gltf.buffers[0].uri = "mesh.bin";
await fs.writeFile(path.join(output, "mesh.bin"), binary);
await fs.writeFile(path.join(output, "model.gltf"), JSON.stringify(gltf));
console.log("Blender import:", path.join(output, "model.gltf"));
