/**
 * 케이슨 마을 학교 — the B1 kit's output (docs/designs/village-lots-v2/tools/parts_lot_school.py): lot_school.glb and its
 * texture manifest checked against the lots v2 contract (villageLots.ts: colliders to the cm, seats, slots, the swing door
 * with its two hinged leaves, node names, budgets, KTX2-only PBR library sets, no money words). Shared checks: lotB1GlbChecks.ts.
 */
import { describe, expect, it } from "vitest";
import { describeLotGlb, describeRoomGlb } from "./lotB1GlbChecks";

describeLotGlb("lot_school", "school", {
  night: ["windows", "clock", "cupola", "porch", "lamps"],
  slotKinds: ["bell", "clock", "nameplate", "notice_board", "playground", "playground", "playground", "playground"],
});

describeRoomGlb("lot_school_class", "school");

describe("lot_school.glb yard trees (coordinator review 2026-11-17)", () => {
  it("leaves the yard's two trees to the village vegetation system: spots in asset.extras.vegetation, on the trunk boxes", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { parseGlb } = await import("../../../scripts/lib/schoolGlb");
    const { lotColliders, villageLot } = await import("@caysonverse/shared/village/villageLots");
    const g = parseGlb(new Uint8Array(fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "client", "public", "models", "village", "lots", "lot_school.glb")))).gltf;
    const veg = ((g.asset as { extras?: { vegetation?: Array<{ kind: string; x: number; z: number; H: number }> } }).extras?.vegetation) ?? [];
    expect(veg).toHaveLength(2);
    const trunks = lotColliders(villageLot("lot_school")).filter((c) => c.id.includes("_tree_"));
    for (const v of veg) {
      expect(["green", "young", "cherry"]).toContain(v.kind);
      expect(trunks.some((t) => v.x > t.box.minX && v.x < t.box.maxX && v.z > t.box.minZ && v.z < t.box.maxZ), JSON.stringify(v)).toBe(true);
    }
  });
});
