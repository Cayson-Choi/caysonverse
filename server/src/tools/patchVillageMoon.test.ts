/**
 * Tests for scripts/patch-village-moon.mjs (fix/fix-moon-smooth: the fountain's crescent put into village.glb as its own
 * unlit node). The crescent's mesh (closed, outward, the old size and place, its UVs inside the atlas's moon region and
 * even across the band), and the patch on a small synthetic village.glb built with Draco here: only the crescent's
 * triangles leave their primitive, everything else keeps its bytes, the new node and material are what the game expects,
 * a second run changes nothing, and the CLI does the same. The script is loaded with a dynamic import (plain node ESM).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "patch-village-moon.mjs");

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- glTF JSON, read loosely
interface Quant {
  bits: number;
  origin?: number[];
  range?: number;
}
interface Attr {
  values: Float32Array;
  size: number;
  quant: Quant | null;
}
interface Geometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}
interface MoonModule {
  MOON: { centre: [number, number]; baseY: number; height: number; yawDeg: number; nArc: number; nRing: number; arcBunch: number };
  MOON_ATLAS: { x: number; y: number; w: number; h: number; size: number; inset: number };
  MOON_MATERIAL: { name: string; color: number[] };
  MOON_NODE: string;
  moonGeometry(): Geometry;
  readGlb(buf: Buffer): { json: Json; bin: Buffer };
  writeGlb(json: Json, bin: Buffer): Buffer;
  draco(): Promise<unknown>;
  decodeDraco(json: Json, bin: Buffer, prim: Json): { attrs: Record<string, Attr>; faces: Uint32Array; np: number; nf: number };
  encodeDraco(attrs: Record<string, Attr>, faces: Uint32Array, np: number): { bytes: Buffer; ids: Record<string, number>; nPoints: number; nFaces: number };
  patchVillageMoon(input: Buffer): Promise<{
    out: Buffer;
    report: { removed: Array<{ mesh: string; primitive: number; material: string; triangles: number; left: number }>; moon: { triangles: number } };
  }>;
}

let M: MoonModule;
let tmp = "";

beforeAll(async () => {
  M = (await import(pathToFileURL(SCRIPT).href)) as MoonModule;
  await M.draco();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-moon-"));
});
afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const at = (arr: ArrayLike<number>, i: number, n = 3) => Array.from({ length: n }, (_, k) => arr[i * n + k]!);

describe("moonGeometry: the crescent's mesh", () => {
  it("is closed and faces outward, with unit normals that agree with every triangle's winding", () => {
    const g = M.moonGeometry();
    const { nArc, nRing } = M.MOON;
    expect(g.indices.length / 3).toBe(2 * nRing * (nArc - 2) + 2 * nRing); // the rings' quads and the two tip fans
    const edges = new Map<string, number>();
    let inward = 0;
    for (let f = 0; f < g.indices.length / 3; f++) {
      const v = [0, 1, 2].map((k) => g.indices[f * 3 + k]!);
      const p = v.map((i) => at(g.positions, i));
      const n = v.map((i) => at(g.normals, i)).reduce((s, x) => [s[0]! + x[0]!, s[1]! + x[1]!, s[2]! + x[2]!]);
      if (dot(cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!)), n) <= 0) inward++;
      for (let k = 0; k < 3; k++) {
        const a = Math.min(v[k]!, v[(k + 1) % 3]!);
        const b = Math.max(v[k]!, v[(k + 1) % 3]!);
        edges.set(`${a}/${b}`, (edges.get(`${a}/${b}`) ?? 0) + 1);
      }
    }
    expect(inward).toBe(0);
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    for (let i = 0; i < g.normals.length / 3; i++) expect(Math.hypot(...at(g.normals, i))).toBeCloseTo(1, 6);
  });

  it("keeps the old crescent's size and place: 7.4 m tall on the plinth at 1.98 m, over the fountain, thin through", () => {
    const g = M.moonGeometry();
    const ys = g.positions.filter((_, k) => k % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(M.MOON.baseY - 0.01);
    expect(Math.max(...ys)).toBeLessThan(M.MOON.baseY + M.MOON.height + 0.01);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(M.MOON.height * 0.97);
    // through the crescent's face (local z, turned by the yaw): at most 0.3 R1 thick
    const yaw = (M.MOON.yawDeg * Math.PI) / 180;
    const face = [Math.sin(yaw), 0, Math.cos(yaw)];
    let depth = 0;
    for (let i = 0; i < g.positions.length / 3; i++) {
      const p = at(g.positions, i);
      depth = Math.max(depth, Math.abs(dot(sub(p, [M.MOON.centre[0], 0, M.MOON.centre[1]]), face)));
      expect(Math.hypot(p[0]! - M.MOON.centre[0], p[2]! - M.MOON.centre[1])).toBeLessThan(M.MOON.height * 0.58); // where the patch looks
    }
    expect(depth).toBeLessThanOrEqual((0.3 * M.MOON.height) / 2 / 2 + 1e-6);
  });

  it("maps into the atlas's moon region with its inset, across the band by the distance across it (no squeezed tips)", () => {
    const g = M.moonGeometry();
    const a = M.MOON_ATLAS;
    const u0 = (a.x + a.inset * a.w) / a.size;
    const u1 = (a.x + (1 - a.inset) * a.w) / a.size;
    const v0 = (a.y + a.inset * a.h) / a.size;
    const v1 = (a.y + (1 - a.inset) * a.h) / a.size;
    for (let i = 0; i < g.uvs.length / 2; i++) {
      const [u, v] = at(g.uvs, i, 2);
      expect(u!).toBeGreaterThanOrEqual(u0 - 1e-9);
      expect(u!).toBeLessThanOrEqual(u1 + 1e-9);
      expect(v!).toBeGreaterThanOrEqual(v0 - 1e-9);
      expect(v!).toBeLessThanOrEqual(v1 + 1e-9);
    }
    // ring by ring (nRing points each): the UV span across the band over its width in metres is the same everywhere,
    // so no ring packs the region's height into a few centimetres (a deep mip level there reads the cells around it)
    const { nArc, nRing } = M.MOON;
    const ratios: number[] = [];
    for (let r = 0; r < nArc - 1; r++) {
      const inner = r * nRing; // phi = 0: the inner edge
      const outer = r * nRing + nRing / 2; // phi = pi: the outer edge
      const width = Math.hypot(...sub(at(g.positions, outer), at(g.positions, inner)));
      const span = Math.abs(g.uvs[outer * 2 + 1]! - g.uvs[inner * 2 + 1]!);
      if (width > 0.05) ratios.push(span / width);
    }
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThan(1.02);
  });
});

// ---------------------------------------------------------------------------------------------------------
// A small village.glb: LM_atlas holds the old crescent's triangles and others, LM_stone and a second LM_atlas don't.

const UNLIT = "KHR_materials_unlit";
const DRACO = "KHR_draco_mesh_compression";

function quad(p: number[][], uv0: number[][], uv1: number[][]) {
  return { p: [p[0], p[1], p[2], p[0], p[2], p[3]] as number[][], t0: [uv0[0], uv0[1], uv0[2], uv0[0], uv0[2], uv0[3]] as number[][], t1: [uv1[0], uv1[1], uv1[2], uv1[0], uv1[2], uv1[3]] as number[][] };
}

/** Some quads as one Draco primitive (POSITION 14 bits, UVs 12, like the exporter's grid). */
function dracoPrim(quads: ReturnType<typeof quad>[]) {
  const P: number[] = [];
  const T0: number[] = [];
  const T1: number[] = [];
  for (const q of quads) {
    for (let k = 0; k < 6; k++) {
      P.push(...q.p[k]!);
      T0.push(...q.t0[k]!);
      T1.push(...q.t1[k]!);
    }
  }
  const np = P.length / 3;
  const faces = new Uint32Array(Array.from({ length: np }, (_, i) => i));
  return M.encodeDraco(
    {
      POSITION: { values: new Float32Array(P), size: 3, quant: { bits: 14 } },
      TEXCOORD_0: { values: new Float32Array(T0), size: 2, quant: { bits: 12 } },
      TEXCOORD_1: { values: new Float32Array(T1), size: 2, quant: { bits: 12 } },
    },
    faces,
    np,
  );
}

function syntheticVillage(): { glb: Buffer; moonTriangles: number; keptTriangles: number } {
  const a = M.MOON_ATLAS;
  const inMoon = (u: number, v: number) => [(a.x + u * a.w) / a.size, (a.y + v * a.h) / a.size];
  const lm = (u: number, v: number) => [u, v];
  // the old crescent: upright quads above the plinth near the fountain's axis, UV0 in the moon region
  const moon = [0, 1, 2].map((k) =>
    quad(
      [[-1 + k, 3, 0], [0 + k, 3, 0], [0 + k, 5, 0.2], [-1 + k, 5, 0.2]],
      [inMoon(0.1 + 0.2 * k, 0.2), inMoon(0.3 + 0.2 * k, 0.2), inMoon(0.3 + 0.2 * k, 0.8), inMoon(0.1 + 0.2 * k, 0.8)],
      [lm(0.5, 0.5), lm(0.52, 0.5), lm(0.52, 0.52), lm(0.5, 0.52)],
    ),
  );
  // the rest of LM_atlas: on the ground (and one in the moon's UV region but far away: a reused atlas cell)
  const rest = [
    quad([[10, 0, 10], [12, 0, 10], [12, 0, 12], [10, 0, 12]], [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2]], [lm(0.1, 0.1), lm(0.2, 0.1), lm(0.2, 0.2), lm(0.1, 0.2)]),
    quad([[30, 0, 0], [31, 0, 0], [31, 4, 0], [30, 4, 0]], [inMoon(0.5, 0.5), inMoon(0.6, 0.5), inMoon(0.6, 0.6), inMoon(0.5, 0.6)], [lm(0.3, 0.3), lm(0.4, 0.3), lm(0.4, 0.4), lm(0.3, 0.4)]),
    quad([[-0.6, 1.55, 0], [0.6, 1.55, 0], [0.6, 1.95, 0], [-0.6, 1.95, 0]], [[0.4, 0.4], [0.45, 0.4], [0.45, 0.45], [0.4, 0.45]], [lm(0.6, 0.6), lm(0.7, 0.6), lm(0.7, 0.7), lm(0.6, 0.7)]), // the plinth
  ];
  const stone = [quad([[0, 0, 0], [5, 0, 0], [5, 0, 5], [0, 0, 5]], [[0.7, 0.7], [0.8, 0.7], [0.8, 0.8], [0.7, 0.8]], [lm(0.8, 0.8), lm(0.9, 0.8), lm(0.9, 0.9), lm(0.8, 0.9)])];
  const other = [quad([[40, 0, 0], [41, 0, 0], [41, 0, 1], [40, 0, 1]], [inMoon(0.2, 0.2), inMoon(0.3, 0.2), inMoon(0.3, 0.3), inMoon(0.2, 0.3)], [lm(0.05, 0.9), lm(0.1, 0.9), lm(0.1, 0.95), lm(0.05, 0.95)])];
  const prims = [dracoPrim([...moon, ...rest]), dracoPrim(stone), dracoPrim(other)];
  const image = Buffer.from("\x89PNG fake atlas bytes, compared byte for byte", "binary");
  const json: Json = {
    asset: { version: "2.0" },
    extensionsUsed: [DRACO, UNLIT],
    extensionsRequired: [DRACO],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "village_lm_11", mesh: 0 },
      { name: "village_lm_12", mesh: 1 },
    ],
    materials: [
      { name: "LM_atlas", pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, extensions: { [UNLIT]: {} } },
      { name: "LM_stone", pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.6, 1] }, extensions: { [UNLIT]: {} } },
    ],
    textures: [{ source: 0 }],
    images: [{ bufferView: 0, mimeType: "image/png", name: "T_atlas" }],
    accessors: [] as Json[],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: image.length }] as Json[],
    buffers: [{ byteLength: 0 }],
    meshes: [] as Json[],
  };
  const parts: Buffer[] = [image];
  let off = image.length;
  const view = (bytes: Buffer) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    off += pad;
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length });
    parts.push(bytes);
    off += bytes.length;
    return json.bufferViews.length - 1;
  };
  const primitive = (enc: ReturnType<MoonModule["encodeDraco"]>, material: number) => {
    const acc = (type: string) => {
      json.accessors.push({ componentType: 5126, count: enc.nPoints, type });
      return json.accessors.length - 1;
    };
    const attributes = { POSITION: acc("VEC3"), TEXCOORD_0: acc("VEC2"), TEXCOORD_1: acc("VEC2") };
    json.accessors.push({ componentType: 5123, count: enc.nFaces * 3, type: "SCALAR" });
    return { attributes, indices: json.accessors.length - 1, material, mode: 4, extensions: { [DRACO]: { bufferView: view(enc.bytes), attributes: enc.ids } } };
  };
  json.meshes.push({ name: "village_lm_11", primitives: [primitive(prims[0]!, 0), primitive(prims[1]!, 1)] });
  json.meshes.push({ name: "village_lm_12", primitives: [primitive(prims[2]!, 0)] });
  const bin = Buffer.concat(parts);
  json.buffers[0].byteLength = bin.length;
  return { glb: M.writeGlb(json, bin), moonTriangles: moon.length * 2, keptTriangles: rest.length * 2 };
}

const dracoBytes = (glb: { json: Json; bin: Buffer }, mesh: number, prim: number) => {
  const v = glb.json.bufferViews[glb.json.meshes[mesh].primitives[prim].extensions[DRACO].bufferView];
  return glb.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
};

describe("patchVillageMoon: the crescent replaced in a village.glb, nothing else touched", () => {
  it("takes the old crescent's triangles out of LM_atlas and adds fountain_moon with the unlit M_moon", async () => {
    const { glb, moonTriangles, keptTriangles } = syntheticVillage();
    const { out, report } = await M.patchVillageMoon(glb);
    expect(report.removed).toEqual([{ mesh: "village_lm_11", primitive: 0, material: "LM_atlas", triangles: moonTriangles, left: keptTriangles }]);
    const a = M.readGlb(glb);
    const b = M.readGlb(out);
    // the changed primitive: its other triangles, none of the crescent's
    const dec = M.decodeDraco(b.json, b.bin, b.json.meshes[0].primitives[0]);
    expect(dec.nf).toBe(keptTriangles);
    const P = dec.attrs.POSITION!.values;
    for (let i = 0; i < dec.np; i++) expect(P[i * 3 + 1]! < 2.5 || Math.abs(P[i * 3]!) > 20).toBe(true);
    expect(b.json.accessors[b.json.meshes[0].primitives[0].attributes.POSITION].count).toBe(dec.np);
    // every other primitive and the image: the same bytes
    expect(dracoBytes(b, 0, 1).equals(dracoBytes(a, 0, 1))).toBe(true);
    expect(dracoBytes(b, 1, 0).equals(dracoBytes(a, 1, 0))).toBe(true);
    const img = (g: { json: Json; bin: Buffer }) => {
      const v = g.json.bufferViews[g.json.images[0].bufferView];
      return g.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
    };
    expect(img(b).equals(img(a))).toBe(true);
    // the new node, mesh and material
    const node = b.json.nodes.find((n: Json) => n.name === M.MOON_NODE);
    expect(node).toBeTruthy();
    expect(b.json.scenes[0].nodes).toContain(b.json.nodes.indexOf(node));
    const prim = b.json.meshes[node.mesh].primitives;
    expect(prim).toHaveLength(1);
    expect(Object.keys(prim[0].attributes).sort()).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]); // no light-map UVs
    const mat = b.json.materials[prim[0].material];
    expect(mat.name).toBe(M.MOON_MATERIAL.name);
    expect(mat.extensions).toEqual({ [UNLIT]: {} });
    expect(mat.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 }); // LM_atlas's atlas
    expect(mat.pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 1]);
    const moon = M.decodeDraco(b.json, b.bin, prim[0]);
    expect(moon.nf).toBe(report.moon.triangles);
    expect(moon.nf).toBe(M.moonGeometry().indices.length / 3);
    expect(b.json.materials).toHaveLength(a.json.materials.length + 1);
  });

  it("is idempotent: a patched file comes back byte for byte, and patching twice equals patching once", async () => {
    const { glb } = syntheticVillage();
    const once = (await M.patchVillageMoon(glb)).out;
    const twice = await M.patchVillageMoon(once);
    expect(twice.report.removed).toEqual([]);
    expect(twice.out.equals(once)).toBe(true);
  });

  it("refuses a file whose LM_atlas has no atlas texture (the crescent's colour)", async () => {
    const { glb } = syntheticVillage();
    const g = M.readGlb(glb);
    delete g.json.materials[0].pbrMetallicRoughness.baseColorTexture;
    await expect(M.patchVillageMoon(M.writeGlb(g.json, g.bin))).rejects.toThrow(/base colour texture/);
  });

  it("the CLI writes the patched file, reports the check, and leaves an already patched file alone", () => {
    const { glb } = syntheticVillage();
    const src = path.join(tmp, "village.glb");
    const dst = path.join(tmp, "village_patched.glb");
    fs.writeFileSync(src, glb);
    const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    const first = run(src, "--out", dst);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("removed the old crescent: 6 triangles from village_lm_11[0] (LM_atlas)");
    expect(first.stdout).toContain("check passed");
    expect(fs.readFileSync(src).equals(glb)).toBe(true); // --out: the input stays
    const second = run(dst);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("(already patched: unchanged)");
    const dry = run(src, "--dry");
    expect(dry.status, dry.stderr).toBe(0);
    expect(fs.readFileSync(src).equals(glb)).toBe(true);
  }, 30_000); // three node processes, each loading Draco: well over the 5 s default when the machine is busy
});
