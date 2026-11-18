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
function sphere(o, cx, cy, cz, r, seg = 12) {
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
  sphere(o, 0, BAR_Y, D / 2 + 0.006, 0.05, 14);
  await write("lotprop__lot_church_nave_cross_carved", o, [1, 0.93, 0.82, 1], "wood_pine_natural");
}
// a pew's oak cap: a 2.6 m top rail (7 cm x 12 cm, chamfered) and a post with a ball finial at each end (the pew faces +Z, its back at z = -0.3)
{
  const o = { pos: [], nor: [], uv: [], idx: [] };
  merge(o, alongX((t) => prism(t, 1.0, -0.30, 0.07, 0.12, 0.02, -1.3, 1.3)));
  for (const x of [-1.3, 1.3]) { prism(o, x, -0.2, 0.09, 0.09, 0.012, 0, 1.0); sphere(o, x, 1.06, -0.2, 0.05, 14); prism(o, x, -0.3, 0.09, 0.09, 0.012, 0, 1.0); }
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
