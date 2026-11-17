/**
 * Shared checks for B2's lot GLBs (lots v2: lot_chapel, lot_church and their walk-in rooms), after B1's lotB1GlbChecks.ts
 * (same contract checks) with what the sacred rooms add: M_screen (the stained glass seen from outside), M_lightpool (the
 * sun's coloured pools, a lot own KTX2 map), M_fire (candle flames), the sacred props' placements (asset.extras.sacred: their
 * files on disk, KTX2 only, their triangles in the room's budget) and the phone LOD of each room (`<unit>_phone.glb`).
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
  lotInteriorSeatBoxes,
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
  materials: Record<string, { pbr?: string; kind?: string; repeatMeters?: number[]; maps?: { albedo: string } }>;
  pbrSets: string[];
}

interface SacredExtra {
  node: string;
  file: string;
  phoneFile: string;
  phone: boolean;
  triangles: { pc: number; phone: number };
  drawOnly?: string;
}

const glbOf = (f: string): { g: Gltf; bytes: number } => ({ g: parseGlb(new Uint8Array(fs.readFileSync(f))).gltf, bytes: fs.statSync(f).size });

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

/** Draw calls of a node tree: one per primitive, instanced nodes once. */
function draws(g: Gltf, idx: number): number {
  const n = g.nodes![idx]!;
  let d = n.mesh !== undefined ? g.meshes![n.mesh]!.primitives.length : 0;
  for (const c of n.children ?? []) d += draws(g, c);
  return d;
}

const close = (a: number, b: number, eps = 0.011) => Math.abs(a - b) <= eps;

function pbrIds(): Set<string> {
  const src = fs.readFileSync(path.join(REPO, "client", "src", "village", "pbr", "pbrManifest.generated.ts"), "utf8");
  return new Set([...src.matchAll(/^ {4}"id": "([a-z0-9_]+)"/gm)].map((m) => m[1]!));
}

function checkManifestMaterials(g: Gltf, man: Manifest, dir: string, prefix: string | null): Set<string> {
  const ids = pbrIds();
  const used = new Set<string>();
  for (const name of g.materials!.map((m) => m.name!)) {
    const m = man.materials[name];
    expect(m, name).toBeDefined();
    if (m!.kind === "glass" || m!.kind === "screen" || m!.kind === "fire") continue;
    if (m!.kind === "own" || m!.kind === "lightpool") {
      const own = m!.maps!.albedo;
      expect(own.endsWith(".ktx2"), own).toBe(true);
      expect(fs.existsSync(path.join(LOTS, dir, own)), own).toBe(true);
      continue;
    }
    if (prefix) expect(name.startsWith(prefix), name).toBe(true);
    expect(ids.has(m!.pbr!), `${name} -> ${m!.pbr}`).toBe(true);
    expect(m!.repeatMeters).toEqual([1, 1]);
    for (const tier of ["2k", "1k"]) expect(fs.existsSync(path.join(PBR, tier, `${m!.pbr}_albedo.ktx2`)), `${m!.pbr} ${tier}`).toBe(true);
    for (const k of ["normal", "orm"]) expect(fs.existsSync(path.join(PBR, "1k", `${m!.pbr}_${k}.ktx2`)), `${m!.pbr} ${k}`).toBe(true);
    used.add(m!.pbr!);
  }
  return used;
}

export function describeB2Lot(id: LotId, dir: string, want: { night: string[]; slotKinds: string[] }): void {
  const LOT = villageLot(id);
  const load = () => glbOf(path.join(LOTS, `${id}.glb`));
  describe(`${id}.glb (lots v2 B2 kit)`, () => {
    it("has the shell, the detail (structure + goods), night glow and instanced kinds (contract 6)", () => {
      const { g } = load();
      expect(node(g, lotShellNode(id)).mesh).toBeTypeOf("number");
      const det = node(g, lotDetailNode(id));
      const goodsIdx = g.nodes!.findIndex((n) => n.name === `lotgoods__${id}`);
      expect(det.children).toContain(goodsIdx);
      expect(det.children).toContain(g.nodes!.findIndex((n) => n.name === `lotdetail__${id}_mesh`));
      const names = g.nodes!.map((n) => n.name ?? "");
      for (const part of want.night) expect(names, part).toContain(`lotnight__${id}_${part}`);
      const inst = g.nodes!.filter((n) => n.extensions && "EXT_mesh_gpu_instancing" in n.extensions);
      expect(inst.length).toBeGreaterThan(0);
      const kinds = g.nodes!.filter((n) => (n.name ?? "").startsWith(`lotinst__${id}_`) && n.mesh === undefined);
      expect(kinds.length).toBeLessThanOrEqual(LOT_GLB_BUDGET.instancedKindsPerLot);
      for (const n of names) expect(n, n).not.toMatch(MONEY);
    });

    it("has the contract's colliders, to the centimetre (contract 3, T6)", () => {
      const { g } = load();
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
      const { g } = load();
      for (const s of lotSeatMarkers(LOT)) {
        const t = node(g, `seat__${s.id}`).translation!;
        expect(close(t[0]!, s.x) && close(t[2]!, s.z) && close(t[1]!, s.seatTop), s.id).toBe(true);
      }
      for (const s of lotSlots(LOT)) {
        const t = node(g, s.node).translation!;
        expect(close(t[0]!, s.x) && close(t[1]!, s.y) && close(t[2]!, s.z), s.node).toBe(true);
        expect(s.tags).toHaveLength(0);
      }
      expect(lotSlots(LOT).map((s) => s.kind).sort()).toEqual([...want.slotKinds].sort());
      const extras = (g.asset as { extras?: { doors?: Record<string, Record<string, { openDeg: number }>> } }).extras ?? {};
      for (const d of lotDoorPoints(LOT)) {
        const n = node(g, lotDoorNode(d.door));
        const t = n.translation!;
        expect(close(t[0]!, d.centre.x) && close(t[2]!, d.centre.z), d.door).toBe(true);
        const leaves = (n.children ?? []).map((c) => g.nodes![c]!.name!).sort();
        expect(leaves, d.door).toEqual([`${lotDoorNode(d.door)}_l`, `${lotDoorNode(d.door)}_r`]);
        const ex = extras.doors?.[d.door] ?? {};
        expect(Object.keys(ex).sort()).toEqual(["l", "r"]);
        expect(Math.abs(ex.l!.openDeg)).toBe(90);
        expect(ex.l!.openDeg).toBe(-ex.r!.openDeg);
      }
    });

    it("stays in the triangle, draw, material and size budgets (design 7, T10)", () => {
      const { g, bytes } = load();
      const shellNode = node(g, lotShellNode(id));
      expect(meshTris(g, shellNode.mesh!)).toBeLessThanOrEqual(LOT_TRIANGLES[id].shell);
      expect(g.meshes![shellNode.mesh!]!.primitives.length).toBeLessThanOrEqual(LOT_GLB_BUDGET.shellDraws);
      const detIdx = g.nodes!.findIndex((n) => n.name === lotDetailNode(id));
      const leafTris = lotDoorPoints(LOT).flatMap((d) => (node(g, lotDoorNode(d.door)).children ?? []).map((c) => drawnTris(g, c))).reduce((a, b) => a + b, 0);
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
      const { g } = load();
      const extras = (g.asset as { extras?: { textures?: string } }).extras ?? {};
      expect(extras.textures).toBe(`lots/${dir}/${id}_textures.json`);
      const man = JSON.parse(fs.readFileSync(path.join(LOTS, dir, `${id}_textures.json`), "utf8")) as Manifest;
      expect(man.format).toBe(LOT_GLB_BUDGET.textureFormat);
      const used = checkManifestMaterials(g, man, dir, `LM_${dir}_`);
      for (const f of LOT_SURFACE_RULES.families[id]) expect(used, f).toContain(f);
      expect(used.size).toBeLessThanOrEqual(LOT_GLB_BUDGET.pbrSets.maxDistinct);
    });
  });
}

/** A walk-in room of B2 (design 11 / contract 11): `<unit>.glb` and its phone LOD `<unit>_phone.glb`, in the room frame. */
export function describeB2Room(unitId: string, dir: string, sacredNodes: string[]): void {
  const spec = LOT_INTERIORS.find((i) => i.unit === unitId)!;
  const unit = villageLot(spec.lot).units.find((u) => u.id === unitId)!;
  const o = unit.interior.origin;
  for (const lod of ["pc", "phone"] as const) {
    const file = path.join(LOTS, `${unitId}${lod === "phone" ? "_phone" : ""}.glb`);
    describe(`${path.basename(file)} (lots v2 B2 room, ${lod})`, () => {
      it("has the room node, every solid as a collider to the centimetre, the seats, the exit and the sacred placements (T14)", () => {
        const { g } = glbOf(file);
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
          // P6: the 0.6 m strip in front of every pew stays clear of every solid
          const { front } = lotInteriorSeatBoxes(s);
          for (const so of spec.solids) {
            const r = so.rect;
            const hit = r.x0 < front.x1 - 0.01 && r.x1 > front.x0 + 0.01 && r.z0 < front.z1 - 0.01 && r.z1 > front.z0 + 0.01;
            expect(hit, `${s.id} front vs ${so.name}`).toBe(false);
          }
        }
        const d = lotInteriorDoor(spec);
        const t = node(g, d.node).translation!;
        expect(close(t[0]!, o.x + spec.doorX) && close(t[2]!, o.z), d.node).toBe(true);
        const extras = (g.asset as { extras?: { sacred?: SacredExtra[]; origin?: { x: number; z: number } } }).extras ?? {};
        expect(extras.origin).toEqual(o);
        const sacred = extras.sacred ?? [];
        const names = g.nodes!.map((n) => n.name ?? "");
        for (const want of sacredNodes) expect(sacred.map((s) => s.node), want).toContain(want);
        for (const s of sacred) {
          expect(names, s.node).toContain(s.node);
          for (const f of [s.file, s.phoneFile]) {
            const p = path.join(REPO, "client", "public", "models", "village", f);
            expect(fs.existsSync(p), f).toBe(true);
            const sg = parseGlb(new Uint8Array(fs.readFileSync(p))).gltf;
            for (const im of sg.images ?? []) expect((im as { mimeType?: string }).mimeType, f).toBe("image/ktx2");
            if (s.drawOnly) expect(sg.nodes!.map((n) => n.name), s.drawOnly).toContain(s.drawOnly);
          }
        }
        for (const n of names) expect(n).not.toMatch(MONEY);
      });

      it(`stays in the room's ${lod} budget (room + sacred props: triangles, draws), no images, KTX2 only`, () => {
        const { g, bytes } = glbOf(file);
        const root = g.nodes!.findIndex((n) => n.name === `lotroom__${unitId}`);
        const extras = (g.asset as { extras?: { sacred?: SacredExtra[] } }).extras ?? {};
        const sacred = (extras.sacred ?? []).filter((s) => lod === "pc" || s.phone);
        const sacredTris = sacred.reduce((a, s) => a + s.triangles[lod], 0);
        const budget = spec.budget[lod];
        expect(drawnTris(g, root) + sacredTris).toBeLessThanOrEqual(budget.triangles);
        expect(draws(g, root) + sacred.length).toBeLessThanOrEqual(budget.draws);
        expect(g.images ?? []).toHaveLength(0);
        expect(bytes).toBeLessThanOrEqual(1024 * 1024);
        const man = JSON.parse(fs.readFileSync(path.join(LOTS, dir, `${unitId}_textures.json`), "utf8")) as Manifest;
        checkManifestMaterials(g, man, dir, null);
        if (g.materials!.some((m) => m.name === "M_fire")) {
          expect(names(g)).toContain(`fire__${unitId}_candles`);
          expect(names(g)).toContain(`fire__${unitId}_light`);
          expect(man.materials["M_fire"]?.kind).toBe("fire");
        }
        if (g.materials!.some((m) => m.name === "M_lightpool")) {
          expect(names(g)).toContain(`lotlight__${unitId}_pools`);
          expect(man.materials["M_lightpool"]?.kind).toBe("lightpool");
        }
      });
    });
  }
}

const names = (g: Gltf) => g.nodes!.map((q) => q.name ?? "");
