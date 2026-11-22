/** Move the two existing heavy lids while keeping their paint attached.
* Fixed interpolants on long triangles keep the deformation inside the
* registered eye windows, including on the coarse phone casting.
*/
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeBasisEncoder, encodeToKTX2 } from 'ktx2-encoder';
function ease(lo, hi, value) {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}
function lidOffset([x, y, z], tier) {
  const u = Math.abs(x + 4);
  const region = ease(26, 39, u) * (1 - ease(136, 151, u))
    * ease(1650, 1667, y) * (1 - ease(1687, 1705, y))
    * ease(-77, -51, z) * (1 - ease(51, 64, z));
  const forward = (tier === 'pc' ? 15.5 : 16.5) * ease(98, 126, u) * region;
  const raised = (.3 + 3.6 * ease(78, 110, u) - 2.5 * ease(116, 132, u)) * region;
  const lower = -1.1 * (1 - ease(1674, 1680, y)) * ease(46, 65, u)
    * (1 - ease(90, 108, u)) * region;
  const outward = (tier === 'pc' ? 1.45 : 3.25) * Math.sign(x + 4)
    * ease(108, 123, u) * (1 - ease(1692, 1701, y)) * region;
  return [.068 * forward + raised + lower, forward, outward];
}
// Signed inward distances in original photograph pixels. All bounds are on
// the fixed frontal, left and right cameras used for the paired overlays.
function eyeWindow([x, y, z], side) {
  const vertical = depth => 551.5 - .265 * (y - .068 * depth) / Math.hypot(1, .068);
  const fx = 196.1201142 + (197 + .265 * x - 195.828144) * .991954434;
  const fy = 108.8993954 + (vertical(z) - 108.6528054) * .991954434;
  const lx = 569.0622756 + (576 - .265 * z - 568.647469) * .99329442;
  const ly = 108.0777733 + (vertical(x) - 109.466497) * .99329442;
  const rx = 1363.272280 + (1355.5 + .265 * z - 1363.800234) * .99202410;
  const ry = 107.762577 + (vertical(-x) - 109.574246) * .99202410;
  return [fx - (side < 0 ? 154 : 200.5), (side < 0 ? 191.5 : 238) - fx, fy - 98, 117 - fy,
    lx - 547, 596 - lx, ly - 98, 117.5 - ly, rx - 1333, 1387 - rx, ry - 98, 117.5 - ry];
}
// The porcelain-white scleral window and the short inked temporal lash use
// the casting's existing facial UVs. The original textures remain attached
// to every other primitive. Crop the two new maps at source texel edges.
async function glazeWindows(doc, binary, tier, primitive, vertices, lightUv, triangles, spans) {
  const eye = [], skin = [];
  const scleraCenter = tier === 'pc' ? 101.85 : 102.3;
  const uv = id => [lightUv.readUInt16LE(id * 4) / 65535, lightUv.readUInt16LE(id * 4 + 2) / 65535];
  for (let i = 0; i < triangles.length; i += 3) {
    const ids = triangles.slice(i, i + 3);
    const coords = ids.map(uv);
    const horizontal = coords.map(([s]) => 720 * (s - .75) - 4);
    const vertical = coords.map(([, t]) => 1820 - 400 * t);
    const intersectsBrush = Math.max(...vertical) > 1667 && Math.min(...vertical) < 1686 &&
      [1, -1].some(side => {
        const lateral = horizontal.map(x => side * x);
        return Math.max(...lateral) > 57 && Math.min(...lateral) < 137;
      });
    const target = intersectsBrush && ids.every(id => vertices.readFloatLE(id * 32 + 24) > .5) ? eye : skin;
    target.push(...ids);
  }
  function addView(bytes, target) {
    const view = {buffer: 0, byteOffset: 0, byteLength: bytes.length};
    if (target) view.target = target;
    spans.set(view, bytes);
    return doc.bufferViews.push(view) - 1;
  }
  const codec = await new NodeBasisEncoder().init();
  const coords = eye.map(uv);
  const linear = byte => {
    const value = byte / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  };
  const srgb = value => Math.round(255 * Math.min(1, value <= .0031308 ?
    12.92 * value : 1.055 * value ** (1 / 2.4) - .055));
  async function paintAtlas(slot, kind) {
    const fill = kind === 'fill', orm = kind === 'orm';
    const texture = doc.textures[slot.index];
    const image = doc.images[texture.extensions.KHR_texture_basisu.source];
    const view = doc.bufferViews[image.bufferView];
    const file = new codec.KTX2File(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength));
    const W = file.getWidth(), H = file.getHeight(), old = Buffer.alloc(W * H * 4);
    try {
      assert.ok(file.startTranscoding());
      assert.ok(file.transcodeImage(old, 0, 0, 0, codec.transcoder_texture_format.cTFRGBA32.value, 0, -1, -1));
    } finally {
      file.close();
      file.delete();
    }
    const px = coords.map(([u]) => u * W), py = coords.map(([, v]) => v * H);
    const xmin = Math.max(0, 4 * Math.floor((Math.min(...px) - 4) / 4));
    const xmax = Math.min(W, 4 * Math.ceil((Math.max(...px) + 4) / 4));
    const ymin = Math.max(0, 4 * Math.floor((Math.min(...py) - 4) / 4));
    const ymax = Math.min(H, 4 * Math.ceil((Math.max(...py) + 4) / 4));
    const width = xmax - xmin, height = ymax - ymin, pixels = Buffer.alloc(width * height * 4);
    const glaze = [.251, .262, .193];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const tx = x + xmin, ty = y + ymin, k = 4 * (x + width * y), source = 4 * (tx + W * ty);
      const a = Math.abs(720 * ((tx + .5) / W - .75) - 4), Y = 1820 - 400 * (ty + .5) / H;
      const white = Math.exp(-(((a - scleraCenter) / 4.2) ** 2 + ((Y - 1677.75) / 1.87) ** 2));
      const taper = ease(118, 131, a);
      const inkHeight = (Y - 1679.0 - .9 * taper) / (2.6 - 1.1 * taper);
      const ink = ease(110, 118, a) * (1 - ease(120, 131.5, a)) * Math.exp(-(inkHeight ** 2));
      if (orm) {
        const t = Math.max(0, Math.min(1, (a - 32) / 105.5));
        const arc = Math.sin(Math.PI * t);
        const upper = 1681.5 - 1.2 * arc + 2.2 * t ** 3 - 6.5 * (1 - t) ** 11;
        const lower = upper - 11.8 * arc ** .86;
        const circle = ((t - .452) / .182) ** 2 + ((Y - upper + .6) / 14) ** 2;
        const iris = (1 - ease(.74, 1.24, circle)) * ease(lower - .7, lower + 1.1, Y)
          * (1 - ease(upper - .4, upper + 1.0, Y));
        const temporal = ease(101, 110, a) * (1 - ease(120, 128, a));
        const lash = temporal * Math.exp(-(((Y - 1682.0) / 2.6) ** 2));
        const matte = .86 * Math.max(iris, lash);
        pixels[k] = old[source];
        pixels[k + 1] = Math.round(old[source + 1] + matte * (255 - old[source + 1]));
        pixels[k + 2] = old[source + 2];
        pixels[k + 3] = 255;
        continue;
      }
      for (let channel = 0; channel < 3; channel++) {
        const radiance = linear(old[source + channel]) * (1 - .78 * ink);
        pixels[k + channel] = srgb(radiance + (fill ? white * glaze[channel] : 0));
      }
      pixels[k + 3] = 255;
    }
    const bytes = Buffer.from(await encodeToKTX2(new Uint8Array(1), {
      isUASTC: true, uastcLDRQualityLevel: 3, needSupercompression: true, isPerceptual: !orm,
      isSetKTX2SRGBTransferFunc: !orm, generateMipmap: true, isKTX2File: true, isYFlip: false,
      imageDecoder: async () => ({width, height, data: pixels}),
    }));
    const name = tier + '-eye-' + kind;
    const binding = doc.images.push({name, mimeType: 'image/ktx2', bufferView: addView(bytes)}) - 1;
    const index = doc.textures.push({sampler: texture.sampler, extensions: {KHR_texture_basisu: {source: binding}}}) - 1;
    return {index, texCoord: slot.texCoord || 0, extensions: {KHR_texture_transform: {
      offset: [-xmin / width, -ymin / height], scale: [W / width, H / height],
    }}};
  }
  const material = structuredClone(doc.materials[primitive.material]);
  material.name += ' (eye glaze)';
  material.emissiveTexture = await paintAtlas(material.emissiveTexture, 'fill');
  material.pbrMetallicRoughness.baseColorTexture = await paintAtlas(material.pbrMetallicRoughness.baseColorTexture, 'color');
  material.pbrMetallicRoughness.metallicRoughnessTexture = await paintAtlas(material.pbrMetallicRoughness.metallicRoughnessTexture, 'orm');
  if (!doc.extensionsUsed.includes('KHR_texture_transform')) doc.extensionsUsed.push('KHR_texture_transform');
  const eyeMaterial = doc.materials.push(material) - 1;
  const indices = Buffer.alloc(eye.length * 2);
  eye.forEach((id, i) => indices.writeUInt16LE(id, 2 * i));
  const accessor = doc.accessors.push({bufferView: addView(indices, 34963), componentType: 5123, type: 'SCALAR', count: eye.length}) - 1;
  doc.meshes[0].primitives.push({...primitive, indices: accessor, material: eyeMaterial});
  return {skin, eyeFaces: eye.length / 3};
}
export async function refineEyeLids({ doc, binary }, tier) {
  const prim = doc.meshes[0].primitives[0];
  const pos = doc.accessors[prim.attributes.POSITION], idx = doc.accessors[prim.indices];
  const light = doc.accessors[prim.attributes.TEXCOORD_1];
  const source = accessor => {
    const v = doc.bufferViews[accessor.bufferView];
    return binary.subarray(v.byteOffset, v.byteOffset + v.byteLength);
  };
  const base = source(pos), lightData = source(light), indices = source(idx);
  assert.equal(doc.bufferViews[pos.bufferView].byteStride, 32);
  assert.equal(idx.componentType, 5123);
  assert.equal(light.componentType, 5123);
  const n = pos.count, margin = .55;
  const points = Array.from({ length: n }, (_, i) => [0, 4, 8].map(k => base.readFloatLE(32 * i + k) * 1000));
  const neighbors = Array.from({ length: n }, () => new Set());
  const faces = Array.from({ length: idx.count / 3 }, (_, f) => {
    const v = [0, 1, 2].map(j => indices.readUInt16LE(6 * f + 2 * j));
    for (let j = 0; j < 3; j++) {
      neighbors[v[j]].add(v[(j + 1) % 3]);
      neighbors[v[j]].add(v[(j + 2) % 3]);
    }
    return v;
  });
  const fixedEdges = new Map(), movement = new Map(), candidates = [];
  const edgeKey = (i, j) => Math.min(i, j) * n + Math.max(i, j);
  for (let i = 0; i < n; i++) {
    const p = points[i], side = Math.sign(p[0] + 4), [dy, dz, outward] = lidOffset(p, tier);
    if (Math.abs(dy) + Math.abs(dz) < .02 || base.readFloatLE(i * 32 + 24) < .5)
      continue;
    const nx = base.readFloatLE(i * 32 + 12), ny = base.readFloatLE(i * 32 + 16), nz = base.readFloatLE(i * 32 + 20);
    // Slide along the temple surface as the outer lid comes forwards.
    // This keeps the upper lid from lifting into a sharp reflective shelf.
    const xLimit = .25 + 8.75 * ease(1682, 1693, p[1]);
    const slide = Math.abs(nx) > .18 ? Math.max(-xLimit, Math.min(xLimit, -(ny * dy + nz * dz) / nx)) : 0;
    const dx = slide + outward;
    const a = eyeWindow(p, side), moved = eyeWindow([p[0] + dx, p[1] + dy, p[2] + dz], side);
    if (Math.min(...a, ...moved) <= margin)
      continue;
    const edges = [];
    for (const j of neighbors[i]) {
      const b = eyeWindow(points[j], side);
      let t = 1;
      for (let k = 0; k < b.length; k++)
        if (b[k] < margin)
          t = Math.min(t, (a[k] - margin) / (a[k] - b[k]));
      if (t < 1)
        edges.push({ key: edgeKey(i, j), i, j, t });
    }
    // The outer lid continues into an almost straight source brow plane.
    // Fade the displacement before very short guard spokes change its tangent.
    const room = edges.reduce((size, edge) => Math.min(size, edge.t * Math.hypot(...points[edge.j].map((v, k) => v - p[k]))), Infinity);
    const fade = p[1] > 1684 ? ease(0, 13, room) : 1;
    candidates.push({ i, dx: dx * fade, dy: dy * fade, dz: dz * fade, edges, priority: (Math.abs(dy) + Math.abs(dz)) * Math.exp(-(((p[1] - 1679) / 18) ** 2)) });
  }
  candidates.sort((a, b) => b.priority - a.priority);
  // Each guard splits the two source triangles incident to its edge.
  // Preserve the original mobile triangle allowance for both lids together.
  const budget = tier === 'phone' ? 25 : 240;
  for (const c of candidates) {
    const cost = c.edges.filter(e => !fixedEdges.has(e.key)).length;
    if (fixedEdges.size + cost > budget)
      continue;
    movement.set(c.i, c);
    for (const e of c.edges)
      fixedEdges.set(e.key, e);
  }
  const vertices = Buffer.alloc((n + fixedEdges.size) * 32), uv1 = Buffer.alloc((n + fixedEdges.size) * 4);
  base.copy(vertices);
  lightData.copy(uv1);
  for (const [i, { dx, dy, dz }] of movement) {
    vertices.writeFloatLE((points[i][0] + dx) / 1000, i * 32);
    vertices.writeFloatLE((points[i][1] + dy) / 1000, i * 32 + 4);
    vertices.writeFloatLE((points[i][2] + dz) / 1000, i * 32 + 8);
  }
  const guards = [], splitFaces = [], resultIndices = [];
  for (const g of fixedEdges.values()) {
    g.vertex = n + guards.length;
    guards.push(g);
    for (let k = 0; k < 8; k++) {
      const a = base.readFloatLE(g.i * 32 + k * 4), b = base.readFloatLE(g.j * 32 + k * 4);
      vertices.writeFloatLE(a + (b - a) * g.t, 32 * g.vertex + 4 * k);
    }
    const normal = [12, 16, 20].map(k => vertices.readFloatLE(g.vertex * 32 + k));
    const length = Math.hypot(...normal);
    normal.forEach((v, k) => vertices.writeFloatLE(v / length, g.vertex * 32 + 12 + 4 * k));
    for (let k = 0; k < 2; k++) {
      const a = lightData.readUInt16LE(g.i * 4 + 2 * k), b = lightData.readUInt16LE(g.j * 4 + 2 * k);
      uv1.writeUInt16LE(Math.round(a + (b - a) * g.t), 4 * g.vertex + 2 * k);
    }
  }
  for (const [faceIndex, v] of faces.entries()) {
    const g = v.map((i, k) => fixedEdges.get(edgeKey(i, v[(k + 1) % 3])));
    const count = g.reduce((a, s) => a + Number(Boolean(s)), 0);
    if (!count) {
      resultIndices.push(...v);
      continue;
    }
    for (const edge of g)
      if (edge && edge.sourceFace === undefined) {
        edge.sourceFace = faceIndex;
        edge.barycentric = v.map(i => i === edge.i ? 1 - edge.t : i === edge.j ? edge.t : 0);
      }
    let out;
    if (count === 1) {
      const k = g.findIndex(Boolean), a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3], m = g[k].vertex;
      out = [[a, m, c], [m, b, c]];
    }
    else {
      assert.equal(count, 2);
      const k = (g.findIndex(s => !s) + 1) % 3, a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3], m = g[k].vertex, h = g[(k + 1) % 3].vertex;
      out = [[m, b, h], [a, m, h], [a, h, c]];
    }
    splitFaces.push({ sourceFace: faceIndex, source: v, output: out });
    resultIndices.push(...out.flat());
  }
  assert.ok(movement.size && n + guards.length <= 65535);
  const spans = new Map();
  const { skin, eyeFaces } = await glazeWindows(doc, binary, tier, prim, vertices, uv1, resultIndices, spans);
  const indexData = Buffer.alloc(skin.length * 2);
  skin.forEach((i, j) => indexData.writeUInt16LE(i, 2 * j));
  for (const [accessor, bytes, count] of [[pos, vertices, n + guards.length], [light, uv1, n + guards.length], [idx, indexData, skin.length]]) {
    const v = doc.bufferViews[accessor.bufferView], ex = v.extensions.EXT_meshopt_compression;
    ex.count = count;
    spans.set(v, bytes);
    spans.set(ex, Buffer.from(MeshoptEncoder.encodeGltfBuffer(bytes, count, ex.byteStride, ex.mode, 0)));
  }
  for (const id of Object.values(prim.attributes))
    doc.accessors[id].count = n + guards.length;
  idx.count = skin.length;
  if (process.env.BUDDHA_FACE_AUDIT_DIR) {
    const source = { vertexCount: n, primitive: 0, sourceTriangleCount: faces.length, eyeFaces, moved: [...movement.keys()], guards, splitFaces };
    writeFileSync(path.join(process.env.BUDDHA_FACE_AUDIT_DIR, tier + '-split-provenance.json'), JSON.stringify(source, null, 2));
  }
  console.log(tier, movement.size, 'adjusted vertices,', guards.length, 'fixed guards,', resultIndices.length / 3 - faces.length, 'extra local triangles');
  return spans;
}
