/** Pass 21: replace the lower-nose patch while retaining the original boundary.
 * Millimetres about the facial axis. A smooth solid defines tip and alae;
 * a continuous radial depth chart avoids projection folds. Original attribute
 * bytes and atlases stay intact. The new patch has its own gilt/light maps.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NodeBasisEncoder, encodeToKTX2 } from "ktx2-encoder";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { remeshPatch } from "./buddha_patch21.mjs";
import { giltRGBGain } from "./buddha_leaf21.mjs";


const AXIS = -.004, BASE = 1.595;
let fineSupport;
const seedHashes = {
  pc: "cd44cdea52297554aaaa5cbbfc38a7a64ce8353c98f737ed7a122d37655d441b",
  phone: "ab6db73129e2fd5eabff184b9951d2e18e47f19bc6333d6cab5104658e4069f1",
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function ramp(lo, hi, v) {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}
const unit = v => {
  const n = Math.hypot(...v);
  return v.map(c => c / n);
};
// The high, slightly lateral and frontal light of the reference photographs.
const light = unit([.5, .7, .5]);
const shade = {floor: .85, crown: 1.17, turn: [-.22, .92], step: 2.0, hollow: .05};
// The solid of the lower nose (mm; u is the distance from the facial axis).
// hole: |x| and y range recast. The face beneath is the casting softened (mm), with a hollow under each ala.
const nose = {hole: [75, -27, 24], reach: [82, -32, 34], ease: 16, soften: 4.5,
  hollow: {c: [35, 7], r: [23, 23], depth: 6},
  tip: {c: [0, 0, 77.5], r: [17.7, 16.5, 15], k: 8.5},
  ala: {c: [24.3, 7.2, 55.3], r: [14, 18.6, 22.6], k: 10.2, front: 9.2},
  columella: {c: [0, -16, 70], r: [6, 4, 14], k: 4}};
const bakeSize = {pc: [1024, 512], phone: [512, 256]};
function blurred({w, h, value}, sigma) {
  const radius = Math.ceil(3 * sigma), kernel = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-.5 * (k / sigma) ** 2));
  const total = kernel.reduce((a, b) => a + b, 0);
  const pass = (source, dx, dy) => {
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const a = clamp(x + k * dx, 0, w - 1), b = clamp(y + k * dy, 0, h - 1);
        sum += kernel[k + radius] * source[b * w + a];
      }
      out[y * w + x] = sum / total;
    }
    return out;
  };
  const smooth = pass(pass(value, 1, 0), 0, 1);
  // Bilinear, in normalised atlas coordinates.
  return (u, v) => {
    const x = clamp(u * w - .5, 0, w - 1.001), y = clamp(v * h - .5, 0, h - 1.001);
    const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j;
    return (1 - b) * ((1 - a) * smooth[j * w + i] + a * smooth[j * w + i + 1]) +
      b * ((1 - a) * smooth[(j + 1) * w + i] + a * smooth[(j + 1) * w + i + 1]);
  };
}

function packed(parts, view, bytes) {
  const ext = view.extensions.EXT_meshopt_compression;
  const compressed = MeshoptEncoder.encodeGltfBuffer(bytes, ext.count, ext.byteStride, ext.mode, 0);
  parts.set(view, bytes);
  parts.set(ext, Buffer.from(compressed));
}

// Seven of the desktop casting's original triangles cross the highlight where
// the bridge rolls into the tip. Keep their exact positions, normals and
// winding, and continue the tip's finish across the shared edges.
function includeTipCrown(points, indices, cut, sites, fresh, triangles, uvOf) {
  const sourceToLocal = new Map();
  sites.forEach((site, i) => {
    if (site.originalId !== undefined) sourceToLocal.set(site.originalId, i);
  });
  // The bridge and the sides of the nose above the new patch are painted with
  // the new finish too, so the whole nose reads as one leaf (geometry unchanged).
  const eligible = p => p.gilt && p.y >= 6 && p.y <= 100 && p.z > 30 && Math.abs(p.x) < (p.y < 44 ? 36 : 18);
  for (let t = 0; t < indices.length; t += 3) {
    if (cut.has(t)) continue;
    const ids = indices.slice(t, t + 3);
    if (!ids.every(id => eligible(points[id]))) continue;
    const face = ids.map(id => {
      const p = points[id], normal = p.row.slice(3, 6);
      if (!sourceToLocal.has(id)) {
        sourceToLocal.set(id, fresh.length);
        const point = [p.x, p.y, p.z];
        const plain = Object.fromEntries(Object.entries(uvOf).map(([name, read]) => [name, read(id)]));
        fresh.push({point, was: point, old: normal, normal, plain,
          edge: 0, blend: 0, side: p.x < 0 ? -1 : 1});
      }
      const i = sourceToLocal.get(id);
      Object.assign(fresh[i], {normal, preserveSource: true, sourceOriginalId: id});
      return i;
    });
    cut.add(t);
    triangles.push(face);
  }
}

// The sharpened nose reference (registered to the photograph's owner crops)
// sets the relative light of the gilt. The images stay outside the repository;
// NOSE_SHARP_REF names the folder holding redraw-registered-front/side.png.
const CAMERA = {p: 265, ground: 551.5, pitch: .068};
const REGISTRATION = {
  front: {ref: [196.12011419126338, 108.89939538181166], model: [195.82814395942916, 108.65280539188187], scale: .9919544340073664, sheet: 0},
  left: {ref: [569.0622755548725, 108.07777330914251], model: [568.6474687480413, 109.46649657778491], scale: .993294419715006, sheet: 384},
};
const VIEWS = {
  front: {direction: [0, -1, CAMERA.pitch], right: [1, 0, 0], origin: 197, w: 716, h: 420,
    box: [175 + 122.3565 / 18, 97 + 423.8095 / 18, 175 + (122.3565 + 556 * 1.00025) / 18, 97 + (423.8095 + 326 * 1.0015) / 18]},
  head: {direction: [0, -1, CAMERA.pitch], right: [1, 0, 0], origin: 197, w: 1056, h: 1328, box: [130, 14, 262, 180]},
  left: {direction: [1, 0, CAMERA.pitch], right: [0, 1, 0], origin: 192, w: 441, h: 420,
    box: [544 + 72.50175 / 16, 97 + 351.59055 / 16, 544 + (72.50175 + 290 * .99945) / 16, 97 + (351.59055 + 276 * 1.000025) / 16]},
};
function cameraOf(name) {
  const v = VIEWS[name], r = REGISTRATION[name === "head" ? "front" : name];
  const toModel = (x, y) => [(x - r.ref[0]) / r.scale + r.model[0] - r.sheet, (y - r.ref[1]) / r.scale + r.model[1]];
  const [mx0, my0] = toModel(v.box[0], v.box[1]), [mx1, my1] = toModel(v.box[2], v.box[3]);
  const d = unit(v.direction), right = v.right;
  const up = unit([d[1] * right[2] - d[2] * right[1], d[2] * right[0] - d[0] * right[2], d[0] * right[1] - d[1] * right[0]]);
  const cx = (mx0 + mx1) / 2, cy = (my0 + my1) / 2, spanX = (mx1 - mx0) / CAMERA.p, spanY = spanX * v.h / v.w;
  const cr = (cx - v.origin) / CAMERA.p, cu = (CAMERA.ground - cy) / CAMERA.p;
  // Millimetres about the facial axis to the crop's pixels.
  return ([x, y, z]) => {
    const P = [x / 1000 + AXIS, -z / 1000, y / 1000 + BASE];
    const sx = P[0] * right[0] + P[1] * right[1] + P[2] * right[2], sy = P[0] * up[0] + P[1] * up[1] + P[2] * up[2];
    return [((sx - cr) / spanX + .5) * v.w, (.5 - (sy - cu) / spanY) * v.h];
  };
}
// The profile redraw is registered too, but projecting it laid hard nostril
// streaks over the front; the frontal redraw alone sets the light.
const USE_SIDE = false;
async function loadSharpReference() {
  const folder = process.env.NOSE_SHARP_REF;
  assert.ok(folder, "Set NOSE_SHARP_REF to the private folder with redraw-registered-front.png and redraw-registered-side.png");
  const { createRequire } = await import("node:module");
  const sharp = createRequire(import.meta.url)("sharp");
  const sigma = 4.5;
  const views = {};
  for (const name of ["head", "left"]) {
    const file = folder + "/redraw-registered-" + (name === "head" ? "head-front" : "side") + ".png";
    const {data, info} = await sharp(file).removeAlpha().blur(name === "head" ? Math.max(.3, sigma * .35) : sigma).raw().toBuffer({resolveWithObject: true});
    assert.equal(info.width, VIEWS[name].w);
    const at = (x, y) => {
      x = clamp(x - .5, 0, info.width - 1.001); y = clamp(y - .5, 0, info.height - 1.001);
      const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j, out = [0, 0, 0];
      for (const [di, dj, w] of [[0, 0, (1 - a) * (1 - b)], [1, 0, a * (1 - b)], [0, 1, (1 - a) * b], [1, 1, a * b]]) {
        const k = 3 * ((j + dj) * info.width + i + di);
        for (let c = 0; c < 3; c++) out[c] += w * data[k + c];
      }
      return out;
    };
    // Neutral leaf: the flat cheek inside the crop.
    const box = name === "head" ? [[250, 320], [860, 940]] : [[340, 420], [60, 160]];
    const samples = [];
    for (let y = box[1][0]; y < box[1][1]; y += 2) for (let x = box[0][0]; x < box[0][1]; x += 2) samples.push(at(x, y));
    const neutral = [0, 1, 2].map(c => samples.map(s => s[c]).sort((p, q) => p - q)[samples.length >> 1]);
    views[name] = {at, neutral, project: cameraOf(name), w: info.width, h: info.height};
  }
  // Leaf or shadow; not the green moustache, the red lips or the grey backdrop.
  const gold = c => !(c[1] > .95 * c[0] && c[1] > c[2]) && !(c[0] > 120 && c[1] < .5 * c[0])
    && !(c[0] > 110 && c[0] - c[2] < 30);
  const sample = (name, xyz) => {
    const v = views[name], [px, py] = v.project(xyz);
    const margin = Math.min(px, py, v.w - px, v.h - py);
    if (margin <= 0) return null;
    const c = v.at(px, py);
    if (!gold(c)) return null;
    // Only the light is taken from the redraw; the leaf keeps its own colour.
    // Highlights of the redraw are capped so the leaf does not flare.
    const luma = q => .3 * q[0] + .59 * q[1] + .11 * q[2], L = 1 + .8 * (clamp(luma(c) / luma(v.neutral), .12, 1.12) - 1);
    return {ratio: [L ** .7, L ** 1.3, L ** 9], fade: ramp(10, 150, margin * (name === "head" ? .5 : 1))};
  };
  return (xyz, normal) => {
    const nz = Math.max(0, normal[2]), nx = Math.max(0, Math.sign(xyz[0]) * normal[0]);
    const f = sample("head", xyz), s = sample("left", [Math.abs(xyz[0]), xyz[1], xyz[2]]);
    let wf = f ? f.fade * ramp(-.45, .05, normal[2]) : 0, ws = s && USE_SIDE ? s.fade * ramp(.3, .7, nx) * (1 - ramp(.25, .55, -normal[1])) * nx ** 2 : 0;
    const total = wf + ws;
    if (total < 1e-4) return null;
    // The side view lends the ala's crescent, not the deep nostril darks.
    const floor = .55;
    // Beyond the ala the cheek stays plain leaf: no redraw shading there.
    const cheek = ramp(43, 53, Math.abs(xyz[0]));
    const ratio = [0, 1, 2].map(ch => {
      const r = ((f ? f.ratio[ch] * wf : 0) + (s ? Math.max(floor, s.ratio[ch]) * ws : 0)) / total;
      return r + (1 - r) * cheek;
    });
    // Fade where neither camera faces the surface.
    // Above the moustache only: the redraw paints its own, different moustache.
    const weight = clamp(total / .3, 0, 1) * ramp(-27, -17, xyz[1]);
    return {ratio, weight};
  };
}

export async function sculptAlarBalls({doc, binary}, tier, report = null) {
  const primitive = doc.meshes[0].primitives[0], attrs = primitive.attributes;
  const position = doc.accessors[attrs.POSITION], view = doc.bufferViews[position.bufferView];
  const second = doc.bufferViews[doc.accessors[attrs.TEXCOORD_1].bufferView];
  const copy = v => Buffer.from(binary.subarray(v.byteOffset, v.byteOffset + v.byteLength));
  const data = copy(view), fill = copy(second);
  assert.equal(createHash("sha256").update(data).digest("hex"), seedHashes[tier], "Expected the pass-20 casting at 0ef78a87");
  assert.equal(view.byteStride, 32);
  assert.equal(second.byteStride, 4);
  const accessor = doc.accessors[primitive.indices];
  assert.equal(accessor.componentType, 5123);
  const start = doc.bufferViews[accessor.bufferView].byteOffset + (accessor.byteOffset || 0);
  const indices = Array.from({length: accessor.count}, (_, k) => binary.readUInt16LE(start + 2 * k));

  const points = Array.from({length: position.count}, (_, i) => {
    const row = Array.from({length: 8}, (_, k) => data.readFloatLE(32 * i + 4 * k));
    const x = (row[0] - AXIS) * 1000, y = (row[1] - BASE) * 1000, z = row[2] * 1000;
    return {row, x, y, z, gilt: row[6] >= .5};
  });
  // The whole lower nose is cast again from a solid model: the face beneath it,
  // the tip, the two alae and the two nostrils, joined by smooth unions. Its
  // proportions follow the sharpened reference (ChatGPT) laid over the original
  // photographs. The bridge, the cheeks, the lips and everything else keep the
  // casting of pass 20; the new mesh meets it vertex for vertex at its rim.
  const upperAla = x => 8 * ramp(14,25,Math.abs(x)) * (1-ramp(51,70,Math.abs(x)));
  const inside = p => p.gilt && Math.abs(p.x) < nose.hole[0] && p.y > nose.hole[1] && p.y < nose.hole[2] + upperAla(p.x) && p.z > 25;

  // 1. The face beneath the nose: a thin plate over (x, y) through the casting
  //    around the hole, so that bridge, cheeks and lip run on under it smoothly.
  const G = {x0: -90, y0: -40, nx: 181, ny: 101};
  const gcell = (i, j) => j * G.nx + i;
  const top = new Float64Array(G.nx * G.ny).fill(-Infinity);
  for (let t = 0; t < indices.length; t += 3) {
    const P = [indices[t], indices[t + 1], indices[t + 2]].map(i => points[i]);
    if (!P.every(p => p.gilt && p.z > 20)) continue;
    const det = (P[1].x - P[0].x) * (P[2].y - P[0].y) - (P[1].y - P[0].y) * (P[2].x - P[0].x);
    if (Math.abs(det) < 1e-9) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(P[0].x, P[1].x, P[2].x) - G.x0)), i1 = Math.min(G.nx - 1, Math.floor(Math.max(P[0].x, P[1].x, P[2].x) - G.x0));
    const j0 = Math.max(0, Math.ceil(Math.min(P[0].y, P[1].y, P[2].y) - G.y0)), j1 = Math.min(G.ny - 1, Math.floor(Math.max(P[0].y, P[1].y, P[2].y) - G.y0));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const fx = i + G.x0 - P[0].x, fy = j + G.y0 - P[0].y;
      const b = (fx * (P[2].y - P[0].y) - fy * (P[2].x - P[0].x)) / det, c = ((P[1].x - P[0].x) * fy - (P[1].y - P[0].y) * fx) / det, a = 1 - b - c;
      if (a < -1e-9 || b < -1e-9 || c < -1e-9) continue;
      top[gcell(i, j)] = Math.max(top[gcell(i, j)], a * P[0].z + b * P[1].z + c * P[2].z);
    }
  }
  // The casting seen from the front, softened, with a hollow where each new ala
  // will stand so that the ball rises out of it.
  const raw = new Float64Array(top);
  for (let pass = 0; pass < 200; pass++) {
    let open = 0;
    for (let j = 1; j < G.ny - 1; j++) for (let i = 1; i < G.nx - 1; i++) {
      const k = gcell(i, j);
      if (raw[k] > -Infinity) continue;
      const n = [raw[k - 1], raw[k + 1], raw[k - G.nx], raw[k + G.nx]].filter(v => v > -Infinity);
      if (n.length) raw[k] = n.reduce((a, b) => a + b, 0) / n.length; else open++;
    }
    if (!open) break;
  }
  for (let k = 0; k < raw.length; k++) if (raw[k] === -Infinity) raw[k] = 40;
  const sigma = nose.soften, radius = Math.ceil(3 * sigma), kernel = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-.5 * (k / sigma) ** 2));
  const total = kernel.reduce((a, b) => a + b, 0);
  const blur = (src, dx, dy) => {
    const out = new Float64Array(src.length);
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += kernel[k + radius] * src[gcell(clamp(i + k * dx, 0, G.nx - 1), clamp(j + k * dy, 0, G.ny - 1))];
      out[gcell(i, j)] = sum / total;
    }
    return out;
  };
  const plate = blur(blur(raw, 1, 0), 0, 1);
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const u = Math.abs(i + G.x0), y = j + G.y0, h = nose.hollow;
    const upperTurn = 3 * ramp(1, 16, y);
    plate[gcell(i, j)] -= (h.depth + upperTurn) * Math.exp(-(((u - h.c[0]) / h.r[0]) ** 2 + ((y - h.c[1]) / h.r[1]) ** 2));
    plate[gcell(i, j)] -= 7.0 * Math.exp(-(((u - 16) / 15) ** 2 + ((y - 1) / 25) ** 2)) * ramp(0, 7, u);
    // Fill the shallow secondary valley behind the ball. This broad, smooth
    // adjustment prevents a separate cheek silhouette in profile.
    plate[gcell(i, j)] += 0 * Math.exp(-(((u - 40) / 17) ** 2 + ((y + 4) / 27) ** 2));
    plate[gcell(i, j)] -= 0 * Math.exp(-(((u - 59) / 22) ** 2 + ((y - 4) / 25) ** 2));
  }
  // The sculpt is bilateral about the facial axis. The untouched source rim
  // may be slightly asymmetric; its exact positions are retained by the collar.
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < (G.nx - 1) / 2; i++) {
    const a = gcell(i, j), b = gcell(G.nx - 1 - i, j), mean = (plate[a] + plate[b]) / 2;
    plate[a] = plate[b] = mean;
  }
  // Use the high-resolution casting for the shared nose shape. Each tier
  // still meets its own source cheek at its exact, separately sampled rim.
  if (tier === 'pc') fineSupport = plate.slice();
  else if (fineSupport) plate.set(fineSupport);
  const face = (x, y) => {
    const fx = clamp(x - G.x0, 0, G.nx - 1.001), fy = clamp(y - G.y0, 0, G.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    return (1 - b) * ((1 - a) * plate[gcell(i, j)] + a * plate[gcell(i + 1, j)]) + b * ((1 - a) * plate[gcell(i, j + 1)] + a * plate[gcell(i + 1, j + 1)]);
  };

  // 2. The solid. Distances in millimetres, negative inside.
  const ellipsoid = (p, c, r) => {
    const q = [0, 1, 2].map(k => (p[k] - c[k]) / r[k]), k0 = Math.hypot(...q);
    const k1 = Math.hypot(...q.map((v, k) => v / r[k]));
    return k1 ? k0 * (k0 - 1) / k1 : -Math.min(...r);
  };
  const smin = (a, b, k) => { const h = clamp(.5 + .5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };
  const solid = p => {
    const [x, y, z] = p, u = Math.abs(x), m = [u, y, z];
    const h = .5, gx = (face(x + h, y) - face(x - h, y)) / (2 * h), gy = (face(x, y + h) - face(x, y - h)) / (2 * h);
    let d = (z - face(x, y)) / Math.sqrt(1 + gx * gx + gy * gy);
    d = smin(d, ellipsoid(m, nose.tip.c, nose.tip.r), nose.tip.k);
    // Behind and above, the ala meets the face in a soft crescent; in front it swells out of the tip.
    d = smin(d, ellipsoid(m, nose.ala.c, nose.ala.r), nose.ala.k + nose.ala.front * ramp(nose.ala.c[2] + 2, nose.ala.c[2] + 16, z));
    d = smin(d, ellipsoid(m, nose.columella.c, nose.columella.r), nose.columella.k);
    return d;
  };
  const sdf = solid;
  // One oblique oval connects the alar rim and columella. Its long axis
  // projects across the front and along the side. Intersect the radial chart
  // with this plane to build the rim, its shallow bowl and the floor shadow.
  const center = [17.6, -6.2, 61.4], long = [5.8, 1.08, -10.8], short = [-1.5, 3.75, .68];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const axis = [long[1]*short[2]-long[2]*short[1], long[2]*short[0]-long[0]*short[2], long[0]*short[1]-long[1]*short[0]];
  const aa = dot(long,long), ab = dot(long,short), bb = dot(short,short), det = aa*bb-ab*ab;
  const aperture = q => {
    const ray = [Math.abs(q[0])/60, q[1]/60, 1], denom = dot(axis,ray);
    if (denom < .01) return {r:100, d:0};
    const d = dot(axis,center)/denom, offset = ray.map((v,i)=>v*d-center[i]);
    const a=dot(offset,long), b=dot(offset,short);
    const lu=(bb*a-ab*b)/det, lv=(aa*b-ab*a)/det;
    return {r:Math.hypot(lu,lv), lu, lv, d};
  };
  const holeR2 = q => aperture(q).r ** 2;
  const cavityShade = ([x,y,z]) => {
    const hole = aperture([60*x/z,60*y/z]);
    if(hole.r>=1.16) return 0;
    // Light reaches the lower lip of the opening while the upper wall
    // remains shaded. Both cameras see the same oblique, continuous bowl.
    return (1-ramp(.44,1.16,hole.r))*(.93+.07*Math.tanh(1.6*hole.lv-.8*hole.lu));
  };
  // 3. Cut the casting in the hole and divide it.
  const mine = new Set();
  points.forEach((p, i) => { if (inside(p)) mine.add(i); });
  const cut = new Set(), hole = [];
  for (let t = 0; t < indices.length; t += 3) {
    const ids = [indices[t], indices[t + 1], indices[t + 2]];
    // A triangle reaching into the hole is cast again whole, unless it reaches far out.
    const far = i => { const p = points[i]; return !p.gilt || Math.abs(p.x) > nose.reach[0] || p.y < nose.reach[1] || p.y > nose.reach[2] + upperAla(p.x) || p.z < 20; };
    if (ids.some(i => mine.has(i)) && !ids.some(far)) { hole.push(ids); cut.add(t); }
  }
  const radialOrigin = [0, 0, 0];
  const radialPlane = p => [60 * p[0] / (p[2] - radialOrigin[2]), 60 * (p[1] - radialOrigin[1]) / (p[2] - radialOrigin[2])];
  const extraPoints = [];
  // Extra samples along the tip's lower turn keep the side profile round.
  for (const x of [-4, 0, 4]) for (let y = -23; y <= 9; y += 1.25) extraPoints.push([x, y]);
  for (const side of [-1, 1]) for (const r of tier === "pc" ? [.3, .6, .9, 1.2, 1.6] : [.4, .85, 1.3]) {
    const n = tier === "pc" ? 32 : 12;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      const p = center.map((v,k)=>v+r*(long[k]*Math.cos(a)+short[k]*Math.sin(a)));
      extraPoints.push([side*60*p[0]/p[2],60*p[1]/p[2]]);
    }
  }
  // Bake from a dense surface in both tiers. The phone mesh is simplified
  // after baking, so its coarser triangles do not become painted facets.
  const patch = remeshPatch({points, hole, perspective: true, extraPoints,
    gridFilter: q => holeR2(q) > 2.8, spacing: tier === "pc" ? 2.56 : 2.8,
    project: p => radialPlane([p.x, p.y, p.z]), depth: p => p.z});
  const {sites, triangles} = patch;
  console.log(tier, "patch", JSON.stringify(patch.diagnostics));
  const read = (st, fn) => { let sum = null; for (const [i, v] of st.w) { const r = fn(i); sum = sum ? sum.map((c, k) => c + v * r[k]) : r.map(c => v * c); } return sum; };
  const ring = patch.boundary;
  const ringSegments = patch.loops[0].map((k, i, loop) => [sites[k].q, sites[loop[(i + 1) % loop.length]].q]);
  const uvOf = {color: i => [0, 1].map(k => data.readFloatLE(32 * i + 24 + 4 * k)),
    "photographic-fill": i => [0, 1].map(k => fill.readUInt16LE(4 * i + 2 * k) / 65535)};
  const fresh = sites.map((st, k) => {
    const was = read(st, i => [points[i].x, points[i].y, points[i].z]);
    let edge = Infinity;
    for (const [a, b] of ringSegments) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = clamp(((st.q[0] - a[0]) * dx + (st.q[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
      edge = Math.min(edge, Math.hypot(st.q[0] - a[0] - t * dx, st.q[1] - a[1] - t * dy));
    }
    const plain = {};
    for (const name of Object.keys(uvOf)) plain[name] = read(st, uvOf[name]);
    edge = ring.has(k) ? 0 : edge;
    const blend = ramp(0, nose.ease, edge) * (1 - ramp(69, 81, Math.abs(was[0])));
    return {was, edge, blend, plain, old: unit(read(st, i => points[i].row.slice(3, 6))), side: was[0] < 0 ? -1 : 1};
  });
  // All new vertices lie on one radial chart. Taking the first solid
  // crossing along a common ray preserves triangle orientation even at a naris.
  // The previous nearest-old-normal projection could send adjacent samples to
  // opposite sides of a cavity, folding the mesh and streaking its texture.
  const rayPoint = (q, d) => [q[0] * d / 60, radialOrigin[1] + q[1] * d / 60, radialOrigin[2] + d];
  const rayHit = q => {
    let lastD = 145, last = sdf(rayPoint(q, lastD));
    for (let d = 144; d >= 1; d -= 1) {
      const value = sdf(rayPoint(q, d));
      if (last > 0 && value <= 0) {
        let lo = d, hi = lastD;
        for (let pass = 0; pass < 24; pass++) {
          const mid = (lo + hi) / 2;
          if (sdf(rayPoint(q, mid)) > 0) hi = mid; else lo = mid;
        }
        return rayPoint(q, (lo + hi) / 2);
      }
      lastD = d; last = value;
    }
    throw Error("No solid crossing for nose chart " + q);
  };
  const q0 = [0, 1].map(j => Math.floor(Math.min(...sites.map(s => s.q[j]))) - 8);
  const q1 = [0, 1].map(j => Math.ceil(Math.max(...sites.map(s => s.q[j]))) + 8);
  const rw = q1[0] - q0[0] + 1, rh = q1[1] - q0[1] + 1, rd = new Float64Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) rd[y * rw + x] = rayHit([q0[0] + x, q0[1] + y])[2];
  const rayDepth = blurred({w: rw, h: rh, value: rd}, 4.4);
  const baseDepth = q => {
    const raw = rayHit(q)[2], soft = rayDepth((q[0] - q0[0] + .5) / rw, (q[1] - q0[1] + .5) / rh);
    return raw + (soft - raw) * ramp(4, 12, Math.abs(q[0]));
  };
  // Depths along the central meridian at successive 2 mm chart ordinates.
  // The fixed profile camera supplies the silhouette. The narrow central
  // blend carries that curvature into the volume on either side of the tip.
  const meridian = [57.1,58.5,62.0,67.7,73.7,77.5,80.9,83.8,86.7,89.3,91.1,92.3,92.9,
    92.9,92.7,92.1,91.5,90.4,89.2,87.9,86.7,85.6,84.6,83.5];
  const meridianShift = meridian.map((z, i) => z - baseDepth([0,-26+2*i]));
  const ovalCenter = radialPlane(center);
  const depthChange = q => aperture(q).d - baseDepth(q);
  const shift = depthChange(ovalCenter);
  const tilt = [0,1].map(i => {
    const a=[...ovalCenter], b=[...ovalCenter]; a[i]+=.5; b[i]-=.5;
    return clamp(depthChange(a)-depthChange(b), -1.2, 1.2);
  });
  const chartPoint = q => {
    const uv = [Math.abs(q[0])-ovalCenter[0],q[1]-ovalCenter[1]];
    const weight = Math.exp(-.5*((uv[0]/8.5)**2+(uv[1]/5.8)**2));
    const r2 = holeR2(q);
    const t = clamp((q[1] + 26) / 2, 0, meridian.length - 1.001);
    const i = Math.floor(t);
    const central = (meridianShift[i] + (meridianShift[i+1]-meridianShift[i])*(t-i))
      * Math.exp(-.5*(q[0]/7.7)**2) * ramp(-28,-21,q[1]) * (1-ramp(12,20,q[1]));
    const originalDepth = baseDepth(q);
    const base = rayPoint(q, originalDepth), u = Math.abs(base[0]);
    // Sample a broader lower tip on the same radial rays. This rounds the
    // underside without sliding vertices or crossing the naris UV chart.
    const broad = ramp(0, 5, u) * (1 - ramp(13, 20, u)) * (1 - ramp(-9, 2, base[1]))
      * ramp(62, 75, base[2]) * (1 - ramp(88, 94, base[2])) * ramp(1.2, 2.5, aperture(q).r);
    const shoulder = broad > 0 ? clamp(baseDepth([q[0] * .82, q[1]]) - originalDepth, 0, 4.5) * broad : 0;
    const z = originalDepth + central + shoulder + weight*(shift + tilt[0]*uv[0]+tilt[1]*uv[1]) - 1.45*Math.exp(-1.7*r2);
    return rayPoint(q,z);
  };
  fresh.forEach((v, k) => {
    if (!v.edge) { v.point = v.was; return; }
    const target = chartPoint(sites[k].q), e = v.blend;
    v.point = v.was.map((c, j) => c + (target[j] - c) * e);
  });

  // At grazing incidence a valley followed by even a 2 mm rise in the
  // cheek hides a strip of the ala. Read the *joined* chart, including its
  // collar, and bring this valley up to a gently falling cheek tangent.
  const joined = new Float64Array(rw*rh).fill(NaN);
  for (const tri of triangles) {
    const [a,b,c] = tri.map(n => sites[n].q);
    const det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
    if (Math.abs(det)<1e-8) continue;
    for(let j=Math.ceil(Math.min(a[1],b[1],c[1]));j<=Math.max(a[1],b[1],c[1]);j++)
      for(let i=Math.ceil(Math.min(a[0],b[0],c[0]));i<=Math.max(a[0],b[0],c[0]);i++) {
        const wb=((i-a[0])*(c[1]-a[1])-(j-a[1])*(c[0]-a[0]))/det;
        const wc=((b[0]-a[0])*(j-a[1])-(b[1]-a[1])*(i-a[0]))/det, wa=1-wb-wc;
        if(Math.min(wa,wb,wc)>=-1e-5) joined[(j-q0[1])*rw+i-q0[0]]=wa*fresh[tri[0]].point[2]+wb*fresh[tri[1]].point[2]+wc*fresh[tri[2]].point[2];
      }
  }
  const correction = new Float64Array(joined.length);
  for(let j=0;j<rh;j++) for(const side of [-1,1]) {
    let envelope=-Infinity;
    for(let r=135;r>=28;r--) {
      const i=side*r-q0[0];
      if(i<0||i>=rw) continue;
      const k=j*rw+i, z=joined[k];
      if(!Number.isFinite(z)) {envelope=-Infinity;continue;}
      envelope=Math.max(z,envelope+.115);
      correction[k]=Math.min(6.5,envelope-z);
    }
  }
  const lift=blurred({w:rw,h:rh,value:correction},2.5);
  fresh.forEach((v,k)=>{
    if(!v.edge) return;
    const q=sites[k].q, x=Math.abs(v.point[0]);
    const gain=ramp(33,44,x)*(1-ramp(70,80,x))*ramp(0,7,v.edge);
    const dz=lift((q[0]-q0[0]+.5)/rw,(q[1]-q0[1]+.5)/rh)*gain;
    v.point[2]+=dz;
  });

  // Round the exposed side of the ala in the plane of the profile photograph.
  // Its back turns into the cheek while the frontal attachment stays broad.
  for (const v of fresh) {
    const [x, y, z] = v.point;
    const lateral = Math.abs(x);
    const shell = ramp(24, 36, lateral) * (1 - ramp(55, 72, lateral));
    const dome = Math.exp(-.5 * (((z - 52) / 9.8) ** 2 + ((y - 8.5) / 14.2) ** 2));
    v.point[0] += Math.sign(x) * 2.5 * shell * dome * v.blend;
  }

  // 4. Normals from the faces; the old normals at the rim.
  const sums = fresh.map(() => [0, 0, 0]);
  for (const tri of triangles) {
    const P = tri.map(n => fresh[n].point), e1 = P[1].map((c, k) => c - P[0][k]), e2 = P[2].map((c, k) => c - P[0][k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    tri.forEach(n => f.forEach((c, k) => sums[n][k] += c));
  }
  fresh.forEach((v, n) => {
    const now = unit(sums[n]), keep = 1 - v.blend;
    v.normal = unit(now.map((c, k) => c + (v.old[k] - c) * keep));
  });

  includeTipCrown(points, indices, cut, sites, fresh, triangles, uvOf);
  // Painting weight: the new finish fades to the untouched casting at the outer
  // edge of the bridge region, while the geometry keeps its own rim blend.
  const bridgeZone = ([x, y]) => {
    const outer = 34 - 17 * ramp(30, 44, y);
    return (1 - ramp(outer - 9, outer, Math.abs(x))) * ramp(4, 14, y) * (1 - ramp(80, 98, y));
  };
  for (const v of fresh) v.cblend = Math.max(v.preserveSource ? 0 : v.blend, bridgeZone(v.point));
  {
    // Moved casting vertices still shared with untouched triangles keep the old
    // finish exactly; the weight relaxes smoothly inward from them.
    const shared = new Set();
    for (let t = 0; t < indices.length; t += 3) if (!cut.has(t)) for (let k = 0; k < 3; k++) shared.add(indices[t + k]);
    const fixed = fresh.map(v => v.preserveSource && shared.has(v.sourceOriginalId));
    const nbrs = fresh.map(() => new Set());
    for (const [a, b, c] of triangles) { nbrs[a].add(b).add(c); nbrs[b].add(a).add(c); nbrs[c].add(a).add(b); }
    const cap = fresh.map(v => v.cblend);
    fresh.forEach((v, i) => { if (fixed[i]) v.cblend = 0; });
    for (let it = 0; it < 40; it++) {
      const next = fresh.map((v, i) => {
        if (fixed[i] || !nbrs[i].size) return v.cblend;
        let sum = 0; for (const n of nbrs[i]) sum += fresh[n].cblend;
        return Math.min(cap[i], .5 * v.cblend + .5 * sum / nbrs[i].size);
      });
      fresh.forEach((v, i) => { v.cblend = next[i]; });
    }
  }
  // 5. Tone of the leaf: the high light on the form, and the shade of hollows
  //    (the crescent behind each ala, the nostrils) read from the solid itself.
  const toneOf = v => {
    const local = [v.side * v.normal[0], v.normal[1], v.normal[2]];
    const lit = ramp(shade.turn[0], shade.turn[1], local[0] * light[0] + local[1] * light[1] + local[2] * light[2]);
    let ao = 0;
    for (let k = 1; k <= 5; k++) {
      const h = shade.step * k, q = v.point.map((c, n) => c + v.normal[n] * h);
      ao += Math.max(0, (h - sdf(q)) / h) / 2 ** k;
    }
    return (shade.floor + (shade.crown - shade.floor) * lit) * (1 - shade.hollow * ao);
  };

  const atlasRGBA = {};
  for (const atlasName of ["photographic-fill", "color", "orm"]) {
    const image = doc.images.find(im => im.name === tier + "-" + atlasName), v = doc.bufferViews[image.bufferView];
    const basis = await new NodeBasisEncoder().init(), file = new basis.KTX2File(binary.subarray(v.byteOffset, v.byteOffset + v.byteLength));
    assert.ok(file.isValid() && file.startTranscoding());
    const w = file.getWidth(), h = file.getHeight(), out = Buffer.alloc(4 * w * h);
    assert.ok(file.transcodeImage(out, 0, 0, 0, basis.transcoder_texture_format.cTFRGBA32.value, 0, -1, -1));
    file.close(); file.delete();
    atlasRGBA[atlasName] = {w, h, data: out};
  }
  // 6. The new patch has local colour and light maps on its radial chart.
  //    Both approach the sampled original atlases at the fixed rim. The
  //    original atlases remain intact for every untouched part of the statue.
  const sampleAtlas = (rgba, u, v) => {
    const x = clamp(u * rgba.w - .5, 0, rgba.w - 1.001), y = clamp(v * rgba.h - .5, 0, rgba.h - 1.001);
    const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j, out = [0, 0, 0];
    for (const [di, dj, w] of [[0, 0, (1 - a) * (1 - b)], [1, 0, a * (1 - b)], [0, 1, (1 - a) * b], [1, 1, a * b]]) {
      const k = 4 * ((j + dj) * rgba.w + i + di);
      for (let c = 0; c < 3; c++) out[c] += w * rgba.data[k + c];
    }
    return out;
  };
  const fillAt = (u, v) => sampleAtlas(atlasRGBA["photographic-fill"], u, v);
  const baseAt = (u, v) => sampleAtlas(atlasRGBA.color, u, v);
  const flat = fresh.map(v => [...radialPlane(v.point), v.point[2]]);
  const lo = [Math.min(...flat.map(f => f[0])) - 1, Math.min(...flat.map(f => f[1])) - 1];
  const hi = [Math.max(...flat.map(f => f[0])) + 1, Math.max(...flat.map(f => f[1])) + 1];
  const [W, H] = bakeSize[tier];
  const texel = f => [(f[0] - lo[0]) / (hi[0] - lo[0]) * W, (1 - (f[1] - lo[1]) / (hi[1] - lo[1])) * H];
  const neutralFill = fillAt(.684, .492).map((c, k) => (c + fillAt(.816, .492)[k]) / 2);
  const neutralBase = baseAt(.69, .50);
  const chroma = [1.02, .98, .72];
  const tones = fresh.map(toneOf);
  const sharpRef = await loadSharpReference();
  // The cheek just outside the new finish: the leaf the redraw's light is laid on.
  const rimFill = [0, 0, 0], rimBase = [0, 0, 0];
  let rimCount = 0;
  for (const v of fresh) {
    const lateral = Math.abs(v.point[0]);
    if (v.edge > 6 || lateral < 42 || Math.abs(v.point[1]) > 22) continue;
    const f = fillAt(...v.plain["photographic-fill"]), b = baseAt(...v.plain.color);
    for (let ch = 0; ch < 3; ch++) { rimFill[ch] += f[ch]; rimBase[ch] += b[ch]; }
    rimCount++;
  }
  assert.ok(rimCount > 20, "Expected cheek samples beside the nose");
  for (let ch = 0; ch < 3; ch++) { rimFill[ch] /= rimCount; rimBase[ch] /= rimCount; }
  const pixels = new Float64Array(4 * W * H), basePixels = new Float64Array(4 * W * H), ormPixels = new Uint8Array(4 * W * H), depth = new Float64Array(W * H).fill(-Infinity);
  const smoothMask = new Float64Array(W * H);
  const hueMask = new Float64Array(W * H);
  for (const [a, b, c] of triangles) {
    const P = [a, b, c].map(n => texel(flat[n])), Z = [a, b, c].map(n => flat[n][2]);
    const det = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]);
    if (Math.abs(det) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const fx = x + .5 - P[0][0], fy = y + .5 - P[0][1];
      const wb = (fx * (P[2][1] - P[0][1]) - fy * (P[2][0] - P[0][0])) / det, wc = ((P[1][0] - P[0][0]) * fy - (P[1][1] - P[0][1]) * fx) / det, wa = 1 - wb - wc;
      if (wa < -.02 || wb < -.02 || wc < -.02) continue;
      const z = wa * Z[0] + wb * Z[1] + wc * Z[2], k = y * W + x;
      if (z <= depth[k]) continue;
      depth[k] = z;
      const uv = [0, 1].map(ch => wa * fresh[a].plain.color[ch] + wb * fresh[b].plain.color[ch] + wc * fresh[c].plain.color[ch]);
      const xyz = [0, 1, 2].map(ch => wa * fresh[a].point[ch] + wb * fresh[b].point[ch] + wc * fresh[c].point[ch]);
      const dark = cavityShade(xyz), oldBase = baseAt(...uv);
      const nrm = unit([0, 1, 2].map(ch => wa * fresh[a].normal[ch] + wb * fresh[b].normal[ch] + wc * fresh[c].normal[ch]));
      const proj = sharpRef ? sharpRef(xyz, nrm) : null;
      // The bridge zone takes the new finish only where the redraw covers it.
      const eGeom = wa * fresh[a].blend + wb * fresh[b].blend + wc * fresh[c].blend;
      const eZone = wa * fresh[a].cblend + wb * fresh[b].cblend + wc * fresh[c].cblend;
      const e = eGeom + Math.max(0, eZone - eGeom) * (proj ? proj.weight : 0);
      // Cheek beside the ala: smoothed below, away from the fixed rim.
      smoothMask[k] = ramp(29, 37, Math.abs(xyz[0])) * ramp(0, .7, e);
      hueMask[k] = ramp(-20, -14, xyz[1]) * ramp(24, 34, Math.abs(xyz[0])) * ramp(0, .6, e);
      const lightUV = [0, 1].map(ch => wa * fresh[a].plain["photographic-fill"][ch] + wb * fresh[b].plain["photographic-fill"][ch] + wc * fresh[c].plain["photographic-fill"][ch]);
      const oldLight = fillAt(...lightUV);
      const gain = giltRGBGain(xyz,tier);
      const crownHeight = xyz[1] - 16.4;
      const tipCrown = tier === "phone" || sharpRef ? 1 : 1 - .12 * ramp(74, 84, xyz[2])
        * Math.exp(-.5 * ((xyz[0] / 5.35) ** 2 + (crownHeight / (crownHeight > 0 ? 3.45 : 4.65)) ** 2))
        * (1 - ramp(7, 11, Math.abs(xyz[0]))) * (1 - ramp(24, 30, xyz[1]));
      // The new finish fades in over the rounded wing. Beyond it the
      // cheek continues on the original colour and photographic fill.
      const lateral = Math.abs(xyz[0]);
      const rootTaper = 1 - ramp(18, 34, xyz[1]) * ramp(10, 20, lateral);
      const centralRoot = tier === 'pc' ? (1 - ramp(6, 14, lateral)) * ramp(10, 20, xyz[1]) : 0;
      const materialBlend = e + (Math.sin(e * Math.PI / 2) - e) * centralRoot;
      const profileShell = ramp(29, 42, lateral) * (1 - ramp(57, 72, lateral))
        * Math.exp(-.5 * (((xyz[2] - 51) / 11) ** 2 + ((xyz[1] - 8) / 15) ** 2));
      const cheekTaper = ramp(39, 63, lateral);
      const finish = materialBlend * (1 - cheekTaper * (1 - .30 * profileShell))
        * (rootTaper + .31 * profileShell * (1 - rootTaper));
      const base = oldBase.map((v, ch) => v + (neutralBase[ch] * gain[ch] * chroma[ch] - v) * finish);
      // On the underside of a wing the broad photographic bounce remains
      // visible in the temple's lower, directional light. Reduce the local
      // base contribution by the measured amount as the warm fill increases.
      const rim = aperture(radialPlane(xyz)).r;
      const underside = ramp(16, 24, lateral) * (1 - ramp(34, 43, lateral))
        * Math.exp(-.5 * ((xyz[1] - 1) / 7) ** 2) * ramp(46, 59, xyz[2]) * ramp(1.05, 1.8, rim);
      const tone = wa*tones[a]+wb*tones[b]+wc*tones[c];
      const orm = sampleAtlas(atlasRGBA.orm, ...uv);
      const warm = 1 - ramp(-9, 11, xyz[1] - .068*xyz[2]);
      const backGlow = profileShell * Math.exp(-.5 * (((xyz[2] - 50.5) / 7.2) ** 2 + ((xyz[1] - 14) / 6.9) ** 2));
      const returnShadow = profileShell * Math.exp(-.5 * (((xyz[2] - 46.5) / 5.0) ** 2 + ((xyz[1] + 6.5) / 7.5) ** 2));
      const upperCrest = profileShell * Math.exp(-.5 * (((xyz[2] - 53) / 7.7) ** 2 + ((xyz[1] - 22.2) / 3.2) ** 2));
      const dorsal = Math.exp(-.5 * ((xyz[0] / 9.0) ** 2 + ((xyz[1] - 8.5) / 7.8) ** 2)) * ramp(72, 86, xyz[2]);
      // Inside the alae the old casting's light (its wider pass-20 alar
      // shadows) must not show through: the new finish is used in full there.
      const bridgeKeep = 0;
      const fin = proj ? Math.max(finish, proj.weight * (1 - ramp(40, 50, lateral)) * ramp(0, .7, e) * (1 - clamp(bridgeKeep, 0, 1))) : finish;
      for (let ch = 0; ch < 3; ch++) {
        const shape = 1 + [.075, .12, .23][ch] * backGlow - .15 * returnShadow - .08 * upperCrest + .047 * dorsal;
        let lit = neutralFill[ch]*[1.10+.105*warm,.96-.064*warm,.68-.12*warm][ch]*gain[ch]*tone*shape;
        let baseCh = base[ch] * (1 + (shape - 1) * finish) * (1 - .055 * underside * finish);
        if (proj) {
          // The sharpened reference, projected from the registered front and
          // side cameras, sets the relative light of the leaf on the nose.
          // Toward the rim the redraw's light is laid on the cheek's own leaf,
          // so the new finish meets the untouched casting without a seam.
          const ratio = proj.ratio[ch], w = proj.weight * ramp(0, .45, fin);
          const inner = ramp(0, .25, fin);
          const litRef = (oldLight[ch] + (rimFill[ch] - oldLight[ch]) * inner) * ratio;
          const baseRef = (oldBase[ch] + (rimBase[ch] - oldBase[ch]) * inner) * ratio;
          lit = lit + (litRef - lit) * w;
          baseCh = baseCh + (baseRef - baseCh) * w;
        }
        pixels[4 * k + ch] = (oldLight[ch] + (lit - oldLight[ch]) * fin) * (1 - [.72, .9, 1][ch] * dark) * tipCrown;
        // Warm bounce from below reaches the underside of each ala, as in the photograph.
        const bounce = 1 + [.1, .15, .1][ch] * ramp(.05, .6, -nrm[1]) * ramp(16, 24, lateral) * (1 - ramp(36, 42, lateral)) * ramp(-10, -2, xyz[1]) * (1 - dark) * fin;
        basePixels[4 * k + ch] = Math.min(250, baseCh * bounce) * (1 - [.65, .82, 1][ch] * dark) * tipCrown;
        const satin = ch === 0 ? 255 : ch === 1 ? 154 : 198;
        ormPixels[4 * k + ch] = Math.round(orm[ch] + finish * (satin - orm[ch]));
      }
      pixels[4 * k + 3] = 255;
      basePixels[4 * k + 3] = 255;
      ormPixels[4 * k + 3] = 255;
    }
  }
  // Fill every unused texel from its nearest painted neighbour. Even the
  // coarsest mip therefore contains leaf/light colours, never unpainted black.
  for (const atlasPixels of [pixels, basePixels, ormPixels]) {
    const queue = new Int32Array(W * H);
    let end = 0;
    for (let k = 0; k < W * H; k++) if (atlasPixels[4 * k + 3]) queue[end++] = k;
    assert.ok(end, "Empty nose atlas");
    for (let cursor = 0; cursor < end; cursor++) {
      const k = queue[cursor], x = k % W, y = Math.floor(k / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = x + dx, b = y + dy, next = b * W + a;
        if (a < 0 || b < 0 || a >= W || b >= H || atlasPixels[4 * next + 3]) continue;
        for (let ch = 0; ch < 4; ch++) atlasPixels[4 * next + ch] = atlasPixels[4 * k + ch];
        queue[end++] = next;
      }
    }
    assert.equal(end, W * H);
  }
  // Leftover blotches of the old photographic light on the cheek beside each
  // ala are smoothed into one continuous leaf. The rim itself is unchanged.
  {
    const radius = tier === "pc" ? 40 : 24;
    const boxBlur = (src) => {
      let cur = Float64Array.from(src);
      for (let pass = 0; pass < 3; pass++) {
        const tmp = new Float64Array(cur.length), out = new Float64Array(cur.length);
        for (let y = 0; y < H; y++) for (let ch = 0; ch < 3; ch++) {
          let sum = 0, n = 0;
          for (let x = -radius; x <= radius; x++) { const xx = clamp(x, 0, W - 1); sum += cur[4 * (y * W + xx) + ch]; n++; }
          for (let x = 0; x < W; x++) {
            tmp[4 * (y * W + x) + ch] = sum / n;
            const add = clamp(x + radius + 1, 0, W - 1), drop = clamp(x - radius, 0, W - 1);
            sum += cur[4 * (y * W + add) + ch] - cur[4 * (y * W + drop) + ch];
          }
        }
        for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) {
          let sum = 0, n = 0;
          for (let y = -radius; y <= radius; y++) { const yy = clamp(y, 0, H - 1); sum += tmp[4 * (yy * W + x) + ch]; n++; }
          for (let y = 0; y < H; y++) {
            out[4 * (y * W + x) + ch] = sum / n;
            const add = clamp(y + radius + 1, 0, H - 1), drop = clamp(y - radius, 0, H - 1);
            sum += tmp[4 * (add * W + x) + ch] - tmp[4 * (drop * W + x) + ch];
          }
        }
        cur = out;
      }
      return cur;
    };
    // The same cheek keeps the hue of the plain leaf: an olive cast read from
    // the coarse phone casting's atlas becomes gold of equal brightness.
    const luma = (q, k) => .3 * q[4 * k] + .59 * q[4 * k + 1] + .11 * q[4 * k + 2];
    for (const [atlas, rim] of [[pixels, rimFill], [basePixels, rimBase]]) {
      const rimL = .3 * rim[0] + .59 * rim[1] + .11 * rim[2];
      for (let k = 0; k < W * H; k++) {
        const m = hueMask[k];
        if (m <= 0) continue;
        const f = luma(atlas, k) / rimL;
        for (let ch = 0; ch < 3; ch++) atlas[4 * k + ch] += (rim[ch] * f - atlas[4 * k + ch]) * m;
      }
    }
    for (const [atlas, rim] of [[pixels, rimFill], [basePixels, rimBase]]) {
      const soft = boxBlur(atlas);
      const rimL = .3 * rim[0] + .59 * rim[1] + .11 * rim[2];
      for (let k = 0; k < W * H; k++) {
        const m = smoothMask[k];
        if (m <= 0) continue;
        for (let ch = 0; ch < 3; ch++) atlas[4 * k + ch] += (soft[4 * k + ch] - atlas[4 * k + ch]) * m;
        // Never darker than the open cheek beyond it.
        const lift = Math.max(1, .97 * rimL / Math.max(1, luma(atlas, k)));
        for (let ch = 0; ch < 3; ch++) atlas[4 * k + ch] *= 1 + (lift - 1) * m * m;
      }
    }
  }
  const image8 = new Uint8Array(4 * W * H);
  for (let k = 0; k < W * H; k++) {
    for (let ch = 0; ch < 3; ch++) image8[4 * k + ch] = clamp(Math.round(pixels[4 * k + ch]), 0, 255);
    image8[4 * k + 3] = 255;
  }
  if (report) (report[tier] ??= {}).lightMap = {W, H, image8};
  const ktx = Buffer.from(await encodeToKTX2(new Uint8Array(1), {isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true, isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true, generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({width: W, height: H, data: image8})}));
  const base8 = Uint8Array.from(basePixels, v => clamp(Math.round(v), 0, 255));
  const baseKtx = Buffer.from(await encodeToKTX2(new Uint8Array(1), {isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true, isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true, generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({width: W, height: H, data: base8})}));

  const ormKtx = Buffer.from(await encodeToKTX2(new Uint8Array(1), {isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true, isPerceptual: false,
    isSetKTX2SRGBTransferFunc: false, generateMipmap: true, isKTX2File: true, isYFlip: false,
    imageDecoder: async () => ({width: W, height: H, data: ormPixels})}));

  // 7. Append the new nose attributes and local maps; retain all original bytes.
  let targetFaces = triangles;
  if (tier === "phone") {
    await MeshoptSimplifier.ready;
    // The low tier otherwise pulls the wings inward at their broadest turn.
    // Carry the finished UVs with a smooth displacement, before decimation.
    fresh.forEach((v, i) => {
      if (v.preserveSource) return;
      const [x, y, z] = v.point, u = Math.abs(x), h = y - .068 * z;
      const wing = ramp(16, 28, u) * (1 - ramp(38, 62, u));
      const band = ramp(-8.5, -1, h) * (1 - ramp(0, 13, h));
      v.point[0] += Math.sign(x) * 1.2 * wing * band * v.blend * ramp(1.3, 2, aperture(sites[i].q).r);
    });
    const positions = Float32Array.from(fresh.flatMap(v => v.point));
    const normals = Float32Array.from(fresh.flatMap(v => v.normal));
    const limit = 10499 - (indices.length / 3 - cut.size);
    // Keep samples on the upper wing under the moving grazing highlight.
    // This avoids a large, flat triangle across the mobile profile.
    const locked = Uint8Array.from(fresh,v=>v.edge===0||v.preserveSource?1:0);
    for(const side of [-1,1]) for(const u of [27,34,40,45]) for(const y of [15,21,27]) {
      let nearest=-1, distance=Infinity;
      fresh.forEach((v,i)=>{
        const d=(v.point[0]-side*u)**2+(v.point[1]-y)**2;
        if(v.edge>3 && d<distance){nearest=i;distance=d;}
      });
      if(nearest>=0)locked[nearest]=1;
    }
    // Keep a smooth mobile turning edge down to the bottom of the ala.
    for (const side of [-1, 1]) for (const u of [32, 39, 47]) for (const h of [-8.5, -4, .5, 6]) {
      let nearest = -1, distance = Infinity;
      fresh.forEach((v, i) => {
        const [x, y, z] = v.point, d = (x - side * u) ** 2 + (y - .068 * z - h) ** 2;
        if (v.edge > 3 && d < distance) {nearest = i; distance = d;}
      });
      if (nearest >= 0) locked[nearest] = 1;
    }
    const [selected] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(triangles.flat()), positions, 3,
      normals, 3, [.5, .5, .5], locked, limit * 3, 1, ['LockBorder']);
    assert.ok(selected.length <= 3 * limit, 'Phone patch exceeds its triangle budget');
    targetFaces = Array.from({length: selected.length / 3}, (_, i) => Array.from(selected.subarray(i * 3, i * 3 + 3)));
  }
  const used = new Set(targetFaces.flat());
  const rows = [], lights = [];
  let count = position.count;
  const freshId = fresh.map((v, n) => {
    if (!used.has(n)) return -1;
    const row = Buffer.alloc(32);
    [AXIS + v.point[0] / 1000, BASE + v.point[1] / 1000, v.point[2] / 1000, ...v.normal, ...v.plain.color].forEach((c, k) => row.writeFloatLE(c, 4 * k));
    if(v.preserveSource) data.copy(row,0,32*v.sourceOriginalId,32*v.sourceOriginalId+24);
    rows.push(row);
    const [tx, ty] = texel(flat[n]), bytes = Buffer.alloc(4);
    [tx / W, ty / H].forEach((c, k) => bytes.writeUInt16LE(clamp(Math.round(65535 * c), 0, 65535), 2 * k));
    lights.push(bytes);
    return count++;
  });
  assert.ok(count < 65536);
  const kept = [];
  for (let t = 0; t < indices.length; t += 3) if (!cut.has(t)) kept.push(indices[t], indices[t + 1], indices[t + 2]);
  const added = [];
  for (const tri of targetFaces) for (const n of tri) added.push(freshId[n]);
  const u16 = list => { const b = Buffer.alloc(2 * list.length); list.forEach((v, k) => b.writeUInt16LE(v, 2 * k)); return b; };
  const indexView = doc.bufferViews[accessor.bufferView];
  assert.equal(indexView.byteLength, 2 * indices.length);
  const before = position.count;
  for (const name of ["POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1"]) {
    assert.equal(doc.accessors[attrs[name]].count, before);
    doc.accessors[attrs[name]].count = count;
  }
  for (const v of [view, second]) v.extensions.EXT_meshopt_compression.count = count;
  accessor.count = kept.length;
  indexView.extensions.EXT_meshopt_compression.count = kept.length;
  const parts = new Map();
  packed(parts, view, Buffer.concat([data, ...rows]));
  packed(parts, second, Buffer.concat([fill, ...lights]));
  packed(parts, indexView, u16(kept));
  // The second primitive, its index view, its light map and its material.
  const addedView = {buffer: 0, byteOffset: 0, byteLength: 2 * added.length, target: 34963};
  doc.bufferViews.push(addedView);
  parts.set(addedView, u16(added));
  const addedAccessor = doc.accessors.push({bufferView: doc.bufferViews.length - 1, componentType: 5123, count: added.length, type: "SCALAR"}) - 1;
  const imageView = {buffer: 0, byteOffset: 0, byteLength: ktx.length};
  doc.bufferViews.push(imageView);
  parts.set(imageView, ktx);
  const image = doc.images.push({name: tier + "-nose-light", mimeType: "image/ktx2", bufferView: doc.bufferViews.length - 1}) - 1;
  const leaf = doc.materials[primitive.material];
  const fillTexture = doc.textures[leaf.emissiveTexture.index];
  const texture = doc.textures.push({sampler: fillTexture.sampler, extensions: {KHR_texture_basisu: {source: image}}}) - 1;
  const material = doc.materials.push({...structuredClone(leaf), name: leaf.name + " (nose)", emissiveTexture: {index: texture, texCoord: 1}}) - 1;
  const baseView = {buffer: 0, byteOffset: 0, byteLength: baseKtx.length};
  doc.bufferViews.push(baseView); parts.set(baseView, baseKtx);
  const baseImage = doc.images.push({name: tier + "-nose-color", mimeType: "image/ktx2", bufferView: doc.bufferViews.length - 1}) - 1;
  const baseTexture = doc.textures.push({sampler: fillTexture.sampler, extensions: {KHR_texture_basisu: {source: baseImage}}}) - 1;
  doc.materials[material].pbrMetallicRoughness.baseColorTexture = {index: baseTexture, texCoord: 1};
  const ormView = {buffer: 0, byteOffset: 0, byteLength: ormKtx.length};
  doc.bufferViews.push(ormView); parts.set(ormView, ormKtx);
  const ormImage = doc.images.push({name: tier + '-nose-orm', mimeType: 'image/ktx2', bufferView: doc.bufferViews.length - 1}) - 1;
  const ormTexture = doc.textures.push({sampler: fillTexture.sampler, extensions: {KHR_texture_basisu: {source: ormImage}}}) - 1;
  doc.materials[material].pbrMetallicRoughness.metallicRoughnessTexture = {index: ormTexture, texCoord: 1};
  // Retain the shared leaf normal map on its original UV set through the rim.
  doc.meshes[0].primitives.push({attributes: {...attrs}, indices: addedAccessor, material, mode: 4});
  if (report) Object.assign(report[tier], {sdf, face, fresh, triangles});
  console.log(tier, cut.size, "triangles of the lower nose recast as", targetFaces.length, "with", used.size, "vertices; light map", W + "x" + H, ktx.length, "bytes");
  return parts;
}
