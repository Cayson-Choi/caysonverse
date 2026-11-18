// Flower arrangements with real petals for the chapel (lilies and roses in a brass vase, and a big urn arrangement): every
// petal is a curved, double-sided strip (a few dozen triangles), stems are 5-sided tubes. glTF +Y up, metres; origin on the
// vase's foot (the urn arrangement: on the urn's lip). Materials: white petal, tinted petal, leaf, brass, stamen.
//   node build_flowers.mjs <out dir>
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mk = () => ({ pos: [], nor: [], uv: [], idx: [] });
// (a zero normal reaches the shader as NaN: it blanked the whole frame through the post pass; never emit one)
const norm = (v) => { const l = Math.hypot(...v); return l < 1e-12 ? [0, 1, 0] : v.map((c) => c / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => a.map((c, i) => c - b[i]);
// yaw about Y after a tilt about X (positive tilt leans +Y toward +Z), then translate
function xf(p, a, t, base) {
  const [x, y, z] = p;
  const y1 = y * Math.cos(t) - z * Math.sin(t), z1 = y * Math.sin(t) + z * Math.cos(t);
  return [base[0] + x * Math.cos(a) + z1 * Math.sin(a), base[1] + y1, base[2] - x * Math.sin(a) + z1 * Math.cos(a)];
}
function surf(o, fn, nu, nv) {
  const b = o.pos.length / 3, e = 1e-3;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const p = fn(u, v);
    const du = u + e <= 1 ? e : -e, dv = v + e <= 1 ? e : -e;
    const a = sub(fn(u + du, v), p).map((c) => c * Math.sign(du)), c2 = sub(fn(u, v + dv), p).map((c) => c * Math.sign(dv));
    const n = cross(a, c2);
    o.pos.push(...p); o.nor.push(...norm(n)); o.uv.push(u, v);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = b + j * (nu + 1) + i, c = a + nu + 1; o.idx.push(a, a + 1, c, a + 1, c + 1, c); }
}
/** A petal: length L, width W, cup c, tip curl k; placed at base with yaw a and tilt t. */
function petal(o, base, a, t, L, W, c, k = 0, shape = 0.8) {
  surf(o, (u, v) => {
    const w = W * Math.pow(Math.sin(Math.PI * Math.pow(u, shape) * 0.97 + 0.03), 0.9) * (0.35 + 0.65 * Math.min(1, u * 2.2));
    const x = (v * 2 - 1) * w;
    return xf([x, L * u, c * (x / Math.max(W, 1e-3)) ** 2 * 0.6 + k * u * u * L], a, t, base);
  }, 4, 3);
}
function tube(o, p0, p1, r0, r1, seg = 5) {
  const d = norm(sub(p1, p0));
  const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const s = norm(cross(d, up)), t = cross(d, s);
  const b = o.pos.length / 3;
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i <= seg; i++) {
    const th = (2 * Math.PI * i) / seg, c = Math.cos(th), sn = Math.sin(th), r = ring ? r1 : r0, p = ring ? p1 : p0;
    const n = [s[0] * c + t[0] * sn, s[1] * c + t[1] * sn, s[2] * c + t[2] * sn];
    o.pos.push(p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r); o.nor.push(...n); o.uv.push(i / seg, ring);
  }
  for (let i = 0; i < seg; i++) { const a = b + i, c = a + seg + 1; o.idx.push(a, a + 1, c, a + 1, c + 1, c); }
}
function lathe(o, prof, seg, cx, cy, cz) {
  const b = o.pos.length / 3;
  for (let i = 0; i < prof.length; i++) for (let j = 0; j <= seg; j++) {
    const th = (2 * Math.PI * j) / seg;
    const [r, y] = prof[i], [r2, y2] = prof[Math.min(prof.length - 1, i + 1)], [r1, y1] = prof[Math.max(0, i - 1)];
    const n = norm([(y2 - y1) * Math.cos(th), -(r2 - r1), (y2 - y1) * Math.sin(th)]);
    o.pos.push(cx + r * Math.cos(th), cy + y, cz + r * Math.sin(th)); o.nor.push(...n); o.uv.push(j / seg, y);
  }
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < seg; j++) { const a = b + i * (seg + 1) + j, c = a + seg + 1; o.idx.push(a, c, a + 1, a + 1, c, c + 1); }
}
function lily(parts, p, a, t, s = 1) {
  for (let k = 0; k < 6; k++) petal(parts.white, p, a + (k * Math.PI) / 3, t + 0.5, 0.11 * s, 0.036 * s, 0.015 * s, 0.05 * s, 0.7);
  for (let k = 0; k < 3; k++) { const q = xf([0, 0.075 * s, 0.01 * s], a + k * 2.09, t + 0.5, p); tube(parts.gold, p, q, 0.0012, 0.0016, 3); }
}
function rose(parts, which, p, a, t, s = 1) {
  const o = parts[which];
  for (let k = 0; k < 4; k++) petal(o, p, a + (k * Math.PI) / 2, t + 0.12, 0.05 * s, 0.026 * s, 0.01 * s, 0.025 * s, 0.9);
  for (let k = 0; k < 5; k++) petal(o, p, a + 0.4 + (k * 2 * Math.PI) / 5, t + 0.35, 0.06 * s, 0.03 * s, 0.012 * s, 0.03 * s, 0.9);
}
function leaf(parts, p, a, t, L) { petal(parts.leaf, p, a, t, L, L * 0.28, L * 0.05, L * 0.25, 0.85); }

async function bouquet(name, { vase, h, nL, nR, rose: roseKind, r0, base }) {
  seed = 11 + name.length * 3;
  const parts = { white: mk(), tint: mk(), leaf: mk(), brass: mk(), gold: mk() };
  const y0 = vase ? 0.22 : 0;
  if (vase) lathe(parts.brass, [[0.05, 0.0], [0.06, 0.02], [0.04, 0.05], [0.035, 0.1], [0.06, 0.18], [0.075, 0.22], [0.062, 0.222], [0.058, 0.2]], 16, 0, 0, 0);
  const total = nL + nR + Math.round(nL * 0.8);
  for (let k = 0; k < total; k++) {
    const a = rnd() * Math.PI * 2, spread = r0 * (0.3 + 0.7 * rnd());
    const top = [Math.cos(a) * spread, y0 + h * (0.55 + 0.45 * (1 - (spread / r0) * 0.6)) * (0.8 + 0.3 * rnd()), Math.sin(a) * spread];
    const bot = [Math.cos(a) * 0.012, y0 - 0.02, Math.sin(a) * 0.012];
    tube(parts.leaf, bot, top, 0.0035, 0.0028);
    const dir = norm(sub(top, bot));
    const tilt = Math.acos(dir[1]), yaw = Math.atan2(dir[0], dir[2]);
    if (k < nL) lily(parts, top, yaw, tilt * 0.9, 1.0);
    else if (k < nL + nR) rose(parts, roseKind, top, yaw, tilt * 0.8, 1.0);
    else leaf(parts, [bot[0] * 0.5 + top[0] * 0.5, bot[1] * 0.4 + top[1] * 0.6, bot[2] * 0.5 + top[2] * 0.5], yaw + rnd() * 6, tilt + 0.9, 0.13 + rnd() * 0.06);
  }
  for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2 + rnd(); leaf(parts, [Math.cos(a) * 0.04, y0 + 0.03, Math.sin(a) * 0.04], a, 1.1 + rnd() * 0.3, 0.12 + rnd() * 0.05); }
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  const root = doc.createNode(name);
  scene.addChild(root);
  const mats = {
    white: doc.createMaterial("M_petal_white").setBaseColorFactor([0.97, 0.96, 0.93, 1]).setRoughnessFactor(0.7).setMetallicFactor(0).setDoubleSided(true),
    tint: doc.createMaterial("M_petal_tint").setBaseColorFactor(base).setRoughnessFactor(0.65).setMetallicFactor(0).setDoubleSided(true),
    leaf: doc.createMaterial("M_leaf").setBaseColorFactor([0.16, 0.36, 0.14, 1]).setRoughnessFactor(0.55).setMetallicFactor(0).setDoubleSided(true),
    brass: doc.createMaterial("M_vase_brass").setBaseColorFactor([0.85, 0.66, 0.3, 1]).setRoughnessFactor(0.35).setMetallicFactor(0.5).setDoubleSided(true),
    gold: doc.createMaterial("M_stamen").setBaseColorFactor([0.9, 0.62, 0.16, 1]).setRoughnessFactor(0.6).setMetallicFactor(0),
  };
  let tris = 0;
  for (const [k, g] of Object.entries(parts)) {
    if (!g.idx.length) continue;
    const prim = doc.createPrimitive().setMaterial(mats[k])
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buf))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.nor)).setBuffer(buf))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(g.uv)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(g.idx)).setBuffer(buf));
    root.addChild(doc.createNode(name + "_" + k).setMesh(doc.createMesh(name + "_" + k).addPrimitive(prim)));
    tris += g.idx.length / 3;
  }
  console.log(name, tris, "tris");
  await new NodeIO().write(join(outDir, name + ".glb"), doc);
}
await bouquet("lotprop__lot_chapel_nave_flowers_white_tall", { vase: true, h: 0.42, nL: 3, nR: 3, rose: "white", r0: 0.1, base: [0.97, 0.96, 0.93, 1] });
await bouquet("lotprop__lot_chapel_nave_flowers_pink_low", { vase: true, h: 0.25, nL: 2, nR: 4, rose: "tint", r0: 0.08, base: [0.86, 0.36, 0.42, 1] });
await bouquet("lotprop__lot_chapel_nave_flowers_white_low", { vase: true, h: 0.25, nL: 3, nR: 3, rose: "white", r0: 0.08, base: [0.97, 0.96, 0.93, 1] });
await bouquet("lotprop__lot_chapel_nave_flowers_urn", { vase: false, h: 0.5, nL: 5, nR: 6, rose: "tint", r0: 0.22, base: [0.98, 0.93, 0.82, 1] });
