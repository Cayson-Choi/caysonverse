import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { decodeDraco, draco, readGlb } from "../../../scripts/patch-village-moon.mjs";

const file = readFileSync(new URL("../../../client/public/models/lake/lake_structures.glb", import.meta.url));
const { json, bin } = readGlb(file);
beforeAll(async () => { await draco(); });

function primitive(node, material) {
  const mesh = json.meshes[json.nodes.find(n => n.name === node).mesh];
  const p = mesh.primitives.find(p => json.materials[p.material]?.name === material);
  return decodeDraco(json, bin, p);
}

it.each(["a", "b"])("closes both gable ends of fishing hut %s up to the soffit", (hut) => {
  const { attrs, faces } = primitive("lake_hut_" + hut, "M_lake_log");
  const pos = attrs.POSITION.values;
  const directions = [];
  for (let f = 0; f < faces.length; f += 3) {
    const ids = Array.from(faces.subarray(f, f + 3));
    const [a, b, c] = ids.map(i => pos.subarray(i * 3, i * 3 + 3));
    const heights = [a[1], b[1], c[1]];
    if (Math.max(...heights) < 3.7) continue;
    const dir = a[0] > 143 ? 1 : -1;
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2]);
    expect(nx * dir).toBeGreaterThan(1);
    expect(attrs.NORMAL.values[3 * ids[0]] * dir).toBeGreaterThan(0.99);
    expect(Math.min(...heights)).toBeCloseTo(3.26, 2);
    expect(Math.max(...heights)).toBeCloseTo(3.766, 2);
    directions.push(dir);
  }
  expect(directions.sort()).toEqual([-1, 1]);
});

it.each(["pier", "pier_t", "walkway_a", "walkway_b", "jwadae_a", "jwadae_b"])("runs oak grain along the individual %s planks at metre scale", (deck) => {
  const { attrs, faces } = primitive("lake_" + deck, "M_lake_deck");
  const pos = attrs.POSITION.values, uv = attrs.TEXCOORD_0.values;
  const along = deck === "pier" ? 2 : 0, across = 2 - along;
  let onBoards = 0;
  for (let f = 0; f < faces.length; f += 3) {
    const ids = Array.from(faces.subarray(f, f + 3));
    if (ids.some(i => Math.abs(pos[3 * i + 1]) > 0.002 || attrs.NORMAL.values[3 * i + 1] < 0.99)) continue;
    const width = ids.map(i => pos[3 * i + across]);
    const span = Math.max(...width) - Math.min(...width);
    if (span < 0.10 || span > 0.17) continue;
    for (let k = 0; k < 3; k++) {
      const i = ids[k], j = ids[(k + 1) % 3];
      if (Math.abs(width[k] - width[(k + 1) % 3]) > 0.001) continue;
      const length = Math.abs(pos[3 * i + along] - pos[3 * j + along]);
      expect(Math.abs(uv[2 * i] - uv[2 * j])).toBeCloseTo(length / 1.4, 2);
      expect(uv[2 * i + 1]).toBeCloseTo(uv[2 * j + 1], 2);
      expect(length).toBeLessThan(3.81);
      onBoards++;
    }
  }
  expect(onBoards).toBeGreaterThan(40);
  expect(attrs.TEXCOORD_1).toBeDefined();
  expect(file.length).toBeLessThan(1.5 * 1024 * 1024);
});
