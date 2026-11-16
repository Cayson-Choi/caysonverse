/**
 * The A8 house body kit's output (X1, docs/designs/house-exteriors/tools/build_house_body.py): village_houses.glb and the
 * houses' PBR tiling sets checked against the contract (houseExterior.ts HOUSE_GLB_BUDGET, HOUSE_SURFACE_RULES; design 8 A1,
 * A4,
 * A6). X2 (porch_kit.py, 2026-11-17) adds the porches, steps, beds, LPG, gardens, flush decks and owner-slot fittings into
 * the same nodes: each house's detail <= 6,000 triangles and 6 materials (M_leaf_flora the sixth), its shell <= 1,800; and
 * check_porch.py's report (x2/porch_check.json) proves every porch solid against the contract's colliders, lift zones,
 * the body and the front door's swing — this file checks that report against houseExterior.ts.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseGlb, type Gltf } from "../../../scripts/lib/schoolGlb";
import {
  HOUSE_GLB_BUDGET,
  HOUSE_SURFACE_RULES,
  houseDetailNode,
  houseExteriorColliders,
  houseShellNode,
  houseSlotNode,
  houseWorldToLocal,
} from "@caysonverse/shared/village/houseExterior";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";

const REPO = path.resolve(__dirname, "..", "..", "..");
const MODELS = path.join(REPO, "client", "public", "models", "village");
const GLB = path.join(MODELS, "village_houses.glb");
const TEX = path.join(MODELS, "houses");
const IDS = Array.from({ length: 10 }, (_, i) => `house_${i + 1}`);
const PORCH_CHECK = path.join(REPO, "docs", "designs", "house-exteriors", "x2", "porch_check.json");

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

  it("stays in the triangle budgets with the porch kit in (A1)", () => {
    const g = load();
    let total = 0;
    for (const id of IDS) {
      const s = meshTris(g, node(g, houseShellNode(id)).mesh!);
      const d = meshTris(g, node(g, houseDetailNode(id)).mesh!);
      expect(s, id).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.shellTriangles);
      expect(d, id).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.detailTriangles);
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
      expect(g.meshes![node(g, houseDetailNode(id)).mesh!]!.primitives.length, id).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.detailDraws);
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

  it("draws the beds' and gardens' planting spots with the village's flora material, alpha-clipped (X2)", () => {
    const g = load();
    const flora = g.materials!.find((m) => m.name === "M_leaf_flora");
    expect(flora).toBeDefined();
    expect((flora as { alphaMode?: string }).alphaMode).toBe("MASK");
    for (const id of IDS) {
      const prims = g.meshes![node(g, houseDetailNode(id)).mesh!]!.primitives;
      expect(prims.some((p) => g.materials![p.material!]!.name === "M_leaf_flora"), id).toBe(true);
    }
  });
});

interface PorchReport {
  pass: boolean;
  totalTriangles: number;
  houses: Record<
    string,
    {
      fails: string[];
      doorClearance: { metres: number };
      colliders: Record<string, { collider: number[]; solids: number[] }>;
    }
  >;
}

describe("porch kit check (X2, check_porch.py report)", () => {
  const rep = JSON.parse(fs.readFileSync(PORCH_CHECK, "utf8")) as PorchReport;

  it("passes every check for the ten houses (contract, colliders, walk zones, clips, door swing, budgets, texels)", () => {
    expect(rep.pass).toBe(true);
    for (const id of IDS) expect(rep.houses[id]!.fails, id).toEqual([]);
    expect(rep.totalTriangles).toBeLessThanOrEqual(HOUSE_GLB_BUDGET.totalTriangles);
  });

  it("keeps the front door's swing at least 5 cm from every porch part (owner 2026-11-17)", () => {
    for (const id of IDS) expect(rep.houses[id]!.doorClearance.metres, id).toBeGreaterThanOrEqual(0.05);
  });

  it("builds to the contract's colliders: each one has its parts inside it, to the centimetre", () => {
    for (const h of VILLAGE_LAYOUT.sceneryHouses.filter((q) => IDS.includes(q.id))) {
      const r = rep.houses[h.id]!;
      const want = houseExteriorColliders(h);
      expect(Object.keys(r.colliders).length, h.id).toBe(want.length);
      for (const c of want) {
        const key = c.id.startsWith("garden_") ? "garden" : c.id.replace(`${h.id}_`, "");
        const got = r.colliders[key];
        expect(got, `${h.id} ${key}`).toBeDefined();
        const a = houseWorldToLocal(h, c.box.minX, c.box.minZ);
        const b = houseWorldToLocal(h, c.box.maxX, c.box.maxZ);
        const local = [Math.min(a.lx, b.lx), Math.max(a.lx, b.lx), Math.min(a.lz, b.lz), Math.max(a.lz, b.lz)];
        for (let i = 0; i < 4; i++) expect(Math.abs(got!.collider[i]! - local[i]!), `${h.id} ${key} [${i}]`).toBeLessThanOrEqual(0.011);
      }
    }
  });
});
