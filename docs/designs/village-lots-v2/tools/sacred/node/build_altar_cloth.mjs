// A draped linen altar cloth with a gold hem for the chapel's altar (room frame, absolute coordinates; anchor at the room origin).
//   node build_altar_cloth.mjs <out dir>
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });
const [ax0, ax1, az0, az1] = [3.7, 5.7, 11.55, 12.35];
const X0 = ax0 - 0.075, X1 = ax1 + 0.075, Z0 = az0 - 0.075, Z1 = az1 + 0.075, TOP = 1.472;

function grid(fn, nu, nv, o, flip = false) {
  const b = o.pos.length / 3;
  const e = 1e-4;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    const p = fn(u, v), pu = fn(u + e, v), pv = fn(u, v + e);
    const a = pu.map((c, k) => c - p[k]), c2 = pv.map((c, k) => c - p[k]);
    let n = [a[1] * c2[2] - a[2] * c2[1], a[2] * c2[0] - a[0] * c2[2], a[0] * c2[1] - a[1] * c2[0]];
    const l = Math.hypot(...n) || 1; n = n.map((q) => (flip ? -q : q) / l);
    o.pos.push(...p); o.nor.push(...n); o.uv.push(u * 2, v * 2);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = b + j * (nu + 1) + i, c = a + nu + 1;
    o.idx.push(a, a + 1, c, a + 1, c + 1, c);
  }
}
const lin = { pos: [], nor: [], uv: [], idx: [] }, gold = { pos: [], nor: [], uv: [], idx: [] };
const W = X1 - X0, DEP = Z1 - Z0;
const fold = (x, drop) => 0.016 * Math.sin((2 * Math.PI * x) / 0.21 + 0.6) * drop + 0.008 * Math.sin((2 * Math.PI * x) / 0.083) * drop;
// top (very faintly crumpled)
grid((u, v) => [X0 + u * W, TOP + 0.002 * Math.sin(u * 40) * Math.sin(v * 25), Z0 + v * DEP], 40, 12, lin, true);
// front drop (faces -z), 0.62 m down to 0.85, hem band 4 cm
const FD = 0.52;
grid((u, v) => { const x = X0 + u * W, d = v * FD; return [x, TOP - d - 0.004 * v, Z0 - 0.004 - fold(x, Math.min(1, d / 0.1 + 0.1)) - 0.012 * v]; }, 120, 14, lin, false);
// side drops, shorter (0.34)
for (const [x, s] of [[X0, -1], [X1, 1]]) grid((u, v) => { const z = Z0 + u * DEP, d = v * 0.34; return [x + s * (0.004 + 0.012 * v + 0.008 * Math.sin((2 * Math.PI * z) / 0.19) * v), TOP - d, z]; }, 40, 10, lin, s === 1);
// gold hem on the front and sides, and a gold band 6 cm in from the front edge on the top
grid((u, v) => { const x = X0 + u * W, d = FD - 0.045 + v * 0.045; return [x, TOP - d - 0.004, Z0 - 0.006 - fold(x, 1) - 0.012 * (d / FD) - 0.003]; }, 120, 2, gold, false);
for (const [x, s] of [[X0, -1], [X1, 1]]) grid((u, v) => { const z = Z0 + u * DEP, d = 0.295 + v * 0.045; return [x + s * (0.006 + 0.012 * (d / 0.34) + 0.0025), TOP - d, z]; }, 40, 2, gold, s === 1);
grid((u, v) => [X0 + u * W, TOP + 0.0035, Z0 + 0.04 + v * 0.03], 40, 1, gold, true);

const doc = new Document();
const buf = doc.createBuffer();
const scene = doc.createScene();
const mk = (name, geo, mat) => {
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.pos)).setBuffer(buf))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.nor)).setBuffer(buf))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(geo.uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(geo.idx)).setBuffer(buf));
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
};
const root = doc.createNode("lotprop__lot_chapel_nave_altar_cloth");
scene.addChild(root);
root.addChild(mk("cloth_linen", lin, doc.createMaterial("M_altar_linen").setBaseColorFactor([0.96, 0.95, 0.92, 1]).setRoughnessFactor(0.85).setMetallicFactor(0).setDoubleSided(true)));
root.addChild(mk("cloth_gold", gold, doc.createMaterial("M_altar_gold").setBaseColorFactor([0.85, 0.66, 0.28, 1]).setRoughnessFactor(0.4).setMetallicFactor(0.5).setDoubleSided(true)));
await new NodeIO().write(join(outDir, "lotprop__lot_chapel_nave_altar_cloth.glb"), doc);
