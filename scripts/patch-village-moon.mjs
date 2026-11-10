#!/usr/bin/env node
/**
 * scripts/patch-village-moon.mjs — 광장 분수의 초승달을 village.glb 안에서 새로 만든다 (fix/fix-moon-smooth).
 *
 *   node scripts/patch-village-moon.mjs <village.glb> [--out <other.glb>] [--dry]
 *
 * Why: the crescent (art/village/tools/build_village.py crescent()) was light-mapped like the rest of the village, but on
 * the 2048² light map it got ~3.5 texels per metre, split by the UV unwrap into 11 islands (the front, the back and nine
 * 2-4 texel slivers along the steep knife-edge rim). The band along every inner and outer edge, both tips included, is
 * those islands: hard seams where they meet and staircase steps where a sliver ends, light-map texels 28 cm wide.
 *
 * What it does (idempotent; every other node, mesh, material, image, UV set and light-map texel is left as it is):
 *  1. removes the old crescent's triangles from whatever primitive holds them (a light-mapped `LM_atlas` primitive in the
 *     baked file: triangles near the fountain above its plinth whose UV0 is in the atlas's moon region). That primitive is
 *     re-encoded with Draco on the input's quantization grid, so every remaining vertex keeps its quantized value (Draco
 *     stores an explicit grid as 6-decimal text: the values move by about 1e-6, a few hundredths of a step at most);
 *  2. adds (or, on a patched file, replaces) the node `fountain_moon`: one primitive of a dense crescent with a rounded rim
 *     (an elliptical cross-section all round, pointed tips), analytic normals and the atlas's pearl gradient as UV0;
 *  3. gives it the material `M_moon`: unlit like every village material, the atlas as its colour, no light map. The game
 *     gives it the bake's own light on it as a smooth function of the normal (client/src/village/villageModelPrep.ts
 *     `MOON_PROBE`, `moonMaterial`), so it keeps the old crescent's colours by day and night;
 *  4. checks the result against the input: every other primitive's Draco data, every image and every other JSON entry
 *     byte for byte, and the changed primitive's triangles (decoded, as steps on the input's grid) = the input's minus the
 *     crescent's, every value within 0.05 of a step of the input's. Exit 1 if not.
 *
 * The crescent's shape is `moonGeometry()` here and the same formulas in build_village.py crescent() (a full rebuild
 * excludes the moon from the bake's export and post_village.py runs this script). Needs draco3d (the repo's node_modules).
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, "..", "package.json"));
const draco3d = require("draco3d");

// ───────────────────────────────────────────── the crescent ─────────────────────────────────────────────

/** The crescent as build_village.py places it (game metres: x east, y up, z south). */
export const MOON = {
  centre: [0, 0], // the fountain (layout plaza.fountain.centre)
  baseY: 1.98, // on the plinth
  height: 7.4, // the outer circle's diameter
  yawDeg: -25, // the face (local +z) turned from +z (south) by this yaw (game yaw: +z toward +x)
  nArc: 120, // segments from tip to tip
  nRing: 32, // segments around the cross-section
  arcBunch: 0.5, // 0..1: how much denser the segments are at the tips (where the band narrows fast)
};
/**
 * The atlas's moon region (art/village/work/tex/atlas.json `regions.moon`, T_atlas 2048²) and an inset from its border:
 * 1/20 of the region (26 px), so the mip levels a far crescent reads (down to the 32 px one) stay inside the region and
 * never take in the dark window cell to its left or the banner below it.
 */
export const MOON_ATLAS = { x: 1536, y: 0, w: 512, h: 512, size: 2048, inset: 0.05 };
/**
 * The material: unlit (KHR_materials_unlit, like every village material), the atlas's pearl gradient as it is. The game
 * lights it with the bake's own light on it (villageModelPrep.ts `MOON_PROBE`).
 */
export const MOON_MATERIAL = { name: "M_moon", color: [1, 1, 1, 1] };
export const MOON_NODE = "fountain_moon";
const UNLIT = "KHR_materials_unlit";

/**
 * The crescent's mesh: an outer circle R1, an inner circle R2 offset right and up; across the band (inner edge to outer
 * edge) an ellipse — u = (1 - cos φ) / 2 across, z = ±T/2 · sin φ through — so the rim is round all the way, and the
 * thickness T = 0.3 R1 · (w / w_max)^0.55 thins with the band's width w to a point at each tip.
 * UV0 runs along the arc tip to tip (as the old crescent's did) and across the band by the distance across it, centred:
 * the widest point spans the region, a tip only its middle. (Spanning the whole region at every width put the region's
 * height into the last centimetres of each tip: the GPU then read a mip level a few texels wide there, which takes in
 * the cells around the region and showed as a dark dotted line down the tips.)
 * Returns float64 arrays: positions, normals (unit, outward), uvs (glTF, into the atlas), indices (CCW from outside).
 */
export function moonGeometry(o = MOON) {
  const R1 = o.height / 2;
  const R2 = R1 * 0.8;
  const offX = R1 * 0.42;
  const offY = R1 * 0.1;
  const tmax = R1 * 0.3;
  const yaw = (o.yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const [cx, cz] = o.centre;
  const cy = o.baseY + R1;
  const offLen = Math.hypot(offX, offY);
  // the tips: where the inner circle meets the outer one (|R1·d - off| = R2)
  const k = (R1 * R1 + offLen * offLen - R2 * R2) / (2 * R1);
  const half = Math.acos(k / offLen);
  const alpha = Math.atan2(offY, offX);
  const thA = alpha + half; // the upper tip
  const thB = alpha - half + 2 * Math.PI; // the lower tip (the band runs through 180°, opposite the offset)
  const wMax = R1 - (R2 - offLen);
  const innerR = (th) => {
    const b = Math.cos(th) * offX + Math.sin(th) * offY;
    return Math.min(R1, b + Math.sqrt(b * b - (offLen * offLen - R2 * R2)));
  };
  const arcFrac = (t) => t - (o.arcBunch * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
  const world = (lx, ly, lz) => [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
  const local = (t, phi) => {
    const th = thA + (thB - thA) * arcFrac(t);
    const ri = innerR(th);
    const w = Math.max(0, R1 - ri);
    const T = tmax * Math.pow(w / wMax, 0.55);
    const r = ri + (w * (1 - Math.cos(phi))) / 2;
    return [r * Math.cos(th), r * Math.sin(th), (T / 2) * Math.sin(phi), th, ri, w];
  };
  const P = (t, phi) => {
    const l = local(t, phi);
    return world(l[0], l[1], l[2]);
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const { inset } = MOON_ATLAS;
  const uv = (u, v) => {
    const a = MOON_ATLAS;
    const uu = inset + (1 - 2 * inset) * u;
    const vv = inset + (1 - 2 * inset) * v;
    return [(a.x + uu * a.w) / a.size, (a.y + (1 - vv) * a.h) / a.size]; // glTF v (image rows from the top)
  };
  const pos = [];
  const nrm = [];
  const tex = [];
  const eps = 1e-5;
  const nA = o.nArc;
  const nR = o.nRing;
  const centreLine = (t) => {
    const l = local(t, 0);
    const rm = l[4] + l[5] / 2;
    return world(rm * Math.cos(l[3]), rm * Math.sin(l[3]), 0);
  };
  // the rings (t = i / nA, i = 1 .. nA - 1), then the two tips
  for (let i = 1; i < nA; i++) {
    const t = i / nA;
    const mid = centreLine(t);
    const span = local(t, 0)[5] / wMax; // the band's width here, as a share of its widest
    for (let j = 0; j < nR; j++) {
      const phi = (2 * Math.PI * j) / nR;
      const p = P(t, phi);
      const dt = sub(P(t + eps, phi), P(t - eps, phi));
      const dp = sub(P(t, phi + eps), P(t, phi - eps));
      let n = norm(cross(dt, dp));
      if (dot(n, sub(p, mid)) < 0) n = [-n[0], -n[1], -n[2]];
      pos.push(...p);
      nrm.push(...n);
      tex.push(...uv(arcFrac(t), 0.5 + span * ((1 - Math.cos(phi)) / 2 - 0.5)));
    }
  }
  const tipIndex = [];
  for (const t of [0, 1]) {
    const p = P(t, 0);
    const n = norm(sub(p, centreLine(t === 0 ? 1 / nA : 1 - 1 / nA)));
    tipIndex.push(pos.length / 3);
    pos.push(...p);
    nrm.push(...n);
    tex.push(...uv(t, 0.5));
  }
  const ring = (i, j) => (i - 1) * nR + (((j % nR) + nR) % nR);
  const idx = [];
  // triangle winding: counter-clockwise seen from outside (checked against the normals below)
  const tri = (a, b, d) => {
    const g = cross(sub(pos.slice(b * 3, b * 3 + 3), pos.slice(a * 3, a * 3 + 3)), sub(pos.slice(d * 3, d * 3 + 3), pos.slice(a * 3, a * 3 + 3)));
    const nsum = [0, 1, 2].map((q) => nrm[a * 3 + q] + nrm[b * 3 + q] + nrm[d * 3 + q]);
    if (dot(g, nsum) >= 0) idx.push(a, b, d);
    else idx.push(a, d, b);
  };
  for (let i = 1; i < nA - 1; i++) {
    for (let j = 0; j < nR; j++) {
      const a = ring(i, j);
      const b = ring(i + 1, j);
      const d = ring(i + 1, j + 1);
      const e = ring(i, j + 1);
      tri(a, b, d);
      tri(a, d, e);
    }
  }
  for (let j = 0; j < nR; j++) {
    tri(tipIndex[0], ring(1, j), ring(1, j + 1));
    tri(tipIndex[1], ring(nA - 1, j + 1), ring(nA - 1, j));
  }
  return { positions: pos, normals: nrm, uvs: tex, indices: idx, tips: { thA, thB } };
}

// ───────────────────────────────────────────── GLB I/O ─────────────────────────────────────────────

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export function readGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB");
  const total = buf.readUInt32LE(8);
  let off = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (off < total) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString("utf8"));
    else if (type === BIN_CHUNK) bin = body;
    off += 8 + len;
  }
  return { json, bin };
}

export function writeGlb(json, bin) {
  let js = Buffer.from(JSON.stringify(json), "utf8");
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(GLB_MAGIC, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + b.length, 8);
  const ch = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([head, ch(js.length, JSON_CHUNK), js, ch(b.length, BIN_CHUNK), b]);
}

const viewBytes = (json, bin, i) => {
  const v = json.bufferViews[i];
  return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
};

/** Lay the buffer views out again in index order (4-byte aligned), with some views' bytes replaced. */
function rebuildBin(json, bin, replace) {
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
  const out = Buffer.concat(parts);
  json.buffers[0].byteLength = out.length;
  return out;
}

// ───────────────────────────────────────────── Draco ─────────────────────────────────────────────

let D = null;
let E = null;
/** Load Draco's decoder and encoder (once). */
export async function draco() {
  if (!D) D = await draco3d.createDecoderModule({});
  if (!E) E = await draco3d.createEncoderModule({});
  return { D, E };
}

const DRACO_EXT = "KHR_draco_mesh_compression";
const TYPE_OF = (name) =>
  name === "POSITION" ? "POSITION" : name === "NORMAL" ? "NORMAL" : name.startsWith("TEXCOORD") ? "TEX_COORD" : name.startsWith("COLOR") ? "COLOR" : "GENERIC";

/**
 * Decode a Draco primitive: per glTF attribute its float values, size and quantization (bits, origin, range — read with
 * the transform skipped), and the faces.
 */
export function decodeDraco(json, bin, prim) {
  const ext = prim.extensions[DRACO_EXT];
  const data = viewBytes(json, bin, ext.bufferView);
  const run = (skip) => {
    const dec = new D.Decoder();
    const buf = new D.DecoderBuffer();
    buf.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
    if (skip) for (const t of [D.POSITION, D.NORMAL, D.TEX_COORD, D.COLOR, D.GENERIC]) dec.SkipAttributeTransform(t);
    const mesh = new D.Mesh();
    const st = dec.DecodeBufferToMesh(buf, mesh);
    if (!st.ok()) throw new Error("Draco: " + st.error_msg());
    return { dec, buf, mesh };
  };
  const a = run(false);
  const nf = a.mesh.num_faces();
  const np = a.mesh.num_points();
  const faces = new Uint32Array(nf * 3);
  const ia = new D.DracoInt32Array();
  for (let f = 0; f < nf; f++) {
    a.dec.GetFaceFromMesh(a.mesh, f, ia);
    faces[f * 3] = ia.GetValue(0);
    faces[f * 3 + 1] = ia.GetValue(1);
    faces[f * 3 + 2] = ia.GetValue(2);
  }
  D.destroy(ia);
  const q = run(true);
  const attrs = {};
  for (const [name, uid] of Object.entries(ext.attributes)) {
    const att = a.dec.GetAttributeByUniqueId(a.mesh, uid);
    const size = att.num_components();
    const fa = new D.DracoFloat32Array();
    a.dec.GetAttributeFloatForAllPoints(a.mesh, att, fa);
    const values = new Float32Array(np * size);
    for (let i = 0; i < np * size; i++) values[i] = fa.GetValue(i);
    D.destroy(fa);
    const qatt = q.dec.GetAttributeByUniqueId(q.mesh, uid);
    const tr = new D.AttributeQuantizationTransform();
    let quant = null;
    if (tr.InitFromAttribute(qatt)) {
      quant = { bits: tr.quantization_bits(), origin: Array.from({ length: size }, (_, k) => tr.min_value(k)), range: tr.range() };
    }
    D.destroy(tr);
    attrs[name] = { values, size, quant, uid };
  }
  for (const r of [a, q]) {
    D.destroy(r.mesh);
    D.destroy(r.buf);
    D.destroy(r.dec);
  }
  return { attrs, faces, np, nf };
}

/**
 * Encode a triangle mesh with Draco (edgebreaker, speed 4 like the Blender exporter's level 6). `attrs`: glTF name →
 * { values (Float32Array, per point), size, quant: {bits, origin?, range?} | null }. An `origin` + `range` pins the
 * quantization grid (a re-encode then decodes to the same floats). Returns { bytes, ids: glTF name → Draco attribute id }.
 */
export function encodeDraco(attrs, faces, np) {
  const mesh = new E.Mesh();
  const mb = new E.MeshBuilder();
  mb.AddFacesToMesh(mesh, faces.length / 3, faces);
  const ids = {};
  for (const [name, a] of Object.entries(attrs)) {
    ids[name] = mb.AddFloatAttributeToMesh(mesh, E[TYPE_OF(name)], np, a.size, a.values);
    if (ids[name] < 0) throw new Error("Draco: could not add " + name);
  }
  const enc = new E.ExpertEncoder(mesh);
  for (const [name, a] of Object.entries(attrs)) {
    if (!a.quant) continue;
    if (a.quant.origin) enc.SetAttributeExplicitQuantization(ids[name], a.quant.bits, a.size, a.quant.origin, a.quant.range);
    else enc.SetAttributeQuantization(ids[name], a.quant.bits);
  }
  enc.SetSpeedOptions(4, 4);
  enc.SetTrackEncodedProperties(true);
  enc.SetEncodingMethod(E.MESH_EDGEBREAKER_ENCODING);
  const out = new E.DracoInt8Array();
  const len = enc.EncodeToDracoBuffer(false, out);
  if (!len) throw new Error("Draco: encoding failed");
  const bytes = Buffer.alloc(len);
  for (let i = 0; i < len; i++) bytes[i] = out.GetValue(i) & 0xff;
  const nPoints = enc.GetNumberOfEncodedPoints();
  const nFaces = enc.GetNumberOfEncodedFaces();
  destroyAll(E, out, enc, mb, mesh);
  return { bytes, ids, nPoints, nFaces };
}
function destroyAll(M, ...xs) {
  for (const x of xs) M.destroy(x);
}

// ───────────────────────────────────────────── finding the old crescent ─────────────────────────────────────────────

/** A triangle of the old crescent: all three corners above the plinth, within 4.3 m of the fountain's axis, UV0 in the moon region. */
function isMoonCorner(p, t) {
  const a = MOON_ATLAS;
  const u0 = a.x / a.size - 1e-3;
  const u1 = (a.x + a.w) / a.size + 1e-3;
  const v0 = a.y / a.size - 1e-3;
  const v1 = (a.y + a.h) / a.size + 1e-3;
  const r = Math.hypot(p[0] - MOON.centre[0], p[2] - MOON.centre[1]);
  return p[1] > MOON.baseY - 0.01 && r < MOON.height * 0.58 && t[0] >= u0 && t[0] <= u1 && t[1] >= v0 && t[1] <= v1;
}

/**
 * Every triangle as a string of its corners' values, rotated to its smallest corner, sorted. With `grid` (glTF name →
 * the INPUT's quantization) a value is written as its step on that grid: the same string means the same quantized value.
 * (Draco keeps an explicit grid's origin and range as 6-decimal text, so a re-encode lands on a grid a few 1e-7 off the
 * input's: every value stays on its own step, `drift` reports how far it moved.)
 */
function canonicalTriangles(dec, faceList, grid = null, drift = null, table = new Map()) {
  const names = Object.keys(dec.attrs).sort();
  const code = (n, v, k) => {
    const q = grid?.[n];
    if (!q) return v.toString();
    const step = q.range / (2 ** q.bits - 1);
    const s = Math.round((v - q.origin[k]) / step);
    const key = `${n}/${k}/${s}`;
    if (!drift) table.set(key, v); // the input: remember each step's decoded value
    else if (table.has(key)) drift[n] = Math.max(drift[n] ?? 0, Math.abs(v - table.get(key)));
    return String(s);
  };
  const corner = (i) =>
    names
      .map((n) => {
        const a = dec.attrs[n];
        return Array.from(a.values.subarray(i * a.size, i * a.size + a.size), (v, k) => code(n, v, k)).join(",");
      })
      .join("|");
  const out = [];
  for (const f of faceList) {
    const cs = [corner(dec.faces[f * 3]), corner(dec.faces[f * 3 + 1]), corner(dec.faces[f * 3 + 2])];
    let best = 0;
    for (let k = 1; k < 3; k++) if (cs[k] < cs[best]) best = k;
    out.push([cs[best], cs[(best + 1) % 3], cs[(best + 2) % 3]].join(" / "));
  }
  return out.sort();
}

// ───────────────────────────────────────────── the patch ─────────────────────────────────────────────

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

export async function patchVillageMoon(input) {
  await draco();
  const { json, bin } = readGlb(input);
  const replace = new Map();
  const report = { removed: [], moon: null };
  const moonMeshIndex = json.nodes.find((n) => n.name === MOON_NODE)?.mesh;

  // 1. the old crescent's triangles, wherever they are (not in a fountain_moon of an earlier run)
  const changed = [];
  for (const [mi, mesh] of json.meshes.entries()) {
    if (mi === moonMeshIndex) continue;
    for (const [pi, prim] of mesh.primitives.entries()) {
      const matName = json.materials[prim.material]?.name ?? "";
      if (matName !== "LM_atlas" && matName !== MOON_MATERIAL.name) continue;
      if (!prim.extensions?.[DRACO_EXT]) throw new Error(`${mesh.name}[${pi}]: not Draco-compressed (unsupported)`);
      const dec = decodeDraco(json, bin, prim);
      const P = dec.attrs.POSITION.values;
      const T = dec.attrs.TEXCOORD_0?.values;
      if (!T) continue;
      const moonFaces = [];
      const keep = [];
      for (let f = 0; f < dec.nf; f++) {
        const ok = [0, 1, 2].every((k) => {
          const i = dec.faces[f * 3 + k];
          return isMoonCorner([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [T[i * 2], T[i * 2 + 1]]);
        });
        (ok ? moonFaces : keep).push(f);
      }
      if (moonFaces.length === 0) continue;
      if (keep.length === 0) throw new Error(`${mesh.name}[${pi}] holds nothing but the crescent (unexpected layout)`);
      // the remaining faces and the points they use, re-encoded on the same quantization grid
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
      const ext = prim.extensions[DRACO_EXT];
      replace.set(ext.bufferView, enc.bytes);
      ext.attributes = Object.fromEntries(Object.keys(ext.attributes).map((n) => [n, enc.ids[n]]));
      for (const [name, a] of Object.entries(attrs)) {
        const acc = json.accessors[prim.attributes[name]];
        acc.count = enc.nPoints;
        if (name === "POSITION") Object.assign(acc, accessorBounds(a.values, 3));
      }
      json.accessors[prim.indices].count = enc.nFaces * 3;
      if (enc.nFaces !== keep.length) throw new Error(`Draco dropped ${keep.length - enc.nFaces} faces of ${mesh.name}[${pi}]`);
      changed.push({ mi, pi, dec, moonFaces, keep });
      report.removed.push({ mesh: mesh.name, primitive: pi, material: matName, triangles: moonFaces.length, left: keep.length });
    }
  }

  // 2. the material
  const atlas = json.materials.find((m) => m.name === "LM_atlas");
  const baseTex = atlas?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (baseTex === undefined) throw new Error("LM_atlas has no base colour texture (the atlas)");
  let matIndex = json.materials.findIndex((m) => m.name === MOON_MATERIAL.name);
  const material = {
    name: MOON_MATERIAL.name,
    pbrMetallicRoughness: {
      baseColorFactor: MOON_MATERIAL.color,
      baseColorTexture: { index: baseTex },
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    extensions: { [UNLIT]: {} },
  };
  if (!(json.extensionsUsed ?? []).includes(UNLIT)) json.extensionsUsed = [...(json.extensionsUsed ?? []), UNLIT];
  if (matIndex < 0) {
    matIndex = json.materials.length;
    json.materials.push(material);
  } else json.materials[matIndex] = material;

  // 3. the crescent's mesh
  const g = moonGeometry();
  const np = g.positions.length / 3;
  const enc = encodeDraco(
    {
      POSITION: { values: new Float32Array(g.positions), size: 3, quant: { bits: 16 } },
      NORMAL: { values: new Float32Array(g.normals), size: 3, quant: { bits: 12 } },
      TEXCOORD_0: { values: new Float32Array(g.uvs), size: 2, quant: { bits: 14 } },
    },
    new Uint32Array(g.indices),
    np,
  );
  if (enc.nFaces !== g.indices.length / 3) throw new Error("Draco dropped crescent faces");
  const bounds = accessorBounds(new Float32Array(g.positions), 3);
  const accessorsWanted = {
    POSITION: { componentType: 5126, count: enc.nPoints, type: "VEC3", min: bounds.min, max: bounds.max },
    NORMAL: { componentType: 5126, count: enc.nPoints, type: "VEC3" },
    TEXCOORD_0: { componentType: 5126, count: enc.nPoints, type: "VEC2" },
  };
  const indexAccessor = { componentType: enc.nPoints < 65536 ? 5123 : 5125, count: enc.nFaces * 3, type: "SCALAR" };
  let moonMesh = moonMeshIndex === undefined ? null : json.meshes[moonMeshIndex];
  const old = moonMesh?.primitives?.[0];
  const accIndex = (name, want) => {
    const i = old?.attributes?.[name] ?? (name === "indices" ? old?.indices : undefined);
    if (i !== undefined) {
      json.accessors[i] = want;
      return i;
    }
    json.accessors.push(want);
    return json.accessors.length - 1;
  };
  let view = old?.extensions?.[DRACO_EXT]?.bufferView;
  if (view === undefined) {
    json.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: 0 });
    view = json.bufferViews.length - 1;
  }
  replace.set(view, enc.bytes);
  const attributes = {};
  for (const [name, want] of Object.entries(accessorsWanted)) attributes[name] = accIndex(name, want);
  const prim = {
    attributes,
    extensions: { [DRACO_EXT]: { bufferView: view, attributes: { ...enc.ids } } },
    indices: accIndex("indices", indexAccessor),
    material: matIndex,
    mode: 4,
  };
  if (!moonMesh) {
    moonMesh = { name: MOON_NODE, primitives: [prim] };
    json.meshes.push(moonMesh);
    const node = { mesh: json.meshes.length - 1, name: MOON_NODE };
    json.nodes.push(node);
    json.scenes[json.scene ?? 0].nodes.push(json.nodes.length - 1);
  } else {
    moonMesh.name = MOON_NODE;
    moonMesh.primitives = [prim];
  }
  report.moon = { vertices: enc.nPoints, triangles: enc.nFaces, dracoBytes: enc.bytes.length };

  const outBin = rebuildBin(json, bin, replace);
  const out = writeGlb(json, outBin);
  const checked = await verify(input, out, changed);
  report.unchangedPrimitives = checked.same;
  report.reencoded = changed.map((c) => ({ mesh: json.meshes[c.mi].name, primitive: c.pi, ...c.check }));
  return { out, report };
}

// ───────────────────────────────────────────── the check ─────────────────────────────────────────────

/** Fail unless everything but the crescent is what it was (see the header, step 4). */
async function verify(inputBuf, outBuf, changed) {
  const a = readGlb(inputBuf);
  const b = readGlb(outBuf);
  const fail = (m) => {
    throw new Error("verify: " + m);
  };
  const moonMeshB = b.json.nodes.find((n) => n.name === MOON_NODE)?.mesh;
  const moonMeshA = a.json.nodes.find((n) => n.name === MOON_NODE)?.mesh;
  const changedKey = new Set(changed.map((c) => `${c.mi}/${c.pi}`));
  // nodes, materials, textures, images, samplers, scenes: the same, but for the crescent's node and material
  const strip = (j, moonMesh) => ({
    nodes: j.nodes.filter((n) => n.name !== MOON_NODE),
    materials: j.materials.filter((m) => m.name !== MOON_MATERIAL.name),
    textures: j.textures,
    samplers: j.samplers,
    images: j.images?.map((im) => ({ ...im, bufferView: undefined })),
    extensionsUsed: j.extensionsUsed?.filter((e) => e !== UNLIT), // the crescent's material may be the first unlit one
    extensionsRequired: j.extensionsRequired,
    sceneNodes: j.scenes.map((s) => s.nodes.filter((i) => j.nodes[i].name !== MOON_NODE).map((i) => j.nodes[i].name)),
    meshes: j.meshes.filter((_, i) => i !== moonMesh).map((m) => m.name),
  });
  const sa = JSON.stringify(strip(a.json, moonMeshA));
  const sb = JSON.stringify(strip(b.json, moonMeshB));
  if (sa !== sb) fail("nodes / materials / textures / images / scenes differ outside the crescent");
  // images: byte for byte
  for (const [i, im] of (a.json.images ?? []).entries()) {
    const ba = viewBytes(a.json, a.bin, im.bufferView);
    const bb = viewBytes(b.json, b.bin, b.json.images[i].bufferView);
    if (!ba.equals(bb)) fail(`image ${im.name} changed`);
  }
  // every primitive but the crescent's: the same Draco bytes and accessors, or (the changed one) the same triangles minus the moon's
  let same = 0;
  for (const [mi, mesh] of a.json.meshes.entries()) {
    if (mi === moonMeshA) continue;
    for (const [pi, pa] of mesh.primitives.entries()) {
      const pb = b.json.meshes[mi].primitives[pi];
      if (pa.material !== pb.material || pa.mode !== pb.mode) fail(`${mesh.name}[${pi}] material/mode changed`);
      const ea = pa.extensions?.[DRACO_EXT];
      const eb = pb.extensions?.[DRACO_EXT];
      if (!changedKey.has(`${mi}/${pi}`)) {
        if (ea) {
          if (!viewBytes(a.json, a.bin, ea.bufferView).equals(viewBytes(b.json, b.bin, eb.bufferView))) fail(`${mesh.name}[${pi}] Draco bytes changed`);
          if (JSON.stringify(ea.attributes) !== JSON.stringify(eb.attributes)) fail(`${mesh.name}[${pi}] Draco ids changed`);
        }
        for (const [name, acc] of Object.entries(pa.attributes)) {
          const x = { ...a.json.accessors[acc] };
          const y = { ...b.json.accessors[pb.attributes[name]] };
          if (!ea) {
            // plain accessors: compare their bytes too
            const bx = viewBytes(a.json, a.bin, x.bufferView);
            const by = viewBytes(b.json, b.bin, y.bufferView);
            if (!bx.equals(by)) fail(`${mesh.name}[${pi}] ${name} bytes changed`);
          }
          delete x.bufferView;
          delete y.bufferView;
          if (JSON.stringify(x) !== JSON.stringify(y)) fail(`${mesh.name}[${pi}] accessor ${name} changed`);
        }
        same++;
        continue;
      }
      const c = changed.find((q) => q.mi === mi && q.pi === pi);
      const grid = Object.fromEntries(Object.entries(c.dec.attrs).map(([n, x]) => [n, x.quant]));
      const table = new Map();
      const want = canonicalTriangles(c.dec, c.keep, grid, null, table);
      const decB = decodeDraco(b.json, b.bin, pb);
      const drift = {};
      const got = canonicalTriangles(decB, Array.from({ length: decB.nf }, (_, f) => f), grid, drift, table);
      if (want.length !== got.length || want.some((t, k) => t !== got[k])) fail(`${mesh.name}[${pi}] triangles differ from the input's minus the crescent's`);
      const steps = Object.fromEntries(Object.entries(drift).map(([n, d]) => [n, d / (grid[n].range / (2 ** grid[n].bits - 1))]));
      if (Object.values(steps).some((s) => s > 0.05)) fail(`${mesh.name}[${pi}] values moved by up to ${JSON.stringify(steps)} quantization steps`);
      c.check = { triangles: got.length, drift, steps };
    }
  }
  // instancing and other node-level data: compared in `nodes` above. The crescent: a closed, outward mesh.
  const pm = b.json.meshes[moonMeshB].primitives[0];
  const dm = decodeDraco(b.json, b.bin, pm);
  const edges = new Map();
  let inward = 0;
  const P = dm.attrs.POSITION.values;
  const N = dm.attrs.NORMAL.values;
  for (let f = 0; f < dm.nf; f++) {
    const v = [0, 1, 2].map((k) => dm.faces[f * 3 + k]);
    const p = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const gN = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nS = [0, 1, 2].map((q) => N[v[0] * 3 + q] + N[v[1] * 3 + q] + N[v[2] * 3 + q]);
    if (gN[0] * nS[0] + gN[1] * nS[1] + gN[2] * nS[2] < 0) inward++;
    for (let k = 0; k < 3; k++) {
      // edges by position (Draco may split points)
      const key = (i) => `${P[i * 3]},${P[i * 3 + 1]},${P[i * 3 + 2]}`;
      const x = key(v[k]);
      const y = key(v[(k + 1) % 3]);
      const id = x < y ? `${x}|${y}` : `${y}|${x}`;
      edges.set(id, (edges.get(id) ?? 0) + 1);
    }
  }
  const open = [...edges.values()].filter((n) => n !== 2).length;
  if (inward) fail(`${inward} crescent triangles face inward`);
  if (open) fail(`the crescent is not closed (${open} edges not shared by two triangles)`);
  return { same };
}

// ───────────────────────────────────────────── CLI ─────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node scripts/patch-village-moon.mjs <village.glb> [--out <other.glb>] [--dry]");
    process.exit(2);
  }
  const outIdx = args.indexOf("--out");
  const target = outIdx >= 0 ? args[outIdx + 1] : file;
  const input = readFileSync(file);
  try {
    const { out, report } = await patchVillageMoon(input);
    const sameAsInput = out.equals(input);
    for (const r of report.removed) console.log(`removed the old crescent: ${r.triangles} triangles from ${r.mesh}[${r.primitive}] (${r.material}), ${r.left} left`);
    for (const r of report.reencoded) {
      const d = Object.entries(r.drift).map(([n, v]) => `${n} ${v.toExponential(1)} (${r.steps[n].toFixed(3)} step)`).join(", ");
      console.log(`  ${r.mesh}[${r.primitive}]: its other ${r.triangles} triangles decode to the same quantized values; largest drift ${d}`);
    }
    console.log(`  ${report.unchangedPrimitives} other primitives: Draco bytes identical`);
    console.log(`fountain_moon: ${report.moon.vertices} vertices, ${report.moon.triangles} triangles, Draco ${report.moon.dracoBytes} B (M_moon)`);
    console.log(`${file}: ${input.length} B -> ${out.length} B${sameAsInput ? " (already patched: unchanged)" : ""}; check passed`);
    if (!args.includes("--dry") && !(sameAsInput && target === file)) writeFileSync(target, out);
  } catch (err) {
    console.error(String(err?.stack ?? err));
    process.exit(1);
  }
}
