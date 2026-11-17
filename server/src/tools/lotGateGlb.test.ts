/**
 * 케이슨랜드 정문 — the B3 polish of L4's gate (75ab7df; docs/designs/village-lots-v2/tools/parts_lot_gate.py on gate_kit.py /
 * gate_base.py): lot_gate.glb against the lots v2 contract (positions, colliders, seats and slot names unchanged), the budget
 * the gate was reviewed at (shell 4k, detail 25k), KTX2 only (PBR library sets + one small word-free own atlas), no money
 * (the ticket-price boards are gone: no ticket cell, no price words in names or the manifest).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractColliders, parseGlb, type Gltf } from "../../../scripts/lib/schoolGlb";
import {
  LOT_GLB_BUDGET,
  LOT_TRIANGLES,
  lotColliders,
  lotDetailNode,
  lotDoorNode,
  lotDoorPoints,
  lotSeatMarkers,
  lotShellNode,
  lotSlots,
  villageLot,
} from "@caysonverse/shared/village/villageLots";

const REPO = path.resolve(__dirname, "..", "..", "..");
const LOTS = path.join(REPO, "client", "public", "models", "village", "lots");
const PBR = path.join(REPO, "client", "public", "textures", "pbr");
const LOT = villageLot("lot_gate");
const MONEY = /price|sell|shop|atm|ticket|cash|pay|won|가격|판매|매표|입장권|어른|어린이|자유이용권/i;

const load = (): { g: Gltf; bytes: number } => {
  const f = path.join(LOTS, "lot_gate.glb");
  return { g: parseGlb(new Uint8Array(fs.readFileSync(f))).gltf, bytes: fs.statSync(f).size };
};
const node = (g: Gltf, name: string) => {
  const n = g.nodes!.find((q) => q.name === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
};
const meshTris = (g: Gltf, mesh: number): number =>
  g.meshes![mesh]!.primitives.reduce((t, p) => t + (p.indices !== undefined ? g.accessors![p.indices]!.count : g.accessors![p.attributes.POSITION!]!.count) / 3, 0);
function drawnTris(g: Gltf, idx: number): number {
  const n = g.nodes![idx]!;
  let t = 0;
  if (n.mesh !== undefined) {
    const inst = (n.extensions as Record<string, { attributes?: Record<string, number> }> | undefined)?.EXT_mesh_gpu_instancing;
    t += meshTris(g, n.mesh) * (inst?.attributes?.TRANSLATION !== undefined ? g.accessors![inst.attributes.TRANSLATION]!.count : 1);
  }
  for (const c of n.children ?? []) t += drawnTris(g, c);
  return t;
}
const close = (a: number, b: number, eps = 0.011) => Math.abs(a - b) <= eps;

describe("lot_gate.glb (lots v2 B3 polish of L4 75ab7df)", () => {
  it("keeps the contract's 21 colliders to the centimetre, the seats and the slots", () => {
    const { g } = load();
    const { colliders, problems } = extractColliders(g);
    expect(problems).toEqual([]);
    const want = lotColliders(LOT);
    expect(want).toHaveLength(21);
    expect(colliders.map((c) => c.name).sort()).toEqual(want.map((c) => `col__${c.id}`).sort());
    for (const c of want) {
      const got = colliders.find((x) => x.name === `col__${c.id}`)!;
      for (const k of ["minX", "maxX", "minZ", "maxZ"] as const) expect(got.box[k], `${c.id} ${k}`).toBeCloseTo(c.box[k], 2);
    }
    for (const s of lotSeatMarkers(LOT)) {
      const t = node(g, `seat__${s.id}`).translation!;
      expect(close(t[0]!, s.x) && close(t[2]!, s.z) && close(t[1]!, s.seatTop), s.id).toBe(true);
    }
    for (const s of lotSlots(LOT)) {
      const t = node(g, s.node).translation!;
      expect(close(t[0]!, s.x) && close(t[1]!, s.y) && close(t[2]!, s.z), s.node).toBe(true);
    }
  });

  it("has the shell, the detail, the night glow and the closed gate's two hinged leaves", () => {
    const { g } = load();
    expect(node(g, lotShellNode("lot_gate")).mesh).toBeTypeOf("number");
    node(g, lotDetailNode("lot_gate"));
    const names = g.nodes!.map((n) => n.name ?? "");
    for (const part of ["letters", "lamps", "lanterns"]) expect(names.some((n) => n.startsWith(`lotnight__lot_gate_${part}`)), part).toBe(true);
    for (const d of lotDoorPoints(LOT)) {
      const n = node(g, lotDoorNode(d.door));
      expect(close(n.translation![0]!, d.centre.x) && close(n.translation![2]!, d.centre.z)).toBe(true);
      expect((n.children ?? []).map((c) => g.nodes![c]!.name).sort()).toEqual([`${lotDoorNode(d.door)}_l`, `${lotDoorNode(d.door)}_r`]);
    }
    for (const n of names) expect(n, n).not.toMatch(MONEY);
  });

  it("stays in the budget it was reviewed at (shell 4k, detail 25k incl. instances, structure <= 55%), <= 10 materials, 0.6 MB, no images", () => {
    const { g, bytes } = load();
    const shell = node(g, lotShellNode("lot_gate"));
    expect(meshTris(g, shell.mesh!)).toBeLessThanOrEqual(LOT_TRIANGLES.lot_gate.shell);
    expect(g.meshes![shell.mesh!]!.primitives.length).toBeLessThanOrEqual(LOT_GLB_BUDGET.shellDraws);
    const det = g.nodes!.findIndex((n) => n.name === lotDetailNode("lot_gate"));
    const leaves = (node(g, lotDoorNode("lot_gate_main")).children ?? []).reduce((t, c) => t + drawnTris(g, c), 0);
    expect(drawnTris(g, det) + leaves).toBeLessThanOrEqual(LOT_TRIANGLES.lot_gate.detail);
    expect(meshTris(g, node(g, "lotdetail__lot_gate_mesh").mesh!) + leaves).toBeLessThanOrEqual(LOT_TRIANGLES.lot_gate.detail * LOT_GLB_BUDGET.structureShare);
    expect(g.materials!.length).toBeLessThanOrEqual(LOT_GLB_BUDGET.maxMaterials);
    expect(g.images ?? []).toHaveLength(0);
    expect(bytes).toBeLessThanOrEqual(LOT_GLB_BUDGET.maxBytes);
  });

  it("textures: KTX2 only — library sets for every LM_ surface, the word-free own atlas, no ticket board", () => {
    const { g } = load();
    const extras = (g.asset as { extras?: { textures?: string } }).extras ?? {};
    expect(extras.textures).toBe("lots/martgate/lot_gate_textures.json");
    const raw = fs.readFileSync(path.join(LOTS, "martgate", "lot_gate_textures.json"), "utf8");
    expect(raw).not.toMatch(/\b(price|prices|ticket|tickets|cash|atm|sell|shop)\b|가격|판매|매표|입장권|어른|어린이|자유이용권/i);
    const man = JSON.parse(raw) as { format: string; materials: Record<string, { pbr?: string; kind?: string; maps?: { albedo: string } }> };
    expect(man.format).toBe("ktx2");
    for (const name of g.materials!.map((m) => m.name!)) {
      const m = man.materials[name];
      expect(m, name).toBeDefined();
      if (m!.kind === "own") {
        expect(m!.maps!.albedo.endsWith(".ktx2")).toBe(true);
        expect(fs.existsSync(path.join(LOTS, "martgate", m!.maps!.albedo))).toBe(true);
        continue;
      }
      if (m!.kind) {
        expect(["glass", "lamp", "emit"]).toContain(m!.kind);
        continue;
      }
      expect(name.startsWith("LM_martgate_"), name).toBe(true);
      for (const tier of ["2k", "1k"]) expect(fs.existsSync(path.join(PBR, tier, `${m!.pbr}_albedo.ktx2`)), `${m!.pbr} ${tier}`).toBe(true);
    }
  });
});
