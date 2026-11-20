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
  const ends = new Map();
  for (let f = 0; f < faces.length; f += 3) {
    const ids = Array.from(faces.subarray(f, f + 3));
    const [a, b, c] = ids.map(i => pos.subarray(i * 3, i * 3 + 3));
    const heights = [a[1], b[1], c[1]];
    if (Math.min(...heights) < 3.259 || Math.max(...heights) < 3.261) continue;
    const dir = a[0] > 143 ? 1 : -1;
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2]);
    expect(nx * dir).toBeGreaterThan(0);
    expect(attrs.NORMAL.values[3 * ids[0]] * dir).toBeGreaterThan(0.75);
    const extent = ends.get(dir) ?? [Infinity, -Infinity];
    ends.set(dir, [Math.min(extent[0], ...heights), Math.max(extent[1], ...heights)]);
  }
  expect([...ends.keys()].sort()).toEqual([-1, 1]);
  for (const [low, high] of ends.values()) {
    expect(low).toBeCloseTo(3.26, 2);
    expect(high).toBeCloseTo(3.766, 2);
  }
  const soffit = primitive("lake_hut_" + hut, "M_lake_matte");
  let roofFaces = 0;
  for (let f = 0; f < soffit.faces.length; f += 3) {
    const ids = Array.from(soffit.faces.subarray(f, f + 3));
    const pts = ids.map(i => soffit.attrs.POSITION.values.subarray(i * 3, i * 3 + 3));
    if (pts.some(p => p[1] < 2.99) || !pts.some(p => p[1] > 3.65)) continue;
    const [a, b, c] = pts;
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    expect(ny).toBeLessThan(0);
    expect(soffit.attrs.NORMAL.values[3 * ids[0] + 1]).toBeLessThan(-0.9);
    roofFaces++;
  }
  expect(roofFaces).toBe(4);
});

it.each(["a", "b"])("hews the four walls of hut %s around its windows and door", (hut) => {
  const mesh = primitive("lake_hut_" + hut, "M_lake_log");
  const z0 = hut === "a" ? -30.5 : 4.5;
  // Probe a point on the facade against its projected triangles, as viewed from outside.
  function surface(axis, plane, dir, along, y) {
    const { faces, attrs } = mesh, pos = attrs.POSITION.values;
    for (let f = 0; f < faces.length; f += 3) {
      const ids = Array.from(faces.subarray(f, f + 3));
      if (ids.some(i => dir * attrs.NORMAL.values[3 * i + axis] < 0.75 || Math.abs(pos[3 * i + axis] - plane) > 0.040)) continue;
      const [a, b, c] = ids.map(i => pos.subarray(3 * i, 3 * i + 3));
      const u = 2 - axis, du = along - a[u], dy = y - a[1];
      const bx = b[u] - a[u], by = b[1] - a[1], cx = c[u] - a[u], cy = c[1] - a[1];
      const det = bx * cy - by * cx;
      if (Math.abs(det) < 1e-8) continue;
      const s = (du * cy - dy * cx) / det, t = (bx * dy - by * du) / det;
      if (s >= -1e-6 && t >= -1e-6 && s + t <= 1.000001) {
        return dir * (plane - a[axis] - s * (b[axis] - a[axis]) - t * (c[axis] - a[axis]));
      }
    }
    return null;
  }
  const pitch = 3 / 17;
  for (const [axis, wall, direction, along] of [[0, 141.5, -1, z0 + 1.25], [0, 144.5, 1, z0 + 1.25],
    [2, z0, -1, 143], [2, z0 + 2.5, 1, 143]]) {
    expect(surface(axis, wall, direction, along, (4 + 0.02) * pitch)).toBeCloseTo(0.035, 2);
    expect(surface(axis, wall, direction, along, (4 + 0.62) * pitch)).toBeCloseTo(0, 3);
  }
  for (const [x, dir] of [[141.5, -1], [144.5, 1]]) expect(surface(0, x, dir, z0 + 1.25, 1.8)).toBeNull();
  const doorWall = hut === "a" ? z0 : z0 + 2.5, outward = hut === "a" ? -1 : 1;
  expect(surface(2, doorWall, outward, 143.9, 1.0)).toBeNull();
  expect(surface(2, doorWall, outward, 142.2, 1.8)).toBeNull();
  const oak = name => json.materials.find(m => m.name === name).pbrMetallicRoughness.baseColorTexture.index;
  expect(oak("M_lake_log")).toBe(oak("M_lake_deck"));
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
