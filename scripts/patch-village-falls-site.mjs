/**
 * scripts/patch-village-falls-site.mjs — B1 waterfall W6: cuts the waterfall site box out of village.glb (feat/falls-w6).
 *
 *   node scripts/patch-village-falls-site.mjs <village.glb> [--out <other.glb>] [--edge <waterfall_site_edge.json>]
 *        [--forest <extra_far_trees.json>] [--dry]
 *
 * Why: the falls are their own model now (client/public/models/village/waterfall.glb, art/village/tools/bake_waterfall.py)
 * and own everything inside `layout.backdrop.waterfall.site` (x -140..-100, z -104..-58, game metres). The village still
 * drew its old falls there: the beige backdrop cliff with the falls painted into T_backdrop, 26 shore rocks, the old
 * M_waterfall ribbons / mist cards, the old pool disc, the ground grid and 138 far-forest cards — which covered the new
 * pool, slabs and shore. The village art sources of the shipped file (the houses rebuild, feat/houses-m1) are not on
 * this machine, so instead of a full Blender rebuild (which would bring the pre-houses village back) the shipped file is
 * cut in place, the way patch-village-busstop.mjs took the old shelter out. Design: docs/designs/waterfall/design.md §7.2.
 *
 * What it does (design §7.2 V1-V9; idempotent: a second run finds nothing to cut and changes nothing):
 *   V1-V3  drops every M_waterfall primitive (old ribbons + mist cards + foam ring), the old cliff grid and its 26 rocks
 *          (the M_backdrop components inside the box, whole), and clips the backdrop terrain, the ground grid (LM_grass)
 *          and the water (M_water: old pool disc, the feeder's first leg) EXACTLY at the box outline (triangles are split
 *          on the box's four lines; every attribute, the light-map UV too, is interpolated linearly, so what is left
 *          looks as before). The material M_waterfall and its image T_falls go (nothing else uses them); every other
 *          image keeps its bytes (T_sky / T_backdrop stay the sky-glare fix of a6d2f65), the light maps are untouched.
 *   V4/V5  the seam: the cut ground is also split at the falls ground's boundary vertices (falls_shape tensor axes,
 *          build_waterfall.tensor_axes), its outline is made the polyline through the visible (top-most) ground's heights
 *          there, and that polyline is written as waterfall_site_edge.json (172 points, 1 m, CCW from the north-west
 *          corner; the in-between points are ON the polyline), which build_waterfall.py meshes the falls ground to.
 *   V5b    pocket flatten: ground 0 in the rest pocket (x -106..-95, z -90..-68), back to its own height 2 m outside it.
 *   V7     the feeder stream starts at the outlet's end (-107, -58) with its water at -0.30 there, falling to -0.43 at the
 *          creek as before (its leg inside the box is the falls' own outlet).
 *   V9     far-forest cards: the ones standing inside the box go; --forest adds cards (a JSON list of {x, z, y, s, k})
 *          round the site.
 * Positions of the clipped primitives are re-encoded with Draco on the input's grid (POSITION of the backdrop: 18 bits
 * instead of 16 on the same origin/range, 8 mm instead of 34 mm steps, so the seam is exact to a few mm); every other
 * primitive's Draco bytes are left as they are. Exit 1 if a check fails.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeDraco, draco, encodeDraco, readGlb, writeGlb } from "./patch-village-moon.mjs";

export const SITE = { minX: -140, maxX: -100, minZ: -104, maxZ: -58 };
export const POCKET = { minX: -106, maxX: -95, minZ: -90, maxZ: -68 };
const RAMP = 2.0;
/** The pocket's outline and the ramp's outer outline, plus a middle line in the ramp (a smoother rise), as split lines. */
const POCKET_LINES = [
  [2, POCKET.minZ], [2, POCKET.minZ - 1], [2, POCKET.minZ - RAMP], [2, POCKET.maxZ], [2, POCKET.maxZ + 1], [2, POCKET.maxZ + RAMP],
  [0, POCKET.maxX], [0, POCKET.maxX + 1], [0, POCKET.maxX + RAMP], [0, POCKET.minX], [0, POCKET.minX - 1], [0, POCKET.minX - RAMP],
];
const DRACO_EXT = "KHR_draco_mesh_compression";
const INST_EXT = "EXT_mesh_gpu_instancing";
const EPS = 1e-6;

/**
 * The seam polyline's vertices: the falls ground's boundary vertices (art/village/tools/build_waterfall.py tensor_axes)
 * that the 1 m seam file can carry — every whole metre, but only the even ones on x -140..-128, where the falls grid
 * is 2 m. The falls ground meets the file's points linearly, so a polyline with vertices here only is met exactly.
 */
export function fallsAxes() {
  const xs = [];
  for (let x = SITE.minX; x <= SITE.maxX; x++) if (x > -128 || x % 2 === 0) xs.push(x);
  const zs = [];
  for (let z = SITE.minZ; z <= SITE.maxZ; z++) zs.push(z);
  return { xs, zs };
}

/** The seam file's points: every metre round the box, CCW seen from above (north W->E, east N->S, south E->W, west S->N). */
export function edgePoints() {
  const b = SITE;
  const pts = [];
  const run = (x0, z0, x1, z1) => {
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0));
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
  };
  run(b.minX, b.minZ, b.maxX, b.minZ);
  run(b.maxX, b.minZ, b.maxX, b.maxZ);
  run(b.maxX, b.maxZ, b.minX, b.maxZ);
  run(b.minX, b.maxZ, b.minX, b.minZ);
  return pts;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const boxDist = (x, z, b) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
const insideOpen = (x, z) => x > SITE.minX + EPS && x < SITE.maxX - EPS && z > SITE.minZ + EPS && z < SITE.maxZ - EPS;

/** Which side of the outline a point lies on (or null), and its coordinate along that side. */
function onEdge(x, z, tol = 1e-4) {
  const b = SITE;
  if (Math.abs(z - b.minZ) < tol && x >= b.minX - tol && x <= b.maxX + tol) return ["n", x];
  if (Math.abs(z - b.maxZ) < tol && x >= b.minX - tol && x <= b.maxX + tol) return ["s", x];
  if (Math.abs(x - b.maxX) < tol && z >= b.minZ - tol && z <= b.maxZ + tol) return ["e", z];
  if (Math.abs(x - b.minX) < tol && z >= b.minZ - tol && z <= b.maxZ + tol) return ["w", z];
  return null;
}

// ───────────────────────────────────────────── polygon clipping ─────────────────────────────────────────────
// A corner is a Float64Array of every attribute's values in a fixed order; POSITION is first (x, y, z at 0..2).

function lerpCorner(a, b, t) {
  const c = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) c[i] = a[i] + (b[i] - a[i]) * t;
  return c;
}

/** Split a convex polygon by the line (coord `axis` (0 x, 2 z) = v) into [below, above] (either may be empty). */
function splitPoly(poly, axis, v) {
  const lo = [];
  const hi = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const da = a[axis] - v;
    const db = b[axis] - v;
    if (da <= EPS) lo.push(a);
    if (da >= -EPS) hi.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const c = lerpCorner(a, b, da / (da - db));
      c[axis] = v;
      lo.push(c);
      hi.push(c);
    }
  }
  const ok = (p) => p.length >= 3 && Math.abs(area2(p)) > 1e-10;
  return [ok(lo) ? lo : null, ok(hi) ? hi : null];
}
function area2(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[2] - b[0] * a[2];
  }
  return s;
}
const centroid = (p) => {
  let x = 0;
  let z = 0;
  for (const c of p) {
    x += c[0];
    z += c[2];
  }
  return [x / p.length, z / p.length];
};
const bboxOf = (p) => {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of p) {
    x0 = Math.min(x0, c[0]);
    x1 = Math.max(x1, c[0]);
    z0 = Math.min(z0, c[2]);
    z1 = Math.max(z1, c[2]);
  }
  return { x0, x1, z0, z1 };
};

/**
 * Cut a triangle (3 corners) against the site box: the parts outside it, as polygons. Triangles that touch the
 * outline are also split at the falls ground's boundary-vertex lines, so the cut outline has a vertex at each of them.
 */
function cutTriangle(tri, axes) {
  const b = SITE;
  let bb = bboxOf(tri);
  if (bb.x1 <= b.minX + EPS || bb.x0 >= b.maxX - EPS || bb.z1 <= b.minZ + EPS || bb.z0 >= b.maxZ - EPS) {
    // outside or touching only: still split it at the seam lines if it lies on the outline
    const touches = (Math.abs(bb.x1 - b.minX) < EPS || Math.abs(bb.x0 - b.maxX) < EPS || Math.abs(bb.z1 - b.minZ) < EPS || Math.abs(bb.z0 - b.maxZ) < EPS);
    return touches ? seamSplit([tri], axes) : [tri];
  }
  let pieces = [tri];
  for (const [axis, v] of [[0, b.minX], [0, b.maxX], [2, b.minZ], [2, b.maxZ]]) {
    const next = [];
    for (const p of pieces) for (const q of splitPoly(p, axis, v)) if (q) next.push(q);
    pieces = next;
  }
  const out = pieces.filter((p) => {
    const [cx, cz] = centroid(p);
    return !insideOpen(cx, cz);
  });
  return seamSplit(out, axes);
}

/** Split the polygons lying against the outline at the seam lines (x = xs on the north / south side, z = zs east / west). */
function seamSplit(polys, axes) {
  const b = SITE;
  const res = [];
  for (const p of polys) {
    const bb = bboxOf(p);
    let parts = [p];
    const nsTouch = (Math.abs(bb.z1 - b.minZ) < 1e-4 || Math.abs(bb.z0 - b.maxZ) < 1e-4) && bb.x1 > b.minX && bb.x0 < b.maxX;
    const ewTouch = (Math.abs(bb.x1 - b.minX) < 1e-4 || Math.abs(bb.x0 - b.maxX) < 1e-4) && bb.z1 > b.minZ && bb.z0 < b.maxZ;
    if (nsTouch) {
      for (const xv of axes.xs) {
        if (xv <= bb.x0 + 1e-4 || xv >= bb.x1 - 1e-4) continue;
        const next = [];
        for (const q of parts) for (const r of splitPoly(q, 0, xv)) if (r) next.push(r);
        parts = next;
      }
    }
    if (ewTouch) {
      for (const zv of axes.zs) {
        if (zv <= bb.z0 + 1e-4 || zv >= bb.z1 - 1e-4) continue;
        const next = [];
        for (const q of parts) for (const r of splitPoly(q, 2, zv)) if (r) next.push(r);
        parts = next;
      }
    }
    res.push(...parts);
  }
  return res;
}

// ───────────────────────────────────────────── mesh helpers ─────────────────────────────────────────────

/** Union-find components of a decoded primitive (corners joined by equal positions): per face its component id. */
function components(dec) {
  const P = dec.attrs.POSITION.values;
  const key = (i) => `${P[i * 3].toFixed(4)},${P[i * 3 + 1].toFixed(4)},${P[i * 3 + 2].toFixed(4)}`;
  const id = new Map();
  const rep = new Int32Array(dec.np);
  for (let i = 0; i < dec.np; i++) {
    const k = key(i);
    if (!id.has(k)) id.set(k, id.size);
    rep[i] = id.get(k);
  }
  const par = Int32Array.from({ length: id.size }, (_, i) => i);
  const find = (a) => {
    while (par[a] !== a) {
      par[a] = par[par[a]];
      a = par[a];
    }
    return a;
  };
  for (let f = 0; f < dec.nf; f++) {
    const a = find(rep[dec.faces[f * 3]]);
    par[find(rep[dec.faces[f * 3 + 1]])] = a;
    par[find(rep[dec.faces[f * 3 + 2]])] = a;
  }
  const comp = new Int32Array(dec.nf);
  for (let f = 0; f < dec.nf; f++) comp[f] = find(rep[dec.faces[f * 3]]);
  return comp;
}

/** The attribute layout of a decoded primitive: [name, size, offset] with POSITION first. */
function layoutOf(dec) {
  const names = ["POSITION", ...Object.keys(dec.attrs).filter((n) => n !== "POSITION").sort()];
  let off = 0;
  return names.map((n) => {
    const s = dec.attrs[n].size;
    const r = [n, s, off];
    off += s;
    return r;
  });
}
function cornerOf(dec, lay, i) {
  const width = lay.reduce((s, [, n]) => s + n, 0);
  const c = new Float64Array(width);
  for (const [n, s, o] of lay) for (let k = 0; k < s; k++) c[o + k] = dec.attrs[n].values[i * s + k];
  return c;
}

/** Polygons (lists of corners) to indexed attributes: corners with identical values share a point. */
function buildMesh(polys, lay) {
  const width = lay.reduce((s, [, n]) => s + n, 0);
  const map = new Map();
  const vals = [];
  const faces = [];
  const idx = (c) => {
    const k = Array.from(c, (v) => v.toPrecision(9)).join(",");
    let i = map.get(k);
    if (i === undefined) {
      i = map.size;
      map.set(k, i);
      vals.push(c);
    }
    return i;
  };
  for (const p of polys) {
    const ids = p.map(idx);
    const sliver = (a, b, c) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-7; // left by a split: no area
    };
    for (let k = 1; k + 1 < ids.length; k++) {
      if (ids[0] === ids[k] || ids[k] === ids[k + 1] || ids[0] === ids[k + 1]) continue;
      if (sliver(p[0], p[k], p[k + 1])) continue;
      faces.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  const np = vals.length;
  const attrs = {};
  for (const [n, s, o] of lay) {
    const a = new Float32Array(np * s);
    for (let i = 0; i < np; i++) for (let k = 0; k < s; k++) a[i * s + k] = vals[i][o + k];
    attrs[n] = { values: a, size: s };
  }
  return { attrs, faces: Uint32Array.from(faces), np, width };
}

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

/** Polyline interpolation: tab = sorted [t, y]. */
function interp(tab, t) {
  if (t <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (t <= tab[i][0]) {
      const [t0, y0] = tab[i - 1];
      const [t1, y1] = tab[i];
      return y0 + ((y1 - y0) * (t - t0)) / (t1 - t0 || 1);
    }
  }
  return tab[tab.length - 1][1];
}

/** Height of the top-most triangle of `polysets` under (x, z), or null. */
function topHeight(polysets, x, z) {
  let best = null;
  for (const polys of polysets) {
    for (const p of polys) {
      for (let k = 1; k + 1 < p.length; k++) {
        const a = p[0];
        const b = p[k];
        const c = p[k + 1];
        const minx = Math.min(a[0], b[0], c[0]);
        const maxx = Math.max(a[0], b[0], c[0]);
        const minz = Math.min(a[2], b[2], c[2]);
        const maxz = Math.max(a[2], b[2], c[2]);
        if (x < minx - 1e-5 || x > maxx + 1e-5 || z < minz - 1e-5 || z > maxz + 1e-5) continue;
        const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
        if (Math.abs(d) < 1e-12) continue;
        const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d;
        const v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
        if (u < -1e-5 || v < -1e-5 || u + v > 1 + 1e-5) continue;
        const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
        if (best === null || y > best) best = y;
      }
    }
  }
  return best;
}

// ───────────────────────────────────────────── the feeder stream (V7) ─────────────────────────────────────────────
/** art/village/tools/build_village.py feeder_pts() without its first point (the old pool), W0 §12: starts at (-107, -58). */
export const FEEDER = [[-107.0, -58.0], [-104.5, -25.0], [-106.5, 10.0], [-105.0, 42.0], [-110.0, 62.0], [-118.0, 70.0]];
export const FEEDER_Y = [-0.3, -0.43];
function feederDist(x, z) {
  let best = Infinity;
  let bestT = 0;
  let acc = 0;
  let total = 0;
  for (let i = 1; i < FEEDER.length; i++) total += Math.hypot(FEEDER[i][0] - FEEDER[i - 1][0], FEEDER[i][1] - FEEDER[i - 1][1]);
  for (let i = 1; i < FEEDER.length; i++) {
    const [ax, az] = FEEDER[i - 1];
    const [bx, bz] = FEEDER[i];
    const dx = bx - ax;
    const dz = bz - az;
    const L = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (L * L)));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < best) {
      best = d;
      bestT = (acc + t * L) / total;
    }
    acc += L;
  }
  return [best, bestT];
}

/**
 * A position grid whose step is a power of two (and no coarser than the input's, or `maxStep`) and whose origin is a
 * multiple of it: the box lines (whole metres) and the seam heights (1/128 m) then decode exactly.
 */
function exactGrid(values, q, maxStep) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i++) {
    min[i % 3] = Math.min(min[i % 3], values[i]);
    max[i % 3] = Math.max(max[i % 3], values[i]);
  }
  let step = 2 ** Math.floor(Math.log2(q.range / (2 ** q.bits - 1)));
  if (maxStep) step = Math.min(step, maxStep);
  const origin = min.map((m) => Math.floor(m / step) * step);
  const ext = Math.max(...max.map((m, k) => m - origin[k]));
  const bits = Math.ceil(Math.log2(ext / step + 2));
  if (bits > 24) throw new Error("position grid too fine");
  return { bits, origin, range: step * (2 ** bits - 1) };
}

// ───────────────────────────────────────────── Draco with integer colours ─────────────────────────────────────────────
const TYPE_OF = (name) =>
  name === "POSITION" ? "POSITION" : name === "NORMAL" ? "NORMAL" : name.startsWith("TEXCOORD") ? "TEX_COORD" : name.startsWith("COLOR") ? "COLOR" : "GENERIC";
/**
 * encodeDraco (patch-village-moon.mjs) for attributes whose accessor is an integer type: COLOR_0 (unsigned byte,
 * normalised) and COLOR_1 (unsigned short, normalised) go back as the integers they were, not as floats.
 */
function encodeTyped(attrs, faces, np) {
  if (Object.values(attrs).every((a) => a.ct === 5126)) return encodeDraco(attrs, faces, np);
  const E = DRACO_E;
  const mesh = new E.Mesh();
  const mb = new E.MeshBuilder();
  mb.AddFacesToMesh(mesh, faces.length / 3, faces);
  const ids = {};
  for (const [name, a] of Object.entries(attrs)) {
    const t = E[TYPE_OF(name)];
    if (a.ct === 5126) ids[name] = mb.AddFloatAttributeToMesh(mesh, t, np, a.size, a.values);
    else if (a.ct === 5121) ids[name] = mb.AddUInt8Attribute(mesh, t, np, a.size, Uint8Array.from(a.values, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)));
    else if (a.ct === 5123) ids[name] = mb.AddUInt16Attribute(mesh, t, np, a.size, Uint16Array.from(a.values, (v) => Math.round(Math.min(1, Math.max(0, v)) * 65535)));
    else throw new Error(`${name}: component type ${a.ct}`);
    if (ids[name] < 0) throw new Error("Draco: could not add " + name);
    if (a.ct !== 5126) mb.SetNormalizedFlagForAttribute(mesh, ids[name], true);
  }
  const enc = new E.ExpertEncoder(mesh);
  for (const [name, a] of Object.entries(attrs)) {
    if (!a.quant || a.ct !== 5126) continue;
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
  for (const x of [out, enc, mb, mesh]) E.destroy(x);
  return { bytes, ids, nPoints, nFaces };
}
let DRACO_E = null;

// ───────────────────────────────────────────── the patch ─────────────────────────────────────────────

const viewBytes = (json, bin, i) => {
  const v = json.bufferViews[i];
  return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
};
const readFloats = (json, bin, ai) => {
  const a = json.accessors[ai];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  if (a.componentType !== 5126) throw new Error(`accessor ${ai}: not float`);
  const v = json.bufferViews[a.bufferView];
  if (v.byteStride && v.byteStride !== n * 4) throw new Error(`accessor ${ai}: strided`);
  const bytes = viewBytes(json, bin, a.bufferView).subarray(a.byteOffset ?? 0, (a.byteOffset ?? 0) + a.count * n * 4);
  return { f: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), n };
};

export async function patchVillageFallsSite(input, { forest = [] } = {}) {
  DRACO_E = (await draco()).E;
  const { json, bin } = readGlb(input);
  const axes = fallsAxes();
  const report = { removedPrimitives: [], cut: [], removedComponents: 0, farCardsRemoved: 0, farCardsAdded: 0 };
  const replace = new Map(); // bufferView -> new bytes
  const matName = (prim) => json.materials[prim.material]?.name ?? "";
  // already cut (the old falls' material is gone with the cut): nothing to do — the pocket ramp must not be applied twice
  if (!json.materials.some((m) => m.name === "M_waterfall")) return { out: input, report, sides: null, unchanged: true };

  // 1. M_waterfall primitives go (V2)
  for (const mesh of json.meshes) {
    const keep = mesh.primitives.filter((p) => matName(p) !== "M_waterfall");
    if (keep.length !== mesh.primitives.length) report.removedPrimitives.push(`${mesh.name}: ${mesh.primitives.length - keep.length} M_waterfall`);
    mesh.primitives = keep;
  }

  // 2. decode the primitives that reach into the box
  const CUT_MATS = new Set(["M_backdrop", "LM_grass", "M_water"]);
  const work = [];
  for (const [mi, mesh] of json.meshes.entries()) {
    for (const [pi, prim] of mesh.primitives.entries()) {
      const m = matName(prim);
      if (!CUT_MATS.has(m)) continue;
      if (!prim.extensions?.[DRACO_EXT]) throw new Error(`${mesh.name}[${pi}] is not Draco-compressed`);
      const a = json.accessors[prim.attributes.POSITION];
      if (a.max[0] < SITE.minX - 10 || a.min[0] > SITE.maxX + 10 || a.max[2] < SITE.minZ - 10 || a.min[2] > SITE.maxZ + 10) {
        if (!(m === "M_water" && a.min[0] < -96)) continue; // the feeder's water legs further south are re-levelled too
      }
      work.push({ mi, pi, prim, mesh, mat: m, dec: decodeDraco(json, bin, prim) });
    }
  }

  // 3. per primitive: polygons outside the box (the old cliff grid + rocks: whole components inside the box go)
  for (const w of work) {
    const { dec, mat } = w;
    const lay = layoutOf(dec);
    w.lay = lay;
    const comp = mat === "M_backdrop" ? components(dec) : null;
    let dropComp = new Set();
    if (comp) {
      const stats = new Map();
      for (let f = 0; f < dec.nf; f++) {
        let s = stats.get(comp[f]);
        if (!s) stats.set(comp[f], (s = { n: 0, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }));
        s.n++;
        for (let k = 0; k < 3; k++) {
          const i = dec.faces[f * 3 + k];
          const x = dec.attrs.POSITION.values[i * 3];
          const z = dec.attrs.POSITION.values[i * 3 + 2];
          s.x0 = Math.min(s.x0, x);
          s.x1 = Math.max(s.x1, x);
          s.z0 = Math.min(s.z0, z);
          s.z1 = Math.max(s.z1, z);
        }
      }
      for (const [c, s] of stats) {
        const cx = (s.x0 + s.x1) / 2;
        const cz = (s.z0 + s.z1) / 2;
        // the old cliff grid and its shore rocks: every small part reaching into the box (one rock straddles its edge)
        const reaches = s.x1 > SITE.minX && s.x0 < SITE.maxX && s.z1 > SITE.minZ && s.z0 < SITE.maxZ;
        if (s.n < 5000 && reaches && insideOpen(cx, cz) || (s.n < 200 && reaches)) dropComp.add(c);
      }
      report.removedComponents += dropComp.size;
    }
    const polys = [];
    let changed = dropComp.size > 0;
    for (let f = 0; f < dec.nf; f++) {
      if (comp && dropComp.has(comp[f])) continue;
      const tri = [0, 1, 2].map((k) => cornerOf(dec, lay, dec.faces[f * 3 + k]));
      // V5b pocket flatten on the ground (before the cut, so the seam carries it): the ground is first split on the
      // pocket's lines and the ramp's outer lines, so the flat floor and the 2 m ramp are drawn as such (the grid is
      // 2.5 m and the backdrop 7 m: flattening their corners only would leave the pocket's edges tilted)
      let pre = [tri];
      if (mat !== "M_water") {
        const bb = bboxOf(tri);
        if (bb.x1 > POCKET.minX - RAMP && bb.x0 < POCKET.maxX + RAMP && bb.z1 > POCKET.minZ - RAMP && bb.z0 < POCKET.maxZ + RAMP) {
          for (const [axis, v] of POCKET_LINES) {
            const next = [];
            for (const p of pre) {
              const b2 = bboxOf(p);
              const lo = axis === 0 ? b2.x0 : b2.z0;
              const hi = axis === 0 ? b2.x1 : b2.z1;
              if (v <= lo + EPS || v >= hi - EPS) next.push(p);
              else for (const q of splitPoly(p, axis, v)) if (q) next.push(q);
            }
            pre = next;
          }
          const done = new Set();
          for (const p of pre) {
            for (const c of p) {
              if (done.has(c) || c[1] > 3) continue;
              done.add(c);
              const k = smooth(RAMP, 0.0, boxDist(c[0], c[2], POCKET));
              if (k > 0 && Math.abs(c[1]) > 1e-6) {
                c[1] *= 1 - k;
                changed = true;
              }
            }
          }
          if (pre.length !== 1) changed = true;
        }
      }
      const pieces = pre.flatMap((p) => cutTriangle(p, axes));
      if (pieces.length !== 1 || pieces[0] !== tri) changed = true;
      polys.push(...pieces);
    }
    w.polys = polys;
    w.changed = changed;
  }

  // 4. the seam polyline: the top-most ground (backdrop terrain + ground grid) at the falls ground's boundary vertices
  const ground = work.filter((w) => w.mat !== "M_water").map((w) => w.polys);
  const sides = { n: [], s: [], e: [], w: [] };
  // read 1 mm outside the outline (what is seen from inside the box), rounded to the backdrop's 1/128 m grid
  const NUDGE = 1e-3;
  const q128 = (y) => (y === null ? null : Math.round(y * 128) / 128);
  const nudgeX = (x) => (x <= SITE.minX + EPS ? -NUDGE : x >= SITE.maxX - EPS ? NUDGE : 0);
  const nudgeZ = (z) => (z <= SITE.minZ + EPS ? -NUDGE : z >= SITE.maxZ - EPS ? NUDGE : 0);
  for (const x of axes.xs) {
    sides.n.push([x, q128(topHeight(ground, x + nudgeX(x), SITE.minZ - NUDGE))]);
    sides.s.push([x, q128(topHeight(ground, x + nudgeX(x), SITE.maxZ + NUDGE))]);
  }
  for (const z of axes.zs) {
    sides.w.push([z, q128(topHeight(ground, SITE.minX - NUDGE, z + nudgeZ(z)))]);
    sides.e.push([z, q128(topHeight(ground, SITE.maxX + NUDGE, z + nudgeZ(z)))]);
  }
  for (const [k, tab] of Object.entries(sides)) {
    tab.sort((a, b) => a[0] - b[0]);
    const miss = tab.filter((r) => r[1] === null);
    if (miss.length) throw new Error(`seam side ${k}: no ground at ${miss.map((r) => r[0]).join(", ")}`);
  }
  // snap the outline vertices of the visible (top-most) ground onto it; a layer hidden under another stays
  let snapped = 0;
  let worstSnap = 0;
  const visible = new Map();
  for (const w of work) {
    if (w.mat === "M_water") continue;
    for (const p of w.polys) {
      for (const c of p) {
        const e = onEdge(c[0], c[2]);
        if (!e) continue;
        const k = `${c[0].toFixed(5)},${c[2].toFixed(5)}`;
        if (!visible.has(k)) visible.set(k, topHeight(ground, c[0] + nudgeX(c[0]), c[2] + nudgeZ(c[2])));
        c.top = visible.get(k);
      }
    }
  }
  for (const w of work) {
    if (w.mat === "M_water") continue;
    for (const p of w.polys) {
      for (const c of p) {
        const e = onEdge(c[0], c[2]);
        if (!e) continue;
        if (c.top !== null && c[1] >= c.top - 0.1) {
          // on the output's grid first (1/128 m: both grids hold it), then the polyline's height there
          const t = Math.round(e[1] * 128) / 128;
          if (e[0] === "n" || e[0] === "s") c[0] = t;
          else c[2] = t;
          const y = Math.round(interp(sides[e[0]], t) * 128) / 128;
          worstSnap = Math.max(worstSnap, Math.abs(c[1] - y));
          if (c[1] !== y) w.changed = true;
          c[1] = y;
          snapped++;
        }
      }
    }
  }
  report.seam = { snapped, worstSnapM: +worstSnap.toFixed(4) };

  // 5. V7: the feeder's water from (-107, -58): -0.30 there, -0.43 at the creek
  for (const w of work) {
    if (w.mat !== "M_water") continue;
    for (const p of w.polys) {
      for (const c of p) {
        if (c[0] > -96 || c[2] < SITE.maxZ - 1e-4) continue;
        const [d, t] = feederDist(c[0], c[2]);
        if (d > 2.2 || c[1] > -0.1 || c[1] < -0.6) continue;
        const y = FEEDER_Y[0] + (FEEDER_Y[1] - FEEDER_Y[0]) * t;
        if (Math.abs(c[1] - y) > 1e-6) {
          c[1] = y;
          w.changed = true;
        }
      }
    }
  }

  // 6. re-encode the changed primitives
  for (const w of work) {
    if (!w.changed) continue;
    const built = buildMesh(w.polys, w.lay);
    const attrs = {};
    for (const [n] of w.lay) {
      const q = w.dec.attrs[n].quant;
      let quant = q;
      if (q && n === "POSITION") quant = exactGrid(built.attrs[n].values, q, w.mat === "M_backdrop" ? 1 / 128 : null);
      const ct = json.accessors[w.prim.attributes[n]].componentType;
      attrs[n] = { values: built.attrs[n].values, size: built.attrs[n].size, quant, ct };
    }
    const enc = encodeTyped(attrs, built.faces, built.np);
    if (enc.nFaces !== built.faces.length / 3) throw new Error(`Draco dropped faces of ${w.mesh.name}[${w.pi}]`);
    const ext = w.prim.extensions[DRACO_EXT];
    replace.set(ext.bufferView, enc.bytes);
    ext.attributes = Object.fromEntries(Object.keys(ext.attributes).map((n) => [n, enc.ids[n]]));
    for (const [n] of w.lay) {
      const acc = json.accessors[w.prim.attributes[n]];
      acc.count = enc.nPoints;
      if (n === "POSITION") Object.assign(acc, accessorBounds(built.attrs[n].values, 3));
    }
    json.accessors[w.prim.indices].count = enc.nFaces * 3;
    report.cut.push({ mesh: w.mesh.name, primitive: w.pi, material: w.mat, faces: [w.dec.nf, enc.nFaces] });
  }

  // 7. V9: far-forest cards — out of the box, extra ones round it
  const farNodes = json.nodes.filter((n) => n.name?.startsWith("inst__far_") && n.extensions?.[INST_EXT]);
  for (const [k, node] of farNodes.entries()) {
    const at = node.extensions[INST_EXT].attributes;
    const T = readFloats(json, bin, at.TRANSLATION);
    const R = readFloats(json, bin, at.ROTATION);
    const Sc = readFloats(json, bin, at.SCALE);
    const keep = [];
    for (let i = 0; i < T.f.length / 3; i++) if (!insideOpen(T.f[i * 3], T.f[i * 3 + 2])) keep.push(i);
    const add = forest.filter((t) => t.k === k && !insideOpen(t.x, t.z));
    const removed = T.f.length / 3 - keep.length;
    if (!removed && !add.length) continue;
    report.farCardsRemoved += removed;
    report.farCardsAdded += add.length;
    const n = keep.length + add.length;
    const t2 = new Float32Array(n * 3);
    const r2 = new Float32Array(n * 4);
    const s2 = new Float32Array(n * 3);
    keep.forEach((i, j) => {
      t2.set(T.f.subarray(i * 3, i * 3 + 3), j * 3);
      r2.set(R.f.subarray(i * 4, i * 4 + 4), j * 4);
      s2.set(Sc.f.subarray(i * 3, i * 3 + 3), j * 3);
    });
    add.forEach((t, a) => {
      const j = keep.length + a;
      t2.set([t.x, t.y, t.z], j * 3);
      const ang = t.r ?? 0;
      r2.set([0, Math.sin(ang / 2), 0, Math.cos(ang / 2)], j * 4);
      s2.set([t.s, t.s, t.s], j * 3);
    });
    for (const [ai, arr] of [[at.TRANSLATION, t2], [at.ROTATION, r2], [at.SCALE, s2]]) {
      const acc = json.accessors[ai];
      if (acc.byteOffset) throw new Error("instance accessor with an offset");
      acc.count = n;
      if (acc.min) Object.assign(acc, accessorBounds(arr, arr.length / n));
      replace.set(acc.bufferView, Buffer.from(arr.buffer));
    }
  }

  if (!report.removedPrimitives.length && !report.cut.length && !report.farCardsRemoved && !report.farCardsAdded) {
    return { out: input, report, sides, unchanged: true };
  }

  // 8. garbage: empty meshes / nodes, unused materials, textures, images, accessors and buffer views
  const out = gc(json, bin, replace);
  return { out: writeGlb(out.json, out.bin), report: { ...report, ...out.report }, sides };
}

/** Drop what nothing uses any more and lay the binary chunk out again (4-byte aligned, buffer-view order kept). */
function gc(json, bin, replace) {
  const rep = {};
  // nodes whose mesh lost every primitive
  const emptyMesh = new Set(json.meshes.map((m, i) => (m.primitives.length ? -1 : i)).filter((i) => i >= 0));
  const dropNode = new Set();
  json.nodes.forEach((n, i) => {
    if (n.mesh !== undefined && emptyMesh.has(n.mesh) && !(n.children?.length)) dropNode.add(i);
  });
  rep.removedNodes = [...dropNode].map((i) => json.nodes[i].name);
  const nodeMap = remap(json.nodes.length, dropNode);
  json.nodes = json.nodes.filter((_, i) => !dropNode.has(i));
  for (const n of json.nodes) if (n.children) n.children = n.children.map((c) => nodeMap[c]);
  for (const s of json.scenes) s.nodes = s.nodes.filter((i) => !dropNode.has(i)).map((i) => nodeMap[i]);
  // meshes
  const usedMesh = new Set(json.nodes.map((n) => n.mesh).filter((m) => m !== undefined));
  const meshDrop = new Set(json.meshes.map((_, i) => i).filter((i) => !usedMesh.has(i)));
  const meshMap = remap(json.meshes.length, meshDrop);
  json.meshes = json.meshes.filter((_, i) => !meshDrop.has(i));
  for (const n of json.nodes) if (n.mesh !== undefined) n.mesh = meshMap[n.mesh];
  // materials
  const usedMat = new Set(json.meshes.flatMap((m) => m.primitives.map((p) => p.material)));
  const matDrop = new Set(json.materials.map((_, i) => i).filter((i) => !usedMat.has(i)));
  rep.removedMaterials = [...matDrop].map((i) => json.materials[i].name);
  const matMap = remap(json.materials.length, matDrop);
  json.materials = json.materials.filter((_, i) => !matDrop.has(i));
  for (const m of json.meshes) for (const p of m.primitives) p.material = matMap[p.material];
  // textures (every textureInfo object in the materials: an object with an `index`)
  const texRefs = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (typeof o.index === "number" && ("texCoord" in o || Object.keys(o).length <= 4)) texRefs.push(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  json.materials.forEach(walk);
  const usedTex = new Set(texRefs.map((r) => r.index));
  const texDrop = new Set(json.textures.map((_, i) => i).filter((i) => !usedTex.has(i)));
  const texMap = remap(json.textures.length, texDrop);
  json.textures = json.textures.filter((_, i) => !texDrop.has(i));
  for (const r of texRefs) r.index = texMap[r.index];
  const srcOf = (t) => t.extensions?.EXT_texture_webp?.source ?? t.source;
  const usedImg = new Set(json.textures.map(srcOf));
  const imgDrop = new Set(json.images.map((_, i) => i).filter((i) => !usedImg.has(i)));
  rep.removedImages = [...imgDrop].map((i) => json.images[i].name);
  const imgMap = remap(json.images.length, imgDrop);
  json.images = json.images.filter((_, i) => !imgDrop.has(i));
  for (const t of json.textures) {
    if (t.extensions?.EXT_texture_webp) t.extensions.EXT_texture_webp.source = imgMap[t.extensions.EXT_texture_webp.source];
    if (t.source !== undefined) t.source = imgMap[t.source];
  }
  // accessors
  const usedAcc = new Set();
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      Object.values(p.attributes).forEach((a) => usedAcc.add(a));
      if (p.indices !== undefined) usedAcc.add(p.indices);
    }
  }
  for (const n of json.nodes) {
    const at = n.extensions?.[INST_EXT]?.attributes;
    if (at) Object.values(at).forEach((a) => usedAcc.add(a));
  }
  const accDrop = new Set(json.accessors.map((_, i) => i).filter((i) => !usedAcc.has(i)));
  const accMap = remap(json.accessors.length, accDrop);
  json.accessors = json.accessors.filter((_, i) => !accDrop.has(i));
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] = accMap[p.attributes[k]];
      if (p.indices !== undefined) p.indices = accMap[p.indices];
    }
  }
  for (const n of json.nodes) {
    const at = n.extensions?.[INST_EXT]?.attributes;
    if (at) for (const k of Object.keys(at)) at[k] = accMap[at[k]];
  }
  // buffer views
  const usedView = new Set();
  json.accessors.forEach((a) => a.bufferView !== undefined && usedView.add(a.bufferView));
  json.images.forEach((im) => im.bufferView !== undefined && usedView.add(im.bufferView));
  for (const m of json.meshes) for (const p of m.primitives) if (p.extensions?.[DRACO_EXT]) usedView.add(p.extensions[DRACO_EXT].bufferView);
  const viewDrop = new Set(json.bufferViews.map((_, i) => i).filter((i) => !usedView.has(i)));
  const viewMap = remap(json.bufferViews.length, viewDrop);
  const parts = [];
  let off = 0;
  const views = [];
  json.bufferViews.forEach((v, i) => {
    if (viewDrop.has(i)) return;
    const bytes = replace.get(i) ?? viewBytes(json, bin, i);
    const pad = (4 - (off % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    off += pad;
    views.push({ ...v, byteOffset: off, byteLength: bytes.length });
    parts.push(Buffer.from(bytes));
    off += bytes.length;
  });
  json.bufferViews = views;
  json.accessors.forEach((a) => a.bufferView !== undefined && (a.bufferView = viewMap[a.bufferView]));
  json.images.forEach((im) => im.bufferView !== undefined && (im.bufferView = viewMap[im.bufferView]));
  for (const m of json.meshes) for (const p of m.primitives) if (p.extensions?.[DRACO_EXT]) p.extensions[DRACO_EXT].bufferView = viewMap[p.extensions[DRACO_EXT].bufferView];
  const newBin = Buffer.concat(parts);
  json.buffers[0].byteLength = newBin.length;
  rep.removedViews = viewDrop.size;
  rep.removedAccessors = accDrop.size;
  return { json, bin: newBin, report: rep };
}
function remap(n, drop) {
  const m = new Int32Array(n).fill(-1);
  let j = 0;
  for (let i = 0; i < n; i++) if (!drop.has(i)) m[i] = j++;
  return m;
}

/** The seam file (art/village/work/waterfall_site_edge.json) from the seam polyline. */
export function edgeJson(sides) {
  const pts = edgePoints().map(([x, z]) => {
    const e = onEdge(x, z);
    return { x: +x.toFixed(6), z: +z.toFixed(6), y: +interp(sides[e[0]], e[1]).toFixed(7) };
  });
  return {
    format: "caysonverse-falls-site-edge",
    version: 2,
    provisional: false,
    note:
      "village ground heights on the waterfall site box, read from the cut village.glb by scripts/patch-village-falls-site.mjs " +
      "(W6): the village's seam is the polyline through these points (it has a vertex at each of the falls ground's boundary " +
      "vertices; the points between lie on it), pocket flatten applied.",
    site: SITE,
    spacing: 1.0,
    order: "CCW from the north-west corner",
    points: pts,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const file = args[0] && !args[0].startsWith("--") ? args[0] : null;
  if (!file) {
    console.error("usage: node scripts/patch-village-falls-site.mjs <village.glb> [--out <glb>] [--edge <json>] [--forest <json>] [--dry]");
    process.exit(2);
  }
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const target = opt("--out") ?? file;
  const forest = opt("--forest") ? JSON.parse(readFileSync(opt("--forest"), "utf8")) : [];
  const input = readFileSync(file);
  try {
    const { out, report, sides, unchanged } = await patchVillageFallsSite(input, { forest });
    console.log(JSON.stringify(report, null, 1));
    console.log(`${file}: ${input.length} B -> ${out.length} B${unchanged ? " (already patched: unchanged)" : ""}`);
    if (opt("--edge") && !unchanged) {
      writeFileSync(opt("--edge"), JSON.stringify(edgeJson(sides), null, 1));
      console.log("wrote", opt("--edge"));
    }
    if (!args.includes("--dry") && !(unchanged && target === file)) writeFileSync(target, out);
  } catch (err) {
    console.error(String(err?.stack ?? err));
    process.exit(1);
  }
}
