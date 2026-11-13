/**
 * scripts/village-lm-uvmap.mjs — where each texel of the village's light map (village_lm.webp, 2048^2) lies on the ground
 * (fix/crosswalk-signals review r3). It decodes LM_plaza's primitive (Draco) and rasterises its light-map UVs (TEXCOORD_1)
 * into two float32 2048^2 planes, world x then world z (NaN where no triangle covers the texel), written raw to <out.bin>.
 *
 *   node scripts/village-lm-uvmap.mjs client/public/models/village/village.glb <out.bin>
 *
 * art/village/tools/post_lightmap_busbay.py reads it to lift the old parked bus's baked shadow off the road by the stop
 * (the bus is its own model now and moves; the bake still had its shadow, and a blue tint in it, where it used to stand).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readGlb, draco, decodeDraco } from "./patch-village-moon.mjs";
const { json, bin } = readGlb(readFileSync(process.argv[2]));
await draco();
const mi = json.materials.findIndex((m) => m.name === "LM_plaza");
const N = 2048;
const X = new Float32Array(N * N).fill(NaN), Z = new Float32Array(N * N).fill(NaN);
for (const mesh of json.meshes) for (const p of mesh.primitives) {
  if (p.material !== mi) continue;
  const d = decodeDraco(json, bin, p);
  const P = d.attrs.POSITION.values, U = d.attrs.TEXCOORD_1.values;
  for (let f = 0; f < d.nf; f++) {
    const id = [d.faces[f * 3], d.faces[f * 3 + 1], d.faces[f * 3 + 2]];
    const u = id.map((i) => U[i * 2] * N), v = id.map((i) => U[i * 2 + 1] * N);
    const px = id.map((i) => P[i * 3]), pz = id.map((i) => P[i * 3 + 2]);
    const minx = Math.max(0, Math.floor(Math.min(...u)) - 1), maxx = Math.min(N - 1, Math.ceil(Math.max(...u)) + 1);
    const miny = Math.max(0, Math.floor(Math.min(...v)) - 1), maxy = Math.min(N - 1, Math.ceil(Math.max(...v)) + 1);
    const den = (v[1] - v[2]) * (u[0] - u[2]) + (u[2] - u[1]) * (v[0] - v[2]);
    if (Math.abs(den) < 1e-12) continue;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const a = ((v[1] - v[2]) * (cx - u[2]) + (u[2] - u[1]) * (cy - v[2])) / den;
      const b = ((v[2] - v[0]) * (cx - u[2]) + (u[0] - u[2]) * (cy - v[2])) / den;
      const c = 1 - a - b;
      if (a < -0.02 || b < -0.02 || c < -0.02) continue;
      X[y * N + x] = a * px[0] + b * px[1] + c * px[2];
      Z[y * N + x] = a * pz[0] + b * pz[1] + c * pz[2];
    }
  }
}
writeFileSync(process.argv[3], Buffer.concat([Buffer.from(X.buffer), Buffer.from(Z.buffer)]));
console.log("done");
