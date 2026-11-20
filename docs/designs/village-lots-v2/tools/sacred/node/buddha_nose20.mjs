import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MeshoptEncoder } from "meshoptimizer";

const diagonal = Math.SQRT1_2;
const seedHashes = {
  pc: "30283ba6f9f25bb1de3fd31fc4cddedc5c9b3358826a9c3bea473fe2f54f28a3",
  phone: "c15fb9d6d6099100201b873895c77debc3b8b31c7e285c98a81f44d7d1e471eb",
};

const mix = (a, b, weight) => a + (b - a) * weight;
function unit(vector) {
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
}
function ramp(low, high, value) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t*t*(3 - 2*t);
}
function gaussian(s, y, center, height, rx, ry) {
  return Math.exp(-(((s - center) / rx)**2 + ((y - height) / ry)**2));
}

// Distances are in millimetres. In the oblique tangent plane of either wing,
// s runs from tip to cheek, y is vertical and the height field points outward.
function wingHeight(s, y) {
  const cheek = 64.35 + .12*y - .0047*y*y
    + 2.4*Math.log1p(Math.exp((s - 9)/6)) + 1.7*Math.log1p(Math.exp((-s - 14)/7));
  const mound = 10.8*gaussian(s, y, 1.0, 7.4, 15, 12.6);
  return cheek + mound - 1.55*gaussian(s, y, 16, 1.3, 8.7, 9.0)
    - .82*gaussian(s, y, 15, 13, 10, 12);
}

function wingWeight(u, y, z, s) {
  return ramp(14,21,u)*(1-ramp(46,57,u))*ramp(39,48,z)*(1-ramp(77,84,z))
    *ramp(-5,2,y)*(1-ramp(19,32,y))*ramp(-24,-16,s)*(1-ramp(18,32,s));
}

function packed(parts, view, bytes) {
  const ext = view.extensions.EXT_meshopt_compression;
  const compressed = MeshoptEncoder.encodeGltfBuffer(bytes, ext.count, ext.byteStride, ext.mode, 0);
  parts.set(view, bytes);
  parts.set(ext, Buffer.from(compressed));
}

// Preserve interpolation across the triangles shared with the central tip,
// dorsum and aperture floor. Their longer edges matter especially on the phone.
function lockedNeighbours(doc, binary, primitive, data, count) {
  const points = Array.from({length:count}, (_, i) => {
    const u = Math.abs(1000*(data.readFloatLE(32*i) + .004));
    const y = 1000*(data.readFloatLE(32*i + 4) - 1.595);
    const z = 1000*data.readFloatLE(32*i + 8);
    return [u, y, z, (u - z + 38.5)*diagonal];
  });
  const indices = doc.accessors[primitive.indices];
  assert.equal(indices.componentType, 5123);
  const start = doc.bufferViews[indices.bufferView].byteOffset + (indices.byteOffset || 0);
  const locked = new Set();
  for (let t = 0; t < indices.count; t += 3) {
    const ids = [0,1,2].map(k => binary.readUInt16LE(start + 2*(t + k)));
    const vertices = ids.map(i => points[i]);
    if (!vertices.some(([u,y,z]) => u<58 && y>-13 && y<33 && z>38 && z<85)) continue;
    const ranges = [0,1,2,3].map(k => {
      const values = vertices.map(p => p[k]);
      return [Math.min(...values), Math.max(...values)];
    });
    const [[u0,u1], [y0,y1], [z0,z1], [s0,s1]] = ranges;
    const tip = u0<=14 && z1>=75 && y0<=30 && y1>=-22;
    const bridge = u0<=21 && z1>=57 && y1>=34;
    const aperture = u0<34 && u1>18 && z1>53 && z0<75 && y0<=-5.8 && y1>=-14 && s0<7 && s1>-7;
    if (tip || bridge || aperture) ids.forEach(id => locked.add(id));
  }
  return locked;
}

export function sculptAlae({doc, binary}, tier) {
  const primitive = doc.meshes[0].primitives[0], attrs = primitive.attributes;
  const position = doc.accessors[attrs.POSITION], view = doc.bufferViews[position.bufferView];
  const second = doc.bufferViews[doc.accessors[attrs.TEXCOORD_1].bufferView];
  const copy = v => Buffer.from(binary.subarray(v.byteOffset, v.byteOffset + v.byteLength));
  const data = copy(view), fill = copy(second);
  assert.equal(createHash("sha256").update(data).digest("hex"), seedHashes[tier], "Expected pass 19");
  assert.equal(view.byteStride, 32);
  assert.equal(second.byteStride, 4);
  const locked = lockedNeighbours(doc, binary, primitive, data, position.count);
  let changed = 0;
  for (let i = 0; i < position.count; i++) {
    const row = Array.from({length:8}, (_, k) => data.readFloatLE(i*32 + k*4));
    if (row[6] < .5 || locked.has(i)) continue;
    const x = (row[0] + .004)*1000, y = (row[1] - 1.595)*1000, z = row[2]*1000;
    const u = Math.abs(x), sign = Math.sign(x), s = (u - z + 38.5)*diagonal;
    const weight = wingWeight(u, y, z, s);
    const rear = ramp(7,14,s)*(1-ramp(22,32,s))*ramp(-13,-8,y)*(1-ramp(-3,4,y))
      *ramp(38,47,z)*(1-ramp(47,57,u));
    const finishWeight = Math.max(weight, .44*rear*ramp(12,20,s));
    if (finishWeight <= 0) continue;

    if (weight > 0) {
      const delta = weight*(wingHeight(s,y) - (u+z)*diagonal)*diagonal/1000;
      data.writeFloatLE(row[0] + sign*delta, 32*i);
      data.writeFloatLE(row[2] + delta, 32*i+8);
      const h = .10;
      const ds = (wingHeight(s+h,y) - wingHeight(s-h,y))/(2*h);
      const dy = (wingHeight(s,y+h) - wingHeight(s,y-h))/(2*h);
      const target = unit([sign*diagonal*(1-ds), -dy, diagonal*(1+ds)]);
      const normal = unit(target.map((v,k) => mix(row[k+3], v, weight)));
      normal.forEach((v,k) => data.writeFloatLE(v, 32*i+12+4*k));
    }

    // Unfold the original gilt and its photographed light across the sidewall.
    // The phone has a separate 512 × 256 fill atlas and wider cheek triangles.
    const pigment = [.75+sign*(.046+.00102*s), .542-.00176*y];
    const silk = tier === "phone"
      ? [(sign<0 ? .711 : .799)+sign*.00080*s,
        .5430-.00170*y-.00028*s+.004*gaussian(s,y,10,-1,11,8)]
      : [.75+sign*(.036+.00096*s), .5405-.00167*y+.0055*gaussian(s,y,9,-1,9,7)];
    for (let k = 0; k < 2; k++) {
      data.writeFloatLE(mix(row[6+k], pigment[k], finishWeight), 32*i+24+4*k);
      const offset = 4*i+2*k;
      fill.writeUInt16LE(Math.round(mix(fill.readUInt16LE(offset), 65535*silk[k], finishWeight)), offset);
    }
    changed++;
  }

  const parts = new Map();
  packed(parts, view, data);
  packed(parts, second, fill);
  console.log(tier, changed, "alar vertices");
  return parts;
}
