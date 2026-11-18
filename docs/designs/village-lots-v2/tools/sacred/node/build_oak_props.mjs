// Carved-oak overlay props for the church (no textures of their own: the material is named M_pbr_wood_oak and LotRoom binds the
// library set; UVs are in metres, grain along the u axis). glTF +Y up, origin bottom centre, front +Z.
//   node build_oak_props.mjs <out dir>
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

/** A prism along +Y of a chamfered rectangle (w x d, chamfer c) from y0 to y1 centred on (cx, cz); grain (u) runs up the length. */
function prism(o, cx, cz, w, d, c, y0, y1, flare = 0) {
  const hw = w / 2, hd = d / 2;
  const P = [[hw - c, hd], [hw, hd - c], [hw, -hd + c], [hw - c, -hd], [-hw + c, -hd], [-hw, -hd + c], [-hw, hd - c], [-hw + c, hd]];
  const n = P.length;
  let per = 0;
  const lens = P.map((p, i) => { const q = P[(i + 1) % n]; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); per += l; return l; });
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n];
    const nx = -(q[1] - p[1]), nz = q[0] - p[0], nl = Math.hypot(nx, nz);
    const b = o.pos.length / 3;
    const v = [[p, y0], [q, y0], [q, y1], [p, y1]];
    const us = [y0, y0, y1, y1], vs = [acc, acc + lens[i], acc + lens[i], acc];
    v.forEach(([pt, y], k) => {
      const f = flare && y === y1 ? 1 + flare : 1;
      o.pos.push(cx + pt[0] * f, y, cz + pt[1] * f); o.nor.push(nx / nl, 0, nz / nl); o.uv.push(us[k], vs[k]);
    });
    o.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    acc += lens[i];
  }
  for (const [y, up] of [[y0, false], [y1, true]]) {
    const b = o.pos.length / 3;
    const f = flare && up ? 1 + flare : 1;
    P.forEach((pt) => { o.pos.push(cx + pt[0] * f, y, cz + pt[1] * f); o.nor.push(0, up ? 1 : -1, 0); o.uv.push(cx + pt[0], cz + pt[1]); });
    for (let i = 1; i < n - 1; i++) o.idx.push(...(up ? [b, b + i + 1, b + i] : [b, b + i, b + i + 1]));
  }
}
/** The same prism laid along X: swap (x,y) of the finished vertices. */
function alongX(build) {
  const t = { pos: [], nor: [], uv: [], idx: [] };
  build(t);
  for (let i = 0; i < t.pos.length; i += 3) { const x = t.pos[i], y = t.pos[i + 1]; t.pos[i] = y; t.pos[i + 1] = x; const nx = t.nor[i], ny = t.nor[i + 1]; t.nor[i] = ny; t.nor[i + 1] = nx; }
  for (let i = 0; i < t.idx.length; i += 3) { const a = t.idx[i + 1]; t.idx[i + 1] = t.idx[i + 2]; t.idx[i + 2] = a; } // mirror: flip winding
  return t;
}
function merge(o, t) { const b = o.pos.length / 3; o.pos.push(...t.pos); o.nor.push(...t.nor); o.uv.push(...t.uv); for (const i of t.idx) o.idx.push(i + b); }
function sphere(o, cx, cy, cz, r, seg = 8) {
  const b = o.pos.length / 3;
  for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg; j++) {
    const th = (Math.PI * i) / seg, ph = (2 * Math.PI * j) / seg;
    const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
    o.pos.push(cx + r * nx, cy + r * ny, cz + r * nz); o.nor.push(nx, ny, nz); o.uv.push(ph * r, th * r);
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) { const a = b + i * (seg + 1) + j, c = a + seg + 1; o.idx.push(a, c, a + 1, a + 1, c, c + 1); }
}

function write(name, geo, tint, set = "wood_oak") {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  const mat = doc.createMaterial("M_pbr_" + set).setBaseColorFactor(tint).setMetallicFactor(0).setRoughnessFactor(0.5);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.pos)).setBuffer(buf))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.nor)).setBuffer(buf))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(geo.uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(geo.idx)).setBuffer(buf));
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  return new NodeIO().write(join(outDir, name + ".glb"), doc);
}

// the cross: 1.0 x 1.8 m, beams 0.16 x 0.09 with a 1.2 cm chamfer, a raised fillet down the middle of each beam, flared ends
{
  const o = { pos: [], nor: [], uv: [], idx: [] };
  const BAR_Y = 1.3, W = 0.16, D = 0.09;
  prism(o, 0, 0, W, D, 0.014, 0, 1.8, 0.0);
  merge(o, alongX((t) => prism(t, BAR_Y, 0, W, D, 0.014, -0.5, 0.5)));
  prism(o, 0, D / 2 + 0.004, 0.035, 0.012, 0.004, 0.05, 1.75);
  merge(o, alongX((t) => prism(t, BAR_Y, D / 2 + 0.004, 0.035, 0.012, 0.004, -0.45, 0.45)));
  // a boss where the beams meet
  sphere(o, 0, BAR_Y, D / 2 + 0.006, 0.05, 10);
  await write("lotprop__lot_church_nave_cross_carved", o, [1, 0.93, 0.82, 1], "wood_pine_natural");
}
// a pew's oak cap: a 2.6 m top rail (7 cm x 12 cm, chamfered) and a post with a ball finial at each end (the pew faces +Z, its back at z = -0.3)
{
  const o = { pos: [], nor: [], uv: [], idx: [] };
  merge(o, alongX((t) => prism(t, 1.0, -0.30, 0.07, 0.12, 0.02, -1.3, 1.3)));
  for (const x of [-1.3, 1.3]) { prism(o, x, -0.2, 0.09, 0.09, 0.012, 0, 1.0); sphere(o, x, 1.06, -0.2, 0.05, 8); prism(o, x, -0.3, 0.09, 0.09, 0.012, 0, 1.0); }
  await write("lotprop__lot_church_nave_pew_cap", o, [0.74, 0.52, 0.32, 1]);
}

// the pulpit's moulded crown and base ring: six chamfered rails round the hexagon (R 0.45, open back toward the stair = edge 4)
{
  const o = { pos: [], nor: [], uv: [], idx: [] };
  const R = 0.45;
  for (const [y, h, d] of [[0.95, 0.08, 0.13], [0.0, 0.07, 0.1]]) {
    for (let k = 0; k < 6; k++) {
      if (k === 4) continue;
      const a0 = (2 * Math.PI * k) / 6 + Math.PI / 6, a1 = (2 * Math.PI * (k + 1)) / 6 + Math.PI / 6;
      const p0 = [R * Math.cos(a0), R * Math.sin(a0)], p1 = [R * Math.cos(a1), R * Math.sin(a1)];
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], mlen = Math.hypot(...mid);
      const out = [mid[0] / mlen, mid[1] / mlen];
      const th = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const t = alongX((g) => prism(g, h / 2, 0, h, d, 0.02, -R / 2 - 0.03, R / 2 + 0.03));
      const c = Math.cos(th), sn = Math.sin(th), off = 0.04 + (d - 0.1) / 2;
      for (let i = 0; i < t.pos.length; i += 3) {
        const lx = t.pos[i], ly = t.pos[i + 1], lz = t.pos[i + 2];
        t.pos[i] = mid[0] + out[0] * off + lx * c - lz * sn * 1; t.pos[i + 2] = mid[1] + out[1] * off + lx * sn + lz * c; t.pos[i + 1] = ly + y;
        const nx = t.nor[i], nz = t.nor[i + 2];
        t.nor[i] = nx * c - nz * sn; t.nor[i + 2] = nx * sn + nz * c;
      }
      merge(o, t);
    }
  }
  await write("lotprop__lot_church_nave_pulpit_crown", o, [0.8, 0.56, 0.34, 1]);
}

// ---- multi-material writer ----
function writeMulti(name, parts) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  const root = doc.createNode(name);
  scene.addChild(root);
  for (const [k, p] of Object.entries(parts)) {
    if (!p.geo.idx.length) continue;
    const mat = doc.createMaterial(p.mat).setBaseColorFactor(p.color).setMetallicFactor(p.metal ?? 0).setRoughnessFactor(p.rough ?? 0.5).setDoubleSided(!!p.double);
    const g = p.geo;
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buf))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.nor)).setBuffer(buf))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(g.uv)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(g.idx)).setBuffer(buf));
    root.addChild(doc.createNode(name + "_" + k).setMesh(doc.createMesh(name + "_" + k).addPrimitive(prim)));
  }
  return new NodeIO().write(join(outDir, name + ".glb"), doc);
}
const G0 = () => ({ pos: [], nor: [], uv: [], idx: [] });
/** Rotate a prism built along +Y so that it runs along +Z (a proper rotation about X by +90 degrees: y -> z, z -> -y), then move it. */
function alongZ(t, dx = 0, dy = 0, dz = 0) {
  for (let i = 0; i < t.pos.length; i += 3) {
    const y = t.pos[i + 1], z = t.pos[i + 2];
    t.pos[i] += dx; t.pos[i + 1] = -z + dy; t.pos[i + 2] = y + dz;
    const ny = t.nor[i + 1], nz = t.nor[i + 2]; t.nor[i + 1] = -nz; t.nor[i + 2] = ny;
  }
  return t;
}
/** Shear z by the pew back's rake (0.12 per metre above the seat) on a finished geometry. */
function rake(t) { for (let i = 0; i < t.pos.length; i += 3) t.pos[i + 2] += -(t.pos[i + 1] - 0.45) * 0.12; return t; }

// the pews' panel mouldings: a raised oak frame in each of three panels along the back, and one on each end's outer face
{
  const back = G0(), ends = G0();
  const rail = 0.04, prou = 0.018;
  for (const cx of [-0.86, 0, 0.86]) {
    const w = 0.78, y0 = 0.52, y1 = 0.89;
    const zb = -0.2 - ((y0 + y1) / 2 - 0.45) * 0.12 + 0.016;
    // stiles (vertical) and rails (horizontal) of the frame, on the back's front face (z a little nearer the nave)
    for (const sx of [-1, 1]) { const t = G0(); prism(t, cx + sx * (w / 2 - rail / 2), zb, rail, prou * 2, 0.007, y0, y1); merge(back, rake(t)); }
    for (const y of [y0 + rail / 2, y1 - rail / 2]) merge(back, rake(alongX((t) => prism(t, y, zb, rail, prou * 2, 0.007, cx - w / 2, cx + w / 2))));
    // a raised field (a flat panel proud 6 mm)
    const f = G0(); prism(f, cx, zb + 0.002, w - 2 * rail - 0.02, 0.014, 0.004, y0 + rail + 0.01, y1 - rail - 0.01); merge(back, rake(f));
  }
  // end faces (x = +-1.30): a frame round the sunk panel
  for (const sx of [-1, 1]) {
    const x = sx * 1.3;
    for (const zc of [-0.26, 0.16]) { const t = G0(); prism(t, x, zc, prou * 2, rail, 0.007, 0.1, 0.66); merge(ends, t); }
    for (const y of [0.1 + rail / 2, 0.66 - rail / 2]) merge(ends, alongZ(G0F((t) => prism(t, 0, 0, prou * 2, rail, 0.007, -0.26, 0.16)), x, y, 0));
  }
  await writeMulti("lotprop__lot_church_nave_pew_panels", {
    back: { geo: back, mat: "M_pbr_wood_oak", color: [0.74, 0.52, 0.32, 1], rough: 0.5 },
    ends: { geo: ends, mat: "M_pbr_wood_oak", color: [0.74, 0.52, 0.32, 1], rough: 0.5 },
  });
}
function G0F(build) { const t = G0(); build(t); return t; }

// the organ: nine tapered metal pipes (varied lengths, mouths, feet), oak case panels and cornice, a real keyboard (organ x 6.6..7.6, z 7.6..8.4)
{
  const pipes = G0(), mouths = G0(), oak = G0(), ivory = G0(), ebony = G0();
  const z0 = 7.6, z1 = 8.4;
  const N = 7;
  for (let k = 0; k < N; k++) {
    const t = (k + 0.5) / N, z = z0 + 0.08 + (z1 - z0 - 0.16) * t;
    const hh = 0.8 + 0.7 * (1 - Math.abs(2 * t - 1)) + 0.03;
    const x = 7.4, y0 = 1.25, r = 0.046 - 0.004 * (1 - hh / 1.55);
    const seg = 18;
    const b = pipes.pos.length / 3;
    const prof = [[0.012, 0], [r * 0.7, 0.09], [r, 0.2], [r, hh - 0.01], [r * 1.03, hh], [r * 0.9, hh - 0.012]];
    for (let i = 0; i < prof.length; i++) for (let j = 0; j <= seg; j++) {
      const th = (2 * Math.PI * j) / seg, [pr, py] = prof[i], [r2, y2] = prof[Math.min(prof.length - 1, i + 1)], [r1, y1] = prof[Math.max(0, i - 1)];
      const nl = Math.hypot(y2 - y1, r2 - r1) || 1;
      pipes.pos.push(x + pr * Math.cos(th), y0 + py, z + pr * Math.sin(th));
      pipes.nor.push(((y2 - y1) / nl) * Math.cos(th), -(r2 - r1) / nl, ((y2 - y1) / nl) * Math.sin(th));
      pipes.uv.push(py, (j / seg) * 2 * Math.PI * pr);
    }
    for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < seg; j++) { const a = b + i * (seg + 1) + j, c = a + seg + 1; pipes.idx.push(a, c, a + 1, a + 1, c, c + 1); }
    // the mouth: a dark cut-up window facing the nave (-x), an arch-lipped rectangle
    const my = y0 + 0.2 + 0.03 * k % 0.06;
    const mw = r * 1.1, mh = r * 0.8;
    const m0 = mouths.pos.length / 3;
    for (const [dz, dy] of [[-mw / 2, 0], [mw / 2, 0], [mw / 2, mh], [-mw / 2, mh]]) { mouths.pos.push(x - r - 0.001, my + dy, z + dz); mouths.nor.push(-1, 0, 0); mouths.uv.push(0, 0); }
    mouths.idx.push(m0, m0 + 2, m0 + 1, m0, m0 + 3, m0 + 2);
  }
  // case: moulded panel frames on its front (x = 6.915), a cornice and base moulding
  for (const zc of [7.82, 8.18]) {
    const w = 0.28, y0 = 0.1, y1 = 0.72, rl = 0.03;
    for (const sz of [-1, 1]) { const t = G0(); prism(t, 6.915, zc + sz * (w / 2 - rl / 2), 0.03, rl, 0.006, y0, y1); merge(oak, t); }
    for (const y of [y0 + rl / 2, y1 - rl / 2]) merge(oak, alongZ(G0F((t) => prism(t, 0, 0, 0.03, rl, 0.006, -w / 2, w / 2)), 6.915, y, zc));
  }
  merge(oak, alongZ(G0F((t) => prism(t, 0, 0, 0.07, 0.05, 0.012, -0.4, 0.4)), 6.94, 1.215, 8.0));   // case cornice
  merge(oak, alongZ(G0F((t) => prism(t, 0, 0, 0.05, 0.03, 0.008, -0.38, 0.38)), 6.93, 0.04, 8.0));   // plinth
  // keyboard: 15 white keys (24 mm), 10 black, a keyslip and a music desk
  const kx0 = 6.72, kx1 = 6.9, ky = 0.88, kz0 = 7.7, nW = 15, kw = 0.6 / nW;
  for (let i = 0; i < nW; i++) { const t = G0(); prism(t, (kx0 + kx1) / 2, kz0 + (i + 0.5) * kw, kx1 - kx0, kw - 0.003, 0.002, ky, ky + 0.018); merge(ivory, t); }
  for (let i = 0; i < nW - 1; i++) { if ([2, 6, 9, 13].includes(i)) continue; const t = G0(); prism(t, kx0 + (kx1 - kx0) * 0.62, kz0 + (i + 1) * kw, (kx1 - kx0) * 0.6, kw * 0.55, 0.002, ky + 0.018, ky + 0.034); merge(ebony, t); }
  merge(oak, alongZ(G0F((t) => prism(t, 0, 0, 0.012, 0.05, 0.003, -0.31, 0.31)), kx0 - 0.012, ky + 0.005, 8.0));  // keyslip
  merge(oak, alongZ(G0F((t) => prism(t, 0, 0, 0.012, 0.18, 0.003, -0.28, 0.28)), 6.98, 1.0, 8.0));                // music desk
  await writeMulti("lotprop__lot_church_nave_organ_front", {
    pipes: { geo: pipes, mat: "M_organ_pipe", color: [0.9, 0.92, 0.96, 1], metal: 0.35, rough: 0.28, double: true },
    mouths: { geo: mouths, mat: "M_organ_mouth", color: [0.05, 0.05, 0.06, 1], rough: 0.8, double: true },
    oak: { geo: oak, mat: "M_pbr_wood_oak", color: [0.74, 0.5, 0.3, 1], rough: 0.5 },
    ivory: { geo: ivory, mat: "M_organ_ivory", color: [0.95, 0.93, 0.86, 1], rough: 0.4 },
    ebony: { geo: ebony, mat: "M_organ_ebony", color: [0.06, 0.05, 0.05, 1], rough: 0.35 },
  });
}
