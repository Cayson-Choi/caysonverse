/**
 * 마을 절 — the B3 kits' output (docs/designs/village-lots-v2/tools/parts_lot_temple.py, parts_lot_temple_hall.py): lot_temple.glb
 * and the 대웅전 room lot_temple_hall.glb with their texture manifests, checked against the lots v2 contract (villageLots.ts)
 * with B1's shared checks (lotB1GlbChecks.ts), plus the sacred props' markers (contract 11: `lotstatue__` / `lotart__`) and
 * the temple's naming rules (only the sign words "케이슨산", "대웅전" are geometry; no order, scripture or money in node names).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseGlb } from "../../../scripts/lib/schoolGlb";
import { LOT_INTERIORS, villageLot } from "@caysonverse/shared/village/villageLots";
import { describeLotGlb, describeRoomGlb } from "./lotB1GlbChecks";

describeLotGlb("lot_temple", "temple", {
  night: ["doors", "eaves", "lantern"],
  slotKinds: ["bell", "lantern", "nameplate", "nameplate", "pond"],
});

describeRoomGlb("lot_temple_hall", "temple");

const LOTS = path.resolve(__dirname, "..", "..", "..", "client", "public", "models", "village", "lots");

describe("lot_temple_hall.glb sacred props (design 11.2, contract 11)", () => {
  const g = parseGlb(new Uint8Array(fs.readFileSync(path.join(LOTS, "lot_temple_hall.glb")))).gltf;
  const extras = (g.asset as { extras?: { sacred?: Array<{ node: string; file: string; phone: string; mirrorX: boolean }> } }).extras ?? {};
  const unit = villageLot("lot_temple").units[0]!;
  const spec = LOT_INTERIORS.find((i) => i.unit === "lot_temple_hall")!;

  it("marks the 본존불, the two 협시보살 (the right one mirrored) and the 후불탱화, each with its PC and phone file on disk", () => {
    const sac = extras.sacred ?? [];
    expect(sac.map((s) => s.node).sort()).toEqual([
      "lotart__lot_temple_hall_taenghwa",
      "lotstatue__lot_temple_hall_bodhisattva_l",
      "lotstatue__lot_temple_hall_bodhisattva_r",
      "lotstatue__lot_temple_hall_buddha",
    ]);
    for (const s of sac) {
      for (const f of [s.file, s.phone]) expect(fs.existsSync(path.join(LOTS, f)), f).toBe(true);
      const n = g.nodes!.find((q) => q.name === s.node)!;
      expect(n, s.node).toBeDefined();
      expect((n.scale?.[0] ?? 1) < 0, s.node).toBe(s.mirrorX);
    }
    expect(sac.filter((s) => s.mirrorX).map((s) => s.node)).toEqual(["lotstatue__lot_temple_hall_bodhisattva_r"]);
  });

  it("stands the figures on the 수미단 (inside its solid, on its top) and hangs the 탱화 behind them", () => {
    const sumidan = spec.solids.find((s) => s.name === "sumidan")!;
    for (const s of extras.sacred ?? []) {
      const t = g.nodes!.find((q) => q.name === s.node)!.translation!;
      const x = t[0]! - unit.interior.origin.x;
      const z = t[2]! - unit.interior.origin.z;
      expect(x > sumidan.rect.x0 && x < sumidan.rect.x1 && z > sumidan.rect.z0 && z < sumidan.rect.z1, s.node).toBe(true);
      if (s.node.startsWith("lotstatue__")) expect(t[1]!).toBeCloseTo(sumidan.height, 2);
      else expect(t[1]!).toBeGreaterThan(2.0);
    }
  });

  it("names nothing after a real order, scripture or money", () => {
    for (const f of ["lot_temple.glb", "lot_temple_hall.glb"]) {
      const gg = parseGlb(new Uint8Array(fs.readFileSync(path.join(LOTS, f)))).gltf;
      for (const n of gg.nodes!.map((q) => q.name ?? "")) expect(n, f).not.toMatch(/卐|swastika|sutra|scripture|price|ticket|shop/i);
    }
  });
});
