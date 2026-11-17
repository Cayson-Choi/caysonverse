/**
 * Shared checks for B1's lot GLBs (lots v2: lot_school, lot_library), after v1's lotHallPostGlb.test.ts: the file's nodes,
 * colliders, seats, slots and swing door against villageLots.ts, the budgets of design 7 / contract 6, and the texture
 * manifest (every LM_ material a PBR library set with its KTX2 files on disk, the lot's surface families covered).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractColliders, parseGlb, type Gltf } from "../../../scripts/lib/schoolGlb";
import {
  LOT_GLB_BUDGET,
  LOT_INTERIORS,
  LOT_SURFACE_RULES,
  LOT_TRIANGLES,
  lotColliders,
  lotDetailNode,
  lotDoorNode,
  lotDoorPoints,
  lotInteriorDoor,
  lotSeatMarkers,
  lotShellNode,
  lotSlots,
  villageLot,
  type LotId,
} from "@caysonverse/shared/village/villageLots";

const REPO = path.resolve(__dirname, "..", "..", "..");
const LOTS = path.join(REPO, "client", "public", "models", "village", "lots");
const PBR = path.join(REPO, "client", "public", "textures", "pbr");
const MONEY = /price|sell|shop|atm|ticket|cash|pay|won|가격|판매|매표|입장권|원\b/i;

interface Manifest {
  lot: string;
  format: string;
  materials: Record<string, { pbr?: string; kind?: string; repeatMeters?: number[]; vertexColor?: boolean }>;
  pbrSets: string[];
}

function load(id: LotId): { g: Gltf; bytes: number } {
  const f = path.join(LOTS, `${id}.glb`);
  return { g: parseGlb(new Uint8Array(fs.readFileSync(f))).gltf, bytes: fs.statSync(f).size };
}

function node(g: Gltf, name: string) {
  const n = g.nodes!.find((q) => q.name === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
}

function meshTris(g: Gltf, mesh: number): number {
  let t = 0;
  for (const p of g.meshes![mesh]!.primitives) {
    const acc = p.indices !== undefined ? g.accessors![p.indices]!.count : g.accessors![p.attributes.POSITION!]!.count;
    t += acc / 3;
  }
  return t;
}

/** Triangles drawn under a node: an instanced node draws its mesh once per instance. */
function drawnTris(g: Gltf, idx: number): number {
  const n = g.nodes![idx]!;
  let t = 0;
  if (n.mesh !== undefined) {
    const inst = (n.extensions as Record<string, { attributes?: Record<string, number> }> | undefined)?.EXT_mesh_gpu_instancing;
    const count = inst?.attributes?.TRANSLATION !== undefined ? g.accessors![inst.attributes.TRANSLATION]!.count : 1;
    t += meshTris(g, n.mesh) * count;
  }
  for (const c of n.children ?? []) t += drawnTris(g, c);
  return t;
}

const close = (a: number, b: number, eps = 0.011) => Math.abs(a - b) <= eps;

function pbrIds(): Set<string> {
  const src = fs.readFileSync(path.join(REPO, "client", "src", "village", "pbr", "pbrManifest.generated.ts"), "utf8");
  return new Set([...src.matchAll(/^ {4}"id": "([a-z0-9_]+)"/gm)].map((m) => m[1]!));
}

export function describeLotGlb(id: LotId, dir: string, want: { night: string[]; slotKinds: string[] }): void {
  const LOT = villageLot(id);
  describe(`${id}.glb (lots v2 B1 kit)`, () => {
    it("has the shell, the detail (structure + goods), night glow and instanced kinds (contract 6)", () => {
      const { g } = load(id);
      expect(node(g, lotShellNode(id)).mesh).toBeTypeOf("number");
      const det = node(g, lotDetailNode(id));
      const goodsIdx = g.nodes!.findIndex((n) => n.name === `lotgoods__${id}`);
      expect(det.children).toContain(goodsIdx);
      expect(det.children).toContain(g.nodes!.findIndex((n) => n.name === `lotdetail__${id}_mesh`));
      expect(g.nodes![goodsIdx]!.children).toContain(g.nodes!.findIndex((n) => n.name === `lotgoods__${id}_mesh`));
      const names = g.nodes!.map((n) => n.name ?? "");
      for (const part of want.night) expect(names, part).toContain(`lotnight__${id}_${part}`);
      const inst = g.nodes!.filter((n) => n.extensions && "EXT_mesh_gpu_instancing" in n.extensions);
      expect(inst.length).toBeGreaterThan(0);
      const kinds = g.nodes!.filter((n) => (n.name ?? "").startsWith(`lotinst__${id}_`) && n.mesh === undefined);
      expect(kinds.length).toBeLessThanOrEqual(LOT_GLB_BUDGET.instancedKindsPerLot);
      for (const n of names) expect(n, n).not.toMatch(MONEY);
    });

    it("has the contract's colliders, to the centimetre (contract 3, T6)", () => {
      const { g } = load(id);
      const { colliders, problems } = extractColliders(g);
      expect(problems).toEqual([]);
      const wantC = lotColliders(LOT);
      expect(colliders.map((c) => c.name).sort()).toEqual(wantC.map((c) => `col__${c.id}`).sort());
      for (const c of wantC) {
        const got = colliders.find((x) => x.name === `col__${c.id}`)!;
        for (const k of ["minX", "maxX", "minZ", "maxZ"] as const) expect(got.box[k], `${c.id} ${k}`).toBeCloseTo(c.box[k], 2);
        const n = node(g, `col__${c.id}`);
        const top = n.translation![1]! + n.scale![1]! / 2;
        if (c.camera) expect(top, c.id).toBeCloseTo(c.cameraHeight, 2);
        else expect(top, c.id).toBeLessThan(1.6);
      }
    });

    it("puts the seats, the slots and the swing door with its two hinged leaves where the contract says (T7)", () => {
      const { g } = load(id);
      for (const s of lotSeatMarkers(LOT)) {
        const t = node(g, `seat__${s.id}`).translation!;
        expect(close(t[0]!, s.x) && close(t[2]!, s.z) && close(t[1]!, s.seatTop), s.id).toBe(true);
      }
      for (const s of lotSlots(LOT)) {
        const t = node(g, s.node).translation!;
        const unit = s.where === "exterior" ? null : LOT.units.find((u) => `interior:${u.id}` === s.where)!;
        const ox = unit ? unit.interior.origin.x : 0;
        const oz = unit ? unit.interior.origin.z : 0;
        expect(close(t[0]!, s.x + ox) && close(t[1]!, s.y) && close(t[2]!, s.z + oz), s.node).toBe(true);
        expect(s.tags).toHaveLength(0);
      }
      expect(lotSlots(LOT).map((s) => s.kind).sort()).toEqual([...want.slotKinds].sort());
      const extras = (g.asset as { extras?: { doors?: Record<string, Record<string, { openDeg: number }>>; textures?: string } }).extras ?? {};
      for (const d of lotDoorPoints(LOT)) {
        const n = node(g, lotDoorNode(d.door));
        const t = n.translation!;
        expect(close(t[0]!, d.centre.x) && close(t[2]!, d.centre.z), d.door).toBe(true);
        const leaves = (n.children ?? []).map((c) => g.nodes![c]!.name!).sort();
        expect(leaves, d.door).toEqual([`${lotDoorNode(d.door)}_l`, `${lotDoorNode(d.door)}_r`]);
        expect(LOT.doors.find((q) => q.id === d.door)!.leaf).toBe("swing");
        const ex = extras.doors?.[d.door] ?? {};
        expect(Object.keys(ex).sort()).toEqual(["l", "r"]);
        // the two leaves turn opposite ways (inward): 90 degrees each
        expect(Math.abs(ex.l!.openDeg)).toBe(90);
        expect(ex.l!.openDeg).toBe(-ex.r!.openDeg);
      }
    });

    it("stays in the triangle, draw, material and size budgets (design 7, T10)", () => {
      const { g, bytes } = load(id);
      const shellNode = node(g, lotShellNode(id));
      expect(meshTris(g, shellNode.mesh!)).toBeLessThanOrEqual(LOT_TRIANGLES[id].shell);
      expect(g.meshes![shellNode.mesh!]!.primitives.length).toBeLessThanOrEqual(LOT_GLB_BUDGET.shellDraws);
      const detIdx = g.nodes!.findIndex((n) => n.name === lotDetailNode(id));
      const leaves = lotDoorPoints(LOT).flatMap((d) => (node(g, lotDoorNode(d.door)).children ?? []).map((c) => drawnTris(g, c)));
      const leafTris = leaves.reduce((a, b) => a + b, 0);
      expect(drawnTris(g, detIdx) + leafTris).toBeLessThanOrEqual(LOT_TRIANGLES[id].detail);
      const structure = meshTris(g, node(g, `lotdetail__${id}_mesh`).mesh!) + leafTris;
      expect(structure).toBeLessThanOrEqual(LOT_TRIANGLES[id].detail * LOT_GLB_BUDGET.structureShare);
      for (const m of [`lotdetail__${id}_mesh`, `lotgoods__${id}_mesh`]) {
        expect(g.meshes![node(g, m).mesh!]!.primitives.length, m).toBeLessThanOrEqual(LOT_GLB_BUDGET.detailDraws);
      }
      expect(g.materials!.length).toBeLessThanOrEqual(LOT_GLB_BUDGET.maxMaterials);
      expect(g.images ?? []).toHaveLength(0);
      expect(bytes).toBeLessThanOrEqual(LOT_GLB_BUDGET.maxBytes);
    });

    it("names KTX2 PBR library sets for every surface and covers the lot's families (design 6, contract 7)", () => {
      const { g } = load(id);
      const extras = (g.asset as { extras?: { textures?: string } }).extras ?? {};
      expect(extras.textures).toBe(`lots/${dir}/${id}_textures.json`);
      const man = JSON.parse(fs.readFileSync(path.join(LOTS, dir, `${id}_textures.json`), "utf8")) as Manifest;
      expect(man.format).toBe(LOT_GLB_BUDGET.textureFormat);
      const ids = pbrIds();
      const used = new Set<string>();
      for (const name of g.materials!.map((m) => m.name!)) {
        const m = man.materials[name];
        expect(m, name).toBeDefined();
        if (name === "M_glass") {
          expect(m!.kind).toBe("glass");
          continue;
        }
        expect(name.startsWith(`LM_${dir}_`), name).toBe(true);
        expect(ids.has(m!.pbr!), `${name} -> ${m!.pbr}`).toBe(true);
        expect(m!.repeatMeters).toEqual([1, 1]);
        for (const tier of ["2k", "1k"]) {
          const albedo = path.join(PBR, tier, `${m!.pbr}_albedo.ktx2`);
          expect(fs.existsSync(albedo), albedo).toBe(true);
        }
        for (const k of ["normal", "orm"]) expect(fs.existsSync(path.join(PBR, "1k", `${m!.pbr}_${k}.ktx2`)), `${m!.pbr} ${k}`).toBe(true);
        used.add(m!.pbr!);
      }
      for (const f of LOT_SURFACE_RULES.families[id]) {
        if (f === "grass" && id === "lot_school") {
          expect(used.has("grass")).toBe(true);
          continue;
        }
        expect(used, f).toContain(f);
      }
      expect(used.size).toBeLessThanOrEqual(LOT_GLB_BUDGET.pbrSets.maxDistinct);
    });
  });
}

/** A walk-in room's GLB (design 11 / contract 11): `<unit>.glb` in the room frame at the unit's interior origin. */
export function describeRoomGlb(unitId: string, dir: string): void {
  const spec = LOT_INTERIORS.find((i) => i.unit === unitId)!;
  const unit = villageLot(spec.lot).units.find((u) => u.id === unitId)!;
  const o = unit.interior.origin;
  describe(`${unitId}.glb (lots v2 B1 room)`, () => {
    const load2 = () => {
      const f = path.join(LOTS, `${unitId}.glb`);
      return { g: parseGlb(new Uint8Array(fs.readFileSync(f))).gltf, bytes: fs.statSync(f).size };
    };
    it("has the room node, every solid as a collider to the centimetre, the seats and the exit (T14)", () => {
      const { g } = load2();
      node(g, `lotroom__${unitId}`);
      const { colliders, problems } = extractColliders(g);
      expect(problems).toEqual([]);
      expect(colliders.map((c) => c.name).sort()).toEqual(spec.solids.map((s) => `col__${unitId}_${s.name}`).sort());
      for (const s of spec.solids) {
        const got = colliders.find((c) => c.name === `col__${unitId}_${s.name}`)!;
        expect(got.box.minX, s.name).toBeCloseTo(o.x + s.rect.x0, 2);
        expect(got.box.maxX, s.name).toBeCloseTo(o.x + s.rect.x1, 2);
        expect(got.box.minZ, s.name).toBeCloseTo(o.z + s.rect.z0, 2);
        expect(got.box.maxZ, s.name).toBeCloseTo(o.z + s.rect.z1, 2);
        const n = node(g, `col__${unitId}_${s.name}`);
        expect(n.translation![1]! + n.scale![1]! / 2, s.name).toBeCloseTo(s.height, 2);
      }
      for (const s of spec.seats) {
        const t = node(g, `seat__${s.id}`).translation!;
        expect(close(t[0]!, o.x + s.x) && close(t[2]!, o.z + s.z) && close(t[1]!, s.seatTop), s.id).toBe(true);
      }
      const d = lotInteriorDoor(spec);
      const t = node(g, d.node).translation!;
      expect(close(t[0]!, o.x + spec.doorX) && close(t[2]!, o.z), d.node).toBe(true);
    });

    it("stays in the room's budget, no images, KTX2 library sets only", () => {
      const { g, bytes } = load2();
      let tris = 0;
      const root = g.nodes!.findIndex((n) => n.name === `lotroom__${unitId}`);
      tris = drawnTris(g, root);
      expect(tris).toBeLessThanOrEqual(spec.budget.pc.triangles);
      expect(g.images ?? []).toHaveLength(0);
      expect(bytes).toBeLessThanOrEqual(1024 * 1024);
      const man = JSON.parse(fs.readFileSync(path.join(LOTS, dir, `${unitId}_textures.json`), "utf8")) as Manifest;
      const ids = pbrIds();
      for (const name of g.materials!.map((m) => m.name!)) {
        const m = man.materials[name];
        expect(m, name).toBeDefined();
        if (m!.kind === "glass" || m!.kind === "screen") continue;
        expect(ids.has(m!.pbr!), name).toBe(true);
        expect(fs.existsSync(path.join(PBR, "1k", `${m!.pbr}_albedo.ktx2`))).toBe(true);
      }
      for (const n of g.nodes!.map((q) => q.name ?? "")) expect(n).not.toMatch(MONEY);
    });
  });
}
