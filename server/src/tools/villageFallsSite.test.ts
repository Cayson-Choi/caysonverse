/**
 * B1 waterfall W6: the waterfall site box is cut out of the shipped village.glb (scripts/patch-village-falls-site.mjs)
 * and waterfall.glb's ground meets the cut exactly (docs/designs/waterfall/design.md §7.1-7.2, V1-V9). This reads the
 * real files: nothing of the old falls left in the village (cliff, rocks, ribbons, pool disc, ground, forest cards in the
 * box), the sky-glare fix's images kept byte for byte, the seam (the village's ground 2 mm outside the box against the
 * seam file, the falls ground's outline against the same file), the rest pocket flat, the feeder stream's new start,
 * and a second run of the patch changing nothing. The scripts are plain node ESM, loaded with a dynamic import.
 */
import { beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MODELS = path.join(REPO_ROOT, "client", "public", "models", "village");
const EDGE_FILE = path.join(REPO_ROOT, "docs", "designs", "waterfall", "waterfall_site_edge.json");

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- glTF JSON, read loosely
interface Decoded {
  attrs: Record<string, { values: Float32Array; size: number }>;
  faces: Uint32Array;
  np: number;
  nf: number;
}
interface MoonModule {
  draco(): Promise<unknown>;
  readGlb(buf: Buffer): { json: Json; bin: Buffer };
  decodeDraco(json: Json, bin: Buffer, prim: Json): Decoded;
}
interface SiteModule {
  SITE: { minX: number; maxX: number; minZ: number; maxZ: number };
  POCKET: { minX: number; maxX: number; minZ: number; maxZ: number };
  patchVillageFallsSite(input: Buffer): Promise<{ out: Buffer; unchanged?: boolean }>;
}
type Tri = [number[], number[], number[]];

let moon: MoonModule;
let site: SiteModule;
let village: { json: Json; bin: Buffer; bytes: Buffer };
let edge: { points: Array<{ x: number; z: number; y: number }>; provisional: boolean; site: Json };
const ground: Tri[] = [];
const water: Tri[] = [];

function triangles(json: Json, bin: Buffer, prim: Json, out: Tri[]): void {
  const d = moon.decodeDraco(json, bin, prim);
  const P = d.attrs.POSITION!.values;
  for (let f = 0; f < d.nf; f++) {
    const c = [0, 1, 2].map((k) => {
      const i = d.faces[f * 3 + k]!;
      return [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!];
    });
    out.push(c as Tri);
  }
}

/** The top-most surface's height under (x, z), or null. */
function topAt(tris: Tri[], x: number, z: number): number | null {
  let best: number | null = null;
  for (const [a, b, c] of tris) {
    if (x < Math.min(a[0]!, b[0]!, c[0]!) - 1e-4 || x > Math.max(a[0]!, b[0]!, c[0]!) + 1e-4) continue;
    if (z < Math.min(a[2]!, b[2]!, c[2]!) - 1e-4 || z > Math.max(a[2]!, b[2]!, c[2]!) + 1e-4) continue;
    const d = (b[0]! - a[0]!) * (c[2]! - a[2]!) - (c[0]! - a[0]!) * (b[2]! - a[2]!);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((x - a[0]!) * (c[2]! - a[2]!) - (c[0]! - a[0]!) * (z - a[2]!)) / d;
    const v = ((b[0]! - a[0]!) * (z - a[2]!) - (x - a[0]!) * (b[2]! - a[2]!)) / d;
    if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) continue;
    const y = a[1]! + u * (b[1]! - a[1]!) + v * (c[1]! - a[1]!);
    if (best === null || y > best) best = y;
  }
  return best;
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
function imageBytes(json: Json, bin: Buffer, name: string): Buffer {
  const im = json.images.find((i: Json) => i.name === name);
  const v = json.bufferViews[im.bufferView];
  return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
}

beforeAll(async () => {
  moon = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts", "patch-village-moon.mjs")).href)) as MoonModule;
  site = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts", "patch-village-falls-site.mjs")).href)) as SiteModule;
  await moon.draco();
  const bytes = fs.readFileSync(path.join(MODELS, "village.glb"));
  village = { ...moon.readGlb(bytes), bytes };
  edge = JSON.parse(fs.readFileSync(EDGE_FILE, "utf8"));
  const { json, bin } = village;
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const m = json.materials[prim.material]?.name;
      if (m === "LM_grass" || m === "M_backdrop") triangles(json, bin, prim, ground);
      if (m === "M_water") triangles(json, bin, prim, water);
    }
  }
}, 60_000);

const inside = (x: number, z: number, g = 0) =>
  x > site.SITE.minX + g && x < site.SITE.maxX - g && z > site.SITE.minZ + g && z < site.SITE.maxZ - g;

describe("village.glb: the waterfall site box is cut out (W6, V1-V9)", () => {
  it("has nothing of the old falls: no M_waterfall, no T_falls, no old ribbon node", () => {
    const { json } = village;
    expect(json.materials.map((m: Json) => m.name)).not.toContain("M_waterfall");
    expect(json.images.map((m: Json) => m.name)).not.toContain("T_falls");
    expect(json.nodes.map((n: Json) => n.name)).not.toContain("village_water_-10");
  });

  it("keeps the sky-glare fix (a6d2f65): T_sky and T_backdrop are main's bytes", () => {
    expect(sha(imageBytes(village.json, village.bin, "T_sky"))).toBe("04b8d68379dd94dd");
    expect(sha(imageBytes(village.json, village.bin, "T_backdrop"))).toBe("d6c9d939129f54f5");
  });

  it("draws no ground, rock or water inside the box", () => {
    const centroidIn = (t: Tri) => inside((t[0][0]! + t[1][0]! + t[2][0]!) / 3, (t[0][2]! + t[1][2]! + t[2][2]!) / 3, 1e-3);
    expect(ground.filter(centroidIn)).toEqual([]);
    expect(water.filter(centroidIn)).toEqual([]);
  });

  it("has no far-forest card standing inside the box", () => {
    const { json, bin } = village;
    let n = 0;
    for (const node of json.nodes) {
      const at = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
      if (!at || !String(node.name).startsWith("inst__far_")) continue;
      const a = json.accessors[at.TRANSLATION];
      const v = json.bufferViews[a.bufferView];
      const f = new Float32Array(bin.buffer.slice(bin.byteOffset + (v.byteOffset ?? 0), bin.byteOffset + (v.byteOffset ?? 0) + a.count * 12));
      for (let i = 0; i < a.count; i++) if (inside(f[i * 3]!, f[i * 3 + 2]!)) n++;
    }
    expect(n).toBe(0);
  });

  it("meets the seam file: the ground 2 mm outside the outline is on its polyline (within 6 mm), 172 points CCW from the north-west", () => {
    expect(edge.provisional).toBe(false);
    expect(edge.points).toHaveLength(172);
    expect(edge.points[0]).toMatchObject({ x: -140, z: -104 });
    expect(edge.points[40]).toMatchObject({ x: -100, z: -104 });
    expect(edge.points[86]).toMatchObject({ x: -100, z: -58 });
    expect(edge.points[126]).toMatchObject({ x: -140, z: -58 });
    const S = site.SITE;
    let worst = 0;
    const pts = edge.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      for (let s = 0; s < 4; s++) {
        const t = s / 4;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const ox = x <= S.minX + 1e-6 ? -0.002 : x >= S.maxX - 1e-6 ? 0.002 : 0;
        const oz = z <= S.minZ + 1e-6 ? -0.002 : z >= S.maxZ - 1e-6 ? 0.002 : 0;
        const h = topAt(ground, x + ox, z + oz);
        expect(h, `ground at ${x}, ${z}`).not.toBeNull();
        worst = Math.max(worst, Math.abs(h! - (a.y + (b.y - a.y) * t)));
      }
    }
    expect(worst).toBeLessThan(0.006);
  });

  it("is flat in the rest pocket east of the box (V5b): 0 within 1 cm", () => {
    for (let x = -99.75; x <= -95; x += 0.5) {
      for (let z = -89.75; z <= -68.25; z += 0.5) expect(Math.abs(topAt(ground, x, z)!), `${x}, ${z}`).toBeLessThan(0.01);
    }
  });

  it("starts the feeder stream at the outlet's end (-107, -58) with its water at -0.30 or lower (V7)", () => {
    let near = 0;
    for (const t of water) {
      for (const c of t) {
        if (Math.hypot(c[0]! - -107, c[2]! - -58) < 2.0) {
          near++;
          expect(c[1]).toBeLessThanOrEqual(-0.3 + 0.002);
        }
      }
    }
    expect(near).toBeGreaterThan(0);
    expect(topAt(water, -107, -57.9)).not.toBeNull();
  });

  it("a second run of the patch changes nothing", async () => {
    const r = await site.patchVillageFallsSite(village.bytes);
    expect(r.unchanged).toBe(true);
    expect(r.out.equals(village.bytes)).toBe(true);
  });
});

describe("waterfall.glb: its ground meets the same seam (W6)", () => {
  it("every outline vertex of falls_ground is on the seam polyline (within 1.5 cm)", () => {
    const bytes = fs.readFileSync(path.join(MODELS, "waterfall.glb"));
    const { json, bin } = moon.readGlb(bytes);
    const node = json.nodes.find((n: Json) => n.name === "falls_ground");
    expect(node).toBeTruthy();
    const S = site.SITE;
    const tab = (side: "n" | "s" | "e" | "w") =>
      edge.points
        .filter((p) => (side === "n" ? p.z === S.minZ : side === "s" ? p.z === S.maxZ : side === "e" ? p.x === S.maxX : p.x === S.minX))
        .map((p) => [side === "n" || side === "s" ? p.x : p.z, p.y] as [number, number])
        .sort((a, b) => a[0] - b[0]);
    const sides = { n: tab("n"), s: tab("s"), e: tab("e"), w: tab("w") };
    const interp = (t: Array<[number, number]>, v: number) => {
      for (let i = 1; i < t.length; i++) {
        if (v <= t[i]![0] + 1e-9) return t[i - 1]![1] + ((t[i]![1] - t[i - 1]![1]) * (v - t[i - 1]![0])) / (t[i]![0] - t[i - 1]![0]);
      }
      return t[t.length - 1]![1];
    };
    const tr = node.translation ?? [0, 0, 0];
    let n = 0;
    let worst = 0;
    for (const prim of json.meshes[node.mesh].primitives) {
      const d = moon.decodeDraco(json, bin, prim);
      const P = d.attrs.POSITION!.values;
      for (let i = 0; i < d.np; i++) {
        const x = P[i * 3]! + tr[0];
        const y = P[i * 3 + 1]! + tr[1];
        const z = P[i * 3 + 2]! + tr[2];
        const side = Math.abs(z - S.minZ) < 0.01 ? "n" : Math.abs(z - S.maxZ) < 0.01 ? "s" : Math.abs(x - S.maxX) < 0.01 ? "e" : Math.abs(x - S.minX) < 0.01 ? "w" : null;
        if (!side) continue;
        const want = interp(sides[side], side === "n" || side === "s" ? x : z);
        if (y < want - 0.3) continue; // the skirt hanging below the outline
        n++;
        worst = Math.max(worst, Math.abs(y - want));
      }
    }
    expect(n).toBeGreaterThan(150);
    expect(worst).toBeLessThan(0.015);
  });
});
