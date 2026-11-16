/**
 * The A8 house body kit's output (X1, docs/designs/house-exteriors/tools/build_house_body.py): village_houses.glb and the
 * houses' PBR tiling sets checked against the contract (houseExterior.ts HOUSE_GLB_BUDGET, HOUSE_SURFACE_RULES; design 8 A1,
 * A4, A6). X2 adds the porches into the same `housedetail__` nodes, so the body detail keeps room for them: at most 5 detail
 * materials (X2 adds M_leaf_flora: contract 5's 6 draws) and a share of the 6,000-triangle detail budget.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseGlb, type Gltf } from "../../../scripts/lib/schoolGlb";
import { HOUSE_GLB_BUDGET, HOUSE_SURFACE_RULES, houseDetailNode, houseShellNode, houseSlotNode } from "@caysonverse/shared/village/houseExterior";

const REPO = path.resolve(__dirname, "..", "..", "..");
const MODELS = path.join(REPO, "client", "public", "models", "village");
const GLB = path.join(MODELS, "village_houses.glb");
const TEX = path.join(MODELS, "houses");
const IDS = Array.from({ length: 10 }, (_, i) => `house_${i + 1}`);
/** The body kit's own share of a house's detail budget (the rest is the porch kit's, X2). */
const BODY_DETAIL_MAX = 3_400;

function load(): Gltf {
  return parseGlb(new Uint8Array(fs.readFileSync(GLB))).gltf;
}

function meshTris(g: Gltf, mesh: number): number {
  let t = 0;
  for (const p of g.meshes![mesh]!.primitives) {
    const acc = p.indices !== undefined ? g.accessors![p.indices]!.count : g.accessors![p.attributes.POSITION!]!.count;
    t += acc / 3;
  }
  return t;
}

function node(g: Gltf, name: string) {
  const n = g.nodes!.find((q) => q.name === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
}

describe("village_houses.glb (A8 house body kit)", () => {
  it("has every house's shell and detail and the 30 owner slots (A6)", () => {
    const g = load();
    for (const id of IDS) {
      expect(node(g, houseShellNode(id)).mesh).toBeTypeOf("number");
      expect(node(g, houseDetailNode(id)).mesh).toBeTypeOf("number");
      for (const k of ["nameplate", "mailbox", "sign"] as const) expect(node(g, houseSlotNode(id, k)).mesh).toBeUndefined();
    }
  });

  it("stays in the triangle budgets, leaving the porch kit its share of the detail (A1)", () => {
    const g = load();
    let total = 0;
    for (const id of IDS) {
      const s = meshTris(g, node(g, houseShellNode(id)).mesh!);
      const d = meshTris(g, node(g, houseDetailNode(id)).mesh!);
      expect(s, id).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.shellTriangles);
      expect(d, id).toBeLessThanOrEqual(BODY_DETAIL_MAX);
      total += s + d;
    }
    expect(total).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.totalTriangles);
  });

  it("uses the contract's materials only, few enough draws per part, and carries no images (A4)", () => {
    const g = load();
    const names = g.materials!.map((m) => m.name!);
    expect(names.length).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.maxMaterials);
    for (const n of names) expect(HOUSE_GLB_BUDGET.materials).toContain(n);
    expect(g.images ?? []).toHaveLength(0);
    for (const id of IDS) {
      expect(g.meshes![node(g, houseShellNode(id)).mesh!]!.primitives.length, id).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.shellDraws);
      expect(g.meshes![node(g, houseDetailNode(id)).mesh!]!.primitives.length, id).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.detailDraws - 1);
    }
    expect(fs.statSync(GLB).size).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.maxBytes);
  });

  it("has the PBR sets for every textured material, within the download budget (contract 6)", () => {
    const meta = JSON.parse(fs.readFileSync(path.join(TEX, "house_textures.json"), "utf8")) as {
      mapSide: number;
      materials: Record<string, { sets: string[]; maps: Record<string, string> }>;
    };
    const g = load();
    const textured = g.materials!.map((m) => m.name!).filter((n) => n.startsWith("LM_"));
    let bytes = 0;
    const sets = new Set<string>();
    for (const m of textured) {
      const t = meta.materials[m];
      expect(t, m).toBeDefined();
      for (const k of HOUSE_SURFACE_RULES.pbr) {
        const f = path.join(TEX, t!.maps[k === "roughness" ? "rough" : k]!);
        expect(fs.existsSync(f), f).toBe(true);
        bytes += fs.statSync(f).size;
      }
      for (const s of t!.sets) sets.add(s);
    }
    expect(meta.mapSide).toBeLessThanOrEqual(HOUSE_SURFACE_RULES.mapSide);
    expect(bytes).toBeLessThanOrEqual(HOUSE_SURFACE_RULES.setsMaxBytes);
    for (const s of HOUSE_SURFACE_RULES.sets) expect(sets, s).toContain(s);
  });
});
