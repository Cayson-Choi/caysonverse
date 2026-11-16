import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  LAKE_FISH_GLB_HASH, LAKE_FISH_IDS, LAKE_FISH_MAX_BYTES, LAKE_FISH_PATH, LAKE_GEAR_GLB_HASH, LAKE_GEAR_MAX_BYTES,
  LAKE_GEAR_NODES, LAKE_GEAR_PATH, ROD_BONES, ROD_CLIPS, lakeFishNode,
} from "./lakeGear";

const PUBLIC = resolve(process.cwd(), "../client/public");
const gearPath = resolve(PUBLIC, `.${LAKE_GEAR_PATH}`);
const fishPath = resolve(PUBLIC, `.${LAKE_FISH_PATH}`);

function gltf(path: string) {
  const buf = readFileSync(path);
  expect(buf.toString("ascii", 0, 4)).toBe("glTF");
  const n = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + n).toString("utf8")) as {
    nodes: { name?: string; children?: number[]; mesh?: number }[];
    animations?: { name: string }[];
    scenes: { nodes: number[] }[];
    materials?: { name: string }[];
    images?: unknown[];
    extensionsUsed?: string[];
  };
}
const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 8);

describe("lake_gear.glb", () => {
  const g = gltf(gearPath);
  const names = g.nodes.map((n) => n.name);
  it("내용 해시와 크기 예산", () => {
    expect(hash(gearPath)).toBe(LAKE_GEAR_GLB_HASH);
    expect(statSync(gearPath).size).toBeLessThanOrEqual(LAKE_GEAR_MAX_BYTES);
  });
  it("약속한 노드·뼈·클립이 있다", () => {
    for (const n of Object.values(LAKE_GEAR_NODES)) expect(names, n).toContain(n);
    for (const b of ROD_BONES) expect(names, b).toContain(b);
    const clips = (g.animations ?? []).map((a) => a.name);
    for (const c of ROD_CLIPS) expect(clips, c).toContain(c);
  });
});

describe("lake_fish.glb", () => {
  const g = gltf(fishPath);
  const names = g.nodes.map((n) => n.name);
  it("내용 해시와 크기 예산", () => {
    expect(hash(fishPath)).toBe(LAKE_FISH_GLB_HASH);
    expect(statSync(fishPath).size).toBeLessThanOrEqual(LAKE_FISH_MAX_BYTES);
  });
  it("종마다 fish_<id> 노드와 LOD1, 재질 둘(사진 몸·반투명 지느러미), 이미지 셋(사진·노멀·지느러미), Draco·WebP", () => {
    for (const id of LAKE_FISH_IDS) {
      expect(names, id).toContain(lakeFishNode(id));
      expect(names, id).toContain(`${lakeFishNode(id)}_lod1`);
    }
    expect((g.materials ?? []).map((m) => m.name).sort()).toEqual(["M_fin", "M_fish"]);
    expect(g.images?.length).toBe(3);
    expect(g.extensionsUsed ?? []).toContain("KHR_draco_mesh_compression");
    expect(g.extensionsUsed ?? []).toContain("EXT_texture_webp");
  });
});
