/**
 * scripts/patch-village-busstop.mjs — takes the OLD bus shelter out of village.glb (fix/crosswalk-signals).
 *
 *   node scripts/patch-village-busstop.mjs <village.glb> [--out <other.glb>] [--dry]
 *
 * Why: art/village/tools/parts_props.py bus_stop() baked a box shelter (flat roof, glass panels, bench, sign pole) onto the
 * sidewalk at (38, -5.5), 1.5 m from the bus's doors. The bus stop is now a separate model (client/public/models/village/
 * village_busstop.glb, art/village/tools/build_busstop.py) standing at the back of a waiting pad, and the old one must go.
 *
 * What it does (idempotent; the village is NOT re-exported or re-baked): removes the old shelter's triangles — every triangle
 * of the `LM_atlas` and `LM_wood` primitives whose three corners are inside OLD_SHELTER (above the pavement, in its box) —
 * and re-encodes those two primitives with Draco on the input's quantization grid, so every remaining vertex keeps its
 * quantized value. Every other primitive's Draco bytes, every image, every other JSON entry and the light-map UVs of the
 * remaining triangles are left as they are. It then checks the output against the input: the kept triangles decode to
 * the input's kept triangles (corner positions, UV0 and UV1 within 1e-4), the other buffer views are byte-identical. Exit 1 if not.
 * (The light maps still hold the old shelter's shadow on the sidewalk: a re-bake of the village is what removes that.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeDraco, draco, encodeDraco, readGlb, writeGlb } from "./patch-village-moon.mjs";

/** The old shelter and its sign post (game metres): the roof's footprint 2.1 x 5.3 round (38, -5.5), the post 0.6 m north of it. */
export const OLD_SHELTER = { minX: 36.9, maxX: 39.1, minZ: -9.0, maxZ: -2.7, minY: 0.1, sideMinX: 37.2 };
const MATERIALS = new Set(["LM_atlas", "LM_wood"]);
const DRACO_EXT = "KHR_draco_mesh_compression";

const viewBytes = (json, bin, i) => {
  const v = json.bufferViews[i];
  return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
};
const inBox = (p) => p[0] >= OLD_SHELTER.minX && p[0] <= OLD_SHELTER.maxX && p[2] >= OLD_SHELTER.minZ && p[2] <= OLD_SHELTER.maxZ && p[1] >= OLD_SHELTER.minY;

const accessorBounds = (values, size) => {
  const min = Array(size).fill(Infinity);
  const max = Array(size).fill(-Infinity);
  for (let i = 0; i < values.length; i++) {
    const k = i % size;
    if (values[i] < min[k]) min[k] = values[i];
    if (values[i] > max[k]) max[k] = values[i];
  }
  return { min, max };
};

/**
 * Every triangle as a record: its corners (sorted by position, each corner's values for all attributes) and its centroid.
 * The records are sorted by centroid, so an input and an output compare triangle by triangle within a tolerance (a Draco
 * re-encode on the input's grid moves a value by about 1e-6, which a rounded string key would turn into a mismatch).
 */
function triRecords(dec, faceList) {
  const names = Object.keys(dec.attrs).sort();
  const P = dec.attrs.POSITION.values;
  const corner = (i) => {
    const v = [];
    for (const n of names) {
      const a = dec.attrs[n];
      for (let k = 0; k < a.size; k++) v.push(a.values[i * a.size + k]);
    }
    return { pos: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], v };
  };
  const recs = faceList.map((f) => {
    const cs = [0, 1, 2].map((k) => corner(dec.faces[f * 3 + k]));
    cs.sort((x, y) => x.pos[0] - y.pos[0] || x.pos[1] - y.pos[1] || x.pos[2] - y.pos[2]);
    const c = [0, 1, 2].map((k) => (cs[0].pos[k] + cs[1].pos[k] + cs[2].pos[k]) / 3);
    return { c, vals: cs.flatMap((x) => x.v) };
  });
  const E = 1e-4;
  recs.sort((a, b) => {
    for (let k = 0; k < 3; k++) {
      if (a.c[k] < b.c[k] - E) return -1;
      if (a.c[k] > b.c[k] + E) return 1;
    }
    return 0;
  });
  return recs;
}

export async function patchVillageBusstop(input) {
  await draco();
  const { json, bin } = readGlb(input);
  const replace = new Map();
  const report = [];
  const checks = [];
  for (const [mi, mesh] of json.meshes.entries()) {
    for (const [pi, prim] of mesh.primitives.entries()) {
      const matName = json.materials[prim.material]?.name ?? "";
      if (!MATERIALS.has(matName)) continue;
      if (!prim.extensions?.[DRACO_EXT]) throw new Error(`${mesh.name}[${pi}]: not Draco-compressed (unsupported)`);
      const dec = decodeDraco(json, bin, prim);
      const P = dec.attrs.POSITION.values;
      const gone = [];
      const keep = [];
      for (let f = 0; f < dec.nf; f++) {
        const pts = [0, 1, 2].map((k) => {
          const i = dec.faces[f * 3 + k];
          return [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
        });
        // the old shelter's tops (every corner above the pavement), and (review r2) the sides of its posts and bench legs, which
        // start at y = 0: every corner in the footprint beyond the kerb (x >= 37.2) with one corner above 0.3 m
        const ok = pts.every(inBox) || (pts.every((q) => q[0] >= OLD_SHELTER.sideMinX && q[0] <= OLD_SHELTER.maxX && q[2] >= OLD_SHELTER.minZ && q[2] <= OLD_SHELTER.maxZ) && pts.some((q) => q[1] > 0.3));
        (ok ? gone : keep).push(f);
      }
      if (gone.length === 0) continue;
      if (keep.length === 0) throw new Error(`${mesh.name}[${pi}] holds nothing but the old shelter (unexpected layout)`);
      const map = new Map();
      const faces = new Uint32Array(keep.length * 3);
      keep.forEach((f, n) => {
        for (let k = 0; k < 3; k++) {
          const i = dec.faces[f * 3 + k];
          if (!map.has(i)) map.set(i, map.size);
          faces[n * 3 + k] = map.get(i);
        }
      });
      const np = map.size;
      const attrs = {};
      for (const [name, a] of Object.entries(dec.attrs)) {
        const values = new Float32Array(np * a.size);
        for (const [oldI, newI] of map) values.set(a.values.subarray(oldI * a.size, oldI * a.size + a.size), newI * a.size);
        attrs[name] = { values, size: a.size, quant: a.quant };
      }
      const enc = encodeDraco(attrs, faces, np);
      if (enc.nFaces !== keep.length) throw new Error(`Draco dropped ${keep.length - enc.nFaces} faces of ${mesh.name}[${pi}]`);
      const ext = prim.extensions[DRACO_EXT];
      replace.set(ext.bufferView, enc.bytes);
      ext.attributes = Object.fromEntries(Object.keys(ext.attributes).map((n) => [n, enc.ids[n]]));
      for (const [name, a] of Object.entries(attrs)) {
        const acc = json.accessors[prim.attributes[name]];
        acc.count = enc.nPoints;
        if (name === "POSITION") Object.assign(acc, accessorBounds(a.values, 3));
      }
      json.accessors[prim.indices].count = enc.nFaces * 3;
      checks.push({ mi, pi, dec, keep, view: ext.bufferView });
      report.push({ mesh: mesh.name, primitive: pi, material: matName, removed: gone.length, left: keep.length });
    }
  }

  // lay the buffer views out again (4-byte aligned) with the two primitives' bytes replaced
  const parts = [];
  let off = 0;
  json.bufferViews.forEach((v, i) => {
    const bytes = replace.get(i) ?? viewBytes(json, bin, i);
    const pad = (4 - (off % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    off += pad;
    v.byteOffset = off;
    v.byteLength = bytes.length;
    parts.push(Buffer.from(bytes));
    off += bytes.length;
  });
  const newBin = Buffer.concat(parts);
  json.buffers[0].byteLength = newBin.length;
  const out = report.length === 0 ? input : writeGlb(json, newBin);

  // integrity: the kept triangles decode the same; every other buffer view is byte-identical
  if (report.length) {
    const back = readGlb(out);
    const fail = (m) => {
      throw new Error("integrity check failed: " + m);
    };
    const inJson = readGlb(input).json;
    const inBin = readGlb(input).bin;
    const changedViews = new Set(checks.map((c) => c.view));
    for (let i = 0; i < inJson.bufferViews.length; i++) {
      if (changedViews.has(i)) continue;
      if (!viewBytes(back.json, back.bin, i).equals(viewBytes(inJson, inBin, i))) fail(`buffer view ${i} changed`);
    }
    for (const c of checks) {
      const prim = back.json.meshes[c.mi].primitives[c.pi];
      const dec2 = decodeDraco(back.json, back.bin, prim);
      const want = triRecords(c.dec, c.keep);
      const got = triRecords(dec2, Array.from({ length: dec2.nf }, (_, f) => f));
      if (want.length !== got.length) fail(`${c.mi}[${c.pi}]: ${got.length} triangles, ${want.length} expected`);
      let worst = 0;
      for (let k = 0; k < want.length; k++) {
        for (let q = 0; q < want[k].vals.length; q++) worst = Math.max(worst, Math.abs(want[k].vals[q] - got[k].vals[q]));
      }
      if (worst > 1e-3) fail(`${c.mi}[${c.pi}]: a triangle differs by ${worst}`);
    }
  }
  return { out, report };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const file = args[0] && !args[0].startsWith("--") ? args[0] : null;
  if (!file) {
    console.error("usage: node scripts/patch-village-busstop.mjs <village.glb> [--out <other.glb>] [--dry]");
    process.exit(2);
  }
  const outIdx = args.indexOf("--out");
  const target = outIdx >= 0 ? args[outIdx + 1] : file;
  const input = readFileSync(file);
  try {
    const { out, report } = await patchVillageBusstop(input);
    for (const r of report) console.log(`removed the old shelter: ${r.removed} triangles from ${r.mesh}[${r.primitive}] (${r.material}), ${r.left} left`);
    console.log(`${file}: ${input.length} B -> ${out.length} B${report.length === 0 ? " (already patched: unchanged)" : ""}; check passed`);
    if (!args.includes("--dry") && !(report.length === 0 && target === file)) writeFileSync(target, out);
  } catch (err) {
    console.error(String(err?.stack ?? err));
    process.exit(1);
  }
}
