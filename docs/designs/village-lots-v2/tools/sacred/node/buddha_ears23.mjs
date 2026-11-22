/** Place the lobes on the existing pass-22 ear shells in the registered views. */
import assert from 'node:assert/strict';
import { MeshoptEncoder } from 'meshoptimizer';

function findEarVertices(records, count, indices) {
  // The medial and lateral faces meet across duplicate UV and normal records.
  // Weld positions for connectivity only. The output retains each original index.
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  function root(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  const welded = new Map(), seeds = [];
  for (let i = 0; i < count; i++) {
    const offset = 32 * i;
    const [x, y, z, u, v] = [0, 4, 8, 24, 28].map(k => records.readFloatLE(offset + k));
    const key = [x, y, z].join(',');
    if (welded.has(key)) parent[i] = root(welded.get(key));
    else welded.set(key, i);
    if (u > .375 && u < .5 && v < .5 && Math.abs(x) > .091 && Math.abs(x) < .245 &&
        y > 1.46 && y < 1.748 && z > -.229 && z < -.131) seeds.push(i);
  }
  for (let byte = 0; byte < indices.length; byte += 6) {
    const a = indices.readUInt16LE(byte), b = indices.readUInt16LE(byte + 2), c = indices.readUInt16LE(byte + 4);
    parent[root(b)] = root(a);
    parent[root(c)] = root(a);
  }
  const components = new Set(seeds.map(root));
  assert.equal(components.size, 2, 'Expected the two original auricles');
  return Array.from({ length: count }, (_, i) => i).filter(i => components.has(root(i)));
}

export async function refineEars({ doc, binary }, tier) {
  const primitive = doc.meshes[0].primitives[0];
  const position = doc.accessors[primitive.attributes.POSITION], index = doc.accessors[primitive.indices];
  const view = doc.bufferViews[position.bufferView], indexView = doc.bufferViews[index.bufferView];
  assert.equal(view.byteStride, 32);
  assert.equal(position.byteOffset || 0, 0);
  assert.equal(index.componentType, 5123);

  const records = Buffer.from(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  const start = indexView.byteOffset + (index.byteOffset || 0);
  const ears = findEarVertices(records, position.count, binary.subarray(start, start + 2 * index.count));
  assert.equal(ears.length, tier === 'pc' ? 520 : 202);
  const top = 1.616, bottom = 1.508;
  let moved = 0;
  for (const i of ears) {
    const offset = 32 * i;
    const x = records.readFloatLE(offset), y = records.readFloatLE(offset + 4);
    if (y >= top) continue;
    // Translate a complete horizontal section. The original photograph has
    // the right-hand lobe farther from the cheek and the left-hand lobe lower.
    const outward = x < 0 ? -.006 : .012;
    const down = x < 0 ? -.006 : -.0022;
    const t = Math.min(1, (top - y) / (top - bottom));
    const blend = t * t * (3 - 2 * t);
    records.writeFloatLE(x + outward * blend, offset);
    records.writeFloatLE(y + down * blend, offset + 4);
    // Apply the inverse transpose of the local deformation gradient to each
    // stored shading normal. A rigid section keeps its original normal bytes.
    if (t < 1) {
      const derivative = -6 * t * (1 - t) / (top - bottom);
      const nx = records.readFloatLE(offset + 12), nz = records.readFloatLE(offset + 20);
      const ny = (records.readFloatLE(offset + 16) - nx * outward * derivative) / (1 + down * derivative);
      const length = Math.hypot(nx, ny, nz);
      [nx, ny, nz].forEach((v, j) => records.writeFloatLE(v / length, offset + 12 + 4 * j));
    }
    moved++;
  }

  await MeshoptEncoder.ready;
  const compressed = view.extensions.EXT_meshopt_compression;
  const encoded = MeshoptEncoder.encodeGltfBuffer(records, compressed.count, compressed.byteStride, compressed.mode, 0);
  console.log(tier, moved, 'lower ear position records adjusted');
  return new Map([[view, records], [compressed, Buffer.from(encoded)]]);
}
